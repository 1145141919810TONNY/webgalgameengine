using System.Text;
using System.Text.RegularExpressions;

namespace Shiori.Scripting.Validate;

/// <summary>
/// 条件表达式的书写规则：归一化 + 白名单校验。
/// 条件表达式最终交给 JS 求值，因此只放行三个变量空间前缀的标识符、数字
/// 与比较/逻辑运算符；条件区里单独的 = 会被当成 == （= 在 JS 里是赋值，
/// 写进条件会恒真并真的改变量值）。
/// 运行时 system/vars.js 用同一套口径判定，两处需保持一致。
/// </summary>
public static class ConditionRules
{
    // 变量空间前缀 + 标识符（允许中文变量名，与 VarSpace.parseName 的宽松命名一致）
    private const string Ident = @"(?:f|sf|tf)\.[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*";

    /// <summary>条件区里单独的 = （前后不接 = &lt; &gt; !）→ ==。</summary>
    private static readonly Regex SingleEquals = new Regex(@"(^|[^=<>!])=(?!=)", RegexOptions.Compiled);

    /// <summary>允许出现的词法片段：变量、数字、运算符。</summary>
    private static readonly Regex AllowedToken = new Regex(
        Ident + @"|\d+(?:\.\d+)?|==|!=|>=|<=|&&|\|\||[><!()]",
        RegexOptions.Compiled);

    /// <summary>把条件区里的 = 归一化为 ==。非条件位置不受影响。</summary>
    public static string Normalize(string? expression)
    {
        if (string.IsNullOrEmpty(expression)) return expression ?? "";
        return SingleEquals.Replace(expression, "$1==");
    }

    /// <summary>该条件是否因把 = 当 == 用而被归一化过（用于提示作者改写法）。</summary>
    public static bool WasAssignment(string? expression)
        => !string.IsNullOrEmpty(expression) && Normalize(expression) != expression;

    /// <summary>返回条件里不受支持的片段；完全合法时返回空串。</summary>
    public static string FindUnsupported(string? expression)
    {
        var rest = AllowedToken.Replace(Normalize(expression), " ");
        var sb = new StringBuilder();
        foreach (var ch in rest)
            if (!char.IsWhiteSpace(ch)) sb.Append(ch);
        return sb.ToString();
    }

    public static bool IsValid(string? expression) => FindUnsupported(expression).Length == 0;

    public const string WhitelistHint =
        "条件区只允许 f. / sf. / tf. 变量、数字与 == != > >= < <= && || ! ( )";
}
