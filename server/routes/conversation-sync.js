'use strict';

const { sendJson, readBody } = require('../helpers');
const { MAX_USER_DATA } = require('../config');
const { db } = require('../db');
const sync = require('../services/conversation-sync');

async function peer(req, res) {
  const body = await readBody(req, MAX_USER_DATA);
  if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
  const text = body.toString('utf8');
  if (!sync.validSignature(req, text)) { sendJson(res, 401, { error: 'unauthorized' }, req); return; }
  let payload;
  try { payload = JSON.parse(text); } catch (e) { sendJson(res, 400, { error: 'invalid json' }, req); return; }
  if (!payload || typeof payload.username !== 'string' || payload.username.length > 80) {
    sendJson(res, 400, { error: 'invalid username' }, req); return;
  }
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(payload.username);
  if (!user) { sendJson(res, 404, { error: 'user not found' }, req); return; }
  try {
    const merged = sync.mergeForUser(user.id, payload);
    sendJson(res, 200, merged, req);
  } catch (e) {
    sendJson(res, 400, { error: 'invalid snapshot', detail: e.message }, req);
  }
}

async function remove(req, res) {
  const body = await readBody(req, 4096);
  if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); } catch (e) { sendJson(res, 400, { error: 'invalid json' }, req); return; }
  try {
    sync.deleteForUser(req.uid, payload.id);
    sync.schedulePeerSync();
    sendJson(res, 200, { status: 'deleted' }, req);
  } catch (e) { sendJson(res, 400, { error: e.message }, req); }
}

module.exports = { peer, remove };
