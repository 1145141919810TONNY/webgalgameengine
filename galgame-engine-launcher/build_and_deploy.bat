@echo off
chcp 65001 >nul
echo ====================================
echo   Galgame Launcher 编译并部署脚本
echo ====================================
echo.

:: 检查 dotnet 是否安装
dotnet --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 .NET SDK
    echo.
    echo 请先安装 .NET 6 SDK:
    echo 下载地址：https://dotnet.microsoft.com/zh-cn/download/dotnet/6.0
    echo.
    pause
    exit /b 1
)

echo [信息] 检测到 .NET SDK 版本:
dotnet --version
echo.

:: 获取当前目录
set SCRIPT_DIR=%~dp0

:: 恢复 NuGet 包
echo [步骤 1/4] 正在恢复 NuGet 包...
dotnet restore
if %errorlevel% neq 0 (
    echo [错误] NuGet 包恢复失败
    pause
    exit /b 1
)
echo [完成] NuGet 包恢复成功
echo.

:: 编译项目
echo [步骤 2/4] 正在编译项目...
dotnet build -c Release
if %errorlevel% neq 0 (
    echo [错误] 编译失败
    pause
    exit /b 1
)
echo [完成] 编译成功
echo.

:: 发布项目
echo [步骤 3/4] 正在发布项目...
echo [信息] 此过程可能需要 2-3 分钟，请耐心等待...

:: 清理旧的发布文件
if exist "%SCRIPT_DIR%bin\Release\net6.0-windows\win-x64\publish" (
    rmdir /S /Q "%SCRIPT_DIR%bin\Release\net6.0-windows\win-x64\publish"
)

:: 使用完全独立模式（不依赖任何运行时）
dotnet publish -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true /p:EnableCompressionInSingleFile=false
if %errorlevel% neq 0 (
    echo [错误] 发布失败
    pause
    exit /b 1
)
echo [完成] 发布成功
echo.

:: 复制到游戏目录
echo [步骤 4/4] 正在复制到游戏目录...
set GAME_ENGINE_DIR=%SCRIPT_DIR%..\galgame-engine
if not exist "%GAME_ENGINE_DIR%" (
    echo [错误] 未找到 galgame-engine 目录：%GAME_ENGINE_DIR%
    pause
    exit /b 1
)

copy /Y "%SCRIPT_DIR%bin\Release\net6.0-windows\win-x64\publish\GalgameLauncher.exe" "%GAME_ENGINE_DIR%\"
if %errorlevel% neq 0 (
    echo [错误] 复制失败
    pause
    exit /b 1
)

echo [完成] 已成功复制到：%GAME_ENGINE_DIR%\GalgameLauncher.exe
echo.

:: 创建 plugin 目录（如果不存在）
if not exist "%GAME_ENGINE_DIR%\plugin" (
    mkdir "%GAME_ENGINE_DIR%\plugin"
    echo [完成] 已创建 plugin 目录
    echo.
)

echo ====================================
echo   编译并部署成功！
echo ====================================
echo.
echo 可执行文件位置:
echo %GAME_ENGINE_DIR%\GalgameLauncher.exe
echo.
echo 使用说明:
echo 1. 双击运行 galgame-engine/GalgameLauncher.exe
echo 2. 程序会自动启动 HTTP 服务器并打开浏览器
echo 3. 保持窗口开启以维持服务器运行
echo.
echo 按任意键退出...
pause >nul
