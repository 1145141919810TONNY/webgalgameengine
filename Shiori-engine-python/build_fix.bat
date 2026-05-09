@echo off
chcp 65001 >nul
echo ========================================
echo   Shiori Engine Launcher - 单文件编译脚本
echo ========================================
echo.

REM 检查 Python 是否安装
echo [1/4] 检查 Python 环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)
echo Python 已安装
echo.

REM 检查并安装依赖
echo [2/4] 检查并安装依赖...
python -c "import PyQt6" >nul 2>&1
if errorlevel 1 (
    echo 正在安装 PyQt6 和 PyQt6-WebEngine...
    pip install pyqt6 pyqt6-webengine pyinstaller
    if errorlevel 1 (
        echo 错误: 依赖安装失败
        pause
        exit /b 1
    )
)
python -c "import PyQt6.QtWebEngineWidgets" >nul 2>&1
if errorlevel 1 (
    echo 正在安装 PyQt6-WebEngine...
    pip install pyqt6-webengine
    if errorlevel 1 (
        echo 错误: PyQt6-WebEngine 安装失败
        pause
        exit /b 1
    )
)
echo 依赖安装完成
echo.

REM 验证 PyQt6 安装
echo [3/4] 验证 PyQt6 安装...
python -c "import PyQt6; print('PyQt6 版本:', PyQt6.__version__)"
python -c "import PyQt6.QtWebEngineWidgets; print('PyQt6-WebEngine: OK')"
echo.

REM 清理旧文件
echo [4/4] 清理旧文件...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
echo 清理完成
echo.

REM 使用 spec 文件进行单文件打包
echo ========================================
echo   开始编译（单文件模式）
echo ========================================
echo.

echo [1/2] 编译标准版（无控制台窗口）...
pyinstaller --noconfirm shiori.spec

if errorlevel 1 (
    echo 错误: 标准版编译失败
    pause
    exit /b 1
)
echo 标准版编译成功
echo.

echo [2/2] 编译调试版（带控制台窗口）...
pyinstaller --noconfirm shiori_debug.spec

if errorlevel 1 (
    echo 错误: 调试版编译失败
    pause
    exit /b 1
)
echo 调试版编译成功
echo.

echo ========================================
echo   编译完成！
echo ========================================
echo.

REM 显示编译结果
echo 编译输出位置: %~dp0dist\
echo.
echo 文件列表:
dir "%~dp0dist\*.exe" /B
echo.

REM 显示文件大小
for %%F in ("%~dp0dist\*.exe") do (
    set /a size=%%~zF/1024/1024
    echo   %%~nxF - !size! MB
)
echo.

echo ========================================
echo   使用说明
echo ========================================
echo.
echo 单文件模式：所有依赖已打包进 exe
echo.
echo 部署方法：
echo   1. 复制 dist\Shiori.exe 和 Shiori_debug.exe 到项目根目录
echo   2. 确保根目录有 shiori engine 文件夹
echo   3. 双击 exe 即可运行
echo.
echo 或运行部署脚本：
echo   deploy_to_root.bat
echo.
echo 验证版权信息:
echo   右键 Shiori.exe - 属性 - 详细信息
echo.

pause
