/* ============================================================
   AI 英语对话教练 — 网页答题复习
   由 js/app.js 拆分而来（新增切片，内容为全新代码；
   网页复习流程原在 06-anki.js，因单切片 1000 行上限迁出）。

   通过 AnkiConnect GUI 动作驱动 Anki 复习队列与 FSRS 排程。
   复习的是整个用户牌组（英语学习::<用户>），因此同时覆盖：
   - 薄弱点问答题（选择 / 多空填空 / 改错）
   - 生词卡，两个阶段：
       阶段 1「看英文想中文」：自我回想后翻中文，自评；连续达标后
       阶段 2「看中文默写英文」：输入英文单词判分（暂停阶段 1）。
   答题/回想后不再自动跳下一张：展示结果与四档评分（重来/困难/良好/
   简单），默认「错误→重来、正确→良好」。Enter/→ 或「下一题」按默认
   评分推进，点击具体评分按钮按该档评分推进，← 撤销上一题回上一张。
   依赖的全局函数均为跨切片顶层声明（06-anki.js / 21-anki-tasks.js 等）。
   ============================================================ */

// ---- 网页答题复习（通过 AnkiConnect GUI 驱动 Anki FSRS 排程） ----
let webReviewState = null;
// 生词阶段：阶段 1 看英文想中文，连续 N 次「良好/简单」后升入阶段 2 默写
const VOCAB_REC_STREAK = 3;

function startWebReview() {
  removeAllModals();
  if (webReviewState && webReviewState.keyHandler) document.removeEventListener('keydown', webReviewState.keyHandler);
  webReviewState = { cardId: null, total: 0, current: 0, correct: 0, queueStats: null, currentQueue: null, history: [] };
  const session = webReviewState;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Anki 网页复习');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.id = 'ankiReviewModal';
  modal.className = 'wr-modal';
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
      if (webReviewState !== session) return;
      if (!ver || !ver.ok || !ver.result || !ver.result.result) {
        modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--orange)">⚠️ Anki 未运行或 AnkiConnect 未连接<br><br>请先打开 Anki（可最小化），然后重新点击「✅ 复习」<br><br><button data-action="close-overlay" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
        return;
      }
      await ensureQuizModelAndDeck();
      if (webReviewState !== session) return;
      // 复习整个用户牌组（薄弱点 + 词汇 + 其他子牌组一起复习）
      const result = await ankiPostCall({ action: 'guiDeckReview', version: 6, params: { name: ankiBaseDeck() } });
      // guiDeckReview 返回 true/false
      if (!result || !result.ok || !result.result || !result.result.result) {
        // 可能没有可复习卡片。注意：is:due 只匹配到期/学习中卡片，
        // 不匹配「新卡」——刚补题推送的卡全是新卡，必须把 is:new/is:learn 也算上。
        // deck:父牌组 会匹配其所有子牌组（薄弱点、词汇…）。
        const cardIds = await ankiPostCall({ action: 'findCards', version: 6, params: { query: 'deck:' + ankiBaseDeck() + ' (is:due OR is:new OR is:learn)' } });
        const studyable = (cardIds && cardIds.result && cardIds.result.result) ? cardIds.result.result.length : 0;
        if (studyable === 0) {
          modal.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:12px">🎉</div><div style="font-size:18px;font-weight:700;margin-bottom:8px">没有待复习卡片</div><div style="font-size:14px;color:var(--text2);margin-bottom:4px">继续对话，新的薄弱点与生词会自动生成卡片</div><button data-action="close-overlay" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button></div>';
        } else {
          modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--orange)">⚠️ 无法启动复习会话（有 ' + studyable + ' 张可复习卡片，但 Anki 拒绝启动）<br>请确保 Anki 窗口已打开，然后重试<br><br><button data-action="close-overlay" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
        }
        return;
      }
      // AnkiConnect updates guiCurrentCard immediately after guiDeckReview;
      // avoid the old half-second artificial delay that made each review feel laggy.
      await new Promise(r => setTimeout(r, 80));
      if (webReviewState === session) fetchNextWebReviewCard();
    } catch (e) {
      modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">❌ 启动复习失败：' + esc(e.message || e) + '<br><br>请确认 Anki 已运行且 AnkiConnect 插件已安装（默认端口 8765）<br><br><button data-action="close-overlay" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
    }
  }, 300);
  overlay.onclick = function(e) { if (e.target === overlay) { closeWebReview(); } };
}

function webReviewDeckMatches(cardData) {
  const deck = String(cardData && cardData.deckName || '');
  const base = ankiBaseDeck();
  const decks = [base, base + '::薄弱点', base + '::词汇', base + '::纠错', base + '::拓展'];
  return deck === base || deck.startsWith(base + '::');
}

function webReviewQueueKind(cardData) {
  if (!cardData) return null;
  const queue = cardData.queue;
  if (queue === 0) return 'new';
  if (queue === 1 || queue === 3 || queue === 4) return 'learn';
  if (queue === 2) return 'review';
  if (queue !== undefined && queue !== null) return null;
  return ({ 0: 'new', 1: 'learn', 2: 'review', 3: 'learn' })[cardData.type] || null;
}

async function webReviewRefreshQueueStats(cardData) {
  const st = webReviewState;
  if (!st) return;
  const request = (st.statsRequest || 0) + 1;
  st.statsRequest = request;
  const base = ankiBaseDeck();
  st.queueStats = null;
  st.currentQueue = webReviewQueueKind(cardData);
  try {
    // Deck statistics respect Anki's daily limits; raw is:new counts do not.
    const statsResult = await ankiPostCall({ action: 'getDeckStats', version: 6, params: { decks: [base] } });
    if (webReviewState !== st || st.statsRequest !== request) return;
    const rows = Object.values(statsResult && statsResult.result && statsResult.result.result || {});
    if (!rows.length || rows.some(row => !['new_count', 'learn_count', 'review_count'].every(k => Number.isFinite(row[k]) && row[k] >= 0))) {
      throw new Error('Anki queue counts unavailable');
    }
    st.queueStats = rows.reduce((sum, row) => ({
      new: sum.new + row.new_count,
      learn: sum.learn + row.learn_count,
      review: sum.review + row.review_count
    }), { new: 0, learn: 0, review: 0 });
    // guiCurrentCard normally includes queue/type. Avoid a second cardsInfo
    // request on every card; only fall back when older Anki versions omit it.
    let current = cardData;
    if (cardData && webReviewQueueKind(cardData) === null) {
      const infoResult = await ankiPostCall({ action: 'cardsInfo', version: 6, params: { cards: [cardData.cardId] } });
      const cards = infoResult && infoResult.result && infoResult.result.result;
      current = Array.isArray(cards) && cards.find(card => card.cardId === cardData.cardId) || cardData;
    }
    st.currentQueue = cardData ? webReviewQueueKind(current || cardData) : null;
  } catch (e) {
    dbg('ANKI_QUEUE_STATS', e.message);
  }
}

