#!/usr/bin/env node
/* 语法检查：server.js + js/ 下所有前端脚本（含 js/app/ 拆分切片）。
   用 node --check 逐个校验，不需要任何第三方依赖。
   通配符由本脚本自己展开，避免 npm script 里跨平台的 shell 差异。 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function collect() {
  const files = [path.join(ROOT, 'server.js')];

  // 后端拆分后的 server/ 目录（含 services/、routes/ 子目录）
  const serverDir = path.join(ROOT, 'server');
  if (fs.existsSync(serverDir)) {
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir).sort()) {
        const abs = path.join(dir, f);
        const st = fs.statSync(abs);
        if (st.isDirectory()) walk(abs);
        else if (f.endsWith('.js')) files.push(abs);
      }
    };
    walk(serverDir);
  }

  const jsDir = path.join(ROOT, 'js');
  for (const f of fs.readdirSync(jsDir)) {
    if (f.endsWith('.js')) files.push(path.join(jsDir, f));
  }

  // app.js 拆分后的切片
  const partsDir = path.join(jsDir, 'app');
  if (fs.existsSync(partsDir)) {
    for (const f of fs.readdirSync(partsDir).sort()) {
      if (f.endsWith('.js')) files.push(path.join(partsDir, f));
    }
  }

  // 测试与脚本本身也一并检查
  for (const dir of ['test', 'scripts']) {
    const d = path.join(ROOT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.js')) files.push(path.join(d, f));
    }
  }
  return files;
}

const files = collect();
let failed = 0;

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log(`  ok   ${rel}`);
  } catch (e) {
    failed++;
    const msg = (e.stderr || Buffer.from('')).toString().split('\n').slice(0, 6).join('\n');
    console.error(`  FAIL ${rel}\n${msg}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} 个文件语法检查通过`);
process.exit(failed ? 1 : 0);
