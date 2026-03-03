@echo off
chcp 65001 >nul
echo ====================================
echo   清理编译产物脚本
echo ====================================
echo.
echo [信息] 正在删除编译生成的临时文件夹...
echo.

:: 尝试删除 .vs 文件夹（如果失败则跳过）
if exist ".vs" (
    rmdir /S /Q ".vs" 2>nul
    if %errorlevel% equ 0 (
        echo [完成] 已删除 .vs 文件夹
    ) else (
        echo [警告] .vs 文件夹被占用，无法删除（请关闭 VS 后重试）
    )
) else (
    echo [信息] .vs 文件夹不存在
)

:: 删除 bin 和 obj 文件夹
if exist "bin" (
    rmdir /S /Q "bin"
    echo [完成] 已删除 bin 文件夹
)

if exist "obj" (
    rmdir /S /Q "obj"
    echo [完成] 已删除 obj 文件夹
)

echo.
echo ====================================
echo   清理完成！
echo ====================================
echo.
echo 保留的文件:
echo - Program.cs
echo - GalgameLauncher.csproj
echo - build_and_deploy.bat
echo - README.md
echo - 快速指南.txt
echo - .gitignore
echo.
echo 按任意键退出...
pause >nul
