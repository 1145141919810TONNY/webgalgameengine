// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 画布缩放计算（T23 / OPT S6）。
// 等比画布模式下按「宽度 / 设计宽度 1920」求 ZoomFactor，并夹紧到 0.25–5.0。
// 流式布局恒返回 1；宽度非有限或非正时回退为 1，不修改 CSS/HTML。

using System;

namespace ShioriCSharp;

/// <summary>
/// 布局缩放计算工具：把窗口宽度换算为 WebView2 的 ZoomFactor。
/// </summary>
public static class LayoutScale
{
    /// <summary>设计基准宽度（像素），等比画布以此为缩放基准。</summary>
    public const double DesignWidth = 1920.0;
    /// <summary>允许的最小缩放因子。</summary>
    public const double MinZoom = 0.25;
    /// <summary>允许的最大缩放因子。</summary>
    public const double MaxZoom = 5.0;
    /// <summary>窗口最小宽度（像素）。</summary>
    public const double MinWindowWidth = 960.0;
    /// <summary>窗口最小高度（像素）。</summary>
    public const double MinWindowHeight = 540.0;

    /// <summary>
    /// 根据布局模式与当前宽度计算缩放因子。
    /// </summary>
    /// <param name="mode">布局模式；非 <see cref="LayoutMode.UniformCanvas"/> 时恒返回 1。</param>
    /// <param name="width">当前可用宽度（像素）。</param>
    /// <returns>夹紧到 [<see cref="MinZoom"/>, <see cref="MaxZoom"/>] 的缩放因子。</returns>
    /// <remarks>
    /// 边界处理：宽度为 NaN、Infinity 或非正时返回 1.0（保持原始缩放，不触发页面重排）。
    /// 本方法为纯计算，无副作用。
    /// </remarks>
    public static double ComputeZoom(LayoutMode mode, double width)
    {
        // 非等比画布（流式）模式不做缩放
        if (mode != LayoutMode.UniformCanvas)
            return 1.0;
        // 非法宽度回退为 1，避免把 NaN/Infinity 传给 ZoomFactor
        if (double.IsNaN(width) || double.IsInfinity(width) || width <= 0)
            return 1.0;
        var zoom = width / DesignWidth;
        if (zoom < MinZoom) return MinZoom;
        if (zoom > MaxZoom) return MaxZoom;
        return zoom;
    }
}
