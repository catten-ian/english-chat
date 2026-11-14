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
  div.innerHTML = '<div class="avatar">' + aiAvatarHTML() + '</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
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
  div.innerHTML = `<div class="avatar">${aiAvatarHTML()}</div><div class="bubble ai-bubble"><div class="ai-text md-content">${renderMD(text)}</div><div class="ai-msg-actions"><button class="tts-btn" data-text="${textAttr}" data-action="speak-text" title="朗读">🔊 朗读</button><button class="tts-btn" data-action="translate-ai-msg" data-arg1="${msgIdAttr}" title="翻译整段">🌐 翻译</button></div></div>`;
  m.appendChild(div);
  renderChatMath(div.querySelector('.ai-text'));
  scrollToBottom();
  return div;
}

function aiAvatarHTML() {
  const id = typeof getActiveCharacterId === 'function' ? getActiveCharacterId() : 'alex';
  const chars = typeof getSavedCharacters === 'function' ? getSavedCharacters() : [];
  const c = chars.find(x => x && x.id === id);
  const avatar = (c && c.avatar) || '🤖';
  return /^data:image\//i.test(avatar) || /^https?:\/\//i.test(avatar)
    ? '<img src="' + esc(avatar) + '" alt="AI 头像">' : esc(avatar);
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
    });
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
  standardizeLegacyVocabAsync();
  const v = getVocab();
  const countEl = document.getElementById('wordCount');
  if (countEl) countEl.textContent = v.length;
  const el = document.getElementById('vocabContent');
  if (!v.length) { el.innerHTML = '<div class="empty">还没有生词</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="a-btn primary" data-action="add-vocab-manual">＋ 手动添加</button><button class="a-btn" data-action="import-vocab">批量导入</button></div>'; return; }
  // Use the card layout; each card is clickable to view details
  el.innerHTML = '<div class="vocab-list">' + v.map((item, i) => {
    const translations = Array.isArray(item.meanings) && item.meanings.length ? item.meanings : (item.translation || '').split(/\s*\/\s*/).filter(Boolean);
    const translation = translations[0] || '未填写释义';
    const example = item.example ? `<div class="v-example">"${esc(item.example)}"</div>` : '';
    const part = item.part ? `<span class="v-part">${esc(item.part)}</span>` : '';
    const date = item.added ? `<span class="v-date">${esc(item.added)}</span>` : '';
    return `<div class="vocab-card" data-action="show-vocab-detail" data-arg1="${i}" title="点击查看详情">
      <div class="v-head"><span class="v-word">${esc(item.word)}</span>${part}<span class="v-hint">📖</span></div>
      <div class="v-meaning${translation === '未填写释义' ? ' vocab-empty-meaning' : ''}">${esc(translation)}${translations.length > 1 ? ' <span style="font-size:11px;color:var(--text3)">+' + (translations.length - 1) + ' 个释义</span>' : ''}</div>
      ${example}
      <div class="v-foot"><span class="v-date">${date}</span><button class="del" data-action="edit-vocab" data-arg1="${i}" title="编辑">✎</button><button class="del" data-action="remove-word" data-arg1="${i}" title="删除">×</button></div>
    </div>`;
  }).join('') + '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="a-btn" data-action="add-vocab-manual">＋ 手动添加</button><button class="a-btn" data-action="import-vocab">批量导入</button><button class="vocab-clear" data-action="clear-all-vocab">清空所有生词</button></div>';
}

