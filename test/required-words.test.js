/* 必用词匹配（13-banks.js）
   ------------------------------------------------------------
   高考翻译题的「词」字段形态多样，只做「小写全等 + 去后缀」会大量误报。
   下面的用例覆盖了实测到的四类失配：
     - 变式（defer → defers、stop → stopped、study → studies）
     - 词性标注（'gaze v.'）
     - 多词短语（'in case'、'occur to'）
     - 句型骨架（'the more…the more'、'so … that …'）
   同时校验首字母大写的必用词必须出现在句首。

   函数在浏览器全局作用域中（无 module.exports），这里从切片源码里
   截取相关片段求值，与 render-security.test.js 的做法一致。 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { APP_DIR } = require('./helpers');

const banksPath = path.join(APP_DIR, 'js', 'app', '13-banks.js');
const banksSrc = fs.readFileSync(banksPath, 'utf8');

/* 截取「必用词匹配」整段：从 stripPosTag 到 checkRequiredWordsUsed 结束 */
function extractSection() {
  const start = banksSrc.indexOf('function stripPosTag');
  assert.ok(start >= 0, '未找到 stripPosTag（13-banks.js 结构可能已变化）');
  const endMarker = 'function mergeShGaokaoBank';
  const end = banksSrc.indexOf(endMarker, start);
  assert.ok(end > start, '未找到 mergeShGaokaoBank 作为结束标记');
  return banksSrc.slice(start, end);
}

const sandbox = {};
// eslint-disable-next-line no-new-func
new Function(
  'sandbox',
  extractSection() +
    `
  sandbox.checkRequiredWordsUsed = checkRequiredWordsUsed;
  sandbox.requiredWordUsed = requiredWordUsed;
  sandbox.requiredWordParts = requiredWordParts;
  sandbox.capitalRequirementMet = capitalRequirementMet;
  sandbox.stripPosTag = stripPosTag;
  sandbox.wordFormSet = wordFormSet;
  sandbox.formsMatch = formsMatch;
  sandbox.countPhraseOccurrences = countPhraseOccurrences;
`
)(sandbox);

const {
  checkRequiredWordsUsed,
  requiredWordUsed,
  requiredWordParts,
  capitalRequirementMet,
  stripPosTag,
  formsMatch
} = sandbox;

describe('stripPosTag：剥离词性标注', () => {
  test('常见词性标注被移除', () => {
    assert.strictEqual(stripPosTag('gaze v.'), 'gaze');
    assert.strictEqual(stripPosTag('affect vt.'), 'affect');
    assert.strictEqual(stripPosTag('quantity n.'), 'quantity');
    assert.strictEqual(stripPosTag('rapid adj.'), 'rapid');
  });

  test('普通词与短语不受影响', () => {
    assert.strictEqual(stripPosTag('defer'), 'defer');
    assert.strictEqual(stripPosTag('in case'), 'in case');
    assert.strictEqual(stripPosTag('the more…the more'), 'the more…the more');
  });
});

describe('requiredWordParts：拆分句型骨架', () => {
  test('省略号 / 三点连接的骨架被拆成多段', () => {
    assert.deepStrictEqual(requiredWordParts('the more…the more'), ['the more', 'the more']);
    assert.deepStrictEqual(requiredWordParts('so … that …'), ['so', 'that']);
    assert.deepStrictEqual(requiredWordParts('not only...but also'), ['not only', 'but also']);
  });

  test('单词与短语只有一段', () => {
    assert.deepStrictEqual(requiredWordParts('defer'), ['defer']);
    assert.deepStrictEqual(requiredWordParts('in case'), ['in case']);
  });
});

describe('formsMatch：词形变式', () => {
  const pairs = [
    ['defer', 'defers'],
    ['defer', 'deferred'],
    ['stop', 'stopped'],
    ['stop', 'stopping'],
    ['study', 'studies'],
    ['study', 'studied'],
    ['make', 'making'],
    ['polite', 'politely'],
    ['occur', 'occurred'],
    ['big', 'bigger'],
    ['carry', 'carried'],
    ['gaze', 'gazed']
  ];
  test('原形与常见变式互相匹配', () => {
    for (const [base, form] of pairs) {
      assert.ok(formsMatch(base, form), `${base} 应匹配 ${form}`);
    }
  });

  test('不相关的词不匹配', () => {
    assert.ok(!formsMatch('defer', 'differ'));
    assert.ok(!formsMatch('stop', 'step'));
    assert.ok(!formsMatch('case', 'cause'));
  });
});

