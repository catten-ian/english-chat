/* ============================================================
   AI 英语对话教练 — DOMContentLoaded 初始化、登录引导、定时备份
   由 js/app.js 拆分而来（原 8024-8251 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
   ============================================================ */

/* ============================================================
   全局事件委托（data-action）
   ------------------------------------------------------------
   启用严格 CSP（script-src 'self'）后，HTML 里的 inline onclick
   会被浏览器直接拒绝。本应用在 JS 里动态生成大量带操作按钮的
   HTML，无法逐个 addEventListener，因此统一采用「data-action +
   全局委托」：
     <button data-action="send-message">…
   document 上的 click/change/input 委托捕获后查表分发。
   静态 HTML（index.html）中的按钮同样改用 data-action，与动态
   内容共用一套机制。
   - 参数：data-arg1 / data-arg2 / data-arg3 … + data-argc 声明个数
   - 委托只处理「最内层」带 data-action 的祖先，处理完即返回，
     等价于原内层 onclick 里 event.stopPropagation() 挡住外层 onclick
   ============================================================ */
const ACTION_HANDLERS = {};
function registerAction(name, fn) {
  if (ACTION_HANDLERS[name]) throw new Error('duplicate action: ' + name);
  ACTION_HANDLERS[name] = fn;
}

function initActionDelegation() {
  function resolve(e) {
    const t = e.target;
    if (!t || !t.closest) return null;
    const el = t.closest('[data-action]');
    if (!el) return null;
    const fn = ACTION_HANDLERS[el.getAttribute('data-action')];
    if (!fn) return null;
    return { el, fn };
  }
  function collectArgs(el) {
    const argc = parseInt(el.getAttribute('data-argc') || '0', 10);
    const args = [];
    for (let i = 1; i <= argc; i++) args.push(el.getAttribute('data-arg' + i));
    return args;
  }
  document.addEventListener('click', function (e) {
    const hit = resolve(e);
    if (!hit) return;
    const args = collectArgs(hit.el);
    // this = 触发元素（与 handler 内部 this.closest(...) 的旧用法兼容）
    hit.fn.apply(hit.el, [e].concat(args));
  });
  document.addEventListener('change', function (e) {
    const hit = resolve(e);
    if (!hit) return;
    hit.fn.call(hit.el, e);
  });
  document.addEventListener('input', function (e) {
    const hit = resolve(e);
    if (!hit) return;
    hit.fn.call(hit.el, e);
  });
}

/* 通用「关闭最近弹层」动作（原 this.closest('.modal-overlay').remove() 的集中版） */
registerAction('close-overlay', function (e) {
  const ov = this.closest('.modal-overlay');
  if (ov) ov.remove();
});
/* 通用「关闭最近系统错误提示」 */
registerAction('dismiss-error', function (e) {
  const el = this.closest('.system-error');
  if (el) el.remove();
});
/* 系统错误条「重试」：data-arg1 为旧 opts.retry 函数名（字符串） */
registerAction('retry-error', function () {
  const name = this.getAttribute('data-arg1');
  const el = this.closest('.system-error');
  if (el) el.remove();
  if (name === 'resendFromLastUserMsg') resendFromLastUserMsg();
  else if (name === 'resendLastUserText') resendLastUserText();
});

/* ============================================================
   action 注册表：静态 index.html 按钮 + 动态生成 HTML 的按钮。
   参数通过 data-arg1..N + data-argc 传递；这里统一转换为旧函数签名。
   ============================================================ */
