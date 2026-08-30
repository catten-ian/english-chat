/* ============================================================
   AI 英语对话教练 — Anki 任务中心（持久化任务队列）
   由 js/app.js 拆分而来（新增切片，内容为全新代码）。

   解决的问题：此前卡片推送是「即发即忘」——Anki 没开、AnkiConnect
   报错、AI 出题失败都只弹一条 toast，任务本身丢了，用户也不知道少了
   什么。现在所有推送先入队列，持久化到 localStorage + 服务端
   `user_data.anki_tasks`，失败可重试、可查看原因、可手动清理。

   任务状态机：
     pending  → 待处理（Anki 未连接 / 尚未轮到）
     running  → 正在推送
     done     → 成功（记录 added/skipped）
     failed   → 失败（记录 error，可重试，超过上限进 dead）
     dead     → 重试耗尽，需要手动重试或删除

   只定义函数 + 一个顶层状态变量，无副作用，可安全放在 19-init 之后。
   ============================================================ */

/* ---------- 存储 ---------- */
const ANKI_TASK_KEY = 'ai_en_anki_tasks';
const ANKI_TASK_MAX = 200;        // 队列上限，超出丢弃最老的 done 项
const ANKI_TASK_MAX_RETRY = 3;    // 自动重试上限，之后进 dead

let ankiQueueRunning = false;     // 队列消费互斥（避免并发推送同一批）

