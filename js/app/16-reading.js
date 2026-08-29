/* ============================================================
   AI 英语对话教练 — 阅读模式：文章、高亮、笔记、划词、TTS、联动主应用
   由 js/app.js 拆分而来（原 5801-6503 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ============================================================
   Reading Mode（阅读模式）
   - 文章来源：时政精选 / 粘贴文章 / 最近阅读
   - 功能：高亮（多色）/ 划词翻译 / 一键进入主应用背诵练习
   ============================================================ */
let readingState = {
  article: null,           // { id, title, source, lang, content }
  highlights: [],          // [{ id, start, end, color, note, text }]
  hlMode: false,            // 是否处于高亮选中模式
  notesOpen: false,
  translateTip: null,
  history: []              // [{ id, title, source, lang, updatedAt }]
};
const READING_HL_COLORS = [
  { id: 'hl-yellow', name: '黄色', color: '#fef3c7' },
  { id: 'hl-green',  name: '绿色', color: '#bbf7d0' },
  { id: 'hl-blue',   name: '蓝色', color: '#bfdbfe' },
  { id: 'hl-pink',   name: '粉色', color: '#fbcfe8' },
  { id: 'hl-orange', name: '橙色', color: '#fed7aa' }
];

const READING_PRESETS = [
  // 8 篇时政 / 名言 / 文化类英语文章
  { id: 'p-un', title: '联合国成立 80 周年：和平与多边主义的当下意义', lang: 'zh', source: '时政精选',
    paragraphs: [
      'Eighty years ago, in the aftermath of a devastating world war, the United Nations was founded with a single, urgent purpose: to save succeeding generations from the scourge of war.',
      'Today, that founding promise still guides the work of the UN in every continent. From climate negotiations in New York to peacekeeping missions in Africa, the institution remains a unique platform for dialogue among nations.',
      'Critics argue that the UN is slow, bureaucratic, and at times powerless. Yet few other bodies can bring together so many voices around a single table, especially on issues that no single country can solve alone.',
      'Looking ahead, the next decade will test whether the world is still willing to invest in cooperation. Climate change, pandemics, and the rapid spread of artificial intelligence all demand shared rules and shared responsibility.'
    ]
  },
  { id: 'p-ai', title: 'AI and the Future of Work', lang: 'en', source: '时政精选',
    paragraphs: [
      'Artificial intelligence is reshaping the workplace faster than most policymakers expected. Tasks that once required years of training — drafting legal briefs, summarizing medical records, translating documents — can now be performed by software in seconds.',
      'This does not mean that humans are no longer needed. Rather, the nature of human work is shifting. Creativity, judgement, and the ability to coordinate with other people are becoming more valuable, not less.',
      'Yet the transition will not be painless. Workers whose skills can be replicated by a model face real economic risk, and governments are only beginning to discuss how to share the gains more broadly.',
      'The most realistic path forward is neither techno-optimism nor blanket fear. It is a deliberate effort to build institutions — in education, in labor markets, in social insurance — that give people room to adapt.'
    ]
  },
  { id: 'p-climate', title: 'Why Local Climate Action Still Matters', lang: 'en', source: '时政精选',
    paragraphs: [
      'When international climate talks stall, it is easy to assume that meaningful action is impossible. Yet cities, regions, and local businesses continue to push forward, often out of the spotlight.',
      'Local governments control decisions about buildings, transport, and waste — three of the largest sources of emissions. Their choices, multiplied across a country, can move national numbers in measurable ways.',
      'Beyond numbers, local action builds habits. People who install solar panels, switch to electric buses, or restore wetlands in their own neighborhoods become part of a wider story of change.',
      'Global agreements set the destination. Local projects do the daily work of getting there.'
    ]
  },
  { id: 'p-reading', title: 'In Praise of Slow Reading', lang: 'en', source: '随笔',
    paragraphs: [
      'There is a particular pleasure in reading a difficult book slowly. You finish a paragraph, look up, realize the room has gone quiet, and understand that the book has done something to you.',
      'Slow reading is not the same as rereading, and it is not the same as taking notes. It is the practice of staying with a sentence long enough to feel the weight of every word.',
      'In an age of constant notifications, this kind of attention is itself a kind of resistance. It says: not everything has to be optimized for speed.',
      'The books that changed me the most were almost never the ones I read fastest. They were the ones I lingered in, returning to favorite pages, and finally closing with a small sense of loss.'
    ]
  },
  { id: 'p-food', title: 'The Quiet Politics of the Family Dinner', lang: 'en', source: '文化',
    paragraphs: [
      'The family dinner is one of the most ordinary rituals in modern life, and one of the most quietly political.',
      'It is a place where children first learn to argue, to listen, to wait, and to compromise. The habits of citizenship — patience, reciprocity, the willingness to change your mind — are rehearsed at the kitchen table long before they are tested in public.',
      'When families lose the habit of eating together, something is lost beyond nutrition. The forum where a child first practiced disagreement has simply closed.',
      'No public policy can replace it. But public policy can protect the conditions that make it possible: shorter working hours, fairer wages, and a culture that does not treat the family meal as a luxury.'
    ]
  },
  { id: 'p-translation', title: '为什么翻译不可能完全准确？', lang: 'zh', source: '随笔',
    paragraphs: [
      'The earliest English translators of Chinese poetry faced an impossible choice. Some clung to the literal meaning and produced awkward, half-poetic lines. Others tried to recreate the music of the original in English and drifted away from the words on the page.',
      'A century later, that tension has not gone away. Each generation rediscovers the same paradox: a translation that respects meaning often fails to breathe, and a translation that breathes often forgets the original.',
      'This is not a flaw to be fixed. It is the nature of translation itself. Languages are not interchangeable codes; they are different ways of cutting up the world.',
      'A good translation is honest about its limits. It tells the reader, in so many words: this is one way to hear the original, and there are others.'
    ]
  },
  { id: 'p-deep', title: 'Why Deep Work Is Becoming a Luxury', lang: 'en', source: '时政精选',
    paragraphs: [
      'A few decades ago, professional life was structured around long stretches of uninterrupted work. Reports were drafted in the morning, reviewed in the afternoon, and revised over several quiet days.',
      'Today, that pattern has been broken. Meetings, messages, and notifications arrive in a constant stream, and many knowledge workers spend their days reacting rather than thinking.',
      'The cost is not just personal stress. It is a quiet loss of capability, both for individuals and for the institutions that depend on them.',
      'Companies and governments that understand this are starting to protect pockets of deep work — closing chat for a few hours, blocking off calendars, redesigning open offices. The next competitive advantage may belong to those who can still think slowly.'
    ]
  },
  { id: 'p-music', title: '为什么一首歌能让你突然难过？', lang: 'zh', source: '文化',
    paragraphs: [
      'You hear the first few notes of a song you have not listened to in years, and suddenly the whole afternoon turns a different shade. You remember not just the song but the room you were in, the friend you were sitting next to, the season outside the window.',
      'Music is unusually good at carrying memory. The reason is partly biological: rhythm and pitch reach parts of the brain that ordinary language does not. But the rest is personal.',
      'A song becomes a small diary. You add to it each time you hear it, and the next time you hear it, you receive back all those entries at once.',
      'This is why the same song can make one person weep and another shrug. It is not just sound; it is a stored version of a life.'
    ]
  }
];

