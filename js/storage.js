/* ============================================================
   AI 英语对话教练 - Storage (SQLite DB-backed + 登录)
   - 服务端 SQLite 为权威数据源，按账户隔离；localStorage 仅作本地缓存
   - 所有 /api/db/* 与代理均带 Authorization: Bearer <token>
============================================================ */

// 同源（Caddy/Nginx 反代 /api → 后端 8091）时为空字符串；
// 若用 file:// 直接双击打开 index.html，则显式指向本地后端（服务端 CORS 已放行 null 来源）
const BACKEND_URL = (typeof location !== 'undefined' && location.protocol === 'file:') ? 'http://localhost:8091' : "";

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

/* ---------- DB CRUD（按登录用户隔离） ----------
   保存必须串行：同一 key 若有请求在途，新数据先进 pending，
   在途请求结束后只发送「最后一份」快照。
   这样可以避免旧快照后到、覆盖服务端较新数据（last-write-wins 回退）。 */
const _saveInflight = {};   // key -> Promise
const _savePending = {};    // key -> 最新待发数据（只保留一份）
// 同步状态（顶栏指示器读取）：pending 在途请求数；failedKeys 当前仍未同步成功的 key 集合；
// lastError 最近一次错误；lastSavedAt 最近一次成功时间。某 key 成功后即从 failedKeys 移除。
const syncStatus = { pending: 0, failedKeys: new Set(), lastError: null, lastSavedAt: null };

async function _saveNow(key, data) {
  try {
    const res = await fetch(BACKEND_URL + '/api/db/' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      syncStatus.failedKeys.add(key);
      syncStatus.lastError = key + ': HTTP ' + res.status;
      console.warn('apiSave rejected:', key, res.status);
      return false;
    }
    syncStatus.failedKeys.delete(key);
    if (syncStatus.failedKeys.size === 0) syncStatus.lastError = null;
    syncStatus.lastSavedAt = new Date().toISOString();
    return true;
  } catch (e) {
    syncStatus.failedKeys.add(key);
    syncStatus.lastError = key + ': ' + e.message;
    console.warn('apiSave failed:', key, e.message);
    return false;
  }
}

function apiSave(key, data) {
  if (_saveInflight[key]) {
    // 已有请求在途：覆盖 pending（只保留最新快照），复用同一条队列
    _savePending[key] = data;
    return _saveInflight[key];
  }
  syncStatus.pending++;
  const run = (async () => {
    let payload = data;
    let ok = true;
    // 循环消费 pending，直到没有新的待发数据
    /* eslint-disable no-constant-condition */
    while (true) {
      ok = await _saveNow(key, payload);
      if (Object.prototype.hasOwnProperty.call(_savePending, key)) {
        payload = _savePending[key];
        delete _savePending[key];
        continue;
      }
      break;
    }
    return ok;
  })();
  _saveInflight[key] = run.finally(() => {
    delete _saveInflight[key];
    syncStatus.pending = Math.max(0, syncStatus.pending - 1);
  });
  return _saveInflight[key];
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

/* ---------- 失败重传（网络恢复 / 点击指示器重试时调用） ----------
   把 localStorage 缓存里的核心集合重新 POST 一遍。只重传这四类有
   固定本地镜像的数据（对话/生词/薄弱点/设置）；头像、角色卡、阅读进度等
   会在下次各自编辑时自然重试。无 token / 离线时直接跳过。 */
async function flushLocalToServer() {
  if (!authToken) return { skipped: true };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { offline: true };
  const tasks = [];
  const parse = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return fallback; } };
  const convs = parse('ai_en_convs', null);
  if (convs && typeof convs === 'object') tasks.push(['conversations', convs]);
  const vocab = parse('ai_en_vocab', null);
  if (Array.isArray(vocab)) tasks.push(['vocab', vocab]);
  const weak = parse('ai_en_weak', null);
  if (weak && typeof weak === 'object') tasks.push(['weak', weak]);
  const settings = parse('ai_en_settings_backup', null);
  if (settings && typeof settings === 'object') tasks.push(['settings', settings]);
  const results = await Promise.all(tasks.map(([k, d]) => _saveNow(k, d)));
  return { flushed: results.filter(Boolean).length, total: tasks.length };
}

