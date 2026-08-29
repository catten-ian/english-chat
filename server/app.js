/* ============================================================
   AI 英语对话教练 - HTTP 组装（server/app.js）
   - 路由分发（顺序与原 server.js 单体一致，逐条映射到 routes/ 模块）
   - 鉴权门槛：除 health / login / music / 静态外全部需要 Bearer token
   - 生命周期：优雅关闭（SIGINT/SIGTERM/SIGBREAK）+ 定时 WAL checkpoint
   ============================================================ */
'use strict';

const http = require('node:http');

const { corsHeaders, sendJson, readBody } = require('./helpers');
const { MINIMAX_KEY, ELEVEN_KEY, BACKUP_INTERVAL_MIN } = require('./config');
const { db, checkpointWal, pruneSessions } = require('./db');
const { auth, seedUsers } = require('./auth');
const { startBackupScheduler } = require('./services/backup');
const logger = require('./services/logger');

const healthRoutes = require('./routes/health');
const musicRoutes = require('./routes/music');
const authRoutes = require('./routes/auth');
const userDataRoutes = require('./routes/user-data');
const gaokaoRoutes = require('./routes/gaokao');
const backupRoutes = require('./routes/backup');
const proxyRoutes = require('./routes/proxy');
const { serveStatic } = require('./routes/static');

/* 启动数据准备：迁移已在 db.js 完成，这里播种默认账户（幂等） */
seedUsers(db);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;

  // 每个请求一个短 id，贯穿该请求的所有日志行；响应结束时记录路由/状态/耗时
  req.id = logger.newRequestId();
  const t0 = Date.now();
  res.on('finish', () => {
    // API 请求全记；静态资源只记异常（404/500），避免每次刷页面几十条噪音
    if (pathname.startsWith('/api/') || res.statusCode >= 400) {
      const meta = { id: req.id, method, path: pathname, status: res.statusCode, ms: Date.now() - t0 };
      if (req.uid) meta.uid = req.uid;
      const line = `${method} ${pathname} → ${res.statusCode} ${meta.ms}ms`;
      if (res.statusCode >= 500) logger.error(line, meta);
      else logger.info(line, meta);
    }
  });

  if (method === 'OPTIONS') {
    res.writeHead(200, corsHeaders(req));
    res.end();
    return;
  }

  try {
    // Health（无需鉴权；不返回绝对路径，避免泄露本机布局信息）
    if (method === 'GET' && pathname === '/api/health') return healthRoutes.healthGet(req, res);
    // 刷新 Anki 连接缓存
    if (method === 'GET' && pathname === '/api/health/anki') return healthRoutes.healthAnki(req, res);

    // 背景音乐：列出 music 目录中的音频文件（本地静态资源，无需鉴权）
    if (method === 'GET' && pathname === '/api/music/list') return musicRoutes.musicList(req, res);

    // 登录（无需鉴权）
    if (method === 'POST' && pathname === '/api/auth/login') return await authRoutes.login(req, res);

    if (method === 'GET' && !pathname.startsWith('/api/')) {
      serveStatic(res, pathname);
      return;
    }

    // 其余需要鉴权
    const au = auth(req);
    if (!au) { sendJson(res, 401, { error: 'unauthorized' }, req); return; }
    req.uid = au.uid;
    req.username = au.username;

    if (method === 'GET' && pathname === '/api/auth/me') return authRoutes.me(req, res);
    if (method === 'POST' && pathname === '/api/auth/logout') return authRoutes.logout(req, res);
    // 会话管理：查看本账户活跃会话 / 退出其他设备
    if (method === 'GET' && pathname === '/api/auth/sessions') return authRoutes.sessions(req, res);
    if (method === 'POST' && pathname === '/api/auth/revoke-others') return authRoutes.revokeOthers(req, res);
    // 修改密码：校验旧密码 → 换哈希 → 撤销除当前会话外的所有会话
    if (method === 'POST' && pathname === '/api/auth/change-password') return await authRoutes.changePassword(req, res);

    // 用户数据读写
    const dbMatch = pathname.match(/^\/api\/db\/(\w+)$/);
    if (dbMatch) return await userDataRoutes.dbKey(req, res, dbMatch[1]);

    // 高考翻译题库：列出所有试卷（带题数）
    if (method === 'GET' && pathname === '/api/gaokao/exams') return gaokaoRoutes.gaokaoExams(req, res);

    // 高考翻译题库：单张试卷题目（支持 /api/gaokao/exam/:encodedName 或 /api/gaokao/question/:id）
    const gaokaoExamMatch = pathname.match(/^\/api\/gaokao\/exam\/(.+)$/);
    if (method === 'GET' && gaokaoExamMatch) return gaokaoRoutes.gaokaoExam(req, res, gaokaoExamMatch[1]);

    // 单题查询（用于 Anki 推送或详情）
    const gaokaoQMatch = pathname.match(/^\/api\/gaokao\/question\/(\d+)$/);
    if (method === 'GET' && gaokaoQMatch) return gaokaoRoutes.gaokaoQuestion(req, res, gaokaoQMatch[1]);

    // 高考翻译题库：查询该用户已推送到 Anki 的题号列表
    if (method === 'GET' && pathname === '/api/gaokao/pushed') return gaokaoRoutes.gaokaoPushed(req, res);

    // 高考翻译题库：把题目推送到 Anki（直接调 AnkiConnect，复用 ankiCall）
    if (method === 'POST' && pathname === '/api/gaokao/push-to-anki') return await gaokaoRoutes.gaokaoPushToAnki(req, res);

    // 备份（VACUUM INTO）
    if (method === 'POST' && pathname === '/api/backup') return backupRoutes.backup(req, res);

    // MiniMax chat（非流式）
    if (method === 'POST' && pathname === '/api/proxy/chat') return await proxyRoutes.chat(req, res);

    // MiniMax chat（流式 SSE）
    if (method === 'POST' && pathname === '/api/proxy/chat/stream') return await proxyRoutes.chatStream(req, res);

    // MiniMax web search
    if (method === 'POST' && pathname === '/api/proxy/websearch') return await proxyRoutes.websearch(req, res);

    // ElevenLabs TTS
    const ttsMatch = pathname.match(/^\/api\/proxy\/tts\/([\w-]+)$/);
    if (method === 'POST' && ttsMatch) return await proxyRoutes.tts(req, res, ttsMatch[1]);

    // AnkiConnect 代理
    if (method === 'POST' && pathname === '/api/proxy/anki') return await proxyRoutes.ankiProxy(req, res);

    // 静态
    if (method === 'GET') { serveStatic(res, pathname); return; }

    sendJson(res, 404, { error: 'not found' }, req);
  } catch (e) {
    logger.error('请求处理异常: ' + (e && e.message), { id: req.id, method, path: pathname, err: e });
    // SSE 等场景可能已发送响应头，此时再写 JSON 会抛 ERR_HTTP_HEADERS_SENT
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' }, req);
    else if (!res.writableEnded) { try { res.end(); } catch (ee) {} }
  }
});

