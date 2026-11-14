/* ============================================================
   AI 英语对话教练 — 网页 FSRS 复习适配
   由 js/app.js 拆分而来（native scheduler review integration）。
   ============================================================ */

function nativeSchedulerStorageLabel(health) {
  return health && health.storage_mode === 'sqlite-user-sharded'
    ? 'FAME 分片调度器'
    : '本地调度器';
}

function prefersNativeSchedulerMode() {
  try {
    const preference = localStorage.getItem(NATIVE_SCHEDULER_MODE_KEY);
    const isDevEntry = typeof BACKEND_URL === 'string' && BACKEND_URL === '/api-dev';
    return preference === '1' || (isDevEntry && preference !== '0');
  } catch (_) { return false; }
}

function webReviewSchedulerUnavailableHTML() {
  return '<div style="text-align:center;padding:20px;color:var(--red)"><div style="font-size:18px;font-weight:700;margin-bottom:10px">网页 FSRS 暂时不可用</div><div style="font-size:14px;color:var(--text2)">无法连接网页调度服务。请检查网络后重试；你的 FSRS 选择已保留。</div><button data-action="close-web-review" style="margin-top:16px;padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
}

async function webReviewRestoreNativeSchedulerMode() {
  if (typeof isNativeSchedulerMode !== 'function' || isNativeSchedulerMode() || typeof restoreNativeSchedulerMode !== 'function') return true;
  let restored = false;
  try { restored = await restoreNativeSchedulerMode(); } catch (_) {}
  return restored || typeof prefersNativeSchedulerMode !== 'function' || !prefersNativeSchedulerMode();
}

function webReviewVocabQuiz(word, meaning, example) {
  const key = String(word || '').trim().toLowerCase();
  const vocab = typeof getVocab === 'function' ? getVocab() : [];
  const saved = Array.isArray(vocab) ? vocab.find(item => String(item && item.word || '').trim().toLowerCase() === key) : null;
  const direction = String(saved && saved.direction || '');
  const phase = typeof webReviewVocabPhase === 'function' ? webReviewVocabPhase(word) : 1;
  const type = direction === 'meaning-to-word' || (!direction && phase === 2) ? 'dictation' : 'recall';
  const savedMeanings = saved && Array.isArray(saved.meanings) ? saved.meanings : [];
  const savedMeaning = savedMeanings.length
    ? savedMeanings.join('\n')
    : String(saved && (saved.translation || saved.meaning) || '');
  const resolvedMeaning = String(meaning || '').trim() || savedMeaning.trim();
  const validMeaning = webReviewValidVocabMeaning(resolvedMeaning);
  const invalidReason = !String(word || '').trim()
    ? '这张卡没有英文答案，暂时无法复习。'
    : (!validMeaning ? '这张卡没有中文释义，或释义内容无效；请跳过并在生词本修正后再复习。' : '');
  return { type, word, meaning: resolvedMeaning, example, explanation: '', invalidReason };
}

function webReviewValidVocabMeaning(meaning) {
  const text = String(meaning || '').trim();
  if (!text || !/[\u3400-\u9fff]/.test(text)) return false;
  // Reject prompt residue and generic usage notes that contain Chinese but do not define the word.
  return !/(?:场景通用|无需额外解释|不需要额外解释|仅供参考|根据语境理解|此处无需翻译|请(?:输入|填写|提供)|答案形式|中文释义)/.test(text);
}

function webReviewVocabMeaningBlock(raw, expectedWord, hideAnswer) {
  const p = webReviewParseVocabMeaning(raw, expectedWord);
  if (hideAnswer) {
    const count = String(expectedWord || '').trim().split(/\s+/).filter(Boolean).length || 1;
    const kind = count > 1 ? '词组' : '单词';
    const meanings = p.meanings.filter(m => /[\u3400-\u9fff]/.test(m));
    return `<div class="wr-vocab-meaning wr-vocab-prompt"><div class="wr-vocab-prompt-label">中文释义</div>${meanings.length ? `<ol class="wr-vocab-defs">${meanings.map(m => `<li>${esc(m)}</li>`).join('')}</ol>` : '<div class="wr-vocab-prompt-empty">这张旧卡还没有中文释义，请先在生词本补充</div>'}<div class="wr-vocab-prompt-hint">请输入英文${kind}（${count} 个词）</div></div>`;
  }
  return `<div class="wr-vocab-meaning">${p.phonetic || p.pos ? `<div class="wr-vocab-head">${p.phonetic ? `<span class="wr-vocab-phonetic">${esc(p.phonetic)}</span>` : ''}${p.pos ? `<span class="wr-vocab-pos">${esc(p.pos)}</span>` : ''}</div>` : ''}<ol class="wr-vocab-defs">${p.meanings.map(m => `<li>${esc(m)}</li>`).join('') || '<li>暂无中文释义，请在 Anki 中补充</li>'}</ol>${!hideAnswer && p.inflection ? `<div class="wr-vocab-inflection"><span>词形变化</span>${esc(p.inflection)}</div>` : ''}${!hideAnswer && p.details ? `<details class="wr-vocab-details"><summary>更多词典信息</summary><div>${esc(p.details)}</div></details>` : ''}</div>`;
}

