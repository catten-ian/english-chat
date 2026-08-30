/* ============================================================
   AI 英语对话教练 — 首页与六大模块切换、作答草稿
   由 js/app.js 拆分而来（原 5622-5800 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
// ---- 状态 ----
let currentMode = 'chat'; // chat | reading | practice | writing | translation | charade
let trSource = 'bank';    // bank | ai
let chSource = 'bank';    // bank | ai
let currentTranslation = null;
let trHistoryExpanded = false;

// ---- 首页 / 模式切换 ----
function showHome() {
  if (typeof AudioManager !== 'undefined') AudioManager.stopSpeech();
  localStorage.setItem('ai_en_mode', 'home');
  document.getElementById('homePage').style.display = 'flex';
  document.getElementById('sidePanel').style.display = '';
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mainArea').querySelectorAll('.module-area, .chat-area').forEach(el => el.style.display = 'none');
  document.getElementById('newConvBtn').style.display = '';
  document.getElementById('difficultyCtl').style.display = '';
  document.getElementById('homeUser').textContent = currentUser() || '';
}

let currentGameTab = 'charade';
// 在 Game 中心内切换子游戏（Charade / Cloze / Wordle）
function switchGameTab(game) {
  if (!['charade', 'cloze', 'wordle'].includes(game)) game = 'charade';
  currentGameTab = game;
  localStorage.setItem('ai_en_game_tab', game);
  const tabs = document.querySelectorAll('.game-tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.game === game));
  ['charade', 'cloze', 'wordle'].forEach(g => {
    const el = document.getElementById(g + 'Area');
    if (el) el.style.display = g === game ? 'flex' : 'none';
  });
  if (game === 'charade' && !chState) charadeNext();
  if (game === 'cloze' && !clState) clozeNext();
  if (game === 'wordle' && !wlState) wlGenerate();
}

function switchMode(mode, force) {
  if (currentMode === mode && !force) return;
  // 自动保存当前模式的作答草稿（不弹窗）
  if (currentMode === 'writing') saveAnswerDraft('writing');
  else if (currentMode === 'translation') saveAnswerDraft('translation');
  else if (currentMode === 'charade' || (currentMode === 'game' && currentGameTab === 'charade')) saveAnswerDraft('charade');
  currentMode = mode;
  localStorage.setItem('ai_en_mode', mode);
  // 切换模块时停止正在播放的朗读（TTS），并恢复被压低的背景音乐
  if (typeof AudioManager !== 'undefined') AudioManager.stopSpeech();
  if (mode === 'game') localStorage.setItem('ai_en_game_tab', currentGameTab || 'charade');
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('sidePanel').style.display = '';
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (typeof closeDrawers === 'function') closeDrawers();
  if (typeof closeMobileMore === 'function') closeMobileMore();
  document.getElementById('mainArea').querySelectorAll('.module-area, .chat-area').forEach(el => el.style.display = 'none');
  const areaId = mode === 'translation' ? 'translateArea' : mode === 'game' ? 'gameArea' : mode + 'Area';
  const area = document.getElementById(areaId);
  if (area) { area.style.display = 'flex'; }

  // 控制仅 Chat 模式显示的元素
  document.getElementById('newConvBtn').style.display = mode === 'chat' ? '' : 'none';
  document.getElementById('difficultyCtl').style.display = mode === 'chat' ? '' : 'none';

  // 模块初始化
  if (mode === 'practice') { renderPracticeStats(); }
  if (mode === 'progress') { renderProgressDashboard(); if (typeof renderCostCenter === 'function') renderCostCenter(); }
  if (mode === 'writing') { renderTopicSuggest(); }
  if (mode === 'translation' && !currentTranslation) { nextTranslate(); }
  if (mode === 'translation') { renderTranslateHistory(); trPopulateCategories(); }
  if (mode === 'game') { switchGameTab(currentGameTab || 'charade'); }
  if (mode === 'reading') { ensureReadingLoaded(); }

  // 恢复该模式的作答草稿（含已评分的标注状态）
  if (mode === 'writing') restoreAnswerDraft('writing');
  else if (mode === 'translation') restoreAnswerDraft('translation');
  else if (mode === 'charade' || (mode === 'game' && currentGameTab === 'charade')) restoreAnswerDraft('charade');

  // 右侧反馈面板按模式重置，避免残留上一个模式的内容
  resetAnalysisForMode(mode);
}

function hasUnsavedDraft() {
  try {
    if (currentMode === 'writing') {
      const v = document.getElementById('wText').value || '';
      const overlay = document.getElementById('wAnnOverlay');
      const graded = overlay && overlay.classList.contains('visible');
      return v.trim().length > 0 && !graded;
    }
    if (currentMode === 'translation') {
      const v = document.getElementById('trInput').value || '';
      const overlay = document.getElementById('trAnnOverlay');
      const graded = overlay && overlay.classList.contains('visible');
      return v.trim().length > 0 && !graded;
    }
    if (currentMode === 'charade' || (currentMode === 'game' && currentGameTab === 'charade')) {
      const v = document.getElementById('chDesc').value || '';
      return v.trim().length > 0;
    }
  } catch (e) {}
  return false;
}

/* ---------- 作答草稿自动保存 / 恢复 ---------- */
const DRAFT_KEYS = { writing: 'ai_en_draft_writing', translation: 'ai_en_draft_translation', charade: 'ai_en_draft_charade' };

