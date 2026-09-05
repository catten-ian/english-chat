/* ============================================================
   AI 英语对话教练 — 设置读写、消息编辑、评分分析、发送消息、对话管理与侧栏
   由 js/app.js 拆分而来（原 2292-2942 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- Settings persistence ---------- */
function getSetting(key, def) {
  try { const v = JSON.parse(localStorage.getItem('ai_en_setting_' + key)); return v === null ? def : v; } catch(e) { return def; }
}
function setSetting(key, val) {
  localStorage.setItem('ai_en_setting_' + key, JSON.stringify(val));
  // 只存在本地的偏好（翻译历史/查词历史/自定义题库等）随 settings 快照上传，
  // 否则登出清缓存即永久丢失。白名单与抑制逻辑见 js/storage.js。
  if (typeof syncSettingToServer === 'function') syncSettingToServer(key);
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
      <button class="edit-save" data-action="save-edit" data-arg1="${msgId}">✓ 保存</button>
      <button class="edit-cancel" data-action="cancel-edit" data-arg1="${msgId}">✕ 取消</button>
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
      return '<button class="topic-item' + active + '" data-topic="' + k + '" data-action="pick-topic" data-arg1="' + k + '">' + esc(TOPIC_LABELS[k] || k) + '</button>';
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
  try { localStorage.setItem('ai_en_sidebar_open', sidebarOpen ? '1' : '0'); } catch (e) {}
  // On mobile, close the right panel when opening the sidebar
  if (isMobile() && sidebarOpen) {
    document.getElementById('sidePanel').classList.remove('open');
  }
  syncDrawerBackdrop();
  document.querySelector('.main-area').style.marginLeft = sidebarOpen ? '0' : '0';
}

/* 侧栏初始状态：记住用户上次选择；未选择时大屏（≥1440px）默认展开 */
function applySidebarPreference() {
  if (isMobile()) return;
  let saved = null;
  try { saved = localStorage.getItem('ai_en_sidebar_open'); } catch (e) {}
  const desktop = window.innerWidth >= 1440;
  sidebarOpen = saved !== null ? saved === '1' : desktop;
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sidebarToggle');
  if (sb) sb.classList.toggle('open', sidebarOpen);
  if (btn) btn.textContent = sidebarOpen ? '◀' : '▶';
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
      return `<div class="conv-item${active}" data-action="resume-conv" data-arg1="${id}"><span class="title">${title}${topicTag}</span><span class="date">${time}</span><button class="del-btn" data-action="delete-conv" data-arg1="${id}" title="删除">×</button></div>`;
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
        '<button data-action="prompt-new-conv" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:14px;cursor:pointer">💬 开始新对话</button></div>';
    }
  }
  renderSidebar();
}

function sidebarNewConversation() {
  toggleSidebar();
  promptNewConversation();
}
