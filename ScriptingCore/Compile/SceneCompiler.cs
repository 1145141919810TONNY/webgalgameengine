using System.Collections.Generic;
using System.Text.Json;
using Shiori.Scripting.Emit;
using Shiori.Scripting.Validate;

namespace Shiori.Scripting.Compile;

/// <summary>场景 story[] → 每行 nodes + macros + diagnostics（file:line:col）。</summary>
public sealed class SceneCompiler
{
    private readonly Compiler _compiler;

    public SceneCompiler(Compiler? compiler = null)
    {
        _compiler = compiler ?? new Compiler();
    }

    public JsonElement CompileStory(string file, JsonElement story)
    {
        var lines = new List<object>();
        var all = new DiagnosticBag();
        var index = 0;

        if (story.ValueKind == JsonValueKind.Array)
        {
            foreach (var line in story.EnumerateArray())
            {
                var result = _compiler.CompileLine(line, file, index);
                foreach (var d in result.Diagnostics.Items)
                    all.Add(d.Severity, d.Message, d.Span, d.Suggestion);

                var nodes = new List<JsonElement>();
                foreach (var n in result.Nodes)
                    nodes.Add(DslNodeJson.ToJson(n));

                lines.Add(new
                {
                    index,
                    nodes,
                    // 本行实际展开命中的宏（按名排序）。调试面板按"当前行"展示，
                    // 剧情推进到下一行时列表随之整体切换；本行没用到宏则为空数组。
                    macros = result.Macros,
                    diagnostics = DslNodeJson.DiagnosticsToJson(result.Diagnostics.Items)
                });
                index++;
            }
        }

        var payload = new
        {
            file,
            lines,
            diagnostics = DslNodeJson.DiagnosticsToJson(all.Items)
        };
        return JsonSerializer.SerializeToElement(payload, DslNodeJson.Options);
    }
}
