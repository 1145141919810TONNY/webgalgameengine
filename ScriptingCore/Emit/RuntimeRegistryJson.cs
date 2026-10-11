using System.Collections.Generic;
using System.Text.Encodings.Web;
using System.Text.Json;
using Shiori.Scripting.Schema;

namespace Shiori.Scripting.Emit;

/// <summary>Schema → 页面可消费 JSON（window.__shiori.dsl.registry）。</summary>
public static class RuntimeRegistryJson
{
    public static string Emit(CommandRegistry registry)
    {
        var commands = new List<object>();
        var seen = new HashSet<string>();
        foreach (var c in registry.Commands)
        {
            if (!seen.Add(c.Name)) continue;
            commands.Add(new
            {
                name = c.Name,
                aliases = c.Aliases,
                source = c.Source,
                label = c.Label
            });
        }

        var macros = new List<object>();
        foreach (var m in registry.Macros)
        {
            var parameters = new List<object>();
            foreach (var p in m.Parameters)
                parameters.Add(new { name = p.Name, type = p.Type, defaultValue = p.DefaultValue });
            var steps = new List<object>();
            foreach (var s in m.Steps)
                steps.Add(new { cmd = s.Cmd, kv = s.Kv, args = s.Args });
            macros.Add(new { name = m.Name, label = m.Label, parameters, steps });
        }

        var payload = new
        {
            version = DslVersion.Value,
            commands,
            macros
        };
        return JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        });
    }
}