describe('checkRequiredWordsUsed：整体判定', () => {
  /* [说明, 译文, 必用词, 期望 missing, 期望 capitalViolations] */
  const cases = [
    ['单词变式 defers', 'He defers to his teacher.', ['defer'], [], []],
    ['双写辅音 stopped', 'He stopped running.', ['stop'], [], []],
    ['词性标注 gaze v.', 'He gazed into the distance.', ['gaze v.'], [], []],
    ['多词短语 in case', 'In case it rains, take an umbrella.', ['in case'], [], []],
    ['多词短语 occur to', 'It occurred to me suddenly.', ['occur to'], [], []],
    ['句首大写短语', 'Not only did he come, but he stayed.', ['Not only'], [], []],
    ['句型骨架两次', 'The more I read, the more I like it.', ['the more…the more'], [], []],
    ['so...that', 'It was so cold that we left early.', ['so … that …'], [], []],
    ['ies 变式', 'He studies hard every day.', ['study'], [], []],
    ['e 结尾 + ing', 'He is making a cake.', ['make'], [], []],
    ['副词 ly', 'He behaved politely.', ['polite'], [], []],
    ['撇号短语', "He can't help laughing.", ['can\u2019t help'], [], []],
    ['多个必用词全用上', 'In case it rains, he defers to her advice.', ['in case', 'defer'], [], []],

    ['真的缺词', 'He likes apples.', ['defer'], ['defer'], []],
    ['短语词序不符', 'In the case he left.', ['in case'], ['in case'], []],
    ['骨架只出现一次', 'The more I read, I like it.', ['the more…the more'], ['the more…the more'], []],
    ['部分缺失', 'He defers to her.', ['defer', 'in case'], ['in case'], []],

    ['大写词未在句首', 'He said not only that.', ['Not only'], [], ['Not only']],

    ['空译文', '', ['defer'], [], []],
    ['无必用词', 'Anything goes.', [], [], []]
  ];

  for (const [name, text, words, expMissing, expCapital] of cases) {
    test(name, () => {
      const r = checkRequiredWordsUsed(text, words);
      assert.deepStrictEqual(r.missing, expMissing, `missing 不符（译文: ${text}）`);
      assert.deepStrictEqual(r.capitalViolations, expCapital, `capitalViolations 不符（译文: ${text}）`);
    });
  }

  test('同一个词不会同时出现在 missing 和 capitalViolations', () => {
    const r = checkRequiredWordsUsed('He likes apples.', ['Not only']);
    assert.deepStrictEqual(r.missing, ['Not only']);
    assert.deepStrictEqual(r.capitalViolations, [], '未使用的词不应再报位置错误');
  });

  test('异常输入不抛异常', () => {
    assert.doesNotThrow(() => checkRequiredWordsUsed(null, null));
    assert.doesNotThrow(() => checkRequiredWordsUsed('text', null));
    assert.doesNotThrow(() => checkRequiredWordsUsed(null, ['w']));
    assert.doesNotThrow(() => checkRequiredWordsUsed('text', ['', '  ']));
  });
});

describe('capitalRequirementMet：句首位置', () => {
  test('必用词在句首 → 通过', () => {
    assert.ok(capitalRequirementMet('Not only did he come, but he stayed.', 'Not only'));
    assert.ok(capitalRequirementMet('Only then did I realize it.', 'Only'));
  });

  test('必用词不在句首 → 不通过', () => {
    assert.ok(!capitalRequirementMet('He said not only that.', 'Not only'));
    assert.ok(!capitalRequirementMet('I only then realized.', 'Only'));
  });
});

describe('与真实题库数据的兼容性', () => {
  const bankPath = path.join(APP_DIR, 'data', 'gaokao_translations.json');

  test('题库里的每个必用词都能被解析（不抛异常、不产生空 parts）', (t) => {
    if (!fs.existsSync(bankPath)) return t.skip('缺少 data/gaokao_translations.json');
    const data = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
    let total = 0;
    const bad = [];
    for (const exam of data) {
      const qs = exam['翻译题'] || {};
      for (const q of Object.values(qs)) {
        if (!q || !Array.isArray(q['词'])) continue;
        for (const w of q['词']) {
          const s = String(w || '').trim();
          if (!s) continue;
          total++;
          try {
            const parts = requiredWordParts(s);
            if (!parts.length) bad.push(s);
            // 拿参考答案跑一遍，确认不抛异常
            requiredWordUsed(String(q['答案'] || ''), s);
          } catch (e) {
            bad.push(`${s} → ${e.message}`);
          }
        }
      }
    }
    assert.ok(total > 300, `必用词总数偏少 (${total})`);
    assert.deepStrictEqual(bad, [], '以下必用词解析异常: ' + bad.slice(0, 10).join(' | '));
  });

  test('参考答案对必用词的命中率应显著高于随机（回归保护）', (t) => {
    if (!fs.existsSync(bankPath)) return t.skip('缺少 data/gaokao_translations.json');
    const data = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
    let checked = 0;
    let hit = 0;
    for (const exam of data) {
      const qs = exam['翻译题'] || {};
      for (const q of Object.values(qs)) {
        if (!q || !Array.isArray(q['词'])) continue;
        const answer = String(q['答案'] || '');
        if (!answer) continue;
        for (const w of q['词']) {
          const s = String(w || '').trim();
          if (!s) continue;
          checked++;
          if (requiredWordUsed(answer, s)) hit++;
        }
      }
    }
    const rate = hit / checked;
    // 参考答案本就是「用上必用词」的标准解，命中率应该很高。
    // 修复前（简单小写全等）实测约 0.66；这里设 0.90 作为回归下限。
    assert.ok(
      rate >= 0.9,
      `参考答案命中率过低: ${(rate * 100).toFixed(1)}% (${hit}/${checked})，匹配逻辑可能退化`
    );
  });
});
