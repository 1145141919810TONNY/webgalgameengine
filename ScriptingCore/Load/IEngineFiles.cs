using System;
using System.Collections.Generic;
using System.IO;
using Shiori.Scripting.Host;

namespace Shiori.Scripting.Load;

/// <summary>
/// 引擎文件源抽象：以"站点根相对路径（正斜杠）"为唯一寻址方式。
/// 存在的意义：脚本层（macro 扫描、readFile、manifest）绝不能假定资源一定躺在磁盘目录里。
/// 发行形态下站点根只有 .sgd 分包、没有 macro\ 等目录，若直接 Directory.Exists/EnumerateFiles
/// 会静默返回空，导致宏原生脚本（media_impl.js / quake_impl.js 等）不被注入、效果层消失。
/// 由宿主（启动器）注入实现：可以是纯磁盘，也可以是"磁盘 + .sgd 容器"的合并视图。
/// </summary>
public interface IEngineFiles
{
    /// <summary>目录是否存在（虚拟视图下：磁盘有目录，或容器内有该前缀的 entry）。</summary>
    bool DirectoryExists(string relDir);

    /// <summary>递归枚举该目录下全部文件，返回站点根相对路径（正斜杠）。</summary>
    IEnumerable<string> EnumerateFiles(string relDir);

    /// <summary>文件是否存在（磁盘或容器内）。</summary>
    bool FileExists(string relPath);

    /// <summary>按 UTF-8 读取文件全文（磁盘优先，容器兜底）。</summary>
    string ReadAllText(string relPath);
}

/// <summary>纯磁盘实现（开发期散文件形态，也是未注入自定义实现时的默认行为）。</summary>
public sealed class DiskEngineFiles : IEngineFiles
{
    private readonly string _root;

    public DiskEngineFiles(string engineRoot)
    {
        if (string.IsNullOrWhiteSpace(engineRoot))
            throw new ArgumentException("engineRoot required", nameof(engineRoot));
        _root = Path.GetFullPath(engineRoot);
    }

    /// <summary>站点根绝对路径。</summary>
    public string Root => _root;

    public bool DirectoryExists(string relDir)
    {
        var full = Combine(relDir);
        return full != null && Directory.Exists(full);
    }

    public IEnumerable<string> EnumerateFiles(string relDir)
    {
        var full = Combine(relDir);
        if (full == null || !Directory.Exists(full)) yield break;

        foreach (var path in Directory.EnumerateFiles(full, "*", SearchOption.AllDirectories))
        {
            if (!PathGuard.IsUnderRoot(path, _root)) continue;
            yield return ToRel(path);
        }
    }

    public bool FileExists(string relPath)
    {
        var full = Combine(relPath);
        return full != null && File.Exists(full);
    }

    public string ReadAllText(string relPath)
    {
        var full = Combine(relPath);
        if (full == null) throw new FileNotFoundException("path outside engine root", relPath);
        return File.ReadAllText(full);
    }

    /// <summary>拼接并校验路径，越界返回 null。</summary>
    private string? Combine(string relPath)
    {
        if (string.IsNullOrWhiteSpace(relPath)) return null;
        string full;
        try
        {
            full = Path.GetFullPath(Path.Combine(_root, relPath.Replace('/', Path.DirectorySeparatorChar)));
        }
        catch (Exception)
        {
            return null;
        }
        return PathGuard.IsUnderRoot(full, _root) ? full : null;
    }

    private string ToRel(string full)
    {
        var root = PathGuard.WithSep(_root);
        var p = Path.GetFullPath(full);
        return p.StartsWith(root, StringComparison.OrdinalIgnoreCase)
            ? p.Substring(root.Length).Replace('\\', '/')
            : Path.GetFileName(full);
    }
}
