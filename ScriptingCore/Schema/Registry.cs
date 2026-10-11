using System;
using System.Collections.Generic;

namespace Shiori.Scripting.Schema;

/// <summary>内置 Schema ∪ 宏 ∪ 页面上报。重名冲突检测；别名挂靠。</summary>
public sealed class CommandRegistry
{
    private readonly Dictionary<string, CommandSchema> _byName =
        new Dictionary<string, CommandSchema>(StringComparer.OrdinalIgnoreCase);

    private readonly Dictionary<string, MacroSchema> _macros =
        new Dictionary<string, MacroSchema>(StringComparer.OrdinalIgnoreCase);

    public UnknownCommandPolicy UnknownPolicy { get; set; } = UnknownCommandPolicy.Warn;

    public void Add(CommandSchema schema)
    {
        if (schema == null) throw new ArgumentNullException(nameof(schema));
        RegisterName(schema.Name, schema);
        foreach (var alias in schema.Aliases)
            RegisterName(alias, schema);
    }

    public void AddMacro(MacroSchema macro)
    {
        if (macro == null) throw new ArgumentNullException(nameof(macro));
        var key = Fold(macro.Name);
        if (_macros.ContainsKey(key) || _byName.ContainsKey(key))
            throw new InvalidOperationException("指令/宏重名: " + macro.Name);
        _macros[key] = macro;
    }

    public bool TryGet(string name, out CommandSchema? schema)
    {
        schema = null;
        if (string.IsNullOrWhiteSpace(name)) return false;
        return _byName.TryGetValue(Fold(name), out schema);
    }

    public bool TryGetMacro(string name, out MacroSchema? macro)
    {
        macro = null;
        if (string.IsNullOrWhiteSpace(name)) return false;
        return _macros.TryGetValue(Fold(name), out macro);
    }

    public IReadOnlyCollection<CommandSchema> Commands => _byName.Values;

    public IReadOnlyCollection<MacroSchema> Macros => _macros.Values;

    public static CommandRegistry CreateDefault()
    {
        var r = new CommandRegistry();
        BuiltinCommands.Register(r);
        return r;
    }

    private void RegisterName(string name, CommandSchema schema)
    {
        var key = Fold(name);
        if (_byName.ContainsKey(key) || _macros.ContainsKey(key))
            throw new InvalidOperationException("指令重名: " + name);
        _byName[key] = schema;
    }

    internal static string Fold(string name) => name.Trim();
}

public enum UnknownCommandPolicy
{
    Ignore,
    Warn,
    Error
}

public sealed class MacroSchema
{
    public MacroSchema(string name, ParamSchema[] parameters, IReadOnlyList<MacroStep> steps, string? label = null)
    {
        Name = name;
        Parameters = parameters ?? Array.Empty<ParamSchema>();
        Steps = steps ?? Array.Empty<MacroStep>();
        Label = string.IsNullOrEmpty(label) ? name : label;
    }

    public string Name { get; }
    public string Label { get; }
    public ParamSchema[] Parameters { get; }
    public IReadOnlyList<MacroStep> Steps { get; }
}

public sealed class MacroStep
{
    public MacroStep(string cmd, IReadOnlyDictionary<string, string>? kv = null, IReadOnlyList<string>? args = null)
    {
        Cmd = cmd;
        Kv = kv ?? new Dictionary<string, string>();
        Args = args ?? Array.Empty<string>();
    }

    public string Cmd { get; }
    public IReadOnlyDictionary<string, string> Kv { get; }
    public IReadOnlyList<string> Args { get; }
}
