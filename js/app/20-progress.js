/* ============================================================
   AI 英语对话教练 — Progress 学习者模型仪表盘
   由 js/app.js 拆分而来（新增切片，内容为全新代码）。
   - 纯本地聚合：从 localStorage（vocab / weak / conversations /
     trHistory / ankiStreak）计算统计，不发任何请求
   - 无第三方图表库（CSP script-src 'self'）：条形图 / 趋势柱用
     纯 HTML+CSS 实现
   - 只定义函数、无顶层副作用，因此放在 19-init 之后加载是安全的
   ============================================================ */

/* ---------- 聚合 ---------- */

/* 遍历一棵消息版本树，收集所有 user 变体上的 feedback.analysis */
function collectChatAnalyses(nodes, out) {
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    if (!n || !Array.isArray(n.variants)) continue;
    for (const v of n.variants) {
      const a = v && v.feedback && v.feedback.analysis;
      if (a) out.push(a);
      if (v && Array.isArray(v.next)) collectChatAnalyses(v.next, out);
    }
  }
  return out;
}

/* Chat 四维均分：grammar / expression / collocation / style（0-10） */
function aggregateChatDims(analyses) {
  const dims = { grammar: [], expression: [], collocation: [], style: [] };
  for (const a of analyses) {
    for (const k of Object.keys(dims)) {
      const s = a[k] && Number(a[k].score);
      if (Number.isFinite(s) && s >= 0 && s <= 10) dims[k].push(s);
    }
  }
  const avg = arr => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null;
  return {
    grammar: avg(dims.grammar),
    expression: avg(dims.expression),
    collocation: avg(dims.collocation),
    style: avg(dims.style),
    samples: dims.grammar.length
  };
}

/* 按评分时间排序的（分值, 时间）序列，用于趋势图 */
function chatScoreTimeline(convs) {
  const pts = [];
  for (const c of Object.values(convs || {})) {
    const analyses = collectChatAnalyses(c.messages, []);
    for (const a of analyses) {
      const vals = ['grammar', 'expression', 'collocation', 'style']
        .map(k => a[k] && Number(a[k].score))
        .filter(s => Number.isFinite(s));
      if (vals.length) pts.push({ avg: vals.reduce((x, y) => x + y, 0) / vals.length });
    }
  }
  return pts; // 无逐条时间戳（analysis 未存时间），顺序即对话存储顺序
}

/* 翻译历史得分（trHistory 每条带 t 与 score "7/10" 之类） */
function translationScores() {
  const list = getSetting('trHistory', []);
  return (Array.isArray(list) ? list : [])
    .map(r => {
      const s = parseInt(String(r && r.score || '').match(/\d+/)?.[0] || '0', 10);
      return { t: r.t || 0, score: s };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => a.t - b.t);
}

/* 薄弱点分类统计 */
function weakCategoryStats() {
  const wps = getAllWeakPoints();
  const byCat = {};
  let archived = 0, active = 0;
  for (const wp of wps) {
    if (wp.archived) { archived++; continue; }
    active++;
    const cat = wp.category || '未分类';
    byCat[cat] = (byCat[cat] || 0) + (wp.count || 1);
  }
  return { byCat, active, archived, total: wps.length };
}

/* 最近活跃对话（按 updatedAt 倒序） */
function recentConversations(convs, n) {
  return Object.values(convs || {})
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, n || 5)
    .map(c => ({ title: c.title || '未命名', updatedAt: c.updatedAt, topic: c.topic || '' }));
}

/* ---------- 渲染 ---------- */

