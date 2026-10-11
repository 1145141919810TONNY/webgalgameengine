using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using Shiori.Scripting.Compile;
using Shiori.Scripting.Emit;
using Shiori.Scripting.Load;
using Shiori.Scripting.Schema;

namespace Shiori.Scripting.Host;

/// <summary>Q25 白名单桥：compileScene / registrySnapshot / catalogQuery / diagnostics / readFile。</summary>
public sealed class DslRuntime
{
    private static readonly HashSet<string> Allowed = new HashSet<string>(StringComparer.Ordinal)
    {
        "compileScene",
        "registrySnapshot",
        "catalogQuery",
        "diagnostics",
        "readFile"
    };

    private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private readonly string _engineRoot;
    private readonly IEngineFiles _files;
    private readonly object _gate = new object();
    private readonly CommandRegistry _registry;
    private readonly Compiler _compiler;
    private readonly SceneCompiler _scene;
    private JsonElement _lastDiagnostics;
    private const int ReadFileMaxBytes = 2 * 1024 * 1024;
    private const int MaxArgsBytes = 2 * 1024 * 1024;
    private const int MaxStoryLines = 20000;

    public DslRuntime(string engineRoot)
        : this(engineRoot, null)
    {
    }

    /// <summary>
    /// 以指定的引擎文件源构造。宿主在发行形态下应注入"磁盘 + .sgd 容器"合并视图，
    /// 否则 macro 目录被打包后扫描结果为空，宏原生脚本不会注入页面。
    /// </summary>
    public DslRuntime(string engineRoot, IEngineFiles? files)
    {
        if (string.IsNullOrWhiteSpace(engineRoot))
            throw new ArgumentException("engineRoot required", nameof(engineRoot));
        _engineRoot = Path.GetFullPath(engineRoot);
        _files = files ?? new DiskEngineFiles(_engineRoot);
        _registry = CommandRegistry.CreateDefault();
        try
        {
            Assets = AssetCatalog.FromManifestFile(Path.Combine(_engineRoot, "engine_manifest.json"));
        }
        catch (Exception)
        {
            Assets = new AssetCatalog();
        }
        // 逻辑目录名（约定），物理位置由 IEngineFiles 解析：磁盘目录或 .sgd 容器均可
        Macros = MacroCatalog.Scan(_files, "macro");
        var catalogBag = Macros.MergeInto(_files, _registry);
        _compiler = new Compiler(_registry);
        _scene = new SceneCompiler(_compiler);
        _lastDiagnostics = DslNodeJson.DiagnosticsToJson(catalogBag.Items);
    }

    public AssetCatalog Assets { get; }
    public MacroCatalog Macros { get; }
    public CommandRegistry Registry => _registry;