/* ==================== 生命周期 ==================== */
// 每天清理一次过期会话（unref 避免阻止进程退出）
const sessionTimer = setInterval(pruneSessions, 24 * 60 * 60 * 1000);
if (sessionTimer.unref) sessionTimer.unref();
// 每 60 秒把 WAL 并回主库：应对 Windows 直接关窗口（不触发信号）导致的收尾缺失
const checkpointTimer = setInterval(() => checkpointWal('PASSIVE'), 60 * 1000);
if (checkpointTimer.unref) checkpointTimer.unref();
// 服务端常驻备份：即便浏览器关闭，后端也按间隔生成快照（env AI_EN_BACKUP_INTERVAL_MIN，0=关）
const backupTimer = startBackupScheduler(BACKUP_INTERVAL_MIN);
if (backupTimer) logger.info(`定时备份已启用：每 ${BACKUP_INTERVAL_MIN} 分钟`);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`收到 ${signal}，正在优雅关闭...`);
  clearInterval(sessionTimer);
  clearInterval(checkpointTimer);
  if (backupTimer) clearInterval(backupTimer);
  // 停止接收新连接，等在途请求结束
  server.close(() => {
    finalizeDb();
    logger.info('服务已关闭');
    process.exit(0);
  });
  // 兜底：10 秒内没结束（长连接/SSE 卡住）就强制退出，但仍先收尾数据库
  const force = setTimeout(() => {
    logger.warn('仍有连接未结束，强制退出');
    finalizeDb();
    process.exit(0);
  }, 10000);
  if (force.unref) force.unref();
}

let dbClosed = false;
function finalizeDb() {
  if (dbClosed) return;
  dbClosed = true;
  try {
    // WAL checkpoint：把 -wal 内容并回主库，避免只复制 app.db 时状态不完整
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) { logger.error('checkpoint 失败: ' + e.message, { err: e }); }
  try { db.close(); } catch (e) { logger.error('数据库关闭失败: ' + e.message, { err: e }); }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Windows 下 Ctrl+C 走 SIGINT；SIGBREAK 对应 Ctrl+Break
process.on('SIGBREAK', () => shutdown('SIGBREAK'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection: ' + (reason instanceof Error ? reason.message : String(reason)),
    { err: reason instanceof Error ? reason : null });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException: ' + (err && err.message ? err.message : String(err)), { err });
  // 状态已不可信：收尾数据库后退出，由启动器/用户重启
  finalizeDb();
  process.exit(1);
});

/* 入口：由 server.js 调用。端口支持 argv[2] / PORT / 默认 8091 */
function main() {
  const PORT = Number(process.argv[2] || process.env.PORT || 8091);
  server.listen(PORT, '127.0.0.1', () => {
    logger.info(`Server: http://localhost:${PORT}  (127.0.0.1 only)`);
    logger.info(`DB: ${require('./config').DB_PATH}  (schema v${require('./migrations').SCHEMA_VERSION})`);
    logger.info(`MiniMax key: ${MINIMAX_KEY ? 'set' : 'MISSING'} | ElevenLabs key: ${ELEVEN_KEY ? 'set' : 'MISSING'}`);
    logger.info('Press Ctrl+C to stop');
  });
  server.on('error', (e) => { logger.error('Server error: ' + e.message, { err: e }); process.exit(1); });
}

module.exports = { main, server };