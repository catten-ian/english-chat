'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.AI_EN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-gift-proxy-'));
process.env.MINIMAX_API_KEY = 'site-fake-key';
process.env.OPENAI_API_KEY = 'site-openai-fake-key';
const { db } = require('../server/db');
const { quotaStatus } = require('../server/services/usage');
const { saveProviderConfig } = require('../server/services/provider-credentials');
let proxyImpl;
require('../server/services/proxy').proxyRequest = (...args) => proxyImpl(...args);
const routes = require('../server/routes/proxy');
const { resolveProvider } = require('../server/services/providers');
let serial = 0;
function user(daily = 100, rpm = 100) {
  return Number(db.prepare('INSERT INTO users(username,password_hash,daily_call_limit,rpm_limit) VALUES(?,?,?,?)')
    .run('proxy-gift-' + (++serial), 'x', daily, rpm).lastInsertRowid);
}
class Response extends EventEmitter {
  constructor() { super(); this.status = null; this.headersSent = false; this.writableEnded = false; this.parts = []; }
  writeHead(status) { this.status = status; this.headersSent = true; }
  write(part) { this.parts.push(Buffer.from(part).toString()); return true; }
  end(part) { if (part) this.parts.push(Buffer.from(part).toString()); this.writableEnded = true; }
  get body() { return this.parts.join(''); }
}
function request(uid, extra = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'Explain present perfect in English.' }], ...extra }))]);
  req.uid = uid; req.headers = {}; return req;
}
async function chat(uid, extra = {}) {
  const res = new Response(); await routes.chat(request(uid, extra), res); return res;
}

test('gift proxy rejects provider/model/identity/accounting spoof and malformed input', async () => {
  let calls = 0;
  proxyImpl = async () => { calls++; return { status: 200, data: Buffer.from('{}') }; };
  const uid = user(0);
  for (const extra of [{ model: 'other-M3' }, { provider: 'openai', model: 'gpt-4o-mini' }]) {
    assert.equal((await chat(uid, { ...extra, personal: true, userId: 1 })).status, 403);
  }
  for (const extra of [{ model: {} }, { messages: [] }, { messages: [{ role: 'user', content: {} }] }]) assert.equal((await chat(uid, extra)).status, 400);
  assert.equal((await chat(uid, { personal: true, uid: 1 })).status, 429);
  assert.equal(calls, 0);
});

test('site-funded canonical request prepends learning scope and strips client accounting flags', async () => {
  const uid = user(1); let sent;
  proxyImpl = async (url, body, headers) => { sent = JSON.parse(body); assert.equal(headers.Authorization, 'Bearer site-fake-key'); return { status: 200, data: Buffer.from('{"model":"unexpected-alias"}') }; };
  const res = await chat(uid, { personal: true, userId: 2, reservationId: 'spoof' });
  assert.equal(res.status, 200);
  assert.match(sent.messages[0].content, /English learning only/);
  assert.equal(sent.model, 'MiniMax-M3'); assert.equal(sent.stream, false);
  assert.equal(Object.hasOwn(sent, 'personal'), false); assert.equal(Object.hasOwn(sent, 'userId'), false);
  assert.equal(quotaStatus(uid).used, 1);
  assert.equal((await chat(uid)).status, 429);
});

test('parallel upstream requests cannot exceed reserved daily allowance', async () => {
  const uid = user(2); let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  proxyImpl = async () => { calls++; await gate; return { status: 200, data: Buffer.from('{}') }; };
  const pending = Array.from({ length: 12 }, () => chat(uid));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2); assert.equal(quotaStatus(uid).used, 2);
  release();
  const responses = await Promise.all(pending);
  assert.equal(responses.filter(r => r.status === 200).length, 2);
  assert.equal(responses.filter(r => r.status === 429).length, 10);
});

test('upstream failures release daily allowance while rolling RPM limits all attempts', async () => {
  const uid = user(1, 2);
  proxyImpl = async () => { throw new Error('offline'); };
  assert.equal((await chat(uid)).status, 502); assert.equal(quotaStatus(uid).used, 0);
  proxyImpl = async () => ({ status: 503, data: Buffer.from('{}') });
  assert.equal((await chat(uid)).status, 503); assert.equal(quotaStatus(uid).used, 0);
  assert.equal((await chat(uid)).status, 429);
});

