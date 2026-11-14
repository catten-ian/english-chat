'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/app/17-practice.js', 'utf8') + '\n' + fs.readFileSync('js/app/37-translation-grading.js', 'utf8');
const agentsSource = fs.readFileSync('js/app/02-agents.js', 'utf8');
const slashSource = fs.readFileSync('js/app/13-banks.js', 'utf8');
const initSource = fs.readFileSync('js/app/19-init.js', 'utf8');
const parseSource = fs.readFileSync('js/app/03-parse.js', 'utf8');
const configSource = fs.readFileSync('server/config.js', 'utf8');
const proxySource = fs.readFileSync('server/routes/proxy.js', 'utf8');
const isolated = { module: { exports: {} } };
vm.runInNewContext(source + '\nmodule.exports = partialTranslationFeedback;', isolated);
const partialTranslationFeedback = isolated.module.exports;

test('streaming translation preview ignores incomplete JSON fields', () => {
  const result = partialTranslationFeedback(`{"score":"8/10 — 基本准确","errors":["时态`);
  assert.equal(result.score, '8/10 — 基本准确');
  assert.equal(result.errors, undefined);
});

test('streaming translation preview exposes complete fields before the JSON object ends', () => {
  const result = partialTranslationFeedback('{"score":"8/10 — 基本准确","errors":["时态需要调整"],"better_translation":"The novel');
  assert.equal(result.score, '8/10 — 基本准确');
  assert.deepEqual(Array.from(result.errors), ['时态需要调整']);
  assert.equal(result.better_translation, undefined);
});

test('streaming translation preview safely decodes escaped content', () => {
  const result = partialTranslationFeedback(String.raw`{"better_translation":"He said \"hello\""`);
  assert.equal(result.better_translation, 'He said "hello"');
});

test('stream reader accepts OpenAI-compatible text parts and wrapped JSON responses', () => {
  const isolated = { module: { exports: {} } };
  vm.runInNewContext(agentsSource + '\nmodule.exports = consumeSSE;', isolated);
  const consume = isolated.module.exports;
  assert.equal(consume(JSON.stringify({ choices: [{ delta: { content: [{ type: 'text', text: 'hello' }] } }] })), 'hello');
  assert.equal(consume(JSON.stringify({ output_text: 'hello' })), 'hello');
  const grading = { score: '8/10', better_translation: 'She did it.' };
  assert.equal(consume(JSON.stringify({ data: { result: JSON.stringify(grading) } })), JSON.stringify(grading));
  assert.equal(consume(JSON.stringify({ choices: [{ message: { content: JSON.stringify(grading) } }] })), JSON.stringify(grading));
});

test('streamDict handles a non-SSE wrapped completion and omits max_tokens when requested', async () => {
  const grading = { score: '8/10', better_translation: 'She did it.' };
  let requestBody;
  const isolated = {
    module: { exports: {} }, TextDecoder, Response, setTimeout, clearTimeout,
    BACKEND_URL: '', activeProvider: () => 'aihub8', activeTextModel: () => 'gpt-6.1-terra',
    authHeaders: () => ({}), llmLog() {},
    fetch: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return new Response(JSON.stringify({ data: { result: JSON.stringify(grading) } }), { status: 200 });
    }
  };
  vm.runInNewContext(agentsSource + '\nmodule.exports = streamDict;', isolated);
  let output = '';
  const result = await isolated.module.exports([], { maxTokens: null }, delta => { output += delta; });
  assert.equal(result, JSON.stringify(grading));
  assert.equal(output, JSON.stringify(grading));
  assert.equal(requestBody.stream, true);
  assert.equal(Object.hasOwn(requestBody, 'max_tokens'), false);
});

test('server keeps a separate first-data timeout and does not cap stream duration', () => {
  assert.match(configSource, /STREAM_FIRST_BYTE_TIMEOUT\s*=\s*240000/);
  assert.match(configSource, /STREAM_IDLE_TIMEOUT\s*=\s*180000/);
  assert.match(proxySource, /firstByteTimer\s*=\s*setTimeout\(abortUpstream, STREAM_FIRST_BYTE_TIMEOUT\)/);
  assert.match(proxySource, /if \(firstByteTimer\) \{ clearTimeout\(firstByteTimer\); firstByteTimer = null; \}/);
  assert.doesNotMatch(proxySource, /STREAM_TOTAL_TIMEOUT/);
});

test('the same translation answer can only start one grading request', () => {
  const isolated = { module: { exports: {} } };
  vm.runInNewContext(source + '\nmodule.exports = claimTranslationSubmission;', isolated);
  const claim = isolated.module.exports;
  const question = { zh: 'question' };

  assert.equal(claim(question, '  answer  '), true);
  assert.equal(claim(question, 'answer'), false);
  assert.equal(claim(question, 'revised answer'), true);
  assert.equal(claim({ zh: 'next question' }, 'answer'), true);
});

test('translation submit paints pending feedback before persistence and ignores IME/repeat Enter', () => {
  const practice = fs.readFileSync('js/app/17-practice.js', 'utf8');
  const enterHandler = initSource.match(/trInput\.addEventListener\('keydown',[\s\S]*?\n        \}\);/);
  assert.ok(enterHandler);
  assert.match(enterHandler[0], /e\.isComposing/);
  assert.match(enterHandler[0], /e\.repeat/);
  assert.match(practice, /renderTranslationFeedbackPager\(\);\s*\/\/ Let the pending feedback paint[\s\S]*?requestAnimationFrame\(afterPaint\)/);
});

