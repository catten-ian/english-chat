'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Only the deployment artifact gets the public mount; local index stays relative.
function buildDevIndex(html, root = path.join(__dirname, '..')) {
  if (!html.includes('<base href="./">') && !html.includes('<base href="/english-dev/">')) throw new Error('Missing dev base marker');
  return html.replace('<base href="./">', '<base href="/english-dev/">')
    .replace(/((?:src|href)=")([^"?]+)\?v=[^"\s]+/g, (match, prefix, file) => {
      const absolute = path.resolve(root, file);
      if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('Asset outside build root');
      const revision = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex').slice(0, 16);
      return prefix + file + '?v=' + revision;
    });
}

if (require.main === module) {
  const destination = process.argv[2];
  if (!destination) throw new Error('Pass an output HTML path outside the stable checkout');
  fs.writeFileSync(destination, buildDevIndex(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')));
}
module.exports = { buildDevIndex };
