using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Parse;

/// <summary>一条变量语句：ns.name op value（value 为字面量或变量引用）。</summary>
public sealed class VarStatement
{
    public string Ns { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>= += -= *= /= ++ -- noop</summary>
    public string Op { get; set; } = "=";
    /// <summary>lit = 字面量，ref = 引用另一个变量</summary>
    public string ValueKind { get; set; } = "lit";
    public object? Value { get; set; }
}

/// <summary>一段条件分支：cond 为空表示无条件顺次执行。</summary>
public sealed class VarBranch
{
    public string? Cond { get; set; }
    public List<VarStatement> Then { get; } = new List<VarStatement>();
    public List<VarStatement> Else { get; } = new List<VarStatement>();
}

/// <summary>$ 变量语句区的解析结果。</summary>
public sealed class VarProgram
{
    public List<VarBranch> Branches { get; } = new List<VarBranch>();
}

/// <summary>
/// $ 变量语句区解析：只解析引擎定义的语句，不执行任意 JS，因此没有注入面。
/// 词面：$ 行首引导；?条件 引导条件；| 分隔真假分支；; 分隔语句。
/// 语句：ns.name = 值 / += -= *= /= 值 / ++ / -- / ~（保持不变）。
/// 值只接受数字、true、false、引号字符串与另一个变量的引用。
/// </summary>
public static class VarProgramParser
{
    private const string Ns = "(f|sf|tf)";
    private const string Id = @"[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*";

    private static readonly Regex StInc = new Regex(
        "^" + Ns + @"\.(" + Id + @")\s*(\+\+|--)$", RegexOptions.Compiled);
    private static readonly Regex StCompound = new Regex(
        "^" + Ns + @"\.(" + Id + @")\s*(\+=|-=|\*=|\/=)\s*(.+)$", RegexOptions.Compiled);
    private static readonly Regex StCompare = new Regex(
        "^" + Ns + @"\.(" + Id + @")\s*==\s*(.+)$", RegexOptions.Compiled);
    private static readonly Regex StAssign = new Regex(
        "^" + Ns + @"\.(" + Id + @")\s*=\s*(.+)$", RegexOptions.Compiled);
    private static readonly Regex StShort = new Regex(
        "^" + Ns + @"\.(" + Id + @")\s*([+-])\s*(\d+(?:\.\d+)?)$", RegexOptions.Compiled);
    private static readonly Regex StRef = new Regex(
        "^" + Ns + @"\.(" + Id + @")$", RegexOptions.Compiled);
    private static readonly Regex StNumber = new Regex(@"^-?\d+(?:\.\d+)?$", RegexOptions.Compiled);

    /// <summary>解析整段 $ 区；语法问题写入 diagnostics，已解析出的合法语句仍然保留。</summary>
    public static VarProgram Parse(string field, SourceSpan span, DiagnosticBag diagnostics)
    {
        var program = new VarProgram();
        var text = (field ?? "").Trim();
        if (text.StartsWith("$", StringComparison.Ordinal)) text = text.Substring(1).Trim();

        if (text.Length == 0)
        {
            diagnostics.Add(DiagnosticSeverity.Error, "$ 之后没有任何变量语句", span);
            return program;
        }

        var branch = new VarBranch();

        if (text[0] == '?')
        {
            var parts = SplitTopLevel(text.Substring(1), '|');
            if (parts.Count > 3)
                diagnostics.Add(DiagnosticSeverity.Error,
                    "$ 区里的 | 最多出现两次（?条件 | 真分支 | 假分支）", span);
            branch.Cond = parts[0].Trim();
            if (branch.Cond.Length == 0)
                diagnostics.Add(DiagnosticSeverity.Error, "$ 区的 ? 之后缺少条件表达式", span);
            else if (branch.Cond != "#")
                CheckCondition(branch.Cond, span, diagnostics);

            if (parts.Count > 1) ParseStatements(parts[1], branch.Then, span, diagnostics, "真分支");
            if (parts.Count > 2) ParseStatements(parts[2], branch.Else, span, diagnostics, "假分支");
            // 只写 ?条件 | 真分支 时，条件不成立就什么都不做，不另加诊断。
        }
        else
        {
            ParseStatements(text, branch.Then, span, diagnostics, "语句");
        }

        program.Branches.Add(branch);
        return program;
    }

    private static void CheckCondition(string cond, SourceSpan span, DiagnosticBag diagnostics)
    {
        var bad = ConditionRules.FindUnsupported(cond);
        if (bad.Length > 0)
        {
            diagnostics.Add(DiagnosticSeverity.Error,
                "$ 区条件含不受支持的写法: " + bad, span, ConditionRules.WhitelistHint);
            return;
        }
        if (ConditionRules.WasAssignment(cond))
            diagnostics.Add(DiagnosticSeverity.Warn,
                "$ 区条件区里的 = 已按 == 处理: " + cond, span, "等值比较请写 ==");
    }

    private static void ParseStatements(
        string text, List<VarStatement> into, SourceSpan span, DiagnosticBag diagnostics, string label)
    {
        foreach (var piece in text.Split(';'))
        {
            var raw = piece.Trim();
            if (raw.Length == 0) continue;
            var one = ParseStatement(raw, span, diagnostics, label);
            if (one != null) into.Add(one);
        }
    }

