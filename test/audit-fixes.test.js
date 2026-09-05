/* ============================================================
   回归测试：2026-09 审计修复
   ------------------------------------------------------------
   每个用例都对应一个真实存在过的缺陷，注释里写清原始症状，
   避免以后重构时把同样的坑再挖一遍。
   ============================================================ */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { APP_DIR, startServer, request, login } = require('./helpers');
const { ankiQueryScoped, ankiGuard } = require('../server/validation');
const { createRateLimiter } = require('../server/rate-limit');

/* ---------- Anki 检索串归属校验 ---------- */
describe('Anki query 归属校验（原缺陷：includes 判定可被 OR 绕过）', () => {
  const root = '英语学习::catten';

  test('应用实际使用的三种检索形态仍放行', () => {
    // js/app/06-anki.js:548 / :623 与 js/app/22-web-review.js:57 的真实 query
    assert.ok(ankiQueryScoped('deck:英语学习::catten::词汇 tag:vocabulary', root));
    assert.ok(ankiQueryScoped('deck:英语学习::catten::薄弱点', root));
    // 括号内的 OR 是安全的，不能误伤
    assert.ok(ankiQueryScoped('deck:英语学习::catten (is:due OR is:new OR is:learn)', root));
  });

  test('nid: 列表放行（addNotes 后 changeDeck 归位用）', () => {
    assert.ok(ankiQueryScoped('nid:1712345678901', root), '单个 nid 也必须放行');
    assert.ok(ankiQueryScoped('nid:1 OR nid:22 OR nid:333', root));
  });

  test('顶层 OR 追加不受限分支被拒（核心漏洞）', () => {
    // 旧实现只做 query.includes('deck:'+root)，下面三条全都会放行 → 整库可读 / 任意卡片可搬走
    assert.ok(!ankiQueryScoped('deck:英语学习::catten OR deck:*', root));
    assert.ok(!ankiQueryScoped('deck:英语学习::catten OR deck:别人的牌组', root));
    assert.ok(!ankiQueryScoped('deck:英语学习::catten or tag:marked', root));
  });

  test('通配符、取反牌组、非 deck 开头一律拒绝', () => {
    assert.ok(!ankiQueryScoped('deck:*', root));
    assert.ok(!ankiQueryScoped('deck:英语学习::catten::*', root));
    assert.ok(!ankiQueryScoped('-deck:英语学习::catten', root));
    assert.ok(!ankiQueryScoped('tag:vocabulary deck:英语学习::catten', root));
    assert.ok(!ankiQueryScoped('nid:1 OR tag:foo', root));
    assert.ok(!ankiQueryScoped('', root));
  });

  test('括号不配对按不安全处理', () => {
    assert.ok(!ankiQueryScoped('deck:英语学习::catten (is:due OR is:new', root));
  });

  test('ankiGuard 对 findCards/findNotes 生效', () => {
    const bad = ankiGuard({ action: 'findCards', params: { query: 'deck:英语学习::catten OR deck:*' } }, 'catten');
    assert.ok(bad && bad.status === 403, '越权 query 应被 403 拦下');
    const ok = ankiGuard({ action: 'findNotes', params: { query: 'deck:英语学习::catten::词汇 tag:vocabulary' } }, 'catten');
    assert.strictEqual(ok, null);
  });
});

/* ---------- addNote 媒体字段 ---------- */
describe('addNote 的 audio/picture/video 字段被拒绝', () => {
  test('note.audio 带 path 会把本机任意文件复制进 Anki 媒体库', () => {
    const r = ankiGuard({
      action: 'addNote',
      params: { note: { deckName: '英语学习::catten::词汇', fields: { Front: 'a', Back: 'b' }, audio: [{ path: 'C:/Windows/win.ini', filename: 'x.mp3' }] } }
    }, 'catten');
    assert.ok(r && r.status === 403, '应被拒绝，实际: ' + JSON.stringify(r));
  });

  test('addNotes 批量里的 picture/url 同样被拒绝', () => {
    const r = ankiGuard({
      action: 'addNotes',
      params: { notes: [{ deckName: '英语学习::catten::词汇', fields: {}, picture: [{ url: 'http://evil/x.png', filename: 'x.png' }] }] }
    }, 'catten');
    assert.ok(r && r.status === 403);
  });

  test('不带媒体字段的正常卡片仍放行', () => {
    const r = ankiGuard({
      action: 'addNote',
      params: { note: { deckName: '英语学习::catten::词汇', fields: { Front: 'a', Back: 'b' } } }
    }, 'catten');
    assert.strictEqual(r, null);
  });
});

