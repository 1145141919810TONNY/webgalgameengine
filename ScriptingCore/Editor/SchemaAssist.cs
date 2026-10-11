using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using Shiori.Scripting.Compile;
using Shiori.Scripting.Parse;
using Shiori.Scripting.Schema;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Editor;

/// <summary>WPF-free editor surface over CommandRegistry. Completions / ParamHints / Translate / Lint share one Schema.</summary>
public sealed class SchemaAssist
{
    private static readonly Regex WaitSeconds =
        new Regex(@"^等待\s*([\d.]+)\s*秒$", RegexOptions.Compiled);

    private static readonly Regex JumpLabelHuman =
        new Regex(@"^跳转标签「(.+)」$", RegexOptions.Compiled);

    public static SchemaAssist Default { get; } = new SchemaAssist(CommandRegistry.CreateDefault());

    private readonly CommandRegistry _registry;
    private readonly Compiler _compiler;
    private readonly Parser _parser = new Parser();
    private readonly Dictionary<string, string> _labelToName =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public SchemaAssist(CommandRegistry registry)
    {
        _registry = registry ?? throw new ArgumentNullException(nameof(registry));
        _compiler = new Compiler(_registry);
        foreach (var schema in UniqueCommands())
        {
            if (!_labelToName.ContainsKey(schema.Label))
                _labelToName[schema.Label] = schema.Name;
        }
        foreach (var macro in UniqueMacros())
        {
            if (!_labelToName.ContainsKey(macro.Label))
                _labelToName[macro.Label] = macro.Name;
        }
    }

    public string Version => DslVersion.Value;

    public bool VersionMatches(string version) =>
        string.Equals(Version, version, StringComparison.Ordinal);

    public IReadOnlyList<CompletionItem> Completions(string? prefix = null)
    {
        var items = new List<CompletionItem>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string name, string kind, string label, string canonical)
        {
            var key = name + ":" + kind;
            if (!seen.Add(key)) return;
            items.Add(new CompletionItem(name, kind, label, canonical));
        }

        foreach (var schema in UniqueCommands())
        {
            Add(schema.Name, "command", schema.Label, schema.Name);
            foreach (var alias in schema.Aliases)
                Add(alias, "alias", schema.Label, schema.Name);
        }

        foreach (var macro in UniqueMacros())
            Add(macro.Name, "macro", macro.Label, macro.Name);

        if (string.IsNullOrWhiteSpace(prefix))
            return items;

        var filtered = new List<CompletionItem>();
        foreach (var item in items)
        {
            if (Starts(item.Name, prefix) || Starts(item.Label, prefix))
                filtered.Add(item);
        }
        return filtered;
    }

    public IReadOnlyList<ParamHint> ParamHints(string name)
    {
        var hints = new List<ParamHint>();
        if (_registry.TryGet(name, out var schema) && schema != null)
        {
            foreach (var p in schema.Positional) hints.Add(ToHint(p));
            foreach (var p in schema.Named) hints.Add(ToHint(p));
            return hints;
        }

        if (_registry.TryGetMacro(name, out var macro) && macro != null)
        {
            foreach (var p in macro.Parameters) hints.Add(ToHint(p));
        }
        return hints;
    }

    public string Translate(string? command)
    {
        if (string.IsNullOrWhiteSpace(command))
            return "";

        var calls = _parser.ParseField(command);
        if (calls.Count == 0)
            return "";

        var parts = new List<string>();
        foreach (var call in calls)
            parts.Add(TranslateCall(call));
        return string.Join(" | ", parts);
    }

    public string HumanToCommand(string humanText)
    {
        if (string.IsNullOrWhiteSpace(humanText))
            return "";

        var parts = humanText.Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries);
        var result = new List<string>();
        foreach (var raw in parts)
        {
            var part = raw.Trim();
            if (part.Length == 0) continue;

            if (_labelToName.TryGetValue(part, out var name))
            {
                result.Add("[" + name + "]");
                continue;
            }

            var jump = JumpLabelHuman.Match(part);
            if (jump.Success)
            {
                result.Add("[" + jump.Groups[1].Value + "]");
                continue;
            }

            var match = WaitSeconds.Match(part);
            if (match.Success &&
                double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds))
            {
                result.Add("[wait time=" + ((int)(seconds * 1000)).ToString(CultureInfo.InvariantCulture) + "]");
            }
        }

        return string.Join(",", result);
    }

    public IReadOnlyList<Diagnostic> Lint(string field, string file = "", int line = 0)
    {
        var text = field ?? "";
        var jumpNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var call in _parser.ParseField(text, file, line))
        {
            if (IsJumpLabel(call))
                jumpNames.Add(call.Name);
        }

        var diags = _compiler.CompileCommandField(text, file, line).Diagnostics.Items;
        if (jumpNames.Count == 0)
            return diags;

        var kept = new List<Diagnostic>();
        foreach (var d in diags)
        {
            const string prefix = "未注册指令: ";
            if (d.Message.StartsWith(prefix, StringComparison.Ordinal) &&
                jumpNames.Contains(d.Message.Substring(prefix.Length)))
                continue;
            kept.Add(d);
        }
        return kept;
    }

    private string TranslateCall(RawCall call)
    {
        var name = call.Name ?? "";
        if (name.Equals("wait", StringComparison.OrdinalIgnoreCase) &&
            call.Kv.TryGetValue("time", out var timeRaw) &&
            int.TryParse(timeRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var ms))
        {
            var seconds = (ms / 1000.0).ToString("F1", CultureInfo.InvariantCulture);
            return "等待 " + seconds + " 秒";
        }

        if (_registry.TryGet(name, out var schema) && schema != null)
            return schema.Label;
        if (_registry.TryGetMacro(name, out var macro) && macro != null)
            return macro.Label;
        if (IsJumpLabel(call))
            return "跳转标签「" + name + "」";
        return "[未知指令: " + name + "]";
    }

    private bool IsJumpLabel(RawCall call)
    {
        if (string.IsNullOrWhiteSpace(call.Name)) return false;
        if (call.Args.Count > 0 || call.Kv.Count > 0) return false;
        if (_registry.TryGet(call.Name, out _)) return false;
        if (_registry.TryGetMacro(call.Name, out _)) return false;
        return true;
    }

    private IEnumerable<CommandSchema> UniqueCommands()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var schema in _registry.Commands)
        {
            if (seen.Add(schema.Name))
                yield return schema;
        }
    }

    private IEnumerable<MacroSchema> UniqueMacros()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var macro in _registry.Macros)
        {
            if (seen.Add(macro.Name))
                yield return macro;
        }
    }

    private static ParamHint ToHint(ParamSchema p) =>
        new ParamHint(p.Name, p.Type, p.Optional, p.Label, p.DefaultValue);

    private static bool Starts(string value, string prefix) =>
        value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
}

public sealed class CompletionItem
{
    public CompletionItem(string name, string kind, string label, string canonical)
    {
        Name = name;
        Kind = kind;
        Label = label;
        Canonical = canonical;
    }

    public string Name { get; }
    public string Kind { get; }
    public string Label { get; }
    public string Canonical { get; }
}

public sealed class ParamHint
{
    public ParamHint(string name, string type, bool optional, string label, object? defaultValue)
    {
        Name = name;
        Type = type;
        Optional = optional;
        Label = label;
        DefaultValue = defaultValue;
    }

    public string Name { get; }
    public string Type { get; }
    public bool Optional { get; }
    public string Label { get; }
    public object? DefaultValue { get; }
}