    private static VarStatement? ParseStatement(
        string raw, SourceSpan span, DiagnosticBag diagnostics, string label)
    {
        if (raw == "~") return new VarStatement { Op = "noop" };

        Match m;
        if ((m = StInc.Match(raw)).Success)
            return Build(m.Groups[1].Value, m.Groups[2].Value, m.Groups[3].Value, "lit", 1, span, diagnostics, label);

        if ((m = StCompound.Match(raw)).Success)
            return WithValue(m.Groups[1].Value, m.Groups[2].Value, m.Groups[3].Value, m.Groups[4].Value,
                span, diagnostics, label);

        if (StCompare.IsMatch(raw))
        {
            diagnostics.Add(DiagnosticSeverity.Error,
                label + "里的 == 不是赋值: " + raw, span, "赋值用 =，== 只出现在条件区");
            return null;
        }

        if ((m = StAssign.Match(raw)).Success)
            return WithValue(m.Groups[1].Value, m.Groups[2].Value, "=", m.Groups[3].Value,
                span, diagnostics, label);

        // 简写形式 sf.dead+1 / sf.dead-1，等价于 += 1 / -= 1
        if ((m = StShort.Match(raw)).Success)
            return Build(m.Groups[1].Value, m.Groups[2].Value,
                m.Groups[3].Value == "+" ? "+=" : "-=",
                "lit", double.Parse(m.Groups[4].Value, CultureInfo.InvariantCulture),
                span, diagnostics, label);

        diagnostics.Add(DiagnosticSeverity.Error,
            "无法识别的变量语句: " + raw, span, "形如 sf.dead += 1 / f.flag = 1 / tf.n++");
        return null;
    }

    private static VarStatement? WithValue(
        string ns, string name, string op, string rawValue,
        SourceSpan span, DiagnosticBag diagnostics, string label)
    {
        var (kind, value, error) = ParseValue(rawValue);
        if (error != null)
        {
            diagnostics.Add(DiagnosticSeverity.Error,
                label + "的赋值不受支持: " + error, span,
                "值只接受数字 / true / false / 引号字符串 / 另一个 f. sf. tf. 变量");
            return null;
        }
        return Build(ns, name, op, kind, value, span, diagnostics, label);
    }

    private static VarStatement? Build(
        string ns, string name, string op, string kind, object? value,
        SourceSpan span, DiagnosticBag diagnostics, string label)
    {
        if (IsWriteProtected(ns, name))
        {
            diagnostics.Add(DiagnosticSeverity.Error,
                label + "企图改写系统变量 " + ns + "." + name, span,
                "tf.allclear 由宿主调试菜单维护，剧本不可改写");
            return null;
        }
        if (IsClearFlag(ns, name) && !IsClearFlagValue(op, kind, value))
        {
            diagnostics.Add(DiagnosticSeverity.Error,
                label + "里的 sf.clear 只能置 1", span,
                "0 只是默认值；置 1 后不可由剧本回退，清零请用设置的「清除存档」功能");
            return null;
        }
        return new VarStatement { Ns = ns, Name = name, Op = op, ValueKind = kind, Value = value };
    }

    /// <summary>tf.allclear 是宿主调试菜单「开启全部鉴赏」的开关，剧本不可改写。</summary>
    public static bool IsWriteProtected(string ns, string name)
        => ns == "tf" && name == "allclear";

    /// <summary>sf.clear 是通关标识，剧本可写（跨会话留存）。</summary>
    public static bool IsClearFlag(string ns, string name)
        => ns == "sf" && name == "clear";

    /// <summary>sf.clear 只接受 <c>= 1</c>：0 只是默认值，其余运算符、变量引用与其它值都不允许。</summary>
    private static bool IsClearFlagValue(string op, string kind, object? value)
        => op == "=" && kind == "lit" && value is double d && d == 1;

    private static (string kind, object? value, string? error) ParseValue(string raw)
    {
        var s = (raw ?? "").Trim();
        if (s.Length == 0) return ("lit", null, "赋值为空");

        var m = StRef.Match(s);
        if (m.Success) return ("ref", m.Groups[1].Value + "." + m.Groups[2].Value, null);

        if (s == "true") return ("lit", true, null);
        if (s == "false") return ("lit", false, null);
        if (StNumber.IsMatch(s))
            return ("lit", double.Parse(s, CultureInfo.InvariantCulture), null);

        if (s.Length >= 2 && (s[0] == '"' || s[0] == '\'') && s[s.Length - 1] == s[0])
            return ("lit", s.Substring(1, s.Length - 2), null);

        return ("lit", null, s);
    }

    /// <summary>按 sep 切分，但把成对的 sep（如条件里的 || ）当一个整体，不当作分隔符。</summary>
    private static List<string> SplitTopLevel(string text, char sep)
    {
        var parts = new List<string>();
        var buf = new System.Text.StringBuilder();
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c == sep && i + 1 < text.Length && text[i + 1] == sep)
            {
                buf.Append(c).Append(c);
                i++;
                continue;
            }
            if (c == sep)
            {
                parts.Add(buf.ToString());
                buf.Clear();
                continue;
            }
            buf.Append(c);
        }
        parts.Add(buf.ToString());
        return parts;
    }
}
