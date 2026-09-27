'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, request, login } = require('./helpers');
const { mergeSnapshots } = require('../server/services/conversation-merge');

const at = n => new Date(1788000000000 + n * 1000).toISOString();
const variant = (content, next = []) => ({ content, feedback: null, next });
const node = (id, content, next = []) => ({ id, role: 'user', variants: [variant(content, next)], activeVariant: 0 });
const conv = (id, messages, updatedAt = at(1)) => ({ id, title: id, createdAt: at(0), updatedAt, messages });

describe('conversation merge', () => {
  test('A/B 会话并集与同节点分支并集，重复同步幂等', () => {
    const a = { conversations: { a: conv('a', [node('m', 'first', [node('a1', 'A')])]) }, deleted: {} };
    const b = { conversations: { a: conv('a', [node('m', 'first', [node('b1', 'B')])], at(2)), b: conv('b', []) }, deleted: {} };
    const merged = mergeSnapshots(a, b);
    assert.deepEqual(Object.keys(merged.conversations), ['a', 'b']);
    assert.deepEqual(merged.conversations.a.messages[0].variants[0].next.map(n => n.id), ['a1', 'b1']);
    assert.deepEqual(mergeSnapshots(merged, b), merged);
  });

  test('同消息不同改写保留为两个变体，较新端为活跃变体', () => {
    const a = { conversations: { a: conv('a', [node('m', 'old')]) }, deleted: {} };
    const b = { conversations: { a: conv('a', [node('m', 'new')], at(2)) }, deleted: {} };
    const merged = mergeSnapshots(a, b).conversations.a.messages[0];
    assert.deepEqual(merged.variants.map(v => v.content), ['old', 'new']);
    assert.equal(merged.variants[merged.activeVariant].content, 'new');
  });

  test('删除墓碑阻止旧快照复活，并允许之后创建更新', () => {
    const stale = { conversations: { a: conv('a', [], at(1)) }, deleted: {} };
    const deleted = { conversations: {}, deleted: { a: at(2) } };
    assert.equal(mergeSnapshots(deleted, stale).conversations.a, undefined);
    assert.ok(mergeSnapshots(deleted, { conversations: { a: conv('a', [], at(3)) }, deleted: {} }).conversations.a);
  });

  test('拒绝损坏和原型键', () => {
    assert.throws(() => mergeSnapshots({ conversations: {}, deleted: {} }, { conversations: JSON.parse('{"__proto__":{"id":"__proto__","messages":[]}}'), deleted: {} }));
  });
  test('旧扁平消息重复交换不会被复制多次', () => {
    const a = { conversations: { a: conv('a', [{ role: 'user', content: 'legacy' }]) }, deleted: {} };
    assert.deepEqual(mergeSnapshots(mergeSnapshots(a, a), a), a);
  });
});

describe('authenticated conversation sync API', () => {
  let srv;
  const secret = 'test-secret-that-is-longer-than-32-bytes';
  test('保存并合并、鉴权交换、显式删除与旧快照防复活', async () => {
    srv = await startServer({ tag: 'conv-sync', env: { AI_EN_SYNC_SECRET: secret } });
    try {
      const token = await login(srv.port, 'test', 'test');
      const initial = { a: conv('a', [node('m', 'one')]) };
      assert.equal((await request({ port: srv.port, method: 'POST', path: '/api/db/conversations', token, json: initial })).status, 200);
      const peer = { username: 'test', conversations: { b: conv('b', []), a: conv('a', [node('m', 'two')], at(2)) }, deleted: {} };
      const body = JSON.stringify(peer);
      const timestamp = String(Date.now());
      const headers = { 'X-Sync-Timestamp': timestamp, 'X-Sync-Signature': crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex') };
      assert.equal((await request({ port: srv.port, method: 'POST', path: '/api/sync/conversations', raw: body })).status, 401);
      const exchanged = await request({ port: srv.port, method: 'POST', path: '/api/sync/conversations', raw: body, headers });
      assert.equal(exchanged.status, 200);
      assert.deepEqual(JSON.parse(exchanged.body).conversations.a.messages[0].variants.map(v => v.content), ['one', 'two']);
      assert.equal((await request({ port: srv.port, method: 'POST', path: '/api/conversations/delete', token, json: { id: 'a' } })).status, 200);
      await request({ port: srv.port, method: 'POST', path: '/api/db/conversations', token, json: initial });
      const final = JSON.parse((await request({ port: srv.port, path: '/api/db/conversations', token })).body);
      assert.deepEqual(Object.keys(final), ['b']);
    } finally { await srv.stop(); srv.cleanup(); }
  });
});
