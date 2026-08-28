/* ============================================================
   测试辅助：在临时目录里启动一个真实 server.js 子进程
   - 通过 AI_EN_DATA_DIR / AI_EN_DB_PATH 注入临时数据目录
   - 绝不触碰仓库里的 data/app.db 与 .env
   - 端口取 0 之外的随机高位端口（server.js 只接受显式端口参数）
============================================================ */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');

const APP_DIR = path.resolve(__dirname, '..');
const SERVER = path.join(APP_DIR, 'server.js');

function makeTempDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-test-' + (tag || '') + '-'));
  return dir;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

/* 启动服务；resolve 时保证 /api/health 已可用 */
async function startServer(opts) {
  const options = opts || {};
  const dataDir = options.dataDir || makeTempDir('data');
  const port = options.port || (await freePort());
  const env = {
    ...process.env,
    AI_EN_DATA_DIR: dataDir,
    // 显式清空 key，避免测试意外命中真实外部服务
    MINIMAX_API_KEY: '',
    ELEVEN_API_KEY: '',
    ...(options.env || {})
  };
  const child = spawn(process.execPath, [SERVER, String(port)], {
    cwd: APP_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
  child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });

  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));

  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const r = await request({ port, method: 'GET', path: '/api/health' });
      if (r.status === 200) { ready = true; break; }
    } catch (e) { /* 还没起来 */ }
    await sleep(120);
  }

  const server = {
    port,
    dataDir,
    child,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    exited,
    /* 硬停止。注意：Windows 上 child.kill() 走 TerminateProcess，
       不会触发进程内的 SIGINT/SIGTERM handler，因此这不是「优雅关闭」。 */
    async stop() {
      if (child.exitCode !== null) return child.exitCode;
      child.kill();
      const code = await Promise.race([exited, sleep(4000).then(() => null)]);
      if (code === null) { try { child.kill('SIGKILL'); } catch (e) {} }
      return code;
    },
    /* 尝试优雅关闭。Windows 无法向其他进程投递 SIGTERM，
       返回 false 表示本平台不支持，调用方应跳过相关断言。 */
    async gracefulStop() {
      if (process.platform === 'win32') { await this.stop(); return false; }
      if (child.exitCode !== null) return true;
      child.kill('SIGTERM');
      const code = await Promise.race([exited, sleep(8000).then(() => null)]);
      if (code === null) { try { child.kill('SIGKILL'); } catch (e) {} return false; }
      return true;
    },
    cleanup() {
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
    }
  };

  if (!ready) {
    await server.stop();
    throw new Error(`server 未在超时内就绪 (exit=${child.exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return server;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* 发一个 HTTP 请求。opts: { port, method, path, token, json, raw, headers, chunkedBytes } */
function request(opts) {
  return new Promise((resolve, reject) => {
    const headers = { ...(opts.headers || {}) };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

    let payload;
    if (opts.json !== undefined) {
      payload = Buffer.from(JSON.stringify(opts.json), 'utf8');
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    } else if (opts.raw !== undefined) {
      payload = Buffer.isBuffer(opts.raw) ? opts.raw : Buffer.from(String(opts.raw), 'utf8');
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    // chunkedBytes 模式：不设 Content-Length，Node 自动用 chunked 传输
    // 调用方显式给了 Content-Length 时不要覆盖（用于测试「声明过大」场景）
    const hasExplicitLen = Object.keys(headers).some(k => k.toLowerCase() === 'content-length');
    if (payload && !opts.chunkedBytes && !hasExplicitLen) headers['Content-Length'] = payload.length;

    const req = http.request(
      { host: '127.0.0.1', port: opts.port, method: opts.method || 'GET', path: opts.path, headers },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c.toString('utf8'); });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', (e) => reject(e));

    if (opts.chunkedBytes) {
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      let sent = 0;
      const total = opts.chunkedBytes;
      const write = () => {
        while (sent < total) {
          if (req.destroyed) return;
          const n = Math.min(chunk.length, total - sent);
          sent += n;
          if (!req.write(chunk.subarray(0, n))) { req.once('drain', write); return; }
        }
        req.end();
      };
      write();
      return;
    }
    req.end(payload);
  });
}

/* 走原始 socket 发请求，用于测试 path traversal（不让 http 客户端归一化路径） */
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (c) => { buf += c.toString('binary'); });
    sock.on('end', () => {
      const m = buf.match(/^HTTP\/1\.\d (\d{3})/);
      const idx = buf.indexOf('\r\n\r\n');
      resolve({
        status: m ? Number(m[1]) : 0,
        head: idx >= 0 ? buf.slice(0, idx) : buf,
        body: idx >= 0 ? buf.slice(idx + 4) : ''
      });
    });
    sock.on('error', reject);
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error('rawGet timeout')); });
  });
}

async function login(port, username, password) {
  const r = await request({ port, method: 'POST', path: '/api/auth/login', json: { username, password } });
  if (r.status !== 200) throw new Error('login failed: ' + r.status + ' ' + r.body);
  return JSON.parse(r.body).token;
}

function openDb(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(dbPath);
}

module.exports = { APP_DIR, SERVER, startServer, request, rawGet, login, sleep, makeTempDir, freePort, openDb, crypto };
