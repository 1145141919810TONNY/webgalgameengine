using System;
using System.Collections.Generic;

namespace Shiori.Scripting.Parse;

public sealed class SourceSpan
{
    public string File { get; set; } = "";
    public int Line { get; set; }
    public int Column { get; set; }
}

public abstract class DslNode
{
    public abstract string Kind { get; }
    public SourceSpan Span { get; set; } = new SourceSpan();
}

public sealed class ResourceOp : DslNode
{
    public override string Kind => "resource";
    public string Type { get; set; } = "";
    public string Key { get; set; } = "";
}

public sealed class InstructionOp : DslNode
{
    public override string Kind => "inst";
    public string Cmd { get; set; } = "";
    public List<object?> Args { get; set; } = new List<object?>();
    public Dictionary<string, object?> Kv { get; set; } =
        new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
    public string Source { get; set; } = "builtin";
}

public sealed class TextOp : DslNode
{
    public override string Kind => "text";
    public List<TextRun> Runs { get; set; } = new List<TextRun>();
}

public sealed class TextRun
{
    public string? T { get; set; }
    public bool S { get; set; }
    public bool A { get; set; }
    public string? Ruby { get; set; }
    public string? Base { get; set; }
}

public sealed class BranchOp : DslNode
{
    public override string Kind => "branch";
    public string Type { get; set; } = "";
    public object? Data { get; set; }
}

public sealed class WaitOp : DslNode
{
    public override string Kind => "wait";
    public string Mode { get; set; } = "click";
    public int? Ms { get; set; }
}

/// <summary>
/// $ 变量语句区（command 字段以 $ 引导）编译出的节点。
/// Program 是 VarProgramParser 的解析结果，运行时按它执行；
/// 节点本身不含求值逻辑，只承载解析产物与源码位置。
/// </summary>
public sealed class VarOp : DslNode
{
    public override string Kind => "vars";
    public VarProgram Program { get; set; } = new VarProgram();
}

public sealed class RawCall
{
    public string Name { get; set; } = "";
    public List<string> Args { get; set; } = new List<string>();
    public Dictionary<string, string> Kv { get; set; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    public SourceSpan Span { get; set; } = new SourceSpan();
    public string Surface { get; set; } = "bracket";
}