function ensureReadingLoaded() {
  if (!Array.isArray(readingState.history) || !readingState.history.length) {
    // 加载历史
    apiLoad('reading').then(data => {
      if (data && typeof data === 'object') {
        if (Array.isArray(data.history)) readingState.history = data.history;
        if (data.current && data.current.id && !readingState.article) {
          readingState.article = data.current;
          readingState.highlights = Array.isArray(data.highlights) ? data.highlights : [];
          renderReadingArticle();
        }
      }
      if (!readingState.article) {
        const ra = document.getElementById('readingArea');
        if (ra) ra.classList.remove('has-article');
      }
      renderReadingPicker();
      updateReadingNoteCount();
    }).catch(() => {});
  } else {
    if (!readingState.article) {
      const ra = document.getElementById('readingArea');
      if (ra) ra.classList.remove('has-article');
    }
    renderReadingPicker();
    updateReadingNoteCount();
  }
}

function saveReadingState() {
  apiSave('reading', { history: readingState.history, current: readingState.article, highlights: readingState.highlights });
}

function renderReadingPicker() {
  // 渲染预设列表
  const list = document.getElementById('rdPresetsList');
  if (list) {
    list.innerHTML = READING_PRESETS.map(p => '<button data-action="start-reading-preset" data-arg1="' + p.id + '">' +
      '<strong>' + esc(p.title) + '</strong><br><span style="font-size:10px;color:var(--text3)">' + esc(p.source) + ' · ' + (p.lang === 'zh' ? '中' : 'EN') + ' · ' + p.paragraphs.length + ' 段</span></button>').join('');
  }
  // 渲染历史
  const hist = document.getElementById('rdHistoryList');
  if (hist) {
    if (!readingState.history.length) {
      hist.innerHTML = '<div style="text-align:center;color:var(--text2);padding:14px;font-size:13px">尚无最近阅读</div>';
    } else {
      hist.innerHTML = readingState.history.map(h =>
        '<button data-action="start-reading-history" data-arg1="' + h.id + '" style="text-align:left">' +
        '<strong>' + esc(h.title) + '</strong><br>' +
        '<span style="font-size:10px;color:var(--text3)">' + esc(h.source) + ' · ' + new Date(h.updatedAt).toLocaleDateString() + '</span></button>'
      ).join('');
    }
  }
  // Tab 切换
  document.querySelectorAll('#rdSourceTabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#rdSourceTabs button').forEach(x => x.classList.toggle('active', x === b));
      const src = b.dataset.src;
      document.getElementById('rdPresetsPane').style.display = src === 'presets' ? '' : 'none';
      document.getElementById('rdPastePane').style.display = src === 'paste' ? '' : 'none';
      document.getElementById('rdHistoryPane').style.display = src === 'history' ? '' : 'none';
    };
  });
}

