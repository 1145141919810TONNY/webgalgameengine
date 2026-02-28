@echo off
chcp 65001 >nul
echo 正在启动Galgame引擎...
echo.

:: 检查当前目录
echo 当前目录: %CD%
echo.

:: 检查Python是否已安装
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未找到Python。请先安装Python。
    echo 请访问 https://www.python.org/downloads/ 下载并安装Python。
    pause
    exit /b 1
)

echo 启动本地HTTP服务器...
echo 服务器将在 http://localhost:8080 上运行
echo.

:: 在新窗口中启动服务器并在后台运行
start "Galgame Server" cmd /c "python -m http.server 8080"

:: 等待服务器启动
timeout /t 2 /nobreak >nul

:: 打开浏览器访问游戏
echo 启动浏览器并打开游戏...
start http://localhost:8080/index.html

echo.
echo 游戏已在浏览器中打开！
echo 请保持此窗口开启以维持服务器运行。
echo.
echo 要停止服务器，请在此窗口中按 Ctrl+C，然后输入 Y 并回车。
echo.
pause