function renderProgressDashboard() {
  const el = document.getElementById('progressDashboard');
  if (!el) return;

  const vocab = getVocab();
  const weak = weakCategoryStats();
  const convs = getAllConversations();
  const convCount = Object.keys(convs).length;
  const analyses = [];
  for (const c of Object.values(convs)) collectChatAnalyses(c.messages, analyses);
  const dims = aggregateChatDims(analyses);
  const trPts = translationScores();
  const streak = parseInt(getSetting('ankiStreak', 0)) || 0;

  const statCards = [
    { label: '📚 生词本', value: vocab.length, sub: '个词条' },
    { label: '🎯 薄弱点', value: weak.active, sub: '活跃 / 归档 ' + weak.archived },
    { label: '💬 对话', value: convCount, sub: '最近 5 条见下' },
    { label: '🔥 Anki 连续', value: streak, sub: '天' }
  ].map(s =>
    `<div class="pg-stat"><div class="pg-stat-label">${esc(s.label)}</div><div class="pg-stat-value">${esc(String(s.value))}</div><div class="pg-stat-sub">${esc(s.sub)}</div></div>`
  ).join('');

  // Chat 四维均分（横向条）
  const dimMeta = [
    ['grammar', '📖 语法 Grammar'],
    ['expression', '💬 表意 Expression'],
    ['collocation', '🔗 搭配 Collocation'],
    ['style', '✨ 文采 Style']
  ];
  const dimColor = v => v >= 8 ? 'var(--green)' : v >= 6 ? 'var(--primary)' : v >= 4 ? 'var(--amber)' : 'var(--red)';
  let dimHtml = '';
  if (dims.samples) {
    dimHtml = '<div class="pg-card"><div class="pg-card-title">💬 Chat 四维均分 <span class="pg-card-note">（' + dims.samples + ' 次评分）</span></div>';
    dimHtml += dimMeta.map(([k, label]) => {
      const v = dims[k];
      const pct = v === null ? 0 : Math.round(v * 10);
      const valTxt = v === null ? '—' : v.toFixed(1);
      return `<div class="pg-dim"><span class="pg-dim-label">${label}</span><div class="pg-dim-bar"><div class="pg-dim-fill" style="width:${pct}%;background:${dimColor(v || 0)}"></div></div><span class="pg-dim-val">${valTxt}</span></div>`;
    }).join('');
    dimHtml += '</div>';
  } else {
    dimHtml = '<div class="pg-card"><div class="pg-card-title">💬 Chat 四维均分</div><div class="pg-empty">还没有对话评分。去 Chat 模块聊几句，AI 会给你的回答打分。</div></div>';
  }

  // 翻译趋势（最近 20 次，纯 CSS 柱状）
  let trHtml = '<div class="pg-card"><div class="pg-card-title">🌐 翻译得分趋势 <span class="pg-card-note">（最近 ' + Math.min(trPts.length, 20) + ' 次）</span></div>';
  if (trPts.length >= 2) {
    const recent = trPts.slice(-20);
    const max = 10;
    trHtml += '<div class="pg-trend">' + recent.map(p => {
      const h = Math.max(4, Math.round(p.score / max * 64));
      const c = p.score >= 9 ? 'var(--green)' : p.score >= 7 ? 'var(--primary)' : p.score >= 5 ? 'var(--amber)' : 'var(--red)';
      return `<div class="pg-trend-bar" title="${esc(String(p.score))}"><div style="height:${h}px;background:${c}"></div><span>${p.score}</span></div>`;
    }).join('') + '</div>';
    const avg = recent.reduce((s, p) => s + p.score, 0) / recent.length;
    trHtml += `<div class="pg-card-note">平均 ${avg.toFixed(1)} / 10</div>`;
  } else {
    trHtml += '<div class="pg-empty">翻译记录不足 2 条。去 Translation 模块做几道题就有趋势了。</div>';
  }
  trHtml += '</div>';

  // 薄弱点分类分布（横向条）
  let weakHtml = '<div class="pg-card"><div class="pg-card-title">🎯 薄弱点分布（按出错次数）</div>';
  const catEntries = Object.entries(weak.byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (catEntries.length) {
    const maxCount = catEntries[0][1] || 1;
    weakHtml += catEntries.map(([cat, n]) =>
      `<div class="pg-dim"><span class="pg-dim-label">${esc(cat)}</span><div class="pg-dim-bar"><div class="pg-dim-fill" style="width:${Math.round(n / maxCount * 100)}%;background:var(--primary)"></div></div><span class="pg-dim-val">${n}</span></div>`
    ).join('');
  } else {
    weakHtml += '<div class="pg-empty">还没有薄弱点记录。多对话、多练习，AI 会自动归纳你的易错点。</div>';
  }
  weakHtml += '</div>';

  // 最近对话
  const recent = recentConversations(convs, 5);
  let recentHtml = '<div class="pg-card"><div class="pg-card-title">🕘 最近对话</div>';
  if (recent.length) {
    recentHtml += recent.map(c => {
      const d = c.updatedAt ? new Date(c.updatedAt) : null;
      const ds = d ? ((d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')) : '';
      return `<div class="pg-recent"><span class="pg-recent-title">${esc(c.title)}</span><span class="pg-recent-meta">${esc(c.topic ? ' #' + c.topic : '')} ${esc(ds)}</span></div>`;
    }).join('');
  } else {
    recentHtml += '<div class="pg-empty">还没有对话。</div>';
  }
  recentHtml += '</div>';

  el.innerHTML =
    '<div class="pg-stats">' + statCards + '</div>' +
    '<div class="pg-grid">' + dimHtml + weakHtml + trHtml + recentHtml + '</div>';
}
