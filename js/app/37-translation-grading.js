/* ============================================================
   Translation grading — streaming requests, schema validation and retry.
   Extracted from js/app/17-practice.js.
   Shared parser/transport helpers are in 02-agents.js and 03-parse.js.
============================================================ */
function partialTranslationFeedback(raw) {
  const fields = {};
  for (const key of ['score', 'better_translation']) {
    const match = raw.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    if (match) {
      try { fields[key] = JSON.parse('"' + match[1] + '"'); } catch (_) {}
    }
  }
  const errorsMatch = raw.match(/"errors"\s*:\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?\s*)*)\]/);
  if (errorsMatch) {
    try { fields.errors = JSON.parse('[' + errorsMatch[1].replace(/,\s*\]$/, ']') + ']'); } catch (_) {}
  }
  return fields.score || fields.better_translation || (fields.errors && fields.errors.length) ? fields : null;
}

function isTranslationEvaluation(obj) {
  const value = obj && obj.score;
  if ((typeof value !== 'number' && typeof value !== 'string') || !String(value).trim()) return false;
  const match = String(value).match(/^\s*(\d+(?:\.\d+)?)/);
  if (!match || Number(match[1]) > 10) return false;
  return (typeof obj.better_translation === 'string' && !!obj.better_translation.trim()) ||
    (Array.isArray(obj.errors) && obj.errors.length > 0) ||
    (typeof obj.errors === 'string' && !!obj.errors.trim());
}

function normalizeTranslationEvaluation(obj) {
  const feedbackText = item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    return ['error', 'correction', 'rule', 'note', 'message', 'explanation', 'suggestion']
      .map(key => typeof item[key] === 'string' ? item[key] : '').filter(Boolean).join(' · ');
  };
  return {
    ...obj,
    score: typeof obj.score === 'number' ? obj.score + '/10' : obj.score,
    errors: (Array.isArray(obj.errors) ? obj.errors : [obj.errors]).map(feedbackText).filter(Boolean),
    better_translation: typeof obj.better_translation === 'string' ? obj.better_translation : '',
    segments: Array.isArray(obj.segments) ? obj.segments.filter(segment => segment && typeof segment.text === 'string') : []
  };
}

// ---- 翻译历史记录 ----
function saveTranslationRecord(rec) {
  if (!rec || !rec.question) return;
  let list = getSetting('trHistory', []);
  if (rec.id) {
    const index = list.findIndex(item => item.id === rec.id);
    if (index >= 0) list[index] = { ...list[index], ...rec };
    else list.unshift(rec);
  } else list.unshift(rec);
  if (list.length > 100) list = list.slice(0, 100);
  setSetting('trHistory', list);
}

function retryTranslationGrade(id) {
  const submission = trFeedbackItems.find(item => item.id === id && item.status === 'error');
  if (!submission) { toastMsg('当前页面已没有可重试的评分任务，请从历史记录重新提交'); return; }
  gradeTranslationSubmission(submission).catch(() => {});
}

function navigateTranslationFeedback(delta) {
  if (!trFeedbackItems.length) return;
  const next = trFeedbackPage + delta;
  if (next < 0 || next >= trFeedbackItems.length) return;
  trFeedbackPage = next;
  renderTranslationFeedbackPager();
}

