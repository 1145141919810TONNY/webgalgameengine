"""
Shiori 主应用程序
整合 HTTP 服务器、QtWebEngine 窗口和 API 桥接
"""
import sys
import os
from pathlib import Path
from PyQt6.QtWidgets import QApplication, QMainWindow, QMessageBox, QMenuBar, QMenu
from PyQt6.QtCore import Qt, QUrl, QSettings
from PyQt6.QtGui import QAction, QIcon, QKeySequence
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebEngineCore import QWebEngineProfile, QWebEngineSettings
from PyQt6.QtWebChannel import QWebChannel

from http_server import ShioriHTTPServer
from api_bridge import ShioriAPI
from version import VERSION, APP_NAME, AUTHOR, COPYRIGHT, DESCRIPTION


class ShioriApplication:
    """Shiori 应用程序主类"""
    
    def __init__(self, is_debug: bool = False):
        self.is_debug = is_debug
        self.app = QApplication(sys.argv)
        
        # 设置应用信息
        self.app.setApplicationName(APP_NAME)
        self.app.setApplicationVersion(VERSION)
        self.app.setOrganizationName(AUTHOR)
        self.app.setOrganizationDomain("shiori-engine.local")
        
        # 获取程序所在目录
        if getattr(sys, 'frozen', False):
            # 打包后的 exe
            self.app_dir = Path(sys.executable).parent
            
            # 单文件模式：PyInstaller 会解压到临时目录
            if hasattr(sys, '_MEIPASS'):
                # 这是 PyInstaller 的临时解压目录
                self._temp_dir = Path(sys._MEIPASS)
                if self.is_debug:
                    print(f"[INFO] 单文件模式 - 临时目录: {self._temp_dir}")
        else:
            # 开发环境
            self.app_dir = Path(__file__).parent.absolute()
            self._temp_dir = None
        
        if self.is_debug:
            print(f"[INFO] 程序目录: {self.app_dir}")
            print(f"[INFO] 调试模式: {'开启' if self.is_debug else '关闭'}")
        
        # 单文件模式不需要 dependency/plugins 目录
        # 所有依赖都已打包进 exe
        
        # 验证引擎文件夹
        self.engine_dir = self.app_dir / "shiori engine"
        self.index_file = self.engine_dir / "index.html"
        
        if not self.engine_dir.exists() or not self.index_file.exists():
            self._show_engine_not_found_error()
            sys.exit(1)
        
        if self.is_debug:
            print(f"[INFO] 引擎目录: {self.engine_dir}")
        
        # 初始化组件
        self.http_server = None
        self.main_window = None
        self.api_bridge = None
    
    def run(self):
        """运行应用程序"""
        try:
            # 启动 HTTP 服务器
            self._start_http_server()
            
            # 创建主窗口
            self._create_main_window()
            
            # 运行事件循环
            exit_code = self.app.exec()
            
            # 清理资源
            self._cleanup()
            
            sys.exit(exit_code)
            
        except Exception as e:
            error_msg = f"程序运行错误:\n{str(e)}"
            if self.is_debug:
                print(f"[ERROR] {error_msg}")
                import traceback
                traceback.print_exc()
            
            QMessageBox.critical(None, "错误", error_msg)
            self._cleanup()
            sys.exit(1)
    
    def force_quit(self):
        """强制退出应用程序，确保所有进程都被终止"""
        if self.is_debug:
            print("[INFO] 强制退出应用程序...")
        
        # 先尝试正常清理
        self._cleanup()
        
        # 强制退出
        import os
        import signal
        
        # 对于Windows系统，使用os._exit确保完全退出
        if os.name == 'nt':  # Windows
            os._exit(0)
        else:  # Unix-like systems
            os.kill(os.getpid(), signal.SIGTERM)
    
    def _start_http_server(self):
        """启动 HTTP 服务器"""
        self.http_server = ShioriHTTPServer(
            root_dir=str(self.engine_dir),
            is_debug=self.is_debug
        )
        
        try:
            port = self.http_server.start(start_port=8080, end_port=8099)
            self.server_url = f"http://localhost:{port}/index.html"
            
            if self.is_debug:
                print(f"[INFO] 服务器 URL: {self.server_url}")
                
        except RuntimeError as e:
            QMessageBox.critical(
                None, 
                "错误", 
                f"无法启动本地服务:\n{str(e)}\n\n请确保没有其他程序占用 8080-8099 端口。"
            )
            sys.exit(1)
    
    def _create_main_window(self):
        """创建主窗口"""
        self.main_window = ShioriMainWindow(
            server_url=self.server_url,
            app_dir=str(self.app_dir),
            is_debug=self.is_debug
        )
        
        self.main_window.show()
        
        if self.is_debug:
            print("[INFO] 主窗口已创建")
    
    def _cleanup(self):
        """清理资源"""
        if self.is_debug:
            print("[INFO] 正在清理资源...")
        
        # 停止 HTTP 服务器
        if self.http_server:
            try:
                self.http_server.stop()
            except Exception as e:
                if self.is_debug:
                    print(f"[WARN] 停止HTTP服务器时出错: {e}")
        
        # 清理API桥接
        if hasattr(self, 'api_bridge') and self.api_bridge:
            try:
                self.api_bridge.deleteLater()
            except Exception as e:
                if self.is_debug:
                    print(f"[WARN] 清理API桥接时出错: {e}")
        
        if self.is_debug:
            print("[INFO] 资源清理完成")
    
    def _show_engine_not_found_error(self):
        """显示引擎未找到错误"""
        error_msg = f"未找到引擎文件夹或入口文件，请确保 'shiori engine' 文件夹与程序同级"
        
        if self.is_debug:
            print(f"[ERROR] {error_msg}")
            print(f"[ERROR] 期望路径: {self.engine_dir}")
            print(f"[ERROR] 期望文件: {self.index_file}")
        
        QMessageBox.critical(None, APP_NAME, error_msg)


