/* ============================================================
   AI 英语对话教练 - 静态文件路由（server/routes/static.js）
   安全模型：每个公开 URL 前缀映射到一个独立的物理根目录。
   - 先解码，再逐段校验，最后用 path.resolve + 前缀比较确认没有逃出该根目录
   - 任何 '..' / 反斜杠 / NUL / 绝对路径一律拒绝
   - 扩展名必须在白名单内（不再用 octet-stream 兜底，避免 .env/.db 被下载）
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sendJson } = require('../helpers');
const { STATIC_MIME, STATIC_DIRS, INDEX_FILE } = require('../config');

// 严格 CSP：脚本只允许同源外链（所有 inline onclick / <script> 已改为 data-action 委托）；
// 样式保留 'unsafe-inline'（大量 style 属性 / KaTeX 注入）；图片/音频放开 data: 与 blob:
// （头像 dataURL、TTS 与录音为 blob URL）；字体同源；禁止 frame/object。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

// 把 URL 相对路径安全地解析到指定根目录内；失败返回 null
function resolveInside(root, relPath) {
  if (!relPath) return null;
  // 拒绝 NUL、反斜杠（Windows 分隔符）、以及任何形式的父级引用
  if (relPath.includes('\0') || relPath.includes('\\')) return null;
  const segments = relPath.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return null;
  }
  if (path.isAbsolute(relPath)) return null;
  const resolved = path.resolve(root, segments.join(path.sep));
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) return null;
  return resolved;
}

function sendFile(res, abs) {
  const ext = path.extname(abs).toLowerCase();
  const mime = STATIC_MIME[ext];
  if (!mime) { sendJson(res, 404, { error: 'not found' }); return; }
  fs.readFile(abs, (err, data) => {
    if (err) { sendJson(res, 404, { error: 'not found' }); return; }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': CSP
    });
    res.end(data);
  });
}

function serveStatic(res, pathname) {
  // URL pathname 保留百分号编码，需解码以支持中文文件名；解码失败直接拒绝
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (e) { sendJson(res, 400, { error: 'bad request' }); return; }
  if (decoded.includes('\0')) { sendJson(res, 400, { error: 'bad request' }); return; }

  if (decoded === '/' || decoded === '/index.html') { sendFile(res, INDEX_FILE); return; }

  for (const [prefix, root] of Object.entries(STATIC_DIRS)) {
    if (!decoded.startsWith(prefix)) continue;
    const abs = resolveInside(root, decoded.slice(prefix.length));
    if (!abs) { sendJson(res, 404, { error: 'not found' }); return; }
    sendFile(res, abs);
    return;
  }
  sendJson(res, 404, { error: 'not found' });
}

module.exports = { serveStatic };