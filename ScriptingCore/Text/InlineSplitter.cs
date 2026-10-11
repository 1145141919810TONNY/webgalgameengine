using System.Collections.Generic;
using System.Text.RegularExpressions;
using Shiori.Scripting.Parse;

namespace Shiori.Scripting.Text;

/// <summary>正文 [s]/[a]/ruby 规范拆解。绝不把未注册方括号当指令。</summary>
public static class InlineSplitter
{
    private static readonly Regex Token = new Regex(
        @"\[s\]|\[a\]|<ruby>(.*?)<rt>(.*?)</rt></ruby>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline);

    public static List<TextRun> Split(string? text)
    {
        var runs = new List<TextRun>();
        if (string.IsNullOrEmpty(text))
        {
            runs.Add(new TextRun { T = text ?? "" });
            return runs;
        }

        var idx = 0;
        foreach (Match m in Token.Matches(text))
        {
            if (m.Index > idx)
                runs.Add(new TextRun { T = text.Substring(idx, m.Index - idx) });
            var raw = m.Value;
            if (raw.Equals("[s]", System.StringComparison.OrdinalIgnoreCase))
                runs.Add(new TextRun { S = true });
            else if (raw.Equals("[a]", System.StringComparison.OrdinalIgnoreCase))
                runs.Add(new TextRun { A = true });
            else
                runs.Add(new TextRun { Base = m.Groups[1].Value, Ruby = m.Groups[2].Value });
            idx = m.Index + m.Length;
        }

        if (idx < text.Length)
            runs.Add(new TextRun { T = text.Substring(idx) });
        if (runs.Count == 0)
            runs.Add(new TextRun { T = text });
        return runs;
    }
}