registerAction('go-home', function () { showHome(); });
registerAction('switch-mode', function () { switchMode(this.getAttribute('data-mode')); });
registerAction('toggle-anki', function () { toggleAnki(); });
registerAction('toggle-auto-read', function () { toggleAutoRead(); });
registerAction('toggle-music', function () { toggleMusic(); });
registerAction('prompt-new-conv', function () { promptNewConversation(); });
registerAction('open-settings', function () { openSettings(); });
registerAction('export-debug', function () { exportDebug(); });
registerAction('logout-app', function () { logoutUser(); }); // 原首页 bug：调用了不存在的 logout()
registerAction('sidebar-new-conv', function () { sidebarNewConversation(); });
registerAction('toggle-sidebar', function () { toggleSidebar(); });
registerAction('close-drawers', function () { closeDrawers(); });
registerAction('send-message', function () { sendMessage(); });
registerAction('stop-sending', function () { stopSending(); });
registerAction('toggle-hl', function () { toggleHighlightMode(); });
registerAction('toggle-notes', function () { toggleNotesPanel(); });
registerAction('reading-tts', function () { readingTts(); });
registerAction('open-reading-picker', function () { openReadingPicker(); });
registerAction('open-recite', function () { openReciteInMain(); });
registerAction('reset-reading-picker', function () { resetReadingPicker(); });
registerAction('start-reading-paste', function () { startReadingFromPaste(); });
registerAction('start-web-review', function () { startWebReview(); });
registerAction('push-all-anki', function () { pushAllToAnki(); });
registerAction('start-writing', function () { startWriting(); });
registerAction('clear-writing', function () { clearWriting(); });
registerAction('clear-topic-image', function () { clearTopicImage(); });
registerAction('submit-writing', function () { submitWriting(); });
registerAction('translate-source', function () { translateSource(this.getAttribute('data-arg1')); });
registerAction('tr-category-changed', function () { trCategoryChanged(); });
registerAction('export-tr-bank', function () { exportTrBank(); });
registerAction('next-translate', function () { nextTranslate(); });
registerAction('submit-translate', function () { submitTranslate(); });
registerAction('show-translate-answer', function () { showTranslateAnswer(); });
registerAction('toggle-tr-history', function () { toggleTranslateHistory(); });
registerAction('switch-game-tab', function () { switchGameTab(this.getAttribute('data-game')); });
registerAction('charade-source', function () { charadeSource(this.getAttribute('data-arg1')); });
registerAction('charade-next', function () { charadeNext(); });
registerAction('charade-reveal', function () { charadeReveal(); });
registerAction('submit-charade', function () { submitCharade(); });
registerAction('charade-hint', function () { charadeShowHint(); });
registerAction('cloze-source', function () { clozeSource(this.getAttribute('data-arg1')); });
registerAction('cloze-next', function () { clozeNext(); });
registerAction('submit-cloze', function () { submitCloze(); });
registerAction('cloze-answers', function () { clozeShowAnswers(); });
registerAction('wordle-source', function () { wordleSource(this.getAttribute('data-arg1')); });
registerAction('wordle-new', function () { wordleNew(); });
registerAction('panel-mode', function () { setFeedbackPanelMode(this.getAttribute('data-arg1')); });
registerAction('switch-right-tab', function () { switchRightTab(this.getAttribute('data-tab')); });
registerAction('switch-feedback-tab', function () { switchFeedbackTab(this.getAttribute('data-ftab')); });
registerAction('query-dict', function () { queryDict(); });
registerAction('bank-render', function () { renderTrBankPanel(); });
registerAction('toggle-mobile-panel', function () { toggleMobilePanel(); });
registerAction('add-from-tip', function () { addFromTip(); });
registerAction('hide-tip', function () { hideTip(); });
registerAction('close-topic-modal', function () { closeTopicModal(); });
// 文件上传（change 委托）：原 inline onchange="fn(event)"
registerAction('topic-image', function (e) { handleTopicImageUpload(e); });
registerAction('import-tr-bank', function (e) { importTrBank(e); });

