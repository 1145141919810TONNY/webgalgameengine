// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 文件说明：渲染配置骨架（render_profile.json 的内存模型）。
// 定义磁盘缓存 / 硬件加速 / 缩略图 / 帧缓存 / 立绘渲染器 / 布局模式六维正交配置，
// 以不可变 record + With* 方法实现安全更新，并提供 JSON 持久化与 WebView2 启动参数生成。

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ShioriCSharp;

/// <summary>磁盘缓存容量档位（对应 WebView2 的 disk-cache-size）。</summary>
public enum DiskCacheSize
{
    /// <summary>1 MB（默认，磁盘占用最小）。</summary>
    Mb1,
    /// <summary>256 MB。</summary>
    Mb256,
    /// <summary>1 GB。</summary>
    Gb1
}

/// <summary>硬件加速模式档位（映射到 WebView2/Chromium 的 GPU 相关开关）。</summary>
public enum HardwareAccelMode
{
    /// <summary>跟随系统默认行为。</summary>
    Default,
    /// <summary>强制 GPU 光栅化（忽略 GPU 黑名单）。</summary>
    ForceGpu,
    /// <summary>强制软件渲染，仅用于故障诊断。</summary>
    ForceSoftware
}

/// <summary>立绘渲染器实现方式。</summary>
public enum CharRendererMode
{
    /// <summary>DOM 分层叠加（既有方案）。</summary>
    Dom,
    /// <summary>预合成为单张位图。</summary>
    Precomposed,
    /// <summary>Canvas 舞台绘制。</summary>
    Canvas,
    /// <summary>由引擎按设备能力自动选择。</summary>
    Auto
}

/// <summary>正文布局模式。</summary>
public enum LayoutMode
{
    /// <summary>流式布局（内容随窗口自然流动）。</summary>
    Flow,
    /// <summary>等比画布（固定纵横比画布，整体缩放适配窗口）。</summary>
    UniformCanvas
}

/// <summary>渲染配置的变更维度，用于向宿主精确描述“哪一项”发生了变化。</summary>
public enum RenderChangeKind
{
    /// <summary>磁盘缓存容量变化。</summary>
    DiskCache,
    /// <summary>硬件加速模式变化。</summary>
    HardwareAccel,
    /// <summary>图像缩略图开关变化。</summary>
    Thumbnails,
    /// <summary>帧缓存开关变化。</summary>
    FrameCache,
    /// <summary>立绘渲染器变化。</summary>
    CharRenderer,
    /// <summary>布局模式变化。</summary>
    LayoutMode
}

/// <summary>
/// <see cref="RenderChangeKind"/> 的便捷扩展：判定某类变更生效所需的动作级别。
/// </summary>
public static class RenderChangeKindExtensions
{
    /// <summary>
    /// 该变更是否需要重启引擎进程才能生效
    /// （磁盘缓存、硬件加速、帧缓存均固化在 WebView2 启动参数中，运行期无法热改）。
    /// </summary>
    /// <param name="kind">变更维度。</param>
    /// <returns>需要重启返回 true。</returns>
    public static bool NeedsRestart(this RenderChangeKind kind) =>
        kind is RenderChangeKind.DiskCache
            or RenderChangeKind.HardwareAccel
            or RenderChangeKind.FrameCache;

    /// <summary>
    /// 该变更是否只需重载页面/立绘即可生效（渲染器切换无需重启进程）。
    /// </summary>
    /// <param name="kind">变更维度。</param>
    /// <returns>需要重载返回 true。</returns>
    public static bool NeedsReload(this RenderChangeKind kind) =>
        kind == RenderChangeKind.CharRenderer;
}

