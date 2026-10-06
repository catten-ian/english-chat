'use strict';
const { sendJson, readBody } = require('../helpers');
const { db } = require('../db');
const { giftQuotaForUser } = require('../services/usage');

function requireAdmin(req, res) {
  const user = db.prepare('SELECT role FROM users WHERE id=? AND soft_deleted_at IS NULL').get(req.uid);
  if (user?.role === 'admin') return true;
  sendJson(res, 403, { error: 'admin required' }, req);
  return false;
}

function listUsers(req, res) {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare('SELECT id, username, role, daily_call_limit, rpm_limit, provider_mode, soft_deleted_at, created_at FROM users ORDER BY id').all();
  const usage = db.prepare("SELECT user_id, SUM(requests) requests, SUM(total_tokens) tokens FROM usage_log WHERE day=date('now','localtime') GROUP BY user_id").all();
  const byId = new Map(usage.map(x => [x.user_id, x]));
  sendJson(res, 200, { users: rows.map(u => ({ ...u, quota: giftQuotaForUser(u.id), today_requests: Number(byId.get(u.id)?.requests || 0), today_tokens: Number(byId.get(u.id)?.tokens || 0) })) }, req);
}

async function updateUser(req, res) {
  if (!requireAdmin(req, res)) return;
  const body = await readBody(req, 16 * 1024);
  let p = {};
  try { p = JSON.parse(body || '{}'); } catch (_) { sendJson(res, 400, { error: 'invalid json' }, req); return; }
  const id = Number(p.user_id);
  if (!Number.isInteger(id) || id <= 0) { sendJson(res, 400, { error: 'invalid user_id' }, req); return; }
  const daily = p.daily_call_limit;
  const rpm = p.rpm_limit;
  if (!Number.isInteger(daily) || daily < 0 || daily > 100000 || !Number.isInteger(rpm) || rpm < 1 || rpm > 1000 ||
      !['gift', 'custom'].includes(p.provider_mode) || !['admin', 'user'].includes(p.role)) {
    sendJson(res, 400, { error: 'invalid limits, provider_mode or role' }, req); return;
  }
  const mode = p.provider_mode;
  const role = p.role;
  if (id === req.uid && role !== 'admin') { sendJson(res, 400, { error: 'cannot remove your own admin access' }, req); return; }
  const result = db.prepare('UPDATE users SET daily_call_limit=?, rpm_limit=?, provider_mode=?, role=? WHERE id=?').run(daily, rpm, mode, role, id);
  if (!result.changes) { sendJson(res, 404, { error: 'user not found' }, req); return; }
  sendJson(res, 200, { status: 'updated' }, req);
}

module.exports = { listUsers, updateUser };
