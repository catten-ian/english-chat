'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function storage() {
  const values = new Map([['ai_en_token', 'token'], ['ai_en_user', 'test']]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] || null,
    get length() { return values.size; }
  };
}

function app(fetch) {
  const localStorage = storage();
  const context = vm.createContext({
    localStorage, sessionStorage: storage(), fetch, location: { protocol: 'http:' },
    navigator: { onLine: true }, console, setTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/storage.js'), 'utf8'), context);
  return { context, localStorage };
}

test('删除失败保留重试队列，不会发送缺少会话的整份快照', async () => {
  const calls = [];
  const { context, localStorage } = app(async (url, options) => {
    calls.push({ url, body: options.body });
    return { ok: false, status: 503 };
  });
  localStorage.setItem('ai_en_convs', JSON.stringify({ conv_a: { id: 'conv_a', messages: [] } }));
  context.deleteConversation('conv_a');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(localStorage.getItem('ai_en_convs'), '{}');
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_en_conv_deletes')), ['conv_a']);
  assert.deepEqual(calls.map(c => c.url), ['/api/conversations/delete']);
  assert.equal(vm.runInContext('syncStatus.failedKeys.has("conversation_deletions")', context), true);
});

test('服务器返回的会话并集更新缓存，不覆盖请求途中产生的新本地编辑', async () => {
  let respond;
  const { context, localStorage } = app(() => new Promise(resolve => { respond = resolve; }));
  const original = { conv_a: { id: 'conv_a', messages: [] } };
  context.saveAllConversations(original);
  await new Promise(resolve => setTimeout(resolve, 0));
  localStorage.setItem('ai_en_convs', JSON.stringify({ ...original, conv_b: { id: 'conv_b', messages: [] } }));
  respond({ ok: true, json: async () => ({ conversations: { ...original, conv_cloud: { id: 'conv_cloud', messages: [] } } }) });
  await vm.runInContext('_saveInflight.conversations', context);
  assert.equal(!!JSON.parse(localStorage.getItem('ai_en_convs')).conv_b, true);
  assert.equal(!!JSON.parse(localStorage.getItem('ai_en_convs')).conv_cloud, false);
});
