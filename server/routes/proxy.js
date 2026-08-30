/* ============================================================
   AI 英语对话教练 - 代理路由（server/routes/proxy.js）
   POST /api/proxy/chat             MiniMax 非流式
   POST /api/proxy/chat/stream      MiniMax 流式 SSE（客户端断开即中止上游）
   POST /api/proxy/websearch        MiniMax web search
   POST /api/proxy/tts/:voiceId     ElevenLabs TTS
   POST /api/proxy/anki             AnkiConnect 代理（白名单 + 牌组归属校验）
   ============================================================ */
'use strict';

const { corsHeaders, sendJson, readBody } = require('../helpers');
const {
  MINIMAX_KEY, ELEVEN_KEY, MINIMAX_BASE,
  PROXY_TIMEOUT, STREAM_IDLE_TIMEOUT, STREAM_TOTAL_TIMEOUT, MAX_ANKI_BODY
} = require('../config');
const { proxyRequest } = require('../services/proxy');
const { ankiCall, ankiCache, parseAnkiBody } = require('../services/anki');
const { ankiGuard } = require('../validation');
const logger = require('../services/logger');
const { recordUsage, parseChatUsage, parseStreamUsage } = require('../services/usage');

// MiniMax chat（非流式）
async function chat(req, res) {
  const body = await readBody(req);
  const r = await proxyRequest(MINIMAX_BASE + '/v1/chat/completions', body, { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + MINIMAX_KEY });
  // 用量记账（只记数字，不记内容）
  const u = parseChatUsage(r.data) || {};
  recordUsage({
    userId: req.uid, provider: 'minimax', kind: 'chat', model: u.model,
    promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
    status: r.status
  });
  res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req) });
  res.end(r.data);
}

// MiniMax chat（流式 SSE）
async function chatStream(req, res) {
  const body = await readBody(req);
  // 一个 controller 贯穿整个流生命周期：
  // 客户端断开（点「停止」/关页面）必须真正中止上游，否则 MiniMax 会继续生成并计费
  const ctrl = new AbortController();
  let closed = false;
  const abortUpstream = () => {
    if (closed) return;
    closed = true;
    try { ctrl.abort(); } catch (e) {}
  };
  req.on('aborted', abortUpstream);
  req.on('close', abortUpstream);
  res.on('close', abortUpstream);

  // 建连 / 等首字节超时
  let connectTimer = setTimeout(abortUpstream, PROXY_TIMEOUT);
  // 整个流的总时长上限
  const totalTimer = setTimeout(abortUpstream, STREAM_TOTAL_TIMEOUT);
  let idleTimer = null;
  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(abortUpstream, STREAM_IDLE_TIMEOUT);
  };
  const cleanup = () => {
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
    req.removeListener('aborted', abortUpstream);
    req.removeListener('close', abortUpstream);
    res.removeListener('close', abortUpstream);
  };

  let upstream;
  try {
    upstream = await fetch(MINIMAX_BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Accept-Encoding': 'identity', 'Authorization': 'Bearer ' + MINIMAX_KEY },
      body,
      signal: ctrl.signal
    });
  } catch (e) {
    cleanup();
    if (!res.headersSent) sendJson(res, 502, { error: 'proxy_stream_failed', detail: String(e.message || e).slice(0, 200) }, req);
    return;
  }
  clearTimeout(connectTimer);
  connectTimer = null;

  // 上游报错时不要伪装成 200 SSE：读取有限错误体，把真实状态码透传给前端
  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 500); } catch (e) {}
    cleanup();
    if (!res.headersSent) sendJson(res, upstream.status || 502, { error: 'upstream_error', status: upstream.status, detail }, req);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'close', ...corsHeaders(req) });
  const reader = upstream.body.getReader();
  bumpIdle();
  // 只保留流的尾部用于抽取 usage 帧（MiniMax 在最后一个 data 帧给 usage）。
  // 不累计整段回复：既省内存，也避免把生成内容留在服务端。
  let tail = '';
  const TAIL_MAX = 4096;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (closed || res.writableEnded) break;
      bumpIdle();
      const chunk = Buffer.from(value);
      tail = (tail + chunk.toString('utf8')).slice(-TAIL_MAX);
      // 处理背压：write 返回 false 时等 drain，避免内存堆积
      if (!res.write(chunk)) {
        await new Promise((resolve) => {
          const onDrain = () => { res.removeListener('close', onDrain); resolve(); };
          res.once('drain', onDrain);
          res.once('close', onDrain);
        });
      }
    }
  } catch (e) {
    // 客户端主动断开属正常情况，不当作错误
    if (!closed) logger.error('SSE stream error: ' + e.message, { id: req.id, err: e });
  } finally {
    try { await reader.cancel(); } catch (e) {}
    cleanup();
    // 记账：流被中止时上游可能没发 usage 帧，此时只记一次请求（tokens 未知）
    const u = parseStreamUsage(tail) || {};
    recordUsage({
      userId: req.uid, provider: 'minimax', kind: 'chat_stream', model: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      status: 200
    });
    if (!res.writableEnded) res.end();
  }
}