function addVocabManual(idx) {
  const v = getVocab();
  const old = Number.isInteger(idx) ? v[idx] : null;
  removeAllModals();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-card" style="max-width:520px;width:calc(100% - 28px)">
    <div class="modal-header"><h3>${old ? '编辑生词' : '加入生词本'}</h3><button class="modal-close" data-action="close-overlay">×</button></div>
    <div class="modal-body" style="display:grid;gap:10px">
      <label>英文单词或词组<input id="vocabEditWord" value="${esc(old?.word || '')}" placeholder="例如: take responsibility" style="width:100%;box-sizing:border-box;padding:9px;margin-top:4px"></label>
      <div><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><strong>释义</strong><button class="a-btn" type="button" data-action="vocab-add-sense">＋ 添加释义</button></div><div id="vocabSenseRows" style="display:grid;gap:8px;margin-top:8px">${(old?.senses || (old?.meanings || []).map(text => ({ text }))).map((sense, i) => vocabSenseEditorRow(sense, i)).join('')}</div><small style="color:var(--text2)">没有释义时可留空，保存后会在后台自动生成并整理格式。</small></div>
      <label>默认复习方向<select id="vocabEditDirection" style="width:100%;padding:9px;margin-top:4px"><option value="meaning-to-word" ${(old?.direction || 'meaning-to-word') === 'meaning-to-word' ? 'selected' : ''}>看中文写英文</option><option value="word-to-meaning" ${old?.direction === 'word-to-meaning' ? 'selected' : ''}>看英文想中文</option></select></label>
      <label>语境（可选）<textarea id="vocabEditContext" rows="2" placeholder="记录这个词出现在哪里" style="width:100%;box-sizing:border-box;padding:9px;margin-top:4px">${esc(old?.context || '')}</textarea></label>
    </div>
    <div class="modal-footer"><button class="a-btn" data-action="close-overlay">取消</button><button class="a-btn primary" data-action="save-vocab-editor" data-arg1="${Number.isInteger(idx) ? idx : -1}">保存</button></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}

function vocabSenseEditorRow(sense, index) {
  const item = typeof sense === 'string' ? { text: sense } : (sense || {});
  return `<div class="vocab-sense-editor" data-sense-row style="border:1px solid var(--border);border-radius:6px;padding:9px;display:grid;gap:7px">
    <div style="display:grid;grid-template-columns:1fr 80px auto;gap:6px"><input data-sense-field="text" value="${esc(item.text || '')}" placeholder="中文释义" aria-label="中文释义 ${index + 1}" style="min-width:0;padding:7px"><input data-sense-field="pos" value="${esc(item.pos || '')}" placeholder="词性" aria-label="词性 ${index + 1}" style="min-width:0;padding:7px"><button type="button" class="del" data-action="vocab-remove-sense" title="删除此释义">×</button></div>
    <input data-sense-field="example" value="${esc(item.example || '')}" placeholder="英文例句（可选）" aria-label="例句 ${index + 1}" style="padding:7px">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px"><label><input data-sense-field="focus" type="checkbox" ${item.focus ? 'checked' : ''}> 重点关注</label><label><input data-sense-field="unknown" type="checkbox" ${item.unknown ? 'checked' : ''}> 这个意思不会</label><select data-sense-field="direction" aria-label="此释义的复习方向" style="margin-left:auto;padding:5px"><option value="zh2en" ${item.direction === 'zh2en' || (!item.direction && item.direction !== 'en2zh') ? 'selected' : ''}>看中文回忆英文 (zh2en)</option><option value="en2zh" ${item.direction === 'en2zh' ? 'selected' : ''}>看英文回忆中文 (en2zh)</option></select></div>
  </div>`;
}

function vocabAddSenseRow() {
  const root = document.getElementById('vocabSenseRows');
  if (!root) return;
  root.insertAdjacentHTML('beforeend', vocabSenseEditorRow({ direction: 'zh2en' }, root.querySelectorAll('[data-sense-row]').length));
}

function vocabRemoveSenseRow(button) {
  button?.closest('[data-sense-row]')?.remove();
}