function openReadingPicker() {
  // 显示空状态（如果当前没有文章则显示，否则返回阅读）
  const ra = document.getElementById('readingArea');
  if (ra) ra.classList.remove('has-article');
  if (readingState.article) {
    const empty = document.getElementById('rdEmpty');
    if (empty) empty.style.display = '';
    // 切回选择面板
    const tabs = document.getElementById('rdSourceTabs');
    if (tabs) {
      tabs.style.display = '';
      document.getElementById('rdSourceBody').style.display = '';
    }
    // 移除文章内容以显示选择面板
    const paper = document.getElementById('rdPaper');
    Array.from(paper.children).forEach(c => { if (c.id !== 'rdEmpty') c.remove(); });
    document.getElementById('rdSourcePill').textContent = '📚 选择文章';
  }
}

function resetReadingPicker() {
  // 在粘贴面板中作为取消按钮
  document.getElementById('rdPasteText').value = '';
  document.getElementById('rdPasteTitle').value = '';
  // 切回预设
  document.querySelector('#rdSourceTabs button[data-src="presets"]').click();
}

function startReadingFromPreset(id) {
  const p = READING_PRESETS.find(x => x.id === id);
  if (!p) return;
  startReading({
    id: p.id,
    title: p.title,
    lang: p.lang,
    source: p.source,
    paragraphs: p.paragraphs
  });
}

function startReadingFromPaste() {
  const text = document.getElementById('rdPasteText').value.trim();
  if (!text) { toastMsg('请粘贴文章内容', 'error'); return; }
  const title = (document.getElementById('rdPasteTitle').value || '').trim() || '我的文章';
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length ? text.split(/\n\s*\n/) : [text];
  const id = 'pasted-' + Date.now();
  const lang = detectReadingLang(text);
  startReading({ id, title, lang, source: '粘贴', paragraphs });
}

function startReadingFromHistory(id) {
  const h = readingState.history.find(x => x.id === id);
  if (!h) return;
  // 历史保留原文（含 highlights）
  readingState.article = h;
  readingState.highlights = Array.isArray(h.highlights) ? h.highlights : [];
  renderReadingArticle();
}

