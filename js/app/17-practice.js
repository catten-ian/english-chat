/* ============================================================
   AI 英语对话教练 — Practice / Writing / Translation 模块与内联标注
   由 js/app.js 拆分而来（原 6504-7344 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
// ---- 学习中心 · 复习与 Anki 子页 ----
/* 此前这里是 `el.innerHTML = ankiSidebar.innerHTML`——直接拷侧边栏的 DOM，
   导致主区域出现一份为窄侧栏设计的迷你面板，且侧栏未渲染时主区域就空白。
   现在自己取数、自己排版：本地统计（离线可用）+ Anki 牌组统计（连上才有）。 */
async function renderPracticeStats() {
  const el = document.getElementById('practiceStats');
  if (!el) return;

  // 1) 本地数据：不依赖 Anki，任何时候都能显示
  const weak = (typeof getAllWeakPoints === 'function') ? getAllWeakPoints() : [];
  const active = weak.filter(w => !w.archived);
  const archived = weak.filter(w => w.archived);
  const vocab = (typeof getVocab === 'function') ? getVocab() : [];
  const due = active.filter(w => {
    if (!w.last_quizzed) return true;   // 从没考过 → 待出题
    const days = (Date.now() - new Date(w.last_quizzed).getTime()) / 86400000;
    return days >= (w.interval || 1);
  });

  const localCards = [
    { icon: '🎯', label: '活跃薄弱点', value: active.length, sub: archived.length ? `已归档 ${archived.length}` : '尚无归档' },
    { icon: '⏰', label: '待复习薄弱点', value: due.length, sub: '按间隔估算' },
    { icon: '📚', label: '生词本', value: vocab.length, sub: '可一键推送' }
  ];

  el.innerHTML = '<div class="pm-cards">' + localCards.map(c => `
    <div class="pm-card">
      <div class="pm-card-label">${esc(c.icon)} ${esc(c.label)}</div>
      <div class="pm-card-value">${esc(String(c.value))}</div>
      <div class="pm-card-sub">${esc(c.sub)}</div>
    </div>`).join('') + '</div>' +
    '<div id="pmAnkiDeck" class="pm-deck"><div class="pm-deck-loading">⏳ 正在读取 Anki 牌组统计…</div></div>';

  renderPracticeAnkiDeck();
}

/* Anki 牌组统计（异步，失败/未连接给出可操作提示而不是一句「未连接」） */
async function renderPracticeAnkiDeck() {
  const box = document.getElementById('pmAnkiDeck');
  if (!box) return;

  // dev 版优先使用服务器网页 FSRS。初始化时可能尚未完成登录恢复，
  // 因此这里再尝试一次恢复；失败才继续走 AnkiConnect 兼容模式。
  if (typeof isNativeSchedulerMode === 'function' && !isNativeSchedulerMode() && typeof restoreNativeSchedulerMode === 'function') {
    try { await restoreNativeSchedulerMode(); } catch (_) {}
  }
  if (typeof isNativeSchedulerMode === 'function' && isNativeSchedulerMode()) {
    try {
      const response = await nativeSchedulerAllCards({ limit: 2000 });
      const cards = Array.isArray(response && response.data) ? response.data : [];
      const total = Number(response && (response.total ?? response.total_cards ?? response.count));
      const cardCount = Number.isFinite(total) && total >= 0 ? total : cards.length;
      const dueResponse = await nativeSchedulerDueCards({ limit: 2000 });
      const dueCards = Array.isArray(dueResponse && dueResponse.data) ? dueResponse.data : [];
      let schedulerLabel = '本地调度器';
      try {
        const healthResponse = await fetch(nativeSchedulerApiPath('/api/native-anki/health'), { headers: authHeaders() });
        if (healthResponse.ok) schedulerLabel = nativeSchedulerStorageLabel(await healthResponse.json());
      } catch (_) {}
      const today = cards.filter(card => {
        const value = card && (card.last_review || card.last_reviewed_at || card.last_review_at);
        if (!value) return false;
        const date = new Date(value);
        const now = new Date();
        return date.toDateString() === now.toDateString();
      }).length;
      const queueCounts = webReviewQueueCounts(dueCards);
      const newCount = queueCounts.new;
      const learnCount = queueCounts.learn;
      const reviewCount = queueCounts.review;
      box.innerHTML = `<div class="pm-deck-head">
        <span class="pm-deck-title">🗂️ 网页 FSRS</span>
        <span class="pm-deck-meta">共 ${cardCount} 张 · ${esc(schedulerLabel)}</span>
      </div>
      <div class="pm-chips">
        <span class="pm-chip due">📝 待复习 ${reviewCount}</span>
        <span class="pm-chip new">🆕 新卡 ${newCount}</span>
        <span class="pm-chip learn">📖 学习中 ${learnCount}</span>
      </div>`;
      return;
    } catch (e) {
      // 调度器暂时不可用时保留原有 AnkiConnect 兼容路径。
    }
  }
  let ver = null;
  try {
    ver = await ankiPostCall({ action: 'version', version: 6 }).then(d => d.result && d.result.result).catch(() => null);
  } catch (e) { ver = null; }

  if (!ver) {
    box.innerHTML = `<div class="pm-deck-off">
      <div class="pm-deck-off-title">📴 Anki 未连接</div>
      <div class="pm-deck-off-body">打开 Anki 桌面端（可最小化）并确认已安装 AnkiConnect 插件。
        期间产生的卡片会留在下方任务队列里，连上后点「立即推送」即可补发。</div>
      <button class="a-btn small" data-action="check-anki-connect">🔌 重新检测连接</button>
    </div>`;
    return;
  }

  const [stats, today, byDay] = await Promise.all([
    ankiPostCall({ action: 'getDeckStats', version: 6, params: { decks: [ankiWeakDeck()] } }).then(d => d.result && d.result.result).catch(() => null),
    ankiPostCall({ action: 'getNumCardsReviewedToday', version: 6 }).then(d => d.result && d.result.result).catch(() => 0),
    ankiPostCall({ action: 'getNumCardsReviewedByDay', version: 6 }).then(d => d.result && d.result.result).catch(() => [])
  ]);
  const d0 = (stats && Object.values(stats)[0]) || {};
  const reviewCount = d0.review_count || 0;
  const newCount = d0.new_count || 0;
  const learnCount = d0.learn_count || 0;
  const total = d0.total_in_deck || 0;
  const streak = parseInt(getSetting('ankiStreak', 0)) || 0;

  // 近 14 天复习柱状图
  let bars = '';
  if (Array.isArray(byDay) && byDay.length) {
    const recent = byDay.slice(-14);
    const max = Math.max(1, ...recent.map(d => d[1]));
    bars = '<div class="pm-bars">' + recent.map(d => {
      const parts = String(d[0] || '').split('-');
      const label = parts.length >= 3 ? `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}` : String(d[0]);
      const h = Math.max(3, Math.round(d[1] / max * 56));
      return `<div class="pm-bar" title="${esc(label)}: ${d[1]} 张"><div style="height:${h}px"></div><span>${esc(label)}</span></div>`;
    }).join('') + '</div>';
  }

  box.innerHTML = `<div class="pm-deck-head">
      <span class="pm-deck-title">🗂️ 薄弱点牌组</span>
      <span class="pm-deck-meta">共 ${total} 张 · 今日已复习 ${today || 0} 张 · 🔥 连续 ${streak} 天</span>
    </div>
    <div class="pm-chips">
      <span class="pm-chip due">📝 待复习 ${reviewCount}</span>
      <span class="pm-chip new">🆕 新卡 ${newCount}</span>
      <span class="pm-chip learn">📖 学习中 ${learnCount}</span>
    </div>
    ${bars}`;
}

