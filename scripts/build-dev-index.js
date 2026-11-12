'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Only the deployment artifact gets the public mount; local index stays relative.
function buildMountedIndex(html, mountPath, root = path.join(__dirname, '..')) {
  if (!/^\/[a-z0-9-]+\/$/.test(mountPath)) throw new Error('Invalid public mount path');
  if (!/<base href="(?:\.\/|\/english-(?:dev|beta)\/)"\s*>/.test(html)) throw new Error('Missing public base marker');
  return html.replace(/<base href="(?:\.\/|\/english-(?:dev|beta)\/)"\s*>/, `<base href="${mountPath}">`)
    .replace(/((?:src|href)=")([^"?]+)\?v=[^"\s]+/g, (match, prefix, file) => {
      const absolute = path.resolve(root, file);
      if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('Asset outside build root');
      const revision = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex').slice(0, 16);
      return prefix + file + '?v=' + revision;
    });
}

function buildDevIndex(html, root = path.join(__dirname, '..')) {
  return buildMountedIndex(html, '/english-dev/', root);
}

if (require.main === module) {
  const destination = process.argv[2];
  if (!destination) throw new Error('Pass an output HTML path outside the stable checkout');
  fs.writeFileSync(destination, buildDevIndex(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')));
}
module.exports = { buildDevIndex, buildMountedIndex };
