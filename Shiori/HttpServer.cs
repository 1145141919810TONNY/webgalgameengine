// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// Shiori 启动器 — 内置 HTTP 服务器（HttpServer.cs）
// 基于 HttpListener 的本地静态资源服务器与 JSON API 网关：
//  - 静态文件分发（路径遍历防护、媒体 Range 分段请求、MIME 映射、ETag/304 缓存协商）；
//  - HTML 资产重写（engine.js 模块展开、官方 css/js 清单注入、UI 皮肤脚本注入）；
//  - 虚拟路由：cg-thumb/*（CG 缩略图实时生成）、char-frame（立绘预合成），
//    均基于 OpenCV 解码 + WPF 编码 + 字节级 LRU 缓存与并发闸门限流；
//  - API 路由：api/chars/scan（角色素材扫描）、api/dsl/*（DSL 运行时桥接）。

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using OpenCvSharp;
using Shiori.Scripting.Host;

namespace ShioriCSharp
{
    /// <summary>
    /// 内置 HTTP 服务器：为 WebView2 前端提供本地静态资源服务与 JSON API。
    /// 核心职责：
    ///  1. 静态文件分发（含路径遍历防护、媒体 Range 分段请求、MIME 类型映射）；
    ///  2. HTML 资产重写（engine.js 模块展开、官方 css/js 注入、UI 皮肤脚本注入、标题背景预加载）；
    ///  3. 虚拟路由：cg-thumb/*（CG 缩略图实时生成）与 char-frame（立绘预合成）；
    ///  4. API 路由：api/chars/scan（角色素材扫描）与 api/dsl/*（DSL 运行时桥接）。
    /// 线程模型：每个请求由独立 Task 处理（ProcessRequest）；缩略图/立绘合成受
    /// 每键信号量与全局解码闸门（并发 2）限流，缓存采用字节级 LRU（ByteLruCache）。
    /// </summary>
    public class HttpServer
    {
        /// <summary>站点根目录（游戏资源目录）。所有静态文件访问均被限制在该目录内。</summary>
        private readonly string _rootDir;
        /// <summary>底层 HTTP 监听器，绑定 http://localhost:{port}/ 前缀。</summary>
        private readonly HttpListener _listener;
        /// <summary>调试模式标记；为 true 时向控制台输出请求路径、缓存命中等诊断日志。</summary>
        private readonly bool _isDebug;
        /// <summary>资产目录（engine_manifest.json 解析结果）的易失缓存；null 表示尚未构建。</summary>
        private volatile AssetCatalog? _catalog;
        /// <summary>保护 _catalog 懒初始化的锁对象（双重检查锁定模式）。</summary>
        private readonly object _catalogLock = new object();
        /// <summary>DSL 脚本运行时（懒创建），通过 <see cref="Dsl"/> 属性访问。</summary>
        private DslRuntime? _dsl;
        /// <summary>保护 _dsl 懒初始化的锁对象。</summary>
        private readonly object _dslLock = new object();
        /// <summary>CG 缩略图功能开关（易失字段，可运行期通过 SetThumbnailsEnabled 切换）。</summary>
        private volatile bool _thumbnailsEnabled;
        /// <summary>CG 缩略图字节级 LRU 缓存（256px JPEG）。</summary>
        private readonly ByteLruCache _thumbCache = new();
        /// <summary>缩略图磁盘持久化缓存（T3.3）：跨会话复用，键含源文件版本/包戳，变了即自然失效。</summary>
        private readonly ThumbDiskCache _thumbDisk;
        /// <summary>内存缓存命中次数（诊断用）。</summary>
        private long _thumbMemHits;
        /// <summary>磁盘缓存命中次数（诊断用）。</summary>
        private long _thumbDiskHits;
        /// <summary>缩略图落盘次数（诊断用）。</summary>
        private long _thumbDiskWrites;
        /// <summary>按缩略图缓存键组织的每键互斥信号量，防止并发请求重复解码同一张图。</summary>
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _thumbLocks = new(StringComparer.Ordinal);
        /// <summary>缩略图解码全局闸门：最多允许 2 个并发 OpenCV 解码，避免瞬时内存/CPU 峰值。</summary>
        private readonly SemaphoreSlim _thumbDecodeGate = new(2, 2);
        /// <summary>立绘预合成帧字节级 LRU 缓存；容量由 CharFrameCache.LimitBytes(frameCacheEnabled) 决定（0 = 不缓存，每次现场合成）。</summary>
        private readonly ByteLruCache _frameCache;
        /// <summary>按立绘帧缓存键组织的每键互斥信号量，防止并发请求重复合成同一帧。</summary>
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _frameLocks = new(StringComparer.Ordinal);
        /// <summary>立绘合成全局闸门：最多允许 2 个并发合成任务。</summary>
        private readonly SemaphoreSlim _frameDecodeGate = new(2, 2);
        /// <summary>缩略图预热任务的取消令牌源；禁用缩略图或 Stop 时取消预热。</summary>
        private CancellationTokenSource? _prewarmCts;
        /// <summary>CG 清单（相对 assets/ 的图片路径）的常驻缓存；null 表示尚未构建。</summary>
        private volatile List<string>? _cgManifest;
        /// <summary>保护 <see cref="_cgManifest"/> 懒初始化的锁对象。</summary>
        private readonly object _cgManifestLock = new();
        /// <summary>预加载的 UI 皮肤脚本（ui/ui_size.js 全文），注入每个 HTML 页 head；null/空表示未启用。</summary>
        private string? _uiSkinScript;
        /// <summary>容器虚拟文件系统：站点根下 *.sgd 分包的 fail-closed 读取层；null 表示未启用（无密钥或无 .sgd）。</summary>
        private readonly ContainerVfs? _vfs;

        /// <summary>UI 尺寸配置文件名（按名动态定位，不绑定目录）。</summary>
        private const string UiSizeConfigName = "ui_size.js";
        /// <summary>标题页预加载背景图文件名（按名动态定位，找不到则不注入 preload）。</summary>
        private const string TitleBgFileName = "bg.jpg";
        /// <summary>
        /// 缩略图预热的总时长预算（毫秒）：预算内尽力预热，超时即停，
        /// 剩余部分交给在线请求按需生成。
        /// </summary>
        private const int PrewarmBudgetMs = 8000;
        // 文件名 → 站点根相对路径的查找缓存（FindByFileName 全量枚举较贵）
        private readonly Dictionary<string, string?> _fileNameLookup = new(StringComparer.OrdinalIgnoreCase);
        private readonly object _fileNameLock = new();

        /// <summary>
        /// 获取 DSL 脚本运行时（懒创建、线程安全）。
        /// 首次访问时以站点根目录构造 <see cref="DslRuntime"/> 实例，
        /// 此后所有调用共享同一实例（双重检查锁定，已初始化的读路径完全无锁）。
        /// </summary>
        public DslRuntime Dsl
        {
            get
            {
                // 快路径：已初始化时直接返回，避免每次请求都进入锁
                var cached = _dsl;
                if (cached != null) return cached;
                lock (_dslLock)
                {
                    // 【发行形态】注入"磁盘 + .sgd 容器"合并视图：
                    // 否则 macro 目录被打包后扫描为空，media_impl.js / quake_impl.js 等宏原生脚本不会注入页面。
                    return _dsl ??= new DslRuntime(_rootDir, new VfsEngineFiles(_rootDir, _vfs));
                }
            }
        }

