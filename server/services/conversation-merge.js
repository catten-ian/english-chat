'use strict';

function validMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function validId(id) {
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
}

function validateSnapshot(snapshot) {
  if (!snapshot || !validMap(snapshot.conversations) || !validMap(snapshot.deleted)) return false;
  for (const [id, conv] of Object.entries(snapshot.conversations)) {
    if (!validId(id) || !conv || conv.id !== id || !Array.isArray(conv.messages)) return false;
  }
  for (const [id, at] of Object.entries(snapshot.deleted)) {
    if (!validId(id) || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return false;
  }
  return true;
}

function ownVariant(variant) {
  const { next, ...fields } = variant;
  return JSON.stringify(fields);
}

function mergeNodes(left, right, preferRight) {
  const result = left.map(node => structuredClone(node));
  for (const node of right) {
    const existing = result.find(item => item.id && item.id === node.id);
    if (!existing) { result.push(structuredClone(node)); continue; }
    if (existing.role !== node.role) throw new Error('conflicting message role');
    if (!Array.isArray(existing.variants) || !Array.isArray(node.variants)) {
      if (preferRight) Object.assign(existing, structuredClone(node));
      continue;
    }
    const active = node.variants[node.activeVariant || 0];
    for (const variant of node.variants) {
      const peer = existing.variants.find(item => ownVariant(item) === ownVariant(variant));
      if (peer) peer.next = mergeNodes(peer.next || [], variant.next || [], preferRight);
      else existing.variants.push(structuredClone(variant));
    }
    if (preferRight && active) {
      existing.activeVariant = existing.variants.findIndex(item => ownVariant(item) === ownVariant(active));
    }
  }
  return result;
}

function hasLegacyMessages(messages) {
  return messages.some(node => !node || !node.id || !Array.isArray(node.variants));
}

function mergeSnapshots(left, right) {
  if (!validateSnapshot(left) || !validateSnapshot(right)) throw new Error('invalid conversation snapshot');
  const deleted = { ...left.deleted };
  for (const [id, at] of Object.entries(right.deleted)) {
    if (!deleted[id] || Date.parse(at) > Date.parse(deleted[id])) deleted[id] = at;
  }
  const conversations = {};
  for (const id of new Set([...Object.keys(left.conversations), ...Object.keys(right.conversations)])) {
    const a = left.conversations[id];
    const b = right.conversations[id];
    const preferRight = !!b && (!a || Date.parse(b.updatedAt || 0) > Date.parse(a.updatedAt || 0));
    const newer = preferRight ? b : a;
    const older = preferRight ? a : b;
    if (!newer || (deleted[id] && Date.parse(deleted[id]) >= Date.parse(newer.updatedAt || 0))) continue;
    conversations[id] = older ? {
      ...structuredClone(newer),
      messages: hasLegacyMessages(older.messages) || hasLegacyMessages(newer.messages)
        ? structuredClone(newer.messages)
        : preferRight
        ? mergeNodes(older.messages, newer.messages, true)
        : mergeNodes(newer.messages, older.messages, false)
    } : structuredClone(newer);
  }
  return { conversations, deleted };
}

module.exports = { mergeSnapshots, validateSnapshot, validId };
