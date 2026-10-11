// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// Shiori 启动器 — 立绘预览窗口（CharPreviewWindow）
// 内嵌独立的 WebView2 浏览器加载 char_preview.html，实时预览立绘差分/背景/BGM/文本效果，
// 通过 ExecuteScriptAsync 调用 engine.js 的渲染逻辑，100% 复用引擎原生立绘系统。
// 主要供 CharVisualizerWindow（立绘可视化调试窗口）调用与展示。

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
        /// <summary>父级立绘可视化窗口（拥有并管理本预览窗口的生命周期）。</summary>
        private readonly CharVisualizerWindow _parent;

        /// <summary>对外暴露的父窗口引用（供父窗口反向访问，可能为 null）。</summary>
        public CharVisualizerWindow? ParentWindow => _parent;

        /// <summary>当前预览的角色名（普通立绘系统的角色标识，如 "角色A"）。</summary>
        private string _currentChar = "";
        /// <summary>当前角色朝向/站位（如 "中"、"左"、"右"）。</summary>
        private string _currentOrientation = "";
        /// <summary>当前服装差分 ID（如 "服装1"）。</summary>
        private string _currentDressId = "";
        /// <summary>当前差分 ID。</summary>
        private string _currentDiffId = "";
        /// <summary>当前表情 ID（如 "101"）。</summary>
        private string _currentFaceId = "";
        /// <summary>
        /// 当前待渲染的完整指令字符串，格式如 "[角色A 中 正面 服装1 表情101]" 或 "[lh01 中 lh01_1]"，
        /// 由 <see cref="UpdateInfo"/> 写入，并最终传给 engine.js 的 renderChars()。
        /// </summary>
        private string _currentCommand = "";

        /// <summary>
        /// 强制关闭标志。为 true 时 <see cref="OnClosing"/> 放行真正关闭；
        /// 否则关闭动作被拦截、仅执行 Hide（窗口复用）。
        /// </summary>
        private bool _forceClose = false;
        /// <summary>WebView2 页面是否已完成加载并就绪（就绪前不能执行渲染脚本）。</summary>
        private bool _webViewReady = false;
        /// <summary>是否存在「就绪前到达」的待渲染请求；页面加载完成后补渲染一次。</summary>
        private bool _hasPendingRender = false;

        /// <summary>
        /// 检查 WebView 是否就绪
        /// </summary>
        public bool IsWebViewReady => _webViewReady;

        // 长宽比锁定
        /// <summary>内容区（不含顶栏）的目标长宽比，默认 16:9；由 <see cref="SetAspectRatio"/> 更新。</summary>
        private double _aspectRatio = 16.0 / 9.0;
        /// <summary>重入保护：正在由代码调整窗口尺寸时为 true，避免 SizeChanged 递归触发。</summary>
        private bool _isResizing = false;
        /// <summary>顶栏大约高度（Border padding*2 + content），用于从窗口总高推算内容区高度。</summary>
        private const double TOPBAR_HEIGHT = 42; // 顶栏大约高度（Border padding*2 + content）

        // 拖拽缩放检测（防止每次 SizeChanged 都触发 WebView2 重绘抖动）
        /// <summary>窗口 HWND 的消息源，用于挂接 WndProc 检测拖拽缩放起止。</summary>
        private HwndSource? _hwndSource;
        /// <summary>用户是否正在拖拽窗口边框缩放；期间隐藏 WebView2 以避免每帧重绘闪烁。</summary>
        private bool _isUserDragResizing = false;

        /// <summary>
        /// 构造立绘预览窗口。
        /// </summary>
        /// <param name="parent">父级立绘可视化窗口，用于获取调试标志与 base URL。</param>
        /// <remarks>构造过程仅初始化 XAML 组件并注册 Loaded 事件；WebView2 的创建延迟到窗口加载后进行。</remarks>
        /// <exception cref="Exception">XAML 初始化失败时原样抛出（已在 catch 中记录日志）。</exception>
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

        /// <summary>
        /// 窗口加载完成回调：注册窗口消息钩子并初始化内嵌 WebView2。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">事件参数。</param>
        /// <remarks>
        /// 线程/时序约束：必须在 UI 线程执行。流程为「注册 HwndSource 钩子 → EnsureCoreWebView2Async
        /// → 关闭右键菜单 → 订阅 NavigationCompleted → 导航到预览页」。
        /// 任一环节异常均只记录日志、不抛出，避免影响父窗口。
        /// </remarks>
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
        /// <param name="hwnd">窗口句柄。</param>
        /// <param name="msg">Windows 消息编号。</param>
        /// <param name="wParam">消息的 wParam。</param>
        /// <param name="lParam">消息的 lParam。</param>
        /// <param name="handled">置为 true 表示已处理该消息（本钩子始终不处理，返回 IntPtr.Zero）。</param>
        /// <returns>恒为 <see cref="IntPtr.Zero"/>。</returns>
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
        /// <remarks>
        /// 仅在拖拽结束时调用一次，避免拖拽过程中反复调整导致 WebView2 重绘抖动。
        /// 设置 _isResizing 重入保护，防止修改 Height 时再次触发 SizeChanged。
        /// 高度上限为工作区高度的 90%，避免超出屏幕。
        /// </remarks>
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
        /// debug 构建附加 ?debug=1，让预览页的 F2 变量面板等调试功能与主窗口一致
        /// </summary>
        /// <returns>预览页地址；优先复用父窗口 WebView 的 scheme/host/port，获取失败时回退到 localhost:8080。</returns>
        private string GetPreviewUrl()
        {
            bool isDebug = false;
            try
            {
                isDebug = _parent?.OwnerWindow?.IsDebug == true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] 读取 debug 标志失败: {ex.Message}");
            }

            try
            {
                if (_parent?.OwnerWindow?.WebView?.Source != null)
                {
                    var src = _parent.OwnerWindow.WebView.Source;
                    var url = $"{src.Scheme}://{src.Host}:{src.Port}/char_preview.html";
                    return isDebug ? url + "?debug=1" : url;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharPreview] 获取 base URL 失败: {ex.Message}");
            }
            return isDebug ? "http://localhost:8080/char_preview.html?debug=1" : "http://localhost:8080/char_preview.html";
        }

        /// <summary>
        /// WebView2 页面加载完成回调
        /// </summary>
        /// <param name="sender">事件源（CoreWebView2）。</param>
        /// <param name="e">导航完成事件参数，含是否成功与错误码。</param>
        /// <remarks>加载成功后置就绪标志；若此前有挂起的渲染请求（_hasPendingRender），立即补渲染一次。</remarks>
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

        /// <summary>
        /// 顶栏「打开控制面板」按钮点击处理：显示并激活父级立绘可视化窗口。
        /// </summary>
        /// <param name="sender">按钮控件。</param>
        /// <param name="e">路由事件参数。</param>
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

        /// <summary>
        /// 顶栏「复制指令」按钮点击处理：把当前指令写入系统剪贴板并弹窗提示。
        /// </summary>
        /// <param name="sender">按钮控件。</param>
        /// <param name="e">路由事件参数。</param>
        /// <remarks>指令为空时不执行任何操作；剪贴板操作可能抛异常（如被其它进程占用），已捕获并提示失败。</remarks>
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
        /// <param name="charName">角色名。</param>
        /// <param name="orientation">朝向/站位。</param>
        /// <param name="dressId">服装差分 ID，可为空（为空则不显示该标签）。</param>
        /// <param name="diffId">差分 ID，可为空。</param>
        /// <param name="faceId">表情 ID，可为空。</param>
        /// <param name="cmd">生成的完整指令字符串（供复制与渲染使用）。</param>
        /// <remarks>仅更新内存字段与顶栏文本控件，不触发立绘渲染；渲染由 <see cref="RefreshImage"/> 负责。</remarks>
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
        /// <returns>异步任务；WebView 未就绪时立即返回并挂起渲染请求。</returns>
        /// <remarks>WebView 未就绪时置 _hasPendingRender，待 NavigationCompleted 后补渲染，避免丢帧。</remarks>
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
        /// <returns>异步任务。</returns>
        /// <remarks>
        /// WebView2 互操作：通过网页注入的 setCharPreview() 间接调用 engine.js renderChars()。
        /// 指令中的引号/反斜杠/换行经 <see cref="EscapeJsString"/> 转义，防止 JS 语法错误与注入。
        /// </remarks>
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
        /// <param name="ratio">内容区目标长宽比（宽/高），&lt;= 0 时忽略。</param>
        /// <remarks>保持当前宽度不变、按新比例重算窗口高度；结果超出工作区 90% 高度时不调整。</remarks>
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
        /// <param name="sender">窗口对象。</param>
        /// <param name="e">尺寸变化事件参数，含新旧尺寸。</param>
        /// <remarks>
        /// 锁比例算法：以「用户主要拖拽的方向」为基准（比较宽高变化量），
        /// 宽度驱动时锁定高度、高度驱动时锁定宽度；2% 容差内视为已满足，避免振荡。
        /// 拖拽期间（_isUserDragResizing）与重入期间（_isResizing）均直接返回。
        /// </remarks>
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
        /// <param name="s">待转义的原始字符串。</param>
        /// <returns>可安全嵌入单引号 JS 字符串字面量的结果。</returns>
        /// <remarks>依次转义反斜杠、单引号、换行、回车；反斜杠必须最先处理，否则会二次转义。</remarks>
        private static string EscapeJsString(string s)
        {
            return s.Replace("\\", "\\\\")
                    .Replace("'", "\\'")
                    .Replace("\n", "\\n")
                    .Replace("\r", "\\r");
        }

        /// <summary>
        /// 窗口关闭拦截：非强制关闭时取消关闭并改为隐藏窗口（复用实例）。
        /// </summary>
        /// <param name="e">取消事件参数；置 Cancel = true 以阻止真正关闭。</param>
        /// <remarks>只有调用 <see cref="ForceClose"/>（把 _forceClose 置 true）才允许真正关闭并销毁窗口。</remarks>
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
        /// <remarks>先停止 BGM，再置 _forceClose = true 绕过 OnClosing 的隐藏拦截，最终真正销毁窗口。</remarks>
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
        /// <param name="script">待执行的 JS 代码。</param>
        /// <returns>脚本执行结果的 JSON 字符串；WebView 未就绪或执行异常时返回字面量 "null"。</returns>
        /// <remarks>WebView2 互操作入口，调用方无需自行判空或捕获异常。</remarks>
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

        /// <summary>
        /// 设置预览背景图（通过 JS setBackgroundImage 注入）。
        /// </summary>
        /// <param name="bgPath">背景图相对路径。</param>
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

        /// <summary>清除预览背景（通过 JS clearBackground 注入）。</summary>
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

        /// <summary>
        /// 播放/切换 BGM（通过 JS setBgm 注入）。
        /// </summary>
        /// <param name="bgmPath">BGM 文件相对路径。</param>
        /// <param name="volume">音量（0~1）。</param>
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

        /// <summary>停止 BGM 播放（通过 JS stopBgm 注入）。</summary>
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

        /// <summary>暂停 BGM 播放（通过 JS pauseBgm 注入）。</summary>
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

        /// <summary>恢复 BGM 播放（通过 JS resumeBgm 注入）。</summary>
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

        /// <summary>
        /// 设置 BGM 音量（通过 JS setBgmVolume 注入）。
        /// </summary>
        /// <param name="volume">音量（0~1）。</param>
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

        /// <summary>
        /// 应用对话文本与角色名（通过 JS applyText 注入），用于预览对话框渲染效果。
        /// </summary>
        /// <param name="text">对话内容。</param>
        /// <param name="name">说话角色名。</param>
        /// <remarks>两个参数均经 JS 转义，避免文本中的引号破坏脚本结构。</remarks>
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
