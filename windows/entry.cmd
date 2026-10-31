@echo off
setlocal
chcp 65001 >nul
set "nodeExe=%~dp0..\runtime\node.exe"
if not exist "%nodeExe%" (
  if exist "%~dp0..\runtime\" (
    echo QuotaRing runtime is incomplete. Extract the complete release ZIP and try again.
    pause
    exit /b 1
  )
  where node.exe >nul 2>nul
  if errorlevel 1 (
    echo This source folder has no bundled Node.js. Use a QuotaRing release package, or install Node.js 24+ for development.
    pause
    exit /b 1
  )
  set "nodeExe=node.exe"
)
"%nodeExe%" "%~dp0..\manage.cjs" %*
set "cardExit=%errorlevel%"
echo.
pause
exit /b %cardExit%