function startReading(article) {
  readingState.article = article;
  readingState.highlights = [];
  // 写入历史（去重）
  readingState.history = [{
    id: article.id, title: article.title, source: article.source || '',
    lang: article.lang, updatedAt: new Date().toISOString(),
    paragraphs: article.paragraphs, highlights: []
  }, ...readingState.history.filter(x => x.id !== article.id)].slice(0, 30);
  saveReadingState();
  renderReadingArticle();
  toastMsg('开始阅读：' + article.title, 'success');
}

function detectReadingLang(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  return en > cjk ? 'en' : 'zh';
}

function renderReadingArticle() {
  const paper = document.getElementById('rdPaper');
  if (!paper || !readingState.article) return;
  const a = readingState.article;
  // 有文章 → 显示工具栏
  const ra = document.getElementById('readingArea');
  if (ra) ra.classList.add('has-article');
  Array.from(paper.children).forEach(c => { if (c.id !== 'rdEmpty') c.remove(); });
  // 显示工具栏提示
  document.getElementById('rdSourcePill').textContent = a.source || '文章';
  document.getElementById('rdLangChip').textContent = a.lang === 'zh' ? '中' : 'EN';
  document.getElementById('rdEmpty').style.display = 'none';

  // 标题区
  const head = document.createElement('div');
  head.innerHTML = '<h1 class="reading-title">' + esc(a.title) + '</h1>' +
    '<div class="reading-meta">' +
      '<span>📚 ' + esc(a.source || '文章') + '</span>' +
      '<span>🌐 ' + (a.lang === 'zh' ? '中文' : 'English') + '</span>' +
      '<span>📝 ' + a.paragraphs.length + ' 段</span>' +
      '<span>🕒 ' + new Date().toLocaleString() + '</span>' +
    '</div>';
  paper.appendChild(head);

  // 文章内容
  const content = document.createElement('div');
  content.id = 'rdContent';
  content.className = 'reading-content';
  content.lang = a.lang === 'zh' ? 'zh-CN' : 'en-US';
  // 用 innerHTML 渲染（保留段落），并对每个字符建立索引以便高亮定位
  content.innerHTML = a.paragraphs.map(p => '<p>' + esc(p) + '</p>').join('');
  paper.appendChild(content);

  // 重新挂载事件
  installReadingEvents();

  // 应用已有高亮
  applyHighlights();
  updateReadingNoteCount();
}

function installReadingEvents() {
  const content = document.getElementById('rdContent');
  if (!content) return;

  // 划词：mouseup
  content.addEventListener('mouseup', onReadingSelection);
  content.addEventListener('touchend', onReadingSelection);
  // 点击高亮：显示/隐藏笔记
  content.addEventListener('click', onReadingHighlightClick);
}

/* 选区划词触发翻译 */
function onReadingSelection(e) {
  if (readingState.hlMode) return; // 高亮模式下，选区由 mousedown 处理
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text || text.length > 200) return;
    const range = sel.getRangeAt(0);
    // 仅允许在 rdContent 内（此前依赖浏览器把元素 id 暴露为全局变量，某些环境下会抛错）
    const content = document.getElementById('rdContent');
    if (!content || !content.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    openReadingTip(rect, text);
  }, 0);
}

/* 点击高亮：显示/隐藏笔记入口 */
function onReadingHighlightClick(e) {
  const t = e.target.closest('.hl');
  if (!t) return;
  // 已有笔记：跳转到该笔记
  const id = t.dataset.hlId;
  const hl = readingState.highlights.find(h => h.id === id);
  if (!hl) return;
  if (hl.note) {
    toastMsg('📝 ' + hl.note, 'info', 4000);
  }
}

