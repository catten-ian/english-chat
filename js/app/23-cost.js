/* ============================================================
   AI 英语对话教练 — 成本与隐私中心
   由 js/app.js 拆分而来（新增切片，内容为全新代码）。

   两件事：
   1) 成本：外部 API 用量（MiniMax token / ElevenLabs 字符 / 联网次数）
      按天与按用途聚合展示。数据来自服务端 usage_log 表。
   2) 隐私：把「哪些数据发给了谁、本地存了什么」讲清楚，并提供
      「清除用量记录」入口。

   只定义函数、无顶层副作用，放在 19-init 之后加载安全。
   ============================================================ */

let costCenterDays = 30;   // 当前查看的时间范围
let costCenterCache = null;

/* ---------- 工具 ---------- */
function fmtNum(n) {
  const v = Number(n || 0);
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return String(v);
}

/* MiniMax / ElevenLabs 的粗略单价（仅用于「量级感知」，不是账单）。
   放在前端设置里可改：用户可按自己的实际套餐调整。 */
function unitPrices() {
  return {
    // 元 / 千 token（MiniMax-M3 文本，按公开价量级取值）
    minimaxPerKTokenCNY: parseFloat(getSetting('costMinimaxPerKToken', 0.008)) || 0,
    // 元 / 千字符（ElevenLabs 按订阅计，这里折算一个粗略值）
    elevenPerKCharCNY: parseFloat(getSetting('costElevenPerKChar', 1.5)) || 0,
    // 元 / 次（联网搜索）
    searchPerCallCNY: parseFloat(getSetting('costSearchPerCall', 0.02)) || 0
  };
}

function estimateCost(summary) {
  if (!summary) return null;
  const p = unitPrices();
  let tokens = 0, chars = 0, searches = 0;
  for (const row of summary.byProvider || []) {
    if (row.provider === 'elevenlabs') chars += row.chars || 0;
    else if (row.kind === 'websearch') searches += row.requests || 0;
    else tokens += row.tokens || 0;
  }
  const tokenCost = tokens / 1000 * p.minimaxPerKTokenCNY;
  const charCost = chars / 1000 * p.elevenPerKCharCNY;
  const searchCost = searches * p.searchPerCallCNY;
  return {
    tokens, chars, searches,
    tokenCost, charCost, searchCost,
    total: tokenCost + charCost + searchCost
  };
}

const KIND_LABELS = {
  chat: '对话（非流式）',
  chat_stream: '对话（流式）',
  websearch: '联网搜索',
  tts: '语音朗读'
};

