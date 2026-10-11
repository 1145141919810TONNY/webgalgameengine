// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 文件说明：预合成立绘帧的查询参数解析与缓存键生成。
// 定义 CharFrameSpec（服装/表情/偏移/缩放/舞台尺寸的不可变帧规格）与 CharFrameKey 工具类，
// 提供资源路径规范化与目录穿越防护、图片文件解析、参数严格校验、缓存键与 ETag 计算，
// 供预合成渲染管线判定帧是否命中缓存。

using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace ShioriCSharp;

/// <summary>
/// 预合成立绘帧的不可变规格。
/// 记录服装图与表情图的相对路径、叠加偏移、表情缩放、舞台尺寸与整体基础缩放；
/// 所有字段完全一致即视为同一帧，用于预合成结果的缓存命中判定。
/// </summary>
public readonly struct CharFrameSpec
{
    /// <summary>构造帧规格并固化各字段（构造后不可变）。</summary>
    /// <param name="dressRel">服装图相对 assets 根目录的规范化路径。</param>
    /// <param name="faceRel">表情图相对 assets 根目录的规范化路径。</param>
    /// <param name="offsetX">表情相对服装的水平偏移（DIP）。</param>
    /// <param name="offsetY">表情相对服装的垂直偏移（DIP）。</param>
    /// <param name="faceScale">表情叠加缩放系数，1 为原始大小。</param>
    /// <param name="stageW">舞台（合成画布）宽度（像素）。</param>
    /// <param name="stageH">舞台（合成画布）高度（像素）。</param>
    /// <param name="baseScale">整体基础缩放系数。</param>
    public CharFrameSpec(
        string dressRel, string faceRel,
        double offsetX, double offsetY, double faceScale,
        int stageW, int stageH, double baseScale)
    {
        DressRel = dressRel;
        FaceRel = faceRel;
        OffsetX = offsetX;
        OffsetY = offsetY;
        FaceScale = faceScale;
        StageW = stageW;
        StageH = stageH;
        BaseScale = baseScale;
    }

    /// <summary>服装图相对路径（已规范化，正斜杠分隔）。</summary>
    public string DressRel { get; }
    /// <summary>表情图相对路径（已规范化，正斜杠分隔）。</summary>
    public string FaceRel { get; }
    /// <summary>表情相对服装的水平偏移（DIP）。</summary>
    public double OffsetX { get; }
    /// <summary>表情相对服装的垂直偏移（DIP）。</summary>
    public double OffsetY { get; }
    /// <summary>表情叠加缩放系数。</summary>
    public double FaceScale { get; }
    /// <summary>舞台宽度（像素）。</summary>
    public int StageW { get; }
    /// <summary>舞台高度（像素）。</summary>
    public int StageH { get; }
    /// <summary>整体基础缩放系数。</summary>
    public double BaseScale { get; }
}

/// <summary>
/// 立绘帧查询的解析、校验与缓存键工具类。
/// 全部为无状态纯函数，可安全地在任意线程并发调用。
/// </summary>
public static class CharFrameKey
{
    /// <summary>舞台单边最大像素数；超出视为非法请求，防止超大位图耗尽内存。</summary>
    public const int MaxStagePx = 8192;
    /// <summary>偏移量绝对值上限；超出视为非法请求。</summary>
    public const double MaxAbsOffset = 1000;
    /// <summary>缩放系数上限；防止极端缩放产生超大合成图。</summary>
    public const double MaxScale = 8;
    /// <summary>单张源图解码后允许的最大像素总数（16 兆像素）。</summary>
    public const int MaxDecodedPixels = 16_000_000;
    /// <summary>单张源图文件大小上限（32 MB）。</summary>
    public const long MaxSourceBytes = 32L * 1024 * 1024;