function saveAnswerDraft(mode) {
  const key = DRAFT_KEYS[mode];
  if (!key) return;
  let data = null;
  if (mode === 'writing') {
    const text = document.getElementById('wText')?.value || '';
    const topic = document.getElementById('wTopicInput')?.value || '';
    const overlay = document.getElementById('wAnnOverlay');
    const segments = (overlay && overlay.classList.contains('visible') && overlay.dataset.segments) ? overlay.dataset.segments : null;
    if (text && text.trim()) data = { text, topic, segments };
  } else if (mode === 'translation') {
    const text = document.getElementById('trInput')?.value || '';
    const overlay = document.getElementById('trAnnOverlay');
    const segments = (overlay && overlay.classList.contains('visible') && overlay.dataset.segments) ? overlay.dataset.segments : null;
    if (text && text.trim()) data = { text, segments };
  } else if (mode === 'charade') {
    const text = document.getElementById('chDesc')?.value || '';
    if (text && text.trim()) data = { text };
  }
  try {
    if (data) localStorage.setItem(key, JSON.stringify(data));
    else localStorage.removeItem(key);
  } catch (e) {}
}

function restoreAnswerDraft(mode) {
  let raw = null;
  try { raw = localStorage.getItem(DRAFT_KEYS[mode]); } catch (e) {}
  if (!raw) return;
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { return; }
  if (mode === 'writing') {
    const ta = document.getElementById('wText');
    const tp = document.getElementById('wTopicInput');
    if (d.topic && tp) tp.value = d.topic;
    if (ta) {
      if (d.text) ta.value = d.text;
      updateAnswerPadding(ta);
      updateWordCount();
    }
    updateTopicDisplay(d.topic || '');
    if (d.segments) { try { renderSegments(JSON.parse(d.segments), 'w'); } catch (e) {} }
  } else if (mode === 'translation') {
    const ta = document.getElementById('trInput');
    if (ta) {
      if (d.text) ta.value = d.text;
      updateAnswerPadding(ta);
    }
    if (d.segments) { try { renderSegments(JSON.parse(d.segments), 'tr'); } catch (e) {} }
  } else if (mode === 'charade') {
    const ta = document.getElementById('chDesc');
    if (ta && d.text) ta.value = d.text;
  }
}

function clearAnswerDraft(mode) {
  try { localStorage.removeItem(DRAFT_KEYS[mode]); } catch (e) {}
}

/* ---------- 右侧反馈面板：按模式重置（避免残留上一模式内容） ---------- */
function resetAnalysisForMode(mode) {
  const content = document.getElementById('analysisContent');
  const section = document.getElementById('analysisSection');
  if (!content) return;
  const h3 = section ? section.querySelector('h3') : null;
  if (h3) h3.remove();
  const placeholders = {
    chat: '开始对话后，这里会显示你的回答评分与改进建议',
    writing: '提交作文后，这里会显示评分反馈与作答内联标注',
    translation: '提交翻译后，这里会显示评分反馈与作答内联标注',
    game: '游戏过程中，这里会显示评分反馈',
    reading: '阅读模式下，可使用「🔤 词典翻译」划词查询',
    practice: '复习模式：查看薄弱点与卡片统计',
    progress: '📊 学习者模型仪表盘在主区域，这里不展示内容'
  };
  content.innerHTML = '<div class="empty" style="padding:24px 0">' + esc(placeholders[mode] || '') + '</div>';
  content.style.fontSize = '';
  content.style.lineHeight = '';
  switchRightTab('feedback');
}
