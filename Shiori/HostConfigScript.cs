// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 宿主配置脚本生成（OPT S5.3 L3）。
// 将 RenderProfile 序列化为一段 IIFE JavaScript，需在页面脚本之前
// 通过 WebView2 DocumentCreated 注入，使前端启动时即可读到宿主配置。
// 契约：写入 window.__shioriHostConfig，并尽力同步到 localStorage。

using System.Text.Json;
using System.Text.Json.Serialization;

namespace ShioriCSharp;

/// <summary>
/// 负责把 <see cref="RenderProfile"/> 编译为可在 document-created 阶段注入的 JavaScript 片段。
/// </summary>
public static class HostConfigScript
{
    /// <summary>localStorage 中保存渲染设置的键名（前端与宿主约定的契约键）。</summary>
    public const string LocalStorageKey = "shiori_render_settings";

    /// <summary>序列化选项：属性名转小驼峰，枚举以字符串输出且不接受整数。</summary>
    /// <remarks>
    /// 属性名小驼峰以匹配 JS 侧的字段命名；枚举强制字符串形式，
    /// 便于前端直接按名称比较，同时避免整数枚举值随版本变化而错配。
    /// </remarks>
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(allowIntegerValues: false) }
    };

    /// <summary>
    /// 注入前端所用的渲染配置数据传输对象（仅包含需要暴露给页面的字段）。
    /// </summary>
    /// <param name="Thumbnails">是否启用缩略图。</param>
    /// <param name="FrameCache">是否启用帧缓存。</param>
    /// <param name="CharRenderer">立绘渲染模式。</param>
    /// <param name="DiskCache">磁盘缓存容量档位。</param>
    /// <param name="HardwareAccel">硬件加速模式。</param>
    /// <param name="LayoutMode">布局模式。</param>
    private sealed record HostConfigDto(
        bool Thumbnails,
        bool FrameCache,
        CharRendererMode CharRenderer,
        DiskCacheSize DiskCache,
        HardwareAccelMode HardwareAccel,
        LayoutMode LayoutMode);

    /// <summary>
    /// 把渲染配置编译为注入用的自执行 JS 代码。
    /// </summary>
    /// <param name="profile">渲染配置；为 null 时使用 <see cref="RenderProfile.Default"/>。</param>
    /// <returns>包含配置赋值与 localStorage 写入的 IIFE 字符串。</returns>
    /// <remarks>
    /// localStorage 写入包在 try/catch 中：在隐私模式或配额受限等场景下
    /// 写入可能抛异常，此处静默忽略，保证 window.__shioriHostConfig 仍可用。
    /// </remarks>
    public static string FromProfile(RenderProfile profile)
    {
        // 空配置回退到默认档，保证前端始终能取到完整配置
        profile ??= RenderProfile.Default;
        var json = JsonSerializer.Serialize(
            new HostConfigDto(
                profile.Thumbnails,
                profile.FrameCache,
                profile.CharRenderer,
                profile.DiskCache,
                profile.HardwareAccel,
                profile.LayoutMode),
            JsonOpts);
        // 直接拼接字符串而非模板引擎，减少注入阶段的额外开销与依赖
        return "(function(){" +
               "var c=" + json + ";" +
               "window.__shioriHostConfig=c;" +
               "try{localStorage.setItem('" + LocalStorageKey + "',JSON.stringify(c));}catch(e){}" +
               "})();";
    }
}
