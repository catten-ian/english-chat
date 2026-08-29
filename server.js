#!/usr/bin/env node
/* ============================================================
   AI 英语对话教练 - Backend Server 入口（server.js）
   ------------------------------------------------------------
   真正的实现已拆分到 server/ 目录（零依赖，Node 22.5+）：
     server/config.js      路径 / 常量 / env 密钥 / 白名单定义
     server/db.js          SQLite 连接 + WAL + 题库播种
     server/migrations.js  schema 版本迁移（PRAGMA user_version）
     server/auth.js        密码哈希 / 会话 / 鉴权 / 用户播种
     server/validation.js  user_data 类型校验 + Anki 代理守卫
     server/rate-limit.js  滑动窗口限流框架（默认不启用）
     server/services/      备份 / AnkiConnect / 上游代理
     server/routes/        health / music / auth / user-data /
                           gaokao / backup / proxy / static
     server/helpers.js     CORS / JSON / 请求体读取
     server/app.js         HTTP 组装 + 生命周期 + 监听
   本文件保持可执行入口：node server.js [port]
   兼容 AI_EN_DATA_DIR / AI_EN_DB_PATH 覆盖（测试隔离用）。
   ============================================================ */
'use strict';

require('./server/app').main();