'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
// The game has its own dev dependencies: npm ci --prefix game.
const ts = require('../game/node_modules/typescript');

const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../game/src/services/feedback.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;

function harness(t, { storage = new Map(), startAt = 100000, respond = () => ({ status: 502 }) } = {}) {
  let now = startAt;
  let serial = 0;
  let responder = respond;
  const timers = new Map();
  const calls = [];
  const queues = [];
  class ClockDate extends Date { static now() { return now; } }
  const context = {
    exports: {}, Date: ClockDate, AbortController, crypto: { randomUUID },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    async fetch(url, options) {
      calls.push({ at: now, url, options, body: JSON.parse(options.body) });
      const result = await responder(calls.at(-1));
      return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
    }
  };
  vm.runInNewContext(source, context, { filename: 'feedback.compiled.js' });
  t.after(() => {
    for (const queue of queues) queue.dispose();
    assert.equal(timers.size, 0, 'disposing queues releases every scheduled task');
  });
  return {
    storage, calls, timers,
    get now() { return now; },
    respond(fn) { responder = fn; },
    queue(accountId = 'account-7') {
      const queue = context.exports.createFeedbackQueue({
        accountId, apiBase: '/api-beta',
        headers: () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer test-only' }),
        onChange() {}
      });
      queues.push(queue);
      return queue;
    },
    async tick() {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'a fake task is scheduled');
      const [id, timer] = next;
      now = timer.at; timers.delete(id); timer.fn();
      // Flush async fetch/JSON continuations without advancing the fake clock.
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}

const utterance = { text: 'Where the light?', stageId: 'low-tide', npcName: 'Eli' };

test('game feedback retries with exponential delays, caps requests, and supports explicit recovery', async t => {
  const h = harness(t);
  const queue = h.queue();
  const id = queue.enqueue(utterance);
  while (h.timers.size) await h.tick();

  assert.deepEqual(h.calls.map(call => call.at - 100000), [0, 1000, 3000, 7000, 15000, 31000]);
  assert.equal(queue.records()[0].status, 'failed');
  assert.equal(queue.records()[0].attempts, 6);
  assert.equal(h.calls[0].url, '/api-beta/api/world-game/feedback');
  assert.deepEqual(h.calls[0].body, { text: utterance.text, provider: 'aihub8' });
  assert.equal(Object.hasOwn(h.calls[0].body, 'npcName'), false, 'NPC scope is excluded from feedback requests');

  h.respond(() => ({ status: 200, body: { text: 'A natural alternative: Where is the light?' } }));
  queue.retry(id);
  await h.tick();
  assert.equal(h.calls.length, 7);
  assert.equal(queue.records()[0].status, 'ready');
  assert.equal(queue.records()[0].attempts, 1);
  assert.match(queue.records()[0].feedback, /Where is the light/);
  assert.equal(h.timers.size, 0);
});

test('game feedback does not automatically repeat rejected authentication requests', async t => {
  for (const status of [401, 403]) {
    const h = harness(t, { respond: () => ({ status }) });
    const queue = h.queue();
    queue.enqueue(utterance);
    await h.tick();
    assert.equal(h.calls.length, 1);
    assert.equal(queue.records()[0].status, 'failed');
    assert.match(queue.records()[0].error, /Sign in/);
    assert.equal(h.timers.size, 0);
  }
});

test('game feedback resumes a saved retry after refresh without resetting its deadline or attempt count', async t => {
  const before = harness(t);
  const original = before.queue();
  const id = original.enqueue(utterance);
  await before.tick();
  assert.equal(original.records()[0].status, 'retry');
  const deadline = original.records()[0].nextAttemptAt;
  original.dispose();
  assert.equal(before.timers.size, 0);

  const after = harness(t, {
    storage: before.storage, startAt: before.now + 500,
    respond: () => ({ status: 200, body: { text: 'Try: Where is the light?' } })
  });
  const restored = after.queue();
  assert.equal(restored.records()[0].id, id);
  assert.equal(restored.records()[0].attempts, 1);
  assert.equal(restored.records()[0].nextAttemptAt, deadline);
  await after.tick();
  assert.equal(after.calls[0].at, deadline);
  assert.equal(restored.records()[0].attempts, 2);
  assert.equal(restored.records()[0].status, 'ready');
});

test('refreshing an interrupted final attempt cannot start another automatic billing cycle', async t => {
  const storage = new Map([['bellweather:feedback:v1:account-7', JSON.stringify([{
    ...utterance, id: 'interrupted-last-request', createdAt: 90000, attempts: 6, status: 'pending'
  }])]]);
  const h = harness(t, { storage });
  const restored = h.queue();
  await h.tick();
  assert.equal(h.calls.length, 0);
  assert.equal(restored.records()[0].status, 'failed');
  assert.equal(h.timers.size, 0);
});

test('game feedback persists completed history under the owning account and releases snapshots', async t => {
  const h = harness(t, { respond: () => ({ status: 200, body: { text: 'Your question is clear.' } }) });
  const alice = h.queue('alice');
  alice.enqueue(utterance);
  await h.tick();
  alice.dispose();
  const restored = h.queue('alice');
  const bob = h.queue('bob');
  assert.equal(restored.records().length, 1);
  assert.equal(restored.records()[0].status, 'ready');
  assert.equal(bob.records().length, 0);
  const snapshot = restored.records();
  snapshot[0].text = 'changed outside queue';
  assert.equal(restored.records()[0].text, utterance.text);
  assert.equal(h.timers.size, 0, 'reading completed history sends no new requests');
});
