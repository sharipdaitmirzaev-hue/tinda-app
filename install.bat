@echo off
chcp 65001 >nul
echo ========================================
echo TINDA Image Downloader - установка
echo ========================================
echo.

python --version
if errorlevel 1 (
    echo [ОШИБКА] Python не найден. Установите Python 3.10+ и отметьте "Add Python to PATH".
    pause
    exit /b 1
)

echo.
echo Установка зависимостей Python...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ОШИБКА] Не удалось установить пакеты.
    pause
    exit /b 1
)

echo.
echo Установка браузера Chromium для Playwright...
python -m playwright install chromium
if errorlevel 1 (
    echo [ОШИБКА] Не удалось установить Chromium.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Установка завершена успешно.
echo Запустите программу через run.bat
echo ========================================
pause
