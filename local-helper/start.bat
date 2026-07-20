@echo off
title MVSep - Helper Local
cd /d "%~dp0"

echo ============================================
echo    MVSep - Helper Local
echo    Iniciando servidor en puerto 3456...
echo ============================================
echo.

:: Verificar si node está instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo Instalalo desde: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Verificar si npm install ya se ejecutó
if not exist "node_modules\" (
    echo [INFO] Instalando dependencias por primera vez...
    call npm install
    echo.
)

echo [OK] Servidor iniciado. Manten esta ventana abierta.
echo [OK] Cierra esta ventana para detener el servidor.
echo.

node server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] El servidor se detuvo con un error.
    echo Revisa los mensajes arriba para mas detalles.
    pause
)
