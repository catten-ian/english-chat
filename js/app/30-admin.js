/* ============================================================
   Account limits and feedback administration
   Extracted from js/app/ administration features
   ============================================================ */
/* ============================================================
   Account quotas and feedback administration.
   ============================================================ */
'use strict';

function initAdminAccountSettings(modal) {
  apiMe().then(me => { if (modal.isConnected) { const entry = modal.querySelector('#adminEntry'); entry.hidden = me?.role !== 'admin'; entry.style.display = entry.hidden ? 'none' : ''; } }).catch(() => {});
  fetch(BACKEND_URL + '/api/usage?days=1', { headers: authHeaders() }).then(r => {
    if (!r.ok) throw new Error('额度获取失败');
    return r.json();
  }).then(data => {
    if (!modal.isConnected) return;
    const quota = data.quota;
    modal.querySelector('#giftQuotaStatus').textContent = quota?.unlimited ? 'MiniMax M3 站内调用不限次数' : 'MiniMax M3 今日赠送：' + Number(quota?.used || 0) + ' / ' + Number(quota?.daily ?? 100) + ' 次，每分钟最多 ' + Number(quota?.rpm ?? 10) + ' 次';
  }).catch(() => { if (modal.isConnected) modal.querySelector('#giftQuotaStatus').textContent = '赠送额度暂时无法读取'; });
}

async function adminRequest(path, body) {
  const response = await fetch((BACKEND_URL || '') + path, {
    method: body ? 'POST' : 'GET', headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '后台请求失败');
  return result;
}

async function openAdminPanel() {
  removeAllModals();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-card" style="width:min(1000px,calc(100vw - 24px));max-width:1000px;max-height:90dvh"><div class="modal-header"><h3>管理后台</h3><button class="modal-close" data-action="close-overlay" aria-label="关闭">&times;</button></div><div class="modal-body" style="overflow:auto"><div style="display:flex;gap:8px;margin-bottom:12px" role="tablist"><button class="a-btn primary" data-admin-tab="users" role="tab" aria-selected="true">账户与额度</button><button class="a-btn" data-admin-tab="feedback" role="tab" aria-selected="false">用户反馈</button><button class="a-btn" data-admin-refresh>刷新</button></div><div data-admin-error role="alert" style="color:var(--red)"></div><div data-admin-content aria-live="polite">加载中...</div></div></div>';
  document.body.appendChild(overlay);
  let tab = 'users';
  const showError = e => { overlay.querySelector('[data-admin-error]').textContent = e.message; };
  async function load() {
    overlay.querySelector('[data-admin-error]').textContent = '';
    const content = overlay.querySelector('[data-admin-content]');
    content.textContent = '加载中...';
    const selectedTab = tab;
    try {
      const data = await adminRequest(tab === 'users' ? '/api/admin/users' : '/api/admin/feedback');
      if (selectedTab !== tab || !overlay.isConnected) return;
      content.innerHTML = tab === 'users' ? adminUsersMarkup(data.users || []) : adminFeedbackMarkup(data.feedback || []);
    } catch (e) { content.textContent = ''; showError(e); }
  }
  overlay.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !overlay.contains(button)) return;
    if (button.hasAttribute('data-admin-tab')) {
      tab = button.dataset.adminTab;
      overlay.querySelectorAll('[data-admin-tab]').forEach(b => { b.classList.toggle('primary', b === button); b.setAttribute('aria-selected', String(b === button)); });
      await load();
    } else if (button.hasAttribute('data-admin-refresh')) await load();
    else if (button.hasAttribute('data-admin-save-user') || button.hasAttribute('data-admin-save-feedback')) {
      const row = button.closest('[data-admin-row]');
      const field = name => row.querySelector('[name="' + name + '"]').value;
      button.disabled = true;
      try {
        if (button.hasAttribute('data-admin-save-user')) {
          const daily = Number(field('daily_call_limit')); const rpm = Number(field('rpm_limit'));
          if (!Number.isInteger(daily) || daily < 0 || daily > 100000 || !Number.isInteger(rpm) || rpm < 1 || rpm > 1000) throw new Error('每日次数须为 0-100000 的整数，RPM 须为 1-1000 的整数');
          await adminRequest('/api/admin/users/update', { user_id: Number(row.dataset.adminRow), daily_call_limit: daily, rpm_limit: rpm, provider_mode: field('provider_mode'), role: field('role') });
        } else await adminRequest('/api/admin/feedback/update', { id: Number(row.dataset.adminRow), status: field('status'), admin_note: field('admin_note') });
        toastMsg('已保存'); await load();
      } catch (e) { showError(e); } finally { button.disabled = false; }
    }
  });
  await load();
}

function adminUsersMarkup(users) {
  if (!users.length) return '<p>暂无账户</p>';
  return users.map(u => '<section data-admin-row="' + Number(u.id) + '" style="padding:12px 0;border-bottom:1px solid var(--border)"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><strong>' + esc(u.username) + '</strong><span>' + (u.soft_deleted_at ? '已停用' : '正常') + '</span><span>今日赠送：' + (u.quota?.unlimited ? '不限' : Number(u.quota?.used || 0) + ' / ' + Number(u.daily_call_limit)) + '</span><span>总调用：' + Number(u.today_requests) + '</span></div><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end"><label>每日赠送次数<br><input name="daily_call_limit" aria-label="' + esc(u.username) + ' 每日赠送次数" type="number" min="0" max="100000" step="1" value="' + Number(u.daily_call_limit) + '" style="width:120px"></label><label>每分钟次数<br><input name="rpm_limit" type="number" min="1" max="1000" step="1" value="' + Number(u.rpm_limit) + '" style="width:100px"></label><label>提供商模式<br><select name="provider_mode"><option value="gift"' + (u.provider_mode === 'gift' ? ' selected' : '') + '>站内赠送</option><option value="custom"' + (u.provider_mode === 'custom' ? ' selected' : '') + '>个人配置</option></select></label><label>权限<br><select name="role"><option value="user"' + (u.role !== 'admin' ? ' selected' : '') + '>用户</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>管理员</option></select></label><button class="a-btn primary" data-admin-save-user>保存</button></div></section>').join('');
}

function adminFeedbackMarkup(rows) {
  if (!rows.length) return '<p>暂无反馈</p>';
  const statuses = { open: '待处理', in_progress: '处理中', resolved: '已解决', closed: '已关闭' };
  return rows.map(f => '<section data-admin-row="' + Number(f.id) + '" style="padding:12px 0;border-bottom:1px solid var(--border)"><strong>' + esc(f.title || f.type) + '</strong><div style="font-size:12px;color:var(--text2)">' + esc(f.username) + ' &middot; ' + esc(f.created_at) + '</div><p style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(f.body) + '</p><label>状态 <select name="status">' + Object.entries(statuses).map(([value, label]) => '<option value="' + value + '"' + (f.status === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label><label style="display:block;margin-top:8px">回复<textarea name="admin_note" rows="3" maxlength="5000" style="display:block;width:100%;box-sizing:border-box">' + esc(f.admin_note || '') + '</textarea></label><button class="a-btn primary" data-admin-save-feedback style="margin-top:8px">保存回复</button></section>').join('');
}

registerAction('open-admin', function () { openAdminPanel(); });