/* ---------- CORS ---------- */
describe('CORS 不再放行 Origin: null', () => {
  test('config 里不含字面量 null', () => {
    const { ALLOWED_ORIGINS } = require('../server/config');
    assert.ok(!ALLOWED_ORIGINS.has('null'), 'Origin: null 可由任意站点的 sandbox iframe 伪造');
    assert.ok(ALLOWED_ORIGINS.has('http://localhost:8091'));
  });
});

/* ---------- 限流器 clear ---------- */
describe('rate limiter', () => {
  test('clear 只清单个 key', () => {
    const l = createRateLimiter({ windowMs: 60000, max: 2 });
    l.hit('a'); l.hit('a'); l.hit('b');
    assert.ok(!l.check('a').ok, 'a 应已超限');
    l.clear('a');
    assert.ok(l.check('a').ok, 'clear 后 a 应恢复');
    assert.strictEqual(l.size(), 1, 'b 的计数不应被一起清掉');
  });

  test('窗口滑出后自动恢复', () => {
    const l = createRateLimiter({ windowMs: 1000, max: 1 });
    const t0 = 1_000_000;
    l.hit('k', t0);
    assert.ok(!l.check('k', t0 + 500).ok);
    assert.ok(l.check('k', t0 + 1500).ok);
  });
});

/* ---------- 前端源码级回归 ---------- */
describe('前端源码回归', () => {
  const read = (rel) => fs.readFileSync(path.join(APP_DIR, rel), 'utf8');

  test('对话标题换行正则不是字符类 [\\n\\r] 的字面反斜杠写法', () => {
    // 原缺陷：/[\\n\\r]+/g 实际匹配的是 \ n r 三个字符，标题里所有 n/r 被吃掉
    const src = read('js/storage.js');
    assert.ok(!/\[\\\\n\\\\r\]/.test(src), 'js/storage.js 里仍有 [\\\\n\\\\r] 写法');
    assert.match(src, /replace\(\/\[\\n\\r\]\+\/g/, '应使用真正的换行字符类');
  });

  test('reconnectAnkiConnect 的调用没有被行尾注释吞掉', () => {
    // 原缺陷：`// 强制重新探测  const ok = await checkAnkiConnect(true);` → ok 未定义，按钮必抛
    const src = read('js/app/12-settings.js');
    const m = src.match(/async function reconnectAnkiConnect\(\)[\s\S]{0,400}?\n\}/);
    assert.ok(m, '未找到 reconnectAnkiConnect');
    assert.match(m[0], /^\s*const ok = await checkAnkiConnect\(true\);/m, 'checkAnkiConnect 调用必须在独立一行');
  });

  test('查词失败分支不再引用未定义的 raw', () => {
    // 原缺陷：html = esc(cleaned || raw) → "查询失败: raw is not defined"
    const src = read('js/app/10-dictionary.js');
    assert.ok(!/esc\(cleaned \|\| raw\)/.test(src), '仍在引用未定义的 raw');
    assert.match(src, /esc\(cleaned \|\| accText \|\| ''\)/);
  });

  test('查词只统计一次 weak_points', () => {
    // 原缺陷：同一段 forEach(addWeakPoint) 写了两遍，薄弱点计数翻倍
    const src = read('js/app/10-dictionary.js');
    const hits = src.match(/obj\.weak_points\.forEach/g) || [];
    assert.strictEqual(hits.length, 1, 'weak_points 只应遍历一次，实际 ' + hits.length + ' 次');
  });

  test('ankiAddNotesBatch 的 order 与传入 notes 对齐', () => {
    // 原缺陷：order 按去重后的 toAdd 构建，调用方却按原始下标取 → note id 绑错薄弱点
    const src = read('js/app/06-anki.js');
    assert.match(src, /const order = new Array\(notes\.length\)\.fill\(null\)/);
    assert.match(src, /order\[idxMap\[j\]\] =/);
  });

  test('自动备份定时器只在已登录时打服务端', () => {
    const src = read('js/app/19-init.js');
    assert.match(src, /if \(!isAuthed\(\)\) return;/, '未登录时不应 POST /api/backup');
  });
});