function openReadingTip(rect, text) {
  closeReadingTip();
  let tip = document.getElementById('rdTranslateTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'rdTranslateTip';
    tip.className = 'reading-translate-tip';
    document.body.appendChild(tip);
  }
  tip.classList.add('visible');
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-label', '单词/短语翻译');
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - 160), window.innerWidth - 340);
  const top = Math.min(window.innerHeight - 280, rect.bottom + 6);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  tip.innerHTML = '<div class="rtt-header">' + esc(text) + '</div>' +
    '<div class="rtt-body"><span class="rtt-loading">翻译中...</span></div>' +
    '<div class="rtt-actions">' +
    '<button class="rtt-add" data-act="add">加入生词本</button>' +
    '<button class="rtt-note" data-act="note">📝 加笔记</button>' +
    '<button class="rtt-close" data-act="close">关闭</button>' +
    '</div>';
  tip.querySelectorAll('button').forEach(b => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const act = b.dataset.act;
    if (act === 'add') { readingTipAddVocab(text); closeReadingTip(); }
    else if (act === 'note') { readingTipAddNote(text); closeReadingTip(); }
    else { closeReadingTip(); }
  }));
  readingState.translateTip = { text };
  fetchReadingTipTranslation(text, tip);
}

function closeReadingTip() {
  const tip = document.getElementById('rdTranslateTip');
  if (tip) { tip.classList.remove('visible'); }
}

async function fetchReadingTipTranslation(text, tip) {
  const body = tip.querySelector('.rtt-body');
  try {
    const ctx = getActivePath().slice(-6).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
    const contextBlock = ctx ? '\n\nRelevant conversation context:\n' + ctx : '';
    const sys = `You are a dictionary assistant. For the given English word/phrase, provide a detailed dictionary entry in Chinese. If the word is a morphological variant (plural, past tense, -ing, etc.), show the base/lemma form as the main entry and list all variants. Return ONLY valid JSON (no markdown, no thinking):
{
  "word": "base form",
  "input": "the original selected text",
  "phonetic": "/IPA/",
  "part": "词性 (n./v./adj./adv.)",
  "variants": {"plural": "forms", "past": "forms", "present": "forms", "comparative": "forms"} as applicable,
  "meanings": ["释义1", "释义2"],
  "examples": [{"en": "English sentence using the phrase", "zh": "中文翻译"}],
  "collocations": ["搭配1 (翻译)", "搭配2 (翻译)"],
  "synonyms": [{"word": "同义词", "note": "辨析说明"}],
  "etymology": "word origin explanation in Chinese"
}` + contextBlock;
    const res = await fetch((BACKEND_URL || '') + '/api/proxy/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }], temperature: 0.2, max_tokens: 1200, thinking: { type: 'disabled' } })
    });
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const cleaned = stripThinking(content);
    let obj = smartParseJSON(cleaned);
    if (!obj) {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) obj = smartParseJSON(m[0]);
    }
    if (!obj) throw new Error('无法解析');
    let html = '';
    if (obj.word) html += '<div style="font-weight:700;font-size:16px;color:var(--primary);margin-bottom:2px">' + esc(obj.word) + '</div>';
    if (obj.phonetic) html += '<div style="font-family:monospace;color:var(--text2);font-size:12px;margin-bottom:4px">' + esc(obj.phonetic) + '</div>';
    if (obj.part) html += '<div style="font-size:11px;color:var(--text2);font-style:italic;margin-bottom:6px">' + esc(obj.part) + '</div>';
    if (Array.isArray(obj.meanings)) html += obj.meanings.map(m => '<div style="margin:2px 0">• ' + esc(m) + '</div>').join('');
    if (Array.isArray(obj.examples)) {
      html += '<div style="margin-top:6px;border-top:1px dashed var(--border);padding-top:4px"><strong style="font-size:11px;color:var(--text2)">例句</strong></div>';
      obj.examples.forEach(ex => {
        html += '<div style="margin-top:3px;font-size:12px;line-height:1.5"><div>' + esc(ex.en || '') + '</div><div style="color:var(--text2)">' + esc(ex.zh || '') + '</div></div>';
      });
    }
    if (Array.isArray(obj.collocations)) {
      html += '<div style="margin-top:6px;border-top:1px dashed var(--border);padding-top:4px"><strong style="font-size:11px;color:var(--text2)">常见搭配</strong></div>';
      html += obj.collocations.map(c => '<div style="font-size:12px">• ' + esc(c) + '</div>').join('');
    }
    body.innerHTML = html || '<span class="rtt-loading">未返回结果</span>';
  } catch (e) {
    body.innerHTML = '<span class="rtt-loading">翻译失败：' + esc(e.message.substring(0, 80)) + '</span>';
  }
}

