/* ============================================================
   AI 英语对话教练 - AnkiConnect 调用（server/services/anki.js）
   - 直接走本机 socket 到 127.0.0.1:8765（AnkiConnect 是 HTTP 服务）
   - 维护工作地址缓存，省掉每次探测 version 的往返
   ============================================================ */
'use strict';

const net = require('node:net');

// AnkiConnect 工作地址缓存（null 表示尚未探测/已失效）
// AnkiConnect endpoints are user preference state. Never share a private
// bridge choice between accounts in the same Node process.
const _ankiWorkingUrls = new Map();

/* 发送一次 AnkiConnect 请求并解析出 HTTP body（有限长度保护）。
   任何错误都 resolve({ ok:false, err }) 而不是 reject，方便调用方统一处理。 */
function ankiCall(portOrUrl, action, payloadBuf, timeoutMs) {
  return new Promise((resolve) => {
    const t = timeoutMs || 2500;
    const target = typeof portOrUrl === 'string' ? new URL(portOrUrl) : null;
    const host = target ? target.hostname : '127.0.0.1';
    const port = target ? Number(target.port || 80) : (portOrUrl || 8765);
    const path = target ? (target.pathname || '/') : '/' + action;
    const sock = net.createConnection({ host, port }, () => {
      sock.write(Buffer.from(
        `POST ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nContent-Type: application/json\r\nContent-Length: ${payloadBuf.length}\r\nConnection: close\r\n\r\n`
      ));
      sock.write(payloadBuf);
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); });
    sock.on('end', () => {
      const txt = buf.toString('utf8');
      const idx = txt.indexOf('\r\n\r\n');
      let body = idx >= 0 ? txt.slice(idx + 4) : txt;
      const head = idx >= 0 ? txt.slice(0, idx) : '';
      const cl = head.match(/content-length:\s*(\d+)/i);
      if (cl) body = body.slice(0, Number(cl[1]));
      resolve({ ok: true, body });
    });
    sock.on('error', (e) => resolve({ ok: false, err: e.message }));
    sock.setTimeout(t, () => { sock.destroy(); resolve({ ok: false, err: 'timeout' }); });
  });
}

/* 解析 AnkiConnect HTTP 响应体为 JSON 结果（{ result, error }） */
function parseAnkiBody(rawBody) {
  const headEnd = rawBody.indexOf('\r\n\r\n');
  const bodyStr = headEnd >= 0 ? rawBody.slice(headEnd + 4) : rawBody;
  const clMatch = rawBody.match(/content-length:\s*(\d+)/i);
  const jsonStr = clMatch ? bodyStr.slice(0, Number(clMatch[1])) : bodyStr;
  return JSON.parse(jsonStr);
}

const ankiCache = {
  get(userKey = 'anonymous') { return _ankiWorkingUrls.get(String(userKey)) || null; },
  set(userKey = 'anonymous', url) {
    // Backward-compatible set(url) for any non-route callers.
    if (url === undefined) { url = userKey; userKey = 'anonymous'; }
    _ankiWorkingUrls.set(String(userKey), String(url));
  },
  clear(userKey) {
    if (userKey === undefined || userKey === null) _ankiWorkingUrls.clear();
    else _ankiWorkingUrls.delete(String(userKey));
  }
};

module.exports = { ankiCall, parseAnkiBody, ankiCache };
