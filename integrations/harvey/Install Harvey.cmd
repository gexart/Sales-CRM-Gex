@echo off
rem Installs Harvey and the Gexart Harvey app (Python, Git, Claude Code CLI if missing).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Harvey.ps1"
pause