function readingTipAddVocab(word) {
  const v = getVocab();
  if (!v.some(x => x.word && x.word.toLowerCase() === word.toLowerCase())) {
    v.push({ word, translation: '（阅读中添加）', part: '', example: '', context: 'Reading mode', added: new Date().toISOString().slice(0, 10) });
    saveVocab(v);
    renderVocab();
    toastMsg('已加入生词本：' + word, 'success');
  } else {
    toastMsg('生词本中已有：' + word);
  }
}

function readingTipAddNote(text) {
  const note = prompt('为 "' + text + '" 添加笔记：');
  if (!note) return;
  // 把这条 note 关联到当前文章作为一个全局笔记
  const articleId = readingState.article ? readingState.article.id : null;
  if (!articleId) return;
  if (!readingState.highlights) readingState.highlights = [];
  readingState.highlights.push({ id: 'note-' + Date.now(), text, note, color: 'hl-yellow', globalNote: true });
  saveReadingState();
  updateReadingNoteCount();
  toastMsg('笔记已添加', 'success');
}

function updateReadingNoteCount() {
  const el = document.getElementById('rdNoteCount');
  if (!el) return;
  const notes = (readingState.highlights || []).filter(h => h.note);
  el.textContent = notes.length ? ' (' + notes.length + ')' : '';
}

/* ---- 高亮选中模式 ---- */
function toggleHighlightMode() {
  readingState.hlMode = !readingState.hlMode;
  const btn = document.getElementById('rdHlBtn');
  if (btn) btn.setAttribute('aria-pressed', readingState.hlMode);
  document.body.style.cursor = readingState.hlMode ? 'crosshair' : '';
  toastMsg(readingState.hlMode ? '高亮模式开启：选中文本 → 选颜色' : '高亮模式关闭');
}

document.addEventListener('mouseup', function(e) {
  if (!readingState.hlMode) return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    const content = document.getElementById('rdContent');
    if (!content || !content.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    openHighlightPicker(rect.left + rect.width / 2, rect.bottom + 6, (color) => {
      addHighlight(text, range, color);
      sel.removeAllRanges();
    });
  }, 0);
}, true);

function openHighlightPicker(x, y, onPick) {
  const picker = document.getElementById('hlPicker');
  if (!picker) return;
  picker.style.display = 'flex';
  picker.style.left = Math.max(8, Math.min(x - 80, window.innerWidth - 180)) + 'px';
  picker.style.top = Math.max(8, Math.min(y, window.innerHeight - 60)) + 'px';
  picker.innerHTML = '';
  READING_HL_COLORS.forEach(c => {
    const b = document.createElement('button');
    b.style.background = c.color;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.onclick = (ev) => {
      ev.stopPropagation();
      picker.style.display = 'none';
      onPick(c.id);
    };
    picker.appendChild(b);
  });
  // 关闭逻辑：外部点击
  setTimeout(() => {
    function close(ev) {
      if (!picker.contains(ev.target)) {
        picker.style.display = 'none';
        document.removeEventListener('click', close, true);
      }
    }
    document.addEventListener('click', close, true);
  }, 0);
}

/* 计算一个 range 在正文中的位置（第几段 + 段内字符偏移），用于持久化高亮 */
function hlPosition(range) {
  const content = document.getElementById('rdContent');
  if (!content || !range) return null;
  const ps = Array.from(content.querySelectorAll('p'));
  const startEl = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  const pEl = startEl && startEl.closest ? startEl.closest('p') : null;
  if (!pEl) return null;
  const pIdx = ps.indexOf(pEl);
  if (pIdx < 0) return null;
  try {
    const s = range.cloneRange();
    s.setStart(pEl, 0);
    const startOffset = s.toString().length;
    const e = range.cloneRange();
    e.setStart(pEl, 0);
    e.setEnd(range.endContainer, range.endOffset);
    const endOffset = e.toString().length;
    return { pIdx, startOffset, endOffset };
  } catch (err) { return null; }
}

