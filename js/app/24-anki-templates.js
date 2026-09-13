/* ============================================================
   AI 英语对话教练 — Anki 桌面端卡片模板
   由 js/app.js 拆分而来（Anki 模型 CSS / 卡片模板 / 新字段渲染）。
   ============================================================ */

const VOCAB_MODEL = '英语学习-词汇';
const ANKI_QUIZ_MODEL = '英语学习-薄弱点问答';
const ANKI_BASIC_MODEL = '英语学习-基础卡';
const VOCAB_TEMPLATE = '默写';
const ANKI_QUIZ_TEMPLATE = '薄弱点问答';
const ANKI_BASIC_TEMPLATE = '正反面';
const ANKI_QUIZ_FIELDS = ['Question', 'Answer', 'Explanation'];
const ANKI_BASIC_FIELDS = ['Front', 'Back'];

const ANKI_QUIZ_CSS = `
* { box-sizing: border-box; }
.card {
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
  font-size: 18px; line-height: 1.65; color: #0f172a; background: #f8fafc;
  padding: 28px 24px; text-align: left; margin: 0 auto;
}
.quiz-shell, .basic-shell { max-width: 700px; margin: 0 auto; }
.quiz-kicker, .basic-kicker {
  text-align: center; color: #64748b; font-size: 12px; font-weight: 800;
  letter-spacing: 2px; margin-bottom: 18px;
}
.quiz-stem {
  white-space: pre-wrap; font-size: 19px; line-height: 1.75; color: #0f172a;
  padding: 18px 20px; background: #ffffff; border: 1px solid #dbeafe;
  border-radius: 16px; box-shadow: 0 8px 24px rgba(15, 23, 42, .06);
}
.quiz-options { display: grid; gap: 12px; margin-top: 16px; }
.quiz-option {
  display: grid; grid-template-columns: 38px 1fr; gap: 12px; align-items: start;
  padding: 14px 16px; background: #ffffff; border: 1px solid #dbe3ef;
  border-radius: 14px; box-shadow: 0 4px 14px rgba(15, 23, 42, .04);
}
.quiz-option .letter {
  display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center;
  border-radius: 9px; background: #eff6ff; color: #2563eb; font-weight: 800;
}
.quiz-option .option-text { line-height: 1.65; white-space: pre-wrap; }
hr#answer, .quiz-divider, .basic-divider, .vocab-divider {
  border: none; border-top: 1px dashed #cbd5e1; margin: 24px 0;
}
.quiz-answer, .answer {
  white-space: pre-wrap; margin: 0; padding: 15px 18px; border-radius: 14px;
  background: #ecfdf5; border: 1px solid #bbf7d0; color: #166534;
  font-size: 19px; font-weight: 750; line-height: 1.65;
}
.quiz-explanation, .explanation {
  white-space: pre-wrap; margin: 14px 0 0; padding: 14px 16px;
  border-left: 4px solid #93c5fd; border-radius: 10px; background: #ffffff;
  color: #475569; font-size: 15px; line-height: 1.75;
}
`;

const ANKI_BASIC_CSS = `
* { box-sizing: border-box; }
.card {
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
  font-size: 18px; line-height: 1.7; color: #0f172a; background: #f8fafc;
  padding: 28px 24px; text-align: left; margin: 0 auto;
}
.basic-shell { max-width: 700px; margin: 0 auto; }
.basic-kicker {
  text-align: center; color: #64748b; font-size: 12px; font-weight: 800;
  letter-spacing: 2px; margin-bottom: 18px;
}
.basic-front-card, .basic-back-card {
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px;
  padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, .06);
}
.basic-front-text {
  white-space: pre-wrap; text-align: center; font-size: 24px; line-height: 1.65;
  font-weight: 750; color: #0f172a;
}
.basic-back-text { white-space: pre-wrap; font-size: 17px; line-height: 1.8; color: #334155; }
.basic-divider { border: none; border-top: 1px dashed #cbd5e1; margin: 24px 0; }
`;

