/* ============================================================
   AI 英语对话教练 - Storage (SQLite DB-backed + 登录)
   - 服务端 SQLite 为权威数据源，按账户隔离；localStorage 仅作本地缓存
   - 所有 /api/db/* 与代理均带 Authorization: Bearer <token>
============================================================ */

const BACKEND_URL = "";  // 同源：Caddy/Nginx 反代 /api → 后端 8091

/* ---------- Auth ---------- */
let authToken = localStorage.getItem('ai_en_token') || sessionStorage.getItem('ai_en_token') || null;
let authUser = localStorage.getItem('ai_en_user') || sessionStorage.getItem('ai_en_user') || null;

function authHeaders() {
  return authToken ? { 'Authorization': 'Bearer ' + authToken } : {};
}
function isAuthed() { return !!authToken; }
function currentUser() { return authUser; }
// remember=true → token 存 localStorage（跨会话保持登录）；否则存 sessionStorage（关标签即登出）
function setAuth(token, user, remember) {
  authToken = token;
  authUser = user;
  const rm = typeof remember === 'boolean' ? remember
    : !!(typeof document !== 'undefined' && document.getElementById('loginRemember') && document.getElementById('loginRemember').checked);
  if (token) {
    if (rm) {
      localStorage.setItem('ai_en_token', token);
      localStorage.setItem('ai_en_user', user || '');
      sessionStorage.removeItem('ai_en_token');
      sessionStorage.removeItem('ai_en_user');
    } else {
      sessionStorage.setItem('ai_en_token', token);
      sessionStorage.setItem('ai_en_user', user || '');
      localStorage.removeItem('ai_en_token');
      localStorage.removeItem('ai_en_user');
    }
  } else {
    localStorage.removeItem('ai_en_token');
    localStorage.removeItem('ai_en_user');
    sessionStorage.removeItem('ai_en_token');
    sessionStorage.removeItem('ai_en_user');
  }
}
function logoutLocal() { setAuth(null, null); }

async function apiLogin(username, password) {
  const res = await fetch(BACKEND_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '登录失败（HTTP ' + res.status + '）');
  setAuth(data.token, data.username);
  return data;
}
async function apiLogout() {
  try { await fetch(BACKEND_URL + '/api/auth/logout', { method: 'POST', headers: authHeaders() }); } catch (e) {}
  logoutLocal();
}
async function apiMe() {
  const res = await fetch(BACKEND_URL + '/api/auth/me', { headers: authHeaders() });
  if (!res.ok) return null;
  return await res.json();
}

/* ---------- 修改密码 ---------- */
async function apiChangePassword(oldPassword, newPassword) {
  const res = await fetch(BACKEND_URL + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '修改密码失败（HTTP ' + res.status + '）');
  return data;
}

