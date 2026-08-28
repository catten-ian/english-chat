/* Anki 代理白名单与牌组归属校验
   这些用例只验证「代理层是否放行」，全部在 AnkiConnect 未运行时也能跑：
   - 被拒绝 → 4xx（校验发生在连接 AnkiConnect 之前）
   - 被放行 → 503 ankiconnect unreachable（说明通过了校验，只是本机没开 Anki）
   若本机恰好开着 Anki，放行分支可能返回 200/502，同样视为「已放行」。
*/
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { startServer, request, login } = require('./helpers');

const OWNED = '英语学习::test::薄弱点';
const OWNED_ROOT = '英语学习::test';
const FOREIGN = '英语学习::catten::薄弱点';

describe('Anki 代理：白名单与归属', () => {
  let srv;
  let token;

  before(async () => {
    srv = await startServer({ tag: 'anki' });
    token = await login(srv.port, 'test', 'test');
  });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  const call = (json) => request({ port: srv.port, method: 'POST', path: '/api/proxy/anki', token, json });

  function assertDenied(r, msg) {
    assert.ok(r.status >= 400 && r.status < 500, `${msg}：应被代理层拒绝（4xx），实际 ${r.status} ${r.body.slice(0, 160)}`);
  }
  function assertPassedGuard(r, msg) {
    // 通过校验后才会去连 AnkiConnect：未运行 → 503；运行中 → 200/502
    assert.ok([200, 502, 503].includes(r.status), `${msg}：应通过校验，实际 ${r.status} ${r.body.slice(0, 160)}`);
  }

  test('未鉴权无法访问 Anki 代理', async () => {
    const r = await request({ port: srv.port, method: 'POST', path: '/api/proxy/anki', json: { action: 'version', version: 6 } });
    assert.strictEqual(r.status, 401);
  });

  test('非法 JSON 400', async () => {
    const r = await request({ port: srv.port, method: 'POST', path: '/api/proxy/anki', token, raw: '{{{' });
    assert.strictEqual(r.status, 400);
  });

  test('白名单外的高危 action 一律 403', async () => {
    // 注意：findNotes / notesInfo 属于白名单内（生词去重需要），
    // 它们的越权场景在下面的专项用例里验证。
    const dangerous = [
      'deleteDecks', 'deleteNotes', 'removeDeck', 'deleteMediaFile',
      'sync', 'exportPackage', 'importPackage', 'multi',
      'guiImportFile', 'reloadCollection', 'getProfiles', 'loadProfile',
      'updateNoteFields', 'setDeckConfigId', 'removeTags', 'addTags',
      'retrieveMediaFile', 'getMediaFilesNames', 'apiReflect',
      'guiBrowse', 'guiExitAnki', 'suspend', 'unsuspend', 'relearnCards'
    ];
    for (const action of dangerous) {
      const r = await call({ action, version: 6, params: {} });
      assert.strictEqual(r.status, 403, `${action} 应 403，实际 ${r.status}`);
    }
  });

  test('缺少 action 400', async () => {
    const r = await call({ version: 6 });
    assert.strictEqual(r.status, 400);
  });

  test('只读 action 放行', async () => {
    for (const action of ['version', 'deckNames', 'modelNames', 'getNumCardsReviewedToday', 'getNumCardsReviewedByDay']) {
      assertPassedGuard(await call({ action, version: 6 }), action);
    }
  });

  test('GUI 复习动作放行', async () => {
    assertPassedGuard(await call({ action: 'guiCurrentCard', version: 6 }), 'guiCurrentCard');
    assertPassedGuard(await call({ action: 'guiShowAnswer', version: 6 }), 'guiShowAnswer');
    assertPassedGuard(await call({ action: 'guiAnswerCard', version: 6, params: { ease: 3 } }), 'guiAnswerCard');
  });

  test('addNote：本人牌组放行，他人牌组 403', async () => {
    const note = (deckName) => ({
      action: 'addNote', version: 6,
      params: { note: { deckName, modelName: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: ['ai-english'] } }
    });
    assertPassedGuard(await call(note(OWNED)), 'addNote 本人牌组');
    assertDenied(await call(note(FOREIGN)), 'addNote 他人牌组');
    assertDenied(await call(note('Default')), 'addNote 默认牌组');
    assertDenied(await call(note('英语学习')), 'addNote 顶层牌组');
    assertDenied(await call(note('英语学习::testX::x')), 'addNote 前缀相似但不同用户');
  });

  test('addNote：非白名单模型 403', async () => {
    const r = await call({
      action: 'addNote', version: 6,
      params: { note: { deckName: OWNED, modelName: 'Cloze', fields: {}, tags: [] } }
    });
    assertDenied(r, 'addNote 非白名单模型');
  });

  test('addNotes：任一条目越界即拒绝，并有数量上限', async () => {
    const mk = (deckName) => ({ deckName, modelName: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] });

    assertPassedGuard(await call({ action: 'addNotes', version: 6, params: { notes: [mk(OWNED), mk(OWNED_ROOT + '::词汇')] } }), 'addNotes 全本人');
    assertDenied(await call({ action: 'addNotes', version: 6, params: { notes: [mk(OWNED), mk(FOREIGN)] } }), 'addNotes 含他人牌组');
    assertDenied(await call({ action: 'addNotes', version: 6, params: { notes: [] } }), 'addNotes 空数组');
    assertDenied(await call({ action: 'addNotes', version: 6, params: { notes: Array(201).fill(mk(OWNED)) } }), 'addNotes 超量');
  });

  test('canAddNotes 同样受约束', async () => {
    const mk = (deckName) => ({ deckName, modelName: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] });
    assertPassedGuard(await call({ action: 'canAddNotes', version: 6, params: { notes: [mk(OWNED)] } }), 'canAddNotes 本人');
    assertDenied(await call({ action: 'canAddNotes', version: 6, params: { notes: [mk(FOREIGN)] } }), 'canAddNotes 他人');
  });

  test('createDeck / guiDeckReview / getDeckStats 限定本人牌组', async () => {
    assertPassedGuard(await call({ action: 'createDeck', version: 6, params: { deck: OWNED } }), 'createDeck 本人');
    assertDenied(await call({ action: 'createDeck', version: 6, params: { deck: FOREIGN } }), 'createDeck 他人');

    assertPassedGuard(await call({ action: 'guiDeckReview', version: 6, params: { name: OWNED } }), 'guiDeckReview 本人');
    assertDenied(await call({ action: 'guiDeckReview', version: 6, params: { name: FOREIGN } }), 'guiDeckReview 他人');

    assertPassedGuard(await call({ action: 'getDeckStats', version: 6, params: { decks: [OWNED] } }), 'getDeckStats 本人');
    assertDenied(await call({ action: 'getDeckStats', version: 6, params: { decks: [OWNED, FOREIGN] } }), 'getDeckStats 含他人');
  });

  test('changeDeck 校验目标牌组与卡片 id', async () => {
    assertPassedGuard(await call({ action: 'changeDeck', version: 6, params: { deck: OWNED, cards: [1, 2, 3] } }), 'changeDeck 本人');
    assertDenied(await call({ action: 'changeDeck', version: 6, params: { deck: FOREIGN, cards: [1] } }), 'changeDeck 他人');
    assertDenied(await call({ action: 'changeDeck', version: 6, params: { deck: OWNED, cards: [] } }), 'changeDeck 空卡片');
    assertDenied(await call({ action: 'changeDeck', version: 6, params: { deck: OWNED, cards: ['x'] } }), 'changeDeck 非法 id');
    assertDenied(await call({ action: 'changeDeck', version: 6, params: { deck: OWNED, cards: Array(501).fill(1) } }), 'changeDeck 超量');
  });

  test('findCards 必须限定在本人牌组', async () => {
    assertPassedGuard(await call({ action: 'findCards', version: 6, params: { query: 'deck:' + OWNED } }), 'findCards 本人');
    assertPassedGuard(await call({ action: 'findCards', version: 6, params: { query: 'deck:' + OWNED + ' is:due' } }), 'findCards 本人+is:due');
    assertDenied(await call({ action: 'findCards', version: 6, params: { query: 'deck:*' } }), 'findCards 全库');
    assertDenied(await call({ action: 'findCards', version: 6, params: { query: 'deck:' + FOREIGN } }), 'findCards 他人');
    assertDenied(await call({ action: 'findCards', version: 6, params: { query: '' } }), 'findCards 空 query');
  });

  test('findCards 允许纯 nid 列表（addNote 后归位牌组用）', async () => {
    // ensureDeckPlacement 会用 'nid:123 OR nid:456' 找刚添加的卡片
    assertPassedGuard(await call({ action: 'findCards', version: 6, params: { query: 'nid:1712345678901' } }), 'findCards 单个 nid');
    assertPassedGuard(await call({ action: 'findCards', version: 6, params: { query: 'nid:1 OR nid:2 OR nid:3' } }), 'findCards 多个 nid');
    // 混入非 nid 条件则拒绝，避免借此绕过牌组限制
    assertDenied(await call({ action: 'findCards', version: 6, params: { query: 'nid:1 OR deck:*' } }), 'findCards nid 混 deck:*');
    assertDenied(await call({ action: 'findCards', version: 6, params: { query: 'nid:1 OR tag:foo' } }), 'findCards nid 混 tag');
    assertDenied(await call({ action: 'findCards', version: 6, params: { query: 'nid:abc' } }), 'findCards 非法 nid');
  });

  test('cardsInfo 校验 id 与数量', async () => {
    assertPassedGuard(await call({ action: 'cardsInfo', version: 6, params: { cards: [1, 2] } }), 'cardsInfo 正常');
    assertDenied(await call({ action: 'cardsInfo', version: 6, params: { cards: [] } }), 'cardsInfo 空');
    assertDenied(await call({ action: 'cardsInfo', version: 6, params: { cards: [-1] } }), 'cardsInfo 负数');
    assertDenied(await call({ action: 'cardsInfo', version: 6, params: { cards: Array(501).fill(1) } }), 'cardsInfo 超量');
  });

  test('findNotes 限定本人牌组，notesInfo 校验 id（生词去重用）', async () => {
    assertPassedGuard(await call({ action: 'findNotes', version: 6, params: { query: 'deck:' + OWNED_ROOT + '::词汇 tag:vocabulary' } }), 'findNotes 本人');
    assertDenied(await call({ action: 'findNotes', version: 6, params: { query: 'deck:*' } }), 'findNotes 全库');
    assertDenied(await call({ action: 'findNotes', version: 6, params: { query: 'deck:' + FOREIGN } }), 'findNotes 他人');
    assertDenied(await call({ action: 'findNotes', version: 6, params: { query: '' } }), 'findNotes 空 query');

    assertPassedGuard(await call({ action: 'notesInfo', version: 6, params: { notes: [1, 2, 3] } }), 'notesInfo 正常');
    assertDenied(await call({ action: 'notesInfo', version: 6, params: { notes: [] } }), 'notesInfo 空');
    assertDenied(await call({ action: 'notesInfo', version: 6, params: { notes: ['x'] } }), 'notesInfo 非法 id');
    assertDenied(await call({ action: 'notesInfo', version: 6, params: { notes: Array(501).fill(1) } }), 'notesInfo 超量');
  });

  test('createModel / updateModelStyling 只允许本应用模型', async () => {
    assertPassedGuard(await call({ action: 'createModel', version: 6, params: { modelName: '英语学习-词汇', inOrderFields: ['Front', 'Back'], cardTemplates: [] } }), 'createModel 允许');
    assertDenied(await call({ action: 'createModel', version: 6, params: { modelName: 'Evil', inOrderFields: [], cardTemplates: [] } }), 'createModel 非白名单');
    assertPassedGuard(await call({ action: 'updateModelStyling', version: 6, params: { model: { name: '英语学习-词汇', css: '' } } }), 'updateModelStyling 允许');
    assertDenied(await call({ action: 'updateModelStyling', version: 6, params: { model: { name: 'Basic-Other', css: '' } } }), 'updateModelStyling 非白名单');
  });

  test('storeMediaFile 只允许应用自己的文件名，禁止 path/url', async () => {
    assertPassedGuard(await call({ action: 'storeMediaFile', version: 6, params: { filename: 'ai_en_123.mp3', data: 'AAAA', deleteExisting: true } }), 'storeMediaFile 正常');
    assertDenied(await call({ action: 'storeMediaFile', version: 6, params: { filename: '../../evil.mp3', data: 'AAAA' } }), 'storeMediaFile 路径穿越');
    assertDenied(await call({ action: 'storeMediaFile', version: 6, params: { filename: 'evil.exe', data: 'AAAA' } }), 'storeMediaFile 非法扩展名');
    assertDenied(await call({ action: 'storeMediaFile', version: 6, params: { filename: 'ai_en_1.mp3', path: 'C:/Windows/win.ini' } }), 'storeMediaFile path');
    assertDenied(await call({ action: 'storeMediaFile', version: 6, params: { filename: 'ai_en_1.mp3', url: 'http://evil/x.mp3' } }), 'storeMediaFile url');
    assertDenied(await call({ action: 'storeMediaFile', version: 6, params: { filename: 'ai_en_1.mp3' } }), 'storeMediaFile 缺 data');
  });

  test('不同用户的牌组根不同（catten 不能操作 test 的牌组）', async () => {
    const cattenToken = await login(srv.port, 'catten', 'catten');
    const r = await request({
      port: srv.port, method: 'POST', path: '/api/proxy/anki', token: cattenToken,
      json: { action: 'createDeck', version: 6, params: { deck: OWNED } }
    });
    assertDenied(r, 'catten 操作 test 牌组');

    const own = await request({
      port: srv.port, method: 'POST', path: '/api/proxy/anki', token: cattenToken,
      json: { action: 'createDeck', version: 6, params: { deck: FOREIGN } }
    });
    assertPassedGuard(own, 'catten 操作自己牌组');
  });
});
