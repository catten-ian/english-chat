/* ============================================================
   AI 英语对话教练 - 用量与隐私路由（server/routes/usage.js）
   GET    /api/usage          用量汇总（?days=30）
   DELETE /api/usage          清除本账户的用量记录
   GET    /api/privacy        隐私说明：外部依赖 + 本地数据清单（静态自述）
   ============================================================ */
'use strict';

const { sendJson } = require('../helpers');
const { getUsageSummary, clearUsage } = require('../services/usage');
const { MINIMAX_KEY, ELEVEN_KEY, MINIMAX_BASE, BACKUP_INTERVAL_MIN } = require('../config');

function usageGet(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const days = url.searchParams.get('days');
  try {
    sendJson(res, 200, getUsageSummary(req.uid, days), req);
  } catch (e) {
    sendJson(res, 500, { error: 'usage query failed', detail: e.message }, req);
  }
}

function usageClear(req, res) {
  const removed = clearUsage(req.uid);
  sendJson(res, 200, { status: 'cleared', removed }, req);
}

/* 隐私自述：把「数据发给了谁、存在哪」讲清楚。
   这里返回的是服务端事实（哪些 key 已配置、上游地址、数据文件位置），
   不含任何密钥值。 */
function privacyGet(req, res) {
  sendJson(res, 200, {
    external: [
      {
        name: 'MiniMax',
        configured: !!MINIMAX_KEY(),
        base: MINIMAX_BASE(),
        purpose: '对话生成、评分分析、出题、划词翻译、联网搜索',
        sends: ['对话消息与你的输入文本', '（联网时）搜索关键词'],
        note: '密钥只在服务端 .env，前端不可见；请求由本机后端转发'
      },
      {
        name: 'ElevenLabs',
        configured: !!ELEVEN_KEY(),
        base: 'https://api.elevenlabs.io',
        purpose: '语音朗读（TTS）与 Anki 卡片音频',
        sends: ['需要朗读的文本'],
        note: '按字符计费；不朗读时不会调用'
      },
      {
        name: 'AnkiConnect',
        configured: true,
        base: 'http://127.0.0.1:8765',
        purpose: '卡片推送与复习排程',
        sends: ['卡片正/反面内容与标签'],
        note: '完全本机通信，不出网；action 有白名单，牌组限本账户'
      }
    ],
    localData: [
      { what: '账户、对话、生词、薄弱点、设置、Anki 任务队列', where: 'data/app.db（SQLite，按 user_id 隔离）' },
      { what: '数据库快照备份', where: 'data/backups/*.db' + (BACKUP_INTERVAL_MIN ? `（服务端每 ${BACKUP_INTERVAL_MIN} 分钟一次）` : '（服务端定时备份已关闭）') },
      { what: '请求日志（方法/路径/状态/耗时，不含请求体）', where: 'data/logs/server.log' },
      { what: '用量记账（token 数与字符数，不含任何文本内容）', where: 'data/app.db → usage_log 表' },
      { what: '浏览器本地缓存（对话/生词/设置镜像）', where: 'localStorage（切换账户时自动清空）' }
    ],
    guarantees: [
      '服务端只绑定 127.0.0.1，局域网内其它机器无法访问',
      '会话 token 只以 SHA-256 形式落库，数据库泄露也无法直接冒充登录',
      '用量记账只存数字与元信息，不存 prompt、回复、音频或搜索词',
      '静态资源为白名单服务：.env、data/、config.json 一律 404'
    ]
  }, req);
}

module.exports = { usageGet, usageClear, privacyGet };
