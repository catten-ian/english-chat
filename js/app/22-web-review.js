/* ============================================================
   AI 英语对话教练 — 网页答题复习
   由 js/app.js 拆分而来（新增切片，内容为全新代码；
   网页复习流程原在 06-anki.js，因单切片 1000 行上限迁出）。

   通过 AnkiConnect GUI 动作驱动 Anki 复习队列与 FSRS 排程：
   - 选择题：点击选项或按 1-4 / A-D 作答；
   - 填空题：键盘输入答案，回车提交；
   - 判对/判错后自动 guiShowAnswer + guiAnswerCard 评分，
     展示正确答案与 Explanation，再拉下一张；
   - 无法识别题型的卡片回退为「翻卡 + 四档自评」。
   依赖的全局函数均为跨切片顶层声明（06-anki.js / 21-anki-tasks.js 等）。
   ============================================================ */

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
        modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--orange)">⚠️ Anki 未运行或 AnkiConnect 未连接<br><br>请先打开 Anki（可最小化），然后重新点击「✅ 复习」<br><br><button data-action="close-overlay" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
        return;
      }
      const result = await ankiPostCall({ action: 'guiDeckReview', version: 6, params: { name: ankiWeakDeck() } });
      // guiDeckReview 返回 true/false
      if (!result || !result.ok || !result.result || !result.result.result) {
        // 可能牌组没有可复习卡片。注意：is:due 只匹配到期/学习中卡片，
        // 不匹配「新卡」——刚补题推送的卡全是新卡，必须把 is:new/is:learn 也算上。
        const cardIds = await ankiPostCall({ action: 'findCards', version: 6, params: { query: 'deck:' + ankiWeakDeck() + ' (is:due OR is:new OR is:learn)' } });
        const studyable = (cardIds && cardIds.result && cardIds.result.result) ? cardIds.result.result.length : 0;
        if (studyable === 0) {
          modal.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:12px">🎉</div><div style="font-size:18px;font-weight:700;margin-bottom:8px">薄弱点牌组没有待复习卡片</div><div style="font-size:14px;color:var(--text2);margin-bottom:4px">继续对话，新的薄弱点会自动生成题目</div><button data-action="close-overlay" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button></div>';
        } else {
          modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--orange)">⚠️ 无法启动复习会话（有 ' + studyable + ' 张可复习卡片，但 Anki 拒绝启动）<br>请确保 Anki 窗口已打开，然后重试<br><br><button data-action="close-overlay" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
        }
        return;
      }
      await new Promise(r => setTimeout(r, 500));
      fetchNextWebReviewCard();
    } catch (e) {
      modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">❌ 启动复习失败：' + esc(e.message || e) + '<br><br>请确认 Anki 已运行且 AnkiConnect 插件已安装（默认端口 8765）<br><br><button data-action="close-overlay" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
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
          // 没有卡片可复习：很可能薄弱点题目从未成功推送（anki_notes 全空），
          // 提供「立即补题」而不是干巴巴的空状态——补题走任务队列，成功后自动开考
          showWebReviewEmptyWithCatchUp();
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
    modal.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:12px">🎉</div><div style="font-size:18px;font-weight:700;margin-bottom:8px">薄弱点牌组没有待复习卡片</div><div style="font-size:14px;color:var(--text2);margin-bottom:4px">继续对话，新的薄弱点会自动生成题目</div><button data-action="close-overlay" style="margin-top:16px;padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">关闭</button></div>';
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

function webReviewFieldText(cardData, name) {
  const f = cardData && cardData.fields && cardData.fields[name];
  let raw = (f && (f.value !== undefined ? f.value : f)) || '';
  const d = document.createElement('div');
  d.innerHTML = String(raw);
  return (d.textContent || '').replace(/\r/g, '');
}

function webReviewQuizType(cardData) {
  const qText = webReviewFieldText(cardData, 'Question');
  const aText = webReviewFieldText(cardData, 'Answer').trim();
  const exp = webReviewFieldText(cardData, 'Explanation').trim();
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
    const am = aText.match(/([A-D])/);
    return { type: 'mc', stem, options: opts, answer: am ? am[1] : '', answerRaw: aText, explanation: exp };
  }
  if (/_{2,}/.test(qText) && aText) {
    return { type: 'fill', stem: qText.trim(), answer: aText.replace(/^[A-D][\.、\)]?\s*/, '').trim(), explanation: exp };
  }
  return { type: 'manual', stem: qText.trim(), answer: aText, explanation: exp, answerHtml: (cardData && cardData.answer) || '' };
}

function webReviewKeyHandler(ev) {
  if (!webReviewState || webReviewState.locked) return;
  const quiz = webReviewState.quiz;
  if (!quiz) return;
  if (quiz.type === 'mc') {
    const k = ev.key.toLowerCase();
    let letter = null;
    if (k >= '1' && k <= '4') letter = 'ABCD'[Number(k) - 1];
    else if (k >= 'a' && k <= 'd') letter = k.toUpperCase();
    if (letter) { ev.preventDefault(); webReviewChoose(letter); }
  }
}

