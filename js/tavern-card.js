/* Tavern Character Card V1/V2 + Worldbook helpers.
 * Browser-safe and dependency-free. The CommonJS export is used by tests only. */
(function (root) {
  'use strict';

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function asObject(value) {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (_) { return null; }
    }
    return value && typeof value === 'object' ? value : null;
  }

  function unwrap(value) {
    const obj = asObject(value) || {};
    if (obj.data && typeof obj.data === 'object' && (obj.data.name || obj.data.description || obj.data.first_mes)) {
      return { card: obj.data, root: obj };
    }
    return { card: obj, root: obj };
  }

  function safeId(name) {
    const slug = text(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
    return 'tavern_' + (slug || 'character');
  }

  function normalizeEntries(source) {
    let list = source;
    if (!list) return [];
    if (list.entries && typeof list.entries === 'object') list = list.entries;
    if (!Array.isArray(list) && typeof list === 'object') {
      list = Object.keys(list).map(key => ({ ...list[key], uid: list[key] && list[key].uid != null ? list[key].uid : key }));
    }
    if (!Array.isArray(list)) return [];
    return list.map((entry, index) => {
      const e = entry && typeof entry === 'object' ? entry : {};
      const rawKeys = e.key != null ? e.key : e.keys;
      const rawSecondary = e.keysecondary != null ? e.keysecondary : e.secondary_keys;
      const keys = Array.isArray(rawKeys) ? rawKeys.map(text).filter(Boolean) : text(rawKeys).split(',').map(x => x.trim()).filter(Boolean);
      const secondary = Array.isArray(rawSecondary) ? rawSecondary.map(text).filter(Boolean) : text(rawSecondary).split(',').map(x => x.trim()).filter(Boolean);
      return {
        uid: e.uid != null ? String(e.uid) : String(index),
        key: keys,
        keysecondary: secondary,
        content: text(e.content),
        comment: text(e.comment || e.name),
        constant: e.constant === true,
        selective: e.selective === true,
        enabled: e.enabled !== false,
        position: text(e.position || 'before_char'),
        depth: Number.isFinite(Number(e.depth)) ? Number(e.depth) : 4,
        order: Number.isFinite(Number(e.insertion_order)) ? Number(e.insertion_order) : (Number.isFinite(Number(e.order)) ? Number(e.order) : 0),
        probability: Number.isFinite(Number(e.probability)) ? Number(e.probability) : 100
      };
    }).filter(e => e.content);
  }

  function findWorldbook(root, card) {
    const ext = card.extensions || root.extensions || {};
    return card.worldbook || card.world_info || card.worldInfo || card.lorebook ||
      root.worldbook || root.world_info || root.worldInfo || root.lorebook ||
      root.entries ||
      ext.worldbook || ext.world_info || ext.worldInfo || ext.lorebook ||
      (ext.tavern && (ext.tavern.worldbook || ext.tavern.world_info));
  }

  function normalize(value) {
    const input = asObject(value);
    if (!input) throw new TypeError('Tavern card must be a JSON object');
    const unwrapped = unwrap(input);
    const c = unwrapped.card;
    const root = unwrapped.root;
    const name = text(c.name || c.char_name || c.character_name) || (root.entries ? 'Imported worldbook' : 'Imported character');
    const personality = text(c.personality);
    const scenario = text(c.scenario);
    const description = text(c.description || c.persona || c.personality);
    const worldbook = normalizeEntries(findWorldbook(root, c));
    const card = {
      spec: text(root.spec || c.spec || (root.data ? 'chara_card_v2' : 'chara_card_v1')),
      spec_version: text(root.spec_version || c.spec_version || ''),
      name,
      description,
      personality,
      scenario,
      first_mes: text(c.first_mes || c.greeting || c.first_message),
      mes_example: text(c.mes_example || c.example_dialogue || c.example_dialogs),
      creator_notes: text(c.creator_notes),
      system_prompt: text(c.system_prompt),
      post_history_instructions: text(c.post_history_instructions),
      alternate_greetings: Array.isArray(c.alternate_greetings) ? c.alternate_greetings.map(text).filter(Boolean) : [],
      tags: Array.isArray(c.tags) ? c.tags.map(text).filter(Boolean) : [],
      creator: text(c.creator),
      character_version: text(c.character_version),
      worldbook
    };
    const personalityParts = personality ? personality.split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 12) : [];
    return {
      id: safeId(name), name, fullName: name, nationality: '', city: '', age: 0,
      occupation: '', personality: personalityParts, interests: [], family: '',
      mannerisms: description, pet: '', backstorySeed: scenario || description,
      avatar: text(c.avatar || root.avatar || '🎭'), tavernCard: card, worldbook,
      source: 'tavern'
    };
  }

  function prompt(cardOrCharacter) {
    const card = cardOrCharacter && cardOrCharacter.tavernCard;
    if (!card) return '';
    const lines = ['[TAVERN CHARACTER CARD]', 'Character: ' + card.name];
    if (card.description) lines.push('Description/Persona: ' + card.description);
    if (card.personality) lines.push('Personality: ' + card.personality);
    if (card.scenario) lines.push('Scenario: ' + card.scenario);
    if (card.system_prompt) lines.push('Author system direction: ' + card.system_prompt);
    if (card.post_history_instructions) lines.push('Post-history direction: ' + card.post_history_instructions);
    if (card.first_mes) lines.push('Opening tone (do not quote verbatim unless natural): ' + card.first_mes);
    if (card.alternate_greetings && card.alternate_greetings.length) lines.push('Alternate opening tones: ' + card.alternate_greetings.join(' | '));
    if (card.mes_example) lines.push('Example dialogue (match its tone, do not copy it): ' + card.mes_example);
    if (card.creator_notes) lines.push('Creator notes: ' + card.creator_notes);
    return lines.join('\n');
  }

  function worldPrompt(cardOrCharacter, userText) {
    const entries = cardOrCharacter && (cardOrCharacter.worldbook || (cardOrCharacter.tavernCard && cardOrCharacter.tavernCard.worldbook));
    if (!Array.isArray(entries) || !entries.length) return '';
    const haystack = text(userText).toLowerCase();
    const matched = entries.filter(entry => {
      if (!entry.enabled || entry.probability <= 0) return false;
      if (entry.constant) return true;
      const primary = entry.key.some(k => haystack.includes(String(k).toLowerCase()));
      if (!primary) return false;
      const secondary = entry.keysecondary || [];
      return !entry.selective || !secondary.length || secondary.some(k => haystack.includes(String(k).toLowerCase()));
    })
      .sort((a, b) => b.order - a.order).slice(0, 8);
    if (!matched.length) return '';
    return '[TAVERN WORLDBOOK CONTEXT]\n' + matched.map(e => '- ' + (e.comment ? e.comment + ': ' : '') + e.content).join('\n');
  }

  function decodePngText(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error('不是有效的 PNG 文件');
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('latin1') : null;
    function decodeBase64Json(encoded) {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const utf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(bytes) : binary;
      return JSON.parse(utf8);
    }
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 0 || offset + length + 12 > bytes.length) break;
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === 'tEXt') {
        const nul = data.indexOf(0);
        if (nul > 0 && decoder && decoder.decode(data.subarray(0, nul)).toLowerCase() === 'chara') {
          return decodeBase64Json(decoder.decode(data.subarray(nul + 1)));
        }
      } else if (type === 'iTXt') {
        const raw = decoder ? decoder.decode(data) : '';
        if (raw.toLowerCase().startsWith('chara\u0000')) {
          const parts = raw.split('\u0000');
          return decodeBase64Json(parts[5] || '');
        }
      }
      offset += length + 12;
    }
    throw new Error('PNG 中未找到 Tavern chara 数据');
  }

  const api = { normalize, prompt, worldPrompt, decodePngText, normalizeEntries, safeId };
  root.TavernCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