function webReviewQueueHeader(typeLabel) {
  const stats = webReviewState.queueStats;
  const current = webReviewState.currentQueue;
  const item = (kind, label) => `<span class="wr-queue-count wr-queue-${kind}${current === kind ? ' is-current' : ''}"${current === kind ? ' aria-current="true"' : ''} title="${label}${current === kind ? ' · 当前卡片' : ''}"><b>${stats ? stats[kind] : '—'}</b><small>${label}</small></span>`;
  return `<div class="wr-review-head">
    <div class="wr-review-head-main">
      <div class="wr-queue-strip" aria-label="Anki 今日队列；待重来包含学习中和重新学习的卡片">
        ${item('new', '待新学')}${item('learn', '待重来')}${item('review', '待复习')}
      </div>
      <span class="wr-review-type">📝 ${esc(typeLabel)}</span>
    </div>
    <span class="wr-review-score" id="wrScore">答对 ${webReviewState.correct} 次</span>
  </div>`;
}

function showWebReviewDeckMismatch(cardData) {
  const modal = document.getElementById('ankiReviewModal');
  if (!modal) return;
  const actual = String(cardData && cardData.deckName || '未知牌组');
  modal.innerHTML = `<div style="text-align:center;padding:20px">
    <div style="font-size:40px;margin-bottom:12px">⚠️</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:10px">Anki 当前正在复习其他账户的牌组</div>
    <div style="font-size:13px;color:var(--text2);line-height:1.8;text-align:left">
      当前网页账户：<b>${esc(currentUser() || '未知')}</b><br>
      网页目标牌组：<b>${esc(ankiBaseDeck())}</b><br>
      Anki 当前牌组：<b>${esc(actual)}</b><br><br>
      请先在 Anki 中退出当前复习窗口，再重新点击网页复习。这样可以避免把其他账户的卡混入本次复习。
    </div>
    <button data-action="close-overlay" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button>
  </div>`;
}

function fetchNextWebReviewCard() {
  const st = webReviewState;
  if (!st) return;
  (async () => {
    try {
      const card = await ankiPostCall({ action: 'guiCurrentCard', version: 6 });
      if (webReviewState !== st) return;
      const cardData = card && card.result && card.result.result;
      if (!cardData) {
        // 没有更多卡片 — 检查是否 Anki 已退出复习模式
        const total = webReviewState.current;
        if (total > 0) {
          finishWebReview();
        } else {
          // 没有卡片可复习：很可能薄弱点题目从未成功推送（anki_notes 全空），
          // 提供「立即补题」而不是干巴巴的空状态——补题走任务队列，成功后自动开考
          showWebReviewEmptyWithCatchUp();
        }
        return;
      }
      if (!webReviewDeckMatches(cardData)) {
        showWebReviewDeckMismatch(cardData);
        return;
      }
      webReviewState.cardId = cardData.cardId;
      webReviewState.current++;
      webReviewState.total = Math.max(webReviewState.total, webReviewState.current);
      await webReviewRefreshQueueStats(cardData);
      if (webReviewState !== st) return;
      showWebReviewQuestion(cardData);
    } catch (e) {
      const modal = document.getElementById('ankiReviewModal');
      if (modal) {
        modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">❌ 读取卡片失败：' + esc(e.message || e) + '<br><br><button data-action="close-web-review" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
      }
    }
  })();
}

/* 空牌组的「补题」引导：
   统计需要出题的薄弱点数量，一键入队补题，队列跑完后自动重新进入复习。 */
function showWebReviewEmptyWithCatchUp() {
  const modal = document.getElementById('ankiReviewModal');
  if (!modal) return;
  const perWp = parseInt(getSetting('ankiQuizPerWp', 2)) || 2;
  const needs = Object.values(getWeak()).filter(w => w && !w.archived && (w.anki_notes || []).length < perWp);
  const hasQueueSupport = typeof enqueueAnkiTask === 'function';

  if (!needs.length || !hasQueueSupport) {
    // 真的没有可补的题（全部掌握/归档，或旧版本无队列）
    modal.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:12px">🎉</div><div style="font-size:18px;font-weight:700;margin-bottom:8px">没有待复习卡片</div><div style="font-size:14px;color:var(--text2);margin-bottom:4px">继续对话，新的薄弱点与生词会自动生成卡片</div><button data-action="close-overlay" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button></div>';
    return;
  }

  modal.innerHTML = `<div style="text-align:center;padding:20px">
    <div style="font-size:40px;margin-bottom:12px">📭</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:8px">薄弱点牌组没有待复习卡片</div>
    <div style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:6px">
      你有 <b style="color:var(--text)">${needs.length}</b> 个薄弱点还没有题目卡
      （每薄弱点 ${perWp} 道，预计生成约 ${Math.min(12, needs.length) * Math.ceil(perWp / 2)}+ 道题）。<br>
      可能是之前出题时 Anki 没开或 AI 调用失败，题目没有推送成功。
    </div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px">补题会调用 AI 生成（约需几十秒），完成后自动开始复习。</div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button data-action="web-review-catchup" style="padding:9px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">⚡ 立即补题并复习</button>
      <button data-action="close-overlay" style="padding:9px 20px;border-radius:8px;border:1px solid var(--border);background:#fff;color:var(--text);font-size:14px;cursor:pointer">以后再说</button>
    </div>
  </div>`;
}

