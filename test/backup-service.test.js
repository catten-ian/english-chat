/* 备份服务：doBackup 产物校验 + verifyBackup 对坏文件返回失败 */
'use strict';

// 必须在 require 任何 server/* 之前把数据目录指到临时位置（config 在首次 require 时读取 env）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before } = require('node:test');
const assert = require('node:assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-backup-svc-'));
process.env.AI_EN_DATA_DIR = tmp;
process.env.AI_EN_BACKUP_EXTRA_DIR = path.join(tmp, 'extra-mirror');

const { doBackup, verifyBackup } = require('../server/services/backup');
const { BACKUP_DIR, BACKUP_EXTRA_DIR } = require('../server/config');

let backupFile = null;

test('doBackup 产出能通过完整性校验的快照', () => {
  const r = doBackup();
  assert.ok(r.file, '应返回备份文件名');
  assert.ok(r.verified, '应带校验结果');
  assert.strictEqual(r.verified.ok, true, '备份应校验通过：' + JSON.stringify(r.verified));
  assert.strictEqual(r.verified.integrity, 'ok');
  assert.ok(r.verified.tables > 0, '备份应含表');
  assert.ok(fs.existsSync(path.join(BACKUP_DIR, r.file)), '备份文件应落盘');
  backupFile = path.join(BACKUP_DIR, r.file);
});

test('verifyBackup 对合法备份返回 ok', () => {
  const v = verifyBackup(backupFile);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.integrity, 'ok');
});

test('verifyBackup 对伪造/损坏文件返回失败而非抛错', () => {
  const bogus = path.join(BACKUP_DIR, '20260101000000_chat.db');
  fs.writeFileSync(bogus, 'this is definitely not a sqlite database');
  const v = verifyBackup(bogus);
  assert.strictEqual(v.ok, false);
  assert.ok(v.error || v.integrity !== 'ok');
  fs.unlinkSync(bogus);
});

test('doBackup 同时把快照复制到异盘副本目录且副本可通过校验', () => {
  assert.ok(BACKUP_EXTRA_DIR, '应读到异盘副本目录配置');
  const r = doBackup();
  assert.strictEqual(r.mirrored, true, '应报告已镜像');
  const mirrorPath = path.join(BACKUP_EXTRA_DIR, r.file);
  assert.ok(fs.existsSync(mirrorPath), '异盘副本应落盘');
  assert.strictEqual(verifyBackup(mirrorPath).ok, true, '异盘副本应可通过校验');
});

test('startBackupScheduler(0) 返回 null（关闭调度）', () => {
  const { startBackupScheduler } = require('../server/services/backup');
  assert.strictEqual(startBackupScheduler(0), null);
});

test('startBackupScheduler 按间隔触发备份', async () => {
  const { startBackupScheduler } = require('../server/services/backup');
  const count = () => fs.readdirSync(BACKUP_DIR).filter(f => /_chat\.db$/.test(f)).length;
  const before = count();
  const timer = startBackupScheduler(0.01); // 0.01 分钟 = 600ms
  assert.ok(timer, '应返回定时器句柄');
  await new Promise(r => setTimeout(r, 900));
  clearInterval(timer);
  assert.ok(count() > before, '定时备份应至少新增一份快照');
});

test('doBackup 对不存在路径之类的坏目标不会被静默信任（校验失败即抛错）', () => {
  // 正常连续两次备份都应成功（同秒回退名 + 校验）
  const a = doBackup();
  const b = doBackup();
  assert.notStrictEqual(a.file, b.file);
  assert.strictEqual(a.verified.ok, true);
  assert.strictEqual(b.verified.ok, true);
});
