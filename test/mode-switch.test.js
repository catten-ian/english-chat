/* 首页与模块切换回归测试 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');
const { APP_DIR } = require('./helpers');

const SRC = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '15-modes.js'), 'utf8');

test('首页点击当前模式 Chat 仍会进入聊天区', () => {
  const elements = {
    homePage: { style: { display: 'flex' } },
    sidePanel: { style: {} },
    chatArea: { style: { display: 'none' } },
    newConvBtn: { style: {} },
    difficultyCtl: { style: {} },
    mainArea: { querySelectorAll: () => [elements.chatArea] }
  };
  const stored = new Map([['ai_en_mode', 'home']]);
  const sandbox = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value))
    },
    document: {
      getElementById: (id) => elements[id] || null,
      querySelectorAll: () => []
    },
    closeDrawers: () => {},
    closeMobileMore: () => {},
    resetAnalysisForMode: () => {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: '15-modes.js' });

  sandbox.switchMode('chat');

  assert.strictEqual(elements.homePage.style.display, 'none');
  assert.strictEqual(elements.chatArea.style.display, 'flex');
  assert.strictEqual(stored.get('ai_en_mode'), 'chat');
});

test('填空输入框 Enter 提交后不会冒泡为下一题', () => {
  const listeners = {};
  const input = {
    value: '',
    focus() { active = this; },
    addEventListener(type, fn) { listeners[type] = fn; }
  };
  const submit = { addEventListener() {} };
  const modal = {
    querySelectorAll() { return [input]; },
    querySelector(selector) { return selector === '#wrFillSubmit' ? submit : input; }
  };
  let active = null;
  let submitted = 0;
  const sandbox = {
    webReviewState: { quiz: { type: 'fill' }, locked: false },
    setTimeout() {},
    document: { getElementById: () => null, querySelector: () => null }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: '22-web-review.js' });
  vm.runInContext("webReviewState = { quiz: { type: 'fill' }, locked: false };", sandbox);

  sandbox.webReviewBindFillSubmit(modal);
  const event = {
    key: 'Enter',
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };
  input.value = 'answer';
  listeners.keydown(event);

  assert.strictEqual(vm.runInContext('webReviewState.stage', sandbox), 'graded');
  assert.strictEqual(event.defaultPrevented, true);
  assert.strictEqual(event.propagationStopped, true);
});

test('网页复习拒绝接管其他账户的 Anki 牌组', () => {
  const sandbox = {
    ANKI_DECK_PREFIX: '英语学习',
    currentUser: () => 'test',
    ankiBaseDeck: () => '英语学习::test'
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = `function ankiBaseDeck() { return ANKI_DECK_PREFIX + '::' + currentUser(); }\n` + fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: '22-web-review.js' });

  assert.strictEqual(sandbox.webReviewDeckMatches({ deckName: '英语学习::test::薄弱点' }), true);
  assert.strictEqual(sandbox.webReviewDeckMatches({ deckName: '英语学习::test' }), true);
  assert.strictEqual(sandbox.webReviewDeckMatches({ deckName: '英语学习::catten::薄弱点' }), false);
  assert.strictEqual(sandbox.webReviewDeckMatches({ deckName: 'Default' }), false);
});

test('AI 不应把合法句子生成成自相矛盾的纠错题', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '06-anki.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: '06-anki.js' });

  assert.strictEqual(sandbox.isQuizQuestionUsable({
    type: 'error_correction',
    question: 'She has enough experience to handle it.',
    answer: 'She has experience enough to handle it.',
    explanation: '本题实际无语法错误，原句正确。'
  }), false);
  assert.strictEqual(sandbox.isQuizQuestionUsable({
    type: 'error_correction',
    question: 'She have enough experience to handle it.',
    answer: 'She has enough experience to handle it.',
    explanation: '第三人称单数主语后使用 has。'
  }), true);
});

test('网页复习头部显示三类队列并标记当前类别', () => {
  const sandbox = { esc: s => String(s) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: '22-web-review.js' });
  vm.runInContext("webReviewState = { queueStats: { new: 4, learn: 2, review: 7 }, currentQueue: 'learn', correct: 1, current: 3 };", sandbox);
  const html = sandbox.webReviewQueueHeader('生词 · 看英文想中文');
  assert.match(html, /待新学/);
  assert.match(html, /待重来/);
  assert.match(html, /待复习/);
  assert.match(html, /wr-queue-learn is-current/);
});

test('网页复习队列统计按用户牌组请求并汇总三色数量', async () => {
  const card = { cardId: 1001, queue: 0 };
  const requests = [];
  const sandbox = {
    ankiBaseDeck: () => '英语学习::test',
    dbg() {},
    ankiPostCall: async (payload) => {
      requests.push(payload);
      if (payload.action === 'getDeckStats') return { result: { result: { 1: { name: '英语学习::test', new_count: 3, learn_count: 2, review_count: 7 } } } };
      if (payload.action === 'cardsInfo') return { result: { result: [card] } };
      throw new Error('unexpected action');
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8'), sandbox, { filename: '22-web-review.js' });
  vm.runInContext("webReviewState = { currentQueue: null };", sandbox);
  await sandbox.webReviewRefreshQueueStats(card);
  assert.strictEqual(requests.find(r => r.action === 'getDeckStats').params.decks.join('|'), '英语学习::test');
  assert.strictEqual(vm.runInContext('webReviewState.queueStats.new', sandbox), 3);
  assert.strictEqual(vm.runInContext('webReviewState.queueStats.learn', sandbox), 2);
  assert.strictEqual(vm.runInContext('webReviewState.queueStats.review', sandbox), 7);
  assert.strictEqual(vm.runInContext('webReviewState.currentQueue', sandbox), 'new');
  assert.strictEqual(requests.filter(r => r.action === 'cardsInfo').length, 0, '已有 queue 字段时不应重复请求 cardsInfo');
});

test('生词释义解析多词性、变形和多条释义', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: '22-web-review.js' });
  const raw = 'adrift/əˈdrɪft/adj./adv.变形: more adrift · most adrift•（人）漂泊的；漫无目的的•（船）漂浮着，漂流着';
  const parsed = sandbox.webReviewParseVocabMeaning(raw, 'adrift');
  assert.strictEqual(parsed.phonetic, '/əˈdrɪft/');
  assert.strictEqual(parsed.pos, 'adj./adv.');
  assert.strictEqual(parsed.inflection, 'more adrift · most adrift');
  assert.strictEqual(parsed.meanings.join('|'), '（人）漂泊的；漫无目的的|（船）漂浮着，漂流着');
});

test('网页复习能解析结构化 Anki 选择题字段', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: '22-web-review.js' });
  const generatorSandbox = { esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  generatorSandbox.globalThis = generatorSandbox;
  vm.createContext(generatorSandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '24-anki-templates.js'), 'utf8'), generatorSandbox, { filename: '24-anki-templates.js' });
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '06-anki.js'), 'utf8'), generatorSandbox, { filename: '06-anki.js' });
  const raw = generatorSandbox.ankiQuizQuestionFieldHTML({
    question: 'Choose the correct sentence.',
    options: ['A. First option', 'B. Second option', 'C. Third option', 'D. Fourth option']
  });
  const quiz = sandbox.webReviewStructuredQuiz(raw);
  assert.strictEqual(quiz.stem, 'Choose the correct sentence.');
  assert.deepStrictEqual(quiz.options.map(o => o.letter).join(''), 'ABCD');
  assert.strictEqual(quiz.options[1].text, 'Second option');
});

test('网页复习解析题目时隐藏内部测试点标识', () => {
  const sandbox = {
    document: {
      createElement: () => ({
        set innerHTML(value) { this.textContent = value; },
        get innerHTML() { return this.textContent || ''; },
        querySelectorAll: () => [],
        textContent: ''
      })
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8'), sandbox, { filename: '22-web-review.js' });
  const card = {
    modelName: '英语学习-薄弱点问答',
    deckName: '英语学习::test::薄弱点',
    fields: {
      Question: { value: 'Choose the best answer.\nA. one\nB. two\nC. three\nD. four' },
      Answer: { value: 'B. two' },
      Explanation: { value: '这里应选 two。测试点: wp_example（内部标签）。' }
    }
  };
  const quiz = sandbox.webReviewQuizType(card);
  assert.strictEqual(quiz.type, 'mc');
  assert.strictEqual(quiz.explanation, '这里应选 two');
  assert.doesNotMatch(quiz.explanation, /wp_example|测试点/);
});

test('网页复习语法填空保留括号根词提示', () => {
  const sandbox = { document: { createElement: () => ({ innerHTML: '', querySelectorAll: () => [], textContent: '' }) } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8'), sandbox, { filename: '22-web-review.js' });
  const card = {
    modelName: '英语学习-薄弱点问答', deckName: '英语学习::test::薄弱点',
    fields: {
      Question: { value: 'The work ___ every Friday.' },
      Answer: { value: 'is completed (complete)' },
      Explanation: { value: '根据被动语态（complete）判断。' }
    }
  };
  const quiz = sandbox.webReviewQuizType(card);
  assert.strictEqual(quiz.type, 'fill');
  assert.match(quiz.stem, /___ \(complete\)/);
});

test('Anki 桌面模板内联脚本均为合法 JavaScript', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '24-anki-templates.js'), 'utf8'), sandbox, { filename: '24-anki-templates.js' });
  const groups = vm.runInContext('({ basic: ankiBasicTemplates(), vocab: ankiVocabTemplates(), quiz: ankiQuizTemplates() })', sandbox);
  for (const templates of Object.values(groups)) {
    for (const sides of Object.values(templates)) {
      for (const side of Object.values(sides)) {
        for (const match of side.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
          assert.doesNotThrow(() => new vm.Script(match[1]));
        }
      }
    }
  }
});

test('Anki 词汇模板只渲染字段，不依赖容易报错的内联脚本', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '24-anki-templates.js'), 'utf8'), sandbox, { filename: '24-anki-templates.js' });
  const card = Object.values(vm.runInContext('ankiVocabTemplates()', sandbox))[0];
  assert.match(card.Front, /\{\{Front\}\}/);
  assert.doesNotMatch(card.Front, /<script>|\{\{Back\}\}|FrontSide/);
  assert.match(card.Back, /\{\{Back\}\}/);
  assert.doesNotMatch(card.Back, /<script>|\{\{Front\}\}|FrontSide/);

  const meaningSandbox = {};
  meaningSandbox.globalThis = meaningSandbox;
  vm.createContext(meaningSandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '06-anki.js'), 'utf8'), meaningSandbox, { filename: '06-anki.js' });
  const meaning = meaningSandbox.normalizeVocabMeaning('monastery /ˈmɑːnəsteri/ /ˈmɒnəstri/ n. • 修道院•寺院', 'monastery');
  assert.strictEqual(meaning, '修道院\n寺院');
});

test('Anki 默写模板正面不引用背面答案，答案页不重复正面', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '24-anki-templates.js'), 'utf8'), sandbox, { filename: '24-anki-templates.js' });
  const templates = vm.runInContext('ankiVocabTemplates()', sandbox);
  const card = Object.values(templates)[0];
  assert.match(card.Front, /\{\{Front\}\}/);
  assert.doesNotMatch(card.Front, /\{\{Back\}\}|FrontSide/);
  assert.match(card.Back, /\{\{Back\}\}/);
  assert.doesNotMatch(card.Back, /FrontSide|\{\{Front\}\}/);
});

test('Anki 生词正面不泄露答案并显示作答形式', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '06-anki.js'), 'utf8'), sandbox, { filename: '06-anki.js' });
  const front = sandbox.vocabFrontText('obsession/əbˈseʃn/n.变形: obsessions• 痴迷；着魔；执念', 'obsession');
  assert.doesNotMatch(front, /obsession|əbˈseʃn|变形/);
  assert.match(front, /痴迷/);
  assert.match(front, /答案形式：1 个单词/);
  assert.match(sandbox.vocabFrontText('服从；听从', 'defer to'), /答案形式：词组（2 个单词）/);
});

test('上海高考式语法填空保留词根提示且支持多空', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'app', '06-anki.js'), 'utf8'), sandbox, { filename: '06-anki.js' });
  assert.strictEqual(sandbox.decorateFillBlankQuestion({
    type: 'fill_blank', question: 'The work ___ by Friday.', answer: 'is to be completed', blank_hints: ['complete']
  }).question, 'The work ___ (complete) by Friday.');
  assert.strictEqual(sandbox.decorateFillBlankQuestion({
    type: 'fill_blank', question: 'They ___ ___ the work.', answer: 'made up', blank_hints: ['', '']
  }).question, 'They ___ ___ the work.');
  assert.strictEqual(sandbox.decorateFillBlankQuestion({
    type: 'fill_blank', question: 'Looking back over the ___', answer: 'years'
  }).question, 'Looking back over the ___');
});
