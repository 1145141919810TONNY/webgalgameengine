/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 单层 Canvas 立绘舞台：在 Auto 模式下按场次闩锁 Dom 与 Canvas 两种渲染路径，
 * 不切换到 Precomposed（预合成）方案。包含渲染模式决策、指令计数、
 * 舞台尺寸溢出处理、精灵布局计算、绘制以及从活动 DOM 采样样式等能力。
 */
(function (root) {
    'use strict';

    // 自动切换到 Canvas 渲染所需的最少立绘数量（可由宿主配置覆盖）
    var AUTO_CANVAS_MIN_CHARS = (root.ShioriHostConfig && root.ShioriHostConfig.AUTO_CANVAS_MIN_CHARS) || 2;
    // 这些指令表示「移除 / 隐藏 / 等待」，不计入新增立绘数量
    var SKIP_FIRST = {
        '消失': 1, hide: 1, remove: 1,
        '渐出': 1, fadeOut: 1,
        wait: 1
    };

    /**
     * 读取当前生效的 Canvas 渲染阈值（优先取宿主配置，非法时回退到默认值）。
     * @returns {number} 正整数阈值
     */
    function threshold() {
        var n = root.ShioriHostConfig && root.ShioriHostConfig.AUTO_CANVAS_MIN_CHARS;
        return Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : AUTO_CANVAS_MIN_CHARS;
    }

    /**
     * 决策当前应使用的立绘渲染模式。
     * 优先级：宿主显式配置 > 已闩锁模式 > 按立绘数量自动判断。
     * @param {Object} cfg 场景/角色配置，cfg.charRenderer 可为 'Dom'|'Canvas'|'Precomposed'
     * @param {number} count 当前立绘数量
     * @param {string|null} latched 已闩锁的渲染模式（'Dom'|'Canvas'|null）
     * @returns {string} 'Dom' | 'Canvas' | 'Precomposed'
     */
    function effectiveMode(cfg, count, latched) {
        var hc = root.ShioriHostConfig;
        // 宿主提供了统一决策函数时以其为准，保证与宿主配置保持一致
        if (hc && typeof hc.effectiveCharRenderer === 'function') {
            return hc.effectiveCharRenderer(cfg, count, latched);
        }
        var mode = String((cfg && cfg.charRenderer) || 'Dom');
        if (mode === 'Precomposed' || mode === 'Canvas' || mode === 'Dom') return mode;
        if (latched === 'Canvas' || latched === 'Dom') return latched;
        var n = Number(count);
        if (!Number.isFinite(n) || n < 0) n = 0;
        return n >= threshold() ? 'Canvas' : 'Dom';
    }

    /**
     * 统计立绘指令字符串中「新增立绘」的指令条数。
     * 解析形如 [动作 参数] 的标签，取标签内首个 token 作为动作名，
     * 命中 SKIP_FIRST（消失/隐藏/渐出/等待类）的标签不计入数量。
     * @param {string} charString 立绘指令字符串（含若干 [..] 标签）
     * @returns {number} 新增立绘指令数量
     */
    function countAddInstructions(charString) {
        var matches = String(charString == null ? '' : charString).match(/\[([^\]]+)\]/g);
        if (!matches) return 0;
        var n = 0;
        for (var i = 0; i < matches.length; i++) {
            var content = matches[i].slice(1, -1).trim();
            if (!content) continue;
            var first = content.split(/\s+/)[0];
            if (!first) continue;
            // 移除/隐藏/等待类指令不产生新立绘，跳过；同时兼容大小写写法
            if (SKIP_FIRST[first] || SKIP_FIRST[first.toLowerCase()]) continue;
            n++;
        }
        return n;
    }

    /**
     * 判断指令串中是否包含「清除全部立绘」指令，如 [消失 all] / [hide 全部]。
     * @param {string} charString 立绘指令字符串
     * @returns {boolean} 存在清空全部指令时为 true
     */
    function hasClearAll(charString) {
        return /\[\s*(?:消失|hide|remove)\s+(?:all|全部)\s*\]/i.test(String(charString == null ? '' : charString));
    }

    /**
     * 为当前场次决定闩锁的渲染模式。
     * 一旦场次内已闩锁且场上仍有立绘（active > 0），则沿用原模式，避免场次中途切换渲染器；
     * 否则按本场次预计新增立绘数量与阈值比较，达到阈值用 Canvas，否则用 Dom。
     * @param {string|null} latched 当前已闩锁模式
     * @param {number} activeCount 场上现有立绘数量
     * @param {number} addCount 本场次新增立绘数量
     * @returns {string} 'Dom' | 'Canvas'
     */
    function latchForScene(latched, activeCount, addCount) {
        var active = Number(activeCount);
        if (!Number.isFinite(active) || active < 0) active = 0;
        if ((latched === 'Canvas' || latched === 'Dom') && active > 0) return latched;
        var n = Number(addCount);
        if (!Number.isFinite(n) || n < 0) n = 0;
        return n >= threshold() ? 'Canvas' : 'Dom';
    }

    /**
     * 将 CSS 长度字符串（如 "120px"）解析为数字像素值。
     * @param {string} value CSS 长度字符串
     * @returns {number} 像素数值；不可解析时返回 0
     */
    function parseCssPx(value) {
        var n = parseFloat(value);
        return Number.isFinite(n) ? n : 0;
    }

    /**
     * 从 CSS transform 字符串中解析旋转角度（度）。
     * 优先解析 matrix(a,b,c,d,e,f)，用 atan2(b,a) 还原旋转角；
     * 退化到 rotate(Ndeg) 形式；两者都不匹配时返回 0。
     * @param {string} transform CSS transform 字符串（可为 'none' 或空）
     * @returns {number} 旋转角度（度）
     */
    function parseRotationDeg(transform) {
        var t = String(transform == null ? '' : transform).trim();
        if (!t || t === 'none') return 0;
        var m = t.match(/matrix\(([^)]+)\)/);
        if (m) {
            var p = m[1].split(',').map(function (x) { return Number(x.trim()); });
            if (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
                return Math.atan2(p[1], p[0]) * 180 / Math.PI;
            }
        }
        var r = t.match(/rotate\(\s*([+-]?\d*\.?\d+)\s*deg\)/i);
        if (r) {
            var deg = Number(r[1]);
            return Number.isFinite(deg) ? deg : 0;
        }
        return 0;
    }

    /**
     * 从 CSS transform 中解析 2D 仿射矩阵 matrix(a,b,c,d,tx,ty)。
     * @param {string} transform CSS transform 字符串
     * @returns {{a:number,b:number,c:number,d:number,tx:number,ty:number}|null}
     *          解析失败（非 matrix 形式或含非法数值）时返回 null
     */
    function parseMatrix(transform) {
        var t = String(transform == null ? '' : transform).trim();
        var m = t.match(/matrix\(([^)]+)\)/);
        if (!m) return null;
        var p = m[1].split(',').map(function (x) { return Number(x.trim()); });
        if (p.length < 6) return null;
        for (var i = 0; i < 6; i++) {
            if (!Number.isFinite(p[i])) return null;
        }
        return { a: p[0], b: p[1], c: p[2], d: p[3], tx: p[4], ty: p[5] };
    }

    /**
     * 计算 transform 中「除去水平居中位移之外」的本地额外平移量。
     * 立绘常用 translateX(-50%) 做居中，这里将 -50% 视作基准（centerTx = -0.5 * stageW），
     * 把矩阵中的平移量减掉基准后，再换算回元素本地坐标系（用线性部分做逆旋转），
     * 从而得到真正的额外位移，供 Canvas 绘制时复现 DOM 布局。
     * @param {string} transform CSS transform 字符串
     * @param {number} stageW 舞台宽度（像素），用于把百分比位移换算为像素
     * @returns {{x:number, y:number}} 本地坐标系下的额外平移量（像素）
     */
    function extraLocalTranslate(transform, stageW) {
        var w = Number(stageW);
        if (!Number.isFinite(w) || w < 0) w = 0;
        var centerTx = -0.5 * w;
        var mat = parseMatrix(transform);
        if (mat) {
            // 矩阵形式：先减去居中基准，再用线性的转置做逆变换得到本地坐标
            var dx = mat.tx - centerTx;
            var dy = mat.ty;
            return {
                x: dx * mat.a + dy * mat.b,
                y: -dx * mat.b + dy * mat.a
            };
        }
        // 退化路径：累加所有 translateX 的百分比与像素分量
        var t = String(transform == null ? '' : transform);
        var totalPct = 0;
        var totalPx = 0;
        var re = /translateX\(\s*([+-]?\d*\.?\d+)\s*(%|px)?\s*\)/gi;
        var m;
        var found = false;
        while ((m = re.exec(t))) {
            found = true;
            var v = Number(m[1]);
            if (!Number.isFinite(v)) continue;
            if (m[2] === 'px') totalPx += v;
            else totalPct += v;
        }
        if (!found) return { x: 0, y: 0 };
        return { x: totalPct / 100 * w + totalPx - centerTx, y: 0 };
    }

    /**
     * 从 CSS transform 中解析缩放系数。
     * 优先用 matrix 的 hypot(a,b) 还原统一缩放（可正确处理带旋转的矩阵）；
     * 退化到 scale(N) 形式；无法解析时返回 1。
     * @param {string} transform CSS transform 字符串
     * @returns {number} 正数缩放系数
     */
    function parseScale(transform) {
        var t = String(transform == null ? '' : transform).trim();
        if (!t || t === 'none') return 1;
        var m = t.match(/matrix\(([^)]+)\)/);
        if (m) {
            var p = m[1].split(',').map(function (x) { return Number(x.trim()); });
            if (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
                var s = Math.hypot(p[0], p[1]);
                return s > 0 ? s : 1;
            }
        }
        var sc = t.match(/scale\(\s*([+-]?\d*\.?\d+)/i);
        if (sc) {
            var n = Number(sc[1]);
            return Number.isFinite(n) && n > 0 ? n : 1;
        }
        return 1;
    }

    // Canvas 单边最大像素，避免超大画布触发浏览器内存/纹理限制
    var MAX_STAGE_PX = 8192;

    /**
     * 计算允许立绘溢出的舞台/画布尺寸。
     * 画布高度取「可视高度」与「盒子高度」的较大值，使角色超出容器时仍能显示；
     * 宽度与高度都会被裁剪到 MAX_STAGE_PX 以内，并给出高度扩展比例，
     * 供绘制时按该比例换算坐标。
     * @param {number} boxW 立绘容器宽度（像素）
     * @param {number} boxH 立绘容器高度（像素）
     * @param {number} viewW 可视区域宽度（像素）
     * @param {number} viewH 可视区域高度（像素）
     * @returns {{boxW:number, boxH:number, canvasW:number, canvasH:number, extendRatio:number}}
     *          舞台尺寸信息与高度扩展比例
     */
    function overflowStageSize(boxW, boxH, viewW, viewH) {
        var w = Number(boxW);
        var bh = Number(boxH);
        var vh = Number(viewH);
        if (!Number.isFinite(w) || w < 0) w = 0;
        if (!Number.isFinite(bh) || bh < 0) bh = 0;
        if (!Number.isFinite(vh) || vh < 0) vh = 0;
        // 画布需覆盖可视高度，否则超出容器的立绘会被裁掉
        var canvasH = vh > bh ? vh : bh;
        // 上限裁剪，防止超大画布
        if (w > MAX_STAGE_PX) w = MAX_STAGE_PX;
        if (canvasH > MAX_STAGE_PX) canvasH = MAX_STAGE_PX;
        // 高度扩展比例：绘制坐标需按此比例回缩到盒子坐标系
        var ratio = bh > 0 ? canvasH / bh : 1;
        if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
        return {
            boxW: w,
            boxH: bh,
            canvasW: w,
            canvasH: canvasH,
            extendRatio: ratio
        };
    }

    /**
     * 计算单个立绘精灵在舞台上的布局参数。
     * 定位语义与 DOM 版一致：left 为水平百分比中心，bottom 为底部百分比，
     * 显示尺寸按「立绘高度 = 舞台高度」、宽度按位图宽高比等比推导。
     * @param {Object} opts 布局入参
     * @param {number} opts.stageW 舞台宽度（像素）
     * @param {number} opts.stageH 舞台高度（像素，同时作为立绘显示高度基准）
     * @param {number} opts.bmpW 位图宽度（像素）
     * @param {number} opts.bmpH 位图高度（像素）
     * @param {number|string} [opts.left=50] 水平位置（容器宽度百分比）
     * @param {number|string} [opts.bottom=0] 底部位置（容器高度百分比）
     * @param {number} [opts.rotation=0] 旋转角（度）
     * @param {number} [opts.scale=1] 缩放系数
     * @returns {{cx:number, yBottom:number, rotation:number, scale:number, dispW:number, dispH:number, stageH:number}}
     *          精灵布局参数
     */
    function spriteLayout(opts) {
        opts = opts || {};
        var stageW = Number(opts.stageW);
        var stageH = Number(opts.stageH);
        var bmpW = Number(opts.bmpW);
        var bmpH = Number(opts.bmpH);
        if (!Number.isFinite(stageW) || stageW < 0) stageW = 0;
        if (!Number.isFinite(stageH) || stageH < 0) stageH = 0;
        if (!Number.isFinite(bmpW) || bmpW < 0) bmpW = 0;
        if (!Number.isFinite(bmpH) || bmpH <= 0) bmpH = 1;
        var leftPct = parseFloat(opts.left);
        if (!Number.isFinite(leftPct)) leftPct = 50;
        var bottomPct = parseFloat(opts.bottom);
        if (!Number.isFinite(bottomPct)) bottomPct = 0;
        var rotation = Number(opts.rotation);
        if (!Number.isFinite(rotation)) rotation = 0;
        var scale = Number(opts.scale);
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;
        return {
            cx: leftPct / 100 * stageW,
            yBottom: bottomPct / 100 * stageH,
            rotation: rotation,
            scale: scale,
            // 等比缩放：以舞台高度为立绘显示高度，宽度按位图比例换算
            dispW: stageH * (bmpW / bmpH),
            dispH: stageH,
            stageH: stageH
        };
    }

    /**
     * 使用 Canvas 2D 上下文绘制一个立绘精灵。
     * 绘制约定：以 (cx, 底部基线) 为锚点；先在原点放下底部，再按 extraX/extraY 施加额外位移，
     * 最后按 scale 缩放绘制。整个过程用 save/restore 包裹，保证不污染外部上下文状态。
     * @param {CanvasRenderingContext2D} ctx 2D 绘制上下文
     * @param {CanvasImageSource} bmp 位图（Image/Canvas/Bitmap）
     * @param {Object} layout spriteLayout 返回的布局参数，可额外含 opacity/filter/extraX/extraY
     * @param {number} stageH 舞台高度（像素），用于把底部基线换算为画布 y 坐标
     * @returns {void}
     * @sideeffect 修改 ctx 的 globalAlpha/filter/变换矩阵，并在结束时 restore
     */
    function drawSprite(ctx, bmp, layout, stageH) {
        if (!ctx || !bmp || !layout) return;
        var s = Number(layout.scale);
        if (!Number.isFinite(s) || s <= 0) s = 1;
        var dispW = Number(layout.dispW);
        var dispH = Number(layout.dispH);
        if (!Number.isFinite(dispW) || !Number.isFinite(dispH)) return;
        var cx = Number(layout.cx);
        var yBottom = Number(layout.yBottom);
        if (!Number.isFinite(cx)) cx = 0;
        if (!Number.isFinite(yBottom)) yBottom = 0;
        var sh = Number(stageH);
        if (!Number.isFinite(sh)) sh = Number(layout.stageH);
        if (!Number.isFinite(sh)) sh = 0;
        var op = Number(layout.opacity);
        if (!Number.isFinite(op)) op = 1;
        if (op < 0) op = 0;
        if (op > 1) op = 1;
        var rot = Number(layout.rotation);
        if (!Number.isFinite(rot)) rot = 0;
        ctx.save();
        try {
            // 透明度与滤镜：复现 DOM 上的视觉效果
            ctx.globalAlpha = op;
            if (layout.filter) ctx.filter = layout.filter;
            // 定位到精灵底部中心点（canvas 原点左上，y 向下，故用 sh - yBottom）
            ctx.translate(cx, sh - yBottom);
            if (rot) ctx.rotate(rot * Math.PI / 180);
            var extraX = Number(layout.extraX);
            var extraY = Number(layout.extraY);
            if (!Number.isFinite(extraX)) extraX = 0;
            if (!Number.isFinite(extraY)) extraY = 0;
            // 额外本地位移（来自 DOM transform 中除去居中外的那部分）
            if (extraX || extraY) ctx.translate(extraX, extraY);
            // 以底部中心为锚点绘制：x 左移半个宽度，y 上移整个高度
            ctx.drawImage(bmp, -dispW * s / 2, -dispH * s, dispW * s, dispH * s);
        } finally {
            ctx.restore();
        }
    }

    /**
     * 安全获取元素的计算样式。
     * getComputedStyle 在沙箱或元素已脱离文档时可能抛错，此处统一兜底返回 null。
     * @param {HTMLElement} el 目标元素
     * @returns {CSSStyleDeclaration|null} 计算样式；不可用时返回 null
     */
    function computedStyleOf(el) {
        if (!el) return null;
        if (typeof getComputedStyle === 'function') {
            try { return getComputedStyle(el); } catch (e) { return null; }
        }
        return null;
    }

    /**
     * 读取元素行内样式中的 z-index 数值（未设置或非法时按 0 处理）。
     * @param {HTMLElement} el 目标元素
     * @returns {number} z-index 数值
     */
    function zIndexOf(el) {
        var n = parseInt(el && el.style && el.style.zIndex, 10);
        return Number.isFinite(n) ? n : 0;
    }

    /**
     * 按 z-index 从小到大排序元素列表（稳定副本排序，不修改原列表）。
     * z 序决定 Canvas 绘制顺序，后画的覆盖先画的。
     * @param {ArrayLike<HTMLElement>} list 待排序元素集合（类数组亦可）
     * @returns {Array<HTMLElement>} 排序后的新数组
     */
    function sortByZIndex(list) {
        var arr = Array.prototype.slice.call(list || []);
        arr.sort(function (a, b) { return zIndexOf(a) - zIndexOf(b); });
        return arr;
    }

    /**
     * 从当前活动的 DOM 立绘上采样样式，得到可直接用于 Canvas 绘制的布局参数。
     * 采样来源优先级：计算样式 getComputedStyle > 行内 style；scale 则单独从
     * compositeEl（外层合成元素）读取，用以复现 CSS 缩放的层级关系。
     * 所有数值都做了有限性兜底，保证返回对象可直接用于 drawSprite。
     * @param {HTMLElement} el 立绘元素（提供 left/bottom/opacity/filter/transform）
     * @param {HTMLElement} [compositeEl] 外层合成元素，用于读取整体缩放
     * @param {number} stageW 舞台宽度（像素）
     * @param {number} stageH 舞台高度（像素）
     * @returns {{cx:number,yBottom:number,rotation:number,scale:number,opacity:number,filter:string,extraX:number,extraY:number}}
     *          采样得到的精灵布局参数
     */
    function sampleLive(el, compositeEl, stageW, stageH) {
        var w = Number(stageW);
        var h = Number(stageH);
        if (!Number.isFinite(w) || w < 0) w = 0;
        if (!Number.isFinite(h) || h < 0) h = 0;
        var cx = w * 0.5;
        var yBottom = 0;
        var rotation = 0;
        var scale = 1;
        var opacity = 1;
        var filter = '';
        var extraX = 0;
        var extraY = 0;
        // 首选计算样式（已完成布局，left/bottom 为像素绝对值）
        var cs = computedStyleOf(el);
        if (cs) {
            cx = parseCssPx(cs.left);
            yBottom = parseCssPx(cs.bottom);
            var op = parseFloat(cs.opacity);
            opacity = Number.isFinite(op) ? op : 1;
            filter = (cs.filter && cs.filter !== 'none') ? cs.filter : '';
            rotation = parseRotationDeg(cs.transform);
            var extra = extraLocalTranslate(cs.transform, w);
            extraX = extra.x;
            extraY = extra.y;
        } else if (el && el.style) {
            // 退化路径：无计算样式时按行内 style 的百分比语义自行换算为像素
            var lp = parseFloat(el.style.left);
            var bp = parseFloat(el.style.bottom);
            cx = (Number.isFinite(lp) ? lp : 50) / 100 * w;
            yBottom = (Number.isFinite(bp) ? bp : 0) / 100 * h;
            rotation = parseRotationDeg(el.style.transform);
            var sop = parseFloat(el.style.opacity);
            opacity = Number.isFinite(sop) ? sop : 1;
            filter = el.style.filter && el.style.filter !== 'none' ? el.style.filter : '';
            extra = extraLocalTranslate(el.style.transform, w);
            extraX = extra.x;
            extraY = extra.y;
        }
        // 缩放从外层合成元素读取（CSS 缩放挂在外层容器上）
        var ccs = computedStyleOf(compositeEl);
        if (ccs) {
            scale = parseScale(ccs.transform);
        } else if (compositeEl && compositeEl.style) {
            scale = parseScale(compositeEl.style.transform);
        }
        // 最终兜底：缩放必须为正、透明度必须为有限值
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;
        if (!Number.isFinite(opacity)) opacity = 1;
        return {
            cx: cx,
            yBottom: yBottom,
            rotation: rotation,
            scale: scale,
            opacity: opacity,
            filter: filter,
            extraX: extraX,
            extraY: extraY
        };
    }

    // 对外导出：浏览器挂载至 root.ShioriCharStage，Node 环境导出供测试使用
    var api = {
        AUTO_CANVAS_MIN_CHARS: AUTO_CANVAS_MIN_CHARS,
        effectiveMode: effectiveMode,
        countAddInstructions: countAddInstructions,
        hasClearAll: hasClearAll,
        latchForScene: latchForScene,
        overflowStageSize: overflowStageSize,
        spriteLayout: spriteLayout,
        drawSprite: drawSprite,
        sampleLive: sampleLive,
        parseCssPx: parseCssPx,
        parseRotationDeg: parseRotationDeg,
        parseScale: parseScale,
        extraLocalTranslate: extraLocalTranslate,
        sortByZIndex: sortByZIndex
    };
    root.ShioriCharStage = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
