/* ============================================================
   反馈与建议：提交、历史记录和后台状态回写
   由 js/app.js 拆分而来
   ============================================================ */
'use strict';
async function openFeedbackForm() {
  removeAllModals();
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const modal = document.createElement('div'); modal.className = 'modal-card'; modal.style.maxWidth = '520px';
  modal.innerHTML = '<div class="modal-header"><h3>反馈与建议</h3><button class="modal-close" data-action="close-overlay">×</button></div><div class="modal-body"><select id="feedbackType" style="width:100%;padding:8px;margin-bottom:8px"><option value="suggestion">功能建议</option><option value="bug">故障反馈</option><option value="question">使用问题</option></select><input id="feedbackTitle" placeholder="标题（可选）" style="width:100%;box-sizing:border-box;padding:8px;margin-bottom:8px"><textarea id="feedbackBody" rows="7" placeholder="请描述你的建议、问题或复现步骤" style="width:100%;box-sizing:border-box;padding:8px"></textarea><div id="feedbackHistory" style="margin-top:12px"></div><button data-action="submit-feedback" class="a-btn primary" style="margin-top:10px">提交</button></div>';
  overlay.appendChild(modal); document.body.appendChild(overlay); renderFeedbackHistory();
}
async function submitFeedback() {
  const body = document.getElementById('feedbackBody')?.value.trim(); if (!body) return toastMsg('请填写反馈内容');
  const res = await fetch((BACKEND_URL || '') + '/api/feedback', { method:'POST', headers:{'Content-Type':'application/json', ...authHeaders()}, body:JSON.stringify({ type:document.getElementById('feedbackType').value, title:document.getElementById('feedbackTitle').value, body }) });
  if (!res.ok) return toastMsg('提交失败'); toastMsg('反馈已提交'); document.getElementById('feedbackBody').value=''; renderFeedbackHistory();
}
async function renderFeedbackHistory() {
  const el = document.getElementById('feedbackHistory'); if (!el) return;
  const res = await fetch((BACKEND_URL || '') + '/api/feedback', { headers: authHeaders() }); if (!res.ok) return;
  const data = await res.json(); el.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:6px">历史反馈</div>' + (data.feedback || []).map(x => '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><b>' + esc(x.title || x.type) + '</b><span style="float:right">' + esc(x.status) + '</span><div>' + esc(x.body).slice(0,160) + '</div>' + (x.admin_note ? '<div style="color:var(--primary)">回复：' + esc(x.admin_note) + '</div>' : '') + '</div>').join('');
}