function saveVocabEditor(idx) {
  const word = document.getElementById('vocabEditWord')?.value.trim();
  if (!word) return toastMsg('请填写英文单词或词组');
  const direction = document.getElementById('vocabEditDirection')?.value === 'word-to-meaning' ? 'word-to-meaning' : 'meaning-to-word';
  const context = document.getElementById('vocabEditContext')?.value.trim() || '';
  const senseRows = document.querySelectorAll?.('#vocabSenseRows [data-sense-row]') || [];
  const senses = [...senseRows].map(row => {
    const read = name => row.querySelector(`[data-sense-field="${name}"]`);
    return { text: read('text')?.value.trim() || '', pos: read('pos')?.value.trim() || '', example: read('example')?.value.trim() || '', focus: !!read('focus')?.checked, unknown: !!read('unknown')?.checked, direction: read('direction')?.value === 'en2zh' ? 'en2zh' : 'zh2en' };
  }).filter(sense => sense.text);
  if (!senseRows.length) senses.push(...String(document.getElementById('vocabEditMeanings')?.value || '').split(/\n+/).map(text => ({ text: text.trim(), pos: '', example: '', focus: false, unknown: false, direction: direction === 'word-to-meaning' ? 'en2zh' : 'zh2en' })).filter(sense => sense.text));
  const meanings = senses.map(sense => sense.text);
  const v = getVocab();
  const old = idx >= 0 ? v[idx] : null;
  const item = { word, senses, meanings, translation: meanings.join(' / '), direction, context, part: senses[0]?.pos || old?.part || '', example: senses[0]?.example || old?.example || '', added: old?.added || new Date().toISOString().slice(0, 10), meaningStatus: meanings.length ? 'ready' : 'pending', meaningFormatVersion: meanings.length ? 1 : 0, needsMeaningStandardization: false };
  if (idx >= 0 && v[idx]) v[idx] = { ...v[idx], ...item };
  else v.push(item);
  saveVocab(v); renderVocab(); document.querySelector('.modal-overlay')?.remove();
  toastMsg(idx >= 0 ? '✅ 生词已更新' : (meanings.length ? '✅ 已加入生词本' : '✅ 已加入，释义将在后台生成'));
  if (!meanings.length) generateVocabMeaningAsync(word, context, idx >= 0 ? idx : v.length - 1);
}

function importVocab() {
  removeAllModals();
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-card" style="max-width:580px;width:calc(100% - 28px)">
    <div class="modal-header"><h3>批量加入生词本</h3><button class="modal-close" data-action="close-overlay">×</button></div>
    <div class="modal-body" style="display:grid;gap:12px">
      <p style="margin:0;color:var(--text2);font-size:13px;line-height:1.6">支持粘贴文本或上传 TXT、CSV、JSON。每行一个词；CSV/制表符格式为「英文,中文释义」，释义留空会后台自动生成。</p>
      <textarea id="vocabImportText" rows="8" placeholder="take responsibility,承担责任\nobscure\ncome across\t偶然遇到" style="width:100%;box-sizing:border-box;padding:10px;resize:vertical"></textarea>
      <input id="vocabImportFile" type="file" accept=".txt,.csv,.tsv,.json,text/plain,application/json" style="width:100%">
      <div style="font-size:12px;color:var(--text2)">可选：默认复习方向为“看中文写英文”</div>
    </div>
    <div class="modal-footer"><button class="a-btn" data-action="close-overlay">取消</button><button class="a-btn primary" data-action="save-vocab-import">立即加入</button></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.getElementById('vocabImportFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try { document.getElementById('vocabImportText').value = await file.text(); } catch (_) { toastMsg('无法读取该文件'); }
  });
}

function parseVocabImportRows(raw) {
  raw = String(raw || '').trim();
  let rows = [];
  try {
    if (raw[0] === '[' || raw[0] === '{') {
      const parsed = JSON.parse(raw);
      const source = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.words) ? parsed.words : (parsed && Array.isArray(parsed.vocab) ? parsed.vocab : (parsed ? [parsed] : [])));
      rows = source.map(row => typeof row === 'string' ? { word: row } : row).filter(Boolean);
    }
  } catch (_) { rows = []; }
  if (!rows.length) rows = raw.split(/\r?\n/).map(line => {
    // Keep commas inside quoted CSV fields (e.g. "因而,所以") intact.
    const parts = []; let field = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
      else if (!quoted && (ch === '\t' || ch === ',' || ch === '，' || ch === ';')) { parts.push(field.trim()); field = ''; }
      else field += ch;
    }
    parts.push(field.trim());
    return { word: parts[0], meanings: parts.slice(1).filter(Boolean) };
  }).filter(row => row.word);
  return rows;
}

