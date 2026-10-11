namespace Shiori.Scripting.Schema;

/// <summary>通用参数块：指令 uses / 宏 params.extends 挂靠。</summary>
public static class CommonParams
{
    public static readonly ParamSchema Time = new("time", "int", optional: true, label: "毫秒");
    public static readonly ParamSchema Cond = new("cond", "expr", optional: true);
    public static readonly ParamSchema Nowait = new("nowait", "flag", optional: true);
    public static readonly ParamSchema Layer = new("layer", "str", optional: true);
    public static readonly ParamSchema Vol = new("vol", "num", optional: true);
    public static readonly ParamSchema Ease = new("ease", "str", optional: true);
    public static readonly ParamSchema Persist = new("persist", "flag", optional: true);

    public static ParamSchema[] All { get; } =
    {
        Time, Cond, Nowait, Layer, Vol, Ease, Persist
    };
}
