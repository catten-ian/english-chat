'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../game/node_modules/typescript');
const { parseHTML } = require('linkedom');

function modules(globals = {}) {
  const cache = new Map();
  function load(relative) {
    const file = path.resolve(__dirname, '../game/src', relative);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    cache.set(file, exports);
    vm.runInNewContext(source, { exports, ...globals, require(id) { return globals.__moduleMocks?.[id] || (id.endsWith('.css') ? {} : load(path.relative(path.resolve(__dirname, '../game/src'), path.resolve(path.dirname(file), id + '.ts')))); } }, { filename: file });
    return exports;
  }
  return load;
}

test('screen movement follows the 3D camera and keeps the map north-up', () => {
  const { movementFromScreen } = modules()('simulation/input.ts');
  const up = movementFromScreen('3d', 0, -1), right = movementFromScreen('3d', 1, 0);
  assert.ok(up.z > .95 && up.x < 0, '3D forward moves into the scene');
  assert.ok(right.x > .95 && right.z > 0, '3D right follows the diagonal view');
  assert.ok(Math.abs(up.x * right.x + up.z * right.z) < 1e-10, 'screen axes remain orthogonal');
  const map = movementFromScreen('2d', 0, -1);
  assert.equal(map.x, 0); assert.equal(map.z, -1);
});
function harness() {
  const { document, window } = parseHTML('<html><body><main id="game-root"><div class="wg-shell"><div class="wg-controls"></div></div></main></body></html>');
  window.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); this.open = true; };
  window.HTMLElement.prototype.close = function () { this.removeAttribute('open'); this.open = false; };
  const load = modules({ document });
  const { createChapterPanel } = load('ui/chapter.ts');
  const stages = load('content/world.ts').STAGES;
  const calls = [];
  const panel = createChapterPanel(document.querySelector('#game-root'), {
    start: () => calls.push(['start']), answer: (index, choice) => calls.push(['answer', index, choice]),
    settle: () => calls.push(['settle']), switchStage: id => calls.push(['switch', id]), refresh: () => calls.push(['refresh'])
  });
  const journey = { stageId: 'low-tide', unlockedStageIds: ['low-tide'], completedStageIds: [], stages, position: { x: 1.2, z: -10.5 }, npcPositions: {}, evidence: [], visitedNpcIds: [], feedback: { records: [], summaries: [] } };
  return { document, window, panel, calls, journey };
}
function findButton(document, text) { return [...document.querySelectorAll('button')].find(button => button.textContent === text); }

test('chapter book requires all resident accounts and never offers locked chapter switches', () => {
  const h = harness(); h.panel.update(h.journey); h.panel.open();
  assert.equal(findButton(h.document, 'Make your case').disabled, true);
  assert.match(h.document.querySelector('.wg-chapter-body').textContent, /Eli Turner/);
  assert.match(h.document.querySelector('.wg-chapter-body').textContent, /Mara Quinn/);
  assert.doesNotMatch(h.document.querySelector('.wg-chapter-body').textContent, /A Safe Crossing/);
  h.panel.update({ ...h.journey, visitedNpcIds: ['eli', 'mara'], evidence: [{ id: 'e1', stageId: 'low-tide', text: '<img src=x onerror=evil()>', source: 'Mara' }] });
  assert.equal(findButton(h.document, 'Make your case').disabled, false);
  assert.equal(h.document.querySelector('.wg-chapter-evidence img'), null, 'evidence is text, never executable markup');
  findButton(h.document, 'Make your case').click();
  assert.deepEqual(h.calls, [['start']]);
});

