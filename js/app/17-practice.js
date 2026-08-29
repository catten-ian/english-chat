/* ============================================================
   AI 英语对话教练 — Practice / Writing / Translation 模块与内联标注
   由 js/app.js 拆分而来（原 6504-7344 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
// ---- Practice ----
function renderPracticeStats() {
  const el = document.getElementById('practiceStats');
  if (!el) return;
  const ankiSidebar = document.getElementById('ankiSidebar');
  el.innerHTML = ankiSidebar ? ankiSidebar.innerHTML : '<div style="color:var(--text2)">No Anki data available. Start chatting to build weak points.</div>';
  // 追加复习按钮
  el.innerHTML += '<div style="margin-top:12px;display:flex;gap:8px">' +
    '<button class="send-btn" data-action="start-web-review" style="padding:8px 20px;font-size:14px">✅ 开始网页复习</button>' +
    '<button class="toggle-btn" data-action="toggle-anki" style="font-size:13px">📚 切换自动添加</button></div>';
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
  const textWrap = document.getElementById('wTopicTextWrap');
  const imgWrap = document.getElementById('wTopicImageWrap');
  const imgEl = document.getElementById('wTopicImage');
  if (textWrap) {
    if (topic) textWrap.innerHTML = '✍️ ' + esc(topic);
    else textWrap.innerHTML = '<span style="color:var(--text2);font-weight:500;font-size:15px">📝 选择或输入一个作文题目，开始写作</span>';
  }
  if (imgWrap && imgEl) {
    if (currentTopicImageDataUrl) {
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
function showModuleFeedback(mode, title, html) {
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
  toastMsg('✅ ' + (titles[mode] || '反馈') + ' 已生成，查看右侧');
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
    ], { temperature: 0.4, maxTokens: 4000 });
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
  document.getElementById('trBankBtn').classList.toggle('active', src === 'bank');
  document.getElementById('trAiBtn').classList.toggle('active', src === 'ai');
  const sel = document.getElementById('trCategorySelect');
  if (sel) sel.style.display = src === 'bank' ? '' : 'none';
  currentTranslation = null;
  nextTranslate();
}

function trPopulateCategories() {
  mergeShGaokaoBank();
  const sel = document.getElementById('trCategorySelect');
  if (!sel) return;
  // 用户自定义分类（已导入的）放在最前面
  const custom = getSetting('trCustomBank', null);
  let html = '<option value="all">🎲 全部混合</option>';
  if (custom && Array.isArray(custom) && custom.length) {
    html += '<option value="custom">📥 我的自定义题库 (' + custom.length + ')</option>';
  }
  for (const k of Object.keys(TRANSLATION_BANK)) {
    html += '<option value="' + esc(k) + '">' + esc(TRANSLATION_BANK[k].label) + ' (' + TRANSLATION_BANK[k].items.length + ')</option>';
  }
  sel.innerHTML = html;
  if (!sel.dataset.value) sel.dataset.value = 'all';
  sel.value = sel.dataset.value;
  // 同步刷新右侧题库面板的分类下拉
  populateBankCategorySelect();
}

// 填充右侧题库面板的分类下拉（与翻译模块的题库同源）
function populateBankCategorySelect() {
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
    const cnt = TRANSLATION_BANK[k].items.length;
    const answered = Object.keys(getSetting('trQuestionStats', {})).filter(x => x.startsWith(k + ':')).length;
    html += '<option value="' + esc(k) + '">' + esc(TRANSLATION_BANK[k].label) + ' (' + answered + '/' + cnt + ')</option>';
  }
  sel.innerHTML = html;
  if (!sel.dataset.value) sel.dataset.value = 'all';
  if (![...sel.options].some(o => o.value === sel.value)) sel.value = 'all';
}

// 右侧题库面板：列出所有题目，标记作答痕迹
function renderTrBankPanel() {
  mergeShGaokaoBank();
  populateBankCategorySelect();
  const modeEl = document.getElementById('bankModeSel');
  if (modeEl && modeEl.value !== 'translate') {
    // 让旧的 Gaokao 真题卷列表继续工作
    renderGaokaoList();
    return;
  }
  const catSel = document.getElementById('bankCatSel');
  const statusSel = document.getElementById('bankStatusSel');
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

  const stats = getSetting('trQuestionStats', {});
  const statusFilter = (statusSel && statusSel.value) || 'all';

  // 过滤
  const filtered = items.filter(({ catKey, catIdx, item }) => {
    if (search) {
      const inZh = (item.zh || '').toLowerCase().includes(search);
      const inRef = (item.ref || '').toLowerCase().includes(search);
      if (!inZh && !inRef) return false;
    }
    if (statusFilter !== 'all') {
      const s = stats[trStatKey(catKey, catIdx)];
      const answered = !!(s && s.answered);
      if (statusFilter === 'answered' && !answered) return false;
      if (statusFilter === 'unanswered' && answered) return false;
    }
    return true;
  });

  const total = items.length;
  const answeredCount = items.filter(({ catKey, catIdx }) => stats[trStatKey(catKey, catIdx)]).length;

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
    const s = stats[trStatKey(catKey, catIdx)];
    const answered = !!(s && s.answered);
    const best = s ? s.bestScore : 0;
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
    const btn = document.getElementById('trBankBtn');
    const aiBtn = document.getElementById('trAiBtn');
    if (btn) btn.classList.add('active');
    if (aiBtn) aiBtn.classList.remove('active');
    const sel = document.getElementById('trCategorySelect');
    if (sel) { sel.value = catKey; sel.dataset.value = catKey; }
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
  if (sel) sel.dataset.value = sel.value;
  currentTranslation = null;
  nextTranslate();
}

function trPickBankItem() {
  const sel = document.getElementById('trCategorySelect');
  const cat = (sel && sel.value) || 'all';
  let pool, poolKey;
  if (cat === 'custom') {
    pool = getSetting('trCustomBank', []);
    poolKey = 'custom';
    if (!pool || !pool.length) { toastMsg('自定义题库为空，请先导入'); return null; }
  } else if (cat === 'all') {
    pool = flattenTrBank();
    poolKey = 'all';
  } else {
    pool = (TRANSLATION_BANK[cat] && TRANSLATION_BANK[cat].items) || [];
    poolKey = cat;
  }
  if (!pool.length) { toastMsg('所选题库为空'); return null; }
  const idx = Math.floor(Math.random() * pool.length);
  return { item: pool[idx], catKey: poolKey, catIdx: idx, pool: pool };
}

// 题目统计缓存：{ "<catKey>:<idx>": { answered, bestScore, lastScore, lastAnswer, lastTime, lastFeedback } }
function trStatKey(catKey, idx) { return catKey + ':' + idx; }
function trUpdateQuestionStat(catKey, idx, rec) {
  if (!catKey || idx === undefined || idx === null) return;
  const stats = getSetting('trQuestionStats', {});
  const k = trStatKey(catKey, idx);
  if (!stats[k]) stats[k] = { answered: 0, bestScore: 0, lastScore: 0, lastAnswer: '', lastTime: 0, lastFeedback: '', lastZh: '' };
  const s = stats[k];
  s.answered = (s.answered || 0) + 1;
  const sc = parseInt(String(rec.score || '').match(/\d+/)?.[0] || '0') || 0;
  if (sc > (s.bestScore || 0)) s.bestScore = sc;
  s.lastScore = sc;
  s.lastAnswer = rec.userAnswer || '';
  s.lastTime = rec.t || Date.now();
  s.lastFeedback = rec.feedback || '';
  s.lastZh = rec.question || '';
  setSetting('trQuestionStats', stats);
  // 触发题库面板刷新
  if (typeof renderTrBankPanel === 'function') renderTrBankPanel();
}
function trGetStat(catKey, idx) {
  const stats = getSetting('trQuestionStats', {});
  return stats[trStatKey(catKey, idx)] || null;
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
      const raw = await callAPI([
        { role: 'system', content: aiPrompt },
        { role: 'user', content: 'Generate a Chinese sentence + required words.' }
      ], { temperature: 0.7, maxTokens: 400, thinking: { type: 'disabled' } });
      const obj = smartParseJSON(stripThinking(raw)) || {};
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

/* 渲染必用词 chips；userAnswer 可选（用于高亮已使用/未使用的词）
   匹配逻辑复用 13-banks.js 的 requiredWordUsed / capitalRequirementMet，
   与提交后的评分保持一致（此前 chips 自己做简单小写全等匹配，
   defers / stopped / in case 这类会被误标为「尚未使用」）。 */
