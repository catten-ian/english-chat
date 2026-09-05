# AI 英语对话教练

一个多角色、多功能的 AI 英语沉浸式对话练习平台。**登录后进入首页，6 大功能模块独立选择**：Chat 对话、Reading 阅读、学习中心（学习者模型 + 复习 Anki + 成本隐私）、Writing 写作、Translation 翻译、Game 猜词（含 Charade/Cloze/Wordle）。支持智能评分反馈、划词翻译、生词本、薄弱点追踪、Anki 集成、语音朗读和多模态作文评分。

## 功能概要

- **首页 + 6 大功能模块**：登录后显示首页，按需进入 Chat / Reading / 学习中心（Practice）/ Writing / Translation / Game（Game 内含 Charade / Cloze / Wordle）
- **AI 角色对话**：4 个内置角色（Alex/Emma/Sakura/Mateo） + 自定义角色（Chat 模块）
- **智能评分系统**：每次回复自动获取语法、表达、搭配、风格四维度评分
- **多 Agent 架构**：策略师（风格分析）+ 执行者（联网搜索研究）
- **划词翻译**：点击单词或拖选短语/句子，流式翻译带增量渲染（Chat / Reading 模块）
- **词典/翻译工具**：英汉词典、中译英（多级别）、句子分析、英语提问（Chat 模块右侧面板）
- **高考翻译题库**：内置上海 2020-2024 一二三模 87 套试卷 348 道翻译题（`data/gaokao_translations.json`），每题含 **「词」必用词**（必须使用的英文词，含变式/句首大写约束），支持浏览、单题/整卷推送到 Anki；翻译规则版本可在设置中切换（高考版默认：必用词 + 一句话）
- **阅读模式**：时政精选 / 粘贴文章 / 历史回看，5 色高亮 + 笔记面板 + 一键进入主应用背诵练习（联动 `article-memorizing`）
- **生词本**：一键添加，卡片式管理，支持导出
- **薄弱点追踪**：自动追踪语法错误，间隔复习排程，Anki 联动
- **Anki 集成**：自动将生词、语法纠错、拓展知识和薄弱点题目添加到 Anki，支持浏览器内网页答题复习与复习统计；Practice 模式提供 **「一键同步到 Anki」**——把生词本全部生词（词汇默写卡）与全部薄弱点（AI 自动出题，薄弱点问答卡）按当前模式批量补推，按英文单词/每薄弱点题数去重
- **Anki 任务中心**（Practice 模块内）：所有卡片推送先入**持久化队列**（`pending → running → done | failed → dead`）。Anki 没开时任务原地排队且不消耗重试次数，不再像以前那样「弹条 toast 就丢了」。面板显示状态 chips + 任务列表（结果 +N / 跳过数、失败原因、单条重试/删除）+ 批量操作（立即推送 / 重试失败 / 清理完成）；队列同步到 `user_data.anki_tasks`，换浏览器登录后自动补发
- **写作模块**：选题（题库 + 自定义）+ 考试类型（高考/考研/CET-4/6/IELTS/TOEFL/GRE）+ AI 多模态评分
- **翻译模块**：题库 + AI 出题（中→英），AI 评分 + 改进建议（有参考答案的题同时显示参考答案 + AI译文，无答案的只显示 AI译文）
- **作答框内联标注**：作文/翻译提交评分后，直接在作答文本上标注（正确=绿、错误=红、表达不地道=黄），悬停查看中文说明，可一键「返回编辑」；作答框默认左右留出较大边缘间距，内容变长后自动缩短留白以容纳更多文字
- **作答字体设置**：设置面板可调整作答框（作文/翻译/描述）的字体大小与字体样式（无衬线/衬线/等宽/手写/花体）
- **记住当前模式**：进入某功能模块后刷新页面不会回到首页，自动恢复上次所在模式（含 Game 子页签）
- **作答草稿自动保存**：写作/翻译/描述作答框的内容在切换模式时自动保存（含已评分的内联标注状态），切回自动恢复，不再弹确认框打断操作
- **反馈面板随模式重置**：切换模式时右侧反馈面板自动重置为对应模式的引导文案，不会残留上一个模式的评分
- **阅读工具栏随文章显示**：未选择文章时隐藏高亮/笔记/朗读等工具栏，选中文章后才出现
- **首页价值主张**：首页新增产品 tagline 与 CHAT 主推卡片（渐变高亮），突出「实时 AI 反馈 + 内联批注 + Anki 复习 + 多模态评分」
- **猜词模块**：题库 + AI 出词（英文），用户用英文描述，AI 评分
- **背景音乐**：顶部导航栏 🎵 按钮，单击播放/暂停、双击下一首、滚轮调音量（2% 步进）、**悬停展开迷你播放器**（进度拖动、模式切换、上下曲、音量）；三种播放模式（列表循环/单曲循环/随机）；支持系统媒体键、出错自动跳过、刷新后续播；设置面板有可折叠的独立音乐栏目（启用、自动下一首、播放模式、曲目、可拖动进度、音量 1% 精度滑块+数字输入框、上下曲）；把音频放进 `music/` 即可；**多标签页互斥**（同一 profile 开多个页面不会音乐重叠，任一页开始播放会顶掉其它页）
- **语音朗读**：ElevenLabs TTS 朗读每条回复，支持自动朗读
- **多用户登录**：PBKDF2 密码哈希，数据按账户隔离
- **版本树对话**：编辑消息保留旧版本，可切换查看
- **数据备份**：SQLite `VACUUM INTO` 快照，浏览器每 2 分钟触发 + **服务端常驻定时备份**（默认每小时）；每份快照生成后做只读完整性校验（`integrity_check`），坏文件直接删除；按 2分钟/5分钟/10分钟/1小时/1天/2天/3天/7天/30天节点分层保留；支持**异盘副本**与**恢复 CLI**（见下）
- **学习中心**（原 Practice + Progress 合并，三个子页懒加载）：**📈 学习概览**——聚合生词/薄弱点/对话/翻译历史 + Anki 连续天数：统计卡 + Chat 四维均分（0–10 横向条）+ 翻译得分趋势（纯 CSS 柱状图）+ 薄弱点分类分布 + 最近对话；**🎯 复习与 Anki**——本地薄弱点/待复习/生词统计卡 + Anki 牌组统计（近 14 天柱状图、未连接给引导提示）+ 网页复习/一键同步入口 + Anki 任务队列；**💰 成本与隐私**——外部 API 用量记账（MiniMax token / ElevenLabs 字符 / 联网次数）按天/用途/模型聚合 + 可编辑单价估算 + 隐私面板（数据发给了谁/本地存了什么）+ 清除用量。**记账只存数字与元信息，绝不存 prompt、回复、音频或搜索词**（有测试断言 `usage_log` 不含任何文本列）

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
npm start               # 等价于 node server.js，http://localhost:8091
```

或双击 `ai-english-chat/start.bat`（会检查 Node 版本、端口占用，并轮询 `/api/health` 确认就绪后再打开浏览器）。

> ⚠️ `.bat` 文件必须是 **CRLF** 换行。仓库根已加 `.gitattributes`（`*.bat text eol=crlf`）强制 checkout 为 CRLF——LF 换行的 bat 会被 `cmd.exe` 误解析，表现为 `'xxx' 不是内部或外部命令`。脚本内部用 `ping -n` 而非 `timeout` 做延时，因为 `timeout` 需要控制台输入句柄，被重定向或由其它进程调起时会报 `Input redirection is not supported`。

> 需要 **Node 22.5+**（使用内置 `node:sqlite`）。需要在 `ai-english-chat/.env` 中配置 `MINIMAX_API_KEY` 和 `ELEVEN_API_KEY` 才能使用 AI 对话和语音朗读功能。

停止服务请在后端窗口按 `Ctrl+C`：会触发优雅关闭（停止接收新连接 → 等待在途请求 → WAL 并回主库 → 关闭数据库）。

## 测试

```bash
cd ai-english-chat
npm test                # node:test，零依赖，216 个用例（含全量语法检查）
npm run check           # 单独跑语法检查（server.js + server/**/*.js + js/**/*.js + test/ + scripts/）
```

测试全部在临时目录中启动独立服务进程（通过 `AI_EN_DATA_DIR` 注入），**不会读写 `data/app.db` 或 `.env`**，也不调用任何外部 API。

覆盖范围：

| 文件 | 覆盖内容 |
|---|---|
| `test/static-security.test.js` | 路径穿越（20 种变体）、NUL、扩展名白名单、nosniff、**严格 CSP（script-src 'self'）**、health 不泄露路径、index.html 引用的资源可访问 |
| `test/auth.test.js` | 登录/登出、伪造 token、**数据库中不存明文 token**、会话列表、退出其他设备、修改密码全流程 |
| `test/user-data.test.js` | 账户隔离、JSON 与顶层类型校验、损坏数据不覆盖有效数据、chunked 请求体上限 |
| `test/anki-proxy.test.js` | Anki action 白名单、牌组归属（跨用户拒绝）、参数与数量校验、storeMediaFile 文件名约束 |
| `test/schema-backup.test.js` | schema 版本管理与幂等迁移、题库导入原子性（源文件损坏不清空旧库）、备份同秒不冲突、备份可打开 |
| `test/backup-service.test.js` | 备份产物完整性校验、损坏/伪造备份被拒、异盘副本落盘且可校验、定时调度器触发与关闭开关 |
| `test/logger.test.js` | request id 格式、JSONL 落盘（级别/消息/元数据）、Error 序列化、debug 级过滤、大小轮转与保留数、真实进程请求日志（id/路径/状态/耗时） |
| `test/anki-tasks.test.js` | Anki 任务队列：入队与持久化、Anki 离线保 pending（不消耗重试）、重试上限进 dead、quiz 薄弱点已删/AI 失败、未知类型不崩、手动重试/删除/清理、容量裁剪保留 pending |
| `test/usage.test.js` | 用量记账：schema v4 建表、**usage_log 无任何文本列（隐私约束）**、totalTokens 兜底、负数规整、未登录不写库、非流式/SSE usage 解析（含截断流返回 null）、按 provider/kind/model 聚合、账户隔离、days 参数规整、`/api/usage` 与 `/api/privacy` 端到端（含密钥不外泄断言） |
| `test/keys.test.js` | 服务与密钥：掩码规则（长 key 前4后4/短 key 全遮）、`.env` 原子写入（原位替换/追加/新建文件，保留注释）、`GET /api/keys/status` 只回掩码**不含明文**、rotate 参数校验、rotate 端到端（写入 `AI_EN_ENV_FILE` 隔离文件 + 运行时立即生效）、rotate-base URL 校验、test 端点未配置时 ok:false |
| `test/render-security.test.js` | `renderMD()` XSS corpus（fenced code / 正文 / inline code / 链接 / 数学）、Cloze 句子转义 |
| `test/api-contract.test.js` | 前端调用的每个 `/api/*` 都有后端路由、Anki action 与模型白名单前后端一致、user_data key 一致、无残留的旧 Python 入口引用、前端配置不含 key |
| `test/app-split.test.js` | app.js 拆分完整性：切片齐全/命名规范、index.html 顺序加载、无重复顶层声明、拼接可解析、关键函数齐全 |
| `test/required-words.test.js` | 翻译必用词匹配：变式（defers/stopped/studies）、词性标注、多词短语、句型骨架、句首大写；以真实题库参考答案命中率做回归 |
| `test/mode-switch.test.js` | 模式切换：面板显隐、当前模式持久化 |
| `test/encoding.test.js` | 全站 UTF-8 编码防回归（源码/文档不得出现乱码字节） |
| `test/audit-fixes.test.js` | 2026-09 审计修复回归：Anki query 顶层 OR 越权、note 媒体字段拒绝、CORS 不放行 `Origin: null`、限流器 clear/窗口滑出、5 个必现前端 bug 的源码级断言、草稿键与本地偏好同步白名单一致性、背景音乐播放逻辑（模式/进度/音量）、登录失败限流端到端 |
| `test/syntax-all.test.js` | 把 `scripts/check-syntax.js` 纳入 `npm test`（此前 `js/storage.js`、`js/config.js`、`scripts/*.js` 从未被解析） |

### 默认账户

| 用户名 | 密码 |
|---|---|
| `test` | `test` |
| `catten` | `catten` |

可用 `scripts/manage_users.py` 增删改查用户（从工作区根目录运行 `python scripts\manage_users.py ...`，即 `article-memorizing/` 下）。

> 首次使用请尽快修改默认账户密码：设置面板 → 「🔑 修改密码」。

### 服务与密钥（设置面板）

设置面板新增「🔌 服务与密钥」分区，不用手动改 `.env` 再重启：

- **MiniMax**（对话 / 评分 / 出题 / 联网搜索）：粘贴新 key → 保存即生效（进程内热更新，无需重启）；可修改上游地址（走反代/镜像时用）
- **ElevenLabs**（语音朗读 / 卡片发音）：同上
- **检测按钮**：用当前密钥对上游发一次最小成本请求（MiniMax `max_tokens=1`、ElevenLabs 只读账户端点），返回鉴权是否通过
- **安全边界**：密钥只存在服务端 `.env`（gitignored），任何接口只返回掩码（前4…后4），**永不明文回传**；写入用原子替换（临时文件 + rename），失败不破坏原文件；`AI_EN_ENV_FILE` 环境变量可重定向 .env 位置（测试/多实例用）
- 注意：若进程环境变量里也设置了同名 key，它的优先级高于 `.env`（面板会提示）

## 项目结构

```
ai-english-chat/
├── index.html           # 主页面
├── server.js            # 后端入口（node server.js [port]，实现拆分到 server/）
├── server/              # 后端模块（零依赖，Node 22.5+）
│   ├── app.js           # HTTP 组装：路由分发 + 生命周期 + 监听
│   ├── config.js        # 路径 / 常量 / env 密钥 / Anki·静态白名单
│   ├── db.js            # SQLite 连接（WAL）+ 题库播种
│   ├── migrations.js    # schema 版本迁移（PRAGMA user_version）
│   ├── auth.js          # PBKDF2 / 会话 token 哈希 / 鉴权 / 用户播种
│   ├── validation.js    # user_data 类型校验 + Anki 代理守卫（含检索串归属校验）
│   ├── rate-limit.js    # 滑动窗口限流框架（已接入登录失败限流）
│   ├── helpers.js       # CORS / JSON / 请求体读取
│   ├── routes/          # health / music / auth / user-data / gaokao / backup / proxy / keys / usage / static
│   └── services/        # backup（快照+分层保留）/ anki（AnkiConnect）/ proxy（上游转发）/ logger（JSONL+轮转）/ usage（用量记账）/ envfile（.env 原子写）
├── start.bat            # 启动脚本
├── .env                 # 密钥（gitignored）
├── css/
│   └── style.css        # 样式
├── package.json         # engines.node >=22.5 + start/test/check 脚本（零第三方依赖）
├── js/
│   ├── app/             # 主应用逻辑，按领域拆分为 23 个切片（原单体 app.js，约 8200 行）
│   │   ├── 01-core.js        # 全局状态、工具函数、Markdown 渲染、系统提示词、callAPI
│   │   ├── 02-agents.js      # 策略师 / 执行者（联网研究）/ SSE 流式
│   │   ├── 03-parse.js       # 高容忍度 JSON 解析、AI 回复提取
│   │   ├── 04-chat-tree.js   # 消息版本树
│   │   ├── 05-chat-view.js   # 聊天渲染、反馈、生词本 / 薄弱点
│   │   ├── 06-anki.js        # Anki 集成（推送 / 出题 / 复习）
│   │   ├── 07-chat-actions.js# 消息编辑、评分分析、发送、对话管理、侧栏
│   │   ├── 08-selection.js   # TTS、划词翻译、调试导出、右侧页签
│   │   ├── 09-gaokao.js      # 高考翻译题库
│   │   ├── 10-dictionary.js  # 词典 / 翻译查询
│   │   ├── 11-ui-panels.js   # 面板、模态框、本地备份、toast
│   │   ├── 12-settings.js    # 设置面板、AnkiConnect、登出、改密、角色卡、斜杠命令
│   │   ├── 13-banks.js       # 写作/翻译题库、翻译规则、必用词匹配
│   │   ├── 14-music.js       # 背景音乐播放器
│   │   ├── 15-modes.js       # 首页与模块切换、作答草稿
│   │   ├── 16-reading.js     # 阅读模式（文章 / 高亮 / 划词 / TTS / 联动主应用）
│   │   ├── 17-practice.js    # Writing / Translation 模块与内联标注
│   │   ├── 18-games.js       # Charade / Cloze / Wordle
│   │   ├── 19-init.js        # DOMContentLoaded 初始化、登录引导、定时备份
│   │   ├── 20-progress.js    # Progress 学习者模型仪表盘（纯本地聚合）
│   │   ├── 21-anki-tasks.js  # Anki 任务中心（持久化队列 + 重试）
│   │   ├── 22-web-review.js  # 网页答题复习（选择/填空键盘作答 + 自动评分）
│   │   └── 23-cost.js        # 成本与隐私中心（用量图表 + 隐私面板）
│   ├── config.js        # 角色卡、配置常量（不含密钥）
│   ├── shgaoka_bank.js  # 上海高考翻译题库（由 data/gaokao_translations.json 生成）
│   └── storage.js       # 存储层（登录 + SQLite 读写 + 本地缓存隔离 + 本地偏好同步白名单）
├── scripts/
│   ├── check-syntax.js  # npm run check 实际执行：枚举 js/** 逐个 node --check
│   └── backup_cli.js    # 备份 list / verify / restore（演练默认开，恢复前自动存盘）
├── test/                # node:test 测试（临时 DB，不碰真实数据）
│   ├── helpers.js       # 启动隔离服务进程 / HTTP 工具
│   ├── static-security.test.js
│   ├── auth.test.js
│   ├── user-data.test.js
│   ├── anki-proxy.test.js
│   ├── anki-tasks.test.js
│   ├── schema-backup.test.js
│   ├── backup-service.test.js
│   ├── logger.test.js
│   ├── usage.test.js
│   ├── keys.test.js
│   ├── render-security.test.js
│   ├── api-contract.test.js
│   ├── app-split.test.js
│   ├── mode-switch.test.js
│   ├── encoding.test.js
│   ├── audit-fixes.test.js
│   ├── syntax-all.test.js
│   └── required-words.test.js
├── docs/
│   └── audit-2026-08.md # 代码审查与修复记录
├── img/icons/           # 首页功能卡图标
├── vendor/
│   └── katex/           # KaTeX 数学渲染
├── music/               # 背景音乐目录（放入音频文件即可播放，gitignored）
└── data/
    ├── app.db           # SQLite 数据库（gitignored）
    ├── gaokao_translations.json  # 高考翻译题源数据（启动导入 SQLite）
    └── backups/         # 数据库快照备份
```

用户管理脚本位于**工作区根目录**（`ai-english-chat` 的上一级）：

```bash
cd F:\my_doc\code\article-memorizing
python scripts\manage_users.py list
```

## 详细操作指南

查看 [WIKI.md](./WIKI.md) 获取完整功能说明与操作指引。

代码审查与修复记录见 [docs/audit-2026-08.md](./docs/audit-2026-08.md)（含已修问题、跳过项、遗留项与后续路线）。

## 前端结构说明

`js/app.js` 已拆分为 `js/app/01-core.js … 23-cost.js` 共 **23 个顺序切片**，由 `index.html` 按序加载（01–19 为原单体拆分，20–23 为新增功能切片）。这是「顺序切片」而非模块化重构，原因：原文件含顶层 IIFE、事件绑定与 `const/let` 声明，重排会改变执行顺序与 TDZ 行为。切片本身没有 `import/export`，函数仍声明在全局作用域，跨切片调用靠加载顺序保证。

拆分由 `_archive/ai-english-chat-legacy-20260828/split-app.js`（gitignored，不在仓库内运行）生成，校验约束：

1. 拼接所有切片（去掉头注释）与拆分前内容**逐字节一致** → 无丢失/无重复
2. 每个切片单独 `node --check` 通过 → 括号/字符串/模板未被切在中间
3. `test/app-split.test.js`（11 用例）固化：切片齐全、index.html 顺序加载且不再引用单体、无重复顶层声明、拼接可解析、关键函数齐全
4. 旧单体已归档到 `_archive/ai-english-chat-legacy-20260828/app.js.monolith-before-split`（gitignored）

> 改动某个切片后：`npm run check` 自动对新内容做语法检查；`npm test` 的 `app-split` 与 `api-contract` 用例保证切分不退化。切片 **顺序不可调整**。

## 安全

- 后端仅绑定 `127.0.0.1`，局域网不可达
- **静态文件按前缀映射到独立物理目录**：`index.html` + `/css/*` + `/js/*` + `/vendor/*` + `/music/*` + `/img/*`；解码后逐段校验，拒绝 `..`/反斜杠/NUL/绝对路径，扩展名必须在白名单内（无 octet-stream 兜底），响应带 `X-Content-Type-Options: nosniff`
- **严格 CSP**（`Content-Security-Policy`）：`script-src 'self'`（禁止 inline 事件/脚本，前端交互全部走 `data-action` + 事件委托，见 `js/app/19-init.js`）、`style-src 'self' 'unsafe-inline'`、`img/media-src` 放开 `data:`/`blob:`（头像 dataURL、TTS/录音 blob）、`frame-src/object-src 'none'`
- 所有 `/api/*` 接口（除登录/健康检查/音乐列表）需 `Authorization: Bearer <token>`
- 密码 PBKDF2 加盐哈希 + timing-safe 比较；会话 30 天有效期，过期会话自动清理
- **会话 token 只以 SHA-256 落库**，原始 token 仅在登录响应中返回一次；数据库/WAL/备份泄露无法直接冒充用户
- 修改密码会撤销该账户除当前会话外的所有会话；也可在「查看会话 → 退出其他设备」手动撤销
- **请求体按实际字节计量**，不信任 `Content-Length`；chunked 请求同样受限（user_data 8MB / Anki 12MB / 改密 8KB / 其他 24MB）
- `/api/db/*` 服务端强校验：必须是合法 JSON 且顶层类型符合该 key 约定，损坏数据不能覆盖有效数据
- **AnkiConnect 代理白名单**：只放行本应用实际使用的 action，且所有牌组操作强制限定在 `英语学习::<当前用户>` 子树内；`storeMediaFile` 只接受应用自己生成的文件名，禁止 `path`/`url`
- 数据按用户 ID 隔离存储，本地缓存带账户归属标记，切换账户自动清空
- 前端渲染：模型输出的 Markdown 代码块、Cloze 句子等一律转义后再插入 DOM
- 密钥仅存在于服务器端 `.env`，前端不暴露（契约测试会检查）

### 数据库与运维

- schema 版本由 `PRAGMA user_version` 管理，迁移在单事务内执行；迁移失败即终止启动，不带半迁移状态运行
- 启动时校验关键表/列存在；schema 版本高于程序支持时拒绝启动
- 优雅关闭（`Ctrl+C` / SIGTERM）：停止接收新连接 → 等待在途请求（上限 10s）→ `wal_checkpoint(TRUNCATE)` → 关闭数据库
- 每 60 秒做一次被动 WAL checkpoint（Windows 直接关窗口不触发信号，靠这个保证 `app.db` 不会长期落后）
- `PRAGMA busy_timeout = 5000`，与 `manage_users.py` 等外部工具并发写时等待而非立即报错
- 备份有互斥锁，同秒重名自动加毫秒+随机后缀；每份快照生成后只读打开做 `PRAGMA integrity_check` + 表计数校验，校验失败的文件立即删除
- **结构化日志**：`data/logs/server.log`（JSONL，按大小轮转，默认 5MB × 5 份）--每个请求带 12 位短 id，响应结束记录方法/路径/状态/耗时；控制台仍输出人类可读行。环境变量：`AI_EN_LOG_TO_FILE=0` 关闭文件日志、`AI_EN_LOG_MAX_BYTES`、`AI_EN_LOG_KEEP`、`AI_EN_LOG_LEVEL`（debug/info/warn/error，默认 info）
- **服务端常驻备份调度**：不依赖浏览器开着，后端按间隔自动备份。环境变量：
  - `AI_EN_BACKUP_INTERVAL_MIN`：备份间隔分钟，默认 `60`，设 `0` 关闭
  - `AI_EN_BACKUP_EXTRA_DIR`：异盘副本目录（如 `E:\backups\ai-english-chat`），每份备份额外复制一份过去并同样校验/清理，防单盘损坏
- **备份恢复 CLI**（零依赖，仅用内置模块；路径同样遵循 `AI_EN_DATA_DIR`）：

```bash
node scripts/backup_cli.js list                        # 列出备份（含校验状态/用户数）
node scripts/backup_cli.js verify latest               # 校验最新备份（也可传序号或文件名）
node scripts/backup_cli.js restore latest              # 演练：只打印计划，不改文件
node scripts/backup_cli.js restore latest --yes        # 执行：先自动存一份恢复前快照，再替换并校验
```

> ⚠️ 恢复前请先停止服务。CLI 会检测 `app.db-wal` 并警告；恢复时会自动删除 `app.db-wal`/`app.db-shm`（否则旧 WAL 会与替换后的主库不一致），恢复后自动重新校验，并在 `backups/` 留下 `*_prerestore_chat.db` 回滚快照。
