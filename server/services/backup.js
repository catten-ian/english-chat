/* ============================================================
   AI 英语对话教练 - 备份服务（server/services/backup.js）
   - VACUUM INTO 生成 SQLite 快照（同秒冲突时追加后缀回退）
   - 备份后用只读连接做完整性校验（PRAGMA integrity_check + 表数），
     校验失败的快照会被删除并抛错，避免留下"看似成功"的坏备份
   - 多时间节点保留策略清理（pruneBackups）
   - 互斥锁：多标签页 / 手动+定时同时触发时拒绝并发
   - 服务端常驻调度（startBackupScheduler）：浏览器关闭时后端也定期备份
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BACKUP_DIR, BACKUP_RETENTION_MS, BACKUP_EXTRA_DIR } = require('../config');
const logger = require('./logger');

// 惰性获取主库连接：恢复 CLI 只需要 verifyBackup，不应因 require 本模块而打开线上库
function getDb() { return require('../db').db; }

// 备份互斥锁（防止同秒同名文件冲突 / 并发 VACUUM）
let _backupInFlight = false;

function pruneBackups(dir) {
  const baseDir = dir || BACKUP_DIR;
  let files;
  // 兼容标准名 20260828123456_chat.db 与同秒冲突回退名 20260828123456_123456_chat.db
  try { files = fs.readdirSync(baseDir).filter(f => /^\d{14}(?:_\d+)?_chat\.db$/.test(f)); } catch (e) { return; }
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
    if (!keep.has(it.f)) { try { fs.unlinkSync(path.join(baseDir, it.f)); } catch (e) {} }
  }
}

/* 只读打开一个备份文件做完整性校验。不触碰线上库。
   返回 { ok, integrity, tables, users } 或 { ok:false, error }。 */
function verifyBackup(absPath) {
  let vdb = null;
  try {
    vdb = new DatabaseSync(absPath, { readOnly: true });
    const row = vdb.prepare('PRAGMA integrity_check').get();
    const integrity = String(row && (row.integrity_check !== undefined ? row.integrity_check : Object.values(row)[0]));
    const tables = vdb.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get().c;
    let users = 0;
    try { users = vdb.prepare('SELECT COUNT(*) AS c FROM users').get().c; } catch (e) { /* 表缺失按 0 */ }
    return { ok: integrity === 'ok' && tables > 0, integrity, tables, users };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { if (vdb) vdb.close(); } catch (e) {}
  }
}

/* 执行一次备份。成功返回 { file, verified }；并发时抛 { status:409 }；
   VACUUM 或校验失败向上抛。prune 失败不影响本次备份但记录日志。 */
function doBackup() {
  if (_backupInFlight) {
    const err = new Error('backup already in progress');
    err.status = 409;
    throw err;
  }
  _backupInFlight = true;
  try {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    let name = `${ts}_chat.db`;
    // 同秒先后两个请求（非并发）会产生同名文件导致 VACUUM INTO 失败：
    // 若目标已存在，追加毫秒+随机后缀回退（不受保留策略影响，仍按前 14 位时间分层清理）
    if (fs.existsSync(path.join(BACKUP_DIR, name))) {
      name = `${ts}_${Date.now().toString().slice(-6)}${Math.random().toString(36).slice(2, 6)}_chat.db`;
    }
    const absOut = path.join(BACKUP_DIR, name);
    const out = absOut.replace(/'/g, "''");
    getDb().exec("VACUUM INTO '" + out + "'");
    // 校验产物：坏快照直接删除并报错，不留隐患
    const verified = verifyBackup(absOut);
    if (!verified.ok) {
      try { fs.unlinkSync(absOut); } catch (e) {}
      throw new Error('backup verification failed: ' + (verified.error || verified.integrity));
    }
    try { pruneBackups(); } catch (pe) { logger.error('备份清理失败: ' + pe.message, { err: pe }); }
    // 异盘副本：复制一份到第二目录并做同样校验；副本失败不影响主备份结果
    let mirrored = false;
    if (BACKUP_EXTRA_DIR && path.resolve(BACKUP_EXTRA_DIR) !== path.resolve(BACKUP_DIR)) {
      try {
        const mirrorPath = path.join(BACKUP_EXTRA_DIR, name);
        fs.copyFileSync(absOut, mirrorPath);
        const mv = verifyBackup(mirrorPath);
        if (!mv.ok) { try { fs.unlinkSync(mirrorPath); } catch (e) {} throw new Error(mv.error || mv.integrity); }
        try { pruneBackups(BACKUP_EXTRA_DIR); } catch (e) {}
        mirrored = true;
      } catch (me) {
        logger.warn('异盘副本失败（主备份仍有效）: ' + me.message);
      }
    }
    return { file: name, verified, mirrored };
  } finally {
    _backupInFlight = false;
  }
}

/* 服务端常驻备份调度。intervalMin=0 关闭。返回定时器句柄（已 unref）。 */
function startBackupScheduler(intervalMin) {
  const ms = Math.max(0, Number(intervalMin) || 0) * 60 * 1000;
  if (!ms) return null;
  const tick = function () {
    try {
      const r = doBackup();
      logger.info(`定时备份完成: ${r.file} (integrity=${r.verified.integrity}, tables=${r.verified.tables}${r.mirrored ? ', 异盘副本已同步' : ''})`);
    } catch (e) {
      if (e && e.status === 409) return; // 与手动备份并发，跳过本轮
      logger.error('定时备份失败: ' + e.message, { err: e });
    }
  };
  const timer = setInterval(tick, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { doBackup, pruneBackups, verifyBackup, startBackupScheduler };
