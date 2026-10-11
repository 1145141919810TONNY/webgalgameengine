// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// HTTP 服务端辅助工具：客户端断开识别与 HTTP Range 请求解析。
// WebView2 在播放媒体时频繁 abort／重探 Range，写入响应常抛 Win32 64
// 「指定的网络名不再可用」，这属于正常路径，不应记作 500，也不能重复 Close。

using System.Net;

namespace ShioriCSharp;

/// <summary>
/// 识别 <see cref="HttpListener"/> 在写响应阶段遇到的「客户端已断开」类异常。
/// </summary>
/// <remarks>
/// 浏览器主动 abort 连接或对媒体重新发起 Range 探测时，服务端写响应会失败。
/// 这是可预期的正常流程，调用方据此跳过错误日志与重复释放即可。
/// </remarks>
public static class HttpListenerAbort
{
    /// <summary>
    /// 判断异常链中是否存在「客户端断开」特征（错误码或消息文本）。
    /// </summary>
    /// <param name="ex">待检查的异常，可为 null。</param>
    /// <returns>确认为客户端断开返回 true，否则 false。</returns>
    /// <remarks>
    /// 遍历 InnerException 链，任一层的 <see cref="HttpListenerException.ErrorCode"/>
    /// 命中已知断连码，或消息文本包含中英文断连提示，即判定为断开。
    /// </remarks>
    public static bool IsClientAbort(Exception? ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            // 优先依据 Win32 错误码判断，避免受本地化消息差异影响
            if (e is HttpListenerException hle && IsAbortCode(hle.ErrorCode))
                return true;
            // 兜底：错误码缺失（如包装异常）时按消息文本匹配
            var msg = e.Message;
            if (!string.IsNullOrEmpty(msg)
                && (msg.Contains("指定的网络名不再可用", StringComparison.Ordinal)
                    || msg.Contains("network name is no longer available", StringComparison.OrdinalIgnoreCase)
                    || msg.Contains("connection was aborted", StringComparison.OrdinalIgnoreCase)))
                return true;
        }

        return false;
    }

    /// <summary>
    /// 判断 Win32 错误码是否属于客户端断连。
    /// </summary>
    /// <param name="code">错误码。</param>
    /// <returns>命中 64（网络名不可用）、1229、995（IO 已中止）、1236（连接被本机中止）返回 true。</returns>
    private static bool IsAbortCode(int code) =>
        code is 64 or 1229 or 995 or 1236;
}

/// <summary>
/// HTTP Range 请求解析工具，主要用于媒体文件的断点/分段请求。
/// </summary>
public static class ByteRange
{
    /// <summary>
    /// 判断扩展名是否为需要 Range 支持的媒体类型。
    /// </summary>
    /// <param name="ext">含点号的扩展名（如 ".mp4"），大小写不敏感。</param>
    /// <returns>属于视频/音频扩展名返回 true，否则 false。</returns>
    public static bool IsMediaExtension(string? ext)
    {
        if (string.IsNullOrEmpty(ext)) return false;
        return ext.ToLowerInvariant() is ".mp4" or ".webm" or ".mov"
            or ".ogg" or ".mp3" or ".wav" or ".m4a" or ".flac";
    }

    /// <summary>
    /// 解析 Range 请求头为可用的字节区间。
    /// </summary>
    /// <param name="header">Range 头原始值，形如 <c>bytes=0-1023</c>；可为 null。</param>
    /// <param name="fileSize">文件总字节数，用于夹紧区间上界。</param>
    /// <param name="start">输出：区间起始字节（含）。</param>
    /// <param name="end">输出：区间结束字节（含）。</param>
    /// <returns>解析成功返回 true，失败（格式非法或区间无效）返回 false。</returns>
    /// <remarks>
    /// 仅处理首个区间（逗号前部分）。支持三种形式：
    /// <c>start-end</c>、<c>start-</c>（到文件末尾）、<c>-suffix</c>（末尾 N 字节）。
    /// start 越界（&lt;0 或 ≥ fileSize）视为失败；end 超过文件末尾时夹紧为 fileSize−1。
    /// </remarks>
    public static bool TryParse(string? header, long fileSize, out long start, out long end)
    {
        start = 0;
        end = 0;
        if (fileSize <= 0 || string.IsNullOrWhiteSpace(header)) return false;
        var raw = header.Trim();
        const string prefix = "bytes=";
        if (!raw.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;
        // 多区间请求取第一个区间处理
        var spec = raw.Substring(prefix.Length).Split(',')[0].Trim();
        var dash = spec.IndexOf('-');
        if (dash < 0) return false;
        var left = spec.Substring(0, dash).Trim();
        var right = spec.Substring(dash + 1).Trim();
        if (left.Length == 0)
        {
            // 后缀形式：-N 表示最后 N 字节
            if (!long.TryParse(right, out var suffix) || suffix <= 0) return false;
            start = Math.Max(0, fileSize - suffix);
            end = fileSize - 1;
        }
        else
        {
            // 前缀形式：start- 或 start-end
            if (!long.TryParse(left, out start) || start < 0 || start >= fileSize) return false;
            if (right.Length == 0) end = fileSize - 1;
            else if (!long.TryParse(right, out end)) return false;
        }

        // 统一把结束位置夹紧到文件末尾
        if (end >= fileSize) end = fileSize - 1;
        return end >= start;
    }
}
