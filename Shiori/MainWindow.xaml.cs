/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * Shiori 启动器 — 主窗口交互逻辑
 * 处理游戏启动、窗口管理、菜单系统及 WebView2 集成等核心功能
 */

using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
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
        private CharVisualizerWindow? _charVisualizerWindow;
        private bool _quitConfirmed = false; // QUIT按钮确认标志

        /// <summary>供子窗口访问 WebView2 控件</summary>
        public Microsoft.Web.WebView2.Wpf.WebView2 WebView => webView;
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
            Closing += OnWindowClosing;
        }
        
        /// <summary>
        /// 窗口关闭事件处理（点击X按钮时弹出确认）
        /// </summary>
        private void OnWindowClosing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            // 如果QUIT按钮已经确认过，直接退出不再弹确认
            if (_quitConfirmed)
            {
                return;
            }
            
            // 弹出确认对话框
            if (!ShowConfirmDialog("确定要退出游戏吗？", "退出确认"))
            {
                // 用户取消关闭，阻止关闭事件
                e.Cancel = true;
            }
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

            // 初始化 WebView2
            await webView.EnsureCoreWebView2Async();
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            
            // 加载页面（添加debug参数）
            var debugParam = _isDebug ? "?debug=1" : "";
            webView.Source = new Uri($"http://localhost:8080/index.html{debugParam}");
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

            var reloadAction = new MenuItem { Header = "重新加载引擎", InputGestureText = "Ctrl+F5" };
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

            // 设置菜单
            var settingsMenu = new MenuItem { Header = "设置(_S)" };

            var systemSettingsAction = new MenuItem { Header = "系统设置" };
            systemSettingsAction.Click += (s, e) =>
            {
                // 调用 JavaScript 打开系统设置
                _ = webView.CoreWebView2.ExecuteScriptAsync("systemModule.showSystemSettings()");
            };
            settingsMenu.Items.Add(systemSettingsAction);

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
                _restartAction.Click += (s, e) => webView.Reload();
                debugMenu.Items.Add(_restartAction);

                debugMenu.Items.Add(new Separator());

                var flowchartDebugAction = new MenuItem { Header = "剧本流程图(调试版)" };
                flowchartDebugAction.Click += (s, e) => webView.Source = new Uri("http://localhost:8080/html/flowchart_debug.html");
                debugMenu.Items.Add(flowchartDebugAction);

                debugMenu.Items.Add(new Separator());

                var clearSavesAction = new MenuItem { Header = "清除所有存档" };
                clearSavesAction.Click += ClearAllSaves;
                debugMenu.Items.Add(clearSavesAction);

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

        private void ShowAbout(object sender, RoutedEventArgs e)
        {
            MessageBox.Show(
                $"Shiori Engine Launcher\nVersion: 1.2.5\n\nShiori Engine Copyright (c) 2026 bilibili 月が綺麗ですね_",
                "关于",
                MessageBoxButton.OK,
                MessageBoxImage.Information
            );
        }

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
        /// 显示游戏帮助窗口（WPF原生弹窗）
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
            else if ((e.Key == Key.F12 || e.SystemKey == Key.F12) && _isDebug)
            {
                webView.CoreWebView2.OpenDevToolsWindow();
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

        // ========================================
        // 系统设置窗口相关
        // ========================================
        
        private Window? _systemSettingsWindow;
        private Slider? _mainVolumeSlider;
        private Slider? _bgmVolumeSlider;
        private Slider? _seVolumeSlider;
        private Slider? _voiceVolumeSlider;
        private TextBlock? _mainVolumeValue;
        private TextBlock? _bgmVolumeValue;
        private TextBlock? _seVolumeValue;
        private TextBlock? _voiceVolumeValue;
        
        // AUTO设置相关控件
        private Slider? _autoDelaySlider;
        private TextBlock? _autoDelayValue;
        private CheckBox? _autoCountdownCheckbox;
        private int _autoLoadCounter = 0;  // 计数器，用于处理多次打开设置窗口的情况
        private int _autoLoadVersion = 0;   // 版本号，用于验证回调是否过期
        
        /// <summary>
        /// 显示系统设置窗口
        /// </summary>
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
        private void LoadInitialAutoSettings()
        {
            // 异步调用新方法
            _ = LoadInitialAutoSettingsAsync();
        }
        
        /// <summary>
        /// AUTO延迟滑块值改变事件
        /// </summary>
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
        /// 音量类型枚举
        /// </summary>
        private enum VolumeType
        {
            Main,
            Bgm,
            Se,
            Voice
        }
        
        protected override void OnClosed(EventArgs e)
        {
            _server?.Stop();
            _videoBridge?.CloseVideo();
            base.OnClosed(e);
            // 强制终止进程，确保子窗口（CharPreviewWindow）不会阻止退出
            Environment.Exit(0);
        }
    }
}
