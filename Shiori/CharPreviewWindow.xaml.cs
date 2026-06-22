/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * Shiori 启动器 — 立绘预览窗口
 * 支持实时查看和切换立绘差分效果
 */

using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Web.WebView2.Core;

namespace ShioriCSharp
{
    /// <summary>
    /// 立绘预览窗口 - 内嵌 WebView2 浏览器，复用 engine.js 立绘渲染
    ///     
    /// 核心设计：不再用 C# Canvas 手动计算坐标叠加 dress/face 层，
    /// 而是内置一个独立 WebView2 加载 char_preview.html，
    /// 通过 ExecuteScriptAsync 调用 engine.js 的 renderChars()。
    /// 引擎原有渲染逻辑 100% 复用，新旧立绘系统均支持。
    /// </summary>
    public partial class CharPreviewWindow : Window
    {
        private readonly CharVisualizerWindow _parent;
        public CharVisualizerWindow? ParentWindow => _parent;

        private string _currentChar = "";
        private string _currentOrientation = "";
        private string _currentDressId = "";
        private string _currentDiffId = "";
        private string _currentFaceId = "";
        private string _currentCommand = "";

        private bool _forceClose = false;
        private bool _webViewReady = false;
        private bool _hasPendingRender = false;

        /// <summary>
        /// 检查 WebView 是否就绪
        /// </summary>
        public bool IsWebViewReady => _webViewReady;

        // 长宽比锁定
        private double _aspectRatio = 16.0 / 9.0;
        private bool _isResizing = false;
        private const double TOPBAR_HEIGHT = 42; // 顶栏大约高度（Border padding*2 + content）

        // 拖拽缩放检测（防止每次 SizeChanged 都触发 WebView2 重绘抖动）
        private HwndSource? _hwndSource;
        private bool _isUserDragResizing = false;

        public CharPreviewWindow(CharVisualizerWindow parent)
        {
            try
            {
                _parent = parent;
                InitializeComponent();
                Loaded += OnLoaded;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR 构造函数: {ex.Message}");
                throw;
            }
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            try
            {
                Console.WriteLine("[CharPreview] 窗口加载完成，初始化内嵌 WebView2...");

                // 注册 Windows 消息钩子，检测拖拽缩放开始/结束
                _hwndSource = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);
                if (_hwndSource != null)
                {
                    _hwndSource.AddHook(WndProc);
                    Console.WriteLine("[CharPreview] HwndSource hook registered for resize detection");
                }

                // 初始化 WebView2
                await charWebView.EnsureCoreWebView2Async();

                // 隐藏 WebView2 默认右键菜单
                charWebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;

                // 监听页面加载完成
                charWebView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;

                // 加载预览专用 HTML 页面（复用端口 8080 的 HTTP 服务器）
                string previewUrl = GetPreviewUrl();
                charWebView.Source = new Uri(previewUrl);
                Console.WriteLine($"[CharPreview] 加载预览页面: {previewUrl}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR OnLoaded: {ex.Message}");
            }
        }

        /// <summary>
        /// Windows 消息钩子：检测用户拖拽窗口边框的开始与结束
        /// 拖拽期间隐藏 WebView2 防止每帧重绘闪烁，松手后一次性恢复
        /// </summary>
        private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            const int WM_ENTERSIZEMOVE = 0x0231;
            const int WM_EXITSIZEMOVE  = 0x0232;

            switch (msg)
            {
                case WM_ENTERSIZEMOVE:
                    if (!_isUserDragResizing)
                    {
                        _isUserDragResizing = true;
                        charWebView.Visibility = Visibility.Hidden;
                        Console.WriteLine("[CharPreview] 开始拖拽缩放 — WebView2 已隐藏");
                    }
                    break;

                case WM_EXITSIZEMOVE:
                    _isUserDragResizing = false;
                    AdjustSizeToFinal();
                    charWebView.Visibility = Visibility.Visible;
                    Console.WriteLine("[CharPreview] 拖拽缩放结束 — WebView2 已恢复，单次重绘");
                    break;
            }

