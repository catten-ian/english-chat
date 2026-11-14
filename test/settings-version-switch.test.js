'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const settingsPath = path.join(__dirname, '..', 'js', 'app', '12-settings.js');
const settingsSource = fs.readFileSync(settingsPath, 'utf8');
const switchSource = settingsSource.slice(
  settingsSource.indexOf('function settingsVersionSwitchMarkup()'),
  settingsSource.indexOf('function openSettings()')
);

function renderSwitch(version) {
  const sandbox = {
    URLSearchParams,
    location: { search: `?version=${version}` }
  };
  vm.runInNewContext(switchSource + '\nglobalThis.render = settingsVersionSwitchMarkup;', sandbox);
  return sandbox.render();
}

test('settings version switch links all releases and marks the current release', () => {
  const cases = [
    ['dev', '/english/?version=dev'],
    ['stable', '/english/?version=stable'],
    ['old', '/english/?version=old']
  ];
  for (const [current, href] of cases) {
    const markup = renderSwitch(current);
    assert.match(markup, /🧭 版本切换/);
    assert.match(markup, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
    assert.match(markup, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" aria-current="page"`));
    assert.match(markup, /href="\/english\/\?version=dev"/);
    assert.match(markup, /href="\/english\/\?version=stable"/);
    assert.match(markup, /href="\/english\/\?version=old"/);
  }
  assert.match(settingsSource, /\$\{settingsVersionSwitchMarkup\(\)\}/);
  assert.match(settingsSource, /key: 'version-switch'/);
});
