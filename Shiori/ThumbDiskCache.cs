// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 缩略图落盘缓存（T3.3）。
// 背景：/cg-thumb 缩略图
// 是「源图字节 → OpenCV 解码 → 缩放 → JPEG 编码」的纯函数产物，且 .sgd 容器内容不可变，
// 因此可以跨会话复用。第二次启动时 CG 页首屏几乎全部命中磁盘，无需再碰容器解密与解码。
//
// 失效策略：文件名 = 缓存键的哈希，缓存键里已含「相对路径 + 源文件 mtime + 源文件长度
// （容器来源则用 .sgd 包自身的 mtime/长度）+ 缩略图宽度」，所以源资源或容器一变，
// 键就变、文件名就变，旧文件自然不会再被读到 —— 不需要额外的版本号或清单文件。
//
// 线程模型：所有公开操作在内部锁下执行；一切 IO 异常都被吞掉并降级为「未命中」，
// 绝不让缓存层的问题影响请求处理。

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace ShioriCSharp;

/// <summary>
/// 缩略图磁盘缓存：把已生成的缩略图 JPEG 落到 <c>%LOCALAPPDATA%\Shiori\thumbs\&lt;盘区&gt;\</c>，
/// 跨会话复用。按总字节数做 LRU（按写入时间淘汰），超预算时在写入路径上触发一次裁剪。
/// </summary>
/// <remarks>
/// 缓存目录按「站点根目录的哈希」分子目录，避免同一台机器上多个游戏互相污染
/// （键里只有站点根相对路径，不含站点根本身）。
/// </remarks>
public sealed class ThumbDiskCache
{
    /// <summary>默认字节上限：128 MiB（缩略图单张约 8~20 KB，可容纳数千张）。</summary>
    public const long DefaultMaxBytes = 128L * 1024 * 1024;

    /// <summary>文件名里保留的相对路径前缀最大长度（便于人工排查，超出部分截断）。</summary>
    private const int NamePrefixMax = 60;

    /// <summary>哈希后缀长度（十六进制字符数）。32 字符 = 128 bit，碰撞概率可忽略。</summary>
    private const int HashSuffixChars = 32;

    /// <summary>缓存根目录（含按站点根哈希区分的子目录）；初始化失败时为 null。</summary>
    private readonly string? _dir;
    /// <summary>总字节上限。</summary>
    private readonly long _maxBytes;
    /// <summary>保护 <see cref="_approxBytes"/> 与目录写操作的锁。</summary>
    private readonly object _gate = new();
    /// <summary>当前目录已占用的近似字节数（构造时扫描一次，写入/裁剪时维护）。</summary>
    private long _approxBytes;
    /// <summary>为 true 时整个缓存层不可用（目录建不出来、权限不足等），所有操作直接短路。</summary>
    private readonly bool _disabled;

