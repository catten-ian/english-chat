/* ============================================================
   AI 英语对话教练 - 背景音乐路由（server/routes/music.js）
   GET /api/music/list  列出 music 目录中的音频文件（本地静态资源，无需鉴权）
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sendJson } = require('../helpers');
const { MUSIC_DIR } = require('../config');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.oga', '.wav', '.webm', '.flac', '.opus', '.aac']);

function musicList(req, res) {
  try {
    const files = fs.readdirSync(MUSIC_DIR)
      .filter(f => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map(f => {
        const stat = fs.statSync(path.join(MUSIC_DIR, f));
        return {
          file: f,
          name: f.replace(/\.[^.]+$/, '').replace(/^\s*\d+[\s._-]+/, '').trim() || f,
          // Changing a source file changes its URL and therefore invalidates
          // the client's immutable local cache entry.
          version: `${Math.trunc(stat.mtimeMs)}-${stat.size}`
        };
      });
    sendJson(res, 200, { files }, req);
  } catch (e) {
    sendJson(res, 500, { error: 'failed', detail: e.message }, req);
  }
}

module.exports = { musicList };
