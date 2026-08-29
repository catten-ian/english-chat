/* 结构化日志：request id、JSONL 文件输出、级别过滤、轮转 */
'use strict';

// 必须在 require 任何 server/* 之前把数据目录指到临时位置（config 在首次 require 时读取 env）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-logger-'));
process.env.AI_EN_DATA_DIR = tmp;
// 小轮转阈值，便于测试
process.env.AI_EN_LOG_MAX_BYTES = '4096';
process.env.AI_EN_LOG_KEEP = '3';

const logger = require('../server/services/logger');
const { LOG_DIR, LOG_FILE } = logger;

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
}

test('newRequestId 返回 12 位十六进制且互不相同', () => {
  const a = logger.newRequestId();
  const b = logger.newRequestId();
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.notStrictEqual(a, b);
});

test('info 日志写入 JSONL 文件（含级别与消息）', () => {
  logger.info('hello structured world', { id: 'abc123', k: 1 });
  const lines = readJsonl(LOG_FILE);
  const last = lines[lines.length - 1];
  assert.strictEqual(last.level, 'info');
  assert.strictEqual(last.msg, 'hello structured world');
  assert.strictEqual(last.id, 'abc123');
  assert.strictEqual(last.k, 1);
  assert.ok(last.ts);
});

test('error 级别的 Error 对象序列化为堆栈字符串', () => {
  const e = new Error('boom-boom');
  logger.error('something failed', { err: e });
  const lines = readJsonl(LOG_FILE);
  const last = lines[lines.length - 1];
  assert.strictEqual(last.level, 'error');
  assert.ok(String(last.err).includes('boom-boom'), 'err 字段应含错误信息');
});

test('低于阈值的 debug 不写文件', () => {
  const before = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
  logger.debug('this should be filtered');
  const after = fs.statSync(LOG_FILE).size;
  assert.ok(!readJsonl(LOG_FILE).some(l => l.msg === 'this should be filtered'));
  assert.strictEqual(after, before, 'debug 不应写入任何字节');
});

test('超过大小上限自动轮转，保留文件数受 KEEP 限制', () => {
  // 写入超过 4096 字节触发轮转
  const big = 'x'.repeat(200);
  for (let i = 0; i < 60; i++) logger.info(`rotation-test ${i} ${big}`);
  const files = fs.readdirSync(LOG_DIR).filter(f => /^server\.log(\.\d+)?$/.test(f)).sort();
  assert.ok(files.length > 1, '应产生轮转文件，实际：' + files.join(','));
  const maxIdx = Math.max(...files.map(f => {
    const m = f.match(/^server\.log\.(\d+)$/);
    return m ? Number(m[1]) : 0; // 当前文件 server.log 记 0
  }));
  assert.ok(maxIdx <= 3, '轮转文件数不应超过 KEEP=3（不含当前文件），实际 maxIdx=' + maxIdx);
  // 所有轮转文件都应是合法 JSONL
  for (const f of files) {
    if (f === 'server.log') continue;
    const lines = readJsonl(path.join(LOG_DIR, f));
    assert.ok(lines.length > 0);
    assert.ok(lines.every(l => l.level && l.msg));
  }
});

test('真实服务进程会输出结构化请求日志（id/路径/状态/耗时）', async () => {
  const { startServer, request } = require('./helpers');
  const s = await startServer({ tag: 'slog', env: { AI_EN_LOG_TO_FILE: '1' } });
  try {
    await request({ port: s.port, method: 'GET', path: '/api/health' });
    // 未知 API 端点：落在鉴权门槛之后是 404（带 token 才会走到 404 分支），
    // 不带 token 时是 401 —— 两者都应记录
    await request({ port: s.port, method: 'POST', path: '/api/no-such-endpoint', json: {} });
    const logFile = path.join(s.dataDir, 'logs', 'server.log');
    assert.ok(fs.existsSync(logFile), '服务应写请求日志文件');
    const lines = readJsonl(logFile);
    const health = lines.find(l => l.path === '/api/health');
    assert.ok(health, '应记录 /api/health 请求');
    assert.match(health.id, /^[0-9a-f]{12}$/);
    assert.strictEqual(health.method, 'GET');
    assert.strictEqual(health.status, 200);
    assert.ok(Number.isFinite(health.ms) && health.ms >= 0);
    const rejected = lines.find(l => l.path === '/api/no-such-endpoint');
    assert.ok(rejected && (rejected.status === 401 || rejected.status === 404), '应记录 401/404');
  } finally {
    await s.stop();
    s.cleanup();
  }
});
