@echo off
chcp 65001 >nul
cd /d "%~dp0"
python app.py
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Программа завершилась с ошибкой.
    echo Убедитесь, что вы сначала запустили install.bat
    pause
)
