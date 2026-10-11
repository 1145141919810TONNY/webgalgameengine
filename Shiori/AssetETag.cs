// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 静态资源 ETag / If-None-Match 支持（OPT S5.2）。
// 依据源文件的最后写入时间与字节长度生成弱校验用的 ETag 字符串，
// 用于 /assets 图片的 304 协商缓存；缩略图缓存键同时纳入源文件 mtime、
// 长度与缩略图宽度，保证源文件变化或尺寸切换时缓存自动失效。

using System;
using System.Globalization;

namespace ShioriCSharp;

/// <summary>
/// 静态资源 ETag 生成与协商缓存判定工具。
/// 提供从文件元数据构造 ETag、解析 If-None-Match 请求头，
/// 以及构造缩略图缓存键的静态方法。
/// </summary>
public static class AssetETag
{
    /// <summary>缩略图的标准宽度（像素），作为 <see cref="ThumbKey"/> 的默认宽度参数。</summary>
    public const int ThumbWidth = 256;

    /// <summary>
    /// 根据文件的最后写入时间与字节长度生成 ETag 字符串。
    /// </summary>
    /// <param name="lastWriteUtc">文件最后写入时间（不要求已是 UTC，内部会统一转换）。</param>
    /// <param name="length">文件字节长度。</param>
    /// <returns>形如 <c>"&lt;毫秒tick-xhex&gt;-&lt;长度hex&gt;"</c> 的带双引号 ETag 值。</returns>
    /// <remarks>采用十六进制表示以缩短字符串长度；不含 W/ 前缀，属于强校验器语义。</remarks>
    public static string FromFile(DateTime lastWriteUtc, long length)
    {
        var ticks = lastWriteUtc.ToUniversalTime().Ticks.ToString("x", CultureInfo.InvariantCulture);
        var len = length.ToString("x", CultureInfo.InvariantCulture);
        return "\"" + ticks + "-" + len + "\"";
    }

    /// <summary>
    /// 判断请求头 If-None-Match 是否命中给定 ETag，从而可返回 304。
    /// </summary>
    /// <param name="header">If-None-Match 请求头原始值，可为 null/空白。</param>
    /// <param name="etag">服务端为资源生成的 ETag。</param>
    /// <returns>命中返回 true；etag 为空或请求头为空/空白时返回 false。</returns>
    /// <remarks>
    /// 支持以逗号分隔的多个候选值、通配符 <c>*</c>，
    /// 以及弱校验前缀 <c>W/</c>（比对时被剥离，与强 ETag 一并按序数相等比较）。
    /// </remarks>
    public static bool IfNoneMatch(string? header, string etag)
    {
        if (string.IsNullOrEmpty(etag) || string.IsNullOrWhiteSpace(header))
            return false;
        var raw = header.Trim();
        // 通配符：任何缓存副本均可视为命中
        if (raw == "*")
            return true;
        // 逐个候选值比对，剥离弱校验前缀后做序号（Ordinal）相等判断
        foreach (var part in raw.Split(','))
        {
            var t = part.Trim();
            if (t.StartsWith("W/", StringComparison.OrdinalIgnoreCase))
                t = t.Substring(2).Trim();
            if (string.Equals(t, etag, StringComparison.Ordinal))
                return true;
        }
        return false;
    }

    /// <summary>
    /// 构造缩略图缓存的唯一键。
    /// </summary>
    /// <param name="rel">相对资源路径，反斜杠会被规范化为正斜杠；null 视为空串。</param>
    /// <param name="lastWriteUtc">源文件最后写入时间。</param>
    /// <param name="length">源文件字节长度。</param>
    /// <param name="width">缩略图宽度，默认 <see cref="ThumbWidth"/>。</param>
    /// <returns>由路径、UTC tick、长度、宽度构成的管道分隔键。</returns>
    /// <remarks>键中包含源文件元数据，源文件更新或宽度变化时会自然失效，避免脏缓存。</remarks>
    public static string ThumbKey(string rel, DateTime lastWriteUtc, long length, int width = ThumbWidth)
    {
        rel = (rel ?? "").Replace('\\', '/');
        return rel
            + "|" + lastWriteUtc.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture)
            + "|" + length.ToString(CultureInfo.InvariantCulture)
            + "|" + width.ToString(CultureInfo.InvariantCulture);
    }
}

/// <summary>
/// 图片缓存 HTTP 策略：决定哪些图片响应可携带 ETag 以及是否允许返回 304。
/// </summary>
/// <remarks>
/// 背景：/assets 原图永不发 ETag、永不 304。原因在于 WebView2 进程重启后，
/// 若内存缓存为空而服务器对 CSS background-image 返回带空响应体的 304，
/// 图片将无法绘制；且一次失败的 CSS 加载会剔除磁盘缓存项，导致下次启动
/// 退化为 200。最终表现为「100% 失败 → 成功 → 失败」的交替现象。
/// 而 /cg-thumb 通过 img.src 加载，可安全使用 304 协商。
/// </remarks>
public static class ImageCachePolicy
{
    /// <summary>
    /// 判断某次响应是否应携带 ETag。
    /// </summary>
    /// <param name="isThumbnail">该资源是否为缩略图（/cg-thumb）。</param>
    /// <returns>仅缩略图返回 true，原图始终返回 false。</returns>
    public static bool SendETag(bool isThumbnail) => isThumbnail;

    /// <summary>
    /// 判断当前请求是否可回复 304 Not Modified。
    /// </summary>
    /// <param name="isThumbnail">该资源是否为缩略图。</param>
    /// <param name="ifNoneMatch">客户端 If-None-Match 是否命中。</param>
    /// <returns>仅当资源是缩略图且协商命中时返回 true，否则返回 false（走完整 200 响应）。</returns>
    public static bool ShouldNotModified(bool isThumbnail, bool ifNoneMatch) =>
        isThumbnail && ifNoneMatch;
}
