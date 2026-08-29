/* ============================================================
   AI 英语对话教练 — 面板模式与拖拽、侧栏缩放、模态框、本地备份、toast
   由 js/app.js 拆分而来（原 4120-4342 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- Feedback panel modes ---------- */
let feedbackPanelMode = 'expanded';
function setFeedbackPanelMode(mode) {
  const panel = document.getElementById('sidePanel');
  if (!panel) return;
  feedbackPanelMode = mode;
  panel.classList.remove('panel-expanded', 'panel-mini', 'panel-collapsed', 'open');
  if (mode === 'expanded') {
    panel.classList.add('panel-expanded', 'open');
    // 恢复展开时的宽度（从小窗模式保存的宽度，或 localStorage 中读取）
    const savedW = localStorage.getItem('ai_en_panelW');
    if (savedW) panel.style.width = savedW + 'px';
    else panel.style.width = '';   // 恢复 CSS 默认
    // 清除小窗时设置的定位与尺寸
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.height = '';
  }
  if (mode === 'mini') {
    // 保存当前展开宽度
    const expandedW = panel.offsetWidth;
    localStorage.setItem('ai_en_panelW', String(expandedW));
    panel.classList.add('panel-mini', 'open');
    // 初始位置：右下角，340×360
    panel.style.width = '340px';
    panel.style.height = '360px';
    panel.style.left = (window.innerWidth - 340 - 18) + 'px';
    panel.style.top = (window.innerHeight - 360 - 18) + 'px';
    panel.style.right = '';
    panel.style.bottom = '';
  }
  if (mode === 'collapsed') panel.classList.add('panel-collapsed');
  document.body.classList.toggle('floating-panel-open', mode !== 'collapsed');
  hideTip();
  syncDrawerBackdrop();
}