/* 补题执行：入队 quiz 任务 → 跑队列 → 全部完成后自动重启复习会话 */
async function webReviewCatchUp() {
  const modal = document.getElementById('ankiReviewModal');
  if (!modal) return;
  const perWp = parseInt(getSetting('ankiQuizPerWp', 2)) || 2;
  const needs = Object.values(getWeak()).filter(w => w && !w.archived && (w.anki_notes || []).length < perWp);
  if (!needs.length) { fetchNextWebReviewCard(); return; }

  modal.innerHTML = `<div style="text-align:center;padding:24px">
    <div style="font-size:16px;font-weight:700;margin-bottom:10px">🤖 正在为 ${needs.length} 个薄弱点生成题目…</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">AI 出题中，请稍候（每轮最多 6 个薄弱点，可能需要多轮调用）</div>
    <div class="spinner" style="width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto"></div>
  </div>`;

  try {
    // 分批入队（与 autoGenerateQuizQuestions 单次上限一致）
    for (let i = 0; i < needs.length; i += 12) {
      const chunk = needs.slice(i, i + 12);
      enqueueAnkiTask('quiz', { weakPointIds: chunk.map(w => w.id).filter(Boolean) }, '复习补题：' + chunk.length + ' 个薄弱点');
    }
    const r = await processAnkiQueue({ manual: true, includeFailed: true });
    const tasks = getAnkiTasks();
    const justDone = tasks.filter(t => t.status === 'done' && (t.label || '').startsWith('复习补题')).length;
    const failed = tasks.filter(t => (t.status === 'failed' || t.status === 'dead') && (t.label || '').startsWith('复习补题')).length;

    if (failed && !justDone) {
      modal.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red)">
        <div style="font-size:34px;margin-bottom:10px">😔</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">补题失败（AI 或 Anki 出错）</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:14px">任务已留在队列里，可在「学习中心 → 复习与 Anki」的任务中心重试</div>
        <button data-action="close-overlay" style="padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button>
      </div>`;
      return;
    }

    // 成功（或部分成功）：重启复习会话拉新卡
    const okMsg = justDone ? `已生成 ${justDone} 批题目` : '题目已就绪';
    modal.innerHTML = `<div style="text-align:center;padding:24px">
      <div style="font-size:16px;font-weight:700;margin-bottom:8px">✅ ${okMsg}${failed ? `，${failed} 批失败（可稍后重试）` : ''}</div>
      <div style="font-size:12px;color:var(--text2)">正在进入复习…</div>
    </div>`;
    setTimeout(() => {
      // 重开复习会话（guiDeckReview 需要 Anki 处于非复习态；先关掉当前 overlay）
      closeWebReview();
      setTimeout(() => startWebReview(), 400);
    }, 800);
  } catch (e) {
    modal.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red)">❌ 补题出错：${esc(e.message || e)}<br><br><button data-action="close-overlay" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>`;
  }
}

/* ==================== 卡片解析 ==================== */
function webReviewFieldRaw(cardData, name) {
  const f = cardData && cardData.fields && cardData.fields[name];
  return String((f && (f.value !== undefined ? f.value : f)) || '');
}

function webReviewTextFromHTML(raw) {
  const d = document.createElement('div');
  d.innerHTML = String(raw || '');
  d.querySelectorAll('script, style, template').forEach(el => el.remove());
  d.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  d.querySelectorAll('div, p, li, ul, ol, h1, h2, h3, h4, blockquote').forEach(el => {
    el.prepend('\n'); el.append('\n');
  });
  return (d.textContent || '').replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').trim();
}

function webReviewFieldText(cardData, name) {
  return webReviewTextFromHTML(webReviewFieldRaw(cardData, name));
}

