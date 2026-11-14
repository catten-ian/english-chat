'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

function reviewContext() {
  const { document } = parseHTML('<html><body><div><div id="ankiReviewModal"></div></div></body></html>');
  const context = vm.createContext({ document, getSetting: () => null, toastMsg() {}, dbg() {},
    esc: value => String(value), renderAnkiSidebar() {}, setTimeout() {}, crypto: { randomUUID: () => 'qa-event' } });
  for (const file of ['22-web-review.js', '34-review-fsrs.js']) {
    vm.runInContext(fs.readFileSync('js/app/' + file, 'utf8'), context);
  }
  return context;
}

test('语法填空的解析不能泄露到正面，答案首字母保留', () => {
  const context = reviewContext();
  const quiz = context.webReviewQuizType({ fields: {
    Question: 'By the time we arrived, the train ____ (leave).',
    Answer: 'had left', Explanation: '应使用过去完成时 had left。'
  } });
  assert.equal(quiz.stem, 'By the time we arrived, the train ____ (leave).');
  assert.equal(quiz.answer, 'had left');
  assert.match(quiz.explanation, /had left/);
  const capital = context.webReviewQuizType({ fields: {
    Question: '____ (compare) with last year, sales have improved.',
    Answer: 'Compared', Explanation: '这里使用过去分词。'
  } });
  assert.equal(capital.answer, 'Compared');
  assert.doesNotMatch(capital.stem, /这里使用/);
});

test('生词卡遵循生词本保存的复习方向', () => {
  const context = reviewContext();
  context.getVocab = () => [{ word: 'persist', direction: 'meaning-to-word' }];
  const card = { modelName: '英语学习-词汇', fields: { Front: '持续存在；坚持', Back: 'persist' } };
  assert.equal(context.webReviewQuizType(card).type, 'dictation');
  context.getVocab = () => [{ word: 'persist', direction: 'word-to-meaning' }];
  assert.equal(context.webReviewQuizType(card).type, 'recall');
});

test('旧生词卡优先从用户生词本补回中文释义，缺失时标成不可评分', () => {
  const context = reviewContext();
  const card = { modelName: '英语学习-词汇', fields: { Front: '', Back: 'persist' } };
  context.getVocab = () => [{ word: 'persist', direction: 'meaning-to-word', meanings: ['坚持；持续存在'] }];
  const repaired = context.webReviewQuizType(card);
  assert.equal(repaired.type, 'dictation');
  assert.equal(repaired.meaning, '坚持；持续存在');
  const prompt = context.webReviewVocabMeaningBlock(repaired.meaning, repaired.word, true);
  assert.match(prompt, /坚持；持续存在/);
  assert.doesNotMatch(prompt, /persist/);

  context.getVocab = () => [{ word: 'persist', direction: 'meaning-to-word' }];
  const invalid = context.webReviewQuizType(card);
  assert.match(invalid.invalidReason, /没有中文释义/);
});

test('不能把场景说明当成中文释义要求用户默写', () => {
  const context = reviewContext();
  context.getVocab = () => [{ word: 'persist', direction: 'meaning-to-word' }];
  const quiz = context.webReviewQuizType({ modelName: '英语学习-词汇', fields: {
    Front: '日常和学术场景通用，无需额外解释', Back: 'persist'
  } });
  assert.match(quiz.invalidReason, /释义内容无效/);
  assert.match(quiz.meaning, /日常和学术场景通用/);
});

test('跳过无效 FSRS 卡不调用调度器评分接口', () => {
  const context = reviewContext();
  let answers = 0;
  let advanced = 0;
  context.nativeSchedulerAnswer = async () => { answers++; };
  context.fetchNextWebReviewCard = () => { advanced++; };
  vm.runInContext("webReviewState = { native: true, committing: false, quiz: { invalidReason: '缺少释义' } }", context);
  context.webReviewSkipInvalid();
  assert.equal(answers, 0);
  assert.equal(advanced, 1);
  assert.equal(vm.runInContext('webReviewState.invalidSkipped', context), 1);
});

test('历史薄弱点改错卡在网页正面明确提示纠错', () => {
  const context = reviewContext();
  const card = context.webReviewQuizType({
    modelName: '英语学习-薄弱点', deckName: '英语学习::test::薄弱点',
    fields: { Question: 'Communities need ways to measures progress.', Answer: 'Communities need ways to measure progress.', Explanation: 'ways to 后接动词原形。' }
  });
  assert.match(card.stem, /^Correct the error in this sentence:/);
  assert.match(card.stem, /Communities need ways to measures progress/);
});

test('FSRS 生词默写正面实际显示中文释义但不泄露英文答案', () => {
  const context = reviewContext();
  const html = context.webReviewVocabMeaningBlock('坚持；持续存在', 'persist', true);
  assert.match(html, /坚持/);
  assert.match(html, /持续存在/);
  assert.match(html, /请输入英文单词（1 个词）/);
  assert.doesNotMatch(html, /persist/);
});

