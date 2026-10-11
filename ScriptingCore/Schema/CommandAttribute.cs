using System;

namespace Shiori.Scripting.Schema;

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public sealed class CmdAttribute : Attribute
{
    public CmdAttribute(string name, params string[] aliases)
    {
        Name = name ?? throw new ArgumentNullException(nameof(name));
        Aliases = aliases ?? Array.Empty<string>();
    }

    public string Name { get; }
    public string[] Aliases { get; }
}

public sealed class ParamSchema
{
    public ParamSchema(string name, string type, bool optional = true, object? defaultValue = null, string? label = null)
    {
        Name = name;
        Type = type;
        Optional = optional;
        DefaultValue = defaultValue;
        Label = string.IsNullOrEmpty(label) ? name : label;
    }

    public string Name { get; }
    public string Type { get; }
    public bool Optional { get; }
    public object? DefaultValue { get; }
    public string Label { get; }
}

public sealed class CommandSchema
{
    public CommandSchema(
        string name,
        string[]? aliases = null,
        ParamSchema[]? positional = null,
        ParamSchema[]? named = null,
        string source = "builtin",
        string? label = null)
    {
        Name = name;
        Aliases = aliases ?? Array.Empty<string>();
        Positional = positional ?? Array.Empty<ParamSchema>();
        Named = named ?? Array.Empty<ParamSchema>();
        Source = source;
        Label = string.IsNullOrEmpty(label) ? name : label;
    }

    public string Name { get; }
    public string[] Aliases { get; }
    public ParamSchema[] Positional { get; }
    public ParamSchema[] Named { get; }
    public string Source { get; }
    public string Label { get; }
}
