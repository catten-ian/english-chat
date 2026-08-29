/* ============================================================
   AI 英语对话教练 - 认证模块（server/auth.js）
   - PBKDF2 密码哈希 / 校验
   - 会话 token：只以 SHA-256 形式落库（数据库/WAL/备份泄露时
     无法直接冒充用户；token 本身 256bit 熵，无需加盐或慢哈希）
   - 请求鉴权（Bearer token → 用户）
   - 首次启动播种默认账户 + 迁移旧 JSON 数据
   ============================================================ */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// 惰性引用：运行时才访问 db，避免与 db.js 的加载顺序产生耦合
const dbMod = require('./db');
const { SESSION_TTL_DAYS, DATA_DIR } = require('./config');
const logger = require('./services/logger');

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

/* 会话 token 只以 SHA-256 形式落库 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}
function userByToken(token) {
  if (!token) return null;
  return dbMod.db.prepare('SELECT s.user_id uid, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > ?')
    .get(hashToken(token), new Date().toISOString()) || null;
}

/* 从 Authorization 头解析当前用户；无有效凭据返回 null */
function auth(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return userByToken(auth.slice(7).trim());
}

/* 首次启动播种默认账户；若旧 JSON 数据存在则迁移到 catten 账户。
   只应该在启动时调用一次（app.js 在 db 就绪后调用）。 */
function seedUsers(db) {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount !== 0) return;
  for (const [u, p] of [['test', 'test'], ['catten', 'catten']]) {
    db.prepare('INSERT OR IGNORE INTO users (username, password_hash) VALUES (?,?)').run(u, hashPassword(p));
  }
  logger.info('已创建账户 test / catten（密码与账户名相同）');
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
        logger.info('旧 JSON 数据已迁移: ' + key);
      } catch (e) { logger.warn('旧 JSON 数据迁移跳过 ' + key + ': ' + e.message); }
    }
  }
}

module.exports = { hashPassword, verifyPassword, hashToken, userByToken, auth, seedUsers };