test('FSRS 两卡回看和完成后上一题不重复评分，保留答案及解析', async () => {
  const context = reviewContext();
  let calls = 0;
  context.nativeSchedulerAnswer = async () => { calls++; };
  vm.runInContext(`webReviewState = {
    native: true, nativeIndex: -1, nativeReviewed: Object.create(null),
    nativeCards: [
      { id: 'one', state_name: 'new', fields: { Question: 'The train ____ (leave).', Answer: 'had left', Explanation: '过去完成时' } },
      { id: 'two', state_name: 'new', fields: { Question: 'It ____ (complete).', Answer: 'will be completed', Explanation: '被动语态' } }
    ], queueStats: {new:2, learn:0, review:0}, correct:0, total:2
  }`, context);
  context.fetchNextWebReviewCard();
  context.webReviewGrade(true, '', '过去完成时');
  assert.equal(vm.runInContext('webReviewState.correct', context), 0, '评分成功前不计入正确数');
  await context.webReviewCommitNative(3);
  assert.equal(calls, 1);
  assert.equal(vm.runInContext('webReviewState.correct', context), 1, '正确作答只统计一次');
  assert.equal(vm.runInContext('webReviewState.cardId', context), 'two');
  await context.webReviewPrev();
  assert.equal(vm.runInContext('webReviewState.cardId', context), 'one');
  const modal = context.document.getElementById('ankiReviewModal');
  assert.match(modal.textContent, /已评分：良好/);
  assert.match(modal.textContent, /参考答案：had left/);
  assert.match(modal.textContent, /过去完成时/);
  await context.webReviewCommitNative(3);
  assert.equal(calls, 1, '回看不能再次写入评分');
  context.fetchNextWebReviewCard();
  context.webReviewGrade(true, '', '被动语态');
  await context.webReviewCommitNative(3);
  assert.equal(calls, 2);
  assert.equal(vm.runInContext('webReviewState.correct', context), 2);
  assert.match(modal.textContent, /复习完成/);
  assert.ok(modal.querySelector('#wrPrevFinished'));
  await context.webReviewPrev();
  assert.equal(vm.runInContext('webReviewState.cardId', context), 'two');
  assert.match(modal.textContent, /参考答案：will be completed/);
  assert.equal(calls, 2);
});

test('FSRS 评分失败显示重试，沿用同一事件并只推进一次', async () => {
  const context = reviewContext();
  context.document.getElementById('ankiReviewModal').innerHTML = '<div id="wrResult"></div>';
  const payloads = [];
  let shouldFail = true;
  let advanced = 0;
  context.nativeSchedulerAnswer = async (cardId, payload) => {
    payloads.push({ cardId, ...payload });
    if (shouldFail) throw new Error('temporary network failure');
    return { ok: true };
  };
  context.fetchNextWebReviewCard = () => { advanced++; };
  vm.runInContext(`webReviewState = {
    native: true, committing: false, cardId: 'retry-card', nativeIndex: 0,
    nativeReviewed: Object.create(null), nativeCards: [{ id: 'retry-card', state_name: 'new', version: 7 }],
    queueStats: {new:1, learn:0, review:0}, correct:0, total:1,
    quiz: {type:'dictation'}, judgedCorrect:true
  }`, context);

  await context.webReviewCommitNative(3);
  const result = context.document.querySelector('#wrResult');
  assert.match(result.textContent, /评分未提交：temporary network failure/);
  assert.ok(result.querySelector('#wrRetryNative'));
  assert.equal(advanced, 0, 'failed rating must not advance the queue');
  assert.equal(vm.runInContext('webReviewState.correct', context), 0);

  shouldFail = false;
  result.querySelector('#wrRetryNative').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].event_id, payloads[1].event_id, 'retry must reuse the idempotency key');
  assert.equal(payloads[1].expected_version, 7);
  assert.equal(advanced, 1);
  assert.equal(vm.runInContext("webReviewState.nativeReviewed['retry-card'].label", context), '良好');
  assert.equal(vm.runInContext('webReviewState.correct', context), 1);
});

test('退出网页复习后串行刷新侧栏与学习中心 FSRS 统计', async () => {
  const context = reviewContext();
  context.document.body.innerHTML = '<div><div id="ankiReviewModal"></div></div><div id="pmAnkiDeck"></div>';
  const refreshes = [];
  context.renderAnkiSidebar = async () => { refreshes.push('sidebar:start'); await Promise.resolve(); refreshes.push('sidebar:end'); };
  context.renderPracticeAnkiDeck = async () => { refreshes.push('practice:start'); await Promise.resolve(); refreshes.push('practice:end'); };
  vm.runInContext("webReviewState = { keyHandler: null }", context);

  await context.closeWebReview();

  assert.deepEqual(refreshes, ['sidebar:start', 'sidebar:end', 'practice:start', 'practice:end']);
  assert.equal(context.document.getElementById('ankiReviewModal'), null);
});

test('学习中心只统计到期队列，并识别 FAME 的数字 state 与 state_name', async () => {
  const context = reviewContext();
  context.document.body.innerHTML = '<div id="pmAnkiDeck"></div>';
  const due = [{ state: 0, state_name: 'new' }, { state: 1, state_name: 'learning' }, { state: 2, state_name: 'review' }];
  context.isNativeSchedulerMode = () => true;
  context.nativeSchedulerAllCards = async () => ({ data: [...due, { state: 2, state_name: 'review' }] });
  context.nativeSchedulerDueCards = async () => ({ data: due });
  context.nativeSchedulerApiPath = value => value;
  context.authHeaders = () => ({});
  context.fetch = async () => ({ ok: true, json: async () => ({ storage_mode: 'sqlite-user-sharded' }) });
  const practice = fs.readFileSync('js/app/17-practice.js', 'utf8');
  vm.runInContext(practice.slice(practice.indexOf('async function renderPracticeAnkiDeck('), practice.indexOf('function renderTopicSuggest(')), context);
  await context.renderPracticeAnkiDeck();
  const text = context.document.getElementById('pmAnkiDeck').textContent;
  assert.match(text, /共 4 张/);
  assert.match(text, /待复习 1/);
  assert.match(text, /新卡 1/);
  assert.match(text, /学习中 1/);
});
