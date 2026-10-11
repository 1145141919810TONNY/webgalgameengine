using System;
using System.IO;
using System.Text.Json;
using Shiori.Scripting.Emit;
using Shiori.Scripting.Load;
using Shiori.Scripting.Schema;

namespace Shiori.Scripting.Host;

/// <summary>AssetCatalog + MacroCatalog 一次装载，供宿主注入 hostRegistry / native js。</summary>
public sealed class Bootstrapper
{
    public string EngineRoot { get; }
    public DslRuntime Runtime { get; }
    public AssetCatalog Assets => Runtime.Assets;
    public MacroCatalog Macros => Runtime.Macros;
    public CommandRegistry Registry => Runtime.Registry;

    public Bootstrapper(string engineRoot)
        : this(new DslRuntime(Path.GetFullPath(engineRoot)), engineRoot)
    {
    }

    public Bootstrapper(DslRuntime runtime, string engineRoot)
    {
        Runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
        EngineRoot = Path.GetFullPath(engineRoot);
    }

    public static Bootstrapper Load(string engineRoot) => new Bootstrapper(engineRoot);

    public string HostRegistryJson() => RuntimeRegistryJson.Emit(Registry);

    /// <summary>文档创建时注入：shioriHost 同步 shim + hostRegistry。dsl 已加载则 ingest 宏步骤，不替换 command 表。</summary>
    public string DocumentCreatedScript()
    {
        var registryJson = HostRegistryJson();
        var encoded = JsonSerializer.Serialize(registryJson);
        return "(function(){" +
               "var hostRegistry=JSON.parse(" + encoded + ");" +
               "var root=window;" +
               "if(typeof root.__shiori!=='object'||root.__shiori===null)root.__shiori={};" +
               "if(typeof root.__shiori.dsl!=='object'||root.__shiori.dsl===null)root.__shiori.dsl={};" +
               "root.__shiori.dsl.hostRegistry=hostRegistry;" +
               "root.SHIORI_DSL_VERSION=hostRegistry.version||'DSL1.0';" +
               "try{" +
               "if(typeof root.__shiori.dsl.ingestHostRegistry==='function')" +
               "root.__shiori.dsl.ingestHostRegistry(hostRegistry);" +
               "}catch(e){try{console.warn('[DSL] ingestHostRegistry',e);}catch(_){}}" +
               "try{" +
               "if(chrome&&chrome.webview&&chrome.webview.hostObjects&&chrome.webview.hostObjects.sync)" +
               "root.shioriHost=chrome.webview.hostObjects.sync.shioriHost;" +
               "}catch(e){try{console.warn('[DSL] shioriHost',e);}catch(_){}}" +
               "})();";
    }
}
