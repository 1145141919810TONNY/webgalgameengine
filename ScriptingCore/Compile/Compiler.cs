using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using Shiori.Scripting.Parse;
using Shiori.Scripting.Schema;
using Shiori.Scripting.Text;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Compile;

/// <summary>RawCall / ops JSON → 统一指令树（WaitOp / InstructionOp / …）。</summary>
public sealed class Compiler
{
    private readonly CommandRegistry _registry;
    private readonly Parser _parser = new Parser();
    private readonly MacroExpander _expander;

    public Compiler(CommandRegistry? registry = null)
    {
        _registry = registry ?? CommandRegistry.CreateDefault();
        _expander = new MacroExpander(_registry);
    }

    public CommandRegistry Registry => _registry;

    public CompileResult CompileCommandField(string field, string file = "", int line = 0, ISet<string>? macros = null)
    {
        var diagnostics = new DiagnosticBag();
        var nodes = new List<DslNode>();

        // $ 引导的变量语句区：整个字段是一段变量语句，不按 [标签] / @宏 解析。
        var text = (field ?? "").TrimStart();
        if (text.StartsWith("$", StringComparison.Ordinal))
        {
            var span = new SourceSpan { File = file, Line = line, Column = (field ?? "").IndexOf('$') };
            nodes.Add(new VarOp { Program = VarProgramParser.Parse(field!, span, diagnostics), Span = span });
            return new CompileResult(nodes, diagnostics, macros);
        }
        // $ 出现在字段中段时不会被任何一方解析，明确报出来，避免静默失效。
        if (text.IndexOf('$') >= 0)
            diagnostics.Add(DiagnosticSeverity.Warn,
                "变量语句区必须由 $ 引导整个 command 字段，此处中段的 $ 不会被解析",
                new SourceSpan { File = file, Line = line },
                "把变量语句单独写成一行，command 以 $ 开头");

        var calls = _parser.ParseField(field!, file, line);
        foreach (var call in calls)
            AppendCall(call, nodes, diagnostics, macros);
        return new CompileResult(nodes, diagnostics, macros);
    }

    public CompileResult CompileOps(JsonElement ops, string file = "", int line = 0, ISet<string>? macros = null)
    {
        var diagnostics = new DiagnosticBag();
        var nodes = new List<DslNode>();
        if (ops.ValueKind != JsonValueKind.Array)
            return new CompileResult(nodes, diagnostics, macros);
        foreach (var el in ops.EnumerateArray())
        {
            var call = OpsToCall(el, file, line);
            if (call != null)
                AppendCall(call, nodes, diagnostics, macros);
        }
        return new CompileResult(nodes, diagnostics, macros);
    }

    public CompileResult CompileLine(JsonElement line, string file = "", int lineNo = 0)
    {
        var diagnostics = new DiagnosticBag();
        var nodes = new List<DslNode>();

        // 本行实际展开命中的宏（忽略大小写去重）。贯穿本行的各个字段（ops / chars / command），
        // 编译结束后随 CompileResult 一起交出，供调试面板按"当前行"展示。
        var lineMacros = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        AddResource(line, "background", "background", nodes);
        AddResource(line, "bgm", "bgm", nodes);
        AddResource(line, "se", "se", nodes);
        AddResource(line, "videos", "video", nodes);

        if (line.TryGetProperty("ops", out var ops) && ops.ValueKind == JsonValueKind.Array)
        {
            var r = CompileOps(ops, file, lineNo, lineMacros);
            nodes.AddRange(r.Nodes);
            foreach (var d in r.Diagnostics.Items) diagnostics.Add(d.Severity, d.Message, d.Span, d.Suggestion);
        }

        if (TryGetString(line, "chars", out var chars) && !string.IsNullOrWhiteSpace(chars))
        {
            foreach (var call in _parser.ParseField(chars, file, lineNo))
            {
                if (string.IsNullOrEmpty(call.Name)) continue;
                if (!_registry.TryGet(call.Name, out _) && !_registry.TryGetMacro(call.Name, out _))
                {
                    call.Args.Insert(0, call.Name);
                    call.Name = "char";
                }
                AppendCall(call, nodes, diagnostics, lineMacros);
            }
        }

        if (TryGetString(line, "command", out var command) && !string.IsNullOrWhiteSpace(command))
        {
            var r = CompileCommandField(command, file, lineNo, lineMacros);
            nodes.AddRange(r.Nodes);
            foreach (var d in r.Diagnostics.Items) diagnostics.Add(d.Severity, d.Message, d.Span, d.Suggestion);
        }

        if (TryGetString(line, "text", out var text))
            nodes.Add(new TextOp { Runs = InlineSplitter.Split(text), Span = new SourceSpan { File = file, Line = lineNo } });

        if (line.TryGetProperty("action", out var action))
        {
            var span = new SourceSpan { File = file, Line = lineNo };
            if (action.ValueKind == JsonValueKind.Object)
            {
                nodes.Add(new BranchOp
                {
                    Type = TryGetString(action, "type", out var t) ? t! : "choice",
                    Data = action.GetRawText(),
                    Span = span
                });
            }
            else if (action.ValueKind == JsonValueKind.Array)
            {
                // 数组 = 一条 else-if 链，整体记为一个 chain 节点，分支条件逐个校验。
                nodes.Add(new BranchOp { Type = "chain", Data = action.GetRawText(), Span = span });
            }

            if (action.ValueKind == JsonValueKind.Object || action.ValueKind == JsonValueKind.Array)
                ValidateAction(action, span, diagnostics);
        }

        return new CompileResult(nodes, diagnostics, lineMacros);
    }

