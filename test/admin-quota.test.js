'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.AI_EN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-admin-quota-'));
const { db } = require('../server/db');
const usage = require('../server/services/usage');
const admin = require('../server/routes/admin');
const gift = { provider: 'minimax', kind: 'chat', model: 'MiniMax-M3' };
let serial = 0;
function user(extra = {}) {
  const id = Number(db.prepare('INSERT INTO users(username,password_hash,role,daily_call_limit,rpm_limit,provider_mode) VALUES(?,?,?,?,?,?)')
    .run(extra.username || 'quota-' + (++serial), 'test-hash', extra.role || 'user', extra.daily ?? 100, extra.rpm ?? 10, extra.mode || 'gift').lastInsertRowid);
  return id;
}
async function invoke(handler, uid, payload) {
  const req = Readable.from(payload ? [Buffer.from(JSON.stringify(payload))] : []);
  req.uid = uid; req.headers = {}; req.method = 'POST';
  let status; let body;
  const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
  await handler(req, res);
  return { status, body };
}

test('new users have 100 gifts and rolling 10 RPM; zero gifts remains zero', () => {
  const uid = user();
  assert.equal(usage.quotaStatus(uid).daily, 100);
  assert.equal(usage.quotaStatus(uid).rpm, 10);
  const zero = user({ daily: 0 });
  assert.equal(usage.reserveGiftCall(zero, gift).allowed, false);
  assert.equal(usage.quotaStatus(zero).daily, 0);
});

test('only catten/test are unlimited; role/custom mode do not bypass site gifts', () => {
  for (const extra of [{ mode: 'custom' }, { role: 'admin' }]) {
    const uid = user({ ...extra, daily: 0 });
    assert.equal(usage.reserveGiftCall(uid, gift).allowed, false);
    assert.equal(usage.reserveGiftCall(uid, { ...gift, personal: true }).allowed, true);
  }
  for (const username of ['catten', 'test']) {
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    const uid = existing?.id || user({ username, daily: 0 });
    assert.equal(usage.reserveGiftCall(uid, gift).unlimited, true);
  }
  assert.equal(usage.reserveGiftCall(9999999, gift).allowed, false);
});

test('concurrent in-flight requests reserve daily gifts before upstream completion', async () => {
  const uid = user({ daily: 3, rpm: 100 });
  const results = await Promise.all(Array.from({ length: 15 }, async () => usage.reserveGiftCall(uid, gift)));
  assert.equal(results.filter(r => r.allowed).length, 3);
  assert.equal(usage.quotaStatus(uid).used, 3);
  for (const r of results.filter(r => r.allowed)) usage.finishGiftCall(r.reservationId, 200);
  assert.equal(usage.reserveGiftCall(uid, gift).allowed, false);
});

test('usage-history deletion and upstream reported model cannot reset gift spending', () => {
  const uid = user({ daily: 1 });
  const q = usage.reserveGiftCall(uid, gift);
  usage.recordUsage({ userId: uid, ...gift, model: 'upstream-alias', reservationId: q.reservationId, status: 200 });
  usage.finishGiftCall(q.reservationId, 200);
  usage.clearUsage(uid);
  assert.equal(usage.quotaStatus(uid).used, 1);
  assert.equal(usage.reserveGiftCall(uid, gift).allowed, false);
});

test('failed calls restore daily gifts, but repeated failures still obey rolling RPM', () => {
  const uid = user({ daily: 1, rpm: 2 });
  const a = usage.reserveGiftCall(uid, gift);
  usage.finishGiftCall(a.reservationId, 503);
  assert.equal(usage.quotaStatus(uid).used, 0);
  const b = usage.reserveGiftCall(uid, gift);
  assert.equal(b.allowed, true);
  usage.finishGiftCall(b.reservationId, 502);
  assert.equal(usage.reserveGiftCall(uid, gift).allowed, false);
  db.prepare('UPDATE gift_calls SET created_ms=? WHERE user_id=?').run(Date.now() - 61000, uid);
  assert.equal(usage.reserveGiftCall(uid, gift).allowed, true);
});

test('gift ledger survives a process restart and deleting analytics as first operation', () => {
  const uid = user({ daily: 1 });
  const q = usage.reserveGiftCall(uid, gift);
  usage.finishGiftCall(q.reservationId, 200);
  const code = "const u=require('./server/services/usage');u.clearUsage(" + uid + "); console.log('RESULT='+JSON.stringify(u.quotaStatus(" + uid + ')));';
  const child = spawnSync(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.match(/RESULT=(.*)/)[1]);
  assert.equal(result.used, 1);
  assert.equal(result.allowed, false);
});

test('personally paid M3 usage is logged without consuming gifts', () => {
  const uid = user({ daily: 1 });
  usage.recordUsage({ userId: uid, ...gift, personal: true, status: 200 });
  assert.equal(usage.quotaStatus(uid).used, 0);
  assert.equal(usage.reserveGiftCall(uid, gift).allowed, true);
});

test('admin rejects unauthorized, fractional, missing and non-finite limits and persists zero', async () => {
  const adminId = user({ role: 'admin' }); const uid = user();
  const valid = { user_id: uid, daily_call_limit: 0, rpm_limit: 7, role: 'user', provider_mode: 'gift' };
  assert.equal((await invoke(admin.updateUser, uid, valid)).status, 403);
  for (const bad of [{ daily_call_limit: 0.5 }, { daily_call_limit: null }, { daily_call_limit: '100' }, { rpm_limit: -2 }, { rpm_limit: 1.5 }, { role: 'owner' }, { provider_mode: 'unlimited' }]) {
    assert.equal((await invoke(admin.updateUser, adminId, { ...valid, ...bad })).status, 400);
  }
  assert.equal((await invoke(admin.updateUser, adminId, valid)).status, 200);
  assert.equal(usage.quotaStatus(uid).daily, 0);
  assert.equal(usage.quotaStatus(uid).rpm, 7);
  assert.equal((await invoke(admin.updateUser, adminId, { ...valid, user_id: adminId })).status, 400);
  const listing = await invoke(admin.listUsers, adminId);
  assert.equal(listing.status, 200);
  assert.equal(listing.body.users.find(u => u.id === uid).quota.daily, 0);
});
