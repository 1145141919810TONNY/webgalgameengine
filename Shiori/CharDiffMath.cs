// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 立绘差分几何计算（T21）：由 dress/face 的尺寸、偏移与缩放推导 face 的合成矩形。
// 本文件的算法与 engine/chardiff_math.js 保持同语义，供 C# 侧在合成前
// 计算可见区域与对应源像素 ROI，避免为整张 face 分配缓冲区。

namespace ShioriCSharp;

/// <summary>
/// face 在 dress 坐标系中的目标矩形（浮点、以 dress 左上角为原点）。
/// </summary>
public readonly struct CharDiffFaceRect
{
    /// <summary>构造目标矩形。</summary>
    /// <param name="destX">矩形左上角 X（相对 dress 左边）。</param>
    /// <param name="destY">矩形左上角 Y（相对 dress 上边）。</param>
    /// <param name="destW">矩形宽度。</param>
    /// <param name="destH">矩形高度。</param>
    public CharDiffFaceRect(double destX, double destY, double destW, double destH)
    {
        DestX = destX;
        DestY = destY;
        DestW = destW;
        DestH = destH;
    }

    /// <summary>矩形左上角 X（相对 dress 左边）。</summary>
    public double DestX { get; }
    /// <summary>矩形左上角 Y（相对 dress 上边）。</summary>
    public double DestY { get; }
    /// <summary>矩形宽度。</summary>
    public double DestW { get; }
    /// <summary>矩形高度。</summary>
    public double DestH { get; }
}

/// <summary>
/// 裁剪到 dress 范围内的 face 可见区域，及其对应的 face 源像素 ROI（均为整数像素）。
/// </summary>
public readonly struct CharDiffVisibleFace
{
    /// <summary>构造可见区域映射结果。</summary>
    /// <param name="destX">可见区域在 dress 中的 X。</param>
    /// <param name="destY">可见区域在 dress 中的 Y。</param>
    /// <param name="destW">可见区域宽度。</param>
    /// <param name="destH">可见区域高度。</param>
    /// <param name="srcX">对应 face 源图 ROI 的 X。</param>
    /// <param name="srcY">对应 face 源图 ROI 的 Y。</param>
    /// <param name="srcW">对应 face 源图 ROI 的宽度。</param>
    /// <param name="srcH">对应 face 源图 ROI 的高度。</param>
    public CharDiffVisibleFace(int destX, int destY, int destW, int destH, int srcX, int srcY, int srcW, int srcH)
    {
        DestX = destX;
        DestY = destY;
        DestW = destW;
        DestH = destH;
        SrcX = srcX;
        SrcY = srcY;
        SrcW = srcW;
        SrcH = srcH;
    }

    /// <summary>可见区域在 dress 中的 X。</summary>
    public int DestX { get; }
    /// <summary>可见区域在 dress 中的 Y。</summary>
    public int DestY { get; }
    /// <summary>可见区域宽度。</summary>
    public int DestW { get; }
    /// <summary>可见区域高度。</summary>
    public int DestH { get; }
    /// <summary>对应 face 源图 ROI 的 X。</summary>
    public int SrcX { get; }
    /// <summary>对应 face 源图 ROI 的 Y。</summary>
    public int SrcY { get; }
    /// <summary>对应 face 源图 ROI 的宽度。</summary>
    public int SrcW { get; }
    /// <summary>对应 face 源图 ROI 的高度。</summary>
    public int SrcH { get; }
}

/// <summary>
/// 立绘 dress/face 合成的几何计算工具（与 engine/chardiff_math.js 同语义）。
/// </summary>
public static class CharDiffMath
{
    /// <summary>
    /// 计算 face 在 dress 坐标系中的目标矩形。
    /// </summary>
    /// <param name="dressW">dress 宽度（像素）。</param>
    /// <param name="dressH">dress 高度（像素）。</param>
    /// <param name="faceW">face 源宽度（像素）。</param>
    /// <param name="faceH">face 源高度（像素）；为 0 时目标宽度记为 0。</param>
    /// <param name="faceOffsetX">face 水平偏移，单位为百分比。</param>
    /// <param name="faceOffsetY">face 垂直偏移，单位为百分比。</param>
    /// <param name="faceScaleFactor">face 相对 dress 的缩放系数（作用于高度）。</param>
    /// <param name="stageW">舞台宽度，用于把百分比水平偏移换算为像素。</param>
    /// <param name="stageH">舞台高度，用于归一化；非正时按 1 处理以避免除零。</param>
    /// <param name="baseScale">基础缩放补偿；非正时按 1 处理以避免除零。</param>
    /// <returns>face 应绘制在 dress 内的目标矩形（可能部分超出 dress 边界）。</returns>
    /// <remarks>
    /// 计算规则：先由 dressH × faceScaleFactor 得到目标高度，再按源图宽高比
    /// 推导目标宽度以保持等比；偏移量按 stage 尺寸与 baseScale 换算。
    /// </remarks>
    public static CharDiffFaceRect ComputeFaceRect(
        double dressW, double dressH, double faceW, double faceH,
        double faceOffsetX, double faceOffsetY, double faceScaleFactor,
        double stageW, double stageH, double baseScale = 1)
    {
        // 保护除零：舞台高度与基础缩放非正时退化为 1
        var h = stageH > 0 ? stageH : 1;
        var b = baseScale > 0 ? baseScale : 1;
        var destH = dressH * faceScaleFactor;
        // 保持源图宽高比推导目标宽度
        var destW = faceH > 0 ? faceW * (destH / faceH) : 0;
        // 水平偏移受 dressH/stageH 比值缩放；垂直偏移直接按 dressH 计
        var ox = (faceOffsetX / 100) * stageW * (dressH / h) / b;
        var oy = (faceOffsetY / 100) * dressH / b;
        // 水平居中于 dress，垂直以底边（dressH - oy）为基准向上对齐
        return new CharDiffFaceRect(
            (dressW / 2 + ox) - destW / 2,
            (dressH - oy) - destH,
            destW,
            destH);
    }