// ---- Writing ----
function renderTopicSuggest() {
  const el = document.getElementById('wTopicSuggest');
  if (!el) return;
  el.innerHTML = WRITING_TOPICS.slice(0, 6).map(t => '<button data-action="pick-writing-topic" data-arg1="' + esc(t) + '">' + esc(t) + '</button>').join('');
}

function pickWritingTopic(topic) {
  document.getElementById('wTopicInput').value = topic;
  updateTopicDisplay(topic);
  document.getElementById('wText').focus();
}

let currentTopicImageDataUrl = null;

function updateTopicDisplay(topic) {
  const display = document.getElementById('wTopicDisplay');
  const textWrap = document.getElementById('wTopicTextWrap');
  const imgWrap = document.getElementById('wTopicImageWrap');
  const imgEl = document.getElementById('wTopicImage');
  const hasTopic = !!(topic && String(topic).trim());
  const hasImage = !!currentTopicImageDataUrl;
  if (display) display.style.display = (hasTopic || hasImage) ? 'flex' : 'none';
  if (textWrap) {
    if (hasTopic) textWrap.innerHTML = '✍️ ' + esc(topic);
    else textWrap.innerHTML = '';
  }
  if (imgWrap && imgEl) {
    if (hasImage) {
      imgEl.src = currentTopicImageDataUrl;
      imgWrap.style.display = 'inline-block';
    } else {
      imgWrap.style.display = 'none';
    }
  }
}

function handleTopicImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toastMsg('请选择图片文件'); return; }
  if (file.size > 5 * 1024 * 1024) { toastMsg('图片过大（>5MB），请压缩后重试'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    currentTopicImageDataUrl = e.target.result;
    updateTopicDisplay(document.getElementById('wTopicInput').value.trim());
    toastMsg('📷 图片已附加');
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function handleTopicImageDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toastMsg('请拖入图片文件'); return; }
  if (file.size > 5 * 1024 * 1024) { toastMsg('图片过大（>5MB）'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    currentTopicImageDataUrl = e.target.result;
    updateTopicDisplay(document.getElementById('wTopicInput').value.trim());
    toastMsg('📷 图片已附加');
  };
  reader.readAsDataURL(file);
}

function clearTopicImage() {
  currentTopicImageDataUrl = null;
  updateTopicDisplay(document.getElementById('wTopicInput').value.trim());
}

function startWriting() {
  const topic = document.getElementById('wTopicInput').value.trim();
  if (!topic && !currentTopicImageDataUrl) { toastMsg('请先输入或选择一个作文题目（可附加图片）'); return; }
  updateTopicDisplay(topic);
  document.getElementById('wText').focus();
  // 反馈已迁到右侧统一面板，旧的 #wFeedback 节点不存在，访问它会抛异常中断本函数
  updateWordCount();
}

function updateWordCount() {
  const text = document.getElementById('wText').value.trim();
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const el = document.getElementById('wWordCount');
  if (el) el.textContent = '📝 ' + words + ' words' + (words >= 80 ? ' ✅' : ' (建议至少 80 词)');
}

// ---- 练习反馈：规整卡片渲染辅助（与聊天反馈风格一致） ----
function pfHero(scoreText, label) {
  return '<div class="pf-hero"><div class="pf-hero-score">' + esc(scoreText || '') + '</div><div class="pf-hero-label">' + esc(label || '综合评分') + '</div></div>';
}
function pfSection(title, inner) {
  return '<div class="pf-section"><div class="pf-title">' + title + '</div>' + (inner || '') + '</div>';
}
function pfList(items, tone) {
  if (!items || !items.length) return '';
  return '<div class="pf-list">' + items.map(it => '<div class="pf-item ' + (tone || '') + ' md-content">' + renderMD(it) + '</div>').join('') + '</div>';
}
function pfText(text, tone) {
  return '<div class="pf-item ' + (tone || '') + ' md-content">' + renderMD(text || '') + '</div>';
}
function pfHighlight(text) {
  return '<div class="pf-highlight md-content">' + renderMD(text || '') + '</div>';
}
function pfCorr(list) {
  if (!list || !list.length) return '';
  return '<div class="corr-list">' + list.map((g, i) => {
    const rule = g.rule ? '<div class="corr-why md-content">' + renderMD(g.rule) + '</div>' : '';
    return '<div class="corr-card"><div class="corr-head"><span class="corr-num">' + (i + 1) + '</span><span class="corr-type">' + esc(g.type || 'grammar') + '</span></div>' +
      '<div class="corr-change"><span class="orig">' + esc(g.error || g.original || '') + '</span> → <span class="fixed">' + esc(g.correction || g.corrected || '') + '</span></div>' + rule + '</div>';
  }).join('') + '</div>';
}

/* ---------- 作答内联标注（直接覆盖在作答区上） ---------- */
const ANN_TEXTAREA = { w: 'wText', tr: 'trInput', ch: 'chDesc' };

function renderSegments(segments, prefix) {
  // segments: [{text, type: "correct"|"error"|"improve", note: "..."}]
  const overlay = document.getElementById(prefix + 'AnnOverlay');
  if (!segments || !segments.length || !overlay) return;
  const norm = segments.map(s => ({
    text: s.text || '',
    type: s.type === 'correct' ? 'correct' : s.type === 'error' ? 'error' : 'improve',
    note: s.note || ''
  }));
  overlay.dataset.segments = JSON.stringify(norm);
  const renderBody = () => norm.map(s => {
    const note = s.note ? esc(s.note) : '';
    return '<span class="ann-' + s.type + '"' + (note ? ' title="' + note + '"' : '') + '>' + esc(s.text) + '</span>';
  }).join('');
  overlay.innerHTML =
    '<div class="ann-head"><span>📊 内联标注</span>' +
    '<span class="ann-legend"><span><span class="ann-dot green"></span> 正确</span><span><span class="ann-dot red"></span> 错误</span><span><span class="ann-dot amber"></span> 可改进</span></span>' +
    '<button class="ann-edit-btn" data-action="ann-back-edit" data-arg1="' + prefix + '">✏️ 返回编辑</button></div>' +
    '<div class="ann-body">' + renderBody() + '</div>';
  overlay.classList.add('visible');
  const ta = document.getElementById(ANN_TEXTAREA[prefix]);
  if (ta) { ta.style.display = 'none'; }
  // 自动滚动到作答区
  const area = document.getElementById(prefix + 'AnswerArea');
  if (area) area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function annBackToEdit(prefix) {
  const overlay = document.getElementById(prefix + 'AnnOverlay');
  const ta = document.getElementById(ANN_TEXTAREA[prefix]);
  if (overlay) overlay.classList.remove('visible');
  if (ta) {
    ta.style.display = '';
    const len = (ta.value || '').length;
    ta.focus();
    ta.setSelectionRange(len, len);
  }
}

/* ---------- 内容驱动边缘留白 ---------- */
function updateAnswerPadding(ta) {
  if (!ta) return;
  const area = ta.closest('.answer-area') || ta.parentElement;
  const len = (ta.value || '').length;
  // 默认慷慨边缘留白，随内容增多逐步缩减
  const maxPad = 56, minPad = 16;
  // 使用平方根曲线：较短内容时留白多，长内容渐缩
  const pad = Math.max(minPad, Math.min(maxPad, maxPad - Math.sqrt(len) * 1.6));
  area.style.setProperty('--answer-pad', pad + 'px');
}

/* ---------- 作答字体设置 ---------- */
function applyAnswerFontSettings() {
  const size = getSetting('answerFontSize', 15);
  const family = getSetting('answerFontFamily', 'inherit');
  document.documentElement.style.setProperty('--answer-font-size', size + 'px');
  document.documentElement.style.setProperty('--answer-font-family', family);
}

// ---- 统一右侧边栏反馈 ----
function showModuleFeedback(mode, title, html, silent) {
  const section = document.getElementById('analysisSection');
  const content = document.getElementById('analysisContent');
  if (!content) return;
  const titles = { writing: '✍️ 作文评分', translation: '🌐 翻译评分', charade: '🎭 Charade 评分', cloze: '🧩 选词填空' };
  const badge = titles[mode] || '📊 评分';
  const headerExtra = mode ? '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc(badge) + (title ? ' · ' + esc(title) : '') + '</div>' : '';
  // 找到/创建标题元素（可能在 analysisSection 内或外）
  let h3 = section ? section.querySelector('h3') : null;
  if (!h3 && section) {
    h3 = document.createElement('h3');
    section.insertBefore(h3, section.firstChild);
  }
  if (h3) h3.innerHTML = '📊 反馈' + headerExtra;
  content.innerHTML = '<div class="empty" style="display:none"></div><div class="w-feedback">' + html + '</div>';
  content.style.fontSize = '13px';
  content.style.lineHeight = '1.7';
  // 切到反馈标签页
  switchRightTab('feedback');
  if (typeof sidePanel !== 'undefined' && sidePanel) {
    if (sidePanel.classList.contains('panel-collapsed')) setFeedbackPanelMode('expanded');
  }
  if (!silent) toastMsg('✅ ' + (titles[mode] || '反馈') + ' 已生成，查看右侧');
}

async function submitWriting() {
  const text = document.getElementById('wText').value.trim();
  if (!text || text.split(/\s+/).filter(Boolean).length < 20) { toastMsg('请至少写 20 个词再提交评分'); return; }
  const examType = document.getElementById('wExamType').value;
  const topic = document.getElementById('wTopicInput').value.trim();
  showModuleFeedback('writing', examType, '<div class="loading">⏳ AI 评分中...</div>');

  try {
    const prompt = 'You are an experienced English writing examiner for ' + examType + '. Evaluate the following essay on the topic "' + (topic || '(see attached image)') + '". Provide feedback in Chinese.\n\nReturn ONLY valid JSON:\n{\n  "score": "overall score out of 100 and brief grade (e.g. 72/100 — Pass)",\n  "strengths": ["2-3 strengths in Chinese"],\n  "weaknesses": ["2-3 weaknesses in Chinese"],\n  "grammar_issues": [{"error": "original error sentence", "correction": "corrected sentence", "rule": "grammar rule in Chinese"}],\n  "vocabulary": ["2-3 suggested vocabulary improvements in Chinese"],\n  "structure": "feedback on essay structure in Chinese",\n  "sample_sentence": "a rewritten version of one key sentence showing improvement",\n  "segments": [{"text": "part of the user\'s essay", "type": "correct|error|improve", "note": "Chinese explanation, especially for error/improve types"}]\n}\n\nImportant: The "segments" field must cover the ENTIRE user\'s essay, breaking it into consecutive parts. Each segment has: text (exact substring from user\'s essay), type (correct=正确, error=语法/用词错误, improve=表达不地道或可改进), and note (Chinese explanation of the issue or why it\'s good). Join all segments\' text in order to reconstruct the original essay exactly.';
    const userContent = currentTopicImageDataUrl
      ? [
          { type: 'text', text: (topic ? 'Topic: ' + topic + '\n\n' : '') + 'Essay:\n' + text },
          { type: 'image_url', image_url: { url: currentTopicImageDataUrl } }
        ]
      : text;
    const raw = await callAPI([
      { role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' },
      { role: 'user', content: userContent }
    ], { temperature: 0.4, maxTokens: 4000, vision: !!currentTopicImageDataUrl, reasoningEffort: 'max' });
    const obj = smartParseJSON(raw);
    if (obj) {
      let html = pfHero(obj.score, '综合评分');
      if (obj.strengths) html += pfSection('✅ 优点', pfList(obj.strengths, 'green'));
      if (obj.weaknesses) html += pfSection('🔧 需要改进', pfList(obj.weaknesses, 'amber'));
      if (obj.grammar_issues) html += pfSection('📝 语法问题', pfCorr(obj.grammar_issues));
      if (obj.vocabulary) html += pfSection('📖 词汇建议', pfList(obj.vocabulary));
      if (obj.structure) html += pfSection('📐 结构评价', pfText(obj.structure));
      if (obj.sample_sentence) html += pfSection('💡 示范句', pfHighlight(obj.sample_sentence));
      showModuleFeedback('writing', examType, html);
      // 作答内联标注
      if (obj.segments && obj.segments.length) renderSegments(obj.segments, 'w');
    } else {
      showModuleFeedback('writing', examType, '<div style="color:var(--red)">解析失败，请重试。原始响应：<pre>' + esc(raw.substring(0, 300)) + '</pre></div>');
    }
  } catch (e) {
    showModuleFeedback('writing', examType, '<span style="color:var(--red)">评分失败: ' + esc(e.message || '') + '</span>');
  }
}

function clearWriting() {
  document.getElementById('wTopicInput').value = '';
  document.getElementById('wText').value = '';
  currentTopicImageDataUrl = null;
  updateTopicDisplay('');
  updateWordCount();
  const ov = document.getElementById('wAnnOverlay');
  if (ov) ov.classList.remove('visible');
  const ta = document.getElementById('wText');
  if (ta) ta.style.display = '';
  clearAnswerDraft('writing');
}

// ---- Translation ----
function translateSource(src) {
  trSource = src;
  setSetting('trSource', src);
  document.getElementById('trBankBtn').classList.toggle('active', src === 'bank');
  document.getElementById('trAiBtn').classList.toggle('active', src === 'ai');
  const sel = document.getElementById('trCategorySelect');
  if (sel) sel.style.display = src === 'bank' ? '' : 'none';
  currentTranslation = null;
  nextTranslate();
}

function trPopulateCategories() {
  mergeShGaokaoBank();
  trReconcileStatsFromHistory();
  const sel = document.getElementById('trCategorySelect');
  if (!sel) return;
  // 用户自定义分类（已导入的）放在最前面
  const custom = getSetting('trCustomBank', null);
  let html = '<option value="all">🎲 全部混合</option>';
  if (custom && Array.isArray(custom) && custom.length) {
    html += '<option value="custom">📥 我的自定义题库 (' + custom.length + ')</option>';
  }
  for (const k of Object.keys(TRANSLATION_BANK)) {
    const count = trTranslationCategoryEntries(k).length;
    html += '<option value="' + esc(k) + '">' + esc(trTranslationCategoryLabel(k)) + ' (' + count + ')</option>';
  }
  sel.innerHTML = html;
  const savedCategory = sel.dataset.value || getSetting('trCategory', 'all');
  sel.dataset.value = savedCategory;
  sel.value = [...sel.options].some(o => o.value === savedCategory) ? savedCategory : 'all';
  const onlyNewEl = document.getElementById('trOnlyNew');
  if (onlyNewEl) onlyNewEl.checked = !!getSetting('trOnlyNew', false);
  trOnlyNew = !!getSetting('trOnlyNew', false);
  // 同步刷新右侧题库面板的分类下拉
  populateBankCategorySelect();
}

// 填充右侧题库面板的分类下拉（与翻译模块的题库同源）
function populateBankCategorySelect() {
  trReconcileStatsFromHistory();
  const sel = document.getElementById('bankCatSel');
  if (!sel) return;
  const mode = document.getElementById('bankModeSel');
  if (mode && mode.value !== 'translate') {
    sel.innerHTML = '<option value="">（切换到翻译题库）</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  let html = '';
  for (const k of Object.keys(TRANSLATION_BANK)) {
    const entries = trTranslationCategoryEntries(k);
    const cnt = entries.length;
    const answered = entries.filter(({ catKey, catIdx }) => !!trGetStat(catKey, catIdx)?.answered).length;
    html += '<option value="' + esc(k) + '">' + esc(trTranslationCategoryLabel(k)) + ' (' + answered + '/' + cnt + ')</option>';
  }
  const previous = sel.value || sel.dataset.value || 'all';
  sel.innerHTML = '<option value="all">🎲 全部混合</option>' + html;
  sel.dataset.value = [...sel.options].some(o => o.value === previous) ? previous : 'all';
  sel.value = sel.dataset.value;
}

function bankModeChanged() {
  const mode = document.getElementById('bankModeSel')?.value || 'translate';
  if (mode === 'translate') renderTrBankPanel(); else { populateBankCategorySelect(); renderGaokaoList(); }
}

// 右侧题库面板：列出所有题目，标记作答痕迹
function renderTrBankPanel() {
  mergeShGaokaoBank();
  trReconcileStatsFromHistory();
  populateBankCategorySelect();
  const modeEl = document.getElementById('bankModeSel');
  if (modeEl && modeEl.value !== 'translate') {
    // 让旧的 Gaokao 真题卷列表继续工作
    renderGaokaoList();
    return;
  }
  const catSel = document.getElementById('bankCatSel');
  const statusSel = document.getElementById('bankStatusSel');
  const scoreSort = document.getElementById('bankScoreSort')?.value || 'none';
  const search = (document.getElementById('bankSearch')?.value || '').toLowerCase().trim();
  const listEl = document.getElementById('gaokaoList');
  const detailEl = document.getElementById('gaokaoDetail');
  if (!listEl) return;
  if (detailEl) detailEl.style.display = 'none';
  if (listEl) listEl.style.display = 'block';

  const cat = (catSel && catSel.value) || 'all';
  // 收集题目（带 catKey 和 catIdx）
  const items = [];
  if (cat === 'all') {
    for (const k of Object.keys(TRANSLATION_BANK)) {
      TRANSLATION_BANK[k].items.forEach((it, i) => items.push({ catKey: k, catIdx: i, item: it }));
    }
  } else {
    const bank = TRANSLATION_BANK[cat];
    if (bank) bank.items.forEach((it, i) => items.push({ catKey: cat, catIdx: i, item: it }));
  }
  const uniqueItems = trUniqueTranslationEntries(items);

  const stats = getSetting('trQuestionStats', {});
  const statusFilter = (statusSel && statusSel.value) || 'all';

  // 过滤
  const filtered = uniqueItems.filter(({ catKey, catIdx, item }) => {
    if (search) {
      const inZh = (item.zh || '').toLowerCase().includes(search);
      const inRef = (item.ref || '').toLowerCase().includes(search);
      if (!inZh && !inRef) return false;
    }
    if (statusFilter !== 'all') {
      const s = trGetStat(catKey, catIdx);
      const answered = !!(s && s.answered);
      if (statusFilter === 'answered' && !answered) return false;
      if (statusFilter === 'unanswered' && answered) return false;
      const best = Number(s?.bestScore) || 0;
      if (statusFilter === 'best-9' && best < 9) return false;
      if (statusFilter === 'best-7' && best < 7) return false;
      if (statusFilter === 'best-5' && best < 5) return false;
      if (statusFilter === 'best-under-5' && (!answered || best >= 5)) return false;
    }
    return true;
  });

  if (scoreSort !== 'none') {
    filtered.sort((a, b) => {
      const aScore = Number(trGetStat(a.catKey, a.catIdx)?.bestScore) || 0;
      const bScore = Number(trGetStat(b.catKey, b.catIdx)?.bestScore) || 0;
      if (!aScore && bScore) return 1;
      if (aScore && !bScore) return -1;
      return scoreSort === 'best-asc' ? aScore - bScore : bScore - aScore;
    });
  }

  const total = uniqueItems.length;
  const answeredCount = uniqueItems.filter(({ catKey, catIdx }) => (Number(trGetStat(catKey, catIdx)?.answered) || 0) > 0).length;

  let html = '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 2px;font-size:11px;color:var(--text2)">' +
    '<span>共 ' + total + ' 题 · 已答 ' + answeredCount + '</span>' +
    '<span style="color:var(--primary)">点击题目 → 加载到主区</span>' +
    '</div>';

  if (!filtered.length) {
    html += '<div class="empty" style="padding:20px 0;text-align:center">无匹配结果</div>';
    listEl.innerHTML = html;
    return;
  }

  html += '<div>';
  for (const { catKey, catIdx, item } of filtered) {
    const s = trGetStat(catKey, catIdx);
    const answered = !!(s && Number(s.answered) > 0);
    const best = s ? (Number(s.bestScore) || 0) : 0;
    const last = s ? s.lastScore : 0;
    const lastTime = s && s.lastTime ? trTimeAgo(s.lastTime) : '';
    const scoreColor = last >= 8 ? 'var(--green)' : last >= 5 ? 'var(--amber)' : last > 0 ? 'var(--red)' : 'var(--text3)';
    const statusBadge = answered
      ? '<span style="display:inline-block;padding:1px 6px;border-radius:8px;background:' + scoreColor + ';color:#fff;font-size:10px;font-weight:700">最近 ' + last + '分</span>'
      : '<span style="display:inline-block;padding:1px 6px;border-radius:8px;background:var(--bg);color:var(--text3);font-size:10px;border:1px solid var(--border)">未答</span>';
    const catTag = '<span style="font-size:9px;color:var(--text3);margin-left:4px">' + esc((TRANSLATION_BANK[catKey] && TRANSLATION_BANK[catKey].label) || catKey) + '</span>';
    const zh = (item.zh || '').length > 60 ? (item.zh.substring(0, 60) + '…') : item.zh;
    html += '<div data-action="tr-select-question" data-arg1="' + esc(catKey) + '" data-arg2="' + catIdx + '" data-argc="2" class="tr-q-hover" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;background:#fff;line-height:1.6;transition:all .15s;position:relative">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<span style="font-weight:600;color:var(--text)">第 ' + (catIdx + 1) + ' 题</span>' +
        statusBadge +
      '</div>' +
      '<div style="color:var(--text)">' + esc(zh) + catTag + '</div>' +
      (answered ? '<div style="margin-top:4px;font-size:10px;color:var(--text3)">最佳 ' + best + ' 分 · ' + lastTime + '</div>' : '') +
    '</div>';
  }
  html += '</div>';
  listEl.innerHTML = html;
}

function trTimeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 86400000 * 7) return Math.floor(diff / 86400000) + ' 天前';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// 点击右侧题库中的题目：自动切到翻译模式 + 加载该题
function trSelectQuestion(catKey, catIdx) {
  // 切到翻译模式（如果在 Chat）
  if (currentMode !== 'translation') switchMode('translation');
  setTimeout(() => {
    trSource = 'bank';
    setSetting('trSource', 'bank');
    const btn = document.getElementById('trBankBtn');
    const aiBtn = document.getElementById('trAiBtn');
    if (btn) btn.classList.add('active');
    if (aiBtn) aiBtn.classList.remove('active');
    const sel = document.getElementById('trCategorySelect');
    if (sel) { sel.value = catKey; sel.dataset.value = catKey; setSetting('trCategory', catKey); }
    const bank = TRANSLATION_BANK[catKey];
    if (!bank || !bank.items[catIdx]) { toastMsg('题目不存在'); return; }
    const item = bank.items[catIdx];
    currentTranslation = { ...item, _catKey: catKey, _catIdx: catIdx };
    const qEl = document.getElementById('trQuestion');
    if (qEl) qEl.innerHTML = '📝 ' + esc(item.zh);
    // 加载该题的历史作答（如果有）
    const stat = trGetStat(catKey, catIdx);
    renderTrQuestionWords(item.words || [], (stat && stat.lastAnswer) || '');
    const inputEl = document.getElementById('trInput');
    if (inputEl) {
      inputEl.value = (stat && stat.lastAnswer) ? stat.lastAnswer : '';
      inputEl.focus();
    }
    // 显示进度
    updateTrQuestionProgress();
    // 切到反馈标签展示历史评分
    if (stat && stat.lastScore) {
      switchRightTab('feedback');
    }
    toastMsg('📌 已加载：' + ((TRANSLATION_BANK[catKey] && TRANSLATION_BANK[catKey].label) || catKey) + ' # ' + (catIdx + 1));
  }, 50);
}

// 更新翻译模块顶部"题目进度"显示（已答/未答 + 加载历史）
function updateTrQuestionProgress() {
  const el = document.getElementById('trQuestionProgress');
  if (!el) return;
  if (!currentTranslation || !currentTranslation._catKey) {
    el.innerHTML = '';
    return;
  }
  const catKey = currentTranslation._catKey;
  const catIdx = currentTranslation._catIdx;
  const stat = trGetStat(catKey, catIdx);
  const answered = stat ? stat.answered : 0;
  const best = stat ? stat.bestScore : 0;
  const catLabel = (TRANSLATION_BANK[catKey] && TRANSLATION_BANK[catKey].label) || catKey;
  el.innerHTML = '<div style="font-size:11px;color:var(--text2);padding:4px 0;display:flex;gap:10px;align-items:center">' +
    '<span>📚 ' + esc(catLabel) + ' · 第 ' + (catIdx + 1) + ' 题</span>' +
    (answered > 0 ? '<span style="color:var(--green)">已答 ' + answered + ' 次</span>' : '<span style="color:var(--text3)">未答</span>') +
    (best > 0 ? '<span style="color:var(--primary)">最佳 ' + best + ' 分</span>' : '') +
    '</div>';
}

function trCategoryChanged() {
  const sel = document.getElementById('trCategorySelect');
  if (sel) { sel.dataset.value = sel.value; setSetting('trCategory', sel.value); }
  currentTranslation = null;
  nextTranslate();
}

function trPickBankItem() {
  const sel = document.getElementById('trCategorySelect');
  const cat = (sel && sel.value) || 'all';
  const candidates = [];
  if (cat === 'custom') {
    const pool = getSetting('trCustomBank', []);
    if (!pool || !pool.length) { toastMsg('自定义题库为空，请先导入'); return null; }
    pool.forEach((item, idx) => candidates.push({ item, catKey: 'custom', catIdx: idx }));
  } else if (cat === 'all') {
    for (const k of Object.keys(TRANSLATION_BANK)) {
      (TRANSLATION_BANK[k].items || []).forEach((item, idx) => candidates.push({ item, catKey: k, catIdx: idx }));
    }
  } else {
    const pool = (TRANSLATION_BANK[cat] && TRANSLATION_BANK[cat].items) || [];
    pool.forEach((item, idx) => candidates.push({ item, catKey: cat, catIdx: idx }));
  }
  let pool = trUniqueTranslationEntries(candidates);
  if (trOnlyNew) pool = pool.filter(x => !trGetStat(x.catKey, x.catIdx)?.answered);
  if (!pool.length) { toastMsg(trOnlyNew ? '当前题库没有未答题，请关闭「只做新题」' : '所选题库为空'); return null; }
  return pool[Math.floor(Math.random() * pool.length)];
}

let translationBankRefreshScheduled = false;
function scheduleTranslationBankRefresh() {
  const tab = document.getElementById('tab-gaokao');
  if (!tab || tab.style.display === 'none' || translationBankRefreshScheduled) return;
  translationBankRefreshScheduled = true;
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : callback => setTimeout(callback, 0);
  schedule(() => {
    translationBankRefreshScheduled = false;
    const currentTab = document.getElementById('tab-gaokao');
    if (currentTab && currentTab.style.display !== 'none') renderTrBankPanel();
  });
}

function trUpdateQuestionStat(catKey, idx, rec) {
  if (!catKey || idx === undefined || idx === null) return;
  const stats = getSetting('trQuestionStats', {});
  const k = trStatKey(catKey, idx);
  if (!stats[k]) stats[k] = { answered: 0, bestScore: 0, lastScore: 0, lastAnswer: '', lastTime: 0, lastFeedback: '', lastZh: '' };
  const s = stats[k];
  const isSameSubmission = rec.submissionId && s.lastSubmissionId === rec.submissionId;
  if (rec.pending) { s.answered = Math.max(1, s.answered || 0); s._pending = true; }
  else {
    if (!s._pending && !isSameSubmission) s.answered = (s.answered || 0) + 1;
    s._pending = false;
    if (rec.submissionId) s.lastSubmissionId = rec.submissionId;
  }
  const sc = parseInt(String(rec.score || '').match(/\d+/)?.[0] || '0') || 0;
  if (sc > (s.bestScore || 0)) s.bestScore = sc;
  s.lastScore = sc;
  s.lastAnswer = rec.userAnswer || '';
  s.lastTime = rec.t || Date.now();
  s.lastFeedback = rec.feedback || '';
  s.lastZh = rec.question || '';
  setSetting('trQuestionStats', stats);
  // Keep the hidden question bank off the submit hot path and coalesce updates.
  if (typeof renderTrBankPanel === 'function') scheduleTranslationBankRefresh();
}

function importTrBank(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toastMsg('文件过大（>5MB）'); return; }
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const items = parseTrBankFile(data);
      if (!items || !items.length) { toastMsg('文件解析成功但无有效题目'); return; }
      setSetting('trCustomBank', items);
      trPopulateCategories();
      const sel = document.getElementById('trCategorySelect');
      if (sel) { sel.value = 'custom'; sel.dataset.value = 'custom'; }
      currentTranslation = null;
      nextTranslate();
      toastMsg('📥 已导入 ' + items.length + ' 题，可在「我的自定义题库」里选');
    } catch (err) {
      toastMsg('解析失败: ' + err.message);
    }
  };
  reader.onerror = function () { toastMsg('读取失败'); };
  reader.readAsText(file, 'utf-8');
  event.target.value = '';
}

