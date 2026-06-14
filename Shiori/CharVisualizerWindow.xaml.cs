using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace ShioriCSharp
{
    /// <summary>
    /// 立绘变更窗口 - 弹窗B(控制面板)
    /// 选项卡:立绘/元素/文本
    /// </summary>
    public partial class CharVisualizerWindow : Window
    {
        private readonly MainWindow _owner;
        public MainWindow OwnerWindow => _owner;

        private CharPreviewWindow? _previewWindow;

        // 配置数据
        private JsonObject? _charDiffConfig;
        private JsonObject? _bgConfig;
        private JsonObject? _bgmConfig;

        private string? _selectedChar;
        private string? _selectedOrientation;

        // 位置层级选择（拆分为X轴/Y轴独立选择）
        private string? _selectedPosX; // 水平: 左左/左/.../右右
        private string? _selectedPosY; // 垂直: 下/中下/下下/上/中上/上上
        private bool _suppressToggleX = false; // 防止 X轴 PreviewMouseDown 和 SelectionChanged 互相触发
        private bool _suppressToggleY = false; // 防止 Y轴 PreviewMouseDown 和 SelectionChanged 互相触发

        private double _aspectRatio = 16.0 / 9.0;

        // 当前状态（用于输出JSON）
        private string _currentBg = "";
        private string _currentBgm = "";

        public CharVisualizerWindow(MainWindow owner)
        {
            try
            {
                _owner = owner;
                InitializeComponent();
                Loaded += OnLoaded;
                PreviewKeyDown += OnPreviewKeyDown;
                Closed += OnClosedHandler;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharVisualizer] ERROR 构造函数: {ex.Message}");
                throw;
            }
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            try
            {
                Console.WriteLine("[CharVisualizer] 窗口加载");

                cmbAspectRatio.SelectedIndex = 0;

                // 延迟加载配置,等待游戏引擎初始化
                _ = Task.Delay(500).ContinueWith(_ =>
                {
                    Dispatcher.Invoke(() => _ = LoadConfigFromJsEngine());
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharVisualizer] ERROR OnLoaded: {ex.Message}");
            }
        }

        private async Task<bool> LoadConfigFromJsEngine()
        {
            try
            {
                Console.WriteLine("[CharVisualizer] 开始从 JS 引擎读取配置...");

                // 先打开预览窗口，因为配置文件是在预览窗口的 WebView 中加载的
                OpenPreviewWindow();

                // 等待预览窗口初始化完成
                for (int i = 0; i < 30; i++)
                {
                    if (_previewWindow != null && _previewWindow.IsWebViewReady)
                    {
                        Console.WriteLine($"[CharVisualizer] 预览窗口 WebView 已就绪 (第 {i + 1} 次检查)");
                        break;
                    }
                    if (i == 29)
                    {
                        Console.WriteLine("[CharVisualizer] WARNING: 预览窗口初始化超时(15秒)");
                    }
                    await Task.Delay(500);
                }

                // 优先从预览窗口的 WebView 读取配置
                if (_previewWindow != null)
                {
                    await LoadConfigFromPreviewWindow();
                }
                else
                {
                    // 降级到从主窗口读取
                    if (_owner.WebView?.CoreWebView2 == null)
                    {
                        Console.WriteLine("[CharVisualizer] ERROR: 所有 WebView 都未初始化");
                        PopulateCharList();
                        PopulateBackgroundList();
                        PopulateBgmList();
                        if (lstChar.Items.Count > 0)
                            lstChar.SelectedIndex = 0;
                        return false;
                    }

                    await LoadConfigFromOwnerWebView();
                }

                // 初始化所有列表
                PopulateCharList();
                PopulateBackgroundList();
                PopulateBgmList();

                if (lstChar.Items.Count > 0)
                    lstChar.SelectedIndex = 0;

                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharVisualizer] ERROR 读取配置失败: {ex.Message}");
                PopulateCharList();
                PopulateBackgroundList();
                PopulateBgmList();
                if (lstChar.Items.Count > 0)
                    lstChar.SelectedIndex = 0;
                return true;
            }
        }

        private async Task LoadConfigFromPreviewWindow()
        {
            try
            {
                // 等待预览窗口加载配置文件(重试30次 = 15秒)
                for (int i = 0; i < 30; i++)
                {
                    var checkResult = await _previewWindow!.ExecuteScriptAsync("typeof CHAR_DIFF_CONFIG !== 'undefined'");
                    if (checkResult == "true")
                    {
                        Console.WriteLine($"[CharVisualizer] 预览窗口配置已加载 (第 {i + 1} 次检查)");
                        break;
                    }
                    if (i == 29)
                    {
                        Console.WriteLine("[CharVisualizer] WARNING: 预览窗口配置加载超时(15秒)");
                        return;
                    }
                    await Task.Delay(500);
                }

                // 读取 CHAR_DIFF_CONFIG
                try
                {
                    var rawResult = await _previewWindow.ExecuteScriptAsync("CHAR_DIFF_CONFIG");
                    if (!string.IsNullOrEmpty(rawResult) && rawResult != "null" && rawResult != "undefined")
                    {
                        var node = JsonNode.Parse(rawResult!);
                        if (node is JsonObject obj)
                        {
                            _charDiffConfig = obj;
                            Console.WriteLine($"[CharVisualizer] CHAR_DIFF_CONFIG 加载成功: {_charDiffConfig.Count} 个角色");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[CharVisualizer] WARNING: 从预览窗口读取 CHAR_DIFF_CONFIG 失败: {ex.Message}");
                }

                // 读取背景配置
                try
                {
                    var rawResult = await _previewWindow.ExecuteScriptAsync("BG_CONFIG_SUB");
                    if (!string.IsNullOrEmpty(rawResult) && rawResult != "null" && rawResult != "undefined")
                    {
                        var node = JsonNode.Parse(rawResult!);
                        if (node is JsonObject obj)
                        {
                            _bgConfig = obj;
                            Console.WriteLine($"[CharVisualizer] BG_CONFIG_SUB 加载成功: {_bgConfig.Count} 个背景");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[CharVisualizer] WARNING: 从预览窗口读取 BG_CONFIG_SUB 失败: {ex.Message}");
                }

                // 读取BGM配置
                try
                {
                    var rawResult = await _previewWindow.ExecuteScriptAsync("BGM_CONFIG_SUB");
                    if (!string.IsNullOrEmpty(rawResult) && rawResult != "null" && rawResult != "undefined")
                    {
                        var node = JsonNode.Parse(rawResult!);
                        if (node is JsonObject obj)
                        {
                            _bgmConfig = obj;
                            Console.WriteLine($"[CharVisualizer] BGM_CONFIG_SUB 加载成功: {_bgmConfig.Count} 个BGM");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[CharVisualizer] WARNING: 从预览窗口读取 BGM_CONFIG_SUB 失败: {ex.Message}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharVisualizer] ERROR LoadConfigFromPreviewWindow: {ex.Message}");
            }
        }

        private async Task LoadConfigFromOwnerWebView()
        {
            try
            {
                for (int i = 0; i < 60; i++)
                {
                    var checkResult = await _owner.WebView!.CoreWebView2.ExecuteScriptAsync("typeof CHAR_DIFF_CONFIG !== 'undefined'");
                    if (checkResult == "true")
                    {
                        Console.WriteLine($"[CharVisualizer] 主窗口配置已加载 (第 {i + 1} 次检查)");
                        break;
                    }
                    if (i == 59)
                    {
                        Console.WriteLine("[CharVisualizer] WARNING: 主窗口配置加载超时(30秒)");
                        return;
                    }
                    await Task.Delay(500);
                }

                try
                {
                    var rawResult = await _owner.WebView.CoreWebView2.ExecuteScriptAsync("CHAR_DIFF_CONFIG");
                    if (!string.IsNullOrEmpty(rawResult) && rawResult != "null" && rawResult != "undefined")
                    {
                        var node = JsonNode.Parse(rawResult!);
                        if (node is JsonObject obj)
                        {
                            _charDiffConfig = obj;
                            Console.WriteLine($"[CharVisualizer] CHAR_DIFF_CONFIG 加载成功: {_charDiffConfig.Count} 个角色");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[CharVisualizer] WARNING: 读取 CHAR_DIFF_CONFIG 失败: {ex.Message}");
                }

                try
                {
                    var rawResult = await _owner.WebView.CoreWebView2.ExecuteScriptAsync("BG_CONFIG_SUB");
                    if (!string.IsNullOrEmpty(rawResult) && rawResult != "null" && rawResult != "undefined")
                    {
                        var node = JsonNode.Parse(rawResult!);
                        if (node is JsonObject obj)
                        {
                            _bgConfig = obj;
                            Console.WriteLine($"[CharVisualizer] BG_CONFIG_SUB 加载成功: {_bgConfig.Count} 个背景");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[CharVisualizer] WARNING: 读取 BG_CONFIG_SUB 失败: {ex.Message}");
                }

                try
                {
                    var rawResult = await _owner.WebView.CoreWebView2.ExecuteScriptAsync("BGM_CONFIG_SUB");
                    if (!string.IsNullOrEmpty(rawResult) && rawResult != "null" && rawResult != "undefined")
                    {
                        var node = JsonNode.Parse(rawResult!);
                        if (node is JsonObject obj)
                        {
                            _bgmConfig = obj;
                            Console.WriteLine($"[CharVisualizer] BGM_CONFIG_SUB 加载成功: {_bgmConfig.Count} 个BGM");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[CharVisualizer] WARNING: 读取 BGM_CONFIG_SUB 失败: {ex.Message}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharVisualizer] ERROR LoadConfigFromOwnerWebView: {ex.Message}");
            }
        }

        private void PopulateCharList()
        {
            Console.WriteLine($"[CharVisualizer] PopulateCharList() 被调用");
            Console.WriteLine($"[CharVisualizer] _charDiffConfig = {_charDiffConfig?.Count ?? 0} 个角色");

            lstChar.Items.Clear();

            if (_charDiffConfig != null && _charDiffConfig.Count > 0)
            {
                Console.WriteLine($"[CharVisualizer] 添加角色: {string.Join(", ", _charDiffConfig.Select(p => p.Key))}");
                foreach (var prop in _charDiffConfig)
                    lstChar.Items.Add(prop.Key);
            }

            Console.WriteLine($"[CharVisualizer] lstChar 最终项数: {lstChar.Items.Count}");
        }

        private void OnCharSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (lstChar.SelectedItem == null) return;

            _selectedChar = lstChar.SelectedItem.ToString();
            Console.WriteLine($"[CharVisualizer] OnCharSelectionChanged: {_selectedChar}");

            lstPose.Items.Clear();
            lstDress.Items.Clear();
            lstFace.Items.Clear();

            if (_selectedChar != null && _charDiffConfig != null)
            {
                Console.WriteLine($"[CharVisualizer] 选中角色: {_selectedChar}");
                PopulatePoseList(_selectedChar);
                lstFace.IsEnabled = true;
            }

            UpdatePreview();
        }

        private void OnPoseSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (lstPose.SelectedItem != null)
                _selectedOrientation = lstPose.SelectedItem.ToString();
            else
                _selectedOrientation = null;

            if (_selectedChar != null && _selectedOrientation != null)
            {
                PopulateDressesAndFaces();
            }

            UpdatePreview();
        }

        /// <summary>
        /// 填充方位列表（lstPose），从角色配置中收集所有方位
        /// 填充后自动选中第一个方位，触发 OnPoseSelectionChanged → PopulateDressesAndFaces()
        /// </summary>
        private void PopulatePoseList(string charName)
        {
            Console.WriteLine($"[CharVisualizer] PopulatePoseList({charName})");
            lstPose.Items.Clear();

            if (_charDiffConfig == null || string.IsNullOrEmpty(charName))
                return;

            if (!_charDiffConfig.TryGetPropertyValue(charName, out var roleNode) || roleNode is not JsonObject roleObj)
                return;

            var orientations = roleObj.Select(p => p.Key).OrderByDescending(k => k == "正面").ThenBy(k => k).ToList();
            foreach (var orientName in orientations)
            {
                lstPose.Items.Add(orientName);
                Console.WriteLine($"[CharVisualizer]   添加方位: {orientName}");
            }

            // 关键：设置 SelectedIndex 会触发 OnPoseSelectionChanged
            if (lstPose.Items.Count > 0)
                lstPose.SelectedIndex = 0;
        }

        private void PopulateDressesAndFaces()
        {
            lstDress.Items.Clear();
            lstFace.Items.Clear();

            if (_selectedChar == null || _selectedOrientation == null || _charDiffConfig == null)
                return;

            if (_charDiffConfig.TryGetPropertyValue(_selectedChar, out var roleNode) && roleNode is JsonObject roleObj)
            {
                if (roleObj.TryGetPropertyValue(_selectedOrientation, out var orientNode) && orientNode is JsonObject orientObj)
                {
                    // 填充服装
                    if (orientObj.TryGetPropertyValue("dress", out var dressNode) && dressNode is JsonArray dressArr)
                    {
                        foreach (var item in dressArr)
                        {
                            if (item is JsonObject itemObj && itemObj.TryGetPropertyValue("id", out var idNode))
                            {
                                string id = idNode?.ToString() ?? "";
                                var listItem = new ListBoxItem
                                {
                                    Content = $"服装 {id}",
                                    Tag = id  // 存储实际 ID
                                };
                                lstDress.Items.Add(listItem);
                            }
                        }
                    }

                    // 填充表情
                    if (orientObj.TryGetPropertyValue("face", out var faceNode) && faceNode is JsonArray faceArr)
                    {
                        foreach (var item in faceArr)
                        {
                            if (item is JsonObject itemObj && itemObj.TryGetPropertyValue("id", out var idNode))
                            {
                                string id = idNode?.ToString() ?? "";
                                var listItem = new ListBoxItem
                                {
                                    Content = $"表情 {id}",
                                    Tag = id  // 存储实际 ID
                                };
                                lstFace.Items.Add(listItem);
                            }
                        }
                    }
                }
            }

            if (lstDress.Items.Count > 0) lstDress.SelectedIndex = 0;
            if (lstFace.Items.Count > 0) lstFace.SelectedIndex = 0;
        }

        private void OnDressFaceSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            // Debug: 输出当前选择
            var dressItem = lstDress.SelectedItem as ListBoxItem;
            var faceItem = lstFace.SelectedItem as ListBoxItem;
            Console.WriteLine($"[CharVisualizer] OnDressFaceSelectionChanged: dress={dressItem?.Tag ?? "null"}, face={faceItem?.Tag ?? "null"}");

            UpdatePreview();
        }

        private async void UpdatePreview()
        {
            OpenPreviewWindow();
            if (_previewWindow == null || !_previewWindow.IsLoaded) return;

            string orient = _selectedOrientation ?? "";

            string dressId = "";
            if (lstDress.SelectedItem is ListBoxItem dressItem && dressItem.Tag is string dId)
                dressId = dId;

            string faceId = "";
            if (lstFace.SelectedItem is ListBoxItem faceItem && faceItem.Tag is string fId)
                faceId = fId;

            string cmd = GenerateCommand();
            Console.WriteLine($"[CharVisualizer] UpdatePreview: char={_selectedChar}, orient={orient}, dress={dressId}, face={faceId}, cmd={cmd}");

            _previewWindow.UpdateInfo(_selectedChar ?? "", orient, dressId, "", faceId, cmd);
            _previewWindow.RefreshImage();
        }

        private string GenerateCommand()
        {
            var sb = new StringBuilder();

            if (!string.IsNullOrEmpty(_selectedChar))
            {
                var orientation = lstPose.SelectedItem?.ToString() ?? "";

                string dressId = "";
                if (lstDress.SelectedItem is ListBoxItem dressItem && dressItem.Tag != null)
                {
                    dressId = dressItem.Tag.ToString() ?? "";
                }
                else
                {
                    var text = lstDress.SelectedItem?.ToString() ?? "";
                    var match = System.Text.RegularExpressions.Regex.Match(text, @"\d+");
                    if (match.Success)
                        dressId = match.Value;
                    else
                        dressId = text;
                }

                string faceId = "";
                if (lstFace.SelectedItem is ListBoxItem faceItem && faceItem.Tag != null)
                {
                    faceId = faceItem.Tag.ToString() ?? "";
                }
                else
                {
                    var text = lstFace.SelectedItem?.ToString() ?? "";
                    var match = System.Text.RegularExpressions.Regex.Match(text, @"\d+");
                    if (match.Success)
                        faceId = match.Value;
                    else
                        faceId = text;
                }

                // 格式: [角色名 位置X 位置Y 方位 服装 表情]（与剧本指令格式一致）
                sb.Append($"[{_selectedChar}");
                if (!string.IsNullOrEmpty(_selectedPosX)) sb.Append($" {_selectedPosX}");
                if (!string.IsNullOrEmpty(_selectedPosY)) sb.Append($" {_selectedPosY}");
                if (!string.IsNullOrEmpty(orientation)) sb.Append($" {orientation}");
                if (!string.IsNullOrEmpty(dressId)) sb.Append($" {dressId}");
                if (!string.IsNullOrEmpty(faceId)) sb.Append($" {faceId}");
                sb.Append(']');
            }

            return sb.ToString();
        }

        private void OnPreviewClick(object sender, RoutedEventArgs e)
        {
            var cmd = GenerateCommand();
            if (!string.IsNullOrWhiteSpace(cmd))
                MessageBox.Show(cmd, "预览指令", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        private void OnCopyClick(object sender, RoutedEventArgs e)
        {
            try
            {
                var json = GetOutputJson();
                Clipboard.SetText(json);
                MessageBox.Show("指令已复制:\n" + json, "复制成功", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharVisualizer] ERROR 复制完整指令失败: {ex.Message}");
                MessageBox.Show("复制失败: " + ex.Message, "复制失败", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void OnRefreshClick(object sender, RoutedEventArgs e)
        {
            PopulateCharList();
            UpdatePreview();
        }

                private void OnOpenPreviewClick(object sender, RoutedEventArgs e)
        {
            Console.WriteLine("[CharVisualizer] OnOpenPreviewClick 被调用");
            try
            {
                OpenPreviewWindow();
                if (_previewWindow != null && _previewWindow.IsLoaded)
                {
                    _previewWindow.Show();
                    _previewWindow.Activate();
                    _previewWindow.WindowState = WindowState.Normal;
                    Console.WriteLine("[CharVisualizer] 预览窗口已打开并激活");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharVisualizer] ERROR OnOpenPreviewClick: {ex.Message}");
            }
        }

        private void OpenPreviewWindow()
        {
            try
            {
                if (_previewWindow == null || !_previewWindow.IsLoaded)
                {
                    Console.WriteLine("[CharVisualizer] 创建新的预览窗口...");
                    _previewWindow = new CharPreviewWindow(this);
                    // 不设置 Owner，避免 WPF Owner 链导致的问题
                    // 改用 WindowStartupLocation 手动控制位置
                    _previewWindow.WindowStartupLocation = WindowStartupLocation.CenterOwner;
                    _previewWindow.Show();
                    Console.WriteLine("[CharVisualizer] 预览窗口创建成功");
                }
                else
                {
                    Console.WriteLine("[CharVisualizer] 预览窗口已存在，复用");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CharVisualizer] ERROR OpenPreviewWindow: {ex.Message}");
                MessageBox.Show($"无法打开立绘预览窗口: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void OnAspectRatioChanged(object sender, SelectionChangedEventArgs e)
        {
            if (cmbAspectRatio.SelectedItem is ComboBoxItem item && item.Tag is string tag)
            {
                if (double.TryParse(tag, out var ratio))
                {
                    _aspectRatio = ratio;
                    _previewWindow?.SetAspectRatio(ratio);
                }
            }
        }

        private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            // 关闭弹窗B时,同时关闭弹窗A
            if (_previewWindow != null && _previewWindow.IsLoaded)
            {
                _previewWindow.ForceClose();
                _previewWindow = null;
            }
        }


        private void OnClosedHandler(object? sender, EventArgs e)
        {
            _previewWindow?.ForceClose();
            _previewWindow = null;
        }

        // ============================================================
        //  元素选项卡 - 背景图片相关
        // ============================================================

        private void PopulateBackgroundList()
        {
            // 获取调用栈信息
            var stackTrace = new System.Diagnostics.StackTrace();
            string callerMethod = stackTrace.GetFrame(1)?.GetMethod()?.Name ?? "Unknown";
            
            Console.WriteLine($"[CharVisualizer] PopulateBackgroundList called from: {callerMethod}");
            Console.WriteLine($"[CharVisualizer] PopulateBackgroundList: _bgConfig is null: {_bgConfig == null}, _bgConfig?.Count: {_bgConfig?.Count ?? 0}, lstBackground.Items.Count before: {lstBackground.Items.Count}");
            
            // 只有在有有效配置时才清空并重新填充列表
            if (_bgConfig == null || _bgConfig.Count == 0)
            {
                Console.WriteLine("[CharVisualizer] PopulateBackgroundList: _bgConfig is null or empty, skipping");
                return;
            }
            
            // 先保存当前选中项
            string selectedBg = null;
            if (lstBackground.SelectedItem is ListBoxItem selectedItem)
            {
                selectedBg = selectedItem.Content.ToString();
            }
            
            lstBackground.Items.Clear();
            
            foreach (var prop in _bgConfig)
            {
                var item = new ListBoxItem
                {
                    Content = prop.Key,
                    Tag = prop.Value?.ToString()
                };
                lstBackground.Items.Add(item);
                
                // 恢复选中状态
                if (prop.Key == selectedBg)
                {
                    item.IsSelected = true;
                }
            }
            
            Console.WriteLine($"[CharVisualizer] PopulateBackgroundList: loaded {lstBackground.Items.Count} backgrounds");
        }

        private void OnBgSearchGotFocus(object sender, RoutedEventArgs e)
        {
            if (txtBgSearch.Text == "搜索背景..." && txtBgSearch.Foreground == Brushes.Gray)
            {
                txtBgSearch.Text = "";
                txtBgSearch.Foreground = Brushes.Black;
            }
        }

        private void OnBgSearchLostFocus(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(txtBgSearch.Text))
            {
                // CRITICAL: 必须先设置 Foreground，再设置 Text
                // 因为 Text 改变会立即触发 OnBgSearchTextChanged，
                // 其中用 Foreground == Brushes.Gray 来判断是否为占位符文本
                txtBgSearch.Foreground = Brushes.Gray;
                txtBgSearch.Text = "搜索背景...";
            }
        }

        private void OnBgSearchTextChanged(object sender, TextChangedEventArgs e)
        {
            if (lstBackground == null) return;
            if (txtBgSearch == null) return;
            if (txtBgSearch.Foreground == Brushes.Gray) return;
            
            string search = txtBgSearch.Text.ToLower();
            foreach (var item in lstBackground.Items)
            {
                if (item is ListBoxItem listItem)
                {
                    string content = listItem.Content.ToString()?.ToLower() ?? "";
                    listItem.Visibility = content.Contains(search) ? Visibility.Visible : Visibility.Collapsed;
                }
            }
        }

        private void OnBackgroundSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            Console.WriteLine($"[CharVisualizer] OnBackgroundSelectionChanged called. _bgConfig: {(object)_bgConfig ?? "null"}, lstBackground.Items.Count: {lstBackground.Items.Count}");
            
            if (lstBackground.SelectedItem is ListBoxItem item)
            {
                string bgName = item.Content.ToString() ?? "";
                string bgPath = item.Tag?.ToString() ?? "";
                _currentBg = bgName;
                
                Console.WriteLine($"[CharVisualizer] 选择背景: {bgName}, 路径: {bgPath}, _currentBg: {_currentBg}");
                
                _previewWindow?.SetBackground(bgPath);
            }
            else
            {
                Console.WriteLine("[CharVisualizer] OnBackgroundSelectionChanged: SelectedItem is null");
            }
            
            Console.WriteLine($"[CharVisualizer] OnBackgroundSelectionChanged finished. lstBackground.Items.Count: {lstBackground.Items.Count}");
        }

        private void OnClearBackgroundClick(object sender, RoutedEventArgs e)
        {
            _currentBg = "";
            lstBackground.SelectedItem = null;
            _previewWindow?.ClearBackground();
        }

        // ============================================================
        //  元素选项卡 - BGM相关
        // ============================================================

        private void PopulateBgmList()
        {
            lstBgm.Items.Clear();
            if (_bgmConfig != null)
            {
                foreach (var prop in _bgmConfig)
                {
                    var item = new ListBoxItem
                    {
                        Content = prop.Key,
                        Tag = prop.Value?.ToString()
                    };
                    lstBgm.Items.Add(item);
                }
            }
        }

        private void OnBgmSearchGotFocus(object sender, RoutedEventArgs e)
        {
            if (txtBgmSearch.Text == "搜索BGM..." && txtBgmSearch.Foreground == Brushes.Gray)
            {
                txtBgmSearch.Text = "";
                txtBgmSearch.Foreground = Brushes.Black;
            }
        }

        private void OnBgmSearchLostFocus(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(txtBgmSearch.Text))
            {
                // CRITICAL: 必须先设置 Foreground，再设置 Text（同 OnBgSearchLostFocus 问题）
                txtBgmSearch.Foreground = Brushes.Gray;
                txtBgmSearch.Text = "搜索BGM...";
            }
        }

        private void OnBgmSearchTextChanged(object sender, TextChangedEventArgs e)
        {
            if (lstBgm == null) return;
            if (txtBgmSearch == null) return;
            if (txtBgmSearch.Foreground == Brushes.Gray) return;
            
            string search = txtBgmSearch.Text.ToLower();
            foreach (var item in lstBgm.Items)
            {
                if (item is ListBoxItem listItem)
                {
                    string content = listItem.Content.ToString()?.ToLower() ?? "";
                    listItem.Visibility = content.Contains(search) ? Visibility.Visible : Visibility.Collapsed;
                }
            }
        }

        private void OnBgmSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (lstBgm.SelectedItem is ListBoxItem item)
            {
                string bgmName = item.Content.ToString() ?? "";
                string bgmPath = item.Tag?.ToString() ?? "";
                _currentBgm = bgmName;
                
                Console.WriteLine($"[CharVisualizer] 选择BGM: {bgmName}, 路径: {bgmPath}");
                
                double volume = sldBgmVolume.Value;
                _previewWindow?.SetBgm(bgmPath, volume);
            }
        }

        private void OnStopBgmClick(object sender, RoutedEventArgs e)
        {
            _currentBgm = "";
            lstBgm.SelectedItem = null;
            _previewWindow?.StopBgm();
        }

        private void OnPauseBgmClick(object sender, RoutedEventArgs e)
        {
            _previewWindow?.PauseBgm();
        }

        private void OnResumeBgmClick(object sender, RoutedEventArgs e)
        {
            _previewWindow?.ResumeBgm();
        }

        private void OnBgmVolumeChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (txtBgmVolume == null) return;
            
            double volume = sldBgmVolume.Value;
            txtBgmVolume.Text = $"{(int)(volume * 100)}%";
            _previewWindow?.SetBgmVolume(volume);
        }

        // ============================================================
        //  获取当前输出JSON（用于复制指令）
        // ============================================================

        public string GetOutputJson()
        {
            var lines = new List<string>();
            
            // 始终输出text字段（即使为空），text是必选项
            lines.Add("text:\"\"");
            
            // 如果用户输入了立绘，才显示chars
            string chars = GenerateCommand();
            if (!string.IsNullOrWhiteSpace(chars))
            {
                lines.Add($"chars:\"{EscapeJsString(chars)}\"");
            }
            
            // 如果用户选择了背景，才显示background
            if (!string.IsNullOrWhiteSpace(_currentBg))
            {
                lines.Add($"background:\"{EscapeJsString(_currentBg)}\"");
            }
            
            // 如果用户选择了BGM，才显示bgm
            if (!string.IsNullOrWhiteSpace(_currentBgm))
            {
                lines.Add($"bgm:\"{EscapeJsString(_currentBgm)}\"");
            }
            
            // 构建输出：每行带逗号（最后一行也有，因为 } 后不加逗号由外层控制；
            // 但这里是 JS 对象格式，末尾 , 在 ES5+ 合法，末尾 }, 也方便粘贴）
            var sb = new StringBuilder();
            sb.AppendLine("{");
            for (int i = 0; i < lines.Count; i++)
            {
                sb.Append(lines[i]);
                sb.AppendLine(",");
            }
            sb.Append("},");
            
            return sb.ToString();
        }
        
        /// <summary>转义 JS 字符串中的特殊字符</summary>
        private static string EscapeJsString(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
        }

        // ============================================================
        // ============================================================
        //  位置层级选择（单ListBox + 再次点击取消选中）
        // ============================================================

        /// <summary>
        /// X轴(水平) PreviewMouseLeftButtonDown: 点击已选中项 → 取消选中
        /// </summary>
        private void OnPosXPreviewMouseDown(object sender, MouseButtonEventArgs e)
        {
            if (sender is not ListBox lb) return;
            var item = ItemsControl.ContainerFromElement(lb, e.OriginalSource as DependencyObject) as ListBoxItem;
            if (item == null) return;
            if (lb.SelectedItem == item)
            {
                _suppressToggleX = true;
                lb.SelectedIndex = -1;
                _selectedPosX = null;
                Console.WriteLine("[CharVisualizer] X Position toggled off");
                UpdatePreview();
            }
        }

        /// <summary>
        /// Y轴(垂直) PreviewMouseLeftButtonDown: 点击已选中项 → 取消选中
        /// </summary>
        private void OnPosYPreviewMouseDown(object sender, MouseButtonEventArgs e)
        {
            if (sender is not ListBox lb) return;
            var item = ItemsControl.ContainerFromElement(lb, e.OriginalSource as DependencyObject) as ListBoxItem;
            if (item == null) return;
            if (lb.SelectedItem == item)
            {
                _suppressToggleY = true;
                lb.SelectedIndex = -1;
                _selectedPosY = null;
                Console.WriteLine("[CharVisualizer] Y Position toggled off");
                UpdatePreview();
            }
        }

        private void OnPosXSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppressToggleX) { _suppressToggleX = false; return; }
            if (lstPosX.SelectedItem is not ListBoxItem lbi) { return; }
            _selectedPosX = lbi.Content?.ToString();
            Console.WriteLine($"[CharVisualizer] X Position selected: {_selectedPosX}");
            UpdatePreview();
        }

        private void OnPosYSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppressToggleY) { _suppressToggleY = false; return; }
            if (lstPosY.SelectedItem is not ListBoxItem lbi) { return; }
            _selectedPosY = lbi.Content?.ToString();
            Console.WriteLine($"[CharVisualizer] Y Position selected: {_selectedPosY}");
            UpdatePreview();
        }

        // 保留旧方法名兼容（XAML中不再引用，但以防万一）
        [System.Obsolete("Use OnPosXSelectionChanged / OnPosYSelectionChanged instead")]
        private void OnPosPreviewMouseDown(object sender, MouseButtonEventArgs e) { }

        [System.Obsolete("Use OnPosXSelectionChanged / OnPosYSelectionChanged instead")]
        private void OnPosSelectionChanged(object sender, SelectionChangedEventArgs e) { }

        private void OnClearPosXClick(object? sender, RoutedEventArgs e)
        {
            _selectedPosX = null;
            lstPosX.SelectedIndex = -1;
            Console.WriteLine("[CharVisualizer] X Position cleared");
            UpdatePreview();
        }

        private void OnClearPosYClick(object? sender, RoutedEventArgs e)
        {
            _selectedPosY = null;
            lstPosY.SelectedIndex = -1;
            Console.WriteLine("[CharVisualizer] Y Position cleared");
            UpdatePreview();
        }

        // 保留旧清除按钮兼容
        private void OnClearPositionClick(object sender, RoutedEventArgs e)
        {
            _selectedPosX = null;
            _selectedPosY = null;
            lstPosX.SelectedIndex = -1;
            lstPosY.SelectedIndex = -1;
            Console.WriteLine("[CharVisualizer] All Positions cleared");
            UpdatePreview();
        }

        // ============================================================
        //  F9 快捷键：在本窗口获得焦点时也能关闭
        // ============================================================

        private void OnPreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.F9 || e.SystemKey == Key.F9)
            {
                Console.WriteLine("[CharVisualizer] F9 pressed — closing window");
                Close();
                e.Handled = true;
            }
        }

        /// <summary>判断 ListBoxItem 是否为分隔线</summary>
        private static bool IsSeparator(ListBoxItem item)
            => item?.Content is Separator;
    }
}