    /// <summary>
    /// 把 face 目标矩形裁到 dress 内，并映射回原 face 像素 ROI。
    /// 缩放只发生在可见区域，分配不超过 dress 像素数。
    /// </summary>
    /// <param name="dest">computeFaceRect 得出的目标矩形（可能越界或含非有限值）。</param>
    /// <param name="dressW">dress 宽度（像素），用于裁剪右边界。</param>
    /// <param name="dressH">dress 高度（像素），用于裁剪下边界。</param>
    /// <param name="faceW">face 源宽度（像素）。</param>
    /// <param name="faceH">face 源高度（像素）。</param>
    /// <param name="vis">输出：裁剪后的可见区域及其源 ROI；失败时为 default。</param>
    /// <returns>得到非空可见区域返回 true，否则返回 false。</returns>
    /// <remarks>
    /// 失败情形包括：任一尺寸非正、矩形含 NaN/Infinity、宽高非正，
    /// 或裁剪后可见区域为空。此方法为纯计算，无副作用。
    /// </remarks>
    public static bool TryMapVisibleFace(
        in CharDiffFaceRect dest, int dressW, int dressH, int faceW, int faceH,
        out CharDiffVisibleFace vis)
    {
        vis = default;
        // 尺寸合法性；任一非正直接失败
        if (dressW <= 0 || dressH <= 0 || faceW <= 0 || faceH <= 0)
            return false;
        // 拒绝 NaN/Infinity，避免后续取整产生未定义结果
        if (!double.IsFinite(dest.DestX) || !double.IsFinite(dest.DestY)
            || !double.IsFinite(dest.DestW) || !double.IsFinite(dest.DestH))
            return false;
        if (!(dest.DestW > 0) || !(dest.DestH > 0))
            return false;

        // 先以浮点求与 dress 的交集，再取整并二次夹紧，控制像素对齐误差
        var x0 = Math.Max(0.0, dest.DestX);
        var y0 = Math.Max(0.0, dest.DestY);
        var x1 = Math.Min((double)dressW, dest.DestX + dest.DestW);
        var y1 = Math.Min((double)dressH, dest.DestY + dest.DestH);
        var dx = (int)Math.Round(x0);
        var dy = (int)Math.Round(y0);
        var dw = (int)Math.Round(x1 - x0);
        var dh = (int)Math.Round(y1 - y0);
        if (dx < 0) dx = 0;
        if (dy < 0) dy = 0;
        if (dx + dw > dressW) dw = dressW - dx;
        if (dy + dh > dressH) dh = dressH - dy;
        if (dw <= 0 || dh <= 0)
            return false;

        // 目标区域 → 源 ROI 的线性映射（等比缩放）
        var sx = (int)Math.Round((dx - dest.DestX) / dest.DestW * faceW);
        var sy = (int)Math.Round((dy - dest.DestY) / dest.DestH * faceH);
        var sw = (int)Math.Round(dw / dest.DestW * faceW);
        var sh = (int)Math.Round(dh / dest.DestH * faceH);
        // 映射结果可能出现负起点或越界，进一步夹紧到源图范围
        if (sx < 0) { sw += sx; sx = 0; }
        if (sy < 0) { sh += sy; sy = 0; }
        if (sx + sw > faceW) sw = faceW - sx;
        if (sy + sh > faceH) sh = faceH - sy;
        if (sw <= 0 || sh <= 0)
            return false;

        vis = new CharDiffVisibleFace(dx, dy, dw, dh, sx, sy, sw, sh);
        return true;
    }
}