function renderTrQuestionWords(words, usedText) {
  const el = document.getElementById('trQuestionWords');
  if (!el) return;
  if (!words || !words.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML = '<span style="font-size:11px;color:var(--text2)">🔑 必用词</span>' +
    words.map(w => {
      const isUsed = !!usedText && requiredWordUsed(usedText, w);
      // 词性标注（'gaze v.'）不参与句首大写判断
      const capitalizeHint = /^[A-Z]/.test(stripPosTag(w));
      const capitalBad = isUsed && capitalizeHint && !capitalRequirementMet(usedText, w);
      const label = (capitalizeHint ? 'ⓘ ' : '') + esc(w);
      let bg = '#fef3c7', bd = '#fde68a', fg = '#92400e';
      let title = capitalizeHint ? '首字母大写：建议在开头使用' : '尚未使用';
      if (capitalBad) {
        bg = '#fee2e2'; bd = '#fecaca'; fg = '#991b1b';
        title = '已使用，但应放在句首';
      } else if (isUsed) {
        bg = '#dcfce7'; bd = '#86efac'; fg = '#065f46';
        title = '已使用';
      }
      return '<span title="' + title + '" style="padding:2px 8px;border-radius:10px;background:' + bg + ';color:' + fg + ';border:1px solid ' + bd + ';font-weight:600">' + label + '</span>';
    }).join('');
}

async function submitTranslate() {
  const input = document.getElementById('trInput').value.trim();
if (!input) { toastMsg('请先输入翻译'); return; }
  if (!currentTranslation) { toastMsg('请先点击「下一题」'); return; }
  const title = currentTranslation.zh.substring(0, 20) + '...';
  const question = currentTranslation.zh;
  const ref = currentTranslation.ref;
  showModuleFeedback('translation', title, '<div class="loading">⏳ 评分中...</div>');

  try {
    const prompt = buildTranslationEvalPrompt({ zh: question, ref, user: input, words: currentTranslation.words || currentTranslation.q_words || [], ruleVersion: getTranslationRuleVersion() });
    const raw = await callAPI([
      { role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' },
      { role: 'user', content: 'Chinese: ' + question + '\nUser\'s translation: ' + input + (ref ? '\nReference: ' + ref : '') + ((currentTranslation.words || []).length ? '\nRequired words (must appear): ' + currentTranslation.words.join(', ') : '') }
    ], { temperature: 0.3, maxTokens: 2000 });
    const obj = smartParseJSON(raw);
    let html = pfHero(obj && obj.score, '翻译评分');
    if (obj && obj.errors) html += pfSection('🔧 改进建议', pfList(obj.errors, 'amber'));
    if (obj && obj.better_translation) html += pfSection('🤖 AI译文', pfHighlight(obj.better_translation));
    if (ref) html += pfSection('📚 参考答案', pfHighlight(ref));
    // 必用词达成度
    const used = checkRequiredWordsUsed(input, currentTranslation.words || currentTranslation.q_words || []);
    if (used.missing && used.missing.length) {
      html += pfSection('🔑 必用词（未使用）', pfList(used.missing.map(w => '缺少：' + w + '（或未变式）'), 'red'));
    }
    if (used.capitalViolations && used.capitalViolations.length) {
      html += pfSection('🔠 大写位置错误', pfList(used.capitalViolations.map(w => w + ' 应在句首'), 'red'));
    }
    if (!obj) html += '<div class="pf-item red" style="margin-top:10px">⚠️ 解析失败，请重试</div>';
    showModuleFeedback('translation', title, html);
    // 作答内联标注
    if (obj && obj.segments && obj.segments.length) renderSegments(obj.segments, 'tr');

    // 保存作答记录
    saveTranslationRecord({
      question, ref,
      userAnswer: input,
      score: (obj && obj.score) || '未评分',
      feedback: (obj && obj.errors && obj.errors.length) ? obj.errors.join(' · ') : (obj && obj.better_translation ? obj.better_translation : ''),
      action: 'submit',
      t: Date.now(),
      catKey: currentTranslation._catKey || null,
      catIdx: (currentTranslation._catIdx !== undefined ? currentTranslation._catIdx : null)
    });
    trUpdateQuestionStat(currentTranslation._catKey, currentTranslation._catIdx, {
      question, userAnswer: input, score: (obj && obj.score) || '未评分', feedback: (obj && obj.errors && obj.errors.length) ? obj.errors.join(' · ') : '', t: Date.now()
    });
    updateTrQuestionProgress();
    renderTranslateHistory();
  } catch (e) {
    showModuleFeedback('translation', title, '<span style="color:var(--red)">评分失败: ' + esc(e.message || '') + '</span>');
    // 即使失败也记录
    saveTranslationRecord({
      question, ref,
      userAnswer: input,
      score: '错误',
      feedback: e.message || '',
      action: 'submit',
      t: Date.now(),
      catKey: currentTranslation._catKey || null,
      catIdx: (currentTranslation._catIdx !== undefined ? currentTranslation._catIdx : null)
    });
    trUpdateQuestionStat(currentTranslation._catKey, currentTranslation._catIdx, {
      question, userAnswer: input, score: '0', feedback: e.message || '', t: Date.now()
    });
    updateTrQuestionProgress();
    renderTranslateHistory();
  }
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

// ---- 翻译历史记录 ----
function saveTranslationRecord(rec) {
  if (!rec || !rec.question) return;
  let list = getSetting('trHistory', []);
  list.unshift(rec);
  if (list.length > 100) list = list.slice(0, 100);
  setSetting('trHistory', list);
}

function renderTranslateHistory() {
  const list = getSetting('trHistory', []);
  const countEl = document.getElementById('trHistCount');
  if (countEl) countEl.textContent = '(' + list.length + ')';
  const wrap = document.getElementById('trHistoryList');
  if (!wrap) return;
  wrap.style.display = trHistoryExpanded ? 'block' : 'none';
  if (!list.length) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--text2);text-align:center;padding:12px">暂无作答记录</div>';
    return;
  }
  wrap.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:11px;color:var(--text2)">' +
    '<span>📋 最近 ' + list.length + ' 条</span>' +
    '<span data-action="clear-tr-history" style="cursor:pointer;color:var(--text3)" title="清空所有记录">🗑️ 清空</span></div>' +
    list.map((r, i) => {
    const tm = new Date(r.t || Date.now());
    const dateStr = (tm.getMonth() + 1) + '-' + tm.getDate() + ' ' + String(tm.getHours()).padStart(2, '0') + ':' + String(tm.getMinutes()).padStart(2, '0');
    const scoreColor = (r.score || '').startsWith('9') || (r.score || '').startsWith('10') ? 'var(--green)'
      : (r.score || '').startsWith('7') || (r.score || '').startsWith('8') ? 'var(--primary)'
      : (r.score || '').startsWith('5') || (r.score || '').startsWith('6') ? 'var(--amber)'
      : 'var(--red)';
    return '<div data-action="expand-tr-record" data-arg1="' + i + '" style="padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;line-height:1.6">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
      '<span style="color:var(--text2);font-size:11px">📝 ' + esc(dateStr) + ' · ' + (r.action === 'show_answer' ? '查看答案' : '作答') + '</span>' +
      '<span style="font-weight:700;color:' + scoreColor + '">' + esc(r.score || '-') + '</span>' +
      '</div>' +
      '<div style="color:var(--text)">📌 ' + esc(r.question.length > 50 ? r.question.substring(0, 50) + '…' : r.question) + '</div>' +
      '<div id="trRecExp_' + i + '" style="display:none;margin-top:6px;border-top:1px dashed var(--border);padding-top:6px">' +
        '<div><b>你的翻译：</b><span style="color:var(--text2)">' + esc(r.userAnswer || '(空)') + '</span></div>' +
        (r.ref ? '<div style="margin-top:4px"><b>参考答案：</b><span style="color:var(--green)">' + esc(r.ref) + '</span></div>' : '') +
        (r.feedback ? '<div style="margin-top:4px"><b>反馈：</b><span style="color:var(--text2)">' + esc(r.feedback) + '</span></div>' : '') +
      '</div>' +
      '</div>';
  }).join('');
}

function expandTrRecord(i) {
  const exp = document.getElementById('trRecExp_' + i);
  if (exp) exp.style.display = exp.style.display === 'none' ? 'block' : 'none';
}

function toggleTranslateHistory() {
  trHistoryExpanded = !trHistoryExpanded;
  renderTranslateHistory();
}

function clearTranslateHistory() {
  if (!confirm('确定清空翻译记录？')) return;
  setSetting('trHistory', []);
  renderTranslateHistory();
}
