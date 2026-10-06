'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app', '28-reading-exports.js'), 'utf8');

test('reading exports create a real Open XML Word package', () => {
  assert.match(source, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(source, /readingExportZip\(\[/);
  assert.match(source, /word\/document\.xml/);
  assert.match(source, /reading-practice\.docx/);
  assert.doesNotMatch(source, /application\/msword/);
});

test('long-image export keeps foreignObject markup intact and measures detached content', () => {
  assert.match(source, /document\.body\.appendChild\(root\)/);
  assert.match(source, /new XMLSerializer\(\)\.serializeToString\(root\)/);
  assert.doesNotMatch(source, /serializeToString\(root\)\.replace\(\/&\/g/);
  assert.match(source, /root\.style\.visibility = 'visible'/);
  assert.match(source, /image\/svg\+xml/);
});