/* ---- 动态 HTML 中的按钮动作 ---- */
// 消息区（05-chat-view.js）
registerAction('speak-text', function () { speakText(this); });
registerAction('translate-ai-msg', function () { translateAiMessage(this.getAttribute('data-arg1'), this); });
registerAction('select-feedback', function () { selectFeedback(this.getAttribute('data-arg1')); });
registerAction('edit-message', function () { editMessage(this.getAttribute('data-arg1')); });
registerAction('delete-message', function () { deleteMessage(this.getAttribute('data-arg1')); });
registerAction('switch-variant', function () { switchVariant(this.getAttribute('data-arg1'), +this.getAttribute('data-arg2')); });
registerAction('retry-analysis', function () { retryAnalysis(this.getAttribute('data-arg1')); });
registerAction('show-vocab-detail', function () { showVocabDetail(+this.getAttribute('data-arg1')); });
registerAction('remove-word', function () { removeWord(+this.getAttribute('data-arg1')); });
registerAction('clear-all-vocab', function () { clearAllVocab(); });
registerAction('delete-weak-point', function () { deleteWeakPoint(this.getAttribute('data-arg1')); });
// Anki（06-anki.js）
registerAction('anki-sync', function () { syncAnkiReviewData(); renderAnkiSidebar(); });
registerAction('web-review-show-answer', function () { webReviewShowAnswer(); });
registerAction('close-web-review', function () { closeWebReview(); });
registerAction('web-review-answer', function () { webReviewAnswer(+this.getAttribute('data-arg1')); });
// Anki 任务中心（21-anki-tasks.js）
registerAction('anki-queue-run', function () { processAnkiQueue({ manual: true, includeFailed: true }); });
registerAction('anki-queue-retry-all', function () { retryAllFailedAnkiTasks(); });
registerAction('anki-queue-clear-done', function () { clearFinishedAnkiTasks(); });
registerAction('anki-task-retry', function () { retryAnkiTask(this.getAttribute('data-arg1')); });
registerAction('anki-task-delete', function () { deleteAnkiTask(this.getAttribute('data-arg1')); });
// 成本与隐私中心（22-cost.js）
registerAction('cost-range', function () { setCostRange(this.getAttribute('data-arg1')); });
registerAction('cost-set-price', function () { setCostPrice(this.getAttribute('data-arg1'), this.value); });
registerAction('cost-clear-usage', function () { clearUsageRecords(); });
// 对话/版本树（07-chat-actions.js）
registerAction('save-edit', function () { saveEdit(this.getAttribute('data-arg1')); });
registerAction('cancel-edit', function () { cancelEdit(this.getAttribute('data-arg1')); });
registerAction('pick-topic', function () { pickTopic(this.getAttribute('data-arg1')); });
registerAction('resume-conv', function () { resumeConversation(this.getAttribute('data-arg1')); });
registerAction('delete-conv', function () { deleteConv(this.getAttribute('data-arg1')); });
// 划词/词典（08-selection.js / 10-dictionary.js）
registerAction('quick-add-anki', function () { quickAddToAnki(this.getAttribute('data-arg1'), this.getAttribute('data-arg2')); });
registerAction('quick-add-vocab', function () { quickAddVocab(this.getAttribute('data-arg1'), this.getAttribute('data-arg2')); });
registerAction('clear-dict-history', function () { clearDictHistory(); });
registerAction('query-dict-history', function () { queryDictFromHistory(+this.getAttribute('data-arg1')); });
registerAction('toggle-dict-feedback', function () { toggleDictFeedback(+this.getAttribute('data-arg1')); });
// 高考题库（09-gaokao.js）
registerAction('open-gaokao-exam', function () { openGaokaoExam(this.getAttribute('data-arg1')); });
registerAction('back-gaokao-list', function () { backToGaokaoList(); });
registerAction('gaokao-push-all', function () { gaokaoPushAll(this.getAttribute('data-arg1')); });
registerAction('gaokao-mark-opened', function () { gaokaoMarkOpened(); });
registerAction('gaokao-push-one', function () { gaokaoPushOne(+this.getAttribute('data-arg1')); });
// 设置（12-settings.js）
registerAction('settings-select-char', function () { settingsSelectCharacter(this.getAttribute('data-arg1')); });
registerAction('delete-strategist-instruction', function () { deleteStrategistInstruction(+this.getAttribute('data-arg1')); });
registerAction('click-avatar-file', function () { const f = document.getElementById('avatarFile'); if (f) f.click(); });
registerAction('change-password', function () { changePassword(); });
registerAction('prompt-new-character', function () { promptNewCharacter(); });
registerAction('music-prev', function () { musicPrev(); });
registerAction('settings-music-toggle', function () { settingsMusicToggle(); });
registerAction('music-next', function () { musicNext(); });
registerAction('send-strategist-instruction', function () { sendStrategistInstruction(); });
registerAction('check-anki-connect', function () { checkAnkiConnect(); });
registerAction('reconnect-anki-connect', function () { reconnectAnkiConnect(); });
registerAction('backup-now', function () { backupNow(); });
registerAction('logout-user', function () { logoutUser(); });
registerAction('save-settings', function () { saveSettings(); });
registerAction('save-new-character', function () { saveNewCharacter(); });
registerAction('choose-slash-command', function () { chooseSlashCommand(this.getAttribute('data-arg1')); });
registerAction('upload-avatar', function () { uploadAvatar(this); });
registerAction('settings-music-select', function () { settingsMusicSelect(this.value); });
registerAction('set-music-vol', function () { setMusicVol(this.value); });
registerAction('set-tts-duck-ratio', function () {
  const v = Math.max(0, Math.min(100, parseInt(this.value, 10) || 0));
  setSetting('ttsDuckRatio', v);
  const lab = document.getElementById('setTtsDuckRatioValue');
  if (lab) lab.textContent = v === 0 ? '暂停' : v + '%';
});
// 阅读（16-reading.js）
registerAction('start-reading-preset', function () { startReadingFromPreset(this.getAttribute('data-arg1')); });
registerAction('start-reading-history', function () { startReadingFromHistory(this.getAttribute('data-arg1')); });
registerAction('delete-reading-note', function () { deleteReadingNote(this.getAttribute('data-arg1')); });
// 练习/题库面板（17-practice.js）
registerAction('pick-writing-topic', function () { pickWritingTopic(this.getAttribute('data-arg1')); });
registerAction('ann-back-edit', function () { annBackToEdit(this.getAttribute('data-arg1')); });
registerAction('tr-select-question', function () { trSelectQuestion(this.getAttribute('data-arg1'), +this.getAttribute('data-arg2')); });
registerAction('clear-tr-history', function () { clearTranslateHistory(); });
registerAction('expand-tr-record', function () { expandTrRecord(+this.getAttribute('data-arg1')); });
// 游戏（18-games.js）
registerAction('charade-improve', function () { charadeImprove(); });
registerAction('charade-skip', function () { charadeSkip(); });
registerAction('cloze-pick', function () { clPickCandidate(this, this.getAttribute('data-arg1')); });
registerAction('wl-key', function () { wlKey(this.getAttribute('data-arg1')); });