/* ---------- 高考翻译题库 API ---------- */
async function apiGaokaoExams() {
  try {
    const res = await fetch(BACKEND_URL + '/api/gaokao/exams', { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.warn('apiGaokaoExams failed:', e.message); return null; }
}
async function apiGaokaoExam(name) {
  try {
    const res = await fetch(BACKEND_URL + '/api/gaokao/exam/' + encodeURIComponent(name), { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.warn('apiGaokaoExam failed:', e.message); return null; }
}
async function apiGaokaoPushed() {
  try {
    const res = await fetch(BACKEND_URL + '/api/gaokao/pushed', { headers: authHeaders() });
    if (!res.ok) return { ids: [] };
    return await res.json();
  } catch (e) { return { ids: [] }; }
}
async function apiGaokaoPushToAnki(ids) {
  try {
    const res = await fetch(BACKEND_URL + '/api/gaokao/push-to-anki', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ids })
    });
    return await res.json();
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ---------- 用量与隐私中心 API ---------- */
async function apiUsage(days) {
  try {
    const res = await fetch(BACKEND_URL + '/api/usage?days=' + (days || 30), { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.warn('apiUsage failed:', e.message); return null; }
}
async function apiUsageClear() {
  try {
    const res = await fetch(BACKEND_URL + '/api/usage', { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.warn('apiUsageClear failed:', e.message); return null; }
}
async function apiPrivacy() {
  try {
    const res = await fetch(BACKEND_URL + '/api/privacy', { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.warn('apiPrivacy failed:', e.message); return null; }
}

/* ---------- 本地缓存归属（防止 A 账户缓存被 B 账户读到/回写） ----------
   localStorage 是浏览器级共享的，而账户数据在服务端按 user_id 隔离。
   这里用 owner 标记登记「当前缓存属于谁」：
   - owner 与当前登录用户不一致 → 先清空全部用户态缓存，再从服务端 hydration
   - owner 缺失（老版本升级） → 视为当前用户，保留现有缓存，仅补写标记 */
const CACHE_OWNER_KEY = 'ai_en_cache_owner';
// 用户态缓存的固定 key（不含 ai_en_setting_* 前缀键，另行处理）
const USER_CACHE_KEYS = [
  'ai_en_convs', 'ai_en_vocab', 'ai_en_weak', 'ai_en_current_conv',
  'ai_en_settings_backup', 'ai_en_backup_latest', 'ai_en_backup_history',
  'ai_en_dict_history', 'ai_en_mode', 'ai_en_game_tab', 'ai_en_practice_tab', 'ai_en_anki_tasks'
];

function clearUserCache() {
  try {
    USER_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
    // 所有 ai_en_setting_* 偏好（角色、Anki 开关、阅读、翻译规则等）
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ai_en_setting_')) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

/* 在 hydration 之前调用：确认缓存归属，必要时清空 */
function ensureCacheOwner(username) {
  if (!username) return;
  let owner = null;
  try { owner = localStorage.getItem(CACHE_OWNER_KEY); } catch (e) {}
  if (owner && owner !== username) {
    clearUserCache();
  }
  try { localStorage.setItem(CACHE_OWNER_KEY, username); } catch (e) {}
}

/* 登录后：从 DB 加载数据到本地缓存
   服务端返回 null 时必须写入空默认值，不能保留旧值（否则会残留上一账户数据） */
async function loadUserData() {
  ensureCacheOwner(currentUser());

  const convs = await apiLoad('conversations');
  localStorage.setItem('ai_en_convs', JSON.stringify(convs && typeof convs === 'object' && !Array.isArray(convs) ? convs : {}));

  const vocab = await apiLoad('vocab');
  localStorage.setItem('ai_en_vocab', JSON.stringify(Array.isArray(vocab) ? vocab : []));

  const weak = await apiLoad('weak');
  localStorage.setItem('ai_en_weak', JSON.stringify(weak && typeof weak === 'object' && !Array.isArray(weak) ? weak : {}));

  const settings = await apiLoad('settings');
  const settingsObj = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  localStorage.setItem('ai_en_settings_backup', JSON.stringify(settingsObj));
  // 服务端 settings 展开写入真实 setting 键（此前只写 backup，导致设置无法跨浏览器恢复）
  hydrateSettingsFromServer(settingsObj);

  // Anki 任务队列（换设备/换浏览器时也能继续补发未完成的推送）
  const ankiTasks = await apiLoad('anki_tasks');
  localStorage.setItem('ai_en_anki_tasks', JSON.stringify(Array.isArray(ankiTasks) ? ankiTasks : []));

  const avatar = await apiLoad('avatar');
  setSetting('avatar', typeof avatar === 'string' ? avatar : '');

  const characters = await apiLoad('characters');
  setSetting('characters', Array.isArray(characters) ? characters : []);

  const strategist = await apiLoad('strategist');
  setSetting('strategistInstructions', Array.isArray(strategist) ? strategist : []);
  return true;
}

/* settings 对象 → ai_en_setting_* 键。current_conv 单独处理（不是偏好项） */
function hydrateSettingsFromServer(settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object') return;
  for (const [k, v] of Object.entries(settingsObj)) {
    if (k === 'current_conv') {
      if (v) localStorage.setItem('ai_en_current_conv', String(v));
      continue;
    }
    if (v === undefined) continue;
    setSetting(k, v);
  }
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
  // current_conv 一并持久化到 DB settings。
  // 必须同时更新本地 backup 快照，否则下次读到的是旧快照，会把新保存的设置覆盖回去。
  const settings = getSettingsBackup();
  settings.current_conv = id || null;
  saveSettingsBackup(settings);
  apiSave('settings', settings);
}
function getSettingsBackup() {
  try { return JSON.parse(localStorage.getItem('ai_en_settings_backup') || '{}'); } catch(e) { return {}; }
}
function saveSettingsBackup(settings) {
  try { localStorage.setItem('ai_en_settings_backup', JSON.stringify(settings || {})); } catch (e) {}
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
