'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app', '28-reading-exports.js'), 'utf8');
const readingSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app', '26-game-reading.js'), 'utf8');

test('reading exports create a real Open XML Word package', () => {
  assert.match(source, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(source, /readingExportZip\(\[/);
  assert.match(source, /word\/document\.xml/);
  assert.match(source, /reading-practice\.docx/);
  assert.doesNotMatch(source, /application\/msword/);
});

test('long-image export keeps foreignObject markup intact and measures detached content', () => {
  assert.match(source, /document\.body\.appendChild\(root\)/);
  assert.match(source, /new XMLSerializer\(\)\.serializeToString\(root\)/);
  assert.doesNotMatch(source, /serializeToString\(root\)\.replace\(\/&\/g/);
  assert.match(source, /root\.style\.visibility = 'visible'/);
  assert.match(source, /image\/svg\+xml/);
});

test('default reading set has 40 answer points including five reading choices', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), /id="grReadingCount"[^>]*max="60" value="40"/);
  const sandbox = {};
  vm.runInNewContext(readingSource.slice(0, readingSource.indexOf('function readingPracticeParseJSON')), sandbox);
  const quotas = sandbox.readingPracticeQuotas({ types: ['cloze', 'grammar', 'seven', 'reading'], count: 40 });
  assert.equal(Object.values(quotas).reduce((a, b) => a + b, 0), 36);
  assert.equal(quotas.reading, 5);
  assert.equal(quotas.cloze, 20);
  assert.equal(quotas.grammar, 10);
  assert.equal(quotas.seven, 1);
  const pointTotal = quotas.cloze + quotas.grammar + quotas.seven * 5 + quotas.reading;
  assert.equal(pointTotal, 40);
});

test('reading model calls allow enough time for long article question validation', () => {
  assert.match(readingSource, /AbortSignal\.timeout\(240000\)/);
  assert.doesNotMatch(readingSource, /AbortSignal\.timeout\(30000\)/);
});

test('reading generation is batched, verified per type, and rejects duplicate prompts', () => {
  assert.match(readingSource, /offset \+= 5/);
  assert.match(readingSource, /校验未通过/);
  assert.match(readingSource, /生成的题目重复/);
  assert.doesNotMatch(readingSource, /readingPracticeFallbackQuestions/);
});

test('featured reading uses an offline authored 40-point bank without an AI call', () => {
  const sandbox = {};
  vm.runInNewContext(readingSource.slice(0, readingSource.indexOf('async function readingPracticeNew')), sandbox);
  const questions = sandbox.readingPreparedQuestionBank({ types: ['cloze', 'grammar', 'seven', 'reading'], count: 40 });
  assert.equal(questions.length, 36);
  assert.equal(questions.reduce((sum, q) => sum + (q.type === 'seven' ? 5 : 1), 0), 40);
  assert.equal(questions.filter(q => q.type === 'cloze').length, 20);
  assert.equal(questions.filter(q => q.type === 'grammar').length, 10);
  assert.equal(questions.filter(q => q.type === 'reading').length, 5);
  const cloze = questions.filter(q => q.type === 'cloze');
  assert.ok(new Set(cloze.map(q => q.q)).size === cloze.length);
  assert.ok(new Set(cloze.map(q => q.answer)).size > 1);
  assert.ok(cloze.every(q => !q.q.includes(q.options[q.answer])));
  assert.ok(questions.filter(q => q.type === 'grammar').every(q => /\([^)]{2,}\)/.test(q.q)));
  const seven = questions.filter(q => q.type === 'seven');
  assert.equal(seven.length, 1);
  assert.ok(seven.every(q => q.options.length === 7 && q.answer.length === 5));
  assert.equal(new Set(seven[0].options).size, 7);
  assert.equal(new Set(seven[0].answer).size, 5);
  assert.ok(new Set(questions.filter(q => q.type === 'reading').map(q => q.answer)).size > 1);
  const custom = sandbox.readingPreparedQuestionBank({ types: ['cloze', 'grammar', 'seven', 'reading'], count: 34 });
  assert.equal(custom.reduce((sum, q) => sum + (q.type === 'seven' ? 5 : 1), 0), 34);
  assert.match(readingSource, /settings\.source === 'current'[\s\S]*readingPreparedQuestionBank\(settings\)/);
});