test('only encrypted account-owned credentials bypass gifts, without cross-user leakage', async () => {
  const uid = user(0); const other = user(0);
  saveProviderConfig(uid, 'openai', { key: 'paid-fake-key', model: 'gpt-4o-mini' });
  assert.equal(resolveProvider('openai', uid).personal, true);
  assert.equal(resolveProvider('openai', other).personal, false);
  proxyImpl = async (url, body, headers) => {
    assert.equal(headers.Authorization, 'Bearer paid-fake-key');
    assert.equal(JSON.parse(body).messages.length, 1);
    return { status: 200, data: Buffer.from('{}') };
  };
  assert.equal((await chat(uid, { provider: 'openai', model: 'gpt-4o-mini' })).status, 200);
  assert.equal(quotaStatus(uid).used, 0);
  assert.equal((await chat(other, { provider: 'openai', model: 'gpt-4o-mini', personal: true })).status, 403);
  saveProviderConfig(uid, 'minimax', { key: 'personal-m3-key', model: 'MiniMax-M3' });
  proxyImpl = async (url, body, headers) => {
    assert.equal(headers.Authorization, 'Bearer personal-m3-key');
    return { status: 200, data: Buffer.from('{"model":"MiniMax-M3"}') };
  };
  assert.equal((await chat(uid)).status, 200);
  assert.equal(quotaStatus(uid).used, 0);
});

test('stream connection errors and upstream error responses release gifts', async () => {
  const oldFetch = global.fetch;
  try {
    const uid = user(1);
    global.fetch = async () => { throw new Error('network failed'); };
    let res = new Response(); await routes.chatStream(request(uid), res);
    assert.equal(res.status, 502); assert.equal(quotaStatus(uid).used, 0);
    global.fetch = async () => ({ ok: false, status: 503, text: async () => 'unavailable' });
    res = new Response(); await routes.chatStream(request(uid), res);
    assert.equal(res.status, 503); assert.equal(quotaStatus(uid).used, 0);
  } finally { global.fetch = oldFetch; }
});

test('started stream cancellation aborts upstream and consumes exactly one gift', async () => {
  const oldFetch = global.fetch;
  try {
    const uid = user(1); let signal; let canceled = false; let reads = 0;
    const res = new Response();
    global.fetch = async (url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, body: { getReader: () => ({
        async read() { if (++reads === 1) return { done: false, value: Buffer.from('data: {"choices":[]}\n\n') }; res.emit('close'); throw new Error('aborted'); },
        async cancel() { canceled = true; }
      }) } };
    };
    await routes.chatStream(request(uid), res);
    assert.equal(res.status, 200); assert.equal(signal.aborted, true); assert.equal(canceled, true);
    assert.equal(quotaStatus(uid).used, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM gift_calls WHERE user_id=?').get(uid).n, 1);
  } finally { global.fetch = oldFetch; }
});

test('accepted stream read failure retains one gift and cleans the reader', async () => {
  const oldFetch = global.fetch;
  try {
    const uid = user(1); let canceled = false;
    global.fetch = async () => ({ ok: true, status: 200, body: { getReader: () => ({
      async read() { throw new Error('read failed'); }, async cancel() { canceled = true; }
    }) } });
    const res = new Response(); await routes.chatStream(request(uid), res);
    assert.equal(res.status, 200); assert.equal(res.writableEnded, true); assert.equal(canceled, true);
    assert.equal(quotaStatus(uid).used, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM gift_calls WHERE user_id=?').get(uid).n, 1);
  } finally { global.fetch = oldFetch; }
});

test('successful stream forces stream mode and does not abort on completed request close', async () => {
  const oldFetch = global.fetch;
  try {
    const uid = user(1); const req = request(uid); const res = new Response(); let first = true;
    global.fetch = async (url, options) => {
      req.emit('close'); assert.equal(options.signal.aborted, false);
      assert.equal(JSON.parse(options.body).stream, true);
      return { ok: true, status: 200, body: { getReader: () => ({
        async read() { if (!first) return { done: true }; first = false; return { done: false, value: Buffer.from('data: {"model":"alias","usage":{"total_tokens":4}}\n\n') }; },
        async cancel() {}
      }) } };
    };
    await routes.chatStream(req, res);
    assert.equal(res.status, 200); assert.equal(quotaStatus(uid).used, 1);
    assert.equal(db.prepare('SELECT total_tokens FROM usage_log WHERE user_id=?').get(uid).total_tokens, 4);
  } finally { global.fetch = oldFetch; }
});