/* ---------- DB CRUD（按登录用户隔离） ---------- */
async function apiSave(key, data) {
  try {
    const res = await fetch(BACKEND_URL + '/api/db/' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) {
    console.warn('apiSave failed:', key, e.message);
    return false;
  }
}
async function apiLoad(key) {
  try {
    const res = await fetch(BACKEND_URL + '/api/db/' + key, { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('apiLoad failed:', key, e.message);
    return null;
  }
}

/* 登录后：从 DB 加载数据到本地缓存 */
async function loadUserData() {
  const convs = await apiLoad('conversations');
  if (convs && typeof convs === 'object') localStorage.setItem('ai_en_convs', JSON.stringify(convs));
  const vocab = await apiLoad('vocab');
  if (Array.isArray(vocab)) localStorage.setItem('ai_en_vocab', JSON.stringify(vocab));
  const weak = await apiLoad('weak');
  if (weak && typeof weak === 'object') localStorage.setItem('ai_en_weak', JSON.stringify(weak));
  const settings = await apiLoad('settings');
  if (settings && typeof settings === 'object') localStorage.setItem('ai_en_settings_backup', JSON.stringify(settings));
  const avatar = await apiLoad('avatar');
  if (avatar) setSetting('avatar', avatar);
  const characters = await apiLoad('characters');
  if (Array.isArray(characters)) setSetting('characters', characters);
  const strategist = await apiLoad('strategist');
  if (Array.isArray(strategist)) setSetting('strategistInstructions', strategist);
  return true;
}

/* ---------- Vocabulary ---------- */
function getVocab() {
  try { return JSON.parse(localStorage.getItem('ai_en_vocab') || '[]'); } catch(e) { return []; }
}
function saveVocab(v) {
  localStorage.setItem('ai_en_vocab', JSON.stringify(v));
  apiSave('vocab', v);
}

/* ---------- Weak Points ----------
   新格式（v2，含排程/Anki 关联字段）：
   {
     "wp_xxx": {
       "id": "wp_xxx",
       "category": "grammar",        // grammar|collocation|vocabulary|语法搭配...
       "point": "第三人称单数动词加-s",
       "suggestion": "he/she/it 后的动词要加 -s 或 -es",
       "count": 5,                    // 累计出错次数
       "interval": 1,                 // 当前复习间隔（天）
       "ease": 2.5,                   // 难度系数
       "streak": 0,                   // 连续掌握次数
       "last_quizzed": null,          // 上次复习时间 ISO
       "anki_notes": [],              // 关联的 Anki note id 列表（题目卡）
       "archived": false,             // 是否已掌握归档
       "created_at": "2026-..."
     }
   }
   旧格式（v1，key 形如 "语法搭配|he/she/it 加-s"）读取时会自动迁移为 v2。
*/
function getWeak() {
  let w;
  try { w = JSON.parse(localStorage.getItem('ai_en_weak') || '{}'); } catch(e) { w = {}; }
  if (w && typeof w === 'object' && !Array.isArray(w)) {
    // 检测 v1 旧格式（存在含 | 的 key）并迁移
    let migrated = false;
    const out = {};
    for (const [k, v] of Object.entries(w)) {
      if (k.includes('|') && v && typeof v === 'object') {
        out['wp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)] = migrateWeakPoint(v, k);
        migrated = true;
      } else {
        out[k] = v;
      }
    }
    if (migrated) {
      saveWeak(out);
      return out;
    }
  }
  return w && typeof w === 'object' ? w : {};
}

function migrateWeakPoint(v, oldKey) {
  const parts = oldKey.split('|');
  const category = parts[0] || v.category || '语法搭配';
  const point = parts.length > 1 ? parts.slice(1).join('|') : (v.point || '');
  return {
    id: 'wp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    category: category,
    point: point,
    suggestion: v.suggestion || '',
    count: v.count || 1,
    interval: 1,
    ease: 2.5,
    streak: 0,
    last_quizzed: null,
    anki_notes: [],
    archived: false,
    created_at: new Date().toISOString()
  };
}

/* 所有薄弱点（数组形式，按 count 降序） */
function getAllWeakPoints() {
  const w = getWeak();
  return Object.values(w).sort((a, b) => (b.count || 0) - (a.count || 0));
}

/* 按 id 取单个薄弱点 */
function getWeakPointById(id) {
  const w = getWeak();
  return w[id] || null;
}

/* 更新单个薄弱点 */
function upsertWeakPoint(wp) {
  const w = getWeak();
  if (!wp || !wp.id) return;
  w[wp.id] = wp;
  saveWeak(w);
}

function saveWeak(w) {
  localStorage.setItem('ai_en_weak', JSON.stringify(w));
  apiSave('weak', w);
}

function addWeakPoint(category, point, suggestion) {
  const w = getWeak();
  // 尝试匹配已有同类别+同内容的薄弱点（v1 遗留 key 也兼容）
  let found = null;
  for (const [k, v] of Object.entries(w)) {
    if (!v || typeof v !== 'object') continue;
    if (v.point === point && v.category === category) { found = v; break; }
    // 旧 key 形如 "语法搭配|点"
    if (k.includes('|') && k.split('|').slice(1).join('|') === point && k.split('|')[0] === category) {
      found = migrateWeakPoint(v, k);
      break;
    }
  }
  if (found) {
    found.count = (found.count || 0) + 1;
    if (suggestion && !found.suggestion) found.suggestion = suggestion;
    if (!found.id) { delete w[findKeyByName(w, category, point)]; found.id = 'wp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    w[found.id] = found;
  } else {
    const wp = {
      id: 'wp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      category: category || '语法搭配',
      point: point || '',
      suggestion: suggestion || '',
      count: 1,
      interval: 1,
      ease: 2.5,
      streak: 0,
      last_quizzed: null,
      anki_notes: [],
      archived: false,
      created_at: new Date().toISOString()
    };
    w[wp.id] = wp;
  }
  saveWeak(w);
  renderWeak();
  return found;
}

function findKeyByName(w, category, point) {
  for (const [k, v] of Object.entries(w)) {
    if (v && v.point === point && v.category === category && k.includes('|')) return k;
  }
  return null;
}

/* ---------- Conversations ---------- */
function getAllConversations() {
  try { return JSON.parse(localStorage.getItem('ai_en_convs') || '{}'); } catch(e) { return {}; }
}
function saveAllConversations(convs) {
  localStorage.setItem('ai_en_convs', JSON.stringify(convs));
  apiSave('conversations', convs);
}
function getCurrentConvId() {
  return localStorage.getItem('ai_en_current_conv') || null;
}
function setCurrentConvId(id) {
  if (id) localStorage.setItem('ai_en_current_conv', id);
  else localStorage.removeItem('ai_en_current_conv');
  // current_conv 一并持久化到 DB settings
  const settings = getSettingsBackup();
  settings.current_conv = id || null;
  apiSave('settings', settings);
}
function getSettingsBackup() {
  try { return JSON.parse(localStorage.getItem('ai_en_settings_backup') || '{}'); } catch(e) { return {}; }
}

function generateConvId() {
  return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function createConversation(title, topic) {
  const convs = getAllConversations();
  const id = generateConvId();
  convs[id] = {
    id: id,
    title: title || '新对话',
    topic: topic || 'free',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  saveAllConversations(convs);
  setCurrentConvId(id);
  return id;
}

function saveConversation(messages) {
  const id = getCurrentConvId();
  if (!id) return;
  const convs = getAllConversations();
  if (!convs[id]) return;
  convs[id].messages = messages;
  convs[id].updatedAt = new Date().toISOString();
  // Auto-title from first user message (handle tree structure)
  if (!convs[id].title || convs[id].title === '新对话') {
    const firstUser = findFirstUserContent(messages);
    if (firstUser) {
      convs[id].title = firstUser.replace(/[\\n\\r]+/g, ' ').substring(0, 28) + (firstUser.length > 28 ? '...' : '');
    }
  }
  saveAllConversations(convs);
}

function findFirstUserContent(nodes) {
  if (!nodes) return null;
  for (const n of nodes) {
    const v = n.variants ? n.variants[n.activeVariant || 0] : null;
    const content = v ? v.content : n.content;
    if (n.role === 'user' && content) return content;
    const child = findFirstUserContent(v ? v.next : (n.next || []));
    if (child) return child;
  }
  return null;
}

function deleteConversation(id) {
  const convs = getAllConversations();
  delete convs[id];
  saveAllConversations(convs);
  if (getCurrentConvId() === id) {
    setCurrentConvId(null);
  }
}

function loadConversation(id) {
  const convs = getAllConversations();
  return convs[id] || null;
}

function getConversationTitle(id) {
  const convs = getAllConversations();
  const c = convs[id];
  if (!c) return '未知对话';
  return c.title || '新对话 ' + new Date(c.createdAt).toLocaleDateString();
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
