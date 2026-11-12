'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

test('outer resident channel streams via game API only, shares feedback and restores normal chat', async () => {
  const { document, window } = parseHTML('<html><body><div id="chatArea"><div id="messages">Normal chat stays intact</div><div class="input-area" style="display:flex"><textarea id="userInput"></textarea></div></div></body></html>');
  let token = 'owner-one', available = true, history = [], records = [];
  const calls = [];
  const state = () => ({ stageId: 'low-tide', continuation: { available, npcId: 'eli', name: 'Eli Turner', history, reason: 'Return to the resident.' }, feedback: { records, summaries: [] } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/world-game.js'), 'utf8'), {
    document, window, Element: window.Element, URL, AbortController, AbortSignal, TextDecoder,
    crypto: { randomUUID: () => 'outer-turn-id' },
    location: { href: 'https://www.catten.cyou/english?version=beta', assign() { assert.fail('should not navigate'); } },
    BACKEND_URL: '/api-beta', authHeaders: () => ({ Authorization: 'Bearer ' + token }),
    llmPreference: () => ({ provider: 'aihub8', textModel: 'gpt-6.1-terra' }),
    setTimeout: () => ({}), clearTimeout() {},
    async fetch(url, options) {
      calls.push({ url, options });
      let data = url.endsWith('/state') ? state() : { records, summaries: [] };
      if (url.endsWith('/npc')) {
        const body = JSON.parse(options.body);
        assert.equal(body.channel, 'english-chat'); assert.equal(body.npcId, 'eli');
        assert.equal(body.provider, 'aihub8'); assert.equal(body.model, 'gpt-6.1-terra');
        assert.equal(Object.hasOwn(body, 'messages'), false); assert.equal(Object.hasOwn(body, 'history'), false);
        let step = 0;
        history = [{ role: 'user', content: body.text }, { role: 'assistant', content: 'The lens was intact.' }];
        records = [{ id: 'feedback-1', stageId: 'low-tide', npcName: 'Eli Turner', text: body.text, status: 'ready', feedback: 'A natural question.' }];
        return { ok: true, body: { getReader: () => ({ async read() { return ++step === 1 ? { done: false, value: Buffer.from('data: {"choices":[{"delta":{"content":"The lens was intact."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') } : { done: true }; } }) } };
      }
      return { ok: true, json: async () => data };
    }
  });
  const selector = document.querySelector('#bellweather-chat-channel');
  selector.querySelector('option[value="normal"]').removeAttribute('selected'); selector.querySelector('option[value="resident"]').setAttribute('selected', ''); selector.dispatchEvent(new window.Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.querySelector('#messages').style.display, 'none');
  const form = document.querySelector('#bellweather-chat-panel form');
  form.querySelector('textarea').value = 'What did you check?'; form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(document.querySelector('#bellweather-chat-panel').textContent, /The lens was intact/);
  assert.match(document.querySelector('#bellweather-chat-panel details').textContent, /A natural question/);
  assert.equal(document.querySelector('#bellweather-chat-panel details').open || false, false);
  assert.equal(calls.every(call => call.url.startsWith('/api-beta/api/world-game/')), true, 'normal proxy, Tavern books and essay feedback never enter resident requests');
  token = 'owner-two'; history = []; records = []; available = false;
  window.dispatchEvent(new window.Event('focus')); await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(document.querySelector('#bellweather-chat-panel').textContent, /The lens was intact|A natural question/);
  assert.equal(form.querySelector('button[type="submit"]').disabled, true);
  selector.querySelector('option[value="resident"]').removeAttribute('selected'); selector.querySelector('option[value="normal"]').setAttribute('selected', ''); selector.dispatchEvent(new window.Event('change'));
  assert.equal(document.querySelector('#messages').textContent, 'Normal chat stays intact');
  assert.equal(document.querySelector('.input-area').style.display, 'flex');
  assert.equal(document.querySelector('#bellweather-chat-panel').hidden, true);
  window.dispatchEvent(new window.Event('pagehide'));
});
