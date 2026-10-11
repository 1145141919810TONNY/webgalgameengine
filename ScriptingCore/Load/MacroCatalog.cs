using System;
using System.Collections.Generic;
using System.IO;
using Shiori.Scripting.Host;
using Shiori.Scripting.Parse;
using Shiori.Scripting.Schema;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Load;

/// <summary>扫描 macro\：*.js 原生后载、*.ks 宏定义源、*.json manifest。</summary>
/// 全部路径以"站点根相对路径（正斜杠）"存储，读取一律经 IEngineFiles，
/// 因此发行形态（macro 目录已被打包为 macro.sgd、磁盘无目录）同样能扫描到。
public sealed class MacroCatalog
{
    /// <summary>相对路径，如 "macro/media_impl.js"。</summary>
    public List<string> NativeJs { get; } = new List<string>();
    public List<string> KsMacros { get; } = new List<string>();
    public List<string> Manifests { get; } = new List<string>();

    public static MacroCatalog Scan(string macroDir) => Scan(macroDir, macroDir);

    public static MacroCatalog Scan(string macroDir, string engineRoot)
    {
        if (string.IsNullOrEmpty(macroDir) || string.IsNullOrEmpty(engineRoot))
            return new MacroCatalog();
        if (!Directory.Exists(engineRoot))
            return new MacroCatalog();

        var files = new DiskEngineFiles(engineRoot);
        var rel = Rel(engineRoot, macroDir);
        return rel == null ? new MacroCatalog() : Scan(files, rel);
    }

    /// <summary>按虚拟文件源扫描指定相对目录（宿主可注入"磁盘 + 容器"合并视图）。</summary>
    public static MacroCatalog Scan(IEngineFiles files, string relDir)
    {
        var cat = new MacroCatalog();
        if (files == null || string.IsNullOrWhiteSpace(relDir)) return cat;

        var dir = relDir.Replace('\\', '/').Trim('/');
        if (dir.Length == 0) return cat;

        // 虚拟视图下"目录存在"由实现判定：容器内有该前缀 entry 即视为存在
        if (!files.DirectoryExists(dir)) return cat;

        foreach (var rel in files.EnumerateFiles(dir))
        {
            var ext = Path.GetExtension(rel);
            if (ext.Equals(".js", StringComparison.OrdinalIgnoreCase))
                cat.NativeJs.Add(rel);
            else if (ext.Equals(".ks", StringComparison.OrdinalIgnoreCase))
                cat.KsMacros.Add(rel);
            else if (ext.Equals(".json", StringComparison.OrdinalIgnoreCase))
                cat.Manifests.Add(rel);
        }

        cat.NativeJs.Sort(StringComparer.OrdinalIgnoreCase);
        cat.KsMacros.Sort(StringComparer.OrdinalIgnoreCase);
        cat.Manifests.Sort(StringComparer.OrdinalIgnoreCase);
        return cat;
    }

    public DiagnosticBag MergeInto(IEngineFiles files, CommandRegistry registry)
    {
        if (registry == null) throw new ArgumentNullException(nameof(registry));
        var bag = new DiagnosticBag();

        foreach (var rel in KsMacros)
        {
            try
            {
                var fileBag = new DiagnosticBag();
                var text = files.ReadAllText(rel);
                var macros = KsMacroParser.Parse(text, rel, fileBag);
                Copy(fileBag, bag);
                if (fileBag.HasError) continue;
                foreach (var m in macros)
                    TryAdd(registry, m, bag);
            }
            catch (IOException ex)
            {
                bag.Add(DiagnosticSeverity.Warn, "无法读取宏文件: " + rel + " (" + ex.GetType().Name + ")",
                    new Parse.SourceSpan { File = rel });
            }
        }

        foreach (var rel in Manifests)
        {
            try
            {
                var fileBag = new DiagnosticBag();
                var text = files.ReadAllText(rel);
                var macros = JsonManifestLoader.Load(text, rel, fileBag);
                Copy(fileBag, bag);
                if (fileBag.HasError) continue;
                foreach (var m in macros)
                    TryAdd(registry, m, bag);
            }
            catch (IOException ex)
            {
                bag.Add(DiagnosticSeverity.Warn, "无法读取 manifest: " + rel + " (" + ex.GetType().Name + ")",
                    new Parse.SourceSpan { File = rel });
            }
        }

        return bag;
    }

    private static void TryAdd(CommandRegistry registry, MacroSchema macro, DiagnosticBag bag)
    {
        try
        {
            registry.AddMacro(macro);
        }
        catch (InvalidOperationException)
        {
            if (registry.TryGetMacro(macro.Name, out _))
                return;
            bag.Add(DiagnosticSeverity.Warn, "指令/宏重名已跳过: " + macro.Name);
        }
    }

    private static void Copy(DiagnosticBag from, DiagnosticBag to)
    {
        foreach (var d in from.Items)
            to.Add(d.Severity, d.Message, d.Span, d.Suggestion);
    }

    private static string? Rel(string root, string full)
    {
        try
        {
            var r = PathGuard.WithSep(Path.GetFullPath(root));
            var p = Path.GetFullPath(full);
            if (!p.StartsWith(r, StringComparison.OrdinalIgnoreCase)) return null;
            var rel = p.Substring(r.Length).Replace('\\', '/').Trim('/');
            return rel.Length == 0 ? null : rel;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
