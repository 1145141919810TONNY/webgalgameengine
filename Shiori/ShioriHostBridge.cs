// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// Shiori 启动器 — WebView2 宿主桥（Q25 白名单 invoke）。
// 通过 COM 可见类型把前端的 window.chrome.webview 调用转发到脚本运行时，
// 具体的命令白名单与参数校验由 DslRuntime 负责。

using System.Runtime.InteropServices;
using Shiori.Scripting.Host;

namespace ShioriCSharp;

/// <summary>
/// 前端与宿主之间的调用契约。以 IDispatch 接口暴露，供 WebView2 的 COM 互操作调用。
/// </summary>
/// <remarks>
/// 使用 IDispatch（后期绑定）而非 IUnknown，以便 JS 侧通过 AddHostObjectToScript 直接调用。
/// </remarks>
[ComVisible(true)]
[InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
public interface IShioriHostBridge
{
    /// <summary>
    /// 统一入口：按名称调用脚本运行时暴露的命令。
    /// </summary>
    /// <param name="name">命令名称（由运行时按白名单校验）。</param>
    /// <param name="args">JSON 格式参数字符串。</param>
    /// <returns>命令结果（通常为 JSON 字符串）。</returns>
    string invoke(string name, string args);
}

/// <summary>
/// 宿主桥实现：把 COM 调用转发给 <see cref="DslRuntime"/>。
/// </summary>
/// <remarks>
/// 标注 <see cref="ComVisibleAttribute"/> 且不自动生成类接口（ClassInterfaceType.None），
/// 仅通过 <see cref="IShioriHostBridge"/> 暴露成员，避免意外泄漏公共成员给脚本侧。
/// </remarks>
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.None)]
[ComDefaultInterface(typeof(IShioriHostBridge))]
public sealed class ShioriHostBridge : IShioriHostBridge
{
    /// <summary>被桥接的脚本运行时实例。</summary>
    private readonly DslRuntime _runtime;

    /// <summary>
    /// 构造宿主桥。
    /// </summary>
    /// <param name="runtime">脚本运行时实例，不能为 null。</param>
    /// <exception cref="ArgumentNullException"><paramref name="runtime"/> 为 null 时抛出。</exception>
    public ShioriHostBridge(DslRuntime runtime)
    {
        _runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
    }

    /// <summary>
    /// 转发前端调用到脚本运行时。
    /// </summary>
    /// <param name="name">命令名称；null 会被规整为空串。</param>
    /// <param name="args">JSON 参数；null 或空串会被规整为 "{}"。</param>
    /// <returns>运行时的调用结果字符串。</returns>
    public string invoke(string name, string args)
    {
        return _runtime.Invoke(name ?? "", string.IsNullOrEmpty(args) ? "{}" : args);
    }
}
