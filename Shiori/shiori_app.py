"""
Shiori 主应用程序
整合 HTTP 服务器、QtWebEngine 窗口和 API 桥接
"""
import sys
import os
import re
from pathlib import Path
from PyQt6.QtWidgets import QApplication, QMainWindow, QMessageBox, QMenuBar, QMenu
from PyQt6.QtCore import Qt, QUrl, QSettings
from PyQt6.QtGui import QAction, QIcon, QKeySequence
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebEngineCore import QWebEngineProfile, QWebEngineSettings, QWebEnginePage
from PyQt6.QtWebChannel import QWebChannel

from http_server import ShioriHTTPServer
from api_bridge import ShioriAPI
from video_decoder import VideoDecoder
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
            # 打包后的 exe (onedir 模式)
            self.app_dir = Path(sys.executable).parent
        else:
            # 开发环境
            self.app_dir = Path(__file__).parent.absolute()
        
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
            # 重要：固定使用端口 8080，确保 localStorage Origin 一致
            port = self.http_server.start(start_port=8080)
            self.server_url = f"http://localhost:{port}/index.html"
            
            if self.is_debug:
                print(f"[INFO] 服务器 URL: {self.server_url}")
                print(f"[INFO] 固定端口 {port} 确保 localStorage 持久化")
                
        except RuntimeError as e:
            QMessageBox.critical(
                None, 
                "错误", 
                f"无法启动本地服务:\n{str(e)}\n\n请确保没有其他程序占用端口 8080。"
            )
            sys.exit(1)
    
    def _create_main_window(self):
        """创建主窗口"""
        # 图标目录位置：始终在程序同级目录下
        icon_dir = self.app_dir / "ico"
        
        self.main_window = ShioriMainWindow(
            server_url=self.server_url,
            app_dir=str(self.app_dir),
            is_debug=self.is_debug,
            icon_dir=icon_dir
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
    
    def __init__(self, server_url: str, app_dir: str, is_debug: bool = False, icon_dir: Path = None):
        super().__init__()
        
        self.server_url = server_url
        self.app_dir = Path(app_dir)
        self.is_debug = is_debug
        self._is_closing = False  # 防止重复关闭
        
        # 设置窗口图标（支持多种尺寸）
        if icon_dir and icon_dir.exists():
            self._setup_window_icon(icon_dir)
        
        # 窗口基本设置
        self.setWindowTitle(APP_NAME)
        self.setMinimumSize(800, 450)  # 最小尺寸保持16:9比例
        self.resize(1280, 720)  # 默认尺寸改为16:9
        
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
    
    def _setup_window_icon(self, icon_dir: Path):
        """设置窗口图标（支持多种尺寸）"""
        try:
            if self.is_debug:
                print(f"[INFO] 正在从目录加载图标: {icon_dir}")
                print(f"[INFO] 目录是否存在: {icon_dir.exists()}")
            
            # 定义需要加载的图标尺寸
            icon_sizes = [
                (16, 'ico16.ico'),
                (32, 'ico32.ico'),
                (64, 'ico64.ico'),
                (128, 'ico128.ico'),
                (256, 'ico256.ico'),
            ]
            
            # 创建 QIcon 对象
            window_icon = QIcon()
            loaded_count = 0
            
            # 添加不同尺寸的图标
            for size, filename in icon_sizes:
                icon_path = icon_dir / filename
                if icon_path.exists():
                    window_icon.addFile(str(icon_path))
                    loaded_count += 1
                    if self.is_debug:
                        print(f"[INFO] 已加载图标: {filename} ({size}x{size})")
                else:
                    if self.is_debug:
                        print(f"[WARN] 图标文件不存在: {icon_path}")
            
            # 设置窗口图标
            if not window_icon.isNull() and loaded_count > 0:
                self.setWindowIcon(window_icon)
                if self.is_debug:
                    print(f"[INFO] 窗口图标已设置（共加载 {loaded_count} 个尺寸）")
            else:
                if self.is_debug:
                    print(f"[ERROR] 未能加载任何图标文件")
                    
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] 设置窗口图标失败: {e}")
                import traceback
                traceback.print_exc()
    
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
    
    def resizeEvent(self, event):
        """重写 resizeEvent 以保持当前宽高比"""
        # 获取新的大小
        new_size = event.size()
        width = new_size.width()
        height = new_size.height()
        
        # 计算期望的高度（基于宽度和当前宽高比）
        expected_height = int(width / self.current_aspect_ratio)
        
        # 如果高度差异超过2像素，则调整
        if abs(height - expected_height) > 2:
            # 阻止事件，设置正确的大小
            from PyQt6.QtCore import QSignalBlocker
            with QSignalBlocker(self):
                self.resize(width, expected_height)
        else:
            # 接受事件
            super().resizeEvent(event)
    
    def _setup_webengine(self):
        """配置 WebEngine"""
        # 配置配置文件（启用持久化存储以保存游戏存档）
        # 注意：必须在创建web_view之前配置profile
        from PyQt6.QtWebEngineCore import QWebEngineProfile, QWebEngineSettings
        
        # 创建自定义profile而不是使用defaultProfile
        storage_path = str(self.app_dir / "shiori_data")
        cache_path = str(self.app_dir / "shiori_cache")
        
        # 确保存储目录存在
        os.makedirs(storage_path, exist_ok=True)
        os.makedirs(cache_path, exist_ok=True)
        
        if self.is_debug:
            print(f"[INFO] 持久化存储路径: {storage_path}")
            print(f"[INFO] 缓存路径: {cache_path}")
        
        # 创建持久化的profile（不使用降级方案，避免与defaultProfile冲突）
        try:
            # 使用带参数的构造函数创建持久化profile
            profile = QWebEngineProfile("shiori_profile", self)
            profile.setPersistentStoragePath(storage_path)
            profile.setCachePath(cache_path)
            profile.setPersistentCookiesPolicy(
                QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies
            )
            
            # 启用所有本地存储功能
            settings_attr = profile.settings()
            settings_attr.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)
            
            if self.is_debug:
                print(f"[INFO] 已创建持久化profile")
                print(f"[INFO] Storage path: {profile.persistentStoragePath()}")
                print(f"[INFO] Cache path: {profile.cachePath()}")
                print(f"[INFO] Cookies policy: {profile.persistentCookiesPolicy()}")
                print(f"[INFO] LocalStorageEnabled: True")
                
        except Exception as e:
            # 严重错误：无法创建持久化profile，直接退出
            error_msg = f"无法创建持久化配置文件:\n{str(e)}\n\n存档功能将无法正常工作。"
            if self.is_debug:
                print(f"[ERROR] {error_msg}")
                import traceback
                traceback.print_exc()
            QMessageBox.critical(None, "致命错误", error_msg)
            sys.exit(1)
        
        # 创建 WebEngine 视图
        self.web_view = QWebEngineView(self)
        
        # 创建使用自定义profile的page
        page = QWebEnginePage(profile, self.web_view)
        self.web_view.setPage(page)
        
        self.setCentralWidget(self.web_view)
        
        # 等待页面加载完成后再进行其他操作，确保localStorage可用
        self.web_view.loadFinished.connect(self._on_page_load_finished)
        
        # 配置 WebEngine 设置
        settings = self.web_view.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        
        # 启用媒体和编解码器支持（关键配置）
        settings.setAttribute(QWebEngineSettings.WebAttribute.PluginsEnabled, True)
        try:
            # Qt 6.5+ 的媒体支持属性
            settings.setAttribute(QWebEngineSettings.WebAttribute.Accelerated2dCanvasEnabled, True)
        except AttributeError:
            pass  # 旧版本Qt可能不支持此属性
        
        settings.setAttribute(QWebEngineSettings.WebAttribute.FullScreenSupportEnabled, True)
        
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
    
    def _load_video_env_map(self) -> dict:
        """
        从 video.html 文件中动态解析视频环境映射表
        通过读取 HTML 文件中的按钮 data-env 属性和 onclick 事件提取视频名称
        
        :return: {videoName: 'html'|'python'} 映射字典
        """
        video_env_map = {}
        
        try:
            # 构建 video.html 文件路径
            video_html_path = self.app_dir / "shiori engine" / "html" / "video.html"
            
            if not video_html_path.exists():
                if self.is_debug:
                    print(f"[WARN] video.html 文件不存在: {video_html_path}")
                return video_env_map
            
            # 读取 HTML 文件内容
            with open(video_html_path, 'r', encoding='utf-8') as f:
                html_content = f.read()
            
            # 使用正则表达式匹配所有带有 data-env 属性的按钮
            # 匹配模式: <button ... data-env="xxx" onclick="playVideo('yyy')">
            pattern = r'<button[^>]*data-env=["\']([^"\']+)["\'][^>]*onclick=["\']playVideo\(["\']([^"\']+)["\']\)["\']'
            matches = re.findall(pattern, html_content)
            
            for env, video_name in matches:
                video_env_map[video_name] = env
            
            if self.is_debug:
                print(f"[INFO] 从 video.html 解析到 {len(video_env_map)} 个视频配置")
                for video_name, env in video_env_map.items():
                    print(f"  - {video_name}: {env}")
            
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] 解析 video.html 失败: {e}")
                import traceback
                traceback.print_exc()
        
        return video_env_map
    
    def _setup_webchannel(self):
        """设置 QWebChannel 用于 Python-JS 互操作"""
        # 创建 API 桥接对象
        self.api_bridge = ShioriAPI(
            app_dir=str(self.app_dir),
            is_debug=self.is_debug
        )
        
        # 创建视频解码器
        self.video_decoder = VideoDecoder(
            app_dir=str(self.app_dir),
            is_debug=self.is_debug
        )
        
        # 动态加载视频环境映射表（从video.html中自动解析）
        VideoDecoder.video_env_map = self._load_video_env_map()
        
        if self.is_debug:
            print(f"[INFO] 视频环境映射已加载: {VideoDecoder.video_env_map}")
        
        # 创建 WebChannel
        self.web_channel = QWebChannel(self)
        self.web_channel.registerObject("ShioriAPI", self.api_bridge)
        self.web_channel.registerObject("VideoDecoder", self.video_decoder)
        
        # 将 WebChannel 设置到页面
        self.web_view.page().setWebChannel(self.web_channel)
        
        if self.is_debug:
            print("[INFO] QWebChannel 已初始化")
            print("[INFO] 已注册: ShioriAPI, VideoDecoder")
    
    def _setup_shortcuts(self):
        """设置键盘快捷键"""
        # 注意：不设置F5快捷键，确保F5能传递给网页用于游戏存档功能
        
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
        
        # 重新加载引擎（移除快捷键，避免与游戏F5存档冲突）
        reload_action = QAction("重新加载引擎", self)
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
        
        # 刷新（移除快捷键，避免与游戏F5存档冲突）
        view_refresh_action = QAction("刷新", self)
        view_refresh_action.triggered.connect(lambda: self.web_view.reload())
        view_menu.addAction(view_refresh_action)
        
        # 分辨率子菜单
        resolution_menu = view_menu.addMenu("分辨率")
        
        # 二级菜单：宽高比选择
        aspect_ratio_menu = resolution_menu.addMenu("宽高比")
        
        # 16:9 选项
        action_16_9 = QAction("16:9 (宽屏)", self)
        action_16_9.setCheckable(True)
        action_16_9.setChecked(True)  # 默认选中
        action_16_9.triggered.connect(lambda: self._set_aspect_ratio(16/9, action_16_9, action_4_3))
        aspect_ratio_menu.addAction(action_16_9)
        
        # 4:3 选项
        action_4_3 = QAction("4:3 (标准)", self)
        action_4_3.setCheckable(True)
        action_4_3.setChecked(False)
        action_4_3.triggered.connect(lambda: self._set_aspect_ratio(4/3, action_4_3, action_16_9))
        aspect_ratio_menu.addAction(action_4_3)
        
        resolution_menu.addSeparator()
        
        # 三级菜单：具体分辨率（根据当前宽高比动态更新）
        self.resolution_actions_menu = resolution_menu.addMenu("选择分辨率")
        self.current_aspect_ratio = 16/9  # 默认16:9
        self.action_16_9_ref = action_16_9
        self.action_4_3_ref = action_4_3
        self._update_resolution_menu()
        
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
        
        # GitHub页面
        github_action = QAction("GitHub 仓库", self)
        github_action.triggered.connect(self._open_github)
        help_menu.addAction(github_action)
        
        # 教学页面
        teaching_action = QAction("GitHub Pages 教学页面", self)
        teaching_action.triggered.connect(self._open_teaching)
        help_menu.addAction(teaching_action)
        
        # WakuDemo应用商店
        wakudemo_action = QAction("WakuDemo 应用商店", self)
        wakudemo_action.triggered.connect(self._open_wakudemo)
        help_menu.addAction(wakudemo_action)
        
        help_menu.addSeparator()
        
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
    
    def _open_url_in_browser(self, url: str):
        """在外部浏览器中打开URL"""
        import webbrowser
        webbrowser.open(url)
        if self.is_debug:
            print(f"[DEBUG] 打开URL: {url}")
    
    def _open_github(self):
        """打开GitHub仓库页面"""
        self._open_url_in_browser("https://github.com/1145141919810TONNY/webgalgameengine")
    
    def _open_teaching(self):
        """打开GitHub Pages教学页面"""
        self._open_url_in_browser("https://1145141919810tonny.github.io/Shioriteaching/")
    
    def _open_wakudemo(self):
        """打开WakuDemo应用商店"""
        self._open_url_in_browser("https://wakudemo.cn/games/100266")
    
    def _toggle_fullscreen(self):
        """切换全屏模式"""
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()
        
        if self.is_debug:
            print(f"[DEBUG] 全屏模式: {self.isFullScreen()}")
    
    def _change_resolution(self, width: int, height: int):
        """更改窗口分辨率"""
        if self.isFullScreen():
            self.showNormal()
        
        self.resize(width, height)
        
        # 居中显示
        self._center_on_screen()
        
        if self.is_debug:
            print(f"[DEBUG] 分辨率已更改为: {width} x {height}")
    
    def _set_aspect_ratio(self, ratio: float, current_action: QAction, other_action: QAction):
        """设置窗口宽高比"""
        self.current_aspect_ratio = ratio
        
        # 更新复选框状态
        current_action.setChecked(True)
        other_action.setChecked(False)
        
        # 更新分辨率菜单
        self._update_resolution_menu()
        
        # 调整当前窗口大小以保持新比例
        current_width = self.width()
        new_height = int(current_width / ratio)
        self.resize(current_width, new_height)
        
        if self.is_debug:
            ratio_name = "16:9" if ratio == 16/9 else "4:3"
            print(f"[DEBUG] 宽高比已切换为: {ratio_name}")
    
    def _update_resolution_menu(self):
        """根据当前宽高比更新分辨率菜单"""
        # 清除旧的分辨率选项
        self.resolution_actions_menu.clear()
        
        # 定义不同宽高比的分辨率
        if self.current_aspect_ratio == 16/9:
            resolutions = [
                ("1280 x 720", 1280, 720),      # HD (720p)
                ("1600 x 900", 1600, 900),      # HD+ (900p)
                ("1920 x 1080", 1920, 1080),    # Full HD (1080p)
            ]
        else:  # 4:3
            resolutions = [
                ("800 x 600", 800, 600),        # SVGA
                ("1024 x 768", 1024, 768),      # XGA
                ("1280 x 960", 1280, 960),      # XVGA
                ("1400 x 1050", 1400, 1050),    # SXGA+
                ("1600 x 1200", 1600, 1200),    # UXGA
            ]
        
        # 添加新的分辨率选项
        for label, width, height in resolutions:
            action = QAction(label, self)
            action.triggered.connect(lambda checked, w=width, h=height: self._change_resolution(w, h))
            self.resolution_actions_menu.addAction(action)
        
        if self.is_debug:
            ratio_name = "16:9" if self.current_aspect_ratio == 16/9 else "4:3"
            print(f"[DEBUG] 分辨率菜单已更新为: {ratio_name} ({len(resolutions)} 个选项)")
    
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
<div style='font-size: 10pt; line-height: 1.6;'>
<h2 style='font-size: 10pt; margin: 0 0 10px 0;'>{APP_NAME}</h2>
<table border="0" cellpadding="5" style='font-size: 10pt;'>
<tr><td>Shiori Engine:</td><td>V2.0.1</td></tr>
<tr><td>Shiori Engine exe:</td><td>V1.1.1</td></tr>
</table>
<hr>
<p style='font-size: 10pt;'>技术栈:</p>
<ul style='font-size: 10pt;'>
<li>Python: {sys.version.split()[0]}</li>
<li>Qt: {QT_VERSION_STR}</li>
<li>PyQt6: {PYQT_VERSION_STR}</li>
<li>WebEngine: {webengine_version}</li>
</ul>
<p style='font-size: 10pt;'>描述: {DESCRIPTION}</p>
<p style='font-size: 10pt;'>{COPYRIGHT}</p>
</div>
            """
            
            QMessageBox.about(self, f"关于 {APP_NAME}", about_text)
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] 关于对话框错误: {e}")
                import traceback
                traceback.print_exc()
            
            # 如果出错，显示简化的关于信息
            simple_text = f"""
