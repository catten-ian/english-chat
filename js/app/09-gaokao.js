/* ============================================================
   AI 英语对话教练 — 高考翻译题库浏览与推送
   由 js/app.js 拆分而来（原 3643-3828 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- Gaokao Translation Question Bank ---------- */
let _gaokaoExams = [];
let _gaokaoPushed = new Set();
let _gaokaoSearch = '';
let _gaokaoCurrentExam = null;

async function loadGaokaoList(force) {
  // 如果当前在翻译题库模式，调用 renderTrBankPanel
  const modeEl = document.getElementById('bankModeSel');
  if (modeEl && modeEl.value === 'translate') {
    renderTrBankPanel();
    bindTrBankSearch();
    return;
  }
  if (!isAuthed()) return;
  const el = document.getElementById('gaokaoList');
  if (el) el.innerHTML = '<div class="empty" style="padding:18px 0">⏳ 加载中...</div>';
  const data = await apiGaokaoExams();
  if (!data) { if (el) el.innerHTML = '<div class="empty" style="color:var(--red)">❌ 加载失败</div>'; return; }
  _gaokaoExams = data.exams || [];
  const pushedData = await apiGaokaoPushed();
  _gaokaoPushed = new Set(pushedData.ids || []);
  renderGaokaoList();
  const sEl = document.getElementById('gaokaoSearch');
  if (sEl && !sEl._bound) {
    sEl._bound = true;
    sEl.addEventListener('input', e => { _gaokaoSearch = e.target.value.trim(); renderGaokaoList(); });
  }
}

function bindTrBankSearch() {
  const s = document.getElementById('bankSearch');
  if (s && !s._bound) {
    s._bound = true;
    // oninput 已写在 HTML 上，这里不再重复绑定
  }
}

function renderGaokaoList() {
  const el = document.getElementById('gaokaoList');
  if (!el) return;
  if (!_gaokaoExams.length) { el.innerHTML = '<div class="empty" style="padding:18px 0">题库为空</div>'; return; }
  const search = _gaokaoSearch.toLowerCase();
  const filtered = _gaokaoExams.filter(e => {
    if (!search) return true;
    return (e.exam || '').toLowerCase().includes(search) || (e.year || '').includes(search);
  });
  if (!filtered.length) { el.innerHTML = '<div class="empty">无匹配结果</div>'; return; }
  // 按年份倒序、分组显示
  const byYear = {};
  for (const e of filtered) {
    const y = e.year || '其他';
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(e);
  }
  let html = `<div style="font-size:12px;color:var(--text2);padding:4px 0">共 ${_gaokaoExams.length} 套试卷 / ${filtered.length} 匹配</div>`;
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
  for (const y of years) {
    html += `<div style="font-weight:700;color:var(--primary);margin:8px 0 4px;font-size:13px">📅 ${y}年 (${byYear[y].length}套)</div>`;
    for (const e of byYear[y]) {
      const pushedCount = e.first_id && e.last_id ? Math.max(0, e.last_id - e.first_id + 1 - countUnpushedInExam(e)) : 0;
      // 简单标记：每套的 first_id 在 _gaokaoPushed 中则认为已部分推送
      const isPushed = _gaokaoPushed.has(e.first_id);
      html += `<div class="gaokao-exam-item" data-action="open-gaokao-exam" data-arg1="${esc(e.exam).replace(/'/g, "&#39;")}" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;cursor:pointer;font-size:12px;background:${isPushed ? '#f0f9ff' : '#fff'};position:relative">
        <div style="font-weight:600">${esc(e.exam)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${e.q_count} 道翻译题 ${isPushed ? '<span style="color:var(--green);margin-left:6px">✓ 已推送</span>' : ''}</div>
      </div>`;
    }
  }
  el.innerHTML = html;
}

function countUnpushedInExam(exam) {
  return exam.last_id - exam.first_id + 1;
}

async function openGaokaoExam(examName) {
  _gaokaoCurrentExam = examName;
  const list = document.getElementById('gaokaoList');
  const detail = document.getElementById('gaokaoDetail');
  if (list) list.style.display = 'none';
  if (detail) {
    detail.style.display = '';
    detail.innerHTML = '<div class="empty" style="padding:20px 0">⏳ 加载题目...</div>';
  }
  const data = await apiGaokaoExam(examName);
  if (!data) { if (detail) detail.innerHTML = '<div class="empty" style="color:var(--red)">❌ 加载失败</div>'; return; }
  renderGaokaoDetail(data);
}

