/* ============================================================
   AI 英语对话教练 - 配置模块（server/config.js）
   集中管理：路径、大小/超时常量、env 密钥、user_data key 约定、
   Anki 白名单、静态白名单、备份保留策略。
   由 server.js（入口）→ server/app.js 组装使用。
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/* 项目根：本文件位于 <root>/server/ 下 */
const BASE = path.join(__dirname, '..');

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

/* 服务端常驻备份间隔（分钟）。即便浏览器关闭、定时器不触发，后端也会定期
   VACUUM INTO 快照。设为 0 关闭。env AI_EN_BACKUP_INTERVAL_MIN 可覆盖。 */
const BACKUP_INTERVAL_MIN = (() => {
  const raw = (process.env.AI_EN_BACKUP_INTERVAL_MIN ?? '').trim();
  if (raw === '') return 60; // 默认每小时
  const v = Number(raw);
  return Number.isFinite(v) ? Math.max(0, v) : 60;
})();

/* 异盘备份副本目录（可选）。设置后每次备份会把快照额外复制一份到这里，
   建议指向另一块盘 / 同步盘目录，防单盘损坏。env AI_EN_BACKUP_EXTRA_DIR。 */
const BACKUP_EXTRA_DIR = (() => {
  const dir = (process.env.AI_EN_BACKUP_EXTRA_DIR || '').trim();
  if (!dir) return null;
  try { fs.mkdirSync(dir, { recursive: true }); return dir; }
  catch (e) { console.error('[CONFIG] 异盘备份目录不可用，已忽略：' + e.message); return null; }
})();

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
  strategist: 'array',
  anki_tasks: 'array'
};

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
/* 密钥用可变量 + getter 暴露：设置面板里更换 key 后需要进程内立即生效
   （否则只能重启服务）。
   读取顺序：进程环境变量优先于 .env 文件。注意判断用 !== undefined
   而不是真值——测试会显式注入空串表示「强制未配置」，若用 || 会
   意外回落到开发者本机 .env 的真实 key。 */
function pickKey(envName, fileValue) {
  const v = process.env[envName];
  return (v !== undefined ? v : fileValue) || '';
}
let _MINIMAX_KEY = pickKey('MINIMAX_API_KEY', env.MINIMAX_API_KEY);
let _ELEVEN_KEY = pickKey('ELEVEN_API_KEY', env.ELEVEN_API_KEY);
let _MINIMAX_BASE = pickKey('MINIMAX_BASE', env.MINIMAX_BASE) || 'https://api.minimaxi.com';
const KEY_SOURCES = {
  minimax: process.env.MINIMAX_API_KEY !== undefined ? 'env' : (env.MINIMAX_API_KEY ? 'file' : 'none'),
  eleven: process.env.ELEVEN_API_KEY !== undefined ? 'env' : (env.ELEVEN_API_KEY ? 'file' : 'none')
};
function setRuntimeKey(service, key) {
  if (service === 'minimax') _MINIMAX_KEY = key;
  else if (service === 'eleven') _ELEVEN_KEY = key;
}
function setMinimaxBase(base) { if (base) _MINIMAX_BASE = String(base).trim(); }
/* 密钥/上游地址以函数形式暴露：调用点取的是当前值，
   设置面板换 key 后立即生效而无需重启。 */
const MINIMAX_KEY = () => _MINIMAX_KEY;
const ELEVEN_KEY = () => _ELEVEN_KEY;
const MINIMAX_BASE = () => _MINIMAX_BASE;

const ALLOWED_ORIGINS = new Set(['null', 'http://localhost:8091', 'http://127.0.0.1:8091']);

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

module.exports = {
  BASE, DATA_DIR, MUSIC_DIR, BACKUP_DIR, DB_PATH,
  BACKUP_RETENTION_MS, BACKUP_INTERVAL_MIN, BACKUP_EXTRA_DIR,
  MAX_BODY, MAX_USER_DATA, MAX_ANKI_BODY,
  PROXY_TIMEOUT, STREAM_IDLE_TIMEOUT, STREAM_TOTAL_TIMEOUT, SESSION_TTL_DAYS,
  USER_DATA_KEYS,
  MINIMAX_KEY, ELEVEN_KEY, MINIMAX_BASE, ALLOWED_ORIGINS,
  KEY_SOURCES, setRuntimeKey, setMinimaxBase,
  ENV_FILE: process.env.AI_EN_ENV_FILE ? path.resolve(process.env.AI_EN_ENV_FILE) : path.join(BASE, '.env'),
  ANKI_DECK_PREFIX, ANKI_ALLOWED_MODELS, ANKI_MAX_NOTES, ANKI_MAX_CARDS, ANKI_MAX_MEDIA_B64,
  ANKI_READONLY_ACTIONS, ANKI_GUI_ACTIONS, ANKI_GUARDED_ACTIONS,
  STATIC_MIME, STATIC_DIRS, INDEX_FILE
};
