'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = [
  '06-anki.js',
  '36-anki-quality.js'
].map(name => fs.readFileSync(path.join(__dirname, '..', 'js', 'app', name), 'utf8')).join('\n');
const context = vm.createContext({ dbg() {} });
vm.runInContext(source, context, { filename: '06-anki.js' });

test('quiz dedup catches duplicate main-idea prompts despite punctuation and HTML options', () => {
  const a = { question: '<div class="quiz-stem">What is the main idea of "The Quiet Value of Repair"?</div><div class="quiz-options">A. ...</div>' };
  const b = { question: '<div class="quiz-stem">What is the main idea of &quot;The Quiet Value of Repair&quot;?</div><div class="quiz-options">B. ...</div>' };
  assert.equal(context.quizQuestionsAreNearDuplicates(a, b), true);
});

test('quiz dedup catches paraphrased stems testing the same shared-adaptation idea', () => {
  const a = { question: 'Which sentence best expresses the idea that adaptation is a shared process?' };
  const b = { question: 'Which sentence best completes the idea that adaptation is a shared process?' };
  assert.equal(context.quizQuestionsAreNearDuplicates(a, b), true);
});

test('quiz dedup catches a repeated grammar point generated as fill-in and error-correction cards', () => {
  const fill = {
    weak_point_ids: ['grammar-measure-progress'],
    question: '<div class="quiz-stem">Communities need effective ways to ___ (measure) progress, identify problems, and correct mistakes before small issues become larger ones.</div>'
  };
  const correction = {
    weakPointIds: ['grammar-measure-progress'],
    question: '<div class="quiz-stem">Communities need ways to measures progress, and a pilot project becomes useful when its failures are treated as evidence.</div>'
  };
  assert.equal(context.quizQuestionsAreNearDuplicates(fill, correction), true);
});

test('quiz dedup keeps different skills in the same weak point distinct', () => {
  const title = {
    weak_point_ids: ['repair-reading'],
    question: 'What does the title The Quiet Value of Repair suggest about the benefit discussed in the passage?'
  };
  const mainIdea = {
    weak_point_ids: ['repair-reading'],
    question: 'What is the main idea of The Quiet Value of Repair?'
  };
  assert.equal(context.quizQuestionsAreNearDuplicates(title, mainIdea), false);
});

test('quiz dedup keeps distinct questions that share only a broad topic word', () => {
  const a = { question: 'What does the title The Quiet Value of Repair suggest about the benefit discussed in the passage?' };
  const b = { question: 'What do local residents contribute to adaptation planning?' };
  assert.equal(context.quizQuestionsAreNearDuplicates(a, b), false);
});

test('quiz dedup keeps a title-inference question distinct from a main-idea question', () => {
  const a = { question: 'What does the title The Quiet Value of Repair suggest about the benefit discussed in the passage?' };
  const b = { question: 'What is the main idea of The Quiet Value of Repair?' };
  assert.equal(context.quizQuestionsAreNearDuplicates(a, b), false);
});

test('fill-in questions require one answer and one correctly displayed root hint per blank', () => {
  const valid = {
    type: 'fill_blank',
    question: 'The report ___ (complete) before the committee meets.',
    answer: 'must be completed',
    blank_hints: ['complete'],
    explanation: 'The passive form is required.'
  };
  assert.equal(context.isQuizQuestionUsable(valid), true);
  assert.equal(context.isQuizQuestionUsable({ ...valid, answer: 'must be completed, reviewed' }), false);
  assert.equal(context.isQuizQuestionUsable({ ...valid, question: 'The report ___ before the committee meets.' }), false);
  assert.equal(context.isQuizQuestionUsable({ ...valid, blank_hints: [] }), false);
  assert.equal(context.isQuizQuestionUsable({
    ...valid,
    question: 'Communities need ways to ___ (measure) progress.',
    answer: 'measure',
    blank_hints: ['measure']
  }), false, 'a root hint identical to the answer gives away the blank');
});

test('multiple-choice questions reject Chinese stems and conspicuously longer correct answers', () => {
  const valid = {
    type: 'multiple_choice',
    question: 'The equipment ___ before every flight.',
    options: ['A. is checked', 'B. checks', 'C. has checked', 'D. was checking'],
    answer: 'A',
    explanation: 'The passive voice describes the routine check.'
  };
  assert.equal(context.isQuizQuestionUsable(valid), true);
  assert.equal(context.isQuizQuestionUsable({ ...valid, question: '选择正确的表达: ___' }), false);
  assert.equal(context.isQuizQuestionUsable({
    ...valid,
    options: ['A. is checked carefully before departure by the ground crew', 'B. checks', 'C. has checked', 'D. was checking']
  }), false);
});

test('second-pass quiz review rejects the screenshot pattern with unrelated, implausible distractors', async () => {
  const weakQuestion = {
    type: 'multiple_choice',
    question: 'A machine has stopped working because one of its parts is broken. Which sentence is most appropriate?',
    options: [
      'A. The engineer is trying to solve the problem.',
      'B. The engineer is trying to express the problem.',
      'C. The engineer is trying to raise the canopy.',
      'D. The engineer is trying to discuss the challenge facing the world.'
    ],
    answer: 'A',
    explanation: 'solve a problem 表示解决问题。'
  };
  assert.equal(context.isQuizQuestionUsable(weakQuestion), true, 'local shape checks alone cannot assess semantic distractor quality');
  context.smartParseJSON = JSON.parse;
  let request;
  context.callAPI = async messages => {
    request = messages;
    return JSON.stringify({ approved_indices: [], rejected: [{ index: 0, reason: 'three distractors are unrelated or implausible' }] });
  };

  const accepted = await context.reviewGeneratedQuizQuestions([weakQuestion]);

  assert.deepEqual(accepted, []);
  assert.match(request[0].content, /distractor is silly, unrelated/);
  assert.match(request[0].content, /more than one defensible answer/);
  assert.match(request[1].content, /raise the canopy/);
});

test('second-pass quiz review fails closed when the model response is malformed', async () => {
  context.smartParseJSON = value => {
    try { return JSON.parse(value); } catch (_) { return null; }
  };
  context.callAPI = async () => 'not JSON';
  await assert.rejects(context.reviewGeneratedQuizQuestions([{ question: 'A question?' }]), /invalid JSON/);
});

test('a rejected second-pass review never writes a quiz card to FSRS or Anki', async () => {
  const valid = {
    type: 'multiple_choice',
    question: 'The engineer is trying to ___ the broken machine.',
    options: ['A. repair', 'B. repairing', 'C. repaired', 'D. repairs'],
    answer: 'A',
    explanation: 'The infinitive follows "trying to".'
  };
  let generationCalls = 0;
  let writes = 0;
  context.getSetting = (_key, fallback) => fallback;
  context.buildQuizPrompt = () => 'generate English practice';
  context.callAPI = async () => {
    generationCalls++;
    return generationCalls === 1
      ? JSON.stringify({ questions: [valid] })
      : JSON.stringify({ approved_indices: [], rejected: [{ index: 0, reason: 'distractors are too easy' }] });
  };
  context.ankiAddNotesBatch = async () => { writes++; return { added: 1 }; };
  context.nativeSchedulerCreateQuizNotes = async () => { writes++; return { added: 1 }; };

  const result = await context.autoGenerateQuizQuestions([{ id: 'wp1', category: 'grammar', point: 'verb patterns' }]);

  assert.equal(generationCalls, 2);
  assert.equal(writes, 0);
  assert.equal(result.added, 0);
  assert.equal(result.note, 'quality review rejected candidates');
});
