// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// imgpack 批量图片协议（T3.9）—— 编解码与入参校验。
//
// 单独成类的理由：这份协议的定义必须与前端 ui/imgpool.js 的 parseImgPack 逐字节一致，
// 因此把它从 HttpServer 里剥出来、**不依赖任何 HTTP / WPF 类型**，
// 让离线测试可以直接编译本文件、产出真实字节流交给前端解析器往返验证（见 _pchk/imgpack_spec）。
//
// 线格式（全部大端）：
//   magic "SIPK" | u32 version | u32 count
//   重复 count 次： u16 keyLen | key(UTF-8) | u32 dataLen | data(dataLen 字节)
// dataLen == 0 表示该键取不到（源图缺失 / 解码失败），前端据此画占位底而不是报错。

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace ShioriCSharp;

/// <summary>
/// imgpack 协议：批量图片响应的编码器与请求键解析器。
/// </summary>
public static class ImgPackFormat
{
    /// <summary>响应魔数（ASCII "SIPK"）。</summary>
    public static readonly byte[] Magic = { (byte)'S', (byte)'I', (byte)'P', (byte)'K' };

    /// <summary>协议版本。</summary>
    public const int Version = 1;

    /// <summary>单次批量请求允许的最大键数量（防滥用：一次请求几百 MB 的源图）。</summary>
    public const int MaxKeys = 512;

    /// <summary>单个键的最大长度（UTF-8 字节数上限参考值，实际按字符数校验）。</summary>
    public const int MaxKeyChars = 512;

    /// <summary>
    /// 按线格式编码一条批量响应。
    /// </summary>
    /// <param name="items">(键, 数据) 序列；数据为 null 时写成 <c>dataLen = 0</c>。顺序即输出顺序。</param>
    /// <returns>完整的响应体字节。</returns>
    public static byte[] Encode(IReadOnlyList<(string Key, byte[]? Data)> items)
    {
        int n = items?.Count ?? 0;
        using var ms = new MemoryStream(64 + n * 32);
        ms.Write(Magic, 0, Magic.Length);
        WriteU32Be(ms, (uint)Version);
        WriteU32Be(ms, (uint)n);

        for (int i = 0; i < n; i++)
        {
            var (key, data) = items![i];
            byte[] nameBytes = Encoding.UTF8.GetBytes(key ?? string.Empty);
            // 键长是 u16：超长键（> 65535 字节）在线格式里无法表达，直接截断为 0 长度条目
            if (nameBytes.Length > ushort.MaxValue)
            {
                WriteU16Be(ms, 0);
                WriteU32Be(ms, 0);
                continue;
            }
            WriteU16Be(ms, (ushort)nameBytes.Length);
            ms.Write(nameBytes, 0, nameBytes.Length);
            WriteU32Be(ms, (uint)(data?.Length ?? 0));
            if (data != null && data.Length > 0) ms.Write(data, 0, data.Length);
        }
        return ms.ToArray();
    }

    /// <summary>写入大端 u32（与 .sgd 容器的字节序约定一致）。</summary>
    public static void WriteU32Be(Stream s, uint v)
    {
        s.WriteByte((byte)(v >> 24));
        s.WriteByte((byte)(v >> 16));
        s.WriteByte((byte)(v >> 8));
        s.WriteByte((byte)v);
    }

    /// <summary>写入大端 u16。</summary>
    public static void WriteU16Be(Stream s, ushort v)
    {
        s.WriteByte((byte)(v >> 8));
        s.WriteByte((byte)v);
    }

    /// <summary>
    /// 解析 <c>api/imgpack?keys=...</c> 的键参数为「相对 assets/ 的安全图片路径」列表。
    /// 规则（与前端 <c>ui/imgpool.js</c> 的 normKey 保持一致）：
    ///   · 去掉 query（CG 页压测会在路径后拼 <c>?dup=N_i</c>）；
    ///   · 允许 <c>assets/cg/x.jpg</c> 与 <c>cg/x.jpg</c> 两种写法，统一收敛到相对 assets/；
    ///   · 拒绝空段、<c>.</c>、<c>..</c>、含冒号（盘符 / 协议）的路径；
    ///   · 只接受图片扩展名；
    ///   · 去重且保持首次出现顺序；超过 <see cref="MaxKeys"/> 截断。
    /// </summary>
    /// <param name="raw">逗号分隔的原始参数值，可为 null。</param>
    /// <returns>归一化后的键列表。</returns>
    public static List<string> ParseKeys(string? raw)
    {
        var outp = new List<string>();
        if (string.IsNullOrWhiteSpace(raw)) return outp;

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in raw.Split(','))
        {
            if (outp.Count >= MaxKeys) break;
            string s = item.Trim().Replace('\\', '/');
            if (s.Length == 0) continue;

            int qm = s.IndexOf('?');
            if (qm >= 0) s = s.Substring(0, qm);
            int hm = s.IndexOf('#');
            if (hm >= 0) s = s.Substring(0, hm);

            int idx = s.IndexOf("assets/", StringComparison.OrdinalIgnoreCase);
            if (idx >= 0) s = s.Substring(idx + "assets/".Length);
            s = s.TrimStart('/');
            // 也接受缩略图路由的写法（/cg-thumb/cg/x.jpg）：宿主自己的 assetThumbUrl 产出的就是这种形态，
            // 调用方把它原样丢进来也必须收敛到同一把键。与 ui/imgpool.js 的 normKey 保持一致。
            if (s.StartsWith("cg-thumb/", StringComparison.OrdinalIgnoreCase))
                s = s.Substring("cg-thumb/".Length);
            if (s.Length == 0 || s.Length > MaxKeyChars) continue;
            // 含冒号 → 盘符绝对路径或 "javascript:" 之类，一律拒绝
            if (s.Contains(':')) continue;

            bool bad = false;
            foreach (var seg in s.Split('/'))
            {
                if (seg.Length == 0 || seg == "." || seg == "..") { bad = true; break; }
            }
            if (bad) continue;
            if (!IsImageName(s)) continue;

            if (seen.Add(s)) outp.Add(s);
        }
        return outp;
    }

    /// <summary>按扩展名判定是否为可作缩略图的图片（不读文件、不碰容器）。</summary>
    /// <param name="pathOrName">路径或文件名。</param>
    /// <returns>是图片扩展名返回 true。</returns>
    public static bool IsImageName(string pathOrName)
    {
        var ext = System.IO.Path.GetExtension(pathOrName ?? string.Empty);
        return ext.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".png", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".webp", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".gif", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".bmp", StringComparison.OrdinalIgnoreCase);
    }
}
