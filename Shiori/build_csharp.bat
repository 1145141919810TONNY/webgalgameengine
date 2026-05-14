@echo off
chcp 65001 >nul
echo ========================================
echo   Shiori Engine Launcher - C# 编译脚本
echo ========================================
echo.

echo [1/3] 正在恢复 NuGet 包...
dotnet restore "ShioriC#.csproj"
if errorlevel 1 (
    echo 错误: 依赖恢复失败
    pause
    exit /b 1
)

echo [2/3] 正在编译发布版本 (Shiori.exe)...
dotnet publish "ShioriC#.csproj" -c Release -r win-x64 --self-contained false -o dist
if errorlevel 1 (
    echo 错误: 发布失败
    pause
    exit /b 1
)

echo [3/3] 正在编译调试版本 (Shiori_debug.exe)...
dotnet publish "ShioriC#.csproj" -c Debug -r win-x64 --self-contained false -o dist

:: 清理多余文件，只保留两个 exe
echo [4/4] 正在清理多余文件...
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
