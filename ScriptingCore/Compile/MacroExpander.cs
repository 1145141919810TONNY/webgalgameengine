using System;
using System.Collections.Generic;
using Shiori.Scripting.Parse;
using Shiori.Scripting.Schema;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Compile;

public sealed class MacroExpander
{
    /* 宏展开深度不设上限：循环嵌套由 stack 检测拦住，深度只受宏总数自然约束。
       depth 参数保留（仍逐层递增），仅用于未来可能的诊断与统计，不再参与判定。 */

    private readonly CommandRegistry _registry;

    public MacroExpander(CommandRegistry registry)
    {
        _registry = registry ?? throw new ArgumentNullException(nameof(registry));
    }

    /// <summary>
    /// 展开一次调用。hit 非空时，本次（含嵌套）实际命中的宏名写入其中，
    /// 供调用方按"行"或按"剧本"维度统计；未注册的伪宏不会被计入。
    /// </summary>
    public List<RawCall> Expand(RawCall call, DiagnosticBag diagnostics, ISet<string>? hit = null)
    {
        var result = new List<RawCall>();
        ExpandInto(call, diagnostics, 0, result, new HashSet<string>(StringComparer.OrdinalIgnoreCase), hit);
        return result;
    }

    private void ExpandInto(
        RawCall call,
        DiagnosticBag diagnostics,
        int depth,
        List<RawCall> output,
        HashSet<string> stack,
        ISet<string>? hit)
    {
        if (!_registry.TryGetMacro(call.Name, out var macro) || macro == null)
        {
            output.Add(call);
            return;
        }

        // 命中宏（含嵌套展开）即记为"本次展开实际生效的宏"
        hit?.Add(call.Name);

        if (!stack.Add(call.Name))
        {
            diagnostics.Add(DiagnosticSeverity.Error, "宏循环嵌套: " + call.Name, call.Span);
            return;
        }

        var bound = Bind(macro, call);
        foreach (var step in macro.Steps)
        {
            var next = new RawCall
            {
                Name = step.Cmd,
                Span = call.Span,
                Surface = call.Surface
            };
            foreach (var kv in step.Kv)
                next.Kv[kv.Key] = Substitute(kv.Value, bound);
            foreach (var a in step.Args)
                next.Args.Add(Substitute(a, bound));

            if (_registry.TryGetMacro(next.Name, out _))
                ExpandInto(next, diagnostics, depth + 1, output, stack, hit);
            else
                output.Add(next);
        }

        stack.Remove(call.Name);
    }

    private static Dictionary<string, string> Bind(MacroSchema macro, RawCall call)
    {
        var bound = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var pos = 0;
        foreach (var p in macro.Parameters)
        {
            if (call.Kv.TryGetValue(p.Name, out var named))
                bound[p.Name] = named;
            else if (pos < call.Args.Count)
                bound[p.Name] = call.Args[pos++];
            else if (p.DefaultValue != null)
                bound[p.Name] = Convert.ToString(p.DefaultValue) ?? "";
            else
                bound[p.Name] = "";
        }

        return bound;
    }

    private static string Substitute(string template, Dictionary<string, string> bound)
    {
        if (string.IsNullOrEmpty(template) || template[0] != '%')
            return template;
        var key = template.Substring(1);
        return bound.TryGetValue(key, out var v) ? v : "";
    }
}