/// <summary>
/// 渲染配置的不可变快照（sealed record + init 属性）。
/// 任何修改都通过 With* 方法派生新实例，避免多处共享同一可变状态引发竞态；
/// 通过 <see cref="Load"/> / <see cref="Save"/> 与 render_profile.json 互转，
/// 并可经 <see cref="BrowserArgs"/> 生成 WebView2 启动参数。
/// </summary>
public sealed record RenderProfile
{
    /// <summary>
    /// JSON 序列化选项：缩进输出、属性名忽略大小写、枚举仅接受字符串形式
    /// （拒绝数字枚举值，防止配置文件出现无意义的整数枚举）。
    /// </summary>
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(allowIntegerValues: false) }
    };

    /// <summary>出厂默认配置（全部维度取缺省值）。</summary>
    public static RenderProfile Default { get; } = new();

    /// <summary>磁盘缓存容量档位，默认 1 MB。</summary>
    public DiskCacheSize DiskCache { get; init; } = DiskCacheSize.Mb1;
    /// <summary>硬件加速模式，默认跟随系统。</summary>
    public HardwareAccelMode HardwareAccel { get; init; } = HardwareAccelMode.Default;
    /// <summary>是否生成图像缩略图，默认开启。</summary>
    public bool Thumbnails { get; init; } = true;
    /// <summary>是否启用预合成帧缓存，默认关闭。</summary>
    public bool FrameCache { get; init; } = false;
    /// <summary>立绘渲染器实现，默认 DOM 分层。</summary>
    public CharRendererMode CharRenderer { get; init; } = CharRendererMode.Dom;
    /// <summary>正文布局模式，默认流式。</summary>
    public LayoutMode LayoutMode { get; init; } = LayoutMode.Flow;

    /// <summary>上次关闭时窗口宽度（DIP）。默认与 MainWindow.xaml 初始值一致。</summary>
    public double WindowWidth { get; init; } = 1280;

    /// <summary>上次关闭时窗口高度（DIP）。默认与 MainWindow.xaml 初始值一致。</summary>
    public double WindowHeight { get; init; } = 720;

    /// <summary>上次关闭时窗口是否最大化。</summary>
    public bool WindowMaximized { get; init; } = false;

    /// <summary>上次关闭时是否独占全屏（F11）。</summary>
    public bool WindowFullScreen { get; init; } = false;

    /// <summary>
    /// 派生仅更新窗口几何信息的新配置（关窗时保存窗口状态用）。
    /// </summary>
    /// <param name="width">窗口宽度（DIP）。</param>
    /// <param name="height">窗口高度（DIP）。</param>
    /// <param name="maximized">是否最大化。</param>
    /// <param name="fullScreen">是否独占全屏（F11）。</param>
    /// <returns>仅窗口字段更新的新实例。</returns>
    public RenderProfile WithWindowSize(double width, double height, bool maximized = false, bool fullScreen = false) =>
        this with { WindowWidth = width, WindowHeight = height, WindowMaximized = maximized, WindowFullScreen = fullScreen };

    /// <summary>
    /// 磁盘缓存档位对应的字节数（1 MB / 256 MB / 1 GB）。
    /// 不参与 JSON 序列化，由 <see cref="DiskCache"/> 档位即时换算。
    /// </summary>
    [JsonIgnore]
    public long DiskCacheBytes => DiskCache switch
    {
        DiskCacheSize.Mb256 => 268435456L,
        DiskCacheSize.Gb1 => 1073741824L,
        _ => 1048576L
    };

    // ── 各维度 With* 派生方法：仅替换对应字段，其余保持不变（不可变更新） ──

    /// <summary>派生更新磁盘缓存档位的新配置。</summary>
    /// <param name="value">新档位。</param>
    /// <returns>新实例。</returns>
    public RenderProfile WithDiskCache(DiskCacheSize value) => this with { DiskCache = value };
    /// <summary>派生更新硬件加速模式的新配置。</summary>
    /// <param name="value">新模式。</param>
    /// <returns>新实例。</returns>
    public RenderProfile WithHardwareAccel(HardwareAccelMode value) => this with { HardwareAccel = value };
    /// <summary>派生更新缩略图开关的新配置。</summary>
    /// <param name="value">新开关值。</param>
    /// <returns>新实例。</returns>
    public RenderProfile WithThumbnails(bool value) => this with { Thumbnails = value };
    /// <summary>派生更新帧缓存开关的新配置。</summary>
    /// <param name="value">新开关值。</param>
    /// <returns>新实例。</returns>
    public RenderProfile WithFrameCache(bool value) => this with { FrameCache = value };
    /// <summary>派生更新立绘渲染器的新配置。</summary>
    /// <param name="value">新渲染器。</param>
    /// <returns>新实例。</returns>
    public RenderProfile WithCharRenderer(CharRendererMode value) => this with { CharRenderer = value };
    /// <summary>派生更新布局模式的新配置。</summary>
    /// <param name="value">新模式。</param>
    /// <returns>新实例。</returns>
    public RenderProfile WithLayoutMode(LayoutMode value) => this with { LayoutMode = value };

    /// <summary>
    /// 从 JSON 文件加载配置。
    /// 任何异常情况（文件缺失、JSON 损坏、IO 失败、无权限、枚举值越界）
    /// 均静默回退到 <see cref="Default"/>，保证启动永远能拿到一份可用配置。
    /// </summary>
    /// <param name="path">配置文件路径（通常为 render_profile.json）。</param>
    /// <returns>加载成功返回文件内容；任何失败返回默认配置。</returns>
    public static RenderProfile Load(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return Default;
        try
        {
            var loaded = JsonSerializer.Deserialize<RenderProfile>(File.ReadAllText(path), JsonOpts);
            if (loaded == null)
                return Default;
            // 枚举值越界（手改配置出现未知字符串）时整体回退默认，
            // 避免半新半旧的混合配置进入运行期。
            if (!Enum.IsDefined(loaded.DiskCache)
                || !Enum.IsDefined(loaded.HardwareAccel)
                || !Enum.IsDefined(loaded.CharRenderer)
                || !Enum.IsDefined(loaded.LayoutMode))
                return Default;
            return loaded;
        }
        catch (JsonException)
        {
            return Default;
        }
        catch (IOException)
        {
            return Default;
        }
        catch (UnauthorizedAccessException)
        {
            return Default;
        }
    }

    /// <summary>
    /// 将当前配置写入 JSON 文件。
    /// 采用“先写临时文件再原子替换”策略，防止写入中途崩溃/断电留下半截配置。
    /// 副作用：会按需创建父目录，并在同目录短暂产生 .tmp 文件。
    /// </summary>
    /// <param name="path">目标配置文件路径。</param>
    /// <exception cref="ArgumentException">path 为空或空白。</exception>
    public void Save(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("path required", nameof(path));
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);
        var json = JsonSerializer.Serialize(this, JsonOpts);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, json);
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>
    /// 生成本配置对应的 WebView2（Chromium）启动参数。
    /// 磁盘缓存大小始终输出；硬件加速仅在显式选择 GPU / 软件时追加对应开关，
    /// 默认模式不附加任何参数以跟随系统行为。
    /// 这些参数在浏览器进程创建时固定，因此对应维度的变更需要重启生效。
    /// </summary>
    /// <returns>命令行参数列表（不含程序名）。</returns>
    public IReadOnlyList<string> BrowserArgs()
    {
        var args = new List<string>
        {
            "--disk-cache-size=" + DiskCacheBytes.ToString(System.Globalization.CultureInfo.InvariantCulture)
        };
        switch (HardwareAccel)
        {
            case HardwareAccelMode.ForceGpu:
                args.Add("--ignore-gpu-blocklist");
                args.Add("--enable-gpu-rasterization");
                args.Add("--enable-zero-copy");
                break;
            case HardwareAccelMode.ForceSoftware:
                args.Add("--disable-gpu");
                args.Add("--disable-gpu-compositing");
                break;
        }
        return args;
    }
}