function webReviewSkipInvalid() {
  const st = webReviewState;
  if (!st || !st.native || st.committing || !st.quiz || !st.quiz.invalidReason) return;
  st.invalidSkipped = (st.invalidSkipped || 0) + 1;
  toastMsg('已跳过无效卡片，未提交评分');
  fetchNextWebReviewCard();
}

function webReviewQueueCounts(cards) {
  return (Array.isArray(cards) ? cards : []).reduce((counts, card) => {
    const state = String(card && (card.state_name || card.state) || '').toLowerCase();
    if (state === 'new') counts.new++;
    else if (state === 'learning' || state === 'relearning' || state === 'learn') counts.learn++;
    else if (state === 'review') counts.review++;
    return counts;
  }, { new: 0, learn: 0, review: 0 });
}

function webReviewQueueKind(cardData) {
  if (!cardData) return null;
  const stateName = String(cardData.state_name || cardData.state || '').toLowerCase();
  if (stateName === 'new') return 'new';
  if (stateName === 'learning' || stateName === 'relearning' || stateName === 'learn') return 'learn';
  if (stateName === 'review') return 'review';
  const queue = cardData.queue;
  if (queue === 0) return 'new';
  if (queue === 1 || queue === 3 || queue === 4) return 'learn';
  if (queue === 2) return 'review';
  if (queue !== undefined && queue !== null) return null;
  return ({ 0: 'new', 1: 'learn', 2: 'review', 3: 'learn' })[cardData.type] || null;
}

function webReviewNativeCardData(card) {
  if (!card || typeof card !== 'object') return null;
  return {
    ...card,
    cardId: card.cardId || card.card_id || card.id,
    modelName: card.modelName || card.model_name || card.model || '',
    deckName: card.deckName || card.deck_name || card.deck || '',
    fields: card.fields || {}
  };
}

function webReviewNativeEventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'review-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

async function webReviewCommitNative(rating) {
  const st = webReviewState;
  if (!st || st.committing || !st.native || st.nativeReviewed[st.cardId]) return;
  const card = st.nativeCards[st.nativeIndex];
  if (!card || (!card.id && !card.cardId)) {
    toastMsg('这张卡缺少调度器 ID，无法提交评分');
    return;
  }
  const cardId = card.id || card.cardId;
  st.committing = true;
  const labels = { 1: '重来', 2: '困难', 3: '良好', 4: '简单' };
  try {
    let pending = st.nativePendingEvent;
    if (!pending || pending.cardId !== cardId || pending.rating !== rating) {
      pending = st.nativePendingEvent = { cardId, rating, eventId: webReviewNativeEventId() };
    }
    const payload = { rating, event_id: pending.eventId };
    const version = card.expected_version ?? card.version ?? card.card_version;
    if (version !== undefined && version !== null) payload.expected_version = version;
    await nativeSchedulerAnswer(cardId, payload);
    st.nativeReviewed[cardId] = { rating, label: labels[rating] || '已记录' };
    if (st.judgedCorrect === true || (st.selfGraded && rating >= 3)) st.correct++;
    if (st.queueStats) {
      const kind = webReviewQueueKind(card) || (String(card.state_name || card.state || '').toLowerCase() === 'new' ? 'new' : 'review');
      st.queueStats[kind] = Math.max(0, (st.queueStats[kind] || 0) - 1);
    }
    if (st.quiz && st.quiz.type === 'recall') {
      const promoted = webReviewVocabRecord(st.quiz.word, rating);
      if (promoted) toastMsg('🎯 「' + st.quiz.word + '」已熟练，以后改为看中文默写英文');
    }
    st.nativePendingEvent = null;
    st.committing = false;
    fetchNextWebReviewCard();
  } catch (e) {
    st.committing = false;
    dbg('NATIVE_SCHEDULER_ANSWER', e.message);
    const modal = document.getElementById('ankiReviewModal');
    const res = modal && modal.querySelector('#wrResult');
    if (res) {
      res.innerHTML = `<div style="padding:12px;border:1px solid #ef4444;border-radius:8px;color:var(--red)">评分未提交：${esc(e.message || e)} <button id="wrRetryNative" style="margin-left:8px">重试</button></div>`;
      res.querySelector('#wrRetryNative').addEventListener('click', () => webReviewCommitNative(rating));
    } else if (modal) {
      modal.insertAdjacentHTML('beforeend', '<div id="wrResult" style="color:var(--red);padding:8px">评分未提交：' + esc(e.message || e) + '</div>');
    }
  }
}