    /// <summary>
    /// 校验 action 里的分支条件：条件表达式白名单、条件区里的 =（按 == 处理并提示）、
    /// else-if 链的兜底项位置。只报问题，不改写剧本数据。
    /// </summary>
    private void ValidateAction(JsonElement action, SourceSpan span, DiagnosticBag diagnostics)
    {
        if (action.ValueKind == JsonValueKind.Object)
        {
            ValidateActionBody(action, span, diagnostics);
            return;
        }

        var entries = new List<JsonElement>();
        foreach (var el in action.EnumerateArray())
            if (el.ValueKind == JsonValueKind.Object) entries.Add(el);

        if (entries.Count == 0)
        {
            diagnostics.Add(DiagnosticSeverity.Error, "action 数组里没有任何分支项", span);
            return;
        }

        var hasFallback = false;
        for (var i = 0; i < entries.Count; i++)
        {
            ValidateActionBody(entries[i], span, diagnostics);
            if (!IsFallbackEntry(entries[i])) continue;
            hasFallback = true;
            if (i != entries.Count - 1)
                diagnostics.Add(DiagnosticSeverity.Warn,
                    "省略 when 的分支项恒真，会遮蔽它后面的分支，应放在链末", span);
        }
        if (!hasFallback)
            diagnostics.Add(DiagnosticSeverity.Warn,
                "action 链没有兜底项，全部条件不成立时本行不产生任何动作", span,
                "把最后一项的 when 去掉即可兜底");
    }

    private void ValidateActionBody(JsonElement body, SourceSpan span, DiagnosticBag diagnostics)
    {
        if (body.TryGetProperty("when", out var when))
            ValidateCondition(when, span, diagnostics, "when");

        if (!body.TryGetProperty("choices", out var choices) || choices.ValueKind != JsonValueKind.Array)
            return;
        foreach (var c in choices.EnumerateArray())
        {
            if (c.ValueKind != JsonValueKind.Object) continue;
            if (c.TryGetProperty("when", out var cw))
                ValidateCondition(cw, span, diagnostics, "choices[].when");
        }
    }

    private static void ValidateCondition(
        JsonElement el, SourceSpan span, DiagnosticBag diagnostics, string where)
    {
        if (el.ValueKind != JsonValueKind.String) return;
        var cond = el.GetString() ?? "";
        if (string.IsNullOrWhiteSpace(cond)) return;

        var bad = ConditionRules.FindUnsupported(cond);
        if (bad.Length > 0)
        {
            diagnostics.Add(DiagnosticSeverity.Error,
                where + " 含不受支持的写法: " + bad, span, ConditionRules.WhitelistHint);
            return;
        }
        if (ConditionRules.WasAssignment(cond))
            diagnostics.Add(DiagnosticSeverity.Warn,
                where + " 条件区里的 = 已按 == 处理: " + cond, span, "等值比较请写 ==");
    }

    private static bool IsFallbackEntry(JsonElement entry)
    {
        if (entry.TryGetProperty("when", out var w) && w.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(w.GetString()))
            return false;
        if (entry.TryGetProperty("flag", out var f) && f.ValueKind == JsonValueKind.String)
        {
            var s = f.GetString();
            if (!string.IsNullOrEmpty(s)) return s == "#";      // flag 有值时：'#' 恒真，其余按变量判定
        }
        return true;
    }

    private void AppendCall(RawCall call, List<DslNode> nodes, DiagnosticBag diagnostics, ISet<string>? macros)
    {
        if (string.IsNullOrWhiteSpace(call.Name)) return;

        var expanded = _expander.Expand(call, diagnostics, macros);
        foreach (var item in expanded)
            nodes.Add(Lower(item, diagnostics));
    }

