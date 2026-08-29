/* ============================================================
   AI 英语对话教练 - 用户数据路由（server/routes/user-data.js）
   GET/POST /api/db/:key
   - 服务端强校验：必须是合法 JSON，且顶层类型符合该 key 的约定
   ============================================================ */
'use strict';

const { sendJson, readBody } = require('../helpers');
const { USER_DATA_KEYS, MAX_USER_DATA } = require('../config');
const { matchesType } = require('../validation');
const { db } = require('../db');
const logger = require('../services/logger');

/* key 是 dispatcher 解析出的 URL 段；返回 true 表示已处理 */
async function dbKey(req, res, key) {
  if (!Object.prototype.hasOwnProperty.call(USER_DATA_KEYS, key)) { sendJson(res, 400, { error: 'unknown key' }, req); return; }
  const uid = req.uid;

  if (req.method === 'GET') {
    const row = db.prepare('SELECT value FROM user_data WHERE user_id=? AND key=?').get(uid, key);
    let val = null;
    if (row) {
      try { val = JSON.parse(row.value); }
      catch (e) {
        // 数据损坏：明确记录，避免只表现为「数据消失」
        logger.error(`user ${uid} key ${key}: 存储值不是合法 JSON，返回 null`);
        val = null;
      }
    }
    sendJson(res, 200, val, req);
    return;
  }
  if (req.method === 'POST') {
    const body = await readBody(req, MAX_USER_DATA);
    if (!body) { sendJson(res, 413, { error: 'body too large' }, req); return; }
    const text = body.toString('utf8');
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
}

module.exports = { dbKey };