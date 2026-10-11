// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// Shiori 启动器主窗口交互逻辑实现。负责游戏启动流程编排、窗口尺寸/全屏管理、
// 菜单系统构建、WebView2 初始化与宿主通信桥接、版本资源清理，以及系统设置弹窗等。
// 本文件是整个启动器 UI 层的核心枢纽，通过 HttpServer 与 WebView2 共同承载引擎运行。

using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Shiori.Scripting.Host;

namespace ShioriCSharp
{
    /// <summary>
    /// Shiori 启动器主窗口。
    /// 承载 WebView2 渲染宿主、本地 HttpServer、菜单栏与启动遮罩，
    /// 负责将引擎目录下的网页内容呈现给用户，并处理窗口生命周期与宿主消息。
    /// </summary>
    public partial class MainWindow : Window
    {
        /// <summary>本地 HTTP 服务器实例，向 WebView2 提供引擎页面与资源。</summary>
        private HttpServer? _server;
        /// <summary>视频桥接器，负责视频文件的解码与逐帧投递。</summary>
        private VideoBridge? _videoBridge;
        /// <summary>应用程序（exe）所在目录，所有相对路径解析均以此为基准。</summary>
        private readonly string _appDir;
        /// <summary>是否为调试构建（exe 文件名包含 "debug"）。</summary>
        private readonly bool _isDebug;
        /// <summary>调试菜单中的"从头开始"菜单项，页面加载后按需启用。</summary>
        private MenuItem? _restartAction;
        /// <summary>立绘变更窗口实例（调试用），为 null 表示未打开。</summary>
        private CharVisualizerWindow? _charVisualizerWindow;
        /// <summary>QUIT按钮确认标志</summary>
        private bool _quitConfirmed = false;
        /// <summary>启动时恢复全屏状态，等 WebView2 就绪后同步 JS 侧 class</summary>
        private bool _pendingFullscreenSync = false;
        /// <summary>当前渲染配置（分辨率、缩放、缓存等），持久化于 render_profile.json。</summary>
        private RenderProfile _renderProfile = RenderProfile.Default;
        /// <summary>已注入的宿主配置脚本 ID，用于后续替换或移除。</summary>
        private string? _hostConfigScriptId;
        /// <summary>宿主配置刷新的并发控制门，保证多次刷新按序执行。</summary>
        private readonly HostConfigRefreshGate _hostConfigRefresh = new();
        /// <summary>引擎根目录（"shiori engine" 绝对路径）。</summary>
        private string _engineDir = "";
        /// <summary>已加载的插件会话，关闭时需调用 Shutdown 释放。</summary>
        private ShioriPluginSession? _plugins;

        // 启动遮罩（logo）控制
        /// <summary>启动遮罩最短显示时长的定时器（3 秒）。</summary>
        private DispatcherTimer? _splashTimer;
        /// <summary>WebView2 首屏导航是否已成功完成。</summary>
        private bool _loadingCompleted;
        /// <summary>遮罩是否已开始/完成淡出，避免重复触发动画。</summary>
        private bool _splashDismissed;
        /// <summary>是否在启动时强制执行一次「重新加载引擎」（等价 Ctrl+F5）。关掉即恢复旧行为。</summary>
        private const bool EnableStartupReload = true;
        /// <summary>启动自检重载是否已发起过（每进程仅一次，防止与 NavigationCompleted 形成死循环）。</summary>
        private bool _startupReloadDone;
        /// <summary>启动自检重载已发起但尚未收到新的 NavigationCompleted；此期间保持遮罩，避免用户看到刷新闪烁。</summary>
        private bool _startupReloadInFlight;
        /// <summary>自检重载的兜底定时器：重载迟迟不回来时强制放行遮罩，避免卡在启动画面。</summary>
        private DispatcherTimer? _reloadWatchdog;

        /// <summary>供子窗口访问 WebView2 控件</summary>
        public Microsoft.Web.WebView2.Wpf.WebView2 WebView => webView;

        /// <summary>是否为 debug 构建（exe 文件名含 debug）。供子窗口判定 F1/F2 等调试功能。</summary>
        public bool IsDebug => _isDebug;
        /// <summary>当前窗口宽高比（默认 16:9），用于尺寸变更时的比例锁定。</summary>
        private double _currentAspectRatio = 16.0 / 9.0;

        /// <summary>
        /// 构造主窗口：初始化 XAML 组件、设置最小尺寸、检测调试构建、
        /// 恢复上次窗口尺寸，并挂接各生命周期与输入事件。
        /// </summary>
        public MainWindow()
        {
            InitializeComponent();
            MinWidth = LayoutScale.MinWindowWidth;
            MinHeight = LayoutScale.MinWindowHeight;

            _appDir = AppDomain.CurrentDomain.BaseDirectory;
            
            // 检测是否为调试版（文件名包含 debug）
            var exeName = Path.GetFileNameWithoutExtension(System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName ?? "");
            _isDebug = exeName.IndexOf("debug", StringComparison.OrdinalIgnoreCase) >= 0;

            // 恢复上次关闭时的窗口大小（在窗口首次显示前应用，避免闪跳）
            ApplyStartupWindowSize(RenderProfile.Load(RenderProfilePath()));

            Loaded += MainWindow_Loaded;
            PreviewKeyDown += MainWindow_PreviewKeyDown;
            SizeChanged += MainWindow_SizeChanged;
            webView.SizeChanged += (_, _) => ApplyLayoutScale();
            webView.NavigationCompleted += WebView_NavigationCompleted;
            Closing += OnWindowClosing;
        }

        /// <summary>
        /// 按上次关闭时保存的尺寸和状态恢复窗口。
        /// 窗口比例锁定以宽度为准（16:9），此处按宽度回推高度并 clamp 到屏幕工作区。
        /// </summary>
        /// <param name="profile">包含 WindowWidth / WindowHeight / WindowFullScreen / WindowMaximized 的渲染配置；可为 null。</param>
        /// <remarks>尺寸非法或过小时直接忽略；恢复全屏时置 _pendingFullscreenSync 等待 JS 同步。</remarks>
        private void ApplyStartupWindowSize(RenderProfile profile)
        {
            try
            {
                double w = profile?.WindowWidth ?? 0;
                double h = profile?.WindowHeight ?? 0;
                if (double.IsNaN(w) || double.IsNaN(h) || double.IsInfinity(w) || double.IsInfinity(h)) return;
                if (w < MinWidth || h < MinHeight) return;

                double ratio = _currentAspectRatio > 0 ? _currentAspectRatio : 16.0 / 9.0;
                var work = SystemParameters.WorkArea;

                // 以宽度为准回推高度（与 SizeChanged 中的比例锁定一致）
                h = w / ratio;
                if (h > work.Height)
                {
                    h = work.Height;
                    w = h * ratio;
                }
                if (w > work.Width)
                {
                    w = work.Width;
                    h = w / ratio;
                }
                if (w < MinWidth || h < MinHeight) return;

                Width = w;
                Height = h;

                // 恢复窗口状态（全屏 > 最大化 > 普通）
                bool wantFullScreen = profile?.WindowFullScreen ?? false;
                bool wantMaximized = profile?.WindowMaximized ?? false;

                if (wantFullScreen)
                {
                    WindowStyle = WindowStyle.None;
                    ResizeMode = ResizeMode.NoResize;
                    WindowState = WindowState.Maximized;
                    _pendingFullscreenSync = true; // 等 WebView2 就绪后同步 JS 侧 class
                }
                else if (wantMaximized)
                {
                    WindowState = WindowState.Maximized;
                }

                Console.WriteLine($"[WindowSize] restored {w:F0}x{h:F0} max={wantMaximized} fs={wantFullScreen}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[WindowSize] restore failed: " + ex.Message);
            }
        }

        /// <summary>退出时保存当前窗口尺寸和状态（最大化/全屏），供下次启动恢复。</summary>
        /// <remarks>写入 render_profile.json；最大化/全屏时使用 RestoreBounds 记录还原尺寸。失败仅记录日志不抛出。</remarks>
        private void SaveWindowSize()
        {
            try
            {
                double w, h;
                bool isMaximized = WindowState == WindowState.Maximized;
                bool isFullScreen = WindowStyle == WindowStyle.None;

                if (WindowState == WindowState.Normal)
                {
                    w = Width;
                    h = Height;
                }
                else
                {
                    var rb = RestoreBounds;
                    w = rb.Width;
                    h = rb.Height;
                }
                if (double.IsNaN(w) || double.IsNaN(h) || w < MinWidth || h < MinHeight) return;

                _renderProfile = RenderProfile.Load(RenderProfilePath())
                    .WithWindowSize(w, h, isMaximized, isFullScreen);
                _renderProfile.Save(RenderProfilePath());
                Console.WriteLine($"[WindowSize] saved {w:F0}x{h:F0} max={isMaximized} fs={isFullScreen}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[WindowSize] save failed: " + ex.Message);
            }
        }
        
        /// <summary>
        /// 窗口关闭事件处理（点击X按钮时弹出确认）
        /// </summary>
        /// <param name="sender">事件源（窗口）。</param>
        /// <param name="e">关闭事件参数，设置 e.Cancel = true 可阻止关闭。</param>
        /// <remarks>已通过 QUIT 按钮确认（_quitConfirmed）时跳过确认直接保存尺寸退出。</remarks>
        private void OnWindowClosing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            // 如果QUIT按钮已经确认过，直接退出不再弹确认
            if (_quitConfirmed)
            {
                SaveWindowSize();
                return;
            }
            
            // 弹出确认对话框
            if (!ShowConfirmDialog("确定要退出游戏吗？", "退出确认"))
            {
                // 用户取消关闭，阻止关闭事件
                e.Cancel = true;
                return;
            }

            SaveWindowSize();
        }

        /// <summary>
        /// 窗口 Loaded 事件：启动流程主编排。
        /// 依次完成遮罩定时器启动、渲染配置加载、菜单构建、启动 logo 检测、
        /// WebView2 环境创建（与服务器启动并行）、HttpServer 与 VideoBridge 启动、
        /// 安全策略注入、宿主桥接与启动脚本注入、插件加载，最后导航到首页。
        /// </summary>
        /// <param name="sender">事件源（窗口）。</param>
        /// <param name="e">路由事件参数。</param>
        /// <remarks>异步方法；关键失败点（引擎目录缺失、端口占用）会弹窗并关闭窗口。</remarks>
        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            // 启动 3 秒定时器，保证遮罩至少显示 3 秒
            _splashTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _splashTimer.Tick += (_, _) =>
            {
                _splashTimer.Stop();
                TryDismissSplash();
            };
            _splashTimer.Start();

            _renderProfile = RenderProfile.Load(RenderProfilePath());
            SetupMenu();

            var engineDir = Path.Combine(_appDir, "shiori engine");
            _engineDir = engineDir;

            // 提前构建容器 VFS（不依赖后续 _server）：封面 logo 在发行模式下已打包进 assets/cg.sgd，
            // 必须从容器读取；同时复用于下方 _server 构造，避免重复扫描 *.sgd 与重复解包。
            var vfs = HttpServer.CreateVfs(engineDir, _isDebug);

            // 检测启动图片：优先使用 assets/cg/logo.*（不限扩展名，与管理器标题图片同目录）
            var logoPatterns = new[] { "logo.png", "logo.jpg", "logo.jpeg", "logo.bmp", "logo.gif", "logo.webp" };
            string? foundLogo = null;

            // 1) 散文件模式（开发期）：磁盘直接存在
            var cgDir = Path.Combine(engineDir, "assets", "cg");
            if (Directory.Exists(cgDir))
            {
                foundLogo = logoPatterns
                    .Select(p => Path.Combine(cgDir, p))
                    .FirstOrDefault(File.Exists);
            }

            // 2) 发行模式：logo 已加密进 assets/cg.sgd，需从容器读回并落临时文件供 WPF 显示
            //    （不能硬编码磁盘路径——发行形态磁盘上只有 .sgd，没有 assets/cg/ 明文目录）
            if (foundLogo == null && vfs != null)
            {
                foreach (var p in logoPatterns)
                {
                    var rel = "assets/cg/" + p;
                    if (vfs.Contains(rel) && vfs.TryRead(rel, out var bytes))
                    {
                        try
                        {
                            var tmp = Path.Combine(Path.GetTempPath(), "shiori_splash_" + p);
                            File.WriteAllBytes(tmp, bytes);
                            foundLogo = tmp;
                            break;
                        }
                        catch { /* 落盘失败则尝试下一个候选扩展名 */ }
                    }
                }
            }

            if (foundLogo != null)
            {
                try
                {
                    SplashImage.Source = new BitmapImage(new Uri(foundLogo));
                    SplashImage.Visibility = Visibility.Visible;
                    SplashText.Visibility = Visibility.Collapsed;
                }
                catch { /* 加载失败则回退文字 */ }
            }