function addHighlight(text, range, color) {
  const content = document.getElementById('rdContent');
  if (!content) return;
  // 位置必须在修改 DOM 之前计算：deleteContents 之后 range 会收缩到插入点
  const pos = hlPosition(range);
  // 用 range 包围的节点建立稳定引用
  const hl = document.createElement('span');
  hl.className = 'hl ' + color;
  hl.textContent = text;
  try {
    range.deleteContents();
    range.insertNode(hl);
  } catch (e) { return; }
  const id = 'hl-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  hl.dataset.hlId = id;
  // 记录稳定位置（段落 + 段内偏移），供刷新/重渲染后恢复；跨段高亮可能无法精确恢复
  readingState.highlights.push({ id, text, color, note: '', createdAt: new Date().toISOString(), ...(pos || {}) });
  // 同步历史中对应文章的 highlights
  syncHistoryHighlights();
  saveReadingState();
}

function syncHistoryHighlights() {
  const id = readingState.article && readingState.article.id;
  if (!id) return;
  const h = readingState.history.find(x => x.id === id);
  if (h) h.highlights = JSON.parse(JSON.stringify(readingState.highlights));
}

/* 重渲染文章后，把保存的高亮按「段落 + 偏移」重新包成 span。
   从每段末尾往前插入，避免前面插入改变后续偏移。 */
function applyHighlights() {
  const content = document.getElementById('rdContent');
  if (!content) return;
  const ps = Array.from(content.querySelectorAll('p'));
  const hls = readingState.highlights || [];
  // 按段落分组，组内按 endOffset 降序（从后往前插）
  const byPara = new Map();
  for (const h of hls) {
    if (typeof h.pIdx !== 'number') continue;
    if (!byPara.has(h.pIdx)) byPara.set(h.pIdx, []);
    byPara.get(h.pIdx).push(h);
  }
  for (const [pIdx, arr] of byPara) {
    const p = ps[pIdx];
    if (!p) continue;
    arr.sort((a, b) => (b.endOffset || 0) - (a.endOffset || 0));
    for (const h of arr) {
      const startOffset = h.startOffset, endOffset = h.endOffset;
      if (typeof startOffset !== 'number' || typeof endOffset !== 'number') continue;
      const firstText = p.firstChild && p.firstChild.nodeType === 3 ? p.firstChild : null;
      if (!firstText) continue;
      const pText = p.textContent || '';
      // 用偏移 + 文本双重校验，避免正文变动后错位
      if (pText.slice(startOffset, endOffset) !== h.text) continue;
      try {
        const r = document.createRange();
        r.setStart(firstText, Math.min(startOffset, firstText.length));
        r.setEnd(firstText, Math.min(endOffset, firstText.length));
        const span = document.createElement('span');
        span.className = 'hl ' + (h.color || 'hl-yellow');
        span.textContent = h.text;
        span.dataset.hlId = h.id;
        r.deleteContents();
        r.insertNode(span);
      } catch (e) { /* 单个高亮恢复失败不影响其他 */ }
    }
  }
  updateReadingNoteCount();
}

/* ---- 笔记面板 ---- */
function toggleNotesPanel() {
  let p = document.getElementById('rdNotesPanel');
  if (p) { p.remove(); readingState.notesOpen = false; return; }
  p = document.createElement('div');
  p.id = 'rdNotesPanel';
  p.className = 'reading-notes-panel';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', '阅读笔记');
  const notes = (readingState.highlights || []).filter(h => h.note);
  const all = readingState.highlights || [];
  p.innerHTML = '<div class="notes-header"><span>📒 阅读笔记 (' + notes.length + ')</span>' +
    '<button class="a-btn small ghost" data-action="toggle-notes">×</button></div>' +
    '<div class="notes-body" id="rdNotesBody"></div>';
  document.body.appendChild(p);
  readingState.notesOpen = true;
  renderNotesList();
}