    /// <summary>
    /// 将外部传入的原始资源路径规范化为 assets 根目录下的相对路径。
    /// 规则：接受 "assets/..."、"/assets/..." 或直接相对路径，统一去除前缀与多余斜杠；
    /// 拒绝根斜杠路径、Windows 盘符路径、绝对路径以及含 "." / ".." 段的路径（防目录穿越）。
    /// </summary>
    /// <param name="raw">原始路径字符串，可为 null。</param>
    /// <param name="rel">输出规范化后的相对路径（正斜杠分隔）；失败时为空字符串。</param>
    /// <returns>规范化成功返回 true；路径为空或非法返回 false。</returns>
    public static bool TryNormalizeRel(string? raw, out string rel)
    {
        rel = "";
        if (string.IsNullOrWhiteSpace(raw))
            return false;
        // 统一分隔符为 '/'，并剥掉可选的 assets/ 前缀。
        var s = raw.Trim().Replace('\\', '/');
        if (s.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase))
            s = s.Substring("/assets/".Length);
        else if (s.StartsWith("assets/", StringComparison.OrdinalIgnoreCase))
            s = s.Substring("assets/".Length);
        else if (s.StartsWith('/'))
            return false;
        s = s.TrimStart('/');
        if (s.Length == 0)
            return false;
        if (s.Length >= 2 && s[1] == ':')
            return false;
        var asOs = s.Replace('/', Path.DirectorySeparatorChar);
        if (Path.IsPathRooted(asOs))
            return false;
        // 逐段检查：拒绝 "." / ".." 等相对段，杜绝目录穿越。
        var parts = s.Split('/', StringSplitOptions.RemoveEmptyEntries);
        foreach (var p in parts)
        {
            if (p is "." or "..")
                return false;
        }
        rel = string.Join("/", parts);
        return rel.Length > 0;
    }

    /// <summary>相对路径无扩展名时依次尝试补全的图片扩展名（小写）。</summary>
    private static readonly string[] ImageFallbackExts =
        { ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp" };

    /// <summary>
    /// 将原始相对路径解析为 assets 根目录下实际存在的图片全路径。
    /// 先按原样（已含扩展名）尝试；若路径无扩展名，再按 <see cref="ImageFallbackExts"/> 顺序补全尝试。
    /// </summary>
    /// <param name="assetsRoot">assets 根目录路径。</param>
    /// <param name="rel">原始相对路径（内部会先经 <see cref="TryNormalizeRel"/> 规范化）。</param>
    /// <param name="fullPath">输出命中的图片文件全路径；失败时为空字符串。</param>
    /// <returns>找到受支持的图片文件返回 true；否则 false。</returns>
    public static bool TryResolveImage(string assetsRoot, string? rel, out string fullPath)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(assetsRoot) || !TryNormalizeRel(rel, out var n))
            return false;
        string root;
        try { root = Path.GetFullPath(assetsRoot); }
        catch (ArgumentException) { return false; }
        catch (NotSupportedException) { return false; }
        catch (PathTooLongException) { return false; }

        if (TryCandidate(root, n, out fullPath))
            return true;
        if (Path.GetExtension(n).Length > 0)
            return false;
        foreach (var ext in ImageFallbackExts)
        {
            if (TryCandidate(root, n + ext, out fullPath))
                return true;
        }
        return false;
    }

    /// <summary>
    /// 尝试单个候选文件：与根目录拼接后校验结果仍位于根目录之内（防拼接穿越），
    /// 且文件确实存在、扩展名属于受支持的图片类型。
    /// </summary>
    /// <param name="root">assets 根目录（已规范化为全路径）。</param>
    /// <param name="relative">相对路径（正斜杠分隔）。</param>
    /// <param name="hit">输出命中文件的全路径。</param>
    /// <returns>候选合法且存在返回 true。</returns>
    private static bool TryCandidate(string root, string relative, out string hit)
    {
        hit = "";
        string cand;
        try
        {
            cand = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        }
        catch (ArgumentException) { return false; }
        catch (NotSupportedException) { return false; }
        catch (PathTooLongException) { return false; }

        var rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        if (!cand.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(Path.GetFullPath(root), cand, StringComparison.OrdinalIgnoreCase))
            return false;
        if (!File.Exists(cand))
            return false;
        var ext = Path.GetExtension(cand);
        foreach (var e in ImageFallbackExts)
        {
            if (e.Equals(ext, StringComparison.OrdinalIgnoreCase))
            {
                hit = cand;
                return true;
            }
        }
        return false;
    }

    /// <summary>
    /// 解析并严格校验一次预合成帧请求的全部字符串参数。
    /// 舞台尺寸为必填且有上限；偏移与缩放为可选（缺省 0 / 1）且必须为有限值并落在界内，
    /// 保证进入渲染管线的规格始终合法，杜绝恶意参数触发超大位图合成。
    /// </summary>
    /// <param name="dress">服装图路径（必填，需规范化成功）。</param>
    /// <param name="face">表情图路径（必填，需规范化成功）。</param>
    /// <param name="ox">X 偏移字符串（可空，缺省 0）。</param>
    /// <param name="oy">Y 偏移字符串（可空，缺省 0）。</param>
    /// <param name="fs">表情缩放字符串（可空，缺省 1）。</param>
    /// <param name="sw">舞台宽字符串（必填，正整数且 ≤ <see cref="MaxStagePx"/>）。</param>
    /// <param name="sh">舞台高字符串（必填，正整数且 ≤ <see cref="MaxStagePx"/>）。</param>
    /// <param name="bs">基础缩放字符串（可空，缺省 1）。</param>
    /// <param name="spec">输出解析成功后的帧规格。</param>
    /// <returns>全部参数合法返回 true；任一失败返回 false（spec 为 default）。</returns>
    public static bool TryParse(
        string? dress, string? face,
        string? ox, string? oy, string? fs,
        string? sw, string? sh, string? bs,
        out CharFrameSpec spec)
    {
        spec = default;
        if (!TryNormalizeRel(dress, out var dressRel))
            return false;
        if (!TryNormalizeRel(face, out var faceRel))
            return false;
        if (!int.TryParse(sw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var stageW)
            || stageW <= 0 || stageW > MaxStagePx)
            return false;
        if (!int.TryParse(sh, NumberStyles.Integer, CultureInfo.InvariantCulture, out var stageH)
            || stageH <= 0 || stageH > MaxStagePx)
            return false;
        if (!TryFinite(ox, 0, out var offsetX) || Math.Abs(offsetX) > MaxAbsOffset)
            return false;
        if (!TryFinite(oy, 0, out var offsetY) || Math.Abs(offsetY) > MaxAbsOffset)
            return false;
        if (!TryFinite(fs, 1, out var faceScale) || !(faceScale > 0) || faceScale > MaxScale)
            return false;
        if (!TryFinite(bs, 1, out var baseScale) || !(baseScale > 0) || baseScale > MaxScale)
            return false;
        spec = new CharFrameSpec(dressRel, faceRel, offsetX, offsetY, faceScale, stageW, stageH, baseScale);
        return true;
    }

    /// <summary>
    /// 由帧规格与两张源图的文件身份（最后写入时间 + 字节长度）构造缓存键。
    /// 源文件时间戳或大小一旦变化即产生不同的键，实现内容变化后的自动缓存失效。
    /// 浮点统一使用 G17 往返格式、数字统一 InvariantCulture，保证跨区域设置键值稳定。
    /// </summary>
    /// <param name="spec">帧规格。</param>
    /// <param name="dressWriteUtc">服装图最后写入时间（UTC）。</param>
    /// <param name="dressLen">服装图字节长度。</param>
    /// <param name="faceWriteUtc">表情图最后写入时间（UTC）。</param>
    /// <param name="faceLen">表情图字节长度。</param>
    /// <returns>竖线分隔的缓存键字符串。</returns>
    public static string CacheKey(
        CharFrameSpec spec,
        DateTime dressWriteUtc, long dressLen,
        DateTime faceWriteUtc, long faceLen)
    {
        var inv = CultureInfo.InvariantCulture;
        return spec.DressRel.Replace('\\', '/')
            + "|" + spec.FaceRel.Replace('\\', '/')
            + "|" + spec.OffsetX.ToString("G17", inv)
            + "|" + spec.OffsetY.ToString("G17", inv)
            + "|" + spec.FaceScale.ToString("G17", inv)
            + "|" + spec.StageW.ToString(inv)
            + "|" + spec.StageH.ToString(inv)
            + "|" + spec.BaseScale.ToString("G17", inv)
            + "|" + dressWriteUtc.ToUniversalTime().Ticks.ToString(inv)
            + "|" + dressLen.ToString(inv)
            + "|" + faceWriteUtc.ToUniversalTime().Ticks.ToString(inv)
            + "|" + faceLen.ToString(inv);
    }

    /// <summary>
    /// 将缓存键哈希为 HTTP 风格 ETag（SHA-256 十六进制小写、外层带双引号），
    /// 供 WebView2 侧 If-None-Match 协商缓存使用。
    /// </summary>
    /// <param name="cacheKey">缓存键（null 视为空串）。</param>
    /// <returns>形如 "a1b2..." 的带引号 ETag 字符串。</returns>
    public static string ETag(string cacheKey)
    {
        var bytes = Encoding.UTF8.GetBytes(cacheKey ?? "");
        var hash = SHA256.HashData(bytes);
        return "\"" + Convert.ToHexString(hash).ToLowerInvariant() + "\"";
    }

    /// <summary>
    /// 解析可选 double 参数：空/空白视为缺省并直接通过；
    /// 非空则必须按 InvariantCulture 解析成功且为有限值（拒绝 NaN / Infinity）。
    /// </summary>
    /// <param name="raw">原始字符串。</param>
    /// <param name="fallback">缺省值。</param>
    /// <param name="v">输出解析值；缺省时为 fallback。</param>
    /// <returns>缺省或解析为有限值返回 true；否则 false。</returns>
    private static bool TryFinite(string? raw, double fallback, out double v)
    {
        v = fallback;
        if (string.IsNullOrWhiteSpace(raw))
            return true;
        if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out v))
            return false;
        return double.IsFinite(v);
    }
}

/// <summary>
/// 预合成帧缓存容量策略辅助类。
/// </summary>
public static class CharFrameCache
{
    /// <summary>
    /// 依据渲染配置计算帧缓存容量上限：
    /// 启用时取 <see cref="ByteLruCache.DefaultLimitBytes"/>，禁用时为 0（等效关闭缓存）。
    /// </summary>
    /// <param name="frameCacheEnabled">帧缓存是否启用。</param>
    /// <returns>缓存容量字节数。</returns>
    public static long LimitBytes(bool frameCacheEnabled) =>
        frameCacheEnabled ? ByteLruCache.DefaultLimitBytes : 0;
}
