/* ============================================================
   User-specific provider credentials editor; secrets stay on the server.
   Extracted from js/app/12-settings.js.
============================================================ */
async function initProviderCredentials() {
  const selector = document.getElementById('setCredentialProvider');
  const status = document.getElementById('providerConfigStatus');
  if (!selector || !status) return;
  let entries = [];
  async function refresh() {
    const response = await apiFetch('/api/providers', { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取配置失败');
    entries = [...data.providers, ...data.search];
    populate();
  }
  function populate() {
    const entry = entries.find(item => item.id === selector.value);
    document.getElementById('setCredentialBase').value = entry?.base || '';
    document.getElementById('setCredentialModel').value = entry?.model || '';
    document.getElementById('setCredentialKey').value = '';
    status.textContent = entry?.personal ? '已保存个人密钥（仅服务器存储）' : '使用站点配置';
  }
  async function save(remove) {
    const button = document.getElementById(remove ? 'removeCredentialBtn' : 'saveCredentialBtn');
    button.disabled = true;
    status.textContent = '保存中...';
    try {
      const response = await apiFetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ provider: selector.value, base: document.getElementById('setCredentialBase').value,
          model: document.getElementById('setCredentialModel').value, key: document.getElementById('setCredentialKey').value, remove }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      await refresh();
    } catch (e) { status.textContent = e.message; }
    finally { button.disabled = false; }
  }
  selector.addEventListener('change', populate);
  document.getElementById('saveCredentialBtn').addEventListener('click', () => save(false));
  document.getElementById('removeCredentialBtn').addEventListener('click', () => save(true));
  try { await refresh(); } catch (e) { status.textContent = e.message; }
}
