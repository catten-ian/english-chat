'use strict';
const { sendJson, readBody } = require('../helpers');
const { db } = require('../db');

function requireAdmin(req, res) {
  const user = db.prepare('SELECT role FROM users WHERE id=? AND soft_deleted_at IS NULL').get(req.uid);
  if (user?.role === 'admin') return true;
  sendJson(res, 403, { error: 'admin required' }, req);
  return false;
}

function list(req, res) {
  const rows = db.prepare('SELECT id, type, title, body, status, admin_note, created_at, updated_at FROM feedback WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.uid);
  sendJson(res, 200, { feedback: rows }, req);
}

async function create(req, res) {
  const body = await readBody(req, 32 * 1024);
  let p; try { p = JSON.parse(body || '{}'); } catch (_) { sendJson(res, 400, { error: 'invalid json' }, req); return; }
  const text = String(p.body || '').trim();
  if (!text || text.length > 10000) { sendJson(res, 400, { error: 'body required' }, req); return; }
  const type = ['bug', 'suggestion', 'question'].includes(p.type) ? p.type : 'suggestion';
  const title = String(p.title || '').trim().slice(0, 200);
  const r = db.prepare('INSERT INTO feedback(user_id,type,title,body) VALUES(?,?,?,?)').run(req.uid, type, title, text);
  sendJson(res, 201, { id: r.lastInsertRowid }, req);
}

function adminList(req, res) {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare('SELECT f.*, u.username FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT 500').all();
  sendJson(res, 200, { feedback: rows }, req);
}

async function adminUpdate(req, res) {
  if (!requireAdmin(req, res)) return;
  const body = await readBody(req, 16 * 1024); let p; try { p = JSON.parse(body || '{}'); } catch (_) { sendJson(res, 400, { error: 'invalid json' }, req); return; }
  const id = Number(p.id); const status = ['open', 'in_progress', 'resolved', 'closed'].includes(p.status) ? p.status : null;
  if (!Number.isInteger(id) || !status) { sendJson(res, 400, { error: 'invalid feedback update' }, req); return; }
  const r = db.prepare("UPDATE feedback SET status=?, admin_note=?, updated_at=datetime('now') WHERE id=?").run(status, String(p.admin_note || '').slice(0, 5000), id);
  if (!r.changes) { sendJson(res, 404, { error: 'not found' }, req); return; }
  sendJson(res, 200, { status: 'updated' }, req);
}
module.exports = { list, create, adminList, adminUpdate };