test('reading generator returns 40 validated questions with real seven-choose-five questions', async () => {
  const sandbox = {
    AbortSignal,
    generatedTotal: 0,
    callAPI: async messages => {
      const system = messages[0].content;
      if (system.startsWith('Check every question')) {
        const questions = JSON.parse(messages[1].content.split('Questions:\n')[1]);
        return JSON.stringify({ ok: true, questions });
      }
      const type = system.match(/all of type (\w+)/)[1];
      const count = Number(system.match(/Return exactly (\d+) questions/)[1]);
      const questions = Array.from({ length: count }, (_, i) => ({
        type, q: type === 'seven' ? `Passage ${++sandbox.generatedTotal}: (1) ____ (2) ____ (3) ____ (4) ____ (5) ____. Context ${String.fromCharCode(96 + sandbox.generatedTotal)}.` : `${type} question ${++sandbox.generatedTotal}`,
        options: type === 'seven' ? Array.from({ length: 7 }, (_, n) => `Sentence ${n + 1}`) : ['A', 'B', 'C', 'D'],
        answer: type === 'seven' ? [0, 1, 2, 3, 4] : type === 'grammar' ? 'completes' : 0, hint: type === 'grammar' ? 'complete' : undefined
      }));
      return JSON.stringify({ questions });
    }
  };
  vm.runInNewContext(readingSource.slice(0, readingSource.indexOf('async function readingPracticeNew')), sandbox);
  assert.equal(sandbox.readingQuestionIsValid({ type: 'seven', q: 'Passage: (1) ____ (2) ____ (3) ____ (4) ____ (5) ____.', options: ['A','B','C','D','E','F','G'], answer: [0,1,2,3,4] }, 'seven'), true);
  const article = { paragraphs: ['article text'] };
  const questions = await sandbox.readingPracticeGenerateQuestions(article, { types: ['cloze', 'grammar', 'seven', 'reading'], count: 40 });
  assert.equal(questions.length, 36);
  assert.equal(questions.reduce((sum, q) => sum + (q.type === 'seven' ? 5 : 1), 0), 40);
  assert.equal(questions.filter(question => question.type === 'reading').length, 5);
  assert.ok(questions.filter(question => question.type === 'seven').every(question => question.options.length === 7 && question.answer.length === 5));
  assert.ok(questions.filter(question => question.type === 'grammar').every(question => /\([^)]{2,}\)/.test(question.q)));
});

test('cloze, grammar, and seven-choose-five are answered inline before reading questions', async () => {
  const words = Array.from({ length: 610 }, (_, i) => 'word' + i);
  const article = Array.from({ length: 10 }, (_, i) => words.slice(i * 61, (i + 1) * 61).join(' '));
  const { document } = parseHTML('<html><body><button data-action="reading-practice-new"></button><div id="gameReadingResult"></div><div id="gameReadingArticle"></div><div id="gameReadingQuestions"></div></body></html>');
  const sandbox = {
    document,
    AbortSignal,
    READING_PREPARED_ARTICLES: [{ title: 'Prepared article', paragraphs: article }],
    getSetting: (key, fallback) => fallback,
    setSetting() {},
    esc: value => String(value),
    readingTranslateHardWords() {}
  };
  vm.runInNewContext(readingSource.slice(0, readingSource.indexOf('function readingPracticeAddWord')) + '\nglobalThis.current = () => gameReadingCurrent;', sandbox);
  await sandbox.readingPracticeNew();
  const current = sandbox.current();
  const articleDetails = document.querySelector('#gameReadingArticle .reading-main-article');
  assert.ok(articleDetails);
  assert.equal(document.querySelector('#gameReadingArticle details'), null);
  assert.equal(current.questions.reduce((sum, q) => sum + (q.type === 'seven' ? 5 : 1), 0), 40);
  const questionMarkup = document.getElementById('gameReadingQuestions').innerHTML;
  const articleMarkup = document.getElementById('gameReadingArticle').innerHTML;
  const articleRoot = document.querySelector('#gameReadingArticle .reading-source-copy');
  assert.equal(articleRoot.querySelectorAll('select[data-gr-cloze]').length, 20);
  assert.equal(articleRoot.querySelectorAll('input[data-gr-answer]').length, 10);
  assert.equal(articleRoot.querySelectorAll('select[data-gr-gap]').length, 5);
  assert.match(articleRoot.textContent, /\(accessible\)/);
  assert.match(articleRoot.textContent, /Extreme weather rarely affects/);
  assert.equal(articleRoot.querySelectorAll('input[type="radio"]').length, 0);
  assert.equal(articleRoot.querySelectorAll('.reading-line-number').length, 0);
  const inlineTypes = [...articleRoot.querySelectorAll('[data-gr-q]')].map(el => {
    const id = Number(el.getAttribute('data-gr-q'));
    return current.questions[id].type;
  });
  assert.ok(inlineTypes.slice(0, -1).some((type, i) => type !== inlineTypes[i + 1]));
  assert.equal(articleRoot.querySelectorAll('.reading-seven-section').length, 0);
  assert.equal(articleRoot.querySelectorAll('.reading-seven-passage').length, 5);
  assert.equal(articleRoot.querySelectorAll('.reading-seven-options').length, 1);
  const comprehension = document.querySelector('.reading-comprehension');
  assert.ok(comprehension);
  assert.equal(comprehension.querySelectorAll('input[type="radio"]').length, 20);
  assert.ok(articleMarkup.includes('reading-main-article'));
  assert.ok(articleMarkup.indexOf('reading-seven-options-wrap') > articleMarkup.indexOf('reading-main-article'));
  assert.ok(questionMarkup.includes('reading-comprehension'));
  assert.doesNotMatch(articleMarkup + questionMarkup, /参考答案|gr-feedback/);
  assert.doesNotMatch(articleMarkup + questionMarkup, /"answer"\s*:/);
  assert.match(questionMarkup, /data-reading-submit/);
  assert.doesNotMatch(questionMarkup, /data-action="reading-practice-submit"/);
});

