/* ============================================================
   AI 英语对话教练 - 结构化日志（server/services/logger.js）
   - 控制台输出人类可读行；文件输出 JSONL（每行一个 JSON 对象）
   - 每个请求带短 request id，便于把同一次请求的多条日志串起来
   - 文件按大小轮转：server.log → server.log.1 → … → .N，超出丢弃
   - 零依赖；文件写入失败只降级为控制台输出，绝不影响请求
   环境变量：
     AI_EN_LOG_TO_FILE=0   关闭文件日志（默认开）
     AI_EN_LOG_MAX_BYTES   单文件上限字节（默认 5MB）
     AI_EN_LOG_KEEP        保留轮转文件数（默认 5）
     AI_EN_LOG_LEVEL       debug/info/warn/error（默认 info）
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.AI_EN_LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOG_ENABLED = process.env.AI_EN_LOG_TO_FILE !== '0';
const LOG_FILE = LOG_ENABLED ? path.join(LOG_DIR, 'server.log') : null;
const MAX_BYTES = Math.max(4096, Number(process.env.AI_EN_LOG_MAX_BYTES) || 5 * 1024 * 1024);
const KEEP = Math.max(1, Number(process.env.AI_EN_LOG_KEEP) || 5);

let _bytes = 0;
let _fileBroken = false;

if (LOG_FILE) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try { _bytes = fs.statSync(LOG_FILE).size; } catch (e) { _bytes = 0; }
  } catch (e) {
    _fileBroken = true;
    console.error('[LOG] 日志目录不可用，文件日志已降级关闭:', e.message);
  }
}

/* 生成短请求 id（12 位十六进制，碰撞概率可忽略，且比 uuid 短便于阅读） */
function newRequestId() {
  return crypto.randomBytes(6).toString('hex');
}

function rotateLocked() {
  // server.log.(N-1) → .N …… server.log → .1；最老的一份自然被覆盖丢弃
  for (let i = KEEP - 1; i >= 1; i--) {
    const from = path.join(LOG_DIR, `server.log.${i}`);
    const to = path.join(LOG_DIR, `server.log.${i + 1}`);
    try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch (e) {}
  }
  try { fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'server.log.1')); } catch (e) {}
  _bytes = 0;
}

function writeFile(line) {
  if (!LOG_FILE || _fileBroken) return;
  try {
    if (_bytes + Buffer.byteLength(line) > MAX_BYTES) rotateLocked();
    fs.appendFileSync(LOG_FILE, line);
    _bytes += Buffer.byteLength(line);
  } catch (e) {
    _fileBroken = true; // 后续不再重试，避免每条日志都抛
    console.error('[LOG] 写日志文件失败，已降级为仅控制台:', e.message);
  }
}

function safeConsole(fn, line) {
  // stdout/stderr 管道在客户端断开 / 父进程关闭后会被设 EPIPE；
  // 这里吞掉异常，保证日志失败不会反过来把请求拉下水
  try { fn(line); } catch (e) { /* stderr broken, swallow */ }
}

function log(level, msg, meta) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const t = new Date();
  const pad = (n, w) => String(n).padStart(w, '0');
  const htime = `${pad(t.getHours(), 2)}:${pad(t.getMinutes(), 2)}:${pad(t.getSeconds(), 2)}.${pad(t.getMilliseconds(), 3)}`;
  const idTag = meta && meta.id ? ` (${meta.id})` : '';
  const tag = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' }[level];
  // 控制台：人类可读
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  safeConsole(consoleFn, `[${htime}] ${tag}${idTag} ${msg}`);
  // 错误对象在控制台也打出堆栈（文件里则序列化为 err 字段）
  if (meta && meta.err) safeConsole(consoleFn, meta.err instanceof Error ? (meta.err.stack || meta.err.message) : meta.err);
  // 文件：JSONL
  const entry = Object.assign({ ts: t.toISOString(), level, msg }, meta || {});
  if (entry.err instanceof Error) { entry.err = entry.err.stack || entry.err.message; }
  writeFile(JSON.stringify(entry) + '\n');
}

module.exports = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  newRequestId,
  LOG_FILE,
  LOG_DIR
};