/* ============================================================
   移动端「更多」溢出菜单（#mobileMoreMenu，仅 ≤767px 显示）
   顶栏放不下的次要操作（Anki/Auto/音乐/新对话/设置/调试/首页）收进 ⋯ 菜单。
   ============================================================ */
function closeMobileMore() {
  const menu = document.getElementById('mobileMoreMenu');
  if (menu) menu.classList.remove('open');
}
function toggleMobileMore() {
  const menu = document.getElementById('mobileMoreMenu');
  if (!menu) return;
  const willOpen = !menu.classList.contains('open');
  if (willOpen) {
    const u = document.getElementById('mmmUser');
    if (u) u.textContent = currentUser() ? ('👤 ' + currentUser()) : '';
  }
  menu.classList.toggle('open', willOpen);
}
function initMobileMore() {
  const menu = document.getElementById('mobileMoreMenu');
  if (!menu) return;
  // 点中任一菜单项后收起
  menu.addEventListener('click', function (e) {
    if (e.target.closest('.mmm-item')) closeMobileMore();
  });
  // 点击菜单与 ⋯ 按钮之外的区域收起
  document.addEventListener('click', function (e) {
    if (!menu.classList.contains('open')) return;
    if (e.target.closest('#mobileMoreMenu') || e.target.closest('.mobile-more-btn')) return;
    closeMobileMore();
  });
}
registerAction('toggle-mobile-more', function (e) { e.stopPropagation(); toggleMobileMore(); });

