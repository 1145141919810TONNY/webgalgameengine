@echo off
setlocal enabledelayedexpansion

title 验证 Shiori 引擎完整性

echo ========================================
echo   Shiori 引擎完整性验证工具
echo ========================================
echo.

set SCRIPT_DIR=%~dp0
set ERROR_COUNT=0

REM 1
echo 【阶段 1】检测启动器文件...
echo.
set FOUND=0
if exist "%SCRIPT_DIR%Shiori.exe" (
    echo [OK] 检测到 Shiori.exe
    set FOUND=1
)
if exist "%SCRIPT_DIR%Shiori_debug.exe" (
    echo [OK] 检测到 Shiori_debug.exe
    set FOUND=1
)
if %FOUND%==0 (
    echo [ERROR] 未检测到启动器文件
    set /a ERROR_COUNT+=1
)
echo.

REM 2
echo 【阶段 2】检测核心文件...
echo.
if not exist "%SCRIPT_DIR%shiori engine\" (
    echo [ERROR] 引擎文件夹不存在
    set /a ERROR_COUNT+=1
    goto END
)
set /a MISSING=0
if exist "%SCRIPT_DIR%shiori engine\engine.js" (echo [OK] engine.js) else (echo [MISSING] engine.js & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\system.js" (echo [OK] system.js) else (echo [MISSING] system.js & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\index.html" (echo [OK] index.html) else (echo [MISSING] index.html & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\char_preview.html" (echo [OK] char_preview.html) else (echo [MISSING] char_preview.html & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\scenes\scene1.html" (echo [OK] scenes\scene1.html) else (echo [MISSING] scenes\scene1.html & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\style.css" (echo [OK] style.css) else (echo [MISSING] style.css & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\bg_config.js" (echo [OK] bg_config.js) else (echo [MISSING] bg_config.js & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\bgm_config.js" (echo [OK] bgm_config.js) else (echo [MISSING] bgm_config.js & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\cg_config.js" (echo [OK] cg_config.js) else (echo [MISSING] cg_config.js & set /a MISSING+=1)
if exist "%SCRIPT_DIR%shiori engine\illustration.js" (echo [OK] illustration.js) else (echo [MISSING] illustration.js & set /a MISSING+=1)
echo.
if %MISSING%==0 (echo [OK] 核心文件完整) else (echo [ERROR] 缺失 %MISSING% 个文件 & set /a ERROR_COUNT+=1)
echo.

REM 3 - 检测 html 文件夹内的所有 html 文件（排除 copy.html）
echo 【阶段 3】检测 html 文件夹...\necho.
if not exist "%SCRIPT_DIR%shiori engine\html\" (
    echo [ERROR] html 文件夹不存在
    set /a ERROR_COUNT+=1
) else (
    set /a HTML_MISSING=0
    set /a HTML_COUNT=0
    for %%F in ("%SCRIPT_DIR%shiori engine\html\*.html") do (
        set FILENAME=%%~nxF
        if /i not "!FILENAME!"=="copy.html" (
            set /a HTML_COUNT+=1
            echo [OK] html\!FILENAME!
        )
    )
    if !HTML_COUNT! GTR 0 (
        echo [OK] html 文件夹检测完成，共 !HTML_COUNT! 个文件
    ) else (
        echo [ERROR] html 文件夹内未找到 html 文件
        set /a ERROR_COUNT+=1
    )
)
echo.

REM 4 - 检测 assets 文件夹结构
echo 【阶段 4】检测 assets 文件夹...\necho.
if not exist "%SCRIPT_DIR%shiori engine\assets\" (
    echo [ERROR] assets 文件夹不存在
    set /a ERROR_COUNT+=1
) else (
    set /a ASSETS_MISSING=0
    if exist "%SCRIPT_DIR%shiori engine\assets\audio\" (echo [OK] assets\audio) else (echo [MISSING] assets\audio & set /a ASSETS_MISSING+=1)
    if exist "%SCRIPT_DIR%shiori engine\assets\video\" (echo [OK] assets\video) else (echo [MISSING] assets\video & set /a ASSETS_MISSING+=1)
    if exist "%SCRIPT_DIR%shiori engine\assets\bg\" (echo [OK] assets\bg) else (echo [MISSING] assets\bg & set /a ASSETS_MISSING+=1)
    if exist "%SCRIPT_DIR%shiori engine\assets\cg\" (echo [OK] assets\cg) else (echo [MISSING] assets\cg & set /a ASSETS_MISSING+=1)
    if exist "%SCRIPT_DIR%shiori engine\assets\chars\" (echo [OK] assets\chars) else (echo [MISSING] assets\chars & set /a ASSETS_MISSING+=1)
    echo.
    if !ASSETS_MISSING!==0 (echo [OK] assets 文件夹结构完整) else (echo [ERROR] assets 文件夹缺失 !ASSETS_MISSING! 个子文件夹 & set /a ERROR_COUNT+=1)
)
echo.

:END
echo ========================================
if %ERROR_COUNT%==0 (
    echo   检测完成：全部通过
) else (
    echo   检测完成：发现 %ERROR_COUNT% 个错误
)
echo ========================================
echo.
pause
