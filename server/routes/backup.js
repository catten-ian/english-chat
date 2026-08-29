/* ============================================================
   AI 英语对话教练 - 备份路由（server/routes/backup.js）
   POST /api/backup  VACUUM INTO 快照 + 分层保留
   ============================================================ */
'use strict';

const { sendJson } = require('../helpers');
const { doBackup } = require('../services/backup');

function backup(req, res) {
  try {
    const { file } = doBackup();
    sendJson(res, 200, { status: 'backed up', file }, req);
  } catch (e) {
    // 并发拒绝（409）与执行失败（500）分开处理，与既有契约一致
    if (e && e.status === 409) {
      sendJson(res, 409, { error: e.message }, req);
      return;
    }
    sendJson(res, 500, { error: 'backup failed', detail: e.message }, req);
  }
}

module.exports = { backup };