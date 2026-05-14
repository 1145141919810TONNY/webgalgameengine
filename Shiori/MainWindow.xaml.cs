using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;

namespace ShioriCSharp
{
    public partial class MainWindow : Window
    {
        private HttpServer? _server;
        private VideoBridge? _videoBridge;
        private readonly string _appDir;
        private readonly bool _isDebug;
        private MenuItem? _restartAction;
        private double _currentAspectRatio = 16.0 / 9.0;

        public MainWindow()
        {
            InitializeComponent();
            
            _appDir = AppDomain.CurrentDomain.BaseDirectory;
            
            // 检测是否为调试版（文件名包含 debug）
            var exeName = Path.GetFileNameWithoutExtension(System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName ?? "");
            _isDebug = exeName.IndexOf("debug", StringComparison.OrdinalIgnoreCase) >= 0;

            Loaded += MainWindow_Loaded;
            PreviewKeyDown += MainWindow_PreviewKeyDown;
            SizeChanged += MainWindow_SizeChanged;
            webView.NavigationCompleted += WebView_NavigationCompleted;
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            SetupMenu();

            var engineDir = Path.Combine(_appDir, "shiori engine");
            if (!Directory.Exists(engineDir))
            {
                MessageBox.Show("未找到 'shiori engine' 文件夹", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
                return;
            }

            // 启动本地服务器
            _server = new HttpServer(engineDir, 8080, _isDebug);
            _server.Start();

            // 初始化视频桥接
            _videoBridge = new VideoBridge(_appDir, _isDebug);

            // 初始化 WebView2
            await webView.EnsureCoreWebView2Async();
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            
            // 加载页面
            webView.Source = new Uri("http://localhost:8080/index.html");
        }

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

            var reloadAction = new MenuItem { Header = "重新加载引擎" };
            reloadAction.Click += (s, e) => webView.Reload();
            fileMenu.Items.Add(reloadAction);

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
                _restartAction.Click += (s, e) => webView.Reload();
                debugMenu.Items.Add(_restartAction);

                debugMenu.Items.Add(new Separator());

                var loadSceneAction = new MenuItem { Header = "加载指定文件" };
                loadSceneAction.Click += LoadCustomScene;
                debugMenu.Items.Add(loadSceneAction);

                MainMenu.Items.Add(debugMenu);
            }
        }

        private void SetAspectRatio(double ratio, MenuItem current, MenuItem other)
        {
            _currentAspectRatio = ratio;
            current.IsChecked = true;
            other.IsChecked = false;

            RestoreWindowStyle();

            int width = (int)Width;
            int height = (int)(width / ratio);
            Width = width;
            Height = height;
            CenterWindowOnScreen();
        }

        private void UpdateResolutionMenu(MenuItem menu)
        {
            menu.Items.Clear();
            var resolutions = _currentAspectRatio == 16.0 / 9.0
                ? new (string label, int w, int h)[] { ("1280 x 720", 1280, 720), ("1366 x 768", 1366, 768), ("1600 x 900", 1600, 900) }
                : new (string label, int w, int h)[] { ("800 x 600", 800, 600), ("1024 x 768", 1024, 768) };

            foreach (var res in resolutions)
            {
                var item = new MenuItem { Header = res.label };
                item.Click += (s, e) => ChangeResolution(res.w, res.h);
                menu.Items.Add(item);
            }
        }

        private void ChangeResolution(int width, int height)
        {
            RestoreWindowStyle();
            Width = width;
            Height = height;
            CenterWindowOnScreen();
        }

        private void CenterWindowOnScreen()
        {
            double left = (SystemParameters.WorkArea.Width - Width) / 2 + SystemParameters.WorkArea.Left;
            double top = (SystemParameters.WorkArea.Height - Height) / 2 + SystemParameters.WorkArea.Top;
            Left = left;
            Top = top;
        }

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

        private void ShowAbout(object sender, RoutedEventArgs e)
        {
            MessageBox.Show(
                $"Shiori Engine Launcher\nVersion: 1.2.0\n\nDescription: A lightweight visual novel engine launcher.",
                "关于",
                MessageBoxButton.OK,
                MessageBoxImage.Information
            );
        }

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
        }

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

        private void MainWindow_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            // 拦截 F10，防止其被菜单栏作为“激活菜单”的快捷键捕获
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
            else if ((e.Key == Key.F12 || e.SystemKey == Key.F12) && _isDebug)
            {
                webView.CoreWebView2.OpenDevToolsWindow();
                e.Handled = true;
            }
            else if (e.Key == Key.Home || e.SystemKey == Key.Home)
            {
                webView.Source = new Uri("http://localhost:8080/index.html");
                e.Handled = true;
            }
        }

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

        private void RestoreWindowStyle()
        {
            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResizeWithGrip;
        }

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

        protected override void OnClosed(EventArgs e)
        {
            _server?.Stop();
            _videoBridge?.CloseVideo();
            base.OnClosed(e);
        }
    }
}
