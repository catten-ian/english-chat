/* ============================================================
   AI 英语对话教练 — 全局状态、工具函数、Markdown 渲染、系统提示词、callAPI
   由 js/app.js 拆分而来（原 1-291 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ============================================================
   AI 英语对话教练 - Main Application
============================================================ */

/* ---------- State ---------- */
let conversation = [];
let currentLevel = 6;
let currentTopic = 'free';
const TOPIC_LABELS = { free: '自由发挥', daily: '日常生活', tech: '科技', culture: '文化', travel: '旅行', business: '商业', environment: '环境', health: '健康', entertainment: '娱乐', education: '教育', ielts_s1: '雅思口语 P1', ielts_s2: '雅思口语 P2', ielts_s3: '雅思口语 P3', ielts_w1: '雅思写作 Task1', ielts_w2: '雅思写作 Task2' };
const TOPIC_ORDER = ['free', 'daily', 'tech', 'culture', 'travel', 'business', 'environment', 'health', 'entertainment', 'education', 'ielts_s1', 'ielts_s2', 'ielts_s3', 'ielts_w1', 'ielts_w2'];
let pendingTopicCb = null;
let isSending = false;
let lastRawResponse = '';
let lastThinking = '';
let lastApiError = null;
let debugLog = [];
let translateCache = {};
let sidebarOpen = false;
let tipSelected = '';
let selectedMsgId = null;
let alexBackstory = '';
let ankiAutoAdd = false;
let autoReadAloud = false;
let currentAbort = null;        // AbortController for the in-flight send cycle (stop button)
let analysisAbort = null;       // 评分/分析独立中止：主回复结束后它仍在后台跑，需要单独控制
let analysisTimers = [];        // 分析重试的 setTimeout id（切换对话/登出/停止时清理）
const _streamThrottle = { el: null, buf: '', raf: null };  // 流式渲染节流缓冲
let streamChatEnabled = true;   // stream Alex's reply token by token
let strategistEnabled = true;   // 策略师: pre-reply style/intent analysis
let executorEnabled = true;     // 执行者: 由主对话/策略师指派时执行多轮联网研究
let agentRuntimeLog = [];       // 后台 Agent（策略师/执行者）运行记录 —— 仅显示在「调试」面板
let llmRuntimeLog = [];          // 大模型调用日志（请求 JSON + 完整响应 JSON，含思考过程）

function agentLog(agent, msg) {
  agentRuntimeLog.push({ t: new Date().toISOString(), agent, msg: String(msg).substring(0, 600) });
  if (agentRuntimeLog.length > 300) agentRuntimeLog.shift();
}
function llmLog(type, request, response, thinking) {
  llmRuntimeLog.push({
    t: new Date().toISOString(),
    type,
    request: { model: request.model, messages: (request.messages || []).length, max_tokens: request.max_tokens, temperature: request.temperature },
    response: String(response || '').substring(0, 2000),
    thinking: String(thinking || '').substring(0, 1000),
  });
  if (llmRuntimeLog.length > 100) llmRuntimeLog.shift();
}

