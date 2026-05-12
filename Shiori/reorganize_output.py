"""
PyInstaller 输出后处理脚本
将 _internal 中的文件按类型分离到 plugins 和 dependency 目录
"""
import os
import sys
from pathlib import Path
import shutil


def organize_pyinstaller_output(dist_dir: str):
    """
    整理 PyInstaller 输出目录，将两个版本的 exe 合并到 dist 根目录并共享 _internal
    
    Args:
        dist_dir: PyInstaller 的 dist 目录路径
    """
    dist = Path(dist_dir)
    
    if not dist.exists():
        print(f"[ERROR] dist 目录不存在: {dist}")
        sys.exit(1)
    
    print(f"[INFO] 开始整理 dist 目录...")
    print(f"[INFO] dist 目录: {dist}")
    
    # 查找编译生成的子目录
    shiori_dir = dist / "Shiori"
    shiori_debug_dir = dist / "Shiori_debug"
    
    if not shiori_dir.exists():
        print(f"[ERROR] 未找到 Shiori 编译输出: {shiori_dir}")
        sys.exit(1)
    
    if not shiori_debug_dir.exists():
        print(f"[ERROR] 未找到 Shiori_debug 编译输出: {shiori_debug_dir}")
        sys.exit(1)
    
    # 1. 复制 Shiori.exe 到 dist 根目录
    shiori_exe = shiori_dir / "Shiori.exe"
    if shiori_exe.exists():
        shutil.copy2(shiori_exe, dist / "Shiori.exe")
        print(f"[OK] 复制 Shiori.exe 到 dist 根目录")
    else:
        print(f"[ERROR] 未找到 Shiori.exe")
        sys.exit(1)
    
    # 2. 复制 Shiori_debug.exe 到 dist 根目录
    debug_exe = shiori_debug_dir / "Shiori_debug.exe"
    if debug_exe.exists():
        shutil.copy2(debug_exe, dist / "Shiori_debug.exe")
        print(f"[OK] 复制 Shiori_debug.exe 到 dist 根目录")
    else:
        print(f"[ERROR] 未找到 Shiori_debug.exe")
        sys.exit(1)
    
    # 3. 移动 _internal 文件夹到 dist 根目录（从 Shiori 目录获取）
    src_internal = shiori_dir / "_internal"
    dest_internal = dist / "_internal"
    
    if src_internal.exists():
        if dest_internal.exists():
            print(f"[INFO] 清理已存在的 _internal 目录...")
            shutil.rmtree(dest_internal)
        shutil.move(str(src_internal), str(dest_internal))
        print(f"[OK] 移动 _internal 到 dist 根目录")
    else:
        print(f"[ERROR] 未找到 _internal 目录")
        sys.exit(1)
    
    # 4. 清理临时编译目录
    print(f"[INFO] 清理临时编译目录...")
    if shiori_dir.exists():
        shutil.rmtree(shiori_dir)
        print(f"[OK] 删除 {shiori_dir.name}")
    
    if shiori_debug_dir.exists():
        shutil.rmtree(shiori_debug_dir)
        print(f"[OK] 删除 {shiori_debug_dir.name}")
    
    print(f"\n[INFO] 整理完成!")
    print(f"[INFO] 最终结构:")
    print(f"  {dist}/")
    print(f"  ├── Shiori.exe (正式版)")
    print(f"  ├── Shiori_debug.exe (调试版)")
    print(f"  └── _internal/ (共享依赖库)")
    print(f"\n[提示] 请确保将 'shiori engine' 文件夹也复制到 {dist} 目录下以正常运行。")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python reorganize_output.py <dist_dir>")
        print("示例: python reorganize_output.py dist")
        sys.exit(1)
    
    dist_directory = sys.argv[1]
    organize_pyinstaller_output(dist_directory)
