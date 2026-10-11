// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 插件契约（OPT S8）。
// 托管插件通过实现 IShioriPlugin（或提供同名成员）接入宿主；宿主向插件
// 暴露 IShioriHost 以提供 API 版本、目录信息、日志与 UI 线程调度能力。
// 原生插件则通过 C ABI 提供等价能力。本文件仅定义契约，不含加载逻辑。

namespace ShioriCSharp;

/// <summary>
/// 托管插件的实现契约。插件加载器会实例化实现类并调用其生命周期方法。
/// </summary>
public interface IShioriPlugin
{
    /// <summary>插件名称（用于日志与展示）。</summary>
    string Name { get; }
    /// <summary>插件版本字符串。</summary>
    string Version { get; }
    /// <summary>插件所支持的最低宿主 API 版本（含）。</summary>
    int MinHostApiVersion { get; }
    /// <summary>插件所支持的最高宿主 API 版本（含）。</summary>
    int MaxHostApiVersion { get; }
    /// <summary>
    /// 宿主就绪回调。插件可在此保存 <paramref name="host"/> 引用并完成初始化。
    /// </summary>
    /// <param name="host">宿主能力访问点。</param>
    void OnHostReady(IShioriHost host);
    /// <summary>宿主即将关闭时调用，插件应在此释放资源、注销回调。</summary>
    void OnShutdown();
}

/// <summary>
/// 提供给插件的宿主能力接口。
/// </summary>
public interface IShioriHost
{
    /// <summary>宿主当前 API 版本，插件应据此做兼容性判断。</summary>
    int ApiVersion { get; }
    /// <summary>应用根目录。</summary>
    string AppDirectory { get; }
    /// <summary>引擎目录（脚本、资源等所在位置）。</summary>
    string EngineDirectory { get; }
    /// <summary>插件目录。</summary>
    string PluginDirectory { get; }
    /// <summary>
    /// 输出一条日志。
    /// </summary>
    /// <param name="message">日志内容。</param>
    void Log(string message);
    /// <summary>
    /// 将动作调度到 UI 线程执行，供插件安全更新界面。
    /// </summary>
    /// <param name="action">待执行的动作。</param>
    void InvokeOnUi(Action action);
}

/// <summary>
/// 插件发现/加载的结果记录，用于展示与诊断（含跳过原因）。
/// </summary>
public sealed class ShioriPluginRecord
{
    /// <summary>
    /// 构造一条插件记录；传入的字符串 null 会被规整为空串。
    /// </summary>
    /// <param name="path">插件文件或目录路径。</param>
    /// <param name="name">插件名称。</param>
    /// <param name="version">插件版本。</param>
    /// <param name="kind">插件类型（如托管/原生）。</param>
    /// <param name="skipReason">被跳过的原因；成功加载时为 null。</param>
    public ShioriPluginRecord(string path, string name, string version, string kind, string? skipReason)
    {
        Path = path ?? "";
        Name = name ?? "";
        Version = version ?? "";
        Kind = kind ?? "";
        SkipReason = skipReason;
    }

    /// <summary>插件文件或目录路径。</summary>
    public string Path { get; }
    /// <summary>插件名称。</summary>
    public string Name { get; }
    /// <summary>插件版本。</summary>
    public string Version { get; }
    /// <summary>插件类型（如托管/原生）。</summary>
    public string Kind { get; }
    /// <summary>被跳过的原因；成功加载时为 null。</summary>
    public string? SkipReason { get; }
}
