#!/usr/bin/env node
/* ============================================================
   AI 英语对话教练 - 备份管理 / 恢复 CLI（零依赖，node:sqlite）
   用法：
     node scripts/backup_cli.js list                      列出所有备份（按时间倒序）
     node scripts/backup_cli.js verify <latest|序号|文件名> 校验某个备份完整性
     node scripts/backup_cli.js restore <latest|序号|文件名> [--yes]
                                                          恢复备份（会先对当前库做一份
                                                          恢复前快照；不带 --yes 只演练）
   目标参数：latest = 最新一份；序号 = list 中 [n]；文件名 = data/backups 下的文件名。
   路径遵循 AI_EN_DATA_DIR / AI_EN_DB_PATH 环境变量（与服务端一致）。
   ⚠️ 恢复前请先停止服务（node server.js），否则可能覆盖到正在写入的库。
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DB_PATH, BACKUP_DIR } = require('../server/config');
const { verifyBackup } = require('../server/services/backup');

const BACKUP_RE = /^\d{14}(?:_\d+)?_chat\.db$/;

function listBackups() {
  let files = [];
  try { files = fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RE.test(f)); } catch (e) { return []; }
  return files
    .map(f => {
      const abs = path.join(BACKUP_DIR, f);
      const ts = f.slice(0, 14);
      const y = +ts.slice(0, 4), mo = +ts.slice(4, 6) - 1, d = +ts.slice(6, 8);
      const h = +ts.slice(8, 10), mi = +ts.slice(10, 12), s = +ts.slice(12, 14);
      const time = Date.UTC(y, mo, d, h, mi, s);
      let size = 0;
      try { size = fs.statSync(abs).size; } catch (e) {}
      return { f, abs, time, size };
    })
    .sort((a, b) => b.time - a.time);
}

function humanSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function fmtTime(t) {
  const d = new Date(t);
  const p = x => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function resolveTarget(arg) {
  const list = listBackups();
  if (!list.length) return { error: '备份目录为空：' + BACKUP_DIR };
  if (!arg || arg === 'latest') return { item: list[0] };
  if (/^\d+$/.test(arg)) {
    const idx = parseInt(arg, 10);
    if (idx < 1 || idx > list.length) return { error: `序号超出范围（1..${list.length}）` };
    return { item: list[idx - 1] };
  }
  const item = list.find(x => x.f === arg || path.basename(arg) === x.f);
  if (!item) return { error: '找不到备份文件：' + arg };
  return { item };
}

function cmdList() {
  const list = listBackups();
  console.log('备份目录：' + BACKUP_DIR);
  if (!list.length) { console.log('（暂无备份）'); return 0; }
  list.forEach((x, i) => {
    const v = verifyBackup(x.abs);
    const mark = v.ok ? 'OK ' : 'BAD';
    const extra = v.ok ? `users=${v.users} tables=${v.tables}` : (v.error || v.integrity);
    console.log(`  [${i + 1}] ${mark} ${fmtTime(x.time)}  ${humanSize(x.size).padStart(9)}  ${x.f}  (${extra})`);
  });
  return 0;
}

function cmdVerify(arg) {
  const r = resolveTarget(arg);
  if (r.error) { console.error('✗ ' + r.error); return 1; }
  const v = verifyBackup(r.item.abs);
  if (v.ok) {
    console.log(`✓ ${r.item.f} 完整性通过（integrity=${v.integrity}, tables=${v.tables}, users=${v.users}）`);
    return 0;
  }
  console.error(`✗ ${r.item.f} 校验失败：${v.error || v.integrity}`);
  return 1;
}

function cmdRestore(arg, yes) {
  const r = resolveTarget(arg);
  if (r.error) { console.error('✗ ' + r.error); return 1; }
  const target = r.item;

  // 1) 源备份必须先通过校验
  const v = verifyBackup(target.abs);
  if (!v.ok) {
    console.error(`✗ 目标备份校验失败，拒绝恢复：${v.error || v.integrity}`);
    return 1;
  }

  // 2) 检查 WAL/SHM：存在通常意味着服务还在运行
  const wal = DB_PATH + '-wal', shm = DB_PATH + '-shm';
  const walExists = fs.existsSync(wal);
  console.log('将执行恢复：');
  console.log('  目标数据库：' + DB_PATH);
  console.log('  来源备份  ：' + target.f + `（${humanSize(target.size)}, users=${v.users}）`);
  if (walExists) console.log('  ⚠️ 检测到 app.db-wal，服务可能仍在运行！请先停止 node server.js。');

  // 3) 恢复前对当前库做安全快照（可逆）
  let preSnap = null;
  if (fs.existsSync(DB_PATH)) {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    preSnap = path.join(BACKUP_DIR, `${ts}_prerestore_chat.db`);
    console.log('  当前库将先备份到：' + path.basename(preSnap));
  }

  if (!yes) {
    console.log('\n（演练模式：未做任何改动。确认无误后加 --yes 执行）');
    return 0;
  }

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    if (preSnap) fs.copyFileSync(DB_PATH, preSnap);
    // 覆盖主库，并删除 WAL/SHM（否则旧 WAL 会与替换后的主库不一致）
    fs.copyFileSync(target.abs, DB_PATH);
    for (const f of [wal, shm]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {} }
    const after = verifyBackup(DB_PATH);
    if (!after.ok) {
      console.error('✗ 恢复后校验失败：' + (after.error || after.integrity));
      console.error('  可用恢复前快照回滚：' + (preSnap ? path.basename(preSnap) : '（无）'));
      return 1;
    }
    console.log(`✓ 恢复完成并校验通过（users=${after.users}）。`);
    if (preSnap) console.log('  恢复前快照：' + path.basename(preSnap) + '（确认无误后可自行删除）');
    return 0;
  } catch (e) {
    console.error('✗ 恢复失败：' + e.message);
    return 1;
  }
}

function usage() {
  console.log(`用法：
  node scripts/backup_cli.js list
  node scripts/backup_cli.js verify <latest|序号|文件名>
  node scripts/backup_cli.js restore <latest|序号|文件名> [--yes]

数据库：${DB_PATH}
备份目录：${BACKUP_DIR}`);
}

function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const yes = rest.includes('--yes') || arg === '--yes';
  const targetArg = arg && arg !== '--yes' ? arg : 'latest';
  if (cmd === 'list') process.exit(cmdList());
  if (cmd === 'verify') process.exit(cmdVerify(targetArg));
  if (cmd === 'restore') process.exit(cmdRestore(targetArg, yes));
  usage();
  process.exit(cmd ? 1 : 0);
}

main();
