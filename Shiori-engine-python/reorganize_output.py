"""
PyInstaller 输出后处理脚本
将 _internal 中的文件按类型分离到 plugins 和 dependency 目录
"""
import os
import sys
from pathlib import Path
import shutil


def organize_pyinstaller_output(source_dir: str, output_dir: str = None):
    """
    整理 PyInstaller 输出目录
    
    Args:
        source_dir: PyInstaller 生成的 dist/Shiori 目录
        output_dir: 整理后的输出目录（默认为 Shiori/output）
    """
    source = Path(source_dir)
    
    # 如果未指定 output_dir，则在源目录的父目录（Shiori）下创建 output
    if output_dir is None:
        shiori_dir = source.parent  # Shiori 目录
        output_dir = shiori_dir / "output"
    
    output = Path(output_dir)
    
    if not source.exists():
        print(f"[ERROR] 源目录不存在: {source}")
        sys.exit(1)
    
    # 清理旧的 output 目录
    if output.exists():
        print(f"[INFO] 清理旧的 output 目录...")
        shutil.rmtree(output)
    
    # 创建输出目录结构
    plugins_dir = output / "plugins"
    dependency_dir = output / "dependency"
    
    plugins_dir.mkdir(parents=True, exist_ok=True)
    dependency_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"[INFO] 开始整理 PyInstaller 输出...")
    print(f"[INFO] 源目录: {source}")
    print(f"[INFO] 输出目录: {output}")
    
    # 复制 exe 文件到输出根目录
    exe_files = list(source.glob("*.exe"))
    for exe in exe_files:
        dest = output / exe.name
        shutil.copy2(exe, dest)
        print(f"[OK] 复制 exe: {exe.name}")
    
    # 处理 _internal 目录
    internal_dir = source / "_internal"
    if not internal_dir.exists():
        print(f"[ERROR] _internal 目录不存在: {internal_dir}")
        sys.exit(1)
    
    dll_count = 0
    pyd_count = 0
    other_count = 0
    
    print(f"[INFO] 正在分类 _internal 中的文件...")
    
    # 遍历 _internal 中的所有文件和目录
    for item in internal_dir.rglob("*"):
        if item.is_file():
            relative_path = item.relative_to(internal_dir)
            
            # 判断文件类型
            if item.suffix.lower() in ['.dll']:
                # DLL 文件 -> plugins
                dest = plugins_dir / relative_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dest)
                dll_count += 1
                
            elif item.suffix.lower() in ['.pyd']:
                # PYD 文件（Python 扩展模块，本质也是 DLL）-> plugins
                dest = plugins_dir / relative_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dest)
                pyd_count += 1
                
            else:
                # 其他文件 -> dependency
                dest = dependency_dir / relative_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dest)
                other_count += 1
    
    print(f"\n[INFO] 整理完成:")
    print(f"  - DLL 文件: {dll_count} 个 -> plugins/")
    print(f"  - PYD 文件: {pyd_count} 个 -> plugins/")
    print(f"  - 其他文件: {other_count} 个 -> dependency/")
    print(f"  - 总计: {dll_count + pyd_count + other_count} 个文件")
    
    # 复制必要的启动脚本或配置文件（如果存在）
    for item in source.iterdir():
        if item.is_file() and item.suffix.lower() in ['.bat', '.cmd', '.json', '.yaml', '.yml']:
            dest = output / item.name
            shutil.copy2(item, dest)
            print(f"[OK] 复制配置: {item.name}")
    
    print(f"\n[INFO] 输出目录结构:")
    print(f"  {output}/")
    print(f"  ├── Shiori.exe")
    print(f"  ├── Shiori_debug.exe")
    print(f"  ├── plugins/          ({dll_count + pyd_count} 个 DLL/PYD 文件)")
    print(f"  └── dependency/       ({other_count} 个其他文件)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python reorganize_output.py <source_dir> <output_dir>")
        print("示例: python reorganize_output.py dist/Shiori dist/Shiori_organized")
        sys.exit(1)
    
    source_directory = sys.argv[1]
    output_directory = sys.argv[2]
    
    organize_pyinstaller_output(source_directory, output_directory)
