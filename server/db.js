/* ============================================================
   AI 英语对话教练 - 数据库模块（server/db.js）
   - SQLite（node:sqlite, WAL），按用户隔离
   - 打开连接 + PRAGMA → 执行 schema 迁移 → 播种基础数据
   - 提供周期性 WAL checkpoint / 过期会话清理 / 题库导入
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, DB_PATH } = require('./config');
const { runMigrations } = require('./migrations');
const logger = require('./services/logger');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// 与外部工具（manage_users.py / 备份脚本）并发写时等待锁而不是立刻 SQLITE_BUSY
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA synchronous = NORMAL');

runMigrations(db);

/* 周期性 WAL checkpoint。
   不能只依赖优雅关闭时的 checkpoint：Windows 上直接关闭控制台窗口
   （或任务管理器结束进程）走的是 TerminateProcess，不触发 SIGINT/SIGTERM，
   收尾代码根本不会执行。若不定期并回主库，-wal 会持续增长，
   且「只复制 app.db」得到的会是过旧的状态。
   PASSIVE 模式不会阻塞读写，拿不到锁就跳过，下次再来。 */
function checkpointWal(mode) {
  try {
    db.exec(`PRAGMA wal_checkpoint(${mode || 'PASSIVE'})`);
  } catch (e) {
    logger.error('wal_checkpoint 失败: ' + e.message, { err: e });
  }
}

/* 清理过期会话（启动时 + 每天一次），避免 sessions 表与备份无限增长 */
function pruneSessions() {
  try {
    const r = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    const n = Number(r.changes || 0);
    if (n) logger.info(`清理过期会话 ${n} 条`);
  } catch (e) { logger.error('清理过期会话失败: ' + e.message, { err: e }); }
}
pruneSessions();

// 启动时若 gaokao_questions 为空，从 data/gaokao_translations.json 导入
(function seedGaokao() {
  try {
    const fp = path.join(DATA_DIR, 'gaokao_translations.json');
    if (!fs.existsSync(fp)) { logger.warn('gaokao_translations.json 不存在，跳过题库初始化'); return; }
    // 先读取并解析源文件；解析失败直接中止，绝不能先清空旧库
    const raw = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('题库 JSON 结构异常：应为数组');

    const cnt = db.prepare('SELECT COUNT(*) AS c FROM gaokao_questions').get().c;
    // 若库已有数据且含「词」字段，视为已导入，跳过（避免每次启动重复导入）
    const wordsCount = db.prepare("SELECT COUNT(*) AS c FROM gaokao_questions WHERE q_words IS NOT NULL AND q_words != ''").get().c;
    if (cnt > 0 && wordsCount > 0) return;

    // 需要导入 / 重建：把 DELETE 放进与 INSERT 同一个事务，JSON 解析失败时旧数据不受影响
    const insert = db.prepare('INSERT INTO gaokao_questions (exam, q_no, q_text, a_text, q_words, source_file, exam_year) VALUES (?,?,?,?,?,?,?)');
    const count = { exams: 0, questions: 0 };
    db.exec('BEGIN');
    try {
      if (cnt > 0) {
        logger.info('旧数据缺少「词」字段，清表重建...');
        db.exec('DELETE FROM gaokao_questions');
      }
      for (const exam of data) {
        const examName = exam['试卷'] || '';
        const sourceFile = exam['原卷文件'] || '';
        // 从试卷名推断年份（例如 "2022届"）
        const m = examName.match(/(\d{4})届/);
        const year = m ? m[1] : '';
        const questions = exam['翻译题'] || {};
        if (typeof questions !== 'object' || questions === null) continue;
        count.exams++;
        for (const [key, q] of Object.entries(questions)) {
          if (!q || typeof q !== 'object') continue;
          // 解析「词」数组 → JSON 字符串（允许词中含引号）
          let wordsJson = '';
          if (Array.isArray(q['词'])) {
            const cleaned = q['词'].map(w => String(w || '').trim()).filter(Boolean);
            if (cleaned.length) wordsJson = JSON.stringify(cleaned);
          }
          insert.run(examName, String(q['题号'] || key), (q['句子'] || q['题目'] || ''), q['答案'] || '', wordsJson, sourceFile, year);
          count.questions++;
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const total = db.prepare('SELECT COUNT(*) AS c FROM gaokao_questions').get().c;
    logger.info(`题库初始化完成：导入 ${count.exams} 套试卷，共 ${count.questions} 道题（库内 ${total}）`);
  } catch (e) {
    logger.error('题库初始化失败（旧数据未受影响）: ' + e.message, { err: e });
  }
})();

/* 「词」字段：JSON 字符串 → 数组 */
function parseWords(s) {
  if (!s) return [];
  try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr : []; }
  catch (e) { return []; }
}

// 启动完整性检查的正常路径下，migrations 已兜底（migrations.runMigrations 内校验）
// 对外暴露 runMigrations 便于测试复用；schema 校验失败在迁移阶段即终止。

module.exports = { db, checkpointWal, pruneSessions, parseWords, runMigrations };