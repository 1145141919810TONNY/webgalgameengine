// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 立绘差分位图叠加（T21）：BGRA 像素的 source-over 合成。
// dest 与 src 均为每像素 4 字节（B、G、R、A）、行优先排列的缓冲区，
// 支持负偏移与越界裁剪，供立绘 dress/face 合成时把 face 贴到 dress 上。

using System;

namespace ShioriCSharp;

/// <summary>
/// 立绘差分位图叠加工具：把带 Alpha 的源位图以 source-over 方式混合到目标位图。
/// </summary>
/// <remarks>
/// 像素格式约定为 BGRA、每像素 4 字节、行优先（stride = 宽度 × 4）。
/// 本类是纯计算工具，无共享状态，可安全并发调用（前提是各调用方使用独立缓冲区）。
/// </remarks>
public static class CharDiffBlit
{
    /// <summary>
    /// 将源位图按 source-over 规则叠加到目标位图的指定位置。
    /// </summary>
    /// <param name="dest">目标缓冲区（BGRA），会被就地修改。</param>
    /// <param name="destW">目标缓冲区宽度（像素）。</param>
    /// <param name="destH">目标缓冲区高度（像素）。</param>
    /// <param name="src">源缓冲区（BGRA），只读不修改。</param>
    /// <param name="srcW">源缓冲区宽度（像素）。</param>
    /// <param name="srcH">源缓冲区高度（像素）。</param>
    /// <param name="destX">源左上角在目标中的 X 坐标，允许为负（表示左侧被裁剪）。</param>
    /// <param name="destY">源左上角在目标中的 Y 坐标，允许为负（表示上方被裁剪）。</param>
    /// <exception cref="ArgumentNullException"><paramref name="dest"/> 或 <paramref name="src"/> 为 null。</exception>
    /// <exception cref="ArgumentException">缓冲区实际长度小于「宽 × 高 × 4」时抛出。</exception>
    /// <remarks>
    /// 副作用：就地修改 <paramref name="dest"/> 的像素字节。
    /// 边界处理：源位图可能部分或全部位于目标之外，此实现通过调整源起点
    /// （srcX0/srcY0）与可拷贝范围（copyW/copyH）完成裁剪；若裁剪后无可绘制
    /// 区域或宽高非正，则静默返回（不抛异常）。
    /// 混合公式（每通道 c）：out = (src·a + dst·(255−a)) / 255；
    /// Alpha 通道同理：outA = a + dstA·(255−a)/255。
    /// </remarks>
    public static void Blit(
        byte[] dest, int destW, int destH,
        byte[] src, int srcW, int srcH,
        int destX, int destY)
    {
        if (dest == null) throw new ArgumentNullException(nameof(dest));
        if (src == null) throw new ArgumentNullException(nameof(src));
        if (destW <= 0 || destH <= 0 || srcW <= 0 || srcH <= 0)
            return;
        // 使用 long 乘法避免大图时 int 溢出导致的最小长度校验失效
        if (dest.Length < (long)destW * destH * 4)
            throw new ArgumentException("dest buffer too small", nameof(dest));
        if (src.Length < (long)srcW * srcH * 4)
            throw new ArgumentException("src buffer too small", nameof(src));

        // 裁剪窗口：srcX0/srcY0 为源图实际起步像素，copyW/copyH 为可拷贝范围
        var srcX0 = 0;
        var srcY0 = 0;
        var copyW = srcW;
        var copyH = srcH;
        if (destX < 0)
        {
            // 源左部越出目标左边界：跳过源图左侧 |destX| 像素
            srcX0 = -destX;
            copyW += destX;
            destX = 0;
        }
        if (destY < 0)
        {
            // 源上部越出目标上边界：跳过源图上方 |destY| 像素
            srcY0 = -destY;
            copyH += destY;
            destY = 0;
        }
        // 右侧/下侧越界：收窄可拷贝范围到目标内
        if (destX + copyW > destW)
            copyW = destW - destX;
        if (destY + copyH > destH)
            copyH = destH - destY;
        if (copyW <= 0 || copyH <= 0)
            return;

        for (var y = 0; y < copyH; y++)
        {
            // di/si 为行首字节偏移，行内按 +4 步进
            var di = ((destY + y) * destW + destX) * 4;
            var si = ((srcY0 + y) * srcW + srcX0) * 4;
            for (var x = 0; x < copyW; x++)
            {
                var sa = src[si + 3];
                if (sa == 0)
                {
                    // 完全透明：目标保持原样，快速跳过
                    di += 4;
                    si += 4;
                    continue;
                }
                if (sa == 255)
                {
                    // 完全不透明：直接覆盖（含 Alpha）
                    dest[di] = src[si];
                    dest[di + 1] = src[si + 1];
                    dest[di + 2] = src[si + 2];
                    dest[di + 3] = 255;
                }
                else
                {
                    // 半透明：逐通道 source-over 混色，取整除法
                    var inv = 255 - sa;
                    dest[di] = (byte)((src[si] * sa + dest[di] * inv) / 255);
                    dest[di + 1] = (byte)((src[si + 1] * sa + dest[di + 1] * inv) / 255);
                    dest[di + 2] = (byte)((src[si + 2] * sa + dest[di + 2] * inv) / 255);
                    dest[di + 3] = (byte)(sa + dest[di + 3] * inv / 255);
                }
                di += 4;
                si += 4;
            }
        }
    }
}