    private DslNode Lower(RawCall call, DiagnosticBag diagnostics)
    {
        var name = call.Name;
        if (IsWait(name))
            return ToWait(call);

        if (name.Equals("s", StringComparison.OrdinalIgnoreCase))
            return new WaitOp { Mode = "click", Span = call.Span };

        if (IsResourceOff(call))
        {
            call.Kv["storage"] = name;
            call.Args.Clear();
            name = "off";
            call.Name = name;
        }
        else if (!_registry.TryGet(name, out _) && !_registry.TryGetMacro(name, out _) && call.Args.Count > 0)
        {
            call.Args.Insert(0, name);
            name = "char";
            call.Name = name;
        }

        if (!_registry.TryGet(name, out var schema) && !_registry.TryGetMacro(name, out _))
        {
            var msg = "未注册指令: " + name;
            switch (_registry.UnknownPolicy)
            {
                case UnknownCommandPolicy.Error:
                    diagnostics.Add(DiagnosticSeverity.Error, msg, call.Span, "在 Schema 注册或当正文处理");
                    break;
                case UnknownCommandPolicy.Ignore:
                    break;
                default:
                    diagnostics.Add(DiagnosticSeverity.Warn, msg, call.Span, "未注册指令按原文忽略");
                    break;
            }
        }

        var inst = new InstructionOp
        {
            Cmd = schema?.Name ?? name,
            Source = schema?.Source ?? "builtin",
            Span = call.Span
        };
        foreach (var a in call.Args) inst.Args.Add(Coerce(a));
        foreach (var kv in call.Kv) inst.Kv[kv.Key] = Coerce(kv.Value);

        if (name.Equals("pov", StringComparison.OrdinalIgnoreCase) && inst.Args.Count > 0 && !inst.Kv.ContainsKey("name"))
        {
            if (string.Equals(Convert.ToString(inst.Args[0]), "stop", StringComparison.OrdinalIgnoreCase))
                inst.Kv["stop"] = true;
            else
                inst.Kv["name"] = string.Join(" ", inst.Args.ConvertAll(x => Convert.ToString(x) ?? ""));
        }

        return inst;
    }

    private static bool IsResourceOff(RawCall call)
    {
        if (call.Args.Count == 0) return false;
        if (!string.Equals(call.Args[0], "off", StringComparison.OrdinalIgnoreCase))
            return false;
        return call.Name.IndexOf('.') >= 0;
    }

    private static bool IsWait(string name) =>
        name.Equals("wait", StringComparison.OrdinalIgnoreCase);

    private static WaitOp ToWait(RawCall call)
    {
        if (call.Kv.TryGetValue("time", out var timeRaw) && !string.IsNullOrWhiteSpace(timeRaw))
        {
            var ms = Lexer.TryParseInt(timeRaw) ?? 0;
            return new WaitOp { Mode = "time", Ms = ms, Span = call.Span };
        }

        return new WaitOp { Mode = "click", Span = call.Span };
    }

    private static RawCall? OpsToCall(JsonElement el, string file, int line)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        if (!el.TryGetProperty("cmd", out var cmdEl)) return null;
        var call = new RawCall
        {
            Name = cmdEl.GetString() ?? "",
            Span = new SourceSpan { File = file, Line = line },
            Surface = "ops"
        };
        foreach (var p in el.EnumerateObject())
        {
            if (p.NameEquals("cmd")) continue;
            call.Kv[p.Name] = JsonToString(p.Value);
        }
        return call;
    }

    private static void AddResource(JsonElement line, string prop, string type, List<DslNode> nodes)
    {
        if (TryGetString(line, prop, out var key) && !string.IsNullOrWhiteSpace(key))
            nodes.Add(new ResourceOp { Type = type, Key = key! });
    }

    private static bool TryGetString(JsonElement obj, string name, out string? value)
    {
        value = null;
        if (obj.ValueKind != JsonValueKind.Object) return false;
        if (!obj.TryGetProperty(name, out var el)) return false;
        if (el.ValueKind == JsonValueKind.String) { value = el.GetString(); return true; }
        if (el.ValueKind == JsonValueKind.Number) { value = el.GetRawText(); return true; }
        return false;
    }

    private static string JsonToString(JsonElement el)
    {
        return el.ValueKind == JsonValueKind.String ? (el.GetString() ?? "") : el.GetRawText();
    }

    private static object? Coerce(string value)
    {
        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n))
            return n;
        if (bool.TryParse(value, out var b))
            return b;
        return value;
    }
}

public sealed class CompileResult
{
    /// <summary>
    /// 本次编译实际展开命中的宏名（忽略大小写去重后按名排序）。无宏时为空列表。
    /// 逐行编译时即"当前行用到的宏"，编译整份剧本时也可由各行结果自行汇总。
    /// </summary>
    public IReadOnlyList<string> Macros { get; }

    public CompileResult(IReadOnlyList<DslNode> nodes, DiagnosticBag diagnostics, IEnumerable<string>? macros = null)
    {
        Nodes = nodes;
        Diagnostics = diagnostics;
        var list = macros == null ? new List<string>() : new List<string>(macros);
        list.Sort(StringComparer.OrdinalIgnoreCase);
        Macros = list;
    }

    public IReadOnlyList<DslNode> Nodes { get; }
    public DiagnosticBag Diagnostics { get; }
}
