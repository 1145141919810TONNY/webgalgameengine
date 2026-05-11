"""
Shiori Engine Launcher - 主程序入口
基于 Python + PyQt6 + QtWebEngine 的独立桌面应用程序
"""
import sys
import os
from pathlib import Path

# 添加当前目录到路径
current_dir = Path(__file__).parent.absolute()
sys.path.insert(0, str(current_dir))

from shiori_app import ShioriApplication
from version import APP_NAME, VERSION


def main():
    """主函数入口"""
    # 检查是否为调试模式
    is_debug = '--debug' in sys.argv or 'Shiori_debug' in sys.executable
    
    if is_debug:
        print(f"[INFO] {APP_NAME} v{VERSION}")
        print(f"[INFO] 启动中...")
    
    try:
        # 启用 QtWebEngine 视频编解码器支持
        # 必须在 QApplication 创建之前设置
        # Windows 环境下建议使用更简洁的配置，禁用 GPU 沙箱并尝试软解以提高兼容性
        os.environ['QTWEBENGINE_CHROMIUM_FLAGS'] = (
            '--single-process '
            '--no-sandbox '
            '--disable-gpu-sandbox '
            '--disable-software-rasterizer '
            '--enable-webgl '
            '--allow-file-access-from-files '
            '--disable-dev-shm-usage '
            '--use-fake-ui-for-media-stream '
            '--enable-features=TranslateUI '
            '--disable-ipc-floating '
            '--enable-accelerated-video-decode '
            '--enable-gpu-compositing '
            # 启用媒体解码器支持
            '--enable-features=FFmpegVideoDecoder '
            '--enable-blink-features=PlatformEncryptedMedia '
            '--disable-features=VaapiVideoDecoder,UseOzonePlatform'
        )
        
        app = ShioriApplication(is_debug=is_debug)
        app.run()
    except Exception as e:
        if is_debug:
            print(f"[ERROR] 程序启动失败: {e}")
            import traceback
            traceback.print_exc()
        else:
            from PyQt6.QtWidgets import QMessageBox, QApplication
            temp_app = QApplication(sys.argv)
            QMessageBox.critical(None, "错误", f"{APP_NAME} 启动失败:\n{str(e)}")
        sys.exit(1)


if __name__ == '__main__':
    main()
