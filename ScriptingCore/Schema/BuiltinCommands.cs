namespace Shiori.Scripting.Schema;

/// <summary>engine_command.parseCommandByName 现有指令 + M1 试点 quake/char。</summary>
public static class BuiltinCommands
{
    public static void Register(CommandRegistry registry)
    {
        registry.Add(new CommandSchema("wait",
            positional: new[] { new ParamSchema("click", "flag", optional: true, label: "点击跳过") },
            named: new[] { CommonParams.Time },
            label: "等待"));

        registry.Add(new CommandSchema("pov",
            positional: new[] { new ParamSchema("name", "str", optional: true) },
            label: "视角"));

        registry.Add(new CommandSchema("char",
            positional: new[] { new ParamSchema("who", "char", optional: false) },
            named: new[] { new ParamSchema("pos", "str", optional: true) },
            label: "立绘"));

        registry.Add(new CommandSchema("quake",
            named: new[]
            {
                new ParamSchema("who", "char", optional: true),
                new ParamSchema("level", "str", optional: true, defaultValue: "中"),
                new ParamSchema("chan", "str", optional: true)
            },
            label: "震动"));

        registry.Add(new CommandSchema("quake-stop",
            named: new[]
            {
                new ParamSchema("who", "char", optional: true),
                new ParamSchema("chan", "str", optional: true)
            },
            label: "停止震动"));

        registry.Add(new CommandSchema("s", label: "点击等待"));
        registry.Add(new CommandSchema("msgoff", label: "隐藏消息框"));
        registry.Add(new CommandSchema("msgon", label: "显示消息框"));
        registry.Add(new CommandSchema("clearname", aliases: new[] { "clear" }, label: "清除姓名"));
        registry.Add(new CommandSchema("fadeout", named: new[] { CommonParams.Time, new ParamSchema("color", "str", optional: true) }, label: "淡出"));
        registry.Add(new CommandSchema("fadein", named: new[] { CommonParams.Time, new ParamSchema("color", "str", optional: true) }, label: "淡入"));
        registry.Add(new CommandSchema("finish", named: new[] { CommonParams.Time, new ParamSchema("bgcolor", "str", optional: true) }, label: "黑屏结束"));
        registry.Add(new CommandSchema("finishwhite", named: new[] { CommonParams.Time, new ParamSchema("bgcolor", "str", optional: true) }, label: "白屏结束"));
        registry.Add(new CommandSchema("novel", label: "切换全屏小说模式"));
        registry.Add(new CommandSchema("normal", label: "退出全屏小说模式"));
        registry.Add(new CommandSchema("lock", aliases: new[] { "阻止" }, label: "锁定点击"));
        registry.Add(new CommandSchema("free", aliases: new[] { "解锁" }, label: "解除点击锁定"));

        var mediaNamed = new[]
        {
            new ParamSchema("storage", "str", optional: true),
            CommonParams.Time,
            CommonParams.Vol
        };
        registry.Add(new CommandSchema("bgm",
            positional: new[] { new ParamSchema("op", "str", optional: true) },
            named: mediaNamed,
            label: "BGM"));
        registry.Add(new CommandSchema("se",
            positional: new[] { new ParamSchema("op", "str", optional: true) },
            named: mediaNamed,
            label: "音效"));
        registry.Add(new CommandSchema("voice",
            positional: new[] { new ParamSchema("op", "str", optional: true) },
            named: mediaNamed,
            label: "语音"));
        registry.Add(new CommandSchema("background",
            named: new[]
            {
                new ParamSchema("storage", "str", optional: true),
                CommonParams.Time,
                CommonParams.Layer,
                new ParamSchema("size", "str", optional: true),
                new ParamSchema("Ssize", "str", optional: true),
                new ParamSchema("x", "str", optional: true),
                new ParamSchema("y", "str", optional: true)
            },
            label: "背景"));
        registry.Add(new CommandSchema("off",
            named: new[] { new ParamSchema("storage", "str", optional: true) },
            label: "移除资源"));

        registry.AddMacro(new MacroSchema("发抖",
            new[]
            {
                new ParamSchema("who", "char", optional: true),
                new ParamSchema("level", "str", optional: true, defaultValue: "中"),
                new ParamSchema("time", "int", optional: true, defaultValue: 600),
                new ParamSchema("chan", "str", optional: true)
            },
            new[]
            {
                new MacroStep("quake", Dict("who", "%who", "level", "%level", "chan", "%chan")),
                new MacroStep("wait", Dict("time", "%time"))
            },
            label: "发抖"));

        registry.AddMacro(new MacroSchema("发抖-stop",
            new[]
            {
                new ParamSchema("who", "char", optional: true),
                new ParamSchema("chan", "str", optional: true)
            },
            new[]
            {
                new MacroStep("quake-stop", Dict("who", "%who", "chan", "%chan"))
            },
            label: "停止发抖"));
    }

    private static System.Collections.Generic.Dictionary<string, string> Dict(params string[] pairs)
    {
        var d = new System.Collections.Generic.Dictionary<string, string>();
        for (var i = 0; i + 1 < pairs.Length; i += 2)
            d[pairs[i]] = pairs[i + 1];
        return d;
    }
}
