/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 立绘 Web Animations API 封装层：提供可取消 / 可反向的动画播放能力，
 * 并集中提供各类立绘动作（发抖、点头、得意、惊吓、倾斜、淡入滑动）的关键帧生成函数。
 */
(function (root) {
    'use strict';

    /**
     * 活动动画注册表。
     * 每一项形如 { el, handle, from, to, startTick, dur, easing }，用于：
     *   - moveCount()：对外暴露「还有多少个动画在跑」，供点击屏蔽链判定；
     *   - finishAll()：把所有动画**落到终态**，
     *     而不是取消后停在半途 —— 这是「快进 / 连点后位置与逐行播放一致」的前提。
     * 每个动画在 finished 时自动出表；被取消（cancel）同样出表。
     * @type {Array<object>}
     */
    var registry = [];

    /** 单调递增的动画序号，用于诊断排序 */
    var seq = 0;

    /**
     * 取 CSS 属性在元素上的**当前渲染值**（唯一合法起点来源）。
     * 优先用 getComputedStyle；不可用时返回 null。
     * @param {HTMLElement} el 目标元素
     * @param {string} prop 属性名（CSS 驼峰或短横线均可）
     * @returns {string|null} 计算值；取不到时 null
     */
    function computedValue(el, prop) {
        if (!el) return null;
        var view = null;
        try {
            view = (el.ownerDocument && el.ownerDocument.defaultView) ||
                (typeof window !== 'undefined' ? window : null);
        } catch (e) { view = null; }
        if (!view || typeof view.getComputedStyle !== 'function') return null;
        try {
            var cs = view.getComputedStyle(el);
            var v = cs ? cs[prop] : null;
            return (v == null || v === '') ? null : v;
        } catch (e) { return null; }
    }

    /**
     * 把关键帧的第一帧里所有属性的值替换成元素**当前渲染值**。
     * 起始值取「元素此刻的实际渲染值」而不是调用方声明的起始值 ——
     * 于是「该元素上已有动画在飞」时连点重播会从当前位置接续，不会瞬跳。
     *
     * 只在「该元素上本来就有在飞的动画」时调用 —— 全新元素 / 无动画元素必须保留调用方
     * 声明的起始值（例如淡入的 opacity:0），否则淡入会被算成「从当前值到当前值」而不生效。
     *
     * @param {HTMLElement} el 目标元素
     * @param {Array<Object>} keyframes 关键帧数组
     * @returns {Array<Object>} 替换首帧后的新数组（不修改入参）
     */
    function withCurrentStart(el, keyframes) {
        if (!keyframes || !keyframes.length || !keyframes[0]) return keyframes;
        var first = keyframes[0];
        var copy = null;
        Object.keys(first).forEach(function (k) {
            if (k === 'offset' || k === 'easing' || k === 'composite') return;
            var v = computedValue(el, k);
            if (v == null) return;
            if (!copy) copy = Object.assign({}, first);
            copy[k] = v;
        });
        if (!copy) return keyframes;
        var out = keyframes.slice();
        out[0] = copy;
        return out;
    }

    /** 注册一个动画句柄 */
    function register(entry) {
        entry.seq = ++seq;
        registry.push(entry);
        var done = function () { unregister(entry); };
        if (entry.handle && entry.handle.finished && typeof entry.handle.finished.then === 'function') {
            entry.handle.finished.then(done).catch(done);
        }
        return entry;
    }

    /** 注销一个动画条目 */
    function unregister(entry) {
        var i = registry.indexOf(entry);
        if (i >= 0) registry.splice(i, 1);
    }

    /**
     * 当前仍在播放的动画数量。
     * 引擎的点击屏蔽链据此判断「是否处于动画中」。
     * @returns {number}
     */
    function moveCount() {
        var n = 0;
        for (var i = 0; i < registry.length; i++) {
            var h = registry[i].handle;
            var st = h ? h.playState : null;
            // 无句柄（降级路径）时保守计入；被取消的条目视作已结束
            if (!h || st === 'running' || st === 'paused') n++;
        }
        return n;
    }

    /**
     * 把所有动画**立即结算到终态**。
     * 顺序：finish()（跳到终点）→ commitStyles()（把终态写进行内样式）→ cancel()（释放）。
     * 与「cancel 停在当前」的区别是语义性的：前者保证快进后位置与逐行播放完全一致。
     * @returns {number} 被结算的动画数量
     */
    function finishAll() {
        var snapshot = registry.slice();
        for (var i = 0; i < snapshot.length; i++) {
            var h = snapshot[i].handle;
            if (!h) { unregister(snapshot[i]); continue; }
            try {
                if (typeof h.finish === 'function') h.finish();       // 落终点（fill:forwards 生效）
            } catch (e) { /* ignore */ }
            commitAndCancel(h);                                        // 固化 + 释放
            unregister(snapshot[i]);
        }
        return snapshot.length;
    }

    /**
     * 取消元素上所有正在运行的动画，并先把当前样式提交到行内样式。
     * 用于在开始新动作前清场，避免旧动画与新动画叠加。
     * @param {HTMLElement} el 目标元素
     * @returns {void}
     * @sideeffect 会调用 commitStyles 写入行内样式并 cancel 现有动画
     */
    function cancelAll(el) {
        if (!el || typeof el.getAnimations !== 'function') return;
        el.getAnimations().forEach(function (a) {
            commitAndCancel(a);
        });
    }

    /**
     * 将动画的当前计算样式提交到元素行内样式后取消该动画。
     * 这样即使动画被取消（fill:forwards 失效），元素仍停留在最终视觉状态。
     * 两步均用 try/catch 包裹：部分浏览器/非标准元素上 commitStyles/cancel 可能抛错。
     * @param {Animation} handle Web Animations API 返回的动画句柄
     * @returns {void}
     */
    function commitAndCancel(handle) {
        if (!handle) return;
        try {
            if (typeof handle.commitStyles === 'function') handle.commitStyles();
        } catch (e) { /* ignore */ }
        try { handle.cancel(); } catch (e) { /* ignore */ }
    }

    /**
     * 播放一段关键帧动画。
     * 默认使用 fill:'forwards' 与 easing:'ease'；当未指定 persist 时，动画结束后会
     * 自动 commitStyles + cancel，把最终状态固化到行内样式并释放动画对象。
     *
     * **起点 invariant**：若该元素上本来就有在飞的动画，本函数会先把它们的
     * 当前渲染值 commitStyles 固化，并用**计算样式**重写首帧 —— 即「动画起点永远等于
     * 打断那一刻的真实视觉位置」。这是防止连点拉扯的底线，不要改成从缓存的目标值起算。
     * 可用 `options.resumeFromCurrent = false` 显式关闭（默认开启）。
     *
     * @param {HTMLElement} el 目标元素
     * @param {Array<Object>} keyframes 关键帧数组
     * @param {Object} [options] 动画选项，会直接透传给 el.animate；额外支持
     *        persist（true=保留句柄不自动提交）、resumeFromCurrent（false=不重写首帧）
     * @returns {Animation|null} 动画句柄；元素不支持 animate 时返回 null
     * @sideeffect 调用 el.animate，可能异步修改元素行内样式；写入活动动画注册表
     */
    function play(el, keyframes, options) {
        if (!el || typeof el.animate !== 'function') return null;
        var src = options || {};
        var persist = !!src.persist;
        var resume = src.resumeFromCurrent !== false;
        var opts = Object.assign({ fill: 'forwards', easing: 'ease' }, src);
        delete opts.persist;
        delete opts.resumeFromCurrent;

        // 打断在飞动画时，先把「当前渲染值」冻结为首帧起点
        if (resume && typeof el.getAnimations === 'function') {
            var running = [];
            try { running = el.getAnimations() || []; } catch (e) { running = []; }
            var hadRunning = false;
            for (var ri = 0; ri < running.length; ri++) {
                var ps = running[ri] ? running[ri].playState : null;
                if (ps === 'running' || ps === 'paused') { hadRunning = true; break; }
            }
            if (hadRunning) {
                // commitStyles 把合成线程算出的当前值写进行内样式，再以它为首帧
                for (var rj = 0; rj < running.length; rj++) commitAndCancel(running[rj]);
                keyframes = withCurrentStart(el, keyframes);
            }
        }

        var handle = el.animate(keyframes, opts);
        var entry = {
            el: el,
            handle: handle,
            from: keyframes && keyframes[0] ? keyframes[0] : null,
            to: keyframes && keyframes.length ? keyframes[keyframes.length - 1] : null,
            startTick: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
            dur: opts.duration || 0,
            easing: opts.easing || 'ease'
        };
        register(entry);

        // 非持久模式：动画正常结束后自动固化样式并取消；若被取消则走 catch 静默忽略
        if (!persist && handle && handle.finished && typeof handle.finished.then === 'function') {
            handle.finished.then(function () { commitAndCancel(handle); }).catch(function () { /* cancelled */ });
        }
        return handle;
    }

    /**
     * 生成不透明度淡入/淡出关键帧。
     * @param {number|string} from 起始不透明度（0~1）
     * @param {number|string} to 结束不透明度（0~1）
     * @returns {Array<Object>} 两帧关键帧数组
     */
    function fadeOpacity(from, to) {
        return [{ opacity: String(from) }, { opacity: String(to) }];
    }

    /**
     * 生成水平发抖关键帧（通过 left 的 calc 正负偏移实现）。
     * @param {string|number} baseLeft 立绘基准 left 值，空/非法时默认 '50%'
     * @param {number} offsetPercent 左右偏移幅度（百分比），非法时默认 2
     * @returns {Array<Object>} 两帧关键帧数组
     */
    function shakeKeyframes(baseLeft, offsetPercent) {
        var left = baseLeft == null || baseLeft === '' ? '50%' : String(baseLeft);
        var off = Number(offsetPercent);
        if (!Number.isFinite(off)) off = 2;
        return [
            { left: 'calc(' + left + ' - ' + off + '%)' },
            { left: 'calc(' + left + ' + ' + off + '%)' }
        ];
    }

    /**
     * 生成点头关键帧（bottom 上下小幅位移后回到原位）。
     * @param {number} baseBottom 基准 bottom 值（百分比），非法时按 0 处理
     * @returns {Array<Object>} 四帧关键帧数组（含首尾回位）
     */
    function nodKeyframes(baseBottom) {
        var b = Number(baseBottom);
        if (!Number.isFinite(b)) b = 0;
        return [
            { bottom: b + '%' },
            { bottom: (b + 2) + '%' },
            { bottom: (b - 2) + '%' },
            { bottom: b + '%' }
        ];
    }

    /**
     * 生成「得意」动作关键帧：bottom 与 rotate 交替摆动，形成昂首挺胸的摇摆感。
     * transform 中固定保留 translateX(-50%) 以维持立绘水平居中。
     * @param {number} baseBottom 基准 bottom 值（百分比），非法时按 0 处理
     * @param {number} baseRotation 基准旋转角（度），非法时按 0 处理
     * @returns {Array<Object>} 四帧关键帧数组
     */
    function proudKeyframes(baseBottom, baseRotation) {
        var b = Number(baseBottom);
        if (!Number.isFinite(b)) b = 0;
        var r = Number(baseRotation);
        if (!Number.isFinite(r)) r = 0;
        var tx = 'translateX(-50%) ';
        return [
            { bottom: (b + 5) + '%', transform: tx + 'rotate(' + (r - 5) + 'deg)' },
            { bottom: (b - 5) + '%', transform: tx + 'rotate(' + r + 'deg)' },
            { bottom: (b + 5) + '%', transform: tx + 'rotate(' + (r + 5) + 'deg)' },
            { bottom: (b - 5) + '%', transform: tx + 'rotate(' + r + 'deg)' }
        ];
    }

    /**
     * 生成惊吓（jumpscare）缩放关键帧：围绕基准缩放做 1.07 / 0.93 的快速抖动。
     * @param {number} baseScale 基准缩放，非法或非正数时按 1 处理
     * @returns {Array<Object>} 五帧关键帧数组（首尾回到基准缩放）
     */
    function jumpscareScaleKeyframes(baseScale) {
        var s = Number(baseScale);
        if (!Number.isFinite(s) || s <= 0) s = 1;
        // 统一附加 translateX(-50%)，保证与立绘居中定位一致
        function t(v) { return 'translateX(-50%) scale(' + v + ')'; }
        return [
            { transform: t(s) },
            { transform: t(s * 1.07) },
            { transform: t(s * 0.93) },
            { transform: t(s * 1.07) },
            { transform: t(s) }
        ];
    }

    /**
     * 生成倾斜（摇头/歪头）关键帧，仅改变旋转角。
     * @param {number} fromDeg 起始角度（度），非法按 0 处理
     * @param {number} toDeg 结束角度（度），非法按 0 处理
     * @returns {Array<Object>} 两帧关键帧数组
     */
    function tiltKeyframes(fromDeg, toDeg) {
        var from = Number(fromDeg);
        var to = Number(toDeg);
        if (!Number.isFinite(from)) from = 0;
        if (!Number.isFinite(to)) to = 0;
        return [
            { transform: 'translateX(-50%) rotate(' + from + 'deg)' },
            { transform: 'translateX(-50%) rotate(' + to + 'deg)' }
        ];
    }

    /**
     * 生成「淡入 + 位移」复合关键帧（常用于入场/退场）。
     * @param {number|string} opacityFrom 起始不透明度
     * @param {number|string} opacityTo 结束不透明度
     * @param {string} transformFrom 起始 transform 字符串
     * @param {string} transformTo 结束 transform 字符串
     * @returns {Array<Object>} 两帧关键帧数组
     */
    function fadeSlideKeyframes(opacityFrom, opacityTo, transformFrom, transformTo) {
        return [
            { opacity: String(opacityFrom), transform: transformFrom },
            { opacity: String(opacityTo), transform: transformTo }
        ];
    }

    // 对外导出：浏览器挂载至 root.ShioriCharAnim，Node 环境导出供测试使用
    var api = {
        cancelAll: cancelAll,
        play: play,
        // 动画注册表接口
        moveCount: moveCount,
        /** 别名：语义化命名，供点击屏蔽链读取 */
        getMoveCount: moveCount,
        finishAll: finishAll,
        /** 诊断：当前注册表快照（只读拷贝） */
        listAnimations: function () { return registry.slice(); },
        // 起点取值工具（测试与外部校验用）
        computedValue: computedValue,
        withCurrentStart: withCurrentStart,
        fadeOpacity: fadeOpacity,
        shakeKeyframes: shakeKeyframes,
        nodKeyframes: nodKeyframes,
        proudKeyframes: proudKeyframes,
        jumpscareScaleKeyframes: jumpscareScaleKeyframes,
        tiltKeyframes: tiltKeyframes,
        fadeSlideKeyframes: fadeSlideKeyframes,
        commitAndCancel: commitAndCancel
    };
    root.ShioriCharAnim = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
