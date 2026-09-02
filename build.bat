@echo off
title Compilador NoteLens
cd /d "%~dp0"
echo [*] Comprobando, compilando y desplegando NoteLens...
call npm run check
if errorlevel 1 goto :error
call npm run deploy
if errorlevel 1 goto :error
echo [+] NoteLens se ha compilado y desplegado correctamente.
goto :end
:error
echo [!] No se pudo completar el proceso. Revisa el mensaje anterior.
:end
pause
