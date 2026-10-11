using System;
using System.Collections.Generic;
using Shiori.Scripting.Parse;
using Shiori.Scripting.Schema;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Load;

/// <summary>.ks 宏定义源：[macro name=]…[endmacro]，宏体仅 []，wait click 为编译错误。</summary>
public static class KsMacroParser
{
    public static IReadOnlyList<MacroSchema> Parse(string source, string file, DiagnosticBag bag)
    {
        if (bag == null) throw new ArgumentNullException(nameof(bag));
        var macros = new List<MacroSchema>();
        if (string.IsNullOrEmpty(source)) return macros;

        var parser = new Parser();
        var calls = parser.ParseField(source, file, 0);
        string? currentName = null;
        var currentParams = new List<ParamSchema>();
        var currentSteps = new List<MacroStep>();
        var paramSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var currentHasError = false;

        foreach (var call in calls)
        {
            if (string.Equals(call.Name, "macro", StringComparison.OrdinalIgnoreCase))
            {
                if (currentName != null)
                    bag.Add(DiagnosticSeverity.Error, "宏未闭合: " + currentName, call.Span, "补 [endmacro]");
                currentName = call.Kv.TryGetValue("name", out var n) ? n : "";
                if (string.IsNullOrWhiteSpace(currentName))
                {
                    bag.Add(DiagnosticSeverity.Error, "[macro] 缺少 name", call.Span);
                    currentName = null;
                    currentHasError = true;
                    continue;
                }
                currentParams = new List<ParamSchema>();
                currentSteps = new List<MacroStep>();
                paramSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                currentHasError = false;
                continue;
            }

            if (string.Equals(call.Name, "endmacro", StringComparison.OrdinalIgnoreCase))
            {
                if (currentName == null)
                {
                    bag.Add(DiagnosticSeverity.Error, "孤立的 [endmacro]", call.Span);
                    continue;
                }
                if (!currentHasError)
                    macros.Add(new MacroSchema(currentName, currentParams.ToArray(), currentSteps));
                currentName = null;
                currentHasError = false;
                continue;
            }

            if (currentName == null)
            {
                bag.Add(DiagnosticSeverity.Warn, "宏体外指令已忽略: " + call.Name, call.Span);
                continue;
            }

            if (IsIllegalMacroWait(call.Name, call.Kv))
            {
                bag.Add(DiagnosticSeverity.Error,
                    string.Equals(call.Name, "s", StringComparison.OrdinalIgnoreCase)
                        ? "宏体内禁止 [s]（等同 wait click）"
                        : "宏体内 wait 只允许定时推进，禁止 [wait click]",
                    call.Span, "写成 [wait time=%time|毫秒]");
                currentHasError = true;
                continue;
            }

            var kv = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var pair in call.Kv)
            {
                kv[pair.Key] = AbsorbParam(pair.Value, currentParams, paramSeen);
            }
            var args = new List<string>();
            foreach (var a in call.Args)
                args.Add(AbsorbParam(a, currentParams, paramSeen));
            currentSteps.Add(new MacroStep(call.Name, kv, args));
        }

        if (currentName != null)
            bag.Add(DiagnosticSeverity.Error, "宏未闭合: " + currentName, new SourceSpan { File = file }, "补 [endmacro]");

        return macros;
    }

    public static bool IsIllegalMacroWait(string cmd, IReadOnlyDictionary<string, string>? kv)
    {
        if (string.Equals(cmd, "s", StringComparison.OrdinalIgnoreCase))
            return true;
        if (!string.Equals(cmd, "wait", StringComparison.OrdinalIgnoreCase))
            return false;
        if (kv == null) return true;
        return !kv.TryGetValue("time", out var t) || string.IsNullOrWhiteSpace(t);
    }

    private static string AbsorbParam(string raw, List<ParamSchema> parameters, HashSet<string> seen)
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