function renderTranslateHistory() {
  const list = getSetting('trHistory', []);
  const countEl = document.getElementById('trHistCount');
  if (countEl) countEl.textContent = '(' + list.length + ')';
  const wrap = document.getElementById('trHistoryList');
  if (!wrap) return;
  wrap.style.display = trHistoryExpanded ? 'block' : 'none';
  // Grading updates history in the background. Avoid rebuilding up to 100
  // expanded feedback records while the history panel is collapsed.
  if (!trHistoryExpanded) return;
  if (!list.length) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--text2);text-align:center;padding:12px">暂无作答记录</div>';
    return;
  }
  wrap.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:11px;color:var(--text2)">' +
    '<span>📋 最近 ' + list.length + ' 条</span>' +
    '<span data-action="clear-tr-history" style="cursor:pointer;color:var(--text3)" title="清空所有记录">🗑️ 清空</span></div>' +
    list.map((r, i) => {
    const tm = new Date(r.t || Date.now());
    const dateStr = (tm.getMonth() + 1) + '-' + tm.getDate() + ' ' + String(tm.getHours()).padStart(2, '0') + ':' + String(tm.getMinutes()).padStart(2, '0');
    const scoreColor = (r.score || '').startsWith('9') || (r.score || '').startsWith('10') ? 'var(--green)'
      : (r.score || '').startsWith('7') || (r.score || '').startsWith('8') ? 'var(--primary)'
      : (r.score || '').startsWith('5') || (r.score || '').startsWith('6') ? 'var(--amber)'
      : 'var(--red)';
    return '<div data-action="expand-tr-record" data-arg1="' + i + '" style="padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;line-height:1.6">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
      '<span style="color:var(--text2);font-size:11px">📝 ' + esc(dateStr) + ' · ' + (r.action === 'show_answer' ? '查看答案' : '作答') + '</span>' +
      '<span style="font-weight:700;color:' + scoreColor + '">' + esc(r.score || '-') + '</span>' +
      '</div>' +
      '<div style="color:var(--text)">📌 ' + esc(r.question.length > 50 ? r.question.substring(0, 50) + '…' : r.question) + '</div>' +
      '<div id="trRecExp_' + i + '" style="display:none;margin-top:6px;border-top:1px dashed var(--border);padding-top:6px">' +
        '<div><b>你的翻译：</b><span style="color:var(--text2)">' + esc(r.userAnswer || '(空)') + '</span></div>' +
        (r.ref ? '<div style="margin-top:4px"><b>参考答案：</b><span style="color:var(--green)">' + esc(r.ref) + '</span></div>' : '') +
        (r.feedbackHtml ? '<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">' + r.feedbackHtml + '</div>' : (r.feedback ? '<div style="margin-top:4px"><b>反馈：</b><span style="color:var(--text2)">' + esc(r.feedback) + '</span></div>' : '')) +
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

async function gradeTranslationSubmission(submission) {
  submission.status = 'pending';
  submission.error = '';
  submission.html = '';
  submission.progress = '';
  saveTranslationRecord({ id: submission.id, question: submission.question, ref: submission.ref, userAnswer: submission.userAnswer, score: '评分中', feedback: '', feedbackHtml: '', action: 'submit', t: submission.submittedAt, catKey: submission.catKey, catIdx: submission.catIdx, status: 'pending' });
  renderTranslateHistory();
  if (trFeedbackItems[trFeedbackPage] === submission) renderTranslationFeedbackPager();
  try {
    const prompt = buildTranslationEvalPrompt({ zh: submission.question, ref: submission.ref, user: submission.userAnswer, words: submission.words, ruleVersion: submission.ruleVersion });
    const messages = [{ role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' }, { role: 'user', content: 'Chinese: ' + submission.question + '\nUser translation: ' + submission.userAnswer + (submission.ref ? '\nReference: ' + submission.ref : '') + (submission.words.length ? '\nRequired words (must appear): ' + submission.words.join(', ') : '') }];
    let streamed = '', lastPreview = 0, lastPreviewKey = '';
    const result = await streamAndParseJSON(messages, {
      temperature: 0.3, maxTokens: null, reasoningEffort: 'high',
      onRetry: () => {
        streamed = ''; lastPreview = 0; lastPreviewKey = '';
        submission.html = '';
        submission.progress = '⏳ 结果格式不完整，正在自动重新评分…';
        if (trFeedbackItems[trFeedbackPage] === submission) renderTranslationFeedbackPager();
      },
      onStatus: status => {
        if (submission.progress === status) return;
        submission.progress = status;
        if (status && trFeedbackItems[trFeedbackPage] === submission) renderTranslationFeedbackPager();
      }
    }, isTranslationEvaluation, delta => {
      streamed += delta;
      const now = Date.now();
      if (now - lastPreview < 700 || trFeedbackItems[trFeedbackPage] !== submission) return;
      const partial = partialTranslationFeedback(streamed);
      if (!partial) return;
      const previewKey = JSON.stringify(partial);
      if (previewKey === lastPreviewKey) return;
      lastPreview = now; lastPreviewKey = previewKey;
      submission.html = buildTranslationFeedbackHtml(submission, partial);
      renderTranslationFeedbackPager();
    });
    const obj = normalizeTranslationEvaluation(result.obj);
    submission.status = 'done';
    submission.obj = obj;
    submission.html = buildTranslationFeedbackHtml(submission, obj);
    const score = obj.score;
    saveTranslationRecord({ id: submission.id, question: submission.question, ref: submission.ref, userAnswer: submission.userAnswer, score, feedback: obj.errors.length ? obj.errors.join(' · ') : obj.better_translation, feedbackHtml: submission.html, action: 'submit', t: submission.submittedAt, catKey: submission.catKey, catIdx: submission.catIdx, status: submission.status });
    trUpdateQuestionStat(submission.catKey, submission.catIdx, { submissionId: submission.id, question: submission.question, userAnswer: submission.userAnswer, score, feedback: submission.html, t: submission.submittedAt });
    if (obj.segments.length) submission.segments = obj.segments;
  } catch (e) {
    submission.status = 'error'; submission.error = e.message || '请求失败'; submission.html = buildTranslationFeedbackHtml(submission, null, submission.error);
    saveTranslationRecord({ id: submission.id, question: submission.question, ref: submission.ref, userAnswer: submission.userAnswer, score: '错误', feedback: submission.error, feedbackHtml: submission.html, action: 'submit', t: submission.submittedAt, catKey: submission.catKey, catIdx: submission.catIdx, status: 'error' });
    trUpdateQuestionStat(submission.catKey, submission.catIdx, { submissionId: submission.id, question: submission.question, userAnswer: submission.userAnswer, score: '0', feedback: submission.error, t: submission.submittedAt });
  }
  renderTranslateHistory();
  if (trFeedbackItems[trFeedbackPage] === submission) renderTranslationFeedbackPager();
}
