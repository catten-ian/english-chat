/* ============================================================
   翻译练习统计与题目提示
   由 js/app.js 拆分而来
============================================================ */
function trStatKey(catKey, idx) { return catKey + ':' + idx; }

/* 渲染必用词 chips；userAnswer 可选，用于高亮已使用/未使用的词。 */
function renderTrQuestionWords(words, usedText) {
  const el = document.getElementById('trQuestionWords');
  if (!el) return;
  if (!words || !words.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML = '<span style="font-size:11px;color:var(--text2)">🔑 必用词</span>' +
    words.map(w => {
      const isUsed = !!usedText && requiredWordUsed(usedText, w);
      const capitalizeHint = /^[A-Z]/.test(stripPosTag(w));
      const capitalBad = isUsed && capitalizeHint && !capitalRequirementMet(usedText, w);
      const label = (capitalizeHint ? 'ⓘ ' : '') + esc(w);
      let bg = '#fef3c7', bd = '#fde68a', fg = '#92400e';
      let title = capitalizeHint ? '首字母大写：建议在开头使用' : '尚未使用';
      if (capitalBad) {
        bg = '#fee2e2'; bd = '#fecaca'; fg = '#991b1b';
        title = '已使用，但应放在句首';
      } else if (isUsed) {
        bg = '#dcfce7'; bd = '#86efac'; fg = '#065f46';
        title = '已使用';
      }
      return '<span title="' + title + '" style="padding:2px 8px;border-radius:10px;background:' + bg + ';color:' + fg + ';border:1px solid ' + bd + ';font-weight:600">' + label + '</span>';
    }).join('');
}

function trNormalizeQuestionText(text) {
  return String(text || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
}

function trUniqueTranslationEntries(entries) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : []).filter(entry => {
    const key = trNormalizeQuestionText(entry && entry.item && entry.item.zh);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trTranslationCategoryEntries(catKey) {
  const bank = TRANSLATION_BANK[catKey];
  if (!bank || !Array.isArray(bank.items)) return [];
  return trUniqueTranslationEntries(bank.items.map((item, catIdx) => ({ item, catKey, catIdx })));
}

function trTranslationCategoryLabel(catKey) {
  const bank = TRANSLATION_BANK[catKey];
  return String(bank?.label || catKey).replace(/\s*[（(]\s*\d+\s*题\s*[）)]/g, '').trim();
}

let trHistoryStatsCache = { historyRaw: null, statsRaw: null, stats: null };
const trStatLookupCache = new WeakMap();

// Older translation history records may not carry stable bank coordinates.
// Reconcile them by exact normalized prompt so the bank and "only new" agree.
function trReconcileStatsFromHistory() {
  const historyRaw = localStorage.getItem('ai_en_setting_trHistory') || '[]';
  const statsRaw = localStorage.getItem('ai_en_setting_trQuestionStats') || '{}';
  if (trHistoryStatsCache.stats && trHistoryStatsCache.historyRaw === historyRaw && trHistoryStatsCache.statsRaw === statsRaw) {
    return trHistoryStatsCache.stats;
  }
  const history = getSetting('trHistory', []);
  const oldStats = getSetting('trQuestionStats', {});
  if (!Array.isArray(history) || !history.length) {
    trHistoryStatsCache = { historyRaw, statsRaw, stats: oldStats };
    return oldStats;
  }
  const stats = { ...(oldStats && typeof oldStats === 'object' ? oldStats : {}) };
  const byQuestion = new Map();
  for (const [catKey, bank] of Object.entries(TRANSLATION_BANK)) {
    (bank.items || []).forEach((item, catIdx) => {
      const key = trNormalizeQuestionText(item.zh);
      if (!key) return;
      const matches = byQuestion.get(key) || [];
      matches.push({ catKey, catIdx });
      byQuestion.set(key, matches);
    });
  }
  const recovered = new Map();
  for (const rec of history) {
    if (!rec || rec.action === 'show_answer' || (rec.userAnswer || '').trim() === '(查看参考答案)') continue;
    const questionKey = trNormalizeQuestionText(rec.question);
    if (!questionKey) continue;
    let targets = [];
    const explicit = rec.catKey && Number.isInteger(Number(rec.catIdx))
      ? { catKey: rec.catKey, catIdx: Number(rec.catIdx) } : null;
    const explicitItem = explicit && TRANSLATION_BANK[explicit.catKey]?.items?.[explicit.catIdx];
    if (explicitItem && trNormalizeQuestionText(explicitItem.zh) === questionKey) targets = [explicit];
    else targets = byQuestion.get(questionKey) || [];
    for (const target of targets) {
      const key = trStatKey(target.catKey, target.catIdx);
      const row = recovered.get(key) || { count: 0, bestScore: 0, latest: null };
      row.count++;
      const score = Number(String(rec.score || '').match(/\d+(?:\.\d+)?/)?.[0]) || 0;
      row.bestScore = Math.max(row.bestScore, score);
      const time = Number(rec.t) || 0;
      if (!row.latest || time >= row.latest.time) row.latest = { time, score, rec };
      recovered.set(key, row);
    }
  }
  let changed = false;
  for (const [key, row] of recovered) {
    const current = stats[key] || { answered: 0, bestScore: 0, lastScore: 0, lastAnswer: '', lastTime: 0, lastFeedback: '', lastZh: '' };
    const latest = row.latest;
    const next = {
      ...current,
      answered: Math.max(Number(current.answered) || 0, row.count),
      bestScore: Math.max(Number(current.bestScore) || 0, row.bestScore)
    };
    if (latest && latest.time >= (Number(current.lastTime) || 0)) {
      next.lastScore = latest.score;
      next.lastAnswer = latest.rec.userAnswer || '';
      next.lastTime = latest.time || Date.now();
      next.lastFeedback = latest.rec.feedbackHtml || latest.rec.feedback || '';
      next.lastZh = latest.rec.question || '';
    }
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      stats[key] = next;
      changed = true;
    }
  }
  if (changed) setSetting('trQuestionStats', stats);
  trHistoryStatsCache = {
    historyRaw,
    statsRaw: localStorage.getItem('ai_en_setting_trQuestionStats') || '{}',
    stats
  };
  return stats;
}

function trGetStat(catKey, idx) {
  const stats = trReconcileStatsFromHistory();
  let lookup = trStatLookupCache.get(stats);
  if (!lookup) { lookup = new Map(); trStatLookupCache.set(stats, lookup); }
  const lookupKey = trStatKey(catKey, idx);
  if (lookup.has(lookupKey)) return lookup.get(lookupKey);
  const primary = stats[trStatKey(catKey, idx)] || null;
  const items = TRANSLATION_BANK[catKey] && TRANSLATION_BANK[catKey].items;
  const questionKey = trNormalizeQuestionText(items && items[idx] && items[idx].zh);
  if (!questionKey || !items) { lookup.set(lookupKey, primary); return primary; }
  const matches = items.reduce((out, item, itemIdx) => {
    if (trNormalizeQuestionText(item && item.zh) === questionKey) {
      const stat = stats[trStatKey(catKey, itemIdx)];
      if (stat) out.push(stat);
    }
    return out;
  }, []);
  if (matches.length < 2) { lookup.set(lookupKey, primary); return primary; }
  const latest = matches.reduce((best, stat) => (Number(stat.lastTime) || 0) > (Number(best && best.lastTime) || 0) ? stat : best, null);
  const result = {
    ...(latest || primary || {}),
    answered: Math.max(0, ...matches.map(stat => Number(stat.answered) || 0)),
    bestScore: Math.max(0, ...matches.map(stat => Number(stat.bestScore) || 0))
  };
  lookup.set(lookupKey, result);
  return result;
}
