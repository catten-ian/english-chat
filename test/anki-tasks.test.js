/* Anki 任务中心（21-anki-tasks.js）：队列状态机、持久化、重试、渲染

   前端是浏览器脚本（无 module.exports），这里在 vm sandbox 里加载
   21-anki-tasks.js 并注入所需的最小依赖（localStorage / esc / toastMsg /
   ankiPostCall / ankiAddNotesBatch / getWeak / autoGenerateQuizQuestions），
   以便对纯逻辑（入队/状态流转/重试/清理）做真实断言。 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { APP_DIR } = require('./helpers');

const SRC = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '21-anki-tasks.js'), 'utf8');

/* 极简 localStorage 替身 */
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _dump: () => Object.fromEntries(store)
  };
}

/* 构建一个隔离运行环境。opts 可覆写依赖行为：
   ankiOnline / batchResult / batchThrows / quizResult */
function makeCtx(opts) {
  const o = opts || {};
  const calls = { apiSave: [], toasts: [], batches: [], quizzes: [] };
  const localStorage = makeLocalStorage();
  const sandbox = {
    localStorage,
    console,
    setTimeout,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    // 依赖桩
    apiSave: (key, data) => { calls.apiSave.push({ key, data }); },
    toastMsg: (m) => { calls.toasts.push(m); },
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    getWeak: () => o.weak || {},
    ankiPostCall: async () => {
      if (o.ankiOnline === false) throw new Error('ankiconnect unreachable');
      return { ok: true, result: { result: 6 } };
    },
    ankiAddNotesBatch: async (notes) => {
      calls.batches.push(notes);
      if (o.batchThrows) throw new Error('batch boom');
      if (o.batchResult) return o.batchResult;
      return { added: notes.length, skipped: 0, noteIds: notes.map((_, i) => 1000 + i), order: [] };
    },
    autoGenerateQuizQuestions: async (wpList) => {
      calls.quizzes.push(wpList);
      if (o.quizResult === null) return null;
      return o.quizResult || { added: wpList.length, skipped: 0 };
    },
    renderAnkiSidebar: async () => {},
    // 无 DOM：renderAnkiTaskCenter 内部 getElementById 返回 null 即直接 return
    document: { getElementById: () => null }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: '21-anki-tasks.js' });
  return { sandbox, calls, localStorage };
}

describe('任务入队与持久化', () => {
  test('enqueueAnkiTask 写入 localStorage 且同步到服务端', () => {
    const { sandbox, calls, localStorage } = makeCtx();
    const id = sandbox.enqueueAnkiTask('notes', { notes: [{ fields: {} }] }, '生词 1 张');
    assert.match(id, /^at_/);
    const raw = JSON.parse(localStorage.getItem('ai_en_anki_tasks'));
    assert.strictEqual(raw.length, 1);
    assert.strictEqual(raw[0].status, 'pending');
    assert.strictEqual(raw[0].label, '生词 1 张');
    assert.strictEqual(raw[0].retries, 0);
    // 服务端同步走 apiSave('anki_tasks', ...)
    assert.strictEqual(calls.apiSave.length, 1);
    assert.strictEqual(calls.apiSave[0].key, 'anki_tasks');
  });

  test('未知 kind 也能入队（执行时才失败），空 kind 被拒', () => {
    const { sandbox } = makeCtx();
    assert.strictEqual(sandbox.enqueueAnkiTask('', {}, 'x'), null);
    assert.ok(sandbox.enqueueAnkiTask('weird', {}, 'x'));
  });

  test('ankiTaskCounts 正确分类', () => {
    const { sandbox } = makeCtx();
    const a = sandbox.enqueueAnkiTask('notes', { notes: [] }, 'a');
    const b = sandbox.enqueueAnkiTask('notes', { notes: [] }, 'b');
    sandbox.updateAnkiTask(a, { status: 'done' });
    sandbox.updateAnkiTask(b, { status: 'failed' });
    const c = sandbox.ankiTaskCounts();
    assert.strictEqual(c.total, 2);
    assert.strictEqual(c.done, 1);
    assert.strictEqual(c.failed, 1);
    assert.strictEqual(c.pending, 0);
  });
});