test('quiz shows only the next unanswered question and submits an explicit selected choice', () => {
  const h = harness(); h.panel.update(h.journey); h.panel.open();
  const quiz = { quizId: 'quiz-one', stageId: 'low-tide', questions: [{ q: 'What did you hear?', options: ['One', 'Two', 'Three', 'Four'] }, { q: 'What did you find?', options: ['A', 'B', 'C', 'D'] }], answers: [] };
  h.panel.showQuiz(quiz);
  assert.equal(h.document.querySelectorAll('fieldset').length, 1);
  assert.doesNotMatch(h.document.querySelector('.wg-chapter-body').textContent, /What did you find/);
  const submit = findButton(h.document, 'Submit conclusion'); assert.equal(submit.disabled, true);
  const choice = h.document.querySelector('input[value="2"]'); choice.checked = true; choice.setAttribute('checked', ''); choice.dispatchEvent(new h.window.Event('change'));
  assert.equal(submit.disabled, false);
  h.document.querySelector('form').dispatchEvent(new h.window.Event('submit', { cancelable: true }));
  assert.deepEqual(h.calls, [['answer', 0, 2]]);
  h.panel.showQuiz({ ...quiz, answers: [{ correct: false, selected: 2, explanation: 'Compare both accounts.' }] });
  assert.match(h.document.querySelector('.wg-chapter-body').textContent, /Compare both accounts/);
  assert.match(h.document.querySelector('legend').textContent, /What did you find/);
  assert.equal(findButton(h.document, 'Submit your investigation'), undefined);
  h.panel.showQuiz({ ...quiz, answers: [{ correct: false, selected: 2, explanation: 'Compare both accounts.' }, { correct: true, selected: 1, explanation: 'Supported.' }] });
  findButton(h.document, 'Submit your investigation').click();
  assert.deepEqual(h.calls.at(-1), ['settle']);
});

test('failed settlements preserve investigation; only authoritative completion offers the next chapter', () => {
  const h = harness(); h.panel.update(h.journey); h.panel.open();
  h.panel.showSettlement({ stageId: 'low-tide', complete: false, summary: 'Check the accounts again.', score: 0, total: 3 });
  assert.equal(findButton(h.document, 'Continue to the next chapter'), undefined);
  assert.ok(findButton(h.document, 'Review the accounts'));
  assert.doesNotMatch(h.document.querySelector('.wg-chapter-body').textContent, /report is being prepared/);
  assert.match(h.document.querySelector('.wg-chapter-body').textContent, /Complete this investigation to receive a chapter report/);
  h.panel.showSettlement({ stageId: 'low-tide', complete: true, summary: 'The harbor has a way forward.', score: 3, total: 3, nextStageId: 'storm-line' });
  findButton(h.document, 'Continue to the next chapter').click();
  assert.deepEqual(h.calls.at(-1), ['switch', 'storm-line']);
  h.panel.update({ ...h.journey, stageId: 'storm-line', visitedNpcIds: [], unlockedStageIds: ['low-tide', 'storm-line'], completedStageIds: ['low-tide'] });
  assert.match(h.document.querySelector('.wg-chapter-body').textContent, /A Safe Crossing/);
  assert.match(h.document.querySelector('.wg-chapter-residents').textContent, /Jonah Reed/);
  assert.doesNotMatch(h.document.querySelector('.wg-chapter-residents').textContent, /Eli Turner/);
});

