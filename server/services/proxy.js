/* ============================================================
   AI 英语对话教练 - 上游代理（server/services/proxy.js）
   MiniMax / ElevenLabs 的非流式 POST 转发（Node fetch）
   ============================================================ */
'use strict';

const { PROXY_TIMEOUT } = require('../config');

/* 转发一个 POST 到上游，返回 { status, headers, data(Buffer) }。
   超时通过 AbortController 中止，避免挂死的上游请求泄漏。 */
async function proxyRequest(url, bodyBuf, headers, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || PROXY_TIMEOUT);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: bodyBuf, signal: ctrl.signal });
    const data = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, data };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { proxyRequest };