function getAnkiTasks() {
  try {
    const raw = JSON.parse(localStorage.getItem(ANKI_TASK_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) { return []; }
}

function saveAnkiTasks(list) {
  let arr = Array.isArray(list) ? list : [];
  // 超限时优先丢弃最老的已完成任务，保留 pending/failed/dead（那些还需要用户处理）
  if (arr.length > ANKI_TASK_MAX) {
    const keep = arr.filter(t => t.status !== 'done');
    const done = arr.filter(t => t.status === 'done').slice(-Math.max(0, ANKI_TASK_MAX - keep.length));
    arr = [...done, ...keep].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  try { localStorage.setItem(ANKI_TASK_KEY, JSON.stringify(arr)); } catch (e) {}
  if (typeof apiSave === 'function') apiSave('anki_tasks', arr);
  return arr;
}

function ankiTaskId() {
  return 'at_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ---------- 入队 ----------
   kind: 'notes'（已成型的卡片数组）| 'quiz'（薄弱点出题，需先调 AI）
   payload:
     notes → { notes: [{deckName, modelName, fields, tags}] }
     quiz  → { weakPointIds: [...] }
   label: 用户可读的一句话描述（显示在任务中心列表里） */
function enqueueAnkiTask(kind, payload, label) {
  if (!kind) return null;
  const list = getAnkiTasks();
  const task = {
    id: ankiTaskId(),
    kind: kind,
    label: label || kind,
    payload: payload || {},
    status: 'pending',
    retries: 0,
    error: null,
    result: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  list.push(task);
  saveAnkiTasks(list);
  renderAnkiTaskCenter();
  return task.id;
}

function updateAnkiTask(id, patch) {
  const list = getAnkiTasks();
  const t = list.find(x => x.id === id);
  if (!t) return null;
  Object.assign(t, patch || {}, { updatedAt: Date.now() });
  saveAnkiTasks(list);
  return t;
}

function ankiTaskCounts() {
  const list = getAnkiTasks();
  const c = { pending: 0, running: 0, done: 0, failed: 0, dead: 0, total: list.length };
  for (const t of list) if (c[t.status] !== undefined) c[t.status]++;
  return c;
}

/* ---------- 执行单个任务 ---------- */
async function runAnkiTask(task) {
  if (!task) return false;
  updateAnkiTask(task.id, { status: 'running', error: null });
  try {
    if (task.kind === 'notes') {
      const notes = (task.payload && task.payload.notes) || [];
      if (!notes.length) { updateAnkiTask(task.id, { status: 'done', result: { added: 0, skipped: 0 } }); return true; }
      const r = await ankiAddNotesBatch(notes);
      // ankiAddNotesBatch 内部吞了异常，added=0 且 skipped=全部 视为失败（Anki 不可用）
      if (r.added === 0 && r.skipped === notes.length && !r.noteIds.length) {
        throw new Error('Anki 未响应或全部被拒绝');
      }
      updateAnkiTask(task.id, { status: 'done', result: { added: r.added, skipped: r.skipped } });
      return true;
    }
    if (task.kind === 'quiz') {
      const ids = (task.payload && task.payload.weakPointIds) || [];
      const w = getWeak();
      const wpList = ids.map(id => w[id]).filter(Boolean);
      if (!wpList.length) { updateAnkiTask(task.id, { status: 'done', result: { added: 0, note: '薄弱点已不存在' } }); return true; }
      const r = await autoGenerateQuizQuestions(wpList);
      if (!r) throw new Error('AI 出题失败或无需新增');
      updateAnkiTask(task.id, { status: 'done', result: { added: r.added || 0, skipped: r.skipped || 0 } });
      return true;
    }
    throw new Error('未知任务类型: ' + task.kind);
  } catch (e) {
    const retries = (task.retries || 0) + 1;
    const dead = retries >= ANKI_TASK_MAX_RETRY;
    updateAnkiTask(task.id, {
      status: dead ? 'dead' : 'failed',
      retries: retries,
      error: (e && e.message) || String(e)
    });
    return false;
  }
}

/* ---------- 队列消费 ----------
   只在 Anki 可连通时推进；不可用则原地保留 pending（下次自动重试）。 */
async function processAnkiQueue(opts) {
  const options = opts || {};
  if (ankiQueueRunning) return { skipped: 'already running' };
  const list = getAnkiTasks();
  const todo = list.filter(t => t.status === 'pending' || (options.includeFailed && t.status === 'failed'));
  if (!todo.length) { renderAnkiTaskCenter(); return { done: 0 }; }

  // 先探连接：Anki 没开就不要把队列全刷成 failed
  let online = false;
  try {
    const ver = await ankiPostCall({ action: 'version', version: 6 });
    online = !!(ver && ver.ok && ver.result && ver.result.result);
  } catch (e) { online = false; }
  if (!online) {
    renderAnkiTaskCenter();
    if (options.manual) toastMsg('❌ Anki 未运行，' + todo.length + ' 个任务继续排队');
    return { offline: true, queued: todo.length };
  }

  ankiQueueRunning = true;
  renderAnkiTaskCenter();
  let ok = 0, fail = 0;
  try {
    for (const t of todo) {
      // 重新取最新状态（用户可能中途删除）
      const cur = getAnkiTasks().find(x => x.id === t.id);
      if (!cur || (cur.status !== 'pending' && cur.status !== 'failed')) continue;
      const success = await runAnkiTask(cur);
      if (success) ok++; else fail++;
      // 渲染失败（如目标 DOM 在当前模块不可见）绝不能中断队列循环，
      // 否则任务会永远停在 running、后续任务全部饿死。
      try { renderAnkiTaskCenter(); } catch (e) {}
    }
  } finally {
    ankiQueueRunning = false;
  }
  try { renderAnkiTaskCenter(); } catch (e) {}
  if (typeof renderAnkiSidebar === 'function') { try { await renderAnkiSidebar(); } catch (e) {} }
  if (options.manual || ok || fail) {
    toastMsg('📚 Anki 队列：成功 ' + ok + (fail ? '，失败 ' + fail : ''));
  }
  return { done: ok, failed: fail };
}

/* 重试单个任务（失败/dead 都可以手动重试，重试会清零计数） */
async function retryAnkiTask(id) {
  const t = updateAnkiTask(id, { status: 'pending', retries: 0, error: null });
  if (!t) return;
  renderAnkiTaskCenter();
  await processAnkiQueue({ manual: true });
}

function deleteAnkiTask(id) {
  const list = getAnkiTasks().filter(t => t.id !== id);
  saveAnkiTasks(list);
  renderAnkiTaskCenter();
}

function clearFinishedAnkiTasks() {
  const list = getAnkiTasks().filter(t => t.status !== 'done');
  saveAnkiTasks(list);
  renderAnkiTaskCenter();
  toastMsg('🧹 已清理完成的任务');
}

async function retryAllFailedAnkiTasks() {
  const list = getAnkiTasks();
  let n = 0;
  for (const t of list) {
    if (t.status === 'failed' || t.status === 'dead') { t.status = 'pending'; t.retries = 0; t.error = null; n++; }
  }
  if (!n) { toastMsg('没有失败的任务'); return; }
  saveAnkiTasks(list);
  renderAnkiTaskCenter();
  await processAnkiQueue({ manual: true });
}

/* ---------- 渲染：Anki 任务中心（Practice 模块内） ---------- */
function ankiTaskStatusMeta(status) {
  return {
    pending: { icon: '⏳', text: '排队中', color: 'var(--text2)' },
    running: { icon: '🔄', text: '推送中', color: 'var(--primary)' },
    done: { icon: '✅', text: '已完成', color: 'var(--green)' },
    failed: { icon: '⚠️', text: '失败', color: 'var(--amber)' },
    dead: { icon: '❌', text: '需处理', color: 'var(--red)' }
  }[status] || { icon: '·', text: status, color: 'var(--text3)' };
}

function renderAnkiTaskCenter() {
  const el = document.getElementById('ankiTaskCenter');
  if (!el) return;
  const list = getAnkiTasks().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const c = ankiTaskCounts();

  const chips = [
    c.pending ? `<span class="at-chip pending">⏳ 排队 ${c.pending}</span>` : '',
    c.running ? `<span class="at-chip running">🔄 推送中 ${c.running}</span>` : '',
    c.failed ? `<span class="at-chip failed">⚠️ 失败 ${c.failed}</span>` : '',
    c.dead ? `<span class="at-chip dead">❌ 需处理 ${c.dead}</span>` : '',
    c.done ? `<span class="at-chip done">✅ 完成 ${c.done}</span>` : ''
  ].filter(Boolean).join('');

  let html = '<div class="at-head"><span class="at-title">📋 Anki 任务中心</span>' +
    '<span class="at-actions">' +
    '<button class="a-btn small" data-action="anki-queue-run">▶ 立即推送</button>' +
    ((c.failed || c.dead) ? '<button class="a-btn small" data-action="anki-queue-retry-all">🔄 重试失败</button>' : '') +
    (c.done ? '<button class="a-btn small ghost" data-action="anki-queue-clear-done">🧹 清理完成</button>' : '') +
    '</span></div>';

  html += chips ? '<div class="at-chips">' + chips + '</div>' : '';

  if (!list.length) {
    html += '<div class="at-empty">暂无任务。卡片推送（生词 / 纠错 / 拓展 / 薄弱点出题）都会先进这里排队，Anki 没开也不会丢。</div>';
    el.innerHTML = html;
    return;
  }

  html += '<div class="at-list">' + list.slice(0, 40).map(t => {
    const m = ankiTaskStatusMeta(t.status);
    const tm = new Date(t.updatedAt || t.createdAt || Date.now());
    const ts = (tm.getMonth() + 1) + '-' + tm.getDate() + ' ' + String(tm.getHours()).padStart(2, '0') + ':' + String(tm.getMinutes()).padStart(2, '0');
    const res = t.result
      ? `<span class="at-res">+${t.result.added || 0}${t.result.skipped ? ' / 跳过 ' + t.result.skipped : ''}</span>`
      : '';
    const err = t.error ? `<div class="at-err">${esc(t.error)}${t.retries ? '（已重试 ' + t.retries + ' 次）' : ''}</div>` : '';
    const btns = (t.status === 'failed' || t.status === 'dead')
      ? `<button class="a-btn small" data-action="anki-task-retry" data-arg1="${esc(t.id)}">重试</button>`
      : '';
    const del = `<button class="a-btn small ghost" data-action="anki-task-delete" data-arg1="${esc(t.id)}" title="删除">✕</button>`;
    return `<div class="at-item">
      <span class="at-status" style="color:${m.color}">${m.icon} ${esc(m.text)}</span>
      <span class="at-label">${esc(t.label || t.kind)}</span>
      ${res}
      <span class="at-time">${esc(ts)}</span>
      <span class="at-btns">${btns}${del}</span>
      ${err}
    </div>`;
  }).join('') + '</div>';

  if (list.length > 40) html += `<div class="at-more">仅显示最近 40 条（共 ${list.length}）</div>`;
  el.innerHTML = html;
}
