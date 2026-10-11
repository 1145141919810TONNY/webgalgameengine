using System.Collections.Generic;
using System.Text.Encodings.Web;
using System.Text.Json;
using Shiori.Scripting.Parse;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Emit;

/// <summary>统一指令树 → 页面/桥可消费 JSON 对象。</summary>
public static class DslNodeJson
{
    public static readonly JsonSerializerOptions Options = new JsonSerializerOptions
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static JsonElement ToJson(DslNode node)
    {
        object payload = node switch
        {
            WaitOp w when w.Ms.HasValue => new
            {
                kind = "wait",
                mode = w.Mode,
                ms = w.Ms.Value,
                file = w.Span.File,
                line = w.Span.Line,
                col = w.Span.Column
            },
            WaitOp w => new
            {
                kind = "wait",
                mode = w.Mode,
                file = w.Span.File,
                line = w.Span.Line,
                col = w.Span.Column
            },
            InstructionOp inst => new
            {
                kind = "inst",
                cmd = inst.Cmd,
                args = inst.Args,
                kv = inst.Kv,
                source = inst.Source,
                file = inst.Span.File,
                line = inst.Span.Line,
                col = inst.Span.Column
            },
            ResourceOp res => new
            {
                kind = "resource",
                type = res.Type,
                key = res.Key,
                file = res.Span.File,
                line = res.Span.Line,
                col = res.Span.Column
            },
            TextOp text => new
            {
                kind = "text",
                runs = text.Runs,
                file = text.Span.File,
                line = text.Span.Line,
                col = text.Span.Column
            },
            BranchOp br => new
            {
                kind = "branch",
                type = br.Type,
                data = br.Data,
                file = br.Span.File,
                line = br.Span.Line,
                col = br.Span.Column
            },
            VarOp v => new
            {
                kind = "vars",
                program = new
                {
                    branches = ToBranches(v.Program)
                },
                file = v.Span.File,
                line = v.Span.Line,
                col = v.Span.Column
            },
            _ => new { kind = node.Kind, file = node.Span.File, line = node.Span.Line, col = node.Span.Column }
        };
        return JsonSerializer.SerializeToElement(payload, Options);
    }

    /// <summary>$ 区解析结果 → 运行时可消费的分支数组。</summary>
    private static List<object> ToBranches(VarProgram program)
    {
        var list = new List<object>();
        foreach (var b in program.Branches)
        {
            list.Add(new
            {
                cond = b.Cond,
                then = ToStatements(b.Then),
                @else = ToStatements(b.Else)
            });
        }
        return list;
    }

    private static List<object> ToStatements(List<VarStatement> items)
    {
        var list = new List<object>();
        foreach (var s in items)
        {
            list.Add(new
            {
                ns = s.Ns,
                name = s.Name,
                op = s.Op,
                kind = s.ValueKind,
                value = s.Value
            });
        }
        return list;
    }

    public static JsonElement DiagnosticsToJson(IEnumerable<Diagnostic> items)
    {
        var list = new List<object>();
        foreach (var d in items)
        {
            list.Add(new
            {
                severity = d.Severity.ToString().ToLowerInvariant(),
                message = d.Message,
                suggestion = d.Suggestion,
                file = d.Span.File,
                line = d.Span.Line,
                col = d.Span.Column
            });
        }
        return JsonSerializer.SerializeToElement(list, Options);
    }
}