describe('队列消费', () => {
  test('Anki 在线时 notes 任务推送成功并记录结果', async () => {
    const { sandbox, calls } = makeCtx();
    sandbox.enqueueAnkiTask('notes', { notes: [{ fields: { Front: 'a' } }, { fields: { Front: 'b' } }] }, '生词 2 张');
    const r = await sandbox.processAnkiQueue({ manual: true });
    assert.strictEqual(r.done, 1);
    assert.strictEqual(calls.batches.length, 1);
    const tasks = sandbox.getAnkiTasks();
    assert.strictEqual(tasks[0].status, 'done');
    assert.strictEqual(tasks[0].result.added, 2);
  });

  test('Anki 离线时任务保持 pending（不刷成 failed）', async () => {
    const { sandbox } = makeCtx({ ankiOnline: false });
    sandbox.enqueueAnkiTask('notes', { notes: [{ fields: {} }] }, '生词 1 张');
    const r = await sandbox.processAnkiQueue({ manual: true });
    assert.strictEqual(r.offline, true);
    assert.strictEqual(r.queued, 1);
    const tasks = sandbox.getAnkiTasks();
    assert.strictEqual(tasks[0].status, 'pending', '离线不应把任务标记为失败');
    assert.strictEqual(tasks[0].retries, 0, '离线不应消耗重试次数');
  });

  test('批量推送全部被拒时标记 failed 并累加 retries', async () => {
    const { sandbox } = makeCtx({ batchResult: { added: 0, skipped: 2, noteIds: [], order: [] } });
    sandbox.enqueueAnkiTask('notes', { notes: [{ fields: {} }, { fields: {} }] }, '生词 2 张');
    await sandbox.processAnkiQueue();
    let t = sandbox.getAnkiTasks()[0];
    assert.strictEqual(t.status, 'failed');
    assert.strictEqual(t.retries, 1);
    assert.ok(t.error);
  });

  test('重试达到上限后进入 dead（不再自动重试）', async () => {
    const { sandbox } = makeCtx({ batchThrows: true });
    sandbox.enqueueAnkiTask('notes', { notes: [{ fields: {} }] }, 'x');
    // 连续三轮：failed → failed → dead
    await sandbox.processAnkiQueue({ includeFailed: true });
    assert.strictEqual(sandbox.getAnkiTasks()[0].status, 'failed');
    await sandbox.processAnkiQueue({ includeFailed: true });
    assert.strictEqual(sandbox.getAnkiTasks()[0].status, 'failed');
    await sandbox.processAnkiQueue({ includeFailed: true });
    const t = sandbox.getAnkiTasks()[0];
    assert.strictEqual(t.status, 'dead');
    assert.strictEqual(t.retries, 3);
    // dead 之后普通消费不再触碰它
    const before = t.updatedAt;
    await sandbox.processAnkiQueue();
    assert.strictEqual(sandbox.getAnkiTasks()[0].updatedAt, before, 'dead 任务不应被自动重试');
  });

  test('quiz 任务：薄弱点已删除时视为完成，不算失败', async () => {
    const { sandbox, calls } = makeCtx({ weak: {} });
    sandbox.enqueueAnkiTask('quiz', { weakPointIds: ['wp_gone'] }, '薄弱点出题 1 个');
    await sandbox.processAnkiQueue();
    const t = sandbox.getAnkiTasks()[0];
    assert.strictEqual(t.status, 'done');
    assert.strictEqual(calls.quizzes.length, 0, '不应为不存在的薄弱点调 AI');
  });

  test('quiz 任务：AI 出题返回 null 记为失败', async () => {
    const { sandbox } = makeCtx({ weak: { wp1: { id: 'wp1', point: 'x' } }, quizResult: null });
    sandbox.enqueueAnkiTask('quiz', { weakPointIds: ['wp1'] }, '薄弱点出题 1 个');
    await sandbox.processAnkiQueue();
    assert.strictEqual(sandbox.getAnkiTasks()[0].status, 'failed');
  });

  test('quiz 任务成功时记录 added', async () => {
    const { sandbox, calls } = makeCtx({ weak: { wp1: { id: 'wp1', point: 'x' } }, quizResult: { added: 3, skipped: 1 } });
    sandbox.enqueueAnkiTask('quiz', { weakPointIds: ['wp1'] }, '薄弱点出题 1 个');
    await sandbox.processAnkiQueue();
    const t = sandbox.getAnkiTasks()[0];
    assert.strictEqual(t.status, 'done');
    assert.strictEqual(t.result.added, 3);
    assert.strictEqual(calls.quizzes.length, 1);
  });

  test('未知任务类型标记失败而不是崩溃', async () => {
    const { sandbox } = makeCtx();
    sandbox.enqueueAnkiTask('weird', {}, 'x');
    await sandbox.processAnkiQueue();
    const t = sandbox.getAnkiTasks()[0];
    assert.strictEqual(t.status, 'failed');
    assert.match(t.error, /未知任务类型/);
  });
});