<div style='font-size: 10pt; line-height: 1.6;'>
<h2 style='font-size: 10pt; margin: 0 0 10px 0;'>{APP_NAME}</h2>
<table border="0" cellpadding="5" style='font-size: 10pt;'>
<tr><td>Shiori Engine:</td><td>V2.0.1</td></tr>
<tr><td>Shiori Engine exe:</td><td>V1.1.1</td></tr>
</table>
<p style='font-size: 10pt;'>{COPYRIGHT}</p>
</div>
            """
            QMessageBox.about(self, f"关于 {APP_NAME}", simple_text)
    
    def _on_js_console_message(self, level, message, line_number, source_id):
        """处理 JavaScript 控制台消息"""
        # 调试模式始终输出JavaScript消息
        level_map = {
            0: "LOG",
            1: "WARNING", 
            2: "ERROR"
        }
        
        level_str = level_map.get(level, "UNKNOWN")
        # 始终输出JavaScript消息，帮助调试视频播放问题
        print(f"[JS-{level_str}] {message} (line {line_number}, {source_id})")
        
        # 如果是错误级别，额外输出到stderr
        if level == 2:  # ERROR
            import sys
            print(f"[JS-ERROR] {message}", file=sys.stderr)
    
    def _on_page_load_finished(self, ok):
        """页面加载完成回调，验证 localStorage 可用性"""
        if not ok:
            if self.is_debug:
                print("[WARN] 页面加载失败")
            return
        
        if self.is_debug:
            print("[INFO] 页面加载完成，localStorage 已就绪")
            print("[INFO] 现在可以安全地进行存档操作")
    
    def closeEvent(self, event):
        """窗口关闭事件 - 立即退出，避免卡死"""
        # 防止重复关闭
        if self._is_closing:
            event.ignore()
            return
        
        self._is_closing = True
        
        # 立即接受事件并直接退出，不执行任何清理操作
        # 所有清理工作由 Qt 的析构函数自动处理
        event.accept()
        
        if self.is_debug:
            print("[INFO] 窗口关闭，立即退出...")
        
        # 直接退出，不做任何其他操作
        import os
        os._exit(0)