const ANKI_VOCAB_CSS = `
* { box-sizing: border-box; }
.card {
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
  color: #0f172a; background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
  padding: 28px 24px; text-align: left; margin: 0 auto;
}
.vocab-shell { max-width: 700px; margin: 0 auto; }
.vocab-kicker {
  text-align: center; color: #64748b; font-size: 12px; font-weight: 800;
  letter-spacing: 2px; margin-bottom: 18px;
}
.vocab-front-card, .vocab-back-card {
  background: #ffffff; border: 1px solid #dbeafe; border-radius: 18px;
  padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, .07);
}
.vocab-front-meaning {
  white-space: pre-wrap; text-align: center; font-size: 27px; line-height: 1.65;
  font-weight: 800; color: #0f172a;
}
.vocab-prompt { text-align: center; color: #94a3b8; font-size: 13px; margin-top: 18px; }
.vocab-word-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.vocab-audio { display: inline-flex; align-items: center; }
.vocab-word { font-size: clamp(30px, 7vw, 42px); line-height: 1.25; font-weight: 850; color: #0f766e; letter-spacing: .2px; }
.vocab-phonetic { color: #64748b; font-family: Georgia, "Times New Roman", serif; font-size: 18px; }
.vocab-pos {
  display: inline-flex; padding: 4px 10px; border-radius: 999px;
  background: #dbeafe; color: #1d4ed8; font-size: 12px; font-weight: 800;
}
.vocab-defs { display: grid; gap: 9px; margin: 14px 0 0; padding: 0; list-style: none; counter-reset: vocab-def; }
.vocab-defs li {
  counter-increment: vocab-def; display: grid; grid-template-columns: 26px 1fr; gap: 9px;
  padding: 10px 12px; border-radius: 11px; background: #f8fafc; line-height: 1.65;
}
.vocab-defs li::before {
  content: counter(vocab-def); width: 22px; height: 22px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #ccfbf1; color: #0f766e; font-size: 12px; font-weight: 850;
}
.vocab-inflection { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: #f8fafc; color: #64748b; font-size: 13px; }
.vocab-divider { border: none; border-top: 1px dashed #cbd5e1; margin: 24px 0; }
.vocab-example, .vocab-context {
  white-space: pre-wrap; margin-top: 10px; padding: 12px 14px; border-radius: 12px;
  font-size: 15px; line-height: 1.75;
}
.vocab-example { background: #f1f5f9; color: #334155; }
.vocab-context { background: #ecfdf5; border-left: 4px solid #34d399; color: #475569; }
.replay-button { text-decoration: none; margin-left: 6px; }
.replay-button svg { width: 26px; height: 26px; }
`;

const ANKI_QUIZ_SCRIPT = `
<script>
(function () {
  function fieldText(root) {
    if (!root) return '';
    var clone = root.cloneNode(true);
    clone.querySelectorAll('br').forEach(function (node) { node.replaceWith(document.createTextNode('\\n')); });
    clone.querySelectorAll('p,div,li').forEach(function (node) { node.appendChild(document.createTextNode('\\n')); });
    return clone.textContent.replace(/\\r/g, '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  }
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function clean(value) {
    return String(value || '').replace(/[。.！!？?]?\\s*(?:测试点|测试點)\\s*[:：][\\s\\S]*$/, '').trim();
  }
  function renderQuestion(root) {
    if (!root || root.dataset.aiRendered === '1') return;
    if (root.querySelector('.quiz-option')) { root.dataset.aiRendered = '1'; return; }
    var lines = fieldText(root).split('\\n').map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return;
    var optionRe = /^([A-D])[\\.、\\)]\\s*(.+)$/;
    var start = lines.findIndex(function (line) { return optionRe.test(line); });
    var optionLines = start >= 0 ? lines.slice(start).filter(function (line) { return optionRe.test(line); }) : [];
    root.textContent = '';
    if (optionLines.length === 4) {
      root.appendChild(make('div', 'quiz-stem', lines.slice(0, start).join('\\n')));
      var options = make('div', 'quiz-options');
      optionLines.forEach(function (line) {
        var match = line.match(optionRe);
        var option = make('div', 'quiz-option');
        option.appendChild(make('span', 'letter', match[1]));
        option.appendChild(make('span', 'option-text', match[2]));
        options.appendChild(option);
      });
      root.appendChild(options);
    } else {
      root.className = 'quiz-stem';
      root.textContent = lines.join('\\n');
    }
    root.dataset.aiRendered = '1';
  }
  function renderPlain(root, className, prefix) {
    if (!root || root.dataset.aiRendered === '1') return;
    root.className = className;
    root.textContent = prefix ? prefix + ' ' + clean(fieldText(root)).replace(/^✅\\s*/, '') : clean(fieldText(root));
    root.dataset.aiRendered = '1';
  }
  function init() {
    renderQuestion(document.getElementById('aiQuizQuestion'));
    renderPlain(document.getElementById('aiQuizAnswer'), 'quiz-answer', '✅');
    renderPlain(document.getElementById('aiQuizExplanation'), 'quiz-explanation', '');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>`;