/* ---------- 小窗模式拖拽 + 缩放 ---------- */
(function initPanelDragResize() {
  const panel = document.getElementById('sidePanel');
  const dragBar = document.getElementById('panelDragHandle');
  const resizeCorner = document.getElementById('panelResizeCorner');
  if (!panel || !dragBar || !resizeCorner) return;

  dragBar.addEventListener('mousedown', function(e) {
    if (!panel.classList.contains('panel-mini')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origLeft = parseInt(panel.style.left) || panel.offsetLeft;
    const origTop = parseInt(panel.style.top) || panel.offsetTop;
    function onMove(ev) {
      panel.style.left = (origLeft + ev.clientX - startX) + 'px';
      panel.style.top = (origTop + ev.clientY - startY) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  resizeCorner.addEventListener('mousedown', function(e) {
    if (!panel.classList.contains('panel-mini')) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = panel.offsetWidth, startH = panel.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    function onMove(ev) {
      let w = Math.max(220, Math.min(startW + ev.clientX - startX, vw - 40));
      let h = Math.max(120, Math.min(startH + ev.clientY - startY, vh - 40));
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

/* ---------- Sidebar Resize ---------- */
let resizing = null;
let _suppressAutoScroll = false;
function initResize(handleId, targetId, storageKey, minW, maxW, isLeft) {
  const handle = document.getElementById(handleId);
  const target = document.getElementById(targetId);
  if (!handle || !target) return;
  const saved = localStorage.getItem('ai_en_' + storageKey);
  if (saved) target.style.width = saved + 'px';
  handle.addEventListener('mousedown', function(e) {
    if (target.classList.contains('panel-mini')) return;   // 小窗模式禁用左边条
    e.preventDefault();
    resizing = { handle, target, storageKey, minW, maxW, isLeft, startX: e.clientX, startW: target.offsetWidth };
    handle.classList.add('resizing');
    target.classList.add('resize-active');   // 禁用过渡，边界条跟随鼠标
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
}
document.addEventListener('mousemove', function(e) {
  if (!resizing) return;
  const dx = resizing.isLeft ? (resizing.startX - e.clientX) : (e.clientX - resizing.startX);
  let w = resizing.startW + dx;
  w = Math.max(resizing.minW, Math.min(w, resizing.maxW));
  resizing.target.style.width = w + 'px';
});
document.addEventListener('mouseup', function() {
  if (!resizing) return;
  localStorage.setItem('ai_en_' + resizing.storageKey, resizing.target.offsetWidth);
  resizing.handle.classList.remove('resizing');
  resizing.target.classList.remove('resize-active');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  resizing = null;
});
function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

/* ---------- Modal helpers ---------- */
function removeAllModals() {
  document.querySelectorAll('.modal-overlay, body > div[style*="position:fixed"]').forEach(el => {
    if (el.id === 'translateTip') return;
    el.remove();
  });
}

/* ---------- Backup ---------- */
// 多时间节点保留策略（与服务端一致）：2分钟/5分钟/10分钟/1小时/1天/2天/3天/7天/30天
const BACKUP_RETENTION_MS = [
  2*60*1000, 5*60*1000, 10*60*1000, 60*60*1000,
  24*60*60*1000, 2*24*60*60*1000, 3*24*60*60*1000,
  7*24*60*60*1000, 30*24*60*60*1000
];
function pruneBackupHistory(history) {
  if (!Array.isArray(history) || !history.length) return history;
  const now = Date.now();
  const entries = history.map((e, i) => ({ i, time: new Date(e.time).getTime() }));
  const keep = new Set([entries.length - 1]); // 最新必留
  for (const ms of BACKUP_RETENTION_MS) {
    const target = now - ms;
    let best = null, bestDiff = Infinity;
    for (const en of entries) {
      const d = Math.abs(en.time - target);
      if (d < bestDiff) { bestDiff = d; best = en; }
    }
    if (best) keep.add(best.i);
  }
  return history.filter((_, i) => keep.has(i));
}

function localStorageBackup() {
  try {
    const snap = {
      time: new Date().toISOString(),
      conversations: getAllConversations(),
      currentConv: getCurrentConvId(),
      vocab: getVocab(),
      weak: getWeak()
    };
    localStorage.setItem('ai_en_backup_latest', JSON.stringify(snap));
    // 按多时间节点保留历史备份（而非只留最近 10 份）
    let history = JSON.parse(localStorage.getItem('ai_en_backup_history') || '[]');
    history.push(snap);
    history = pruneBackupHistory(history);
    localStorage.setItem('ai_en_backup_history', JSON.stringify(history));
  } catch (e) { console.warn('localStorage backup failed', e); }
}

function backupNow() {
  localStorageBackup();
  // 服务器端：SQLite 数据库快照（VACUUM INTO）
  try {
    fetch((BACKEND_URL || '') + '/api/backup', { method: 'POST', headers: { ...authHeaders() } }).then(r => r.json()).then(d => {
      if (d && d.status) toastMsg('✅ 已备份到服务器数据库');
      else toastMsg('⚠️ 本地已备份，服务器备份失败');
    }).catch(() => toastMsg('⚠️ 本地已备份，服务器备份失败'));
  } catch (e) {
    toastMsg('✅ 已本地备份');
  }
}

function toastMsg(msg, type = 'info', durationMs = 2500) {
  const stack = document.getElementById('toastStack');
  if (!stack) { console.log('[toast]', msg); return; }
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.textContent = msg;
  stack.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s, transform .25s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(-6px)';
    setTimeout(() => t.remove(), 250);
  }, durationMs);
}

/* ---- 系统错误（不作为 AI 消息持久化；仅 UI 显示） ---- */
function showSystemError(message, opts = {}) {
  const container = document.getElementById('messages');
  if (!container) { toastMsg(message, 'error'); return; }
  const el = document.createElement('div');
  el.className = 'system-error';
  el.setAttribute('role', 'alert');
  el.innerHTML = '<span class="err-icon" aria-hidden="true">⚠️</span><div style="flex:1">' +
    '<div><strong>回复失败</strong></div>' +
    '<div style="margin-top:4px">' + esc(message) + '</div>' +
    (opts.hint ? '<div style="margin-top:4px;color:#7f1d1d;font-size:12px">' + esc(opts.hint) + '</div>' : '') +
    '<div class="err-actions">' +
    (opts.retry ? '<button class="a-btn small" data-action="retry-error" data-arg1="' + opts.retry + '">🔄 重试</button>' : '') +
    '<button class="a-btn small ghost" data-action="dismiss-error">关闭</button>' +
    '</div></div>';
  container.appendChild(el);
  scrollToBottom();
}
