/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 新版立绘 dress+face 合成几何（纯函数，供 engine_chars 与 node 测试共用）。
 * 坐标系：canvas 原点左上，dress 铺满 canvas；face 偏移单位与 CSS 一致（容器宽/高百分比）。
 * 所有计算均为无副作用的纯函数，可同时在浏览器与 Node 测试环境中运行。
 */
(function (root) {
    'use strict';

    /**
     * 计算 dress（身体层）与 face（表情层）合成时，face 应绘制到 dress 位图上的目标矩形。
     *
     * 几何约定：
     * - dress 位图铺满整个立绘画布，其尺寸为 dressW × dressH；
     * - face 以「相对容器宽/高的百分比」描述偏移（与 CSS 中 left/bottom 百分比语义一致）；
     * - 返回值以 canvas 左上角为原点，单位为 dress 位图像素。
     *
     * @param {number} dressW            dress 位图宽度（像素）
     * @param {number} dressH            dress 位图高度（像素），同时作为立绘的基准高度
     * @param {number} faceW             face 原始位图宽度（像素）
     * @param {number} faceH             face 原始位图高度（像素），需大于 0 才能按比例缩放
     * @param {number} faceOffsetX       face 水平偏移，单位为容器宽度百分比（正值向右）
     * @param {number} faceOffsetY       face 垂直偏移，单位为 dress 高度百分比（正值向上）
     * @param {number} faceScaleFactor   face 相对 dress 的缩放系数（1 表示与 dress 等高）
     * @param {number} stageW            舞台容器宽度（像素），用于把百分比偏移换算为像素
     * @param {number} stageH            舞台容器高度（像素），用于非整数高度场景的宽度校准
     * @param {number} baseScale         立绘基础缩放（z 轴分层缩放），用于抵消后续 CSS scale
     * @returns {{destX:number, destY:number, destW:number, destH:number}}
     *          face 在 dress 位图坐标系中的目标矩形（左上角 x/y 与宽高，单位像素）
     */
    function computeCharDiffFaceRect(
        dressW, dressH, faceW, faceH,
        faceOffsetX, faceOffsetY, faceScaleFactor,
        stageW, stageH, baseScale
    ) {
        // 防御：舞台高度与基础缩放非法时退化为 1，避免出现除零 / NaN
        var h = stageH > 0 ? stageH : 1;
        var b = baseScale > 0 ? baseScale : 1;
        // face 按 faceScaleFactor 相对 dress 高度缩放，宽度按原图宽高比等比推导
        var destH = dressH * faceScaleFactor;
        var destW = faceH > 0 ? faceW * (destH / faceH) : 0;
        // face x/y 按 dress 基础 z 校准；画进 dress 像素后再 CSS scale(actualScale)，
        // 必须先除 baseScale，否则 z>0 时偏移被放大两次。
        var ox = (faceOffsetX / 100) * stageW * (dressH / h) / b;
        var oy = (faceOffsetY / 100) * dressH / b;
        // 水平：以 dress 中线为基准居中 face；垂直：以 dress 底边为基准向上偏移（y 轴向下）
        return {
            destX: (dressW / 2 + ox) - destW / 2,
            destY: (dressH - oy) - destH,
            destW: destW,
            destH: destH
        };
    }

    // 导出：浏览器挂到全局 root，Node 环境通过 module.exports 供单元测试使用
    var api = { computeCharDiffFaceRect: computeCharDiffFaceRect };
    root.ShioriCharDiffMath = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
