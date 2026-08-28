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
   Agent helpers: 策略师 (strategist) + 执行者 (web search) + 流式
============================================================ */

/* ---------- 策略师 (全英文，便于模型间协作) ---------- */
function buildStrategistPrompt() {
  const ut = getSetting('userTopic', '');
  const userTopicLine = ut ? `\nThe user has indicated they want to talk about: "${ut}". Steer the conversation naturally toward this topic when appropriate, but do NOT force it if the user clearly wants to discuss something else.` : '';
  const instructions = getStrategistInstructions();
  const permanent = instructions.filter(i => i.permanent).map(i => i.text);
  const oneTime = instructions.filter(i => !i.permanent).map(i => i.text);
  const instructionLine = [...permanent.map(x => '[PERMANENT USER INSTRUCTION] ' + x), ...oneTime.map(x => '[ONE-TIME USER INSTRUCTION] ' + x)].join('\n');
  return `You are the STRATEGIST in an English-learning chat app. Before Alex replies, you quickly analyze the user's latest message and the conversation to make Alex's reply more engaging, natural, and helpful.
Return ONLY valid JSON (no markdown, no thinking, no code fences):
{
  "style": "brief assessment of the user's current tone/style (e.g. playful, serious, shy, talkative)",
  "predicted_intent": "what the user most likely wants (chat / practice / information / venting / humor / debate / storytelling / ...)",
  "topic_hooks": ["2-3 natural, personal follow-up angles Alex could bring up"],
  "tone_advice": "how Alex should adjust tone (energy, humor, empathy, pacing) to match the user",
  "question_suggestion": "one natural follow-up question Alex could end with to keep the conversation going",
  "vocab_suggestions": "2-3 specific vocabulary words or phrases Alex could naturally work into the reply to teach the user",
  "grammar_focus": "one grammar point to subtly reinforce in the reply (e.g. present perfect, conditional, phrasal verb) or empty string",
  "user_level_estimate": "estimated CEFR level (A1/A2/B1/B2/C1/C2) based on user's message",
  "encouragement_note": "one sentence of encouragement or positive reinforcement tailored to the user's effort",
  "needs_search": "true ONLY if answering well requires current/online facts (news, prices, recent events, statistics, releases) that Alex cannot know reliably from training data; otherwise false",
  "search_query": "if needs_search is true, a concise English search query (<= 10 words); otherwise empty string"
}
Keep every field SHORT (<= 20 words). Write all text fields in English.${userTopicLine}${instructionLine ? '\n\nUSER INSTRUCTIONS:\n' + instructionLine : ''}`;
}

async function runStrategist(userText, signal) {
  agentLog('strategist', '开始分析: ' + userText.substring(0, 60));
  const ctx = getActivePath().slice(-8).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
  const messages = [
    { role: 'system', content: buildStrategistPrompt() + (ctx ? '\n\nConversation context:\n' + ctx : '') },
    { role: 'user', content: userText }
  ];
  const result = await callAndParseJSON(messages, { temperature: 0.7, maxTokens: 2000, signal }, (o) => o && o.style);
  agentLog('strategist', '分析完成: ' + (result.obj ? JSON.stringify(result.obj).substring(0, 200) : ('解析失败 — ' + stripThinking(result.raw).substring(0, 200))));
  return result.obj;
}

/* ---------- 执行者（小 agent：多轮联网研究） ---------- */
async function runExecutor(query, signal) {
  const res = await fetch((BACKEND_URL || '') + '/api/proxy/websearch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    signal,
    body: JSON.stringify({ q: query })
  });
  if (!res.ok) throw new Error('websearch HTTP ' + res.status);
  return await res.json();   // {organic:[{title,link,snippet,date}]}
}

function formatSearchResults(data) {
  const org = (data && data.organic) || [];
  if (!org.length) return null;
  return org.slice(0, 5).map(r => {
    const title = (r.title || '').replace(/<[^>]+>/g, '').substring(0, 80);
    const snippet = (r.snippet || '').replace(/<[^>]+>/g, '').substring(0, 200);
    const link = r.link || '';
    return '- ' + title + (snippet ? ' | ' + snippet : '') + (link ? ' | ' + link : '');
  }).join('\n');
}

// 主对话模型决定是否需要联网：需要则只回这一行
function buildSearchDecisionHint() {
  return `[SEARCH PROTOCOL]
If answering the user's message well requires up-to-date or online information (news, prices, recent events, statistics, facts you cannot know reliably), reply with EXACTLY one line:
[NEED_SEARCH] <concise English search query, <= 10 words>
Do not add anything else to that reply. Otherwise, reply normally as Alex.`;
}

function buildResearchPlannerPrompt() {
  return `You are a research planner. Given the original question and the search results gathered so far, decide whether we have enough material to answer, or need one more search.
Return ONLY valid JSON (no markdown, no thinking):
{"done": true/false, "follow_up": "next concise English search query if not done, else empty string"}
Set done=true when the gathered results cover the key facts of the question.`;
}

function buildResearchSummaryPrompt() {
  return `You are a research assistant. Given a question and search results, produce a concise, well-organized factual summary in Chinese (with a short English key-facts section). Cite sources inline as [1][2] matching the result order. Be factual; do not invent data. Return ONLY plain text (no JSON, no markdown).`;
}

// 执行者小 agent：多轮搜索 → 规划 → 汇总
async function runResearch(seedQuery, signal) {
  agentLog('executor', '开始多轮研究: ' + seedQuery);
  const MAX_ROUNDS = 3;
  let query = seedQuery;
  const gathered = [];   // flatten raw results
  const rounds = [];
  for (let r = 0; r < MAX_ROUNDS; r++) {
    let data = null;
    try { data = await runExecutor(query, signal); }
    catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
      agentLog('executor', '第' + (r + 1) + '轮搜索失败: ' + e.message);
      break;
    }
    const org = (data && data.organic) || [];
    agentLog('executor', '第' + (r + 1) + '轮搜索「' + query + '」→ ' + org.length + ' 条结果');
    rounds.push({ round: r + 1, query, organic: org.slice(0, 5).map(x => ({ title: x.title, link: x.link, snippet: x.snippet })) });
    gathered.push(...org.slice(0, 5));
    // 规划：够了没？还要不要跟进一轮
    try {
      const planRaw = await callAPI([
        { role: 'system', content: buildResearchPlannerPrompt() },
        { role: 'user', content: '原始问题: ' + seedQuery + '\n\n已收集的资料:\n' + formatSearchResults(data) }
      ], { temperature: 0.3, maxTokens: 800, signal });
      const plan = tryParseJSON(stripThinking(planRaw)) || tryParseJSON(extractChatReply(planRaw));
      if (!plan || plan.done === true) { agentLog('executor', '规划器判定资料已足够（第' + (r + 1) + '轮）'); break; }
      if (plan.follow_up && String(plan.follow_up).trim()) {
        query = String(plan.follow_up).trim().substring(0, 120);
        agentLog('executor', '规划器要求跟进搜索: ' + query);
      } else break;
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
      agentLog('executor', '规划器调用失败，停止加轮: ' + e.message);
      break;
    }
  }
  // 汇总成研究报告
  let summary = '';
  try {
    const sumRaw = await callAPI([
      { role: 'system', content: buildResearchSummaryPrompt() },
      { role: 'user', content: '问题: ' + seedQuery + '\n\n收集到的资料:\n' + formatSearchResults({ organic: gathered }) }
    ], { temperature: 0.4, maxTokens: 3000, signal });
    summary = extractChatReply(sumRaw) || stripThinking(sumRaw);
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
    summary = formatSearchResults({ organic: gathered }) || '（未收集到有效资料）';
  }
  agentLog('executor', '研究完成，共 ' + rounds.length + ' 轮，结论 ' + summary.length + ' 字');
  return { summary, rounds, gathered: gathered.slice(0, 5).map(x => ({ title: x.title, link: x.link })) };
}

/* ---------- 流式输出 ---------- */
// 处理一行 SSE data: 负载，返回增量文本；不完整 JSON 返回空字符串
function consumeSSE(payload) {
  if (!payload || payload === '[DONE]') return '';
  try {
    const obj = JSON.parse(payload);
    const delta = (obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content) || '';
    return delta || '';
  } catch (e) {
    return ''; // partial frame — 不足一帧时不消费
  }
}

async function streamChat(messages, onDelta, signal) {
  const body = { model: MODEL, messages: messages, temperature: 0.9, max_tokens: 4000, stream: true };
  const res = await fetch((BACKEND_URL || '') + '/api/proxy/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    signal,
    body: JSON.stringify(body)
  });
  if (!res.ok || !res.body) throw new Error('stream HTTP ' + res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  const handleLine = (line, flush) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    if (flush) buffer = ''; // 尾部行处理时不再回存
    const delta = consumeSSE(t.slice(5).trim());
    if (delta) { full += delta; onDelta(delta); }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) handleLine(line, false);
  }
  // EOF：flush decoder 的尾部多字节序列，并处理没有换行结尾的最后一行
  buffer += decoder.decode();
  for (const line of buffer.split('\n')) { if (line.trim()) handleLine(line, false); }
  llmLog('streamChat', body, full, '');
  return full;
}

/* ---------- 增量 JSON 字段渲染（词典/翻译流式时，每个字段完成即渲染） ---------- */
// 从原始 JSON 文本中提取指定 key 的完整值（string/array/object），若值未闭合返回 null
function extractBalancedValue(raw, key) {
  const re = new RegExp('"' + key + '"[^:]*:\\s*([\"\\[\\{])');
  const m = re.exec(raw);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  const openChar = m[1];
  if (openChar === '"') {
    // 找字符串结束
    let inStr = false, esc = false;
    for (let i = start + 1; i < raw.length; i++) {
      const c = raw[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') return raw.substring(start, i + 1);
    }
    return null;
  }
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 1, inStr2 = false;
  for (let i = start + 1; i < raw.length; i++) {
    const c = raw[i];
    if (inStr2) { if (c === '\\') { i++; continue; } if (c === '"') inStr2 = false; continue; }
    if (c === '"') { inStr2 = true; continue; }
    if (c === openChar) depth++;
    if (c === closeChar) { depth--; if (depth === 0) return raw.substring(start, i + 1); }
  }
  return null;
}

// 渲染单个词典字段（用于增量渲染）
function renderDictField(key, value, dictType) {
  if (!value) return '';
  const s = String(value).trim();
  if (key === 'type' && s) return '<div class="dict-type" style="font-size:11px;color:var(--text2);margin-bottom:4px">📄 ' + esc(s) + '</div>';
  if (key === 'word') return '<div style="font-weight:700;font-size:18px;margin-bottom:4px;color:var(--text)">' + esc(s) + '</div>';
  if (key === 'phonetic') return '<div style="font-size:13px;color:var(--text2);margin-bottom:4px;font-family:monospace">' + esc(s) + '</div>';
  if (key === 'part') return '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;font-style:italic">' + esc(s) + '</div>';
  if (key === 'translation') return '<div style="font-size:14px;color:var(--green);margin-bottom:6px;font-weight:600">' + renderMD(s) + '</div>';
  if (key === 'breakdown') return '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;padding:8px;background:var(--primary-bg);border-radius:8px;line-height:1.6" class="md-content">' + renderMD(s) + '</div>';
  if (key === 'original') return '<div style="font-size:13px;color:var(--text2);margin-bottom:4px;font-style:italic">' + esc(s) + '</div>';
  if (key === 'question_suggestion') return '<div style="font-size:12px;color:var(--text2);margin-top:6px;border-top:1px dashed var(--border);padding-top:4px"><b>💡 建议问句</b> ' + esc(s) + '</div>';
  // 数组字段暂不在这里处理（由完整渲染统一处理）
  return '';
}

/* ---------- 流式词典/翻译（与 streamChat 类似，但接受自定义 options） ---------- */
async function streamDict(messages, options, onDelta, signal) {
  const body = { model: MODEL, messages: messages, temperature: options.temperature ?? 0.3, max_tokens: options.maxTokens ?? 3000, stream: true };
  if (options.thinking !== undefined) body.thinking = options.thinking;
  const res = await fetch((BACKEND_URL || '') + '/api/proxy/chat/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, signal, body: JSON.stringify(body)
  });
  if (!res.ok || !res.body) throw new Error('stream HTTP ' + res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let lastReasoningUpdate = 0;
  const handleLine = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const obj = JSON.parse(payload);
      const delta = (obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content) || '';
      const reasoning = (obj.choices && obj.choices[0] && obj.choices[0].delta && (obj.choices[0].delta.reasoning_content || obj.choices[0].delta.thinking)) || '';
      if (reasoning && !full && Date.now() - lastReasoningUpdate > 2000) {
        // 模型还在思考中，显示提示防止用户以为卡住了
        lastReasoningUpdate = Date.now();
        onDelta('⏳ 思考中...');
      }
      if (delta) { full += delta; onDelta(delta); }
    } catch (e) { /* partial frame — wait for more data */ }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) handleLine(line);
  }
  // EOF：flush 尾部多字节序列 + 处理没有换行结尾的最后一行，避免丢失最后一个 token/字段
  buffer += decoder.decode();
  for (const line of buffer.split('\n')) { if (line.trim()) handleLine(line); }
  llmLog('streamDict', body, full, '');
  return full;
}

function addStreamingBubble(msgId) {
  removeTyping();
  const m = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.dataset.msgId = msgId;
  div.innerHTML = '<div class="avatar">🤖</div><div class="bubble ai-bubble"><div class="ai-text"></div></div>';
  m.appendChild(div);
  scrollToBottom();
  return div;
}

function appendStreamDelta(msgId, delta) {
  // 节流：delta 先进缓冲区，用 requestAnimationFrame 每帧批量写入一次。
  // 避免每个 token 都做 textContent +=（O(n²) 全量重建）和滚动布局计算。
  const el = document.querySelector(`.msg.ai[data-msg-id="${msgId}"] .ai-text`);
  if (!el) return;
  if (_streamThrottle.el !== el) {
    _streamThrottle.el = el;
    _streamThrottle.buf = '';
  }
  _streamThrottle.buf += delta;
  if (!_streamThrottle.raf) {
    _streamThrottle.raf = requestAnimationFrame(() => {
      _streamThrottle.raf = null;
      const target = _streamThrottle.el;
      const text = _streamThrottle.buf;
      _streamThrottle.buf = '';
      if (!target) return;
      // 追加到已有文本节点，避免反复重建整段字符串
      const firstText = target.firstChild && target.firstChild.nodeType === 3 ? target.firstChild : null;
      if (firstText) firstText.appendData(text);
      else target.appendChild(document.createTextNode(text));
      scrollToBottom();
    });
  }
}

function clearStreamBubble(msgId) {
  const el = document.querySelector(`.msg.ai[data-msg-id="${msgId}"] .ai-text`);
  if (el) el.textContent = '';
}

// 流式或非流式调用一次完整回复；流式失败自动回退非流式
async function streamOrCall(messages, aiMsgId, live, signal) {
  if (streamChatEnabled) {
    try {
      return await streamChat(messages, (d) => appendStreamDelta(aiMsgId, d), signal);
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
      dbg('STREAM_ERR', e.message);
      if (live && live.remove) live.remove();
      const chatRaw = await callAPI(messages, { signal });
      return extractChatReply(chatRaw);
    }
  }
  const chatRaw = await callAPI(messages, { signal });
  return extractChatReply(chatRaw);
}

/* ---------- JSON Parsing ---------- */
function parseAIResponse(content) {
  if (!content) return { reply: '(empty response)', analysis: null, corrections: [], extensions: [], new_words: [] };
  // Direct parse: could be chat response (has "reply") or analysis response (has "analysis")
  let obj = tryParseJSON(content);
  if (obj) {
    if (obj.reply) return obj;
    if (obj.analysis) {
      return {
        reply: obj.reply || '',
        analysis: obj.analysis || null,
        corrections: obj.corrections || [],
        extensions: obj.extensions || [],
        new_words: obj.new_words || []
      };
    }
  }
  // Strip thinking and try again
  const cleaned = stripThinking(content);
  obj = tryParseJSON(cleaned);
  if (obj) {
    if (obj.reply) return obj;
    if (obj.analysis) {
      return {
        reply: obj.reply || '',
        analysis: obj.analysis || null,
        corrections: obj.corrections || [],
        extensions: obj.extensions || [],
        new_words: obj.new_words || []
      };
    }
  }
  // Extract JSON anchored on "reply" or "analysis"
  obj = extractJSONObject(cleaned, 'reply') || extractJSONObject(cleaned, 'analysis');
  if (obj) {
    if (obj.reply) return obj;
    if (obj.analysis) {
      return {
        reply: obj.reply || '',
        analysis: obj.analysis || null,
        corrections: obj.corrections || [],
        extensions: obj.extensions || [],
        new_words: obj.new_words || []
      };
    }
  }
  // Regex fallback
  const rm = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (rm) {
    const reply = rm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return { reply, analysis: null, corrections: [], extensions: [], new_words: [] };
  }
  return { reply: cleaned.trim() || '(no response)', analysis: null, corrections: [], extensions: [], new_words: [] };
}

function stripThinking(text) {
  if (!text) return '';
  let s = text;
  // Remove <thinking>...</thinking> blocks (with close tag)
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // Remove <think>...</think> blocks (MiniMax-M3 emits <think> without "ing")
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Remove <thinking> prefix (no close tag)
  s = s.replace(/^<thinking>\s*/i, '');
  s = s.replace(/^<think>\s*/i, '');
  // Remove <Thought>...</Thought> blocks
  s = s.replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/```(?:json)?[\s\S]*?```/g, '');
  // Strip thinking prefix: "thinking" or "Thought" followed by reasoning
  const thinkStart = s.match(/^\s*(?:thinking|Thought|Reasoning)\s*[:.-]?\s*/i);
  if (thinkStart) {
    let rest = s.slice(thinkStart[0].length);
    // If there's a JSON object, grab from first brace
    const fb = rest.indexOf('{');
    if (fb !== -1) {
      // Only strip up to brace if the prefix before it is long reasoning
      const prefix = rest.slice(0, fb).trim();
      if (prefix.length > 30 || /let me|the user|i should|analy/i.test(prefix)) {
        rest = rest.slice(fb);
      }
    }
    // Split by double newline and take the last meaningful part
    const parts = rest.split(/\n\s*\n/);
    if (parts.length > 1) {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim().length > 10) {
          rest = parts[i].trim();
          break;
        }
      }
    }
    s = rest;
  }
  // Also handle the case where content starts with reasoning but no "thinking" keyword
  else {
    const fb = s.indexOf('{');
    if (fb > 30) {
      const prefix = s.slice(0, fb).trim();
      if (/^(the user|let me|i should|this is|here's)/i.test(prefix) || prefix.length > 60) {
        s = s.slice(fb);
      }
    }
  }
  return s.trim();
}

function extractJSONObject(text, anchorKey) {
  if (!text) return null;
  const key = anchorKey || 'reply';
  const keyIdx = text.indexOf('"' + key + '"');
  if (keyIdx !== -1) {
    const openBrace = text.lastIndexOf('{', keyIdx);
    const closeBrace = text.lastIndexOf('}');
    if (openBrace !== -1 && closeBrace > openBrace) {
      const obj = tryParseJSON(text.slice(openBrace, closeBrace + 1));
      if (obj && obj[key]) return obj;
    }
  }
  // Fallback: first { to last }
  const fb = text.indexOf('{');
  const lb = text.lastIndexOf('}');
  if (fb !== -1 && lb > fb) {
    const obj = tryParseJSON(text.slice(fb, lb + 1));
    if (obj && (obj[key] || obj.analysis || obj.reply)) return obj;
  }
  return null;
}

/* ============================================================
   高容忍度 JSON 解析：
   直接解析失败 → 剥离思维块/代码围栏/说明文字 → 提取平衡 JSON 块
   → 状态机修复常见不规范（尾逗号、注释、智能引号、单引号、
   未加引号的键、字符串内控制字符）→ 重试解析。
   全部失败时返回 null，调用方可选择重试。
============================================================ */
function tryJSON(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  try {
    const obj = JSON.parse(s);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch (e) { return null; }
}

// 以字符串感知方式提取文本中所有平衡的 JSON 块（{...} 或 [...]）
function extractBalancedBlocks(text) {
  const blocks = [];
  const n = text.length;
  let inStr = false, depth = 0, start = -1;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') {
      if (start === -1) start = i;
      depth++;
    } else if (c === '}' || c === ']') {
      if (start !== -1) {
        depth--;
        if (depth === 0) { blocks.push(text.slice(start, i + 1)); start = -1; depth = 0; }
      }
    }
  }
  if (start !== -1) blocks.push(text.slice(start));   // 未闭合：尽力而为
  return blocks;
}

// 状态机修复常见的不规范 JSON
function repairJSON(s) {
  if (typeof s !== 'string') return s;
  let src = s.replace(/^\uFEFF/, '');
  src = src.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  let out = '';
  let inStr = false;
  let prevSig = '';    // 上一个非空白字符
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') {
        const nx = src[i + 1];
        out += (nx === undefined) ? '\\\\' : ((nx === "'") ? "'" : ('\\' + nx));
        i += 2; continue;
      }
      if (c === '"') { inStr = false; out += c; i++; continue; }
      const code = c.charCodeAt(0);
      if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); i++; continue; }
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; prevSig = '"'; i++; continue; }
    if (c === "'") {
      // 单引号字符串 → 双引号（带撇号启发式：don't 不当作字符串结束）
      inStr = true; out += '"'; i++;
      while (i < n) {
        const d = src[i];
        if (d === '\\') {
          const nx = src[i + 1];
          out += (nx === "'") ? "'" : ('\\' + nx);
          i += 2; continue;
        }
        if (d === "'") {
          const prevIsWord = i > 0 && /[A-Za-z0-9]/.test(src[i - 1]);
          const nextIsWord = i + 1 < n && /[A-Za-z0-9]/.test(src[i + 1]);
          if (prevIsWord && nextIsWord) { out += "'"; i++; continue; }   // 撇号
          inStr = false; out += '"'; i++; break;
        }
        if (d === '"') { out += '\\"'; i++; continue; }
        const dc = d.charCodeAt(0);
        if (dc < 0x20) { out += '\\u' + dc.toString(16).padStart(4, '0'); i++; continue; }
        out += d; i++;
      }
      prevSig = '"'; continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === ',') {
      let j = i + 1; while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === '}' || src[j] === ']') { i++; continue; }   // 尾逗号
      out += c; prevSig = ','; i++; continue;
    }
    if (/\s/.test(c)) { out += c; i++; continue; }
    // 未加引号的键：{ 或 , 后紧跟标识符 + :
    if ((prevSig === '{' || prevSig === ',') && /[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const ident = src.slice(i, j);
      let k = j; while (k < n && /\s/.test(src[k])) k++;
      if (src[k] === ':') { out += '"' + ident + '"'; i = j; prevSig = ident; continue; }
    }
    out += c; prevSig = c; i++;
  }
  return out.trim();
}

// 主入口：高容忍解析。
// 注意：这里用"温和清理"（思维块删除、代码围栏【提取内容而非删除】），
// 而不是 stripThinking（stripThinking 会整体删掉围栏内容，导致围栏内 JSON 丢失）。
function smartParseJSON(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const direct = tryJSON(text);
  if (direct) return direct;
  let cleaned = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');   // 围栏 → 内容
  const direct2 = tryJSON(cleaned);
  if (direct2) return direct2;
  const blocks = extractBalancedBlocks(cleaned);
  // 优先对象块（dict/分析/策略师都是对象），再试数组块
  const ordered = [...blocks.filter(b => b.trim().startsWith('{')), ...blocks.filter(b => b.trim().startsWith('['))];
  for (const block of ordered) {
    const o = tryJSON(block);
    if (o) return o;
    const o2 = tryJSON(repairJSON(block));
    if (o2) return o2;
  }
  return null;
}

function tryParseJSON(s) { return smartParseJSON(s); }

// 调用模型并高容忍解析 JSON；解析失败时自动重试（最多 attempts 次，重试追加严格约束）
async function callAndParseJSON(messages, options, expectedCheck, attempts) {
  attempts = attempts || 3;
  let raw = '';
  const baseSystem = messages[0] ? messages[0].content : '';
  for (let i = 0; i < attempts; i++) {
    const msgs = i === 0 ? messages : [
      { role: 'system', content: baseSystem +
        '\n\nIMPORTANT (retry ' + i + '): Output ONLY a single valid strict JSON object. No markdown fences, no thinking tags, no extra prose, no trailing commas. Use double quotes everywhere.' },
      ...messages.slice(1)
    ];
    raw = await callAPI(msgs, {
      temperature: i === 0 ? (options.temperature ?? 0.4) : 0.15,
      maxTokens: options.maxTokens,
      signal: options.signal
    });
    const obj = smartParseJSON(raw);
    if (obj && (!expectedCheck || expectedCheck(obj))) return { obj, raw };
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 500));
  }
  return { obj: null, raw };
}

/* ---------- Chat Reply Extraction ---------- */
function extractChatReply(content) {
  if (!content) return '';
  let s = content;
  // Remove <thinking>...</thinking> blocks (with close tag)
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // Remove <think>...</think> blocks (MiniMax-M3 emits <think> without "ing")
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Remove <thinking> prefix (no close tag — MiniMax-M3 sometimes does this)
  s = s.replace(/^<thinking>\s*/i, '');
  s = s.replace(/^<think>\s*/i, '');
  // Remove <Thought>...</Thought> blocks
  s = s.replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/```[\s\S]*?```/g, '');
  // If starts with "thinking" or "Thought" keyword, strip the reasoning section
  const thinkMatch = s.match(/^\s*(?:thinking|Thought|reasoning)\s*[:.-]?\s*([\s\S]*)/i);
  if (thinkMatch) {
    let rest = thinkMatch[1].trim();
    const parts = rest.split(/\n\s*\n/);
    if (parts.length > 1) {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim().length > 10) {
          rest = parts[i].trim();
          break;
        }
      }
    }
    s = rest;
  } else {
    // No "thinking" keyword found — the content might be <thinking>tag + reasoning + answer
    // Split by double newline and take the last meaningful paragraph
    const parts = s.split(/\n\s*\n/);
    if (parts.length > 1) {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim().length > 15) {
          s = parts[i].trim();
          break;
        }
      }
    }
  }
  // If it looks like JSON with a reply, extract it
  if (s.includes('"reply"')) {
    const obj = extractJSONObject(s);
    if (obj && obj.reply) return obj.reply;
  }
  return s.trim();
}

/* ---------- Message version tree ---------- */
function makeNode(role, content, feedback) {
  return {
    id: genMsgId(),
    role: role,
    variants: [{ content: content, feedback: feedback || null, next: [] }],
    activeVariant: 0
  };
}
function activeVariant(node) {
  return node.variants[node.activeVariant];
}
// Flatten active branch path into linear message objects
function getActivePath() {
  const out = [];
  function walk(nodes) {
    for (const n of nodes) {
      const v = activeVariant(n);
      out.push({ role: n.role, content: v.content, id: n.id, feedback: v.feedback, strategy: v.strategy, research: v.research, node: n });
      walk(v.next);
    }
  }
  walk(conversation);
  return out;
}
// Append a node to the end of the active path
function appendToEnd(node) {
  const path = getActivePath();
  if (path.length) {
    activeVariant(path[path.length - 1].node).next.push(node);
  } else {
    conversation.push(node);
  }
}
// Find a node by id (search whole tree)
function findNode(id, nodes) {
  if (nodes === undefined) nodes = conversation;
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(id, activeVariant(n).next);
    if (found) return found;
  }
  return null;
}
// Truncate all nodes after the given node in the active path
function truncateAfter(node) {
  function cut(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] === node) {
        nodes.splice(i + 1, nodes.length - i - 1);
        return true;
      }
      const v = activeVariant(nodes[i]);
      if (cut(v.next)) return true;
    }
    return false;
  }
  cut(conversation);
}
// Remove a node and its subtree from the active tree
function removeNodeFromTree(id) {
  function cut(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        nodes.splice(i, 1);
        return true;
      }
      if (cut(activeVariant(nodes[i]).next)) return true;
    }
    return false;
  }
  cut(conversation);
}
// Migrate old flat messages into the version-tree structure
function migrateConversation(msgs) {
  if (!msgs || !msgs.length) return [];
  // If already in new format (has variants), just use it
  if (msgs[0] && msgs[0].variants) return msgs;
  const nodes = [];
  for (const m of msgs) {
    nodes.push(makeNode(m.role, m.content, m.feedback || null));
  }
  // Chain them: each node's next = the following node
  for (let i = 0; i < nodes.length - 1; i++) {
    activeVariant(nodes[i]).next = [nodes[i + 1]];
  }
  return nodes;
}

/* ---------- Chat Rendering ---------- */
function addAiTyping() {
  removeTyping();
  const m = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ai'; div.id = 'typingMsg';
  div.innerHTML = '<div class="avatar">🤖</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  m.appendChild(div);
  scrollToBottom();
}

function removeTyping() {
  const t = document.getElementById('typingMsg');
  if (t) t.remove();
}

function tryExtractReply(text) {
  const cleaned = stripThinking(text);
  try {
    const obj = JSON.parse(cleaned);
    if (obj.reply) return obj.reply;
  } catch(e) {}
  const m = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  return null;
}

/* 在 DOM 中渲染已还原的 .math-raw 数学片段（KaTeX 未加载时保留转义文本） */
function renderChatMath(root) {
  if (!root || typeof katex === 'undefined') return;
  root.querySelectorAll('.math-raw').forEach(span => {
    const tex = span.textContent;   // textContent 会把 &lt; 还原为 <
    const display = span.dataset.display === '1';
    try { katex.render(tex, span, { displayMode: display, throwOnError: false }); }
    catch (e) { /* 渲染失败保留原文本 */ }
  });
}

function addAiMessage(msg) {
  removeTyping();
  let text = msg.content || '';
  const stripped = stripThinking(text).trim();
  if (stripped && (stripped.startsWith('{') || text.includes('"reply"'))) {
    const s = tryExtractReply(text);
    if (s) text = s;
  } else {
    text = stripped;
  }
  const m = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.dataset.msgId = msg.id || '';
  const textAttr = esc(text.replace(/"/g, '&quot;'));
  const msgIdAttr = esc(msg.id || '');
  div.innerHTML = `<div class="avatar">🤖</div><div class="bubble ai-bubble"><div class="ai-text md-content">${renderMD(text)}</div><div class="ai-msg-actions"><button class="tts-btn" data-text="${textAttr}" onclick="speakText(this)" title="朗读">🔊 朗读</button><button class="tts-btn" onclick="translateAiMessage('${msgIdAttr}', this)" title="翻译整段">🌐 翻译</button></div></div>`;
  m.appendChild(div);
  renderChatMath(div.querySelector('.ai-text'));
  scrollToBottom();
  return div;
}

/* ---------- AI 回复整段翻译 ---------- */
async function translateAiMessage(msgId, btn) {
  const div = btn && btn.closest('.msg.ai');
  const node = findNode(msgId);
  let text = '';
  if (node) {
    text = activeVariant(node).content || '';
  } else if (div) {
    const el = div.querySelector('.ai-text');
    text = el ? el.textContent : '';
  }
  if (!text.trim()) { toastMsg('没有可翻译的内容'); return; }

  // 翻译结果容器（在消息下方展开）
  let container = div && div.querySelector('.ai-translate');
  if (!container) {
    container = document.createElement('div');
    container.className = 'ai-translate';
    container.style.cssText = 'margin-top:8px;padding:8px 10px;background:var(--primary-bg);border-radius:8px;font-size:13px;line-height:1.7;color:var(--text);border-left:3px solid var(--primary)';
    const bubble = div.querySelector('.ai-bubble');
    if (bubble) bubble.appendChild(container);
  }
  container.style.display = 'block';
  container.innerHTML = '⏳ 翻译中...';

  try {
    const systemPrompt = 'You are a professional translator. Translate the following English chat message into natural Simplified Chinese. Preserve tone and meaning. Return ONLY the Chinese translation, no JSON, no explanation.';
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }];
    let acc = '';
    await streamDict(messages, { temperature: 0.3, maxTokens: 4000, thinking: { type: 'disabled' } }, (d) => {
      acc += d;
      container.innerHTML = '<div class="ai-translate-label" style="font-size:11px;color:var(--text2);margin-bottom:4px">🌐 中文翻译</div><div style="white-space:pre-wrap">' + esc(acc) + '</div>';
    }, AbortSignal.timeout(60000));
    container.innerHTML = '<div class="ai-translate-label" style="font-size:11px;color:var(--text2);margin-bottom:4px">🌐 中文翻译</div><div style="white-space:pre-wrap">' + esc(acc || '(空)') + '</div>';
  } catch (e) {
    container.innerHTML = '<span style="color:var(--red)">翻译失败: ' + esc(e.message || '') + '</span>';
  }
}

function userBubbleHTML(msg) {
  const hint = msg.feedback && msg.feedback.analysis ? '<span class="feedback-hint">✓ 已反馈</span>' : '';
  return `
    <div class="avatar">👤</div>
    <div class="bubble user-bubble" onclick="selectFeedback('${msg.id}')">
      <div class="user-text">${esc(msg.content)}</div>
      <div class="msg-actions">
        ${hint}
        <button class="msg-btn" onclick="event.stopPropagation();editMessage('${msg.id}')" title="编辑">✏️</button>
        <button class="msg-btn" onclick="event.stopPropagation();deleteMessage('${msg.id}')" title="删除">🗑️</button>
      </div>
    </div>`;
}

function addUserMessage(msg) {
  const m = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg user';
  div.dataset.msgId = msg.id || '';
  div.innerHTML = userBubbleHTML(msg);
  m.appendChild(div);
  scrollToBottom();
  return div;
}

function renderMessages() {
  const m = document.getElementById('messages');
  // Preserve scroll position: remember if user was near the bottom and the offset-from-bottom
  const wasNearBottom = m.scrollHeight > 0 && (m.scrollTop + m.clientHeight >= m.scrollHeight - 100);
  const distFromBottom = Math.max(0, m.scrollHeight - m.scrollTop - m.clientHeight);
  const hadScroll = m.scrollHeight > 0;

  // Temporarily suppress scrollToBottom during rebuild (addAiMessage/addUserMessage call it)
  const prevScrollMode = _suppressAutoScroll;
  _suppressAutoScroll = true;
  m.innerHTML = '';
  const path = getActivePath();
  for (const item of path) {
    if (item.role === 'assistant') addAiMessage(item);
    else addUserMessage(item);
    // Render variant switcher if the node has multiple versions
    const node = item.node;
    if (node.variants.length > 1) {
      const sw = document.createElement('div');
      sw.className = 'variant-switcher';
      sw.dataset.msgId = node.id;
      sw.innerHTML = `
        <button class="vs-btn" onclick="switchVariant('${node.id}', -1)" ${node.activeVariant === 0 ? 'disabled' : ''}>←</button>
        <span class="vs-label">${node.activeVariant + 1}/${node.variants.length} 版本</span>
        <button class="vs-btn" onclick="switchVariant('${node.id}', 1)" ${node.activeVariant === node.variants.length - 1 ? 'disabled' : ''}>→</button>`;
      m.appendChild(sw);
    }
  }
  _suppressAutoScroll = prevScrollMode;

  if (selectedMsgId) {
    document.querySelectorAll('.msg.user').forEach(el => {
      el.classList.toggle('selected', el.dataset.msgId === selectedMsgId);
    });
  }
  // Restore scroll: if user was near bottom, go to bottom; otherwise keep same distance from bottom
  if (hadScroll && wasNearBottom) {
    m.scrollTop = m.scrollHeight;
  } else if (hadScroll) {
    m.scrollTop = Math.max(0, m.scrollHeight - distFromBottom - m.clientHeight);
  }
}