            return IntPtr.Zero;
        }

        /// <summary>
        /// 根据当前窗口尺寸和长宽比做一次性最终调整（仅在拖拽结束时调用）
        /// </summary>
        private void AdjustSizeToFinal()
        {
            if (_aspectRatio <= 0) return;

            try
            {
                _isResizing = true;

                double contentH = Math.Max(ActualHeight - TOPBAR_HEIGHT, 1);
                double currentRatio = ActualWidth / contentH;
                double ratioDiff = Math.Abs(currentRatio - _aspectRatio);

                if (ratioDiff >= 0.02)
                {
                    double newHeight = (ActualWidth / _aspectRatio) + TOPBAR_HEIGHT;
                    if (newHeight >= MinHeight && newHeight <= SystemParameters.WorkArea.Height * 0.9)
                        Height = newHeight;
                }
            }
            finally
            {
                _isResizing = false;
            }
        }

        /// <summary>
        /// 获取预览 HTML 的完整 URL
        /// </summary>
        private string GetPreviewUrl()
        {
            try
            {
                if (_parent?.OwnerWindow?.WebView?.Source != null)
                {
                    var src = _parent.OwnerWindow.WebView.Source;
                    return $"{src.Scheme}://{src.Host}:{src.Port}/char_preview.html";
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] 获取 base URL 失败: {ex.Message}");
            }
            return "http://localhost:8080/char_preview.html";
        }

        /// <summary>
        /// WebView2 页面加载完成回调
        /// </summary>
        private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess)
            {
                _webViewReady = true;
                Console.WriteLine("[CharPreview] char_preview.html 加载完成，WebView 就绪");

                // 如果有待渲染的立绘，立即渲染
                if (_hasPendingRender)
                {
                    _hasPendingRender = false;
                    _ = RenderCharacter();
                }
            }
            else
            {
                Console.WriteLine($"[CharPreview] 页面加载失败: {e.WebErrorStatus}");
            }
        }

        private void OnOpenControlClick(object sender, RoutedEventArgs e)
        {
            Console.WriteLine("[CharPreview] 打开控制面板");
            if (_parent != null)
            {
                _parent.Show();
                _parent.Activate();
                _parent.WindowState = WindowState.Normal;
            }
        }

        private void OnCopyCommandClick(object sender, RoutedEventArgs e)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(_currentCommand))
                {
                    Clipboard.SetText(_currentCommand);
                    MessageBox.Show("指令已复制:\n" + _currentCommand, "复制成功", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR 复制指令失败: {ex.Message}");
                MessageBox.Show("复制失败: " + ex.Message, "复制失败", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }



        /// <summary>
        /// 更新预览信息（由 CharVisualizerWindow 调用）
        /// </summary>
        public void UpdateInfo(string charName, string orientation,
            string dressId, string diffId, string faceId, string cmd)
        {
            _currentChar = charName;
            _currentOrientation = orientation;
            _currentDressId = dressId;
            _currentDiffId = diffId;
            _currentFaceId = faceId;
            _currentCommand = cmd;

            Console.WriteLine($"[CharPreview] UpdateInfo: char={_currentChar}, cmd={_currentCommand}");

            txtCharName.Text = charName;
            txtOrientation.Text = orientation;
            txtDress.Text = !string.IsNullOrEmpty(dressId) ? $"服装:{dressId}" : "";
            txtDiff.Text = !string.IsNullOrEmpty(diffId) ? $"差分:{diffId}" : "";
            txtFace.Text = !string.IsNullOrEmpty(faceId) ? $"表情:{faceId}" : "";
            txtCommand.Text = cmd;
        }

        /// <summary>
        /// 刷新立绘渲染（由 CharVisualizerWindow 调用）
        /// </summary>
        public async Task RefreshImage()
        {
            Console.WriteLine($"[CharPreview] RefreshImage: char={_currentChar}, cmd={_currentCommand}");

            if (!_webViewReady)
            {
                Console.WriteLine("[CharPreview] WebView 尚未就绪，标记待渲染");
                _hasPendingRender = true;
                return;
            }

            await RenderCharacter();
        }

        /// <summary>
        /// 通过 WebView2 ExecuteScriptAsync 调用 JS 渲染立绘
        /// cmd 来自 GenerateCommand()，格式如 "[角色A 中 正面 服装1 表情101]" 或 "[lh01 中 lh01_1]"
        /// 直接传给 engine.js 的 renderChars()，由引擎原生处理新旧系统双重逻辑
        /// </summary>
        private async Task RenderCharacter()
        {
            try
            {
                var charsStr = _currentCommand ?? "";

                // 转义 JS 字符串中的特殊字符
                string escaped = EscapeJsString(charsStr);

                var js = $"setCharPreview('{escaped}')";
                Console.WriteLine($"[CharPreview] 执行 JS: {js}");

                await charWebView.CoreWebView2.ExecuteScriptAsync(js);
                Console.WriteLine("[CharPreview] 立绘渲染完成");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR RenderCharacter: {ex.Message}");
            }
        }

        /// <summary>
        /// 设置长宽比（由 CharVisualizerWindow 的长宽比下拉框触发）
        /// 同时适配窗口大小以匹配
        /// </summary>
        public void SetAspectRatio(double ratio)
        {
            if (ratio <= 0) return;
            _aspectRatio = ratio;
            Console.WriteLine($"[CharPreview] SetAspectRatio({ratio:F3})");

            try
            {
                _isResizing = true;

                // 根据当前宽度重新计算高度
                double contentHeight = (ActualWidth / ratio);
                double newHeight = contentHeight + TOPBAR_HEIGHT;

                if (newHeight >= MinHeight && newHeight <= SystemParameters.WorkArea.Height * 0.9)
                {
                    Height = newHeight;
                }
            }
            finally
            {
                _isResizing = false;
            }
        }

        /// <summary>
        /// 窗口大小变化时锁定长宽比
        /// 用户拖拽缩放期间跳过比例调整和 WebView2 重绘，松手后一次性完成
        /// </summary>
        private void OnWindowSizeChanged(object sender, SizeChangedEventArgs e)
        {
            // 用户正在拖拽缩放边框 → 完全跳过，不触发任何重绘或比例调整
            if (_isUserDragResizing) return;

            if (_isResizing || _aspectRatio <= 0) return;

            // 计算当前内容区的实际比例
            double contentH = Math.Max(e.NewSize.Height - TOPBAR_HEIGHT, 1);
            double currentRatio = e.NewSize.Width / contentH;
            double ratioDiff = Math.Abs(currentRatio - _aspectRatio);

            // 已接近目标比例（2%容差），无需变更，防止振荡
            if (ratioDiff < 0.02) return;

            try
            {
                _isResizing = true;

                // 判断用户主要在拖拽宽度还是高度
                double deltaW = Math.Abs(e.NewSize.Width - e.PreviousSize.Width);
                double deltaH = Math.Abs(e.NewSize.Height - e.PreviousSize.Height);

                if (deltaW >= deltaH)
                {
                    // 宽度驱动：以宽度为基准锁定高度
                    double newHeight = (e.NewSize.Width / _aspectRatio) + TOPBAR_HEIGHT;
                    if (newHeight >= MinHeight)
                        Height = newHeight;
                }
                else
                {
                    // 高度驱动：以高度为基准锁定宽度
                    double newWidth = Math.Max(e.NewSize.Height - TOPBAR_HEIGHT, 1) * _aspectRatio;
                    if (newWidth >= MinWidth)
                        Width = newWidth;
                }
            }
            finally
            {
                _isResizing = false;
            }
        }

        /// <summary>
        /// 转义 JS 字符串（单引号版本）
        /// </summary>
        private static string EscapeJsString(string s)
        {
            return s.Replace("\\", "\\\\")
                    .Replace("'", "\\'")
                    .Replace("\n", "\\n")
                    .Replace("\r", "\\r");
        }

        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            if (_forceClose)
            {
                e.Cancel = false;
                return;
            }
            e.Cancel = true;
            Hide();
            Console.WriteLine("[CharPreview] 窗口隐藏（未销毁）");
        }

        /// <summary>
        /// 强制关闭窗口（父窗口关闭时调用）
        /// </summary>
        public void ForceClose()
        {
            // 停止 BGM 播放
            StopBgm();
            
            _forceClose = true;
            Close();
        }

        /// <summary>
        /// 执行 JavaScript 脚本（供 CharVisualizerWindow 调用）
        /// </summary>
        public async Task<string> ExecuteScriptAsync(string script)
        {
            if (!_webViewReady || charWebView?.CoreWebView2 == null)
            {
                Console.WriteLine("[CharPreview] ExecuteScriptAsync: WebView not ready");
                return "null";
            }
            
            try
            {
                return await charWebView.CoreWebView2.ExecuteScriptAsync(script);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR ExecuteScriptAsync: {ex.Message}");
                return "null";
            }
        }

        // ============================================================
        //  背景控制方法（供 CharVisualizerWindow 调用）
        // ============================================================

        public async void SetBackground(string bgPath)
        {
            if (!_webViewReady) return;
            
            try
            {
                string escaped = EscapeJsString(bgPath);
                var js = $"setBackgroundImage('{escaped}')";
                Console.WriteLine($"[CharPreview] SetBackground: {js}");
                await charWebView.CoreWebView2.ExecuteScriptAsync(js);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR SetBackground: {ex.Message}");
            }
        }

        public async void ClearBackground()
        {
            if (!_webViewReady) return;
            
            try
            {
                await charWebView.CoreWebView2.ExecuteScriptAsync("clearBackground()");
                Console.WriteLine("[CharPreview] Background cleared");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR ClearBackground: {ex.Message}");
            }
        }

        // ============================================================
        //  BGM 控制方法（供 CharVisualizerWindow 调用）
        // ============================================================

        public async void SetBgm(string bgmPath, double volume)
        {
            if (!_webViewReady) return;
            
            try
            {
                string escaped = EscapeJsString(bgmPath);
                var js = $"setBgm('{escaped}', {volume})";
                Console.WriteLine($"[CharPreview] SetBgm: {js}");
                await charWebView.CoreWebView2.ExecuteScriptAsync(js);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR SetBgm: {ex.Message}");
            }
        }

        public async void StopBgm()
        {
            if (!_webViewReady) return;
            
            try
            {
                await charWebView.CoreWebView2.ExecuteScriptAsync("stopBgm()");
                Console.WriteLine("[CharPreview] BGM stopped");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR StopBgm: {ex.Message}");
            }
        }

        public async void PauseBgm()
        {
            if (!_webViewReady) return;
            
            try
            {
                await charWebView.CoreWebView2.ExecuteScriptAsync("pauseBgm()");
                Console.WriteLine("[CharPreview] BGM paused");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR PauseBgm: {ex.Message}");
            }
        }

        public async void ResumeBgm()
        {
            if (!_webViewReady) return;
            
            try
            {
                await charWebView.CoreWebView2.ExecuteScriptAsync("resumeBgm()");
                Console.WriteLine("[CharPreview] BGM resumed");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR ResumeBgm: {ex.Message}");
            }
        }

        public async void SetBgmVolume(double volume)
        {
            if (!_webViewReady) return;
            
            try
            {
                var js = $"setBgmVolume({volume})";
                await charWebView.CoreWebView2.ExecuteScriptAsync(js);
                Console.WriteLine($"[CharPreview] BGM volume set to {volume}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR SetBgmVolume: {ex.Message}");
            }
        }

        // ============================================================
        //  文本控制方法（供 CharVisualizerWindow 调用）
        // ============================================================

        public async void ApplyText(string text, string name)
        {
            if (!_webViewReady) return;
            
            try
            {
                string escapedText = EscapeJsString(text);
                string escapedName = EscapeJsString(name);
                var js = $"applyText('{escapedText}', '{escapedName}')";
                Console.WriteLine($"[CharPreview] ApplyText: {js}");
                await charWebView.CoreWebView2.ExecuteScriptAsync(js);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] ERROR ApplyText: {ex.Message}");
            }
        }
    }
}
