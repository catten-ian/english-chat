/* 认证、会话、修改密码、token 哈希存储 */
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');
const { startServer, request, login, openDb } = require('./helpers');

describe('认证与会话', () => {
  let srv;

  before(async () => { srv = await startServer({ tag: 'auth' }); });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('错误密码 401，正确密码返回 token', async () => {
    const bad = await request({ port: srv.port, method: 'POST', path: '/api/auth/login', json: { username: 'test', password: 'nope' } });
    assert.strictEqual(bad.status, 401);

    const ok = await request({ port: srv.port, method: 'POST', path: '/api/auth/login', json: { username: 'test', password: 'test' } });
    assert.strictEqual(ok.status, 200);
    const j = JSON.parse(ok.body);
    assert.match(j.token, /^[0-9a-f]{64}$/);
    assert.strictEqual(j.username, 'test');
  });

  test('未鉴权访问受保护接口返回 401', async () => {
    for (const p of ['/api/auth/me', '/api/db/vocab', '/api/gaokao/exams', '/api/auth/sessions']) {
      const r = await request({ port: srv.port, path: p });
      assert.strictEqual(r.status, 401, `${p} 应 401`);
    }
  });

  test('伪造 token 不被接受', async () => {
    const r = await request({ port: srv.port, path: '/api/auth/me', token: 'f'.repeat(64) });
    assert.strictEqual(r.status, 401);
  });

  test('数据库中不存明文 token，只存 SHA-256', async () => {
    const token = await login(srv.port, 'test', 'test');
    const db = openDb(path.join(srv.dataDir, 'app.db'));
    try {
      const rows = db.prepare('SELECT token_hash FROM sessions').all();
      assert.ok(rows.length > 0, '应存在会话记录');
      for (const r of rows) {
        assert.notStrictEqual(r.token_hash, token, 'token 不应以明文存储');
        assert.match(r.token_hash, /^[0-9a-f]{64}$/);
      }
      const expected = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
      assert.ok(rows.some(r => r.token_hash === expected), '应能通过哈希匹配到该会话');
      // 旧的明文 token 列必须已不存在
      const cols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
      assert.ok(!cols.includes('token'), 'sessions 不应再有明文 token 列');
    } finally { db.close(); }
  });

  test('logout 后 token 失效', async () => {
    const token = await login(srv.port, 'test', 'test');
    assert.strictEqual((await request({ port: srv.port, path: '/api/auth/me', token })).status, 200);
    assert.strictEqual((await request({ port: srv.port, method: 'POST', path: '/api/auth/logout', token })).status, 200);
    assert.strictEqual((await request({ port: srv.port, path: '/api/auth/me', token })).status, 401);
  });

  test('会话列表可查看，revoke-others 只保留当前会话', async () => {
    const a = await login(srv.port, 'catten', 'catten');
    const b = await login(srv.port, 'catten', 'catten');
    const c = await login(srv.port, 'catten', 'catten');

    const list = await request({ port: srv.port, path: '/api/auth/sessions', token: a });
    assert.strictEqual(list.status, 200);
    const sessions = JSON.parse(list.body).sessions;
    assert.ok(sessions.length >= 3);
    assert.strictEqual(sessions.filter(s => s.current).length, 1, '应恰好一个 current');
    // 展示用 id 是哈希前缀，不足以还原 token
    for (const s of sessions) assert.strictEqual(s.id.length, 12);

    const rev = await request({ port: srv.port, method: 'POST', path: '/api/auth/revoke-others', token: a });
    assert.strictEqual(rev.status, 200);
    assert.ok(JSON.parse(rev.body).revoked >= 2);

    assert.strictEqual((await request({ port: srv.port, path: '/api/auth/me', token: a })).status, 200);
    assert.strictEqual((await request({ port: srv.port, path: '/api/auth/me', token: b })).status, 401);
    assert.strictEqual((await request({ port: srv.port, path: '/api/auth/me', token: c })).status, 401);
  });
});

describe('修改密码', () => {
  let srv;

  before(async () => { srv = await startServer({ tag: 'pw' }); });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('原密码错误 401', async () => {
    const token = await login(srv.port, 'test', 'test');
    const r = await request({
      port: srv.port, method: 'POST', path: '/api/auth/change-password', token,
      json: { old_password: 'wrong', new_password: 'brandnew' }
    });
    assert.strictEqual(r.status, 401);
  });

  test('新密码过短/过长 400', async () => {
    const token = await login(srv.port, 'test', 'test');
    const short = await request({
      port: srv.port, method: 'POST', path: '/api/auth/change-password', token,
      json: { old_password: 'test', new_password: 'ab' }
    });
    assert.strictEqual(short.status, 400);

    const long = await request({
      port: srv.port, method: 'POST', path: '/api/auth/change-password', token,
      json: { old_password: 'test', new_password: 'x'.repeat(201) }
    });
    assert.strictEqual(long.status, 400);
  });

  test('成功修改：撤销其他会话，保留当前会话，旧密码失效', async () => {
    const cur = await login(srv.port, 'test', 'test');
    const other = await login(srv.port, 'test', 'test');

    const r = await request({
      port: srv.port, method: 'POST', path: '/api/auth/change-password', token: cur,
      json: { old_password: 'test', new_password: 'newpass123' }
    });
    assert.strictEqual(r.status, 200);
    assert.ok(JSON.parse(r.body).revoked_sessions >= 1);

    // 当前会话保留，其他会话失效
    assert.strictEqual((await request({ port: srv.port, path: '/api/auth/me', token: cur })).status, 200);
    assert.strictEqual((await request({ port: srv.port, path: '/api/auth/me', token: other })).status, 401);

    // 旧密码不可用，新密码可用
    const oldLogin = await request({ port: srv.port, method: 'POST', path: '/api/auth/login', json: { username: 'test', password: 'test' } });
    assert.strictEqual(oldLogin.status, 401);
    const newLogin = await request({ port: srv.port, method: 'POST', path: '/api/auth/login', json: { username: 'test', password: 'newpass123' } });
    assert.strictEqual(newLogin.status, 200);
  });
});
