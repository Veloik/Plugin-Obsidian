@echo off
title Compilador Obsidian OneNote Plugin
cd /d "%~dp0"
echo [*] Instalando dependencias y compilando...
call npm run build
echo [+] Plugin compilado y desplegado con exito en tu boveda de Obsidian!
pause