const test = require('node:test');
const assert = require('node:assert/strict');
const TavernCards = require('../js/tavern-card.js');

test('normalizes Tavern V1 cards and preserves dialogue fields', () => {
  const c = TavernCards.normalize({
    name: 'Mira', description: 'A patient astronomer.', personality: 'curious, dry humor',
    scenario: 'We are waiting for a meteor shower.', first_mes: 'You made it!',
    mes_example: '<START>\n{{char}}: Look up.\n{{user}}: Wow.', tags: ['space']
  });
  assert.equal(c.name, 'Mira');
  assert.deepEqual(c.personality, ['curious', 'dry humor']);
  assert.equal(c.tavernCard.first_mes, 'You made it!');
  assert.match(TavernCards.prompt(c), /meteor shower/);
});

test('normalizes V2 data wrapper and object worldbook entries', () => {
  const c = TavernCards.normalize({
    spec: 'chara_card_v2',
    data: {
      name: 'Keeper', description: 'Lives in the old library.',
      worldbook: { entries: {
        one: { key: ['library', 'books'], content: 'The library closes at dusk.', enabled: true },
        two: { key: ['unused'], content: 'Should not be selected.', enabled: true },
        three: { key: [], content: 'Always present.', constant: true }
      } }
    }
  });
  assert.equal(c.tavernCard.spec, 'chara_card_v2');
  assert.equal(c.worldbook.length, 3);
  const prompt = TavernCards.worldPrompt(c, 'Tell me about the library');
  assert.match(prompt, /closes at dusk/);
  assert.match(prompt, /Always present/);
  assert.doesNotMatch(prompt, /Should not be selected/);
});

test('worldbook context is bounded and ignores disabled entries', () => {
  const c = TavernCards.normalize({
    name: 'Bounded', description: 'x', worldbook: [
      { key: ['secret'], content: 'disabled', enabled: false },
      ...Array.from({ length: 12 }, (_, i) => ({ key: ['secret'], content: `entry-${i}`, enabled: true, insertion_order: i }))
    ]
  });
  const prompt = TavernCards.worldPrompt(c, 'secret');
  assert.doesNotMatch(prompt, /disabled/);
  assert.equal((prompt.match(/entry-/g) || []).length, 8);
});

test('selective worldbook entries require a secondary key', () => {
  const c = TavernCards.normalize({
    name: 'Selective', worldbook: [{ key: ['school'], keysecondary: ['exam'], selective: true, content: 'Exam lore.' }]
  });
  assert.equal(TavernCards.worldPrompt(c, 'school lunch'), '');
  assert.match(TavernCards.worldPrompt(c, 'school exam'), /Exam lore/);
});

test('rejects malformed card input', () => {
  assert.throws(() => TavernCards.normalize('{not json}'), /JSON object/);
});

test('reads UTF-8 Tavern JSON from a PNG chara tEXt chunk', () => {
  const payload = Buffer.from(JSON.stringify({ name: '小星', description: '中文角色' }), 'utf8').toString('base64');
  const chunkData = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(payload, 'ascii')]);
  const chunk = Buffer.alloc(12 + chunkData.length);
  chunk.writeUInt32BE(chunkData.length, 0);
  chunk.write('tEXt', 4, 4, 'ascii');
  chunkData.copy(chunk, 8);
  // CRC is intentionally zero: the parser only needs the PNG chunk envelope.
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk]);
  const arrayBuffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
  const parsed = TavernCards.decodePngText(arrayBuffer);
  assert.equal(parsed.name, '小星');
});