function parseTrBankFile(data) {
  // 支持多种格式：
  // 1) ["句子1", "句子2", ...] —— 无参考答案
  // 2) [{zh:"...", ref:"..."}, ...]
  // 3) { items: [...] / questions: [...] / data: [...] }
  // 4) { gaokao: {label, items:[...]}, ... }
  let list = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) list = data.items;
    else if (Array.isArray(data.questions)) list = data.questions;
    else if (Array.isArray(data.data)) list = data.data;
    else {
      // 看看是不是 { gaokao: { items }, ... } 结构
      const flat = [];
      for (const k of Object.keys(data)) {
        const v = data[k];
        if (v && Array.isArray(v.items)) flat.push(...v.items);
      }
      list = flat;
    }
  }
  const out = [];
  for (const it of list) {
    if (typeof it === 'string') {
      const s = it.trim();
      if (s) out.push({ zh: s, ref: '' });
    } else if (it && typeof it === 'object') {
      const zh = (it.zh || it.cn || it.chinese || it.question || '').toString().trim();
      const ref = (it.ref || it.en || it.english || it.answer || '').toString().trim();
      if (zh) out.push({ zh, ref });
    }
  }
  return out;
}

function exportTrBank() {
  const sel = document.getElementById('trCategorySelect');
  const cat = (sel && sel.value) || 'all';
  let data, name;
  if (cat === 'custom') {
    const items = getSetting('trCustomBank', []);
    if (!items || !items.length) { toastMsg('自定义题库为空'); return; }
    data = { items };
    name = 'translation-custom.json';
  } else if (cat === 'all') {
    data = { ...TRANSLATION_BANK };
    name = 'translation-all.json';
  } else {
    const catData = TRANSLATION_BANK[cat];
    if (!catData) { toastMsg('未选题库'); return; }
    data = { [cat]: catData };
    name = 'translation-' + cat + '.json';
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toastMsg('💾 已导出 ' + name);
}

async function nextTranslate() {
  document.getElementById('trInput').value = '';
  currentTranslation = null;
  const qEl = document.getElementById('trQuestion');
  // 切题时收掉旧的标注层与草稿
  const ov = document.getElementById('trAnnOverlay');
  if (ov) ov.classList.remove('visible');
  const ta = document.getElementById('trInput');
  if (ta) { ta.style.display = ''; updateAnswerPadding(ta); }
  clearAnswerDraft('translation');

  if (trSource === 'bank') {
    const picked = trPickBankItem();
    if (!picked) {
      qEl.innerHTML = '⚠️ 请选择题库分类或导入自定义题库';
      renderTrQuestionWords(null);
      return;
    }
    const { item, catKey, catIdx } = picked;
    currentTranslation = { ...item, _catKey: catKey, _catIdx: catIdx };
    qEl.innerHTML = '📝 ' + esc(item.zh);
    renderTrQuestionWords(item.words || item.q_words || []);
    updateTrQuestionProgress();
  } else {
    qEl.innerHTML = '⏳ AI 生成题目中...';
    renderTrQuestionWords(null);
    try {
      const rule = getTranslationRuleVersion();
      const aiPrompt = 'You are a Chinese teacher. Generate a single Chinese sentence (10-30 words, suitable for intermediate learners) for translation practice.\n' +
        (rule === 'gaokao' ? 'Output a SINGLE Chinese sentence. Avoid multiple clauses / 分号 ; — the user must translate it into ONE English sentence.' : 'Output a natural Chinese sentence; the user may use 1-3 clauses in English.') +
        '\n\nIMPORTANT: include a "词" field with 1-2 required English words the user must use in the translation.\n' +
        'These words must be single content words (n./v./adj./adv.); avoid articles/prepositions/auxiliaries. Capitalize the first letter only if the user must use it at the start of the English sentence.\n\n' +
        'Return ONLY valid JSON (no markdown, no thinking):\n{\n  "zh": "the Chinese sentence",\n  "ref": "an exemplary English translation that uses all required words and obeys the sentence-count rule",\n  "words": ["word1", "word2"]\n}';
      const result = await streamAndParseJSON([
        { role: 'system', content: aiPrompt },
        { role: 'user', content: 'Generate a Chinese sentence + required words.' }
      ], { temperature: 0.7, maxTokens: null, thinking: { type: 'disabled' } }, obj =>
        typeof obj.zh === 'string' && !!obj.zh.trim()
      );
      const obj = result.obj;
      const sentence = (obj.zh || '').trim() || '请输入中文翻译。';
      const words = Array.isArray(obj.words) ? obj.words.map(s => String(s).trim()).filter(Boolean) : [];
      currentTranslation = { zh: sentence, ref: obj.ref || '', words: words };
      qEl.innerHTML = '🤖 ' + esc(sentence);
      renderTrQuestionWords(words);
    } catch (e) {
      qEl.innerHTML = '⚠️ 出题失败: ' + esc(e.message);
    }
  }
}

function buildTranslationFeedbackHtml(submission, obj, errorText) {
  let html = '';
  if (errorText) return '<span style="color:var(--red)">评分失败: ' + esc(errorText) + '</span><div style="margin-top:10px"><button class="dict-btn" data-action="retry-tr-grade" data-arg1="' + esc(submission.id) + '">↻ 重试评分</button></div>';
  html += pfHero(obj && obj.score, '翻译评分');
  if (obj && obj.errors) html += pfSection('🔧 改进建议', pfList(obj.errors, 'amber'));
  if (obj && obj.better_translation) html += pfSection('🤖 AI译文', pfHighlight(obj.better_translation));
  if (submission.ref) html += pfSection('📚 参考答案', pfHighlight(submission.ref));
  const used = checkRequiredWordsUsed(submission.userAnswer, submission.words || []);
  if (used.missing.length) html += pfSection('🔑 必用词（未使用）', pfList(used.missing.map(w => '缺少：' + w + '（或未变式）'), 'red'));
  if (used.capitalViolations.length) html += pfSection('🔠 大写位置错误', pfList(used.capitalViolations.map(w => w + ' 应在句首'), 'red'));
  if (!obj) html += '<div class="pf-item red" style="margin-top:10px">⚠️ 解析失败，请重试</div><div style="margin-top:10px"><button class="dict-btn" data-action="retry-tr-grade" data-arg1="' + esc(submission.id) + '">↻ 重试评分</button></div>';
  return html;
}

function renderTranslationFeedbackPager() {
  if (!trFeedbackItems.length) return;
  trFeedbackPage = Math.max(0, Math.min(trFeedbackPage, trFeedbackItems.length - 1));
  const item = trFeedbackItems[trFeedbackPage];
  const nav = '<div class="tr-feedback-nav" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">' +
    '<button class="dict-btn" data-action="tr-feedback-prev" ' + (trFeedbackPage === 0 ? 'disabled' : '') + '>← 上一题</button>' +
    '<span style="font-size:11px;color:var(--text2)">第 ' + (trFeedbackPage + 1) + ' / ' + trFeedbackItems.length + ' 题 · ' + (item.status === 'pending' ? '评分中' : item.status === 'error' ? '失败' : '已完成') + '</span>' +
    '<button class="dict-btn" data-action="tr-feedback-next" ' + (trFeedbackPage === trFeedbackItems.length - 1 ? 'disabled' : '') + '>下一题 →</button></div>';
    const body = item.status === 'pending' ? '<div class="loading">' + esc(item.progress || '⏳ AI 正在评分，你可以继续做下一题…') + '</div>' + (item.html || '') : (item.html || '<div class="empty">暂无反馈</div>');
  showModuleFeedback('translation', item.title, nav + '<div class="pf-section"><div class="pf-title">📝 题目</div><div class="pf-highlight md-content">' + renderMD(item.question) + '</div><div class="pf-title" style="margin-top:8px">✍️ 你的答案</div><div class="pf-highlight md-content">' + renderMD(item.userAnswer) + '</div></div>' + body, true);
}


const trSubmittedAnswers = new WeakMap();

function claimTranslationSubmission(question, answer) {
  if (!question || typeof question !== 'object') return true;
  const fingerprint = String(answer || '').trim();
  if (trSubmittedAnswers.get(question) === fingerprint) return false;
  trSubmittedAnswers.set(question, fingerprint);
  return true;
}


function submitTranslate() {
  const inputEl = document.getElementById('trInput');
  const input = inputEl && inputEl.value.trim();
  if (!input) { toastMsg('请先输入翻译'); return; }
  if (!currentTranslation) { toastMsg('请先点击「下一题」'); return; }
  const q = currentTranslation;
  if (!claimTranslationSubmission(q, input)) { toastMsg('这份答案已提交，评分正在进行中'); return; }
  const submission = { id: 'tr-submit-' + (++trSubmissionSeq), question: q.zh, ref: q.ref || '', userAnswer: input, words: [...(q.words || q.q_words || [])], catKey: q._catKey || null, catIdx: q._catIdx ?? null, ruleVersion: getTranslationRuleVersion(), title: q.zh.substring(0, 20) + '...', status: 'pending', submittedAt: Date.now(), html: '' };
  trFeedbackItems.push(submission); trFeedbackPage = trFeedbackItems.length - 1;
  renderTranslationFeedbackPager();
  // Let the pending feedback paint before local persistence and history serialization.
  const afterPaint = () => {
    trUpdateQuestionStat(submission.catKey, submission.catIdx, { submissionId: submission.id, question: submission.question, userAnswer: input, score: 'pending', feedback: '', t: submission.submittedAt, pending: true });
    // Start grading before generating an AI question so the two requests do not compete for first byte.
    gradeTranslationSubmission(submission).catch(() => {});
    setTimeout(() => nextTranslate(), 0);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(afterPaint);
  else setTimeout(afterPaint, 0);
}

function showTranslateAnswer() {
  if (!currentTranslation) return;
  const title = currentTranslation.zh.substring(0, 20) + '...';
  // 保存查看参考答案的记录
  saveTranslationRecord({
    question: currentTranslation.zh,
    ref: currentTranslation.ref,
    userAnswer: '(查看参考答案)',
    score: 'N/A',
    feedback: null,
    action: 'show_answer',
    t: Date.now()
  });
  renderTranslateHistory();
  showModuleFeedback('translation', title, '<div class="pf-section"><div class="pf-title">📚 参考答案</div><div class="pf-highlight md-content">' + renderMD(currentTranslation.ref || '(AI 出题无参考答案)') + '</div></div>');
}