class ShioriMainWindow(QMainWindow):
    """Shiori 主窗口"""
    
    def __init__(self, server_url: str, app_dir: str, is_debug: bool = False):
        super().__init__()
        
        self.server_url = server_url
        self.app_dir = Path(app_dir)
        self.is_debug = is_debug
        self._is_closing = False  # 防止重复关闭
        
        # 窗口基本设置
        self.setWindowTitle(APP_NAME)
        self.setMinimumSize(800, 600)
        self.resize(1280, 800)
        
        # 居中显示
        self._center_on_screen()
        
        # 创建 WebEngine 视图
        self._setup_webengine()
        
        # 创建菜单
        self._setup_menu()
        
        # 加载页面
        self.web_view.load(QUrl(self.server_url))
        
        if self.is_debug:
            print(f"[INFO] 正在加载: {self.server_url}")
    
    def _center_on_screen(self):
        """将窗口居中显示在主屏幕"""
        from PyQt6.QtWidgets import QStyle
        
        # 获取屏幕几何信息
        screen = self.screen()
        if screen:
            screen_geometry = screen.availableGeometry()
            window_geometry = self.frameGeometry()
            
            # 计算居中位置
            x = screen_geometry.center().x() - window_geometry.width() // 2
            y = screen_geometry.center().y() - window_geometry.height() // 2
            
            self.move(x, y)
    
    def _setup_webengine(self):
        """配置 WebEngine"""
        # 创建 WebEngine 视图
        self.web_view = QWebEngineView(self)
        self.setCentralWidget(self.web_view)
        
        # 配置 WebEngine 设置
        settings = self.web_view.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        
        # 禁用不必要的功能以加速关闭
        settings.setAttribute(QWebEngineSettings.WebAttribute.PluginsEnabled, False)
        settings.setAttribute(QWebEngineSettings.WebAttribute.FullScreenSupportEnabled, True)
        
        # 配置配置文件（禁用持久化缓存）
        profile = QWebEngineProfile.defaultProfile()
        try:
            # 尝试使用新版 API
            profile.setPersistentCookiesPolicy(
                QWebEngineProfile.PersistentCookiesPolicy.NoPersistentCookies
            )
        except AttributeError:
            # 如果 API 不存在，忽略（不影响基本功能）
            if self.is_debug:
                print("[INFO] 使用默认持久化策略")
        
        # 设置 QWebChannel 用于 Python-JS 互操作
        self._setup_webchannel()
        
        # 捕获 JavaScript 控制台消息
        try:
            self.web_view.page().javaScriptConsoleMessage.connect(
                self._on_js_console_message
            )
        except AttributeError:
            # 如果 javaScriptConsoleMessage 不是信号，忽略
            if self.is_debug:
                print("[INFO] JavaScript 控制台消息捕获不可用")
        
        # 设置快捷键
        self._setup_shortcuts()
    
    def _setup_webchannel(self):
        """设置 QWebChannel 用于 Python-JS 互操作"""
        # 创建 API 桥接对象
        self.api_bridge = ShioriAPI(
            app_dir=str(self.app_dir),
            is_debug=self.is_debug
        )
        
        # 创建 WebChannel
        self.web_channel = QWebChannel(self)
        self.web_channel.registerObject("ShioriAPI", self.api_bridge)
        
        # 将 WebChannel 设置到页面
        self.web_view.page().setWebChannel(self.web_channel)
        
        if self.is_debug:
            print("[INFO] QWebChannel 已初始化")
    
    def _setup_shortcuts(self):
        """设置键盘快捷键"""
        # F5 - 刷新
        refresh_action = QAction("刷新", self)
        refresh_action.setShortcut(Qt.Key.Key_F5)
        refresh_action.triggered.connect(lambda: self.web_view.reload())
        self.addAction(refresh_action)
        
        # F11 - 全屏切换
        fullscreen_action = QAction("全屏切换", self)
        fullscreen_action.setShortcut(Qt.Key.Key_F11)
        fullscreen_action.triggered.connect(self._toggle_fullscreen)
        self.addAction(fullscreen_action)
        
        # F12 - 开发者工具（仅调试版）
        if self.is_debug:
            devtools_action = QAction("开发者工具", self)
            devtools_action.setShortcut(Qt.Key.Key_F12)
            devtools_action.triggered.connect(self._toggle_devtools)
            self.addAction(devtools_action)
    
    def _setup_menu(self):
        """创建菜单栏"""
        menubar = self.menuBar()
        
        # 文件菜单
        file_menu = menubar.addMenu("文件(&F)")
        
        # 打开引擎文件夹
        open_folder_action = QAction("打开引擎文件夹", self)
        open_folder_action.triggered.connect(self._open_engine_folder)
        file_menu.addAction(open_folder_action)
        
        # 重新加载引擎
        reload_action = QAction("重新加载引擎", self)
        reload_action.setShortcut(Qt.Key.Key_F5)
        reload_action.triggered.connect(lambda: self.web_view.reload())
        file_menu.addAction(reload_action)
        
        file_menu.addSeparator()
        
        # 退出
        exit_action = QAction("退出", self)
        exit_action.setShortcut(QKeySequence.StandardKey.Quit)
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)
        
        # 视图菜单
        view_menu = menubar.addMenu("视图(&V)")
        
        # 刷新
        view_refresh_action = QAction("刷新", self)
        view_refresh_action.setShortcut(Qt.Key.Key_F5)
        view_refresh_action.triggered.connect(lambda: self.web_view.reload())
        view_menu.addAction(view_refresh_action)
        
        # 开发者工具（仅调试版）
        devtools_menu_action = QAction("开发者工具", self)
        devtools_menu_action.setShortcut(Qt.Key.Key_F12)
        devtools_menu_action.triggered.connect(self._toggle_devtools)
        devtools_menu_action.setEnabled(self.is_debug)
        view_menu.addAction(devtools_menu_action)
        
        view_menu.addSeparator()
        
        # 全屏切换
        fullscreen_menu_action = QAction("全屏切换", self)
        fullscreen_menu_action.setShortcut(Qt.Key.Key_F11)
        fullscreen_menu_action.triggered.connect(self._toggle_fullscreen)
        view_menu.addAction(fullscreen_menu_action)
        
        # 帮助菜单
        help_menu = menubar.addMenu("帮助(&H)")
        
        # 关于
        about_action = QAction("关于", self)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)
    
    def _open_engine_folder(self):
        """打开引擎文件夹"""
        import subprocess
        import platform
        
        engine_path = str(self.app_dir / "shiori engine")
        
        if platform.system() == "Windows":
            os.startfile(engine_path)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", engine_path])
        else:
            subprocess.Popen(["xdg-open", engine_path])
        
        if self.is_debug:
            print(f"[DEBUG] 打开引擎文件夹: {engine_path}")
    
    def _toggle_fullscreen(self):
        """切换全屏模式"""
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()
        
        if self.is_debug:
            print(f"[DEBUG] 全屏模式: {self.isFullScreen()}")
    
    def _toggle_devtools(self):
        """切换开发者工具"""
        if not self.is_debug:
            return
        
        # 检查是否已经存在开发者工具
        if hasattr(self, 'devtools_view') and self.devtools_view:
            self.devtools_view.close()
            self.devtools_view = None
        else:
            # 创建开发者工具窗口
            from PyQt6.QtWebEngineWidgets import QWebEngineView
            
            self.devtools_view = QWebEngineView()
            self.devtools_view.setWindowTitle("开发者工具")
            self.devtools_view.resize(800, 600)
            
            # 将开发者工具附加到主视图
            page = self.web_view.page()
            page.setDevToolsPage(self.devtools_view.page())
            
            self.devtools_view.show()
        
        if self.is_debug:
            print("[DEBUG] 开发者工具切换")
    
    def _show_about(self):
        """显示关于对话框"""
        try:
            from PyQt6.QtCore import QT_VERSION_STR
            from PyQt6 import PYQT_VERSION_STR
            
            # 尝试获取 QtWebEngine 版本
            try:
                from PyQt6.QtWebEngineCore import QWebEngineSettings
                webengine_version = "Chromium (QtWebEngine)"
            except:
                webengine_version = "未知"
            
            about_text = f"""
<h2>{APP_NAME}</h2>
<table border="0" cellpadding="5">
<tr><td><b>Shiori Engine:</b></td><td>V2.0.0</td></tr>
<tr><td><b>Shiori Engine exe:</b></td><td>V1.1.0</td></tr>
</table>
<hr>
<p><b>技术栈:</b></p>
<ul>
<li>Python: {sys.version.split()[0]}</li>
<li>Qt: {QT_VERSION_STR}</li>
<li>PyQt6: {PYQT_VERSION_STR}</li>
<li>WebEngine: {webengine_version}</li>
</ul>
<p>描述: {DESCRIPTION}</p>
<p>{COPYRIGHT}</p>
            """
            
            QMessageBox.about(self, f"关于 {APP_NAME}", about_text)
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] 关于对话框错误: {e}")
                import traceback
                traceback.print_exc()
            
            # 如果出错，显示简化的关于信息
            simple_text = f"""
<h2>{APP_NAME}</h2>
<table border="0" cellpadding="5">
<tr><td><b>Shiori Engine:</b></td><td>V2.0.0</td></tr>
<tr><td><b>Shiori Engine exe:</b></td><td>V1.1.0</td></tr>
</table>
<p>{COPYRIGHT}</p>
            """
            QMessageBox.about(self, f"关于 {APP_NAME}", simple_text)
    
    def _on_js_console_message(self, level, message, line_number, source_id):
        """处理 JavaScript 控制台消息"""
        if not self.is_debug:
            return
        
        level_map = {
            0: "LOG",
            1: "WARNING", 
            2: "ERROR"
        }
        
        level_str = level_map.get(level, "UNKNOWN")
        print(f"[JS-{level_str}] {message} (line {line_number}, {source_id})")
    
    def closeEvent(self, event):
        """窗口关闭事件"""
        # 防止重复关闭
        if self._is_closing:
            event.ignore()
            return
        
        self._is_closing = True
        
        if self.is_debug:
            print("[INFO] 窗口关闭，正在退出程序...")
        
        # 立即接受事件，避免阻塞UI
        event.accept()
        
        # 异步执行清理操作，避免阻塞关闭窗口
        from PyQt6.QtCore import QTimer
        QTimer.singleShot(0, self._async_cleanup)
    
    def _async_cleanup(self):
        """异步清理资源"""
        try:
            # 关闭开发者工具（如果打开）
            if hasattr(self, 'devtools_view') and self.devtools_view:
                self.devtools_view.close()
                self.devtools_view.deleteLater()
            
            # 快速清理 WebEngine 资源 - 不等待JS执行完成
            try:
                # 使用非阻塞方式停止媒体播放
                self.web_view.page().runJavaScript("""
                    // 快速停止所有音频和视频
                    try {
                        var audios = document.querySelectorAll('audio');
                        var videos = document.querySelectorAll('video');
                        audios.forEach(function(audio) { 
                            try { audio.pause(); } catch(e) {}
                            try { audio.src = ''; } catch(e) {}
                        });
                        videos.forEach(function(video) { 
                            try { video.pause(); } catch(e) {}
                            try { video.src = ''; } catch(e) {}
                        });
                    } catch(e) {}
                """)
            except Exception as e:
                if self.is_debug:
                    print(f"[WARN] 清理 WebEngine 资源时出错: {e}")
            
            # 强制删除Web视图以加速资源释放
            if hasattr(self, 'web_view') and self.web_view:
                self.web_view.stop()
                self.web_view.deleteLater()
            
            # 清理其他资源
            self._cleanup()
            
            # 延迟一小段时间后强制退出，确保清理完成
            from PyQt6.QtCore import QTimer
            QTimer.singleShot(500, self._force_quit)
            
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] 清理过程中出错: {e}")
                import traceback
                traceback.print_exc()
    
    def _force_quit(self):
        """强制退出应用程序"""
        if self.is_debug:
            print("[INFO] 执行强制退出...")
        
        # 获取主应用实例并强制退出
        app_instance = QApplication.instance()
        if app_instance:
            app_instance.quit()
        
        # 如果quit没有生效，使用更强制的方式
        import os
        import sys
        os._exit(0)
