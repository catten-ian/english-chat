/* ============================================================
   AI 英语对话教练 — Anki 桌面端卡片模板
   由 js/app.js 拆分而来（Anki 模型 CSS / 卡片模板 / 新字段渲染）。
   ============================================================ */

const VOCAB_MODEL = '英语学习-词汇';
// ANKI_QUIZ_MODEL is declared by js/config.js, which loads before this file.
// Keep this module compatible with the shared constant instead of redeclaring it.
const ANKI_BASIC_MODEL = '英语学习-基础卡';
const VOCAB_TEMPLATE = '默写';
const ANKI_QUIZ_TEMPLATE = '薄弱点问答';
const ANKI_BASIC_TEMPLATE = '正反面';
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
.quiz-question { white-space: pre-wrap; }
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
  font-size: 18px; line-height: 1.7; color: #0f172a; background: #f8fafc;
  padding: 28px 24px; text-align: left; margin: 0 auto;
}
.vocab-shell { width: 100%; max-width: 700px; margin: 0 auto; }
.vocab-kicker {
  display: flex; align-items: center; justify-content: center; gap: 9px;
  color: #64748b; font-size: 12px; font-weight: 800;
  letter-spacing: 2px; margin-bottom: 18px; text-transform: uppercase;
}
.vocab-front-card, .vocab-back-card {
  position: relative; overflow: hidden; background: #ffffff;
  border: 1px solid #dbe3ef; border-radius: 18px;
  padding: 28px 26px; box-shadow: 0 10px 30px rgba(15, 23, 42, .06);
}
.vocab-front-card::before, .vocab-back-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 4px;
  background: #0f766e;
}
.vocab-front-meaning {
  white-space: pre-wrap; text-align: left; font-size: 24px; line-height: 1.65;
  font-weight: 750; color: #0f172a;
}
.vocab-front-text, .vocab-back-text {
  white-space: pre-wrap; word-break: break-word;
}
.vocab-front-text {
  font-size: 24px; line-height: 1.7; font-weight: 750; color: #0f172a;
}
.vocab-back-text {
  font-size: 18px; line-height: 1.8; color: #334155;
}
.vocab-direction {
  display: inline-flex; align-items: center; margin-bottom: 18px; padding: 5px 10px;
  border-radius: 999px; background: #ecfdf5; color: #047857;
  font-size: 12px; font-weight: 800;
}
.vocab-prompt {
  color: #64748b; font-size: 13px; margin-top: 22px; padding-top: 14px;
  border-top: 1px solid #e2e8f0;
}
.vocab-word-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.vocab-audio { display: inline-flex; align-items: center; order: 2; }
.vocab-word { font-size: 40px; line-height: 1.25; font-weight: 850; color: #0f766e; letter-spacing: 0; }
.vocab-phonetic { color: #64748b; font-family: Georgia, "Times New Roman", serif; font-size: 18px; }
.vocab-pos {
  display: inline-flex; padding: 4px 8px; border-radius: 999px;
  background: #eff6ff; color: #2563eb; font-size: 12px; font-weight: 800;
}
.vocab-defs { display: grid; gap: 9px; margin: 14px 0 0; padding: 0; list-style: none; counter-reset: vocab-def; }
.vocab-defs li {
  counter-increment: vocab-def; display: grid; grid-template-columns: 26px 1fr; gap: 9px;
  padding: 11px 13px; border-radius: 10px; background: #f8fafc; border: 1px solid #eef2f7; line-height: 1.65;
}
.vocab-defs li::before {
  content: counter(vocab-def); width: 22px; height: 22px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #ccfbf1; color: #0f766e; font-size: 12px; font-weight: 800;
}
.vocab-inflection { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: #f8fafc; color: #64748b; font-size: 13px; }
.vocab-divider { border: none; border-top: 1px dashed #cbd5e1; margin: 24px 0; }
.vocab-example, .vocab-context {
  white-space: pre-wrap; margin-top: 10px; padding: 13px 15px; border-radius: 10px;
  font-size: 15px; line-height: 1.75;
}
.vocab-example { background: #f8fafc; border: 1px solid #eef2f7; color: #334155; }
.vocab-context { background: #ecfdf5; border-left: 4px solid #10b981; color: #475569; }
.vocab-back-content { white-space: pre-wrap; }
.vocab-answer-label { color: #047857; font-size: 12px; font-weight: 800; letter-spacing: 1px; margin-bottom: 8px; }
.replay-button { text-decoration: none; margin-left: 6px; }
.replay-button svg { width: 26px; height: 26px; }
@media (max-width: 480px) {
  .card { padding: 18px 12px; }
  .vocab-front-card, .vocab-back-card { padding: 22px 18px; }
  .vocab-front-meaning { font-size: 21px; }
  .vocab-word { font-size: 34px; }
}
`;

function ankiQuizQuestionHTML() {
  return `<div class="quiz-shell"><div class="quiz-kicker">AI 英语练习</div><div class="quiz-question">{{Question}}</div></div>`;
}
function ankiQuizBackHTML() {
  return `{{FrontSide}}<div class="quiz-shell"><hr id="answer"><div class="quiz-answer">✅ {{Answer}}</div><div class="quiz-explanation">{{Explanation}}</div></div>`;
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

function ankiBasicQuestionHTML() {
  return `<div class="basic-shell"><div class="basic-kicker">AI 英语笔记</div><div class="basic-front-card"><div class="basic-front-text">{{Front}}</div></div></div>`;
}
function ankiBasicBackHTML() {
  return `{{FrontSide}}<div class="basic-shell"><hr class="basic-divider"><div class="basic-back-card"><div class="basic-back-text">{{Back}}</div></div></div>`;
}
function ankiBasicTemplates() {
  return { [ANKI_BASIC_TEMPLATE]: { Front: ankiBasicQuestionHTML(), Back: ankiBasicBackHTML() } };
}

function ankiVocabQuestionHTML() {
  return `<div class="vocab-shell"><div class="vocab-kicker">词汇默写 · 中译英</div><div class="vocab-front-card"><div class="vocab-front-text">{{Front}}</div></div></div>`;
}
function ankiVocabBackHTML() {
  return `<div class="vocab-shell"><div class="vocab-kicker">词汇卡 · 参考答案</div><div class="vocab-back-card"><div class="vocab-answer-label">ANSWER</div><div class="vocab-back-text vocab-back-content">{{Back}}</div></div></div>`;
}
function ankiVocabTemplates() {
  return { [VOCAB_TEMPLATE]: { Front: ankiVocabQuestionHTML(), Back: ankiVocabBackHTML() } };
}
