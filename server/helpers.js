/* ============================================================
   AI 英语对话教练 - HTTP 助手（server/helpers.js）
   CORS 头 / JSON 响应 / 请求体读取（按实际字节累计，不信任 Content-Length）
   ============================================================ */
'use strict';

const { ALLOWED_ORIGINS, MAX_BODY } = require('./config');

function corsHeaders(req) {
  const origin = req && req.headers && req.headers.origin;
  const h = {};
  if (ALLOWED_ORIGINS.has(origin || '')) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, xi-api-key';
  h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  return h;
}

function sendJson(res, status, obj, req) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req || {}) });
  res.end(body);
}

/* 读取请求体：按实际字节累计，不信任 Content-Length
   （chunked / 缺少 Content-Length 的请求同样受 limit 约束）
   超限时返回 null（调用方回 413），剩余数据直接丢弃，不继续累积内存 */
function readBody(req, limit) {
  const max = limit || MAX_BODY;
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > max) { resolve(null); return; }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onError);
      resolve(val);
    };
    function onData(c) {
      // 超限后到达的数据直接丢弃（listener 保留用于消耗流，避免 socket 缓冲堆积）
      if (settled) return;
      size += c.length;
      if (size > max) {
        settled = true;
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        req.removeListener('aborted', onError);
        chunks.length = 0;
        resolve(null); // handler 收到 null → 回 413，连接由框架正常关闭
        return;
      }
      chunks.push(c);
    }
    function onEnd() { finish(Buffer.concat(chunks)); }
    function onError() { finish(null); }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onError);
  });
}

module.exports = { corsHeaders, sendJson, readBody };