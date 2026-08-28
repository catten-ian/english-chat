/* 用户数据读写：账户隔离、类型校验、请求体上限 */
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { startServer, request, login } = require('./helpers');

describe('user_data 账户隔离', () => {
  let srv;

  before(async () => { srv = await startServer({ tag: 'iso' }); });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('A 写入的数据 B 读不到，且互不覆盖', async () => {
    const a = await login(srv.port, 'test', 'test');
    const b = await login(srv.port, 'catten', 'catten');

    await request({ port: srv.port, method: 'POST', path: '/api/db/vocab', token: a, json: [{ word: 'apple' }] });
    await request({ port: srv.port, method: 'POST', path: '/api/db/vocab', token: b, json: [{ word: 'banana' }, { word: 'cherry' }] });

    const ra = JSON.parse((await request({ port: srv.port, path: '/api/db/vocab', token: a })).body);
    const rb = JSON.parse((await request({ port: srv.port, path: '/api/db/vocab', token: b })).body);

    assert.deepStrictEqual(ra, [{ word: 'apple' }]);
    assert.strictEqual(rb.length, 2);
  });

  test('新账户读到 null，不会串到其他账户数据', async () => {
    const b = await login(srv.port, 'catten', 'catten');
    const r = await request({ port: srv.port, path: '/api/db/reading', token: b });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(JSON.parse(r.body), null);
  });

  test('gaokao_pushed 按账户隔离', async () => {
    const a = await login(srv.port, 'test', 'test');
    const b = await login(srv.port, 'catten', 'catten');
    const ra = JSON.parse((await request({ port: srv.port, path: '/api/gaokao/pushed', token: a })).body);
    const rb = JSON.parse((await request({ port: srv.port, path: '/api/gaokao/pushed', token: b })).body);
    assert.deepStrictEqual(ra.ids, []);
    assert.deepStrictEqual(rb.ids, []);
  });
});

describe('user_data 类型校验', () => {
  let srv;
  let token;

  before(async () => {
    srv = await startServer({ tag: 'shape' });
    token = await login(srv.port, 'test', 'test');
  });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('未知 key 400', async () => {
    const r = await request({ port: srv.port, method: 'POST', path: '/api/db/evil', token, json: {} });
    assert.strictEqual(r.status, 400);
  });

  test('非法 JSON 400，且不覆盖已有有效数据', async () => {
    await request({ port: srv.port, method: 'POST', path: '/api/db/settings', token, json: { keep: 'me' } });

    const bad = await request({ port: srv.port, method: 'POST', path: '/api/db/settings', token, raw: 'not json {{{' });
    assert.strictEqual(bad.status, 400);

    const after = JSON.parse((await request({ port: srv.port, path: '/api/db/settings', token })).body);
    assert.deepStrictEqual(after, { keep: 'me' }, '损坏数据不得覆盖有效数据');
  });

  test('顶层类型不符 400', async () => {
    const cases = [
      ['settings', [1, 2, 3]],
      ['settings', 'str'],
      ['conversations', []],
      ['vocab', { a: 1 }],
      ['weak', []],
      ['characters', {}],
      ['strategist', {}],
      ['avatar', { a: 1 }],
      ['reading', []]
    ];
    for (const [key, payload] of cases) {
      const r = await request({ port: srv.port, method: 'POST', path: '/api/db/' + key, token, json: payload });
      assert.strictEqual(r.status, 400, `${key} 传 ${JSON.stringify(payload)} 应 400，实际 ${r.status}`);
    }
  });

  test('合法类型 200 并可读回', async () => {
    const cases = [
      ['conversations', { c1: { id: 'c1', messages: [] } }],
      ['vocab', [{ word: 'x' }]],
      ['weak', { wp_1: { id: 'wp_1', count: 1 } }],
      ['characters', [{ id: 'alex' }]],
      ['strategist', [{ text: 'hi', permanent: true }]],
      ['avatar', 'data:image/png;base64,AAAA'],
      ['reading', { history: [], highlights: [] }]
    ];
    for (const [key, payload] of cases) {
      const w = await request({ port: srv.port, method: 'POST', path: '/api/db/' + key, token, json: payload });
      assert.strictEqual(w.status, 200, `${key} 写入应 200`);
      const r = JSON.parse((await request({ port: srv.port, path: '/api/db/' + key, token })).body);
      assert.deepStrictEqual(r, payload, `${key} 应能原样读回`);
    }
  });
});

describe('请求体上限', () => {
  let srv;
  let token;

  before(async () => {
    srv = await startServer({ tag: 'body' });
    token = await login(srv.port, 'test', 'test');
  });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('chunked 请求（无 Content-Length）超限返回 413', async () => {
    const r = await request({
      port: srv.port, method: 'POST', path: '/api/db/settings', token,
      chunkedBytes: 9 * 1024 * 1024   // > MAX_USER_DATA(8MB)
    });
    assert.strictEqual(r.status, 413);
  });

  test('声明过大的 Content-Length 直接 413', async () => {
    const r = await request({
      port: srv.port, method: 'POST', path: '/api/db/settings', token,
      raw: 'x', headers: { 'Content-Length': String(50 * 1024 * 1024) }
    });
    assert.strictEqual(r.status, 413);
  });

  test('change-password 请求体上限生效', async () => {
    // 8KB 上限会在第一个数据块就被突破，服务端立刻回 413 并关闭连接
    // （与 nginx 等的行为一致）。此时客户端可能还在写，拿到的是连接重置，
    // 两种结果都说明请求已被拒绝、内存未被继续占用。
    let status = null;
    let err = null;
    try {
      const r = await request({
        port: srv.port, method: 'POST', path: '/api/auth/change-password', token,
        chunkedBytes: 64 * 1024   // > 8KB
      });
      status = r.status;
    } catch (e) { err = e; }

    if (status !== null) {
      assert.strictEqual(status, 413);
    } else {
      assert.ok(['ECONNRESET', 'EPIPE'].includes(err.code), '应因超限被拒绝，实际错误: ' + err.message);
    }
  });

  test('超限后服务仍然可用（未被拖垮）', async () => {
    const h = await request({ port: srv.port, path: '/api/health' });
    assert.strictEqual(h.status, 200);
    const ok = await request({ port: srv.port, method: 'POST', path: '/api/db/vocab', token, json: [] });
    assert.strictEqual(ok.status, 200);
  });
});
