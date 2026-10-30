@echo off
rem Opens the Gexart Harvey control panel (no console window stays open).
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0GexartHarvey.ps1"
