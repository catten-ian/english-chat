/* ============================================================
   AI 英语对话教练 - 服务与密钥路由（server/routes/keys.js）

   让用户在设置面板里完成「换 key / 检测连通性」，不用手动改
   .env 再重启。安全边界：

   - 密钥永不明文回传：GET 只返回掩码（前4…后4）
   - 写入 .env 用原子替换（临时文件 + rename），失败不破坏原文件
   - service 参数白名单：minimax | eleven
   - 写入后立即更新进程内配置（config.setRuntimeKey），无需重启
   - 来源为进程环境变量（env）的 key：写文件会成功但不会生效
     （env 优先级更高），响应里带 sourceWarning 提示
   - 检测端点用真实上游做一次最小成本请求，只返回 ok/detail
   ============================================================ */
'use strict';

const path = require('node:path');
const { sendJson, readBody } = require('../helpers');
const {
  MINIMAX_KEY, ELEVEN_KEY, MINIMAX_BASE,
  KEY_SOURCES, setRuntimeKey, setMinimaxBase, ENV_FILE
} = require('../config');
const { maskKey, writeEnvKey } = require('../services/envfile');
const { proxyRequest } = require('../services/proxy');
const logger = require('../services/logger');

function status(req, res) {
  sendJson(res, 200, {
    minimax: {
      configured: !!MINIMAX_KEY(),
      masked: maskKey(MINIMAX_KEY()),
      source: KEY_SOURCES.minimax,
      base: MINIMAX_BASE()
    },
    eleven: {
      configured: !!ELEVEN_KEY(),
      masked: maskKey(ELEVEN_KEY()),
      source: KEY_SOURCES.eleven
    },
    envFile: path.basename(ENV_FILE)
  }, req);
}

/* POST { service, key } —— 更换密钥 */
async function rotate(req, res) {
  const body = await readBody(req, 64 * 1024);
  if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); } catch (e) {
    sendJson(res, 400, { error: 'invalid json' }, req); return;
  }
  const service = payload && payload.service;
  const key = payload && typeof payload.key === 'string' ? payload.key.trim() : '';
  // 服务白名单 → .env 键名
  const SERVICES = { minimax: 'MINIMAX_API_KEY', eleven: 'ELEVEN_API_KEY' };
  const envKey = SERVICES[service];
  if (!envKey) { sendJson(res, 400, { error: 'unknown service' }, req); return; }
  if (!key) { sendJson(res, 400, { error: 'key is required' }, req); return; }
  if (key.length < 8 || key.length > 512) { sendJson(res, 400, { error: 'key length looks wrong' }, req); return; }

  try {
    writeEnvKey(ENV_FILE, envKey, key);
  } catch (e) {
    logger.error('写入 .env 失败: ' + e.message, { err: e });
    sendJson(res, 500, { error: 'failed to write .env', detail: e.message }, req);
    return;
  }
  // 进程内立即生效；并同步来源
  setRuntimeKey(service, key);
  KEY_SOURCES[service] = 'file';
  logger.info(`[KEYS] ${service} 密钥已更新（来源 .env，掩码 ${maskKey(key)}）`);

  const sourceWarning = process.env[envKey]
    ? '注意：当前进程环境变量里也设置了 ' + envKey + '，它的优先级更高，本次写入的 .env 要到 env 移除后才会生效。'
    : null;
  sendJson(res, 200, {
    status: 'rotated',
    service,
    masked: maskKey(key),
    active: true,
    sourceWarning
  }, req);
}

/* POST { base } —— 更新 MiniMax 上游地址（如反代/镜像）。写入 .env 同样原子替换 */
async function rotateBase(req, res) {
  const body = await readBody(req, 64 * 1024);
  if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); } catch (e) {
    sendJson(res, 400, { error: 'invalid json' }, req); return;
  }
  const base = payload && typeof payload.base === 'string' ? payload.base.trim().replace(/\/+$/, '') : '';
  if (!base || !/^https?:\/\//.test(base) || base.length > 200) {
    sendJson(res, 400, { error: 'base must be a valid http(s) URL' }, req); return;
  }
  try {
    writeEnvKey(ENV_FILE, 'MINIMAX_BASE', base);
  } catch (e) {
    logger.error('写入 .env 失败: ' + e.message, { err: e });
    sendJson(res, 500, { error: 'failed to write .env', detail: e.message }, req); return;
  }
  setMinimaxBase(base);
  sendJson(res, 200, { status: 'rotated', service: 'minimax_base', base }, req);
}

/* POST /api/keys/test/:service —— 用保存的 key 做一次最小成本真实请求 */
async function testKey(req, res, service) {
  if (service === 'minimax') {
    const key = MINIMAX_KEY();
    if (!key) { sendJson(res, 200, { ok: false, detail: '未配置 MINIMAX_API_KEY' }, req); return; }
    try {
      // max_tokens=1 的最小请求：验证鉴权与连通，成本几乎为 0
      const r = await proxyRequest(MINIMAX_BASE() + '/v1/chat/completions',
        Buffer.from(JSON.stringify({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })),
        { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + key });
      if (r.status === 200) { sendJson(res, 200, { ok: true, detail: '连接成功（MiniMax 鉴权通过）' }, req); return; }
      let detail = 'HTTP ' + r.status;
      try {
        const errObj = JSON.parse(r.data.toString('utf8'));
        if (errObj && errObj.base_resp && errObj.base_resp.status_msg) detail += ': ' + errObj.base_resp.status_msg;
        else if (errObj && errObj.error) detail += ': ' + (errObj.error.message || JSON.stringify(errObj.error)).slice(0, 120);
      } catch (e) {}
      sendJson(res, 200, { ok: false, detail }, req);
    } catch (e) {
      sendJson(res, 200, { ok: false, detail: '网络错误: ' + String(e.message || e).slice(0, 120) }, req);
    }
    return;
  }
  if (service === 'eleven') {
    const key = ELEVEN_KEY();
    if (!key) { sendJson(res, 200, { ok: false, detail: '未配置 ELEVEN_API_KEY' }, req); return; }
    try {
      // /v1/user 只读账户信息：零成本、且能验证鉴权
      const r = await proxyRequest('https://api.elevenlabs.io/v1/user',
        Buffer.from(''), { 'xi-api-key': key });
      if (r.status === 200) { sendJson(res, 200, { ok: true, detail: '连接成功（ElevenLabs 鉴权通过）' }, req); return; }
      sendJson(res, 200, { ok: false, detail: 'HTTP ' + r.status + (r.status === 401 ? '（key 无效或已过期）' : '') }, req);
    } catch (e) {
      sendJson(res, 200, { ok: false, detail: '网络错误: ' + String(e.message || e).slice(0, 120) }, req);
    }
    return;
  }
  sendJson(res, 400, { error: 'unknown service' }, req);
}

module.exports = { keysStatus: status, keysRotate: rotate, keysRotateBase: rotateBase, keysTest: testKey };