/* ---------- USER_CACHE_KEYS 与草稿键一致性 ---------- */
describe('登出清缓存覆盖全部用户态键', () => {
  test('15-modes.js 的 DRAFT_KEYS 全部在 storage.js 的 USER_CACHE_KEYS 里', () => {
    // 原缺陷：草稿键不在清理列表 → A 登出后 B 会看到 A 的作文/翻译原文
    const modes = fs.readFileSync(path.join(APP_DIR, 'js/app/15-modes.js'), 'utf8');
    const storage = fs.readFileSync(path.join(APP_DIR, 'js/storage.js'), 'utf8');
    const line = modes.match(/const DRAFT_KEYS = \{[^}]+\}/);
    assert.ok(line, '未找到 DRAFT_KEYS');
    const keys = [...line[0].matchAll(/'(ai_en_[a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(keys.length >= 3, '应至少有 3 个草稿键，实际 ' + keys.length);
    const cacheBlock = storage.match(/const USER_CACHE_KEYS = \[[\s\S]*?\];/);
    assert.ok(cacheBlock, '未找到 USER_CACHE_KEYS');
    for (const k of keys) {
      assert.ok(cacheBlock[0].includes("'" + k + "'"), k + ' 不在 USER_CACHE_KEYS 中（登出不会清除）');
    }
  });

  test('只存在本地的偏好键都进了 settings 同步白名单', () => {
    // 原缺陷：trHistory/trQuestionStats/trCustomBank/dictHistory 等只写本地，
    // 登出清 ai_en_setting_* 后永久丢失（服务端没有副本）
    const storage = fs.readFileSync(path.join(APP_DIR, 'js/storage.js'), 'utf8');
    const block = storage.match(/const SYNCED_SETTING_KEYS = \[[\s\S]*?\];/);
    assert.ok(block, '未找到 SYNCED_SETTING_KEYS');
    for (const k of ['trHistory', 'trQuestionStats', 'trCustomBank', 'dictHistory', 'ankiVocabPhase', 'ankiStreak']) {
      assert.ok(block[0].includes("'" + k + "'"), k + ' 未纳入同步，登出即丢');
    }
    // setSetting 必须真的调用同步钩子，否则白名单是死的
    const chat = fs.readFileSync(path.join(APP_DIR, 'js/app/07-chat-actions.js'), 'utf8');
    assert.match(chat, /syncSettingToServer\(key\)/, 'setSetting 未接入同步钩子');
  });
});

/* ---------- 背景音乐播放逻辑（此前零测试） ---------- */
describe('背景音乐播放逻辑', () => {
  const store = {};
  const settings = {};
  const els = {};
  function makeEl(id) {
    return {
      id, textContent: '', value: '0', max: '100', style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {}, appendChild() {}, querySelector() { return makeEl('q'); },
      setAttribute() {}, getBoundingClientRect() { return { right: 300, bottom: 50, left: 0, top: 0 }; }
    };
  }
  const sandbox = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    document: {
      getElementById: (id) => (els[id] || (els[id] = makeEl(id))),
      createElement: () => makeEl('created'),
      body: { appendChild() {} },
      activeElement: null,
      addEventListener() {}
    },
    Audio: function () {
      return {
        src: '', loop: false, volume: 1, currentTime: 0, duration: 100, paused: true, dataset: {},
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; },
        addEventListener() {}
      };
    },
    navigator: {}, window: {}, BACKEND_URL: '', console,
    setTimeout, clearTimeout, Date, Math, JSON, isFinite, parseInt, parseFloat, String, Number, Array,
    getSetting: (k, d) => (k in settings ? settings[k] : d),
    setSetting: (k, v) => { settings[k] = v; },
    dbg() {}, esc: (s) => s,
    fetch: () => Promise.reject(new Error('no network in test'))
  };
  let T;

  before(() => {
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(APP_DIR, 'js/app/14-music.js'), 'utf8');
    // let 声明不挂 globalThis，用同脚本内的钩子读写内部状态
    const hooks = `;globalThis.__t = {
      setItems(v){ musicItems = v; }, setIdx(v){ musicIdx = v; }, getIdx(){ return musicIdx; },
      setAudio(v){ musicAudio = v; }, getAudio(){ return musicAudio; }, setPlay(fn){ musicPlayIdx = fn; }
    };`;
    vm.runInContext(src + hooks, sandbox);
    T = sandbox.__t;
  });

  test('播放模式三档循环并持久化', () => {
    assert.strictEqual(sandbox.musicMode(), 'list');
    sandbox.cycleMusicMode();
    assert.strictEqual(sandbox.musicMode(), 'single');
    sandbox.cycleMusicMode();
    assert.strictEqual(sandbox.musicMode(), 'shuffle');
    sandbox.cycleMusicMode();
    assert.strictEqual(sandbox.musicMode(), 'list');
    assert.strictEqual(settings.musicMode, 'list', '模式应写入设置');
  });

  test('时间格式化', () => {
    assert.strictEqual(sandbox.fmtMusicTime(0), '0:00');
    assert.strictEqual(sandbox.fmtMusicTime(75), '1:15');
    assert.strictEqual(sandbox.fmtMusicTime(NaN), '0:00', '非法值兜底为 0:00');
  });

  test('advanceTrack：单曲重播 / 列表顺序 / 随机不重复', () => {
    T.setItems([{ file: 'a', name: 'A' }, { file: 'b', name: 'B' }, { file: 'c', name: 'C' }]);
    const played = [];
    T.setPlay((i) => { played.push(i); T.setIdx(i); });

    settings.musicMode = 'single';
    T.setIdx(1);
    sandbox.advanceTrack();
    assert.deepStrictEqual(played, [1], '单曲循环应重播当前曲目');

    settings.musicMode = 'list';
    sandbox.advanceTrack();
    assert.strictEqual(played[1], 2, '列表循环应播下一首');
    T.setIdx(2);
    sandbox.advanceTrack();
    assert.strictEqual(played[2], 0, '末尾应回到第一首');

    settings.musicMode = 'shuffle';
    T.setIdx(0);
    for (let k = 0; k < 30; k++) {
      const before = T.getIdx();
      sandbox.advanceTrack();
      assert.notStrictEqual(T.getIdx(), before, '随机播放不应连续重复同一首');
    }
  });

  test('上一首：>3s 回本曲开头，否则切歌并环绕', () => {
    T.setItems([{ file: 'a' }, { file: 'b' }, { file: 'c' }]);
    const played = [];
    T.setPlay((i) => { played.push(i); T.setIdx(i); });
    settings.musicMode = 'list';

    T.setIdx(1);
    T.setAudio({ currentTime: 10, duration: 100 });
    sandbox.musicPrev();
    assert.strictEqual(played.length, 0, '>3s 不应切歌');
    assert.strictEqual(T.getAudio().currentTime, 0, '应回到本曲开头');

    T.setAudio({ currentTime: 1, duration: 100 });
    sandbox.musicPrev();
    assert.strictEqual(played[0], 0, '<3s 应切上一首');

    T.setIdx(0);
    T.setAudio({ currentTime: 1, duration: 100 });
    sandbox.musicPrev();
    assert.strictEqual(played[1], 2, 'idx=0 时应环绕到末首');
  });

  test('进度跳转做边界裁剪', () => {
    T.setAudio({ duration: 100, currentTime: 50 });
    sandbox.musicSeekTo(200);
    assert.strictEqual(T.getAudio().currentTime, 100);
    sandbox.musicSeekTo(-5);
    assert.strictEqual(T.getAudio().currentTime, 0);
    sandbox.musicSeekTo('abc');
    assert.strictEqual(T.getAudio().currentTime, 0, '非数字不应改变进度');
  });

  test('音量 1% 精度：取整 + 裁剪 + 三处控件同步', () => {
    sandbox.setMusicVol(150);
    assert.strictEqual(store.ai_en_music_vol, '100');
    sandbox.setMusicVol(-10);
    assert.strictEqual(store.ai_en_music_vol, '0');
    sandbox.setMusicVol(33.4);
    assert.strictEqual(store.ai_en_music_vol, '33', '小数应四舍五入到整数百分比');
    sandbox.setMusicVol('67.6');
    assert.strictEqual(store.ai_en_music_vol, '68');
    assert.strictEqual(els.setMusicVol.value, '68', '设置面板滑块应同步');
    assert.strictEqual(els.setMusicVolNum.value, '68', '设置面板数字框应同步');
    assert.strictEqual(els.musicPopVol.value, '68', '迷你播放器滑块应同步');
  });
});

