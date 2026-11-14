/* Explicit adapter for the local native scheduler. */
'use strict';

const { validateLocalSchedulerConfig } = require('./scheduler-config');
const { createClient } = require('./scheduler');

function createNativeAnkiAdapter(config) {
  const validated = validateLocalSchedulerConfig(config);
  if (!validated.enabled) {
    return { enabled: false, reason: validated.reason };
  }
  const client = createClient(validated);
  return {
    enabled: true,
    config: validated,
    health: () => client.health(),
    listDecks: (userId) => client.listDecks(userId),
    createNote: (userId, payload) => client.createNote(userId, payload),
    dueCards: (userId, payload) => client.dueCards(userId, payload),
    allCards: (userId, payload) => client.allCards(userId, payload),
    preview: (userId, payload) => client.preview(userId, payload),
    answer: (userId, cardId, payload) => client.answer(userId, cardId, payload),
    importPreview: (userId, payload) => client.importPreview(userId, payload),
    importCommit: (userId, payload) => client.importCommit(userId, payload),
    importSnapshot: (userId, payload) => client.importSnapshot(userId, payload),
    validateSnapshot: (userId, payload) => client.validateSnapshot(userId, payload),
    exportPackage: (userId) => client.exportPackage(userId),
    exportOfficialPackage: (userId) => client.exportOfficialPackage(userId),
    importPackage: (userId, payload) => client.importPackage(userId, payload),
    importOfficialPackage: (userId, payload) => client.importOfficialPackage(userId, payload),
    exportSnapshot: (userId) => client.exportSnapshot(userId)
  };
}

module.exports = { createNativeAnkiAdapter };
