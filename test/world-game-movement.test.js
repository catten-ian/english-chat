'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const ts = require('../game/node_modules/typescript');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bellweather-movement-'));
process.env.AI_EN_DATA_DIR = temp;
process.env.AI_EN_GAME_WORKER = '0';
process.env.MINIMAX_API_KEY = '';
process.env.AIHUB8_API_KEY = '';
const route = require('../server/routes/world-game');
const { db } = require('../server/db');
const store = require('../server/services/world-game-store').getDefaultStore();
const nav = require('../shared/world-game-navigation.cjs');
const { parseHTML } = require('linkedom');
after(() => { route.stopWorker(); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
function loadTs(file, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../game/src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, ...globals });
  return exports;
}
async function move(uid, payload) {
  const raw = Buffer.from(JSON.stringify(payload));
  const req = new PassThrough(); req.uid = uid; req.headers = { 'content-length': String(raw.length) };
  let result;
  const pending = route.move(req, { writeHead(status) { this.status = status; }, end(body) { result = { status: this.status, ...JSON.parse(body) }; } });
  req.end(raw); await pending;
  return result;
}
test('movement route accepts actual corner waypoints, rejects a wall-cutting chord and bounds travelled distance', async () => {
  const uid = Number(db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)').run('movement-fixture', 'fixture').lastInsertRowid);
  const actualNow = Date.now; let now = actualNow(); Date.now = () => now;
  const start = { x: 3.5, z: -2 }, around = [{ x: 3.5, z: -4.2 }, { x: 5, z: -4.2 }], end = around.at(-1);
  const input = { stageId: 'low-tide', position: end };
  const reset = () => { store.move(uid, 'low-tide', start); now += 2000; };
  try {
    assert.equal(nav.segmentWalkable(start, end), false);
    reset(); assert.equal((await move(uid, input)).error, 'path is blocked');
    const accepted = await move(uid, { ...input, path: around }); assert.equal(accepted.status, 200); assert.deepEqual(accepted.position, end);
    reset();
    const loop = [{ x: 3.5, z: -4.2 }, { x: 3.5, z: -2 }, { x: 3.5, z: -4.2 }, { x: 3.5, z: -2 }, ...around];
    assert.equal((await move(uid, { ...input, path: loop })).error, 'movement too fast');
    assert.equal(store.getPosition(uid, 'low-tide').x, start.x);
    // A spoofed first waypoint is a destination from the saved position; it
    // cannot replace that position and skip the intervening wall.
    assert.equal((await move(uid, { ...input, path: [end] })).error, 'path is blocked');
    assert.equal((await move(uid, { ...input, path: [] })).status, 400);
    assert.equal((await move(uid, { ...input, path: Array(129).fill(end) })).status, 400);
    assert.equal((await move(uid, { ...input, path: [start] })).status, 400, 'path endpoint must match position');
    assert.equal((await move(uid, { ...input, path: [{ x: '5', z: -4.2 }] })).status, 400);
    assert.equal((await move(uid, { ...input, padding: 'x'.repeat(13 * 1024) })).status, 413);
    assert.equal((await move(uid, { stageId: 'low-tide', position: { x: 3.5, z: -3 } })).status, 200, 'legacy position-only client still works');
  } finally { Date.now = actualNow; }
});

test('movement trail retains unsent steps while a batch is in flight, preserves corners and bounds buffering', () => {
  const { MovementTrail } = loadTs('services/movement-trail.ts');
  const trail = new MovementTrail({ x: 0, z: 0 });
  trail.append({ x: 0, z: 1 }); trail.append({ x: 0, z: 2 }); trail.append({ x: 1, z: 2 });
  const first = trail.take(); assert.equal(first.path.length, 2);
  trail.append({ x: 2, z: 2 }); trail.append({ x: 2, z: 3 });
  assert.equal(first.path.length, 2, 'in-flight request is an immutable batch');
  const second = trail.take(); assert.deepEqual(JSON.parse(JSON.stringify(second.path)), [{ x: 2, z: 2 }, { x: 2, z: 3 }]);
  for (let i = 0; trail.canWalk; i++) trail.append({ x: 2 + (i % 2) * .001, z: 3 + i * .001 });
  assert.ok(trail.take().path.length <= 128);
  trail.reset({ x: 5, z: 4 }); assert.equal(trail.pending, false);
  assert.deepEqual(JSON.parse(JSON.stringify(trail.take().position)), { x: 5, z: 4 });
  for (let z = 4.1; trail.canWalk; z += .1) trail.append({ x: 5, z });
  assert.ok(trail.take().position.z < 10.2, 'straight-line simplification cannot allow unlimited offline distance');
});