describe('手动操作', () => {
  test('retryAnkiTask 清零重试计数并重新执行', async () => {
    const { sandbox } = makeCtx({ batchThrows: true });
    const id = sandbox.enqueueAnkiTask('notes', { notes: [{ fields: {} }] }, 'x');
    await sandbox.processAnkiQueue();
    assert.strictEqual(sandbox.getAnkiTasks()[0].retries, 1);
    // 换成会成功的实现后重试
    sandbox.ankiAddNotesBatch = async (notes) => ({ added: notes.length, skipped: 0, noteIds: [1], order: [] });
    await sandbox.retryAnkiTask(id);
    const t = sandbox.getAnkiTasks()[0];
    assert.strictEqual(t.status, 'done');
    assert.strictEqual(t.result.added, 1);
  });

  test('deleteAnkiTask 删除指定任务', () => {
    const { sandbox } = makeCtx();
    const a = sandbox.enqueueAnkiTask('notes', { notes: [] }, 'a');
    sandbox.enqueueAnkiTask('notes', { notes: [] }, 'b');
    sandbox.deleteAnkiTask(a);
    const tasks = sandbox.getAnkiTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'b');
  });

  test('clearFinishedAnkiTasks 只清 done，保留待处理项', () => {
    const { sandbox } = makeCtx();
    const a = sandbox.enqueueAnkiTask('notes', { notes: [] }, 'done-one');
    sandbox.enqueueAnkiTask('notes', { notes: [] }, 'still-pending');
    sandbox.updateAnkiTask(a, { status: 'done' });
    sandbox.clearFinishedAnkiTasks();
    const tasks = sandbox.getAnkiTasks();
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].label, 'still-pending');
  });

  test('retryAllFailedAnkiTasks 把 failed/dead 全部重置为 pending', async () => {
    const { sandbox } = makeCtx({ batchThrows: true });
    sandbox.enqueueAnkiTask('notes', { notes: [{ fields: {} }] }, 'a');
    sandbox.enqueueAnkiTask('notes', { notes: [{ fields: {} }] }, 'b');
    await sandbox.processAnkiQueue();
    assert.strictEqual(sandbox.ankiTaskCounts().failed, 2);
    // 之后成功
    sandbox.ankiAddNotesBatch = async (notes) => ({ added: notes.length, skipped: 0, noteIds: [1], order: [] });
    await sandbox.retryAllFailedAnkiTasks();
    const c = sandbox.ankiTaskCounts();
    assert.strictEqual(c.done, 2);
    assert.strictEqual(c.failed, 0);
  });
});

describe('容量上限', () => {
  test('超过上限时优先丢弃最老的 done，保留 pending/failed', () => {
    const { sandbox } = makeCtx();
    // 构造 250 个任务：前 240 个 done，后 10 个 pending
    const list = [];
    for (let i = 0; i < 240; i++) {
      list.push({ id: 'd' + i, kind: 'notes', label: 'done' + i, payload: {}, status: 'done', retries: 0, createdAt: i, updatedAt: i });
    }
    for (let i = 0; i < 10; i++) {
      list.push({ id: 'p' + i, kind: 'notes', label: 'pending' + i, payload: {}, status: 'pending', retries: 0, createdAt: 1000 + i, updatedAt: 1000 + i });
    }
    sandbox.saveAnkiTasks(list);
    const kept = sandbox.getAnkiTasks();
    assert.ok(kept.length <= 200, '应裁剪到上限内，实际 ' + kept.length);
    assert.strictEqual(kept.filter(t => t.status === 'pending').length, 10, 'pending 必须全部保留');
  });
});
