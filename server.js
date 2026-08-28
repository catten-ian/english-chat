#!/usr/bin/env node
/* ============================================================
   AI 英语对话教练 - Backend Server (Node.js, 零依赖)
   - SQLite 存储（node:sqlite, WAL），按用户隔离
   - 登录/会话/多用户（PBKDF2 密码哈希，会话 30 天）
   - 代理：MiniMax chat/stream/websearch、ElevenLabs TTS、AnkiConnect
   - 静态白名单 + 127.0.0.1 绑定 + CORS localhost/null（含 /music/ 背景音乐目录）
   - Keys 从环境变量或 ai-english-chat/.env 读取
============================================================ */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

const BASE = __dirname;
// DATA_DIR / DB_PATH 可用环境变量覆盖，便于测试使用临时目录（绝不碰真实 data/app.db）
const DATA_DIR = process.env.AI_EN_DATA_DIR ? path.resolve(process.env.AI_EN_DATA_DIR) : path.join(BASE, 'data');
const MUSIC_DIR = path.join(BASE, 'music');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = process.env.AI_EN_DB_PATH ? path.resolve(process.env.AI_EN_DB_PATH) : path.join(DATA_DIR, 'app.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MUSIC_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* ---- 备份保留策略（多时间节点，避免只留最近一天的密集备份） ----
   每个节点保留"距今最接近该时间"的一份 + 最新一份，其余删除。
   节点：2分钟 / 5分钟 / 10分钟 / 1小时 / 1天 / 2天 / 3天 / 7天 / 30天 */
const BACKUP_RETENTION_MS = [
  2 * 60 * 1000,            // 2 分钟
  5 * 60 * 1000,            // 5 分钟
  10 * 60 * 1000,           // 10 分钟
  60 * 60 * 1000,           // 1 小时
  24 * 60 * 60 * 1000,      // 1 天
  2 * 24 * 60 * 60 * 1000,  // 2 天
  3 * 24 * 60 * 60 * 1000,  // 3 天
  7 * 24 * 60 * 60 * 1000,  // 7 天
  30 * 24 * 60 * 60 * 1000  // 30 天
];
function pruneBackups() {
  let files;
  // 兼容标准名 20260828123456_chat.db 与同秒冲突回退名 20260828123456_123456_chat.db
  try { files = fs.readdirSync(BACKUP_DIR).filter(f => /^\d{14}(?:_\d+)?_chat\.db$/.test(f)); } catch (e) { return; }
  const now = Date.now();
  const items = files.map(f => {
    const ts = f.slice(0, 14);
    const y = +ts.slice(0, 4), mo = +ts.slice(4, 6) - 1, d = +ts.slice(6, 8);
    const h = +ts.slice(8, 10), mi = +ts.slice(10, 12), s = +ts.slice(12, 14);
    return { f, time: Date.UTC(y, mo, d, h, mi, s) };
  }).sort((a, b) => a.time - b.time);
  if (!items.length) return;
  const keep = new Set([items[items.length - 1].f]); // 最新一份必留
  for (const ms of BACKUP_RETENTION_MS) {
    const target = now - ms;
    let best = null, bestDiff = Infinity;
    for (const it of items) {
      const diff = Math.abs(it.time - target);
      if (diff < bestDiff) { bestDiff = diff; best = it; }
    }
    if (best) keep.add(best.f);
  }
  for (const it of items) {
    if (!keep.has(it.f)) { try { fs.unlinkSync(path.join(BACKUP_DIR, it.f)); } catch (e) {} }
  }
}

const MAX_BODY = 24 * 1024 * 1024;
const MAX_USER_DATA = 8 * 1024 * 1024;   // 单个 user_data key 上限
const MAX_ANKI_BODY = 12 * 1024 * 1024;  // Anki 代理请求上限（含 base64 音频）
const PROXY_TIMEOUT = 60000;              // 建连 / 等首字节
const STREAM_IDLE_TIMEOUT = 90000;        // SSE 空闲上限
const STREAM_TOTAL_TIMEOUT = 10 * 60000;  // SSE 总时长上限
const SESSION_TTL_DAYS = 30;

/* user_data 允许的 key → 顶层类型约定（服务端强校验，防止损坏值覆盖有效数据） */
const USER_DATA_KEYS = {
  conversations: 'object',
  vocab: 'array',
  weak: 'object',
  settings: 'object',
  reading: 'object',
  characters: 'array',
  avatar: 'string',
  strategist: 'array'
};
function matchesType(val, expect) {
  if (expect === 'array') return Array.isArray(val);
  if (expect === 'object') return val !== null && typeof val === 'object' && !Array.isArray(val);
  if (expect === 'string') return typeof val === 'string';
  return false;
}

/* ==================== Keys: env > .env ==================== */
function loadEnvFile(p) {
  const out = {};
  try {
    const txt = fs.readFileSync(p, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || m[0].startsWith('#')) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) {}
  return out;
}
const env = { ...loadEnvFile(path.join(BASE, '.env')) };
const MINIMAX_KEY = process.env.MINIMAX_API_KEY || env.MINIMAX_API_KEY || '';
const ELEVEN_KEY = process.env.ELEVEN_API_KEY || env.ELEVEN_API_KEY || '';
const MINIMAX_BASE = process.env.MINIMAX_BASE || env.MINIMAX_BASE || 'https://api.minimaxi.com';

if (!MINIMAX_KEY) console.log('[WARN] MiniMax API key 未配置（ai-english-chat/.env 或环境变量）');
if (!ELEVEN_KEY) console.log('[WARN] ElevenLabs API key 未配置（ai-english-chat/.env 或环境变量）');

const ALLOWED_ORIGINS = new Set(['null', 'http://localhost:8091', 'http://127.0.0.1:8091']);
let _ankiWorkingUrl = null; // AnkiConnect 工作地址缓存
let _backupInFlight = false; // 备份互斥锁（防止同秒同名文件冲突 / 并发 VACUUM）

/* ==================== Database ==================== */
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// 与外部工具（manage_users.py / 备份脚本）并发写时等待锁而不是立刻 SQLITE_BUSY
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA synchronous = NORMAL');

/* ---------- Schema 迁移 ----------
   用 PRAGMA user_version 明确记录 schema 版本，而不是靠捕获 ALTER TABLE 异常猜测。
   每个迁移在单个事务内执行；除「列已存在」外的任何错误都必须让启动失败，
   否则服务会带着半迁移的 schema 继续运行，故障点与根因相隔很远。

   版本历史：
     0 → 1  初始 schema（users / sessions / user_data / gaokao_questions）
     1 → 2  gaokao_questions.q_words 列（旧库补列）
     2 → 3  sessions 改存 token 哈希（token_hash），并加 expires_at 索引
*/
const SCHEMA_VERSION = 3;

function columnExists(table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
  } catch (e) { return false; }
}

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    up() {
      db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_data (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS gaokao_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam TEXT NOT NULL,
  q_no TEXT NOT NULL,
  q_text TEXT NOT NULL,
  a_text TEXT NOT NULL,
  q_words TEXT,
  source_file TEXT,
  exam_year TEXT
);
CREATE INDEX IF NOT EXISTS idx_gaokao_exam ON gaokao_questions(exam);
`);
    }
  },
  {
    version: 2,
    name: 'gaokao_questions.q_words',
    up() {
      if (!columnExists('gaokao_questions', 'q_words')) {
        db.exec('ALTER TABLE gaokao_questions ADD COLUMN q_words TEXT');
      }
    }
  },
  {
    version: 3,
    name: 'sessions.token_hash（不再明文存 token）',
    up() {
      // 明文 token 等同于可直接使用的凭据；数据库/WAL/备份被读到即可冒充用户。
      // 改为只存 SHA-256(token)，原始 token 仅在登录响应中返回一次。
      // 旧的明文 token 无法转换（哈希不可逆），直接清空要求重新登录。
      if (!columnExists('sessions', 'token_hash')) {
        db.exec(`
CREATE TABLE sessions_new (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
DROP TABLE IF EXISTS sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);
      }
    }
  }
];

