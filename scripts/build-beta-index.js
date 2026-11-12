'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildMountedIndex } = require('./build-dev-index');

if (require.main === module) {
  const destination = process.argv[2];
  if (!destination) throw new Error('Pass an output HTML path outside the stable checkout');
  const root = path.join(__dirname, '..');
  fs.writeFileSync(destination, buildMountedIndex(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), '/english-beta/', root));
}

module.exports = { buildBetaIndex: (html, root) => buildMountedIndex(html, '/english-beta/', root) };