function saveVocabImport() {
  const raw = String(document.getElementById('vocabImportText')?.value || '').trim();
  if (!raw) return toastMsg('请粘贴内容或选择文件');
  const rows = parseVocabImportRows(raw);
  const existing = getVocab(); const byWord = new Map(existing.map(x => [x.word.toLowerCase(), x])); let added = 0; let merged = 0; const pendingWords = new Set();
  rows.forEach(row => {
    const word = String(row.word || row.term || row.text || '').trim(); if (!word) return;
    const rawMeanings = row.meanings ?? row.translation ?? row.meaning ?? '';
    const meanings = Array.isArray(rawMeanings) ? rawMeanings.map(String).map(x => x.trim()).filter(Boolean) : String(rawMeanings).split(/\s*\/\s*/).map(x => x.trim()).filter(Boolean);
    const key = word.toLowerCase();
    const prior = byWord.get(key);
    if (prior) {
      const combined = [...(prior.meanings || []), ...meanings].filter(Boolean);
      prior.meanings = [...new Set(combined)]; prior.translation = prior.meanings.join(' / ');
      if (row.context && !prior.context) prior.context = String(row.context);
      if (row.direction === 'word-to-meaning') prior.direction = 'word-to-meaning';
      if (prior.meanings.length) pendingWords.delete(key); else pendingWords.add(key);
      merged++;
      return;
    }
    const item = { word, meanings, translation: meanings.join(' / '), direction: row.direction === 'word-to-meaning' ? 'word-to-meaning' : 'meaning-to-word', context: String(row.context || ''), part: String(row.part || ''), example: String(row.example || ''), added: new Date().toISOString().slice(0, 10), meaningStatus: meanings.length ? 'ready' : 'pending' };
    existing.push(item); byWord.set(key, item); added++; if (!meanings.length) pendingWords.add(key);
  });
  const pending = [...pendingWords].map(key => byWord.get(key)).filter(item => item && !(item.meanings || []).length);
  saveVocab(existing); renderVocab(); document.querySelector('.modal-overlay')?.remove();
  toastMsg(`✅ 已加入 ${added} 条${merged ? `，合并 ${merged} 条` : ''}${pending.length ? `，${pending.length} 条释义将在后台生成` : ''}`);
  pending.forEach(item => generateVocabMeaningAsync(item.word, item.context));
}

function generateVocabMeaningAsync(word, context, index) {
  if (typeof callAPI !== 'function') return;
  Promise.resolve().then(async () => {
    const raw = await callAPI([{ role: 'system', content: 'You are an English-Chinese dictionary. Return ONLY JSON: {"senses":[{"pos":"词性","meaning":"简洁中文释义","example":"short natural English example"}]}. Give 1-5 common senses in dictionary style, preserve distinct meanings, no numbering or combined slash-separated senses.' }, { role: 'user', content: `Word or phrase: ${word}${context ? `\nContext: ${context}` : ''}` }], { maxTokens: 1400, temperature: 0.2 });
    let obj; try { obj = smartParseJSON(String(raw)); } catch (_) { return; }
    const generated = Array.isArray(obj?.senses) ? obj.senses : Array.isArray(obj?.meanings) ? obj.meanings.map(meaning => ({ meaning, pos: obj.part, example: obj.example })) : [];
    const v = getVocab(); const pos = v.findIndex(x => x.word.toLowerCase() === String(word).toLowerCase()); if (pos < 0) return;
    const prior = v[pos].senses || [];
    const senses = generated.map((sense, i) => ({
      id: prior[i]?.id || `sense-${Date.now()}-${i}`, text: String(sense?.meaning || sense?.text || '').trim(),
      pos: String(sense?.pos || '').trim(), example: String(sense?.example || '').trim(),
      focus: prior[i]?.focus === true, unknown: prior[i]?.unknown === true,
      direction: prior[i]?.direction || (v[pos].direction === 'word-to-meaning' ? 'en2zh' : 'zh2en')
    })).filter(sense => sense.text);
    const meanings = senses.map(sense => sense.text);
    if (!meanings.length) return;
    v[pos] = { ...v[pos], senses, meanings, translation: meanings.join(' / '), part: String(obj.part || senses[0]?.pos || v[pos].part || ''), example: String(obj.example || senses[0]?.example || v[pos].example || ''), meaningStatus: 'ready', meaningFormatVersion: 1, needsMeaningStandardization: false };
    saveVocab(v); renderVocab(); toastMsg(`📖 ${word} 的释义已生成`);
  }).catch(e => { dbg('VOCAB_MEANING_BG', e.message); });
}

