// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 立绘可视化控制面板（弹窗B）的代码后置文件。
// 负责立绘/元素/文本三个选项卡的交互：从 JS 引擎读取角色差分、背景、BGM 配置，
// 将用户在界面上的选择组合成剧本指令，并驱动 CharPreviewWindow 实时刷新预览。
// 本文件仅处理 UI 交互与指令拼装，实际渲染由预览窗口的 WebView 完成。

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
    ///
    /// 职责概述：
    /// <list type="bullet">
    /// <item>从 JS 引擎（预览窗口或主窗口的 WebView）读取 CHAR_DIFF_CONFIG / BG_CONFIG_SUB / BGM_CONFIG_SUB 三份配置；</item>
    /// <item>将配置渲染为界面上的角色、方位、服装、表情、背景、BGM 列表；</item>
    /// <item>把用户在界面上的组合选择拼装为剧本指令字符串（如 <c>[角色 X Y 方位 服装 表情]</c>）；</item>
    /// <item>驱动 <see cref="CharPreviewWindow"/> 实时刷新预览，并支持复制指令到剪贴板。</item>
    /// </list>
    /// 线程模型：所有 UI 操作均在 WPF 主线程（Dispatcher）执行，异步等待使用 await 而非阻塞。
    /// </summary>
    public partial class CharVisualizerWindow : Window
    {
        /// <summary>拥有本窗口的主窗口实例，用于降级读取 WebView 中的配置。</summary>
        private readonly MainWindow _owner;

        /// <summary>对外暴露的只读主窗口引用，供预览窗口等外部组件访问。</summary>
        public MainWindow OwnerWindow => _owner;

        /// <summary>关联的立绘预览窗口（弹窗A），懒加载创建；关闭本窗口时会一并强制关闭。</summary>
        private CharPreviewWindow? _previewWindow;

        // 配置数据
        /// <summary>角色差分配置（CHAR_DIFF_CONFIG）：结构为 角色名 → 方位 → { dress[], face[] }。</summary>
        private JsonObject? _charDiffConfig;

        /// <summary>背景配置（BG_CONFIG_SUB）：结构为 背景名 → 资源路径。</summary>
        private JsonObject? _bgConfig;

        /// <summary>BGM 配置（BGM_CONFIG_SUB）：结构为 BGM 名 → 资源路径。</summary>
        private JsonObject? _bgmConfig;

        /// <summary>当前选中的角色名。</summary>
        private string? _selectedChar;

        /// <summary>当前选中的方位（如 正面/左侧 等）。</summary>
        private string? _selectedOrientation;

        // 位置层级选择（拆分为X轴/Y轴独立选择）
        /// <summary>水平位置选择：左左/左/.../右右，null 表示未选择。</summary>
        private string? _selectedPosX;
        /// <summary>垂直位置选择：下/中下/下下/上/中上/上上，null 表示未选择。</summary>
        private string? _selectedPosY;
        /// <summary>防止 X轴 PreviewMouseDown 和 SelectionChanged 互相触发（再次点击已选中项取消选择时的重入保护）。</summary>
        private bool _suppressToggleX = false;
        /// <summary>防止 Y轴 PreviewMouseDown 和 SelectionChanged 互相触发（再次点击已选中项取消选择时的重入保护）。</summary>
        private bool _suppressToggleY = false;

        /// <summary>
        /// 列表重建期间抑制预览刷新。
        /// 填充方位/服装/表情列表会清空并重新选中首项，连发多次 SelectionChanged；
        /// 中间态指令（缺服装或缺表情）会造成无意义的重复渲染甚至闪烁。
        /// 置位期间 <see cref="UpdatePreview"/> 直接返回，重建结束后由调用方补刷一次。
        /// </summary>
        private bool _suppressPreview = false;

        /// <summary>预览窗口的宽高比，默认 16:9，可由界面下拉框修改。</summary>
        private double _aspectRatio = 16.0 / 9.0;

        // 当前状态（用于输出JSON）
        /// <summary>当前选中的背景名（空字符串表示未选择）。</summary>
        private string _currentBg = "";
        /// <summary>当前选中的 BGM 名（空字符串表示未选择）。</summary>
        private string _currentBgm = "";

        /// <summary>
        /// 构造函数：保存主窗口引用、初始化 XAML 组件并注册窗口生命周期事件。
        /// </summary>
        /// <param name="owner">拥有本窗口的主窗口实例。</param>
        /// <exception cref="Exception">初始化组件失败时记录日志并原样抛出。</exception>
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

        /// <summary>
        /// 窗口加载完成回调：设置宽高比下拉框默认值，并延迟 500ms 后触发配置加载，
        /// 以避免与游戏引擎（JS 侧）的初始化竞争。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
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

        /// <summary>
        /// 配置加载总入口：优先创建/复用预览窗口并从其 WebView 读取配置；
        /// 若预览窗口不可用，则降级从主窗口 WebView 读取；两者均不可用时使用空配置兜底。
        /// 加载完成后统一填充角色/背景/BGM 列表。
        /// </summary>
        /// <returns>加载流程正常结束返回 true；仅当所有 WebView 都未初始化但已用空数据兜底时也返回 true。</returns>
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

        /// <summary>
        /// 从预览窗口（弹窗A）的 WebView 读取三份配置。
        /// 先轮询等待预览窗口完成配置加载（30 次 × 500ms = 15 秒超时），
        /// 再依次读取 CHAR_DIFF_CONFIG、BG_CONFIG_SUB、BGM_CONFIG_SUB，
        /// 每份配置独立解析，任一失败不影响其余配置。
        /// </summary>
        /// <remarks>依赖 <see cref="_previewWindow"/> 非空且已就绪；方法内部吞掉异常仅记录日志，保证 UI 不崩溃。</remarks>
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

        /// <summary>
        /// 降级方案：从主窗口的 WebView 读取三份配置。
        /// 轮询等待主窗口完成配置加载（60 次 × 500ms = 30 秒超时，比预览窗口更宽松，
        /// 因为主窗口需承担引擎主流程初始化），随后依次读取并解析三份配置。
        /// </summary>
        /// <remarks>各配置独立 try/catch，解析失败仅记录告警；外层异常同样只记录日志。</remarks>
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

        /// <summary>
        /// 用 <see cref="_charDiffConfig"/> 的键填充角色列表 lstChar。
        /// 配置为空时列表保持空白且不抛异常。填充后不自动选中，由调用方决定是否选中首项。
        /// </summary>
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

        /// <summary>
        /// 角色列表选择变更回调：记录选中角色，清空方位/服装/表情列表，
        /// 重新填充该角色的方位列表，随后刷新预览。
        /// </summary>
        /// <param name="sender">事件源（lstChar）。</param>
        /// <param name="e">选择变更事件参数。</param>
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
                // 保存/恢复而非直接置 false：填充方位会级联触发服装/表情列表重建，
                // 内层恢复为它进入时的值，外层才能在自身结束时正确解除抑制。
                var prevSuppressed = _suppressPreview;
                _suppressPreview = true;
                try
                {
                    PopulatePoseList(_selectedChar);
                }
                finally
                {
                    _suppressPreview = prevSuppressed;
                }
                lstFace.IsEnabled = true;
            }

            UpdatePreview();
        }

        /// <summary>
        /// 方位列表选择变更回调：更新 <see cref="_selectedOrientation"/>，
        /// 若角色与方位均已选定则重新填充服装/表情列表，最后刷新预览。
        /// </summary>
        /// <param name="sender">事件源（lstPose）。</param>
        /// <param name="e">选择变更事件参数。</param>
        private void OnPoseSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (lstPose.SelectedItem != null)
                _selectedOrientation = lstPose.SelectedItem.ToString();
            else
                _selectedOrientation = null;

            if (_selectedChar != null && _selectedOrientation != null)
            {
                // 清空并重建服装/表情列表会连发多次 SelectionChanged，中间态无需渲染
                var prevSuppressed = _suppressPreview;
                _suppressPreview = true;
                try
                {
                    PopulateDressesAndFaces();
                }
                finally
                {
                    _suppressPreview = prevSuppressed;
                }
            }

            UpdatePreview();
        }

        /// <summary>
        /// 填充方位列表（lstPose），从角色配置中收集所有方位
        /// 填充后自动选中第一个方位，触发 OnPoseSelectionChanged → PopulateDressesAndFaces()
        /// </summary>
        /// <param name="charName">角色名，需存在于 <see cref="_charDiffConfig"/> 中。</param>
        /// <remarks>
        /// 排序规则：方位名恰为 "正面" 的排在最前（<c>OrderByDescending(k =&gt; k == "正面")</c>），
        /// 其余按名称升序排列，保证默认展示正面立绘。
        /// 副作用：设置 <c>SelectedIndex</c> 会间接触发预览刷新。
        /// </remarks>
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

        /// <summary>
        /// 根据当前角色与方位，填充服装（lstDress）与表情（lstFace）列表。
        /// 每个列表项用 <see cref="ListBoxItem.Tag"/> 保存实际 ID，Content 显示为「服装 N / 表情 N」，
        /// 以便后续指令拼装时直接取用真实 ID 而非显示文本。
        /// </summary>
        /// <remarks>填充完成后默认选中各自首项；任一前置条件（角色/方位/配置）缺失时直接返回。</remarks>
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

        /// <summary>
        /// 服装或表情列表选择变更回调：记录调试日志后刷新预览。
        /// 服装与表情共用本处理器。
        /// </summary>
        /// <param name="sender">事件源（lstDress 或 lstFace）。</param>
        /// <param name="e">选择变更事件参数。</param>
        private void OnDressFaceSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            // Debug: 输出当前选择
            var dressItem = lstDress.SelectedItem as ListBoxItem;
            var faceItem = lstFace.SelectedItem as ListBoxItem;
            Console.WriteLine($"[CharVisualizer] OnDressFaceSelectionChanged: dress={dressItem?.Tag ?? "null"}, face={faceItem?.Tag ?? "null"}");

            UpdatePreview();
        }

        /// <summary>
        /// 刷新预览：确保预览窗口存在后，收集当前角色/方位/服装/表情选择，
        /// 生成剧本指令并推送给预览窗口重绘立绘。
        /// </summary>
        /// <remarks>
        /// 声明为 async void 是因为它直接挂接为 UI 事件处理器；方法体内当前无 await，
        /// 但保留了此签名以兼容调用方的异步语义。预览窗口未就绪时静默返回。
        /// </remarks>
        private async void UpdatePreview()
        {
            // 列表重建期间的中间态不渲染（详见 _suppressPreview 说明）
            if (_suppressPreview) return;

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

        /// <summary>
        /// 根据当前所有选中的项拼装剧本立绘指令字符串。
        /// </summary>
        /// <returns>
        /// 形如 <c>[角色名 位置X 位置Y 方位 服装 表情]</c> 的指令；未选中角色时返回空字符串。
        /// 各可选字段为空时自动省略，保持与剧本指令格式一致。
        /// </returns>
        /// <remarks>
        /// 服装/表情 ID 优先从 <see cref="ListBoxItem.Tag"/> 读取；若列表项不是 ListBoxItem（兼容旧数据），
        /// 则回退到用正则从显示文本中提取数字。
        /// </remarks>
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

        /// <summary>
        /// 「预览指令」按钮回调：生成指令并以消息框展示，供用户手工核对格式。
        /// 指令为空（未选角色）时不弹窗。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnPreviewClick(object sender, RoutedEventArgs e)
        {
            var cmd = GenerateCommand();
            if (!string.IsNullOrWhiteSpace(cmd))
                MessageBox.Show(cmd, "预览指令", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        /// <summary>
        /// 「复制指令」按钮回调：生成完整输出 JSON 并写入剪贴板，成功/失败均给出提示。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        /// <remarks>剪贴板可能被其他进程占用而抛出异常，此处捕获并提示用户。</remarks>
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

        /// <summary>
        /// 「刷新」按钮回调：重新填充角色列表并刷新预览。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnRefreshClick(object sender, RoutedEventArgs e)
        {
            PopulateCharList();
            UpdatePreview();
        }

        /// <summary>
        /// 「打开预览」按钮回调：确保预览窗口已创建，并将其显示/激活/还原为正常窗口状态。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
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

        /// <summary>
        /// 惰性创建并显示立绘预览窗口（弹窗A）。已存在且已加载时直接复用，不重复创建。
        /// </summary>
        /// <remarks>
        /// 刻意不设置 <c>Owner</c>，避免 WPF Owner 链引发的显示问题；
        /// 改用 <see cref="WindowStartupLocation.CenterOwner"/> 手动控制位置。
        /// 创建失败时弹出错误提示，不向上抛出。
        /// </remarks>
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

        /// <summary>
        /// 宽高比下拉框变更回调：从选中项的 Tag 解析宽高比数值，写入 <see cref="_aspectRatio"/>
        /// 并同步给预览窗口（若已创建）。
        /// </summary>
        /// <param name="sender">事件源（cmbAspectRatio）。</param>
        /// <param name="e">选择变更事件参数。</param>
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

        /// <summary>
        /// 窗口关闭中回调：级联关闭预览窗口（弹窗A），避免遗留孤儿窗口。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">取消事件参数（此处不取消关闭）。</param>
        private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            // 关闭弹窗B时,同时关闭弹窗A
            if (_previewWindow != null && _previewWindow.IsLoaded)
            {
                _previewWindow.ForceClose();
                _previewWindow = null;
            }
        }


        /// <summary>
        /// 窗口已关闭回调：作为兜底再次强制关闭预览窗口并释放引用，
        /// 覆盖 <see cref="OnClosing"/> 未执行到的情况。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">事件参数。</param>
        private void OnClosedHandler(object? sender, EventArgs e)
        {
            _previewWindow?.ForceClose();
            _previewWindow = null;
        }

        // ============================================================
        //  元素选项卡 - 背景图片相关
        // ============================================================

        /// <summary>
        /// 用 <see cref="_bgConfig"/> 填充背景列表 lstBackground。
        /// </summary>
        /// <remarks>
        /// 与角色列表不同，此处仅在配置有效时才清空重建，并会保存/恢复当前选中项，
        /// 避免刷新过程中丢失用户选择。
        /// 每个列表项的 Content 为背景名，Tag 为资源路径。
        /// 同时输出调用栈信息便于排查重复调用问题。
        /// </remarks>
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

        /// <summary>
        /// 背景搜索框获得焦点回调：若当前为灰色占位符文本，则清空并切换为正常前景色。
        /// </summary>
        /// <param name="sender">事件源（txtBgSearch）。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnBgSearchGotFocus(object sender, RoutedEventArgs e)
        {
            if (txtBgSearch.Text == "搜索背景..." && txtBgSearch.Foreground == Brushes.Gray)
            {
                txtBgSearch.Text = "";
                txtBgSearch.Foreground = Brushes.Black;
            }
        }

        /// <summary>
        /// 背景搜索框失去焦点回调：文本为空时恢复灰色占位符。
        /// </summary>
        /// <param name="sender">事件源（txtBgSearch）。</param>
        /// <param name="e">路由事件参数。</param>
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

        /// <summary>
        /// 背景搜索框文本变更回调：按输入关键字（不区分大小写）过滤背景列表项的可见性。
        /// </summary>
        /// <param name="sender">事件源（txtBgSearch）。</param>
        /// <param name="e">文本变更事件参数。</param>
        /// <remarks>
        /// 通过 <c>Foreground == Brushes.Gray</c> 判定当前是否为占位符状态，若是则不执行过滤，
        /// 避免把占位符文字当作搜索词。
        /// </remarks>
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

        /// <summary>
        /// 背景列表选择变更回调：记录当前背景名到 <see cref="_currentBg"/>，
        /// 并将背景资源路径下发给预览窗口进行切换。
        /// </summary>
        /// <param name="sender">事件源（lstBackground）。</param>
        /// <param name="e">选择变更事件参数。</param>
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

        /// <summary>
        /// 「清除背景」按钮回调：清空当前背景状态与列表选中项，并通知预览窗口移除背景。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnClearBackgroundClick(object sender, RoutedEventArgs e)
        {
            _currentBg = "";
            lstBackground.SelectedItem = null;
            _previewWindow?.ClearBackground();
        }

        // ============================================================
        //  元素选项卡 - BGM相关
        // ============================================================

        /// <summary>
        /// 用 <see cref="_bgmConfig"/> 填充 BGM 列表 lstBgm。
        /// 每个列表项的 Content 为 BGM 名，Tag 为资源路径。配置为空时列表为空。
        /// </summary>
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

        /// <summary>
        /// BGM 搜索框获得焦点回调：若当前为灰色占位符文本，则清空并切换为正常前景色。
        /// </summary>
        /// <param name="sender">事件源（txtBgmSearch）。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnBgmSearchGotFocus(object sender, RoutedEventArgs e)
        {
            if (txtBgmSearch.Text == "搜索BGM..." && txtBgmSearch.Foreground == Brushes.Gray)
            {
                txtBgmSearch.Text = "";
                txtBgmSearch.Foreground = Brushes.Black;
            }
        }

        /// <summary>
        /// BGM 搜索框失去焦点回调：文本为空时恢复灰色占位符。
        /// </summary>
        /// <param name="sender">事件源（txtBgmSearch）。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnBgmSearchLostFocus(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(txtBgmSearch.Text))
            {
                // CRITICAL: 必须先设置 Foreground，再设置 Text（同 OnBgSearchLostFocus 问题）
                txtBgmSearch.Foreground = Brushes.Gray;
                txtBgmSearch.Text = "搜索BGM...";
            }
        }

        /// <summary>
        /// BGM 搜索框文本变更回调：按输入关键字（不区分大小写）过滤 BGM 列表项的可见性。
        /// </summary>
        /// <param name="sender">事件源（txtBgmSearch）。</param>
        /// <param name="e">文本变更事件参数。</param>
        /// <remarks>与背景搜索同理，占位符状态（灰色前景）下不执行过滤。</remarks>
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

        /// <summary>
        /// BGM 列表选择变更回调：记录当前 BGM 名到 <see cref="_currentBgm"/>，
        /// 并以当前音量滑块的值将 BGM 下发给预览窗口播放。
        /// </summary>
        /// <param name="sender">事件源（lstBgm）。</param>
        /// <param name="e">选择变更事件参数。</param>
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

        /// <summary>
        /// 「停止 BGM」按钮回调：清空当前 BGM 状态与列表选中项，并通知预览窗口停止播放。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnStopBgmClick(object sender, RoutedEventArgs e)
        {
            _currentBgm = "";
            lstBgm.SelectedItem = null;
            _previewWindow?.StopBgm();
        }

        /// <summary>
        /// 「暂停 BGM」按钮回调：通知预览窗口暂停播放（保留播放进度）。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnPauseBgmClick(object sender, RoutedEventArgs e)
        {
            _previewWindow?.PauseBgm();
        }

        /// <summary>
        /// 「继续 BGM」按钮回调：通知预览窗口从暂停处恢复播放。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnResumeBgmClick(object sender, RoutedEventArgs e)
        {
            _previewWindow?.ResumeBgm();
        }

        /// <summary>
        /// BGM 音量滑块变更回调：更新百分比文本显示，并将新音量同步给预览窗口。
        /// </summary>
        /// <param name="sender">事件源（sldBgmVolume）。</param>
        /// <param name="e">值变更事件参数，取值范围 0.0–1.0。</param>
        /// <remarks>初始化阶段 <see cref="txtBgmVolume"/> 可能尚未创建，此时提前返回避免空引用。</remarks>
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

        /// <summary>
        /// 生成用于粘贴到剧本中的完整输出对象文本（JS 对象字面量风格）。
        /// </summary>
        /// <returns>
        /// 形如 <c>{ text:"", chars:"...", background:"...", bgm:"...", }</c> 的多行字符串。
        /// </returns>
        /// <remarks>
        /// 规则：text 字段始终输出（空字符串占位，属必选项）；
        /// chars/background/bgm 仅在用户实际选择后才输出对应行。
        /// 每行末尾统一带逗号（含最后一行），以便直接嵌入更大对象时无需补逗号。
        /// </remarks>
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
        /// <param name="s">待转义的原始字符串。</param>
        /// <returns>转义后的字符串；输入为空时原样返回。</returns>
        /// <remarks>依次转义反斜杠、双引号、换行、回车与制表符，避免破坏输出对象的语法。</remarks>
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
        /// <param name="sender">事件源（lstPosX）。</param>
        /// <param name="e">鼠标按键事件参数。</param>
        /// <remarks>
        /// 由于 WPF ListBox 默认不允许点击已选中项来取消选择，这里在 Preview 阶段前瞻处理：
        /// 命中已选中项时把 SelectedIndex 置为 -1 并清空 <see cref="_selectedPosX"/>；
        /// 同时置位 <see cref="_suppressToggleX"/>，避免随后的 SelectionChanged 重复刷新预览。
        /// </remarks>
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
        /// <param name="sender">事件源（lstPosY）。</param>
        /// <param name="e">鼠标按键事件参数。</param>
        /// <remarks>逻辑与 <see cref="OnPosXPreviewMouseDown"/> 对称，使用独立的 <see cref="_suppressToggleY"/> 标志。</remarks>
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

        /// <summary>
        /// X轴位置列表选择变更回调：更新 <see cref="_selectedPosX"/> 并刷新预览。
        /// </summary>
        /// <param name="sender">事件源（lstPosX）。</param>
        /// <param name="e">选择变更事件参数。</param>
        /// <remarks>若本次变更由「再次点击取消选中」触发（<see cref="_suppressToggleX"/> 为 true），则消费该标志并跳过处理。</remarks>
        private void OnPosXSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppressToggleX) { _suppressToggleX = false; return; }
            if (lstPosX.SelectedItem is not ListBoxItem lbi) { return; }
            _selectedPosX = lbi.Content?.ToString();
            Console.WriteLine($"[CharVisualizer] X Position selected: {_selectedPosX}");
            UpdatePreview();
        }

        /// <summary>
        /// Y轴位置列表选择变更回调：更新 <see cref="_selectedPosY"/> 并刷新预览。
        /// </summary>
        /// <param name="sender">事件源（lstPosY）。</param>
        /// <param name="e">选择变更事件参数。</param>
        /// <remarks>逻辑与 <see cref="OnPosXSelectionChanged"/> 对称，使用 <see cref="_suppressToggleY"/> 标志。</remarks>
        private void OnPosYSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppressToggleY) { _suppressToggleY = false; return; }
            if (lstPosY.SelectedItem is not ListBoxItem lbi) { return; }
            _selectedPosY = lbi.Content?.ToString();
            Console.WriteLine($"[CharVisualizer] Y Position selected: {_selectedPosY}");
            UpdatePreview();
        }

        // 保留旧方法名兼容（XAML中不再引用，但以防万一）
        /// <summary>已废弃：旧版位置选择鼠标按下处理器，保留空实现以兼容历史 XAML 引用。</summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">鼠标按键事件参数。</param>
        [System.Obsolete("Use OnPosXSelectionChanged / OnPosYSelectionChanged instead")]
        private void OnPosPreviewMouseDown(object sender, MouseButtonEventArgs e) { }

        /// <summary>已废弃：旧版位置选择变更处理器，保留空实现以兼容历史 XAML 引用。</summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">选择变更事件参数。</param>
        [System.Obsolete("Use OnPosXSelectionChanged / OnPosYSelectionChanged instead")]
        private void OnPosSelectionChanged(object sender, SelectionChangedEventArgs e) { }

        /// <summary>
        /// 「清除 X 轴位置」按钮回调：清空水平位置选择并刷新预览。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnClearPosXClick(object? sender, RoutedEventArgs e)
        {
            _selectedPosX = null;
            lstPosX.SelectedIndex = -1;
            Console.WriteLine("[CharVisualizer] X Position cleared");
            UpdatePreview();
        }

        /// <summary>
        /// 「清除 Y 轴位置」按钮回调：清空垂直位置选择并刷新预览。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
        private void OnClearPosYClick(object? sender, RoutedEventArgs e)
        {
            _selectedPosY = null;
            lstPosY.SelectedIndex = -1;
            Console.WriteLine("[CharVisualizer] Y Position cleared");
            UpdatePreview();
        }

        // 保留旧清除按钮兼容
        /// <summary>
        /// 已废弃的「清除全部位置」按钮回调：同时清空 X/Y 两个维度的位置选择。
        /// 保留以兼容旧 XAML 引用。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">路由事件参数。</param>
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

        /// <summary>
        /// 键盘按下预览回调：在本窗口获得焦点时响应 F9 快捷键关闭窗口。
        /// </summary>
        /// <param name="sender">事件源。</param>
        /// <param name="e">键盘事件参数。</param>
        /// <remarks>
        /// 同时检查 <c>e.Key</c> 与 <c>e.SystemKey</c>，因为 F9 常被系统或其他窗口作为系统键处理，
        /// 只检查 Key 可能漏判。处理后将 <c>e.Handled</c> 置真以阻止事件继续冒泡。
        /// </remarks>
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
        /// <param name="item">待判断的列表项，允许为 null。</param>
        /// <returns>该项内容为 <see cref="Separator"/> 时返回 true，否则返回 false。</returns>
        private static bool IsSeparator(ListBoxItem item)
            => item?.Content is Separator;
    }
}








