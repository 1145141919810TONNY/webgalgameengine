using System.Collections.Generic;

namespace Shiori.Scripting.Parse;

/// <summary>P1/P2 词面 → RawCall 列表。按 '[' / '@' 切分，不按逗号劈开指令体。</summary>
public sealed class Parser
{
    private readonly Lexer _lexer = new Lexer();

    public List<RawCall> ParseField(string field, string file = "", int line = 0)
    {
        var calls = new List<RawCall>();
        if (string.IsNullOrWhiteSpace(field)) return calls;

        var i = 0;
        while (i < field.Length)
        {
            SkipWsAndComma(field, ref i);
            if (i >= field.Length) break;
            if (field[i] == '[')
            {
                var start = i;
                var end = field.IndexOf(']', i + 1);
                if (end < 0) end = field.Length - 1;
                else end += 1;
                var inner = end > start + 1
                    ? field.Substring(start + 1, (end - 1) - (start + 1))
                    : "";
                calls.Add(ParseCallBody(inner, file, line, start, "bracket"));
                i = end;
            }
            else if (field[i] == '@')
            {
                var start = i;
                i++;
                var end = FindAtEnd(field, i);
                var inner = field.Substring(i, end - i).Trim();
                calls.Add(ParseCallBody(inner, file, line, start, "at"));
                i = end;
            }
            else
            {
                i++;
            }
        }

        return calls;
    }

    private RawCall ParseCallBody(string body, string file, int line, int col, string surface)
    {
        var call = new RawCall
        {
            Surface = surface,
            Span = new SourceSpan { File = file, Line = line, Column = col }
        };
        var parts = SplitWsQuoted(body);
        if (parts.Count == 0) return call;
        call.Name = parts[0];
        var i = 1;
        while (i < parts.Count)
        {
            var p = parts[i];
            if (p == ",") { i++; continue; }
            var eq = p.IndexOf('=');
            if (eq > 0)
            {
                call.Kv[p.Substring(0, eq)] = p.Substring(eq + 1);
                i++;
                continue;
            }
            if (i + 2 < parts.Count && parts[i + 1] == "=")
            {
                call.Kv[p] = parts[i + 2];
                i += 3;
                continue;
            }
            if (i + 1 < parts.Count && parts[i + 1].Length > 1 && parts[i + 1][0] == '=')
            {
                call.Kv[p] = parts[i + 1].Substring(1);
                i += 2;
                continue;
            }
            call.Args.Add(p);
            i++;
        }
        return call;
    }

    internal static List<string> SplitWsQuoted(string body)
    {
        var parts = new List<string>();
        if (string.IsNullOrEmpty(body)) return parts;
        var i = 0;
        while (i < body.Length)
        {
            while (i < body.Length && (char.IsWhiteSpace(body[i]) || body[i] == ',')) i++;
            if (i >= body.Length) break;
            if (body[i] == '"' || body[i] == '\'')
            {
                var q = body[i++];
                var sb = new System.Text.StringBuilder();
                while (i < body.Length && body[i] != q)
                {
                    if (body[i] == '\\' && i + 1 < body.Length)
                    {
                        i++;
                        sb.Append(body[i++]);
                    }
                    else sb.Append(body[i++]);
                }
                if (i < body.Length) i++;
                parts.Add(sb.ToString());
                continue;
            }
            var start = i;
            while (i < body.Length && !char.IsWhiteSpace(body[i]) && body[i] != ',') i++;
            parts.Add(body.Substring(start, i - start));
        }
        return parts;
    }

    private static void SkipWsAndComma(string field, ref int i)
    {
        while (i < field.Length && (char.IsWhiteSpace(field[i]) || field[i] == ','))
            i++;
    }

    private static int FindAtEnd(string field, int i)
    {
        while (i < field.Length)
        {
            var c = field[i];
            if (c == '[' || c == '@') return i;
            if (c == ',') return i;
            i++;
        }
        return field.Length;
    }
}