    /// <summary>
    /// 构造磁盘缓存。
    /// </summary>
    /// <param name="rootDir">站点根目录（游戏资源目录），用于派生隔离用的子目录名。</param>
    /// <param name="maxBytes">总字节上限，&lt;= 0 视为禁用磁盘缓存。</param>
    /// <param name="baseDir">缓存根目录覆盖（测试用）；省略时取 <c>%LOCALAPPDATA%\Shiori\thumbs</c>。</param>
    public ThumbDiskCache(string rootDir, long maxBytes = DefaultMaxBytes, string? baseDir = null)
    {
        _maxBytes = maxBytes;
        if (maxBytes <= 0)
        {
            _disabled = true;
            return;
        }

        try
        {
            string root = baseDir;
            if (string.IsNullOrEmpty(root))
            {
                string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (string.IsNullOrEmpty(local)) local = Path.GetTempPath();
                root = Path.Combine(local, "Shiori", "thumbs");
            }
            // 站点根哈希：8 个十六进制字符足够区分同机上的不同游戏
            string tag = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                Path.GetFullPath(rootDir ?? string.Empty).ToLowerInvariant()))).Substring(0, 8);
            _dir = Path.Combine(root, tag);
            System.IO.Directory.CreateDirectory(_dir);
            _approxBytes = MeasureDirectory(_dir);
        }
        catch (Exception ex)
        {
            Console.WriteLine("[ThumbDiskCache] disabled: " + ex.Message);
            _disabled = true;
        }
    }

    /// <summary>缓存是否可用（目录创建成功且容量上限大于 0）。</summary>
    public bool Enabled => !_disabled && _dir != null;

    /// <summary>缓存目录绝对路径；不可用时为 null。</summary>
    /// <remarks>不能叫 <c>Path</c>：会遮蔽 <see cref="System.IO.Path"/>，导致类内所有 Path.xxx 解析失败。</remarks>
    public string? DirectoryPath => _dir;

    /// <summary>当前目录占用的近似字节数。</summary>
    public long ApproxBytes
    {
        get { lock (_gate) return _approxBytes; }
    }

    /// <summary>
    /// 尝试从磁盘读取缓存条目。任何异常（文件被删、权限、IO 错误）都返回 false。
    /// </summary>
    /// <param name="key">缩略图缓存键（<see cref="AssetETag.ThumbKey"/> 的产物）。</param>
    /// <param name="data">命中时输出 JPEG 字节。</param>
    /// <returns>命中返回 true。</returns>
    public bool TryGet(string key, out byte[] data)
    {
        data = Array.Empty<byte>();
        if (!Enabled) return false;
        try
        {
            string p = FilePathFor(key);
            if (!File.Exists(p)) return false;
            data = File.ReadAllBytes(p);
            return data.Length > 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// 写入一条缓存。写入失败静默忽略；写完后若超出预算则触发一次裁剪。
    /// </summary>
    /// <param name="key">缩略图缓存键。</param>
    /// <param name="data">JPEG 字节。</param>
    public void Put(string key, byte[] data)
    {
        if (!Enabled || data == null || data.Length == 0) return;
        try
        {
            string p = FilePathFor(key);
            // 先写临时文件再原子改名：避免进程被杀时留下半截文件被当成有效缓存
            string tmp = p + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
            File.WriteAllBytes(tmp, data);
            long oldLen = 0;
            try { oldLen = new FileInfo(p).Exists ? new FileInfo(p).Length : 0; } catch { }
            File.Move(tmp, p, overwrite: true);

            bool over;
            lock (_gate)
            {
                _approxBytes += data.Length - oldLen;
                if (_approxBytes < 0) _approxBytes = 0;
                over = _approxBytes > _maxBytes;
            }
            if (over) Prune();
        }
        catch
        {
            // 磁盘满 / 文件被锁 / 目录被删：降级为「不落盘」，不影响请求本身
        }
    }

    /// <summary>
    /// 按写入时间从旧到新删除，直到目录占用回落到预算以内。
    /// 供启动期调用（清掉上次运行遗留的、已被新键取代的旧缩略图）。
    /// </summary>
    /// <returns>删除的文件数。</returns>
    public int Prune()
    {
        if (!Enabled) return 0;
        int deleted = 0;
        try
        {
            var files = new List<FileInfo>();
            long total = 0;
            foreach (var f in new DirectoryInfo(_dir!).EnumerateFiles("*.jpg"))
            {
                files.Add(f);
                total += f.Length;
            }
            // 顺带清掉上次异常退出可能留下的临时文件
            foreach (var t in new DirectoryInfo(_dir!).EnumerateFiles("*.tmp"))
            {
                try { t.Delete(); } catch { }
            }

            if (total > _maxBytes)
            {
                foreach (var f in files.OrderBy(x => x.LastWriteTimeUtc))
                {
                    if (total <= _maxBytes) break;
                    try
                    {
                        long len = f.Length;
                        f.Delete();
                        total -= len;
                        deleted++;
                    }
                    catch { /* 单文件删除失败不影响其余 */ }
                }
            }
            lock (_gate) _approxBytes = total;
        }
        catch (Exception ex)
        {
            Console.WriteLine("[ThumbDiskCache] prune failed: " + ex.Message);
        }
        return deleted;
    }

    /// <summary>清空磁盘缓存（缩略图功能被运行期关闭时调用）。</summary>
    public int Clear()
    {
        if (!Enabled) return 0;
        int n = 0;
        try
        {
            foreach (var f in new DirectoryInfo(_dir!).EnumerateFiles("*"))
            {
                try { f.Delete(); n++; } catch { }
            }
            lock (_gate) _approxBytes = 0;
        }
        catch { }
        return n;
    }

    /// <summary>由缓存键派生磁盘文件名：可读的路径前缀 + 键哈希后缀 + <c>.jpg</c>。</summary>
    /// <param name="key">缩略图缓存键。</param>
    /// <returns>该键独占的绝对文件路径。</returns>
    private string FilePathFor(string key)
    {
        string safe = Sanitize(key);
        string hex = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key ?? string.Empty)))
            .Substring(0, HashSuffixChars).ToLowerInvariant();
        return System.IO.Path.Combine(_dir!, safe + "--" + hex + ".jpg");
    }

    /// <summary>把缓存键的可能不合法字符替换为下划线，并截断到可读长度。</summary>
    private static string Sanitize(string key)
    {
        var sb = new StringBuilder(NamePrefixMax);
        string s = key ?? string.Empty;
        foreach (char c in s)
        {
            if (sb.Length >= NamePrefixMax) break;
            sb.Append((c is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9')
                or '.' or '-' or '_') ? c : '_');
        }
        return sb.Length == 0 ? "k" : sb.ToString();
    }

    /// <summary>统计目录内 .jpg 的总字节数（构造期只跑一次）。</summary>
    private static long MeasureDirectory(string dir)
    {
        long total = 0;
        try
        {
            foreach (var f in new DirectoryInfo(dir).EnumerateFiles("*.jpg"))
            {
                try { total += f.Length; } catch { }
            }
        }
        catch { }
        return total;
    }
}