/* ---------- Helpers ---------- */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function genMsgId() {
  return 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

/* ---------- Markdown rendering (safe, preserves line breaks) ---------- */
function renderMD(text, mode) {
  if (!text) return '';
  let s = String(text);

  // --- Fenced code blocks: extract first (verbatim), restore last, escaped ---
  const codeBlocks = [];
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => {
    codeBlocks.push(code);
    return '\u0000CODE' + (codeBlocks.length - 1) + '\u0000';
  });

  // --- LaTeX math: 提取并保护（$$...$$ 块级 / $...$ 行内），最后还原为 .math-raw span ---
  const mathSegs = [];
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => { mathSegs.push({ tex, display: 1 }); return '\u0000MATH' + (mathSegs.length - 1) + '\u0000'; });
  s = s.replace(/\$([^$\n]+?)\$/g, (m, tex) => { mathSegs.push({ tex, display: 0 }); return '\u0000MATH' + (mathSegs.length - 1) + '\u0000'; });

  // Escape HTML
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Blockquotes
  s = s.split('\n').map(line => {
    const q = line.match(/^&gt;\s?(.*)$/);
    return q ? '<blockquote>' + q[1] + '</blockquote>' : line;
  }).join('\n');

  // Headers
  s = s.replace(/^###\s+(.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^##\s+(.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^#\s+(.+)$/gm, '<h3>$1</h3>');

  // Bold + italic combos: ***text***
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* or _text_
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+?)_/g, '$1<em>$2</em>');
  // Strikethrough: ~~text~~
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Inline code: `code`
  s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Build blocks line by line; handle nested lists by indentation, skip <br> inside blocks
  const out = [];
  const stack = [];   // {type:'ul'|'ol', indent}
  for (const line of s.split('\n')) {
    if (!line.trim()) {
      while (stack.length) out.push('</' + stack.pop().type + '>');
      continue;
    }
    if (/^<(h3|h4|h5|blockquote)>/.test(line)) {
      while (stack.length) out.push('</' + stack.pop().type + '>');
      out.push(line);
      continue;
    }
    const indent = (line.match(/^\s*/) || [''])[0].length;
    const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const olMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ulMatch || olMatch) {
      const type = ulMatch ? 'ul' : 'ol';
      while (stack.length && stack[stack.length - 1].indent >= indent) {
        out.push('</' + stack.pop().type + '>');
      }
      if (!stack.length || stack[stack.length - 1].type !== type) {
        out.push('<' + type + '>');
        stack.push({ type, indent });
      }
      out.push('<li>' + (ulMatch ? ulMatch[1] : olMatch[1]) + '</li>');
      continue;
    }
    while (stack.length) out.push('</' + stack.pop().type + '>');
    out.push(line);
  }
  while (stack.length) out.push('</' + stack.pop().type + '>');
  if (mode === 'markdown') {
    // 反馈场景：单个换行视为行内空格（避免过多<br>），两个以上连续换行为段落分隔
    s = out.join('\n').replace(/\n{2,}/g, '<br><br>').replace(/\n/g, ' ');
  } else {
    // 聊天场景：保留换行
    s = out.join('\n').replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  }

  // Restore code blocks（必须转义：模型可能在 ``` 内返回原始 HTML）
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => '<pre class="code-block"><code>' + esc(codeBlocks[Number(i)]) + '</code></pre>');

  // Restore math spans（转义文本；KaTeX 渲染在 DOM 插入后执行）
  s = s.replace(/\u0000MATH(\d+)\u0000/g, (m, i) => {
    const seg = mathSegs[Number(i)];
    return '<span class="math-raw" data-display="' + seg.display + '">' + esc(seg.tex) + '</span>';
  });

  // Remove empty <br> sequences
  s = s.replace(/(<br>\s*){2,}/g, '<br>');
  return s;
}
function dbg(type, msg) {
  debugLog.push({ time: new Date().toISOString(), type: type, msg: String(msg).substring(0, 200) });
  if (debugLog.length > 100) debugLog.shift();
}

/* ---------- System Prompts ---------- */
// buildCharacterCard() and getActiveCharacter() are defined in config.js and loaded before app.js

async function generateBackstory() {
  if (alexBackstory) return;
  try {
    const c = getActiveCharacter();
    const card = buildCharacterCard();
    const raw = await callAPI([
      { role: 'system', content: 'You are a character developer. Expand the following character card into a short, vivid third-person backstory (150-200 words). Add realistic history, a memorable life event, and a distinct voice. Keep it consistent with the given persona. Return ONLY the backstory text, no JSON, no extra text.' },
      { role: 'user', content: card }
    ], { temperature: 0.9, maxTokens: 1200 });
    alexBackstory = extractChatReply(raw);
    dbg('BACKSTORY', 'generated ' + alexBackstory.length + ' chars');
  } catch (e) {
    dbg('BACKSTORY_ERR', e.message);
    alexBackstory = '';
  }
}