function switchVariant(msgId, delta) {
  const node = findNode(msgId);
  if (!node) return;
  const newIdx = node.activeVariant + delta;
  if (newIdx < 0 || newIdx >= node.variants.length) return;
  node.activeVariant = newIdx;
  // Re-select feedback if the selected message is on the new path
  const path = getActivePath();
  const stillThere = path.some(p => p.id === selectedMsgId);
  if (!stillThere) selectedMsgId = null;
  renderMessages();
  if (selectedMsgId) {
    renderFeedbackForMsg(selectedMsgId);
  } else {
    document.getElementById('analysisContent').innerHTML = '<div class="empty">点击右侧聊天中的一条消息查看其反馈</div>';
  }
  saveConversation(conversation);
}

function scrollToBottom() {
  const m = document.getElementById('messages');
  // If we're in the middle of a full re-render, skip (renderMessages restores scroll at the end)
  if (_suppressAutoScroll) return;
  // Only auto-scroll if user was already near the bottom
  if (m.scrollTop + m.clientHeight >= m.scrollHeight - 100) {
    m.scrollTop = m.scrollHeight;
  }
}

/* ---------- Feedback Selection ---------- */
function selectFeedback(userMsgId) {
  selectedMsgId = userMsgId;
  document.querySelectorAll('.msg.user').forEach(el => {
    el.classList.toggle('selected', el.dataset.msgId === userMsgId);
  });
  renderFeedbackForMsg(userMsgId);
}

// Lightweight: update the "✓ 已反馈" hint on a user message bubble without re-rendering the whole chat.
// This avoids the scroll-jump caused by renderMessages() (which clears messages -> scrollTop resets to top).
function updateFeedbackHint(userMsgId) {
  const node = findNode(userMsgId);
  if (!node || node.role !== 'user') return;
  const el = document.querySelector(`.msg.user[data-msg-id="${userMsgId}"]`);
  if (!el) return;
  const v = activeVariant(node);
  const hasFeedback = !!(v.feedback && v.feedback.analysis);
  let hint = el.querySelector('.feedback-hint');
  if (hasFeedback) {
    if (!hint) {
      const actions = el.querySelector('.msg-actions');
      if (actions) actions.insertAdjacentHTML('afterbegin', '<span class="feedback-hint">✓ 已反馈</span>');
    }
  } else {
    if (hint) hint.remove();
  }
}

