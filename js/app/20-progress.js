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
      const s = Number(String(r && r.score || '').match(/\d+(?:\.\d+)?/)?.[0] || '0');
      const rawTime = r && r.t;
      const t = typeof rawTime === 'number' ? rawTime : Date.parse(rawTime || '');
      return { t: Number.isFinite(t) ? t : 0, score: s };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => a.t - b.t);
}

const TRANSLATION_TREND_RANGES = [
  { id: '7d', label: '7 天', days: 7 },
  { id: '30d', label: '30 天', days: 30 },
  { id: '90d', label: '90 天', days: 90 },
  { id: '365d', label: '1 年', days: 365 },
  { id: 'all', label: '全部', days: null }
];

function translationScoreBuckets(points, rangeId, now) {
  const range = TRANSLATION_TREND_RANGES.find(item => item.id === rangeId) || TRANSLATION_TREND_RANGES[1];
  const end = Number(now) || Date.now();
  const start = range.days === null ? -Infinity : end - range.days * 86400000;
  const selected = (Array.isArray(points) ? points : []).filter(point => {
    const time = Number(point && point.t);
    return Number.isFinite(time) && time <= end && time >= start && Number(point.score) > 0;
  });
  if (!selected.length) return { range, points: selected, buckets: [] };

  const first = selected[0].t;
  const last = selected[selected.length - 1].t;
  const spanDays = Math.max(1, (last - first) / 86400000);
  const bucketDays = range.id === '7d' ? 1
    : range.id === '30d' ? 3
      : range.id === '90d' ? 7
        : range.id === '365d' ? null : Math.max(1, Math.ceil(spanDays / 20));
  const groups = new Map();
  for (const point of selected) {
    const date = new Date(point.t);
    const key = bucketDays === null
      ? date.getUTCFullYear() + '-' + date.getUTCMonth()
      : String(Math.floor((point.t - (range.id === 'all' ? first : start)) / (bucketDays * 86400000)));
    const bucket = groups.get(key) || { total: 0, count: 0, firstTime: point.t };
    bucket.total += Number(point.score);
    bucket.count++;
    bucket.firstTime = Math.min(bucket.firstTime, point.t);
    groups.set(key, bucket);
  }
  const buckets = [...groups.values()].map(bucket => {
    const date = new Date(bucket.firstTime);
    return {
      score: bucket.total / bucket.count,
      count: bucket.count,
      label: (date.getUTCMonth() + 1) + '/' + date.getUTCDate(),
      time: bucket.firstTime
    };
  });
  return { range, points: selected, buckets };
}

function setTranslationTrendRange(rangeId) {
  if (!TRANSLATION_TREND_RANGES.some(item => item.id === rangeId)) return;
  setSetting('progressTrendRange', rangeId);
  renderProgressDashboard();
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
  const trRangeId = getSetting('progressTrendRange', '30d');
  const trTrend = translationScoreBuckets(translationScores(), trRangeId, Date.now());
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

  // 按时间窗汇总翻译得分，密集记录按日/周/月或动态区间取均值。
  const trendRangeButtons = TRANSLATION_TREND_RANGES.map(range =>
    `<button class="a-btn small${trTrend.range.id === range.id ? ' primary' : ''}" type="button" data-action="progress-trend-range" data-arg1="${range.id}" aria-pressed="${trTrend.range.id === range.id}">${range.label}</button>`
  ).join('');
  let trHtml = '<div class="pg-card"><div class="pg-trend-head"><div class="pg-card-title">🌐 翻译得分趋势 <span class="pg-card-note">（' + trTrend.range.label + ' · ' + trTrend.points.length + ' 次）</span></div><div class="pg-trend-ranges" role="group" aria-label="翻译趋势时间范围">' + trendRangeButtons + '</div></div>';
  if (trTrend.buckets.length) {
    trHtml += '<div class="pg-trend">' + trTrend.buckets.map(bucket => {
      const h = Math.max(4, Math.round(bucket.score / 10 * 64));
      const c = bucket.score >= 9 ? 'var(--green)' : bucket.score >= 7 ? 'var(--primary)' : bucket.score >= 5 ? 'var(--amber)' : 'var(--red)';
      const score = bucket.score.toFixed(1);
      const title = bucket.label + ' · 平均 ' + score + ' 分 · ' + bucket.count + ' 次';
      return `<div class="pg-trend-bar" title="${esc(title)}" aria-label="${esc(title)}"><div style="height:${h}px;background:${c}"></div><span>${score}</span><small>${bucket.label}</small></div>`;
    }).join('') + '</div>';
    const avg = trTrend.points.reduce((sum, point) => sum + point.score, 0) / trTrend.points.length;
    trHtml += `<div class="pg-card-note">区间平均 ${avg.toFixed(1)} / 10</div>`;
  } else {
    trHtml += '<div class="pg-empty">所选时间范围内暂无有效评分。</div>';
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

async function clusterWeakPoints() {
  const points = getAllWeakPoints();
  const res = document.getElementById('weakClusters');
  if (res) res.innerHTML = '<div class="muted">正在分析薄弱点…</div>';
  try {
    const r = await fetch((BACKEND_URL || '') + '/api/weak-points/cluster', { method:'POST', headers:{'Content-Type':'application/json', ...authHeaders()}, body:JSON.stringify({points}) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || '分析失败');
    if (res) res.innerHTML = (data.clusters || []).map(c => '<div class="pf-section"><b>'+esc(c.label)+'</b><span class="muted"> '+c.count+' 个薄弱点</span><div>'+c.points.map(p=>'<span class="tag">'+esc(p.text)+'</span>').join(' ')+'</div></div>').join('') || '<div class="muted">暂无可聚类薄弱点</div>';
  } catch (e) { if (res) res.innerHTML = '<div style="color:var(--red)">'+esc(e.message || '分析失败')+'</div>'; }
}