/* ============================================================
   模态框可访问性：焦点圈定（focus trap）+ Escape 关闭 + 关闭后焦点恢复
   - 动态弹窗都走 .modal-overlay（append 到 body），用 MutationObserver 自动增强
   - 静态 #topicModal 通过 display 切换显隐，监听其 style 变化
   - 可点击的 div/span（带 data-action 的非原生交互元素）补 tabindex/role，
     并支持 Enter / Space 触发（全局 keydown 委托，原生 button/a/input 不重复处理）
   ============================================================ */
const A11Y_FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
function a11yFocusables(container) {
  return [...container.querySelectorAll(A11Y_FOCUSABLE)].filter(el => el.offsetParent !== null || el.getClientRects().length > 0);
}
function trapModal(container, onClose) {
  if (!container || container.__a11yTrap) return null;
  container.__a11yTrap = true;
  if (!container.getAttribute('role')) container.setAttribute('role', 'dialog');
  if (!container.hasAttribute('aria-modal')) container.setAttribute('aria-modal', 'true');
  if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
  const prevFocus = document.activeElement;
  let released = false;
  const close = onClose || function () { if (container.remove) container.remove(); };
  requestAnimationFrame(() => {
    if (released) return;
    const f = a11yFocusables(container);
    try { (f[0] || container).focus(); } catch (e) {}
  });
  function onKey(e) {
    if (released) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = a11yFocusables(container);
      if (!f.length) { e.preventDefault(); try { container.focus(); } catch (x) {} return; }
      const first = f[0], last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !container.contains(active))) { e.preventDefault(); try { last.focus(); } catch (x) {} }
      else if (!e.shiftKey && active === last) { e.preventDefault(); try { first.focus(); } catch (x) {} }
    }
  }
  container.addEventListener('keydown', onKey);
  const removalObs = new MutationObserver(() => { if (!document.contains(container)) release(); });
  removalObs.observe(document.body, { childList: true, subtree: true });
  function release() {
    if (released) return;
    released = true;
    container.removeEventListener('keydown', onKey);
    removalObs.disconnect();
    if (prevFocus && document.contains(prevFocus) && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch (e) {}
    }
  }
  return { release };
}
function initModalA11y() {
  const mo = new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.classList && n.classList.contains('modal-overlay')) trapModal(n);
      if (n.querySelectorAll) n.querySelectorAll('.modal-overlay').forEach(o => trapModal(o));
    }));
  });
  mo.observe(document.body, { childList: true, subtree: true });
  // 静态话题弹窗：display 切换显隐
  const topic = document.getElementById('topicModal');
  if (topic) {
    let ctrl = null;
    new MutationObserver(() => {
      const visible = getComputedStyle(topic).display !== 'none';
      if (visible && !ctrl) ctrl = trapModal(topic, () => { if (typeof closeTopicModal === 'function') closeTopicModal(); });
      else if (!visible && ctrl) { ctrl.release(); ctrl = null; }
    }).observe(topic, { attributes: true, attributeFilter: ['style', 'class'] });
  }
}
function initInteractiveA11y() {
  const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION']);
  function enhance(root) {
    if (!root || root.nodeType !== 1) return;
    const list = root.matches && root.matches('[data-action]') ? [root] : [];
    root.querySelectorAll && list.push(...root.querySelectorAll('[data-action]'));
    list.forEach(el => {
      if (NATIVE.has(el.tagName)) return;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.getAttribute('role')) el.setAttribute('role', 'button');
    });
  }
  const mo = new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(n => enhance(n)));
  });
  mo.observe(document.body, { childList: true, subtree: true });
  enhance(document.body);
  // Enter / Space 激活非原生 data-action 元素（原生 button/a/input 浏览器已自行派发 click）
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const t = e.target;
    if (!t || t.nodeType !== 1 || NATIVE.has(t.tagName)) return;
    const el = t.closest && t.closest('[data-action]');
    if (!el || NATIVE.has(el.tagName)) return;
    e.preventDefault();
    el.click();
  });
}

