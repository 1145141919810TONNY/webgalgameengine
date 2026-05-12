@echo off
chcp 65001 >nul
echo ========================================
echo   Shiori Engine Launcher - 多文件编译脚本
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
    echo 正在安装 PyQt6、PyQt6-WebEngine 和 OpenCV...
    pip install pyqt6 pyqt6-webengine pyinstaller opencv-python
    if errorlevel 1 (
        echo 错误: 依赖安装失败
        pause
        exit /b 1
    )
)
python -c "import PyQt6.QtWebEngineWidgets" >nul 2>&1
if errorlevel 1 (
    echo 正在安装 PyQt6-WebEngine
    pip install pyqt6-webengine
    if errorlevel 1 (
        echo 错误: PyQt6-WebEngine 安装失败
        pause
        exit /b 1
    )
)
python -c "import cv2" >nul 2>&1
if errorlevel 1 (
    echo 正在安装 OpenCV 视频解码库
    pip install opencv-python
    if errorlevel 1 (
        echo 错误: OpenCV 安装失败
        pause
        exit /b 1
    )
)
echo 依赖安装完成
echo.

REM 验证 PyQt6 安装
echo [3/4] 验证 PyQt6 安装...
python -c "import PyQt6; print('PyQt6: OK')"
python -c "import PyQt6.QtWebEngineWidgets; print('PyQt6-WebEngine: OK')"
python -c "import cv2; print('OpenCV: OK')"
echo.

REM 清理旧文件
echo [4/4] 清理旧文件...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
echo 清理完成
echo.

REM 使用 spec 文件进行多文件打包
echo ========================================
echo   开始编译（多文件 onedir 模式）
echo ========================================
echo.

echo [1/2] 编译标准版（无控制台窗口）...
pyinstaller --clean --noconfirm shiori.spec

if errorlevel 1 (
    echo 错误: 标准版编译失败
    pause
    exit /b 1
)
echo 标准版编译成功
echo.

echo [2/2] 编译调试版（带控制台窗口）...
pyinstaller --clean --noconfirm shiori_debug.spec

if errorlevel 1 (
    echo 错误: 调试版编译失败
    pause
    exit /b 1
)
echo 调试版编译成功
echo.

echo ========================================
echo   正在优化输出结构...
echo ========================================
echo.
python reorganize_output.py dist

echo.
echo ========================================
echo   编译与整理完成！
echo ========================================
echo.

echo 编译输出位置: %~dp0dist\
echo.
echo 使用说明：
echo   1. 将 dist 文件夹内的所有内容复制到目标位置
echo   2. 确保该目录下包含 'shiori engine' 文件夹
echo   3. 双击 Shiori.exe 或 Shiori_debug.exe 即可运行

pause
