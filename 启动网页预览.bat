@echo off
chcp 65001 >nul
if not exist "%~dp0ShadePath-preview.html" (
  echo 未找到 ShadePath-preview.html。请先在项目目录运行 npm run build。
  pause
  exit /b 1
)
start "" "%~dp0ShadePath-preview.html"