/* ---------- 登录限流（真实 HTTP） ---------- */
describe('登录失败限流', () => {
  let srv;
  before(async () => { srv = await startServer({ tag: 'login-rl' }); });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('同一账户连续失败到上限后返回 429，且带 Retry-After', async () => {
    let saw429 = false;
    let attempts = 0;
    for (let i = 0; i < 14; i++) {
      attempts++;
      const r = await request({
        port: srv.port, method: 'POST', path: '/api/auth/login',
        json: { username: 'test', password: 'definitely-wrong-' + i }
      });
      if (r.status === 429) {
        saw429 = true;
        assert.ok(r.headers['retry-after'], '429 应带 Retry-After 头');
        break;
      }
      assert.strictEqual(r.status, 401, `第 ${i + 1} 次应是 401，实际 ${r.status}`);
    }
    assert.ok(saw429, `连续 ${attempts} 次失败仍未触发限流`);
  });

  test('锁定是按账户的：另一个账户仍能正常登录', async () => {
    // 关键取舍：本应用绑定 127.0.0.1，所有请求 IP 相同。
    // 若 IP 档阈值与账户档相同，恶意页面故意打 10 次错密码就能把真实用户一起锁死。
    const token = await login(srv.port, 'catten', 'catten');
    assert.ok(token, 'test 被锁不应影响 catten 登录');
    const me = await request({ port: srv.port, path: '/api/auth/me', token });
    assert.strictEqual(me.status, 200);
  });

  test('成功登录清零该账户的失败计数', async () => {
    for (let i = 0; i < 5; i++) {
      await request({ port: srv.port, method: 'POST', path: '/api/auth/login', json: { username: 'catten', password: 'wrong' + i } });
    }
    // 5 次失败后仍未到上限，正确密码应成功并清零
    const token = await login(srv.port, 'catten', 'catten');
    assert.ok(token);
    // 清零后再来 5 次失败也不该触发（累计 10 次但中间清零过）
    for (let i = 0; i < 5; i++) {
      const r = await request({ port: srv.port, method: 'POST', path: '/api/auth/login', json: { username: 'catten', password: 'wrong2-' + i } });
      assert.strictEqual(r.status, 401, '计数应已清零，实际 ' + r.status);
    }
  });

  test('登录请求体超过 8KB 返回 413', async () => {
    const r = await request({
      port: srv.port, method: 'POST', path: '/api/auth/login',
      raw: JSON.stringify({ username: 'nobody', password: 'x'.repeat(20000) })
    });
    assert.strictEqual(r.status, 413, '实际: ' + r.status + ' ' + r.body);
  });
});
