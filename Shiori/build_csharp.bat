@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   Shiori Engine Launcher - C# 编译脚本
echo ========================================
echo.

set "LOCAL_NUGET_DIR=nupkg"
set "NUGET_CONFIG=%temp%\nuget_local.config"
set "USE_LOCAL_NUGET=false"
set "MISSING_PACKAGES="

:: 检查本地 nupkg 文件夹是否包含所有必需的包
echo 检测本地 NuGet 包...
if not exist "%LOCAL_NUGET_DIR%\microsoft.web.webview2.1.0.2365.46.nupkg" set "MISSING_PACKAGES=!MISSING_PACKAGES! microsoft.web.webview2.1.0.2365.46"
if not exist "%LOCAL_NUGET_DIR%\opencvsharp4.4.9.0.20240103.nupkg" set "MISSING_PACKAGES=!MISSING_PACKAGES! opencvsharp4.4.9.0.20240103"
if not exist "%LOCAL_NUGET_DIR%\opencvsharp4.runtime.win.4.9.0.20240103.nupkg" set "MISSING_PACKAGES=!MISSING_PACKAGES! opencvsharp4.runtime.win.4.9.0.20240103"
if not exist "%LOCAL_NUGET_DIR%\microsoft.netcore.app.runtime.win-x64.8.0.27.nupkg" set "MISSING_PACKAGES=!MISSING_PACKAGES! microsoft.netcore.app.runtime.win-x64.8.0.27"
if not exist "%LOCAL_NUGET_DIR%\microsoft.windowsdesktop.app.runtime.win-x64.8.0.27.nupkg" set "MISSING_PACKAGES=!MISSING_PACKAGES! microsoft.windowsdesktop.app.runtime.win-x64.8.0.27"
if not exist "%LOCAL_NUGET_DIR%\microsoft.aspnetcore.app.runtime.win-x64.8.0.27.nupkg" set "MISSING_PACKAGES=!MISSING_PACKAGES! microsoft.aspnetcore.app.runtime.win-x64.8.0.27"
:: 检查传递依赖包（这些是必需的 transitive dependencies）
if not exist "%LOCAL_NUGET_DIR%\system.runtime.compilerServices.unsafe.nupkg" set "MISSING_PACKAGES=!MISSING_PACKAGES! System.Runtime.CompilerServices.Unsafe"
if not exist "%LOCAL_NUGET_DIR%\system.memory.nupkg" set "MISSING_PACKAGES=!MISSING_PACKAGES! System.Memory"

if not defined MISSING_PACKAGES (
    set "USE_LOCAL_NUGET=true"
    echo 检测到完整的本地 NuGet 包，将完全使用本地源（无需网络）
) else (
    echo 本地 NuGet 包不完整，缺少以下包：
    echo !MISSING_PACKAGES!
    echo 将使用网络源进行编译
)

echo.
echo [1/3] 正在检查并恢复 NuGet 包...

if "%USE_LOCAL_NUGET%"=="true" (
    :: 使用纯本地源还原（不连接网络）- 强制重新还原以确保使用本地源
    echo 使用纯本地源还原（无需网络）...
    
    :: 创建临时 NuGet.Config，只使用本地源
    echo ^<?xml version="1.0" encoding="utf-8"?^> > "%NUGET_CONFIG%"
    echo ^<configuration^> >> "%NUGET_CONFIG%"
    echo   ^<packageSources^> >> "%NUGET_CONFIG%"
    echo     ^<clear /^> >> "%NUGET_CONFIG%"
    echo     ^<add key="Local" value="%cd%\%LOCAL_NUGET_DIR%" /^> >> "%NUGET_CONFIG%"
    echo   ^</packageSources^> >> "%NUGET_CONFIG%"
    echo ^</configuration^> >> "%NUGET_CONFIG%"
    
    dotnet restore "ShioriC#.csproj" --configfile "%NUGET_CONFIG%" --no-cache
    if errorlevel 1 (
        echo 错误: 本地还原失败
        del "%NUGET_CONFIG%"
        pause
        exit /b 1
    )
    
    del "%NUGET_CONFIG%"
    echo 本地还原成功
) else (
    :: 使用网络源还原
    if not exist "obj\project.assets.json" (
        echo 检测到需要还原依赖包...
        echo 尝试使用网络源还原 NuGet 包...
        dotnet restore "ShioriC#.csproj" --no-cache
        if errorlevel 1 (
            echo 错误: 网络还原失败
            pause
            exit /b 1
        )
        echo 网络还原成功
    ) else (
        echo 依赖已缓存，跳过还原步骤
    )
)

echo [2/3] 正在编译发布版本 (Shiori.exe)...
:: 如果使用本地源，创建临时配置文件
set "PUBLISH_CONFIG="
if "%USE_LOCAL_NUGET%"=="true" (
    echo ^<?xml version="1.0" encoding="utf-8"?^> > "%NUGET_CONFIG%"
    echo ^<configuration^> >> "%NUGET_CONFIG%"
    echo   ^<packageSources^> >> "%NUGET_CONFIG%"
    echo     ^<clear /^> >> "%NUGET_CONFIG%"
    echo     ^<add key="Local" value="%cd%\%LOCAL_NUGET_DIR%" /^> >> "%NUGET_CONFIG%"
    echo   ^</packageSources^> >> "%NUGET_CONFIG%"
    echo ^</configuration^> >> "%NUGET_CONFIG%"
    set "PUBLISH_CONFIG=--configfile %NUGET_CONFIG%"
)

:: 使用配置进行发布
dotnet publish "ShioriC#.csproj" -c Release -r win-x64 --self-contained true -o dist --no-restore /p:NuGetAudit=false %PUBLISH_CONFIG%
if errorlevel 1 (
    echo 错误: 发布失败
    if exist "%NUGET_CONFIG%" del "%NUGET_CONFIG%"
    pause
    exit /b 1
)

echo [3/3] 正在编译调试版本 (Shiori_debug.exe)...
:: 使用配置进行发布
dotnet publish "ShioriC#.csproj" -c Debug -r win-x64 --self-contained true -o dist --no-restore /p:NuGetAudit=false %PUBLISH_CONFIG%

:: 清理临时配置文件
if exist "%NUGET_CONFIG%" del "%NUGET_CONFIG%"

echo.
:: 清理多余文件，只保留两个 exe
echo [额外步骤] 正在清理多余文件...
if exist dist\ico rmdir /s /q dist\ico
if exist dist\Shiori.exe.WebView2 rmdir /s /q dist\Shiori.exe.WebView2
if exist dist\Shiori_debug.exe.WebView2 rmdir /s /q dist\Shiori_debug.exe.WebView2
if exist dist\ShioriCSharp rmdir /s /q dist\ShioriCSharp
for /d %%i in (dist\*) do (
    if not "%%~nxi"=="." (
        if not "%%~nxi"==".." (
            if not exist "%%i\*.exe" rmdir /s /q "%%i"
        )
    )
)
del /q dist\*.pdb 2>nul
del /q dist\*.deps.json 2>nul
del /q dist\*.runtimeconfig.json 2>nul

echo.
echo ========================================
echo   编译完成！
echo ========================================
echo 输出位置: %~dp0dist
echo 发布版本: Shiori.exe
echo 调试版本: Shiori_debug.exe
pause
