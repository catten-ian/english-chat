/* 用量记账与隐私中心：usage_log 写入、聚合、清除、隐私自述端点

   记账的核心约束是「只存数字，不存内容」——测试里显式验证
   usage_log 的列里不会出现 prompt / 回复文本。 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-usage-'));
process.env.AI_EN_DATA_DIR = tmp;

const { recordUsage, parseChatUsage, parseStreamUsage, getUsageSummary, clearUsage, localDay } = require('../server/services/usage');
const { db } = require('../server/db');

// 播种一个用户（usage_log 有外键约束）
db.prepare("INSERT OR IGNORE INTO users (username, password_hash) VALUES ('u1','x')").run();
db.prepare("INSERT OR IGNORE INTO users (username, password_hash) VALUES ('u2','x')").run();
const UID1 = db.prepare("SELECT id FROM users WHERE username='u1'").get().id;
const UID2 = db.prepare("SELECT id FROM users WHERE username='u2'").get().id;

describe('usage_log schema 与写入', () => {
  test('迁移已建表且 schema 版本升到 4', () => {
    const v = db.prepare('PRAGMA user_version').get().user_version;
    assert.strictEqual(Number(v), 4);
    const cols = db.prepare('PRAGMA table_info(usage_log)').all().map(c => c.name);
    for (const c of ['user_id', 'day', 'provider', 'kind', 'model', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'chars', 'requests', 'status']) {
      assert.ok(cols.includes(c), '缺列 ' + c);
    }
  });

  test('表结构里没有任何可能承载文本内容的列（隐私约束）', () => {
    const cols = db.prepare('PRAGMA table_info(usage_log)').all().map(c => c.name.toLowerCase());
    for (const forbidden of ['prompt', 'content', 'message', 'messages', 'text', 'response', 'reply', 'query']) {
      assert.ok(!cols.includes(forbidden), 'usage_log 不应有 ' + forbidden + ' 列');
    }
  });

  test('recordUsage 写入一行并正确落 day', () => {
    recordUsage({ userId: UID1, provider: 'minimax', kind: 'chat', model: 'MiniMax-M3', promptTokens: 100, completionTokens: 40, totalTokens: 140 });
    const row = db.prepare('SELECT * FROM usage_log WHERE user_id=? ORDER BY id DESC LIMIT 1').get(UID1);
    assert.strictEqual(row.provider, 'minimax');
    assert.strictEqual(row.kind, 'chat');
    assert.strictEqual(row.total_tokens, 140);
    assert.strictEqual(row.day, localDay());
    assert.strictEqual(row.requests, 1);
  });

  test('totalTokens 缺失时用 prompt+completion 兜底', () => {
    recordUsage({ userId: UID1, provider: 'minimax', kind: 'chat', promptTokens: 7, completionTokens: 3 });
    const row = db.prepare('SELECT * FROM usage_log WHERE user_id=? ORDER BY id DESC LIMIT 1').get(UID1);
    assert.strictEqual(row.total_tokens, 10);
  });

  test('无 userId 时静默跳过（未登录路径不应写库）', () => {
    const before = db.prepare('SELECT COUNT(*) c FROM usage_log').get().c;
    recordUsage({ provider: 'minimax', kind: 'chat', totalTokens: 999 });
    recordUsage(null);
    const after = db.prepare('SELECT COUNT(*) c FROM usage_log').get().c;
    assert.strictEqual(after, before);
  });

  test('负数被规整为 0（防脏数据污染统计）', () => {
    recordUsage({ userId: UID1, provider: 'elevenlabs', kind: 'tts', chars: -50, totalTokens: -1 });
    const row = db.prepare('SELECT * FROM usage_log WHERE user_id=? ORDER BY id DESC LIMIT 1').get(UID1);
    assert.strictEqual(row.chars, 0);
    assert.strictEqual(row.total_tokens, 0);
  });
});

describe('上游响应解析', () => {
  test('parseChatUsage 抽取非流式 usage', () => {
    const buf = Buffer.from(JSON.stringify({
      model: 'MiniMax-M3',
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 }
    }));
    const u = parseChatUsage(buf);
    assert.strictEqual(u.model, 'MiniMax-M3');
    assert.strictEqual(u.promptTokens, 12);
    assert.strictEqual(u.totalTokens, 46);
  });

  test('parseChatUsage 对无 usage / 非 JSON 不抛', () => {
    const noUsage = parseChatUsage(Buffer.from(JSON.stringify({ model: 'm', choices: [] })));
    assert.strictEqual(noUsage.model, 'm');
    assert.strictEqual(parseChatUsage(Buffer.from('not json')), null);
  });

  test('parseStreamUsage 从 SSE 尾部抽 usage', () => {
    const tail = [
      'data: {"choices":[{"delta":{"content":"x"}}]}',
      'data: {"model":"MiniMax-M3","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":6,"total_tokens":11}}',
      'data: [DONE]',
      ''
    ].join('\n');
    const u = parseStreamUsage(tail);
    assert.strictEqual(u.totalTokens, 11);
    assert.strictEqual(u.model, 'MiniMax-M3');
  });

  test('parseStreamUsage 对被截断的流返回 null（不猜数字）', () => {
    assert.strictEqual(parseStreamUsage('data: {"choices":[{"delta":{"content":"partial'), null);
    assert.strictEqual(parseStreamUsage(''), null);
    assert.strictEqual(parseStreamUsage(null), null);
  });
});

describe('聚合与隔离', () => {
  test('getUsageSummary 按 provider/kind 与 model 聚合', () => {
    clearUsage(UID2);
    recordUsage({ userId: UID2, provider: 'minimax', kind: 'chat', model: 'M3', promptTokens: 10, completionTokens: 10, totalTokens: 20 });
    recordUsage({ userId: UID2, provider: 'minimax', kind: 'chat_stream', model: 'M3', totalTokens: 30 });
    recordUsage({ userId: UID2, provider: 'minimax', kind: 'websearch' });
    recordUsage({ userId: UID2, provider: 'elevenlabs', kind: 'tts', chars: 250 });

    const s = getUsageSummary(UID2, 30);
    assert.strictEqual(s.totals.tokens, 50);
    assert.strictEqual(s.totals.chars, 250);
    assert.strictEqual(s.totals.calls, 4);
    const kinds = s.byProvider.map(r => r.kind).sort();
    assert.deepStrictEqual(kinds, ['chat', 'chat_stream', 'tts', 'websearch']);
    const m3 = s.byModel.find(m => m.model === 'M3');
    assert.ok(m3 && m3.tokens === 50);
    assert.ok(s.byDay.length >= 1);
    assert.strictEqual(s.today.tokens, 50);
  });

  test('用量按账户隔离：u2 的汇总不含 u1 的数据', () => {
    const s1 = getUsageSummary(UID1, 30);
    const s2 = getUsageSummary(UID2, 30);
    // u1 之前写过 140+10 tokens，u2 是 50
    assert.notStrictEqual(s1.totals.tokens, s2.totals.tokens);
    assert.strictEqual(s2.totals.tokens, 50);
  });

  test('days 参数被规整：非法值回落 30，上限 365', () => {
    assert.strictEqual(getUsageSummary(UID2, 1).days, 1);
    assert.strictEqual(getUsageSummary(UID2, 0).days, 30, '0/负数视为未指定，回落默认 30');
    assert.strictEqual(getUsageSummary(UID2, 9999).days, 365);
    assert.strictEqual(getUsageSummary(UID2, 'abc').days, 30);
    assert.strictEqual(getUsageSummary(UID2, undefined).days, 30);
  });

  test('clearUsage 只清当前账户', () => {
    const before1 = getUsageSummary(UID1, 30).totals.calls;
    const removed = clearUsage(UID2);
    assert.ok(removed >= 4);
    assert.strictEqual(getUsageSummary(UID2, 30).totals.calls, 0);
    assert.strictEqual(getUsageSummary(UID1, 30).totals.calls, before1, 'u1 的记录不应被删');
  });
});

describe('HTTP 端点', () => {
  test('GET /api/usage、DELETE /api/usage、GET /api/privacy 全流程', async () => {
    const { startServer, request, login } = require('./helpers');
    const s = await startServer({ tag: 'usage' });
    try {
      const token = await login(s.port, 'test', 'test');

      // 未鉴权拒绝
      const noAuth = await request({ port: s.port, path: '/api/usage' });
      assert.strictEqual(noAuth.status, 401);

      // 初始为空
      let r = await request({ port: s.port, path: '/api/usage?days=7', token });
      assert.strictEqual(r.status, 200);
      let body = JSON.parse(r.body);
      assert.strictEqual(body.days, 7);
      assert.strictEqual(body.totals.calls, 0);

      // 隐私自述：结构完整且不泄露密钥值
      r = await request({ port: s.port, path: '/api/privacy', token });
      assert.strictEqual(r.status, 200);
      const priv = JSON.parse(r.body);
      assert.ok(Array.isArray(priv.external) && priv.external.length >= 3);
      assert.ok(Array.isArray(priv.localData) && priv.localData.length >= 3);
      assert.ok(Array.isArray(priv.guarantees));
      // configured 只应是布尔，不能是 key 本身
      for (const x of priv.external) {
        assert.strictEqual(typeof x.configured, 'boolean');
        const json = JSON.stringify(x);
        assert.ok(!/sk-|eyJ|[A-Za-z0-9]{32,}/.test(json), '隐私端点不应出现疑似密钥: ' + json.slice(0, 120));
      }

      // 清除（空表也应 200）
      r = await request({ port: s.port, method: 'DELETE', path: '/api/usage', token });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(JSON.parse(r.body).status, 'cleared');
    } finally {
      await s.stop();
      s.cleanup();
    }
  });
});
