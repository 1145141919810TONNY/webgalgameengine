using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace Shiori.Scripting.Load;

/// <summary>engine_manifest.json official[] 的运行时镜像（不替代 HttpServer 注入）。</summary>
public sealed class AssetCatalog
{
    public string Version { get; set; } = "";
    public List<AssetEntry> Official { get; } = new List<AssetEntry>();

    public static AssetCatalog FromManifestFile(string path)
    {
        var cat = new AssetCatalog();
        if (string.IsNullOrEmpty(path) || !File.Exists(path))
            return cat;
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(File.ReadAllText(path));
        }
        catch (JsonException)
        {
            return cat;
        }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.TryGetProperty("version", out var ver))
                cat.Version = ver.ToString();
            if (root.TryGetProperty("official", out var official) && official.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in official.EnumerateArray())
                {
                    cat.Official.Add(new AssetEntry
                    {
                        Type = ReadString(el, "type"),
                        Path = ReadString(el, "path")
                    });
                }
            }
        }
        return cat;
    }

    private static string ReadString(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var p)) return "";
        return p.ValueKind == JsonValueKind.String ? (p.GetString() ?? "") : p.ToString();
    }
}

public sealed class AssetEntry
{
    public string Type { get; set; } = "";
    public string Path { get; set; } = "";
}