/* ============================================================
   同步状态指示器（顶栏 #syncIndicator）
   读取 storage.js 的 syncStatus：已同步 / 保存中 / 失败可点击重试 / 离线。
   轮询刷新 + online/offline 事件；失败或离线路径下点击会触发重传。
   ============================================================ */
function initSyncIndicator() {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  function fmt(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function render() {
    if (typeof isAuthed === 'function' && !isAuthed()) { el.style.display = 'none'; return; }
    el.style.display = '';
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    let cls, txt, tip;
    if (!online) {
      cls = 'offline'; txt = '⚠️ 离线 · 暂存本地';
      tip = '网络已断开，数据先存在浏览器本地，恢复联网后点击或等待自动重传';
    } else if (syncStatus.pending > 0) {
      cls = 'saving'; txt = '<span class="sync-dot">⏳</span> 保存中…';
      tip = '正在同步到服务器 SQLite 数据库';
    } else if (syncStatus.failedKeys.size > 0) {
      cls = 'error'; txt = '⚠️ 同步失败 · 点击重试';
      tip = '未同步项：' + [...syncStatus.failedKeys].join(', ') +
            (syncStatus.lastError ? '（' + syncStatus.lastError + '）' : '');
    } else if (syncStatus.lastSavedAt) {
      cls = 'synced'; txt = '✓ 已同步 ' + fmt(syncStatus.lastSavedAt);
      tip = '数据已保存到服务器 SQLite · 点击立即重传本地缓存';
    } else {
      cls = 'idle'; txt = '💾 本地存储';
      tip = '登录后数据将同步到服务器';
    }
    if (el.dataset.cls !== cls) { el.dataset.cls = cls; el.className = 'sync-ind ' + cls; }
    if (el.innerHTML !== txt) el.innerHTML = txt;
    el.title = tip;
  }
  el.addEventListener('click', async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toastMsg('当前离线，网络恢复后会自动重试');
      return;
    }
    const r = await flushLocalToServer();
    if (!r || r.offline || r.skipped) { render(); return; }
    if (r.flushed === r.total && syncStatus.failedKeys.size === 0) toastMsg('✅ 本地数据已同步到服务器');
    else toastMsg('同步完成 ' + r.flushed + '/' + r.total + '，仍有 ' + syncStatus.failedKeys.size + ' 项失败');
    render();
  });
  window.addEventListener('online', () => { render(); flushLocalToServer().then(render); });
  window.addEventListener('offline', render);
  setInterval(render, 800);
  render();
}