test('NPC display agrees with the evidence gate for complete, truncated, malformed and interrupted streams', () => {
  const { createNpcStreamReader } = modules()('services/npc-stream.ts');
  const event = (content, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;
  for (const marker of ['data: [DONE]\n\n', event('', 'stop')]) {
    const displays = [];
    const stream = createNpcStreamReader(text => displays.push(text));
    const input = event('The tide ') + event('reached the switch box.') + marker;
    for (let offset = 0; offset < input.length; offset += 7) stream.push(input.slice(offset, offset + 7));
    const result = stream.finish();
    assert.equal(result.complete, true);
    assert.equal(result.text, 'The tide reached the switch box.');
    assert.equal(displays.at(-1), result.text);
  }
  for (const ending of ['', event('', 'length') + 'data: [DONE]\n\n', 'event: error\ndata: {}\n\n', 'data: {"error":"provider stopped"}\n\n', 'data: {bad json}\n\ndata: [DONE]\n\n']) {
    const stream = createNpcStreamReader(() => {});
    stream.push(event('A partial reply.') + ending);
    const result = stream.finish();
    assert.equal(result.complete, false, `reject ${ending || 'EOF without completion'}`);
    assert.equal(result.text, 'A partial reply.', 'partial text stays available for the interruption message');
  }
  const multiline = createNpcStreamReader(() => {});
  multiline.push('data: {"choices": [\r\ndata: {"delta":{"content":"Hello"},"finish_reason":"stop"}]}\r\n\r\n');
  assert.equal(multiline.finish().complete, true, 'SSE data lines are joined before parsing');
});

test('journey API uses the beta mount, explicit answers and cancels in-flight requests on dispose', async () => {
  const calls = [], timers = new Set();
  let hold = false;
  const load = modules({ AbortController, setTimeout(fn) { const id = {}; timers.add(id); return id; }, clearTimeout(id) { timers.delete(id); }, async fetch(url, options) { calls.push({ url, options }); if (hold) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true })); return { ok: true, json: async () => ({ quizId: 'saved' }) }; } });
  const { createJourneyApi } = load('services/journey.ts');
  const api = createJourneyApi({ apiBase: '/api-beta', headers: () => ({ Authorization: 'Bearer isolated' }), provider: () => ({ provider: 'minimax', model: 'chosen-model' }) });
  await api.answer('q-1', 2, 1);
  assert.equal(calls[0].url, '/api-beta/api/world-game/answer');
  assert.deepEqual(JSON.parse(calls[0].options.body), { quizId: 'q-1', index: 2, choice: 1, provider: 'minimax', model: 'chosen-model' });
  assert.equal(timers.size, 0);
  hold = true; const pending = api.load();
  api.dispose();
  await assert.rejects(pending, /request aborted/);
  assert.equal(calls.at(-1).options.signal.aborted, true);
  assert.equal(timers.size, 0);
  await assert.rejects(api.load(), /Game session closed/);
});

test('local graphics drafts cannot grant chapter access, invented clues or authenticated positions', () => {
  const load = modules({ localStorage: { getItem() { return JSON.stringify({ mode: '2d', currentStage: 'beacon', activeNpcIds: ['jonah'], player: { x: 22, z: -16 }, clues: ['invented truth'] }); }, setItem() {} } });
  const { createState, nearestNpc } = load('simulation/state.ts'); const world = load('content/world.ts').WORLD;
  const state = createState('test');
  assert.equal(state.currentStage, 'low-tide'); assert.equal(state.mode, '2d');
  assert.deepEqual(JSON.parse(JSON.stringify(state.clues)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(state.player)), { x: 1.2, z: -10.5 });
  state.player = { x: 22, z: -16 };
  assert.equal(nearestNpc(state, world.npcs), undefined, 'inactive Jonah is not interactable');
  state.activeNpcIds = ['mara', 'jonah'];
  assert.equal(nearestNpc(state, world.npcs).id, 'jonah');
});

test('English drawer stays closed and a background refresh preserves the report being read', () => {
  const { document, window } = parseHTML('<html><body><main id="game-root"></main></body></html>');
  const load = modules({ document, HTMLButtonElement: window.HTMLButtonElement });
  const hud = load('ui/hud.ts').createHud(document.querySelector('#game-root'));
  assert.equal(document.querySelector('#wg-feedback-panel').hidden, true);
  const summaries = [{ id: 's-1', stageId: 'low-tide', status: 'pending', pendingCount: 1 }];
  hud.refreshSummaries(summaries);
  const detail = document.querySelector('#wg-feedback-summaries details'); detail.open = true; detail.setAttribute('open', '');
  hud.refreshSummaries(summaries);
  assert.equal(document.querySelector('#wg-feedback-summaries details'), detail, 'unchanged polls do not rebuild the report');
  hud.refreshSummaries([{ ...summaries[0], status: 'ready', text: 'Your questions became clearer.' }]);
  assert.equal(document.querySelector('#wg-feedback-summaries details').open, true, 'report stays open when it finishes');
  assert.equal(document.querySelector('#wg-feedback-panel').hidden, true, 'background completion does not interrupt exploration');
});

