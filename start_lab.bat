@echo off
title Virtugenium Laboratory Launcher
echo Запуск Virtugenium Laboratory...
cd /d "%~dp0"
npx tauri dev
pause