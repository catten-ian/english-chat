/* ============================================================
   AI 英语对话教练 - .env 文件操作（server/services/envfile.js）

   供「服务与密钥」功能使用：读取 / 原子写入 / 掩码。
   独立成模块是为了可直接单测，不依赖 config 的全局状态。
   ============================================================ */
'use strict';

const fs = require('node:fs');

/* e8f3…9a2b 短掩码：足以辨认是哪把 key，不足以还原 */
function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

/* 读取 .env 的原始行（保留注释与顺序；文件不存在返回空数组） */
function readEnvLines(envFile) {
  try {
    return fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  } catch (e) { return []; }
}

/* 把 KEY=value 原子写进 envFile：
   - 已有该 KEY 行 → 原位替换（保留注释与其他行）
   - 没有 → 追加到末尾
   先写临时文件再 rename，中途失败不会破坏原文件。 */
function writeEnvKey(envFile, envKey, value) {
  const lines = readEnvLines(envFile);
  const re = new RegExp('^\\s*' + envKey + '\\s*=');
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { lines[i] = envKey + '=' + value; replaced = true; break; }
  }
  if (!replaced) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(envKey + '=' + value);
  }
  const tmp = envFile + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, lines.join('\n'), 'utf8');
  fs.renameSync(tmp, envFile);
}

/* 从 .env 读某个 key 的当前值（不存在返回 null） */
function readEnvValue(envFile, envKey) {
  const re = new RegExp('^\\s*' + envKey + '\\s*=(.*)$');
  for (const line of readEnvLines(envFile)) {
    const m = line.match(re);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

module.exports = { maskKey, readEnvLines, writeEnvKey, readEnvValue };