test('chapter change updates the objective and closes a resident form from the prior chapter', () => {
  const { document, window } = parseHTML('<html><body><main id="game-root"></main></body></html>');
  const load = modules({ document, HTMLButtonElement: window.HTMLButtonElement });
  const hud = load('ui/hud.ts').createHud(document.querySelector('#game-root'));
  const world = load('content/world.ts').WORLD;
  hud.openDialogue(world.npcs[0], async () => {});
  assert.equal(document.querySelector('#wg-form').hidden, false);
  hud.resetDialogue();
  hud.update({ currentStage: 'storm-line', activeNpcIds: ['mara', 'jonah'], clues: [], mode: '2d', player: { x: 1.2, z: -10.5 } });
  assert.equal(document.querySelector('#wg-form').hidden, true);
  assert.match(document.querySelector('#wg-stage-title').textContent, /THE STORM LINE/);
  assert.match(document.querySelector('#wg-stage-objective').textContent, /guide the rescue boat/);
});

test('previous device feedback remains readable without restarting paid requests or offering invalid retries', () => {
  const history = [{ id: 'old-ready', stageId: 'low-tide', npcName: 'Eli', text: 'What did you see?', createdAt: 1, status: 'ready', attempts: 1, feedback: 'A clear question.' },
    { id: 'old-pending', stageId: 'low-tide', npcName: 'Mara', text: 'Where did it happen?', createdAt: 2, status: 'pending', attempts: 0 }];
  const { document, window } = parseHTML('<html><body><main id="game-root"></main></body></html>');
  let writes = 0;
  const load = modules({ document, HTMLButtonElement: window.HTMLButtonElement, localStorage: { getItem: () => JSON.stringify(history), setItem: () => { writes++; } } });
  const { readArchivedFeedback, mergeArchivedFeedback } = load('services/feedback.ts');
  const archived = readArchivedFeedback('test');
  const merged = mergeArchivedFeedback([{ ...history[0], archived: false }], archived);
  assert.equal(merged.length, 2, 'server version replaces a duplicate legacy id');
  assert.equal(merged[0].archived, false);
  assert.equal(merged[1].status, 'failed', 'legacy pending notes are never restarted implicitly');
  const hud = load('ui/hud.ts').createHud(document.querySelector('#game-root'));
  hud.refreshFeedback(merged, () => assert.fail('legacy retry must not be invoked'));
  assert.match(document.querySelector('#wg-feedback-list').textContent, /A clear question/);
  assert.match(document.querySelector('#wg-feedback-list').textContent, /saved on this device/);
  assert.equal(document.querySelector('#wg-feedback-list button'), null);
  assert.equal(writes, 0, 'original browser history remains intact');
});

test('provider failures surface configuration guidance rather than chapter-lock or network guesses', () => {
  const { providerError, chapterError, GameApiError } = modules()('services/journey.ts');
  const configured = providerError(503, { error: 'provider_not_configured', provider: 'aihub8' });
  assert.match(configured, /AIHub8 is not configured/);
  assert.match(configured, /provider settings/);
  assert.match(chapterError(new GameApiError(503, { error: 'provider_not_configured', provider: 'minimax' })), /MiniMax is not configured/);
  assert.match(chapterError(new GameApiError(403, { error: '赠送调用仅支持' })), /sponsored calls/);
  assert.match(providerError(401, { error: 'upstream_error' }), /rejected its credentials/);
  assert.equal(providerError(503, { error: 'provider_not_configured', provider: '<script>alert(1)</script>' }).includes('<script>'), false);
});

