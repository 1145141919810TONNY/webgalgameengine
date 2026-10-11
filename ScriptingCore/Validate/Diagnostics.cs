using System.Collections.Generic;
using Shiori.Scripting.Parse;

namespace Shiori.Scripting.Validate;

public enum DiagnosticSeverity
{
    Info,
    Warn,
    Error
}

public sealed class Diagnostic
{
    public DiagnosticSeverity Severity { get; set; }
    public string Message { get; set; } = "";
    public string? Suggestion { get; set; }
    public SourceSpan Span { get; set; } = new SourceSpan();

    public override string ToString()
    {
        var loc = string.IsNullOrEmpty(Span.File)
            ? $"{Span.Line}:{Span.Column}"
            : $"{Span.File}:{Span.Line}:{Span.Column}";
        var s = $"[{Severity}] {loc} {Message}";
        if (!string.IsNullOrEmpty(Suggestion))
            s += " 建议: " + Suggestion;
        return s;
    }
}

public sealed class DiagnosticBag
{
    private readonly List<Diagnostic> _items = new List<Diagnostic>();
    public IReadOnlyList<Diagnostic> Items => _items;
    public bool HasError
    {
        get
        {
            foreach (var d in _items)
                if (d.Severity == DiagnosticSeverity.Error) return true;
            return false;
        }
    }

    public void Add(DiagnosticSeverity severity, string message, SourceSpan? span = null, string? suggestion = null)
    {
        _items.Add(new Diagnostic
        {
            Severity = severity,
            Message = message,
            Suggestion = suggestion,
            Span = span ?? new SourceSpan()
        });
    }
}
