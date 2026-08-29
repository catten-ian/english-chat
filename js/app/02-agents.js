/* ============================================================
   AI 英语对话教练 — 策略师 / 执行者（联网研究）/ SSE 流式输出
   由 js/app.js 拆分而来（原 292-628 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
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