function ankiQuizQuestionHTML() {
  return `<div class="quiz-shell"><div class="quiz-kicker">AI 英语练习</div><div id="aiQuizQuestion">{{Question}}</div></div>${ANKI_QUIZ_SCRIPT}`;
}
function ankiQuizBackHTML() {
  return `{{FrontSide}}<div class="quiz-shell"><hr id="answer"><div id="aiQuizAnswer">{{Answer}}</div><div id="aiQuizExplanation">{{Explanation}}</div></div>${ANKI_QUIZ_SCRIPT}`;
}
function ankiQuizTemplates() {
  return { [ANKI_QUIZ_TEMPLATE]: { Front: ankiQuizQuestionHTML(), Back: ankiQuizBackHTML() } };
}
function ankiQuizQuestionFieldHTML(q) {
  const stem = esc(q.question || '');
  const options = Array.isArray(q.options) && q.options.length ?
    `<div class="quiz-options">${q.options.map(option => {
      const m = String(option).match(/^([A-D])[\.、\)]\s*(.*)$/);
      return m ? `<div class="quiz-option"><span class="letter">${esc(m[1])}</span><span class="option-text">${esc(m[2])}</span></div>` : `<div class="quiz-option"><span class="option-text">${esc(option)}</span></div>`;
    }).join('')}</div>` : '';
  return `<div class="quiz-stem">${stem}</div>${options}`;
}

const ANKI_BASIC_SCRIPT = `
<script>
(function () {
  function fieldText(root) {
    if (!root) return '';
    var clone = root.cloneNode(true);
    clone.querySelectorAll('br').forEach(function (node) { node.replaceWith(document.createTextNode('\\n')); });
    clone.querySelectorAll('p,div,li').forEach(function (node) { node.appendChild(document.createTextNode('\\n')); });
    return clone.textContent.replace(/\\r/g, '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  }
  function render(root, className) {
    if (!root || root.dataset.aiRendered === '1') return;
    root.className = className;
    root.textContent = fieldText(root);
    root.dataset.aiRendered = '1';
  }
  function init() {
    render(document.getElementById('aiBasicFront'), 'basic-front-text');
    render(document.getElementById('aiBasicBack'), 'basic-back-text');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>`;

function ankiBasicQuestionHTML() {
  return `<div class="basic-shell"><div class="basic-kicker">AI 英语笔记</div><div class="basic-front-card"><div id="aiBasicFront">{{Front}}</div></div></div>${ANKI_BASIC_SCRIPT}`;
}
function ankiBasicBackHTML() {
  return `{{FrontSide}}<div class="basic-shell"><hr class="basic-divider"><div class="basic-back-card"><div id="aiBasicBack">{{Back}}</div></div></div>${ANKI_BASIC_SCRIPT}`;
}
function ankiBasicTemplates() {
  return { [ANKI_BASIC_TEMPLATE]: { Front: ankiBasicQuestionHTML(), Back: ankiBasicBackHTML() } };
}