test('main loop keeps in-flight movement, reconciles rejected paths, resets on chapter switch and aborts on exit', async () => {
  const { document, window } = parseHTML('<html><body><main id="game-root"></main></body></html>');
  const state = { player: { x: 2, z: -8 }, mode: '2d', currentStage: 'low-tide', activeNpcIds: [], clues: [] };
  const saved = stageId => ({ stageId, position: { x: 5, z: 4 }, stages: [{ id: stageId, npcs: [] }], evidence: [], feedback: { records: [], summaries: [] } });
  let raf, now = 0, options, loads = 0;
  const requests = [];
  const api = { load: async () => { loads++; return saved('low-tide'); }, feedback: async () => ({ records: [], summaries: [] }), switchStage: async id => saved(id), dispose() {} };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
  const key = (name, type = 'keydown') => { const event = new window.Event(type); event.key = name; document.dispatchEvent(event); window.dispatchEvent(event); };
  const frames = n => { for (let i = 0; i < n; i++) { now += 50; raf(now); } };
  const { MovementTrail } = loadTs('services/movement-trail.ts');
  const mocks = {
    './styles.css': {}, './content/world': { WORLD: { npcs: [] } },
    './simulation/state': { createState: () => state, saveState() {}, nearestNpc() {}, movePlayer(s, dx, dz, dt, onStep) { s.player = { x: s.player.x + dx * dt * 4.2, z: s.player.z + dz * dt * 4.2 }; onStep({ ...s.player }); } },
    './render/renderer': { createRenderer: () => ({ setMode() {}, render() {}, dispose() {} }) },
    './ui/hud': { createHud(root) {
      root.innerHTML = '<a id="wg-back"></a><canvas id="wg-canvas"></canvas><button id="wg-interact"></button><aside id="wg-feedback-panel" hidden></aside><button id="wg-feedback-close"></button>';
      return { refreshFeedback() {}, refreshSummaries() {}, update() {}, resetDialogue() {} };
    } },
    './ui/chapter': { createChapterPanel(root, handlers) { options = handlers; return { update() {}, idle() {}, busy() {}, error() {} }; } },
    './services/journey': { createJourneyApi: () => api }, './services/feedback': { readArchivedFeedback: () => [], mergeArchivedFeedback: value => value },
    './services/npc-stream': {}, './simulation/input': { movementFromScreen: (mode, x, z) => ({ x, z }) }, './services/movement-trail': { MovementTrail }
  };
  loadTs('main.ts', {
    document, window, location: { search: '?version=beta&view=2d', pathname: '/english-beta/world-game/' },
    localStorage: { getItem: name => name === 'ai_en_token' ? 'fixture-token' : name === 'ai_en_user' ? 'fixture-user' : null }, sessionStorage: { getItem: () => null },
    URLSearchParams, AbortController, AbortSignal, TextDecoder, crypto: { randomUUID: () => 'fixture-turn' }, performance: { now: () => 0 },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: callback => { raf = callback; return 1; }, cancelAnimationFrame() {},
    require: id => { assert.ok(Object.hasOwn(mocks, id), id); return mocks[id]; },
    fetch: (url, init) => new Promise((resolve, reject) => { requests.push({ body: JSON.parse(init.body), signal: init.signal, resolve, reject }); })
  });
  await flush();
  key('w'); frames(12); assert.equal(requests.length, 1);
  const first = requests[0]; key('w', 'keyup'); key('d'); frames(4);
  first.resolve({ ok: true, json: async () => ({ position: first.body.position }) }); await flush();
  frames(10); assert.equal(requests.length, 2);
  const second = requests[1];
  assert.ok(second.body.position.x > first.body.position.x, 'later rightward movement was not lost when earlier request completed');
  assert.ok(second.body.path.length >= 2, 'the turn made while waiting for the reply is preserved');
  second.resolve({ ok: false, status: 409 }); await flush();
  assert.equal(loads, 2); assert.deepEqual(JSON.parse(JSON.stringify(state.player)), { x: 5, z: 4 });
  key('d'); frames(11); assert.equal(requests.length, 3);
  const third = requests[2]; assert.equal(third.body.stageId, 'low-tide');
  third.reject(new Error('response lost after possible server acceptance')); await flush(); key('d', 'keyup');
  assert.equal(loads, 3); assert.deepEqual(JSON.parse(JSON.stringify(state.player)), { x: 5, z: 4 }, 'unknown acceptance reloads authoritative position before any next move');
  options.switchStage('storm-line'); await flush(); assert.equal(state.currentStage, 'storm-line');
  key('w'); frames(11); const fourth = requests[3]; assert.equal(fourth.body.stageId, 'storm-line');
  assert.equal(fourth.body.path[0].x, 5, 'new chapter has no path retained from previous chapter');
  window.dispatchEvent(new window.Event('pagehide')); assert.equal(fourth.signal.aborted, true);
  fourth.resolve({ ok: true, json: async () => ({ position: fourth.body.position }) }); await flush();
});