function renderGaokaoDetail(data) {
  const detail = document.getElementById('gaokaoDetail');
  if (!detail) return;
  const allPushed = data.questions.every(q => _gaokaoPushed.has(q.id));
  let html = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
    <button data-action="back-gaokao-list" style="padding:4px 10px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;font-size:12px">← 返回列表</button>
    <div style="flex:1;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(data.exam)}">${esc(data.exam)}</div>
  </div>
  <div style="font-size:11px;color:var(--text2);margin-bottom:8px">${data.questions.length} 道翻译题</div>
  <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
    <button id="gaokaoPushAllBtn" data-action="gaokao-push-all" data-arg1="${esc(data.exam).replace(/'/g, "&#39;")}" style="padding:6px 12px;border:none;background:var(--primary);color:#fff;border-radius:6px;cursor:pointer;font-size:12px;flex:1">📤 全部推送到 Anki</button>
    <button data-action="gaokao-mark-opened" style="padding:6px 12px;border:1px solid var(--border);background:#fff;border-radius:6px;cursor:pointer;font-size:12px">🔄 刷新状态</button>
  </div>
  <div id="gaokaoQuestions">`;
  for (const q of data.questions) {
    const pushed = _gaokaoPushed.has(q.id);
    const words = Array.isArray(q.q_words) ? q.q_words : [];
    const wordsHtml = words.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;align-items:center">' +
          '<span style="font-size:10px;color:var(--text2)">🔑 必用词</span>' +
          words.map(w => '<span style="font-size:11px;padding:1px 7px;border-radius:10px;background:#fef3c7;color:#92400e;border:1px solid #fde68a">' + esc(w) + '</span>').join('') +
        '</div>'
      : '';
    html += `<div class="gaokao-q-item" style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:${pushed ? '#f0fdf4' : '#ffffff'};position:relative">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="font-weight:600;color:var(--primary);font-size:12px">#${esc(q.q_no)}</span>
        ${pushed ? '<span style="font-size:10px;color:var(--green);background:#dcfce7;padding:1px 6px;border-radius:4px">✓ 已推 Anki</span>' : ''}
      </div>
      ${wordsHtml}
      <div style="font-size:13px;line-height:1.6;margin-bottom:6px">${esc(q.q_text)}</div>
      <details style="margin-top:6px">
        <summary style="cursor:pointer;font-size:11px;color:var(--primary);user-select:none">🔍 显示参考答案</summary>
        <div style="font-size:13px;line-height:1.6;margin-top:6px;padding:8px;background:var(--primary-bg);border-radius:6px">${esc(q.a_text)}</div>
      </details>
      ${pushed ? '' : `<button data-action="gaokao-push-one" data-arg1="${q.id}" style="margin-top:6px;padding:4px 10px;border:none;background:var(--green);color:#fff;border-radius:6px;cursor:pointer;font-size:11px">📤 推送</button>`}
    </div>`;
  }
  html += '</div>';
  detail.innerHTML = html;
}

function backToGaokaoList() {
  _gaokaoCurrentExam = null;
  const list = document.getElementById('gaokaoList');
  const detail = document.getElementById('gaokaoDetail');
  if (list) list.style.display = '';
  if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
}

async function gaokaoRefreshPushed() {
  const pushedData = await apiGaokaoPushed();
  _gaokaoPushed = new Set(pushedData.ids || []);
}

async function gaokaoPushOne(id) {
  toastMsg('⏳ 推送到 Anki...');
  const r = await apiGaokaoPushToAnki([id]);
  if (r && r.ok) {
    toastMsg(`✅ 已添加 ${r.added} 张到 Anki`);
    await gaokaoRefreshPushed();
    if (_gaokaoCurrentExam) {
      const data = await apiGaokaoExam(_gaokaoCurrentExam);
      if (data) renderGaokaoDetail(data);
    }
  } else {
    toastMsg('❌ 推送失败：' + (r && r.error ? r.error : '未知错误'));
  }
}

async function gaokaoPushAll(examName) {
  if (!confirm('确定把这套试卷所有翻译题推送到 Anki？')) return;
  const data = await apiGaokaoExam(examName);
  if (!data) return;
  const ids = data.questions.filter(q => !_gaokaoPushed.has(q.id)).map(q => q.id);
  if (!ids.length) { toastMsg('没有需要推送的题（都已推送）'); return; }
  toastMsg('⏳ 批量推送中...');
  // 分批 5 题
  let total = 0, skipped = 0;
  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5);
    const r = await apiGaokaoPushToAnki(batch);
    if (r && r.ok) { total += r.added; skipped += r.skipped; }
  }
  toastMsg(`✅ 已添加 ${total} 张${skipped ? '，跳过 ' + skipped + ' 张重复' : ''}`);
  await gaokaoRefreshPushed();
  const fresh = await apiGaokaoExam(examName);
  if (fresh) renderGaokaoDetail(fresh);
  renderGaokaoList();
}

function gaokaoMarkOpened() {
  if (_gaokaoCurrentExam) {
    apiGaokaoExam(_gaokaoCurrentExam).then(d => { if (d) renderGaokaoDetail(d); });
  }
}