let vocabStandardizationPending = false;
function standardizeLegacyVocabAsync() {
  if (vocabStandardizationPending || typeof callAPI !== 'function') return;
  const snapshot = getVocab();
  const legacy = snapshot.filter(item => item.needsMeaningStandardization && item.senses?.length).slice(0, 10);
  if (!legacy.length) return;
  vocabStandardizationPending = true;
  let shouldContinue = false;
  Promise.resolve().then(async () => {
    const raw = await callAPI([
      { role: 'system', content: 'You are an English-Chinese dictionary editor. Return JSON only: {"items":[{"word":"...","senses":[{"pos":"词性","meaning":"中文释义","example":"自然英文例句"}]}]}. Preserve every supplied meaning separately, add accurate part of speech and one short natural example per meaning, and return every input word exactly once.' },
      { role: 'user', content: JSON.stringify(legacy.map(item => ({ word: item.word, meanings: item.meanings }))) }
    ], { maxTokens: 4000, temperature: 0.1 });
    const parsed = smartParseJSON(String(raw));
    if (!Array.isArray(parsed?.items) || parsed.items.length !== legacy.length) return;
    const normalized = new Map(parsed.items.map(item => [String(item.word || '').toLowerCase(), item]));
    if (legacy.some(item => !normalized.has(item.word.toLowerCase()) || !Array.isArray(normalized.get(item.word.toLowerCase()).senses))) return;
    const current = getVocab();
    let changed = false;
    current.forEach(item => {
      if (!item.needsMeaningStandardization) return;
      const source = normalized.get(item.word.toLowerCase());
      if (!source) return;
      const senses = source.senses.map((sense, index) => ({
        ...item.senses[index], text: String(sense.meaning || sense.text || item.senses[index]?.text || '').trim(),
        pos: String(sense.pos || '').trim(), example: String(sense.example || '').trim()
      })).filter(sense => sense.text);
      if (senses.length !== item.senses.length) return;
      item.senses = senses; item.meanings = senses.map(sense => sense.text); item.translation = item.meanings.join(' / ');
      item.meaningFormatVersion = 1; item.needsMeaningStandardization = false; changed = true;
    });
    if (changed) {
      saveVocab(current);
      shouldContinue = current.some(item => item.needsMeaningStandardization && item.senses?.length);
      renderVocab();
    }
  }).catch(error => { if (typeof dbg === 'function') dbg('VOCAB_STANDARDIZE_BG', error.message); })
    .finally(() => {
      vocabStandardizationPending = false;
      if (shouldContinue) setTimeout(standardizeLegacyVocabAsync, 0);
    });
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
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px">复习方向：${item.direction === 'word-to-meaning' ? '看英文想中文' : '看中文想英文'}${item.meanings?.length ? ' · ' + item.meanings.length + ' 个释义' : ''}</div>
    <div style="font-size:14px;line-height:1.8;color:var(--text);margin-bottom:14px" class="md-content">${translation ? (item.senses?.length ? item.senses : (item.meanings || [translation]).map(text => ({ text }))).map((sense, i) => '<div style="padding:7px 0;border-bottom:1px solid var(--border)"><b>' + (i + 1) + '.</b> ' + (sense.pos ? '<span class="v-part">' + esc(sense.pos) + '</span> ' : '') + renderMD(sense.text, 'markdown') + (sense.focus ? ' <span class="v-part">重点</span>' : '') + (sense.unknown ? ' <span class="v-part">不会</span>' : '') + '<div style="font-size:11px;color:var(--text2)">复习方向：' + (sense.direction === 'en2zh' ? '看英文想中文' : '看中文想英文') + '</div>' + (sense.example ? '<div style="font-size:12px;color:var(--text2)">' + esc(sense.example) + '</div>' : '') + '</div>').join('') : '<span style="color:var(--text2)">未填写释义，可点击编辑后补充</span>'}</div>
    ${item.context ? `<div style="font-size:12px;color:var(--text2);padding:8px 10px;background:var(--bg);border-radius:8px;margin-bottom:10px"><strong>原文语境:</strong> ${esc(item.context)}</div>` : ''}
    ${item.added ? `<div style="font-size:11px;color:var(--text2);margin-bottom:12px">📅 添加于 ${esc(item.added)}</div>` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button data-action="edit-vocab" data-arg1="${idx}" style="padding:7px 18px;border-radius:8px;border:1px solid var(--border);background:#fff;color:var(--text);font-size:13px;cursor:pointer">编辑</button>
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