/* ---------- 渲染 ---------- */
async function renderCostCenter() {
  const el = document.getElementById('costDashboard');
  if (!el) return;
  el.innerHTML = '<div class="cc-loading">⏳ 正在加载用量数据…</div>';

  const [summary, privacy] = await Promise.all([apiUsage(costCenterDays), apiPrivacy()]);
  costCenterCache = summary;
  if (!summary) {
    el.innerHTML = '<div class="cc-empty">用量数据加载失败（请确认已登录、后端在运行）。</div>';
    return;
  }

  const est = estimateCost(summary);
  const rangeBtns = [7, 30, 90].map(d =>
    `<button class="a-btn small${d === costCenterDays ? ' primary' : ''}" data-action="cost-range" data-arg1="${d}">近 ${d} 天</button>`
  ).join('');

  // 概览卡
  const cards = [
    { label: '🔢 LLM Token', value: fmtNum(summary.totals.tokens), sub: `输入 ${fmtNum(summary.totals.promptTokens)} / 输出 ${fmtNum(summary.totals.completionTokens)}` },
    { label: '🔊 TTS 字符', value: fmtNum(summary.totals.chars), sub: 'ElevenLabs 按字符计费' },
    { label: '📞 API 调用', value: fmtNum(summary.totals.calls), sub: `今日 ${fmtNum(summary.today.requests)} 次` },
    { label: '💰 估算花费', value: '¥' + (est ? est.total.toFixed(2) : '0.00'), sub: '按下方单价粗算，非账单' }
  ].map(c =>
    `<div class="cc-stat"><div class="cc-stat-label">${esc(c.label)}</div><div class="cc-stat-value">${esc(c.value)}</div><div class="cc-stat-sub">${esc(c.sub)}</div></div>`
  ).join('');

  let html = `<div class="cc-head">
    <span class="cc-title">💰 成本与隐私中心</span>
    <span class="cc-actions">${rangeBtns}</span>
  </div>`;
  html += `<div class="cc-note">统计区间：${esc(summary.since)} 起，共 ${summary.days} 天</div>`;
  html += '<div class="cc-stats">' + cards + '</div>';

  html += '<div class="cc-grid">';

  // 按用途拆分
  html += '<div class="cc-card"><div class="cc-card-title">📊 按用途拆分</div>';
  if ((summary.byProvider || []).length) {
    const maxTok = Math.max(1, ...summary.byProvider.map(r => r.tokens || r.chars || r.requests || 0));
    html += summary.byProvider.map(r => {
      const label = (KIND_LABELS[r.kind] || r.kind) + ' · ' + r.provider;
      const metric = r.provider === 'elevenlabs'
        ? fmtNum(r.chars) + ' 字符'
        : (r.kind === 'websearch' ? fmtNum(r.requests) + ' 次' : fmtNum(r.tokens) + ' tok');
      const w = Math.round((r.tokens || r.chars || r.requests || 0) / maxTok * 100);
      return `<div class="cc-row"><span class="cc-row-label">${esc(label)}</span><div class="cc-row-bar"><div class="cc-row-fill" style="width:${w}%"></div></div><span class="cc-row-val">${esc(metric)}</span></div>`;
    }).join('');
  } else {
    html += '<div class="cc-empty">这段时间还没有外部 API 调用。</div>';
  }
  html += '</div>';

  // 按天趋势
  html += '<div class="cc-card"><div class="cc-card-title">📈 每日 Token 用量</div>';
  const days = (summary.byDay || []).filter(d => d.tokens > 0 || d.requests > 0);
  if (days.length >= 2) {
    const max = Math.max(1, ...days.map(d => d.tokens));
    const recent = days.slice(-30);
    html += '<div class="cc-trend">' + recent.map(d => {
      const h = Math.max(3, Math.round(d.tokens / max * 64));
      const mmdd = d.day.slice(5);
      return `<div class="cc-trend-bar" title="${esc(d.day)}: ${fmtNum(d.tokens)} tok"><div style="height:${h}px"></div><span>${esc(mmdd)}</span></div>`;
    }).join('') + '</div>';
  } else {
    html += '<div class="cc-empty">数据不足 2 天，暂无趋势。</div>';
  }
  html += '</div>';

  // 按模型
  html += '<div class="cc-card"><div class="cc-card-title">🤖 按模型</div>';
  if ((summary.byModel || []).length) {
    html += summary.byModel.map(m =>
      `<div class="cc-row"><span class="cc-row-label">${esc(m.model)}</span><span class="cc-row-val">${fmtNum(m.tokens)} tok · ${fmtNum(m.requests)} 次</span></div>`
    ).join('');
  } else {
    html += '<div class="cc-empty">暂无模型级数据（流式调用被中止时上游不返回 usage）。</div>';
  }
  html += '</div>';

  // 单价设置
  const p = unitPrices();
  html += `<div class="cc-card"><div class="cc-card-title">🏷️ 估价单价（可改）</div>
    <div class="cc-note">这些只用于粗略估算量级，不等于真实账单。请以各服务商控制台为准。</div>
    <div class="cc-price"><label for="ccPriceToken">MiniMax 元/千 token</label>
      <input id="ccPriceToken" type="number" step="0.001" min="0" value="${p.minimaxPerKTokenCNY}" data-action="cost-set-price" data-arg1="costMinimaxPerKToken"></div>
    <div class="cc-price"><label for="ccPriceChar">ElevenLabs 元/千字符</label>
      <input id="ccPriceChar" type="number" step="0.01" min="0" value="${p.elevenPerKCharCNY}" data-action="cost-set-price" data-arg1="costElevenPerKChar"></div>
    <div class="cc-price"><label for="ccPriceSearch">联网搜索 元/次</label>
      <input id="ccPriceSearch" type="number" step="0.001" min="0" value="${p.searchPerCallCNY}" data-action="cost-set-price" data-arg1="costSearchPerCall"></div>`;
  if (est) {
    html += `<div class="cc-note">拆分：Token ¥${est.tokenCost.toFixed(2)} · TTS ¥${est.charCost.toFixed(2)} · 搜索 ¥${est.searchCost.toFixed(2)}</div>`;
  }
  html += '</div>';

  html += '</div>'; // /cc-grid

  // 隐私说明
  html += '<div class="cc-card cc-privacy"><div class="cc-card-title">🔒 数据去了哪里</div>';
  if (privacy) {
    html += '<table class="cc-table"><thead><tr><th>服务</th><th>用途</th><th>发送的数据</th><th>状态</th></tr></thead><tbody>';
    html += (privacy.external || []).map(x =>
      `<tr><td><b>${esc(x.name)}</b><div class="cc-sub">${esc(x.base)}</div></td>
        <td>${esc(x.purpose)}</td>
        <td>${(x.sends || []).map(s => esc(s)).join('<br>')}<div class="cc-sub">${esc(x.note || '')}</div></td>
        <td>${x.configured ? '<span class="cc-ok">已配置</span>' : '<span class="cc-off">未配置</span>'}</td></tr>`
    ).join('');
    html += '</tbody></table>';

    html += '<div class="cc-card-title" style="margin-top:14px">💾 本地存了什么</div><ul class="cc-list">';
    html += (privacy.localData || []).map(d => `<li>${esc(d.what)}<span class="cc-sub"> → ${esc(d.where)}</span></li>`).join('');
    html += '</ul>';

    html += '<div class="cc-card-title" style="margin-top:14px">✅ 已有的保障</div><ul class="cc-list">';
    html += (privacy.guarantees || []).map(g => `<li>${esc(g)}</li>`).join('');
    html += '</ul>';
  } else {
    html += '<div class="cc-empty">隐私信息加载失败。</div>';
  }
  html += `<div class="cc-danger">
    <button class="a-btn small danger" data-action="cost-clear-usage">🗑️ 清除本账户用量记录</button>
    <span class="cc-sub">只删除 usage_log 中的统计数字，不影响对话、生词与设置。</span>
  </div>`;
  html += '</div>';

  el.innerHTML = html;
}

/* ---------- 交互 ---------- */
function setCostRange(days) {
  const d = parseInt(days, 10);
  costCenterDays = [7, 30, 90].includes(d) ? d : 30;
  renderCostCenter();
}

function setCostPrice(key, value) {
  const v = Math.max(0, parseFloat(value) || 0);
  setSetting(key, v);
  // 只重算估价部分，避免整页重渲染丢焦点
  const el = document.getElementById('costDashboard');
  if (!el || !costCenterCache) return;
  const est = estimateCost(costCenterCache);
  const card = el.querySelector('.cc-stats .cc-stat:nth-child(4) .cc-stat-value');
  if (card && est) card.textContent = '¥' + est.total.toFixed(2);
}

async function clearUsageRecords() {
  if (!confirm('确定清除本账户的用量统计记录？\n（只删统计数字，不影响对话/生词/设置）')) return;
  const r = await apiUsageClear();
  if (r && r.status === 'cleared') {
    toastMsg('🗑️ 已清除 ' + (r.removed || 0) + " 条用量记录");
    renderCostCenter();
  } else {
    toastMsg('❌ 清除失败');
  }
}
