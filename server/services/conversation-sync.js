'use strict';

const crypto = require('node:crypto');
const { db } = require('../db');
const { MAX_USER_DATA, CONVERSATION_SYNC_SECRET, CONVERSATION_SYNC_PEER } = require('../config');
const { mergeSnapshots, validId } = require('./conversation-merge');
const logger = require('./logger');

function readSnapshot(uid) {
  const rows = db.prepare("SELECT key, value FROM user_data WHERE user_id=? AND key IN ('conversations','conversation_deletions')").all(uid);
  const values = Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value)]));
  return { conversations: values.conversations || {}, deleted: values.conversation_deletions || {} };
}

function writeSnapshot(uid, snapshot) {
  const put = db.prepare("INSERT INTO user_data (user_id,key,value,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')");
  const encoded = JSON.stringify(snapshot.conversations);
  if (Buffer.byteLength(encoded) > MAX_USER_DATA) throw new Error('conversation data too large');
  put.run(uid, 'conversations', encoded);
  put.run(uid, 'conversation_deletions', JSON.stringify(snapshot.deleted));
}

function mergeForUser(uid, incoming) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const merged = mergeSnapshots(readSnapshot(uid), incoming);
    writeSnapshot(uid, merged);
    db.exec('COMMIT');
    return merged;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function deleteForUser(uid, id) {
  if (!validId(id)) throw new Error('invalid conversation id');
  db.exec('BEGIN IMMEDIATE');
  try {
    const snapshot = readSnapshot(uid);
    delete snapshot.conversations[id];
    snapshot.deleted[id] = new Date().toISOString();
    writeSnapshot(uid, snapshot);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function signedHeaders(body, timestamp, secret = CONVERSATION_SYNC_SECRET) {
  return {
    'Content-Type': 'application/json',
    'X-Sync-Timestamp': String(timestamp),
    'X-Sync-Signature': crypto.createHmac('sha256', secret).update(String(timestamp) + '.' + body).digest('hex')
  };
}

function validSignature(req, body) {
  if (!CONVERSATION_SYNC_SECRET) return false;
  const timestamp = Number(req.headers['x-sync-timestamp']);
  const signature = String(req.headers['x-sync-signature'] || '');
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = signedHeaders(body, timestamp)['X-Sync-Signature'];
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

let running = null;
async function syncWithPeer() {
  if (!CONVERSATION_SYNC_PEER || !CONVERSATION_SYNC_SECRET) return { skipped: true };
  if (running) return running;
  running = (async () => {
    const users = db.prepare("SELECT DISTINCT u.id,u.username FROM users u JOIN user_data d ON d.user_id=u.id WHERE d.key='conversations'").all();
    for (const user of users) {
      const body = JSON.stringify({ username: user.username, ...readSnapshot(user.id) });
      const response = await fetch(CONVERSATION_SYNC_PEER, {
        method: 'POST', headers: signedHeaders(body, Date.now()), body,
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('peer HTTP ' + response.status);
      const remote = await response.json();
      mergeForUser(user.id, remote);
    }
    return { users: users.length };
  })().finally(() => { running = null; });
  return running;
}

function schedulePeerSync() {
  if (!CONVERSATION_SYNC_PEER || !CONVERSATION_SYNC_SECRET) return;
  syncWithPeer().catch(error => logger.warn('conversation peer sync failed: ' + error.message));
}

module.exports = { readSnapshot, mergeForUser, deleteForUser, signedHeaders, validSignature, schedulePeerSync, syncWithPeer };
