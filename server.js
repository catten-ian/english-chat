#!/usr/bin/env node
/* ============================================================
   AI 英语对话教练 - Backend Server (Node.js, 零依赖)
   - SQLite 存储（node:sqlite, WAL），按用户隔离
   - 登录/会话/多用户（PBKDF2 密码哈希，会话 30 天）
   - 代理：MiniMax chat/stream/websearch、ElevenLabs TTS、AnkiConnect
   - 静态白名单 + 127.0.0.1 绑定 + CORS localhost/null
   - Keys 从环境变量或 ai-english-chat/.env 读取
============================================================ */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

const BASE = __dirname;
const DATA_DIR = path.join(BASE, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'app.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MAX_BODY = 24 * 1024 * 1024;
const PROXY_TIMEOUT = 60000;
const SESSION_TTL_DAYS = 30;

/* ==================== Keys: env > .env ==================== */
function loadEnvFile(p) {
  const out = {};
  try {
    const txt = fs.readFileSync(p, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || m[0].startsWith('#')) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) {}
  return out;
}
const env = { ...loadEnvFile(path.join(BASE, '.env')) };
const MINIMAX_KEY = process.env.MINIMAX_API_KEY || env.MINIMAX_API_KEY || '';
const ELEVEN_KEY = process.env.ELEVEN_API_KEY || env.ELEVEN_API_KEY || '';
const MINIMAX_BASE = process.env.MINIMAX_BASE || env.MINIMAX_BASE || 'https://api.minimaxi.com';

if (!MINIMAX_KEY) console.log('[WARN] MiniMax API key 未配置（ai-english-chat/.env 或环境变量）');
if (!ELEVEN_KEY) console.log('[WARN] ElevenLabs API key 未配置（ai-english-chat/.env 或环境变量）');

const ALLOWED_ORIGINS = new Set(['null', 'http://localhost:8091', 'http://127.0.0.1:8091']);
let _ankiWorkingUrl = null; // AnkiConnect 工作地址缓存

/* ==================== Database ==================== */
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_data (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

function hashPassword(pwd, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.pbkdf2Sync(pwd, salt, 100000, 32, 'sha256').toString('hex');
  return salt + ':' + h;
}
function verifyPassword(pwd, stored) {
  try {
    const [salt, h] = stored.split(':');
    return crypto.timingSafeEqual(
      Buffer.from(h, 'hex'),
      Buffer.from(crypto.pbkdf2Sync(pwd, salt, 100000, 32, 'sha256').toString('hex'), 'hex')
    );
  } catch (e) { return false; }
}
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  for (const [u, p] of [['test', 'test'], ['catten', 'catten']]) {
    db.prepare('INSERT OR IGNORE INTO users (username, password_hash) VALUES (?,?)').run(u, hashPassword(p));
  }
  console.log('[SEED] 已创建账户 test / catten（密码与账户名相同）');
  // 迁移旧 JSON 数据到 catten
  const catten = db.prepare('SELECT id FROM users WHERE username=?').get('catten');
  if (catten) {
    for (const key of ['conversations', 'vocab', 'weak', 'settings']) {
      const fp = path.join(DATA_DIR, key + '.json');
      if (!fs.existsSync(fp)) continue;
      try {
        const raw = fs.readFileSync(fp, 'utf8');
        if (raw.trim().length <= 2) continue;
        let val = JSON.parse(raw);
        if (key === 'conversations' && Array.isArray(val)) {
          val = { conv_legacy: { id: 'conv_legacy', title: '旧对话（已迁移）', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: val } };
        }
        db.prepare('INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?,?,?, datetime(\'now\')) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=datetime(\'now\')')
          .run(catten.id, key, JSON.stringify(val));
        console.log('[MIGRATE] imported', key);
      } catch (e) { console.log('[MIGRATE] skip', key, e.message); }
    }
  }
}

function userByToken(token) {
  return db.prepare('SELECT s.user_id uid, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > ?')
    .get(token, new Date().toISOString()) || null;
}

/* ==================== Backend proxy (Node fetch) ==================== */
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

/* ==================== Anki proxy (direct socket to 127.0.0.1:8765) ==================== */
function ankiCall(port, action, payloadBuf) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: port || 8765 }, () => {
      const urlPath = '/' + action;
      sock.write(Buffer.from(
        `POST ${urlPath} HTTP/1.1\r\nHost: 127.0.0.1:${port || 8765}\r\nContent-Type: application/json\r\nContent-Length: ${payloadBuf.length}\r\nConnection: close\r\n\r\n`
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
    sock.setTimeout(2500, () => { sock.destroy(); resolve({ ok: false, err: 'timeout' }); });
  });
}