test('feedback badge reconciles ready and total replies; retry stays disabled until its request finishes', async () => {
  const { document, window } = parseHTML('<html><body><main id="game-root"></main></body></html>');
  const hud = modules({ document, HTMLButtonElement: window.HTMLButtonElement })('ui/hud.ts').createHud(document.querySelector('#game-root'));
  const records = [
    { id: 'ready', stageId: 'low-tide', npcName: 'Eli', text: 'Hello.', createdAt: 1, status: 'ready', attempts: 1, feedback: 'Natural.' },
    { id: 'failed', stageId: 'low-tide', npcName: 'Eli', text: 'Why?', createdAt: 2, status: 'failed', attempts: 1, error: 'AIHub8 is not configured.' },
    { id: 'pending', stageId: 'low-tide', npcName: 'Mara', text: 'Where?', createdAt: 3, status: 'pending', attempts: 0 }
  ];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  hud.refreshFeedback(records, () => pending);
  assert.equal(document.querySelector('#wg-feedback-count').textContent, '1/3');
  assert.match(document.querySelector('#wg-feedback-toggle').getAttribute('aria-label'), /1 ready of 3 replies/);
  const retry = document.querySelector('#wg-feedback-list button'); retry.click();
  assert.equal(retry.disabled, true);
  hud.setFeedbackStatus('Provider configuration needs attention.');
  hud.refreshFeedback(records);
  assert.equal(document.querySelector('#wg-feedback-service-status').hidden, false, 'an unchanged poll does not erase explicit recovery guidance');
  release(); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(retry.disabled, false);
  assert.equal(document.querySelector('#wg-feedback-panel').hidden, true);
});

test('main surfaces rejected NPC provider configuration, reconciles its feedback job and recovers retry conflicts', async () => {
  const { document, window } = parseHTML('<html><body><main id="game-root"></main></body></html>');
  const calls = [];
  let retried = false;
  const records = () => [{ id: 'job-1', stageId: 'low-tide', npcName: 'Eli', text: 'What did you hear?', createdAt: 1, attempts: 1, status: retried ? 'pending' : 'failed', error: 'AIHub8 is not configured.' }];
  let load;
  load = modules({
    document, window, HTMLButtonElement: window.HTMLButtonElement, AbortController, AbortSignal, TextDecoder, URLSearchParams,
    crypto: { randomUUID: () => 'test-turn-1234' }, performance: { now: () => 0 },
    location: { pathname: '/english', search: '?version=beta/world-game' },
    localStorage: { getItem: key => key === 'ai_en_token' ? 'test-token' : key === 'ai_en_user' ? 'isolated-user' : null, setItem() {} },
    sessionStorage: { getItem: () => null }, setTimeout: () => ({}), clearTimeout() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    __moduleMocks: { './render/renderer': { createRenderer: () => ({ setMode() {}, render() {}, dispose() {} }) } },
    async fetch(url, options) {
      calls.push(url);
      let status = 200, data;
      if (url.endsWith('/state')) data = { stageId: 'low-tide', unlockedStageIds: ['low-tide'], completedStageIds: [], stages: load('content/world.ts').STAGES, position: { x: 1.2, z: -10.5 }, evidence: [], visitedNpcIds: [], feedback: { records: records(), summaries: [] } };
      else if (url.endsWith('/move')) data = { position: { x: 1.2, z: -10.5 } };
      else if (url.endsWith('/npc')) { status = 503; data = { error: 'provider_not_configured', provider: 'aihub8' }; }
      else if (url.endsWith('/feedback/retry')) { retried = true; status = 409; data = { error: 'feedback cannot be retried' }; }
      else if (url.endsWith('/feedback')) data = { records: records(), summaries: [] };
      else assert.fail(`unexpected request ${url}`);
      return { ok: status === 200, status, json: async () => data };
    }
  });
  load('main.ts');
  await new Promise(resolve => setImmediate(resolve));
  document.querySelector('#wg-interact').click();
  document.querySelector('#wg-input').value = 'What did you hear?';
  await document.querySelector('#wg-form').onsubmit({ preventDefault() {} });
  assert.match(document.querySelector('#wg-transcript').textContent, /AIHub8 is not configured/);
  const npcIndex = calls.findIndex(url => url.endsWith('/npc'));
  assert.equal(calls.slice(npcIndex + 1).some(url => url.endsWith('/feedback')), true, 'rejected NPC requests still reconcile their server feedback job');
  assert.equal(document.querySelector('#wg-feedback-count').textContent, '0/1');
  document.querySelector('#wg-feedback-list button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(document.querySelector('#wg-feedback-service-status').textContent, /already queued or ready/);
  assert.equal(document.querySelector('#wg-feedback-list button'), null, 'conflicting retry refreshes authoritative pending state');
  window.dispatchEvent(new window.Event('pagehide'));
});
