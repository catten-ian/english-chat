'use strict';

const crypto = require('node:crypto');
const WORLD = require('./world-game');

// Author-reviewed content is immutable for the lifetime of this process. The
// generator may select wording and order, never facts, answers or explanations.
const wordings = {
  'low-tide': ['What best explains the harbor lanterns going dark?', 'What evidence rules out a shortage of oil?', 'Which first-hand findings help explain the electrical fault?'],
  'storm-line': ['Which passage is safest for the rescue boat?', 'At what time is the second storm surge expected?', 'What makes the north channel unsafe?'],
  beacon: ['In which order should the beacon be restored safely?', 'What spare part can Eli provide?', 'After the tide falls, where should the beacon beam be aimed?']
};
const books = new Map(WORLD.stages.map(stage => {
  const blueprints = stage.questions.map((item, index) => ({
    id: `${stage.id}-q${index + 1}`,
    wordings: [{ id: 'w1', text: item.q }, { id: 'w2', text: wordings[stage.id][index] }],
    options: item.options.map((text, i) => ({ id: `o${i + 1}`, text })),
    correctId: `o${item.answer + 1}`, why: item.why
  }));
  const revision = crypto.createHash('sha256').update(JSON.stringify(blueprints)).digest('hex');
  return [stage.id, { revision, blueprints }];
}));
const exactKeys = (item, keys) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === keys.length && keys.every(key => Object.hasOwn(item, key));

function catalog(stageId) {
  const book = books.get(stageId);
  if (!book) throw new Error('unknown quiz stage');
  return book.blueprints.map(({ id, wordings, options }) => ({ id, wordings: wordings.map(item => ({ ...item })), options: options.map(item => ({ ...item })) }));
}
function assemble(stageId, recipe, source, attempts = 0, fallbackReason) {
  const book = books.get(stageId);
  if (!book || !['ai_assembled', 'authored_fallback'].includes(source) || !Number.isInteger(attempts) || attempts < 0 || attempts > 2) throw new Error('invalid quiz metadata');
  if (!Array.isArray(recipe) || recipe.length !== book.blueprints.length || new Set(recipe.map(item => item?.id)).size !== book.blueprints.length) throw new Error('invalid blueprint set');
  const items = recipe.map(selection => {
    if (!exactKeys(selection, ['id', 'wordingId', 'optionOrder'])) throw new Error('invalid selection');
    const blueprint = book.blueprints.find(item => item.id === selection.id);
    const wording = blueprint?.wordings.find(item => item.id === selection.wordingId);
    if (!wording || !Array.isArray(selection.optionOrder) || selection.optionOrder.length !== 4 || new Set(selection.optionOrder).size !== 4 || selection.optionOrder.some(id => !blueprint.options.some(item => item.id === id))) throw new Error('invalid wording or option permutation');
    return { q: wording.text, options: selection.optionOrder.map(id => blueprint.options.find(item => item.id === id).text), answer: selection.optionOrder.indexOf(blueprint.correctId), why: blueprint.why };
  });
  const metadata = { source, revision: book.revision, recipe: JSON.parse(JSON.stringify(recipe)), attempts };
  if (source === 'authored_fallback') {
    if (!['provider_unavailable', 'invalid_selection', 'generation_timeout'].includes(fallbackReason)) throw new Error('invalid fallback reason');
    metadata.fallbackReason = fallbackReason;
  }
  return { items, metadata };
}
function authored(stageId, attempts = 0, reason = 'provider_unavailable') {
  return assemble(stageId, catalog(stageId).map(item => ({ id: item.id, wordingId: item.wordings[0].id, optionOrder: item.options.map(option => option.id) })), 'authored_fallback', attempts, reason);
}
function valid(row) {
  if (!row || row.invalidated) return false;
  try {
    const metadata = row.metadata;
    if (metadata.revision !== books.get(row.stage_id)?.revision) return false;
    const reconstructed = assemble(row.stage_id, metadata.recipe, metadata.source, metadata.attempts, metadata.fallbackReason);
    return JSON.stringify(reconstructed.items) === JSON.stringify(row.items) && JSON.stringify(reconstructed.metadata) === JSON.stringify(metadata);
  } catch (_) { return false; }
}
module.exports = { catalog, assemble, authored, valid };