document.addEventListener('DOMContentLoaded', function() {
  initActionDelegation();
  initModalA11y();
  initInteractiveA11y();
  initSyncIndicator();
  initMobileMore();
  document.getElementById('difficulty').addEventListener('input', updateDifficulty);
  // 作文题目区拖拽图片：dragover/drop 不是 click/change/input，需静态绑定
  const wTopicDisplay = document.getElementById('wTopicDisplay');
  if (wTopicDisplay) {
    wTopicDisplay.addEventListener('dragover', function (e) { e.preventDefault(); });
    wTopicDisplay.addEventListener('drop', function (e) { handleTopicImageDrop(e); });
  }
  musicInit();

  // Init resize handles
initResize('sidebarResize', 'sidebar', 'sidebarW', 180, 500, true);
initResize('panelResize', 'sidePanel', 'panelW', 280, 720, true);

  const loginOverlay = document.getElementById('loginOverlay');
  const loginBtn = document.getElementById('loginBtn');
  const loginMsg = document.getElementById('loginMsg');
  const loginUser = document.getElementById('loginUser');
  const loginPass = document.getElementById('loginPass');
  const userBadge = document.getElementById('userBadge');

  async function doLogin() {
    const u = loginUser.value.trim();
    const p = loginPass.value;
    if (!u || !p) { loginMsg.textContent = '请输入用户名和密码'; return; }
    loginBtn.disabled = true;
    loginMsg.textContent = '登录中...';
    try {
      await apiLogin(u, p);
      // 换账户时先清掉上一个账户的本地缓存，避免串号（loadUserData 内部也会再确认一次）
      ensureCacheOwner(currentUser());
      loginMsg.textContent = '';
      if (userBadge) userBadge.textContent = currentUser();
      loginOverlay.style.display = 'none';
      bootApp();
    } catch (e) {
      loginMsg.textContent = e.message || '登录失败';
    } finally {
      loginBtn.disabled = false;
    }
  }
  if (loginBtn) loginBtn.addEventListener('click', doLogin);
  if (loginPass) loginPass.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
  if (loginUser) loginUser.addEventListener('keydown', function(e) { if (e.key === 'Enter') { loginPass.focus(); } });

  // 应用主体初始化（登录成功后才执行）
  function bootApp() {
    loadUserData().then(function() {
      // Load persisted settings
      ankiAutoAdd = getSetting('ankiAutoAdd', false);
      autoReadAloud = getSetting('autoRead', false);
      streamChatEnabled = getSetting('streamChat', true);
      strategistEnabled = getSetting('strategistEnabled', true);
      executorEnabled = getSetting('executorEnabled', true);
      activeCharacterId = getSetting('activeCharacter', 'alex');
      const savedAvatar = getSetting('avatar', '');
      if (savedAvatar) {
        const badge = document.getElementById('userBadge');
        if (badge) badge.style.backgroundImage = 'url("' + savedAvatar.replace(/"/g, '') + '")';
      }
      const ankiBtn = document.getElementById('ankiToggle');
      const autoBtn = document.getElementById('autoReadToggle');
      if (ankiBtn) ankiBtn.classList.toggle('active', ankiAutoAdd);
      if (autoBtn) autoBtn.classList.toggle('active', autoReadAloud);

      const input = document.getElementById('userInput');
       document.addEventListener('click', function(e) {
         if (!e.target.closest('#sidePanel, .side-panel-toggle')) {
           if (isMobile() && document.getElementById('sidePanel')?.classList.contains('open')) setFeedbackPanelMode('collapsed');
         }
         if (!e.target.closest('#sidebar, #sidebarToggle, #mobileSidebarToggle')) {
           if (isMobile() && sidebarOpen) { sidebarOpen = false; document.getElementById('sidebar')?.classList.remove('open'); }
         }
       });
input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (document.getElementById('slashMenu')?.style.display === 'block') {
            e.preventDefault();
            const first = document.querySelector('.slash-item');
            if (first) first.click();
            return;
          }
          e.preventDefault(); sendMessage();
        }
      });
      input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        const value = this.value;
        if (/^\/[^\s]*$/.test(value)) renderSlashMenu(value.slice(1));
        else hideSlashMenu();
      });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') hideSlashMenu();
        if (e.key === 'Tab' && document.getElementById('slashMenu')?.style.display === 'block') {
          e.preventDefault();
          const first = document.querySelector('.slash-item');
          if (first) { first.click(); }
        }
        if (e.key === 'ArrowDown' && document.getElementById('slashMenu')?.style.display === 'block') {
          e.preventDefault();
          document.querySelector('.slash-item')?.focus();
        }
      });

      // Dict input: Enter to send on desktop, newline on mobile
      const dictInput = document.getElementById('dictInput');
      if (dictInput) {
        const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        dictInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            if (!isMobile && !e.shiftKey) { e.preventDefault(); queryDict(); }
          }
        });
      }

      // Translation input: Enter to submit, Shift+Enter for newline
      const trInput = document.getElementById('trInput');
      if (trInput) {
        trInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitTranslate();
          }
        });
      }

      // Writing textarea: word count update
      const wText = document.getElementById('wText');
      if (wText) wText.addEventListener('input', updateWordCount);

      // Click-to-translate on feedback panel and dict result
      document.getElementById('sidePanel').addEventListener('mouseup', function(e) {
        const selection = window.getSelection();
        const selected = selection.toString().trim();
        if (!selected || selected.length > 200) return;
        if (e.target.closest('input, textarea, button, select')) return;
        tipSelected = selected;
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        showTip(rect, selected);
        const wordCount = selected.trim().split(/\s+/).length;
        const hasSentencePunct = /[,.!?;:。！？]/.test(selected);
        const hasChinese = /[\u4e00-\u9fff]/.test(selected);
        const isPhrase = wordCount >= 2 && wordCount <= 4 && !hasSentencePunct && !hasChinese;
        const isSentence = wordCount > 4 || hasSentencePunct || hasChinese;
        const ctx = getActivePath().slice(-6).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
        const contextBlock = ctx ? '\n\nRelevant conversation context:\n' + ctx : '';
        translateSelection(selected, isSentence, isPhrase, contextBlock);
      });

      renderVocab();
      renderWeak();
      // Anki 任务中心：登录后先渲染一次，并尝试补发上次遗留的排队任务
      if (typeof renderAnkiTaskCenter === 'function') renderAnkiTaskCenter();
      if (typeof processAnkiQueue === 'function' && authToken) processAnkiQueue().catch(() => {});

      const currentId = getCurrentConvId();
      const convs = getAllConversations();
      if (currentId && convs[currentId]) {
        resumeConversation(currentId);
      } else {
        const ids = Object.keys(convs);
        if (ids.length) {
          resumeConversation(ids[0]);
        } else {
          // 有首页 -> 不自动弹话题选择，让用户从首页进 Chat 后再选
          // 但仍创建一个默认对话以便后续使用。
          // 注意：conversation 必须是版本树「数组」；对话记录本身由 createConversation 写入 convs map，
          // 否则 saveConversation() 会因 convs[id] 不存在而静默丢弃，且 getActivePath() 会对对象报错。
          conversation = [];
          createConversation('新对话', 'free');
        }
      }
      renderSidebar();
      // 侧栏初始展开偏好（大屏默认展开 + 记住用户选择）
      applySidebarPreference();
      // 页面加载：渲染 Anki 侧边栏 + 拉取复习数据（静默失败不影响使用）
      if (ankiAutoAdd && authToken) {
        renderAnkiSidebar().catch(() => {});
        if (getSetting('ankiAutoSync', true) !== false) syncAnkiReviewData().catch(() => {});
      } else {
        renderAnkiSidebar().catch(() => {});
      }
      // 登录成功后恢复上次模式，而不是总是回首页
      document.getElementById('homeUser').textContent = currentUser() || '';
      // 应用作答字体设置
      applyAnswerFontSettings();
      // 作答框初始边缘留白
      ['wText', 'trInput', 'chDesc'].forEach(id => {
        const ta = document.getElementById(id);
        if (ta) {
          updateAnswerPadding(ta);
          ta.addEventListener('input', function() { updateAnswerPadding(this); });
        }
      });
      const savedGameTab = localStorage.getItem('ai_en_game_tab');
      if (savedGameTab && ['charade', 'cloze', 'wordle'].includes(savedGameTab)) currentGameTab = savedGameTab;
      const savedMode = localStorage.getItem('ai_en_mode');
      const validModes = ['chat', 'reading', 'practice', 'writing', 'translation', 'game', 'progress'];
      if (savedMode && validModes.includes(savedMode)) {
        switchMode(savedMode, true);
      } else {
        showHome();
      }
    });
  }

  // 启动：token 有效则直接进入，否则显示登录
  (function tryBoot() {
    if (isAuthed()) {
      apiMe().then(function(me) {
        if (me && me.username) {
          if (userBadge) userBadge.textContent = me.username;
          // token 恢复时服务端用户名是权威值：若与本地缓存归属不一致，先清缓存
          ensureCacheOwner(me.username);
          loginOverlay.style.display = 'none';
          bootApp();
        } else {
          logoutLocal();
          loginOverlay.style.display = 'flex';
        }
      }).catch(function() {
        logoutLocal();
        loginOverlay.style.display = 'flex';
      });
    } else {
      loginOverlay.style.display = 'flex';
    }
  })();

  // Periodic auto-backup every 2 minutes；保留层级由多时间节点策略控制
  setInterval(function() {
    localStorageBackup();
    try { fetch((BACKEND_URL || '') + '/api/backup', { method: 'POST', headers: { ...authHeaders() } }).catch(() => {}); } catch(e) {}
  }, 120000);
});
