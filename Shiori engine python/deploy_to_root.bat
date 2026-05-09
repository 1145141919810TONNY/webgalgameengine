@echo off
chcp 65001 >nul
echo ========================================
echo   Shiori Engine Launcher - 单文件部署脚本
echo ========================================
echo.

set "SCRIPT_DIR=%~dp0"
set "DIST_DIR=%SCRIPT_DIR%dist"
set "TARGET_DIR=%SCRIPT_DIR%..\"

REM 检查 dist 目录是否存在
if not exist "%DIST_DIR%" (
    echo [错误] 找不到 dist 目录: %DIST_DIR%
    echo 请先运行 build_fix.bat 进行编译
    pause
    exit /b 1
)

echo [1/4] 检查编译输出...
if not exist "%DIST_DIR%\Shiori.exe" (
    echo [错误] dist 目录中缺少 Shiori.exe
    pause
    exit /b 1
)
if not exist "%DIST_DIR%\Shiori_debug.exe" (
    echo [错误] dist 目录中缺少 Shiori_debug.exe
    pause
    exit /b 1
)
echo   编译输出检查通过
echo.

echo [2/4] 复制 Shiori.exe 到根目录...
copy /Y "%DIST_DIR%\Shiori.exe" "%TARGET_DIR%Shiori.exe" >nul
if errorlevel 1 (
    echo [错误] 复制 Shiori.exe 失败
    echo 请确保 Shiori.exe 未在其他位置运行
    pause
    exit /b 1
)
echo   Shiori.exe 已复制
echo.

echo [3/4] 复制 Shiori_debug.exe 到根目录...
copy /Y "%DIST_DIR%\Shiori_debug.exe" "%TARGET_DIR%Shiori_debug.exe" >nul
if errorlevel 1 (
    echo [错误] 复制 Shiori_debug.exe 失败
    pause
    exit /b 1
)
echo   Shiori_debug.exe 已复制
echo.

echo [4/4] 验证引擎文件夹...
if exist "%TARGET_DIR%shiori engine\index.html" (
    echo   引擎文件夹已存在
) else (
    echo   [警告] 未找到引擎文件夹，程序可能无法正常运行
    echo   请确保 shiori engine 文件夹位于根目录
)
echo.

echo ========================================
echo   部署完成！
echo ========================================
echo.

REM 验证结果
echo === 验证结果 ===
if exist "%TARGET_DIR%Shiori.exe" (
    echo   [OK] Shiori.exe
) else (
    echo   [FAIL] Shiori.exe 缺失
)

if exist "%TARGET_DIR%Shiori_debug.exe" (
    echo   [OK] Shiori_debug.exe
) else (
    echo   [FAIL] Shiori_debug.exe 缺失
)

if exist "%TARGET_DIR%shiori engine\index.html" (
    echo   [OK] shiori engine\index.html
) else (
    echo   [WARN] shiori engine 目录不存在
)

echo.

REM 计算 exe 大小
for %%F in ("%TARGET_DIR%Shiori.exe") do set EXE_SIZE=%%~zF
set /a EXE_MB=EXE_SIZE/1048576

echo ========================================
echo   最终目录结构
echo ========================================
echo.
echo 根目录 %TARGET_DIR%
echo   ├── Shiori.exe              (%EXE_MB% MB) - 标准版（包含所有依赖）
echo   ├── Shiori_debug.exe        - 调试版（包含所有依赖）
echo   └── shiori engine/          - 引擎文件夹（外部存放）
echo       ├── index.html
echo       ├── api/
echo       ├── assets/
echo       └── ...
echo.
echo ========================================
echo.
echo 下一步操作：
echo   1. 双击 Shiori.exe 启动程序
echo   2. 右键 Shiori.exe → 属性 → 详细信息 查看版权信息
echo   3. 双击 Shiori_debug.exe 查看调试日志
echo.
pause
