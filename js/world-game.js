/* Dedicated Bellweather launcher. Simulation and UI live in game/src. */
(function () {
  'use strict';
  document.addEventListener('click', function (event) {
    const target = event.target instanceof Element ? event.target.closest('.game-tab[data-game="world"]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = new URL(location.href);
    const version = current.searchParams.get('version') || (current.pathname.startsWith('/english-beta/') ? 'beta' : 'dev');
    if (/^(www\.)?catten\.cyou$/.test(current.hostname)) {
      location.assign('/english?version=' + (version.startsWith('beta') ? 'beta' : 'dev') + '/world-game');
    } else location.assign('/world-game/');
  }, true);

  // A separate resident channel deliberately bypasses normal chat personas,
  // imported worldbooks and essay analysis. The server owns all NPC context.
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const node = (tag, text) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
  const button = (text, action) => { const item = node('button', text); item.type = 'button'; item.className = 'a-btn small'; item.addEventListener('click', action); return item; };
  const controls = node('div'); controls.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border)';
  const label = node('label', '对话对象 ');
  const selector = node('select'); selector.id = 'bellweather-chat-channel'; selector.setAttribute('aria-label', '对话对象');
  const normal = node('option', '普通英语聊天'); normal.value = 'normal';
  const resident = node('option', 'Bellweather 居民'); resident.value = 'resident'; selector.append(normal, resident); label.append(selector);
  controls.append(label, button('进入世界', enterGame)); chat.prepend(controls);
  const panel = node('section'); panel.id = 'bellweather-chat-panel'; panel.hidden = true;
  panel.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:clamp(14px,3vw,26px);background:#17211f;color:#f5ecdd;border-top:1px solid #d9c19766;font-family:Georgia,serif;';
  const title = node('h3', 'Bellweather'); const status = node('p'); status.setAttribute('role', 'status');
  const transcript = node('div'); transcript.setAttribute('aria-live', 'polite'); transcript.style.cssText = 'display:grid;gap:12px;margin:16px 0;white-space:pre-wrap;overflow-wrap:anywhere';
  const form = node('form'); const input = node('textarea'); input.maxLength = 1200; input.rows = 3; input.placeholder = 'Ask the resident in English…'; input.setAttribute('aria-label', '给 Bellweather 居民的消息'); input.style.cssText = 'width:100%;box-sizing:border-box;resize:vertical';
  const send = node('button', '发送'); send.type = 'submit'; send.className = 'send-btn';
  const stop = button('停止', () => active?.abort()); stop.hidden = true;
  form.append(input, send, stop);
  const feedback = node('details'); const feedbackTitle = node('summary', 'English feedback'); const feedbackList = node('div'); feedback.append(feedbackTitle, feedbackList);
  panel.append(title, status, button('刷新进度', () => { transient = false; void refresh(); }), transcript, form, feedback); chat.append(panel);
  let snapshot, active, timer, disposed = false, loading = false, transient = false;
  let generation = 0;
  const normalVisibility = new Map(); let sessionOwner;
  function enterGame() {
    const current = new URL(location.href); const version = current.searchParams.get('version') || '';
    location.assign(/^(www\.)?catten\.cyou$/.test(current.hostname) ? '/english?version=' + (version.startsWith('beta') || current.pathname.startsWith('/english-beta/') ? 'beta' : 'dev') + '/world-game' : '/world-game/');
  }
  function base() {
    if (typeof BACKEND_URL !== 'undefined') return BACKEND_URL || '';
    const url = new URL(location.href), version = url.searchParams.get('version') || '';
    return version.startsWith('beta') || url.pathname.startsWith('/english-beta/') ? '/api-beta' : version.startsWith('dev') || url.pathname.startsWith('/english-dev/') ? '/api-dev' : '';
  }
  function headers() {
    if (typeof authHeaders === 'function') return { 'Content-Type': 'application/json', ...authHeaders() };
    const token = localStorage.getItem('ai_en_token') || sessionStorage.getItem('ai_en_token');
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  }
  function preference() {
    if (typeof llmPreference === 'function') { const pref = llmPreference(); return { provider: pref.provider, model: pref.textModel }; }
    return { provider: typeof getSetting === 'function' ? getSetting('llmProvider', 'aihub8') : 'aihub8', model: typeof getSetting === 'function' ? getSetting('llmTextModel', undefined) : undefined };
  }
  function resetResident() {
    generation++; transient = false; snapshot = undefined; active?.abort(); clearTimeout(timer);
    transcript.replaceChildren(); feedbackList.replaceChildren(); title.textContent = 'Bellweather'; status.textContent = '';
    feedbackTitle.textContent = 'English feedback'; feedback.open = false; input.value = ''; send.disabled = true;
  }
  function suspended() { return chat.style.display === 'none' || (sessionOwner !== undefined && sessionOwner !== (headers().Authorization || '')); }
  async function request(path, body, signal) {
    const requestHeaders = headers();
    const response = await fetch(base() + '/api/world-game/' + path, { method: body ? 'POST' : 'GET', headers: requestHeaders, ...(body ? { body: JSON.stringify(body) } : {}), signal });
    if (requestHeaders.Authorization !== headers().Authorization) { resetResident(); throw new Error('账户已变化，请重新加载居民对话。'); }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const error = new Error(detail.error === 'provider_not_configured' ? 'AI 提供商未配置，请在英语应用设置中添加凭据或选择可用提供商。'
        : response.status === 401 ? '请先登录英语应用。' : response.status === 409 ? '居民或位置已变化，请返回游戏，走近最后交谈的居民。' : '暂时无法连接，请稍后重试。');
      error.status = response.status; throw error;
    }
    return response;
  }
  function line(role, text) { const item = node('p'); const speaker = node('strong', role === 'user' ? 'You: ' : (snapshot?.continuation?.name || 'Resident') + ': '); const body = node('span', text); item.append(speaker, body); transcript.append(item); return body; }
  function renderFeedback(value) {
    const records = value?.records || [], summaries = value?.summaries || [];
    feedbackTitle.textContent = 'English feedback · ' + records.filter(item => item.status === 'ready').length + '/' + records.length;
    feedbackList.replaceChildren();
    for (const report of summaries) {
      const item = node('section'); item.append(node('h4', 'Chapter report · ' + report.stageId), node('p', report.status === 'ready' ? report.text : report.error || 'Preparing your chapter report…')); feedbackList.append(item);
    }
    for (const record of records) {
      const item = node('section'); item.style.cssText = 'border-top:1px solid var(--border);padding:10px 0';
      item.append(node('small', record.npcName), node('blockquote', record.text), node('p', record.status === 'ready' ? record.feedback : record.error || 'Preparing your feedback…'));
      if (record.status === 'failed') item.append(button('重试反馈', async event => {
        event.currentTarget.disabled = true;
        try { renderFeedback(await (await request('feedback/retry', { id: record.id, ...preference() }, AbortSignal.timeout(15000))).json()); }
        catch (error) { status.textContent = error.message; } finally { await refresh(); }
      }));
      feedbackList.append(item);
    }
  }
  async function refresh() {
    if (disposed || selector.value !== 'resident' || loading) return;
    if (chat.style.display === 'none') { resetResident(); return; }
    const owner = headers().Authorization || '';
    if (sessionOwner !== owner) {
      resetResident(); sessionOwner = owner;
    }
    loading = true; const current = generation;
    try {
      const data = await (await request('state', undefined, AbortSignal.timeout(15000))).json();
      if (disposed || current !== generation || owner !== (headers().Authorization || '')) return;
      snapshot = data; title.textContent = data.continuation?.name || 'Bellweather 居民';
      if (!active && !transient) {
        status.textContent = data.continuation?.available ? '正在与游戏中身旁的居民继续对话。英语反馈会保存在下方和游戏内。' : data.continuation?.reason || '请先在游戏里走近一位居民。';
        transcript.replaceChildren(); (data.continuation?.history || []).forEach(message => line(message.role, message.content));
      }
      send.disabled = !!active || !data.continuation?.available;
      renderFeedback(data.feedback);
    } catch (error) { if (current === generation) { status.textContent = error.message; send.disabled = true; } }
    finally { loading = false; clearTimeout(timer); if (!disposed && selector.value === 'resident') timer = setTimeout(() => { void refresh(); }, document.hidden ? 15000 : 5000); }
  }
  selector.addEventListener('change', () => {
    resetResident();
    const enabled = selector.value === 'resident'; panel.hidden = !enabled;
    for (const item of chat.children) {
      if (item === controls || item === panel) continue;
      if (enabled) { if (!normalVisibility.has(item)) normalVisibility.set(item, { hidden: item.hidden, display: item.style.display }); item.hidden = true; item.style.display = 'none'; }
      else if (normalVisibility.has(item)) { const original = normalVisibility.get(item); item.hidden = original.hidden; item.style.display = original.display; normalVisibility.delete(item); }
    }
    if (enabled) void refresh();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (active || !snapshot?.continuation?.available || !input.value.trim()) return;
    if (sessionOwner !== (headers().Authorization || '')) { await refresh(); return; }
    const text = input.value.trim(), stageId = snapshot.stageId, npcId = snapshot.continuation.npcId;
    const controller = new AbortController(); active = controller; transient = true; stop.hidden = false; send.disabled = true; input.disabled = true;
    const timeout = setTimeout(() => controller.abort(), 90000); const current = generation;
    input.value = ''; line('user', text); const output = line('assistant', '…');
    let answer = '', complete = false, invalid = false, buffer = '';
    const consume = event => {
      if (/^event:\s*error\s*$/im.test(event)) invalid = true;
      const data = event.split(/\r?\n/).filter(row => row.startsWith('data:')).map(row => row.slice(5).trimStart()).join('\n').trim();
      if (!data) return; if (data === '[DONE]') { complete = true; return; }
      try { const item = JSON.parse(data), choice = item.choices?.[0]; if (item.error) invalid = true; if (choice?.finish_reason === 'stop') complete = true; else if (choice?.finish_reason) invalid = true; if (typeof choice?.delta?.content === 'string') { answer += choice.delta.content; if (answer.length > 6000) invalid = true; output.textContent = answer.slice(0, 6000); } } catch { invalid = true; }
    };
    try {
      const response = await request('npc', { channel: 'english-chat', stageId, npcId, text, turnId: crypto.randomUUID(), ...preference() }, controller.signal);
      if (!response.body) throw new Error('居民回复为空，请重试。');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      while (true) { const part = await reader.read(); if (current !== generation || suspended()) { resetResident(); const error = new Error('Stopped'); error.name = 'AbortError'; throw error; } buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true }); const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ''; events.forEach(consume); if (buffer.length > 16000) { invalid = true; buffer = ''; } if (part.done) { if (buffer.trim()) consume(buffer); break; } }
      if (!answer.trim() || !complete || invalid) throw new Error('回复中断，未记入线索；可以再次询问。');
      status.textContent = '已记录对话，英语反馈在后台准备。';
    } catch (error) { if (current === generation) { output.textContent = answer ? answer + '\n\n（回复中断，未记入线索）' : error.message; status.textContent = error.name === 'AbortError' ? '已停止。' : error.message; } }
    finally { clearTimeout(timeout); if (active === controller) active = undefined; stop.hidden = true; input.disabled = false; if (current === generation) { try { renderFeedback(await (await request('feedback', undefined, AbortSignal.timeout(15000))).json()); } catch {} await refresh(); } }
  });
  window.addEventListener('focus', () => { void refresh(); });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('[data-action="switch-mode"], [data-action="show-home"], [data-action="logout"]')) resetResident();
  }, true);
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => {
    if (chat.style.display === 'none') resetResident(); else if (selector.value === 'resident') void refresh();
  }) : undefined;
  observer?.observe(chat, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('storage', event => { if (!event.key || ['ai_en_token', 'ai_en_user'].includes(event.key)) { resetResident(); void refresh(); } });
  window.addEventListener('pagehide', () => { disposed = true; resetResident(); observer?.disconnect(); });
})();
