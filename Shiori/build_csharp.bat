@echo off
chcp 65001 >nul
echo ========================================
echo   Shiori Engine Launcher - C# 编译脚本
echo ========================================
echo.

echo [1/3] 正在检查并恢复 NuGet 包...
:: 检查依赖是否已还原（通过 obj\project.assets.json 判断）
if not exist "obj\project.assets.json" (
    echo 检测到需要还原依赖包...
    dotnet restore "ShioriC#.csproj"
    if errorlevel 1 (
        echo 错误: 依赖恢复失败
        pause
        exit /b 1
    )
) else (
    echo 依赖已缓存，跳过还原步骤
)

echo [2/3] 正在编译发布版本 (Shiori.exe)...
:: 使用 --no-restore 跳过隐式还原，添加 /p:NuGetAudit=false 禁用漏洞检查
dotnet publish "ShioriC#.csproj" -c Release -r win-x64 --self-contained false -o dist --no-restore /p:NuGetAudit=false
if errorlevel 1 (
    echo 错误: 发布失败
    pause
    exit /b 1
)

echo [3/3] 正在编译调试版本 (Shiori_debug.exe)...
:: 使用 --no-restore 跳过隐式还原，添加 /p:NuGetAudit=false 禁用漏洞检查
dotnet publish "ShioriC#.csproj" -c Debug -r win-x64 --self-contained false -o dist --no-restore /p:NuGetAudit=false

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
