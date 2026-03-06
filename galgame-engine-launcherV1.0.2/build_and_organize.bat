@echo off
chcp 65001 >nul
echo ====================================
echo   Galgame Launcher 构建脚本
echo ====================================
echo.

:: 检查 dotnet 是否安装
dotnet --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 .NET SDK
    echo 请先安装 .NET 6.0 SDK: https://dotnet.microsoft.com/download/dotnet/6.0
    echo.
    pause
    exit /b 1
)

echo [信息] .NET SDK 版本:
dotnet --version
echo.

:: 清理旧的构建产物
echo [清理] 正在清理旧的构建文件...
if exist "bin" rmdir /s /q bin
if exist "obj" rmdir /s /q obj
if exist "publish_output" rmdir /s /q publish_output
echo [成功] 清理完成
echo.

:: 还原依赖
echo [还原] 正在还原 NuGet 包...
dotnet restore
if %errorlevel% neq 0 (
    echo [错误] 还原失败！
    pause
    exit /b 1
)

:: 开始构建
echo [构建] 正在编译 Release 版本...
echo.

dotnet publish -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true /p:EnableCompressionInSingleFile=true

if %errorlevel% neq 0 (
    echo.
    echo [错误] 构建失败！
    echo.
    pause
    exit /b 1
)

echo.
echo ====================================
echo   构建成功！
echo ====================================
echo.

:: 复制到 publish_output 目录
set PUBLISH_DIR=publish_output
if not exist "%PUBLISH_DIR%" mkdir "%PUBLISH_DIR%"
echo [部署] 正在复制文件到 %PUBLISH_DIR%...
copy /Y "bin\Release\net6.0-windows\win-x64\publish\GalgameLauncher.exe" "%PUBLISH_DIR%\"
copy /Y "bin\Release\net6.0-windows\win-x64\publish\GalgameLauncher.pdb" "%PUBLISH_DIR%\" 2>nul

echo.
echo 最终目录结构:
echo.
echo %PUBLISH_DIR%/
dir /b "%PUBLISH_DIR%" | findstr /r "\.exe \.pdb"
echo.
echo ====================================
echo   编译完成！
echo ====================================
echo.
echo 下一步操作:
echo 1. 将 %PUBLISH_DIR% 中的 GalgameLauncher.exe 复制到 galgame-engine 目录
echo 2. 在 galgame-engine\icon 文件夹中放入你的图标文件（可选）
echo 3. 运行 GalgameLauncher.exe 测试
echo.
pause
