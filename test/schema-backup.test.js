/* schema 迁移、题库导入原子性、备份 */
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, request, login, openDb, makeTempDir, APP_DIR } = require('./helpers');

const SOURCE_BANK = path.join(APP_DIR, 'data', 'gaokao_translations.json');

describe('schema 版本管理', () => {
  let srv;

  before(async () => { srv = await startServer({ tag: 'schema' }); });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('新库建成后 user_version 被写入', async () => {
    await srv.stop();   // 先停服，确保 WAL 已 checkpoint
    const db = openDb(path.join(srv.dataDir, 'app.db'));
    try {
      const v = Number(db.prepare('PRAGMA user_version').get().user_version);
      assert.ok(v >= 3, `user_version 应 >= 3，实际 ${v}`);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
      for (const t of ['users', 'sessions', 'user_data', 'gaokao_questions']) {
        assert.ok(tables.includes(t), `缺少表 ${t}`);
      }
    } finally { db.close(); }
  });

  test('schema 版本高于程序支持时拒绝启动', async () => {
    const dir = makeTempDir('futurever');
    const dbPath = path.join(dir, 'app.db');
    const db = openDb(dbPath);
    db.exec('PRAGMA user_version = 999');
    db.close();

    let started = null;
    let failed = false;
    try {
      started = await startServer({ tag: 'future', dataDir: dir });
    } catch (e) {
      failed = true;
      assert.match(e.message, /高于本程序支持|server 未在超时内就绪/);
    }
    if (started) { await started.stop(); started.cleanup(); }
    fs.rmSync(dir, { recursive: true, force: true });
    assert.ok(failed, '应拒绝启动');
  });

  test('重复启动不重复迁移（幂等）', async () => {
    const dir = makeTempDir('idem');
    const a = await startServer({ tag: 'idem-a', dataDir: dir });
    await a.stop();
    const firstLog = a.stdout;

    const b = await startServer({ tag: 'idem-b', dataDir: dir });
    const secondLog = b.stdout;
    await b.stop();
    b.cleanup();

    assert.match(firstLog, /migration 3/, '首次启动应执行迁移');
    assert.ok(!/migration 3/.test(secondLog), '二次启动不应重复执行迁移');
  });

  test('优雅关闭会 checkpoint WAL 并保留数据', async (t) => {
    const dir = makeTempDir('wal');
    const s = await startServer({ tag: 'wal', dataDir: dir });
    const token = await login(s.port, 'test', 'test');
    await request({ port: s.port, method: 'POST', path: '/api/db/vocab', token, json: [{ word: 'checkpoint' }] });

    const graceful = await s.gracefulStop();
    await new Promise((r) => setTimeout(r, 400));

    // 数据必须持久化（无论关闭方式，SQLite 崩溃恢复也应保证这一点）
    const db = openDb(path.join(dir, 'app.db'));
    try {
      const row = db.prepare('SELECT value FROM user_data WHERE key=?').get('vocab');
      assert.ok(row && row.value.includes('checkpoint'), '数据应可读回');
    } finally { db.close(); }

    if (graceful) {
      assert.match(s.stdout, /正在优雅关闭/, '应执行优雅关闭流程');
      const walPath = path.join(dir, 'app.db-wal');
      const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
      assert.ok(walSize < 64 * 1024, `优雅关闭后 WAL 应已并回主库，实际 ${walSize} 字节`);
    } else {
      t.diagnostic('当前平台无法向子进程投递 SIGTERM，跳过 WAL checkpoint 断言（已验证数据可读回）');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('周期性 checkpoint 已注册（防止 Windows 直接关窗口时 WAL 无限增长）', async () => {
    // Windows 关闭控制台窗口走 TerminateProcess，不触发信号处理，
    // 因此不能只依赖关闭时 checkpoint。这里校验定时 checkpoint 存在。
    const src = fs.readFileSync(path.join(APP_DIR, 'server.js'), 'utf8');
    assert.match(src, /setInterval\(\s*\(\)\s*=>\s*checkpointWal/, '应存在周期性 WAL checkpoint');
    assert.match(src, /wal_checkpoint\(TRUNCATE\)/, '优雅关闭时应做 TRUNCATE checkpoint');
  });
});

describe('题库导入原子性', () => {
  test('源 JSON 损坏时不清空已有题库', async (t) => {
    if (!fs.existsSync(SOURCE_BANK)) return t.skip('缺少 data/gaokao_translations.json，跳过');

    const dir = makeTempDir('bank');
    fs.copyFileSync(SOURCE_BANK, path.join(dir, 'gaokao_translations.json'));

    // 第一次启动：正常导入
    const a = await startServer({ tag: 'bank-a', dataDir: dir });
    const tokenA = await login(a.port, 'test', 'test');
    const listA = JSON.parse((await request({ port: a.port, path: '/api/gaokao/exams', token: tokenA })).body);
    assert.ok(listA.total > 0, '首次应导入题库');
    await a.stop();

    // 制造「旧数据」状态：清空 q_words，触发重建路径
    const db = openDb(path.join(dir, 'app.db'));
    const before = db.prepare('SELECT COUNT(*) c FROM gaokao_questions').get().c;
    db.exec("UPDATE gaokao_questions SET q_words = ''");
    db.close();
    assert.ok(before > 0);

    // 破坏源 JSON
    fs.writeFileSync(path.join(dir, 'gaokao_translations.json'), '[{"试卷":"broken", ', 'utf8');

    // 第二次启动：导入应失败，但旧题库必须保留
    const b = await startServer({ tag: 'bank-b', dataDir: dir });
    assert.match(b.stderr, /题库初始化失败（旧数据未受影响）/);
    const tokenB = await login(b.port, 'test', 'test');
    const listB = JSON.parse((await request({ port: b.port, path: '/api/gaokao/exams', token: tokenB })).body);
    assert.ok(listB.total > 0, '源文件损坏时旧题库不得被清空');
    await b.stop();

    // 恢复源 JSON：应成功重建并带回 q_words
    fs.copyFileSync(SOURCE_BANK, path.join(dir, 'gaokao_translations.json'));
    const c = await startServer({ tag: 'bank-c', dataDir: dir });
    assert.match(c.stdout, /题库初始化完成/);
    const tokenC = await login(c.port, 'test', 'test');
    const exams = JSON.parse((await request({ port: c.port, path: '/api/gaokao/exams', token: tokenC })).body);
    assert.ok(exams.total > 0);

    // 单卷详情：source_file 必须有值（此前 SELECT 漏列，恒为空）
    const one = JSON.parse((await request({
      port: c.port, path: '/api/gaokao/exam/' + encodeURIComponent(exams.exams[0].exam), token: tokenC
    })).body);
    assert.ok(one.source_file && one.source_file.length > 0, 'source_file 应有值');
    assert.ok(one.questions.length > 0);
    assert.ok(one.questions.some(q => Array.isArray(q.q_words) && q.q_words.length), '应带回必用词');
    await c.stop();

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('高考推送入参校验', () => {
  let srv;
  let token;

  before(async () => {
    srv = await startServer({ tag: 'push' });
    token = await login(srv.port, 'test', 'test');
  });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('批量超限 / 非法 id 一律 400', async () => {
    const cases = [
      { ids: Array.from({ length: 200 }, (_, i) => i + 1) },
      { ids: [] },
      { ids: ['1junk', -3, 0] },
      { ids: [1.5] },
      { ids: [Number.MAX_VALUE] },
      {}
    ];
    for (const json of cases) {
      const r = await request({ port: srv.port, method: 'POST', path: '/api/gaokao/push-to-anki', token, json });
      assert.strictEqual(r.status, 400, `${JSON.stringify(json)} 应 400，实际 ${r.status} ${r.body.slice(0, 120)}`);
    }
  });
});

describe('备份', () => {
  let srv;
  let token;

  before(async () => {
    srv = await startServer({ tag: 'backup' });
    token = await login(srv.port, 'test', 'test');
  });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('连续备份不会因同秒同名而失败', async () => {
    const names = new Set();
    for (let i = 0; i < 3; i++) {
      const r = await request({ port: srv.port, method: 'POST', path: '/api/backup', token });
      assert.strictEqual(r.status, 200, `第 ${i + 1} 次备份应成功，实际 ${r.status} ${r.body}`);
      const file = JSON.parse(r.body).file;
      assert.ok(!names.has(file), '备份文件名不应重复');
      names.add(file);
    }
    const dir = path.join(srv.dataDir, 'backups');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('_chat.db'));
    assert.ok(files.length >= 1);
  });

  test('备份产物是可打开的 SQLite 库', async () => {
    const r = await request({ port: srv.port, method: 'POST', path: '/api/backup', token });
    const file = JSON.parse(r.body).file;
    const db = openDb(path.join(srv.dataDir, 'backups', file));
    try {
      const c = db.prepare('SELECT COUNT(*) c FROM users').get().c;
      assert.ok(c >= 1, '备份中应含用户表数据');
      const v = Number(db.prepare('PRAGMA user_version').get().user_version);
      assert.ok(v >= 3, '备份应保留 schema 版本');
    } finally { db.close(); }
  });
});
