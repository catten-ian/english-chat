@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

set PORT=8091
set URL=http://localhost:%PORT%

echo ========================================
echo  AI 英语对话教练 - 启动器
echo ========================================
echo.

REM ---- 1. 检查 Node 是否可用 ----
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 node 命令。
  echo        请安装 Node.js 22.5 或更高版本，并确保它在 PATH 中。
  echo        下载: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

REM ---- 2. 检查 Node 版本（需要 22.5+，因为使用 node:sqlite） ----
for /f "delims=" %%v in ('node -e "const [a,b]=process.versions.node.split('.').map(Number);process.stdout.write((a>22||(a===22&&b>=5))?'ok':process.versions.node)"') do set NODECHECK=%%v
if not "!NODECHECK!"=="ok" (
  echo [错误] Node 版本过低: v!NODECHECK!
  echo        本应用使用内置 node:sqlite 模块，需要 Node 22.5 或更高版本。
  echo.
  pause
  exit /b 1
)

REM ---- 3. 确认 node:sqlite 真的可用 ----
node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
  echo [错误] 当前 Node 无法加载 node:sqlite 模块。
  echo        请升级到 Node 22.5+ 正式版后重试。
  echo.
  pause
  exit /b 1
)

REM ---- 4. 端口已被占用时，先判断是不是本应用已在运行 ----
node -e "const http=require('node:http');const r=http.get({host:'127.0.0.1',port:%PORT%,path:'/api/health',timeout:1500},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{process.exit(JSON.parse(d).status==='ok'?0:2)}catch(e){process.exit(2)}})});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})" >nul 2>nul
set HEALTH=!errorlevel!

if "!HEALTH!"=="0" (
  echo  服务已在运行，直接打开浏览器。
  start "" %URL%
  echo.
  echo  地址: %URL%
  timeout /t 3 >nul
  exit /b 0
)
if "!HEALTH!"=="2" (
  echo [错误] 端口 %PORT% 已被其他程序占用（不是本应用）。
  echo        请先关闭占用该端口的程序，或改用其他端口: node server.js 8092
  echo.
  pause
  exit /b 1
)

REM ---- 5. 启动后端 ----
echo  正在启动后端服务...
start "AI English Backend" node server.js %PORT%

REM ---- 6. 轮询 /api/health，最多等 20 秒 ----
set READY=0
for /l %%i in (1,1,40) do (
  if "!READY!"=="0" (
    timeout /t 1 >nul
    node -e "const http=require('node:http');const r=http.get({host:'127.0.0.1',port:%PORT%,path:'/api/health',timeout:1000},res=>process.exit(res.statusCode===200?0:1));r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})" >nul 2>nul
    if not errorlevel 1 set READY=1
  )
)

if "!READY!"=="0" (
  echo.
  echo [错误] 后端在 20 秒内没有就绪。
  echo        请查看 "AI English Backend" 窗口中的错误信息。
  echo        常见原因: 数据库迁移失败、端口冲突、data 目录无写权限。
  echo.
  pause
  exit /b 1
)

echo  后端已就绪，正在打开浏览器...
start "" %URL%
echo.
echo  地址: %URL%
echo  关闭此窗口不会停止后端；如需停止，请在 "AI English Backend" 窗口按 Ctrl+C
echo  （Ctrl+C 会触发优雅关闭：等待在途请求 + WAL 并回主库）
echo.
timeout /t 5 >nul
exit /b 0
