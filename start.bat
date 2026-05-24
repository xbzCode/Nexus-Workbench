@echo off
chcp 65001 >nul 2>&1
title AgentFlow Server

echo ========================================
echo   AgentFlow - 启动服务
echo ========================================
echo.

cd /d "%~dp0"

:: 激活虚拟环境
call server\venv\Scripts\activate.bat

:: 进入 server 目录并启动
cd server
echo [INFO] 正在启动服务...
echo [INFO] 前端页面: http://localhost:8000/
echo [INFO] API 文档:  http://localhost:8000/docs
echo [INFO] 按 Ctrl+C 停止服务
echo.

python -m uvicorn main:app --reload --reload-dir . --port 8000

pause