(function migrate() {
  const cur = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (cur > SCHEMA_VERSION) {
    console.error(`[DB] 数据库 schema 版本 ${cur} 高于本程序支持的 ${SCHEMA_VERSION}，请升级程序后再启动`);
    process.exit(1);
  }
  if (cur === SCHEMA_VERSION) return;

  // 已有数据但 user_version 为 0：说明是迁移体系引入之前的旧库。
  // 此时基线迁移已经由旧版 CREATE TABLE IF NOT EXISTS 建好，仍需逐个跑后续迁移（每步都是幂等的）。
  const legacy = cur === 0 && (() => {
    try { return db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='users'").get().c > 0; }
    catch (e) { return false; }
  })();
  if (legacy) console.log('[DB] 检测到迁移体系之前的旧库，按幂等方式补齐 schema 版本');

  for (const m of MIGRATIONS) {
    if (m.version <= cur) continue;
    db.exec('BEGIN');
    try {
      m.up();
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
      if (!(legacy && m.version === 1)) console.log(`[DB] migration ${m.version} 完成：${m.name}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (re) {}
      console.error(`[DB] migration ${m.version} 失败（${m.name}）：${e.message}`);
      console.error('[DB] 数据库未变更，服务终止。请先修复后再启动。');
      process.exit(1);
    }
  }
  // 启动完整性检查：关键表/列必须存在
  for (const [t, cols] of Object.entries({
    users: ['id', 'username', 'password_hash'],
    sessions: ['token_hash', 'user_id', 'expires_at'],
    user_data: ['user_id', 'key', 'value'],
    gaokao_questions: ['id', 'exam', 'q_words']
  })) {
    for (const c of cols) {
      if (!columnExists(t, c)) {
        console.error(`[DB] schema 校验失败：${t}.${c} 缺失`);
        process.exit(1);
      }
    }
  }
})();

/* 周期性 WAL checkpoint。
   不能只依赖优雅关闭时的 checkpoint：Windows 上直接关闭控制台窗口
   （或任务管理器结束进程）走的是 TerminateProcess，不触发 SIGINT/SIGTERM，
   收尾代码根本不会执行。若不定期并回主库，-wal 会持续增长，
   且「只复制 app.db」得到的会是过旧的状态。
   PASSIVE 模式不会阻塞读写，拿不到锁就跳过，下次再来。 */
function checkpointWal(mode) {
  try {
    db.exec(`PRAGMA wal_checkpoint(${mode || 'PASSIVE'})`);
  } catch (e) {
    console.error('[DB] wal_checkpoint 失败:', e.message);
  }
}

/* 清理过期会话（启动时 + 每天一次），避免 sessions 表与备份无限增长 */
function pruneSessions() {
  try {
    const r = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    const n = Number(r.changes || 0);
    if (n) console.log(`[DB] 清理过期会话 ${n} 条`);
  } catch (e) { console.error('[DB] 清理过期会话失败:', e.message); }
}
pruneSessions();

// 启动时若 gaokao_questions 为空，从 data/gaokao_translations.json 导入
(function seedGaokao() {
  try {
    const fp = path.join(DATA_DIR, 'gaokao_translations.json');
    if (!fs.existsSync(fp)) { console.log('[WARN] gaokao_translations.json 不存在，跳过题库初始化'); return; }
    // 先读取并解析源文件；解析失败直接中止，绝不能先清空旧库
    const raw = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('题库 JSON 结构异常：应为数组');

    const cnt = db.prepare('SELECT COUNT(*) AS c FROM gaokao_questions').get().c;
    // 若库已有数据且含「词」字段，视为已导入，跳过（避免每次启动重复导入）
    const wordsCount = db.prepare("SELECT COUNT(*) AS c FROM gaokao_questions WHERE q_words IS NOT NULL AND q_words != ''").get().c;
    if (cnt > 0 && wordsCount > 0) return;

    // 需要导入 / 重建：把 DELETE 放进与 INSERT 同一个事务，JSON 解析失败时旧数据不受影响
    const insert = db.prepare('INSERT INTO gaokao_questions (exam, q_no, q_text, a_text, q_words, source_file, exam_year) VALUES (?,?,?,?,?,?,?)');
    const count = { exams: 0, questions: 0 };
    db.exec('BEGIN');
    try {
      if (cnt > 0) {
        console.log('[GAOKAO] 旧数据缺少「词」字段，清表重建...');
        db.exec('DELETE FROM gaokao_questions');
      }
      for (const exam of data) {
        const examName = exam['试卷'] || '';
        const sourceFile = exam['原卷文件'] || '';
        // 从试卷名推断年份（例如 "2022届"）
        const m = examName.match(/(\d{4})届/);
        const year = m ? m[1] : '';
        const questions = exam['翻译题'] || {};
        if (typeof questions !== 'object' || questions === null) continue;
        count.exams++;
        for (const [key, q] of Object.entries(questions)) {
          if (!q || typeof q !== 'object') continue;
          // 解析「词」数组 → JSON 字符串（允许词中含引号）
          let wordsJson = '';
          if (Array.isArray(q['词'])) {
            const cleaned = q['词'].map(w => String(w || '').trim()).filter(Boolean);
            if (cleaned.length) wordsJson = JSON.stringify(cleaned);
          }
          insert.run(examName, String(q['题号'] || key), (q['句子'] || q['题目'] || ''), q['答案'] || '', wordsJson, sourceFile, year);
          count.questions++;
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const total = db.prepare('SELECT COUNT(*) AS c FROM gaokao_questions').get().c;
    console.log(`[GAOKAO] 题库初始化完成：导入 ${count.exams} 套试卷，共 ${count.questions} 道题（库内 ${total}）`);
  } catch (e) {
    console.error('[GAOKAO] 题库初始化失败（旧数据未受影响）:', e.message);
  }
})();

// 「词」字段：JSON 字符串 → 数组
function parseWords(s) {
  if (!s) return [];
  try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr : []; }
  catch (e) { return []; }
}

function hashPassword(pwd, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.pbkdf2Sync(pwd, salt, 100000, 32, 'sha256').toString('hex');
  return salt + ':' + h;
}
function verifyPassword(pwd, stored) {
  try {
    const [salt, h] = stored.split(':');
    return crypto.timingSafeEqual(
      Buffer.from(h, 'hex'),
      Buffer.from(crypto.pbkdf2Sync(pwd, salt, 100000, 32, 'sha256').toString('hex'), 'hex')
    );
  } catch (e) { return false; }
}
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  for (const [u, p] of [['test', 'test'], ['catten', 'catten']]) {
    db.prepare('INSERT OR IGNORE INTO users (username, password_hash) VALUES (?,?)').run(u, hashPassword(p));
  }
  console.log('[SEED] 已创建账户 test / catten（密码与账户名相同）');
  // 迁移旧 JSON 数据到 catten
  const catten = db.prepare('SELECT id FROM users WHERE username=?').get('catten');
  if (catten) {
    for (const key of ['conversations', 'vocab', 'weak', 'settings']) {
      const fp = path.join(DATA_DIR, key + '.json');
      if (!fs.existsSync(fp)) continue;
      try {
        const raw = fs.readFileSync(fp, 'utf8');
        if (raw.trim().length <= 2) continue;
        let val = JSON.parse(raw);
        if (key === 'conversations' && Array.isArray(val)) {
          val = { conv_legacy: { id: 'conv_legacy', title: '旧对话（已迁移）', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: val } };
        }
        db.prepare('INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?,?,?, datetime(\'now\')) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=datetime(\'now\')')
          .run(catten.id, key, JSON.stringify(val));
        console.log('[MIGRATE] imported', key);
      } catch (e) { console.log('[MIGRATE] skip', key, e.message); }
    }
  }
}

/* 会话 token 只以 SHA-256 形式落库：数据库/WAL/备份泄露时无法直接冒充用户。
   token 本身有 256bit 熵，无需加盐或慢哈希（暴力枚举不可行）。 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}
function userByToken(token) {
  if (!token) return null;
  return db.prepare('SELECT s.user_id uid, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > ?')
    .get(hashToken(token), new Date().toISOString()) || null;
}

/* ==================== Backend proxy (Node fetch) ==================== */
async function proxyRequest(url, bodyBuf, headers, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || PROXY_TIMEOUT);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: bodyBuf, signal: ctrl.signal });
    const data = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, data };
  } finally {
    clearTimeout(timer);
  }
}

/* ==================== Anki 代理白名单与归属校验 ====================
   AnkiConnect 是无鉴权的本机高权限接口。代理若原样转发任意 action，
   等于把整个 Anki 集合的读写能力暴露给任意已登录用户。
   这里只放行本应用实际使用的 action，并强制所有牌组操作限定在
   「英语学习::<当前用户名>」子树内。
   注意：ANKI_DECK_PREFIX 需与 js/config.js 中的常量保持一致。 */
const ANKI_DECK_PREFIX = '英语学习';
// 允许创建/改样式的笔记类型（与 js/config.js、js/app.js 中的模型名对应）
const ANKI_ALLOWED_MODELS = new Set(['Basic', 'Basic (and reversed card)', '英语学习-词汇', '英语学习-薄弱点问答']);
const ANKI_MAX_NOTES = 200;      // 单次 addNotes/canAddNotes 上限
const ANKI_MAX_CARDS = 500;      // 单次 cardsInfo/changeDeck 卡片数上限
const ANKI_MAX_MEDIA_B64 = 8 * 1024 * 1024;  // storeMediaFile base64 上限

// 只读/无副作用（不涉及牌组归属）
const ANKI_READONLY_ACTIONS = new Set([
  'version', 'deckNames', 'modelNames',
  'getNumCardsReviewedToday', 'getNumCardsReviewedByDay'
]);
// GUI 复习动作：作用于 Anki 当前复习会话，无牌组参数
const ANKI_GUI_ACTIONS = new Set(['guiCurrentCard', 'guiShowAnswer', 'guiAnswerCard']);
// 需要逐项校验参数的动作
const ANKI_GUARDED_ACTIONS = new Set([
  'addNote', 'addNotes', 'canAddNotes', 'createDeck', 'changeDeck',
  'findCards', 'cardsInfo', 'getDeckStats', 'guiDeckReview',
  'findNotes', 'notesInfo',
  'createModel', 'updateModelStyling', 'storeMediaFile'
]);

function ankiUserDeckRoot(username) {
  return ANKI_DECK_PREFIX + '::' + (username || 'default');
}
function isOwnedDeck(deck, username) {
  if (typeof deck !== 'string' || !deck) return false;
  const root = ankiUserDeckRoot(username);
  return deck === root || deck.startsWith(root + '::');
}
function isSafeMediaName(name) {
  // 只允许应用自己生成的音频文件名，禁止路径分隔符与父级引用
  return typeof name === 'string' && /^ai_en_[A-Za-z0-9_-]{1,64}\.(mp3|m4a|ogg|wav)$/.test(name);
}

/* 校验一次 Anki 代理请求。通过返回 null，否则返回 { status, error } */
function ankiGuard(payload, username) {
  if (!payload || typeof payload !== 'object') return { status: 400, error: 'invalid anki payload' };
  const action = typeof payload.action === 'string' ? payload.action : '';
  if (!action) return { status: 400, error: 'anki action required' };

  const allowed = ANKI_READONLY_ACTIONS.has(action) || ANKI_GUI_ACTIONS.has(action) || ANKI_GUARDED_ACTIONS.has(action);
  if (!allowed) return { status: 403, error: 'anki action not allowed: ' + action.slice(0, 40) };
  if (!ANKI_GUARDED_ACTIONS.has(action)) return null;

  const p = payload.params && typeof payload.params === 'object' ? payload.params : {};
  const root = ankiUserDeckRoot(username);
  const denyDeck = (d) => ({ status: 403, error: 'deck not owned: ' + String(d).slice(0, 60) + '（仅允许 ' + root + ' 子树）' });

  switch (action) {
    case 'addNote': {
      const note = p.note;
      if (!note || typeof note !== 'object') return { status: 400, error: 'note required' };
      if (!isOwnedDeck(note.deckName, username)) return denyDeck(note.deckName);
      if (note.modelName !== undefined && !ANKI_ALLOWED_MODELS.has(note.modelName)) {
        return { status: 403, error: 'model not allowed: ' + String(note.modelName).slice(0, 40) };
      }
      return null;
    }
    case 'addNotes':
    case 'canAddNotes': {
      const notes = p.notes;
      if (!Array.isArray(notes) || !notes.length) return { status: 400, error: 'notes required' };
      if (notes.length > ANKI_MAX_NOTES) return { status: 400, error: 'too many notes (max ' + ANKI_MAX_NOTES + ')' };
      for (const n of notes) {
        if (!n || typeof n !== 'object') return { status: 400, error: 'invalid note entry' };
        if (!isOwnedDeck(n.deckName, username)) return denyDeck(n.deckName);
        if (n.modelName !== undefined && !ANKI_ALLOWED_MODELS.has(n.modelName)) {
          return { status: 403, error: 'model not allowed: ' + String(n.modelName).slice(0, 40) };
        }
      }
      return null;
    }
    case 'createDeck': {
      if (!isOwnedDeck(p.deck, username)) return denyDeck(p.deck);
      return null;
    }
    case 'changeDeck': {
      if (!isOwnedDeck(p.deck, username)) return denyDeck(p.deck);
      if (!Array.isArray(p.cards) || !p.cards.length) return { status: 400, error: 'cards required' };
      if (p.cards.length > ANKI_MAX_CARDS) return { status: 400, error: 'too many cards (max ' + ANKI_MAX_CARDS + ')' };
      if (!p.cards.every(c => Number.isSafeInteger(c) && c > 0)) return { status: 400, error: 'invalid card id' };
      return null;
    }
    case 'guiDeckReview': {
      if (!isOwnedDeck(p.name, username)) return denyDeck(p.name);
      return null;
    }
    case 'getDeckStats': {
      const decks = p.decks;
      if (!Array.isArray(decks) || !decks.length) return { status: 400, error: 'decks required' };
      for (const d of decks) { if (!isOwnedDeck(d, username)) return denyDeck(d); }
      return null;
    }
    case 'findCards': {
      // 只允许两种检索形态：
      //   1) 显式限定在本用户牌组内：deck:英语学习::<user>[...]
      //   2) 纯 note id 列表：nid:123 OR nid:456
      //      （用于刚添加完卡片后 changeDeck 归位，见 ensureDeckPlacement）
      const query = typeof p.query === 'string' ? p.query : '';
      if (!query) return { status: 400, error: 'query required' };
      if (query.includes('deck:' + root)) return null;

      const terms = query.split(/\s+(?:OR|or)\s+/).map(s => s.trim()).filter(Boolean);
      if (terms.length && terms.length <= ANKI_MAX_NOTES && terms.every(t => /^nid:\d{1,20}$/.test(t))) {
        return null;
      }
      return { status: 403, error: 'query must be scoped to deck:' + root + ' 或为 nid: 列表' };
    }
    case 'cardsInfo': {
      const cards = p.cards;
      if (!Array.isArray(cards) || !cards.length) return { status: 400, error: 'cards required' };
      if (cards.length > ANKI_MAX_CARDS) return { status: 400, error: 'too many cards (max ' + ANKI_MAX_CARDS + ')' };
      if (!cards.every(c => Number.isSafeInteger(c) && c > 0)) return { status: 400, error: 'invalid card id' };
      return null;
    }
    case 'findNotes': {
      // 与 findCards 同样限定在本用户牌组内（生词去重时会查 deck:...::词汇 tag:vocabulary）
      const query = typeof p.query === 'string' ? p.query : '';
      if (!query) return { status: 400, error: 'query required' };
      if (!query.includes('deck:' + root)) {
        return { status: 403, error: 'query must be scoped to deck:' + root };
      }
      return null;
    }
    case 'notesInfo': {
      const notes = p.notes;
      if (!Array.isArray(notes) || !notes.length) return { status: 400, error: 'notes required' };
      if (notes.length > ANKI_MAX_CARDS) return { status: 400, error: 'too many notes (max ' + ANKI_MAX_CARDS + ')' };
      if (!notes.every(n => Number.isSafeInteger(n) && n > 0)) return { status: 400, error: 'invalid note id' };
      return null;
    }
    case 'createModel':
    case 'updateModelStyling': {
      const name = action === 'createModel' ? p.modelName : (p.model && p.model.name);
      if (!ANKI_ALLOWED_MODELS.has(name)) {
        return { status: 403, error: 'model not allowed: ' + String(name).slice(0, 40) };
      }
      return null;
    }
    case 'storeMediaFile': {
      if (!isSafeMediaName(p.filename)) return { status: 400, error: 'invalid media filename' };
      if (typeof p.data !== 'string' || !p.data) return { status: 400, error: 'media data required' };
      if (p.data.length > ANKI_MAX_MEDIA_B64) return { status: 400, error: 'media too large' };
      // 不允许通过 path/url 让 Anki 读取本机任意文件或发起外部请求
      if (p.path !== undefined || p.url !== undefined) return { status: 400, error: 'media path/url not allowed' };
      return null;
    }
    default:
      return { status: 403, error: 'anki action not allowed: ' + action.slice(0, 40) };
  }
}

/* ==================== Anki proxy (direct socket to 127.0.0.1:8765) ==================== */
function ankiCall(port, action, payloadBuf, timeoutMs) {
  return new Promise((resolve) => {
    const t = timeoutMs || 2500;
    const sock = net.createConnection({ host: '127.0.0.1', port: port || 8765 }, () => {
      const urlPath = '/' + action;
      sock.write(Buffer.from(
        `POST ${urlPath} HTTP/1.1\r\nHost: 127.0.0.1:${port || 8765}\r\nContent-Type: application/json\r\nContent-Length: ${payloadBuf.length}\r\nConnection: close\r\n\r\n`
      ));
      sock.write(payloadBuf);
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); });
    sock.on('end', () => {
      const txt = buf.toString('utf8');
      const idx = txt.indexOf('\r\n\r\n');
      let body = idx >= 0 ? txt.slice(idx + 4) : txt;
      const head = idx >= 0 ? txt.slice(0, idx) : '';
      const cl = head.match(/content-length:\s*(\d+)/i);
      if (cl) body = body.slice(0, Number(cl[1]));
      resolve({ ok: true, body });
    });
    sock.on('error', (e) => resolve({ ok: false, err: e.message }));
    sock.setTimeout(t, () => { sock.destroy(); resolve({ ok: false, err: 'timeout' }); });
  });
}

/* ==================== HTTP helpers ==================== */
function corsHeaders(req) {
  const origin = req && req.headers && req.headers.origin;
  const h = {};
  if (ALLOWED_ORIGINS.has(origin || '')) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, xi-api-key';
  h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  return h;
}
function sendJson(res, status, obj, req) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req || {}) });
  res.end(body);
}
/* 读取请求体：按实际字节累计，不信任 Content-Length
   （chunked / 缺少 Content-Length 的请求同样受 limit 约束）
   超限时返回 null（调用方回 413），剩余数据直接丢弃，不继续累积内存 */
function readBody(req, limit) {
  const max = limit || MAX_BODY;
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > max) { resolve(null); return; }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onError);
      resolve(val);
    };
    function onData(c) {
      // 超限后到达的数据直接丢弃（listener 保留用于消耗流，避免 socket 缓冲堆积）
      if (settled) return;
      size += c.length;
      if (size > max) {
        settled = true;
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        req.removeListener('aborted', onError);
        chunks.length = 0;
        resolve(null); // handler 收到 null → 回 413，连接由框架正常关闭
        return;
      }
      chunks.push(c);
    }
    function onEnd() { finish(Buffer.concat(chunks)); }
    function onError() { finish(null); }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onError);
  });
}
function auth(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return userByToken(auth.slice(7).trim());
}

/* ==================== Static whitelist ====================
   安全模型：每个公开 URL 前缀映射到一个独立的物理根目录。
   - 先解码，再逐段校验，最后用 path.resolve + 前缀比较确认没有逃出该根目录
   - 任何 '..' / 反斜杠 / NUL / 绝对路径一律拒绝
   - 扩展名必须在白名单内（不再用 octet-stream 兜底，避免 .env/.db 被下载）
*/
const STATIC_MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.aac': 'audio/aac' };
// URL 前缀 → 物理根目录（只有这些目录对外可见）
const STATIC_DIRS = {
  '/css/': path.join(BASE, 'css'),
  '/js/': path.join(BASE, 'js'),
  '/vendor/': path.join(BASE, 'vendor'),
  '/music/': MUSIC_DIR,
  '/img/': path.join(BASE, 'img')
};
const INDEX_FILE = path.join(BASE, 'index.html');

// 把 URL 相对路径安全地解析到指定根目录内；失败返回 null
function resolveInside(root, relPath) {
  if (!relPath) return null;
  // 拒绝 NUL、反斜杠（Windows 分隔符）、以及任何形式的父级引用
  if (relPath.includes('\0') || relPath.includes('\\')) return null;
  const segments = relPath.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return null;
  }
  if (path.isAbsolute(relPath)) return null;
  const resolved = path.resolve(root, segments.join(path.sep));
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) return null;
  return resolved;
}

function sendFile(res, abs) {
  const ext = path.extname(abs).toLowerCase();
  const mime = STATIC_MIME[ext];
  if (!mime) { sendJson(res, 404, { error: 'not found' }); return; }
  fs.readFile(abs, (err, data) => {
    if (err) { sendJson(res, 404, { error: 'not found' }); return; }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

function serveStatic(res, pathname) {
  // URL pathname 保留百分号编码，需解码以支持中文文件名；解码失败直接拒绝
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (e) { sendJson(res, 400, { error: 'bad request' }); return; }
  if (decoded.includes('\0')) { sendJson(res, 400, { error: 'bad request' }); return; }

  if (decoded === '/' || decoded === '/index.html') { sendFile(res, INDEX_FILE); return; }

  for (const [prefix, root] of Object.entries(STATIC_DIRS)) {
    if (!decoded.startsWith(prefix)) continue;
    const abs = resolveInside(root, decoded.slice(prefix.length));
    if (!abs) { sendJson(res, 404, { error: 'not found' }); return; }
    sendFile(res, abs);
    return;
  }
  sendJson(res, 404, { error: 'not found' });
}

/* ==================== Server ==================== */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(200, corsHeaders(req));
    res.end();
    return;
  }

  try {
    // Health（无需鉴权；不返回绝对路径，避免泄露本机布局信息）
    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok', minimax: !!MINIMAX_KEY, eleven: !!ELEVEN_KEY }, req);
      return;
    }
    // 刷新 Anki 连接缓存
    if (method === 'GET' && pathname === '/api/health/anki') {
      _ankiWorkingUrl = null;
      sendJson(res, 200, { status: 'cache_cleared' }, req);
      return;
    }

    // 背景音乐：列出 music 目录中的音频文件（本地静态资源，无需鉴权）
    if (method === 'GET' && pathname === '/api/music/list') {
      const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.oga', '.wav', '.webm', '.flac', '.opus', '.aac']);
      try {
        const files = fs.readdirSync(MUSIC_DIR)
          .filter(f => AUDIO_EXT.has(path.extname(f).toLowerCase()))
          .sort((a, b) => a.localeCompare(b, 'zh-CN'))
          .map(f => ({ file: f, name: f.replace(/\.[^.]+$/, '').replace(/^\s*\d+[\s._-]+/, '').trim() || f }));
        sendJson(res, 200, { files }, req);
      } catch (e) {
        sendJson(res, 500, { error: 'failed', detail: e.message }, req);
      }
      return;
    }

    // 登录（无需鉴权）
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
      let payload = {};
      try { payload = JSON.parse(body.toString('utf8')); } catch (e) {}
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '');
      const user = db.prepare('SELECT id, password_hash FROM users WHERE username=?').get(username);
      if (!user || !verifyPassword(password, user.password_hash)) {
        sendJson(res, 401, { error: '用户名或密码错误' }, req);
        return;
      }
      // 原始 token 只在这里返回一次，库里只留哈希
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, last_seen_at) VALUES (?,?,?, datetime(\'now\'))')
        .run(hashToken(token), user.id, new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString());
      sendJson(res, 200, { token, username }, req);
      return;
    }

    if (method === 'GET' && !pathname.startsWith('/api/')) {
      serveStatic(res, pathname);
      return;
    }

    // 其余需要鉴权
    const au = auth(req);
    if (!au) { sendJson(res, 401, { error: 'unauthorized' }, req); return; }
    const uid = au.uid;

    if (method === 'GET' && pathname === '/api/auth/me') {
      sendJson(res, 200, { username: au.username }, req);
      return;
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const authh = req.headers.authorization || '';
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(authh.slice(7).trim()));
      sendJson(res, 200, { status: 'ok' }, req);
      return;
    }
    // 会话管理：查看本账户活跃会话 / 退出其他设备
    if (method === 'GET' && pathname === '/api/auth/sessions') {
      const curHash = hashToken((req.headers.authorization || '').slice(7).trim());
      const rows = db.prepare('SELECT token_hash, created_at, expires_at, last_seen_at FROM sessions WHERE user_id=? ORDER BY created_at DESC').all(uid);
      sendJson(res, 200, {
        sessions: rows.map(r => ({
          id: r.token_hash.slice(0, 12),     // 仅用于展示/撤销，不足以还原 token
          current: r.token_hash === curHash,
          created_at: r.created_at,
          expires_at: r.expires_at,
          last_seen_at: r.last_seen_at
        }))
      }, req);
      return;
    }
    if (method === 'POST' && pathname === '/api/auth/revoke-others') {
      const curHash = hashToken((req.headers.authorization || '').slice(7).trim());
      const r = db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash != ?').run(uid, curHash);
      sendJson(res, 200, { status: 'ok', revoked: Number(r.changes || 0) }, req);
      return;
    }
    // 修改密码：校验旧密码 → 换哈希 → 撤销除当前会话外的所有会话
    if (method === 'POST' && pathname === '/api/auth/change-password') {
      const body = await readBody(req, 8 * 1024);
      if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
      let payload = {};
      try { payload = JSON.parse(body.toString('utf8')); } catch (e) { sendJson(res, 400, { error: 'invalid json' }, req); return; }
      const oldPwd = String(payload.old_password || '');
      const newPwd = String(payload.new_password || '');
      if (newPwd.length < 4) { sendJson(res, 400, { error: '新密码至少 4 位' }, req); return; }
      if (newPwd.length > 200) { sendJson(res, 400, { error: '新密码过长（最多 200 位）' }, req); return; }
      const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(uid);
      if (!row || !verifyPassword(oldPwd, row.password_hash)) {
        sendJson(res, 401, { error: '原密码错误' }, req);
        return;
      }
      const curHash = hashToken((req.headers.authorization || '').slice(7).trim());
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(newPwd), uid);
        const del = db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash != ?').run(uid, curHash);
        db.exec('COMMIT');
        sendJson(res, 200, { status: 'ok', revoked_sessions: Number(del.changes || 0) }, req);
      } catch (e) {
        db.exec('ROLLBACK');
        sendJson(res, 500, { error: '修改密码失败', detail: e.message }, req);
      }
      return;
    }

    // 用户数据读写
    const dbMatch = pathname.match(/^\/api\/db\/(\w+)$/);
    if (dbMatch) {
      const key = dbMatch[1];
      if (!Object.prototype.hasOwnProperty.call(USER_DATA_KEYS, key)) { sendJson(res, 400, { error: 'unknown key' }, req); return; }
      if (method === 'GET') {
        const row = db.prepare('SELECT value FROM user_data WHERE user_id=? AND key=?').get(uid, key);
        let val = null;
        if (row) {
          try { val = JSON.parse(row.value); }
          catch (e) {
            // 数据损坏：明确记录，避免只表现为「数据消失」
            console.error(`[DB] user ${uid} key ${key}: 存储值不是合法 JSON，返回 null`);
            val = null;
          }
        }
        sendJson(res, 200, val, req);
        return;
      }
      if (method === 'POST') {
        const body = await readBody(req, MAX_USER_DATA);
        if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
        const text = body.toString('utf8');
        // 服务端校验：必须是合法 JSON，且顶层类型符合该 key 的约定
        let parsed;
        try { parsed = JSON.parse(text); }
        catch (e) { sendJson(res, 400, { error: 'invalid json', key }, req); return; }
        const expect = USER_DATA_KEYS[key];
        if (!matchesType(parsed, expect)) {
          sendJson(res, 400, { error: 'invalid shape', key, expected: expect }, req);
          return;
        }
        db.prepare('INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?,?,?, datetime(\'now\')) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=datetime(\'now\')')
          .run(uid, key, text);
        sendJson(res, 200, { status: 'saved', key }, req);
        return;
      }
      sendJson(res, 405, { error: 'method' }, req);
      return;
    }

    // 高考翻译题库：列出所有试卷（带题数）
    if (method === 'GET' && pathname === '/api/gaokao/exams') {
      try {
        const rows = db.prepare(`
          SELECT exam, exam_year, source_file,
                 COUNT(*) AS q_count,
                 MIN(id) AS first_id,
                 MAX(id) AS last_id
          FROM gaokao_questions
          GROUP BY exam
          ORDER BY exam_year DESC, exam ASC
        `).all();
        const list = rows.map(r => ({
          exam: r.exam,
          year: r.exam_year || '',
          source_file: r.source_file || '',
          q_count: r.q_count,
          first_id: r.first_id,
          last_id: r.last_id
        }));
        sendJson(res, 200, { total: list.length, exams: list }, req);
      } catch (e) {
        sendJson(res, 500, { error: 'failed', detail: e.message }, req);
      }
      return;
    }

    // 高考翻译题库：单张试卷题目（支持 /api/gaokao/exam/:encodedName 或 /api/gaokao/question/:id）
    const gaokaoExamMatch = pathname.match(/^\/api\/gaokao\/exam\/(.+)$/);
    if (method === 'GET' && gaokaoExamMatch) {
      try {
        const examName = decodeURIComponent(gaokaoExamMatch[1]);
        // 必须选 source_file，否则下方 rows[0].source_file 恒为空
        const rows = db.prepare('SELECT id, q_no, q_text, a_text, q_words, source_file FROM gaokao_questions WHERE exam = ? ORDER BY id ASC').all(examName);
        if (!rows.length) { sendJson(res, 404, { error: 'not found' }, req); return; }
        sendJson(res, 200, { exam: examName, source_file: rows[0].source_file || '', questions: rows.map(r => ({ id: r.id, q_no: r.q_no, q_text: r.q_text, a_text: r.a_text, q_words: parseWords(r.q_words) })) }, req);
      } catch (e) {
        sendJson(res, 500, { error: 'failed', detail: e.message }, req);
      }
      return;
    }

    // 单题查询（用于 Anki 推送或详情）
    const gaokaoQMatch = pathname.match(/^\/api\/gaokao\/question\/(\d+)$/);
    if (method === 'GET' && gaokaoQMatch) {
      try {
        const id = parseInt(gaokaoQMatch[1]);
        const row = db.prepare('SELECT id, exam, q_no, q_text, a_text, q_words, source_file, exam_year FROM gaokao_questions WHERE id = ?').get(id);
        if (!row) { sendJson(res, 404, { error: 'not found' }, req); return; }
        sendJson(res, 200, { ...row, q_words: parseWords(row.q_words) }, req);
      } catch (e) {
        sendJson(res, 500, { error: 'failed', detail: e.message }, req);
      }
      return;
    }

    // 高考翻译题库：查询该用户已推送到 Anki 的题号列表
    if (method === 'GET' && pathname === '/api/gaokao/pushed') {
      try {
        const row = db.prepare('SELECT value FROM user_data WHERE user_id=? AND key=?').get(uid, 'gaokao_pushed');
        let ids = [];
        if (row) { try { ids = JSON.parse(row.value); if (!Array.isArray(ids)) ids = []; } catch (e) {} }
        sendJson(res, 200, { ids }, req);
      } catch (e) { sendJson(res, 500, { error: 'failed', detail: e.message }, req); }
      return;
    }

    // 高考翻译题库：把题目推送到 Anki（直接调 AnkiConnect，复用 ankiCall）
    if (method === 'POST' && pathname === '/api/gaokao/push-to-anki') {
      try {
        const body = await readBody(req);
        let payload = {};
        try { payload = JSON.parse(body.toString('utf8')); } catch (e) {}
        // ids 严格校验：正整数、去重、批量上限 100（防止超大 IN 子句 / 巨大 notes payload）
        const rawIds = Array.isArray(payload.ids) ? payload.ids : [];
        if (rawIds.length > 100) { sendJson(res, 400, { error: 'too many ids (max 100)' }, req); return; }
        const ids = Array.from(new Set(rawIds.filter(x => Number.isSafeInteger(x) && x > 0)));
        if (!ids.length) { sendJson(res, 400, { error: 'ids required' }, req); return; }
        const placeholders = ids.map(() => '?').join(',');
        const rows = db.prepare(`SELECT id, q_text, a_text, q_words, exam FROM gaokao_questions WHERE id IN (${placeholders})`).all(...ids);
        if (!rows.length) { sendJson(res, 404, { error: 'no questions found' }, req); return; }
        const deckName = `英语学习::${au.username}::翻译题`;
        // 确保目标牌组存在
        try {
          const decks = await ankiCall(8765, 'deckNames', Buffer.from(JSON.stringify({ action: 'deckNames', version: 6 })));
          if (decks.ok) {
            const txt = decks.body;
            const headEnd = txt.indexOf('\r\n\r\n');
            const bodyStr = headEnd >= 0 ? txt.slice(headEnd + 4) : txt;
            const clMatch = txt.match(/content-length:\s*(\d+)/i);
            const bodyClean = clMatch ? bodyStr.slice(0, Number(clMatch[1])) : bodyStr;
            const parsed = JSON.parse(bodyClean);
            const list = parsed.result || [];
            if (!list.includes(deckName)) {
              await ankiCall(8765, 'createDeck', Buffer.from(JSON.stringify({ action: 'createDeck', version: 6, params: { deck: deckName } })));
            }
          }
        } catch (e) { console.error('[ANKI] ensure deck err:', e.message); }
        // 卡片正面附上「必用词」（如有），让 Anki 复习时也能看到要求
        const notes = rows.map(r => {
          const ws = parseWords(r.q_words);
          const front = r.q_text
            + (ws.length ? '\n\n🔑 必用词: ' + ws.join(' / ') : '')
            + '\n\n📚 ' + (r.exam || '').substring(0, 30);
          return {
            deckName,
            modelName: 'Basic',
            fields: { Front: front, Back: r.a_text },
            tags: ['ai-english', 'translation', 'gaokao', `q${r.id}`]
          };
        });
        const ankiPayload = JSON.stringify({ action: 'addNotes', version: 6, params: { notes } });
        const ankiRes = await ankiCall(8765, 'addNotes', Buffer.from(ankiPayload, 'utf8'), 8000);
        if (!ankiRes.ok) { sendJson(res, 502, { error: 'anki conn failed', detail: ankiRes.err }, req); return; }
        // 解析 HTTP 响应体
        const headEnd = ankiRes.body.indexOf('\r\n\r\n');
        const bodyStr = headEnd >= 0 ? ankiRes.body.slice(headEnd + 4) : ankiRes.body;
        const clMatch = ankiRes.body.match(/content-length:\s*(\d+)/i);
        const jsonStr = clMatch ? bodyStr.slice(0, Number(clMatch[1])) : bodyStr;
        let result;
        try { result = JSON.parse(jsonStr); } catch (e) { sendJson(res, 502, { error: 'anki bad response', detail: bodyStr.slice(0, 200) }, req); return; }
        // AnkiConnect 顶层 error 不应被当作成功
        if (result.error) { sendJson(res, 502, { error: 'anki error', detail: String(result.error).slice(0, 300) }, req); return; }
        const noteIds = Array.isArray(result.result) ? result.result : [];
        // 逐题结果：noteIds[i] 对应 rows[i]；null 表示该题重复/失败，不能记为已推
        const perQuestion = rows.map((r, i) => {
          const noteId = noteIds[i];
          return { id: r.id, added: Number.isInteger(noteId) ? true : false };
        });
        const added = perQuestion.filter(x => x.added).length;
        const requested = rows.length;
        // 只把真实添加成功的题记入已推状态
        const newIds = perQuestion.filter(x => x.added).map(x => x.id);
        if (newIds.length) {
          try {
            const row = db.prepare('SELECT value FROM user_data WHERE user_id=? AND key=?').get(uid, 'gaokao_pushed');
            let existed = [];
            if (row) { try { const p = JSON.parse(row.value); existed = Array.isArray(p) ? p : []; } catch (e) { existed = []; } }
            const merged = Array.from(new Set([...existed, ...newIds]));
            db.prepare('INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?,?,?, datetime(\'now\')) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=datetime(\'now\')')
              .run(uid, 'gaokao_pushed', JSON.stringify(merged));
          } catch (e) { console.error('[ANKI] save pushed err:', e.message); }
        }
        sendJson(res, 200, { ok: true, requested, added, skipped: requested - added, deck: deckName, questions: perQuestion }, req);
      } catch (e) {
        sendJson(res, 500, { error: 'failed', detail: e.message }, req);
      }
      return;
    }

    // 备份（VACUUM INTO）
    if (method === 'POST' && pathname === '/api/backup') {
      // 互斥：多标签页 / 手动+定时同时触发时，同一秒会生成同名文件导致第二个失败；
      // 这里直接拒绝并发备份，避免同名冲突与重复 IO
      if (_backupInFlight) { sendJson(res, 409, { error: 'backup already in progress' }, req); return; }
      _backupInFlight = true;
      try {
        const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        let name = `${ts}_chat.db`;
        // 同秒先后两个请求（非并发）会产生同名文件导致 VACUUM INTO 失败：
        // 若目标已存在，追加毫秒+随机后缀回退（不受保留策略影响，仍按前 14 位时间分层清理）
        if (fs.existsSync(path.join(BACKUP_DIR, name))) {
          name = `${ts}_${Date.now().toString().slice(-6)}${Math.random().toString(36).slice(2, 6)}_chat.db`;
        }
        const out = path.join(BACKUP_DIR, name).replace(/'/g, "''");
        db.exec("VACUUM INTO '" + out + "'");
        // prune 失败不应让本次备份响应失败，但也不应静默吞掉
        try { pruneBackups(); } catch (pe) { console.error('[BACKUP] prune err:', pe.message); }
        sendJson(res, 200, { status: 'backed up', file: path.basename(out).replace(/''/g, "'") }, req);
      } catch (e) {
        sendJson(res, 500, { error: 'backup failed', detail: e.message }, req);
      } finally {
        _backupInFlight = false;
      }
      return;
    }

    // MiniMax chat（非流式）
    if (method === 'POST' && pathname === '/api/proxy/chat') {
      const body = await readBody(req);
      const r = await proxyRequest(MINIMAX_BASE + '/v1/chat/completions', body, { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + MINIMAX_KEY });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req) });
      res.end(r.data);
      return;
    }

    // MiniMax chat（流式 SSE）
    if (method === 'POST' && pathname === '/api/proxy/chat/stream') {
      const body = await readBody(req);
      // 一个 controller 贯穿整个流生命周期：
      // 客户端断开（点「停止」/关页面）必须真正中止上游，否则 MiniMax 会继续生成并计费
      const ctrl = new AbortController();
      let closed = false;
      const abortUpstream = () => {
        if (closed) return;
        closed = true;
        try { ctrl.abort(); } catch (e) {}
      };
      req.on('aborted', abortUpstream);
      req.on('close', abortUpstream);
      res.on('close', abortUpstream);

      // 建连 / 等首字节超时
      let connectTimer = setTimeout(abortUpstream, PROXY_TIMEOUT);
      // 整个流的总时长上限
      const totalTimer = setTimeout(abortUpstream, STREAM_TOTAL_TIMEOUT);
      let idleTimer = null;
      const bumpIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(abortUpstream, STREAM_IDLE_TIMEOUT);
      };
      const cleanup = () => {
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        clearTimeout(totalTimer);
        if (idleTimer) clearTimeout(idleTimer);
        req.removeListener('aborted', abortUpstream);
        req.removeListener('close', abortUpstream);
        res.removeListener('close', abortUpstream);
      };

      let upstream;
      try {
        upstream = await fetch(MINIMAX_BASE + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Accept-Encoding': 'identity', 'Authorization': 'Bearer ' + MINIMAX_KEY },
          body,
          signal: ctrl.signal
        });
      } catch (e) {
        cleanup();
        if (!res.headersSent) sendJson(res, 502, { error: 'proxy_stream_failed', detail: String(e.message || e).slice(0, 200) }, req);
        return;
      }
      clearTimeout(connectTimer);
      connectTimer = null;

      // 上游报错时不要伪装成 200 SSE：读取有限错误体，把真实状态码透传给前端
      if (!upstream.ok || !upstream.body) {
        let detail = '';
        try { detail = (await upstream.text()).slice(0, 500); } catch (e) {}
        cleanup();
        if (!res.headersSent) sendJson(res, upstream.status || 502, { error: 'upstream_error', status: upstream.status, detail }, req);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'close', ...corsHeaders(req) });
      const reader = upstream.body.getReader();
      bumpIdle();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (closed || res.writableEnded) break;
          bumpIdle();
          // 处理背压：write 返回 false 时等 drain，避免内存堆积
          if (!res.write(Buffer.from(value))) {
            await new Promise((resolve) => {
              const onDrain = () => { res.removeListener('close', onDrain); resolve(); };
              res.once('drain', onDrain);
              res.once('close', onDrain);
            });
          }
        }
      } catch (e) {
        // 客户端主动断开属正常情况，不当作错误
        if (!closed) console.error('[SSE] stream error:', e.message);
      } finally {
        try { await reader.cancel(); } catch (e) {}
        cleanup();
        if (!res.writableEnded) res.end();
      }
      return;
    }

    // MiniMax web search
    if (method === 'POST' && pathname === '/api/proxy/websearch') {
      const body = await readBody(req);
      const r = await proxyRequest(MINIMAX_BASE + '/v1/coding_plan/search', body, { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + MINIMAX_KEY });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req) });
      res.end(r.data);
      return;
    }

    // ElevenLabs TTS
    const ttsMatch = pathname.match(/^\/api\/proxy\/tts\/([\w-]+)$/);
    if (method === 'POST' && ttsMatch) {
      const voiceId = ttsMatch[1];
      const body = await readBody(req);
      const r = await proxyRequest('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, body, { 'Content-Type': 'application/json', 'xi-api-key': ELEVEN_KEY }, 30000);
      res.writeHead(r.status, { 'Content-Type': 'audio/mpeg', ...corsHeaders(req) });
      res.end(r.data);
      return;
    }

    // AnkiConnect 代理
    if (method === 'POST' && pathname === '/api/proxy/anki') {
      const body = await readBody(req, MAX_ANKI_BODY);
      if (!body) { sendJson(res, 413, { ok: false, error: 'body too large' }, req); return; }
      let payload = null;
      try { payload = JSON.parse(body.toString('utf8')); } catch (e) {
        sendJson(res, 400, { ok: false, error: 'invalid json' }, req);
        return;
      }
      // 白名单 + 牌组归属校验：AnkiConnect 无鉴权，不能原样转发任意 action
      const denied = ankiGuard(payload, au.username);
      if (denied) { sendJson(res, denied.status, { ok: false, error: denied.error }, req); return; }
      const action = String(payload.action);

      // 缓存命中：直接转发，不再每次探测 version（省一次往返）
      if (_ankiWorkingUrl) {
        const cached = await ankiCall(8765, action, body);
        if (cached.ok) {
          try {
            const parsed = JSON.parse(cached.body);
            if (!parsed.error) {
              sendJson(res, 200, { ok: true, url: _ankiWorkingUrl, result: parsed }, req);
              return;
            }
          } catch (e) {}
          // 有 error → 缓存可能失效，清空回落探测
          _ankiWorkingUrl = null;
        } else {
          _ankiWorkingUrl = null; // 连接失败 → 清缓存
        }
      }

      // 首次或缓存失效：探测 version 确认可用（只发最小探测 payload，避免把原请求的 params 误传给 version）
      const probe = await ankiCall(8765, 'version', Buffer.from(JSON.stringify({ action: 'version', version: 6 })));
      if (!probe.ok) { sendJson(res, 503, { ok: false, error: 'ankiconnect unreachable', last: probe.err }, req); return; }
      let probeResult = null;
      try { probeResult = JSON.parse(probe.body); } catch (e) {}
      if (probeResult && probeResult.error) { sendJson(res, 503, { ok: false, error: 'ankiconnect unreachable', last: probe.body.slice(0, 120) }, req); return; }
      _ankiWorkingUrl = 'http://127.0.0.1:8765';
      // 转发原请求
      const r = await ankiCall(8765, action, body);
      if (!r.ok) { sendJson(res, 502, { ok: false, error: r.err, url: _ankiWorkingUrl }, req); return; }
      try {
        const parsed = JSON.parse(r.body);
        sendJson(res, 200, { ok: true, url: _ankiWorkingUrl, result: parsed }, req);
      } catch (e) {
        sendJson(res, 200, { ok: true, url: _ankiWorkingUrl, result: { raw: r.body.slice(0, 200) } }, req);
      }
      return;
    }

    // 静态
    if (method === 'GET') { serveStatic(res, pathname); return; }

    sendJson(res, 404, { error: 'not found' }, req);
  } catch (e) {
    console.error('[ERR]', e);
    // SSE 等场景可能已发送响应头，此时再写 JSON 会抛 ERR_HTTP_HEADERS_SENT
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' }, req);
    else if (!res.writableEnded) { try { res.end(); } catch (ee) {} }
  }
});

/* ==================== 生命周期 ==================== */
// 每天清理一次过期会话（unref 避免阻止进程退出）
const sessionTimer = setInterval(pruneSessions, 24 * 60 * 60 * 1000);
if (sessionTimer.unref) sessionTimer.unref();
// 每 60 秒把 WAL 并回主库：应对 Windows 直接关窗口（不触发信号）导致的收尾缺失
const checkpointTimer = setInterval(() => checkpointWal('PASSIVE'), 60 * 1000);
if (checkpointTimer.unref) checkpointTimer.unref();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[AI English Chat] 收到 ${signal}，正在优雅关闭...`);
  clearInterval(sessionTimer);
  clearInterval(checkpointTimer);
  // 停止接收新连接，等在途请求结束
  server.close(() => {
    finalizeDb();
    console.log('[AI English Chat] 已关闭');
    process.exit(0);
  });
  // 兜底：10 秒内没结束（长连接/SSE 卡住）就强制退出，但仍先收尾数据库
  const force = setTimeout(() => {
    console.warn('[AI English Chat] 仍有连接未结束，强制退出');
    finalizeDb();
    process.exit(0);
  }, 10000);
  if (force.unref) force.unref();
}

let dbClosed = false;
function finalizeDb() {
  if (dbClosed) return;
  dbClosed = true;
  try {
    // WAL checkpoint：把 -wal 内容并回主库，避免只复制 app.db 时状态不完整
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) { console.error('[DB] checkpoint 失败:', e.message); }
  try { db.close(); } catch (e) { console.error('[DB] close 失败:', e.message); }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Windows 下 Ctrl+C 走 SIGINT；SIGBREAK 对应 Ctrl+Break
process.on('SIGBREAK', () => shutdown('SIGBREAK'));

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err && err.stack ? err.stack : err);
  // 状态已不可信：收尾数据库后退出，由启动器/用户重启
  finalizeDb();
  process.exit(1);
});

const PORT = Number(process.argv[2] || process.env.PORT || 8091);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[AI English Chat] Server: http://localhost:${PORT}  (127.0.0.1 only)`);
  console.log(`[AI English Chat] DB: ${DB_PATH}  (schema v${SCHEMA_VERSION})`);
  console.log(`[AI English Chat] MiniMax key: ${MINIMAX_KEY ? 'set' : 'MISSING'} | ElevenLabs key: ${ELEVEN_KEY ? 'set' : 'MISSING'}`);
  console.log('Press Ctrl+C to stop');
});
server.on('error', (e) => { console.error('Server error:', e.message); process.exit(1); });