/* ==================== HTTP helpers ==================== */
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
function readBody(req) {
  return new Promise((resolve) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_BODY) { resolve(null); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}
function auth(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return userByToken(auth.slice(7).trim());
}

/* ==================== Static whitelist ==================== */
const STATIC_ROOTS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.m4a': 'audio/mp4' };
function serveStatic(res, pathname) {
  if (pathname === '/' || pathname === '/index.html') pathname = '/index.html';
  if (!/^\/(index\.html|css\/|js\/|vendor\/)/.test(pathname)) { sendJson(res, 404, { error: 'not found' }); return; }
  const abs = path.normalize(path.join(BASE, pathname));
  if (!abs.startsWith(BASE)) { sendJson(res, 404, { error: 'not found' }); return; }
  fs.readFile(abs, (err, data) => {
    if (err) { sendJson(res, 404, { error: 'not found' }); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'Content-Type': STATIC_ROOTS[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

/* ==================== Server ==================== */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(200, corsHeaders(req));
    res.end();
    return;
  }

  try {
    // Health（无需鉴权）
    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok', db: DB_PATH, minimax: !!MINIMAX_KEY, eleven: !!ELEVEN_KEY }, req);
      return;
    }
    // 刷新 Anki 连接缓存
    if (method === 'GET' && pathname === '/api/health/anki') {
      _ankiWorkingUrl = null;
      sendJson(res, 200, { status: 'cache_cleared' }, req);
      return;
    }

    // 登录（无需鉴权）
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      let payload = {};
      try { payload = JSON.parse(body.toString('utf8')); } catch (e) {}
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '');
      const user = db.prepare('SELECT id, password_hash FROM users WHERE username=?').get(username);
      if (!user || !verifyPassword(password, user.password_hash)) {
        sendJson(res, 401, { error: '用户名或密码错误' }, req);
        return;
      }
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
        .run(token, user.id, new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString());
      sendJson(res, 200, { token, username }, req);
      return;
    }

    if (method === 'GET' && !pathname.startsWith('/api/')) {
      serveStatic(res, pathname);
      return;
    }

    // 其余需要鉴权
    const au = auth(req);
    if (!au) { sendJson(res, 401, { error: 'unauthorized' }, req); return; }
    const uid = au.uid;

    if (method === 'GET' && pathname === '/api/auth/me') {
      sendJson(res, 200, { username: au.username }, req);
      return;
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const authh = req.headers.authorization || '';
      db.prepare('DELETE FROM sessions WHERE token=?').run(authh.slice(7).trim());
      sendJson(res, 200, { status: 'ok' }, req);
      return;
    }

    // 用户数据读写
    const dbMatch = pathname.match(/^\/api\/db\/(\w+)$/);
    if (dbMatch) {
      const key = dbMatch[1];
      if (!['conversations', 'vocab', 'weak', 'settings'].includes(key)) { sendJson(res, 400, { error: 'unknown key' }, req); return; }
      if (method === 'GET') {
        const row = db.prepare('SELECT value FROM user_data WHERE user_id=? AND key=?').get(uid, key);
        let val = null;
        if (row) { try { val = JSON.parse(row.value); } catch (e) { val = null; } }
        sendJson(res, 200, val, req);
        return;
      }
      if (method === 'POST') {
        const body = await readBody(req);
        if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
        db.prepare('INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?,?,?, datetime(\'now\')) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=datetime(\'now\')')
          .run(uid, key, body.toString('utf8'));
        sendJson(res, 200, { status: 'saved', key }, req);
        return;
      }
      sendJson(res, 405, { error: 'method' }, req);
      return;
    }

    // 备份（VACUUM INTO）
    if (method === 'POST' && pathname === '/api/backup') {
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const out = path.join(BACKUP_DIR, `${ts}_chat.db`).replace(/'/g, "''");
      try {
        db.exec("VACUUM INTO '" + out + "'");
      } catch (e) { sendJson(res, 500, { error: 'backup failed', detail: e.message }, req); return; }
      const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('_chat.db')).sort();
      while (backups.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
      sendJson(res, 200, { status: 'backed up', file: path.basename(out).replace(/''/g, "'") }, req);
      return;
    }

    // MiniMax chat（非流式）
    if (method === 'POST' && pathname === '/api/proxy/chat') {
      const body = await readBody(req);
      const r = await proxyRequest(MINIMAX_BASE + '/v1/chat/completions', body, { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + MINIMAX_KEY });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req) });
      res.end(r.data);
      return;
    }

    // MiniMax chat（流式 SSE）
    if (method === 'POST' && pathname === '/api/proxy/chat/stream') {
      const body = await readBody(req);
      let upstream;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT);
        upstream = await fetch(MINIMAX_BASE + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Accept-Encoding': 'identity', 'Authorization': 'Bearer ' + MINIMAX_KEY },
          body,
          signal: ctrl.signal
        });
        clearTimeout(timer);
      } catch (e) {
        sendJson(res, 502, { error: 'proxy_stream_failed', detail: String(e.message || e).slice(0, 200) }, req);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'close', ...corsHeaders(req) });
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    // MiniMax web search
    if (method === 'POST' && pathname === '/api/proxy/websearch') {
      const body = await readBody(req);
      const r = await proxyRequest(MINIMAX_BASE + '/v1/coding_plan/search', body, { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + MINIMAX_KEY });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req) });
      res.end(r.data);
      return;
    }

    // ElevenLabs TTS
    const ttsMatch = pathname.match(/^\/api\/proxy\/tts\/([\w-]+)$/);
    if (method === 'POST' && ttsMatch) {
      const voiceId = ttsMatch[1];
      const body = await readBody(req);
      const r = await proxyRequest('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, body, { 'Content-Type': 'application/json', 'xi-api-key': ELEVEN_KEY }, 30000);
      res.writeHead(r.status, { 'Content-Type': 'audio/mpeg', ...corsHeaders(req) });
      res.end(r.data);
      return;
    }

    // AnkiConnect 代理
    if (method === 'POST' && pathname === '/api/proxy/anki') {
      const body = await readBody(req);
      let payload = {};
      try { payload = JSON.parse(body.toString('utf8')); } catch (e) {}
      const action = String(payload.action || 'version');

      // 缓存命中：直接转发，不再每次探测 version（省一次往返）
      if (_ankiWorkingUrl) {
        const cached = await ankiCall(8765, action, body);
        if (cached.ok) {
          try {
            const parsed = JSON.parse(cached.body);
            if (!parsed.error) {
              sendJson(res, 200, { ok: true, url: _ankiWorkingUrl, result: parsed }, req);
              return;
            }
          } catch (e) {}
          // 有 error → 缓存可能失效，清空回落探测
          _ankiWorkingUrl = null;
        } else {
          _ankiWorkingUrl = null; // 连接失败 → 清缓存
        }
      }

      // 首次或缓存失效：探测 version 确认可用（只发最小探测 payload，避免把原请求的 params 误传给 version）
      const probe = await ankiCall(8765, 'version', Buffer.from(JSON.stringify({ action: 'version', version: 6 })));
      if (!probe.ok) { sendJson(res, 503, { ok: false, error: 'ankiconnect unreachable', last: probe.err }, req); return; }
      let probeResult = null;
      try { probeResult = JSON.parse(probe.body); } catch (e) {}
      if (probeResult && probeResult.error) { sendJson(res, 503, { ok: false, error: 'ankiconnect unreachable', last: probe.body.slice(0, 120) }, req); return; }
      _ankiWorkingUrl = 'http://127.0.0.1:8765';
      // 转发原请求
      const r = await ankiCall(8765, action, body);
      if (!r.ok) { sendJson(res, 502, { ok: false, error: r.err, url: _ankiWorkingUrl }, req); return; }
      try {
        const parsed = JSON.parse(r.body);
        sendJson(res, 200, { ok: true, url: _ankiWorkingUrl, result: parsed }, req);
      } catch (e) {
        sendJson(res, 200, { ok: true, url: _ankiWorkingUrl, result: { raw: r.body.slice(0, 200) } }, req);
      }
      return;
    }

    // 静态
    if (method === 'GET') { serveStatic(res, pathname); return; }

    sendJson(res, 404, { error: 'not found' }, req);
  } catch (e) {
    console.error('[ERR]', e);
    sendJson(res, 500, { error: 'internal error' }, req);
  }
});

const PORT = Number(process.argv[2] || 8091);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[AI English Chat] Server: http://localhost:${PORT}  (127.0.0.1 only)`);
  console.log(`[AI English Chat] DB: ${DB_PATH}`);
  console.log(`[AI English Chat] 账户: test / catten（密码与账户名相同，scripts/manage_users.py 修改）`);
  console.log(`[AI English Chat] MiniMax key: ${MINIMAX_KEY ? 'set' : 'MISSING'} | ElevenLabs key: ${ELEVEN_KEY ? 'set' : 'MISSING'}`);
  console.log('Press Ctrl+C to stop');
});
server.on('error', (e) => { console.error('Server error:', e.message); process.exit(1); });