using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Shiori.Scripting.Parse;

public enum TokenKind
{
    LBracket,
    RBracket,
    At,
    Comma,
    Equals,
    Ident,
    Number,
    String,
    Eof
}

public readonly struct Token
{
    public Token(TokenKind kind, string value, int column)
    {
        Kind = kind;
        Value = value;
        Column = column;
    }

    public TokenKind Kind { get; }
    public string Value { get; }
    public int Column { get; }
}

/// <summary>P1 '[' 与 P2 '@' 双入口词法。</summary>
public sealed class Lexer
{
    public IReadOnlyList<Token> Tokenize(string input)
    {
        var tokens = new List<Token>();
        if (string.IsNullOrEmpty(input))
        {
            tokens.Add(new Token(TokenKind.Eof, "", 0));
            return tokens;
        }

        var i = 0;
        while (i < input.Length)
        {
            var c = input[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }
            var col = i;
            switch (c)
            {
                case '[': tokens.Add(new Token(TokenKind.LBracket, "[", col)); i++; break;
                case ']': tokens.Add(new Token(TokenKind.RBracket, "]", col)); i++; break;
                case '@': tokens.Add(new Token(TokenKind.At, "@", col)); i++; break;
                case ',': tokens.Add(new Token(TokenKind.Comma, ",", col)); i++; break;
                case '=': tokens.Add(new Token(TokenKind.Equals, "=", col)); i++; break;
                case '"':
                case '\'':
                    tokens.Add(ReadQuoted(input, ref i));
                    break;
                default:
                    if (IsNumberStart(input, i))
                        tokens.Add(ReadNumber(input, ref i));
                    else
                        tokens.Add(ReadIdent(input, ref i));
                    break;
            }
        }

        tokens.Add(new Token(TokenKind.Eof, "", i));
        return tokens;
    }

    private static bool IsNumberStart(string input, int i)
    {
        return char.IsDigit(input[i]) ||
               (input[i] == '-' && i + 1 < input.Length && char.IsDigit(input[i + 1]));
    }

    private static Token ReadNumber(string input, ref int i)
    {
        var col = i;
        var start = i;
        if (input[i] == '-') i++;
        while (i < input.Length && (char.IsDigit(input[i]) || input[i] == '.')) i++;
        return new Token(TokenKind.Number, input.Substring(start, i - start), col);
    }

    private static Token ReadIdent(string input, ref int i)
    {
        var col = i;
        var sb = new StringBuilder();
        while (i < input.Length)
        {
            var c = input[i];
            if (c == '[' || c == ']' || c == '@' || c == ',' || c == '=' || char.IsWhiteSpace(c))
                break;
            sb.Append(c);
            i++;
        }
        return new Token(TokenKind.Ident, sb.ToString(), col);
    }

    private static Token ReadQuoted(string input, ref int i)
    {
        var col = i;
        var quote = input[i++];
        var sb = new StringBuilder();
        while (i < input.Length && input[i] != quote)
        {
            if (input[i] == '\\' && i + 1 < input.Length)
            {
                i++;
                sb.Append(input[i++]);
            }
            else sb.Append(input[i++]);
        }
        if (i < input.Length) i++;
        return new Token(TokenKind.String, sb.ToString(), col);
    }

    public static int? TryParseInt(string value)
    {
        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n))
            return n;
        return null;
    }
}