            // 点击遮罩任意位置即可跳过剩余等待
            LoadingOverlay.MouseLeftButtonDown += (_, _) =>
            {
                _splashTimer?.Stop();
                TryDismissSplash();
            };

            if (!Directory.Exists(engineDir))
            {
                MessageBox.Show("未找到 'shiori engine' 文件夹", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
                return;
            }

            // 提前发起 WebView2 环境创建（不 await，与服务器启动并行）
            var exeNameForWv2 = Path.GetFileNameWithoutExtension(
                Process.GetCurrentProcess().MainModule?.FileName ?? "");
            var userDataFolder = Path.Combine(_appDir, exeNameForWv2 + ".WebView2");

            // 首次启动优化：预置最简 Profile，大幅减少 WebView2 初始化时间
            PreSeedWebView2Folder(userDataFolder);

            var wv2Options = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = GetWebView2OptimizationArgs(_renderProfile),
                Language = "zh-CN"
            };
            var wv2EnvironmentTask = CoreWebView2Environment.CreateAsync(
                userDataFolder: userDataFolder,
                options: wv2Options
            );

            // 启动本地服务器
            _server = new HttpServer(engineDir, 8080, _isDebug, _renderProfile.Thumbnails, _renderProfile.FrameCache, vfs: vfs);
            try
            {
                _server.Start();
            }
            catch (HttpListenerException)
            {
                MessageBox.Show("端口 8080 已被占用，请关闭占用该端口的程序后重试。", "启动失败", MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
                return;
            }

            // 初始化视频桥接
            _videoBridge = new VideoBridge(engineDir, _isDebug);

            // 等待环境创建完成（此时已与上面操作重叠）
            var environment = await wv2EnvironmentTask;
            await webView.EnsureCoreWebView2Async(environment);
            // 导航前就让它参与布局：Collapsed 状态下 WebView2 视口为 0×0，
            // 页面 100vw/100vh 全算成 0，UI 会"加载了但看不见"。
            // 白闪由不透明的 LoadingOverlay 挡住，不需要靠隐藏 WebView 来防。
            webView.Visibility = Visibility.Visible;
            webView.UpdateLayout();
            ApplyLayoutScale();
            // 允许页面脚本访问宿主对象（AddHostObjectToScript 注入的 shioriHost）
            webView.CoreWebView2.Settings.AreHostObjectsAllowed = true;
            // release 构建屏蔽 DevTools：加密资源必须防止通过 F12 开发者工具查看明文，
            // 故非调试版直接禁用 DevTools（与 F1/F2 一致，F12 同为调试专用功能）。
            // 该开关不依赖键盘焦点路由，是拦截 F12 的权威兜底。
            webView.CoreWebView2.Settings.AreDevToolsEnabled = _isDebug;
            // 导航拦截：主框架与子框架均只允许引擎自身地址，防止被导航到外部页面
            webView.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!IsEngineUri(e.Uri)) e.Cancel = true;
            };
            webView.CoreWebView2.FrameNavigationStarting += (_, e) =>
            {
                if (!IsEngineUri(e.Uri)) e.Cancel = true;
            };
            // 宿主双向通信：接收前端消息（视频控制、退出、系统设置等）
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            // 首屏导航完成：关闭启动遮罩并同步全屏状态
            webView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;

            // 注入宿主对象与文档创建期脚本（宿主配置 + 启动引导），必须在导航前完成
            var dsl = _server!.Dsl;
            webView.CoreWebView2.AddHostObjectToScript("shioriHost", new ShioriHostBridge(dsl));
            _hostConfigScriptId = await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                BuildHostConfigDocumentScript());
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                new Bootstrapper(dsl, engineDir).DocumentCreatedScript());
            ApplyLayoutScale();

            // OPT S8：exe 旁 plugin\*.dll，目录缺失零回归（MainWindow_Loaded 尾、导航前）
            try
            {
                var pluginDir = ShioriPluginLoader.DirectoryBesideExe(_appDir);
                _plugins = ShioriPluginLoader.LoadAll(
                    pluginDir,
                    new LauncherPluginHost(_appDir, engineDir, pluginDir, Dispatcher),
                    msg => Console.WriteLine(msg));
            }
            catch (Exception ex)
            {
                Console.WriteLine("[plugin] loader failed: " + ex.Message);
                _plugins = null;
            }

            // 加载页面（添加debug参数）
            var debugParam = _isDebug ? "?debug=1" : "";
            webView.Source = new Uri($"http://localhost:8080/index.html{debugParam}");
        }

        /// <summary>
        /// 构建主菜单栏：文件、视图、设置、帮助，以及（仅调试构建时的）调试菜单。
        /// 菜单项通过 lambda 直接绑定窗口操作或注入 JS 调用。
        /// </summary>
        private void SetupMenu()
        {
            // 文件菜单
            var fileMenu = new MenuItem { Header = "文件(_F)" };
            
            var homeAction = new MenuItem { Header = "返回标题页面", InputGestureText = "Home" };
            homeAction.Click += (s, e) => webView.Source = new Uri("http://localhost:8080/index.html");
            fileMenu.Items.Add(homeAction);

            fileMenu.Items.Add(new Separator());

            var openFolderAction = new MenuItem { Header = "打开引擎文件夹" };
            openFolderAction.Click += (s, e) => Process.Start("explorer.exe", Path.Combine(_appDir, "shiori engine"));
            fileMenu.Items.Add(openFolderAction);

            var reloadAction = new MenuItem { Header = "重新加载引擎", InputGestureText = "Ctrl+F5" };
            reloadAction.Click += (s, e) => webView.Reload();
            fileMenu.Items.Add(reloadAction);

            var cleanupAction = new MenuItem { Header = "清理无用缓存文件" };
            cleanupAction.Click += (s, e) => RunCacheCleanup();
            fileMenu.Items.Add(cleanupAction);

            fileMenu.Items.Add(new Separator());

            var exitAction = new MenuItem { Header = "退出", InputGestureText = "Alt+F4" };
            exitAction.Click += (s, e) => Close();
            fileMenu.Items.Add(exitAction);

            MainMenu.Items.Add(fileMenu);

            // 视图菜单
            var viewMenu = new MenuItem { Header = "视图(_V)" };

            var refreshAction = new MenuItem { Header = "刷新" };
            refreshAction.Click += (s, e) => webView.Reload();
            viewMenu.Items.Add(refreshAction);

            // 分辨率子菜单
            var resolutionMenu = new MenuItem { Header = "分辨率" };
            
            var aspectRatioMenu = new MenuItem { Header = "宽高比" };
            var ratio16_9 = new MenuItem { Header = "16:9 (宽屏)", IsCheckable = true, IsChecked = true };
            var ratio4_3 = new MenuItem { Header = "4:3 (标准)", IsCheckable = true };

            ratio16_9.Click += (s, e) => SetAspectRatio(16.0 / 9.0, ratio16_9, ratio4_3);
            ratio4_3.Click += (s, e) => SetAspectRatio(4.0 / 3.0, ratio4_3, ratio16_9);

            aspectRatioMenu.Items.Add(ratio16_9);
            aspectRatioMenu.Items.Add(ratio4_3);
            resolutionMenu.Items.Add(aspectRatioMenu);

            resolutionMenu.Items.Add(new Separator());

            var selectResMenu = new MenuItem { Header = "选择分辨率" };
            UpdateResolutionMenu(selectResMenu);
            resolutionMenu.Items.Add(selectResMenu);

            viewMenu.Items.Add(resolutionMenu);
            viewMenu.Items.Add(new Separator());

            var maximizeAction = new MenuItem { Header = "最大化窗口", InputGestureText = "F10" };
            maximizeAction.Click += (s, e) => ToggleMaximized();
            viewMenu.Items.Add(maximizeAction);

            viewMenu.Items.Add(new Separator());

            var fullscreenAction = new MenuItem { Header = "独占全屏", InputGestureText = "F11" };
            fullscreenAction.Click += (s, e) => ToggleFullScreen();
            viewMenu.Items.Add(fullscreenAction);

            MainMenu.Items.Add(viewMenu);

            // 设置菜单
            var settingsMenu = new MenuItem { Header = "设置(_S)" };

            var systemSettingsAction = new MenuItem { Header = "系统设置" };
            systemSettingsAction.Click += (s, e) =>
            {
                // 调用 JavaScript 打开系统设置
                _ = webView.CoreWebView2.ExecuteScriptAsync("systemModule.showSystemSettings()");
            };
            settingsMenu.Items.Add(systemSettingsAction);
            RenderMenu.Attach(settingsMenu, _renderProfile, OnRenderProfileChanged);

            MainMenu.Items.Add(settingsMenu);

            // 帮助菜单
            var helpMenu = new MenuItem { Header = "帮助(_H)" };

            var githubAction = new MenuItem { Header = "GitHub 仓库" };
            githubAction.Click += (s, e) => Process.Start(new ProcessStartInfo("https://github.com/1145141919810TONNY/webgalgameengine") { UseShellExecute = true });
            helpMenu.Items.Add(githubAction);

            var teachingAction = new MenuItem { Header = "GitHub Pages 教学页面" };
            teachingAction.Click += (s, e) => Process.Start(new ProcessStartInfo("https://1145141919810tonny.github.io/Shioriteaching/") { UseShellExecute = true });
            helpMenu.Items.Add(teachingAction);

            var wakudemoAction = new MenuItem { Header = "WakuDemo 应用商店" };
            wakudemoAction.Click += (s, e) => Process.Start(new ProcessStartInfo("https://wakudemo.cn/games/100266") { UseShellExecute = true });
            helpMenu.Items.Add(wakudemoAction);

            helpMenu.Items.Add(new Separator());

            var managerAction = new MenuItem { Header = "Shiori Game Manager 下载" };
            managerAction.Click += (s, e) => Process.Start(new ProcessStartInfo("https://github.com/1145141919810TONNY/Shiori-manager/releases/latest") { UseShellExecute = true });
            helpMenu.Items.Add(managerAction);

            var archiveHelpAction = new MenuItem { Header = "存档相关问题" };
            archiveHelpAction.Click += ShowArchiveHelp;
            helpMenu.Items.Add(archiveHelpAction);

            helpMenu.Items.Add(new Separator());

            var uiHelpAction = new MenuItem { Header = "UI帮助" };
            uiHelpAction.Click += (s, e) => ShowHelpWindow();
            helpMenu.Items.Add(uiHelpAction);

            var aboutAction = new MenuItem { Header = "关于" };
            aboutAction.Click += ShowAbout;
            helpMenu.Items.Add(aboutAction);

            MainMenu.Items.Add(helpMenu);

            // 调试菜单 (仅调试版)
            if (_isDebug)
            {
                var debugMenu = new MenuItem { Header = "调试(_D)" };

                var devToolsAction = new MenuItem { Header = "开发者工具", InputGestureText = "F12" };
                devToolsAction.Click += (s, e) => webView.CoreWebView2.OpenDevToolsWindow();
                debugMenu.Items.Add(devToolsAction);

                debugMenu.Items.Add(new Separator());

                _restartAction = new MenuItem { Header = "从头开始" };
                _restartAction.IsEnabled = false; // 默认禁用，等待页面加载后检测
                _restartAction.Click += async (s, e) =>
                {
                    // P3.1(优化.txt 3 节):Reload 前清 f. 继承残留信号,确保"从头开始"f.* 清零不叠加
                    if (webView.CoreWebView2 != null)
                    {
                        try
                        {
                            await webView.CoreWebView2.ExecuteScriptAsync(
                                "try{sessionStorage.removeItem('shiori_next_scene_target');" +
                                "sessionStorage.removeItem('archiveLoadTarget');" +
                                "sessionStorage.removeItem('shiori_scene_entry_jump');" +
                                "sessionStorage.removeItem('shiori_f_runtime');" +
                                "sessionStorage.removeItem('gameStateSnapshot');}catch(e){}");
                        }
                        catch { /* 页面未就绪时忽略，引擎侧 P3.2 兜底 */ }
                    }
                    webView.Reload();
                };
                debugMenu.Items.Add(_restartAction);

                debugMenu.Items.Add(new Separator());

                var flowchartDebugAction = new MenuItem { Header = "剧本流程图(调试版)" };
                flowchartDebugAction.Click += (s, e) => webView.Source = new Uri("http://localhost:8080/html/flowchart_debug.html");
                debugMenu.Items.Add(flowchartDebugAction);

                debugMenu.Items.Add(new Separator());

                var clearSavesAction = new MenuItem { Header = "清除所有存档" };
                clearSavesAction.Click += ClearAllSaves;
                debugMenu.Items.Add(clearSavesAction);

                var allGalleryAction = new MenuItem { Header = "开启全部鉴赏", IsCheckable = true };
                allGalleryAction.Click += (s, e) => SetAllGalleryUnlock(allGalleryAction.IsChecked);
                debugMenu.Items.Add(allGalleryAction);

                debugMenu.Items.Add(new Separator());

                var loadSceneAction = new MenuItem { Header = "加载指定文件" };
                loadSceneAction.Click += LoadCustomScene;
                debugMenu.Items.Add(loadSceneAction);

                debugMenu.Items.Add(new Separator());

                var charVisualizerAction = new MenuItem { Header = "立绘变更", InputGestureText = "F9" };
                charVisualizerAction.Click += OpenCharVisualizer;
                debugMenu.Items.Add(charVisualizerAction);

                MainMenu.Items.Add(debugMenu);
            }
        }

        /// <summary>
        /// 切换窗口宽高比，并将菜单勾选状态同步到对应项。
        /// </summary>
        /// <param name="ratio">目标宽高比（如 16:9 = 1.777…）。</param>
        /// <param name="current">被选中的菜单项（勾选）。</param>
        /// <param name="other">另一个菜单项（取消勾选）。</param>
        private void SetAspectRatio(double ratio, MenuItem current, MenuItem other)
        {
            _currentAspectRatio = ratio;
            current.IsChecked = true;
            other.IsChecked = false;

            RestoreWindowStyle();

            int width = Math.Max((int)Width, (int)LayoutScale.MinWindowWidth);
            int height = Math.Max((int)(width / ratio), (int)LayoutScale.MinWindowHeight);
            Width = width;
            Height = height;
            CenterWindowOnScreen();
        }

        /// <summary>
        /// 根据当前宽高比重建"选择分辨率"子菜单的候选项。
        /// </summary>
        /// <param name="menu">目标子菜单项，其内容会被清空并重新填充。</param>
        private void UpdateResolutionMenu(MenuItem menu)
        {
            menu.Items.Clear();
            var resolutions = _currentAspectRatio == 16.0 / 9.0
                ? new (string label, int w, int h)[] { ("1280 x 720", 1280, 720), ("1366 x 768", 1366, 768), ("1600 x 900", 1600, 900) }
                : new (string label, int w, int h)[] { ("960 x 720", 960, 720), ("1024 x 768", 1024, 768) };

            foreach (var res in resolutions)
            {
                var item = new MenuItem { Header = res.label };
                item.Click += (s, e) => ChangeResolution(res.w, res.h);
                menu.Items.Add(item);
            }
        }

        /// <summary>
        /// 应用指定分辨率：先退出最大化/全屏，再设置窗口尺寸并居中。
        /// </summary>
        /// <param name="width">目标宽度（会被 clamp 到最小宽度）。</param>
        /// <param name="height">目标高度（会被 clamp 到最小高度）。</param>
        private void ChangeResolution(int width, int height)
        {
            RestoreWindowStyle();
            Width = Math.Max(width, LayoutScale.MinWindowWidth);
            Height = Math.Max(height, LayoutScale.MinWindowHeight);
            CenterWindowOnScreen();
        }

        /// <summary>将窗口居中于当前屏幕工作区。</summary>
        private void CenterWindowOnScreen()
        {
            double left = (SystemParameters.WorkArea.Width - Width) / 2 + SystemParameters.WorkArea.Left;
            double top = (SystemParameters.WorkArea.Height - Height) / 2 + SystemParameters.WorkArea.Top;
            Left = left;
            Top = top;
        }

        /// <summary>
        /// 切换最大化状态。若当前处于独占全屏则先退出全屏，再最大化；
        /// 已最大化则还原为普通窗口样式。切换后强制重绘以规避渲染异常。
        /// </summary>
        private void ToggleMaximized()
        {
            if (WindowState == WindowState.Maximized)
            {
                RestoreWindowStyle();
            }
            else
            {
                if (WindowStyle == WindowStyle.None) ToggleFullScreen(); // Exit fullscreen first
                WindowState = WindowState.Maximized;
            }
            ForceRedraw();
        }

        /// <summary>
        /// 【调试功能】清除所有游戏存档与设置数据。
        /// 先弹二次确认，确认后通过注入 JS 删除 localStorage 中的存档相关键并刷新页面。
        /// </summary>
        /// <param name="sender">事件源（菜单项）。</param>
        /// <param name="e">路由事件参数。</param>
        /// <remarks>仅调试构建有效；非调试构建直接返回。</remarks>
        private void ClearAllSaves(object sender, RoutedEventArgs e)
        {
            if (!_isDebug) return;

            // 二次确认对话框
            var result = MessageBox.Show(
                "确定要清除所有游戏进度和存档吗？\n\n"
                + "此操作将删除：\n"
                + "- 所有游戏存档（galgame_archives）\n"
                + "- 场景进度数据（gameProgress）\n"
                + "- 音量设置（volume_settings）\n"
                + "- 其他游戏状态数据\n\n"
                + "此操作不可恢复！",
                "确认清除",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning,
                MessageBoxResult.No
            );

            if (result != MessageBoxResult.Yes)
            {
                if (_isDebug) Console.WriteLine("[DEBUG] 用户取消了清除存档操作");
                return;
            }

            // 执行JavaScript代码清除localStorage
            var jsCode = @"
                (function() {
                    console.log('[Debug] Clearing all game saves...');
                    
                    // 清除所有游戏相关的localStorage键
                    const keysToRemove = [
                        'galgame_archives',      // 存档列表
                        'gameProgress',          // 场景进度
                        'volume_settings',       // 音量设置
                        'brightness_settings',   // 亮度设置
                        'debug_mode'             // 调试模式状态
                    ];
                    
                    let clearedCount = 0;
                    keysToRemove.forEach(key => {
                        if (localStorage.getItem(key) !== null) {
                            localStorage.removeItem(key);
                            clearedCount++;
                            console.log('[Debug] Removed: ' + key);
                        }
                    });
                    
                    console.log('[Debug] Cleared ' + clearedCount + ' save keys');
                    
                    // 显示提示消息
                    alert('已清除 ' + clearedCount + ' 项游戏数据\n\n页面即将刷新...');
                    
                    // 延迟刷新页面以同步UI状态
                    setTimeout(() => {
                        location.reload();
                    }, 500);
                    
                    return clearedCount;
                })();
            ";

            try
            {
                webView.CoreWebView2.ExecuteScriptAsync(jsCode).ContinueWith(task =>
                {
                    if (_isDebug)
                    {
                        try
                        {
                            var clearedCount = task.Result?.Trim('"') ?? "0";
                            Console.WriteLine($"[DEBUG] 清除了 {clearedCount} 项游戏数据");
                        }
                        catch { }
                    }
                });
            }
            catch (Exception ex)
            {
                if (_isDebug)
                {
                    Console.WriteLine($"[ERROR] 清除存档失败: {ex.Message}");
                }
                MessageBox.Show($"清除存档失败:\n{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        /// <summary>
        /// 【调试功能】开启/关闭「全部鉴赏」。
        /// 向引擎注入 JS 写入临时变量 tf.allclear，使受 sf.clear 门禁管控的鉴赏页
        /// （BGM / 视频 / CG / 小故事）在未通关时也可直接进入，仅供开发者测试。
        /// tf.allclear 是临时变量（标签页关闭即消失），不改动 sf.clear 与任何存档。
        /// </summary>
        /// <param name="on">true 开启，false 关闭。</param>
        private void SetAllGalleryUnlock(bool on)
        {
            if (!_isDebug) return;
            if (webView?.CoreWebView2 == null) return;

            var flag = on ? "true" : "false";
            var jsCode = "(function(){try{"
                + "if(window.VarSpace&&typeof window.VarSpace.setTempAllClear==='function'){"
                + "window.VarSpace.setTempAllClear(" + flag + ");"
                + "}else{"
                + "if(" + flag + "){sessionStorage.setItem('shiori_tf_allclear','1');}"
                + "else{sessionStorage.removeItem('shiori_tf_allclear');}"
                + "}"
                + "return true;}catch(e){return false;}})();";

            try
            {
                webView.CoreWebView2.ExecuteScriptAsync(jsCode);
                if (_isDebug)
                    Console.WriteLine($"[DEBUG] 全部鉴赏已{(on ? "开启" : "关闭")}（tf.allclear={(on ? 1 : 0)}）");
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine($"[ERROR] 切换全部鉴赏失败: {ex.Message}");
            }
        }

        /// <summary>
        /// 【调试功能】通过文件对话框加载引擎目录下的指定 HTML 场景文件。
        /// 仅允许加载 "shiori engine" 目录内的文件，通过相对路径拼接为本地服务器 URL 导航。
        /// </summary>
        /// <param name="sender">事件源（菜单项）。</param>
        /// <param name="e">路由事件参数。</param>
        private void LoadCustomScene(object sender, RoutedEventArgs e)
        {
            var dialog = new Microsoft.Win32.OpenFileDialog
            {
                Filter = "HTML Files (*.html)|*.html|All Files (*.*)|*.*",
                InitialDirectory = Path.Combine(_appDir, "shiori engine", "scenes")
            };

            if (dialog.ShowDialog() == true)
            {
                var filePath = dialog.FileName;
                var engineDir = Path.Combine(_appDir, "shiori engine");
                if (filePath.StartsWith(engineDir))
                {
                    var relativePath = filePath.Substring(engineDir.Length).TrimStart('\\', '/');
                    webView.Source = new Uri($"http://localhost:8080/{relativePath}");
                }
                else
                {
                    MessageBox.Show("只能加载引擎目录下的文件。", "警告", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
        }

        /// <summary>
        /// 打开（或激活）立绘变更可视化窗口；已打开时仅激活置前。
        /// </summary>
        /// <param name="sender">事件源（菜单项），可为 null。</param>
        /// <param name="e">路由事件参数，可为 null。</param>
        /// <remarks>创建失败时弹窗提示错误详情并清空窗口引用，避免残留失效实例。</remarks>
        private void OpenCharVisualizer(object sender, RoutedEventArgs e)
        {
            try
            {
                if (_charVisualizerWindow == null || !_charVisualizerWindow.IsLoaded)
                {
                    _charVisualizerWindow = new CharVisualizerWindow(this) { Owner = this };
                    _charVisualizerWindow.Show();
                }
                else
                {
                    _charVisualizerWindow.Activate();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[MainWindow] ERROR OpenCharVisualizer: {ex.Message}\n{ex.StackTrace}");
                MessageBox.Show(this, "打开立绘变更窗口失败:\n" + ex.Message + "\n\n" + ex.StackTrace + (ex.InnerException != null ? "\n\nInnerException:\n" + ex.InnerException.Message + "\n" + ex.InnerException.StackTrace : ""), "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                _charVisualizerWindow = null;
            }
        }

        /// <summary>关闭立绘变更窗口（若处于打开状态）并清空引用。</summary>
        private void CloseCharVisualizer()
        {
            try
            {
                if (_charVisualizerWindow != null && _charVisualizerWindow.IsLoaded)
                {
                    _charVisualizerWindow.Close();
                    _charVisualizerWindow = null;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[MainWindow] ERROR CloseCharVisualizer: {ex.Message}");
            }
        }

        /// <summary>显示"关于"对话框，展示引擎名称、版本号与版权信息。</summary>
        /// <param name="sender">事件源（菜单项）。</param>
        /// <param name="e">路由事件参数。</param>
        private void ShowAbout(object sender, RoutedEventArgs e)
        {
            MessageBox.Show(
                $"Shiori Engine Launcher\nVersion: 2.0.0\n\nShiori Engine Copyright (c) 2026 bilibili 月が綺麗ですね_",
                "关于",
                MessageBoxButton.OK,
                MessageBoxImage.Information
            );
        }

        /// <summary>
        /// 显示"存档相关问题"帮助窗口。
        /// 按调试/正式构建生成不同的说明文本，并以可滚动自定义窗口呈现（调试版额外加红色警告）。
        /// </summary>
        /// <param name="sender">事件源（菜单项）。</param>
        /// <param name="e">路由事件参数。</param>
        private void ShowArchiveHelp(object sender, RoutedEventArgs e)
        {
            string debugInfo = _isDebug ? @"
【调试版专属说明】
- 当前运行的是调试版本（Shiori_debug.exe）
- 可以使用窗口菜单的'调试' -> '清除所有存档'功能一键清空测试数据
- 调试版的存档与正式版完全隔离，互不影响
- 建议在发布前使用清除功能清理测试存档
" : @"
【正式版玩家专属 - 存档备份指南】
- 当前运行的是正式版本（Shiori.exe）
- 玩家的存档数据安全存储，不会被调试操作影响
- 提示：如果您没有看到调试版本，说明开发者未分发该版本，这是正常的，无需担心

如何备份您的存档（防止丢失）：

方法一：手动备份存档文件夹（最可靠）
  1. 找到程序目录下的文件夹：
     Shiori.exe.WebView2\EBWebView\Default\Local Storage\
  2. 复制整个 leveldb 文件夹到安全位置（如U盘、网盘）
  3. 需要恢复时，将备份的文件夹覆盖回去
  注意：操作前请完全关闭游戏程序
  优点：完整备份，包含所有存档和设置，无需依赖游戏功能

方法二：使用游戏内导出功能
  1. 在游戏主菜单点击'存档'
  2. 在存档页面点击'导出所有存档'按钮
  3. 系统会生成一个JSON文件，保存到安全位置
  4. 重装游戏或换电脑时，使用'导入存档'功能恢复
  优点：操作简单，适合快速备份当前存档列表
  注意：此方法仅导出快速存档，不包含游戏进度数据

方法三：云同步（高级用户）
  - 可以将存档文件夹添加到网盘同步目录
  - 或使用Windows自带的OneDrive自动备份
  - 确保游戏关闭后再进行同步操作

重要提醒：
  - 建议定期备份，特别是在完成重要剧情后
  - 重大更新前先备份，以防兼容性问题
  - 不要同时运行多个游戏实例，可能导致存档损坏
";

            string helpMessage = $@"
=====================================
       Shiori 引擎存档系统说明
=====================================

【存档数据存储位置】
存档数据存储在浏览器的 localStorage 中，由 WebView2 引擎管理。
物理文件位于程序目录下的：
  - 调试版：Shiori_debug.exe.WebView2\EBWebView\
  - 正式版：Shiori.exe.WebView2\EBWebView\

【存档类型】
1. 快速存档（F5）：保存在 galgame_archives 键中
   - 支持多个存档位
   - 可在存档页面管理、导出、导入
   
2. 游戏进度：保存在 gameProgress 键中
   - 记录已完成的场景
   - 追踪玩家访问过的场景标记
   - 用于流程图功能的解锁状态

3. 系统设置：保存在 volume_settings 等键中
   - 音量设置
   - 亮度设置
   - 调试模式状态

{debugInfo}

【重要提醒】
1. 存档隔离机制
   - 调试版和正式版使用不同的存储路径
   - 两者的存档数据完全独立，互不干扰
   - 这样可以保护玩家存档不被开发测试污染

2. 版本兼容性
   - 更新剧本内容不会影响存档数据
   - 但如果变更了存档格式或场景文件名，可能导致旧存档无法加载
   - 重大更新前建议备份存档（使用导出功能）

3. 存档安全
   - 不要手动删除 .WebView2 文件夹，除非确定要清空所有数据
   - 定期使用导出功能备份重要存档
   - 如遇存档问题，可尝试在调试版中清除后重新开始

4. 常见问题
   Q: 为什么我的存档消失了？
   A: 检查是否误删了 .WebView2 文件夹，或切换了调试/正式版本
   
   Q: 如何转移存档到另一台电脑？
   A: 最稳妥的方法是直接复制整个 .WebView2 文件夹到另一台电脑的游戏目录下
      （确保游戏已关闭，两个版本文件夹名称需要对应：Shiori.exe.WebView2 或 Shiori_debug.exe.WebView2）
   
   Q: 更新游戏后存档还能用吗？
   A: 通常可以，但如果存档格式变更可能需要迁移

=====================================
如有其他问题，请访问 GitHub 仓库或教学页面获取帮助。
=====================================";

            // 创建自定义对话框窗口，支持滚动和更宽显示
            var dialogWindow = new Window
            {
                Title = "存档相关问题",
                Width = 900,
                Height = 700,
                MinWidth = 700,
                MinHeight = 500,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Owner = this,
                ResizeMode = ResizeMode.CanResize,
                WindowStyle = WindowStyle.SingleBorderWindow
            };

            // 创建滚动查看器
            var scrollViewer = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Padding = new Thickness(20)
            };

            // 创建内容容器
            var contentPanel = new StackPanel();

            // 如果是调试版，添加红色警告文字
            if (_isDebug)
            {
                var warningBlock = new TextBlock
                {
                    TextWrapping = TextWrapping.Wrap,
                    FontWeight = FontWeights.Bold,
                    Foreground = System.Windows.Media.Brushes.Red,
                    FontSize = 15,
                    Margin = new Thickness(0, 0, 0, 15)
                };
                
                // 添加警告标题
                warningBlock.Inlines.Add(new System.Windows.Documents.Run(" 警告：开发者重要提示\n") { FontWeight = FontWeights.Bold });
                warningBlock.Inlines.Add(new System.Windows.Documents.Run("如果你的游戏已经对外发布，则请不要变更已发布部分的文件名等内容，以免导致玩家存档失效！\n") { FontWeight = FontWeights.Bold });
                warningBlock.Inlines.Add(new System.Windows.Documents.Run("（包括场景文件名、存档数据格式等关键信息）") { FontWeight = FontWeights.Normal, FontSize = 14 });
                
                contentPanel.Children.Add(warningBlock);

                // 添加分隔线
                var separator = new System.Windows.Controls.Separator
                {
                    Margin = new Thickness(0, 0, 0, 15),
                    Background = System.Windows.Media.Brushes.LightGray
                };
                contentPanel.Children.Add(separator);
            }

            // 创建主内容文本框
            var textBlock = new TextBlock
            {
                Text = helpMessage,
                FontFamily = new System.Windows.Media.FontFamily("Microsoft YaHei UI, Consolas, Courier New"),
                FontSize = 14,
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 22,
                Foreground = System.Windows.Media.Brushes.Black
            };

            contentPanel.Children.Add(textBlock);
            scrollViewer.Content = contentPanel;
            dialogWindow.Content = scrollViewer;

            // 显示对话框
            dialogWindow.ShowDialog();
        }

        /// <summary>
        /// 窗口尺寸变更事件：在非最大化/非全屏状态下按当前宽高比锁定高度，并刷新布局缩放。
        /// </summary>
        /// <param name="sender">事件源（窗口）。</param>
        /// <param name="e">尺寸变更参数。</param>
        private void MainWindow_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (WindowState != WindowState.Maximized && WindowStyle != WindowStyle.None)
            {
                double expectedHeight = Width / _currentAspectRatio;
                if (Math.Abs(Height - expectedHeight) > 2)
                {
                    Height = expectedHeight;
                }
            }
            ApplyLayoutScale();
        }

        /// <summary>
        /// 根据当前 WebView2 实际宽度与渲染配置的布局模式计算并应用页面缩放因子。
        /// </summary>
        /// <remarks>
        /// 仅在 WebView2 已就绪、窗口已加载且控件可见时生效；
        /// Flow 模式下同时启用用户缩放控件；缩放值无明显变化时跳过赋值以减少抖动。
        /// 依赖：_renderProfile.LayoutMode、LayoutScale.ComputeZoom。
        /// </remarks>
        private void ApplyLayoutScale()
        {
            if (webView?.CoreWebView2 == null) return;
            if (!IsLoaded) return;
            if (webView.Visibility != Visibility.Visible) return;
            double width = webView.ActualWidth;
            if (!(width > 0) || double.IsNaN(width) || double.IsInfinity(width))
                return;
            var zoom = LayoutScale.ComputeZoom(_renderProfile.LayoutMode, width);
            try
            {
                webView.CoreWebView2.Settings.IsZoomControlEnabled =
                    _renderProfile.LayoutMode == LayoutMode.Flow;
                if (Math.Abs(webView.ZoomFactor - zoom) < 1e-6) return;
                webView.ZoomFactor = zoom;
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        /// <summary>
        /// 旧 WebView2 导航完成处理：仅调试构建使用，用于判断"从头开始"菜单项是否可用。
        /// 仅当当前页面位于 /scenes/ 且检测到有效的 gameEngine 场景数据时启用该菜单项。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">导航完成参数。</param>
        private void WebView_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!_isDebug || _restartAction == null) return;

            var url = webView.Source.ToString();
            bool isInScenes = url.Contains("/scenes/") || url.EndsWith("/scenes");

            if (!isInScenes)
            {
                _restartAction.IsEnabled = false;
                return;
            }

            // 检查当前页面是否为有效的剧本文件
            _ = webView.CoreWebView2.ExecuteScriptAsync(@"
                (typeof gameEngine !== 'undefined' && 
                 gameEngine.sceneData && 
                 gameEngine.sceneData.story && 
                 gameEngine.sceneData.story.length > 0)
            ").ContinueWith(task =>
            {
                try
                {
                    var result = task.Result;
                    // JS 返回的是字符串 "true" 或 "false"
                    Application.Current.Dispatcher.Invoke(() =>
                    {
                        _restartAction.IsEnabled = result != null && result.Trim('"').ToLower() == "true";
                    });
                }
                catch { }
            });
        }

        /// <summary>
        /// 页面加载完成后，若遮罩已显示满 3 秒则直接淡出；
        /// 否则等待到 3 秒后再淡出。用户点击可跳过等待。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">导航完成参数，仅 IsSuccess 为 true 时继续。</param>
        /// <remarks>若启动时恢复了全屏，此处会在 WebView2 就绪后同步 JS 侧 is-fullscreen class。</remarks>
        private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess) return;
            _loadingCompleted = true;

            // 启动自检重载：首屏就绪后趁遮罩仍不透明，强制硬重载一次（等价 Ctrl+F5）。
            // 目的：冷启动时 WebView2 首帧的布局/图片解码偶发未收敛，重载可确保 UI 必现；
            // 放在遮罩下面执行，用户看不到任何闪烁。
            if (EnableStartupReload && !_startupReloadDone)
            {
                _startupReloadDone = true;
                if (TriggerStartupReload())
                {
                    _startupReloadInFlight = true;
                    StartReloadWatchdog();
                    return; // 等重载后的 NavigationCompleted 再走下面的收尾
                }
            }
            _startupReloadInFlight = false;
            StopReloadWatchdog();

            TryDismissSplash();
            ApplyLayoutScale();

            // 启动时恢复了全屏，但 JS 侧的 is-fullscreen class 还没设——此时 WebView2 就绪，同步
            if (_pendingFullscreenSync)
            {
                _pendingFullscreenSync = false;
                _ = webView.CoreWebView2.ExecuteScriptAsync(
                    "document.body.classList.add('is-fullscreen');");
            }
        }

        /// <summary>
        /// 判断给定 URI 是否属于引擎自身（本地 8080 端口的 http 页面）。
        /// 用于导航拦截，防止 WebView2 被导航到外部页面。
        /// </summary>
        /// <param name="uri">待判定的 URI 字符串，可为 null。</param>
        /// <returns>属于引擎本地地址（localhost/127.0.0.1:8080）或 about:blank 时返回 true。</returns>
        private static bool IsEngineUri(string? uri)
        {
            if (string.IsNullOrEmpty(uri)) return false;
            if (uri.Equals("about:blank", StringComparison.OrdinalIgnoreCase)) return true;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var u)) return false;
            if (u.Scheme != Uri.UriSchemeHttp) return false;
            if (!u.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
                && u.Host != "127.0.0.1")
                return false;
            return u.Port == 8080;
        }

        /// <summary>
        /// 尝试关闭启动遮罩：加载必须完成 + 定时器必须已到（或被用户点击跳过）。
        /// 两个条件都由 TryDismissSplash 入口处检查，定时器 Tick 和 点击事件
        /// 都会调用本方法。
        /// </summary>
        private void TryDismissSplash()
        {
            // 加载未完成 → 不关闭
            if (!_loadingCompleted) return;
            // 启动自检重载还没回来 → 保持遮罩，别把刷新过程露给用户看
            if (_startupReloadInFlight) return;
            // 定时器还在跑且用户未点击 → 不关闭（等待定时器到期）
            if (_splashTimer != null && _splashTimer.IsEnabled) return;

            FadeOutSplash();
        }

        /// <summary>
        /// 发起一次强制重载（Ctrl+F5 等价物，绕过 WebView2 磁盘/内存缓存）。
        /// </summary>
        /// <returns>成功发起返回 true；CoreWebView2 未就绪或协议调用失败返回 false。</returns>
        /// <remarks>
        /// 优先走 CDP 的 <c>Page.reload</c> 并带 <c>ignoreCache:true</c>——这才是真正的 Ctrl+F5；
        /// <c>webView.Reload()</c> 只是普通刷新，静态资源（JS/CSS/皮肤图，服务端给了 max-age=86400）
        /// 会直接命中缓存，重载后状态与首屏完全一致，等于白刷一次。
        /// CDP 不可用时退回普通刷新，至少保证页面重新执行一遍。
        /// </remarks>
        private bool TriggerStartupReload()
        {
            try
            {
                var core = webView.CoreWebView2;
                if (core == null) return false;
                _ = core.CallDevToolsProtocolMethodAsync("Page.reload", "{\"ignoreCache\":true}")
                    .ContinueWith(t =>
                    {
                        // CDP 是异步报错的（比如策略禁用了 DevTools 协议），必须挂续延才能兜底
                        if (!t.IsFaulted) return;
                        Console.WriteLine("[startup-reload] CDP Page.reload faulted: "
                            + t.Exception?.InnerException?.Message);
                        try { webView.Reload(); }
                        catch (Exception ex3)
                        {
                            Console.WriteLine("[startup-reload] fallback Reload failed: " + ex3.Message);
                        }
                    }, TaskScheduler.FromCurrentSynchronizationContext());
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine("[startup-reload] CDP Page.reload failed: " + ex.Message);
                try
                {
                    webView.Reload();
                    return true;
                }
                catch (Exception ex2)
                {
                    Console.WriteLine("[startup-reload] fallback Reload failed: " + ex2.Message);
                    return false;
                }
            }
        }

        /// <summary>
        /// 启动自检重载的兜底：5 秒内没等到新的 NavigationCompleted 就强制放行遮罩，
        /// 避免重载异常时永远卡在启动画面。
        /// </summary>
        private void StartReloadWatchdog()
        {
            StopReloadWatchdog();
            _reloadWatchdog = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _reloadWatchdog.Tick += (_, _) =>
            {
                StopReloadWatchdog();
                if (!_startupReloadInFlight) return;
                Console.WriteLine("[startup-reload] watchdog timeout, dismiss splash anyway");
                _startupReloadInFlight = false;
                TryDismissSplash();
            };
            _reloadWatchdog.Start();
        }

        /// <summary>停止并释放自检重载兜底定时器。</summary>
        private void StopReloadWatchdog()
        {
            if (_reloadWatchdog == null) return;
            _reloadWatchdog.Stop();
            _reloadWatchdog = null;
        }

        /// <summary>
        /// 遮罩淡出动画（500ms），完成后隐藏遮罩使游戏可见。
        /// </summary>
        private void FadeOutSplash()
        {
            if (_splashDismissed) return;
            _splashDismissed = true;

            var fadeOut = new DoubleAnimation(1.0, 0.0, TimeSpan.FromMilliseconds(500))
            {
                EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
            };
            fadeOut.Completed += (_, _) =>
            {
                LoadingOverlay.Visibility = Visibility.Collapsed;
                webView.Visibility = Visibility.Visible;
                webView.UpdateLayout();
                ApplyLayoutScale();

                // 开屏结束后立即重新加载 UI 皮肤，确保冷启动时图片必定显示
                _ = webView.CoreWebView2.ExecuteScriptAsync(
                    "if(window.resetUISkin){window.resetUISkin();}");
            };
            LoadingOverlay.BeginAnimation(UIElement.OpacityProperty, fadeOut);
        }

        /// <summary>
        /// WebView2 宿主消息接收处理：解析前端发来的 JSON 消息并按 action 分派。
        /// 支持 loadVideo / getNextFrame / closeVideo / showHelp / goHome /
        /// showSystemSettings / quit 等动作，必要时通过 PostWebMessageAsJson 回传结果。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">包含 WebMessageAsJson 的消息参数。</param>
        /// <remarks>所有涉及 UI 的操作均在 UI 线程 Dispatcher 上执行。</remarks>
        private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var json = e.WebMessageAsJson;
                using var doc = System.Text.Json.JsonDocument.Parse(json);
                var root = doc.RootElement;
                
                if (root.TryGetProperty("action", out var actionProp))
                {
                    string action = actionProp.GetString() ?? "";
                    string result = "";

                    switch (action)
                        {
                            case "loadVideo":
                                var videoName = root.GetProperty("path").GetString();
                                if (videoName != null) result = _videoBridge?.LoadVideo(videoName) ?? "";
                                break;
                            case "getNextFrame":
                                result = _videoBridge?.GetNextFrame() ?? "";
                                break;
                            case "closeVideo":
                                _videoBridge?.CloseVideo();
                                result = "{\"success\":true}";
                                break;
                            case "showHelp":
                                ShowHelpWindow();
                                break;
                            case "goHome":
                                // 返回主菜单（先确认）
                                Application.Current.Dispatcher.Invoke(() =>
                                {
                                    if (ShowConfirmDialog("确定要返回主菜单吗？当前未保存的进度将丢失。", "返回确认"))
                                    {
                                        webView.Source = new Uri("http://localhost:8080/index.html");
                                    }
                                });
                                break;
                            case "showSystemSettings":
                                // 显示系统设置窗口
                                var volumeData = root.GetProperty("data").ToString();
                                Application.Current.Dispatcher.Invoke(() =>
                                {
                                    ShowSystemSettingsWindow(volumeData);
                                });
                                break;
                            case "quit":
                                // 退出游戏（先确认）
                                Application.Current.Dispatcher.Invoke(() =>
                                {
                                    if (ShowConfirmDialog("确定要退出游戏吗？", "退出确认"))
                                    {
                                        _quitConfirmed = true; // 设置标志，避免重复弹窗
                                        Environment.Exit(0);
                                    }
                                });
                                break;
                        }

                    if (!string.IsNullOrEmpty(result))
                    {
                        webView.CoreWebView2.PostWebMessageAsJson(result);
                    }
                }
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine($"[ERROR] WebMessage processing error: {ex.Message}");
            }
        }

        /// <summary>
        /// 显示游戏帮助窗口（WPF原生弹窗）。
        /// 以列表形式列出常用快捷键与按钮说明，内置滚动与关闭按钮。
        /// </summary>
        private void ShowHelpWindow()
        {
            var helpWindow = new Window
            {
                Title = "帮助",
                Width = 400,
                Height = 450,
                MinWidth = 350,
                MinHeight = 350,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Owner = this,
                ResizeMode = ResizeMode.CanResize,
                WindowStyle = WindowStyle.SingleBorderWindow
            };

            // 创建主布局面板（使用Border实现内边距）
            var border = new Border
            {
                Padding = new Thickness(20),
                Background = System.Windows.Media.Brushes.White
            };
            
            var mainPanel = new StackPanel();

            // 创建帮助列表
            var helpItems = new[]
            {
                new { Label = "SKIP/1", Description = "快速跳过对话", Shortcut = "点击" },
                new { Label = "SKIP/2", Description = "快进直到选项处停止", Shortcut = "点击" },
                new { Label = "SAVE", Description = "点击打开存档管理页面", Shortcut = "点击" },
                new { Label = "SCENES", Description = "SAVE二级菜单：跳转到存档页面", Shortcut = "悬停SAVE" },
                new { Label = "MAP", Description = "SAVE二级菜单：跳转到流程图页面", Shortcut = "悬停SAVE" },
                new { Label = "STORY", Description = "SAVE二级菜单：跳转到场景鉴赏页面", Shortcut = "悬停SAVE" },
                new { Label = "OPTION", Description = "打开游戏设置菜单", Shortcut = "点击" },
                new { Label = "LOG", Description = "查看历史对话记录", Shortcut = "滚轮向上" },
                new { Label = "HELP", Description = "打开帮助界面", Shortcut = "点击" },
                new { Label = "BACK", Description = "返回主菜单", Shortcut = "点击" },
                new { Label = "QUIT", Description = "退出游戏", Shortcut = "点击" },
                new { Label = "Ctrl", Description = "按住快速跳过对话（快进）", Shortcut = "按住Ctrl" },
                new { Label = "F5", Description = "快速保存当前进度", Shortcut = "F5" },
                new { Label = "- / +", Description = "降低 / 增加音量", Shortcut = "- / +" },
                new { Label = "↑ / ↓", Description = "增加 / 降低音量", Shortcut = "方向键" },
                new { Label = "ESC", Description = "关闭弹窗 / 返回主菜单", Shortcut = "ESC" },
                new { Label = "Enter", Description = "快速显示下一行", Shortcut = "Enter" }
            };

            // 添加帮助项
            foreach (var item in helpItems)
            {
                var itemPanel = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
                
                // 标签（加粗）
                var labelBlock = new TextBlock
                {
                    Text = $"【{item.Label}】",
                    FontFamily = new System.Windows.Media.FontFamily("宋体"),
                    FontSize = 13,
                    FontWeight = FontWeights.Bold,
                    Foreground = System.Windows.Media.Brushes.Black,
                    Margin = new Thickness(0, 0, 0, 2)
                };
                
                // 描述（普通）
                var descBlock = new TextBlock
                {
                    Text = item.Description,
                    FontFamily = new System.Windows.Media.FontFamily("宋体"),
                    FontSize = 13,
                    Foreground = System.Windows.Media.Brushes.Black
                };

                itemPanel.Children.Add(labelBlock);
                itemPanel.Children.Add(descBlock);
                mainPanel.Children.Add(itemPanel);
            }

            // 关闭按钮
            var closeButton = new Button
            {
                Content = "关闭",
                Width = 100,
                Height = 30,
                FontFamily = new System.Windows.Media.FontFamily("宋体"),
                FontSize = 13,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 15, 0, 0)
            };
            closeButton.Click += (s, e) => helpWindow.Close();
            mainPanel.Children.Add(closeButton);

            // 将mainPanel放入border中
            border.Child = mainPanel;
            
            // 添加滚动容器
            var scrollViewer = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
            };
            scrollViewer.Content = border;
            helpWindow.Content = scrollViewer;

            // 显示窗口
            helpWindow.ShowDialog();
        }
        
        /// <summary>
        /// 显示确认对话框并返回结果
        /// </summary>
        /// <param name="message">提示正文。</param>
        /// <param name="title">对话框标题。</param>
        /// <returns>用户点击"是"返回 true，否则返回 false（默认按钮为"否"）。</returns>
        private bool ShowConfirmDialog(string message, string title)
        {
            var result = MessageBox.Show(
                this,
                message,
                title,
                MessageBoxButton.YesNo,
                MessageBoxImage.Question,
                MessageBoxResult.No
            );
            return result == MessageBoxResult.Yes;
        }

        /// <summary>
        /// 窗口级快捷键预处理：处理 Ctrl+F5 重载、F10 最大化、F11 全屏、
        /// F12（仅调试版开发者工具，release 屏蔽）、F9 立绘变更（调试）、Home 返回首页。
        /// </summary>
        /// <param name="sender">事件源（窗口）。</param>
        /// <param name="e">键盘事件参数，处理后将 e.Handled 置 true 以阻止冒泡。</param>
        private void MainWindow_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            // 拦截 Ctrl+F5，触发重新加载引擎
            if ((e.Key == Key.F5 || e.SystemKey == Key.F5) && Keyboard.Modifiers == ModifierKeys.Control)
            {
                webView.Reload();
                e.Handled = true;
                return;
            }
        
            // 拦截 F10，防止其被菜单栏作为"激活菜单"的快捷键捕获
            if (e.Key == Key.F10 || e.SystemKey == Key.F10)
            {
                ToggleMaximized();
                e.Handled = true;
            }
            else if (e.Key == Key.F11 || e.SystemKey == Key.F11)
            {
                ToggleFullScreen();
                e.Handled = true;
            }
            else if (e.Key == Key.F12 || e.SystemKey == Key.F12)
            {
                // F12 为调试专用：仅调试版打开开发者工具；release 版屏蔽（加密资源不允许通过 DevTools 查看明文）
                if (_isDebug)
                {
                    webView.CoreWebView2.OpenDevToolsWindow();
                }
                e.Handled = true;
            }
            else if ((e.Key == Key.F9 || e.SystemKey == Key.F9) && _isDebug)
            {
                // 如果可视化窗口已打开，关闭它；否则打开它
                if (_charVisualizerWindow != null && _charVisualizerWindow.IsLoaded)
                {
                    CloseCharVisualizer();
                }
                else
                {
                    if (_charVisualizerWindow != null) _charVisualizerWindow = null;
                    OpenCharVisualizer(null, null);
                }
                e.Handled = true;
            }
            else if (e.Key == Key.Home || e.SystemKey == Key.Home)
            {
                webView.Source = new Uri("http://localhost:8080/index.html");
                e.Handled = true;
            }
        }

        /// <summary>
        /// 切换独占全屏：进入时隐藏标题栏/边框并覆盖任务栏，退出时恢复普通窗口样式；
        /// 切换后强制重绘并通知前端切换 is-fullscreen class。
        /// </summary>
        private void ToggleFullScreen()
        {
            if (WindowStyle == WindowStyle.None)
            {
                RestoreWindowStyle();
            }
            else
            {
                // 真正的独占全屏：隐藏标题栏、边框，并覆盖任务栏
                WindowState = WindowState.Normal; // 先还原以确保尺寸计算正确
                WindowStyle = WindowStyle.None;
                ResizeMode = ResizeMode.NoResize;
                WindowState = WindowState.Maximized;
            }
            
            // 强制重绘以解决 UI 渲染异常
            ForceRedraw();

            // 通知前端状态变化
            _ = webView.CoreWebView2.ExecuteScriptAsync(@"
                document.body.classList.toggle('is-fullscreen');
            ");
        }

        /// <summary>恢复标准窗口样式：正常状态 + 单边框 + 可缩放，退出最大化/全屏。</summary>
        private void RestoreWindowStyle()
        {
            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResizeWithGrip;
        }

        /// <summary>
        /// 强制 WPF 与 WebView2 内容重绘，用于解决窗口样式切换后的渲染异常。
        /// </summary>
        private void ForceRedraw()
        {
            // 触发 WPF 的布局更新和重绘
            InvalidateVisual();
            UpdateLayout();
            
            // 稍微延迟后再次刷新，确保 WebView2 内容也完成重绘
            Dispatcher.BeginInvoke(new Action(() =>
            {
                InvalidateVisual();
                UpdateLayout();
            }), System.Windows.Threading.DispatcherPriority.Render);
        }

        // ========================================
        // 系统设置窗口相关
        // ========================================
        
        /// <summary>系统设置窗口实例，为 null 表示未打开。</summary>
        private Window? _systemSettingsWindow;
        /// <summary>主音量滑块。</summary>
        private Slider? _mainVolumeSlider;
        /// <summary>BGM 音量滑块。</summary>
        private Slider? _bgmVolumeSlider;
        /// <summary>音效（SE）音量滑块。</summary>
        private Slider? _seVolumeSlider;
        /// <summary>语音（Voice）音量滑块。</summary>
        private Slider? _voiceVolumeSlider;
        /// <summary>主音量数值文本。</summary>
        private TextBlock? _mainVolumeValue;
        /// <summary>BGM 音量数值文本。</summary>
        private TextBlock? _bgmVolumeValue;
        /// <summary>音效音量数值文本。</summary>
        private TextBlock? _seVolumeValue;
        /// <summary>语音音量数值文本。</summary>
        private TextBlock? _voiceVolumeValue;
        
        // AUTO设置相关控件
        /// <summary>AUTO 自动推进延迟滑块（0.5–10 秒）。</summary>
        private Slider? _autoDelaySlider;
        /// <summary>AUTO 延迟数值文本。</summary>
        private TextBlock? _autoDelayValue;
        /// <summary>是否显示 AUTO 倒计时的复选框。</summary>
        private CheckBox? _autoCountdownCheckbox;
        /// <summary>计数器，用于处理多次打开设置窗口的情况</summary>
        private int _autoLoadCounter = 0;
        /// <summary>版本号，用于验证回调是否过期</summary>
        private int _autoLoadVersion = 0;
        
        /// <summary>
        /// 显示系统设置窗口
        /// </summary>
        /// <param name="volumeData">前端传入的音量 JSON（含 main/bgm/se/voice 字段）。</param>
        /// <remarks>窗口已打开时仅激活置前；音量与 AUTO 设置分别同步加载。</remarks>
        private void ShowSystemSettingsWindow(string volumeData)
        {
            // 如果窗口已打开，激活它
            if (_systemSettingsWindow != null && _systemSettingsWindow.IsLoaded)
            {
                _systemSettingsWindow.Activate();
                return;
            }
            
            _systemSettingsWindow = new Window
            {
                Title = "系统设置",
                Width = 450,
                Height = 520,
                MinWidth = 350,
                MinHeight = 450,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Owner = this,
                ResizeMode = ResizeMode.CanResize,
                WindowStyle = WindowStyle.SingleBorderWindow
            };
            
            _systemSettingsWindow.Closed += SystemSettingsWindow_Closed;
            
            // 创建主布局面板（使用Border实现内边距）
            var border = new Border { Padding = new Thickness(20) };
            var mainPanel = new StackPanel();
            
            // 标题
            var titleBlock = new TextBlock
            {
                Text = "SYSTEM SETTINGS",
                FontFamily = new FontFamily("Microsoft YaHei UI"),
                FontSize = 20,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 20),
                Foreground = Brushes.DarkSlateGray
            };
            mainPanel.Children.Add(titleBlock);
            
            // 音量设置区域
            var volumeGroup = new GroupBox
            {
                Header = "音量设置",
                Margin = new Thickness(0, 0, 0, 15),
                Padding = new Thickness(15)
            };
            
            var volumePanel = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            
            // 主音量控制
            volumePanel.Children.Add(CreateVolumeControl("主音量", out _mainVolumeSlider, out _mainVolumeValue, VolumeType.Main));
            
            // BGM音量控制
            volumePanel.Children.Add(CreateVolumeControl("BGM音量", out _bgmVolumeSlider, out _bgmVolumeValue, VolumeType.Bgm));
            
            // SE音量控制
            volumePanel.Children.Add(CreateVolumeControl("SE音量", out _seVolumeSlider, out _seVolumeValue, VolumeType.Se));
            
            // Voice音量控制
            volumePanel.Children.Add(CreateVolumeControl("Voice音量", out _voiceVolumeSlider, out _voiceVolumeValue, VolumeType.Voice));
            
            volumeGroup.Content = volumePanel;
            mainPanel.Children.Add(volumeGroup);
            
            // AUTO设置区域
            var autoGroup = new GroupBox
            {
                Header = "AUTO设置",
                Margin = new Thickness(0, 0, 0, 15),
                Padding = new Thickness(15)
            };
            
            var autoPanel = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            
            // AUTO延迟时间控制（0.5-10秒）
            var delayPanel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 10) };
            
            var delayLabel = new TextBlock
            {
                Text = "自动推进延迟:",
                FontFamily = new FontFamily("Microsoft YaHei UI"),
                FontSize = 14,
                Width = 100,
                VerticalAlignment = VerticalAlignment.Center
            };
            delayPanel.Children.Add(delayLabel);
            
            _autoDelaySlider = new Slider
            {
                Minimum = 0.5,
                Maximum = 10,
                Value = 3,
                Width = 200,
                Margin = new Thickness(10, 0, 10, 0),
                TickFrequency = 0.5,
                IsSnapToTickEnabled = true
            };
            _autoDelaySlider.ValueChanged += AutoDelaySlider_ValueChanged;
            delayPanel.Children.Add(_autoDelaySlider);
            
            _autoDelayValue = new TextBlock
            {
                Text = "3.0s",
                FontFamily = new FontFamily("Microsoft YaHei UI"),
                FontSize = 14,
                Width = 50,
                TextAlignment = TextAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center
            };
            delayPanel.Children.Add(_autoDelayValue);
            
            autoPanel.Children.Add(delayPanel);
            
            // 显示倒计时选项
            var countdownPanel = new StackPanel { Orientation = Orientation.Horizontal };
            
            var countdownLabel = new TextBlock
            {
                Text = "显示倒计时:",
                FontFamily = new FontFamily("Microsoft YaHei UI"),
                FontSize = 14,
                Width = 100,
                VerticalAlignment = VerticalAlignment.Center
            };
            countdownPanel.Children.Add(countdownLabel);
            
            _autoCountdownCheckbox = new CheckBox
            {
                IsChecked = true,
                Margin = new Thickness(10, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            _autoCountdownCheckbox.Checked += AutoCountdownCheckbox_Checked;
            _autoCountdownCheckbox.Unchecked += AutoCountdownCheckbox_Unchecked;
            countdownPanel.Children.Add(_autoCountdownCheckbox);
            
            autoPanel.Children.Add(countdownPanel);
            
            autoGroup.Content = autoPanel;
            mainPanel.Children.Add(autoGroup);
            
            // 设置窗口可通过标题栏关闭（点击X按钮）
            
            // 添加到窗口
            _systemSettingsWindow.Content = mainPanel;
            
            // 加载初始音量值
            LoadInitialVolumes(volumeData);
            
            // 加载初始AUTO设置（异步加载）
            _ = LoadInitialAutoSettingsAsync();
            
            // 显示窗口（使用 Show() 而不是 ShowDialog()，避免阻塞主线程）
            _systemSettingsWindow.Show();
        }
        
        /// <summary>
        /// 创建音量控制组件
        /// </summary>
        /// <param name="label">通道标签（如"主音量"）。</param>
        /// <param name="slider">输出：创建的滑块控件（0–100）。</param>
        /// <param name="valueBlock">输出：显示百分比数值的文本块。</param>
        /// <param name="type">音量通道类型，用于回调 UpdateVolume。</param>
        /// <returns>包含标签、数值与滑块的垂直布局面板。</returns>
        /// <remarks>滑块变化时更新百分比文本并调用 UpdateVolume 通知前端。</remarks>
        private UIElement CreateVolumeControl(string label, out Slider slider, out TextBlock valueBlock, VolumeType type)
        {
            var panel = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
            
            // 标签行
            var labelPanel = new StackPanel { Orientation = Orientation.Horizontal };
            
            var labelBlock = new TextBlock
            {
                Text = label,
                FontFamily = new FontFamily("Microsoft YaHei UI"),
                FontSize = 13,
                Width = 80,
                Foreground = Brushes.Black
            };
            
            valueBlock = new TextBlock
            {
                Text = "100%",
                FontFamily = new FontFamily("Microsoft YaHei UI"),
                FontSize = 13,
                Width = 50,
                HorizontalAlignment = HorizontalAlignment.Right,
                Foreground = Brushes.Black
            };
            
            labelPanel.Children.Add(labelBlock);
            labelPanel.Children.Add(valueBlock);
            
            // 滑块容器
            var sliderPanel = new StackPanel { Orientation = Orientation.Horizontal };
            
            // 滑块
            slider = new Slider
            {
                Minimum = 0,
                Maximum = 100,
                Value = 100,
                Width = 300,
                Height = 25,
                Margin = new Thickness(0, 5, 0, 0)
            };
            
            // 使用局部变量来捕获，避免在lambda中使用out参数
            var localSlider = slider;
            var localValueBlock = valueBlock;
            
            localSlider.ValueChanged += (s, e) =>
            {
                int value = (int)Math.Round(localSlider.Value);
                localValueBlock.Text = $"{value}%";
                UpdateVolume(type, value);
            };
            
            sliderPanel.Children.Add(slider);
            
            panel.Children.Add(labelPanel);
            panel.Children.Add(sliderPanel);
            
            return panel;
        }
        
        /// <summary>
        /// 加载初始音量值
        /// </summary>
        /// <param name="volumeData">音量 JSON 字符串（main/bgm/se/voice 为整数值）。</param>
        /// <remarks>解析失败仅记录日志（调试构建），不影响窗口显示。</remarks>
        private void LoadInitialVolumes(string volumeData)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(volumeData);
                var root = doc.RootElement;
                
                if (root.TryGetProperty("main", out var mainProp))
                {
                    _mainVolumeSlider.Value = mainProp.GetInt32();
                    _mainVolumeValue.Text = $"{mainProp.GetInt32()}%";
                }
                if (root.TryGetProperty("bgm", out var bgmProp))
                {
                    _bgmVolumeSlider.Value = bgmProp.GetInt32();
                    _bgmVolumeValue.Text = $"{bgmProp.GetInt32()}%";
                }
                if (root.TryGetProperty("se", out var seProp))
                {
                    _seVolumeSlider.Value = seProp.GetInt32();
                    _seVolumeValue.Text = $"{seProp.GetInt32()}%";
                }
                if (root.TryGetProperty("voice", out var voiceProp))
                {
                    _voiceVolumeSlider.Value = voiceProp.GetInt32();
                    _voiceVolumeValue.Text = $"{voiceProp.GetInt32()}%";
                }
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine($"[ERROR] LoadInitialVolumes: {ex.Message}");
            }
        }
        
        /// <summary>
        /// 加载初始AUTO设置（异步版本）
        /// </summary>
        /// <returns>异步任务。</returns>
        /// <remarks>
        /// 读取时先移除控件事件监听，避免赋值触发回写；通过注入 JS
        /// systemModule.getAutoSettings() 获取前端设置，最后在 finally 中恢复监听器。
        /// </remarks>
        private async Task LoadInitialAutoSettingsAsync()
        {
            try
            {
                // 先移除事件监听器，防止在设置值时触发
                _autoDelaySlider.ValueChanged -= AutoDelaySlider_ValueChanged;
                _autoCountdownCheckbox.Checked -= AutoCountdownCheckbox_Checked;
                _autoCountdownCheckbox.Unchecked -= AutoCountdownCheckbox_Unchecked;
                
                // 从JavaScript获取当前AUTO设置
                var script = "systemModule.getAutoSettings()";
                var result = await webView.CoreWebView2.ExecuteScriptAsync(script);
                
                if (!string.IsNullOrEmpty(result))
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(result);
                    var root = doc.RootElement;
                    
                    if (root.TryGetProperty("delay", out var delayProp))
                    {
                        _autoDelaySlider.Value = delayProp.GetDouble();
                        _autoDelayValue.Text = $"{delayProp.GetDouble():F1}s";
                    }
                    if (root.TryGetProperty("showCountdown", out var countdownProp))
                    {
                        _autoCountdownCheckbox.IsChecked = countdownProp.GetBoolean();
                    }
                    
                    Console.WriteLine("[AUTO-DBG] Settings loaded successfully via async");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AUTO-DBG] LoadInitialAutoSettingsAsync exception: {ex.Message}");
            }
            finally
            {
                // 恢复事件监听器
                _autoDelaySlider.ValueChanged += AutoDelaySlider_ValueChanged;
                _autoCountdownCheckbox.Checked += AutoCountdownCheckbox_Checked;
                _autoCountdownCheckbox.Unchecked += AutoCountdownCheckbox_Unchecked;
            }
        }
        
        /// <summary>
        /// 加载初始AUTO设置（保留旧方法以兼容）
        /// </summary>
        /// <remarks>仅转调异步版本 LoadInitialAutoSettingsAsync。</remarks>
        private void LoadInitialAutoSettings()
        {
            // 异步调用新方法
            _ = LoadInitialAutoSettingsAsync();
        }
        
        /// <summary>
        /// AUTO延迟滑块值改变事件
        /// </summary>
        /// <param name="sender">事件源（滑块）。</param>
        /// <param name="e">包含 NewValue 的变更参数。</param>
        /// <remarks>更新数值文本并调用 systemModule.updateAutoSettings 通知前端。</remarks>
        private void AutoDelaySlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            Console.WriteLine($"[AUTO-DBG] AutoDelaySlider_ValueChanged called, newValue: {e.NewValue}");
            
            if (_autoDelayValue != null)
            {
                _autoDelayValue.Text = $"{e.NewValue:F1}s";
            }
            
            // 通知JavaScript更新设置
            _ = webView.CoreWebView2.ExecuteScriptAsync(
                $"systemModule.updateAutoSettings({{ delay: {e.NewValue}, showCountdown: {(_autoCountdownCheckbox?.IsChecked ?? false).ToString().ToLower()} }})"
            );
        }
        
        /// <summary>
        /// AUTO倒计时复选框勾选事件
        /// </summary>
        /// <param name="sender">事件源（复选框）。</param>
        /// <param name="e">路由事件参数。</param>
        /// <remarks>通知前端 showCountdown = true。</remarks>
        private void AutoCountdownCheckbox_Checked(object sender, RoutedEventArgs e)
        {
            // 通知JavaScript更新设置
            _ = webView.CoreWebView2.ExecuteScriptAsync(
                $"systemModule.updateAutoSettings({{ delay: {_autoDelaySlider?.Value ?? 3}, showCountdown: true }})"
            );
        }
        
        /// <summary>
        /// AUTO倒计时复选框取消勾选事件
        /// </summary>
        /// <param name="sender">事件源（复选框）。</param>
        /// <param name="e">路由事件参数。</param>
        /// <remarks>通知前端 showCountdown = false。</remarks>
        private void AutoCountdownCheckbox_Unchecked(object sender, RoutedEventArgs e)
        {
            // 通知JavaScript更新设置
            _ = webView.CoreWebView2.ExecuteScriptAsync(
                $"systemModule.updateAutoSettings({{ delay: {_autoDelaySlider?.Value ?? 3}, showCountdown: false }})"
            );
        }
        
        /// <summary>
        /// 更新音量设置
        /// </summary>
        /// <param name="type">音量通道类型，映射为 main/bgm/se/voice 字符串。</param>
        /// <param name="value">音量值（0–100）。</param>
        /// <remarks>通过注入 JS systemModule.setVolumeChannel 通知前端。</remarks>
        private void UpdateVolume(VolumeType type, int value)
        {
            string channel = type switch
            {
                VolumeType.Main => "main",
                VolumeType.Bgm => "bgm",
                VolumeType.Se => "se",
                VolumeType.Voice => "voice",
                _ => "main"
            };
            
            _ = webView.CoreWebView2.ExecuteScriptAsync(
                $"systemModule.setVolumeChannel('{channel}', {value})"
            );
        }
        
        /// <summary>
        /// 系统设置窗口关闭事件
        /// </summary>
        /// <param name="sender">事件源（设置窗口）。</param>
        /// <param name="e">事件参数。</param>
        /// <remarks>
        /// 递增 _autoLoadVersion 使未完成的异步回调失效，停止所有测试音频，
        /// 并通知前端恢复音频播放，最后清空窗口引用。
        /// </remarks>
        private void SystemSettingsWindow_Closed(object? sender, EventArgs e)
        {
            // 增加版本号，忽略之前的异步回调
            _autoLoadVersion++;
            
            // 停止所有测试音频
            _ = webView.CoreWebView2.ExecuteScriptAsync("systemModule.stopAllTestAudio()");
            
            // 通知 JavaScript 窗口已关闭，恢复音频播放
            _ = webView.CoreWebView2.ExecuteScriptAsync("systemModule.onSystemSettingsClosed()");
            
            _systemSettingsWindow = null;
        }
        
        /// <summary>
        /// 音量类型枚举，用于区分系统设置窗口中的四个音量通道。
        /// </summary>
        private enum VolumeType
        {
            Main,
            Bgm,
            Se,
            Voice
        }
        
        /// <summary>
        /// 菜单项"清理无用缓存文件"的点击处理。
        /// 弹出确认对话框，确认后执行清理并报告结果。
        /// </summary>
        /// <remarks>清理不影响存档（localStorage）、Cookie 与用户设置。</remarks>
        private void RunCacheCleanup()
        {
            var result = MessageBox.Show(
                this,
                "说明：本功能主要用于清理 V1.2.7 之前旧版本遗留的历史缓存文件，\n" +
                "若您是首次使用即为当前及之后版本启动器，通常无需执行此操作。\n\n" +
                "此操作将清理 WebView2 生成的缓存文件和临时数据，包括：\n\n" +
                "  · HTTP 缓存 / GPU 缓存 / 编译缓存\n" +
                "  · 崩溃报告 / 浏览器指标\n" +
                "  · 商业数据库 / 隐私沙盒数据\n" +
                "  · 组件更新缓存\n\n" +
                "游戏存档（localStorage）、Cookie 和用户设置不受影响。\n\n" +
                "是否继续？",
                "清理无用缓存文件",
                MessageBoxButton.YesNo,
                MessageBoxImage.Information,
                MessageBoxResult.No
            );

            if (result != MessageBoxResult.Yes) return;

            try
            {
                CleanupWebView2Folder();
                MessageBox.Show(
                    this,
                    "清理完成！\n\n" +
                    "提示：下次重启程序后效果会更彻底（运行中部分文件可能被锁定）。",
                    "清理完成",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    this,
                    $"清理过程中出现错误：\n{ex.Message}",
                    "清理失败",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error
                );
            }
        }

        /// <summary>
        /// 窗口关闭后的清理：关闭插件会话、停止 HttpServer、关闭视频桥接、
        /// 清理 WebView2 无用文件，并强制终止进程以确保子窗口不会阻止退出。
        /// </summary>
        /// <param name="e">事件参数。</param>
        protected override void OnClosed(EventArgs e)
        {
            try { _plugins?.Shutdown(); } catch { /* isolate */ }
            _plugins = null;
            _server?.Stop();
            _videoBridge?.CloseVideo();
            base.OnClosed(e);
            // 清理 WebView2 生成的无用文件，仅保留存档相关数据
            CleanupWebView2Folder();
            // 强制终止进程，确保子窗口（CharPreviewWindow）不会阻止退出
            Environment.Exit(0);
        }

        /// <summary>渲染配置（render_profile.json）的完整路径。</summary>
        /// <returns>位于 exe 同目录下的配置文件绝对路径。</returns>
        private string RenderProfilePath() => Path.Combine(_appDir, "render_profile.json");

        /// <summary>
        /// 构建注入到文档创建时的宿主配置脚本。
        /// 包含基于 RenderProfile 的宿主配置、调试构建标志（__SHIORI_DEBUG_BUILD），
        /// 以及引擎 system/host_config.js 辅助脚本（若存在）。
        /// </summary>
        /// <returns>拼接完成的 JavaScript 脚本文本。</returns>
        private string BuildHostConfigDocumentScript()
        {
            var boot = HostConfigScript.FromProfile(_renderProfile);
            // release 构建屏蔽 F1/F2：每次导航注入权威标志（URL 的 ?debug=1 仅首次加载携带，跨场景会丢失）
            boot += "window.__SHIORI_DEBUG_BUILD=" + (_isDebug ? "true" : "false") + ";";
            if (string.IsNullOrEmpty(_engineDir)) return boot;
            var helper = Path.Combine(_engineDir, "system", "host_config.js");
            if (!File.Exists(helper)) return boot;
            return boot + File.ReadAllText(helper);
        }

        /// <summary>
        /// 渲染配置变更回调：持久化配置并按变更类型应用。
        /// 缩略图开关立即生效；需重启的项提示用户；其余项排队刷新宿主配置。
        /// </summary>
        /// <param name="profile">新的渲染配置（null 视为默认配置）。</param>
        /// <param name="kind">变更类型，决定生效方式。</param>
        private void OnRenderProfileChanged(RenderProfile profile, RenderChangeKind kind)
        {
            profile ??= RenderProfile.Default;
            try
            {
                profile.Save(RenderProfilePath());
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine("[RenderProfile] save failed: " + ex.Message);
                MessageBox.Show("渲染设置保存失败。", "渲染设置", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            _renderProfile = profile;
            if (kind == RenderChangeKind.Thumbnails)
                _server?.SetThumbnailsEnabled(profile.Thumbnails);
            ApplyLayoutScale();

            if (kind.NeedsRestart())
            {
                MessageBox.Show("此项需重启启动器后生效。", "渲染设置", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            QueueHostConfigRefresh(kind);
        }

        /// <summary>
        /// 将宿主配置刷新任务加入串行队列。
        /// 通过 HostConfigRefreshGate 保证多次快速变更按序执行，仅最后一次生效。
        /// </summary>
        /// <param name="kind">触发刷新的变更类型。</param>
        private void QueueHostConfigRefresh(RenderChangeKind kind)
        {
            var (generation, previous) = _hostConfigRefresh.Enqueue();
            _hostConfigRefresh.NoteNeedsReload(kind.NeedsReload());
            async Task RunAsync()
            {
                try { await previous.ConfigureAwait(true); }
                catch (Exception ex)
                {
                    if (_isDebug) Console.WriteLine("[HostConfig] previous refresh: " + ex.Message);
                }
                // 代次校验：若期间已有更新的刷新入队，则放弃本次
                if (!_hostConfigRefresh.IsCurrent(generation)) return;
                await RefreshHostConfigAndMaybeReloadAsync(kind, generation).ConfigureAwait(true);
            }

            _hostConfigRefresh.SetTail(RunAsync());
        }

        /// <summary>
        /// 重新注入宿主配置脚本，并按决策结果决定是否重载页面。
        /// 通过 generation 校验保证仅最新一次刷新生效，注入失败时回退提示用户。
        /// </summary>
        /// <param name="kind">变更类型。</param>
        /// <param name="generation">本次刷新的代次号，用于判定是否仍为最新。</param>
        /// <returns>异步任务。</returns>
        private async Task RefreshHostConfigAndMaybeReloadAsync(RenderChangeKind kind, int generation)
        {
            var core = webView.CoreWebView2;
            if (core == null) return;

            string? addedId = null;
            try
            {
                addedId = await core.AddScriptToExecuteOnDocumentCreatedAsync(
                    BuildHostConfigDocumentScript()).ConfigureAwait(true);
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine("[HostConfig] inject failed: " + ex.Message);
                MessageBox.Show(
                    "宿主配置注入失败。当前页仍使用上一份配置。",
                    "渲染设置",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
                return;
            }

            core = webView.CoreWebView2;
            var needsReload = kind.NeedsReload();
            if (_hostConfigRefresh.IsCurrent(generation))
                needsReload = _hostConfigRefresh.ConsumePendingReload() || needsReload;
            var decision = HostConfigRefresh.Decide(
                generation,
                _hostConfigRefresh.Latest,
                _hostConfigScriptId,
                addedId,
                coreAlive: core != null,
                needsReload: needsReload);

            if (decision.InjectFailed)
            {
                MessageBox.Show(
                    "宿主配置注入失败。当前页仍使用上一份配置。",
                    "渲染设置",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
                return;
            }

            if (core == null) return;

            try
            {
                _hostConfigScriptId = decision.CommitId;
                foreach (var id in decision.RemoveIds)
                    core.RemoveScriptToExecuteOnDocumentCreated(id);
                if (decision.Reload)
                    core.Reload();
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine("[HostConfig] apply failed: " + ex.Message);
                MessageBox.Show(
                    "宿主配置应用失败。",
                    "渲染设置",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
            }
        }

        /// <summary>
        /// 返回 WebView2 初始化时传入的 Chromium 优化参数。
        /// 通过命令行参数在源头禁止生成崩溃报告、遥测、商业数据库、隐私沙盒等无用文件。
        /// 磁盘缓存 / 硬件加速来自 RenderProfile（OPT S5.1）。
        /// </summary>
        /// <param name="profile">渲染配置，提供磁盘缓存/硬件加速相关的额外参数；可为 null。</param>
        /// <returns>以空格拼接的 Chromium 命令行参数字符串。</returns>
        private static string GetWebView2OptimizationArgs(RenderProfile profile)
        {
            var args = new List<string>
            {
                // ── 崩溃报告 & 遥测（最大的垃圾来源）──
                "--disable-breakpad",
                "--disable-crash-reporter",
                "--disable-metrics",
                "--disable-field-trial-config",

                // ── 组件更新 ──
                "--disable-component-update",

                // ── 后台网络请求 & 静默 ping ──
                "--disable-background-networking",
                "--no-pings",

                // ── 媒体自动播放：允许无用户手势直接播放（场景换页 BGM 自动续播，
                //    配合引擎 requestAudioPlayback 的 localStorage 解锁记忆）──
                "--autoplay-policy=no-user-gesture-required",

                // ── 媒体/GPU 磁盘缓存保持 1 MB；HTTP 磁盘缓存由 RenderProfile 决定 ──
                "--media-cache-size=1048576",
                "--gpu-disk-cache-size-kb=512",

                // ── 禁用 Chromium 无用 Feature ──
                "--disable-features=" + string.Join(",", new[]
                {
                    "CommerceSubscriptions",
                    "DiscountConsentV2",
                    "ParcelTracking",
                    "BrowsingTopics",
                    "InterestGroupStorage",
                    "Fledge",
                    "FledgeAuction",
                    "PrivateAggregationApi",
                    "SharedStorageAPI",
                    "PrivacySandboxAdsAPIs",
                    "PrivacySandboxSettings",
                    "PrivacySandboxEnrollment",
                    "AutofillServerCommunication",
                    "AutofillAiModelCache",
                    "FeatureEngagementTracker",
                    "NetworkActionPredictor",
                    "OptimizationHints",
                    "OptimizationGuide",
                    "OptimizationGuideFetching",
                    "SafeBrowsing",
                    "SafeBrowsingEnhancedProtection",
                    "Sync",
                    "SyncTrustedVault",
                    "IdleDetection",
                    "BackForwardCache",
                    "Journeys",
                    "TabHoverCardImages",
                    "WebOTP",
                }),

                // ── 禁用无关子系统 ──
                "--disable-speech-api",
                "--disable-sync",
                "--disable-web-resources",
                "--disable-origin-trials",
                "--no-default-browser-check",
                "--no-first-run",
                "--disable-extensions",
            };
            profile ??= RenderProfile.Default;
            args.AddRange(profile.BrowserArgs());
            return string.Join(" ", args);
        }

        /// <summary>
        /// 首次启动时预置最简 WebView2 用户数据目录。
        /// WebView2 首次遇到空目录时会执行繁重的 Profile 初始化（创建 Preferences、
        /// Local State、各类 SQLite 数据库等，耗时数秒）。提前写入最关键的两个 JSON 和
        /// 哨兵文件，让 WebView2 认为 Profile 已就绪，从而跳过首次初始化。
        /// </summary>
        /// <param name="userDataFolder">{exeName}.WebView2 根目录</param>
        /// <remarks>已存在 EBWebView 目录时跳过；任何写入失败均静默忽略，由 WebView2 自行兜底。</remarks>
        private static void PreSeedWebView2Folder(string userDataFolder)
        {
            var ebwPath = Path.Combine(userDataFolder, "EBWebView");
            // 若已有 Profile 数据则无需预置
            if (Directory.Exists(ebwPath)) return;

            try
            {
                var defaultPath = Path.Combine(ebwPath, "Default");
                Directory.CreateDirectory(defaultPath);

                // ── 1. 哨兵文件：告诉 WebView2"已运行过首次设置"──
                File.WriteAllText(Path.Combine(ebwPath, "First Run"), "");
                File.WriteAllText(Path.Combine(defaultPath, "First Run"), "");

                // ── 2. Local State（根级别配置）──
                var localState = @"{""consented_to_metrics"":false,""metrics"":{""uid"":""""},""reporting"":{""metrics"":false},""browser"":{""enabled_labs_experiments"":[]}}";
                File.WriteAllText(Path.Combine(ebwPath, "Local State"), localState);

                // ── 3. Preferences（用户偏好，WebView2 首次运行会写入大量默认值）──
                var prefs = @"{
  ""autofill"": {""enabled"": false},
  ""browser"": {
    ""check_default_browser"": false,
    ""window_placement"": {""bottom"":720,""left"":0,""maximized"":false,""right"":1280,""top"":0,""work_area_bottom"":0,""work_area_left"":0,""work_area_right"":0,""work_area_top"":0}
  },
  ""credentials_enable_service"": false,
  ""download"": {""directory_upgrade"": true},
  ""extensions"": {""alerts"": {""initialized"": true},""chrome_url_overrides"": {}},
  ""intl"": {""accept_languages"": ""zh-CN,zh;q=0.9"",""selected_languages"": ""zh-CN,zh""},
  ""profile"": {
    ""content_settings"": {""exceptions"": {},""pref_version"": 1},
    ""created_by_version"": ""\"",
    ""name"": """",
    ""password_manager_enabled"": false
  },
  ""safebrowsing"": {""enabled"": false},
  ""savefile"": {""default_directory"": """"},
  ""signin"": {""allowed"": false},
  ""sync"": {""disabled"": true},
  ""translate"": {""enabled"": false}
}";
                File.WriteAllText(Path.Combine(defaultPath, "Preferences"), prefs);

                // ── 4. 预建必要空目录（避免首次运行时逐个创建）──
                string[] essentialDirs = {
                    "Local Storage", "IndexedDB", "blob_storage",
                    "File System",
                };
                foreach (var d in essentialDirs)
                    Directory.CreateDirectory(Path.Combine(defaultPath, d));
            }
            catch
            {
                // 预置失败不阻塞启动，WebView2 自行兜底初始化
            }
        }

        /// <summary>
        /// 清理 WebView2 用户数据目录中的非必要文件（作为安全兜底）。
        /// 主要删除上一版遗留的垃圾文件和可能仍生成的少量缓存。
        /// </summary>
        /// <remarks>仅删除崩溃/遥测/缓存类文件，不触碰 Local Storage、Cookie 等存档与用户数据。</remarks>
        private void CleanupWebView2Folder()
        {
            try
            {
                var exeName = Path.GetFileNameWithoutExtension(
                    Process.GetCurrentProcess().MainModule?.FileName ?? "");
                var userDataFolder = Path.Combine(_appDir, exeName + ".WebView2");
                if (!Directory.Exists(userDataFolder)) return;

                var ebwPath = Path.Combine(userDataFolder, "EBWebView");
                if (!Directory.Exists(ebwPath)) return;

                // 大部分无用文件已通过初始化参数禁止生成。
                // 此处仅做兜底清理：删除可能仍然存在的遗留/漏网垃圾。

                // === EBWebView 根目录：删除残余的崩溃/遥测等目录 ===
                string[] rootDeletable = {
                    "Crashpad", "BrowserMetrics", "GPUPersistentCache",
                    "GraphiteDawnCache", "GrShaderCache", "ShaderCache",
                    "component_crx_cache", "extensions_crx_cache",
                    "hyphen-data", "MEIPreload", "OriginTrials",
                    "Speech Recognition", "Subresource Filter", "WidevineCdm",
                    "VideoDecodeStats", "AutoLaunchProtocolsComponent",
                    "PKIMetadata", "SmartScreen",
                    "Trust Protection Lists", "TrustTokenKeyCommitments",
                    "CertificateRevocation",
                };

                foreach (var name in rootDeletable)
                    TryDelete(Path.Combine(ebwPath, name));

                DeleteFilesByPattern(ebwPath, "*.pma");

                // === Default 目录：删除残余的缓存与商业/遥测数据库 ===
                var defaultPath = Path.Combine(ebwPath, "Default");
                if (!Directory.Exists(defaultPath)) return;

                string[] defaultDeletable = {
                    "Cache", "Code Cache", "GPUCache",
                    "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache",
                    "VideoDecodeStats", "commerce_subscription_db",
                    "discounts_db", "discount_infos_db", "parcel_tracking_db",
                    "DashTrackerDatabase", "BrowsingTopicsSiteData",
                    "BrowsingTopicsState", "InterestGroups",
                    "PrivateAggregation", "SharedStorage", "BudgetDatabase",
                    "Vpn Tokens", "AutofillAiModelCache", "AutofillStrikeDatabase",
                    "PersistentOriginTrials", "Shared Dictionary",
                    "Safe Browsing Network", "shared_proto_db",
                    "Feature Engagement Tracker", "DIPS",
                    "Network Action Predictor",
                    "Site Characteristics Database",
                    "optimization_guide_hint_cache_store",
                    "Sessions", "README", "ExtensionActivityComp",
                };

                // === Default 目录：删除残余的缓存与商业/遥测数据库 ===
                foreach (var name in defaultDeletable)
                {
                    var fp = Path.Combine(defaultPath, name);
                    // 同时清理同名的 SQLite journal / WAL 文件
                    TryDelete(fp);
                    TryDelete(fp + "-journal");
                    TryDelete(fp + "-wal");
                }

                // 清理遗留的 .old / .pma 文件及 LevelDB 旧日志
                DeleteFilesByPattern(defaultPath, "*.old");
                DeleteFilesByPattern(defaultPath, "*.pma");
                CleanLevelDbOldLogs(defaultPath);
            }
            catch
            {
                // 清理失败不影响正常退出
            }
        }

        /// <summary>
        /// 尝试删除指定文件或目录（递归）。文件被锁定或不存在时静默忽略。
        /// </summary>
        /// <param name="path">待删除的文件或目录路径。</param>
        private static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path))
                    File.Delete(path);
                else if (Directory.Exists(path))
                    Directory.Delete(path, true);
            }
            catch
            {
                // 文件可能被锁定，忽略
            }
        }

        /// <summary>
        /// 递归删除目录下匹配指定模式的所有文件，逐个容错（失败静默跳过）。
        /// </summary>
        /// <param name="directory">搜索根目录。</param>
        /// <param name="pattern">文件通配模式（如 "*.old"）。</param>
        private static void DeleteFilesByPattern(string directory, string pattern)
        {
            try
            {
                if (!Directory.Exists(directory)) return;
                foreach (var file in Directory.GetFiles(directory, pattern, SearchOption.AllDirectories))
                {
                    try { File.Delete(file); } catch { }
                }
            }
            catch { }
        }

        /// <summary>
        /// 递归清理 LevelDB 遗留的 LOG.old 日志文件，失败静默跳过。
        /// </summary>
        /// <param name="directory">搜索根目录。</param>
        private static void CleanLevelDbOldLogs(string directory)
        {
            try
            {
                foreach (var file in Directory.GetFiles(directory, "LOG.old", SearchOption.AllDirectories))
                {
                    try { File.Delete(file); } catch { }
                }
            }
            catch { }
        }

        /// <summary>
        /// 启动器提供给插件的宿主实现（IShioriHost）。
        /// 向插件暴露应用/引擎/插件目录信息，并提供 UI 线程调用与日志能力。
        /// </summary>
        private sealed class LauncherPluginHost : IShioriHost
        {
            /// <summary>WPF Dispatcher，用于将插件回调调度到 UI 线程。</summary>
            private readonly Dispatcher _dispatcher;
            /// <summary>
            /// 构造插件宿主。
            /// </summary>
            /// <param name="appDir">应用（exe）目录。</param>
            /// <param name="engineDir">引擎目录。</param>
            /// <param name="pluginDir">插件目录。</param>
            /// <param name="dispatcher">UI 线程 Dispatcher。</param>
            public LauncherPluginHost(string appDir, string engineDir, string pluginDir, Dispatcher dispatcher)
            {
                AppDirectory = appDir ?? "";
                EngineDirectory = engineDir ?? "";
                PluginDirectory = pluginDir ?? "";
                _dispatcher = dispatcher;
            }
            /// <summary>宿主 API 版本，与加载器约定保持一致。</summary>
            public int ApiVersion => ShioriPluginLoader.HostApiVersion;
            /// <summary>应用（exe）目录。</summary>
            public string AppDirectory { get; }
            /// <summary>引擎目录。</summary>
            public string EngineDirectory { get; }
            /// <summary>插件目录。</summary>
            public string PluginDirectory { get; }
            /// <summary>输出日志到控制台。</summary>
            /// <param name="message">日志内容。</param>
            public void Log(string message) => Console.WriteLine(message);
            /// <summary>
            /// 在 UI 线程上执行指定动作；已在 UI 线程时直接执行，否则通过 Dispatcher.Invoke 调度。
            /// </summary>
            /// <param name="action">待执行的动作；为 null 时忽略。</param>
            public void InvokeOnUi(Action action)
            {
                if (action == null) return;
                if (_dispatcher.CheckAccess()) action();
                else _dispatcher.Invoke(action);
            }
        }
    }
}