function renderNotesList() {
  const body = document.getElementById('rdNotesBody');
  if (!body) return;
  const all = (readingState.highlights || []).filter(h => h.note);
  if (!all.length) {
    body.innerHTML = '<div class="note-empty">还没有笔记<br><br><small>选中文本 → 点击 <b>📝 加笔记</b></small></div>';
    return;
  }
  body.innerHTML = all.map(h => '<div class="note-item">' +
    '<span class="note-color ' + esc(h.color) + '" style="background:var(--' + esc(h.color.replace('hl-', '')) + ',,)' +
      (h.color === 'hl-yellow' ? 'background:#fef3c7' :
       h.color === 'hl-green' ? 'background:#bbf7d0' :
       h.color === 'hl-blue' ? 'background:#bfdbfe' :
       h.color === 'hl-pink' ? 'background:#fbcfe8' :
       'background:#fed7aa') + '"></span>' +
    '<div class="note-text"><strong>' + esc(h.text || '') + '</strong><br>' +
      '<span style="color:var(--text2)">' + esc(h.note) + '</span></div>' +
    '<div class="note-actions">' +
    '<button data-action="delete-reading-note" data-arg1="' + h.id + '" title="删除">×</button>' +
    '</div></div>').join('');
}

function deleteReadingNote(id) {
  readingState.highlights = (readingState.highlights || []).filter(h => h.id !== id);
  syncHistoryHighlights();
  saveReadingState();
  renderNotesList();
  updateReadingNoteCount();
}

/* ---- 阅读模式 TTS ---- */
// 停止朗读：统一交给 AudioManager（也会停止聊天朗读并恢复背景音乐）
function stopReadingTts() {
  if (typeof AudioManager !== 'undefined') AudioManager.stopSpeech();
}

async function readingTts() {
  const a = readingState.article;
  if (!a) { toastMsg('请先选择一篇文章', 'error'); return; }
  const text = a.paragraphs.join(' ');
  try {
    const btn = document.getElementById('rdTtsBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中…'; }
    const res = await fetch((BACKEND_URL || '') + '/api/proxy/tts/' + ELEVEN_VOICE_ID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text: text.substring(0, 4000), model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.95 } })
    });
    if (!res.ok) { const t = await res.text(); throw new Error('TTS ' + res.status + ': ' + t.substring(0, 100)); }
    const blob = await res.blob();
    // 统一走 AudioManager：替换正在播放的朗读（聊天/阅读）、自动压低背景音乐并在结束后恢复
    AudioManager.speakBlob(blob, function (reason) {
      if (reason === 'error') toastMsg('播放失败，请重试', 'error');
    });
    toastMsg('开始朗读', 'success');
  } catch (e) {
    toastMsg('朗读失败：' + e.message, 'error');
  } finally {
    const btn = document.getElementById('rdTtsBtn');
    if (btn) { btn.disabled = false; btn.textContent = '🔊 朗读'; }
  }
}

/* ---- 一键进入主应用背诵练习 ---- */
function openReciteInMain() {
  const a = readingState.article;
  if (!a) { toastMsg('请先选择一篇文章', 'error'); return; }
  const text = a.paragraphs.join('\n\n');
  // 主应用 (article-memorizing) 端口 3000：通过 URL hash 直接预填
  // 主应用需要支持 ?paste=<base64> 来预填；这里直接打开新窗口
  const lang = a.lang === 'zh' ? 'zh' : 'en';
  const title = a.title || '阅读文章';
  const payload = encodeURIComponent(text);
  // 检测主应用端口：从 ?main 读取，默认 3000
  const params = new URLSearchParams(location.search);
  const mainPort = params.get('main') || '3000';
  const mainBase = `http://localhost:${mainPort}`;
  const url = `${mainBase}/?paste=${payload}&lang=${lang}&title=${encodeURIComponent(title)}`;
  window.open(url, '_blank');
  toastMsg('已在新标签页打开背诵练习', 'success');
}
