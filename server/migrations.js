/* ============================================================
   AI 英语对话教练 - Schema 迁移（server/migrations.js）
   用 PRAGMA user_version 明确记录 schema 版本，而不是靠捕获
   ALTER TABLE 异常猜测。每个迁移在单个事务内执行；除「列已存在」
   外的任何错误都必须让启动失败，否则服务会带着半迁移的 schema
   继续运行，故障点与根因相隔很远。
   ============================================================ */
'use strict';

const logger = require('./services/logger');

const SCHEMA_VERSION = 3;

/* 版本历史：
   0 → 1  初始 schema（users / sessions / user_data / gaokao_questions）
   1 → 2  gaokao_questions.q_words 列（旧库补列）
   2 → 3  sessions 改存 token 哈希（token_hash），并加 expires_at 索引
*/

/* 迁移定义需要 db 实例（up() 里直接执行 SQL），
   因此以工厂函数形式提供，由 db.js 在拿到连接后调用。 */
function makeMigrations(db) {
  function columnExists(table, col) {
    try {
      return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
    } catch (e) { return false; }
  }

  return [
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
}

/* 执行迁移到最新版本；任何失败都让启动终止（见文件头注释） */
function runMigrations(db) {
  const cur = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (cur > SCHEMA_VERSION) {
    logger.error(`数据库 schema 版本 ${cur} 高于本程序支持的 ${SCHEMA_VERSION}，请升级程序后再启动`);
    process.exit(1);
  }
  if (cur === SCHEMA_VERSION) return;

  // 已有数据但 user_version 为 0：说明是迁移体系引入之前的旧库。
  // 此时基线迁移已经由旧版 CREATE TABLE IF NOT EXISTS 建好，仍需逐个跑后续迁移（每步都是幂等的）。
  const legacy = cur === 0 && (() => {
    try { return db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='users'").get().c > 0; }
    catch (e) { return false; }
  })();
  if (legacy) logger.info('检测到迁移体系之前的旧库，按幂等方式补齐 schema 版本');

  for (const m of makeMigrations(db)) {
    if (m.version <= cur) continue;
    db.exec('BEGIN');
    try {
      m.up();
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
      if (!(legacy && m.version === 1)) logger.info(`migration ${m.version} 完成：${m.name}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (re) {}
      logger.error(`migration ${m.version} 失败（${m.name}）：${e.message}`, { err: e });
      logger.error('数据库未变更，服务终止。请先修复后再启动。');
      process.exit(1);
    }
  }
  // 启动完整性检查：关键表/列必须存在
  const columnExists = (table, col) => {
    try { return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col); }
    catch (e) { return false; }
  };
  for (const [t, cols] of Object.entries({
    users: ['id', 'username', 'password_hash'],
    sessions: ['token_hash', 'user_id', 'expires_at'],
    user_data: ['user_id', 'key', 'value'],
    gaokao_questions: ['id', 'exam', 'q_words']
  })) {
    for (const c of cols) {
      if (!columnExists(t, c)) {
        logger.error(`schema 校验失败：${t}.${c} 缺失`);
        process.exit(1);
      }
    }
  }
}

module.exports = { SCHEMA_VERSION, runMigrations };