@echo off
setlocal
chcp 65001 >nul
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24+ is required. Install it from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
node.exe "%~dp0..\manage.cjs" %*
set "cardExit=%errorlevel%"
echo.
pause
exit /b %cardExit%
