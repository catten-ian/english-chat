'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app', '34-review-fsrs.js'), 'utf8');

test('学习中心按 FSRS 健康信息标记 FAME 分片调度器', () => {
  const context = vm.createContext({});
  vm.runInContext(source, context, { filename: '17-practice.js' });

  assert.strictEqual(context.nativeSchedulerStorageLabel({ storage_mode: 'sqlite-user-sharded' }), 'FAME 分片调度器');
  assert.strictEqual(context.nativeSchedulerStorageLabel({ storage_mode: 'sqlite-single-writer' }), '本地调度器');
  assert.strictEqual(context.nativeSchedulerStorageLabel(null), '本地调度器');
});

test('FSRS 健康检查临时失败后保留用户模式偏好以便重试', async () => {
  const init = fs.readFileSync(path.join(__dirname, '..', 'js', 'app', '19-init.js'), 'utf8');
  const restore = init.match(/async function restoreNativeSchedulerMode\(\) \{[\s\S]*?\n\}/);
  assert.ok(restore, 'restore function is present');
  const values = new Map([['ai_en_native_scheduler_mode', '1']]);
  const context = vm.createContext({
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    prefersNativeSchedulerMode: () => values.get('ai_en_native_scheduler_mode') === '1',
    enableNativeSchedulerMode: async () => { throw new Error('temporary network failure'); },
    nativeSchedulerMode: true,
    nativeSchedulerAdapter: { dueCards() {} }
  });
  vm.runInContext(restore[0], context);
  assert.equal(await context.restoreNativeSchedulerMode(), false);
  assert.equal(values.get('ai_en_native_scheduler_mode'), '1');
  assert.equal(context.nativeSchedulerMode, false);
});

test('FSRS 评分携带 event_id，并在重试时复用同一 ID', async () => {
  const context = vm.createContext({
    crypto: { randomUUID: () => 'review-event-1' },
    Date,
    Math,
    console,
    toastMsg() {},
    dbg() {},
    esc: value => String(value),
    webReviewQueueKind: () => 'new',
    webReviewVocabRecord: () => false,
    fetchNextWebReviewCard() {},
    document: {
      getElementById() {
        return {
          querySelector(selector) {
            if (selector === '#wrResult') {
              return {
                innerHTML: '',
                querySelector() { return { addEventListener(_event, handler) { context.retry = handler; } }; }
              };
            }
            return null;
          }
        };
      }
    }
  });
  const payloads = [];
  let calls = 0;
  context.webReviewState = {
    native: true,
    committing: false,
    nativeReviewed: Object.create(null),
    nativeCards: [{ id: 'card-1', expected_version: 7 }],
    nativeIndex: 0,
    cardId: 'card-1',
    queueStats: { new: 1, learn: 0, review: 0 },
    judgedCorrect: true
  };
  context.nativeSchedulerAnswer = async (_cardId, payload) => {
    payloads.push(payload);
    if (++calls === 1) throw new Error('temporary failure');
  };
  vm.runInContext(source, context, { filename: '34-review-fsrs.js' });

  await context.webReviewCommitNative(3);
  assert.equal(typeof context.retry, 'function');
  await context.retry();
  assert.equal(JSON.stringify(payloads), JSON.stringify([
    { rating: 3, event_id: 'review-event-1', expected_version: 7 },
    { rating: 3, event_id: 'review-event-1', expected_version: 7 }
  ]));
  assert.equal(context.webReviewState.nativeReviewed['card-1'].rating, 3);
});
