/* ============================================================
   AI 英语对话教练 — 聊天渲染、反馈选择、生词本 / 薄弱点渲染
   由 js/app.js 拆分而来（原 1056-1466 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
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
  div.innerHTML = `<div class="avatar">🤖</div><div class="bubble ai-bubble"><div class="ai-text md-content">${renderMD(text)}</div><div class="ai-msg-actions"><button class="tts-btn" data-text="${textAttr}" data-action="speak-text" title="朗读">🔊 朗读</button><button class="tts-btn" data-action="translate-ai-msg" data-arg1="${msgIdAttr}" title="翻译整段">🌐 翻译</button></div></div>`;
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

function userAvatarHTML() {
  const avatar = getSetting('avatar', '');
  return avatar ? `<img src="${esc(avatar)}" alt="用户头像">` : '👤';
}

function userBubbleHTML(msg) {
  const hint = msg.feedback && msg.feedback.analysis ? '<span class="feedback-hint">✓ 已反馈</span>' : '';
  return `
    <div class="avatar">${userAvatarHTML()}</div>
    <div class="bubble user-bubble" data-action="select-feedback" data-arg1="${msg.id}">
      <div class="user-text">${esc(msg.content)}</div>
      <div class="msg-actions">
        ${hint}
        <button class="msg-btn" data-action="edit-message" data-arg1="${msg.id}" title="编辑">✏️</button>
        <button class="msg-btn" data-action="delete-message" data-arg1="${msg.id}" title="删除">🗑️</button>
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
        <button class="vs-btn" data-action="switch-variant" data-arg1="${node.id}" data-arg2="-1" data-argc="2" ${node.activeVariant === 0 ? 'disabled' : ''}>←</button>
        <span class="vs-label">${node.activeVariant + 1}/${node.variants.length} 版本</span>
        <button class="vs-btn" data-action="switch-variant" data-arg1="${node.id}" data-arg2="1" data-argc="2" ${node.activeVariant === node.variants.length - 1 ? 'disabled' : ''}>→</button>`;
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
      html += '<div style="text-align:center;margin-top:10px"><button class="retry-btn" data-action="retry-analysis" data-arg1="' + userMsgId + '">🔄 重新分析</button></div>';
    } else {
      html += '<div class="empty" style="margin-top:10px">该消息暂无反馈</div>';
      html += '<div style="text-align:center;margin-top:10px"><button class="retry-btn" data-action="retry-analysis" data-arg1="' + userMsgId + '">🔄 生成反馈</button></div>';
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
    return `<div class="vocab-card" data-action="show-vocab-detail" data-arg1="${i}" title="点击查看详情">
      <div class="v-head"><span class="v-word">${esc(item.word)}</span>${part}<span class="v-hint">📖</span></div>
      <div class="v-meaning">${esc(translation)}</div>
      ${example}
      <div class="v-foot"><span class="v-date">${date}</span><button class="del" data-action="remove-word" data-arg1="${i}" title="删除">×</button></div>
    </div>`;
  }).join('') + '</div>' +
    '<button class="vocab-clear" data-action="clear-all-vocab">清空所有生词</button>';
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
      <button data-action="close-overlay" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text2)">×</button>
    </div>
    ${item.part ? `<div style="font-size:12px;color:var(--text2);margin-bottom:8px">${esc(item.part)}</div>` : ''}
    <div style="font-size:14px;line-height:1.8;color:var(--text);margin-bottom:14px" class="md-content">${renderMD(translation, 'markdown')}</div>
    ${item.context ? `<div style="font-size:12px;color:var(--text2);padding:8px 10px;background:var(--bg);border-radius:8px;margin-bottom:10px"><strong>原文语境:</strong> ${esc(item.context)}</div>` : ''}
    ${item.added ? `<div style="font-size:11px;color:var(--text2);margin-bottom:12px">📅 添加于 ${esc(item.added)}</div>` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button data-action="close-overlay" style="padding:7px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:13px;cursor:pointer">知道了</button>
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
    return `<div class="weak-item"><span class="cat">${esc(i.category)}</span>：${esc(i.point)}<span class="cnt">×${i.count || 0}</span>${i.archived ? '<span style="color:var(--green);font-size:10px">✔已掌握</span>' : ''}<button class="del-btn" data-action="delete-weak-point" data-arg1="${key}" title="删除">×</button></div>`;
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
