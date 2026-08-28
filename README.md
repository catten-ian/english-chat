# AI 英语对话教练

一个多角色、多功能的 AI 英语沉浸式对话练习平台。**登录后进入首页，6 大功能模块独立选择**：Chat 对话、Reading 阅读、Practice 复习、Writing 写作、Translation 翻译、Game 猜词（含 Charade/Cloze/Wordle）。支持智能评分反馈、划词翻译、生词本、薄弱点追踪、Anki 集成、语音朗读和多模态作文评分。

## 功能概要

- **首页 + 6 大功能模块**：登录后显示首页，按需进入 Chat / Reading / Practice / Writing / Translation / Game（Game 内含 Charade / Cloze / Wordle）任意模块
- **AI 角色对话**：4 个内置角色（Alex/Emma/Sakura/Mateo） + 自定义角色（Chat 模块）
- **智能评分系统**：每次回复自动获取语法、表达、搭配、风格四维度评分
- **多 Agent 架构**：策略师（风格分析）+ 执行者（联网搜索研究）
- **划词翻译**：点击单词或拖选短语/句子，流式翻译带增量渲染（Chat / Reading 模块）
- **词典/翻译工具**：英汉词典、中译英（多级别）、句子分析、英语提问（Chat 模块右侧面板）
- **高考翻译题库**：内置上海 2020-2024 一二三模 87 套试卷 348 道翻译题（`data/gaokao_translations.json`），每题含 **「词」必用词**（必须使用的英文词，含变式/句首大写约束），支持浏览、单题/整卷推送到 Anki；翻译规则版本可在设置中切换（高考版默认：必用词 + 一句话）
- **阅读模式**：时政精选 / 粘贴文章 / 历史回看，5 色高亮 + 笔记面板 + 一键进入主应用背诵练习（联动 `article-memorizing`）
- **生词本**：一键添加，卡片式管理，支持导出
- **薄弱点追踪**：自动追踪语法错误，间隔复习排程，Anki 联动
- **Anki 集成**：自动将生词、语法纠错、拓展知识和薄弱点题目添加到 Anki，支持浏览器内网页答题复习与复习统计
- **写作模块**：选题（题库 + 自定义）+ 考试类型（高考/考研/CET-4/6/IELTS/TOEFL/GRE）+ AI 多模态评分
- **翻译模块**：题库 + AI 出题（中→英），AI 评分 + 改进建议（有参考答案的题同时显示参考答案 + AI译文，无答案的只显示 AI译文）
- **作答框内联标注**：作文/翻译提交评分后，直接在作答文本上标注（正确=绿、错误=红、表达不地道=黄），悬停查看中文说明，可一键「返回编辑」；作答框默认左右留出较大边缘间距，内容变长后自动缩短留白以容纳更多文字
- **作答字体设置**：设置面板可调整作答框（作文/翻译/描述）的字体大小与字体样式（无衬线/衬线/等宽/手写/花体）
- **记住当前模式**：进入某功能模块后刷新页面不会回到首页，自动恢复上次所在模式（含 Game 子页签）
- **猜词模块**：题库 + AI 出词（英文），用户用英文描述，AI 评分
- **背景音乐**：顶部导航栏 🎵 按钮，单击播放/暂停、双击下一首、滚轮调音量；设置面板有独立音乐栏目（启用、自动下一首、曲目、音量、上下曲）；把音频放进 `music/` 即可
- **语音朗读**：ElevenLabs TTS 朗读每条回复，支持自动朗读
- **多用户登录**：PBKDF2 密码哈希，数据按账户隔离
- **版本树对话**：编辑消息保留旧版本，可切换查看
- **数据备份**：SQLite 快照自动备份 + 手动备份；按 2分钟/5分钟/10分钟/1小时/1天/2天/3天/7天/30天节点分层保留

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 纯 HTML + CSS + JavaScript（无构建） |
| 后端 | Node.js 标准库 HTTP 服务器（`node:http` + `node:sqlite`） |
| 数据库 | SQLite（WAL 模式，按用户隔离） |
| AI 对话 | MiniMax-M3（流式/非流式） |
| 语音 | ElevenLabs TTS |
| 搜索 | MiniMax 搜索 API |
| 卡片 | AnkiConnect（本地插件） |
| 数学 | KaTeX（本地 vendored，`vendor/katex`） |

## 快速启动

```bash
cd ai-english-chat
node server.js          # http://localhost:8091
```

或双击 `ai-english-chat/start.bat`。

> 需要在 `ai-english-chat/.env` 中配置 `MINIMAX_API_KEY` 和 `ELEVEN_API_KEY` 才能使用 AI 对话和语音朗读功能。

### 默认账户

| 用户名 | 密码 |
|---|---|
| `test` | `test` |
| `catten` | `catten` |

可用 `scripts/manage_users.py` 增删改查用户（从工作区根目录运行 `python scripts\manage_users.py ...`，即 `article-memorizing/` 下）。

> 首次使用请尽快修改默认账户密码：设置面板 → 「🔑 修改密码」。

## 项目结构

```
ai-english-chat/
├── index.html           # 主页面
├── server.js            # 后端服务（端口 8091，需要 Node 22.5+）
├── start.bat            # 启动脚本
├── .env                 # 密钥（gitignored）
├── css/
│   └── style.css        # 样式
├── js/
│   ├── app.js           # 主应用逻辑（7600+ 行）
│   ├── config.js        # 角色卡、配置常量（不含密钥）
│   └── storage.js       # 存储层（登录 + SQLite 读写 + 本地缓存隔离）
├── vendor/
│   └── katex/           # KaTeX 数学渲染
├── music/               # 背景音乐目录（放入音频文件即可播放，gitignored）
├── data/
│   ├── app.db           # SQLite 数据库（gitignored）
│   └── backups/         # 数据库快照备份
└── scripts/
    └── manage_users.py  # 用户管理脚本（位于工作区根目录 scripts/，即 ai-english-chat 的上一级）
```

## 详细操作指南

查看 [WIKI.md](./WIKI.md) 获取完整功能说明与操作指引。

代码审查与修复记录见 [docs/audit-2026-08.md](./docs/audit-2026-08.md)（含已修问题、跳过项、遗留项与后续路线）。

## 安全

- 后端仅绑定 `127.0.0.1`，局域网不可达
- 静态文件白名单：只服务 `index.html` + `/css/*` + `/js/*` + `/vendor/*` + `/music/*`
- 所有 `/api/*` 接口（除登录/健康检查/音乐列表）需 `Authorization: Bearer <token>`
- 密码 PBKDF2 哈希，会话 30 天有效期；修改密码会撤销该账户除当前会话外的所有会话
- `/api/db/*` 服务端强校验：必须是合法 JSON 且顶层类型符合该 key 约定
- 数据按用户 ID 隔离存储，本地缓存带账户归属标记，切换账户自动清空
- 密钥仅存在于服务器端 `.env`，前端不暴露