test('dictionary slash menu is scoped to its input and supports tutor/translation commands', () => {
  assert.match(slashSource, /inputId === 'dictInput' \? 'dictSlashMenu' : 'slashMenu'/);
  assert.match(slashSource, /SLASH_COMMANDS\.filter\(c => \['\/ask', '\/translate'\]\.includes\(c\.name\)\)/);
  assert.match(slashSource, /function chooseSlashCommand\(command, inputId\)/);
  assert.match(initSource, /chooseSlashCommand\(this\.getAttribute\('data-arg1'\), this\.getAttribute\('data-target-input'\)/);
  assert.match(fs.readFileSync('index.html', 'utf8'), /id="dictSlashMenu"/);
});

test('structured response parser accepts provider wrappers but rejects incomplete grading results', () => {
  const isolated = { module: { exports: {} } };
  vm.runInNewContext(parseSource + '\n' + source + '\nmodule.exports = { parseStructuredResponse, isTranslationEvaluation, normalizeTranslationEvaluation };', isolated);
  const { parseStructuredResponse: parse, isTranslationEvaluation: valid, normalizeTranslationEvaluation: normalize } = isolated.module.exports;
  const expected = { score: '8/10 — 表达自然', better_translation: 'She finished the task.' };
  assert.equal(parse(JSON.stringify({ data: { result: JSON.stringify(expected) } }), valid)?.better_translation, expected.better_translation);
  assert.equal(parse(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(expected) }] }), valid)?.better_translation, expected.better_translation);
  assert.equal(parse('{"score":"8/10"}', valid), null);
  assert.equal(parse('{"score":"12/10","better_translation":"x"}', valid), null);
  const normalized = normalize({ score: 8, errors: [{ error: 'tense', correction: 'changed tense' }], segments: [{ text: 'Hi' }, {}] });
  assert.equal(normalized.score, '8/10');
  assert.deepEqual(Array.from(normalized.errors), ['tense · changed tense']);
  assert.deepEqual(Array.from(normalized.segments, segment => segment.text), ['Hi']);
});

test('malformed stream output gets one retry and does not attach a token cap', async () => {
  let calls = 0;
  const isolated = { module: { exports: {} }, calls: 0, budgets: [] };
  vm.runInNewContext(parseSource + '\n' + source + `\nstreamDict = async (messages, options, onDelta) => {
    calls++;
    budgets.push(options.maxTokens);
    if (calls === 1) { options.onFinish('length'); onDelta('{"score":"8/10"'); return '{"score":"8/10"'; }
    const value = '{"score":"8/10","better_translation":"She finished it."}';
    options.onFinish('stop'); onDelta(value); return value;
  };\nmodule.exports = streamAndParseJSON;`, isolated);
  const result = await isolated.module.exports([], { maxTokens: null }, obj => !!obj.better_translation);
  assert.equal(isolated.calls, 2);
  assert.deepEqual(Array.from(isolated.budgets), [null, null]);
  assert.equal(result.obj.better_translation, 'She finished it.');
});

test('a complete schema-valid response is accepted even when the provider labels it length', async () => {
  const isolated = { module: { exports: {} } };
  vm.runInNewContext(parseSource + '\n' + source + `\nstreamDict = async (messages, options, onDelta) => {
    const value = '{"score":"8/10","better_translation":"She finished it."}';
    options.onFinish('length'); onDelta(value); return value;
  };\nmodule.exports = streamAndParseJSON;`, isolated);

  const result = await isolated.module.exports([], { maxTokens: null }, obj => !!obj.better_translation);
  assert.equal(result.obj.better_translation, 'She finished it.');
});

test('AI translation prompts use streaming parsing without an output token cap', () => {
  const practiceSource = fs.readFileSync('js/app/17-practice.js', 'utf8');
  assert.match(practiceSource, /streamAndParseJSON\(\[\s*\{ role: 'system', content: aiPrompt \}/);
  assert.match(practiceSource, /\{ temperature: 0\.7, maxTokens: null, thinking: \{ type: 'disabled' \} \}/);
});

test('collapsed translation history updates the count without rebuilding records', () => {
  const count = { textContent: '' };
  const wrap = { style: {}, innerHTML: 'existing history markup' };
  const isolated = {
    module: { exports: {} },
    document: { getElementById: id => id === 'trHistCount' ? count : wrap },
    getSetting: () => [{ question: 'q', feedbackHtml: '<large feedback>' }]
  };
  vm.runInNewContext('let trHistoryExpanded = false;\n' + source + '\nmodule.exports = renderTranslateHistory;', isolated);

  isolated.module.exports();

  assert.equal(count.textContent, '(1)');
  assert.equal(wrap.style.display, 'none');
  assert.equal(wrap.innerHTML, 'existing history markup');
});

test('translation score updates skip a hidden bank and coalesce visible refreshes', () => {
  let visible = false;
  let callback = null;
  let renders = 0;
  const isolated = {
    module: { exports: {} },
    document: { getElementById: id => id === 'tab-gaokao' ? { style: { display: visible ? 'block' : 'none' } } : null },
    requestAnimationFrame: fn => { callback = fn; },
    renderTrBankPanel: () => { renders++; },
    setTimeout
  };
  vm.runInNewContext(source + '\nmodule.exports = { schedule: scheduleTranslationBankRefresh, replaceRenderer: fn => { renderTrBankPanel = fn; } };', isolated);
  isolated.module.exports.replaceRenderer(() => { renders++; });

  isolated.module.exports.schedule();
  assert.equal(callback, null);
  assert.equal(renders, 0);

  visible = true;
  isolated.module.exports.schedule();
  isolated.module.exports.schedule();
  assert.equal(typeof callback, 'function');
  callback();
  assert.equal(renders, 1);
});