const ANKI_VOCAB_SCRIPT = `
<script>
(function () {
  function fieldText(root) {
    if (!root) return '';
    var clone = root.cloneNode(true);
    clone.querySelectorAll('br').forEach(function (node) { node.replaceWith(document.createTextNode('\\n')); });
    clone.querySelectorAll('p,div,li').forEach(function (node) { node.appendChild(document.createTextNode('\\n')); });
    return clone.textContent.replace(/\\[sound:[^\\]]*\\]/g, '').replace(/\\r/g, '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  }
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function parseDictionary(text) {
    var wordMatch = text.match(/^([A-Za-z][A-Za-z0-9'’ .()-]{0,60}?)\\s*\\//);
    if (!wordMatch) return null;
    var rest = text.slice(wordMatch[0].length);
    var phonetics = [];
    while (true) {
      var phonetic = rest.match(/^\\/?([^/\\n]+)\\/\\s*(?:\\((?:英音|美音|英|美|英式|美式|UK|US)\\)\\s*)?/i);
      if (!phonetic) break;
      phonetics.push('/' + phonetic[1] + '/');
      rest = rest.slice(phonetic[0].length);
    }
    var pos = '';
    while (true) {
      var part = rest.match(/^(?:adj|adv|vt|vi|n|v|prep|pron|conj|interj|det|phrase)\\.(?:\\s*[\\/／、]\\s*)?/i);
      if (!part) break;
      pos += (pos ? '/' : '') + part[0].trim().replace(/[\\/／、]$/, '');
      rest = rest.slice(part[0].length);
    }
    var inflection = '';
    var forms = rest.match(/^变形\\s*[:：]\\s*([^•\\n]*)/);
    if (forms) { inflection = forms[1].trim(); rest = rest.slice(forms[0].length); }
    var section = rest.search(/(?:^|\\n)(?:例句|常见搭配|相关搭配|同义词辨析|近义表达|词源)\\s*[:：]?/);
    var definitionText = section >= 0 ? rest.slice(0, section) : rest;
    var meanings = definitionText.split(/\\s*[•\\n]\\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    return { word: wordMatch[1].trim(), phonetics: phonetics, pos: pos, inflection: inflection, meanings: meanings };
  }
  function renderFront(root) {
    if (!root || root.dataset.aiRendered === '1') return;
    var sourceText = fieldText(root);
    var parsed = parseDictionary(sourceText);
    root.textContent = '';
    var card = make('div', 'vocab-front-card');
    card.appendChild(make('div', 'vocab-kicker', '看释义 · 想英文'));
    if (parsed && parsed.meanings.length) {
      if (parsed.pos) card.appendChild(make('div', 'vocab-pos', parsed.pos));
      var defs = make('ol', 'vocab-defs');
      parsed.meanings.forEach(function (meaning) { defs.appendChild(make('li', '', meaning)); });
      card.appendChild(defs);
    } else {
      card.appendChild(make('div', 'vocab-front-meaning', sourceText));
    }
    card.appendChild(make('div', 'vocab-prompt', '先在脑中回忆英文，再点击显示答案'));
    root.appendChild(card);
    root.dataset.aiRendered = '1';
  }
  function renderBack(root) {
    if (!root || root.dataset.aiRendered === '1') return;
    var media = Array.prototype.slice.call(root.querySelectorAll('a.replay-button, audio, [onclick*="play"]')).map(function (node) { return node.cloneNode(true); });
    var lines = fieldText(root).split('\\n').map(function (line) { return line.trim(); }).filter(Boolean);
    var word = lines.shift() || '';
    var examples = [];
    var contexts = [];
    var meanings = [];
    lines.forEach(function (line) {
      var context = line.match(/^💬?\\s*语境\\s*[:：]?\\s*([\\s\\S]*)$/);
      if (context) contexts.push(context[1].trim());
      else if (/[A-Za-z]/.test(line)) examples.push(line);
      else meanings.push(line);
    });
    root.textContent = '';
    var card = make('div', 'vocab-back-card');
    var row = make('div', 'vocab-word-row');
    row.appendChild(make('span', 'vocab-word', word));
    media.forEach(function (node) { var wrap = make('span', 'vocab-audio'); wrap.appendChild(node); row.appendChild(wrap); });
    card.appendChild(row);
    if (meanings.length) {
      var defs = make('ol', 'vocab-defs');
      meanings.forEach(function (meaning) { defs.appendChild(make('li', '', meaning)); });
      card.appendChild(defs);
    }
    examples.forEach(function (example) { card.appendChild(make('div', 'vocab-example', example)); });
    contexts.forEach(function (context) { card.appendChild(make('div', 'vocab-context', '语境：' + context)); });
    root.appendChild(card);
    root.dataset.aiRendered = '1';
  }
  function init() {
    renderFront(document.getElementById('aiVocabFront'));
    renderBack(document.getElementById('aiVocabBack'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>`;

function ankiVocabQuestionHTML() {
  return `<div class="vocab-shell"><div id="aiVocabFront">{{Front}}</div></div>${ANKI_VOCAB_SCRIPT}`;
}
function ankiVocabBackHTML() {
  return `{{FrontSide}}<div class="vocab-shell"><hr class="vocab-divider"><div id="aiVocabBack">{{Back}}</div></div>${ANKI_VOCAB_SCRIPT}`;
}
function ankiVocabTemplates() {
  return { [VOCAB_TEMPLATE]: { Front: ankiVocabQuestionHTML(), Back: ankiVocabBackHTML() } };
}