function renderFeedbackForMsg(userMsgId) {
  const node = findNode(userMsgId);
  const el = document.getElementById('analysisContent');
  if (!node || node.role !== 'user') {
    el.innerHTML = '<div class="empty">点击右侧聊天中的一条消息查看其反馈</div>';
    return;
  }
  const v = activeVariant(node);
  const parsed = v.feedback;
  let html = `<div class="feedback-context"><div class="fc-label">📝 我的回答</div><div class="fc-text">${esc(v.content)}</div></div>`;
  if (!parsed || !parsed.analysis) {
    if (parsed && parsed.error) {
      html += '<div class="empty" style="margin-top:10px;color:var(--red)">⚠️ ' + esc(parsed.error) + '</div>';
      html += '<div style="text-align:center;margin-top:10px"><button class="retry-btn" onclick="retryAnalysis(\'' + userMsgId + '\')">🔄 重新分析</button></div>';
    } else {
      html += '<div class="empty" style="margin-top:10px">该消息暂无反馈</div>';
      html += '<div style="text-align:center;margin-top:10px"><button class="retry-btn" onclick="retryAnalysis(\'' + userMsgId + '\')">🔄 生成反馈</button></div>';
    }
    el.innerHTML = html;
    return;
  }
  const a = parsed.analysis;
  const scoreColor = s => s >= 8 ? 'var(--green)' : s >= 6 ? 'var(--amber)' : 'var(--red)';
  html += '<div class="score-grid">';
  const dims = [['语法 Grammar', a.grammar], ['表意 Expression', a.expression], ['搭配 Collocation', a.collocation], ['文采 Style', a.style]];
  dims.forEach(([label, d]) => {
    if (!d) return;
    const s = d.score || 0;
    html += `<div class="score-card"><div class="label">${label}</div><div class="val" style="color:${scoreColor(s)}">${s}<span style="font-size:12px;color:var(--text2)">/10</span></div><div class="bar"><div class="bar-fill" style="width:${s*10}%;background:${scoreColor(s)}"></div></div><div class="comment md-content">${renderMD(d.comment || '', 'markdown')}</div></div>`;
  });
  html += '</div>';

  // Corrections as cards
  if (parsed.corrections && parsed.corrections.length) {
    html += '<h3 style="font-size:12px;margin:14px 0 8px;color:var(--text2)">✏️ 纠错建议</h3><div class="corr-list">';
    parsed.corrections.forEach((c, i) => {
      const type = c.type || 'grammar';
      const rule = c.rule ? ' · ' + esc(c.rule) : '';
      const example = c.example ? `<div class="corr-example">💡 ${renderMD(c.example, 'markdown')}</div>` : '';
      html += `<div class="corr-card"><div class="corr-head"><span class="corr-num">${i+1}</span><span class="corr-type">${esc(type)}${rule}</span></div><div class="corr-change"><span class="orig">${esc(c.original)}</span> → <span class="fixed">${esc(c.corrected)}</span></div><div class="corr-why md-content">${renderMD(c.explanation || '')}</div>${example}</div>`;
    });
    html += '</div>';
  }

  // Extensions as cards
  if (parsed.extensions && parsed.extensions.length) {
    html += '<h3 style="font-size:12px;margin:14px 0 8px;color:var(--text2)">💡 拓展知识</h3><div class="ext-list">';
    parsed.extensions.forEach(e => {
      const title = e.title ? esc(e.title) : esc(e.type || '');
      html += `<div class="ext-card"><div class="ext-head"><span class="type ${esc(e.type || 'knowledge')}">${esc(e.type || 'knowledge')}</span><span class="ext-title">${title}</span></div><div class="content md-content">${renderMD(e.content, 'markdown')}</div></div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html;
  renderVocab();
  renderWeak();
}

/* ---------- Vocab/Weak Render ---------- */
function renderVocab() {
  const v = getVocab();
  const countEl = document.getElementById('wordCount');
  if (countEl) countEl.textContent = v.length;
  const el = document.getElementById('vocabContent');
  if (!v.length) { el.innerHTML = '<div class="empty">划选 AI 的回复，点击「加入生词本」</div>'; return; }
  // Use the card layout; each card is clickable to view details
  el.innerHTML = '<div class="vocab-list">' + v.map((item, i) => {
    const translation = (item.translation || '').split('\n')[0] || '';
    const example = item.example ? `<div class="v-example">"${esc(item.example)}"</div>` : '';
    const part = item.part ? `<span class="v-part">${esc(item.part)}</span>` : '';
    const date = item.added ? `<span class="v-date">${esc(item.added)}</span>` : '';
    return `<div class="vocab-card" onclick="showVocabDetail(${i})" title="点击查看详情">
      <div class="v-head"><span class="v-word">${esc(item.word)}</span>${part}<span class="v-hint">📖</span></div>
      <div class="v-meaning">${esc(translation)}</div>
      ${example}
      <div class="v-foot"><span class="v-date">${date}</span><button class="del" onclick="event.stopPropagation();removeWord(${i})" title="删除">×</button></div>
    </div>`;
  }).join('') + '</div>' +
    '<button class="vocab-clear" onclick="clearAllVocab()">清空所有生词</button>';
}

function showVocabDetail(idx) {
  const v = getVocab();
  const item = v[idx];
  if (!item) return;
  removeAllModals();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '生词详情');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:14px;padding:22px;max-width:420px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
  const translation = item.translation || '';
  const details = translation.replace(/\n/g, '<br>');
  modal.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <h3 style="font-size:20px;font-weight:700;color:var(--primary)">${esc(item.word)}</h3>
      <button onclick="this.closest('.modal-overlay').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text2)">×</button>
    </div>
    ${item.part ? `<div style="font-size:12px;color:var(--text2);margin-bottom:8px">${esc(item.part)}</div>` : ''}
    <div style="font-size:14px;line-height:1.8;color:var(--text);margin-bottom:14px" class="md-content">${renderMD(translation, 'markdown')}</div>
    ${item.context ? `<div style="font-size:12px;color:var(--text2);padding:8px 10px;background:var(--bg);border-radius:8px;margin-bottom:10px"><strong>原文语境:</strong> ${esc(item.context)}</div>` : ''}
    ${item.added ? `<div style="font-size:11px;color:var(--text2);margin-bottom:12px">📅 添加于 ${esc(item.added)}</div>` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('.modal-overlay').remove()" style="padding:7px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:13px;cursor:pointer">知道了</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}

function clearAllVocab() {
  if (!confirm('确定清空所有生词？')) return;
  saveVocab([]);
  renderVocab();
}

function removeWord(i) {
  const v = getVocab();
  v.splice(i, 1);
  saveVocab(v);
  renderVocab();
}

function renderWeak() {
  // Clean up legacy weak points that shouldn't be tracked (e.g. old "生词" entries)
  const raw = getWeak();
  let changed = false;
  Object.keys(raw).forEach(k => {
    if (raw[k].category === '生词') {
      delete raw[k];
      changed = true;
    }
  });
  if (changed) saveWeak(raw);

  const w = getWeak();
  const el = document.getElementById('weakContent');
  const items = Object.values(w).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 30);
  if (!items.length) { el.innerHTML = '<div class="empty">对话中自动追踪你的薄弱环节</div>'; return; }
  el.innerHTML = items.map(i => {
    const key = encodeURIComponent(i.id || (i.category + '|' + i.point));
    return `<div class="weak-item"><span class="cat">${esc(i.category)}</span>：${esc(i.point)}<span class="cnt">×${i.count || 0}</span>${i.archived ? '<span style="color:var(--green);font-size:10px">✔已掌握</span>' : ''}<button class="del-btn" onclick="deleteWeakPoint('${key}')" title="删除">×</button></div>`;
  }).join('');
}

function deleteWeakPoint(encodedKey) {
  const key = decodeURIComponent(encodedKey);
  const w = getWeak();
  if (w[key]) {
    delete w[key];
    saveWeak(w);
    renderWeak();
  } else {
    // 兼容旧格式（category|point 作为 key）
    for (const [k, v] of Object.entries(w)) {
      if (v && (k.includes(key) || (v.point && key.includes(v.point)))) {
        delete w[k];
        saveWeak(w);
        renderWeak();
        return;
      }
    }
  }
}

function trackWeakPoints(parsed) {
  if (!parsed) return;
  if (parsed.corrections && parsed.corrections.length) {
    parsed.corrections.forEach(c => {
      const rule = c.rule || (c.type || '语法搭配');
      addWeakPoint('语法搭配', (c.original || '').substring(0, 40) + ' → ' + (c.corrected || '').substring(0, 40), '正确说法：' + (c.corrected || '') + (c.explanation ? '；' + c.explanation : ''));
    });
  }
  // 从 weak_points 字段细化追踪（带建议）
  if (parsed.weak_points && parsed.weak_points.length) {
    parsed.weak_points.forEach(wp => {
      const cat = { grammar: '语法', collocation: '搭配', vocabulary: '词汇' }[wp.category] || wp.category || '语法';
      addWeakPoint(cat, (wp.point || '').substring(0, 60), wp.suggestion || '');
    });
  }
}

/* ---------- Anki Integration ----------
   多用户隔离：牌组为 英语学习::<username>::子牌组
   自动出题：弱项 → AI 生成题目 → 推送到 Anki 薄弱点牌组
   网页答题：通过 AnkiConnect GUI 动作驱动 Anki FSRS 排程
   复习数据回流：拉取 Anki 卡片排程 → 更新 weak points 掌握状态
*/
// ---- 牌组/标签工具 ----
function ankiBaseDeck() { return ANKI_DECK_PREFIX + '::' + (currentUser() || 'default'); }
function ankiWeakDeck() { return ankiBaseDeck() + '::薄弱点'; }
function ankiVocabDeck() { return ankiBaseDeck() + '::词汇'; }
function ankiCorrDeck() { return ankiBaseDeck() + '::纠错'; }
function ankiExtDeck() { return ankiBaseDeck() + '::拓展'; }
function ankiUserTag() { return 'ai-english'; }
function wpTag(id) { return 'wp_' + (currentUser() || 'default') + '_' + id; }

// ---- 添加单张卡片（兼容旧调用） ----
async function addToAnki(front, back, tags, deckName) {
  try {
    deckName = deckName || ankiBaseDeck();
    await ensureQuizModelAndDeck();
    const data = await ankiPostCall({
      action: 'addNote', version: 6,
      params: { note: {
        deckName: deckName,
        modelName: 'Basic',
        fields: { Front: front, Back: back },
        tags: tags || [ankiUserTag()]
      } }
    });
    if (!data.ok) throw new Error(data.error || 'anki error');
    if (data.result && data.result.error) throw new Error(data.result.error);
    // AnkiConnect 忽略 deckName 的兜底
    const nid = data.result && data.result.result;
    if (nid) ensureDeckPlacement([{ noteId: nid, deckName }]).catch(() => {});
    return data.result;  // note id
  } catch (e) {
    dbg('ANKI_ADD_ERR', e.message);
    return false;
  }
}

// ---- 批量添加（去重 + 批量） ----
// AnkiConnect 的 addNote/addNotes 忽略 deckName 参数，所有卡片落到"系统默认"牌组。
// 此兜底：添加后立即用 changeDeck 移到目标牌组。
async function ensureDeckPlacement(pairs) {
  // pairs: [{noteId, deckName}, ...]
  if (!pairs || !pairs.length) return;
  const byDeck = {};
  for (const { noteId, deckName } of pairs) {
    if (!noteId || !deckName) continue;
    if (!byDeck[deckName]) byDeck[deckName] = [];
    byDeck[deckName].push(noteId);
  }
  for (const [deck, nids] of Object.entries(byDeck)) {
    try {
      const query = nids.map(n => 'nid:' + n).join(' OR ');
      const res = await ankiPostCall({ action: 'findCards', version: 6, params: { query } });
      const cardIds = res && res.result && res.result.result;
      if (cardIds && cardIds.length) {
        await ankiPostCall({ action: 'changeDeck', version: 6, params: { cards: cardIds, deck } });
      }
    } catch (e) { dbg('DECK_FIX', e.message); }
  }
}

async function ankiAddNotesBatch(notes) {
  if (!notes || !notes.length) return { added: 0, skipped: 0, noteIds: [] };
  try {
    await ensureQuizModelAndDeck();
    // 预检去重
    const canAdd = await ankiPostCall({ action: 'canAddNotes', version: 6, params: { notes } });
    const canResults = canAdd && canAdd.result && canAdd.result.result;
    if (Array.isArray(canResults) && canResults.length) {
      // 过滤掉重复的（记录原索引映射）
      const toAdd = [];
      const idxMap = [];
      notes.forEach((n, i) => { if (canResults[i] !== false) { toAdd.push(n); idxMap.push(i); } });
      const skipped = notes.length - toAdd.length;
      if (!toAdd.length) return { added: 0, skipped, noteIds: [] };
      // 批量添加
      const added = await ankiPostCall({ action: 'addNotes', version: 6, params: { notes: toAdd } });
      const addedResults = added && added.result && added.result.result;
      if (Array.isArray(addedResults)) {
        const noteIds = [];
        const valid = [];
        addedResults.forEach((nid, j) => { if (nid != null && nid !== false) { noteIds.push(nid); valid.push(nid); } });
        // 映射回原始索引对应的 note id（用于关联 weak point）
        const order = [];
        toAdd.forEach((n, j) => { order.push(addedResults[j] != null && addedResults[j] !== false ? addedResults[j] : null); });
        // AnkiConnect 忽略 deckName 的兜底：用 changeDeck 移到正确牌组
        const deckPlacement = [];
        toAdd.forEach((n, j) => {
          const nid = addedResults[j];
          if (nid != null && nid !== false && n.deckName) deckPlacement.push({ noteId: nid, deckName: n.deckName });
        });
        if (deckPlacement.length) ensureDeckPlacement(deckPlacement).catch(() => {});
        return { added: valid.length, skipped: skipped + (addedResults.length - valid.length), noteIds, order };
      }
      return { added: toAdd.length, skipped, noteIds: [], order: [] };
    }
    // fallback: 逐条添加
    let added = 0, skipped = 0;
    const noteIds = [];
    const deckPlacement = [];
    for (const n of notes) {
      try {
        const d = await ankiPostCall({
          action: 'addNote', version: 6,
          params: { note: { deckName: n.deckName, modelName: n.modelName || 'Basic', fields: n.fields, tags: n.tags || [] } }
        });
        if (d && d.result && d.result.result && !d.result.error) { added++; noteIds.push(d.result.result); deckPlacement.push({ noteId: d.result.result, deckName: n.deckName }); }
        else skipped++;
      } catch (e) { skipped++; }
    }
    if (deckPlacement.length) ensureDeckPlacement(deckPlacement).catch(() => {});
    return { added, skipped, noteIds, order: noteIds };
  } catch (e) {
    dbg('ANKI_BATCH_ERR', e.message);
    return { added: 0, skipped: notes.length, noteIds: [], order: [] };
  }
}

// ---- 创建/确保笔记类型 + 牌组 ----
const VOCAB_MODEL = '英语学习-词汇'; // 词汇默写卡片专用模型：Front=中文释义，Back=英文单词

async function ensureQuizModelAndDeck() {
  const [models, decks] = await Promise.all([
    ankiPostCall({ action: 'modelNames', version: 6 }).then(d => d.result && d.result.result).catch(() => null),
    ankiPostCall({ action: 'deckNames', version: 6 }).then(d => d.result && d.result.result).catch(() => null)
  ]);
  // 确保 Basic 模型存在（纠错/拓展使用）
  if (Array.isArray(models) && !models.includes('Basic')) {
    try {
      await ankiPostCall({ action: 'createModel', version: 6, params: {
        modelName: 'Basic',
        inOrderFields: ['Front', 'Back'],
        css: '.card { font-family: Arial; font-size: 18px; text-align: center; }',
        cardTemplates: [{ Name: 'Card 1', Front: '{{Front}}', Back: '{{FrontSide}}<hr id=answer>{{Back}}' }]
      }});
    } catch (e) { dbg('ANKI_MODEL_BASIC', e.message || e); }
  }
  // 创建词汇默写专用模型（美观模板：中文释义→默写英文）
  if (!(Array.isArray(models) && models.includes(VOCAB_MODEL))) {
    try {
      await ankiPostCall({ action: 'createModel', version: 6, params: {
        modelName: VOCAB_MODEL,
        inOrderFields: ['Front', 'Back'],
        css: `.card {
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
  text-align: center; padding: 24px 16px;
  background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
  color: #1e293b;
}
.front-hint {
  font-size: 12px; color: #94a3b8; letter-spacing: 2px;
  margin-bottom: 20px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;
}
.front-meaning {
  font-size: 26px; font-weight: 700; color: #0f172a;
  line-height: 1.6; margin: 20px 0;
}
.front-prompt {
  font-size: 13px; color: #94a3b8; margin-top: 24px;
}
.back-word {
  font-size: 30px; font-weight: 800; color: #0f766e;
  margin: 12px 0; line-height: 1.4;
}
.back-phonetic {
  font-size: 16px; color: #64748b; margin: 6px 0;
  font-family: "IPAexMincho", "Times New Roman", serif;
}
.back-example {
  font-size: 15px; color: #334155; line-height: 1.7;
  margin: 16px 0 6px; padding: 12px; background: #f1f5f9;
  border-radius: 10px; text-align: left;
}
.back-context {
  font-size: 13px; color: #94a3b8; margin-top: 8px;
  font-style: italic;
}
.back-divider {
  border: none; border-top: 1px dashed #cbd5e0; margin: 18px 0;
}`,
        cardTemplates: [{
          Name: '默写',
          Front: `<div class="front-hint">🔤 看词义 · 默写单词</div>
<div class="front-meaning">{{Front}}</div>
<div class="front-prompt">点击显示答案</div>`,
          Back: `{{FrontSide}}
<hr class="back-divider">
<div class="back-word">{{Back}}</div>`
        }]
      }});
    } catch (e) { dbg('ANKI_MODEL_VOCAB', e.message || e); }
  } else {
    // 模型已存在，更新模板样式（确保美观）
    try {
      await ankiPostCall({ action: 'updateModelStyling', version: 6, params: {
        model: { name: VOCAB_MODEL, css: `.card {
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
  text-align: center; padding: 24px 16px;
  background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
  color: #1e293b;
}
.front-hint { font-size: 12px; color: #94a3b8; letter-spacing: 2px; margin-bottom: 20px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px; }
.front-meaning { font-size: 26px; font-weight: 700; color: #0f172a; line-height: 1.6; margin: 20px 0; }
.front-prompt { font-size: 13px; color: #94a3b8; margin-top: 24px; }
.back-word { font-size: 30px; font-weight: 800; color: #0f766e; margin: 12px 0; line-height: 1.4; }
.back-phonetic { font-size: 16px; color: #64748b; margin: 6px 0; font-family: "IPAexMincho", "Times New Roman", serif; }
.back-example { font-size: 15px; color: #334155; line-height: 1.7; margin: 16px 0 6px; padding: 12px; background: #f1f5f9; border-radius: 10px; text-align: left; }
.back-context { font-size: 13px; color: #94a3b8; margin-top: 8px; font-style: italic; }
.back-divider { border: none; border-top: 1px dashed #cbd5e0; margin: 18px 0; }` }
      }});
    } catch (e) { dbg('ANKI_MODEL_VOCAB_STYLE', e.message || e); }
  }
  // 创建专用笔记类型（薄弱点出题用）
  if (!(Array.isArray(models) && models.includes(ANKI_QUIZ_MODEL))) {
    try {
      await ankiPostCall({ action: 'createModel', version: 6, params: {
        modelName: ANKI_QUIZ_MODEL,
        inOrderFields: ANKI_QUIZ_FIELDS,
        css: '.card { font-family: Arial, sans-serif; font-size: 18px; text-align: center; color: #333; } .answer { font-size: 20px; font-weight: bold; color: #15803d; } .explanation { font-size: 14px; color: #888; margin-top: 8px; }',
        cardTemplates: [{
          Name: '薄弱点问答',
          Front: '{{Question}}',
          Back: '{{FrontSide}}<hr id=answer><div class="answer">✅ {{Answer}}</div><div class="explanation">{{Explanation}}</div>'
        }]
      }});
    } catch (e) { dbg('ANKI_MODEL', e.message || e); }
  }
  // 确保牌组存在
  if (Array.isArray(decks)) {
    for (const d of [ankiBaseDeck(), ankiWeakDeck(), ankiVocabDeck(), ankiCorrDeck(), ankiExtDeck()]) {
      if (!decks.includes(d)) {
        try { await ankiPostCall({ action: 'createDeck', version: 6, params: { deck: d } }); } catch (e) {}
      }
    }
  }
}

// ---- 处理分析结果 → 自动推送到 Anki ----
async function processAnalysisForAnki(parsed, userText) {
  if (!parsed) return;
  const masterOn = ankiAutoAdd;
  const vocabOn = masterOn && getSetting('ankiAutoVocab', true) !== false;
  const corrOn = masterOn && getSetting('ankiAutoCorr', true) !== false;
  const extOn = masterOn && getSetting('ankiAutoExt', true) !== false;
  const weakOn = masterOn && getSetting('ankiAutoWeak', true) !== false;
  let total = 0, added = 0;

  // 生词卡片（默写题型：中文释义→默写英文）
  if (vocabOn && parsed.new_words && parsed.new_words.length) {
    const notes = [];
    for (const w of parsed.new_words) {
      let word, meaning, example;
      if (typeof w === 'string') { word = w; const p = w.split(/[—\-–]/); meaning = p.length > 1 ? p[1].trim() : ''; }
      else { word = w.word || ''; meaning = w.meaning || ''; example = w.example || ''; }
      if (!word) continue;
      const ctx = userText ? '\n\n💬 语境：' + (userText.substring(0, 120) || '') : '';
      // 默写题型：Front=中文释义，Back=英文单词+音标+例句
      const frontText = meaning || word;  // 中文释义，没有释义时 fallback 到英文
      let backText = word;
      if (getSetting('ankiAutoAudio', false)) {
        const sound = await ankiAttachAudio(word);
        if (sound) backText = word + '<br>' + sound;
      }
      if (example) backText += '\n\n' + example;
      if (ctx) backText += '\n' + ctx;
      notes.push({ deckName: ankiVocabDeck(), modelName: VOCAB_MODEL, fields: { Front: frontText, Back: backText }, tags: [ankiUserTag(), 'vocabulary'] });
    }
    total += notes.length;
    const r = await ankiAddNotesBatch(notes);
    added += r.added;
  }

  // 纠错卡片
  if (corrOn && parsed.corrections && parsed.corrections.length) {
    const notes = [];
    for (const c of parsed.corrections) {
      const front = c.original || '';
      const back = (c.corrected ? '→ ' + c.corrected + '\n' : '') + (c.rule ? '规则：' + c.rule + '\n' : '') + (c.explanation || '');
      if (!front) continue;
      notes.push({ deckName: ankiCorrDeck(), modelName: 'Basic', fields: { Front: front, Back: back }, tags: [ankiUserTag(), 'correction'] });
    }
    total += notes.length;
    const r = await ankiAddNotesBatch(notes);
    added += r.added;
  }

  // 拓展知识卡片
  if (extOn && parsed.extensions && parsed.extensions.length) {
    const notes = [];
    for (const e of parsed.extensions) {
      const front = '💡 ' + (e.title || e.type || 'Knowledge');
      const back = (e.content || '') + (e.type ? '\n\n类型：' + e.type : '');
      notes.push({ deckName: ankiExtDeck(), modelName: 'Basic', fields: { Front: front, Back: back }, tags: [ankiUserTag(), 'extension'] });
    }
    total += notes.length;
    const r = await ankiAddNotesBatch(notes);
    added += r.added;
  }

  // 薄弱点 → 触发自动出题（实际出题在 maybeGenerateQuizQuestions 中处理）
  if (weakOn && parsed.weak_points && parsed.weak_points.length) {
    // weak_points 已通过 trackWeakPoints 存入存储，这里只需触发出题策略
  }

  if (total > 0) toastMsg('📚 Anki: 已添加 ' + added + ' / ' + total + ' 张卡片');
}

// ---- AI 出题 prompt ----
function buildQuizPrompt(wpList) {
  const multiWp = getSetting('ankiQuizMultiWp', true) !== false;
  return `You are an English quiz generator for a Chinese learner. Create quiz questions to test these weak knowledge points.

Weak points to cover:
${wpList.map(w => `- [${w.id}] (${w.category}) ${w.point}${w.suggestion ? '\n  Tip: ' + w.suggestion.substring(0, 80) : ''}`).join('\n')}

Requirements:
${multiWp ? '- One question should test AS MANY weak points as possible (ideally 2-3 at a time), as long as it stays natural.' : '- Each question should test exactly ONE weak point.'}
- Cover ALL given weak points across the questions.
- Generate ${Math.max(1, Math.ceil(wpList.length * (parseInt(getSetting('ankiQuizPerWp', 2)) || 2) / 1.6))} questions.
- Question types: multiple_choice (4 options A/B/C/D), fill_blank (with hint in brackets), or error_correction.
- Use natural English at an appropriate level. Questions should be realistic.

Return ONLY valid JSON (no markdown, no thinking):
{
  "questions": [
    {
      "type": "multiple_choice|fill_blank|error_correction",
      "question": "the question text (with ___ for blanks, or the erroneous sentence)",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],   // only for multiple_choice
      "answer": "correct answer (for MC: option letter + text; for fill: missing word; for error: correction)",
      "explanation": "Chinese explanation with reasons, referencing each tested weak point",
      "weak_point_ids": ["id1", "id2"]
    }
  ]
}`;
}

// ---- 解析 AI 出题响应 ----
function parseQuizResponse(raw) {
  if (!raw) return null;
  const obj = smartParseJSON(raw);
  if (obj && Array.isArray(obj.questions)) return obj.questions;
  // fallback: extract from larger JSON
  const obj2 = smartParseJSON('{"questions":' + raw + '}');
  if (obj2 && Array.isArray(obj2.questions)) return obj2.questions;
  return null;
}

// ---- 自动生成薄弱点题目 → 推送到 Anki ----
async function autoGenerateQuizQuestions(wpList) {
  if (!wpList || !wpList.length) return;
  const perWp = parseInt(getSetting('ankiQuizPerWp', 2)) || 2;
  const needs = wpList.filter(w => w && !w.archived && (w.anki_notes || []).length < perWp);
  if (!needs.length) return;
  const batch = needs.slice(0, 12);
  // 多轮 API 调用，每轮 6 个薄弱点，以强化多对多关系
  const maxPerCall = 6;
  const rounds = [];
  for (let i = 0; i < batch.length; i += maxPerCall) rounds.push(batch.slice(i, i + maxPerCall));
  const allQuestions = [];
  for (const round of rounds) {
    try {
      const raw = await callAPI([
        { role: 'system', content: buildQuizPrompt(round) },
        { role: 'user', content: 'Generate quiz questions for these weak points.' }
      ], { temperature: 0.7, maxTokens: 5000 });
      const qs = parseQuizResponse(raw);
      if (qs && qs.length) allQuestions.push(...qs);
    } catch (e) { dbg('QUIZ_GEN', e.message); }
  }
  if (!allQuestions.length) return;
  // 构建 Anki 笔记
  const notes = allQuestions.map(q => {
    const qText = q.question + (q.options && q.options.length ? '\n\n' + q.options.join('\n') : '');
    return {
      deckName: ankiWeakDeck(),
      modelName: ANKI_QUIZ_MODEL,
      fields: { Question: qText, Answer: q.answer || '', Explanation: q.explanation || '' },
      tags: [ankiUserTag(), 'weak-point', ...(q.weak_point_ids || []).map(wpTag)]
    };
  });
  const res = await ankiAddNotesBatch(notes);
  // 将实际添加的 note ID 关联回对应的薄弱点（按 order 一一对应）
  if (res.noteIds && res.noteIds.length && Array.isArray(res.order)) {
    const w = getWeak();
    let changed = false;
    allQuestions.forEach((q, qi) => {
      const nid = res.order[qi];
      if (!nid) return;
      (q.weak_point_ids || []).forEach(id => {
        if (w[id]) {
          if (!w[id].anki_notes) w[id].anki_notes = [];
          if (!w[id].anki_notes.includes(nid)) w[id].anki_notes.push(nid);
          changed = true;
        }
      });
    });
    if (changed) saveWeak(w);
  }
  toastMsg('📚 薄弱点出题: 已添加 ' + res.added + ' 道题到 Anki' + (res.skipped ? ' (跳过' + res.skipped + '道重复)' : ''));
  return res;
}

// ---- 出题策略调度 ----
function maybeGenerateQuizQuestions(newWpList) {
  if (!newWpList || !newWpList.length) return;
  const masterOn = ankiAutoAdd && getSetting('ankiAutoWeak', true) !== false;
  if (!masterOn) return;
  const strategy = getSetting('ankiQuizStrategy', 'instant');
  if (strategy === 'instant') {
    // 即时出题：对新发现的薄弱点立即出题
    autoGenerateQuizQuestions(newWpList);
  } else {
    // 积攒模式：统计所有未满 2 道的薄弱点
    const w = getWeak();
    const perWp = parseInt(getSetting('ankiQuizPerWp', 2)) || 2;
    const batchSize = parseInt(getSetting('ankiQuizBatchSize', 5)) || 5;
    const pending = Object.values(w).filter(wp => !wp.archived && (wp.anki_notes || []).length < perWp);
    if (pending.length >= batchSize) {
      autoGenerateQuizQuestions(pending.slice(0, batchSize));
    }
  }
}

// ---- TTS 音频附着到 Anki 卡片 ----
async function ankiAttachAudio(text) {
  // 通过 ElevenLabs TTS 生成音频 → storeMediaFile → 返回 [sound:filename] 字符串
  try {
    if (!text || !getSetting('ankiAutoAudio', false)) return '';
    const res = await fetch((BACKEND_URL || '') + '/api/proxy/tts/' + ANKI_TTS_VOICE_ID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.95 } })
    });
    if (!res.ok) return '';
    const blob = await res.blob();
    // 转 base64
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    if (!b64) return '';
    const filename = 'ai_en_' + Date.now() + '.mp3';
    const result = await ankiPostCall({ action: 'storeMediaFile', version: 6, params: { filename, data: b64, deleteExisting: true } });
    if (result && result.ok) return '[sound:' + filename + ']';
    return '';
  } catch (e) { dbg('ANKI_AUDIO', e.message); return ''; }
}

// ---- 批量同步生词本 + 薄弱点到 Anki 卡组 ----
// 生词：用英语学习-词汇 默写卡（Front=中文释义，Back=英文单词）
// 薄弱点：调用 autoGenerateQuizQuestions 生成 薄弱点问答 题目卡
async function pushAllToAnki() {
  if (!isAuthed()) { toastMsg('请先登录'); return; }
  toastMsg('📚 正在准备同步...');
  // 1. 检查 Anki 连接
  const ver = await ankiPostCall({ action: 'version', version: 6 });
  if (!ver || !ver.ok) { toastMsg('❌ Anki 未运行或 AnkiConnect 未连接'); return; }
  await ensureQuizModelAndDeck();

  // 2. 同步生词
  const vocab = getVocab();
  let vocabAdded = 0, vocabSkipped = 0;
  if (vocab && vocab.length) {
    // 过滤掉已经在 anki 中的（用 word 字段做去重键：an 里塞 [vocab_word] 标签不太好，用 getNotes 查）
    const existingWords = new Set();
    try {
      const allNotes = await ankiPostCall({ action: 'findNotes', version: 6, params: { query: 'deck:' + ankiVocabDeck() + ' tag:vocabulary' } });
      if (allNotes && allNotes.ok && allNotes.result && allNotes.result.result) {
        const ids = allNotes.result.result;
        if (ids.length) {
          const info = await ankiPostCall({ action: 'notesInfo', version: 6, params: { notes: ids.slice(0, 500) } });
          if (info && info.ok && info.result && info.result.result) {
            info.result.result.forEach(n => {
              const f = n && n.fields && n.fields.Front && n.fields.Front.value;
              if (f) existingWords.add(f.trim().toLowerCase());
            });
          }
        }
      }
    } catch (e) { dbg('ANKI_VOCAB_FETCH', e.message); }
    const notes = [];
    for (const v of vocab) {
      if (!v.word) continue;
      const meaning = v.translation || v.meaning || '';
      const example = v.example || v.context || '';
      if (existingWords.has(meaning.toLowerCase())) { vocabSkipped++; continue; }
      const front = meaning || v.word;
      let back = v.word;
      if (example) back += '\n\n' + example.replace(/\n/g, ' ').slice(0, 200);
      if (v.context && v.context !== example) back += '\n\n💬 语境：' + v.context.slice(0, 200);
      notes.push({ deckName: ankiVocabDeck(), modelName: VOCAB_MODEL, fields: { Front: front, Back: back }, tags: [ankiUserTag(), 'vocabulary'] });
    }
    if (notes.length) {
      const r = await ankiAddNotesBatch(notes);
      vocabAdded = r.added || 0;
      toastMsg('📚 生词本：已添加 ' + vocabAdded + ' / ' + notes.length + '（已存在 ' + vocabSkipped + '）');
    } else {
      toastMsg('📚 生词本：无新词可加（已存在 ' + vocabSkipped + '）');
    }
  } else {
    toastMsg('📚 生词本为空，跳过');
  }

  // 3. 同步薄弱点题目
  const weak = getWeak();
  const wpList = Object.values(weak).filter(w => w && !w.archived);
  const perWp = parseInt(getSetting('ankiQuizPerWp', 2)) || 2;
  const needs = wpList.filter(w => (w.anki_notes || []).length < perWp);
  if (!needs.length) {
    toastMsg('✅ 同步完成：生词 +' + vocabAdded + '，薄弱点题目无需新增');
    return;
  }
  toastMsg('🎯 正在为 ' + needs.length + ' 个薄弱点生成题目...');
  const r = await autoGenerateQuizQuestions(needs);
  const quizAdded = r && r.added || 0;
  toastMsg('✅ 同步完成：生词 +' + vocabAdded + '，薄弱点题目 +' + quizAdded);
  // 刷新统计
  if (typeof renderAnkiSidebar === 'function') renderAnkiSidebar();
}

// ---- 从 Anki 拉取复习数据 → 更新 weak points 掌握状态 ----
async function syncAnkiReviewData() {
  try {
    // 检查连接
    const ver = await ankiPostCall({ action: 'version', version: 6 });
    if (!ver || !ver.ok) return;
    // 拉取薄弱点牌组中所有卡片的信息
    const cardIds = await ankiPostCall({ action: 'findCards', version: 6, params: { query: 'deck:' + ankiWeakDeck() } });
    const ids = cardIds && cardIds.result && cardIds.result.result;
    if (!Array.isArray(ids) || !ids.length) return;
    const cardsInfo = await ankiPostCall({ action: 'cardsInfo', version: 6, params: { cards: ids.slice(0, 200) } });
    const cards = cardsInfo && cardsInfo.result && cardsInfo.result.result;
    if (!Array.isArray(cards)) return;
    // 按 tag 归类到 weak point
    const w = getWeak();
    let changed = false;
    for (const card of cards) {
      if (!card || !card.note) continue;
      // 从 tags 中提取 wp 前缀
      const tags = card.tags || [];
      const wpTagPrefix = 'wp_' + (currentUser() || 'default') + '_';
      const wpIds = tags.filter(t => t.startsWith(wpTagPrefix)).map(t => t.slice(wpTagPrefix.length));
      for (const wpId of wpIds) {
        if (w[wpId]) {
          const wp = w[wpId];
          // 更新排程信息
          const prevInterval = wp.interval || 1;
          wp.interval = Math.max(1, card.interval || prevInterval);
          wp.ease = (card.factor || 2500) / 1000;
          wp.streak = Math.max(0, wp.interval > 1 ? card.reps || 0 : 0);
          wp.last_quizzed = new Date().toISOString();
          // 如果 lapses 过高（反复遗忘），增加 count
          if (card.lapses > 2 && wp.count < 20) {
            wp.count = Math.min(20, (wp.count || 0) + 1);
          }
          // 如果 interval > 21 天且 reps >= 3，趋向掌握
          if (card.interval > 21 && card.reps >= 3 && (wp.count || 0) > 0) {
            wp.count = Math.max(0, (wp.count || 0) - 1);
          }
          if ((wp.count || 0) <= 0 && card.interval > 21) {
            wp.archived = true;
          }
          changed = true;
        }
      }
    }
    if (changed) saveWeak(w);
  } catch (e) { dbg('ANKI_SYNC', e.message); }
}

// ---- 侧边栏 Anki 统计面板 ----
async function renderAnkiSidebar() {
  const el = document.getElementById('ankiSidebar');
  if (!el) return;
  try {
    const ver = await ankiPostCall({ action: 'version', version: 6 }).then(d => d.result && d.result.result).catch(() => null);
    if (!ver) {
      el.innerHTML = '<div class="anki-sidebar-section"><div class="anki-sidebar-header">📚 Anki</div><div class="anki-sidebar-stat" style="color:var(--text2)">❌ 未连接</div></div>';
      return;
    }
    const [stats, today, byDay] = await Promise.all([
      ankiPostCall({ action: 'getDeckStats', version: 6, params: { decks: [ankiWeakDeck()] } }).then(d => d.result && d.result.result).catch(() => null),
      ankiPostCall({ action: 'getNumCardsReviewedToday', version: 6 }).then(d => d.result && d.result.result).catch(() => 0),
      ankiPostCall({ action: 'getNumCardsReviewedByDay', version: 6 }).then(d => d.result && d.result.result).catch(() => [])
    ]);
    const deckStat = stats && Object.values(stats)[0];
    const reviewCount = deckStat ? deckStat.review_count || 0 : 0;
    const newCount = deckStat ? deckStat.new_count || 0 : 0;
    const learnCount = deckStat ? deckStat.learn_count || 0 : 0;
    const total = deckStat ? deckStat.total_in_deck || 0 : 0;
    // 连续学习天数（本地持久化）
    let streak = parseInt(getSetting('ankiStreak', 0)) || 0;
    const todayStr = new Date().toDateString();
    const lastStudy = getSetting('ankiLastStudy', '');
    if (todayStr !== lastStudy && today > 0) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (lastStudy === yesterday) streak++;
      else if (lastStudy && lastStudy !== todayStr) streak = 1;
      else if (!lastStudy) streak = 1;
      setSetting('ankiStreak', streak);
      setSetting('ankiLastStudy', todayStr);
    }
    if (todayStr === lastStudy && today > 0 && streak === 0) streak = 1;
    // 7 天柱状图
    let barHtml = '';
    if (Array.isArray(byDay) && byDay.length) {
      const recent = byDay.slice(-7);
      const max = Math.max(1, ...recent.map(d => d[1]));
      barHtml = recent.map(d => {
        const pct = (d[1] / max) * 100;
        return `<span style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1"><span style="font-size:9px;color:var(--text2)">${d[0].slice(5)}</span><span style="width:100%;height:${Math.max(3, pct * 0.6)}px;background:var(--primary);border-radius:2px;min-height:3px"></span><span style="font-size:9px;color:var(--text2)">${d[1]}</span></span>`;
      }).join('');
    }
    el.innerHTML = `<div class="anki-sidebar-section">
      <div class="anki-sidebar-header">
        <span>📚 Anki 复习</span>
        <button onclick="syncAnkiReviewData();renderAnkiSidebar();" title="同步" style="border:none;background:none;cursor:pointer;font-size:12px;color:var(--text2)">🔄</button>
      </div>
      <div class="anki-sidebar-stat"><span>🗂️ 薄弱点牌组</span><span style="color:var(--text2);font-size:11px">总计 ${total}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">
        <span class="anki-badge" style="background:#e0f2fe;color:#0369a1">📝 待复习 ${reviewCount}</span>
        <span class="anki-badge" style="background:#fef3c7;color:#92400e">🆕 新卡 ${newCount}</span>
        <span class="anki-badge" style="background:#fce7f3;color:#9d174d">📖 学习中 ${learnCount}</span>
      </div>
      <div style="font-size:11px;color:var(--text2);margin:4px 0">📊 今日复习: ${today || 0}  &nbsp;|&nbsp; 🔥 连续 ${streak} 天</div>
      ${barHtml ? '<div style="display:flex;gap:2px;margin:6px 0;align-items:flex-end;height:48px">' + barHtml + '</div>' : ''}
      <button onclick="startWebReview()" style="width:100%;padding:6px 0;border-radius:6px;border:none;background:var(--primary);color:#fff;font-size:12px;cursor:pointer;margin-top:4px">▶ 开始复习</button>
    </div>`;
  } catch (e) {
    el.innerHTML = '<div class="anki-sidebar-section"><div class="anki-sidebar-header">📚 Anki</div><div class="anki-sidebar-stat" style="color:var(--text2)">❌ 连接失败</div></div>';
  }
}

// ---- 网页答题复习（通过 AnkiConnect GUI 驱动 Anki FSRS 排程） ----
let webReviewState = null; // {cardId, total, current, correct, el}
function startWebReview() {
  removeAllModals();
  webReviewState = { cardId: null, total: 0, current: 0, correct: 0 };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Anki 网页复习');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.id = 'ankiReviewModal';
  modal.style.cssText = 'background:#fff;border-radius:14px;padding:24px;max-width:560px;width:94%;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
  modal.innerHTML = `<div style="text-align:center;padding:20px">
    <div style="font-size:16px;margin-bottom:12px">⏳ 启动 Anki 复习会话...</div>
    <div class="spinner" style="width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto"></div>
  </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // 异步启动复习
  setTimeout(async () => {
    try {
      // 先检查 Anki 连接
      const ver = await ankiPostCall({ action: 'version', version: 6 });
      if (!ver || !ver.ok || !ver.result || !ver.result.result) {
        modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--orange)">⚠️ Anki 未运行或 AnkiConnect 未连接<br><br>请先打开 Anki（可最小化），然后重新点击「✅ 复习」<br><br><button onclick="this.closest(\'.modal-overlay\').remove()" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
        return;
      }
      const result = await ankiPostCall({ action: 'guiDeckReview', version: 6, params: { name: ankiWeakDeck() } });
      // guiDeckReview 返回 true/false
      if (!result || !result.ok || !result.result || !result.result.result) {
        // 可能牌组没有待复习卡片
        const cardIds = await ankiPostCall({ action: 'findCards', version: 6, params: { query: 'deck:' + ankiWeakDeck() + ' is:due' } });
        const dueCount = (cardIds && cardIds.result && cardIds.result.result) ? cardIds.result.result.length : 0;
        if (dueCount === 0) {
          modal.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:12px">🎉</div><div style="font-size:18px;font-weight:700;margin-bottom:8px">薄弱点牌组没有待复习卡片</div><div style="font-size:14px;color:var(--text2);margin-bottom:4px">继续对话，新的薄弱点会自动生成题目</div><button onclick="this.closest(\'.modal-overlay\').remove()" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button></div>';
        } else {
          modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--orange)">⚠️ 无法启动复习会话（有 ' + dueCount + ' 张待复习卡片，但 Anki 拒绝启动）<br>请确保 Anki 窗口已打开，然后重试<br><br><button onclick="this.closest(\'.modal-overlay\').remove()" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
        }
        return;
      }
      await new Promise(r => setTimeout(r, 500));
      fetchNextWebReviewCard();
    } catch (e) {
      modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">❌ 启动复习失败：' + esc(e.message || e) + '<br><br>请确认 Anki 已运行且 AnkiConnect 插件已安装（默认端口 8765）<br><br><button onclick="this.closest(\'.modal-overlay\').remove()" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
    }
  }, 300);
  overlay.onclick = function(e) { if (e.target === overlay) { closeWebReview(); } };
}

function fetchNextWebReviewCard() {
  (async () => {
    try {
      const card = await ankiPostCall({ action: 'guiCurrentCard', version: 6 });
      const cardData = card && card.result && card.result.result;
      if (!cardData) {
        // 没有更多卡片 — 检查是否 Anki 已退出复习模式
        const total = webReviewState.current;
        if (total > 0) {
          finishWebReview();
        } else {
          // 没有卡片可复习（可能是牌组为空或所有卡片都已复习）
          const modal = document.getElementById('ankiReviewModal');
          if (modal) {
            modal.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:12px">📭</div><div style="font-size:18px;font-weight:700;margin-bottom:8px">没有待复习的卡片</div><div style="font-size:14px;color:var(--text2);margin-bottom:4px">薄弱点牌组中暂时没有到期的题目</div><div style="font-size:12px;color:var(--text2)">继续对话，新的薄弱点会自动生成题目推送到 Anki</div><button onclick="this.closest(\'.modal-overlay\').remove()" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button></div>';
          }
        }
        return;
      }
      webReviewState.cardId = cardData.cardId;
      webReviewState.current++;
      webReviewState.total = Math.max(webReviewState.total, webReviewState.current);
      showWebReviewQuestion(cardData);
    } catch (e) {
      const modal = document.getElementById('ankiReviewModal');
      if (modal) {
        modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">❌ 读取卡片失败：' + esc(e.message || e) + '<br><br><button onclick="closeWebReview()" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
      }
    }
  })();
}

function showWebReviewQuestion(cardData) {
  const modal = document.getElementById('ankiReviewModal');
  if (!modal) return;
  const q = cardData.question || '';
  const fields = cardData.fields || {};
  // 提取干净文本（去除 HTML 标签用于显示，但保留布局）
  const questionHtml = q || fields.Question || fields.Question?.value || '';
  modal.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <span style="font-size:13px;font-weight:600">📝 题目 (${webReviewState.current}/${webReviewState.total})</span>
    <span style="font-size:12px;color:var(--text2)">✅ ${webReviewState.correct}/${webReviewState.current}</span>
  </div>
  <div style="font-size:15px;line-height:1.8;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:14px;text-align:center">${questionHtml}</div>
  <div style="display:flex;gap:8px;justify-content:center">
    <button onclick="webReviewShowAnswer()" style="padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">🤔 显示答案</button>
    <button onclick="closeWebReview()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:#fff;font-size:13px;cursor:pointer">退出</button>
  </div>`;
}

function webReviewShowAnswer() {
  (async () => {
    try {
      await ankiPostCall({ action: 'guiShowAnswer', version: 6 });
      await new Promise(r => setTimeout(r, 200));
      const card = await ankiPostCall({ action: 'guiCurrentCard', version: 6 });
      const cardData = card && card.result && card.result.result;
      if (!cardData) return;
      const answerHtml = cardData.answer || '';
      const modal = document.getElementById('ankiReviewModal');
      if (!modal) return;
      modal.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:13px;font-weight:600">📝 题目 (${webReviewState.current}/${webReviewState.total})</span>
        <span style="font-size:12px;color:var(--text2)">✅ ${webReviewState.correct}/${webReviewState.current}</span>
      </div>
      <div style="font-size:15px;line-height:1.8;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:8px;text-align:center">${answerHtml}</div>
      <div style="text-align:center;font-size:13px;color:var(--text2);margin:8px 0">这次答得怎么样？</div>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
        <button onclick="webReviewAnswer(1)" style="flex:1;min-width:60px;padding:8px 10px;border-radius:8px;border:1px solid #ef4444;background:#fef2f2;color:#dc2626;font-size:13px;cursor:pointer">😰 忘记</button>
        <button onclick="webReviewAnswer(2)" style="flex:1;min-width:60px;padding:8px 10px;border-radius:8px;border:1px solid #f59e0b;background:#fffbeb;color:#d97706;font-size:13px;cursor:pointer">🤔 模糊</button>
        <button onclick="webReviewAnswer(3)" style="flex:1;min-width:60px;padding:8px 10px;border-radius:8px;border:1px solid #22c55e;background:#f0fdf4;color:#15803d;font-size:13px;cursor:pointer">😊 记得</button>
        <button onclick="webReviewAnswer(4)" style="flex:1;min-width:60px;padding:8px 10px;border-radius:8px;border:1px solid #3b82f6;background:#eff6ff;color:#2563eb;font-size:13px;cursor:pointer">😎 简单</button>
      </div>
      <div style="text-align:center;margin-top:10px"><button onclick="closeWebReview()" style="border:none;background:none;color:var(--text2);font-size:12px;cursor:pointer">退出复习</button></div>`;
    } catch (e) {
      dbg('ANKI_ANSWER_SHOW', e.message);
    }
  })();
}

function webReviewAnswer(ease) {
  (async () => {
    try {
      if (ease >= 3) webReviewState.correct++;
      await ankiPostCall({ action: 'guiAnswerCard', version: 6, params: { ease } });
      await new Promise(r => setTimeout(r, 300));
      // 同步更新 weak points（异步不阻塞）
      syncAnkiReviewData().catch(() => {});
      fetchNextWebReviewCard();
    } catch (e) {
      dbg('ANKI_ANSWER', e.message);
      document.getElementById('ankiReviewModal').innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">❌ 答题提交失败：' + esc(e.message) + '<br><br><button onclick="closeWebReview()" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
    }
  })();
}

function finishWebReview() {
  const modal = document.getElementById('ankiReviewModal');
  if (!modal) return;
  const pct = webReviewState.total > 0 ? Math.round((webReviewState.correct / webReviewState.total) * 100) : 0;
  modal.innerHTML = `<div style="text-align:center;padding:20px">
    <div style="font-size:40px;margin-bottom:12px">🎉</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:8px">复习完成!</div>
    <div style="font-size:14px;color:var(--text2);margin-bottom:4px">共 ${webReviewState.total} 题 · 正确 ${webReviewState.correct} 题</div>
    <div style="font-size:24px;font-weight:700;color:${pct >= 70 ? 'var(--green)' : 'var(--red)'}">正确率 ${pct}%</div>
    <button onclick="this.closest('.modal-overlay').remove()" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button>
  </div>`;
}

function closeWebReview() {
  webReviewState = null;
  const modal = document.getElementById('ankiReviewModal');
  if (modal) modal.parentElement.remove();
  renderAnkiSidebar();
}

/* ---------- Settings persistence ---------- */
function getSetting(key, def) {
  try { const v = JSON.parse(localStorage.getItem('ai_en_setting_' + key)); return v === null ? def : v; } catch(e) { return def; }
}
function setSetting(key, val) {
  localStorage.setItem('ai_en_setting_' + key, JSON.stringify(val));
}

function toggleAnki() {
  ankiAutoAdd = !ankiAutoAdd;
  setSetting('ankiAutoAdd', ankiAutoAdd);
  const btn = document.getElementById('ankiToggle');
  if (btn) btn.classList.toggle('active', ankiAutoAdd);
}
function toggleAutoRead() {
  autoReadAloud = !autoReadAloud;
  setSetting('autoRead', autoReadAloud);
  const btn = document.getElementById('autoReadToggle');
  if (btn) btn.classList.toggle('active', autoReadAloud);
}

/* ---------- Edit / Delete Message ---------- */
function editMessage(msgId) {
  const node = findNode(msgId);
  const msgEl = document.querySelector(`.msg.user[data-msg-id="${msgId}"]`);
  if (!node || !msgEl) return;
  const bubble = msgEl.querySelector('.user-bubble');
  if (!bubble) return;
  const original = activeVariant(node).content;
  bubble.onclick = null;
  bubble.innerHTML = `
    <textarea class="edit-area" rows="3">${esc(original)}</textarea>
    <div class="edit-actions">
      <button class="edit-save" onclick="event.stopPropagation();saveEdit('${msgId}')">✓ 保存</button>
      <button class="edit-cancel" onclick="event.stopPropagation();cancelEdit('${msgId}')">✕ 取消</button>
    </div>`;
  const ta = bubble.querySelector('textarea');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

async function saveEdit(msgId) {
  const node = findNode(msgId);
  const msgEl = document.querySelector(`.msg.user[data-msg-id="${msgId}"]`);
  if (!node || !msgEl) return;
  const newText = (msgEl.querySelector('textarea') || {}).value;
  if (!newText || !newText.trim()) return;
  // Truncate everything after this node in the active path
  truncateAfter(node);
  // Add a new variant with the edited content
  node.variants.push({ content: newText.trim(), feedback: null, next: [] });
  node.activeVariant = node.variants.length - 1;
  renderMessages();
  saveConversation(conversation);
  renderSidebar();
  await resendFrom(msgId);
}

function cancelEdit(msgId) {
  const msgEl = document.querySelector(`.msg.user[data-msg-id="${msgId}"]`);
  const node = findNode(msgId);
  if (!msgEl || !node) return;
  const pathItem = { id: node.id, role: 'user', content: activeVariant(node).content, feedback: activeVariant(node).feedback };
  msgEl.innerHTML = userBubbleHTML(pathItem);
}

function deleteMessage(msgId) {
  if (!confirm('确定删除这条消息及其后的所有回复？')) return;
  removeNodeFromTree(msgId);
  if (selectedMsgId === msgId) selectedMsgId = null;
  renderMessages();
  saveConversation(conversation);
  renderSidebar();
  if (selectedMsgId) selectFeedback(selectedMsgId);
  else document.getElementById('analysisContent').innerHTML = '<div class="empty">点击右侧聊天中的一条消息查看其反馈</div>';
}

/* 取消所有后台分析任务（切换对话 / 退出登录 / 点停止时调用） */
function cancelAnalysisTasks() {
  if (analysisAbort) { try { analysisAbort.abort(); } catch (e) {} analysisAbort = null; }
  analysisTimers.forEach(t => clearTimeout(t));
  analysisTimers = [];
}

/* 分析任务是否仍然属于当前上下文。
   主回复结束后分析仍在后台运行；若用户已切换对话或换账户，
   结果不能再写入 UI / weak points / Anki，否则会污染另一个对话。 */
function analysisStillValid(ctx) {
  if (!ctx) return false;
  if (currentUser() !== ctx.user) return false;
  if (getCurrentConvId() !== ctx.convId) return false;
  return !!findNode(ctx.msgId);
}

async function callAnalysis(userText, userMsgId, attempt, signal, ctx) {
  if (attempt === undefined) attempt = 0;
  // 首次调用时记录归属上下文（对话 + 消息 + 账户），重试沿用同一份
  if (!ctx) {
    ctx = { convId: getCurrentConvId(), msgId: userMsgId, user: currentUser() };
  }
  // 分析用独立 controller：主回复的 currentAbort 在 finally 里会被清空，
  // 不能再用它控制后台分析的生命周期
  if (attempt === 0) {
    if (analysisAbort) { try { analysisAbort.abort(); } catch (e) {} }
    analysisAbort = new AbortController();
  }
  const analysisSignal = (analysisAbort && analysisAbort.signal) || signal;
  const scheduleRetry = (delay) => {
    const t = setTimeout(() => {
      analysisTimers = analysisTimers.filter(x => x !== t);
      if (!analysisStillValid(ctx)) return;
      callAnalysis(userText, userMsgId, attempt + 1, analysisSignal, ctx);
    }, delay);
    analysisTimers.push(t);
  };

  try {
    // Add conversation context (last 6 messages)
    const ctxText = getActivePath().slice(-6).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
    const contextBlock = ctxText ? '\n\nConversation context (recent messages):\n' + ctxText : '';
    const analysisRaw = await callAPI([
      { role: 'system', content: buildAnalysisPrompt() + contextBlock },
      { role: 'user', content: userText }
    ], { temperature: 0.3, maxTokens: 5000, signal: analysisSignal });

    // 结果回来时先确认上下文没变，再写任何状态
    if (!analysisStillValid(ctx)) {
      dbg('ANALYSIS_STALE', '对话已切换，丢弃分析结果 ' + userMsgId);
      return;
    }
    const node = findNode(userMsgId);
    const parsed = parseAIResponse(analysisRaw);
    if (node) {
      activeVariant(node).feedback = parsed;
    }
    if (parsed && parsed.analysis) {
      trackWeakPoints(parsed);
      updateFeedbackHint(userMsgId);  // no full re-render -> no scroll jump
      renderFeedbackForMsg(userMsgId);
      saveConversation(conversation);
      // Anki: 同步复习数据 + 处理分析结果推送
      if (ankiAutoAdd) {
        processAnalysisForAnki(parsed, userText).catch(() => {});
        // 同步复习数据（拉取 Anki 卡片的排程状态 → 更新 weak points）
        if (getSetting('ankiAutoSync', true) !== false && authToken) {
          syncAnkiReviewData().then(() => renderWeak()).catch(() => {});
        }
        // 薄弱点 → 自动出题（题目进 Anki 薄弱点牌组，在 Anki 侧答题复习）
        const wpAfterTrack = Object.values(getWeak()).filter(w => !w.archived);
        maybeGenerateQuizQuestions(wpAfterTrack);
      }
    } else {
      // Parsed but no analysis — retry or show error
      if (attempt < 2) {
        dbg('ANALYSIS_RETRY', 'attempt ' + (attempt + 1) + ' no analysis, retrying');
        scheduleRetry(2000);
      } else {
        dbg('ANALYSIS_FAIL', 'failed after 3 attempts');
        if (node) {
          activeVariant(node).feedback = { analysis: null, error: '分析失败，请重试', corrections: [], extensions: [], new_words: [] };
        }
        updateFeedbackHint(userMsgId);
        renderFeedbackForMsg(userMsgId);
      }
    }
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 20)) return; // user stopped — silent
    dbg('ANALYSIS_ERR', err.message);
    if (!analysisStillValid(ctx)) return;
    if (attempt < 2) {
      dbg('ANALYSIS_RETRY', 'attempt ' + (attempt + 1) + ' error, retrying');
      scheduleRetry(3000);
    } else {
      const node = findNode(userMsgId);
      if (node) {
        activeVariant(node).feedback = { analysis: null, error: '分析失败: ' + err.message.substring(0, 80), corrections: [], extensions: [], new_words: [] };
      }
      updateFeedbackHint(userMsgId);
      renderFeedbackForMsg(userMsgId);
    }
  }
}

async function resendFrom(msgId) {
  if (currentAbort) { try { currentAbort.abort(); } catch(e){} }
  currentAbort = new AbortController();
  const signal = currentAbort.signal;
  setSending(true);
  addAiTyping();
  try {
    // Chat call
    const chatMessages = [
      { role: 'system', content: buildChatPrompt() },
      ...buildApiMessages()
    ];
    const chatRaw = await callAPI(chatMessages, { signal });
    const reply = extractChatReply(chatRaw);
    const aiNode = makeNode('assistant', reply || '(no response)', null);
    appendToEnd(aiNode);
    renderMessages();
    saveConversation(conversation);
    // Analysis call (async, non-blocking)
    const node = findNode(msgId);
    if (node) {
      activeVariant(node).feedback = null;
    }
    renderSidebar();
    selectFeedback(msgId);
    callAnalysis(node ? activeVariant(node).content : '', msgId, 0, signal);
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 20)) {
      removeTyping();
      toastMsg('⏹ 已停止');
      return;
    }
    removeTyping();
    lastApiError = { message: err.message, time: new Date().toISOString() };
    dbg('RESEND_ERR', err.message);
    showSystemError(err.message, { retry: 'resendFromLastUserMsg' });
    console.error(err);
  } finally {
    setSending(false);
    currentAbort = null;
  }
}

async function resendFromLastUserMsg() {
  // 找到最近一条用户消息
  const path = getActivePath();
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].role === 'user') { await resendFrom(path[i].id); return; }
  }
}

/* ---------- Send Message ---------- */
async function sendMessage() {
  if (isSending) return;
  const input = document.getElementById('userInput');
  const text = input.value.trim();
  if (!text) return;

  // Handle slash commands: /t, /translate, /ask (note: /search flows through to chat+executor)
  if (text.startsWith('/')) {
    const handled = handleSlashCommand(text);
    if (handled) {
      input.value = '';
      input.style.height = 'auto';
      return;
    }
  }

  const userNode = makeNode('user', text, null);
  appendToEnd(userNode);
  const userMsgId = userNode.id;
  addUserMessage({ id: userNode.id, role: 'user', content: text, feedback: null });
  input.value = '';
  input.style.height = 'auto';
  saveConversation(conversation);

  if (currentAbort) { try { currentAbort.abort(); } catch(e){} }
  currentAbort = new AbortController();
  const signal = currentAbort.signal;

  setSending(true);
  addAiTyping();
  // 中止/出错时需要收尾这个尚未完成的 AI 节点，故在 try 外持有引用
  let aiNodeRef = null;
  let aiMsgIdRef = null;
  try {
    // 0. 策略师 — 后台预分析（风格/意图/是否需联网），结果只进调试面板
    let strategist = null;
    if (strategistEnabled) {
      try {
        strategist = await runStrategist(text, signal);
        // 非常驻指令只消费一次；常驻指令保留
        const instr = getStrategistInstructions();
        const remaining = instr.filter(i => i.permanent);
        if (remaining.length !== instr.length) saveStrategistInstructions(remaining);
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
        agentLog('strategist', '分析失败: ' + e.message);
        strategist = null;
      }
    }

    // 1. 组装系统提示：角色卡 + 策略师简报 + （执行者启用时的）联网决策协议
    let chatSystem = buildChatPrompt();
    if (strategist) {
      chatSystem += '\n\n[STRATEGIST BRIEF]\n' + JSON.stringify(strategist) +
        '\n(Use the suggested follow-up angle naturally; stay in character and in the target difficulty.)';
    }
    if (executorEnabled) {
      chatSystem += '\n\n' + buildSearchDecisionHint();
    }

    const aiNode = makeNode('assistant', '', null);
    appendToEnd(aiNode);
    const aiMsgId = aiNode.id;
    aiNodeRef = aiNode;
    aiMsgIdRef = aiMsgId;
    const live = streamChatEnabled ? addStreamingBubble(aiMsgId) : null;

    let reply = '';
    let research = null;

    // 2. 执行者触发判定：策略师指派 或 主对话模型主动请求（[NEED_SEARCH]）
    let researchQuery = null;
    if (executorEnabled && strategist && strategist.needs_search && strategist.search_query) {
      researchQuery = String(strategist.search_query).trim().substring(0, 120);
      agentLog('executor', '策略师指派联网研究: ' + researchQuery);
    }

    if (researchQuery) {
      // 策略师直接指派 → 跳过首轮对话，直接研究再回答
      if (live) live.querySelector('.ai-text').textContent = '🔎 执行者研究中...';
      research = await runResearch(researchQuery, signal);
      if (live) clearStreamBubble(aiMsgId);
      reply = await streamOrCall([
        { role: 'system', content: chatSystem + '\n\n[EXECUTOR RESEARCH]\n' + research.summary +
          '\n\nAnswer Alex\u2019s reply naturally using these facts; briefly mention a source when appropriate.' },
        ...buildApiMessages()
      ], aiMsgId, live, signal);
    } else {
      // 首轮对话：主对话模型自行决定是否需要联网
      reply = await streamOrCall([
        { role: 'system', content: chatSystem },
        ...buildApiMessages()
      ], aiMsgId, live, signal);
      const m = stripThinking(reply).trim().match(/^\[NEED_SEARCH\]\s*(.+)/i);
      if (m && m[1] && executorEnabled) {
        researchQuery = m[1].trim().substring(0, 120);
        agentLog('executor', '主对话模型请求联网: ' + researchQuery);
        if (live) live.querySelector('.ai-text').textContent = '🔎 执行者研究中...';
        research = await runResearch(researchQuery, signal);
        if (live) clearStreamBubble(aiMsgId);
        reply = await streamOrCall([
          { role: 'system', content: chatSystem + '\n\n[EXECUTOR RESEARCH]\n' + research.summary +
            '\n\nAnswer Alex\u2019s reply naturally using these facts; briefly mention a source when appropriate.' },
          ...buildApiMessages()
        ], aiMsgId, live, signal);
      }
    }

    activeVariant(aiNode).content = reply || '(no response)';
    // 后台 Agent 元数据存到消息节点（仅调试面板读取）
    activeVariant(userNode).strategy = strategist || null;
    activeVariant(userNode).research = research || null;
    renderMessages();
    saveConversation(conversation);

    // Auto-read-aloud if enabled
    if (autoReadAloud && (reply || '').trim()) {
      setTimeout(() => {
        const tts = document.querySelector(`.msg.ai[data-msg-id="${aiMsgId}"] .tts-btn`);
        if (tts) speakText(tts);
      }, 800);
    }

    // 2. Analysis call — async, non-blocking
    activeVariant(userNode).feedback = null;
    renderSidebar();
    selectFeedback(userMsgId);
    callAnalysis(text, userMsgId, 0, signal);
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 20)) {
      removeTyping();
      // 停止时必须处理那个已挂进版本树的空 assistant 节点：
      // 有部分内容 → 保留并标记「已停止」；完全没内容 → 从树上摘掉，
      // 否则下一次保存会把空节点持久化，刷新后出现幽灵气泡 / (no response)
      finalizeAbortedReply(aiNodeRef, aiMsgIdRef);
      toastMsg('⏹ 已停止');
      return;
    }
    removeTyping();
    // 出错同样不能留下空节点
    finalizeAbortedReply(aiNodeRef, aiMsgIdRef, true);
    lastApiError = { message: err.message, time: new Date().toISOString() };
    dbg('SEND_ERR', err.message);
    showSystemError(err.message, { retry: 'resendLastUserText', hint: '请检查网络或稍后重试。' });
    console.error(err);
  } finally {
    setSending(false);
    currentAbort = null;
  }
}

/* 中止/失败时收尾未完成的 AI 节点 */
function finalizeAbortedReply(aiNode, aiMsgId, isError) {
  if (!aiNode) return;
  let partial = '';
  if (aiMsgId) {
    const el = document.querySelector(`.msg.ai[data-msg-id="${aiMsgId}"] .ai-text`);
    if (el) partial = (el.textContent || '').trim();
    // 研究中的占位文本不算真实回复内容
    if (partial === '🔎 执行者研究中...') partial = '';
  }
  const v = activeVariant(aiNode);
  const existing = (v && v.content ? String(v.content) : '').trim();
  const content = existing || partial;
  if (content) {
    v.content = content;
    v.cancelled = !isError;
  } else {
    removeNodeFromTree(aiNode.id);
  }
  renderMessages();
  saveConversation(conversation);
}

async function resendLastUserText() {
  const input = document.getElementById('userInput');
  if (!input) return;
  const txt = input.value.trim();
  if (!txt) {
    const path = getActivePath();
    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i].role === 'user') { input.value = path[i].content; break; }
    }
  }
  if (input.value.trim()) sendMessage();
}

function setSending(v) {
  isSending = v;
  const btn = document.getElementById('sendBtn');
  btn.classList.toggle('loading', v);
  btn.disabled = v;
  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) stopBtn.style.display = v ? 'inline-block' : 'none';
}

function stopSending() {
  if (currentAbort) { try { currentAbort.abort(); } catch(e){} }
  // 「停止」应停掉全部后台任务：主回复 + 评分分析 + 分析重试定时器
  cancelAnalysisTasks();
}

/* ---------- New Conversation ---------- */
/* ---------- 新对话：先选话题 ---------- */
function promptNewConversation() {
  if (isSending) return;
  openTopicModal(function(topic) { startNewConversation(topic); });
}
function openTopicModal(cb) {
  pendingTopicCb = cb;
  const list = document.getElementById('topicList');
  if (list) {
    list.innerHTML = TOPIC_ORDER.map(k => {
      const active = currentTopic === k ? ' active' : '';
      return '<button class="topic-item' + active + '" data-topic="' + k + '" onclick="pickTopic(\'' + k + '\')">' + esc(TOPIC_LABELS[k] || k) + '</button>';
    }).join('');
  }
  const modal = document.getElementById('topicModal');
  if (modal) modal.style.display = 'flex';
}
function closeTopicModal() {
  const modal = document.getElementById('topicModal');
  if (modal) modal.style.display = 'none';
  pendingTopicCb = null;
}
function pickTopic(k) {
  const cb = pendingTopicCb;
  closeTopicModal();
  if (cb) cb(k);
}

async function startNewConversation(topic) {
  if (isSending) return;
  if (topic) currentTopic = topic;
  // 新对话前取消旧对话的后台分析任务
  cancelAnalysisTasks();
  conversation = [];
  selectedMsgId = null;
  createConversation('新对话', currentTopic);
  document.getElementById('messages').innerHTML = '';
  document.getElementById('analysisContent').innerHTML = '<div class="empty">开始对话后，这里会显示你的回答评分与改进建议</div>';
  renderSidebar();

  setSending(true);
  addAiTyping();
  try {
    // Generate Alex's backstory first (cached for future messages)
    await generateBackstory();
    const messages = [
      { role: 'system', content: buildChatPrompt() },
      { role: 'user', content: 'Hello! Let\'s start a conversation. Please introduce yourself and ask me a question.' }
    ];
    const content = await callAPI(messages);
    const reply = extractChatReply(content);
    const aiNode = makeNode('assistant', reply || content, null);
    appendToEnd(aiNode);
    renderMessages();
    saveConversation(conversation);
    renderSidebar();
  } catch (err) {
    removeTyping();
    lastApiError = { message: err.message, time: new Date().toISOString() };
    dbg('INIT_ERR', err.message);
    showSystemError(err.message, { hint: '请检查 API 配置或网络连接。' });
    renderMessages();
    console.error(err);
  } finally {
    setSending(false);
  }
}

/* ---------- Resume Conversation ---------- */
function resumeConversation(convId) {
  if (isSending) return;
  const conv = loadConversation(convId);
  if (!conv) return;
  // 切换对话前取消上一个对话的后台分析，避免结果写进新对话
  cancelAnalysisTasks();
  setCurrentConvId(convId);
  currentTopic = conv.topic || 'free';   // 话题随对话切换
  conversation = migrateConversation(JSON.parse(JSON.stringify(conv.messages || [])));
  selectedMsgId = null;
  document.getElementById('messages').innerHTML = '';
  document.getElementById('analysisContent').innerHTML = '<div class="empty">点击右侧聊天中的一条消息查看其反馈</div>';
  renderMessages();
  renderSidebar();
  const path = getActivePath();
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].role === 'user' && path[i].feedback && path[i].feedback.analysis) {
      selectFeedback(path[i].id);
      break;
    }
  }
  scrollToBottom();
}

/* ---------- Conversation Sidebar ---------- */
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  const sb = document.getElementById('sidebar');
  hideTip();
  sb.classList.toggle('open', sidebarOpen);
  const btn = document.getElementById('sidebarToggle');
  if (btn) btn.textContent = sidebarOpen ? '◀' : '▶';
  // On mobile, close the right panel when opening the sidebar
  if (isMobile() && sidebarOpen) {
    document.getElementById('sidePanel').classList.remove('open');
  }
  syncDrawerBackdrop();
  document.querySelector('.main-area').style.marginLeft = sidebarOpen ? '0' : '0';
}

function toggleMobilePanel() {
  const panel = document.getElementById('sidePanel');
  const opening = !panel.classList.contains('open');
  if (opening) setFeedbackPanelMode('expanded');
  else setFeedbackPanelMode('collapsed');
  if (isMobile() && opening) {
    document.getElementById('sidebar').classList.remove('open');
    sidebarOpen = false;
  }
  syncDrawerBackdrop();
}

function closeDrawers() {
  if (!isMobile()) return;
  const sb = document.getElementById('sidebar');
  const panel = document.getElementById('sidePanel');
  if (sb && sb.classList.contains('open')) {
    sb.classList.remove('open');
    sidebarOpen = false;
    const btn = document.getElementById('sidebarToggle');
    if (btn) btn.textContent = '▶';
  }
  if (panel && panel.classList.contains('open')) {
    panel.classList.remove('open');
  }
  syncDrawerBackdrop();
}

function syncDrawerBackdrop() {
  if (!isMobile()) {
    document.body.classList.remove('drawer-open');
    return;
  }
  const sb = document.getElementById('sidebar');
  const panel = document.getElementById('sidePanel');
  const open = (sb && sb.classList.contains('open')) || (panel && panel.classList.contains('open'));
  document.body.classList.toggle('drawer-open', !!open);
}

function renderSidebar() {
  const convs = getAllConversations();
  const currentId = getCurrentConvId();
  const list = document.getElementById('sidebarList');
  const ids = Object.keys(convs).sort((a, b) => new Date(convs[b].updatedAt) - new Date(convs[a].updatedAt));
  if (!ids.length) {
    list.innerHTML = '<div class="empty" style="padding:24px 0">暂无对话记录</div>';
  } else {
    list.innerHTML = ids.map(id => {
      const c = convs[id];
      const active = id === currentId ? ' active' : '';
      const title = esc(c.title || '新对话');
      const topicTag = c.topic && c.topic !== 'free' ? '<span class="conv-topic">' + esc(TOPIC_LABELS[c.topic] || c.topic) + '</span>' : '';
      const time = formatTime(c.updatedAt || c.createdAt);
      return `<div class="conv-item${active}" onclick="resumeConversation('${id}')"><span class="title">${title}${topicTag}</span><span class="date">${time}</span><button class="del-btn" onclick="event.stopPropagation();deleteConv('${id}')" title="删除">×</button></div>`;
    }).join('');
  }
  // Update sidebar footer with storage status
  const footer = document.querySelector('.sidebar-footer');
  if (footer) {
    footer.textContent = '💾 数据存入 SQLite · 账户 ' + (currentUser() || '');
  }
}

function deleteConv(id) {
  if (!confirm('确定删除此对话？')) return;
  deleteConversation(id);
  if (getCurrentConvId() === id || getCurrentConvId() === null) {
    const convs = getAllConversations();
    const ids = Object.keys(convs);
    if (ids.length) {
      resumeConversation(ids[0]);
    } else {
      conversation = [];
      selectedMsgId = null;
      document.getElementById('messages').innerHTML = '';
      document.getElementById('analysisContent').innerHTML = '<div class="empty">选择一条你的消息查看反馈</div>';
      // Empty state + manual start button — do NOT auto-call the API (avoids surprise cost)
      document.getElementById('messages').innerHTML =
        '<div class="empty" style="padding:40px 0;text-align:center">暂无对话记录<br>' +
        '<button onclick="promptNewConversation()" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:14px;cursor:pointer">💬 开始新对话</button></div>';
    }
  }
  renderSidebar();
}

function sidebarNewConversation() {
  toggleSidebar();
  promptNewConversation();
}

/* ---------- TTS ---------- */
async function speakText(btn) {
  if (btn.classList.contains('playing')) return;
  const text = btn.getAttribute('data-text');
  if (!text) return;
  btn.classList.add('loading');
  btn.innerHTML = '⏳ 生成中...';
  try {
    // Use backend TTS proxy (same-origin, avoids CORS)
    const res = await fetch((BACKEND_URL || '') + '/api/proxy/tts/' + ELEVEN_VOICE_ID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.95 } })
    });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch(e) {}
      throw new Error('TTS ' + res.status + ': ' + detail.substring(0, 100));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    btn.classList.remove('loading');
    btn.classList.add('playing');
    btn.innerHTML = '🔊 播放中...';
    audio.onended = () => {
      btn.classList.remove('playing');
      btn.innerHTML = '🔊 朗读';
      URL.revokeObjectURL(url);
    };
    audio.play().catch(e => {
      btn.classList.remove('playing');
      btn.innerHTML = '🔊 朗读';
      URL.revokeObjectURL(url);
      dbg('TTS_PLAY', e.message);
    });
  } catch (err) {
    btn.classList.remove('loading');
    btn.innerHTML = '🔊 失败';
    dbg('TTS_ERR', err.message);
    console.error('TTS error:', err);
    setTimeout(() => { btn.innerHTML = '🔊 朗读'; }, 3000);
  }
}

/* ---------- Translation ---------- */
document.getElementById('messages').addEventListener('mouseup', function(e) {
  if (document.body.classList.contains('floating-panel-open') || sidebarOpen) return;
  const selection = window.getSelection();
  const selected = selection.toString().trim();
  if (!selected || selected.length > 200) return;
  const bubble = e.target.closest('.ai-bubble');
  if (!bubble) return;
  tipSelected = selected;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  showTip(rect, selected);
  // Detect mode: word, phrase, or sentence
  const wordCount = selected.trim().split(/\s+/).length;
  const hasSentencePunct = /[,.!?;:。！？]/.test(selected);
  const hasChinese = /[\u4e00-\u9fff]/.test(selected);
  const isPhrase = wordCount >= 2 && wordCount <= 4 && !hasSentencePunct && !hasChinese;
  const isSentence = wordCount > 4 || hasSentencePunct || hasChinese;
  // Add 6 conversation context messages
  const ctx = getActivePath().slice(-6).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
  const contextBlock = ctx ? '\n\nRelevant conversation context:\n' + ctx : '';
  translateSelection(selected, isSentence, isPhrase, contextBlock);
});

/* ---------- 点击单词 → 划词翻译（无需手动拖动选择） ---------- */
function wordAtPoint(x, y) {
  if (!document.caretRangeFromPoint) return null;
  const rng = document.caretRangeFromPoint(x, y);
  if (!rng) return null;
  const node = rng.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent || '';
  let off = rng.startOffset;
  let start = off, end = off;
  while (start > 0 && /[A-Za-z']/.test(text[start - 1])) start--;
  while (end < text.length && /[A-Za-z']/.test(text[end])) end++;
  const word = text.substring(start, end);
  if (!/[A-Za-z]/.test(word)) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { word, range };
}

document.getElementById('messages').addEventListener('click', function(e) {
  if (document.body.classList.contains('floating-panel-open') || sidebarOpen) return;
  if (e.target.closest('button, a, .msg-actions, .variant-switcher, .msg-btn, #translateTip')) return;
  const bubble = e.target.closest('.ai-bubble, .user-bubble');
  if (!bubble) return;
  const sel = window.getSelection();
  if (sel && sel.toString().trim().length > 0) return;   // 有划选时交给 mouseup 流程
  const hit = wordAtPoint(e.clientX, e.clientY);
  if (!hit) return;
  sel.removeAllRanges();
  sel.addRange(hit.range);          // 视觉高亮该单词
  tipSelected = hit.word;
  showTip(hit.range.getBoundingClientRect(), hit.word);
  const ctx = getActivePath().slice(-6).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
  const contextBlock = ctx ? '\n\nRelevant conversation context:\n' + ctx : '';
  translateSelection(hit.word, false, false, contextBlock);
});

async function translateSelection(text, isSentence, isPhrase, contextBlock) {
  const wordEl = document.getElementById('tipWord');
  const meanEl = document.getElementById('tipMeaning');
  const tipAdd = document.getElementById('tipAdd');
  wordEl.textContent = text;
  if (translateCache[text]) {
    meanEl.innerHTML = translateCache[text];
    repositionTip();
    return;
  }
  meanEl.innerHTML = '<span class="loading">翻译中...</span>';
  try {
    let systemPrompt, maxTokens;
    if (isPhrase) {
      tipAdd.textContent = '选词添加';
      systemPrompt = 'You are a dictionary assistant. For the given English phrase/collocation, provide a detailed entry. If the phrase is a phrasal verb or collocation, treat it as a whole unit. Return ONLY valid JSON:\n{\n  "type": "phrase",\n  "phrase": "the full phrase",\n  "meaning": "Chinese meaning of the phrase",\n  "part": "phrase type (phrasal verb / collocation / idiom)",\n  "breakdown": "explanation of each word\'s role in the phrase, in Chinese",\n  "examples": [{"en": "English sentence using the phrase", "zh": "中文翻译"}],\n  "collocations": ["related phrases"],\n  "synonyms": [{"phrase": "similar phrase", "note": "difference in Chinese"}]\n}' + contextBlock;
      maxTokens = 1200;
    } else if (isSentence) {
      tipAdd.textContent = '选词添加';
      systemPrompt = 'You are an English tutor. Analyze the given English sentence and provide: 1) Chinese translation, 2) Grammar/structure breakdown, 3) Key vocabulary with explanations, 4) Useful phrases. Return ONLY valid JSON (no markdown, no thinking):\n{\n  "type": "sentence",\n  "original": "the sentence",\n  "translation": "Chinese translation",\n  "breakdown": "Grammar/structure analysis in Chinese",\n  "vocab": [{"word": "word", "meaning": "Chinese meaning", "part": "part of speech", "note": "usage note in Chinese"}],\n  "phrases": [{"phrase": "phrase", "meaning": "Chinese meaning", "usage": "how to use it"}]\n}' + contextBlock;
      maxTokens = 4500;
    } else {
      tipAdd.textContent = '加入生词本';
      systemPrompt = 'You are a dictionary assistant. For the given English word/phrase, provide a detailed dictionary entry in Chinese. If the word is a morphological variant (plural, past tense, -ing, etc.), show the base/lemma form as the main entry and list all variants. Return ONLY valid JSON (no markdown, no thinking):\n{\n  "word": "base form",\n  "input": "the original selected text",\n  "phonetic": "/IPA/",\n  "part": "词性 (n./v./adj./adv.)",\n  "variants": {"plural": "forms", "past": "forms", "present": "forms", "comparative": "forms"} as applicable,\n  "meanings": ["释义1", "释义2"],\n  "examples": [{"en": "English sentence", "zh": "中文翻译"}],\n  "collocations": ["搭配1 (翻译)", "搭配2 (翻译)"],\n  "synonyms": [{"word": "同义词", "note": "辨析说明"}],\n  "etymology": "word origin explanation in Chinese"\n}' + contextBlock;
      maxTokens = 1000;
    }
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ];
    // 流式输出 → 增量渲染字段，完成后解析；失败时非流式重试
    let accText = '';
    let obj = null;
    const seenFields = new Set();   // 已渲染的字段名
    // 手动超时控制器（60s）
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 60000);
    try {
      const full = await streamDict(messages, { temperature: 0.3, maxTokens: maxTokens, thinking: { type: 'disabled' } }, (d) => {
        accText += d;
        const cleanAcc = stripThinking(accText);   // 去掉 thinking 前缀，避免干扰字段检测
        if (cleanAcc === accText && !accText.includes('"')) {
          // 模型还在思考，只显示原始文本
          meanEl.innerHTML = '<pre style="font-size:12px;white-space:pre-wrap;max-height:140px;overflow-y:auto;margin:0;color:var(--text2);background:var(--bg);padding:4px 6px;border-radius:6px;font-family:inherit;font-size:11px;line-height:1.4">' + esc(accText) + '</pre>';
        } else {
          // 增量渲染：检测已完成的字段并显示
          let incrementalHtml = '';
          const fieldsToCheck = ['type', 'word', 'input', 'phonetic', 'part', 'phrase', 'original', 'translation', 'breakdown', 'meaning', 'question_suggestion'];
          for (const k of fieldsToCheck) {
            if (seenFields.has(k)) continue;
            const rawVal = extractBalancedValue(cleanAcc, k);
            if (rawVal) {
              seenFields.add(k);
              try { incrementalHtml += renderDictField(k, JSON.parse(rawVal), ''); } catch (e) { incrementalHtml += renderDictField(k, rawVal, ''); }
            }
          }
          const rawHtml = '<pre style="font-size:12px;white-space:pre-wrap;max-height:140px;overflow-y:auto;margin:6px 0 0;color:var(--text2);background:var(--bg);padding:4px 6px;border-radius:6px;font-family:inherit;font-size:11px;line-height:1.4">' + esc(accText) + '</pre>';
          meanEl.innerHTML = (incrementalHtml || '<span class="loading">翻译中...</span>') + rawHtml;
        }
        repositionTip();
      }, timeoutController.signal);
      clearTimeout(timeoutId);
      obj = smartParseJSON(full);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
      dbg('TIPS_STREAM_ERR', e.message);
    }
    if (!obj) {
      const retried = await callAndParseJSON(messages, { temperature: 0.3, maxTokens: maxTokens }, (o) => o && (o.type || o.word));
      obj = retried.obj;
      if (retried.raw) accText = retried.raw;
    }
    let html;
    if (obj && obj.type === 'sentence') {
      html = '<div style="font-weight:700;font-size:14px;margin-bottom:6px;color:var(--primary)">📝 句子分析</div>';
      html += '<div style="font-size:13px;margin-bottom:4px"><strong>原文</strong><br>' + esc(obj.original) + '</div>';
      html += '<div style="font-size:13px;margin-bottom:8px;color:var(--green)"><strong>翻译</strong><br>' + renderMD(obj.translation, 'markdown') + '</div>';
      if (obj.breakdown) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;padding:8px;background:var(--primary-bg);border-radius:8px;line-height:1.6" class="md-content">' + renderMD(obj.breakdown, 'markdown') + '</div>';
      if (obj.vocab && obj.vocab.length) {
        html += '<div style="font-size:12px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>📖 词汇</strong></div>';
        obj.vocab.forEach(v => {
          const w = esc((v.word || '').replace(/'/g, '\\\''));
          const m = esc((v.meaning || '').replace(/'/g, '\\\''));
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px;padding:6px 8px;background:var(--bg);border-radius:6px">';
          html += '<strong style="color:var(--text)">' + esc(v.word) + '</strong>';
          if (v.part) html += ' <span style="font-size:10px;color:var(--text2)">' + esc(v.part) + '</span>';
          html += ' — ' + esc(v.meaning || '');
          if (v.note) html += '<br><span style="color:var(--text2)">' + esc(v.note) + '</span>';
          html += '<button onclick="event.stopPropagation();quickAddToAnki(\'' + w + '\',\'' + m + '\')" style="float:right;border:none;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;margin-left:4px" title="添加到 Anki">📚</button><button onclick="event.stopPropagation();quickAddVocab(\'' + w + '\',\'' + m + '\')" style="float:right;border:none;background:var(--primary);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer">+</button>';
          html += '</div>';
        });
      }
      if (obj.phrases && obj.phrases.length) {
        html += '<div style="font-size:12px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>🔤 常用搭配</strong></div>';
        obj.phrases.forEach(p => {
          const w = esc((p.phrase || '').replace(/'/g, '\\\''));
          const m = esc((p.meaning || '').replace(/'/g, '\\\''));
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px;padding:6px 8px;background:var(--green-bg);border-radius:6px">';
          html += '<strong style="color:var(--green)">' + esc(p.phrase) + '</strong> — ' + esc(p.meaning || '');
          if (p.usage) html += '<br><span style="color:var(--text2)">' + esc(p.usage) + '</span>';
          html += '<button onclick="event.stopPropagation();quickAddToAnki(\'' + w + '\',\'' + m + '\')" style="float:right;border:none;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;margin-left:4px" title="添加到 Anki">📚</button><button onclick="event.stopPropagation();quickAddVocab(\'' + w + '\',\'' + m + '\')" style="float:right;border:none;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer">+</button>';
          html += '</div>';
        });
      }
    } else if (obj && obj.type === 'phrase') {
      html = '<div style="font-weight:700;font-size:16px;margin-bottom:6px;color:var(--primary)">' + esc(obj.phrase || obj.original || '') + '</div>';
      if (obj.part) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(obj.part) + '</div>';
      if (obj.meaning) html += '<div style="font-size:14px;margin-bottom:6px;color:var(--green)"><strong>' + esc(obj.meaning) + '</strong></div>';
      if (obj.breakdown) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;padding:8px;background:var(--primary-bg);border-radius:8px;line-height:1.6">' + esc(obj.breakdown) + '</div>';
      if (obj.examples && obj.examples.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>例句</strong></div>';
        obj.examples.forEach(ex => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px">';
          if (ex.en) html += '<div style="color:var(--text)">' + esc(ex.en) + '</div>';
          if (ex.zh) html += '<div style="color:var(--text2)">' + esc(ex.zh) + '</div>';
          html += '</div>';
        });
      }
      if (obj.collocations && obj.collocations.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>相关搭配</strong></div>';
        obj.collocations.forEach(c => html += '<div style="font-size:12px;line-height:1.6">• ' + esc(c) + '</div>');
      }
      if (obj.synonyms && obj.synonyms.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>近义表达</strong></div>';
        obj.synonyms.forEach(s => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:3px"><strong>' + esc(s.phrase || s.word || '') + '</strong>';
          if (s.note) html += ' — ' + esc(s.note);
          html += '</div>';
        });
      }
    } else if (obj && obj.word) {
      html = '<div style="font-weight:700;font-size:16px;margin-bottom:6px">' + esc(obj.word) + '</div>';
      if (obj.phonetic) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(obj.phonetic) + '</div>';
      if (obj.part) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(obj.part) + '</div>';
      // Show variants
      if (obj.variants && typeof obj.variants === 'object') {
        const v = Object.entries(obj.variants).filter(([k, val]) => val);
        if (v.length) {
          html += '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;padding:6px 8px;background:var(--bg);border-radius:6px">';
          html += '<strong>变形:</strong> ' + v.map(([k, val]) => esc(val)).join(' · ');
          html += '</div>';
        }
      }
      if (obj.meanings && obj.meanings.length) {
        html += '<div style="margin-bottom:6px">' + obj.meanings.map(m => '<div style="font-size:13px;line-height:1.6">• ' + esc(m) + '</div>').join('') + '</div>';
      }
      if (obj.examples && obj.examples.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>例句</strong></div>';
        obj.examples.forEach(ex => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px">';
          if (ex.en) html += '<div style="color:var(--text)">' + esc(ex.en) + '</div>';
          if (ex.zh) html += '<div style="color:var(--text2)">' + esc(ex.zh) + '</div>';
          html += '</div>';
        });
      }
      if (obj.collocations && obj.collocations.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>常见搭配</strong></div>';
        obj.collocations.forEach(c => {
          html += '<div style="font-size:12px;line-height:1.6">• ' + esc(c) + '</div>';
        });
      }
      if (obj.synonyms && obj.synonyms.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>同义词辨析</strong></div>';
        obj.synonyms.forEach(s => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:3px"><strong>' + esc(s.word || '') + '</strong>';
          if (s.note) html += ' — ' + esc(s.note);
          html += '</div>';
        });
      }
      if (obj.etymology) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>📜 词源</strong><div style="line-height:1.6;margin-top:2px">' + esc(obj.etymology) + '</div></div>';
      }
    } else {
      // Fallback: try to extract readable content from the response
      html = renderDictFallback(stripThinking(accText), text);
    }
    // Only cache single-word lookups; sentence/phrase meanings are context-dependent
    if (!isPhrase && !isSentence) translateCache[text] = html;
    meanEl.innerHTML = html;
    repositionTip();
  } catch (err) {
    meanEl.innerHTML = '<span style="color:var(--red)">翻译失败: ' + esc(err.message.substring(0, 60)) + '</span>';
  }
}

function quickAddVocab(word, meaning) {
  const v = getVocab();
  if (!v.some(i => i.word && i.word.toLowerCase() === word.toLowerCase())) {
    // 提取原句作为语境
    const selection = window.getSelection();
    let context = word;
    if (selection && selection.rangeCount) {
      const rng = selection.getRangeAt(0);
      const container = rng.startContainer;
      if (container && container.textContent && container.textContent !== word) {
        const fullText = container.textContent;
        const idx = fullText.indexOf(word);
        if (idx >= 0) {
          const start = Math.max(0, fullText.lastIndexOf('.', idx - 1) + 1);
          const end = fullText.indexOf('.', idx + word.length);
          context = fullText.slice(start, end >= 0 ? end + 1 : undefined).trim();
        }
      }
    }
    v.push({ word: word, translation: meaning || '', context: context, added: new Date().toISOString().slice(0, 10) });
    saveVocab(v);
    renderVocab();
  }
}

/* 快速添加到 Anki（词典模式用） */
async function quickAddToAnki(word, meaning) {
  if (!word) return;
  const ctx = window.getSelection()?.toString() || word;
  try {
    await ensureQuizModelAndDeck();
    // 默写题型：Front=中文释义，Back=英文单词+语境
    const frontText = meaning || word;
    const backText = word + '\n\n💬 语境：' + ctx.substring(0, 120);
    const res = await ankiAddNotesBatch([{
      deckName: ankiVocabDeck(), modelName: VOCAB_MODEL,
      fields: { Front: frontText, Back: backText },
      tags: [ankiUserTag(), 'vocabulary']
    }]);
    if (res.added > 0) toastMsg('📚 已添加到 Anki 词汇牌组');
    else toastMsg('📚 卡片已存在，已跳过');
  } catch (e) { toastMsg('❌ 添加到 Anki 失败：' + (e.message || '')); }
}

/* ---------- Fallback render for unparseable JSON ---------- */
function renderDictFallback(text, inputWord) {
  // Try to extract key fields with regex
  let html = '';
  // 如果文本是 JSON，格式化显示
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      html += '<div style="font-size:11px;color:var(--text2);margin-bottom:4px">⚠️ 解析为结构化数据失败，以下为原始JSON</div>';
      html += '<pre style="font-size:11px;color:var(--text2);white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:8px;max-height:50vh;overflow-y:auto;margin:0;line-height:1.5">' + esc(JSON.stringify(parsed, null, 2)) + '</pre>';
      return html;
    } catch (e) { /* fall through to regex */ }
  }
  // Extract word
  const wm = text.match(/"word"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (wm) {
    html += '<div style="font-weight:700;font-size:16px;margin-bottom:6px">' + esc(wm[1]) + '</div>';
  } else {
    html += '<div style="font-weight:700;font-size:16px;margin-bottom:6px">' + esc(inputWord) + '</div>';
  }
  // Extract phonetic
  const pm = text.match(/"phonetic"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (pm) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(pm[1]) + '</div>';
  // Extract part of speech
  const ptm = text.match(/"part"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (ptm) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(ptm[1]) + '</div>';
  // Extract meanings
  const mm = text.match(/"meanings"\s*:\s*\[([\s\S]*?)\]/);
  if (mm) {
    const meanings = mm[1].match(/"((?:[^"\\]|\\.)*)"/g);
    if (meanings) {
      html += '<div style="margin-bottom:6px">' + meanings.map(m => '<div style="font-size:13px;line-height:1.6">• ' + esc(m.replace(/^"|"$/g, '')) + '</div>').join('') + '</div>';
    }
  }
  // If nothing was extracted, show the text in a code block
  if (!html) {
    html = '<pre style="font-size:11px;color:var(--text2);white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:8px;max-height:200px;overflow-y:auto">' + esc(text) + '</pre>';
  }
  return html;
}

function repositionTip() {
  const tip = document.getElementById('translateTip');
  if (tip.style.display !== 'flex' && !tip.classList.contains('tip-visible')) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  let x = parseInt(tip.style.left) || 0;
  let y = parseInt(tip.style.top) || 0;
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  // Clamp to viewport
  if (x + tipW > vw - margin) x = vw - tipW - margin;
  if (x < margin) x = margin;
  if (y + tipH > vh - margin) y = vh - tipH - margin;
  if (y < margin) y = margin;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function showTip(rect, word) {
  const tip = document.getElementById('translateTip');
  // Reset position to measure actual size
  tip.style.display = 'flex';
  tip.classList.add('tip-visible');
  tip.style.left = '-9999px';
  tip.style.top = '-9999px';
  tip.style.width = '300px';
  tip.style.height = '500px';
  const tipW = 300, tipH = 500;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 10;

  // 尝试四个方向：正上 → 正下 → 正左 → 正右，以优先选择能完整显示的方向
  const candidates = [
    // 上：正上方居中
    { x: rect.left + rect.width / 2 - tipW / 2, y: rect.top - tipH - margin },
    // 下：正下方居中
    { x: rect.left + rect.width / 2 - tipW / 2, y: rect.bottom + margin },
    // 左：正左侧垂直居中
    { x: rect.left - tipW - margin, y: rect.top + rect.height / 2 - tipH / 2 },
    // 右：正右侧垂直居中
    { x: rect.right + margin, y: rect.top + rect.height / 2 - tipH / 2 },
  ];

  let best = null;
  for (const c of candidates) {
    if (c.x + tipW <= vw - margin && c.x >= margin && c.y + tipH <= vh - margin && c.y >= margin) {
      best = c;
      break;
    }
  }
  if (!best) {
    // 没有方向能完整显示 → 右下方贴近
    best = { x: Math.max(margin, Math.min(rect.right - tipW / 2, vw - tipW - margin)), y: Math.min(rect.bottom + margin, vh - tipH - margin) };
  }
  tip.style.left = Math.round(best.x) + 'px';
  tip.style.top = Math.round(best.y) + 'px';
}

function hideTip() {
  const tip = document.getElementById('translateTip');
  tip.style.display = 'none';
  tip.classList.remove('tip-visible');
  tip.style.width = '';
  tip.style.height = '';
}

/* ---------- 翻译浮层拖拽 + 右下角缩放 ---------- */
(function initTipDragResize() {
  const tip = document.getElementById('translateTip');
  const dragBar = document.getElementById('tipDragBar');
  const resizeH = document.getElementById('tipResize');
  if (!tip || !dragBar || !resizeH) return;

  dragBar.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origLeft = parseInt(tip.style.left) || tip.offsetLeft;
    const origTop = parseInt(tip.style.top) || tip.offsetTop;
    function onMove(ev) {
      tip.style.left = (origLeft + ev.clientX - startX) + 'px';
      tip.style.top = (origTop + ev.clientY - startY) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      repositionTip();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  resizeH.addEventListener('mousedown', function(e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = tip.offsetWidth, startH = tip.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    function onMove(ev) {
      let w = Math.max(220, Math.min(startW + ev.clientX - startX, vw - 40));
      let h = Math.max(90, Math.min(startH + ev.clientY - startY, vh - 40));
      tip.style.width = w + 'px';
      tip.style.height = h + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      repositionTip();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

function addFromTip() {
  const v = getVocab();
  if (!v.some(i => i.word && i.word.toLowerCase() === tipSelected.toLowerCase())) {
    // Try to parse the rich translation data
    const meanEl = document.getElementById('tipMeaning');
    let word = tipSelected;
    let translation = meanEl.textContent || '';
    let part = '';
    let example = '';
    // Extract from the inner HTML if it's structured
    const html = meanEl.innerHTML || '';
    const partMatch = html.match(/<div[^>]*>([^<]*)<\/div>/);
    // Simple extraction: use the first line as translation
    const lines = translation.split('\n').filter(l => l.trim());
    translation = lines[0] || translation;
    // 提取原句作为语境：从选中的文本所在的消息中提取整个句子
    const selection = window.getSelection();
    let context = tipSelected;
    if (selection && selection.rangeCount) {
      const rng = selection.getRangeAt(0);
      const container = rng.startContainer;
      if (container && container.textContent) {
        const fullText = container.textContent;
        const idx = fullText.indexOf(tipSelected);
        if (idx >= 0) {
          const start = Math.max(0, fullText.lastIndexOf('.', idx - 1) + 1);
          const end = fullText.indexOf('.', idx + tipSelected.length);
          context = fullText.slice(start, end >= 0 ? end + 1 : undefined).trim();
        }
      }
    }
    v.push({
      word: word,
      translation: translation.substring(0, 100),
      part: part,
      example: example,
      context: context,
      added: new Date().toISOString().slice(0, 10)
    });
    saveVocab(v);
    renderVocab();
  }
  hideTip();
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('#translateTip') && !e.target.closest('.ai-bubble') && !e.target.closest('.user-bubble')) {
    hideTip();
  }
});

/* ---------- Debug Export ---------- */
/* 后台 Agent（策略师/执行者）运行情况 —— 仅在调试面板展示 */
function buildAgentDebugHTML() {
  let html = '<div style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:8px">' +
    '<div style="font-weight:600;font-size:13px;color:var(--text2);margin-bottom:6px">🧠 后台 Agent 运行记录（本次会话）</div>';
  if (!agentRuntimeLog.length) {
    html += '<div class="empty" style="padding:8px 0">暂无后台活动</div>';
  } else {
    html += '<div style="max-height:180px;overflow-y:auto;background:#0f172a;color:#cbd5e1;border-radius:8px;padding:8px;font-size:11px;line-height:1.7;font-family:Consolas,monospace">';
    for (const e of agentRuntimeLog) {
      const t = (new Date(e.t)).toLocaleTimeString('zh-CN', { hour12: false });
      const label = e.agent === 'strategist' ? '策略师' : e.agent === 'executor' ? '执行者' : e.agent;
      const color = e.agent === 'strategist' ? '#f59e0b' : '#22c55e';
      html += '<div><span style="color:#64748b">' + t + '</span> <span style="color:' + color + '">[' + label + ']</span> ' + esc(e.msg) + '</div>';
    }
    html += '</div>';
  }
  // 按消息归纳
  html += '<div style="margin-top:8px;max-height:180px;overflow-y:auto">';
  let hasPerMsg = false;
  for (const item of getActivePath()) {
    if (item.role !== 'user' || (!item.strategy && !item.research)) continue;
    hasPerMsg = true;
    html += '<div style="border-top:1px dashed var(--border);padding:6px 0;font-size:12px">' +
      '<div style="font-weight:600">👤 ' + esc((item.content || '').substring(0, 50)) + '</div>';
    if (item.strategy) {
      html += '<div style="margin-top:2px;color:#b45309">🧠 策略师: ' + esc(JSON.stringify(item.strategy)) + '</div>';
    }
    if (item.research) {
      html += '<div style="margin-top:2px;color:#15803d">🔎 执行者研究（' + (item.research.rounds || []).length + ' 轮）:</div>';
      for (const r of (item.research.rounds || [])) {
        html += '<div style="margin-left:10px;color:var(--text2)">第' + r.round + '轮「' + esc(r.query) + '」→ ' + (r.organic || []).length + ' 条</div>';
      }
      html += '<div style="margin-left:10px;color:var(--text2);white-space:pre-wrap;max-height:120px;overflow-y:auto">' + esc(item.research.summary || '') + '</div>';
    }
    html += '</div>';
  }
  if (!hasPerMsg) html += '<div class="empty" style="padding:6px 0">尚无消息级 Agent 元数据</div>';
  html += '</div></div>';
  // LLM 调用日志
  html += '<div style="border-bottom:1px solid var(--border);padding:8px 0;">' +
    '<div style="font-weight:600;font-size:13px;color:var(--text2);margin-bottom:6px">🤖 大模型调用日志（请求 + 完整响应，含思考）</div>';
  if (!llmRuntimeLog.length) {
    html += '<div class="empty" style="padding:8px 0">暂无 LLM 调用</div>';
  } else {
    html += '<div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px">';
    for (const e of llmRuntimeLog.slice(-30).reverse()) {
      const t = (new Date(e.t)).toLocaleTimeString('zh-CN', { hour12: false });
      const req = e.request;
      const typeColor = e.type === 'call' ? '#2563eb' : '#0891b2';
      html += '<details style="border:1px solid var(--border);border-radius:6px;padding:4px 6px;margin-bottom:4px;font-size:11px">' +
        '<summary style="cursor:pointer;color:var(--text)"><span style="color:' + typeColor + '">' + esc(e.type) + '</span> ' + t +
        ' · ' + esc(Boolean(req && req.model) ? req.model : MODEL) + ' · ' + (req ? req.messages : 0) + ' 条消息 · 响应 ' + (e.response || '').length + ' 字</summary>' +
        (req ? '<div style="margin-top:4px;max-height:300px;overflow-y:auto;background:var(--bg);border-radius:6px;padding:6px"><b>请求消息:</b>' + esc(dbgReqDetail(req)) + '</div>' : '') +
        (e.thinking ? '<div style="margin-top:2px;color:#b45309;max-height:160px;overflow-y:auto"><b>思考:</b>' + esc(e.thinking) + '</div>' : '') +
        '<div style="margin-top:2px;color:var(--text);white-space:pre-wrap;max-height:200px;overflow-y:auto"><b>响应:</b>' + esc(e.response || '(空)') + '</div>' +
        '</details>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function dbgObjSummary(obj) {
  let s = '';
  try { s = JSON.stringify(obj, null, 1); } catch (e) { s = String(obj); }
  return (s || '').substring(0, 300);
}
function dbgReqDetail(req) {
  // 格式化请求消息列表，显示每条消息的 role + content(前200字)
  if (!req || !req.messages || !Array.isArray(req.messages)) {
    try { return JSON.stringify(req, null, 1).substring(0, 1000); } catch (e) { return String(req).substring(0, 1000); }
  }
  return req.messages.map(m => {
    const role = m.role || '?';
    const content = (m.content || '').substring(0, 1000);
    const roleColor = role === 'system' ? '#2563eb' : role === 'user' ? '#059669' : '#d97706';
    return '<div style="margin-bottom:6px;border-bottom:1px dashed #e2e8f0;padding-bottom:4px">' +
      '<span style="color:' + roleColor + ';font-weight:700">' + esc(role) + '</span> ' +
      '<span style="color:var(--text2);font-size:10px">' + ((m.content || '').length) + '字</span><br>' +
      '<span style="white-space:pre-wrap;word-break:break-word">' + esc(content) + (m.content && m.content.length > 1000 ? '...' : '') + '</span></div>';
  }).join('');
}

function exportDebug() {
  // Remove all stuck overlays/modals first
  removeAllModals();
  const snapshot = {
    time: new Date().toISOString(),
    config: { difficulty: currentLevel, topic: currentTopic, api_model: MODEL, api_url: API_URL },
    conversation: getActivePath().map(m => ({
      role: m.role,
      content: (m.content || '').substring(0, 200) + ((m.content || '').length > 200 ? '...' : ''),
      hasFeedback: !!m.feedback && !!m.feedback.analysis
    })),
    lastRawResponse: lastRawResponse ? lastRawResponse.substring(0, 500) + (lastRawResponse.length > 500 ? '...' : '') : '(none)',
    lastThinking: lastThinking ? lastThinking.substring(0, 300) + (lastThinking.length > 300 ? '...' : '') : '(none)',
    lastApiError: lastApiError,
    debugLog: debugLog.slice(-30),
    vocabulary: getVocab().slice(0, 20),
    weakPoints: Object.values(getWeak()).sort((a, b) => b.count - a.count).slice(0, 20),
    userAgent: navigator.userAgent,
  };
  const text = JSON.stringify(snapshot, null, 2);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '调试快照');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:14px;padding:20px;max-width:700px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
  modal.id = 'snapModal';
  modal.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="font-size:16px;font-weight:700">🔧 调试</h3><div style="display:flex;gap:8px"><button id="snapCopyBtn" style="padding:6px 14px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer">复制快照</button><button onclick="this.closest(\'#snapModal\').parentElement.remove()" style="padding:6px 14px;border-radius:8px;border:1px solid #ddd;background:#fff;font-size:13px;cursor:pointer">关闭</button></div></div>' +
    buildAgentDebugHTML() +
    '<div style="font-weight:600;font-size:13px;color:var(--text2);margin:10px 0 4px">📄 调试快照 (JSON)</div>' +
    '<pre style="flex:1;overflow:auto;background:#f8fafc;border-radius:8px;padding:16px;font-size:12px;line-height:1.5;white-space:pre-wrap;margin:0">' + esc(text) + '</pre>';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.getElementById('snapCopyBtn').onclick = function() {
    navigator.clipboard.writeText(text).then(function() {
      const btn = document.getElementById('snapCopyBtn');
      btn.textContent = '已复制 ✓';
      setTimeout(() => { btn.textContent = '复制到剪贴板'; }, 2000);
    }).catch(function() {
      const pre = modal.querySelector('pre');
      const range = document.createRange();
      range.selectNode(pre);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
  };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}

/* ---------- Right Panel Tabs ---------- */
function switchRightTab(tab) {
  document.querySelectorAll('.right-tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.right-tab-content').forEach(c => c.style.display = c.id === 'tab-' + tab ? '' : 'none');
  if (tab === 'dict') { updateDictContext(); renderDictHistory(); }
  if (tab === 'gaokao') {
    const mode = document.getElementById('bankModeSel');
    if (mode && mode.value === 'translate') renderTrBankPanel();
    else loadGaokaoList();
  }
  if (tab === 'feedback') { switchFeedbackTab('current'); }
}

/* ---------- Feedback Inner Tabs (本次反馈 / 生词本 / 薄弱点) ---------- */
function switchFeedbackTab(tab) {
  document.querySelectorAll('#feedbackTabs .right-tab').forEach(b => b.classList.toggle('active', b.dataset.ftab === tab));
  document.querySelectorAll('[data-ftab-pane]').forEach(p => p.style.display = (p.dataset.ftabPane === tab ? '' : 'none'));
}

/* ---------- Gaokao Translation Question Bank ---------- */
let _gaokaoExams = [];
let _gaokaoPushed = new Set();
let _gaokaoSearch = '';
let _gaokaoCurrentExam = null;

async function loadGaokaoList(force) {
  // 如果当前在翻译题库模式，调用 renderTrBankPanel
  const modeEl = document.getElementById('bankModeSel');
  if (modeEl && modeEl.value === 'translate') {
    renderTrBankPanel();
    bindTrBankSearch();
    return;
  }
  if (!isAuthed()) return;
  const el = document.getElementById('gaokaoList');
  if (el) el.innerHTML = '<div class="empty" style="padding:18px 0">⏳ 加载中...</div>';
  const data = await apiGaokaoExams();
  if (!data) { if (el) el.innerHTML = '<div class="empty" style="color:var(--red)">❌ 加载失败</div>'; return; }
  _gaokaoExams = data.exams || [];
  const pushedData = await apiGaokaoPushed();
  _gaokaoPushed = new Set(pushedData.ids || []);
  renderGaokaoList();
  const sEl = document.getElementById('gaokaoSearch');
  if (sEl && !sEl._bound) {
    sEl._bound = true;
    sEl.addEventListener('input', e => { _gaokaoSearch = e.target.value.trim(); renderGaokaoList(); });
  }
}

function bindTrBankSearch() {
  const s = document.getElementById('bankSearch');
  if (s && !s._bound) {
    s._bound = true;
    // oninput 已写在 HTML 上，这里不再重复绑定
  }
}

function renderGaokaoList() {
  const el = document.getElementById('gaokaoList');
  if (!el) return;
  if (!_gaokaoExams.length) { el.innerHTML = '<div class="empty" style="padding:18px 0">题库为空</div>'; return; }
  const search = _gaokaoSearch.toLowerCase();
  const filtered = _gaokaoExams.filter(e => {
    if (!search) return true;
    return (e.exam || '').toLowerCase().includes(search) || (e.year || '').includes(search);
  });
  if (!filtered.length) { el.innerHTML = '<div class="empty">无匹配结果</div>'; return; }
  // 按年份倒序、分组显示
  const byYear = {};
  for (const e of filtered) {
    const y = e.year || '其他';
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(e);
  }
  let html = `<div style="font-size:12px;color:var(--text2);padding:4px 0">共 ${_gaokaoExams.length} 套试卷 / ${filtered.length} 匹配</div>`;
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
  for (const y of years) {
    html += `<div style="font-weight:700;color:var(--primary);margin:8px 0 4px;font-size:13px">📅 ${y}年 (${byYear[y].length}套)</div>`;
    for (const e of byYear[y]) {
      const pushedCount = e.first_id && e.last_id ? Math.max(0, e.last_id - e.first_id + 1 - countUnpushedInExam(e)) : 0;
      // 简单标记：每套的 first_id 在 _gaokaoPushed 中则认为已部分推送
      const isPushed = _gaokaoPushed.has(e.first_id);
      html += `<div class="gaokao-exam-item" onclick="openGaokaoExam('${esc(e.exam).replace(/'/g, "&#39;")}')" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;cursor:pointer;font-size:12px;background:${isPushed ? '#f0f9ff' : '#fff'};position:relative">
        <div style="font-weight:600">${esc(e.exam)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${e.q_count} 道翻译题 ${isPushed ? '<span style="color:var(--green);margin-left:6px">✓ 已推送</span>' : ''}</div>
      </div>`;
    }
  }
  el.innerHTML = html;
}

function countUnpushedInExam(exam) {
  return exam.last_id - exam.first_id + 1;
}

async function openGaokaoExam(examName) {
  _gaokaoCurrentExam = examName;
  const list = document.getElementById('gaokaoList');
  const detail = document.getElementById('gaokaoDetail');
  if (list) list.style.display = 'none';
  if (detail) {
    detail.style.display = '';
    detail.innerHTML = '<div class="empty" style="padding:20px 0">⏳ 加载题目...</div>';
  }
  const data = await apiGaokaoExam(examName);
  if (!data) { if (detail) detail.innerHTML = '<div class="empty" style="color:var(--red)">❌ 加载失败</div>'; return; }
  renderGaokaoDetail(data);
}

function renderGaokaoDetail(data) {
  const detail = document.getElementById('gaokaoDetail');
  if (!detail) return;
  const allPushed = data.questions.every(q => _gaokaoPushed.has(q.id));
  let html = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
    <button onclick="backToGaokaoList()" style="padding:4px 10px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;font-size:12px">← 返回列表</button>
    <div style="flex:1;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(data.exam)}">${esc(data.exam)}</div>
  </div>
  <div style="font-size:11px;color:var(--text2);margin-bottom:8px">${data.questions.length} 道翻译题</div>
  <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
    <button id="gaokaoPushAllBtn" onclick="gaokaoPushAll('${esc(data.exam).replace(/'/g, "\\'")}')" style="padding:6px 12px;border:none;background:var(--primary);color:#fff;border-radius:6px;cursor:pointer;font-size:12px;flex:1">📤 全部推送到 Anki</button>
    <button onclick="gaokaoMarkOpened();" style="padding:6px 12px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;font-size:12px">🔄 刷新状态</button>
  </div>
  <div id="gaokaoQuestions">`;
  for (const q of data.questions) {
    const pushed = _gaokaoPushed.has(q.id);
    const words = Array.isArray(q.q_words) ? q.q_words : [];
    const wordsHtml = words.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;align-items:center">' +
          '<span style="font-size:10px;color:var(--text2)">🔑 必用词</span>' +
          words.map(w => '<span style="font-size:11px;padding:1px 7px;border-radius:10px;background:#fef3c7;color:#92400e;border:1px solid #fde68a">' + esc(w) + '</span>').join('') +
        '</div>'
      : '';
    html += `<div class="gaokao-q-item" style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:${pushed ? '#f0fdf4' : '#ffffff'};position:relative">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="font-weight:600;color:var(--primary);font-size:12px">#${esc(q.q_no)}</span>
        ${pushed ? '<span style="font-size:10px;color:var(--green);background:#dcfce7;padding:1px 6px;border-radius:4px">✓ 已推 Anki</span>' : ''}
      </div>
      ${wordsHtml}
      <div style="font-size:13px;line-height:1.6;margin-bottom:6px">${esc(q.q_text)}</div>
      <details style="margin-top:6px">
        <summary style="cursor:pointer;font-size:11px;color:var(--primary);user-select:none">🔍 显示参考答案</summary>
        <div style="font-size:13px;line-height:1.6;margin-top:6px;padding:8px;background:var(--primary-bg);border-radius:6px">${esc(q.a_text)}</div>
      </details>
      ${pushed ? '' : `<button onclick="gaokaoPushOne(${q.id})" style="margin-top:6px;padding:4px 10px;border:none;background:var(--green);color:#fff;border-radius:6px;cursor:pointer;font-size:11px">📤 推送</button>`}
    </div>`;
  }
  html += '</div>';
  detail.innerHTML = html;
}

function backToGaokaoList() {
  _gaokaoCurrentExam = null;
  const list = document.getElementById('gaokaoList');
  const detail = document.getElementById('gaokaoDetail');
  if (list) list.style.display = '';
  if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
}

async function gaokaoRefreshPushed() {
  const pushedData = await apiGaokaoPushed();
  _gaokaoPushed = new Set(pushedData.ids || []);
}

async function gaokaoPushOne(id) {
  toastMsg('⏳ 推送到 Anki...');
  const r = await apiGaokaoPushToAnki([id]);
  if (r && r.ok) {
    toastMsg(`✅ 已添加 ${r.added} 张到 Anki`);
    await gaokaoRefreshPushed();
    if (_gaokaoCurrentExam) {
      const data = await apiGaokaoExam(_gaokaoCurrentExam);
      if (data) renderGaokaoDetail(data);
    }
  } else {
    toastMsg('❌ 推送失败：' + (r && r.error ? r.error : '未知错误'));
  }
}

async function gaokaoPushAll(examName) {
  if (!confirm('确定把这套试卷所有翻译题推送到 Anki？')) return;
  const data = await apiGaokaoExam(examName);
  if (!data) return;
  const ids = data.questions.filter(q => !_gaokaoPushed.has(q.id)).map(q => q.id);
  if (!ids.length) { toastMsg('没有需要推送的题（都已推送）'); return; }
  toastMsg('⏳ 批量推送中...');
  // 分批 5 题
  let total = 0, skipped = 0;
  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5);
    const r = await apiGaokaoPushToAnki(batch);
    if (r && r.ok) { total += r.added; skipped += r.skipped; }
  }
  toastMsg(`✅ 已添加 ${total} 张${skipped ? '，跳过 ' + skipped + ' 张重复' : ''}`);
  await gaokaoRefreshPushed();
  const fresh = await apiGaokaoExam(examName);
  if (fresh) renderGaokaoDetail(fresh);
  renderGaokaoList();
}

function gaokaoMarkOpened() {
  if (_gaokaoCurrentExam) {
    apiGaokaoExam(_gaokaoCurrentExam).then(d => { if (d) renderGaokaoDetail(d); });
  }
}

/* ---------- Dictionary / Translator ---------- */
// 词典查询历史记录（最多 12 条，存 localStorage）
function saveDictHistory(text, feedbackHtml) {
  if (!text) return;
  const list = getSetting('dictHistory', []);
  const item = { text, t: Date.now() };
  if (feedbackHtml) item.feedback = feedbackHtml;
  const idx = list.findIndex(x => x.text === text);
  if (idx >= 0) {
    list.splice(idx, 1);
    // 旧的 feedback 也丢弃，让最新一次的结果生效
  }
  list.unshift(item);
  setSetting('dictHistory', list.slice(0, 12));
}

function renderDictHistory() {
  const el = document.getElementById('dictHistory');
  if (!el) return;
  const list = getSetting('dictHistory', []);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="font-size:10px;color:var(--text2);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">' +
    '🕘 查询历史（点击查看反馈）' +
    '<span onclick="clearDictHistory()" style="cursor:pointer;color:var(--text2);font-size:10px" title="清空历史">🗑️ 清空</span>' +
    '</div>' +
    list.map((x, i) => {
      const tm = new Date(x.t || Date.now());
      const ts = (tm.getMonth() + 1) + '-' + tm.getDate() + ' ' + String(tm.getHours()).padStart(2, '0') + ':' + String(tm.getMinutes()).padStart(2, '0');
      const hasFeedback = !!x.feedback;
      return '<div style="padding:2px 4px;border-radius:4px;line-height:1.5">' +
        '<div onclick="queryDictFromHistory(' + i + ')" title="点击重新查询" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;white-space:nowrap">' +
        '<span style="overflow:hidden;text-overflow:ellipsis;user-select:none">' + esc(x.text.length > 28 ? x.text.substring(0, 28) + '…' : x.text) + '</span>' +
        '<span style="color:var(--text3);font-size:10px;flex-shrink:0;margin-left:6px">' + ts + '</span></div>' +
        (hasFeedback ? '<div onclick="toggleDictFeedback(' + i + ')" style="font-size:10px;color:var(--primary);cursor:pointer;margin-top:2px;user-select:none">📋 查看上次反馈</div>' +
          '<div id="dictFb_' + i + '" style="display:none;margin-top:4px;padding:6px;background:var(--surface);border:1px solid var(--border);border-radius:6px;max-height:200px;overflow-y:auto;font-size:11px">' + x.feedback + '</div>' : '') +
        '</div>';
    }).join('');
}

function toggleDictFeedback(i) {
  const el = document.getElementById('dictFb_' + i);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function clearDictHistory() {
  setSetting('dictHistory', []);
  renderDictHistory();
}

function queryDictFromHistory(idx) {
  const list = getSetting('dictHistory', []);
  const item = list[idx];
  if (!item) return;
  const input = document.getElementById('dictInput');
  if (input) { input.value = item.text; input.focus(); }
  queryDict();
}

function updateDictContext() {
  const el = document.getElementById('dictContext');
  const lastMsgs = getActivePath().slice(-20).map(m => m.role === 'user' ? '我: ' + (m.content || '').substring(0, 100) : 'Alex: ' + (m.content || '').substring(0, 100));
  if (lastMsgs.length) el.textContent = '📌 对话上下文（最近' + lastMsgs.length + '条）';
  else el.textContent = '';
  el.title = lastMsgs.join(' | ');
}

async function queryDict() {
  const input = document.getElementById('dictInput');
  let text = input.value.trim();
  if (!text) return;
  // Detect /ask command
  const isAsk = text.startsWith('/ask ');
  if (isAsk) text = text.slice(5).trim();
  const btn = document.getElementById('dictBtn');
  const resultEl = document.getElementById('dictResult');
  btn.disabled = true;
  btn.textContent = '查询中...';
  resultEl.innerHTML = '<div class="loading">⏳ 查询中...</div>';

  // Add conversation context for dictionary
  let contextText = '';
  const ctxMsgs = getActivePath().slice(-20);
  if (ctxMsgs.length) {
    contextText = '\n\nConversation context (recent messages for reference):\n' + ctxMsgs.map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '').substring(0, 200)).join('\n');
  }

  // Detect mode
  const hasChinese = /[\u4e00-\u9fff]/.test(text);
  const isQuestion = /[?？]/.test(text) || /^(如何|怎么|什么|为什么|能不能|what|how|why|can|is|does)/i.test(text.trim());
  const isEnglishWord = /^[a-zA-Z\s'-]+$/.test(text) && text.split(/\s+/).length <= 3 && !isQuestion;
  const isEnglishSentence = /^[a-zA-Z\s',.!?;-]+$/.test(text) && text.split(/\s+/).length > 3 && !isQuestion;

  try {
    let systemPrompt, maxTokens = 4500;
    // Add conversation context for all queries
    const context = getActivePath().slice(-20).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
    const contextBlock = context ? '\n\nConversation context (for reference):\n' + context : '';

    if (isAsk) {
      // /ask: answer a question about English with structured output
      systemPrompt = 'You are an English tutor. Answer the user\'s question about English in detail. Provide structured output with vocabulary, phrases, and learning points. Return ONLY valid JSON:\n{\n  "type": "ask",\n  "question": "the question",\n  "answer": "detailed answer in Chinese, with explanations and examples",\n  "vocab": [{"word": "word", "meaning": "Chinese meaning", "part": "part of speech", "note": "usage note"}],\n  "phrases": [{"phrase": "phrase", "meaning": "Chinese meaning"}],\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point in Chinese"}],\n  "weak_points": [{"category": "grammar|collocation|vocabulary", "point": "knowledge point", "suggestion": "how to improve"}]\n}' + contextBlock;
    } else if (hasChinese && !isEnglishWord) {
      // Chinese → English translation with multiple expressions
      systemPrompt = 'You are a professional translator and English teacher. Translate the Chinese input into English, providing MULTIPLE expression options at different levels. Return ONLY valid JSON:\n{\n  "type": "zh2en",\n  "original": "the Chinese input",\n  "translations": [{"level": "基础/自然/地道/高级", "text": "English expression", "note": "brief usage note in Chinese"}],\n  "key_phrases": [{"phrase": "phrase", "meaning": "Chinese meaning"}],\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point in Chinese"}],\n  "weak_points": [{"category": "grammar|collocation|vocabulary", "point": "generalizable knowledge point", "suggestion": "how to improve"}]\n}';
    } else if (isEnglishWord) {
      // English word dictionary
      systemPrompt = 'You are a dictionary assistant. For the given English word/phrase, provide a detailed dictionary entry in Chinese. If the word is a morphological variant (plural, past tense, -ing, etc.), show the base/lemma form as the main entry and list all variants. Return ONLY valid JSON:\n{\n  "type": "dict",\n  "word": "base form",\n  "input": "the original selected text",\n  "phonetic": "/IPA/",\n  "part": "词性",\n  "variants": {"plural": "forms", "past": "forms", "present": "forms", "comparative": "forms"} as applicable,\n  "meanings": ["释义1", "释义2"],\n  "examples": [{"en": "English sentence", "zh": "中文翻译"}],\n  "collocations": ["搭配1 (翻译)", "搭配2 (翻译)"],\n  "synonyms": [{"word": "同义词", "note": "辨析说明"}],\n  "etymology": "word origin explanation in Chinese",\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point in Chinese"}]\n}';
    } else if (isEnglishSentence || isQuestion) {
      // English sentence analysis or question
      systemPrompt = 'You are an English tutor. Analyze the given English text or answer the question. Provide translation, breakdown, key vocabulary, and learning points. Return ONLY valid JSON:\n{\n  "type": "analysis",\n  "original": "the input",\n  "translation": "Chinese translation (if applicable)",\n  "answer": "answer to the question (if applicable)",\n  "breakdown": "analysis in Chinese",\n  "vocab": [{"word": "word", "meaning": "Chinese meaning", "part": "part of speech", "note": "usage note"}],\n  "phrases": [{"phrase": "phrase", "meaning": "Chinese meaning"}],\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point in Chinese"}],\n  "weak_points": [{"category": "grammar|collocation|vocabulary", "point": "generalizable knowledge point", "suggestion": "how to improve"}]\n}';
    } else {
      systemPrompt = 'You are an English assistant. Answer the user\'s query about English, providing clear explanations in Chinese. Return ONLY valid JSON:\n{\n  "type": "query",\n  "answer": "detailed answer in Chinese",\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point"}],\n  "weak_points": [{"category": "grammar|collocation|vocabulary", "point": "knowledge point", "suggestion": "how to improve"}]\n}';
    }

    const messages = [
      { role: 'system', content: systemPrompt + '\n\nIMPORTANT: No markdown, no thinking, no extra text. Only valid JSON.' },
      { role: 'user', content: text }
    ];
    let accText = '';
    let obj = null;
    const seenFields = new Set();
    // 手动超时控制器（60s）
    const timeoutCtrl = new AbortController();
    const timeoutId2 = setTimeout(() => timeoutCtrl.abort(), 60000);
    try {
      const full = await streamDict(messages, { temperature: 0.4, maxTokens: maxTokens }, (d) => {
        accText += d;
        const cleanAcc = stripThinking(accText);
        if (cleanAcc === accText && !accText.includes('"')) {
          resultEl.innerHTML = '<pre style="font-size:12px;white-space:pre-wrap;max-height:30vh;overflow-y:auto;margin:0;color:var(--text2);background:var(--bg);padding:8px;border-radius:8px;font-family:inherit;font-size:11px;line-height:1.4">' + esc(accText) + '</pre>';
        } else {
          let incrementalHtml = '';
          const fieldsToCheck = ['type', 'word', 'input', 'phonetic', 'part', 'original', 'translation', 'breakdown', 'meaning', 'answer', 'question_suggestion'];
          for (const k of fieldsToCheck) {
            if (seenFields.has(k)) continue;
            const rawVal = extractBalancedValue(cleanAcc, k);
            if (rawVal) {
              seenFields.add(k);
              try { incrementalHtml += renderDictField(k, JSON.parse(rawVal), ''); } catch (e) { incrementalHtml += renderDictField(k, rawVal, ''); }
            }
          }
          const rawHtml = '<pre style="font-size:12px;white-space:pre-wrap;max-height:30vh;overflow-y:auto;margin:6px 0 0;color:var(--text2);background:var(--bg);padding:4px 6px;border-radius:6px;font-family:inherit;font-size:11px;line-height:1.4">' + esc(accText) + '</pre>';
          resultEl.innerHTML = (incrementalHtml || '<div class="loading" style="padding:8px">⏳ 查询中...</div>') + rawHtml;
        }
      }, timeoutCtrl.signal);
      clearTimeout(timeoutId2);
      obj = smartParseJSON(full);
    } catch (e) {
      clearTimeout(timeoutId2);
      if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
      dbg('DICT_STREAM_ERR', e.message);
    }
    if (!obj) {
      const retried = await callAndParseJSON(messages, { temperature: 0.4, maxTokens: maxTokens }, (o) => o && typeof o.type === 'string');
      obj = retried.obj;
      if (retried.raw) accText = retried.raw;
    }
    const cleaned = stripThinking(accText);

    // Track weak points
    if (obj && obj.weak_points) {
      obj.weak_points.forEach(wp => addWeakPoint(wp.category || '词汇', wp.point || ''));
    }

    let html = '';
    if (obj && obj.type === 'zh2en') {
      html += '<div class="dict-section"><h4>📝 翻译</h4><div style="font-size:13px;color:var(--text2);margin-bottom:8px">' + esc(obj.original) + '</div>';
      if (obj.translations) {
        obj.translations.forEach(t => {
          const level = t.level || '';
          const cls = level.includes('基础') ? 'basic' : level.includes('自然') ? 'natural' : 'advanced';
          const w = esc((t.text || '').replace(/'/g, "\\'"));
          const m = esc((t.note || level || '翻译').replace(/'/g, "\\'"));
          html += '<div class="dict-level ' + cls + '"><div class="dl-label">' + esc(level) + '</div><div class="dl-text">' + esc(t.text) + '</div>';
          if (t.note) html += '<div class="dl-note">' + esc(t.note) + '</div>';
          html += '<button onclick="event.stopPropagation();quickAddToAnki(\'' + w + '\',\'' + m + '\')" style="margin-top:4px;border:none;background:var(--green);color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;margin-left:4px" title="添加到 Anki">📚 Anki</button><button onclick="event.stopPropagation();quickAddVocab(\'' + w + '\',\'' + m + '\')" style="margin-top:4px;border:none;background:var(--primary);color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer">+ 加入生词本</button></div>';
        });
      }
      if (obj.key_phrases) {
        html += '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">';
        obj.key_phrases.forEach(p => {
          const w = esc((p.phrase || '').replace(/'/g, "\\'"));
          const m = esc((p.meaning || '').replace(/'/g, "\\'"));
          html += '<span class="dict-phrase" onclick="quickAddVocab(\'' + w + '\',\'' + m + '\')"><span class="dp-add">+</span> ' + esc(p.phrase) + ' <span style="font-size:10px;color:var(--text2)">' + esc(p.meaning) + '</span></span>';
        });
        html += '</div>';
      }
      html += '</div>';
    } else if (obj && obj.type === 'dict') {
      html += '<div class="dict-section"><h4>📖 词典</h4>';
      html += '<div style="font-weight:700;font-size:16px;margin-bottom:4px">' + esc(obj.word) + '</div>';
      if (obj.phonetic) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:4px">' + esc(obj.phonetic) + '</div>';
      if (obj.part) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(obj.part) + '</div>';
      if (obj.variants && typeof obj.variants === 'object') {
        const v = Object.entries(obj.variants).filter(([k, val]) => val);
        if (v.length) {
          html += '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;padding:6px 8px;background:var(--bg);border-radius:6px">';
          html += '<strong>变形:</strong> ' + v.map(([k, val]) => esc(val)).join(' · ');
          html += '</div>';
        }
      }
      if (obj.meanings) html += obj.meanings.map(m => '<div style="font-size:13px;line-height:1.6">• ' + esc(m) + '</div>').join('');
      if (obj.examples) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)"><strong>例句</strong></div>';
        obj.examples.forEach(ex => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px">';
          if (ex.en) html += '<div style="color:var(--text)">' + esc(ex.en) + '</div>';
          if (ex.zh) html += '<div style="color:var(--text2)">' + esc(ex.zh) + '</div>';
          html += '</div>';
        });
      }
      if (obj.collocations) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)"><strong>常见搭配</strong></div>';
        obj.collocations.forEach(c => html += '<div style="font-size:12px;line-height:1.6">• ' + esc(c) + '</div>');
      }
      if (obj.synonyms) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)"><strong>同义词辨析</strong></div>';
        obj.synonyms.forEach(s => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:3px"><strong>' + esc(s.word) + '</strong>';
          if (s.note) html += ' — ' + esc(s.note);
          html += '</div>';
        });
      }
      if (obj.etymology) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>📜 词源</strong><div style="line-height:1.6;margin-top:2px">' + esc(obj.etymology) + '</div></div>';
      }
      html += '</div>';
    } else if (obj && (obj.type === 'analysis' || obj.type === 'query')) {
      if (obj.original) html += '<div class="dict-section"><h4>📝 ' + (obj.type === 'analysis' ? '分析' : '回答') + '</h4>';
      if (obj.original) html += '<div style="font-size:13px;color:var(--text2);margin-bottom:6px">' + esc(obj.original) + '</div>';
      if (obj.translation) html += '<div style="font-size:13px;color:var(--green);margin-bottom:6px"><strong>翻译</strong> ' + esc(obj.translation) + '</div>';
      if (obj.answer) html += '<div style="font-size:13px;line-height:1.6;margin-bottom:8px;padding:8px;background:var(--primary-bg);border-radius:8px" class="md-content">' + renderMD(obj.answer, 'markdown') + '</div>';
      if (obj.breakdown) html += '<div style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:8px;padding:8px;background:var(--bg);border-radius:8px">' + esc(obj.breakdown) + '</div>';
      html += '</div>';
      if (obj.vocab && obj.vocab.length) {
        html += '<div class="dict-section"><h4>📖 词汇</h4>';
        obj.vocab.forEach(v => {
          const w = esc((v.word || '').replace(/'/g, "\\'"));
          const m = esc((v.meaning || '').replace(/'/g, "\\'"));
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px;padding:6px 8px;background:var(--bg);border-radius:6px">';
          html += '<strong>' + esc(v.word) + '</strong>';
          if (v.part) html += ' <span style="font-size:10px;color:var(--text2)">' + esc(v.part) + '</span>';
          html += ' — ' + esc(v.meaning || '');
          if (v.note) html += '<br><span style="color:var(--text2)">' + esc(v.note) + '</span>';
          html += '<button onclick="event.stopPropagation();quickAddToAnki(\'' + w + '\',\'' + m + '\')" style="float:right;border:none;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;margin-left:4px" title="添加到 Anki">📚</button><button onclick="event.stopPropagation();quickAddVocab(\'' + w + '\',\'' + m + '\')" style="float:right;border:none;background:var(--primary);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer">+</button>';
          html += '</div>';
        });
        html += '</div>';
      }
      if (obj.phrases && obj.phrases.length) {
        html += '<div class="dict-section"><h4>🔤 常用搭配</h4>';
        obj.phrases.forEach(p => {
          const w = esc((p.phrase || '').replace(/'/g, "\\'"));
          const m = esc((p.meaning || '').replace(/'/g, "\\'"));
          html += '<span class="dict-phrase" onclick="quickAddVocab(\'' + w + '\',\'' + m + '\')"><span class="dp-add">+</span> ' + esc(p.phrase) + ' <span style="font-size:10px;color:var(--text2)">' + esc(p.meaning) + '</span></span>';
        });
        html += '</div>';
      }
    } else if (obj && obj.answer) {
      html += '<div style="font-size:13px;line-height:1.6;padding:8px;background:var(--primary-bg);border-radius:8px" class="md-content">' + renderMD(obj.answer, 'markdown') + '</div>';
    } else {
      html = esc(cleaned || raw);
    }

    // Extensions
    if (obj && obj.extensions && obj.extensions.length) {
      html += '<div class="dict-section"><h4>💡 拓展知识</h4>';
      obj.extensions.forEach(e => {
        html += '<div class="dict-ext" style="background:var(--green-bg);padding:8px 10px;border-radius:8px;margin-bottom:6px;font-size:12px;line-height:1.6">';
        html += '<span class="ext-type" style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--green)">' + esc(e.type || 'knowledge') + '</span>';
        if (e.title) html += ' <strong>' + esc(e.title) + '</strong>';
        html += '<div style="margin-top:2px">' + esc(e.content) + '</div></div>';
      });
      html += '</div>';
    }

    resultEl.innerHTML = html;
    saveDictHistory(text, html);
    // Track weak points from dict
    if (obj && obj.weak_points) {
      obj.weak_points.forEach(wp => addWeakPoint(wp.category || '词汇', wp.point || ''));
    }
  } catch (err) {
    resultEl.innerHTML = '<div style="color:var(--red);font-size:13px;padding:12px">⚠️ 查询失败: ' + esc(err.message.substring(0, 100)) + '</div>';
    dbg('DICT_ERR', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '查询';
  }
}

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
    (opts.retry ? '<button class="a-btn small" onclick="this.closest(\'.system-error\').remove();(' + opts.retry + ')()">🔄 重试</button>' : '') +
    '<button class="a-btn small ghost" onclick="this.closest(\'.system-error\').remove()">关闭</button>' +
    '</div></div>';
  container.appendChild(el);
  scrollToBottom();
}

/* ---------- Settings Panel ---------- */
function getSavedCharacters() {
  const v = getSetting('characters', null) || [];
  // 合并内置角色与用户自定义角色
  const builtins = CHARACTERS.map(c => c.id);
  const customs = (Array.isArray(v) ? v : []).filter(c => c && c.id && !builtins.includes(c.id));
  return [...CHARACTERS, ...customs];
}

function getActiveCharacterId() {
  return getSetting('activeCharacter', 'alex');
}

function setActiveCharacterId(id) {
  setSetting('activeCharacter', id);
  activeCharacterId = id;
  alexBackstory = '';
}

function openSettings() {
  // Remove all stuck overlays/modals first
  removeAllModals();
  const old = document.getElementById('settingsModal');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'settingsTitle');
  const modal = document.createElement('div');
  modal.id = 'settingsModal';
  modal.className = 'modal-card';
  modal.style.maxWidth = '560px';
  modal.style.padding = '0';
  const isAnki = getSetting('ankiAutoAdd', false);
  const isAuto = getSetting('autoRead', false);
  const isStream = getSetting('streamChat', true);
  const isStrategist = getSetting('strategistEnabled', true);
  const isExecutor = getSetting('executorEnabled', true);
  const isMusic = musicEnabled();
  const isMusicAutoNext = musicAutoNext();
  const musicVol = Math.max(0, Math.min(100, parseInt(localStorage.getItem('ai_en_music_vol') || '60', 10)));
  const avatar = getSetting('avatar', '');
  const activeChar = getActiveCharacterId();
  const saveChars = getSavedCharacters();
  const charOptions = saveChars.map(c =>
    `<div class="char-option ${c.id === activeChar ? 'active' : ''}" onclick="settingsSelectCharacter('${esc(c.id)}')">
       <span class="char-flag">${esc(c.avatar || '🤖')}</span>
       <div class="char-info"><strong>${esc(c.name || c.fullName || c.id)}</strong><small>${esc(c.city || '')} · ${esc((c.interests || []).slice(0,2).join(', '))}</small></div>
     </div>`).join('');
  const strategistHistory = getSetting('strategistInstructions', []);
  const strategistItems = Array.isArray(strategistHistory) ? strategistHistory : [];
  const strategistHTML = strategistItems.length
    ? '<div id="strategistHistory" style="max-height:140px;overflow-y:auto;margin-top:6px">' + strategistItems.map((it, i) =>
        `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;background:var(--bg);border-radius:8px;margin-bottom:6px;font-size:12px">
           <span style="flex:1;word-break:break-all">${esc(it.text)}</span>
           ${it.permanent ? '<span style="color:var(--amber);flex-shrink:0">📌 常驻</span>' : ''}
           <span style="color:var(--text2);flex-shrink:0;font-size:11px">${esc((it.time || '').slice(5, 16))}</span>
           <button onclick="deleteStrategistInstruction(${i})" style="border:none;background:none;color:var(--text2);cursor:pointer;font-size:13px;flex-shrink:0" title="删除">×</button>
         </div>`).join('') + '</div>'
    : '<div class="empty" style="padding:8px 0;font-size:12px">暂无指令，发送一条试试</div>';
  modal.innerHTML = `<div class="modal-header"><h3 id="settingsTitle">⚙️ 设置</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()" aria-label="关闭">×</button></div>
    <div class="modal-body">

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:10px">👤 账户</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div id="avatarPreview" style="width:52px;height:52px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;font-size:26px;overflow:hidden;border:1px solid var(--border)">${avatar ? '<img src="' + esc(avatar) + '" style="width:100%;height:100%;object-fit:cover">' : '👤'}</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:13px">当前账户：<strong>${esc(currentUser() || '')}</strong></span>
          <button onclick="document.getElementById('avatarFile').click()" style="padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:#fff;font-size:12px;cursor:pointer">🖼️ 上传头像</button>
          <input type="file" id="avatarFile" accept="image/*" style="display:none" onchange="uploadAvatar(this)">
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-direction:column">
        <input id="setOldPw" type="password" placeholder="原密码" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
        <input id="setNewPw" type="password" placeholder="新密码（至少 4 位）" autocomplete="new-password" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
        <button onclick="changePassword()" style="padding:6px 14px;border-radius:6px;border:none;background:var(--amber);color:#fff;font-size:12px;cursor:pointer;align-self:flex-start">🔑 修改密码</button>
        <div id="pwMsg" style="font-size:12px;color:var(--green);min-height:16px"></div>
      </div>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:10px">🎭 角色卡</div>
      <div style="display:flex;flex-direction:column;gap:6px">${charOptions}</div>
      <button onclick="promptNewCharacter()" style="margin-top:8px;padding:6px 14px;border-radius:6px;border:1px dashed var(--primary);background:#fff;color:var(--primary);font-size:12px;cursor:pointer">＋ 新建角色</button>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">🧭 聊天偏好</div>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setAnki" ${isAnki ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">📚 自动添加到 Anki</span>
      </label>
      <div id="ankiDetail" style="display:${isAnki ? 'block' : 'none'};margin-left:26px;font-size:12px;color:var(--text2);padding:4px 0 6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiVocab" ${getSetting('ankiAutoVocab', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 生词</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiCorr" ${getSetting('ankiAutoCorr', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 纠错</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiExt" ${getSetting('ankiAutoExt', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 拓展知识</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiWeak" ${getSetting('ankiAutoWeak', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 薄弱点自动出题</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiAutoSync" ${getSetting('ankiAutoSync', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 自动同步复习数据（每次对话后）</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiAudio" ${getSetting('ankiAutoAudio', false) ? 'checked' : ''} style="width:15px;height:15px"> 🎵 生词卡片附带发音（ElevenLabs TTS）</label>
      </div>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setAutoRead" ${isAuto ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">🔊 自动朗读回复</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setStream" ${isStream ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">⚡ 流式输出回复</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setStrategist" ${isStrategist ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">🧠 策略师（回复前分析风格与意图）</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setExecutor" ${isExecutor ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">🔎 执行者（需要时联网搜索）</span>
      </label>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:14px;font-weight:600">🎵 背景音乐</div>
        <span id="setMusicStatus" style="font-size:11px;color:var(--text2)">${musicItems.length ? musicItems.length + ' 首曲目' : '正在读取 music/ 目录…'}</span>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-bottom:8px">
        <input type="checkbox" id="setMusicEnabled" ${isMusic ? 'checked' : ''} style="width:16px;height:16px"> 启用顶部音乐按钮
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-bottom:8px">
        <input type="checkbox" id="setMusicAutoNext" ${isMusicAutoNext ? 'checked' : ''} style="width:16px;height:16px"> 播放结束自动切换下一首
      </label>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:12px;white-space:nowrap">当前曲目</span>
        <select id="setMusicTrack" onchange="settingsMusicSelect(this.value)" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">${musicSettingsOptions()}</select>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:12px;white-space:nowrap">音量</span>
        <input type="range" id="setMusicVol" min="0" max="100" step="5" value="${musicVol}" oninput="setMusicVol(this.value)" style="flex:1;accent-color:var(--primary)">
        <span id="setMusicVolValue" style="width:36px;text-align:right;font-size:12px;color:var(--text2)">${musicVol}%</span>
      </div>
      <div style="display:flex;gap:8px">
        <button class="a-btn small" onclick="musicPrev()">⏮ 上一首</button>
        <button class="a-btn primary small" onclick="settingsMusicToggle()">播放 / 暂停</button>
        <button class="a-btn small" onclick="musicNext()">下一首 ⏭</button>
      </div>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">📝 薄弱点出题策略</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">分析发现薄弱点后，AI 自动生成题目推送到 Anki 薄弱点牌组，利用 Anki 的原生排程（FSRS）复习。题组可能在同一道题中考察多个相关薄弱点。</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:12px;white-space:nowrap">出题时机</span>
        <select id="setQuizStrategy" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
          <option value="instant" ${getSetting('ankiQuizStrategy', 'instant') === 'instant' ? 'selected' : ''}>⚡ 即时（发现即出题）</option>
          <option value="batch" ${getSetting('ankiQuizStrategy', 'instant') === 'batch' ? 'selected' : ''}>📦 积攒（攒够一批再出）</option>
        </select>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;flex:1">
          积攒阈值
          <input type="number" id="setQuizBatchSize" value="${getSetting('ankiQuizBatchSize', 5)}" min="2" max="20" style="width:48px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none"> 个
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;flex:1">
          每薄弱点题数
          <input type="number" id="setQuizPerWp" value="${getSetting('ankiQuizPerWp', 2)}" min="1" max="5" style="width:44px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none"> 道
        </label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px"><input type="checkbox" id="setQuizMultiWp" ${getSetting('ankiQuizMultiWp', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 尽量一题多薄弱点（多轮 API 强化覆盖）</label>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">🎯 你想谈论的主题</div>
      <input id="setUserTopic" type="text" value="${esc(getSetting('userTopic',''))}" placeholder="例：科幻电影、健身、心理咨询…（留空则不引导）"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <div style="font-size:14px;font-weight:600;margin:12px 0 6px">📏 回复长度</div>
      <input id="setRespLen" type="text" value="${esc(getSetting('responseLengthGuide',''))}" placeholder="例：约 120 词 / 两三句话 / 用 1 个例句展开…"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">📝 作答设置（作文 / 翻译 / 描述作答框）</div>
      <div style="display:flex;gap:12px;margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;flex:1">
          字体大小
          <select id="setAnswerFontSize" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
            ${[13,14,15,16,17,18,20,22,24].map(v => '<option value="' + v + '"' + (getSetting('answerFontSize', 15) === v ? ' selected' : '') + '>' + v + 'px</option>').join('')}
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;flex:1">
          字体样式
          <select id="setAnswerFontFamily" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
            <option value="inherit" ${getSetting('answerFontFamily','inherit') === 'inherit' ? 'selected' : ''}>默认（跟随系统）</option>
            <option value="Segoe UI, 'PingFang SC', 'Microsoft YaHei', sans-serif" ${getSetting('answerFontFamily','inherit') === "Segoe UI, 'PingFang SC', 'Microsoft YaHei', sans-serif" ? 'selected' : ''}>无衬线（系统）</option>
            <option value="Georgia, 'Times New Roman', serif" ${getSetting('answerFontFamily','inherit') === "Georgia, 'Times New Roman', serif" ? 'selected' : ''}>衬线 Serif</option>
            <option value="'Courier New', monospace" ${getSetting('answerFontFamily','inherit') === "'Courier New', monospace" ? 'selected' : ''}>等宽 Mono</option>
            <option value="'Comic Sans MS', 'Comic Neue', sans-serif" ${getSetting('answerFontFamily','inherit') === "'Comic Sans MS', 'Comic Neue', sans-serif" ? 'selected' : ''}>手写 Comic</option>
            <option value="'Segoe Script', cursive" ${getSetting('answerFontFamily','inherit') === "'Segoe Script', cursive" ? 'selected' : ''}>花体 Cursive</option>
          </select>
        </label>
      </div>
      <div style="font-size:11px;color:var(--text3)">作答框默认在左右留出较大边缘间距，内容变长后会自动缩短边缘留白以容纳更多文字。</div>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">🌐 翻译规则版本（用于翻译题库 / AI 出题 / 评分）</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">选择 AI 评分时使用哪套规则：</div>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 0">
        <input type="radio" name="setTrRule" value="gaokao" ${(getSetting('translationRuleVersion', null) || 'auto') === 'gaokao' ? 'checked' : ''} style="margin-top:3px">
        <div>
          <div style="font-size:13px;font-weight:600">🏫 高考版（默认）</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5">${esc(TRANSLATION_RULES.gaokao.desc)}</div>
        </div>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 0">
        <input type="radio" name="setTrRule" value="standard" ${getSetting('translationRuleVersion', null) === 'standard' ? 'checked' : ''} style="margin-top:3px">
        <div>
          <div style="font-size:13px;font-weight:600">📚 标准版</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5">${esc(TRANSLATION_RULES.standard.desc)}</div>
        </div>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 0">
        <input type="radio" name="setTrRule" value="legacy" ${getSetting('translationRuleVersion', null) === 'legacy' ? 'checked' : ''} style="margin-top:3px">
        <div>
          <div style="font-size:13px;font-weight:600">📜 旧版</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5">${esc(TRANSLATION_RULES.legacy.desc)}</div>
        </div>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 0">
        <input type="radio" name="setTrRule" value="" ${!getSetting('translationRuleVersion', null) ? 'checked' : ''} style="margin-top:3px">
        <div>
          <div style="font-size:13px;font-weight:600">🤖 自动</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5">选择题库自动判定（上海高考 → 高考版，其他 → 标准版）。这是默认行为。</div>
        </div>
      </label>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">注：「必用词」来自题目 JSON 中的「词」字段。当前翻译题库（上海高考 2020-2024 一二三模）共 348 道已注入必用词。</div>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">🤖 策略师指令（引导 Alex 的风格/角色）</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">发送一条指令让策略师在每次回复前参考。可选「常驻」：写入系统提示词长期生效；不勾选则只对下一条消息生效一次。</div>
      <textarea id="setStrategistInstr" rows="2" placeholder="例：让 Alex 更幽默一点 / 扮演一个严格的面试官 / 多用俚语…" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;resize:vertical"></textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="setInstrPermanent" style="width:16px;height:16px">📌 常驻（写入系统提示词）</label>
        <button onclick="sendStrategistInstruction()" style="padding:6px 16px;border-radius:6px;border:none;background:var(--primary);color:#fff;font-size:12px;cursor:pointer">发送指令</button>
      </div>
      <div style="font-size:12px;font-weight:600;margin-top:10px">📜 历史指令</div>
      ${strategistHTML}
    </div>

    <div style="padding:8px 0;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span>📚 AnkiConnect</span>
      <button onclick="checkAnkiConnect()" style="padding:5px 14px;border-radius:6px;border:1px solid var(--border);background:#fff;color:var(--text);font-size:12px;cursor:pointer">🔄 检测连接</button>
      <button onclick="reconnectAnkiConnect()" style="padding:5px 14px;border-radius:6px;border:none;background:var(--primary);color:#fff;font-size:12px;cursor:pointer;display:none" id="reconnectAnkiBtn">重连</button>
      <span id="ankiStatus" style="font-size:12px;color:var(--text2)">未检测</span>
    </div>
    <div style="font-size:11px;color:var(--text2);padding:0 0 6px 0;line-height:1.6">
      当前薄弱点牌组：<code>${esc(ankiWeakDeck())}</code><br>
      笔记类型：<code>${esc(ANKI_QUIZ_MODEL)}</code>（Question/Answer/Explanation）
    </div>
    <div style="padding:8px 0;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span>💾 数据存储</span>
      <span id="storageStatus" style="font-size:12px;color:var(--text2)">${localStorage.getItem('ai_en_convs') ? '本地(有数据)' : '本地(空)'}</span>
    </div>
    <div style="padding:8px 0;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span>📡 后端服务器</span>
      <span id="backendStatus" style="font-size:12px;color:var(--text2)">检测中...</span>
    </div>
    <div style="padding:8px 0;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span>💾 数据备份</span>
      <button onclick="backupNow()" style="padding:5px 14px;border-radius:6px;border:none;background:var(--green);color:#fff;font-size:12px;cursor:pointer">立即备份</button>
      <span id="backupStatus" style="font-size:11px;color:var(--text2)"></span>
    </div>
    </div>
    <div class="modal-footer">
      <button class="a-btn danger" onclick="logoutUser()">🚪 退出登录</button>
      <div style="display:flex;gap:8px">
        <button class="a-btn primary" onclick="saveSettings()">保存设置</button>
        <button class="a-btn" onclick="this.closest('.modal-overlay').remove()">关闭</button>
      </div>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Check backend status
  fetch(BACKEND_URL + '/api/health').then(r => r.json()).then(d => {
    const label = (d && d.status === 'ok') ? '✅ 在线' : ('⚠️ ' + ((d && d.status) || '未知'));
    document.getElementById('backendStatus').textContent = label + ((d && d.minimax !== undefined) ? (' · MiniMax ' + (d.minimax ? '✓' : '✗')) : '');
  }).catch(() => {
    document.getElementById('backendStatus').textContent = '❌ 离线 (需运行 node server.js)';
  });
  // Auto-check AnkiConnect on settings open
  checkAnkiConnect(false);
  // Anki master toggle → 显示/隐藏细分选项
  const setAnkiEl = document.getElementById('setAnki');
  if (setAnkiEl) {
    setAnkiEl.addEventListener('change', function() {
      const detail = document.getElementById('ankiDetail');
      if (detail) detail.style.display = this.checked ? 'block' : 'none';
    });
  }
  // 出题策略联动：批量模式才需要显示积攒阈值
  const strategyEl = document.getElementById('setQuizStrategy');
  if (strategyEl) {
    const batchLabel = strategyEl.closest('div').nextElementSibling;
    function syncStrategyUI() {
      if (batchLabel) batchLabel.style.display = strategyEl.value === 'batch' ? 'flex' : 'none';
    }
    strategyEl.addEventListener('change', syncStrategyUI);
    syncStrategyUI();
  }
  // Show backup status
  const bh = JSON.parse(localStorage.getItem('ai_en_backup_history') || '[]');
  if (bh.length) {
    document.getElementById('backupStatus').textContent = '上次: ' + new Date(bh[bh.length-1].time).toLocaleTimeString();
  } else {
    document.getElementById('backupStatus').textContent = '暂无备份';
  }
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  // 将设置内容按组折叠（DOM 重组，不破坏逻辑，只改视觉层级）
  restructureSettingsModal(modal);
}

/* 把平铺的设置项按分组折叠到 <details> 里（首次打开设置时调用） */
function restructureSettingsModal(modal) {
  try {
    const body = modal.querySelector('.modal-body');
    if (!body) return;
    const sections = [
      { title: '👤 账户', matchText: '当前账户' },
      { title: '📝 作答设置', matchText: '作答设置' },
      { title: '🎭 角色卡', matchText: '新建角色' },
      { title: '🌐 翻译规则', matchText: '翻译规则版本' },
      { title: '💬 聊天偏好', matchText: '自动添加到 Anki' },
      { title: '🃏 薄弱点出题策略', matchText: '薄弱点出题策略' },
      { title: '🎯 主题与长度', matchText: '你想谈论的主题' },
      { title: '🤖 策略师指令', matchText: '策略师指令' },
      { title: '🔌 连接与备份', matchText: 'AnkiConnect' }
    ];
    const groups = [];
    let pending = [];
    for (const child of Array.from(body.children)) {
      if (child.tagName === 'DIV') {
        const text = child.textContent || '';
        const matched = sections.find(s => text.includes(s.matchText));
        if (matched) {
          if (pending.length) groups.push({ title: null, items: pending });
          pending = [child];
          groups.push({ title: matched.title, items: pending });
          pending = [];
        } else {
          pending.push(child);
        }
      } else {
        pending.push(child);
      }
    }
    if (pending.length) groups.push({ title: null, items: pending });
    body.innerHTML = '';
    let openCount = 0;
    for (const g of groups) {
      if (!g.title) {
        g.items.forEach(i => body.appendChild(i));
        continue;
      }
      const det = document.createElement('details');
      det.className = 'settings-section';
      // 前 3 组（账户 + 作答设置 + 角色卡）默认展开，方便首次打开即可调整作答字体
      if (openCount < 3) det.setAttribute('open', '');
      openCount++;
      const summary = document.createElement('summary');
      summary.textContent = g.title;
      det.appendChild(summary);
      const inner = document.createElement('div');
      inner.className = 'section-body';
      g.items.forEach(i => inner.appendChild(i));
      det.appendChild(inner);
      body.appendChild(det);
    }
  } catch (e) { console.warn('[settings restructure] err:', e); }
}

/* ---------- AnkiConnect 检测/重连 ----------
   浏览器直连 AnkiConnect 会被 CORS 拒绝（AnkiConnect 默认只信任 Origin: http://localhost），
   所以一律走后端 /api/proxy/anki 代理（后端直连本机，无 CORS）。
   同时为兼容不同 Anki 配置：自动探测可用 model 与 deck 并缓存，避免 "model was not found" 错误。
*/
let ankiUrlWorking = null;            // 后端代理报告的工作地址（仅供参考显示）
let ankiModelCache = null;            // 探测到的笔记类型列表（首次 addNote 时探测并缓存）
let ankiDeckEnsured = false;          // 是否已确保 deck 存在

async function ankiPostCall(payload) {
  const r = await fetch((BACKEND_URL || '') + '/api/proxy/anki', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    let friendly = 'proxy HTTP ' + r.status;
    try {
      const errBody = await r.json();
      if (errBody && errBody.error === 'ankiconnect unreachable') friendly = 'Anki 未运行或 AnkiConnect 未连接';
      else if (errBody && errBody.error) friendly = errBody.error;
    } catch (e) {}
    throw new Error(friendly);
  }
  return await r.json();
}

// 探测 Anki 可用的笔记类型（modelNames）和确保 deck 存在（兼容旧调用）
async function ankiProbeAndEnsureDeck() {
  if (ankiModelCache) return ankiModelCache;
  try {
    await ensureQuizModelAndDeck();
    const models = await ankiPostCall({ action: 'modelNames', version: 6 }).then(d => d.result && d.result.result).catch(() => null);
    if (Array.isArray(models) && models.length) {
      const preferred = ['Basic', 'Basic (and reversed card)', 'Front-Back'];
      ankiModelCache = preferred.find(m => models.includes(m)) || models[0];
    }
  } catch (e) { /* ignore */ }
  ankiDeckEnsured = true;
  return ankiModelCache;
}

async function checkAnkiConnect(manual) {
  const statusEl = document.getElementById('ankiStatus');
  const reconnectBtn = document.getElementById('reconnectAnkiBtn');
  if (!statusEl) return;
  if (manual) statusEl.textContent = '⏳ 检测中…';
  try {
    const data = await ankiPostCall({ action: 'version', version: 6 });
    if (!data.ok) throw new Error(data.error || data.last || 'unreachable');
    const ver = data.result && data.result.result;
    ankiUrlWorking = data.url;
    statusEl.textContent = '✅ 已连接 (Anki ' + (ver || '') + ') · 通过 ' + data.url;
    statusEl.style.color = 'var(--green)';
    if (reconnectBtn) reconnectBtn.style.display = 'none';
    // 顺便探测 model/deck（静默失败不影响状态显示）
    try { await ensureQuizModelAndDeck(); } catch (e) {}
    try { renderAnkiSidebar(); } catch (e) {}
    return true;
  } catch (e) {
    statusEl.textContent = '❌ 未连接 — ' + (e.message || e);
    statusEl.style.color = 'var(--red)';
    if (reconnectBtn) reconnectBtn.style.display = manual ? '' : 'inline-block';
    if (manual) toastMsg('❌ AnkiConnect 连接失败：' + (e.message || ''));
    return false;
  }
}

async function reconnectAnkiConnect() {
  ankiModelCache = null; ankiDeckEnsured = false;   // 强制重新探测
  const ok = await checkAnkiConnect(true);
  if (!ok) toastMsg('请确认 Anki 已运行、AnkiConnect 插件已安装（默认 8765 端口），然后重新点击「重连」。');
}

/* ---------- 退出登录 ---------- */
async function logoutUser() {
  if (!confirm('退出登录？本机缓存将被清空，数据仍在服务器数据库中。')) return;
  try { await apiLogout(); } catch (e) {}
  // 退出前停掉所有后台任务，避免旧账户的分析结果写入下一个账户
  if (currentAbort) { try { currentAbort.abort(); } catch (e) {} }
  cancelAnalysisTasks();
  conversation = [];
  // 清空全部用户态缓存（含 ai_en_setting_* 偏好、阅读、词典历史、本地备份），
  // 否则下一个账户登录后可能读到上一个账户的设置与历史
  clearUserCache();
  try { localStorage.removeItem('ai_en_cache_owner'); } catch (e) {}
  const modal = document.getElementById('settingsModal');
  if (modal) modal.parentElement.remove();
  location.reload();
}

function saveSettings() {
  const anki = document.getElementById('setAnki').checked;
  const autoRead = document.getElementById('setAutoRead').checked;
  const stream = document.getElementById('setStream').checked;
  const strategist = document.getElementById('setStrategist').checked;
  const executor = document.getElementById('setExecutor').checked;
  const musicEnabledSetting = !!document.getElementById('setMusicEnabled')?.checked;
  const musicAutoNextSetting = !!document.getElementById('setMusicAutoNext')?.checked;
  const musicTrackSetting = parseInt(document.getElementById('setMusicTrack')?.value, 10);
  const musicVolumeSetting = parseInt(document.getElementById('setMusicVol')?.value, 10) || 0;
  const userTopic = (document.getElementById('setUserTopic').value || '').trim();
  const respLen = (document.getElementById('setRespLen').value || '').trim();
  // 作答字体设置
  const answerFontSize = parseInt(document.getElementById('setAnswerFontSize')?.value) || 15;
  const answerFontFamily = document.getElementById('setAnswerFontFamily')?.value || 'inherit';
  // Anki 细分开关
  const autoVocab = !!document.getElementById('setAnkiVocab')?.checked;
  const autoCorr = !!document.getElementById('setAnkiCorr')?.checked;
  const autoExt = !!document.getElementById('setAnkiExt')?.checked;
  const autoWeak = !!document.getElementById('setAnkiWeak')?.checked;
  const quizStrategy = document.getElementById('setQuizStrategy')?.value || 'instant';
  const quizBatchSize = parseInt(document.getElementById('setQuizBatchSize')?.value) || 5;
  const quizPerWp = parseInt(document.getElementById('setQuizPerWp')?.value) || 2;
  const quizMultiWp = !!document.getElementById('setQuizMultiWp')?.checked;
  const quizAutoSync = !!document.getElementById('setAnkiAutoSync')?.checked;
  const quizAudio = !!document.getElementById('setAnkiAudio')?.checked;
  // 翻译规则版本
  const trRuleEl = document.querySelector('input[name="setTrRule"]:checked');
  const translationRuleVersion = trRuleEl ? (trRuleEl.value || '') : '';
  ankiAutoAdd = anki;
  autoReadAloud = autoRead;
  streamChatEnabled = stream;
  strategistEnabled = strategist;
  executorEnabled = executor;
  setSetting('ankiAutoAdd', anki);
  setSetting('ankiAutoVocab', autoVocab);
  setSetting('ankiAutoCorr', autoCorr);
  setSetting('ankiAutoExt', autoExt);
  setSetting('ankiAutoWeak', autoWeak);
  setSetting('ankiQuizStrategy', quizStrategy);
  setSetting('ankiQuizBatchSize', quizBatchSize);
  setSetting('ankiQuizPerWp', quizPerWp);
  setSetting('ankiQuizMultiWp', quizMultiWp);
  setSetting('ankiAutoSync', quizAutoSync);
  setSetting('ankiAutoAudio', quizAudio);
  setSetting('autoRead', autoRead);
  setSetting('streamChat', stream);
  setSetting('strategistEnabled', strategist);
  setSetting('executorEnabled', executor);
  setSetting('musicEnabled', musicEnabledSetting);
  setSetting('musicAutoNext', musicAutoNextSetting);
  setMusicVol(musicVolumeSetting);
  if (Number.isInteger(musicTrackSetting) && musicTrackSetting >= 0) {
    localStorage.setItem('ai_en_music_idx', String(musicTrackSetting));
    musicIdx = musicTrackSetting;
  }
  setSetting('userTopic', userTopic);
  setSetting('responseLengthGuide', respLen);
  setSetting('answerFontSize', answerFontSize);
  setSetting('answerFontFamily', answerFontFamily);
  setSetting('activeCharacter', activeCharacterId);
  if (translationRuleVersion === '') {
    setSetting('translationRuleVersion', null);
  } else {
    setSetting('translationRuleVersion', translationRuleVersion);
  }
  const mergedSettings = {
    ...getSettingsBackup(),
    ankiAutoAdd: anki,
    ankiAutoVocab: autoVocab,
    ankiAutoCorr: autoCorr,
    ankiAutoExt: autoExt,
    ankiAutoWeak: autoWeak,
    ankiQuizStrategy: quizStrategy,
    ankiQuizBatchSize: quizBatchSize,
    ankiQuizPerWp: quizPerWp,
    ankiQuizMultiWp: quizMultiWp,
    ankiAutoSync: quizAutoSync,
    ankiAutoAudio: quizAudio,
    autoRead: autoRead,
    streamChat: stream,
    strategistEnabled: strategist,
    executorEnabled: executor,
    musicEnabled: musicEnabledSetting,
    musicAutoNext: musicAutoNextSetting,
    musicVolume: musicVolumeSetting,
    musicTrack: Number.isInteger(musicTrackSetting) ? musicTrackSetting : 0,
    userTopic,
    responseLengthGuide: respLen,
    answerFontSize,
    answerFontFamily,
    activeCharacter: activeCharacterId,
    translationRuleVersion: translationRuleVersion || null
  };
  // 本地快照与服务端保持一致，避免后续 setCurrentConvId 用旧快照覆盖这次保存
  saveSettingsBackup(mergedSettings);
  apiSave('settings', mergedSettings);
  const aBtn = document.getElementById('ankiToggle');
  const rBtn = document.getElementById('autoReadToggle');
  if (aBtn) aBtn.classList.toggle('active', anki);
  if (rBtn) rBtn.classList.toggle('active', autoRead);
  applyMusicEnabledUI();
  document.getElementById('settingsModal').parentElement.remove();
  applyAnswerFontSettings();
  if (anki) { syncAnkiReviewData().catch(() => {}); renderAnkiSidebar().catch(() => {}); }
}

/* ---------- 修改密码 ---------- */
async function changePassword() {
  const oldPw = document.getElementById('setOldPw').value;
  const newPw = document.getElementById('setNewPw').value;
  const msg = document.getElementById('pwMsg');
  if (!oldPw || !newPw) { msg.textContent = '请输入原密码和新密码'; msg.style.color = 'var(--red)'; return; }
  if (newPw.length < 4) { msg.textContent = '新密码至少 4 位'; msg.style.color = 'var(--red)'; return; }
  try {
    await apiChangePassword(oldPw, newPw);
    msg.textContent = '✅ 密码已修改';
    msg.style.color = 'var(--green)';
    document.getElementById('setOldPw').value = '';
    document.getElementById('setNewPw').value = '';
  } catch (e) {
    msg.textContent = '❌ ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/* ---------- 头像上传 ---------- */
function uploadAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { alert('头像图片不能超过 2MB'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    setSetting('avatar', dataUrl);
    apiSave('avatar', dataUrl);
    const preview = document.getElementById('avatarPreview');
    if (preview) preview.innerHTML = '<img src="' + esc(dataUrl) + '" style="width:100%;height:100%;object-fit:cover">';
    const badge = document.getElementById('userBadge');
    if (badge) badge.textContent = currentUser() || '';
    toastMsg('✅ 头像已更新');
  };
  reader.readAsDataURL(file);
}

/* ---------- 角色卡选择 ---------- */
function settingsSelectCharacter(id) {
  setActiveCharacterId(id);
  document.querySelectorAll('.char-option').forEach(el => el.classList.toggle('active', el.dataset.charId === id || el.getAttribute('onclick') === "settingsSelectCharacter('" + id + "')"));
  document.querySelectorAll('.char-option').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(getActiveCharacter().name));
  });
  toastMsg('🎭 已切换角色：' + getActiveCharacter().fullName);
}

function promptNewCharacter() {
  removeAllModals();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '新建角色');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:14px;padding:22px;max-width:440px;width:92%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
  modal.innerHTML = `<h3 style="font-size:17px;font-weight:700;margin-bottom:14px">🎭 新建角色卡</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <input id="ncName" placeholder="名字（如 Luna）" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <input id="ncFlags" placeholder="国籍 / 城市（如 American / Seattle）" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <input id="ncOcc" placeholder="职业 / 身份（如 high school teacher）" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <input id="ncEmoji" placeholder="头像 Emoji（如 🍀）" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <textarea id="ncPersona" rows="4" placeholder="性格 / 说话风格 / 兴趣爱好 / 背景故事…" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button onclick="this.closest('.modal-overlay').remove()" style="padding:7px 18px;border-radius:8px;border:1px solid var(--border);background:#fff;font-size:13px;cursor:pointer">取消</button>
      <button onclick="saveNewCharacter()" style="padding:7px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:13px;cursor:pointer">创建</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}

function saveNewCharacter() {
  const name = (document.getElementById('ncName').value || '').trim();
  if (!name) { alert('请输入角色名字'); return; }
  const id = 'custom_' + Date.now();
  const custom = {
    id: id,
    name: name,
    fullName: name,
    nationality: '',
    city: (document.getElementById('ncFlags').value || ''),
    age: 0,
    occupation: (document.getElementById('ncOcc').value || ''),
    personality: [],
    interests: [],
    family: '',
    mannerisms: (document.getElementById('ncPersona').value || '').trim(),
    pet: '',
    backstorySeed: (document.getElementById('ncPersona').value || '').trim(),
    avatar: (document.getElementById('ncEmoji').value || '🤖')
  };
  const existing = getSetting('characters', []) || [];
  existing.push(custom);
  setSetting('characters', existing);
  apiSave('characters', existing);
  document.querySelector('.modal-overlay')?.remove();
  toastMsg('✅ 已创建角色：' + name);
  openSettings();
}

/* ---------- 策略师指令 ---------- */
function getStrategistInstructions() {
  const v = getSetting('strategistInstructions', []);
  return Array.isArray(v) ? v : [];
}
function saveStrategistInstructions(list) {
  setSetting('strategistInstructions', list);
  apiSave('strategist', list);
}
function sendStrategistInstruction() {
  const input = document.getElementById('setStrategistInstr');
  const text = (input.value || '').trim();
  if (!text) { toastMsg('请输入指令内容'); return; }
  const permanent = document.getElementById('setInstrPermanent').checked;
  const list = getStrategistInstructions();
  list.push({ text: text, permanent: Boolean(permanent), time: new Date().toISOString() });
  saveStrategistInstructions(list);
  input.value = '';
  document.getElementById('setInstrPermanent').checked = false;
  toastMsg(permanent ? '📌 指令已设为常驻' : '✅ 指令已发送（仅一次）');
  openSettings();   // 重新打开设置刷新历史列表
}
function deleteStrategistInstruction(idx) {
  const list = getStrategistInstructions();
  if (idx >= 0 && idx < list.length) {
    list.splice(idx, 1);
    saveStrategistInstructions(list);
    openSettings();
  }
}

/* ---------- Retry Analysis ---------- */
function retryAnalysis(userMsgId) {
  const node = findNode(userMsgId);
  if (!node) return;
  activeVariant(node).feedback = null;
  renderFeedbackForMsg(userMsgId);
  callAnalysis(activeVariant(node).content, userMsgId);
}

/* ---------- Slash Commands in Main Chat ---------- */
const SLASH_COMMANDS = [
  { name: '/new', description: '开始新对话' },
  { name: '/topic', description: '选择对话主题' },
  { name: '/translate', alias: '/t', description: '打开词典翻译并查询文本' },
  { name: '/ask', description: '向英语老师提问' },
  { name: '/feedback', description: '打开反馈面板' },
  { name: '/settings', description: '打开设置' },
  { name: '/compact', description: '收起反馈面板' },
  { name: '/help', description: '显示斜杠命令帮助' }
];

function hideSlashMenu() {
  const menu = document.getElementById('slashMenu');
  if (menu) menu.style.display = 'none';
}

function renderSlashMenu(query) {
  const menu = document.getElementById('slashMenu');
  if (!menu) return;
  const q = String(query || '').toLowerCase();
  const items = SLASH_COMMANDS.filter(c => c.name.includes(q) || c.description.includes(q));
  if (!items.length) { hideSlashMenu(); return; }
  menu.innerHTML = items.map((c, i) => `<button class="slash-item" data-command="${esc(c.name)}" onclick="chooseSlashCommand('${esc(c.name)}')"><strong>${esc(c.name)}</strong>${c.alias ? `<small>${esc(c.alias)}</small>` : ''}<span>${esc(c.description)}</span></button>`).join('');
  menu.style.display = 'block';
}

function chooseSlashCommand(command) {
  const input = document.getElementById('userInput');
  if (!input) return;
  input.value = command + ' ';
  input.focus();
  hideSlashMenu();
}

function handleSlashCommand(text) {
  hideSlashMenu();
  // /t or /translate <text> → switch to dict tab and translate
  const tMatch = text.match(/^\/(?:t|translate)\s+(.+)/s);
  if (tMatch) {
    switchRightTab('dict');
    const input = document.getElementById('dictInput');
    input.value = tMatch[1];
    setTimeout(queryDict, 300);
    return true;
  }
  // /ask <question> → switch to dict tab and ask
  const aMatch = text.match(/^\/ask\s+(.+)/s);
  if (aMatch) {
    switchRightTab('dict');
    const input = document.getElementById('dictInput');
    input.value = '/ask ' + aMatch[1];
    setTimeout(queryDict, 300);
    return true;
  }
  if (text === '/new') { promptNewConversation(); return true; }
  if (text === '/topic') { promptNewConversation(); return true; }
  if (text === '/feedback') { setFeedbackPanelMode('expanded'); return true; }
  if (text === '/compact') { setFeedbackPanelMode('collapsed'); return true; }
  if (text === '/settings') { openSettings(); return true; }
  if (text === '/help') {
    const input = document.getElementById('userInput');
    input.value = SLASH_COMMANDS.map(c => c.name + ' — ' + c.description).join('\n');
    return true;
  }
  return false;
}

/* ---------- Init ---------- */
function updateDifficulty() {
  currentLevel = parseInt(document.getElementById('difficulty').value);
  const labels = ['', 'CET-初', 'CET-初', 'CET-4', 'CET-4', 'CET-5', 'CET-6', 'CET-6+', 'CET-7', 'CET-8', 'CET-8+'];
  document.getElementById('diffLabel').textContent = labels[currentLevel] || currentLevel;
}

/* ============================================================
   首页 + 六大功能模块：Chat / Reading / Practice / Writing / Translation / Game
   ============================================================ */

// ---- 题库 ----
const WRITING_TOPICS = [
  'The impact of social media on society', 'Should college students take part-time jobs?',
  'The importance of environmental protection', 'My view on the future of AI',
  'The advantages and disadvantages of online learning', 'How to deal with stress in modern life',
  'The role of traditional culture in modern society', 'Should teenagers be allowed to use smartphones?',
  'The importance of lifelong learning', 'My ideal job',
  'The pros and cons of studying abroad', 'How to build a healthy lifestyle',
  'The value of friendship', 'Should we abolish the college entrance examination?',
  'The impact of technology on interpersonal relationships'
];
// 翻译题库：按分类组织，每个分类有 label 和题目数组
const TRANSLATION_BANK = {
  gaokao: {
    label: '高考英语',
    items: [
      { zh: '随着中国经济的发展，人们的生活水平有了显著提高。', ref: 'With the development of China\'s economy, people\'s living standards have improved significantly.' },
      { zh: '越来越多的大学生利用暑假参加社会实践活动，以拓宽视野。', ref: 'More and more college students take part in social practice activities during summer vacations to broaden their horizons.' },
      { zh: '环境保护是当今世界面临的最紧迫的挑战之一。', ref: 'Environmental protection is one of the most urgent challenges facing the world today.' },
      { zh: '这本书不仅有趣，而且富有教育意义，值得一读。', ref: 'This book is not only interesting but also educational and worth reading.' },
      { zh: '我们应该珍惜时间，因为时间一去不复返。', ref: 'We should cherish time, because time never returns once gone.' },
      { zh: '越来越多的人意识到健康的生活方式的重要性。', ref: 'More and more people have realized the importance of a healthy lifestyle.' },
      { zh: '在数字化时代，传统技艺面临着失传的危险。', ref: 'In the digital age, traditional skills are in danger of being lost.' },
      { zh: '他虽然年轻，但已经取得了令人瞩目的成就。', ref: 'Although he is young, he has already achieved remarkable accomplishments.' },
      { zh: '这部纪录片让我对中国传统文化有了更深的了解。', ref: 'This documentary gave me a deeper understanding of traditional Chinese culture.' },
      { zh: '我们应该学会与他人合作，因为团队合作至关重要。', ref: 'We should learn to cooperate with others, because teamwork is of great importance.' }
    ]
  },
  kaoyan: {
    label: '考研英语',
    items: [
      { zh: '随着互联网的普及，人们获取信息的方式发生了根本性的变化。', ref: 'With the popularization of the Internet, the way people access information has undergone fundamental changes.' },
      { zh: '政府应当采取有效措施来缓解城市交通拥堵问题。', ref: 'The government should take effective measures to alleviate urban traffic congestion.' },
      { zh: '人工智能的发展既带来了机遇，也带来了挑战。', ref: 'The development of artificial intelligence has brought both opportunities and challenges.' },
      { zh: '许多研究表明，定期锻炼对身心健康都有显著的益处。', ref: 'Many studies have shown that regular exercise has significant benefits for both physical and mental health.' },
      { zh: '全球化背景下，文化的多样性应当得到尊重和保护。', ref: 'In the context of globalization, cultural diversity should be respected and protected.' },
      { zh: '教育不仅是传授知识，更重要的是培养批判性思维能力。', ref: 'Education is not only about imparting knowledge, but more importantly about cultivating critical thinking skills.' },
      { zh: '可持续发展要求我们在经济增长与环境保护之间寻求平衡。', ref: 'Sustainable development requires us to seek a balance between economic growth and environmental protection.' },
      { zh: '社交媒体的兴起改变了人们交流和获取信息的方式。', ref: 'The rise of social media has changed the way people communicate and access information.' },
      { zh: '只有在充分尊重知识产权的前提下，创新才能蓬勃发展。', ref: 'Innovation can flourish only with full respect for intellectual property rights.' },
      { zh: '面对全球性挑战，没有任何一个国家能够独善其身。', ref: 'In the face of global challenges, no single country can remain unaffected.' }
    ]
  },
  cet4: {
    label: '大学英语四级',
    items: [
      { zh: '每天锻炼身体对保持健康很重要。', ref: 'Exercising every day is very important for staying healthy.' },
      { zh: '我们应该尽可能多读英文原著来提高阅读能力。', ref: 'We should read as many English originals as possible to improve our reading ability.' },
      { zh: '互联网在我们的日常生活中扮演着越来越重要的角色。', ref: 'The Internet plays an increasingly important role in our daily life.' },
      { zh: '他花了三年时间才完成这部小说。', ref: 'It took him three years to finish the novel.' },
      { zh: '如果你坚持每天练习说英语，你的口语会有很大的进步。', ref: 'If you keep practicing speaking English every day, your spoken English will improve a lot.' },
      { zh: '这家餐厅的菜味道好，价格也合理。', ref: 'This restaurant serves tasty food at reasonable prices.' },
      { zh: '这个博物馆每天都吸引着成千上万的参观者。', ref: 'The museum attracts thousands of visitors every day.' },
      { zh: '我花了两个小时才把作业做完。', ref: 'It took me two hours to finish my homework.' },
      { zh: '无论你做什么，都要尽自己最大的努力。', ref: 'Whatever you do, try your best.' },
      { zh: '昨天晚上我看了部很感人的电影。', ref: 'Last night I watched a very moving movie.' },
      { zh: '这座城市的公共交通既方便又便宜。', ref: 'The public transportation in this city is both convenient and cheap.' },
      { zh: '我每天早晨起床后都会喝一杯咖啡。', ref: 'I have a cup of coffee every morning after I get up.' }
    ]
  },
  cet6: {
    label: '大学英语六级',
    items: [
      { zh: '大量研究表明，长期睡眠不足会显著增加患慢性病的风险。', ref: 'Numerous studies have shown that chronic sleep deprivation significantly increases the risk of chronic diseases.' },
      { zh: '政府在推动经济结构转型的同时，也应注重环境保护。', ref: 'While promoting economic structural transformation, the government should also pay attention to environmental protection.' },
      { zh: '只有当个人利益与集体利益相协调时，社会才能和谐发展。', ref: 'A society can only develop harmoniously when individual interests are coordinated with collective interests.' },
      { zh: '尽管这项技术取得了一些进展，但距离大规模商业应用仍有距离。', ref: 'Although the technology has made some progress, it is still far from large-scale commercial application.' },
      { zh: '他之所以成功，是因为他从未放弃对梦想的追求。', ref: 'The reason for his success is that he never gave up pursuing his dream.' },
      { zh: '随着人们生活水平的提高，旅游已经成为一种流行的休闲方式。', ref: 'With the improvement of people\'s living standards, tourism has become a popular way of leisure.' },
      { zh: '教师不仅要传授知识，更应激发学生独立思考的能力。', ref: 'Teachers should not only impart knowledge but also inspire students to think independently.' },
      { zh: '如今，越来越多的企业开始关注员工的职业发展与心理健康。', ref: 'Nowadays, more and more companies begin to pay attention to employees\' career development and mental health.' },
      { zh: '在做出重大决定之前，最好充分了解相关信息。', ref: 'Before making a major decision, it is best to fully understand the relevant information.' },
      { zh: '尽管面临诸多挑战，该公司依然坚持其创新发展战略。', ref: 'Despite facing many challenges, the company still adheres to its innovative development strategy.' }
    ]
  },
  ielts: {
    label: '雅思',
    items: [
      { zh: '随着全球化的加速，掌握一门外语变得越来越重要。', ref: 'With the acceleration of globalization, mastering a foreign language has become increasingly important.' },
      { zh: '许多研究表明，童年时期的阅读习惯对一个人的终身发展有深远影响。', ref: 'Many studies have shown that reading habits formed in childhood have a profound influence on a person\'s lifelong development.' },
      { zh: '政府应当鼓励企业采用更环保的生产方式，以减少污染。', ref: 'The government should encourage enterprises to adopt more environmentally friendly production methods in order to reduce pollution.' },
      { zh: '在我看来，传统手工艺的传承不仅关系到技艺本身，更关系到文化的延续。', ref: 'In my view, the inheritance of traditional handicrafts concerns not only the skills themselves, but also the continuity of culture.' },
      { zh: '越来越多的人开始意识到，过度依赖手机可能会影响人际交流的质量。', ref: 'More and more people are beginning to realize that over-reliance on mobile phones may affect the quality of interpersonal communication.' },
      { zh: '无论城市还是乡村，每个孩子都应当享有平等的教育机会。', ref: 'Whether in cities or rural areas, every child should enjoy equal educational opportunities.' },
      { zh: '这项研究表明，定期锻炼不仅能改善身体健康，还能缓解压力。', ref: 'The study shows that regular exercise can not only improve physical health but also relieve stress.' },
      { zh: '应对气候变化需要全球合作，没有任何国家可以置身事外。', ref: 'Addressing climate change requires global cooperation, and no country can stand aside.' }
    ]
  },
  toefl: {
    label: '托福',
    items: [
      { zh: '科学家们一直在努力寻找治疗这种疾病更有效的方法。', ref: 'Scientists have been working hard to find more effective methods to treat this disease.' },
      { zh: '城市化进程加快带来了许多社会问题，需要政府加以重视。', ref: 'The acceleration of urbanization has brought many social problems that need the government\'s attention.' },
      { zh: '历史遗迹的保护对于理解一个国家的文化传统至关重要。', ref: 'The preservation of historical sites is essential to understanding a country\'s cultural traditions.' },
      { zh: '许多专家认为，气候变化是当今人类面临的最严峻挑战之一。', ref: 'Many experts believe that climate change is one of the most severe challenges humanity faces today.' },
      { zh: '随着技术的不断进步，传统的教育模式正在发生深刻变化。', ref: 'With the continuous advancement of technology, traditional educational models are undergoing profound changes.' },
      { zh: '在他看来，学习一门外语不仅是掌握一项技能，更是理解一种文化。', ref: 'In his view, learning a foreign language is not only about acquiring a skill, but also about understanding a culture.' },
      { zh: '这项新技术有望彻底改变人们日常交流的方式。', ref: 'This new technology is expected to completely change the way people communicate in daily life.' },
      { zh: '越来越多的研究表明，长期的心理压力可能导致多种健康问题。', ref: 'More and more studies show that long-term psychological stress may lead to various health problems.' }
    ]
  }
};
// 翻译题库"通用混合"（随机从所有分类抽）

function flattenTrBank() {
  const all = [];
  for (const k of Object.keys(TRANSLATION_BANK)) {
    for (const it of TRANSLATION_BANK[k].items) all.push(it);
  }
  return all;
}

/* ============================================================
   翻译规则版本（设置面板可切换）
   ============================================================ */
const TRANSLATION_RULES = {
  gaokao: {
    label: '高考版（必用词 + 一句话）',
    desc: '翻译必须使用「词」字段里列出的所有词（词性不变，可变式；首字母大写者必须用于句首）；高考题默认翻译为完整的一句话，避免分号。'
  },
  standard: {
    label: '标准版（必用词 + 自然分句）',
    desc: '翻译必须使用「词」字段里列出的所有词；可使用多个分句或分号，追求自然流畅。'
  },
  legacy: {
    label: '旧版（仅通用评分，不强制必用词）',
    desc: '不强制使用「词」字段；只做常规翻译评分。'
  }
};

function getTranslationRuleVersion() {
  const v = getSetting('translationRuleVersion', null);
  if (v && TRANSLATION_RULES[v]) return v;
  // 默认：当前题库来自「上海高考」（含必用词）→ 高考版；否则标准版
  const sel = document.getElementById('trCategorySelect');
  const catKey = (sel && sel.value) || (currentTranslation && currentTranslation._catKey) || '';
  if (typeof catKey === 'string' && /上海高考/i.test(catKey)) return 'gaokao';
  if (currentTranslation && currentTranslation._catKey && /上海高考/i.test(currentTranslation._catKey)) return 'gaokao';
  return 'standard';
}

/* 构造翻译评分 prompt（支持必用词 + 单句/多分句规则） */
function buildTranslationEvalPrompt(opts) {
  const { words = [], ruleVersion = 'standard' } = opts;
  const lines = [];
  lines.push('You are an English translation examiner. Evaluate the user\'s English translation of a Chinese sentence.');
  lines.push('Score (0-10) and provide feedback in Chinese.');
  // 必用词约束
  if (ruleVersion !== 'legacy' && words && words.length) {
    lines.push('');
    lines.push('=== 必用词（REQUIRED WORDS）===');
    lines.push('用户必须使用下列每一个词（含变式：过去式、第三人称单数、-ing、-ed、被动、形容词副词等词性派生形式）：');
    lines.push(words.map((w, i) => (i + 1) + '. ' + w).join('\n'));
    lines.push('规则：');
    lines.push('· 词性不变（同一词类；如有多个词性可任选其一）');
    lines.push('· 可使用变式（past / -ed / -s / -ing / 被动 / 大小写调整 / 名词复数 等）');
    lines.push('· 严格大小写要求：如果「词」在原文中首字母大写，用户的翻译中此词必须在句子开头；若在句中用过则大小写不变');
    lines.push('· 每个必用词在翻译中至少出现一次（接受语义等价/派生/同根词），缺少任何一项须明确指出');
    if (ruleVersion === 'gaokao') {
      lines.push('· 上海高考版：必用词 + 单句输出（尽量不使用分号 ; 拆分多句）。必须把整句翻译为完整的一句英语。');
    } else {
      lines.push('· 标准版：可使用 2-3 个分句或分号；优先追求表达自然流畅。');
    }
    lines.push('');
    lines.push('在你的反馈里，明确列出：');
    lines.push('- "missing_words": [列出用户翻译中未使用 / 未用变式体现的必用词]');
    lines.push('- "capital_issues": [列出首字母大写却没在句首的必用词]');
    lines.push('');
  }
  if (ruleVersion === 'gaokao') {
    lines.push('=== 高考风格提示 ===');
    lines.push('高考翻译评分通常要求：');
    lines.push('· 句子结构完整，无语法错误；');
    lines.push('· 必用词必须用上；');
    lines.push('· 全文为一句话，不分句（除非不拆会导致超长）；');
    lines.push('· 尽量用你提供的 8-10 范围给分；表达地道、无错误 9-10；');
  }
  lines.push('');
  lines.push('Return ONLY valid JSON (no markdown, no thinking):');
  lines.push('{');
  lines.push('  "score": "score out of 10 with brief Chinese comment, e.g. 7/10 — 基本准确，部分表达可改进",');
  lines.push('  "errors": ["specific errors or suggestions in Chinese"],');
  lines.push('  "missing_words": ["words the user failed to use (REQUIRED). Omit field if no words required."],');
  lines.push('  "capital_issues": ["words the user placed incorrectly regarding capitalization. Omit if none."],');
  lines.push('  "better_translation": "a better English version if applicable (MUST use all required words, and obey the sentence-count rule)",');
  lines.push('  "segments": [{"text": "part of the user\'s translation", "type": "correct|error|improve", "note": "Chinese explanation"}]');
  lines.push('}');
  lines.push('');
  lines.push('Important: The "segments" field must cover the ENTIRE user\'s translation, breaking it into consecutive parts. Each segment has: text (exact substring), type (correct=正确, error=翻译错误, improve=表达不地道或可改进), note (Chinese explanation). Join all segments\' text in order to reconstruct the user\'s translation exactly.');
  return lines.join('\n');
}

/* 本地快速检查：用户的翻译里是否用上了所有必用词 */
function checkRequiredWordsUsed(text, words) {
  const result = { missing: [], capitalViolations: [] };
  if (!text || !words || !words.length) return result;
  // 抽取翻译里所有英文词（小写）
  const tokens = String(text).split(/[^A-Za-z'-]+/).filter(Boolean);
  const tokenSet = new Set(tokens.map(t => t.toLowerCase()));
  // 词干化：把变式 / 大小写统一
  const stems = (w) => {
    const lw = w.toLowerCase();
    const set = new Set([lw]);
    // 简单词干处理：去掉常见后缀 -s/-es/-ed/-ing/-ly
    if (lw.endsWith('ies') && lw.length > 4) set.add(lw.slice(0, -3) + 'y');
    if (lw.endsWith('es') && lw.length > 3) set.add(lw.slice(0, -2));
    if (lw.endsWith('s') && lw.length > 3) set.add(lw.slice(0, -1));
    if (lw.endsWith('ed') && lw.length > 3) set.add(lw.slice(0, -2));
    if (lw.endsWith('ing') && lw.length > 4) set.add(lw.slice(0, -3));
    if (lw.endsWith('ly') && lw.length > 3) set.add(lw.slice(0, -2));
    return set;
  };
  const wordStems = words.map(w => ({ word: w, stems: stems(w) }));
  for (const { word, stems: ws } of wordStems) {
    let used = false;
    for (const stem of ws) if (tokenSet.has(stem)) { used = true; break; }
    if (!used) result.missing.push(word);
  }
  // 大写检查：句首检测
  if (words.some(w => /^[A-Z]/.test(w))) {
    const firstChar = String(text).trim()[0] || '';
    const rest = String(text).trim().slice(1);
    for (const w of words) {
      if (!/^[A-Z]/.test(w)) continue;
      // 如果用户没把它放在句首，提示
      const lower = w.toLowerCase();
      const firstWord = String(text).trim().split(/\s+/)[0] || '';
      if (firstWord.toLowerCase().slice(0, lower.length) !== lower) {
        // 简化：仅当句首不是以必用词开头时提示
        result.capitalViolations.push(w);
      }
    }
  }
  return result;
}

// 把外部导入的上海高考题库并入 TRANSLATION_BANK（在 DOMContentLoaded 时调用）
function mergeShGaokaoBank() {
  if (typeof window === 'undefined' || !window.SH_GAOKAO_BANK) return;
  for (const k of Object.keys(window.SH_GAOKAO_BANK)) {
    if (TRANSLATION_BANK[k]) continue; // 不覆盖已有分类
    TRANSLATION_BANK[k] = window.SH_GAOKAO_BANK[k];
  }
}
const CHARADE_BANK = [
  { word: 'penguin', hint: 'a black and white bird that cannot fly' },
  { word: 'umbrella', hint: 'something you hold over your head when it rains' },
  { word: 'volcano', hint: 'a mountain that can erupt with hot lava' },
  { word: 'giraffe', hint: 'a very tall animal with a long neck' },
  { word: 'lighthouse', hint: 'a tower with a bright light that guides ships' },
  { word: 'backpack', hint: 'a bag you wear on your shoulders to carry things' },
  { word: 'telescope', hint: 'a tool that makes distant objects look closer' },
  { word: 'hammock', hint: 'a piece of cloth or net you sleep in, hung between two trees' },
  { word: 'tornado', hint: 'a violent rotating column of air' },
  { word: 'scarecrow', hint: 'a figure dressed in old clothes, placed in a field to frighten birds' }
];

/* ============ 背景音乐（顶部导航栏按钮） ============ */
let musicItems = [];          // [{ file, name }]
let musicIdx = -1;            // 当前播放索引
let musicAudio = null;        // Audio 实例
let musicBubbleTimer = null;  // 气泡自动隐藏定时器
let musicClickTimer = null;   // 单击/双击区分定时器

function musicEnabled() { return getSetting('musicEnabled', true) !== false; }
function musicAutoNext() { return getSetting('musicAutoNext', true) !== false; }

function musicSettingsOptions() {
  if (!musicItems.length) return '<option value="">暂无曲目</option>';
  return musicItems.map((item, i) => `<option value="${i}" ${i === musicIdx ? 'selected' : ''}>${esc(item.name || item.file)}</option>`).join('');
}

function applyMusicEnabledUI() {
  const btn = document.getElementById('musicToggle');
  const enabled = musicEnabled();
  if (btn) {
    btn.disabled = !enabled;
    btn.classList.toggle('disabled', !enabled);
  }
  if (!enabled && musicAudio && !musicAudio.paused) {
    musicAudio.pause();
    updateMusicUI();
  }
}

function refreshMusicSettingsControls() {
  const select = document.getElementById('setMusicTrack');
  if (select) {
    select.innerHTML = musicSettingsOptions();
    if (musicIdx >= 0) select.value = String(musicIdx);
  }
  const status = document.getElementById('setMusicStatus');
  if (status) status.textContent = musicItems.length ? `${musicItems.length} 首曲目` : 'music/ 目录暂无音频';
}

async function musicInit() {
  try {
    const res = await fetch((BACKEND_URL || '') + '/api/music/list');
    const data = await res.json();
    musicItems = (data.files || []).map(f => ({ file: f.file, name: f.name }));
    if (musicItems.length) {
      const savedIdx = parseInt(localStorage.getItem('ai_en_music_idx') || '-1', 10);
      musicIdx = (savedIdx >= 0 && savedIdx < musicItems.length) ? savedIdx : 0;
    } else {
      musicIdx = -1;
    }
    applyMusicEnabledUI();
    refreshMusicSettingsControls();
    // 双击下一首 + 滚轮调音量（仅绑定一次）
    const btn = document.getElementById('musicToggle');
    if (btn && !btn.dataset.musicBound) {
      btn.dataset.musicBound = '1';
      btn.addEventListener('dblclick', function(e) {
        e.preventDefault();
        if (musicClickTimer) { clearTimeout(musicClickTimer); musicClickTimer = null; }
        musicNext();
      });
      btn.addEventListener('wheel', function(e) {
        e.preventDefault();
        const cur = parseFloat(localStorage.getItem('ai_en_music_vol') || '60');
        const next = Math.max(0, Math.min(100, cur + (e.deltaY < 0 ? 5 : -5)));
        setMusicVol(next);
        showMusicBubble('🔉 音量 ' + next + '%');
      }, { passive: false });
    }
  } catch (e) {
    dbg('MUSIC_LOAD_ERR', e.message);
  }
}

function toggleMusic() {
  // 区分单击/双击：250ms 内第二次点击视为双击，交给 dblclick 处理
  if (musicClickTimer) { clearTimeout(musicClickTimer); musicClickTimer = null; return; }
  musicClickTimer = setTimeout(function() {
    musicClickTimer = null;
    doToggleMusic();
  }, 250);
}

function doToggleMusic() {
  if (!musicEnabled()) { showMusicBubble('请先在设置中启用背景音乐'); return; }
  if (!musicItems.length) {
    musicInit().then(function() {
      if (!musicItems.length) { showMusicBubble('music/ 目录暂无音乐，请放入音频文件'); return; }
      musicPlayIdx(musicIdx < 0 ? 0 : musicIdx);
    });
    return;
  }
  if (musicIdx < 0) musicIdx = 0;
  if (!musicAudio || !musicAudio.src) { musicPlayIdx(musicIdx); return; }
  if (musicAudio.paused) {
    musicAudio.play().catch(function() {});
  } else {
    musicAudio.pause();
    showMusicBubble('⏸ 已暂停');
  }
  updateMusicUI();
}

function musicPlayIdx(i) {
  if (!musicItems.length) return;
  if (i < 0 || i >= musicItems.length) i = 0;
  musicIdx = i;
  localStorage.setItem('ai_en_music_idx', String(i));
  const url = (BACKEND_URL || '') + '/music/' + encodeURIComponent(musicItems[i].file);
  if (!musicAudio) musicAudio = new Audio();
  musicAudio.src = url;
  musicAudio.loop = false;
  musicAudio.volume = (parseFloat(localStorage.getItem('ai_en_music_vol') || '60') / 100);
  musicAudio.onended = function() {
    if (musicAutoNext()) musicNext();
    else updateMusicUI();
  };
  musicAudio.onerror = function() { showMusicBubble('播放失败: ' + musicItems[i].file); };
  musicAudio.play().catch(function() {});
  showMusicBubble('🎵 ' + (musicItems[i].name || musicItems[i].file));
  updateMusicUI();
}

function musicNext() {
  if (!musicItems.length) return;
  musicPlayIdx((musicIdx + 1) % musicItems.length);
}

function musicPrev() {
  if (!musicItems.length) return;
  musicPlayIdx((musicIdx - 1 + musicItems.length) % musicItems.length);
}

function settingsMusicSelect(v) {
  const i = parseInt(v, 10);
  if (Number.isInteger(i) && i >= 0 && i < musicItems.length) musicPlayIdx(i);
}

function settingsMusicToggle() { doToggleMusic(); }

function updateMusicUI() {
  const btn = document.getElementById('musicToggle');
  if (!btn) return;
  const playing = musicAudio && !musicAudio.paused;
  btn.classList.toggle('playing', !!playing);
}

function setMusicVol(v) {
  v = Math.max(0, Math.min(100, Number(v) || 0));
  localStorage.setItem('ai_en_music_vol', String(v));
  if (musicAudio) musicAudio.volume = v / 100;
  const value = document.getElementById('setMusicVolValue');
  if (value) value.textContent = v + '%';
}

function showMusicBubble(text) {
  const b = document.getElementById('musicBubble');
  if (!b) return;
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(musicBubbleTimer);
  musicBubbleTimer = setTimeout(function() { b.classList.remove('show'); }, 2500);
}

// ---- 状态 ----
let currentMode = 'chat'; // chat | reading | practice | writing | translation | charade
let trSource = 'bank';    // bank | ai
let chSource = 'bank';    // bank | ai
let currentTranslation = null;
let trHistoryExpanded = false;

// ---- 首页 / 模式切换 ----
function showHome() {
  localStorage.setItem('ai_en_mode', 'home');
  document.getElementById('homePage').style.display = 'flex';
  document.getElementById('sidePanel').style.display = '';
  document.getElementById('modeNav').querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
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
  if (mode === 'game') localStorage.setItem('ai_en_game_tab', currentGameTab || 'charade');
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('sidePanel').style.display = '';
  document.getElementById('modeNav').querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('mainArea').querySelectorAll('.module-area, .chat-area').forEach(el => el.style.display = 'none');
  const areaId = mode === 'translation' ? 'translateArea' : mode === 'game' ? 'gameArea' : mode + 'Area';
  const area = document.getElementById(areaId);
  if (area) { area.style.display = 'flex'; }

  // 控制仅 Chat 模式显示的元素
  document.getElementById('newConvBtn').style.display = mode === 'chat' ? '' : 'none';
  document.getElementById('difficultyCtl').style.display = mode === 'chat' ? '' : 'none';

  // 模块初始化
  if (mode === 'practice') { renderPracticeStats(); }
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
    practice: '复习模式：查看薄弱点与卡片统计'
  };
  content.innerHTML = '<div class="empty" style="padding:24px 0">' + esc(placeholders[mode] || '') + '</div>';
  content.style.fontSize = '';
  content.style.lineHeight = '';
  switchRightTab('feedback');
}

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
    list.innerHTML = READING_PRESETS.map(p => '<button onclick="startReadingFromPreset(\'' + p.id + '\')">' +
      '<strong>' + esc(p.title) + '</strong><br><span style="font-size:10px;color:var(--text3)">' + esc(p.source) + ' · ' + (p.lang === 'zh' ? '中' : 'EN') + ' · ' + p.paragraphs.length + ' 段</span></button>').join('');
  }
  // 渲染历史
  const hist = document.getElementById('rdHistoryList');
  if (hist) {
    if (!readingState.history.length) {
      hist.innerHTML = '<div style="text-align:center;color:var(--text2);padding:14px;font-size:13px">尚无最近阅读</div>';
    } else {
      hist.innerHTML = readingState.history.map(h =>
        '<button onclick="startReadingFromHistory(\'' + h.id + '\')" style="text-align:left">' +
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
    '<button class="a-btn small ghost" onclick="toggleNotesPanel()">×</button></div>' +
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
    '<button onclick="deleteReadingNote(\'' + h.id + '\')" title="删除">×</button>' +
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
let readingAudio = null;   // 当前阅读朗读的 Audio 实例（用于停止/替换/释放）
function stopReadingTts() {
  if (readingAudio) {
    try { readingAudio.pause(); } catch (e) {}
    try { if (readingAudio.src) URL.revokeObjectURL(readingAudio.src); } catch (e) {}
    readingAudio = null;
  }
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
    const url = URL.createObjectURL(blob);
    // 重复点击时先停掉上一个，避免叠加播放；播放结束/出错时释放 Blob URL
    stopReadingTts();
    const audio = new Audio(url);
    readingAudio = audio;
    const release = () => {
      if (readingAudio === audio) readingAudio = null;
      try { URL.revokeObjectURL(url); } catch (e) {}
    };
    audio.addEventListener('ended', release);
    audio.addEventListener('error', release);
    audio.play().catch((e) => { release(); toastMsg('播放失败：' + e.message, 'error'); });
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

// ---- Practice ----
function renderPracticeStats() {
  const el = document.getElementById('practiceStats');
  if (!el) return;
  const ankiSidebar = document.getElementById('ankiSidebar');
  el.innerHTML = ankiSidebar ? ankiSidebar.innerHTML : '<div style="color:var(--text2)">No Anki data available. Start chatting to build weak points.</div>';
  // 追加复习按钮
  el.innerHTML += '<div style="margin-top:12px;display:flex;gap:8px">' +
    '<button class="send-btn" onclick="startWebReview()" style="padding:8px 20px;font-size:14px">✅ 开始网页复习</button>' +
    '<button class="toggle-btn" onclick="toggleAnki()" style="font-size:13px">📚 切换自动添加</button></div>';
}

// ---- Writing ----
function renderTopicSuggest() {
  const el = document.getElementById('wTopicSuggest');
  if (!el) return;
  el.innerHTML = WRITING_TOPICS.slice(0, 6).map(t => '<button onclick="pickWritingTopic(\'' + esc(t) + '\')">' + esc(t) + '</button>').join('');
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
    '<button class="ann-edit-btn" onclick="annBackToEdit(\'' + prefix + '\')">✏️ 返回编辑</button></div>' +
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
    html += '<div onclick="trSelectQuestion(\'' + esc(catKey) + '\',' + catIdx + ')" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;background:#fff;line-height:1.6;transition:all .15s;position:relative" onmouseover="this.style.borderColor=\'var(--primary)\'" onmouseout="this.style.borderColor=\'var(--border)\'">' +
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

/* 渲染必用词 chips；userAnswer 可选（用于高亮已使用/未使用的词） */
function renderTrQuestionWords(words, usedText) {
  const el = document.getElementById('trQuestionWords');
  if (!el) return;
  if (!words || !words.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  // 统一小写做匹配，但展示时保留原大小写（首字母大写提示位置要求）
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zA-Z0-9'-]/g, '');
  const used = new Set();
  if (usedText) {
    const tokens = String(usedText).split(/[^A-Za-z]+/g).filter(Boolean).map(norm);
    tokens.forEach(t => used.add(t));
  }
  el.innerHTML = '<span style="font-size:11px;color:var(--text2)">🔑 必用词</span>' +
    words.map(w => {
      const key = norm(w);
      const isUsed = usedText && used.has(key);
      const capitalizeHint = /^[A-Z]/.test(w);
      const label = (capitalizeHint ? 'ⓘ ' : '') + esc(w);
      const bg = isUsed ? '#dcfce7' : '#fef3c7';
      const bd = isUsed ? '#86efac' : '#fde68a';
      const fg = isUsed ? '#065f46' : '#92400e';
      const title = isUsed ? '已使用' : (capitalizeHint ? '首字母大写：建议在开头使用' : '尚未使用');
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
    '<span onclick="clearTranslateHistory()" style="cursor:pointer;color:var(--text3)" title="清空所有记录">🗑️ 清空</span></div>' +
    list.map((r, i) => {
    const tm = new Date(r.t || Date.now());
    const dateStr = (tm.getMonth() + 1) + '-' + tm.getDate() + ' ' + String(tm.getHours()).padStart(2, '0') + ':' + String(tm.getMinutes()).padStart(2, '0');
    const scoreColor = (r.score || '').startsWith('9') || (r.score || '').startsWith('10') ? 'var(--green)'
      : (r.score || '').startsWith('7') || (r.score || '').startsWith('8') ? 'var(--primary)'
      : (r.score || '').startsWith('5') || (r.score || '').startsWith('6') ? 'var(--amber)'
      : 'var(--red)';
    return '<div onclick="expandTrRecord(' + i + ')" style="padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;line-height:1.6">' +
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

// ---- Charade ----
// 状态：{word, hint, revealed, rounds, guessResult}
let chState = null;
let chScore = { correct: 0, total: 0 };

function charadeSource(src) {
  chSource = src;
  document.getElementById('chBankBtn').classList.toggle('active', src === 'bank');
  document.getElementById('chAiBtn').classList.toggle('active', src === 'ai');
  charadeNext();
}

function chRenderScore() {
  const el = document.getElementById('chScore');
  if (el) el.textContent = '✅ ' + chScore.correct + '/' + chScore.total;
}

async function charadeNext() {
  document.getElementById('chDesc').value = '';
  document.getElementById('chGuess').style.display = 'none';
  document.getElementById('chHintBtn').style.display = 'none';
  chState = { word: null, hint: '', revealed: false, rounds: 0, guessResult: null };
  const wordEl = document.getElementById('chWord');
  wordEl.innerHTML = '<div style="font-size:14px;color:var(--text2);margin-bottom:8px">只有你能看到这个词，描述它让 AI 猜</div><button class="send-btn" onclick="charadeReveal()" style="padding:8px 24px;font-size:16px">🎯 显示单词</button>';
  document.getElementById('chSubmitBtn').disabled = true;

  if (chSource === 'bank') {
    const idx = Math.floor(Math.random() * CHARADE_BANK.length);
    chState.word = CHARADE_BANK[idx].word;
    chState.hint = CHARADE_BANK[idx].hint;
  } else {
    wordEl.innerHTML = '<div style="font-size:14px;color:var(--text2)">🤖 AI 生成词汇中...</div>';
    try {
      const raw = await callAPI([
        { role: 'system', content: 'You are a vocabulary teacher. Generate a single English word (common but interesting, suitable for a charades game). Return ONLY the word and a one-line hint separated by |. Example: "volcano|a mountain that erupts with hot lava". No JSON, no extra text.' },
        { role: 'user', content: 'Generate a word for charades.' }
      ], { temperature: 0.7, maxTokens: 100 });
      const parts = raw.split('|').map(s => s.trim());
      chState.word = parts[0] || 'apple';
      chState.hint = parts[1] || 'a common fruit';
      wordEl.innerHTML = '<div style="font-size:14px;color:var(--text2);margin-bottom:8px">只有你能看到这个词，描述它让 AI 猜</div><button class="send-btn" onclick="charadeReveal()" style="padding:8px 24px;font-size:16px">🎯 显示单词</button>';
    } catch (e) {
      chState.word = 'library';
      chState.hint = 'a place with many books';
      wordEl.innerHTML = '<div style="font-size:14px;color:var(--orange);margin-bottom:8px">AI 出题失败，使用备用词</div><button class="send-btn" onclick="charadeReveal()" style="padding:8px 24px;font-size:16px">🎯 显示单词</button>';
    }
  }
}

function charadeReveal() {
  if (!chState || !chState.word) return;
  chState.revealed = true;
  const wordEl = document.getElementById('chWord');
  wordEl.innerHTML = '<div class="ch-revealed">' + esc(chState.word) + '</div><div style="font-size:13px;color:var(--text2);margin-top:8px">现在用英文描述它 —— 不要说出这个单词本身！</div>';
  document.getElementById('chSubmitBtn').disabled = false;
  if (chState.hint) document.getElementById('chHintBtn').style.display = '';
  document.getElementById('chDesc').focus();
}

function charadeShowHint() {
  if (!chState || !chState.hint) return;
  const guessEl = document.getElementById('chGuess');
  guessEl.style.display = 'block';
  guessEl.style.background = 'var(--amber-bg)';
  guessEl.style.border = '1px solid var(--amber)';
  guessEl.innerHTML = '💡 <b>提示</b>：' + esc(chState.hint);
}

function chNormalize(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ');
}
function chIsMatch(guess, target) {
  const g = chNormalize(guess), t = chNormalize(target);
  if (!g || !t) return false;
  if (g === t) return true;
  // 单复数容忍
  const strip = s => s.replace(/(es|s)$/, '');
  if (strip(g) === strip(t)) return true;
  // 包含关系（短语）
  if (g.length >= 4 && t.includes(g)) return true;
  if (t.length >= 4 && g.includes(t)) return true;
  return false;
}

async function submitCharade() {
  const desc = document.getElementById('chDesc').value.trim();
  if (!desc) { toastMsg('Please write your description first.'); return; }
  if (!chState || !chState.revealed) { toastMsg('Click "显示单词" first.'); return; }
  chState.rounds++;
  const guessEl = document.getElementById('chGuess');
  guessEl.style.display = 'block';
  guessEl.style.background = 'var(--bg)';
  guessEl.style.border = '1px solid var(--border)';
  guessEl.innerHTML = '<div class="loading">🤔 AI 正在猜 + 评分中...</div>';
  document.getElementById('chSubmitBtn').disabled = true;

  try {
    // 多维度评分 prompt（接近 Chat 的四维度评分：clarity/grammar/vocabulary/creativity + 综合）
    const prompt = 'You are playing a charades game and acting as a strict English teacher. The player described an English word in English WITHOUT saying the target word. Your jobs: (1) GUESS the target word. (2) Score the description on multiple dimensions.\n\nTarget word: "' + chState.word + '"\nPlayer\'s description: "' + desc + '"\n\nReturn ONLY valid JSON (no markdown, no thinking):\n{\n  "guess": "your single best guess of the word (English, lowercase)",\n  "guess_correct": "true if your guess matches the target word (case-insensitive, allow plural/inflection), else false",\n  "ai_guess_reasoning": "1-2 sentences in English explaining what clues in the description led you to your guess",\n  "score_overall": "overall score 0-100 with grade (e.g. 78/100 — Good)",\n  "score_clarity": 1,\n  "score_grammar": 1,\n  "score_vocabulary": 1,\n  "score_creativity": 1,\n  "score_comprehensibility": 1,\n  "dimensions_comment": "in Chinese: brief overall comment on the description (2-3 sentences)",\n  "strengths": ["in Chinese: 2-4 specific strengths of the description (what was done well)"],\n  "improvements": ["in Chinese: 2-4 specific, actionable improvements (what to change and how)"],\n  "grammar_issues": [{"error": "the original problematic phrase (empty array if no errors)", "correction": "the corrected version", "explanation": "in Chinese: brief grammar rule"}],\n  "vocabulary_upgrade": [{"basic": "basic word/phrase used", "better": "more natural/advanced alternative", "note": "in Chinese: when to use the better one"}],\n  "better_description": "a 1-2 sentence English version that would clearly describe the target word without saying it",\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "short title", "content": "in Chinese: 1-2 sentence learning point"}]\n}\nAll score_* values must be integers 1-10.';
    const raw = await callAPI([
      { role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' },
      { role: 'user', content: 'Analyze the description and respond with the JSON.' }
    ], { temperature: 0.3, maxTokens: 3000 });
    const obj = smartParseJSON(raw);
    const aiGuess = (obj && obj.guess) || '(no guess)';
    // 双向判断猜对：AI 说自己猜对 + 字符串匹配
    const stringMatch = chIsMatch(aiGuess, chState.word);
    const aiSaysCorrect = obj && obj.guess_correct === 'true' || obj && obj.guess_correct === true;
    const correct = stringMatch && aiSaysCorrect;
    chState.guessResult = { aiGuess, correct, desc, rounds: chState.rounds, obj };

    chScore.total++;
    if (correct) chScore.correct++;
    chRenderScore();

    if (correct) {
      guessEl.style.background = 'var(--green-bg)';
      guessEl.style.border = '1px solid var(--green)';
      guessEl.innerHTML = '<div style="font-size:22px;font-weight:800;color:var(--green)">🎉 AI 猜中了！</div>' +
        '<div style="margin-top:6px">AI 的猜测：<b>' + esc(aiGuess) + '</b> = 目标词 <b>' + esc(chState.word) + '</b></div>' +
        (obj && obj.ai_guess_reasoning ? '<div style="margin-top:6px;font-size:12px;color:var(--text2)">💭 推理：' + esc(obj.ai_guess_reasoning) + '</div>' : '') +
        (chState.hint ? '<div style="margin-top:6px;font-size:12px;color:var(--text2)">💡 参考提示：' + esc(chState.hint) + '</div>' : '') +
        '<div style="margin-top:10px;display:flex;gap:8px"><button class="send-btn" onclick="charadeNext()" style="padding:6px 18px;font-size:14px">下一个 →</button></div>';
    } else {
      guessEl.style.background = 'var(--red-bg)';
      guessEl.style.border = '1px solid var(--red)';
      guessEl.innerHTML = '<div style="font-size:18px;font-weight:800;color:var(--red)">❌ AI 没猜中（第 ' + chState.rounds + ' 轮）</div>' +
        '<div style="margin-top:6px">AI 猜成了：<b>' + esc(aiGuess) + '</b>，正确答案是 <b>' + esc(chState.word) + '</b></div>' +
        (obj && obj.ai_guess_reasoning ? '<div style="margin-top:6px;font-size:12px;color:var(--text2)">💭 推理：' + esc(obj.ai_guess_reasoning) + '</div>' : '') +
        '<div style="margin-top:10px;display:flex;gap:8px">' +
        '<button class="send-btn" onclick="charadeImprove()" style="padding:6px 18px;font-size:14px;background:var(--primary)">✏️ 改进描述</button>' +
        '<button class="dict-btn" onclick="charadeSkip()" style="font-size:13px;padding:6px 14px">跳过 →</button></div>';
    }
    document.getElementById('chSubmitBtn').disabled = correct;

    // 完整评价送右侧边栏（多维度，类似 Chat 反馈）
    showCharadeDetailedFeedback(obj, correct);
  } catch (e) {
    guessEl.innerHTML = '<span style="color:var(--red)">评分失败: ' + esc(e.message || '') + '</span>';
    document.getElementById('chSubmitBtn').disabled = false;
  }
}

// 生成 Charade 详细反馈 HTML（多维度评分，类似 Chat 反馈结构）
function showCharadeDetailedFeedback(obj, correct) {
  if (!obj) {
    showModuleFeedback('charade', chState.word, '<div class="pf-item red">⚠️ 评分解析失败，请重试</div>');
    return;
  }
  const title = chState.word + (correct ? ' ✓' : ' ✗') + ' · 第 ' + chState.rounds + ' 轮';
  let html = '';

  // 1. 顶部英雄区：总分 + AI 猜词
  const guessLine = '<div style="font-size:13px;margin-top:6px">🤖 AI 猜成了：<b>' + esc(obj.guess || '-') + '</b> → ' +
    (correct ? '<span style="color:var(--green)">✓ 猜中</span>' : '<span style="color:var(--red)">✗ 实际：' + esc(chState.word) + '</span>') + '</div>';
  html += pfHero(obj.score_overall || (correct ? '8/10 — 描述清晰' : '5/10 — 描述模糊'), '🎭 Charade 描述评分');
  html += '<div class="pf-section">' + guessLine + (obj.ai_guess_reasoning ? '<div style="font-size:11px;color:var(--text2);margin-top:4px">💭 ' + esc(obj.ai_guess_reasoning) + '</div>' : '') + '</div>';

  // 2. 多维度评分条
  const dims = [
    ['score_clarity', '🎯 清晰度'],
    ['score_grammar', '📖 语法'],
    ['score_vocabulary', '💬 词汇'],
    ['score_creativity', '✨ 创意'],
    ['score_comprehensibility', '🤝 AI理解度']
  ];
  const dimHtml = dims.map(([k, label]) => {
    const v = Math.max(1, Math.min(10, parseInt(obj[k]) || 0));
    const pct = v * 10;
    const color = v >= 8 ? 'var(--green)' : v >= 5 ? 'var(--amber)' : 'var(--red)';
    return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px">' +
      '<span style="min-width:88px;color:var(--text2)">' + label + '</span>' +
      '<div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + color + ';transition:width .3s"></div></div>' +
      '<span style="min-width:28px;text-align:right;font-weight:700;color:' + color + '">' + v + '</span>' +
      '</div>';
  }).join('');
  html += '<div class="pf-section"><div class="pf-title">📊 多维度评分</div>' + dimHtml + '</div>';

  // 3. 总体评论
  if (obj.dimensions_comment) {
    html += '<div class="pf-section"><div class="pf-title">📝 总体评论</div><div class="pf-item md-content">' + renderMD(obj.dimensions_comment) + '</div></div>';
  }

  // 4. 优点
  if (obj.strengths && obj.strengths.length) {
    html += '<div class="pf-section"><div class="pf-title">✅ 描述优点</div>' + pfList(obj.strengths, 'green') + '</div>';
  }

  // 5. 改进建议
  if (obj.improvements && obj.improvements.length) {
    html += '<div class="pf-section"><div class="pf-title">💡 改进建议</div>' + pfList(obj.improvements, 'amber') + '</div>';
  }

  // 6. 语法纠错
  if (obj.grammar_issues && obj.grammar_issues.length) {
    const corrHtml = obj.grammar_issues.map(g => {
      return '<div style="background:var(--surface);padding:8px 10px;border-radius:8px;margin-bottom:6px;border-left:3px solid var(--red);line-height:1.5">' +
        '<div style="color:var(--red);font-size:12px">❌ ' + esc(g.error || '') + '</div>' +
        '<div style="color:var(--green);font-size:12px">✅ ' + esc(g.correction || '') + '</div>' +
        (g.explanation ? '<div style="color:var(--text2);font-size:11px;margin-top:2px">' + esc(g.explanation) + '</div>' : '') +
        '</div>';
    }).join('');
    html += '<div class="pf-section"><div class="pf-title">📐 语法纠错</div>' + corrHtml + '</div>';
  }

  // 7. 词汇升级
  if (obj.vocabulary_upgrade && obj.vocabulary_upgrade.length) {
    const vHtml = obj.vocabulary_upgrade.map(v => {
      return '<div style="background:var(--surface);padding:6px 10px;border-radius:6px;margin-bottom:4px;font-size:12px;line-height:1.5">' +
        '<span style="color:var(--text2)">' + esc(v.basic || '') + '</span> → ' +
        '<span style="color:var(--primary);font-weight:600">' + esc(v.better || '') + '</span>' +
        (v.note ? '<div style="color:var(--text2);font-size:11px;margin-top:2px">' + esc(v.note) + '</div>' : '') +
        '</div>';
    }).join('');
    html += '<div class="pf-section"><div class="pf-title">💬 词汇升级</div>' + vHtml + '</div>';
  }

  // 8. 推荐描述
  if (obj.better_description) {
    html += '<div class="pf-section"><div class="pf-title">💡 参考描述</div><div class="pf-highlight md-content">' + renderMD(obj.better_description) + '</div></div>';
  }

  // 9. 拓展知识
  if (obj.extensions && obj.extensions.length) {
    const extHtml = obj.extensions.map(e => {
      return '<div style="background:var(--green-bg);padding:8px 10px;border-radius:8px;margin-bottom:6px;font-size:12px;line-height:1.5">' +
        '<span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--green)">' + esc(e.type || 'knowledge') + '</span>' +
        (e.title ? ' <b>' + esc(e.title) + '</b>' : '') +
        '<div style="margin-top:3px">' + esc(e.content || '') + '</div></div>';
    }).join('');
    html += '<div class="pf-section"><div class="pf-title">📚 拓展知识</div>' + extHtml + '</div>';
  }

  // 10. 你的描述
  html += '<div class="pf-section"><div class="pf-title">📝 你的描述</div><div class="pf-highlight md-content">' + renderMD(chState.guessResult.desc) + '</div></div>';

  // 11. 目标词
  html += '<div class="pf-section"><div class="pf-title">🎯 目标词</div><div class="pf-highlight md-content"><b>' + esc(chState.word) + '</b>' + (chState.hint ? ' — ' + renderMD(chState.hint) : '') + '</div></div>';

  showModuleFeedback('charade', title, html);
}

function charadeImprove() {
  // 回到编辑状态，让用户继续修改描述
  const guessEl = document.getElementById('chGuess');
  guessEl.style.background = 'var(--amber-bg)';
  guessEl.style.border = '1px solid var(--amber)';
  guessEl.innerHTML = '✏️ 继续修改你的描述，再点「🤔 让 AI 猜」。AI 上次猜成了：<b>' + esc(chState.guessResult.aiGuess) + '</b>' +
    (chState.guessResult.obj && chState.guessResult.obj.ai_guess_reasoning ? '<div style="margin-top:4px;font-size:11px;color:var(--text2)">💭 ' + esc(chState.guessResult.obj.ai_guess_reasoning) + '</div>' : '');
  document.getElementById('chDesc').focus();
  document.getElementById('chSubmitBtn').disabled = false;
}

function charadeSkip() {
  // 跳过时给出完整评价到右侧边栏（多维度）
  if (chState && chState.guessResult) {
    showCharadeDetailedFeedback(chState.guessResult.obj, false);
  }
  charadeNext();
}

// ============================================================
// Cloze · 上海高考 11 选 10（生词本驱动 + AI 出题）
// ============================================================
let clState = null; // {questions:[{sentence, options:[], answer}], candidates}
let clSource = 'vocab'; // vocab | ai
let clScore = { correct: 0, total: 0 };
let clChoices = {}; // {questionIndex: optionIndex}

function clNormalize(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9\s'-]/g, '').trim().replace(/\s+/g, ' ');
}

function clTokensOverlap(a, b) {
  // 比较单词级包含（处理变形 / 带连字符 / 短语拆分）
  const tk = s => (s || '').toString().toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean).sort();
  const aSet = new Set(tk(a)); const bSet = new Set(tk(b));
  if (aSet.size === 0 || bSet.size === 0) return false;
  // 至少一个 aSet 的 token 在 bSet 里
  for (const t of aSet) if (bSet.has(t)) return true;
  return false;
}

function clRenderScore() {
  const el = document.getElementById('clozeScore');
  if (el) el.textContent = '✅ ' + clScore.correct + '/' + clScore.total;
}

function clozeSource(src) {
  clSource = src;
  document.getElementById('clozeVocabBtn').classList.toggle('active', src === 'vocab');
  document.getElementById('clozeAiBtn').classList.toggle('active', src === 'ai');
  clozeNext();
}

async function clozeNext() {
  clChoices = {};
  clState = null;
  document.getElementById('clozeQuestions').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2)">⏳ 加载题目...</div>';
  document.getElementById('clozeCandidates').innerHTML = '';

  if (clSource === 'vocab') {
    const vocab = getVocab();
    if (!vocab || vocab.length < 10) {
      document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;text-align:center;color:var(--amber)">📚 生词本里少于 10 个词，请先去 Chat 对话中划词加入生词本，或切换到 AI 出题。</div>';
      return;
    }
    // 从生词本随机抽 10 个词
    const shuffled = [...vocab].sort(() => Math.random() - 0.5).slice(0, 10);
    const picks = shuffled.map(v => ({ word: v.word, meaning: v.translation || v.meaning || '' }));
    // 用 AI 生成 10 个含 these words 的句子（每句填空）
    await clGenerateFromVocab(picks);
  } else {
    await clGenerateFromAI();
  }
}

async function clGenerateFromVocab(picks) {
  const wordsList = picks.map(p => p.word).join(', ');
  const prompt = 'You are creating a Shanghai Gaokao English cloze test (11-choose-10 style) using the following vocabulary words: ' + wordsList + '\n\nFor EACH of these 10 words, write one natural English sentence that uses the word (or a clear inflection of it), with the word itself replaced by "____". The sentence should be natural Gaokao-level English.\n\nReturn ONLY valid JSON:\n{\n  "items": [\n    { "sentence": "The new policy has had a profound ____ on the environment.", "answer": "impact" }\n  ]\n}\nEach answer should match one of the given words (case-insensitive, allow inflections like impacts/impacted).';
  try {
    const raw = await callAPI([
      { role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' },
      { role: 'user', content: 'Generate 10 cloze sentences using these words.' }
    ], { temperature: 0.6, maxTokens: 3000 });
    const obj = smartParseJSON(raw);
    if (!obj || !Array.isArray(obj.items) || obj.items.length < 10) {
      document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;color:var(--red)">AI 生成失败，请重试</div>';
      return;
    }
    const items = obj.items.slice(0, 10);
    // 验证每个 item 的 answer 能在 picks 里找到（容忍变形）
    const valid = items.filter(it => picks.some(p => clNormalize(p.word) === clNormalize(it.answer) || clNormalize(p.word) === clNormalize((it.answer || '').replace(/e?s$/, '')) || clNormalize(it.answer) === clNormalize((p.word || '').replace(/e?s$/, ''))));
    if (valid.length < 8) {
      // fallback: 用 picks 直接做 11 选 10（不用 AI 造句）
      clBuildFromPicks(picks);
      return;
    }
    const questions = valid.slice(0, 10).map(it => {
      const correctWord = picks.find(p => clTokensOverlap(p.word, it.answer) || clNormalize(p.word) === clNormalize(it.answer) || clNormalize(p.word) === clNormalize((it.answer || '').replace(/e?s$/, '')));
      return { sentence: it.sentence, options: [correctWord.word], answer: correctWord.word, meaning: correctWord.meaning };
    });
    clAddDistractorAndRender(questions, picks);
  } catch (e) {
    document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;color:var(--red)">AI 生成失败: ' + esc(e.message) + '</div>';
  }
}

function clBuildFromPicks(picks) {
  // 当 AI 不可用时，从生词本直接生成简单 cloze（句子 = word + 简单释义）
  const questions = picks.slice(0, 10).map(p => ({
    sentence: 'The word <span style="color:var(--primary);font-weight:700">' + esc(p.word) + '</span> means: ' + esc((p.meaning || '').substring(0, 30)) + ' — Please write: <span style="color:var(--primary)">____</span>',
    options: [p.word], answer: p.word, meaning: p.meaning
  }));
  clAddDistractorAndRender(questions, picks);
}

async function clGenerateFromAI() {
  const prompt = 'Generate a Shanghai Gaokao English cloze test (11-choose-10 style). Create 10 sentences at Gaokao difficulty. Each sentence should have one blank. Then create an 11th word that does NOT fit any sentence (the distractor).\n\nReturn ONLY valid JSON:\n{\n  "items": [\n    { "sentence": "...____...", "answer": "impact" }\n  ],\n  "distractor": "harmony"\n}\nMake the answers common CET-6 / Gaokao vocabulary words.';
  try {
    const raw = await callAPI([
      { role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' },
      { role: 'user', content: 'Generate the cloze.' }
    ], { temperature: 0.7, maxTokens: 3000 });
    const obj = smartParseJSON(raw);
    if (!obj || !Array.isArray(obj.items) || obj.items.length < 10) {
      document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;color:var(--red)">AI 生成失败，请重试</div>';
      return;
    }
    const items = obj.items.slice(0, 10);
    const distractor = (obj.distractor || 'extra').toString();
    const questions = items.map(it => ({ sentence: it.sentence, options: [it.answer], answer: it.answer, meaning: '' }));
    clAddDistractorAndRender(questions, [distractor]);
  } catch (e) {
    document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;color:var(--red)">AI 生成失败: ' + esc(e.message) + '</div>';
  }
}

function clAddDistractorAndRender(questions, picks) {
  // 加入 1 个干扰项（多余的），组成 11 选 10
  let distractor = null;
  if (picks.length > 10) distractor = picks[10].word;
  else if (typeof picks[0] === 'string') {
    // AI 模式：picks 是包含 1 个干扰词的数组
    distractor = picks[0];
  } else {
    // 生词本 fallback：从 vocab 里随机抽一个不在 questions 里的
    const vocab = getVocab();
    const used = new Set(questions.map(q => clNormalize(q.answer)));
    const cand = (vocab || []).find(v => !used.has(clNormalize(v.word)));
    distractor = cand ? cand.word : 'extra';
  }
  clState = { questions, distractor, answers: questions.map(q => q.answer) };
  clRenderCandidates();
  clRenderQuestions();
}

function clRenderCandidates() {
  if (!clState) return;
  const all = [...clState.answers, clState.distractor];
  // 随机排序
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  const wrap = document.getElementById('clozeCandidates');
  wrap.innerHTML = shuffled.map((opt, idx) => {
    return '<span class="cloze-cand" data-opt="' + esc(opt) + '" onclick="clPickCandidate(this, \'' + esc(opt) + '\')">' + esc(opt) + '</span>';
  }).join('');
}

function clRenderQuestions() {
  if (!clState) return;
  const wrap = document.getElementById('clozeQuestions');
  wrap.innerHTML = clState.questions.map((q, i) => {
    const chosen = clChoices[i];
    const blank = chosen !== undefined
      ? '<span class="cloze-blank ' + (q.showCorrect ? (clNormalize(chosen) === clNormalize(q.answer) ? 'correct' : 'wrong') : '') + '">' + esc(chosen) + '</span>'
      : '<span class="cloze-blank">____</span>';
    // q.sentence 来自 LLM，必须转义后再拼接（只保留我们自己生成的空格标签）
    const raw = String(q.sentence || '');
    const cut = raw.indexOf('____');
    const head = cut >= 0 ? raw.slice(0, cut) : raw;
    const tail = cut >= 0 ? raw.slice(cut + 4) : '';
    const sentenceHtml = cut >= 0
      ? esc(head) + '</span>' + blank + '<span>' + esc(tail)
      : esc(raw);
    return '<div class="cloze-q" data-idx="' + i + '"><span class="cloze-num">' + (i + 1) + '.</span><span>' + sentenceHtml + '</span></div>';
  }).join('');
}

function clPickCandidate(el, opt) {
  if (!clState) return;
  // 找出点击的 candidate 在 candidates 里的位置
  const candWrap = document.getElementById('clozeCandidates');
  const cands = Array.from(candWrap.querySelectorAll('.cloze-cand'));
  const used = new Set(Object.values(clChoices).map(clNormalize));
  // 检查是否已被使用
  if (used.has(clNormalize(opt))) {
    // 取消选择：从 choices 里移除该选项对应的题号
    for (const idxStr of Object.keys(clChoices)) {
      if (clNormalize(clChoices[idxStr]) === clNormalize(opt)) {
        delete clChoices[idxStr];
      }
    }
    // 重新标记 used
    const usedAfter = new Set(Object.values(clChoices).map(clNormalize));
    cands.forEach(c => c.classList.toggle('used', usedAfter.has(clNormalize(c.dataset.opt))));
    // 找到当前第一个空白题，并填入
    const emptyIdx = clState.questions.findIndex((_, i) => clChoices[i] === undefined);
    if (emptyIdx >= 0) clChoices[emptyIdx] = opt;
    clRenderQuestions();
    return;
  }
  // 找到当前第一个空白题填入
  const emptyIdx = clState.questions.findIndex((_, i) => clChoices[i] === undefined);
  if (emptyIdx < 0) { toastMsg('所有空格已填满'); return; }
  clChoices[emptyIdx] = opt;
  // 标记其他候选的 used 状态
  const usedAfter = new Set(Object.values(clChoices).map(clNormalize));
  cands.forEach(c => c.classList.toggle('used', usedAfter.has(clNormalize(c.dataset.opt))));
  clRenderQuestions();
}

function submitCloze() {
  if (!clState) return;
  const total = clState.questions.length;
  const filled = Object.keys(clChoices).length;
  if (filled < total) { toastMsg('还有 ' + (total - filled) + ' 个空格未填'); return; }
  clScore.total++;
  let correct = 0;
  clState.questions.forEach((q, i) => {
    q.showCorrect = true;
    if (clNormalize(clChoices[i]) === clNormalize(q.answer)) correct++;
  });
  clScore.correct += correct;
  clRenderScore();
  clRenderQuestions();
  // 显示每题对错 + 反馈到右侧
  let html = pfHero(correct + ' / ' + total, '正确率');
  html += pfSection('📝 逐题答案', '<div class="pf-list">' + clState.questions.map((q, i) => {
    const ok = clNormalize(clChoices[i]) === clNormalize(q.answer);
    const tone = ok ? 'green' : 'red';
    return '<div class="pf-item ' + tone + '"><div class="md-content">' + renderMD(q.sentence) + '</div>' +
      '<div style="margin-top:4px;font-size:12px">' +
      '<span style="color:' + (ok ? 'var(--green)' : 'var(--red)') + '">你的: <b>' + esc(clChoices[i] || '(空)') + '</b></span>' +
      ' · <span style="color:var(--green)">答案: <b>' + esc(q.answer) + '</b></span></div></div>';
  }).join('') + '</div>');
  showModuleFeedback('cloze', correct + '/' + total, html);
  toastMsg(correct === total ? '🎉 全对！' : '📝 已评分，查看右侧');
}

function clozeShowAnswers() {
  if (!clState) return;
  clState.questions.forEach(q => q.showCorrect = true);
  // 自动填入正确答案
  clState.questions.forEach((q, i) => clChoices[i] = q.answer);
  clRenderCandidates();
  clRenderQuestions();
}

// ============================================================
// Wordle · 6 次机会猜单词
// ============================================================
let wlState = null; // {word, length, attempts, history:[[letters, status]]}
let wlInput = '';
let wlDone = false;

function wordleSource(src) {
  if (src === 'ai') wlGenerate();
  else wlPromptCustom();
}

function wlPromptCustom() {
  const w = prompt('输入你想让对方猜的 5-6 字母单词：', '');
  if (!w) return;
  const clean = (w.match(/[a-zA-Z]+/)?.[0] || '').toLowerCase();
  if (clean.length < 4 || clean.length > 7) { toastMsg('请输入 4-7 个字母的单词'); return; }
  document.getElementById('wlAiBtn').classList.remove('active');
  document.getElementById('wlCustomBtn').classList.add('active');
  wlStart(clean);
}

function extractWordleWord(text) {
  let s = stripThinking(text || '').toLowerCase();
  // 去除外层 markdown 代码块与 JSON 块，避免 "word" 字段名或代码包裹被误识别
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/\{[\s\S]*?\}/g, ' ');
  // 去掉常见前缀（"the word is apple", "here is: apple" 等）
  s = s.replace(/\bthe\s+word\s+is\b[^\n]*?([a-z]+)/g, '$1');
  s = s.replace(/\bhere'?s?\s+(?:a|an)\s+word\b[^\n]*?([a-z]+)/g, '$1');
  // 只接受 5 或 6 字母的纯英文单词
  const m = s.match(/\b[a-z]{5,6}\b/);
  return m ? m[0] : '';
}

async function wlGenerate() {
  document.getElementById('wlAiBtn').classList.add('active');
  document.getElementById('wlCustomBtn').classList.remove('active');
  const prompt = 'You are picking a single English Wordle-style word. Output rules (strict):\n' +
    '- Exactly 5 or 6 letters, lowercase, common English.\n' +
    '- Reply with ONLY the word. No quotes, no JSON, no markdown, no explanation, no preamble.\n' +
    '- Do not include the word "word" or any other commentary.';
  const tryOnce = async () => {
    const raw = await callAPI(
      [{ role: 'system', content: prompt }, { role: 'user', content: 'Word.' }],
      { temperature: 0.5, maxTokens: 200 }
    );
    return extractWordleWord(raw);
  };
  let word = '';
  for (let i = 0; i < 2 && !word; i++) {
    try { word = await tryOnce(); } catch (e) { /* retry */ }
  }
  if (!word) {
    toastMsg('AI 出题失败，使用备用词 apple');
    word = 'apple';
  }
  wlStart(word);
}

function wlStart(word) {
  wlState = { word, length: word.length, attempts: 0, maxAttempts: 6, history: [] };
  wlInput = '';
  wlDone = false;
  wlRenderBoard();
  wlRenderKeyboard();
  wlUpdateStatus();
}

function wordleNew() {
  if (document.getElementById('wlAiBtn').classList.contains('active')) wlGenerate();
  else wlPromptCustom();
}

function wlUpdateStatus() {
  if (!wlState) return;
  const left = wlState.maxAttempts - wlState.attempts;
  let msg = '🟩 ' + wlState.length + ' 字母 · 还剩 ' + left + ' 次';
  if (wlDone) {
    const lastRow = wlState.history[wlState.history.length - 1] || [];
    if (lastRow.every(s => s && s.status === 'right')) {
      msg = '🎉 答对了！' + wlState.word.toUpperCase();
    } else {
      msg = '❌ 答案：' + wlState.word.toUpperCase();
    }
  }
  const el = document.getElementById('wordleStatus');
  if (el) el.textContent = msg;
}

function wlRenderBoard() {
  if (!wlState) return;
  const board = document.getElementById('wordleBoard');
  const len = wlState.length;
  board.style.gridTemplateColumns = 'repeat(' + len + ', 52px)';
  let html = '';
  for (let r = 0; r < wlState.maxAttempts; r++) {
    const row = wlState.history[r] || [];
    for (let c = 0; c < len; c++) {
      const letter = (row[c] && row[c].letter) || (r === wlState.attempts ? (wlInput.charAt(c) || '') : '');
      const status = (row[c] && row[c].status) || '';
      const anim = (r === wlState.attempts && c === wlInput.length - 1 && letter) ? ' pop' : (row[c] ? ' flip' : '');
      html += '<div class="wl-cell ' + status + anim + '">' + letter.toUpperCase() + '</div>';
    }
  }
  board.innerHTML = html;
}

const WL_KEYS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['enter','z','x','c','v','b','n','m','back']
];

function wlRenderKeyboard() {
  if (!wlState) return;
  const wrap = document.getElementById('wordleKeyboard');
  // 计算每个字母的最终状态（按所有提交）
  const finalStatus = {};
  wlState.history.forEach(row => row.forEach(c => {
    const cur = finalStatus[c.letter];
    if (c.status === 'right') finalStatus[c.letter] = 'right';
    else if (c.status === 'mispos' && cur !== 'right') finalStatus[c.letter] = 'mispos';
    else if (!cur) finalStatus[c.letter] = 'absent';
  }));
  wrap.innerHTML = WL_KEYS.map(row =>
    '<div style="display:flex;justify-content:center;gap:4px;margin-bottom:4px">' +
    row.map(k => {
      const cls = k === 'enter' || k === 'back' ? 'wl-key wide' : 'wl-key';
      const statusCls = finalStatus[k] ? ' ' + finalStatus[k] : '';
      return '<button class="' + cls + statusCls + '" onclick="wlKey(\'' + k + '\')">' + (k === 'back' ? '⌫' : k.toUpperCase()) + '</button>';
    }).join('') + '</div>'
  ).join('');
}

function wlKey(k) {
  if (!wlState || wlDone) return;
  if (k === 'enter') {
    if (wlInput.length !== wlState.length) { toastMsg('字母数不够'); return; }
    wlSubmit();
  } else if (k === 'back') {
    wlInput = wlInput.slice(0, -1);
    wlRenderBoard();
  } else if (wlInput.length < wlState.length) {
    wlInput += k;
    wlRenderBoard();
  }
}

function wlSubmit() {
  const guess = wlInput;
  const target = wlState.word;
  const len = wlState.length;
  const row = [];
  const targetArr = target.split('');
  const status = Array(len).fill('absent');
  // 第一轮：精确匹配
  for (let i = 0; i < len; i++) {
    if (guess[i] === targetArr[i]) { status[i] = 'right'; targetArr[i] = null; }
  }
  // 第二轮：错位
  for (let i = 0; i < len; i++) {
    if (status[i] === 'right') continue;
    const idx = targetArr.indexOf(guess[i]);
    if (idx >= 0) { status[i] = 'mispos'; targetArr[idx] = null; }
  }
  // 记录
  const rowData = [];
  for (let i = 0; i < len; i++) rowData.push({ letter: guess[i], status: status[i] });
  wlState.history.push(rowData);
  wlState.attempts++;
  wlInput = '';
  // 判断胜负
  const allRight = status.every(s => s === 'right');
  if (allRight) wlDone = true;
  else if (wlState.attempts >= wlState.maxAttempts) wlDone = true;
  wlRenderBoard();
  wlRenderKeyboard();
  wlUpdateStatus();
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('difficulty').addEventListener('input', updateDifficulty);
  musicInit();

  // Init resize handles
initResize('sidebarResize', 'sidebar', 'sidebarW', 180, 500, true);
initResize('panelResize', 'sidePanel', 'panelW', 280, 600, true);

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
      const validModes = ['chat', 'reading', 'practice', 'writing', 'translation', 'game'];
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