// MiniMax web search
async function websearch(req, res) {
  const body = await readBody(req);
  const r = await proxyRequest(MINIMAX_BASE + '/v1/coding_plan/search', body, { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + MINIMAX_KEY });
  // 联网搜索按次计（不记搜索词）
  recordUsage({ userId: req.uid, provider: 'minimax', kind: 'websearch', status: r.status });
  res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req) });
  res.end(r.data);
}

// ElevenLabs TTS
async function tts(req, res, voiceId) {
  const body = await readBody(req);
  // TTS 按字符计费：从请求体里只取 text 长度（不留文本内容）
  let chars = 0;
  let ttsModel = null;
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    chars = (parsed && typeof parsed.text === 'string') ? parsed.text.length : 0;
    ttsModel = parsed && parsed.model_id ? String(parsed.model_id) : null;
  } catch (e) {}
  const r = await proxyRequest('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, body, { 'Content-Type': 'application/json', 'xi-api-key': ELEVEN_KEY }, 30000);
  recordUsage({ userId: req.uid, provider: 'elevenlabs', kind: 'tts', model: ttsModel, chars, status: r.status });
  res.writeHead(r.status, { 'Content-Type': 'audio/mpeg', ...corsHeaders(req) });
  res.end(r.data);
}

// AnkiConnect 代理
async function ankiProxy(req, res) {
  const body = await readBody(req, MAX_ANKI_BODY);
  if (!body) { sendJson(res, 413, { ok: false, error: 'body too large' }, req); return; }
  let payload = null;
  try { payload = JSON.parse(body.toString('utf8')); } catch (e) {
    sendJson(res, 400, { ok: false, error: 'invalid json' }, req);
    return;
  }
  // 白名单 + 牌组归属校验：AnkiConnect 无鉴权，不能原样转发任意 action
  const denied = ankiGuard(payload, req.username);
  if (denied) { sendJson(res, denied.status, { ok: false, error: denied.error }, req); return; }
  const action = String(payload.action);

  // 缓存命中：直接转发，不再每次探测 version（省一次往返）
  if (ankiCache.get()) {
    const cached = await ankiCall(8765, action, body);
    if (cached.ok) {
      try {
        const parsed = JSON.parse(cached.body);
        if (!parsed.error) {
          sendJson(res, 200, { ok: true, url: ankiCache.get(), result: parsed }, req);
          return;
        }
      } catch (e) {}
      // 有 error → 缓存可能失效，清空回落探测
      ankiCache.clear();
    } else {
      ankiCache.clear(); // 连接失败 → 清缓存
    }
  }

  // 首次或缓存失效：探测 version 确认可用（只发最小探测 payload，避免把原请求的 params 误传给 version）
  const probe = await ankiCall(8765, 'version', Buffer.from(JSON.stringify({ action: 'version', version: 6 })));
  if (!probe.ok) { sendJson(res, 503, { ok: false, error: 'ankiconnect unreachable', last: probe.err }, req); return; }
  let probeResult = null;
  try { probeResult = JSON.parse(probe.body); } catch (e) {}
  if (probeResult && probeResult.error) { sendJson(res, 503, { ok: false, error: 'ankiconnect unreachable', last: probe.body.slice(0, 120) }, req); return; }
  ankiCache.set('http://127.0.0.1:8765');
  // 转发原请求
  const r = await ankiCall(8765, action, body);
  if (!r.ok) { sendJson(res, 502, { ok: false, error: r.err, url: ankiCache.get() }, req); return; }
  try {
    const parsed = JSON.parse(r.body);
    sendJson(res, 200, { ok: true, url: ankiCache.get(), result: parsed }, req);
  } catch (e) {
    sendJson(res, 200, { ok: true, url: ankiCache.get(), result: { raw: r.body.slice(0, 200) } }, req);
  }
}

module.exports = { chat, chatStream, websearch, tts, ankiProxy };