function buildChatPrompt() {
  const level = currentLevel;
  let levelDesc;
  if (level <= 2) levelDesc = 'CET-2 level: simple language.';
  else if (level <= 4) levelDesc = 'CET-4 level: simple natural English.';
  else if (level <= 6) levelDesc = 'CET-6 level: natural everyday American English.';
  else if (level <= 8) levelDesc = 'Post-CET-6: richer vocabulary.';
  else levelDesc = 'Near-native: sophisticated English.';

  // 用户在设置里填写的「回复长度」提示词，默认空（不附加长度限制）
  const lengthGuide = getSetting('responseLengthGuide', '');
  const lengthGuideLine = lengthGuide ? `\nRESPONSE LENGTH: ${lengthGuide}` : '';
  const permanentInstructions = getStrategistInstructions().filter(i => i.permanent).map(i => i.text);
  const permanentInstructionLine = permanentInstructions.length ? '\nPERMANENT USER PREFERENCES (follow these when compatible with the conversation):\n' + permanentInstructions.map(x => '- ' + x).join('\n') : '';

  return `You are Alex, a real, warm, and engaging American conversation partner — not a robot. You fully inhabit this character and treat the user like a genuine friend.

${buildCharacterCard()}

HOW TO BE NATURAL AND HUMAN:
- Always respond with warmth and genuine curiosity. Never give one-line acknowledgments.
- Actively LEAD and drive the conversation: ask follow-up questions, share your own related opinions/experiences in character, react with emotion (excitement, surprise, humor), and keep the dialogue flowing forward.
- When the user shares something, respond with substance: react, relate, reflect, and then ask a good follow-up question.
- Use your backstory and personality naturally (e.g., mention your graphic design work, your cat Mochi, your travels, your record collection) when it fits the conversation.
- Vary your sentence length and structure. Use contractions, casual interjections ("oh nice", "no way", "love that", "haha"), and light humor. Sound like you're texting a friend, not answering a query.
- Avoid generic filler like "You're the expert, so lead the way" or "That's interesting." Be specific and personal.
- Always end with a question or an invitation to keep the conversation going.

DIFFICULTY: ${levelDesc}
TOPIC: ${TOPIC_TEXTS[currentTopic] || 'any'}
${lengthGuideLine}
LANGUAGE RULE (ABSOLUTE): You must ALWAYS reply in English — never in Chinese. Even if the user writes in Chinese, understand their meaning but respond entirely in English. Never begin or end your message with Chinese. Only use Chinese inside the reply if explaining a translation, grammar point, or idiom meaning for the learner, and keep such explanations short and secondary. English is the only language you speak.${permanentInstructionLine}

Reply with ONLY your natural chat message. No analysis, no JSON, no thinking, no extra text.`;
}

function buildAnalysisPrompt() {
  return `You are an experienced English teacher, specialized in helping Chinese learners improve their English. Analyze the user's English message and provide detailed feedback.

IMPORTANT RULES:
- Only flag REAL grammatical errors (wrong tense, missing articles, word order, agreement errors, etc.)
- Do NOT correct stylistic choices, contractions, or natural spoken English
- Corrections array should be EMPTY if there are no real errors
- Extensions should provide USEFUL advanced vocabulary, collocations, and phrases that genuinely lift the user's expression
- Each extension should be a practical learning point

You MUST respond with ONLY a valid JSON object (no markdown, no extra text, no thinking) in this exact format:
{
  "analysis": {
    "grammar": {"score": 0-10, "comment": "In Chinese. Assess grammar."},
    "expression": {"score": 0-10, "comment": "In Chinese. Assess clarity, meaning."},
    "collocation": {"score": 0-10, "comment": "In Chinese. Assess natural word combinations."},
    "style": {"score": 0-10, "comment": "In Chinese. Assess eloquence, variety."}
  },
  "corrections": [
    {"original": "user phrase with real error", "corrected": "corrected version", "type": "grammar|collocation|vocabulary|punctuation", "rule": "brief rule name", "explanation": "why it's wrong, in Chinese"}
  ],
  "extensions": [
    {"type": "synonym|idiom|knowledge|grammar", "title": "short title", "content": "learning point with examples, partly in Chinese. Include 2-3 useful alternatives or phrases."}
  ],
  "new_words": [
    {"word": "word", "meaning": "Chinese meaning", "example": "example sentence", "part": "n./v./adj./adv."}
  ],
  "weak_points": [
    {"category": "grammar|collocation|vocabulary", "point": "generalizable knowledge point", "suggestion": "how to improve"}
  ]
}

Score guide: 1-4 = needs improvement, 5-6 = acceptable, 7-8 = good, 9-10 = excellent.

For extensions: provide advanced alternatives that are genuinely useful. For example, if the user says "I like", suggest "I'm fond of / I'm passionate about / I have a soft spot for" with usage examples. If the user describes something, suggest richer vocabulary and more vivid expressions. Focus on phrases and collocations, not just single words.`;
}

/* ---------- API ---------- */
async function callAPI(messages, options) {
  options = options || {};
  const body = {
    model: MODEL,
    messages: messages,
    temperature: options.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? 3200
  };
  // 翻译/词典场景禁用思考模式
  if (options.thinking !== undefined) body.thinking = options.thinking;
  // Use backend proxy (same-origin) to avoid CORS issues
  const proxyUrl = (BACKEND_URL || '') + '/api/proxy/chat';
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    signal: options.signal,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch(e) {}
    throw new Error('API error ' + res.status + ': ' + detail);
  }
  const data = await res.json();
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  const content = msg.content || '';
  const thinking = msg.reasoning_content || msg.thinking || '';
  lastRawResponse = content;
  lastThinking = thinking || '';
  lastApiError = null;
  llmLog('call', body, content, thinking);
  return content;
}

function buildApiMessages() {
  return getActivePath().slice(-20).map(m => ({ role: m.role, content: m.content }));
}

