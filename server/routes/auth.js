/* ============================================================
   AI 英语对话教练 - 认证路由（server/routes/auth.js）
   POST /api/auth/login            登录（无需鉴权）
   GET  /api/auth/me               当前用户
   POST /api/auth/logout           登出
   GET  /api/auth/sessions         本账户活跃会话
   POST /api/auth/revoke-others    退出其他设备
   POST /api/auth/change-password  修改密码
   ============================================================ */
'use strict';

const crypto = require('node:crypto');
const { sendJson, readBody } = require('../helpers');
const { SESSION_TTL_DAYS } = require('../config');
const { verifyPassword, hashPassword, hashToken } = require('../auth');
const { db } = require('../db');

async function login(req, res) {
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
}

function me(req, res) {
  sendJson(res, 200, { username: req.username }, req);
}

function logout(req, res) {
  const authh = req.headers.authorization || '';
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(authh.slice(7).trim()));
  sendJson(res, 200, { status: 'ok' }, req);
}

function sessions(req, res) {
  const curHash = hashToken((req.headers.authorization || '').slice(7).trim());
  const rows = db.prepare('SELECT token_hash, created_at, expires_at, last_seen_at FROM sessions WHERE user_id=? ORDER BY created_at DESC').all(req.uid);
  sendJson(res, 200, {
    sessions: rows.map(r => ({
      id: r.token_hash.slice(0, 12),     // 仅用于展示/撤销，不足以还原 token
      current: r.token_hash === curHash,
      created_at: r.created_at,
      expires_at: r.expires_at,
      last_seen_at: r.last_seen_at
    }))
  }, req);
}

function revokeOthers(req, res) {
  const curHash = hashToken((req.headers.authorization || '').slice(7).trim());
  const r = db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash != ?').run(req.uid, curHash);
  sendJson(res, 200, { status: 'ok', revoked: Number(r.changes || 0) }, req);
}

/* 修改密码：校验旧密码 → 换哈希 → 撤销除当前会话外的所有会话 */
async function changePassword(req, res) {
  const body = await readBody(req, 8 * 1024);
  if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
  let payload = {};
  try { payload = JSON.parse(body.toString('utf8')); } catch (e) { sendJson(res, 400, { error: 'invalid json' }, req); return; }
  const oldPwd = String(payload.old_password || '');
  const newPwd = String(payload.new_password || '');
  if (newPwd.length < 4) { sendJson(res, 400, { error: '新密码至少 4 位' }, req); return; }
  if (newPwd.length > 200) { sendJson(res, 400, { error: '新密码过长（最多 200 位）' }, req); return; }
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.uid);
  if (!row || !verifyPassword(oldPwd, row.password_hash)) {
    sendJson(res, 401, { error: '原密码错误' }, req);
    return;
  }
  const curHash = hashToken((req.headers.authorization || '').slice(7).trim());
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(newPwd), req.uid);
    const del = db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash != ?').run(req.uid, curHash);
    db.exec('COMMIT');
    sendJson(res, 200, { status: 'ok', revoked_sessions: Number(del.changes || 0) }, req);
  } catch (e) {
    db.exec('ROLLBACK');
    sendJson(res, 500, { error: '修改密码失败', detail: e.message }, req);
  }
}

module.exports = { login, me, logout, sessions, revokeOthers, changePassword };