test('seven-choose-five awards partial credit per blank', async () => {
  const result = { textContent: '' };
  const card = { innerHTML: '', querySelector: () => null };
  const selected = ['0', '1', '9', '3', '9'];
  const document = {
    querySelectorAll: selector => selector.includes('data-gr-gap') ? selected.map(value => ({ value })) : [],
    querySelector: selector => selector === '[data-gr-q="0"]' ? card : null,
    getElementById: id => id === 'gameReadingResult' ? result : null
  };
  const sandbox = { document, esc: value => String(value) };
  vm.runInNewContext(readingSource.slice(readingSource.indexOf('async function readingPracticeSubmit'), readingSource.indexOf('function readingPracticeAddWord')) + '\nglobalThis.submit = readingPracticeSubmit; globalThis.use = value => { gameReadingCurrent = value; };', sandbox);
  sandbox.use({ questions: [{ type: 'seven', q: 'Passage (1) ____ (2) ____ (3) ____ (4) ____ (5) ____.', options: ['A','B','C','D','E','F','G'], answer: [0,1,2,3,4], explanation: 'Check the transitions.' }] });
  await sandbox.submit();
  assert.match(result.textContent, /得分：3\/5/);
  assert.match(card.innerHTML, /3\/5 空正确/);
});

test('reading generator rejects malformed seven-choose-five answer sets', async () => {
  const sandbox = {
    AbortSignal,
    callAPI: async messages => {
      if (messages[0].content.startsWith('Check every question')) return JSON.stringify({ ok: true, questions: JSON.parse(messages[1].content.split('Questions:\n')[1]) });
      return JSON.stringify({ questions: [{ type: 'seven', q: 'Passage (1) ____ (2) ____ (3) ____ (4) ____ (5) ____.', options: ['A', 'B', 'C', 'D'], answer: [0] }] });
    }
  };
  vm.runInNewContext(readingSource.slice(0, readingSource.indexOf('async function readingPracticeNew')), sandbox);
  await assert.rejects(sandbox.readingPracticeGenerateQuestions({ paragraphs: ['article'] }, { types: ['seven'], count: 5 }), /题目生成数量不足/);
});

test('reading export root contains full article and question set without answer controls', () => {
  const { document } = parseHTML('<html><body><article id="article"><h2>Full article title</h2><p>Complete article text.</p></article><div id="questions"><section class="pf-section"><b>Question 1</b><label>Gap 1<select><option>A</option></select></label><label>Option A</label><div class="gr-feedback">Detailed feedback</div><button>Submit</button></section></div></body></html>');
  const sandbox = { document, toastMsg() {} };
  vm.runInNewContext(source.slice(source.indexOf('function readingExportRoot()'), source.indexOf('function readingExportEsc(')), sandbox);
  const getById = document.getElementById.bind(document);
  document.getElementById = id => id === 'gameReadingArticle' ? getById('article') : getById('questions');
  const root = sandbox.readingExportRoot();
  assert.match(root.textContent, /Complete article text/);
  assert.match(root.textContent, /Question 1/);
  assert.match(root.textContent, /Detailed feedback/);
  assert.match(root.textContent, /______ /);
  assert.doesNotMatch(root.textContent, /Submit/);
  assert.equal(root.querySelector('input'), null);
  assert.equal(root.querySelector('select'), null);
});

test('RSS article failure falls back to a prepared article with a visible source notice', async () => {
  const sandbox = {
    readingFetchRssArticle: async () => { throw new Error('feed offline'); },
    readingPreparedArticle: () => ({ title: 'Offline feature', paragraphs: ['A full prepared text.'], sourceType: 'prepared' }),
    toastMsg() {}
  };
  vm.runInNewContext(source.slice(source.indexOf('async function readingResolveCurrentArticle()'), source.indexOf('function readingExportRoot(')), sandbox);
  const result = await sandbox.readingResolveCurrentArticle();
  assert.equal(result.sourceType, 'prepared-fallback');
  assert.equal(result.sourceNotice, 'feed offline');
  assert.match(readingSource, /pack\.sourceNotice \? '<p class="reading-source-notice" role="status">/);
});