    public string Invoke(string method, string argsJson)
    {
        var name = method ?? "";
        if (!Allowed.Contains(name))
            return Fail("unknown method: " + name);
        if (argsJson != null && argsJson.Length > MaxArgsBytes)
            return Fail("payload too large");

        JsonElement args;
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argsJson) ? "{}" : argsJson);
            args = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return Fail("invalid json");
        }

        lock (_gate)
        {
            try
            {
                string result;
                switch (name)
                {
                    case "compileScene":
                        result = CompileScene(args);
                        break;
                    case "registrySnapshot":
                    {
                        using var snap = JsonDocument.Parse(RuntimeRegistryJson.Emit(_registry));
                        result = Ok(snap.RootElement.Clone());
                        break;
                    }
                    case "catalogQuery":
                        result = Ok(CatalogQuery());
                        break;
                    case "diagnostics":
                        result = Ok(_lastDiagnostics);
                        break;
                    case "readFile":
                        result = ReadFile(args);
                        break;
                    default:
                        result = Fail("unknown method: " + name);
                        break;
                }
                System.Diagnostics.Debug.WriteLine("[DSL] " + name + " " + (result.Contains("\"ok\":true") ? "ok" : "fail"));
                return result;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[DSL] " + name + " " + ex.GetType().Name);
                return Fail("internal error");
            }
        }
    }

    /// <summary>宏原生脚本（*.js）的站点根相对路径。已由 MacroCatalog 按相对路径收集，此处直接返回。</summary>
    public IReadOnlyList<string> NativeJsRelative()
    {
        var list = new List<string>();
        foreach (var rel in Macros.NativeJs)
        {
            if (string.IsNullOrEmpty(rel)) continue;
            list.Add(rel.Replace('\\', '/').TrimStart('/'));
        }
        return list;
    }

    private string CompileScene(JsonElement args)
    {
        var file = args.TryGetProperty("file", out var f) && f.ValueKind == JsonValueKind.String
            ? (f.GetString() ?? "")
            : "";
        if (!args.TryGetProperty("story", out var story) || story.ValueKind != JsonValueKind.Array)
            return Fail("compileScene requires story[]");
        if (story.GetArrayLength() > MaxStoryLines)
            return Fail("story too large");
        var data = _scene.CompileStory(file, story);
        if (data.TryGetProperty("diagnostics", out var diag))
            _lastDiagnostics = diag.Clone();
        return Ok(data);
    }

    private JsonElement CatalogQuery()
    {
        var official = new List<object>();
        foreach (var e in Assets.Official)
            official.Add(new { type = e.Type, path = e.Path });

        var macros = new List<string>();
        foreach (var m in _registry.Macros)
            macros.Add(m.Name);

        var native = new List<string>();
        foreach (var rel in NativeJsRelative())
            native.Add(rel);

        var payload = new
        {
            official,
            macros,
            nativeJs = native,
            version = DslVersion.Value
        };
        return JsonSerializer.SerializeToElement(payload, JsonOpts);
    }

    private string ReadFile(JsonElement args)
    {
        var rel = args.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String
            ? (p.GetString() ?? "")
            : "";
        if (string.IsNullOrWhiteSpace(rel))
            return Fail("readFile requires path");

        var relNorm = (rel ?? "").Replace('\\', '/').TrimStart('/');
        string full;
        try
        {
            full = Path.GetFullPath(Path.Combine(_engineRoot, relNorm));
        }
        catch (Exception)
        {
            return Fail("invalid path");
        }

        if (!PathGuard.IsUnderRoot(full, _engineRoot))
            return Fail("path outside engine root");

        // 优先走引擎文件源（发行形态下文件可能只在 .sgd 内），磁盘缺失时由虚拟源兜底
        bool exists;
        long length = 0;
        if (File.Exists(full) && !Directory.Exists(full))
        {
            exists = true;
            length = new FileInfo(full).Length;
        }
        else
        {
            exists = _files.FileExists(relNorm);
            if (exists)
            {
                try { length = _files.ReadAllText(relNorm).Length; }
                catch (Exception) { exists = false; }
            }
        }

        if (!exists) return Fail("file not found");
        if (length > ReadFileMaxBytes) return Fail("file too large");

        string text;
        try
        {
            text = File.Exists(full) && !Directory.Exists(full)
                ? File.ReadAllText(full)
                : _files.ReadAllText(relNorm);
        }
        catch (Exception)
        {
            return Fail("file not found");
        }

        var data = new { path = relNorm, text };
        return Ok(JsonSerializer.SerializeToElement(data, JsonOpts));
    }

    private string RelFromRoot(string full)
    {
        var root = PathGuard.WithSep(_engineRoot);
        var p = Path.GetFullPath(full);
        if (p.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            return p.Substring(root.Length).Replace('\\', '/');
        return Path.GetFileName(full);
    }

    private static string Ok(JsonElement data)
    {
        var payload = new { ok = true, data };
        return JsonSerializer.Serialize(payload, JsonOpts);
    }

    private static string Fail(string error)
    {
        var payload = new { ok = false, error };
        return JsonSerializer.Serialize(payload, JsonOpts);
    }
}