function webReviewStripHTML(raw) {
  return String(raw || '')
    .replace(/<br\s*\/?>(?:\n)?/gi, '\n')
    .replace(/<\/(?:div|p|li|ul|ol|h[1-4]|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function webReviewStructuredQuiz(raw) {
  const html = String(raw || '');
  const optionBlocks = [...html.matchAll(/<div[^>]*class="[^"]*\bquiz-option\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => m[1]);
  if (optionBlocks.length !== 4) return null;
  const options = optionBlocks.map((body, index) => {
    const letter = body.match(/<span[^>]*class="[^"]*\bletter\b[^"]*"[^>]*>\s*([A-D])\s*<\/span>/i);
    const textHTML = body.replace(/<span[^>]*class="[^"]*\bletter\b[^"]*"[^>]*>[\s\S]*?<\/span>/i, '');
    return { letter: letter ? letter[1] : 'ABCD'[index], text: webReviewStripHTML(textHTML).replace(/\s+/g, ' ').trim() };
  });
  if (options.map(o => o.letter).join('') !== 'ABCD' || options.some(o => !o.text)) return null;
  const stemMatch = html.match(/<div[^>]*class="[^"]*\bquiz-stem\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  return { stem: stemMatch ? webReviewStripHTML(stemMatch[1]).replace(/\s+/g, ' ').trim() : '', options };
}

function webReviewVocabPhaseMap() {
  const m = getSetting('ankiVocabPhase', null);
  return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
}
function webReviewVocabPhase(word) {
  const key = String(word || '').trim().toLowerCase();
  const rec = webReviewVocabPhaseMap()[key];
  return rec && rec.p === 2 ? 2 : 1;
}

function webReviewParseVocabMeaning(raw, expectedWord) {
  let text = String(raw || '').replace(/\r/g, '').trim();
  let word = '', phonetic = '', pos = '', inflection = '';
  const expected = String(expectedWord || '').trim();
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = expected ? text.match(new RegExp('^' + escaped + '(?=\\s|/|$)', 'i')) : text.match(/^([a-z][a-z '\u2019-]*?)(?=\s*\/[^/\n]+\/)/i);
  if (head) { word = expected || head[0].trim(); text = text.slice(head[0].length).trim(); }
  const ipa = text.match(/^\/([^/\n]+)\/\s*/);
  if (ipa) { phonetic = '/' + ipa[1] + '/'; text = text.slice(ipa[0].length).trim(); }
  const part = text.match(/^(?:(?:adj|adv|vt|vi|n|v|prep|pron|conj|interj|det|phrase)\.(?:\s*\/\s*)?)+|^(?:形容词|副词|名词|动词|介词|短语)(?:\s*[\/、]\s*(?:形容词|副词|名词|动词|介词|短语))*/i);
  if (part) { pos = part[0].trim(); text = text.slice(part[0].length).trim(); }
  const forms = text.match(/^变形\s*[:：]\s*([^•\n]*)/);
  if (forms) { inflection = forms[1].trim(); text = text.slice(forms[0].length).trim(); }
  const section = text.search(/(?:^|\n)(?:例句|常见搭配|相关搭配|同义词辨析|近义表达|📜\s*词源|词源)\s*[:：]?/);
  const details = section >= 0 ? text.slice(section).trim() : '';
  const definitions = section >= 0 ? text.slice(0, section) : text;
  const meanings = definitions.split(/\s*[•\n]\s*/).map(s => s.trim()).filter(Boolean);
  return { word, phonetic, pos, inflection, meanings, details };
}

function webReviewVocabMeaningBlock(raw, expectedWord, hideAnswer) {
  const p = webReviewParseVocabMeaning(raw, expectedWord);
  if (hideAnswer) {
    const count = String(expectedWord || '').trim().split(/\s+/).filter(Boolean).length || 1;
    const kind = count > 1 ? '词组' : '单词';
    const hasMeaning = p.meanings.some(m => /[\u3400-\u9fff]/.test(m));
    return `<div class="wr-vocab-meaning wr-vocab-prompt"><div class="wr-vocab-prompt-label">中文释义</div>${hasMeaning ? '' : '<div class="wr-vocab-prompt-empty">这张旧卡还没有中文释义，请先在生词本补充</div>'}<div class="wr-vocab-prompt-hint">请输入英文${kind}（${count} 个词）</div></div>`;
  }
  return `<div class="wr-vocab-meaning">
    ${p.phonetic || p.pos ? `<div class="wr-vocab-head">${p.phonetic ? `<span class="wr-vocab-phonetic">${esc(p.phonetic)}</span>` : ''}${p.pos ? `<span class="wr-vocab-pos">${esc(p.pos)}</span>` : ''}</div>` : ''}
    <ol class="wr-vocab-defs">${p.meanings.map(m => `<li>${esc(m)}</li>`).join('') || '<li>暂无中文释义，请在 Anki 中补充</li>'}</ol>
    ${!hideAnswer && p.inflection ? `<div class="wr-vocab-inflection"><span>词形变化</span>${esc(p.inflection)}</div>` : ''}
    ${!hideAnswer && p.details ? `<details class="wr-vocab-details"><summary>更多词典信息</summary><div>${esc(p.details)}</div></details>` : ''}
  </div>`;
}
// 生词复习评分后更新阶段；返回是否升入阶段 2
function webReviewVocabRecord(word, ease) {
  const key = String(word || '').trim().toLowerCase();
  if (!key) return false;
  const map = webReviewVocabPhaseMap();
  const cur = map[key] || { s: 0, p: 1 };
  if (cur.p === 2) return false; // 阶段 2 保持
  if (ease >= 3) { cur.s = (cur.s || 0) + 1; } else { cur.s = 0; }
  let promoted = false;
  if (cur.s >= VOCAB_REC_STREAK) { cur.p = 2; promoted = true; }
  map[key] = cur;
  setSetting('ankiVocabPhase', map);
  return promoted;
}

function webReviewQuizType(cardData) {
  // 生词卡：词汇模型或词汇牌组（Front=中文释义，Back=英文单词+例句）；
  // 拓展/纠错卡是英语学习-基础卡模型（Front/Back），按问答题处理，不能靠 Front/Back 字段猜生词
  const model = cardData.modelName || '';
  const deck = cardData.deckName || '';
  const isVocab = model === '英语学习-词汇' || /::词汇\s*$/.test(deck);
  // 非生词卡：薄弱点模型用 Question/Answer，基础卡（拓展/纠错）用 Front/Back
  const qRaw = webReviewFieldRaw(cardData, 'Question');
  const answerRaw = webReviewFieldRaw(cardData, 'Answer') || webReviewFieldRaw(cardData, 'Back');
  const explanationRaw = webReviewFieldRaw(cardData, 'Explanation');
  const structuredMc = webReviewStructuredQuiz(qRaw);
  const qText = structuredMc ? '' : (webReviewTextFromHTML(qRaw) || String(qRaw || '').replace(/<[^>]*>/g, ' ') || webReviewFieldText(cardData, 'Front'));
  let aText = '';
  let exp = '';
  if (isVocab) {
    let frontRaw = webReviewFieldRaw(cardData, 'Front');
    let backRaw = webReviewFieldText(cardData, 'Back').replace(/\[sound:[^\]]*\]/g, '').trim();
    // Some legacy notes were saved with Front/Back reversed. Mixed prompts
    // such as “英文词组（2个词）” still contain Chinese, so pure-English
    // detection alone misses them.
    if ((webReviewLooksEnglishAnswer(frontRaw) || webReviewHasEnglishHeadword(frontRaw)) && webReviewLooksChinese(backRaw)) {
      const oldFront = frontRaw;
      frontRaw = backRaw;
      backRaw = webReviewTextFromHTML(oldFront).replace(/\[sound:[^\]]*\]/g, '').trim();
    }
    const meaning = webReviewVocabMeaningText(frontRaw).trim();
    const word = webReviewVocabAnswer(backRaw, frontRaw);
    const parts = backRaw.split('\n').map(s => s.trim()).filter(Boolean);
    const answerLine = parts.findIndex(line => webReviewVocabAnswerLine(line, frontRaw));
    if (answerLine >= 0) parts.splice(answerLine, 1);
    const example = parts.join('\n').trim();
    const phase = webReviewVocabPhase(word);
    if (phase === 2) {
      return { type: 'dictation', word, meaning, example, explanation: '' };
    }
    return { type: 'recall', word, meaning, example, explanation: '' };
  }
  aText = webReviewTextFromHTML(answerRaw).trim();
  exp = webReviewTextFromHTML(explanationRaw).replace(/[。.！!？?]?\s*(?:测试点|测试點)\s*[:：][\s\S]*$/, '').trim();
  if (structuredMc) {
    return { type: 'mc', stem: structuredMc.stem, options: structuredMc.options, answer: webReviewAnswerLetter(aText), answerRaw: aText, explanation: exp };
  }
  const lines = qText.split('\n').map(s => s.trim()).filter(Boolean);
  const optRe = /^([A-D])[\.、\)]\s*(.+)$/;
  const opts = [];
  let optStart = -1;
  lines.forEach((ln, i) => {
    const m = ln.match(optRe);
    if (m) { if (optStart < 0) optStart = i; opts.push({ letter: m[1], text: m[2].trim() }); }
  });
  if (opts.length === 4 && opts.map(o => o.letter).join('') === 'ABCD') {
    const stem = lines.slice(0, optStart).join(' ').trim();
    return { type: 'mc', stem, options: opts, answer: webReviewAnswerLetter(aText), answerRaw: aText, explanation: exp };
  }
  const hasBlank = /_{2,}/.test(webReviewStripHTML(qRaw));
  const hasRootHint = /[（(]\s*[a-z][a-z' -]{1,40}\s*[）)]/i.test(answerRaw + '\n' + explanationRaw);
  if ((hasBlank || hasRootHint) && answerRaw) {
    // 语法填空必须把给出的词根/中文提示留在题干中；旧卡常把它只写在
    // Answer 或 Explanation，兼容这些格式并在正面展示，避免用户无从作答。
    let stem = qText.trim();
    const rootMatch = (answerRaw + '\n' + explanationRaw).match(/[（(]\s*([a-z][a-z' -]{1,40})\s*[）)]/i);
    if (rootMatch && !/[（(]\s*[a-z][a-z' -]{1,40}\s*[）)]/i.test(stem)) {
      const pos = stem.indexOf('___');
      if (pos >= 0) stem = stem.slice(0, pos) + '___ (' + rootMatch[1].trim() + ')' + stem.slice(pos + 3);
    }
    if (!rootMatch && !/[\u3400-\u9fff]/.test(stem)) {
      const cue = webReviewTextFromHTML(explanationRaw).match(/[\u3400-\u9fff][^\n。！？!?]{0,70}/);
      if (cue) stem += `（提示：${cue[0].trim()}）`;
    }
    return { type: 'fill', stem, answer: aText.replace(/^[A-D][\.、\)]?\s*/, '').trim(), explanation: exp };
  }
  return { type: 'manual', stem: qText.trim(), answer: aText, explanation: exp, answerHtml: (cardData && cardData.answer) || '' };
}

function webReviewVocabMeaningText(raw) {
  const text = webReviewTextFromHTML(raw);
  return text.replace(/(?:^|\n)\s*答案形式\s*[:：].*$/gim, '').trim();
}

function webReviewLooksChinese(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''));
}

function webReviewLooksEnglishAnswer(text) {
  const value = String(text || '').replace(/\[sound:[^\]]*\]/gi, '').trim();
  return /[A-Za-z]/.test(value) && !webReviewLooksChinese(value);
}

function webReviewHasEnglishHeadword(text) {
  const value = webReviewTextFromHTML(text).replace(/[\uFF08(][^\uFF09)]*[\uFF09)]/g, '').trim();
  return /(?:^|\n)\s*[A-Za-z][A-Za-z' -]{1,48}(?:\s|$)/m.test(value);
}

// 词汇卡的 Front 永远是题面，Back 永远是答案。旧卡有时把答案形式、
// HTML 或例句放在首行，因此不能再用 Back 的第一行盲猜，否则网页复习会
// 把中文卡误判成英文答案，或者把答案泄露到题面。
function webReviewVocabAnswerLine(line, frontRaw) {
  const value = String(line || '').replace(/\[sound:[^\]]*\]/gi, '').trim();
  if (!value || /^答案形式\s*[:：]/i.test(value) || /^\(?\d+\s*个(?:单词|词)\)?$/i.test(value)) return false;
  const hint = webReviewTextFromHTML(frontRaw).match(/答案形式\s*[:：].*$/im);
  if (hint && value === hint[0].trim()) return false;
  return /[A-Za-z]/.test(value) && !/[\u3400-\u9fff]/.test(value);
}

function webReviewVocabAnswer(backText, frontRaw) {
  const lines = String(backText || '').split('\n').map(s => s.trim()).filter(Boolean);
  const candidate = lines.find(line => webReviewVocabAnswerLine(line, frontRaw));
  if (candidate) return candidate.replace(/^(?:答案|answer)\s*[:：]\s*/i, '').trim();
  // Last-resort legacy format: take the first token only when it is clearly an
  // English headword. Never fall back to Chinese/front content.
  return lines.find(line => /^[A-Za-z][A-Za-z' -]*$/.test(line)) || '';
}

/* ==================== 键盘操作 ==================== */
function webReviewKeyHandler(ev) {
  const st = webReviewState;
  if (!st) return;
  const quiz = st.quiz;
  if (!quiz) return;
  const k = ev.key;
  if (st.stage === 'question') {
    if (k === 'ArrowLeft') { // 题目阶段也可撤销上一张的评分
      ev.preventDefault(); webReviewPrev(); return;
    }
    if (quiz.type === 'mc') {
      const low = k.toLowerCase();
      let letter = null;
      if (k >= '1' && k <= '4') letter = 'ABCD'[Number(k) - 1];
      else if (low >= 'a' && low <= 'd') letter = low.toUpperCase();
      if (letter) { ev.preventDefault(); webReviewChoose(letter); }
    } else if (quiz.type === 'recall' || quiz.type === 'manual') {
      if (k === 'Enter' || k === ' ') { ev.preventDefault(); webReviewReveal(); }
    }
    // fill / dictation：输入框内的 Enter 由输入框自身处理
  } else if (st.stage === 'graded') {
    if (k === 'ArrowRight' || k === 'Enter') { ev.preventDefault(); webReviewNext(); }
    else if (k === 'ArrowLeft') { ev.preventDefault(); webReviewPrev(); }
    else if (k >= '1' && k <= '4') { ev.preventDefault(); webReviewCommit(Number(k)); }
  }
}

function webReviewBindKeys() {
  if (webReviewState.keyHandler) document.removeEventListener('keydown', webReviewState.keyHandler);
  webReviewState.keyHandler = webReviewKeyHandler;
  document.addEventListener('keydown', webReviewState.keyHandler);
}

/* ==================== 题目渲染 ==================== */
function showWebReviewQuestion(cardData) {
  const modal = document.getElementById('ankiReviewModal');
  if (!modal) return;
  const quiz = webReviewQuizType(cardData);
  webReviewState.quiz = quiz;
  webReviewState.stage = 'question';
  webReviewState.locked = false;
  webReviewState.judgedCorrect = null;
  webReviewState.committing = false; // 上一张评分提交已结束，允许再次提交
  webReviewState.selfGraded = (quiz.type === 'recall' || quiz.type === 'manual');
  webReviewBindKeys();

  const typeLabel = { mc: '选择题', fill: '填空题', manual: '问答题', recall: '生词 · 看英文想中文', dictation: '生词 · 看中文默写英文' }[quiz.type] || '';
  const head = webReviewQueueHeader(typeLabel);

  if (quiz.type === 'mc') {
    const btns = quiz.options.map(o =>
      `<button class="wr-option" data-wr-opt="${o.letter}">
        <b>${o.letter}</b><span>${esc(o.text)}</span>
      </button>`).join('');
    modal.innerHTML = head +
      `<div id="wrStem" class="wr-stem">${esc(quiz.stem)}</div>` +
      `<div id="wrOptions" class="wr-options">${btns}</div>` +
      `<div id="wrResult"></div>` +
      webReviewFooter('点击选项，或按 1-4 / A-D');
    modal.querySelectorAll('[data-wr-opt]').forEach(b => b.addEventListener('click', () => webReviewChoose(b.getAttribute('data-wr-opt'))));
  } else if (quiz.type === 'fill') {
    modal.innerHTML = head + webReviewFillBody(quiz) + `<div id="wrResult"></div>` + webReviewFooter('填空后回车或点「提交」');
    webReviewBindFillSubmit(modal);
  } else if (quiz.type === 'recall') {
    modal.innerHTML = head +
      `<div class="wr-vocab-card">
        <div class="wr-vocab-label">生词回想</div>
        <div id="wrWord" class="wr-vocab-question-word">${esc(quiz.word)}</div>
        <div class="wr-vocab-instruction">看到英文，先回想中文意思，再翻答案自评</div>
      </div>
      <div id="wrRecallBody" style="text-align:center;margin-bottom:10px">
        <button id="wrReveal" style="padding:10px 28px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-size:15px;cursor:pointer">👁 显示中文意思</button>
      </div>
      <div id="wrResult"></div>` + webReviewFooter('回想后按回车显示中文');
    modal.querySelector('#wrReveal').addEventListener('click', () => webReviewReveal());
  } else if (quiz.type === 'dictation') {
    modal.innerHTML = head +
      `<div class="wr-vocab-card wr-vocab-dictation">
        <div class="wr-vocab-label">默写阶段</div>
        <div class="wr-vocab-instruction">看中文，写出对应的英文单词</div>
        <div id="wrMeaning">${webReviewVocabMeaningBlock(quiz.meaning, quiz.word, true)}</div>
      </div>
      <input id="wrFill" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
        style="width:100%;padding:12px 14px;border:1.5px solid var(--primary);border-radius:10px;font-size:18px;margin-bottom:10px;box-sizing:border-box;text-align:center"
        placeholder="在这里输入英文单词，回车提交">
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-bottom:10px">
        <button id="wrFillSubmit" style="padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">✅ 提交</button>
      </div>
      <div id="wrResult"></div>` + webReviewFooter('默写后回车或点「提交」');
    webReviewBindFillSubmit(modal);
  } else {
    modal.innerHTML = head +
      `<div id="wrStem" style="font-size:15px;line-height:1.8;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:14px;text-align:center;white-space:pre-wrap">${esc(quiz.stem)}</div>
      <div id="wrRecallBody" style="text-align:center;margin-bottom:10px">
        <button id="wrReveal" style="padding:10px 28px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-size:15px;cursor:pointer">🤔 显示答案</button>
      </div>
      <div id="wrResult"></div>` + webReviewFooter('按回车显示答案');
    modal.querySelector('#wrReveal').addEventListener('click', () => webReviewReveal());
  }
  const prevQ = modal.querySelector('#wrPrevQ');
  if (prevQ) prevQ.addEventListener('click', () => webReviewPrev());
}

function webReviewFooter(hint) {
  return `<div id="wrFoot" style="display:flex;gap:8px;justify-content:space-between;align-items:center">
    <span style="display:flex;gap:10px;align-items:center">
      <button id="wrPrevQ" title="上一题（撤销上一张评分）" style="border:none;background:none;color:var(--text2);font-size:13px;cursor:pointer;padding:2px 4px">◀ 上一题</button>
      <button data-action="close-web-review" style="border:none;background:none;color:var(--text2);font-size:12px;cursor:pointer">退出复习</button>
    </span>
    <span style="font-size:12px;color:var(--text3)">${esc(hint)}</span>
  </div>`;
}

/* 填空题正文：把题干按 ___ 拆成「文字段 + 输入框」交替，
   多空时保留空与空之间的原文（逗号/分号/空格），用户无需猜分隔符。 */
function webReviewFillBody(quiz) {
  const segs = String(quiz.stem || '').split(/(_{2,})/);
  let blankIdx = 0;
  let html = `<div style="font-size:16px;line-height:2.2;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:14px">`;
  const blankCount = (quiz.stem.match(/_{2,}/g) || []).length;
  for (const seg of segs) {
    if (/^_{2,}$/.test(seg)) {
      blankIdx++;
      if (blankCount > 1) html += `<span style="color:var(--primary);font-weight:700;margin-right:4px">${blankIdx}.</span>`;
      html += `<input data-wr-blank="${blankIdx}" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
        style="display:inline-block;min-width:90px;max-width:60%;padding:6px 10px;border:1.5px solid var(--primary);border-radius:8px;font-size:15px;font-family:inherit;margin:0 4px;box-sizing:border-box">`;
    } else {
      html += `<span style="white-space:pre-wrap">${esc(seg)}</span>`;
    }
  }
  html += `</div>
  <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-bottom:10px">
    <button id="wrFillSubmit" style="padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">✅ 提交</button>
  </div>`;
  return html;
}

function webReviewBindFillSubmit(modal) {
  const inputs = [...modal.querySelectorAll('[data-wr-blank], #wrFill')];
  const submit = modal.querySelector('#wrFillSubmit');
  const doSubmit = () => {
    if (webReviewState.quiz.type === 'dictation') {
      webReviewSubmitDictation((modal.querySelector('#wrFill') || {}).value || '');
    } else {
      const vals = inputs.map(i => i.value);
      webReviewSubmitFill(vals);
    }
  };
  if (submit) submit.addEventListener('click', doSubmit);
  inputs.forEach((inp, i) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation(); // 提交后阶段会同步变成 graded，不能让同一 Enter 再触发下一题
        if (i + 1 < inputs.length) inputs[i + 1].focus();
        else doSubmit();
      }
    });
  });
  setTimeout(() => { if (inputs[0]) inputs[0].focus(); }, 50);
}

/* ==================== 判分 ==================== */
function webReviewNormalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function webReviewBlankMatch(given, answer) {
  const g = webReviewNormalize(given);
  const a = webReviewNormalize(answer);
  if (!g || !a) return false;
  if (g === a) return true;
  // Accept harmless answer formatting differences used by legacy cards:
  // surrounding root hints, HTML punctuation, and alternate whitespace.
  const stripRoot = (value) => value.replace(/[\uFF08(]\s*[a-z][a-z' -]{1,40}\s*[\uFF09)]/gi, '').replace(/\s+/g, ' ').trim();
  if (stripRoot(g) === stripRoot(a)) return true;
  // 允许答案带括号可选内容：organize(organise) / (be) used to
  const optRe = /\(([^)]*)\)/g;
  const stripped = a.replace(optRe, '').replace(/\s+/g, ' ').trim();
  const kept = a.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  return (stripped && g === stripped) || (kept && g === kept);
}
function webReviewSplitAnswers(answer) {
  const text = String(answer || '').trim();
  if (!text) return [];
  // A single blank may legitimately contain punctuation (for example
  // "if ..., ..."). Only treat separators as multiple answers when the
  // answer explicitly uses the conventional numbered/blank format.
  if (!/(?:^|\n)\s*(?:\d+\s*[.)、:]|blank\s*\d+)/i.test(text)) {
    return [text];
  }
  return text.split(/\s*(?:[,;|]|\n)\s*/).map(s => s.replace(/^\s*(?:\d+\s*[.)、:]|blank\s*\d+)\s*/i, '').trim()).filter(Boolean);
}

function webReviewAnswerLetter(raw) {
  const text = webReviewTextFromHTML(raw).trim();
  const m = text.match(/^(?:答案|answer|正确答案|correct answer)\s*[:：]?\s*\(?([A-D])\)?(?:\b|[.、)]|$)/i) || text.match(/^\(?([A-D])\)?(?:\b|[.、)]|$)/i);
  return m ? m[1].toUpperCase() : '';
}

function webReviewChoose(letter) {
  const quiz = webReviewState && webReviewState.quiz;
  if (!quiz || quiz.type !== 'mc' || webReviewState.locked) return;
  modalOptionMark(letter, quiz.answer);
  const correct = letter === quiz.answer;
  webReviewGrade(correct, correct ? '' : (quiz.answer + '. ' + (quiz.options.find(o => o.letter === quiz.answer) || {}).text), quiz.explanation);
}

function modalOptionMark(chosen, answer) {
  document.querySelectorAll('[data-wr-opt]').forEach(b => {
    const L = b.getAttribute('data-wr-opt');
    b.disabled = true;
    b.classList.toggle('is-correct', L === answer);
    b.classList.toggle('is-wrong', L === chosen && L !== answer);
  });
}

function webReviewSubmitFill(values) {
  const quiz = webReviewState && webReviewState.quiz;
  if (!quiz || quiz.type !== 'fill' || webReviewState.locked) return;
  const answers = webReviewSplitAnswers(quiz.answer);
  const givenArr = Array.isArray(values) ? values : [values];
  if (!givenArr.some(v => webReviewNormalize(v))) { const i = document.querySelector('[data-wr-blank="1"]') || document.querySelector('#wrFill'); if (i) i.focus(); return; }
  let correct;
  if (answers.length > 1 || givenArr.length > 1) {
    // 多空：逐空判定，全对才算对
    // 单个答案中可能包含逗号/分号（例如 "if ..., ..."），此时将
    // 同一答案用于唯一输入框，而不是拿它去比对每个输入框。
    if (answers.length === 1 && givenArr.length > 1) {
      correct = webReviewBlankMatch(givenArr.filter(Boolean).join(' '), answers[0]);
    } else {
      correct = answers.length === givenArr.length && answers.every((ans, i) => webReviewBlankMatch(givenArr[i] || '', ans));
    }
  } else {
    correct = webReviewBlankMatch(givenArr[0] || '', answers[0] || quiz.answer);
  }
  webReviewGrade(correct, correct ? '' : quiz.answer, quiz.explanation);
}

function webReviewSubmitDictation(raw) {
  const quiz = webReviewState && webReviewState.quiz;
  if (!quiz || quiz.type !== 'dictation' || webReviewState.locked) return;
  const g = webReviewNormalize(raw);
  if (!g) { const i = document.querySelector('#wrFill'); if (i) i.focus(); return; }
  const correct = webReviewBlankMatch(raw, quiz.word);
  webReviewGrade(correct, correct ? '' : quiz.word, quiz.example ? '例句：' + quiz.example : '');
}

/* 判分后进入「评分阶段」：展示结果 + 四档评分按钮，等待用户操作，不自动跳题 */
function webReviewGrade(correct, correctText, explanation) {
  const st = webReviewState;
  if (!st || st.locked) return;
  st.locked = true;
  st.stage = 'graded';
  st.judgedCorrect = !!correct;
  if (correct) st.correct++;
  const res = document.getElementById('wrResult');
  if (res) {
    res.innerHTML = `<div style="padding:12px 14px;border-radius:10px;margin-bottom:12px;background:${correct ? '#f0fdf4' : '#fef2f2'};border:1px solid ${correct ? '#22c55e' : '#ef4444'}">
      <div style="font-weight:700;color:${correct ? '#15803d' : '#dc2626'};margin-bottom:${correctText ? 6 : 0}px">${correct ? '✅ 回答正确' : '❌ 回答错误'}</div>
      ${correctText ? `<div style="font-size:14px;color:var(--text)">✅ 正确答案：<b>${esc(correctText)}</b></div>` : ''}
      ${explanation ? `<div style="font-size:13px;color:var(--text2);margin-top:6px;line-height:1.7;text-align:left;white-space:pre-wrap">💡 ${esc(explanation)}</div>` : ''}
    </div>` + webReviewGradeBar(correct ? 3 : 1);
    webReviewBindGradeBar(res);
  }
}

/* 翻答案（生词回想 / 问答题）：展示答案后直接进入评分阶段，默认「良好」 */
function webReviewReveal() {
  const st = webReviewState;
  if (!st || st.locked) return;
  const quiz = st.quiz;
  if (!quiz) return;
  st.locked = true;
  st.stage = 'graded';
  st.judgedCorrect = null; // 自评，正确性由用户点击的档位决定
  const body = document.getElementById('wrRecallBody');
  if (body) body.style.display = 'none';
  const res = document.getElementById('wrResult');
  if (res) {
    let answerBlock = '';
    if (quiz.type === 'recall') {
      answerBlock = webReviewVocabMeaningBlock(quiz.meaning, quiz.word);
      if (quiz.example) answerBlock += `<div class="wr-vocab-example"><span>例句与语境</span>${esc(quiz.example)}</div>`;
    } else {
      answerBlock = quiz.answer ? `<div style="font-size:16px;font-weight:700;color:#15803d;margin-bottom:6px;white-space:pre-wrap">✅ ${esc(quiz.answer)}</div>` : '';
      if (quiz.explanation) answerBlock += `<div style="font-size:13px;color:var(--text2);line-height:1.7;text-align:left;white-space:pre-wrap">💡 ${esc(quiz.explanation)}</div>`;
    }
    res.innerHTML = `<div style="padding:12px 14px;border-radius:10px;margin-bottom:12px;background:#f8fafc;border:1px solid var(--border)">${answerBlock}</div>` + webReviewGradeBar(3);
    webReviewBindGradeBar(res);
  }
}

function webReviewGradeBar(defaultEase) {
  webReviewState.defaultEase = defaultEase;
  const grades = [
    { ease: 1, icon: '🔁', label: '重来', color: '#dc2626', bg: '#fef2f2' },
    { ease: 2, icon: '😖', label: '困难', color: '#d97706', bg: '#fffbeb' },
    { ease: 3, icon: '👌', label: '良好', color: '#15803d', bg: '#f0fdf4' },
    { ease: 4, icon: '😎', label: '简单', color: '#2563eb', bg: '#eff6ff' }
  ];
  const btns = grades.map(g => {
    const isDef = g.ease === defaultEase;
    return `<button data-wr-grade="${g.ease}" style="flex:1;min-width:64px;padding:9px 6px;border-radius:9px;border:${isDef ? '2px solid ' + g.color : '1px solid ' + g.color};background:${g.bg};color:${g.color};font-size:13px;font-weight:${isDef ? 800 : 600};cursor:pointer">${g.icon} ${g.label}${isDef ? ' ⭐' : ''}</button>`;
  }).join('');
  return `<div style="text-align:center;font-size:12px;color:var(--text2);margin:6px 0 8px">
      这次答得怎么样？<span style="color:var(--text3)">（← 上一题 · 1-4 评分 · Enter/→ 下一题）</span>
    </div>
    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;align-items:center">
      <button id="wrPrev" title="上一题（撤销本次评分）" style="padding:9px 12px;border-radius:9px;border:1px solid var(--border);background:#fff;color:var(--text2);font-size:13px;cursor:pointer">◀</button>
      ${btns}
      <button id="wrNext" style="padding:9px 14px;border-radius:9px;border:none;background:var(--primary);color:#fff;font-size:13px;font-weight:700;cursor:pointer">下一题 ▶</button>
    </div>
    <div style="text-align:center;margin-top:10px"><button data-action="close-web-review" style="border:none;background:none;color:var(--text2);font-size:12px;cursor:pointer">退出复习</button></div>`;
}

function webReviewBindGradeBar(container) {
  const foot = document.getElementById('wrFoot');
  if (foot) foot.style.display = 'none'; // 评分栏自带退出按钮，隐藏题目阶段的底部提示
  container.querySelectorAll('[data-wr-grade]').forEach(b => {
    b.addEventListener('click', () => webReviewCommit(Number(b.getAttribute('data-wr-grade'))));
  });
  const next = container.querySelector('#wrNext');
  if (next) { next.addEventListener('click', () => webReviewNext()); setTimeout(() => next.focus(), 30); }
  const prev = container.querySelector('#wrPrev');
  if (prev) prev.addEventListener('click', () => webReviewPrev());
}

/* 按默认档位进入下一题（Enter/→/下一题按钮） */
function webReviewNext() {
  webReviewCommit(webReviewState ? webReviewState.defaultEase : 3);
}

/* 撤销上一张的评分，回到上一张。
   注意 AnkiConnect 行为：guiUndo 成功后当前显示的卡可能不变（被撤销的卡
   稍后会在队列中重新出现），因此以「undo 返回 true + 当前卡重渲染」为准，
   不做 cardId 严格核对（实测该核对与 Anki 异步刷新存在竞态，会误报失败）。 */
async function webReviewPrev() {
  const st = webReviewState;
  if (!st || st.committing) return;
  if (st.current <= 1 && !st.prevCardId) { toastMsg('已经是第一张了'); return; }
  try {
    const r = await ankiPostCall({ action: 'guiUndo', version: 6 });
    const ok = r && r.ok && r.result && r.result.result;
    if (!ok) { toastMsg('已经是第一张了'); return; }
    const graded = Array.isArray(st.history) ? st.history.pop() : null;
    if (graded && graded.correct) st.correct = Math.max(0, st.correct - 1);
    await new Promise(res => setTimeout(res, 120));
    const card = await ankiPostCall({ action: 'guiCurrentCard', version: 6 });
    const cardData = card && card.result && card.result.result;
    if (webReviewState !== st) return;
    if (!cardData) { toastMsg('已经是第一张了'); return; }
    if (!webReviewDeckMatches(cardData)) { showWebReviewDeckMismatch(cardData); return; }
    if (cardData.cardId === st.cardId) {
      toastMsg('已撤销上一张的评分，它稍后会再次出现');
    } else {
      st.current = Math.max(1, st.current - 1);
      st.total = Math.max(st.total, st.current);
      st.cardId = cardData.cardId;
    }
    await webReviewRefreshQueueStats(cardData);
    if (webReviewState === st) showWebReviewQuestion(cardData);
  } catch (e) {
    dbg('ANKI_UNDO', e.message);
    toastMsg('上一题操作失败：' + e.message);
  }
}

/* 提交评分并进入下一张（ease: 1 重来 / 2 困难 / 3 良好 / 4 简单） */
async function webReviewCommit(ease) {
  const st = webReviewState;
  if (!st || st.committing) return;
  st.committing = true;
  let gradedCorrect = false;
  try {
    gradedCorrect = st.selfGraded ? ease >= 3 : st.judgedCorrect === true;
    if (gradedCorrect) st.correct++;
    await ankiPostCall({ action: 'guiShowAnswer', version: 6 });
    await new Promise(r => setTimeout(r, 40));
    st.prevCardId = st.cardId;
    await ankiPostCall({ action: 'guiAnswerCard', version: 6, params: { ease } });
    if (!Array.isArray(st.history)) st.history = [];
    st.history.push({ cardId: st.cardId, correct: gradedCorrect });
    if (st.quiz && st.quiz.type === 'recall') {
      const promoted = webReviewVocabRecord(st.quiz.word, ease);
      if (promoted) toastMsg('🎯 「' + st.quiz.word + '」已熟练，以后改为看中文默写英文');
    }
    await new Promise(r => setTimeout(r, 80));
    syncAnkiReviewData().catch(() => {});
    fetchNextWebReviewCard();
  } catch (e) {
    st.committing = false;
    if (gradedCorrect) st.correct = Math.max(0, st.correct - 1);
    dbg('ANKI_ANSWER', e.message);
    const modal = document.getElementById('ankiReviewModal');
    if (modal) modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">❌ 答题提交失败：' + esc(e.message) + '<br><br><button data-action="close-web-review" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
  }
}

function finishWebReview() {
  const modal = document.getElementById('ankiReviewModal');
  if (!modal) return;
  webReviewState.stage = 'finished';
  webReviewState.committing = false;
  webReviewState.currentQueue = null;
  const pct = webReviewState.total > 0 ? Math.round((webReviewState.correct / webReviewState.total) * 100) : 0;
  modal.innerHTML = `<div style="text-align:center;padding:20px">
    <div style="font-size:40px;margin-bottom:12px">🎉</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:8px">复习完成!</div>
    <div style="font-size:14px;color:var(--text2);margin-bottom:4px">共 ${webReviewState.total} 题 · 正确 ${webReviewState.correct} 题</div>
    <div style="font-size:24px;font-weight:700;color:${pct >= 70 ? 'var(--green)' : 'var(--red)'}">正确率 ${pct}%</div>
    <button data-action="close-overlay" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button>
  </div>`;
}

function closeWebReview() {
  if (webReviewState && webReviewState.keyHandler) {
    document.removeEventListener('keydown', webReviewState.keyHandler);
  }
  webReviewState = null;
  const modal = document.getElementById('ankiReviewModal');
  if (modal) modal.parentElement.remove();
  renderAnkiSidebar();
}