function showWebReviewQuestion(cardData) {
  const modal = document.getElementById('ankiReviewModal');
  if (!modal) return;
  const quiz = webReviewQuizType(cardData);
  webReviewState.quiz = quiz;
  webReviewState.locked = false;
  if (webReviewState.keyHandler) document.removeEventListener('keydown', webReviewState.keyHandler);
  webReviewState.keyHandler = webReviewKeyHandler;
  document.addEventListener('keydown', webReviewState.keyHandler);

  const head = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <span style="font-size:13px;font-weight:600">📝 题目 (${webReviewState.current}/${webReviewState.total})</span>
    <span style="font-size:12px;color:var(--text2)">✅ ${webReviewState.correct}/${webReviewState.current}</span>
  </div>`;
  const stemBox = `<div id="wrStem" style="font-size:16px;line-height:1.8;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:14px;text-align:left;white-space:pre-wrap">${esc(quiz.stem)}</div>`;

  if (quiz.type === 'mc') {
    const btns = quiz.options.map(o =>
      `<button data-wr-opt="${o.letter}" style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px 14px;border-radius:10px;border:1.5px solid var(--border);background:#fff;font-size:15px;cursor:pointer;line-height:1.5">
        <b style="color:var(--primary);margin-right:8px">${o.letter}.</b>${esc(o.text)}
      </button>`).join('');
    modal.innerHTML = head + stemBox +
      `<div id="wrOptions" style="margin-bottom:10px">${btns}</div>` +
      `<div id="wrResult"></div>` +
      `<div style="display:flex;gap:8px;justify-content:space-between;align-items:center">
        <button data-action="close-web-review" style="border:none;background:none;color:var(--text2);font-size:12px;cursor:pointer">退出复习</button>
        <span style="font-size:12px;color:var(--text3)">点击选项，或按 1-4 / A-D</span>
      </div>`;
    modal.querySelectorAll('[data-wr-opt]').forEach(b => b.addEventListener('click', () => webReviewChoose(b.getAttribute('data-wr-opt'))));
  } else if (quiz.type === 'fill') {
    modal.innerHTML = head + stemBox +
      `<input id="wrFill" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
         style="width:100%;padding:12px 14px;border:1.5px solid var(--primary);border-radius:10px;font-size:16px;margin-bottom:10px;box-sizing:border-box"
         placeholder="在这里输入答案，回车提交">` +
      `<div id="wrResult"></div>` +
      `<div style="display:flex;gap:8px;justify-content:space-between;align-items:center">
        <button data-action="close-web-review" style="border:none;background:none;color:var(--text2);font-size:12px;cursor:pointer">退出复习</button>
        <button id="wrFillSubmit" style="padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">✅ 提交</button>
      </div>`;
    const input = modal.querySelector('#wrFill');
    const submit = () => webReviewSubmitFill(input.value);
    modal.querySelector('#wrFillSubmit').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    setTimeout(() => input && input.focus(), 50);
  } else {
    if (webReviewState.keyHandler) { document.removeEventListener('keydown', webReviewState.keyHandler); webReviewState.keyHandler = null; }
    modal.innerHTML = head +
      `<div style="font-size:15px;line-height:1.8;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:14px;text-align:center;white-space:pre-wrap">${esc(quiz.stem)}</div>` +
      `<div id="wrResult"></div>` +
      `<div style="display:flex;gap:8px;justify-content:center">
        <button data-action="web-review-show-answer" style="padding:8px 24px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">🤔 显示答案</button>
        <button data-action="close-web-review" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:#fff;font-size:13px;cursor:pointer">退出</button>
      </div>`;
  }
}

function webReviewNormalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function webReviewGrade(correct, correctText, explanation) {
  if (webReviewState.locked) return;
  webReviewState.locked = true;
  if (correct) webReviewState.correct++;
  const res = document.getElementById('wrResult');
  if (res) {
    res.innerHTML = `<div style="padding:12px 14px;border-radius:10px;margin-bottom:12px;background:${correct ? '#f0fdf4' : '#fef2f2'};border:1px solid ${correct ? '#22c55e' : '#ef4444'}">
      <div style="font-weight:700;color:${correct ? '#15803d' : '#dc2626'};margin-bottom:${correctText ? 6 : 0}px">${correct ? '✅ 回答正确' : '❌ 回答错误'}</div>
      ${correctText ? `<div style="font-size:14px;color:var(--text)">✅ 正确答案：<b>${esc(correctText)}</b></div>` : ''}
      ${explanation ? `<div style="font-size:13px;color:var(--text2);margin-top:6px;line-height:1.7;text-align:left">💡 ${esc(explanation)}</div>` : ''}
    </div>`;
  }
  const ease = correct ? 3 : 1;
  setTimeout(() => webReviewCommit(ease), correct ? 1000 : 1800);
}

async function webReviewCommit(ease) {
  try {
    await ankiPostCall({ action: 'guiShowAnswer', version: 6 });
    await new Promise(r => setTimeout(r, 150));
    await ankiPostCall({ action: 'guiAnswerCard', version: 6, params: { ease } });
    await new Promise(r => setTimeout(r, 300));
    syncAnkiReviewData().catch(() => {});
    fetchNextWebReviewCard();
  } catch (e) {
    dbg('ANKI_ANSWER', e.message);
    const modal = document.getElementById('ankiReviewModal');
    if (modal) modal.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red)">❌ 答题提交失败：' + esc(e.message) + '<br><br><button data-action="close-web-review" style="padding:8px 20px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">关闭</button></div>';
  }
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
    b.style.cursor = 'default';
    if (L === answer) { b.style.background = '#f0fdf4'; b.style.borderColor = '#22c55e'; }
    else if (L === chosen) { b.style.background = '#fef2f2'; b.style.borderColor = '#ef4444'; }
  });
}

function webReviewSubmitFill(raw) {
  const quiz = webReviewState && webReviewState.quiz;
  if (!quiz || quiz.type !== 'fill' || webReviewState.locked) return;
  const given = webReviewNormalize(raw);
  const accept = webReviewNormalize(quiz.answer);
  if (!given) { const i = document.getElementById('wrFill'); if (i) i.focus(); return; }
  const correct = given === accept || accept.split(' ').some(w => w.length > 2 && given === w) || (given.length >= 3 && (accept.startsWith(given) || given.startsWith(accept)));
  webReviewGrade(correct, correct ? '' : quiz.answer, quiz.explanation);
}

function webReviewShowAnswer() {
  (async () => {
    try {
      await ankiPostCall({ action: 'guiShowAnswer', version: 6 });
      await new Promise(r => setTimeout(r, 200));
      const card = await ankiPostCall({ action: 'guiCurrentCard', version: 6 });
      const cardData = card && card.result && card.result.result;
      if (!cardData) return;
      const quiz = webReviewQuizType(cardData);
      const modal = document.getElementById('ankiReviewModal');
      if (!modal) return;
      const answerBlock = quiz.answer
        ? `<div style="font-size:16px;font-weight:700;color:#15803d;margin-bottom:6px">✅ ${esc(quiz.answer)}</div>` : '';
      const expBlock = quiz.explanation
        ? `<div style="font-size:13px;color:var(--text2);line-height:1.7;text-align:left">💡 ${esc(quiz.explanation)}</div>` : '';
      modal.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:13px;font-weight:600">📝 题目 (${webReviewState.current}/${webReviewState.total})</span>
        <span style="font-size:12px;color:var(--text2)">✅ ${webReviewState.correct}/${webReviewState.current}</span>
      </div>
      <div style="font-size:15px;line-height:1.8;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:10px;text-align:left;white-space:pre-wrap">${esc(quiz.stem)}</div>
      <div style="padding:12px 14px;border-radius:10px;margin-bottom:12px;background:#f8fafc;border:1px solid var(--border)">${answerBlock}${expBlock}</div>
      <div style="text-align:center;font-size:13px;color:var(--text2);margin:8px 0">这次答得怎么样？</div>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
        <button data-action="web-review-answer" data-arg1="1" style="flex:1;min-width:60px;padding:8px 10px;border-radius:8px;border:1px solid #ef4444;background:#fef2f2;color:#dc2626;font-size:13px;cursor:pointer">😰 忘记</button>
        <button data-action="web-review-answer" data-arg1="2" style="flex:1;min-width:60px;padding:8px 10px;border-radius:8px;border:1px solid #f59e0b;background:#fffbeb;color:#d97706;font-size:13px;cursor:pointer">🤔 模糊</button>
        <button data-action="web-review-answer" data-arg1="3" style="flex:1;min-width:60px;padding:8px 10px;border-radius:8px;border:1px solid #22c55e;background:#f0fdf4;color:#15803d;font-size:13px;cursor:pointer">😊 记得</button>
        <button data-action="web-review-answer" data-arg1="4" style="flex:1;min-width:60px;padding:8px 10px;border-radius:8px;border:1px solid #3b82f6;background:#eff6ff;color:#2563eb;font-size:13px;cursor:pointer">😎 简单</button>
      </div>
      <div style="text-align:center;margin-top:10px"><button data-action="close-web-review" style="border:none;background:none;color:var(--text2);font-size:12px;cursor:pointer">退出复习</button></div>`;
    } catch (e) {
      dbg('ANKI_ANSWER_SHOW', e.message);
    }
  })();
}

function webReviewAnswer(ease) {
  if (ease >= 3) webReviewState.correct++;
  webReviewCommit(Number(ease));
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
