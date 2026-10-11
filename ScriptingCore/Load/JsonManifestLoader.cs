using System;
using System.Collections.Generic;
using System.Text.Json;
using Shiori.Scripting.Schema;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Load;

/// <summary>macro\*.json manifest：register[] 里 kind=macro 的声明。</summary>
public static class JsonManifestLoader
{
    public static IReadOnlyList<MacroSchema> Load(string json, string file, DiagnosticBag bag)
    {
        if (bag == null) throw new ArgumentNullException(nameof(bag));
        var macros = new List<MacroSchema>();
        if (string.IsNullOrWhiteSpace(json)) return macros;

        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("register", out var register)
                || register.ValueKind != JsonValueKind.Array)
                return macros;

            foreach (var el in register.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.Object) continue;
                var kind = ReadString(el, "kind");
                if (!kind.Equals("macro", StringComparison.OrdinalIgnoreCase)) continue;
                var name = ReadString(el, "name");
                if (string.IsNullOrWhiteSpace(name))
                {
                    bag.Add(DiagnosticSeverity.Error, "manifest macro 缺少 name",
                        new Parse.SourceSpan { File = file });
                    continue;
                }

                var steps = new List<MacroStep>();
                var parameters = new List<ParamSchema>();
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var illegal = false;
                if (el.TryGetProperty("steps", out var stepsEl) && stepsEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var st in stepsEl.EnumerateArray())
                    {
                        if (st.ValueKind != JsonValueKind.Object) continue;
                        var cmd = ReadString(st, "cmd");
                        var kv = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        foreach (var p in st.EnumerateObject())
                        {
                            if (p.NameEquals("cmd")) continue;
                            var raw = p.Value.ValueKind == JsonValueKind.String
                                ? (p.Value.GetString() ?? "")
                                : p.Value.GetRawText();
                            kv[p.Name] = Absorb(raw, parameters, seen);
                        }
                        if (KsMacroParser.IsIllegalMacroWait(cmd, kv))
                        {
                            bag.Add(DiagnosticSeverity.Error, "宏体内 wait 只允许定时推进，禁止 wait click / [s]",
                                new Parse.SourceSpan { File = file });
                            illegal = true;
                            break;
                        }
                        steps.Add(new MacroStep(cmd, kv));
                    }
                }

                if (!illegal)
                    macros.Add(new MacroSchema(name, parameters.ToArray(), steps));
            }
        }
        catch (JsonException ex)
        {
            bag.Add(DiagnosticSeverity.Error, "manifest JSON 无效: " + ex.Message,
                new Parse.SourceSpan { File = file });
        }

        return macros;
    }

    private static string ReadString(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var p) || p.ValueKind != JsonValueKind.String)
            return "";
        return p.GetString() ?? "";
    }

    private static string Absorb(string raw, List<ParamSchema> parameters, HashSet<string> seen)
    {
        if (string.IsNullOrEmpty(raw) || raw[0] != '%') return raw;
        var body = raw.Substring(1);
        string name;
        string? def = null;
        var bar = body.IndexOf('|');
        if (bar >= 0)
        {
            name = body.Substring(0, bar);
            def = body.Substring(bar + 1);
        }
        else name = body;
        if (!string.IsNullOrEmpty(name) && seen.Add(name))
        {
            object? defaultValue = null;
            if (def != null && int.TryParse(def, out var n)) defaultValue = n;
            else if (!string.IsNullOrEmpty(def)) defaultValue = def;
            parameters.Add(new ParamSchema(name, "str", optional: true, defaultValue: defaultValue));
        }
        return "%" + name;
    }
}