/* ============================================================
   AudioManager — 统一管理「人声 TTS 朗读」与「背景音乐」
   - 全局只有一条人声通道：新朗读会替换（停止）正在播放的旧朗读，
     避免连续点多个「朗读」时声音叠加；Blob URL 用完即释放。
   - 朗读期间自动压低（暂停）背景音乐，朗读结束/出错/被替换后恢复。
   - 背景音乐仍由 14-music.js 的 musicAudio 负责（含跨标签页互斥），
     这里只做「人声 ↔ 音乐」的协调，不接管音乐的曲目/音量逻辑。
   onDone(reason) 回调：reason 为 'ended' | 'error' | 'stopped' | 'replaced'，
   供调用方复位按钮等 UI（一次会话只回调一次）。
   ============================================================ */
const AudioManager = (function () {
  let session = null;          // { audio, url, onDone }
  // 音乐压低（duck）状态
  let musicWasPlaying = false; // 朗读前音乐是否在播放
  let musicPausedByDuck = false; // 是否由我们暂停（ratio=0 时）
  let musicSavedVolume = null; // 朗读前的音乐音量（null = 未压低）

  function duckSetting() {
    let enabled = true, ratio = 20;
    try { enabled = getSetting('ttsDuckMusic', true) !== false; } catch (e) {}
    try { ratio = Math.max(0, Math.min(100, parseInt(getSetting('ttsDuckRatio', 20), 10) || 0)); } catch (e) {}
    return { enabled, ratio };
  }
  function duckMusic() {
    if (musicSavedVolume !== null || musicPausedByDuck) return;  // 已压低（如朗读被替换时）
    if (typeof musicAudio === 'undefined' || !musicAudio) return;
    const { enabled, ratio } = duckSetting();
    if (!enabled) return;
    musicWasPlaying = !musicAudio.paused;
    musicSavedVolume = musicAudio.volume;
    if (ratio <= 0) {
      // 0 = 朗读期间完全暂停音乐
      if (musicWasPlaying) {
        try { musicAudio.pause(); } catch (e) {}
        musicPausedByDuck = true;
        if (typeof updateMusicUI === 'function') updateMusicUI();
      }
    } else {
      // 保持播放，仅把音量压到指定比例
      try { musicAudio.volume = ratio / 100; } catch (e) {}
    }
  }
  function resumeMusic() {
    const wasDucked = musicPausedByDuck || musicSavedVolume !== null;
    const wasPlaying = musicWasPlaying;
    const wasPaused = musicPausedByDuck;
    const savedVol = musicSavedVolume;
    musicWasPlaying = false; musicPausedByDuck = false; musicSavedVolume = null;
    if (!wasDucked) return;
    if (typeof musicAudio === 'undefined' || !musicAudio) return;
    if (wasPaused && musicAudio.paused) { musicAudio.play().catch(function () {}); }
    if (savedVol !== null) { try { musicAudio.volume = savedVol; } catch (e) {} }
    if (wasPlaying || wasPaused) { if (typeof updateMusicUI === 'function') updateMusicUI(); }
  }
  function destroySession(s, reason, restoreMusic) {
    if (!s) return;
    try { s.audio.onended = null; s.audio.onerror = null; s.audio.pause(); } catch (e) {}
    try { URL.revokeObjectURL(s.url); } catch (e) {}
    if (restoreMusic) resumeMusic();
    if (typeof s.onDone === 'function') {
      try { s.onDone(reason); } catch (e) {}
    }
  }

  // 播放一段 TTS 音频（Blob）。onDone 见文件头注释。
  function speakBlob(blob, onDone) {
    // 替换旧会话：不恢复音乐（新会话接管 duck 状态），通知旧调用方复位
    if (session) {
      const old = session;
      session = null;
      destroySession(old, 'replaced', false);
    }
    duckMusic();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const s = { audio, url, onDone: typeof onDone === 'function' ? onDone : null };
    session = s;
    const finish = function (reason) {
      if (session !== s) return;   // 已被更新的会话替换
      session = null;
      destroySession(s, reason, reason !== 'replaced');
    };
    audio.onended = function () { finish('ended'); };
    audio.onerror = function () { finish('error'); };
    audio.play().catch(function () { finish('error'); });
    return audio;
  }

  // 停止当前朗读（恢复音乐）。无朗读时为空操作。
  function stopSpeech() {
    if (!session) return;
    const s = session;
    session = null;
    destroySession(s, 'stopped', true);
  }

  function isSpeaking() { return !!(session && session.audio && !session.audio.paused); }

  return { speakBlob, stopSpeech, isSpeaking };
})();