        // 仅匹配路径以 /engine.js 或裸 engine.js 结尾的 script，不匹配 myengine.js / engine_core.js
        /// <summary>
        /// 匹配引用 engine.js 的 &lt;script src="..."&gt;&lt;/script&gt; 标签（捕获前后属性与引号组）。
        /// 用于把单文件 engine.js 引用原地展开为清单中的全部引擎模块标签（RewriteEngineJsTag）。
        /// </summary>
        private static readonly Regex EngineScriptTag = new(
            @"<script(?<pre>[^>]*?)src=(?<q>['""])(?<dir>(?:[^'""]*/)?)engine\.js\k<q>(?<post>[^>]*)>\s*</script>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        /// <summary>
        /// 匹配所有 script[src] / link[href] 标签，捕获标签名、属性名、引号与 URL。
        /// 用于非官方页面的资源路径映射改写（RewriteMappedTags）。
        /// </summary>
        private static readonly Regex SrcHrefTag = new(
            @"<(?<tag>script|link)\b(?<pre>[^>]*?)(?<attr>src|href)=(?<q>['""])(?<url>[^'""]+)\k<q>(?<post>[^>]*)>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        // engine_* 主系列，外加从 engine.js 拆出的立绘辅助模块（chardiff_math / char_runtime / char_anim / char_stage）。
        // char_preview*.html 的 engine.js 标签依赖本集合展开，缺少辅助模块会导致 F9 预览立绘无法合成显示。
        /// <summary>判定文件名是否属于引擎模块（engine_* 系列及立绘辅助模块），用于清单分组与官方资源识别。</summary>
        private static readonly Regex EngineModuleName = new(
            @"^(?:engine_[a-z0-9_]+|chardiff_math|char_runtime|char_anim|char_stage)\.js$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        /// <summary>校验清单条目相对路径的合法性（仅允许字母/数字/下划线/点/横线/斜杠组成的 .js/.css 路径），防止清单注入任意路径。</summary>
        private static readonly Regex CatalogRelPath = new(
            @"^[a-z0-9_./\-]+\.(js|css)$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        /// <summary>匹配 HTML 中第一个不带 src 属性的内联 &lt;script&gt; 开标签，官方 js 序列插入到该位置之前。</summary>
        private static readonly Regex FirstInlineScript = new(
            @"<script(?![^>]*\bsrc\s*=)[^>]*>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        /// <summary>匹配 &lt;/head&gt; 闭合标签，官方 css 序列插入到该位置之前。</summary>
        private static readonly Regex HeadClose = new(
            @"</head>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        /// <summary>匹配 &lt;/body&gt; 闭合标签，作为无内联 script 时注入 js 的兜底位置。</summary>
        private static readonly Regex BodyClose = new(
            @"</body>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        /// <summary>匹配带 src 的完整 &lt;script&gt; 标签（捕获 URL），用于剥离页面中的官方脚本引用。</summary>
        private static readonly Regex StripScriptSrc = new(
            @"<script\b[^>]*\bsrc=(?<q>['""])(?<url>[^'""]+)\k<q>[^>]*>\s*</script>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        /// <summary>匹配 &lt;link&gt; 标签（捕获 href），用于剥离页面中的官方样式表引用。</summary>
        private static readonly Regex StripLinkHref = new(
            @"<link\b[^>]*\bhref=(?<q>['""])(?<url>[^'""]+)\k<q>[^>]*>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>资产清单条目：官方资源（js/css）的类型与磁盘相对路径。</summary>
        private sealed class CatalogEntry
        {
            /// <summary>资源类型："js"（默认）或 "css"，决定注入时生成 script 还是 link 标签。</summary>
            public string Type { get; init; } = "js";
            /// <summary>相对站点根目录的资源路径（正斜杠分隔，如 "engine/engine_core.js"）。</summary>
            public string RelPath { get; init; } = "";
        }

        /// <summary>
        /// 资产目录：engine_manifest.json 的解析结果（构建后只读，线程安全）。
        /// 汇总官方资源清单、引擎模块序列以及 文件名/路径后缀 → 实际路径 的两类映射。
        /// </summary>
        private sealed class AssetCatalog
        {
            /// <summary>按加载顺序排列的引擎模块路径序列（engine_core.js → engine_boot.js → ...），用于展开 engine.js 标签。</summary>
            public List<string> EngineModulePaths { get; } = new();
            /// <summary>裸文件名 → 实际相对路径 的映射（忽略大小写），用于资源引用改写与官方标签识别。</summary>
            public Dictionary<string, string> ByFileName { get; } = new(StringComparer.OrdinalIgnoreCase);
            /// <summary>旧相对路径后缀 → 新相对路径 的映射（忽略大小写），用于兼容旧页面引用（如 css/style.css → ui/style.css）。</summary>
            public Dictionary<string, string> BySuffix { get; } = new(StringComparer.OrdinalIgnoreCase);
            /// <summary>官方资源条目清单（保持清单顺序），用于官方页的完整注入序列。</summary>
            public List<CatalogEntry> Official { get; } = new();
            /// <summary>page-chrome.js 的相对路径（场景页公共框架脚本）；清单中不存在时为 null。</summary>
            public string? PageChromePath { get; set; }
        }

        /// <summary>
        /// 构造 HTTP 服务器实例（不启动监听，需另行调用 <see cref="Start"/>）。
        /// </summary>
        /// <param name="rootDir">站点根目录（游戏资源目录），静态文件访问被限制在此目录内。</param>
        /// <param name="port">监听端口，默认 8080；仅绑定 http://localhost:{port}/ 前缀。</param>
        /// <param name="isDebug">调试模式：输出请求路径、缓存命中等诊断日志到控制台。</param>
        /// <param name="thumbnailsEnabled">是否启用 CG 缩略图虚拟路由与预热。</param>
        /// <param name="frameCacheEnabled">是否启用立绘预合成帧缓存；false 时缓存容量为 0（每次现场合成）。</param>
        public HttpServer(string rootDir, int port = 8080, bool isDebug = false, bool thumbnailsEnabled = true, bool frameCacheEnabled = false, string? launcherKeyPem = null, ContainerVfs? vfs = null)
        {
            _rootDir = rootDir;
            _isDebug = isDebug;
            _thumbnailsEnabled = thumbnailsEnabled;
            // 立绘帧缓存容量由开关决定：关闭时 Limit=0，等效于不缓存
            _frameCache = new ByteLruCache(CharFrameCache.LimitBytes(frameCacheEnabled));
            // 缩略图磁盘缓存（T3.3）：仅在缩略图功能开启时启用（传 0 = 禁用，构造器直接短路）
            _thumbDisk = new ThumbDiskCache(rootDir, thumbnailsEnabled ? ThumbDiskCache.DefaultMaxBytes : 0);
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://localhost:{port}/");

            // 容器层：优先复用宿主提前构建的 VFS（封面 logo 检测需要，且避免重复构建），
            // 否则按 launcherKeyPem / 自动发现私钥自行构建 fail-closed 虚拟文件系统。
            _vfs = vfs ?? CreateVfs(_rootDir, isDebug, launcherKeyPem);
        }

        /// <summary>
        /// 构建容器虚拟文件系统：优先使用 launcherKeyPem，缺省时自动发现启动器私钥。
        /// 无密钥或构建失败时返回 null（退化为纯磁盘模式）。
        /// 抽取自构造函数，供宿主侧（启动封面 logo 检测）复用，避免重复扫描 *.sgd 与重复解包。
        /// </summary>
        internal static ContainerVfs? CreateVfs(string rootDir, bool isDebug, string? launcherKeyPem = null)
        {
            string? key = launcherKeyPem;
            if (string.IsNullOrEmpty(key))
                key = DiscoverLauncherKey();
            if (string.IsNullOrEmpty(key)) return null;
            try { return new ContainerVfs(rootDir, key); }
            catch (Exception ex) { if (isDebug) Console.WriteLine("[HttpServer] ContainerVfs init failed: " + ex.Message); }
            return null;
        }

        /// <summary>
        /// 自动发现启动器私钥，按优先级依次尝试：
        ///   0. exe 内注入的私钥副本（发布期由 ShioriSigner 烧入，发行包无需任何 .pem）
        ///   1. &lt;exe目录&gt;/plugin/launcher_priv.pem
        ///   2. &lt;exe目录&gt;/launcher_priv.pem
        ///   3. &lt;exe目录的上一级&gt;/launcher_priv.pem
        ///   4. &lt;exe目录的上一级&gt;/keys/launcher_priv.pem
        /// 0 优先：注入副本与构建它的发布密钥同源，最不会漂移；外置 pem 只作开发期兜底。
        /// 注意发布器把"开发者兜底备份"写到发布根的 developer_keys/ 子目录 —— 那不在
        /// 上面的候选里，是有意的：备份不应被运行期自动捡起来。
        /// </summary>
        private static string? DiscoverLauncherKey()
        {
            if (EmbeddedKeys.HasPrivateKey) return EmbeddedKeys.PrivateKeyPem;

            string baseDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            var dirs = new List<string>
            {
                Path.Combine(baseDir, "plugin"),
                baseDir,
            };

            var parent = Directory.GetParent(baseDir);
            if (parent != null)
            {
                dirs.Add(parent.FullName);
                dirs.Add(Path.Combine(parent.FullName, "keys"));
            }

            foreach (var d in dirs)
            {
                try
                {
                    string p = Path.Combine(d, "launcher_priv.pem");
                    if (File.Exists(p)) return File.ReadAllText(p);
                }
                catch { /* 路径非法时忽略，继续下一个候选 */ }
            }
            return null;
        }

        /// <summary>
        /// 运行期切换 CG 缩略图功能开关。
        /// 关闭时：取消后台预热任务并清空缩略图缓存（已生成的缓存立即失效）；
        /// 重新开启后预热不会自动重启，缩略图将按需重新生成。
        /// </summary>
        /// <param name="enabled">true 启用；false 禁用并清缓存。</param>
        public void SetThumbnailsEnabled(bool enabled)
        {
            _thumbnailsEnabled = enabled;
            if (!enabled)
            {
                try { _prewarmCts?.Cancel(); }
                catch (ObjectDisposedException) { }
                _thumbCache.Clear();
            }
        }

        /// <summary>
        /// 启动 HTTP 服务器：开始监听并转入后台接收循环。
        /// 启动时依次执行预热（失败仅记录日志、不阻断启动）：
        ///  1. 解析 engine_manifest.json 构建资产目录（GetAssetCatalog）；
        ///  2. 预加载 UI 皮肤脚本（ui/ui_size.js）；
        ///  3. 若缩略图开启，延迟 1.5 秒后台预热 CG 缩略图（限时 3 秒）。
        /// 副作用：启动监听线程、可能触发磁盘扫描与 JSON 解析。
        /// </summary>
        public void Start()
        {
            _listener.Start();
            try { GetAssetCatalog(); }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine("[HttpServer] catalog warmup: " + ex.Message);
            }
            try { _uiSkinScript = BuildUiSkinScript(); }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine("[HttpServer] UI skin preload: " + ex.Message);
            }
            Task.Run(() => ListenAsync());
            if (_thumbnailsEnabled)
            {
                _prewarmCts = new CancellationTokenSource();
                var token = _prewarmCts.Token;
                // 起服后立即预热 —— 玩家还在标题画面时就把缩略图灌进内存与磁盘缓存，
                // 打开 CG 页时命中的是缓存而不是磁盘。并发由 _thumbDecodeGate 压住（≤2），
                // 时长由 PrewarmBudgetMs 兜底，因此不会与正文首帧抢资源。
                _ = Task.Run(() => PrewarmCgThumbnailsBudgeted(token));
            }
            if (_isDebug) Console.WriteLine($"[INFO] HTTP Server started on port {_listener.Prefixes}");
        }

        /// <summary>
        /// 停止 HTTP 服务器：取消缩略图预热任务，随后停止并释放底层监听器。
        /// 正在处理中的请求可能因连接关闭而抛出异常，由各处理器的 abort 容错逻辑吞掉。
        /// </summary>
        public void Stop()
        {
            try { _prewarmCts?.Cancel(); }
            catch (ObjectDisposedException) { }
            _listener.Stop();
            _listener.Close();
        }

        /// <summary>
        /// 后台接收循环：持续等待新连接，为每个请求派发独立 Task（ProcessRequest），
        /// 使慢请求（如大文件传输、图片合成）不会阻塞后续连接的接收。
        /// 监听器停止后循环自然退出；接收异常仅记录日志并继续。
        /// </summary>
        private async Task ListenAsync()
        {
            while (_listener.IsListening)
            {
                try
                {
                    var context = await _listener.GetContextAsync();
                    _ = Task.Run(() => ProcessRequest(context));
                }
                catch (Exception ex)
                {
                    if (_isDebug) Console.WriteLine($"[ERROR] Listener error: {ex.Message}");
                }
            }
        }

        /// <summary>
        /// 处理单个 HTTP 请求：请求路由分发与统一错误兜底（每个请求一个独立 Task）。
        /// 路由优先级（自上而下）：
        ///  1. api/*：先检查磁盘同名文件，不存在才进入 API 处理；
        ///  2. cg-thumb/*：CG 缩略图虚拟路由（需缩略图开关开启）；
        ///  3. char-frame：立绘预合成虚拟路由；
        ///  4. 静态文件：路径遍历校验 → 存在性校验 → 媒体 Range / 普通分发。
        /// 异常策略：客户端主动断开（abort）时静默终止连接；其他异常返回 500。
        /// 响应关闭职责：本方法是唯一负责 Response.Close/Abort 的地方。
        /// </summary>
        /// <param name="context">HttpListener 请求/响应上下文。</param>
        private async Task ProcessRequest(HttpListenerContext context)
        {
            var request = context.Request;
            var response = context.Response;
            var aborted = false;

            try
            {
                // 先 URL 解码，再 TrimStart('/')  
                var path = request.Url?.AbsolutePath ?? "/index.html";
                path = Uri.UnescapeDataString(path);  // 先解码（使用 Uri.UnescapeDataString 更可靠）
                path = path.TrimStart('/');  // 再移除开头的 /

                // 【发行形态】请求目录（含站点根 "/"）时补全入口页：目录本身不能作为响应体，
                // 且发行形态下入口页只存在于 code.sgd 内，必须由容器提供。
                if (path.Length == 0 || path.EndsWith("/")) path += "index.html";

                // 调试：打印路径信息
                if (_isDebug)
                {
                    Console.WriteLine($"[DEBUG] Raw URL: {request.Url}");
                    Console.WriteLine($"[DEBUG] AbsolutePath (before decode): {request.Url?.AbsolutePath}");
                    Console.WriteLine($"[DEBUG] Decoded path: {path}");
                }

                // 检查是否为 API 请求。
                // 例外：api/ 目录下存在同名磁盘文件时（如 /api/progress_api.js、progress.json），
                // 按静态资源服务，否则这些脚本会被 API 路由拦截而永远 404。
                if (path.StartsWith("api/"))
                {
                    var apiFilePath = Path.GetFullPath(Path.Combine(_rootDir, path));
                    var apiRoot = Path.GetFullPath(_rootDir);
                    bool underRoot = PathGuard.IsUnderRoot(apiFilePath, apiRoot);
                    // 【发行形态】api/ 下的静态脚本可能只存在于 api.sgd 内、磁盘上没有散文件。
                    // 只按 File.Exists 判断会把 progress_api.js 之类误当成 API 路由而永远 404。
                    bool inContainer = underRoot && _vfs != null && _vfs.Contains(path);
                    if (!underRoot || (!File.Exists(apiFilePath) && !inContainer))
                    {
                        await HandleApiRequest(context);
                        return;
                    }
                    // 磁盘文件或容器 entry 存在 → 落入下方静态文件流程
                }

                // CG 缩略图是虚拟路由，磁盘上没有 /cg-thumb/ 文件；必须在 File exists 日志之前分流。
                if (path.StartsWith("cg-thumb/", StringComparison.OrdinalIgnoreCase))
                {
                    if (!_thumbnailsEnabled)
                    {
                        response.StatusCode = 404;
                        return;
                    }
                    var rel = path.Substring("cg-thumb/".Length);
                    var assetsRoot = Path.GetFullPath(Path.Combine(_rootDir, "assets"));
                    var fullSrc = Path.GetFullPath(Path.Combine(assetsRoot, rel));
                    // 【发行形态】源图只存在于 assets/<子包>.sgd 内，磁盘上没有散文件，
                    // 因此存在性判断必须同时认可容器来源，否则缩略图全部 404。
                    string cgVfsRel = "assets/" + rel.Replace('\\', '/');
                    bool cgInContainer = _vfs != null && _vfs.Contains(cgVfsRel);
                    bool cgOnDisk = File.Exists(fullSrc);
                    if (!PathGuard.IsUnderRoot(fullSrc, assetsRoot) || (!cgOnDisk && !cgInContainer) || !IsImageFile(fullSrc))
                    {
                        if (_isDebug) Console.WriteLine($"[DEBUG] 404: CG thumb not found: {path}");
                        response.StatusCode = 404;
                        return;
                    }
                    // 容器来源：assets/<rel> 在包内时直接从 .sgd 读源图（fail-closed，无散文件回落）
                    if (cgInContainer)
                    {
                        // 缓存键与 ETag 由「资源相对路径 + 包戳」稳定派生：无需读源即可协商 304。
                        // 包戳参与缓存键，重打包后旧键立即失效；(default, 0) 则会让包内容变了仍命中旧键。
                        var cgKey = ContainerThumbKey(rel, cgVfsRel, out var etag);
                        if (ImageCachePolicy.SendETag(isThumbnail: true))
                            ApplyImageCacheHeaders(response, etag);
                        if (ImageCachePolicy.ShouldNotModified(isThumbnail: true, AssetETag.IfNoneMatch(request.Headers["If-None-Match"], etag)))
                        {
                            response.StatusCode = 304;
                            response.ContentLength64 = 0;
                            return;
                        }
                        // T3.1/T3.2/T3.3：内存 → 磁盘 → 逐键锁 → 解码闸门；命中即终态，零解密零解码。
                        var cgData = await ResolveThumbnailAsync(cgKey, () =>
                            _vfs!.TryRead(cgVfsRel, out var cgSrcBytes) ? BuildCgThumbnail(cgSrcBytes) : null);
                        if (cgData != null)
                        {
                            response.StatusCode = 200;
                            response.ContentType = "image/jpeg";
                            response.ContentLength64 = cgData.Length;
                            await response.OutputStream.WriteAsync(cgData, 0, cgData.Length);
                            return;
                        }
                        response.StatusCode = 404; return;
                    }

                    var canonRel = Path.GetRelativePath(assetsRoot, fullSrc).Replace('\\', '/');
                    await HandleCgThumbRequest(request, response, canonRel, fullSrc);
                    return;
                }

                // 立绘预合成是虚拟路由，磁盘上没有 /char-frame 文件。
                if (path.Equals("char-frame", StringComparison.OrdinalIgnoreCase))
                {
                    await HandleCharFrameRequest(request, response);
                    return;
                }

                var filePath = Path.GetFullPath(Path.Combine(_rootDir, path));
                
                // 安全校验：防止路径遍历攻击，确保文件在 _rootDir 下
                var normalizedRoot = Path.GetFullPath(_rootDir);
                if (!PathGuard.IsUnderRoot(filePath, normalizedRoot))
                {
                    if (_isDebug) Console.WriteLine($"[DEBUG] 403 Forbidden (path traversal): {filePath}");
                    response.StatusCode = 403;
                    return;
                }

                // 容器优先：若请求落在已打包子目录且 entry 存在，从 .sgd 读回（fail-closed，不在容器内才回落磁盘）
                if (TryServeVfs(path, request, response)) return;

                // 调试：打印最终文件路径
                if (_isDebug)
                {
                    Console.WriteLine($"[DEBUG] RootDir: {normalizedRoot}");
                    Console.WriteLine($"[DEBUG] FilePath: {filePath}");
                    Console.WriteLine($"[DEBUG] File exists: {File.Exists(filePath)}");
                }

                if (!File.Exists(filePath))
                {
                    if (_isDebug) Console.WriteLine($"[DEBUG] 404: File not found: {filePath}");
                    response.StatusCode = 404;
                    return;
                }

                var fileInfo = new FileInfo(filePath);
                var rangeHeader = request.Headers["Range"];
                // Range 分段分发：仅当客户端携带 Range 头、文件为媒体扩展名且区间可解析时走 206 分段响应；
                // 否则走普通整文件响应（含 HTML 重写与图片缓存头逻辑）
                if (rangeHeader != null
                    && ByteRange.IsMediaExtension(Path.GetExtension(filePath))
                    && ByteRange.TryParse(rangeHeader, fileInfo.Length, out _, out _))
                {
                    await HandleRangeRequest(response, filePath, fileInfo.Length, rangeHeader);
                }
                else
                {
                    await HandleNormalRequest(request, response, filePath, fileInfo);
                }
            }
            catch (Exception ex)
            {
                if (HttpListenerAbort.IsClientAbort(ex))
                {
                    aborted = true;
                    TryAbort(response);
                    return;
                }
                if (_isDebug) Console.WriteLine($"[ERROR] Request processing error: {ex.Message}");
                try { response.StatusCode = 500; }
                catch (Exception setEx) when (HttpListenerAbort.IsClientAbort(setEx) || setEx is HttpListenerException)
                {
                    aborted = true;
                    TryAbort(response);
                }
            }
            finally
            {
                if (!aborted)
                {
                    try { response.Close(); }
                    catch (Exception ex) when (HttpListenerAbort.IsClientAbort(ex) || ex is HttpListenerException) { }
                }
            }
        }

        // ============================================================
        //  CG 缩略图：256px JPEG + 字节 LRU + 源文件 ETag/304（OPT S5.2 / T18）。
        // ============================================================

        // ============================================================
        //  缩略图统一获取路径（T3.1/T3.2/T3.3）
        //  内存 LRU → 磁盘持久化 → 逐键锁 → 全局解码闸门 → 生成并回填两层缓存。
        //  容器来源与磁盘来源共用本方法，只有"取源字节的方式"不同（build 回调）。
        // ============================================================

        /// <summary>
        /// 取缩略图字节：按「内存缓存 → 磁盘缓存 → 逐键锁内二次检查 → 全局解码闸门 → 生成」
        /// 的顺序解析，生成成功后同时回填内存与磁盘。
        /// </summary>
        /// <param name="key">缩略图缓存键（已含源资源版本信息）。</param>
        /// <param name="build">真正的解码/缩放/编码回调；返回 null 表示源图不可用。</param>
        /// <returns>JPEG 字节；失败返回 null。</returns>
        private async Task<byte[]?> ResolveThumbnailAsync(string key, Func<byte[]?> build)
        {
            // 1) 内存命中：零 IO、零解码（T3.1 的终态）
            if (_thumbCache.TryGet(key, out var data))
            {
                Interlocked.Increment(ref _thumbMemHits);
                return data;
            }

            // 2) 磁盘命中：跨会话复用，只多一次小文件读（T3.3）
            if (_thumbDisk.TryGet(key, out var fromDisk))
            {
                _thumbCache.TryAdd(key, fromDisk);
                Interlocked.Increment(ref _thumbDiskHits);
                return fromDisk;
            }

            // 3) 未命中：逐键锁防同图重复解码，全局闸门限瞬时并发（T3.2）
            var gate = _thumbLocks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync();
            try
            {
                // 等锁期间他人可能已写入内存或磁盘（double-check）
                if (_thumbCache.TryGet(key, out data)) return data;
                if (_thumbDisk.TryGet(key, out fromDisk))
                {
                    _thumbCache.TryAdd(key, fromDisk);
                    Interlocked.Increment(ref _thumbDiskHits);
                    return fromDisk;
                }
                if (!_thumbnailsEnabled) return null;

                await _thumbDecodeGate.WaitAsync();
                try
                {
                    data = build();
                }
                finally
                {
                    _thumbDecodeGate.Release();
                }
                if (data == null || !_thumbnailsEnabled) return null;

                _thumbCache.TryAdd(key, data);
                _thumbDisk.Put(key, data);
                Interlocked.Increment(ref _thumbDiskWrites);
                return data;
            }
            finally
            {
                gate.Release();
            }
        }

        /// <summary>
        /// 容器来源的缩略图缓存键：把所属 .sgd 的「包戳」（最后写入时间 + 长度）纳入键与 ETag。
        /// 打包器每次重打包都会改这两个字段，因此开发期反复打包也不会读到上一版的陈旧缩略图。
        /// </summary>
        /// <param name="rel">相对 assets/ 的源图路径（正斜杠）。</param>
        /// <param name="vfsRel">站点根相对路径（含 <c>assets/</c> 前缀），用于查包戳。</param>
        /// <param name="etag">输出 ETag（带双引号）。</param>
        /// <returns>缩略图缓存键。</returns>
        private string ContainerThumbKey(string rel, string vfsRel, out string etag)
        {
            DateTime mtime = default;
            long len = 0;
            _vfs?.TryGetPackStamp(vfsRel, out mtime, out len);
            etag = AssetETag.FromFile(mtime, len);
            return AssetETag.ThumbKey(rel, mtime, len);
        }

        /// <summary>
        /// 处理 /cg-thumb/* 请求：返回 CG 图片的 256px JPEG 缩略图。
        /// 缓存协商：以源文件的 (修改时间, 大小) 生成 ETag，命中 If-None-Match 时直接返回 304；
        /// 缓存键 = 相对路径 + 源文件修改时间 + 大小，源文件更新后自动失效。
        /// 并发控制：每键信号量防止重复解码 + 全局解码闸门（并发 2）限制瞬时解码压力；
        /// 拿到锁后二次检查缓存（double-check），避免闸门等待期间他人已写入的同图重复生成。
        /// 副作用：缓存未命中时会触发 OpenCV 解码与 WPF JPEG 编码，并写入 LRU 缓存。
        /// </summary>
        /// <param name="request">客户端请求（读取 If-None-Match 头）。</param>
        /// <param name="response">待写入的响应。</param>
        /// <param name="relKey">相对 assets/ 的源图路径（正斜杠分隔），用作缓存键的一部分。</param>
        /// <param name="fullSourcePath">源图绝对路径（已通过路径守卫校验）。</param>
        private async Task HandleCgThumbRequest(HttpListenerRequest request, HttpListenerResponse response, string relKey, string fullSourcePath)
        {
            var fi = new FileInfo(fullSourcePath);
            if (!fi.Exists)
            {
                response.StatusCode = 404;
                return;
            }

            // ETag/304 缓存协商：基于源文件修改时间与大小生成强校验器
            var etag = AssetETag.FromFile(fi.LastWriteTimeUtc, fi.Length);
            if (ImageCachePolicy.SendETag(isThumbnail: true))
                ApplyImageCacheHeaders(response, etag);
            var noneMatch = AssetETag.IfNoneMatch(request.Headers["If-None-Match"], etag);
            if (ImageCachePolicy.ShouldNotModified(isThumbnail: true, ifNoneMatch: noneMatch))
            {
                if (_isDebug) Console.WriteLine($"[DEBUG] CG thumb 304: {relKey}");
                response.StatusCode = 304;
                response.ContentLength64 = 0;
                return;
            }

            // 缓存键绑定源文件版本（修改时间+大小），源文件变化后旧键自然失效
            var key = AssetETag.ThumbKey(relKey, fi.LastWriteTimeUtc, fi.Length);
            var data = await ResolveThumbnailAsync(key, () => BuildCgThumbnail(fullSourcePath));
            if (data == null)
            {
                response.StatusCode = 404;
                return;
            }

            response.StatusCode = 200;
            response.ContentType = "image/jpeg";
            response.ContentLength64 = data.Length;
            if (_isDebug) Console.WriteLine($"[DEBUG] CG thumb 200: {relKey} bytes={data.Length} jpeg");
            await response.OutputStream.WriteAsync(data, 0, data.Length);
        }

        // ============================================================
        //  立绘预合成：dress+face PNG + 字节 LRU（OPT S5.4 / T21）。
        //  FrameCache=false → Limit=0，每次现场合成仍 200，只是不入表。
        // ============================================================

        /// <summary>
        /// 处理 /char-frame 请求：把立绘 dress（服装/身体）与 face（表情）图层
        /// 按查询参数预合成为单张 PNG 返回。
        /// 查询参数：dress / face（相对 assets/ 的图片路径）、ox / oy（表情偏移）、
        /// fs（表情缩放）、sw / sh（舞台尺寸）、bs（基础缩放），由 CharFrameKey.TryParse 统一解析。
        /// 安全限制：源图必须位于 assets/ 内、为图片扩展名、单文件不超过 MaxSourceBytes。
        /// 缓存协商：缓存键绑定两张源图的（修改时间, 大小）→ ETag，命中即 304。
        /// 并发控制：每键信号量 + 全局合成闸门（并发 2）+ 拿锁后二次检查缓存。
        /// FrameCache 关闭时缓存容量为 0：仍正常合成返回 200，只是不入缓存。
        /// </summary>
        /// <param name="request">客户端请求（读取查询串与 If-None-Match 头）。</param>
        /// <param name="response">待写入的响应。</param>
        private async Task HandleCharFrameRequest(HttpListenerRequest request, HttpListenerResponse response)
        {
            var qs = request.QueryString;
            // 参数解析失败（缺失/非法）→ 400；路径解析或安全校验失败 → 404
            if (!CharFrameKey.TryParse(
                    qs["dress"], qs["face"], qs["ox"], qs["oy"], qs["fs"],
                    qs["sw"], qs["sh"], qs["bs"],
                    out var spec))
            {
                response.StatusCode = 400;
                return;
            }

            // 容器化立绘：dress 与 face 均落在 .sgd 内时，直接从容器读字节预合成
            // （fail-closed：命中容器就不再回落散文件；两图任缺一或两个都不在包内则回落磁盘分支）
            string dressVfsRel = "assets/" + spec.DressRel.Replace('\\', '/');
            string faceVfsRel = "assets/" + spec.FaceRel.Replace('\\', '/');
            if (_vfs != null && _vfs.Contains(dressVfsRel) && _vfs.Contains(faceVfsRel)
                && _vfs.TryRead(dressVfsRel, out var dressBytes) && _vfs.TryRead(faceVfsRel, out var faceBytes))
            {
                long dLen = dressBytes.Length, fLen = faceBytes.Length;
                // 容器内容不可变：缓存键用零时间戳 + 字节长度（容器部署后稳定），不依赖磁盘修改时间
                // 变量名加 vfs 前缀：与下方磁盘分支的同名局部变量(cCacheKey/etag/noneMatch/data)区分，避免 CS0136
                var vfsCacheKey = CharFrameKey.CacheKey(spec, default, dLen, default, fLen);
                var vfsEtag = CharFrameKey.ETag(vfsCacheKey);
                var vfsNoneMatch = AssetETag.IfNoneMatch(request.Headers["If-None-Match"], vfsEtag);
                if (ImageCachePolicy.ShouldNotModified(isThumbnail: true, ifNoneMatch: vfsNoneMatch))
                {
                    if (ImageCachePolicy.SendETag(isThumbnail: true)) ApplyImageCacheHeaders(response, vfsEtag);
                    if (_isDebug) Console.WriteLine($"[DEBUG] char-frame 304 (vfs): {spec.DressRel}");
                    response.StatusCode = 304;
                    response.ContentLength64 = 0;
                    return;
                }
                if (!_frameCache.TryGet(vfsCacheKey, out var vfsData))
                {
                    var gate = _frameLocks.GetOrAdd(vfsCacheKey, _ => new SemaphoreSlim(1, 1));
                    await gate.WaitAsync();
                    try
                    {
                        if (!_frameCache.TryGet(vfsCacheKey, out vfsData))
                        {
                            await _frameDecodeGate.WaitAsync();
                            try { vfsData = BuildCharFrame(dressBytes, faceBytes, spec); }
                            finally { _frameDecodeGate.Release(); }
                            if (vfsData == null) { response.StatusCode = 404; return; }
                            if (!_frameCache.TryGet(vfsCacheKey, out var raced)) _frameCache.TryAdd(vfsCacheKey, vfsData);
                            else vfsData = raced;
                        }
                    }
                    finally { gate.Release(); }
                }
                if (vfsData == null || vfsData.Length == 0) { response.StatusCode = 404; return; }
                if (ImageCachePolicy.SendETag(isThumbnail: true)) ApplyImageCacheHeaders(response, vfsEtag);
                response.StatusCode = 200;
                response.ContentType = "image/png";
                response.ContentLength64 = vfsData.Length;
                if (_isDebug) Console.WriteLine($"[DEBUG] char-frame 200 (vfs): {spec.DressRel} bytes={vfsData.Length} png");
                await response.OutputStream.WriteAsync(vfsData, 0, vfsData.Length);
                return;
            }

            var assetsRoot = Path.GetFullPath(Path.Combine(_rootDir, "assets"));
            if (!CharFrameKey.TryResolveImage(assetsRoot, spec.DressRel, out var dressPath)
                || !CharFrameKey.TryResolveImage(assetsRoot, spec.FaceRel, out var facePath)
                || !PathGuard.IsUnderRoot(dressPath, assetsRoot)
                || !PathGuard.IsUnderRoot(facePath, assetsRoot)
                || !IsImageFile(dressPath)
                || !IsImageFile(facePath))
            {
                response.StatusCode = 404;
                return;
            }

            FileInfo dressFi;
            FileInfo faceFi;
            try
            {
                dressFi = new FileInfo(dressPath);
                faceFi = new FileInfo(facePath);
            }
            catch (IOException)
            {
                response.StatusCode = 404;
                return;
            }
            catch (UnauthorizedAccessException)
            {
                response.StatusCode = 404;
                return;
            }

            if (!dressFi.Exists || !faceFi.Exists
                || dressFi.Length > CharFrameKey.MaxSourceBytes
                || faceFi.Length > CharFrameKey.MaxSourceBytes)
            {
                response.StatusCode = 404;
                return;
            }

            var cacheKey = CharFrameKey.CacheKey(
                spec, dressFi.LastWriteTimeUtc, dressFi.Length,
                faceFi.LastWriteTimeUtc, faceFi.Length);
            var etag = CharFrameKey.ETag(cacheKey);
            var noneMatch = AssetETag.IfNoneMatch(request.Headers["If-None-Match"], etag);
            if (ImageCachePolicy.ShouldNotModified(isThumbnail: true, ifNoneMatch: noneMatch))
            {
                if (ImageCachePolicy.SendETag(isThumbnail: true))
                    ApplyImageCacheHeaders(response, etag);
                if (_isDebug) Console.WriteLine($"[DEBUG] char-frame 304: {spec.DressRel}");
                response.StatusCode = 304;
                response.ContentLength64 = 0;
                return;
            }

            if (!_frameCache.TryGet(cacheKey, out var data))
            {
                var gate = _frameLocks.GetOrAdd(cacheKey, _ => new SemaphoreSlim(1, 1));
                await gate.WaitAsync();
                try
                {
                    if (!_frameCache.TryGet(cacheKey, out data))
                    {
                        await _frameDecodeGate.WaitAsync();
                        try
                        {
                            data = BuildCharFrame(dressPath, facePath, spec);
                        }
                        finally
                        {
                            _frameDecodeGate.Release();
                        }
                        if (data == null)
                        {
                            response.StatusCode = 404;
                            return;
                        }
                        if (!_frameCache.TryGet(cacheKey, out var raced))
                            _frameCache.TryAdd(cacheKey, data);
                        else
                            data = raced;
                    }
                }
                finally { gate.Release(); }
            }

            if (data == null || data.Length == 0)
            {
                response.StatusCode = 404;
                return;
            }

            if (ImageCachePolicy.SendETag(isThumbnail: true))
                ApplyImageCacheHeaders(response, etag);
            response.StatusCode = 200;
            response.ContentType = "image/png";
            response.ContentLength64 = data.Length;
            if (_isDebug) Console.WriteLine($"[DEBUG] char-frame 200: {spec.DressRel} bytes={data.Length} png");
            await response.OutputStream.WriteAsync(data, 0, data.Length);
        }

        /// <summary>
        /// 合成立绘帧：将 face（表情）图层按规格叠加到 dress（服装/身体）图层上，输出 PNG 字节。
        /// 处理管线：解码（保留 Alpha 通道）→ 统一转 BGRA → 计算表情落位矩形（CharDiffMath）
        /// → 裁剪/缩放表情 ROI → 像素级 Alpha 混合（CharDiffBlit.Blit）→ WPF PngBitmapEncoder 编码。
        /// 解码尺寸超过 MaxDecodedPixels 或任一环节失败时返回 null（由调用方转 404）。
        /// 注意：Mat 对象均需手动释放（using / owned 标记），防止非托管内存泄漏。
        /// </summary>
        /// <param name="dressPath">dress 图层（服装/身体）绝对路径。</param>
        /// <param name="facePath">face 图层（表情）绝对路径。</param>
        /// <param name="spec">合成规格（偏移、缩放、舞台尺寸等）。</param>
        /// <returns>合成 PNG 字节；解码失败、尺寸超限或发生异常时返回 null。</returns>
        private static byte[]? BuildCharFrame(string dressPath, string facePath, CharFrameSpec spec)
        {
            try
            {
                return BuildCharFrame(File.ReadAllBytes(dressPath), File.ReadAllBytes(facePath), spec);
            }
            catch (OutOfMemoryException ex)
            {
                Console.WriteLine($"[HttpServer] char-frame compose OOM: {ex.Message}");
                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[HttpServer] char-frame compose failed: {ex.Message}");
                return null;
            }
        }

        /// <summary>由 dress/face 源图字节合成立绘帧（容器来源复用此重载，避免落到磁盘）。</summary>
        private static byte[]? BuildCharFrame(byte[] dressSrc, byte[] faceSrc, CharFrameSpec spec)
        {
            try
            {
                // ImreadModes.Unchanged 保留原图通道数与 Alpha；空图或尺寸非法直接放弃
                using var dressMat = Cv2.ImDecode(dressSrc, ImreadModes.Unchanged);
                using var faceMat = Cv2.ImDecode(faceSrc, ImreadModes.Unchanged);
                if (dressMat.Empty() || faceMat.Empty()
                    || dressMat.Width <= 0 || dressMat.Height <= 0
                    || faceMat.Width <= 0 || faceMat.Height <= 0)
                    return null;
                if ((long)dressMat.Width * dressMat.Height > CharFrameKey.MaxDecodedPixels
                    || (long)faceMat.Width * faceMat.Height > CharFrameKey.MaxDecodedPixels)
                    return null;

                if (!TryToBgra(dressMat, out var dressBgra, out var dressOwned))
                    return null;
                if (!TryToBgra(faceMat, out var faceBgra, out var faceOwned))
                {
                    if (dressOwned) dressBgra.Dispose();
                    return null;
                }

                try
                {
                    // 依据舞台尺寸/基础缩放/表情缩放计算表情图层在 dress 上的目标落位矩形
                    var rect = CharDiffMath.ComputeFaceRect(
                        dressBgra.Width, dressBgra.Height,
                        faceBgra.Width, faceBgra.Height,
                        spec.OffsetX, spec.OffsetY, spec.FaceScale,
                        spec.StageW, spec.StageH, spec.BaseScale);

                    var dressBytes = new byte[checked(dressBgra.Width * dressBgra.Height * 4)];
                    CopyMatBgra(dressBgra, dressBytes);

                    if (CharDiffMath.TryMapVisibleFace(
                            rect, dressBgra.Width, dressBgra.Height,
                            faceBgra.Width, faceBgra.Height, out var vis))
                    {
                        var roi = new OpenCvSharp.Rect(vis.SrcX, vis.SrcY, vis.SrcW, vis.SrcH);
                        using var faceRoi = new Mat(faceBgra, roi);
                        // 局部 Mat 不能与方法参数 faceSrc(源图字节) 同名，否则 CS0136
                        using var faceScaled = new Mat();
                        if (vis.SrcW != vis.DestW || vis.SrcH != vis.DestH)
                            Cv2.Resize(faceRoi, faceScaled, new OpenCvSharp.Size(vis.DestW, vis.DestH), 0, 0, InterpolationFlags.Linear);
                        else
                            faceRoi.CopyTo(faceScaled);

                        var faceBytes = new byte[checked(faceScaled.Width * faceScaled.Height * 4)];
                        CopyMatBgra(faceScaled, faceBytes);
                        CharDiffBlit.Blit(
                            dressBytes, dressBgra.Width, dressBgra.Height,
                            faceBytes, faceScaled.Width, faceScaled.Height,
                            vis.DestX, vis.DestY);
                    }

                    return EncodePngBgra(dressBytes, dressBgra.Width, dressBgra.Height);
                }
                finally
                {
                    if (dressOwned) dressBgra.Dispose();
                    if (faceOwned) faceBgra.Dispose();
                }
            }
            catch (OutOfMemoryException ex)
            {
                Console.WriteLine($"[HttpServer] char-frame compose OOM: {ex.Message}");
                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[HttpServer] char-frame compose failed: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// 将任意通道数的 Mat 统一转换为 4 通道 BGRA（合成管线的统一像素格式）。
        /// 已是 4 通道时原样返回（owned=false，调用方不得释放）；3 通道 BGR 与 1 通道灰度
        /// 分别经 Cv2.CvtColor 转换出新 Mat（owned=true，调用方负责释放）；其他通道数失败。
        /// </summary>
        /// <param name="src">源 Mat（不转移所有权）。</param>
        /// <param name="bgra">输出：4 通道 BGRA Mat（可能是 src 本身或新分配的 Mat）。</param>
        /// <param name="owned">输出：bgra 是否为本调用新分配（true 时调用方必须 Dispose）。</param>
        /// <returns>转换是否成功。</returns>
        private static bool TryToBgra(Mat src, out Mat bgra, out bool owned)
        {
            owned = false;
            bgra = src;
            if (src.Empty())
                return false;
            var ch = src.Channels();
            if (ch == 4)
                return true;
            ColorConversionCodes code;
            if (ch == 3) code = ColorConversionCodes.BGR2BGRA;
            else if (ch == 1) code = ColorConversionCodes.GRAY2BGRA;
            else return false;
            var converted = new Mat();
            try
            {
                Cv2.CvtColor(src, converted, code);
                bgra = converted;
                owned = true;
                return true;
            }
            catch
            {
                converted.Dispose();
                throw;
            }
        }

        /// <summary>
        /// 把 4 通道 BGRA Mat 的像素复制到托管 byte 数组（供托管端混合/编码使用）。
        /// 快路径：行步长恰好为 width*4（紧凑行）时整块 Marshal.Copy；
        /// 慢路径：存在行间填充（padding）时逐行复制以跳过填充字节。
        /// </summary>
        /// <param name="mat">源 Mat（须为 4 通道 BGRA）。</param>
        /// <param name="dest">目标缓冲区，容量不足时抛出 ArgumentException。</param>
        private static void CopyMatBgra(Mat mat, byte[] dest)
        {
            var w = mat.Width;
            var h = mat.Height;
            var rowBytes = w * 4;
            if (dest.Length < (long)rowBytes * h)
                throw new ArgumentException("dest buffer too small", nameof(dest));
            var step = (int)mat.Step();
            // 快路径：无行填充，整块拷贝
            if (step == rowBytes)
            {
                Marshal.Copy(mat.Data, dest, 0, rowBytes * h);
                return;
            }
            // 慢路径：逐行拷贝，跳过每行末尾的填充字节
            for (var y = 0; y < h; y++)
                Marshal.Copy(IntPtr.Add(mat.Data, y * step), dest, y * rowBytes, rowBytes);
        }

        /// <summary>
        /// 把 BGRA 像素缓冲区编码为 PNG 字节（WPF PngBitmapEncoder）。
        /// BitmapSource经 Freeze 后可跨线程安全使用（后台合成线程 → HTTP 写出线程）。
        /// </summary>
        /// <param name="bgra">紧凑排列的 BGRA 像素（stride = width*4）。</param>
        /// <param name="width">图像宽度（像素）。</param>
        /// <param name="height">图像高度（像素）。</param>
        /// <returns>PNG 文件字节。</returns>
        private static byte[] EncodePngBgra(byte[] bgra, int width, int height)
        {
            var bmp = BitmapSource.Create(
                width, height, 96, 96, PixelFormats.Bgra32, null, bgra, width * 4);
            bmp.Freeze();
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bmp));
            using var ms = new MemoryStream();
            encoder.Save(ms);
            return ms.ToArray();
        }

        /// <summary>
        /// 启动即预热：先枚举 CG 清单，再逐张预生成缩略图填充内存 LRU 与磁盘缓存，
        /// 玩家还在标题画面时就开始灌池。
        ///   · 磁盘缓存先查，第二次启动几乎全部命中，零解密零解码；
        ///   · 双闸门：字节上限（内存 LRU 满即停）+ 总时长预算（调用方的链接取消源）。
        /// 终止条件：缩略图被关闭、收到取消信号、或内存缓存已达容量上限。
        /// </summary>
        /// <param name="token">取消令牌（缩略图关闭或时长预算到期）。</param>
        private void PrewarmCgThumbnails(CancellationToken token)
        {
            try
            {
                if (!_thumbnailsEnabled) return;

                // 先枚举清单（磁盘目录扫描 / 容器索引，都是内存操作，很快）
                var manifest = GetCgManifest();
                if (manifest.Count == 0) return;

                // 腾出预算：清掉上次运行遗留的、已被新键取代的旧缩略图
                int pruned = _thumbDisk.Prune();

                var assetsRoot = Path.Combine(_rootDir, "assets");
                int ok = 0, fail = 0, i = 0;
                foreach (var rel in manifest)
                {
                    if (!_thumbnailsEnabled || token.IsCancellationRequested) break;
                    // 内存 LRU 满了就停：继续只会把刚生成的挤出去，纯属空转
                    if (_thumbCache.TotalBytes >= _thumbCache.LimitBytes) break;

                    // 容器优先（fail-closed）：包内存在就从 .sgd 读，否则回落磁盘散文件
                    string vfsRel = "assets/" + rel;
                    string key;
                    Func<byte[]?> build;
                    if (_vfs != null && _vfs.Contains(vfsRel))
                    {
                        key = ContainerThumbKey(rel, vfsRel, out _);
                        string captured = vfsRel;
                        build = () => _vfs.TryRead(captured, out var b) ? BuildCgThumbnail(b) : null;
                    }
                    else
                    {
                        var diskPath = Path.GetFullPath(Path.Combine(assetsRoot, rel.Replace('/', Path.DirectorySeparatorChar)));
                        if (!PathGuard.IsUnderRoot(diskPath, assetsRoot)) { fail++; continue; }
                        FileInfo fi;
                        try { fi = new FileInfo(diskPath); }
                        catch { fail++; continue; }
                        if (!fi.Exists) { fail++; continue; }
                        key = AssetETag.ThumbKey(rel, fi.LastWriteTimeUtc, fi.Length);
                        string captured = diskPath;
                        build = () => BuildCgThumbnail(captured);
                    }

                    int r = PrewarmOne(key, build, token);
                    if (r < 0) break;
                    if (r == 0) ok++; else fail++;
                    // 每 8 张让一次线程：预热是后台低优先级任务，不能把线程池占死
                    if ((++i & 7) == 0) Thread.Sleep(1);
                }
                Console.WriteLine($"[HttpServer] CG thumbs prewarmed: {ok} ok, {fail} fail, pruned={pruned}, mem={_thumbCache.TotalBytes} disk={_thumbDisk.ApproxBytes}");
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[HttpServer] CG thumb prewarm failed: {ex.Message}");
            }
        }

        /// <summary>
        /// 预热单张缩略图（内存 → 磁盘 → 生成并回填两层）。容器来源与磁盘来源共用这一条路径，
        /// 差别只在调用方传进来的 <paramref name="build"/>。
        /// </summary>
        /// <param name="key">缩略图缓存键。</param>
        /// <param name="build">解码回调。</param>
        /// <param name="token">取消令牌。</param>
        /// <returns>0 = 成功（含命中）；1 = 生成失败；-1 = 被取消/已禁用，调用方应终止循环。</returns>
        private int PrewarmOne(string key, Func<byte[]?> build, CancellationToken token)
        {
            if (!_thumbnailsEnabled || token.IsCancellationRequested) return -1;
            if (_thumbCache.TryGet(key, out _)) return 0;          // 本次运行已生成
            if (_thumbDisk.TryGet(key, out var disk))              // 上次运行落盘（T3.3 主要收益点）
            {
                _thumbCache.TryAdd(key, disk);
                Interlocked.Increment(ref _thumbDiskHits);
                return 0;
            }
            try { _thumbDecodeGate.Wait(token); }
            catch (OperationCanceledException) { return -1; }
            byte[]? data;
            try { data = build(); }
            finally { _thumbDecodeGate.Release(); }
            if (data == null) return 1;
            _thumbCache.TryAdd(key, data);
            _thumbDisk.Put(key, data);
            Interlocked.Increment(ref _thumbDiskWrites);
            return 0;
        }

        /// <summary>
        /// CG 清单：<c>assets/cg/</c> 下全部图片的「相对 assets/ 路径」（如 <c>cg/bg1.jpg</c>）。
        /// 起服时枚举一次后常驻，同时供预热与 <c>api/cg-manifest</c> 使用 ——
        /// 前端据此在打开 CG 页时一次批量取图（T3.9），而不是逐个 <c>&lt;img src&gt;</c> 去问。
        /// 容器来源时按容器存储下标排序，使后续批量读尽量贴近顺序 I/O。
        /// 懒构建、线程安全，已构建后读路径完全无锁。
        /// </summary>
        private List<string> GetCgManifest()
        {
            var cached = _cgManifest;
            if (cached != null) return cached;
            lock (_cgManifestLock)
            {
                return _cgManifest ??= BuildCgManifest();
            }
        }

        /// <summary>枚举 CG 清单：容器优先，包内不存在才回落磁盘散文件目录。</summary>
        private List<string> BuildCgManifest()
        {
            var list = new List<string>();
            try
            {
                // 容器来源：entry 名形如 assets/cg/xxx.png
                if (_vfs != null && _vfs.IsPackagedSubdir("assets/cg"))
                {
                    foreach (var entry in _vfs.Enumerate("assets/cg/"))
                    {
                        if (!ImgPackFormat.IsImageName(entry)) continue;
                        list.Add(entry.Substring("assets/".Length));
                    }
                }
                else
                {
                    var cgDir = Path.Combine(_rootDir, "assets", "cg");
                    if (Directory.Exists(cgDir))
                    {
                        var assetsRoot = Path.Combine(_rootDir, "assets");
                        foreach (var f in Directory.GetFiles(cgDir, "*.*", SearchOption.AllDirectories))
                        {
                            if (!ImgPackFormat.IsImageName(f)) continue;
                            list.Add(Path.GetRelativePath(assetsRoot, f).Replace('\\', '/'));
                        }
                    }
                }
                // 按容器存储下标排序（不在容器内的排到最后，保持字典序相对稳定）
                if (_vfs != null)
                {
                    list.Sort((a, b) =>
                    {
                        bool oa = _vfs.TryGetReadOrder("assets/" + a, out int ia);
                        bool ob = _vfs.TryGetReadOrder("assets/" + b, out int ib);
                        if (oa && ob) return ia.CompareTo(ib);
                        if (oa != ob) return oa ? -1 : 1;
                        return string.CompareOrdinal(a, b);
                    });
                }
                else
                {
                    list.Sort(string.CompareOrdinal);
                }
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine("[HttpServer] CG manifest failed: " + ex.Message);
            }
            return list;
        }

        /// <summary>
        /// 由源图生成 256px 宽的 JPEG 缩略图字节（等比缩小、只缩不放大）。
        /// 解码采用 ImreadModes.Color（丢弃 Alpha，JPEG 不支持透明）；
        /// 放大场景（源图宽 &lt; 256）保持原尺寸不放大。任何异常记录日志并返回 null。
        /// </summary>
        /// <param name="fullSourcePath">源图绝对路径。</param>
        /// <returns>JPEG 缩略图字节；解码失败或异常时返回 null。</returns>
        private static byte[]? BuildCgThumbnail(string fullSourcePath)
        {
            try
            {
                return BuildCgThumbnail(File.ReadAllBytes(fullSourcePath));
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[HttpServer] 缩略图生成失败: {fullSourcePath} ({ex.Message})");
                return null;
            }
        }

        /// <summary>由源图字节生成 256px 宽 JPEG 缩略图（容器来源复用此重载，避免落到磁盘）。</summary>
        private static byte[]? BuildCgThumbnail(byte[] srcBytes)
        {
            try
            {
                // Color 模式解码为 3 通道 BGR（JPEG 无透明通道）
                using var mat = Cv2.ImDecode(srcBytes, ImreadModes.Color);
                if (mat.Empty() || mat.Width <= 0 || mat.Height <= 0) return null;

                const int targetWidth = 256;
                double scale = Math.Min(1.0, targetWidth / (double)mat.Width);
                int nw = Math.Max(1, (int)Math.Round(mat.Width * scale));
                int nh = Math.Max(1, (int)Math.Round(mat.Height * scale));

                Mat src = mat;
                Mat? ownedResized = null;
                if (nw != mat.Width || nh != mat.Height)
                {
                    ownedResized = new Mat();
                    Cv2.Resize(mat, ownedResized, new Size(nw, nh), 0, 0, InterpolationFlags.Linear);
                    src = ownedResized;
                }

                try
                {
                    var bmp = ToBitmapSourceBgr24(src);
                    bmp.Freeze();
                    var encoder = new JpegBitmapEncoder { QualityLevel = 80 };
                    encoder.Frames.Add(BitmapFrame.Create(bmp));
                    using var ms = new MemoryStream();
                    encoder.Save(ms);
                    return ms.ToArray();
                }
                finally
                {
                    ownedResized?.Dispose();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[HttpServer] 缩略图生成失败 (container): {ex.Message}");
                return null;
            }
        }

        /// <summary>Mat(BGR, 3通道) → 托管像素数组 + BitmapSource(Bgr24)。全流程同线程，无需 STA。</summary>
        private static BitmapSource ToBitmapSourceBgr24(Mat mat)
        {
            int stride = mat.Width * mat.Channels(); // Bgr24：每像素 3 字节，紧凑行
            var pixels = new byte[stride * mat.Height];
            Marshal.Copy(mat.Data, pixels, 0, pixels.Length);
            return BitmapSource.Create(mat.Width, mat.Height, 96, 96,
                PixelFormats.Bgr24, null, pixels, stride);
        }

        /// <summary>
        /// 带双闸门的缩略图预热入口：起服后立即开始。
        /// 闸门一 = 字节上限（内存 LRU 满即停，见 <see cref="PrewarmCgThumbnails"/>）；
        /// 闸门二 = 总时长预算（本方法的链接取消源 + CancelAfter）。
        /// 海量 CG 时也不会长时间占用后台线程，未完成的部分留待在线请求按需生成。
        /// </summary>
        /// <param name="token">外部取消令牌（Stop 或关闭缩略图）。</param>
        private void PrewarmCgThumbnailsBudgeted(CancellationToken token)
        {
            using var window = CancellationTokenSource.CreateLinkedTokenSource(token);
            window.CancelAfter(TimeSpan.FromMilliseconds(PrewarmBudgetMs));
            PrewarmCgThumbnails(window.Token);
        }

        /// <summary>
        /// 处理媒体文件的 HTTP Range 分段请求（206 Partial Content）。
        /// 用于音视频拖动进度条时的按需拉取，避免整文件重传。
        /// 区间解析失败返回 416；响应头含 Content-Range（区间与总长）与 Accept-Ranges。
        /// 传输：定位到区间起点后以 8KB 块循环写出，直至区间耗尽或流结束。
        /// </summary>
        /// <param name="response">待写入的响应。</param>
        /// <param name="filePath">媒体文件绝对路径。</param>
        /// <param name="fileSize">文件总字节数。</param>
        /// <param name="rangeHeader">客户端 Range 头原始值（如 "bytes=0-1023"）。</param>
        /// <summary>
        /// 尝试从容器虚拟文件系统服务请求路径。命中已打包子目录且 entry 存在时返回 true（响应已写出）。
        /// 覆盖：媒体 Range 分段（206）、HTML 服务端重写、图片/普通静态分发。
        /// 注意：首版对单个 entry 全量解密到内存再切片（媒体 Range 未做原生流式，后续可改 entry_read 偏移流式）。
        /// </summary>
        private bool TryServeVfs(string path, HttpListenerRequest request, HttpListenerResponse response)
        {
            if (_vfs == null || !_vfs.Contains(path)) return false;

            var ext = Path.GetExtension(path);
            var rangeHeader = request.Headers["Range"];

            // Range 分段分发（媒体播放 / 拖动进度条）。
            // 【性能关键】必须只解密被请求的区间：原生 entry_read 支持明文偏移随机访问。
            // 此前先整条 entry 全量解密再切片，BGM/视频每次请求都要解密几十 MB，
            // 而散文件路径用 FileStream.Seek 只读区间——这就是加密后明显变慢的根因。
            if (rangeHeader != null
                && ByteRange.IsMediaExtension(ext)
                && _vfs.TryGetSize(path, out long total)
                && ByteRange.TryParse(rangeHeader, total, out var start, out var end))
            {
                int len = (int)(end - start + 1);
                if (!_vfs.TryReadRange(path, start, len, out var chunk) || chunk.Length == 0)
                {
                    response.StatusCode = 404;
                    return true;
                }
                response.StatusCode = 206;
                response.ContentType = GetContentType(path);
                response.Headers.Add("Content-Range", $"bytes {start}-{start + chunk.Length - 1}/{total}");
                response.ContentLength64 = chunk.Length;
                response.Headers.Add("Accept-Ranges", "bytes");
                response.OutputStream.Write(chunk, 0, chunk.Length);
                return true;
            }

            if (!_vfs.TryRead(path, out var bytes))
            {
                response.StatusCode = 404;
                return true;
            }

            // HTML 分支：服务端重写后返回（与 HandleNormalRequest 一致）
            if (path.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
            {
                var html = Encoding.UTF8.GetString(bytes);
                html = RewriteHtmlAssets(html, Path.Combine(_rootDir, path.Replace('/', Path.DirectorySeparatorChar)));
                var outBytes = Encoding.UTF8.GetBytes(html);
                response.StatusCode = 200;
                response.ContentType = "text/html; charset=utf-8";
                response.ContentLength64 = outBytes.Length;
                response.Headers["Cache-Control"] = "no-store";
                response.OutputStream.Write(outBytes, 0, outBytes.Length);
                return true;
            }

            if (IsImageFile(path))
                response.Headers["Cache-Control"] = "public, max-age=86400";
            response.StatusCode = 200;
            response.ContentType = GetContentType(path);
            response.ContentLength64 = bytes.Length;
            if (ByteRange.IsMediaExtension(ext))
                response.Headers.Add("Accept-Ranges", "bytes");
            response.OutputStream.Write(bytes, 0, bytes.Length);
            return true;
        }

        private async Task HandleRangeRequest(HttpListenerResponse response, string filePath, long fileSize, string rangeHeader)
        {
            // 区间非法（越界/格式错误）→ 416 Range Not Satisfiable
            if (!ByteRange.TryParse(rangeHeader, fileSize, out var start, out var end))
            {
                response.StatusCode = 416;
                return;
            }

            long contentLength = end - start + 1;
            // 206 + Content-Range 声明本次返回的字节区间及文件总长
            response.StatusCode = 206;
            response.ContentType = GetContentType(filePath);
            response.Headers.Add("Content-Range", $"bytes {start}-{end}/{fileSize}");
            response.ContentLength64 = contentLength;
            response.Headers.Add("Accept-Ranges", "bytes");

            // 定位到区间起点后按 8KB 块流式写出，避免大文件整读内存
            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                fs.Seek(start, SeekOrigin.Begin);
                var buffer = new byte[8192];
                long remaining = contentLength;
                int bytesRead;

                while (remaining > 0 && (bytesRead = await fs.ReadAsync(buffer, 0, (int)Math.Min(buffer.Length, remaining))) > 0)
                {
                    await response.OutputStream.WriteAsync(buffer, 0, bytesRead);
                    remaining -= bytesRead;
                }
            }
        }

        /// <summary>
        /// 处理普通（非 Range）静态文件请求。
        /// HTML 特殊路径：读入后经 RewriteHtmlAssets 服务端重写（模块展开/资产注入）再返回，
        /// 并设置 Cache-Control: no-store 禁止 WebView2 磁盘缓存（见方法内注释）。
        /// 原图（原图不走 ETag/304）设置 public, max-age=86400 一天强缓存；
        /// 媒体扩展名额外附加 Accept-Ranges: bytes 以支持后续分段请求。
        /// </summary>
        /// <param name="request">客户端请求（当前未使用，保留以备扩展条件请求）。</param>
        /// <param name="response">待写入的响应。</param>
        /// <param name="filePath">文件绝对路径（已通过存在性与路径守卫校验）。</param>
        /// <param name="fileInfo">文件信息（用于 Content-Length）。</param>
        private async Task HandleNormalRequest(HttpListenerRequest request, HttpListenerResponse response, string filePath, FileInfo fileInfo)
        {
            // HTML 分支：服务端重写后返回，禁止磁盘缓存
            if (filePath.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
            {
                var html = await File.ReadAllTextAsync(filePath, Encoding.UTF8);
                html = RewriteHtmlAssets(html, filePath);
                var bytes = Encoding.UTF8.GetBytes(html);
                response.StatusCode = 200;
                response.ContentType = "text/html; charset=utf-8";
                response.ContentLength64 = bytes.Length;
                // HTML 经服务端动态注入（UI_SIZE_CONFIG 等），禁止 WebView2 磁盘缓存，
                // 否则重启 exe 后会命中旧缓存（缺少注入脚本），导致皮肤图片不出现
                response.Headers["Cache-Control"] = "no-store";
                await response.OutputStream.WriteAsync(bytes, 0, bytes.Length);
                return;
            }

            if (IsImageFile(filePath))
            {
                // Originals: never ETag / never 304 (WebView2 CSS background + empty 304).
                response.Headers["Cache-Control"] = "public, max-age=86400";
            }

            response.StatusCode = 200;
            response.ContentType = GetContentType(filePath);
            response.ContentLength64 = fileInfo.Length;
            if (ByteRange.IsMediaExtension(Path.GetExtension(filePath)))
                response.Headers.Add("Accept-Ranges", "bytes");

            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                await fs.CopyToAsync(response.OutputStream);
            }
        }

        private static void ApplyImageCacheHeaders(HttpListenerResponse response, string etag)
        {
            response.Headers["ETag"] = etag;
            response.Headers["Cache-Control"] = "public, max-age=86400";
        }

        private static bool IsImageFile(string filePath)
        {
            var ext = Path.GetExtension(filePath);
            return ext.Equals(".png", StringComparison.OrdinalIgnoreCase)
                || ext.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
                || ext.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)
                || ext.Equals(".webp", StringComparison.OrdinalIgnoreCase)
                || ext.Equals(".gif", StringComparison.OrdinalIgnoreCase)
                || ext.Equals(".bmp", StringComparison.OrdinalIgnoreCase)
                || ext.Equals(".ico", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// M-ENG-3 6b：对引擎页剥离公共 script/link 后按清单注入全部官方 css/js（每文件一次）。
        /// 场景页含 page-chrome；index/CG 不含。其余页仍走 C2 路径映射。
        /// </summary>
        private string RewriteHtmlAssets(string html, string filePath)
        {
            var catalog = GetAssetCatalog();
            if (catalog == null) return html;
            string result;
            if (ShouldInjectOfficial(filePath))
            {
                html = StripOfficialAssetTags(html, catalog);
                html = InjectOfficialSequence(html, catalog, includePageChrome: IsSceneHtml(filePath));
                result = PreloadTitleBackground(html, filePath);
            }
            else
            {
                html = RewriteMappedTags(html, catalog);
                html = RewriteEngineJsTag(html, catalog, prependChrome: false);
                result = html;
            }
            return InjectUiSkinPreloaded(result, filePath);
        }

        private string PreloadTitleBackground(string html, string filePath)
        {
            var rel = RelFromRoot(filePath);
            if (!rel.Equals("index.html", StringComparison.OrdinalIgnoreCase)) return html;

            // 【不硬编码目录】背景图按文件名动态定位；找不到就跳过，避免注入指向不存在路径的 preload
            var bgRel = FindByFileName(TitleBgFileName);
            if (bgRel == null) return html;

            var tag = "<link rel=\"preload\" as=\"image\" href=\"/" + bgRel + "\">";
            if (html.IndexOf(tag, StringComparison.OrdinalIgnoreCase) >= 0)
                return html;
            var head = Regex.Match(html, @"<head[^>]*>", RegexOptions.IgnoreCase);
            if (!head.Success) return html;
            return html.Substring(0, head.Index + head.Length) + "\n    " + tag + html.Substring(head.Index + head.Length);
        }

        /// <summary>
        /// UI 皮肤预加载：读取 ui_size.js 配置（含所有 UI 元素的尺寸/位置/缩放），不再用 OpenCV 解码图片。
        /// 【不硬编码目录】按文件名在整棵树中动态定位：开发者把配置放在 ui\、skin\ 或任意新目录下都能找到；
        /// 磁盘散文件优先，其次 .sgd 容器。找不到则注入为空（皮肤不显示但不阻断页面）。
        /// </summary>
        private string BuildUiSkinScript()
        {
            var rel = FindByFileName(UiSizeConfigName);
            if (rel == null)
            {
                if (_isDebug) Console.WriteLine($"[HttpServer] UI size config not found: {UiSizeConfigName}");
                return "";
            }

            try
            {
                var disk = Path.Combine(_rootDir, rel.Replace('/', Path.DirectorySeparatorChar));
                string scriptContent;
                if (File.Exists(disk))
                {
                    scriptContent = File.ReadAllText(disk, Encoding.UTF8);
                }
                else if (_vfs != null && _vfs.TryRead(rel, out var bytes))
                {
                    scriptContent = Encoding.UTF8.GetString(bytes);
                }
                else
                {
                    if (_isDebug) Console.WriteLine($"[HttpServer] UI size config unreadable: {rel}");
                    return "";
                }

                if (_isDebug) Console.WriteLine($"[HttpServer] UI size config loaded from {rel} ({scriptContent.Length} bytes)");
                return scriptContent;
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine($"[HttpServer] UI size config read failed ({rel}): {ex.Message}");
                return "";
            }
        }

        /// <summary>
        /// 将 ui_size.js 配置注入 HTML（紧跟 &lt;head&gt; 之后）。
        /// 配置包含所有 UI 元素的尺寸、位置、缩放信息。
        /// </summary>
        private string InjectUiSkinPreloaded(string html, string filePath)
        {
            var script = _uiSkinScript;
            if (string.IsNullOrEmpty(script)) return html;
            if (html.IndexOf("UI_SIZE_CONFIG", StringComparison.Ordinal) >= 0) return html;

            var head = Regex.Match(html, @"<head[^>]*>", RegexOptions.IgnoreCase);
            if (!head.Success) return html;

            var pos = head.Index + head.Length;
            return html.Substring(0, pos) + "\n    <script>" + script + "</script>" + html.Substring(pos);
        }

        private bool ShouldInjectOfficial(string filePath)
        {
            var name = Path.GetFileName(filePath);
            if (name.StartsWith("char_preview", StringComparison.OrdinalIgnoreCase))
                return false;
            if (IsSceneHtml(filePath)) return true;
            var rel = RelFromRoot(filePath);
            return rel.Equals("index.html", StringComparison.OrdinalIgnoreCase)
                || rel.Equals("html/CG.html", StringComparison.OrdinalIgnoreCase);
        }

        private string RelFromRoot(string filePath)
        {
            var full = Path.GetFullPath(filePath);
            var root = Path.GetFullPath(_rootDir);
            if (!root.EndsWith(Path.DirectorySeparatorChar))
                root += Path.DirectorySeparatorChar;
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                return "";
            return full.Substring(root.Length).Replace('\\', '/');
        }

        private bool IsSceneHtml(string filePath)
        {
            var scenesDir = Path.GetFullPath(Path.Combine(_rootDir, "scenes"));
            if (!scenesDir.EndsWith(Path.DirectorySeparatorChar))
                scenesDir += Path.DirectorySeparatorChar;
            var full = Path.GetFullPath(filePath);
            return full.StartsWith(scenesDir, StringComparison.OrdinalIgnoreCase);
        }

        private string RewriteEngineJsTag(string html, AssetCatalog catalog, bool prependChrome)
        {
            if (catalog.EngineModulePaths.Count == 0) return html;
            if (HasScriptEnding(html, "engine_core.js")) return html;
            if (!EngineScriptTag.IsMatch(html)) return html;

            var paths = new List<string>();
            if (prependChrome
                && !string.IsNullOrEmpty(catalog.PageChromePath)
                && !HasScriptEnding(html, "page-chrome.js"))
                paths.Add(catalog.PageChromePath);
            paths.AddRange(catalog.EngineModulePaths);

            return EngineScriptTag.Replace(html, m =>
            {
                var pre = m.Groups["pre"].Value;
                var post = m.Groups["post"].Value;
                var q = m.Groups["q"].Value;
                var sb = new StringBuilder();
                for (int i = 0; i < paths.Count; i++)
                {
                    var abs = "/" + paths[i].Replace('\\', '/').TrimStart('/');
                    if (i == 0)
                        sb.Append($"<script{pre}src={q}{abs}{q}{post}></script>");
                    else
                        sb.Append($"<script src={q}{abs}{q}></script>");
                    if (i < paths.Count - 1) sb.Append('\n');
                }
                return sb.ToString();
            });
        }

        private static bool IsOfficialAssetUrl(AssetCatalog catalog, string url)
        {
            var path = url.Split('?')[0].Replace('\\', '/').Trim();
            var fileName = Path.GetFileName(path);
            if (string.IsNullOrEmpty(fileName)) return false;
            if (fileName.Equals("engine.js", StringComparison.OrdinalIgnoreCase)) return true;
            if (EngineModuleName.IsMatch(fileName)) return true;
            return catalog.ByFileName.ContainsKey(fileName);
        }

        private string StripOfficialAssetTags(string html, AssetCatalog catalog)
        {
            html = StripScriptSrc.Replace(html, m =>
                IsOfficialAssetUrl(catalog, m.Groups["url"].Value) ? "" : m.Value);
            html = StripLinkHref.Replace(html, m =>
                IsOfficialAssetUrl(catalog, m.Groups["url"].Value) ? "" : m.Value);
            return html;
        }

        private string InjectOfficialSequence(string html, AssetCatalog catalog, bool includePageChrome)
        {
            if (catalog.Official.Count == 0) return html;

            var css = new StringBuilder();
            var js = new StringBuilder();
            // official 与 macro 原生脚本（NativeJs）可能重叠（如 macro/shiori_dsl.js），去重避免重复注入
            var addedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in catalog.Official)
            {
                var name = Path.GetFileName(entry.RelPath);
                if (string.IsNullOrEmpty(name) || HasAssetRef(html, name)) continue;
                if (!includePageChrome
                    && name.Equals("page-chrome.js", StringComparison.OrdinalIgnoreCase))
                    continue;
                addedNames.Add(name);
                var abs = "/" + entry.RelPath.Replace('\\', '/').TrimStart('/');
                if (entry.Type.Equals("css", StringComparison.OrdinalIgnoreCase))
                    css.Append($"<link rel=\"stylesheet\" href=\"{abs}\">\n");
                else
                    js.Append($"<script src=\"{abs}\"></script>\n");
            }
            foreach (var rel in Dsl.NativeJsRelative())
            {
                var name = Path.GetFileName(rel);
                if (string.IsNullOrEmpty(name) || HasAssetRef(html, name) || addedNames.Contains(name)) continue;
                addedNames.Add(name);
                var abs = "/" + rel.Replace('\\', '/').TrimStart('/');
                js.Append($"<script src=\"{abs}\"></script>\n");
            }
            if (css.Length == 0 && js.Length == 0) return html;

            if (css.Length > 0)
            {
                var head = HeadClose.Match(html);
                html = head.Success
                    ? html.Substring(0, head.Index) + css + html.Substring(head.Index)
                    : css + html;
            }
            if (js.Length > 0)
            {
                var inline = FirstInlineScript.Match(html);
                if (inline.Success)
                    html = html.Substring(0, inline.Index) + js + html.Substring(inline.Index);
                else
                {
                    var body = BodyClose.Match(html);
                    html = body.Success
                        ? html.Substring(0, body.Index) + js + html.Substring(body.Index)
                        : html + js;
                }
            }
            return html;
        }

        private static bool HasScriptEnding(string html, string filename)
        {
            return Regex.IsMatch(
                html,
                @"<script[^>]+src=['""][^'""]*" + Regex.Escape(filename) + @"['""]",
                RegexOptions.IgnoreCase);
        }

        private static bool HasAssetRef(string html, string filename)
        {
            return Regex.IsMatch(
                html,
                @"(?:src|href)=['""][^'""]*" + Regex.Escape(filename) + @"['""]",
                RegexOptions.IgnoreCase);
        }

        private string RewriteMappedTags(string html, AssetCatalog catalog)
        {
            return SrcHrefTag.Replace(html, m =>
            {
                var tag = m.Groups["tag"].Value;
                var attr = m.Groups["attr"].Value;
                var isScriptSrc = tag.Equals("script", StringComparison.OrdinalIgnoreCase)
                    && attr.Equals("src", StringComparison.OrdinalIgnoreCase);
                var isLinkHref = tag.Equals("link", StringComparison.OrdinalIgnoreCase)
                    && attr.Equals("href", StringComparison.OrdinalIgnoreCase);
                if (!isScriptSrc && !isLinkHref) return m.Value;

                var mapped = ResolveCatalogPath(catalog, m.Groups["url"].Value);
                if (mapped == null) return m.Value;

                var abs = "/" + mapped.Replace('\\', '/').TrimStart('/');
                var q = m.Groups["q"].Value;
                return $"<{tag}{m.Groups["pre"].Value}{attr}={q}{abs}{q}{m.Groups["post"].Value}>";
            });
        }

        private static string? ResolveCatalogPath(AssetCatalog catalog, string url)
        {
            var path = url.Split('?')[0].Replace('\\', '/').Trim();
            if (path.Length == 0) return null;
            var trimmed = path.TrimStart('/');
            while (trimmed.StartsWith("./", StringComparison.Ordinal)) trimmed = trimmed.Substring(2);
            while (trimmed.StartsWith("../", StringComparison.Ordinal)) trimmed = trimmed.Substring(3);

            var fileName = Path.GetFileName(trimmed);
            if (fileName.Equals("engine.js", StringComparison.OrdinalIgnoreCase))
                return null;

            foreach (var kv in catalog.BySuffix)
            {
                if (trimmed.EndsWith(kv.Key, StringComparison.OrdinalIgnoreCase))
                    return kv.Value;
            }
            if (catalog.ByFileName.TryGetValue(fileName, out var mapped))
                return mapped;
            return null;
        }

        private bool TryResolveOnDisk(string rel, out string full)
        {
            full = Path.GetFullPath(Path.Combine(_rootDir, rel.Replace('/', Path.DirectorySeparatorChar)));
            var root = Path.GetFullPath(_rootDir);
            if (!root.EndsWith(Path.DirectorySeparatorChar))
                root += Path.DirectorySeparatorChar;
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                return false;
            return File.Exists(full);
        }

        /// <summary>
        /// 按文件名在整棵站点树中动态定位资源，返回站点根相对路径。
        /// 不假定任何目录名（如 ui\、assets\cg\），开发者改名/新增目录都能自动找到；
        /// 磁盘散文件优先，其次遍历全部容器 entry。找不到返回 null（调用方自行降级）。
        /// </summary>
        private string? FindByFileName(string fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName)) return null;

            // 全量枚举（磁盘递归 + 容器 entry）开销较大，按文件名缓存结果
            lock (_fileNameLock)
            {
                if (_fileNameLookup.TryGetValue(fileName, out var cached)) return cached;
                var found = FindByFileNameCore(fileName);
                _fileNameLookup[fileName] = found;
                return found;
            }
        }

        private string? FindByFileNameCore(string fileName)
        {
            // 1) 磁盘（开发期散文件）
            try
            {
                foreach (var path in Directory.EnumerateFiles(_rootDir, fileName, SearchOption.AllDirectories))
                {
                    var rel = ToRelFromRoot(path);
                    if (rel != null) return rel;
                }
            }
            catch (Exception)
            {
                // 目录不可读时静默降级到容器查找
            }

            // 2) 容器（发行形态）
            if (_vfs != null)
            {
                foreach (var rel in _vfs.Enumerate(string.Empty))
                {
                    if (string.IsNullOrEmpty(rel)) continue;
                    if (Path.GetFileName(rel).Equals(fileName, StringComparison.OrdinalIgnoreCase))
                        return rel;
                }
            }

            return null;
        }

        private string? ToRelFromRoot(string full)
        {
            try
            {
                var root = Path.GetFullPath(_rootDir);
                if (!root.EndsWith(Path.DirectorySeparatorChar)) root += Path.DirectorySeparatorChar;
                var p = Path.GetFullPath(full);
                if (!p.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return null;
                return p.Substring(root.Length).Replace('\\', '/');
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// 【发行形态】资产解析：磁盘散文件优先，其次 .sgd 容器内的 entry。
        /// 清单（engine_manifest.json）里的 js/css 在发行形态下只存在于包内、磁盘上没有散文件，
        /// 若仅按 File.Exists 判定会把清单条目逐条丢弃 → 资产目录为空 → HTML 服务端重写整体失效
        /// （引擎模块 script 标签不展开），表现为只能打开主界面、其余资源全部加载不出。
        /// </summary>
        private bool TryResolveAsset(string rel, out string full)
        {
            string r = (rel ?? string.Empty).Replace('\\', '/').TrimStart('/');
            if (TryResolveOnDisk(r, out full)) return true;

            if (_vfs != null && _vfs.Contains(r))
            {
                full = r;   // 容器来源：返回站点根相对路径（调用方仅用于存在性判定）
                return true;
            }

            full = string.Empty;
            return false;
        }

        private AssetCatalog? GetAssetCatalog()
        {
            var cached = _catalog;
            if (cached != null) return cached;
            lock (_catalogLock)
            {
                if (_catalog != null) return _catalog;

                var manifestPath = Path.Combine(_rootDir, "engine_manifest.json");
                if (!File.Exists(manifestPath)) return null;

                var catalog = new AssetCatalog();
                catalog.BySuffix["css/style.css"] = "ui/style.css";
                catalog.BySuffix["modules/progress_api.js"] = "api/progress_api.js";

                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(manifestPath));
                    if (!doc.RootElement.TryGetProperty("official", out var official)
                        || official.ValueKind != JsonValueKind.Array)
                    {
                        Console.WriteLine("[HttpServer] engine_manifest.json 无 official 数组，跳过改写");
                        return null;
                    }

                    foreach (var item in official.EnumerateArray())
                    {
                        var path = item.TryGetProperty("path", out var p) ? p.GetString() : null;
                        var type = item.TryGetProperty("type", out var t) ? t.GetString() : "js";
                        if (string.IsNullOrEmpty(path) || !CatalogRelPath.IsMatch(path.Replace('\\', '/')))
                        {
                            Console.WriteLine($"[HttpServer] 清单条目非法，跳过改写: {path}");
                            return null;
                        }
                        var rel = path.Replace('\\', '/').TrimStart('/');
                        // 【发行形态】必须同时认可容器来源，否则清单条目在纯 .sgd 发布目录里全被判为"缺文件"
                        if (!TryResolveAsset(rel, out _))
                        {
                            var rootFallback = Path.GetFileName(rel);
                            if (!TryResolveAsset(rootFallback, out _))
                            {
                                Console.WriteLine($"[HttpServer] 清单缺文件，忽略条目: {rel}");
                                continue;
                            }
                            rel = rootFallback;
                        }
                        var name = Path.GetFileName(rel);
                        catalog.ByFileName[name] = rel;
                        catalog.Official.Add(new CatalogEntry
                        {
                            Type = string.IsNullOrEmpty(type) ? "js" : type,
                            RelPath = rel
                        });
                        if (name.Equals("page-chrome.js", StringComparison.OrdinalIgnoreCase))
                            catalog.PageChromePath = rel;
                        if (EngineModuleName.IsMatch(name))
                            catalog.EngineModulePaths.Add(rel);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[HttpServer] engine_manifest.json 解析失败，回退 engine.js: {ex.Message}");
                    return null;
                }

                var hasCore = catalog.EngineModulePaths.Any(p =>
                    Path.GetFileName(p).Equals("engine_core.js", StringComparison.OrdinalIgnoreCase));
                var hasBoot = catalog.EngineModulePaths.Any(p =>
                    Path.GetFileName(p).Equals("engine_boot.js", StringComparison.OrdinalIgnoreCase));
                if (catalog.EngineModulePaths.Count > 0 && (!hasCore || !hasBoot))
                {
                    Console.WriteLine("[HttpServer] 清单引擎组缺少 engine_core/engine_boot，回退 engine.js");
                    catalog.EngineModulePaths.Clear();
                }

                _catalog = catalog;
                if (catalog.EngineModulePaths.Count > 0)
                    Console.WriteLine($"[HttpServer] engine.js → {catalog.EngineModulePaths.Count} modules ({string.Join(", ", catalog.EngineModulePaths)})");
                Console.WriteLine($"[HttpServer] asset catalog: {catalog.ByFileName.Count} files");
                return catalog;
            }
        }

        private string GetContentType(string filePath)
        {
            var ext = Path.GetExtension(filePath).ToLower();
            return ext switch
            {
                ".html" => "text/html",
                ".css" => "text/css",
                ".js" => "application/javascript",
                ".png" => "image/png",
                ".jpg" => "image/jpeg",
                ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                ".gif" => "image/gif",
                ".bmp" => "image/bmp",
                ".svg" => "image/svg+xml",
                ".ico" => "image/x-icon",
                ".json" => "application/json",
                ".ttf" => "font/ttf",
                ".woff" => "font/woff",
                ".woff2" => "font/woff2",
                ".otf" => "font/otf",
                ".mp3" => "audio/mpeg",
                ".ogg" => "audio/ogg",
                ".wav" => "audio/wav",
                ".mp4" => "video/mp4",
                ".webm" => "video/webm",
                _ => "application/octet-stream"
            };
        }

        private static void TryAbort(HttpListenerResponse response)
        {
            try { response.Abort(); }
            catch (HttpListenerException) { }
            catch (ObjectDisposedException) { }
        }

        /// <summary>
        /// 处理 API 请求。响应 Close/Abort 由 ProcessRequest 唯一负责。
        /// </summary>
        private async Task HandleApiRequest(HttpListenerContext context)
        {
            var request = context.Request;
            var response = context.Response;
            var path = request.Url?.AbsolutePath.TrimStart('/');

            if (path == "api/chars/scan")
            {
                await HandleScanCharsRequest(response);
            }
            else if (path == "api/cg-manifest")
            {
                await HandleCgManifestRequest(response);
            }
            else if (path == "api/imgpack")
            {
                await HandleImgPackRequest(context, response);
            }
            else if (path != null && path.StartsWith("api/dsl/", StringComparison.OrdinalIgnoreCase))
            {
                await HandleDslApiRequest(context, path.Substring("api/dsl/".Length));
            }
            else
            {
                response.StatusCode = 404;
                response.StatusDescription = "API endpoint not found";
            }
        }

        /// <summary>把任意文本转成可安全嵌入 JSON 字符串的字面量（转义反斜杠、引号与控制字符）。</summary>
        private static string SafeJsonText(string s)
        {
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r");
        }

        // ============================================================
        //  批量图片端点（T3.9）与 CG 清单端点
        //  线格式与入参校验都在 ImgPackFormat 里（无 HTTP 依赖，便于离线往返测试）
        // ============================================================

        /// <summary>
        /// 处理 <c>api/cg-manifest</c>：返回 CG 清单与缩略图基准宽度。
        /// 前端据此在打开 CG 页时先建满全部格子（尺寸来自清单，零布局抖动），
        /// 再用一次 <c>api/imgpack</c> 批量取图，避免每个 &lt;img&gt; 各自发一次请求。
        /// </summary>
        private async Task HandleCgManifestRequest(HttpListenerResponse response)
        {
            var manifest = GetCgManifest();
            var sb = new StringBuilder(64 + manifest.Count * 24);
            sb.Append("{\"ok\":true,\"thumbWidth\":").Append(AssetETag.ThumbWidth)
              .Append(",\"thumbnailsEnabled\":").Append(_thumbnailsEnabled ? "true" : "false")
              .Append(",\"count\":").Append(manifest.Count)
              .Append(",\"items\":[");
            for (int i = 0; i < manifest.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(SafeJsonText(manifest[i])).Append('"');
            }
            sb.Append("]}");

            var buf = Encoding.UTF8.GetBytes(sb.ToString());
            response.StatusCode = 200;
            response.ContentType = "application/json; charset=utf-8";
            response.ContentLength64 = buf.Length;
            response.Headers["Cache-Control"] = "no-store";
            await response.OutputStream.WriteAsync(buf, 0, buf.Length);
        }

        /// <summary>
        /// 处理 <c>api/imgpack?keys=a,b,c</c>：一次返回多张缩略图的**长度前缀拼接**二进制流。
        /// 为什么要批量：HttpListener 是 HTTP/1.1，浏览器单域最多 6 条连接，
        /// 上百张缩略图必然排队十几轮；批量端点把 N 次往返压成 1 次。
        /// 服务端还会把容器内的条目**按存储偏移顺序**读，磁盘 I/O 从 N 次随机读变成一趟顺序读。
        ///
        /// 响应体格式（全部大端）：
        /// <code>
        /// magic "SIPK" | u32 version | u32 count
        /// 重复 count 次： u16 keyLen | key(UTF-8，相对 assets/ 的路径) | u32 dataLen | data(dataLen 字节 JPEG)
        /// </code>
        /// <c>dataLen == 0</c> 表示该键取不到（源图缺失/解码失败），前端据此画占位底而非报错。
        /// 输出顺序 = 请求顺序，前端可以按下标直接对号入座。
        /// </summary>
        private async Task HandleImgPackRequest(HttpListenerContext context, HttpListenerResponse response)
        {
            if (!_thumbnailsEnabled)
            {
                response.StatusCode = 404;
                return;
            }

            var keys = ImgPackFormat.ParseKeys(context.Request.QueryString["keys"]);
            if (keys.Count == 0)
            {
                response.StatusCode = 400;
                response.StatusDescription = "missing or empty keys";
                return;
            }

            // rel（相对 assets/）→ 缩略图字节；null / 缺键都表示"这一版拿不到"
            var results = new Dictionary<string, byte[]?>(keys.Count, StringComparer.Ordinal);
            var assetsRoot = Path.GetFullPath(Path.Combine(_rootDir, "assets"));
            // assets/cg 一旦分包（即使因密钥错误被锁定），容器就是唯一权威来源 ——
            // 与 BuildCgManifest 的判定保持一致，也避免"包读不到就悄悄回落磁盘散文件"这种弱化 fail-closed 的行为。
            bool cgPackaged = _vfs != null && _vfs.IsPackagedSubdir("assets/cg");

            if (cgPackaged)
            {
                // 1) 容器来源：一次性按存储顺序把源图读出来，读一张、解一张、立刻丢掉源字节
                //    （ReadBatchOrdered 是惰性生成器，所以几百张也不会一次性把源图全灌进内存）
                foreach (var (vrel, srcBytes) in _vfs!.ReadBatchOrdered(keys.Select(rel => "assets/" + rel)))
                {
                    string rel = vrel.Substring("assets/".Length);
                    var key = ContainerThumbKey(rel, vrel, out _);
                    results[rel] = await ResolveThumbnailAsync(key, () => BuildCgThumbnail(srcBytes));
                }
                // 包内不存在 / 读取失败的键：显式标 null（dataLen=0），前端画占位底
                foreach (var rel in keys) if (!results.ContainsKey(rel)) results[rel] = null;
            }
            else
            {
                // 2) 磁盘来源：按路径字典序读（同一目录下的文件在 NTFS 上大致连续）
                foreach (var rel in keys.OrderBy(r => r, StringComparer.Ordinal))
                {
                    results[rel] = null;
                    var diskPath = Path.GetFullPath(Path.Combine(assetsRoot, rel.Replace('/', Path.DirectorySeparatorChar)));
                    if (!PathGuard.IsUnderRoot(diskPath, assetsRoot)) continue;
                    FileInfo fi;
                    try { fi = new FileInfo(diskPath); }
                    catch { continue; }
                    if (!fi.Exists) continue;
                    var key = AssetETag.ThumbKey(rel, fi.LastWriteTimeUtc, fi.Length);
                    string captured = diskPath;
                    results[rel] = await ResolveThumbnailAsync(key, () => BuildCgThumbnail(captured));
                }
            }

            // 3) 组装：输出顺序 = 请求顺序（线格式见 ImgPackFormat）
            var items = new List<(string Key, byte[]? Data)>(keys.Count);
            foreach (var rel in keys)
            {
                items.Add((rel, results.TryGetValue(rel, out var d) ? d : null));
            }
            var payload = ImgPackFormat.Encode(items);

            response.StatusCode = 200;
            response.ContentType = "application/octet-stream";
            response.ContentLength64 = payload.Length;
            // 内容寻址（键里含源资源版本/包戳）：可长期缓存，跨页面复用同一 HTTP 缓存项
            response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
            if (_isDebug)
                Console.WriteLine($"[DEBUG] imgpack {keys.Count} keys → {payload.Length} bytes");
            await response.OutputStream.WriteAsync(payload, 0, payload.Length);
        }

        /// <summary>
        /// 处理角色文件扫描请求
        /// 扫描 assets/chars/ 文件夹，返回文件ID到路径的映射
        /// </summary>
        private async Task HandleScanCharsRequest(HttpListenerResponse response)
        {
            var charFileMap = new Dictionary<string, string>();
            var charPathMap = new Dictionary<string, string>();

            // 扫描 chars 文件夹；assets 已分包时改为从 .sgd 枚举（fail-closed，不读散文件）
            if (_vfs != null && _vfs.IsPackagedSubdir("assets/chars"))
            {
                ScanCharsFromVfs(charFileMap, charPathMap);
            }
            else
            {
                var charsDir = Path.Combine(_rootDir, "assets", "chars");
                if (Directory.Exists(charsDir))
                {
                    // 获取所有角色子文件夹
                    foreach (var roleDir in Directory.GetDirectories(charsDir))
                    {
                        var roleName = Path.GetFileName(roleDir);
                        charPathMap[roleName] = $"assets/chars/{roleName}";

                    // 递归扫描所有图片文件
                    var imageFiles = Directory.GetFiles(roleDir, "*.*", SearchOption.AllDirectories)
                        .Where(f => 
                        {
                            var ext = Path.GetExtension(f).ToLower();
                            return ext is ".png" or ".jpg" or ".jpeg" or ".webp";
                        });

                    foreach (var file in imageFiles)
                    {
                        // 获取相对路径（相对于 _rootDir）
                        var relativePath = file.Substring(_rootDir.Length + 1).Replace('\\', '/');
                        
                        // 生成文件ID：去掉扩展名，保留子路径（用 _ 连接）
                        // 例如：assets/chars/角色A/miyu01/dress1.png → 角色A_miyu01_dress1
                        var fileId = GenerateFileId(roleName, file, roleDir);
                        
                        charFileMap[fileId] = relativePath;
                        
                        // 同时注册裸文件名（不带角色前缀），方便 illustration.js 直接用文件名引用
                        var bareName = Path.GetFileNameWithoutExtension(file);
                        if (!charFileMap.ContainsKey(bareName))
                            charFileMap[bareName] = relativePath;
                    }
                }
            }
            }

            // 构建响应
            var result = new
            {
                success = true,
                charPathMap,
                charFileMap
            };

            var json = System.Text.Json.JsonSerializer.Serialize(result);
            var buffer = System.Text.Encoding.UTF8.GetBytes(json);

            response.StatusCode = 200;
            response.ContentType = "application/json";
            response.ContentLength64 = buffer.Length;

            await response.OutputStream.WriteAsync(buffer, 0, buffer.Length);

            if (_isDebug) Console.WriteLine($"[INFO] Scanned {charFileMap.Count} character files");
        }

        /// <summary>
        /// 从 .sgd 容器枚举 characters 子目录，构建与磁盘扫描同构的 fileId→relPath 映射。
        /// 容器 entry 形如 assets/chars/角色A/miyu01/dress1.png（正斜杠、相对 assets），
        /// 路径拆分规则与 GenerateFileId 保持一致（角色名_子目录_文件名），并注册裸文件名便于直接引用。
        /// </summary>
        private void ScanCharsFromVfs(Dictionary<string, string> charFileMap, Dictionary<string, string> charPathMap)
        {
            const string prefix = "assets/chars/";
            foreach (var entry in _vfs!.Enumerate(prefix))
            {
                string inChars = entry.Substring(prefix.Length); // 角色A/miyu01/dress1.png
                int slash = inChars.IndexOf('/');
                if (slash < 0) continue; // 顶层文件，跳过
                string roleName = inChars.Substring(0, slash);
                charPathMap[roleName] = "assets/chars/" + roleName;

                string within = inChars.Substring(slash + 1); // miyu01/dress1.png
                var ext = Path.GetExtension(within).ToLowerInvariant();
                if (ext is not (".png" or ".jpg" or ".jpeg" or ".webp")) continue;

                string withinDir = Path.GetDirectoryName(within) ?? "";
                string fileName = Path.GetFileNameWithoutExtension(within);
                // 例如：角色A_miyu01_dress1；无子目录时降级为 角色A_dress1
                string fileId = string.IsNullOrEmpty(withinDir)
                    ? $"{roleName}_{fileName}"
                    : $"{roleName}_{withinDir.Replace('/', '_')}_{fileName}";

                charFileMap[fileId] = entry;
                // 同时注册裸文件名（不带角色前缀），方便 illustration.js 直接用文件名引用
                if (!charFileMap.ContainsKey(fileName))
                    charFileMap[fileName] = entry;
            }
            if (_isDebug) Console.WriteLine($"[INFO] Scanned (vfs) {charFileMap.Count} character files");
        }

        private async Task HandleDslApiRequest(HttpListenerContext context, string method)
        {
            var request = context.Request;
            var response = context.Response;
            var argsJson = "{}";
            if (string.Equals(request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase)
                || string.Equals(request.HttpMethod, "PUT", StringComparison.OrdinalIgnoreCase))
            {
                using var reader = new StreamReader(request.InputStream, request.ContentEncoding ?? Encoding.UTF8);
                var body = await reader.ReadToEndAsync();
                if (body.Length > 2 * 1024 * 1024)
                {
                    var tooLarge = Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"payload too large\"}");
                    response.StatusCode = 200;
                    response.ContentType = "application/json; charset=utf-8";
                    response.ContentLength64 = tooLarge.Length;
                    await response.OutputStream.WriteAsync(tooLarge, 0, tooLarge.Length);
                    return;
                }
                if (!string.IsNullOrWhiteSpace(body)) argsJson = body;
            }
            else if (string.Equals(method, "readFile", StringComparison.OrdinalIgnoreCase))
            {
                var pathArg = QueryValue(request.Url?.Query, "path");
                argsJson = JsonSerializer.Serialize(new { path = pathArg });
            }

            var json = Dsl.Invoke(method, argsJson);
            var buffer = Encoding.UTF8.GetBytes(json);
            response.StatusCode = 200;
            response.ContentType = "application/json; charset=utf-8";
            response.ContentLength64 = buffer.Length;
            await response.OutputStream.WriteAsync(buffer, 0, buffer.Length);
        }

        private static string QueryValue(string? query, string key)
        {
            if (string.IsNullOrEmpty(query)) return "";
            var q = query.TrimStart('?');
            foreach (var part in q.Split('&'))
            {
                var eq = part.IndexOf('=');
                if (eq < 0) continue;
                var k = Uri.UnescapeDataString(part.Substring(0, eq));
                if (!k.Equals(key, StringComparison.OrdinalIgnoreCase)) continue;
                return Uri.UnescapeDataString(part.Substring(eq + 1));
            }
            return "";
        }





        
        /// <summary>
        /// 生成文件ID
        /// 格式：角色名_子路径_文件名（不含扩展名）
        /// </summary>
        private string GenerateFileId(string roleName, string filePath, string roleDir)
        {
            // 获取相对于角色文件夹的路径
            var relativePath = filePath.Substring(roleDir.Length + 1);
            var fileName = Path.GetFileNameWithoutExtension(relativePath);
            var directoryPath = Path.GetDirectoryName(relativePath);

            // 组合ID：角色名_子文件夹_文件名
            if (string.IsNullOrEmpty(directoryPath))
            {
                return $"{roleName}_{fileName}";
            }
            else
            {
                // 将子文件夹路径中的分隔符替换为 _
                var dirPart = directoryPath.Replace('\\', '_').Replace('/', '_');
                return $"{roleName}_{dirPart}_{fileName}";
            }
        }
    }
}
