/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 统一帧节拍（ContinuousTick）。
 *
 * 结构：
 *
 *     抽干事件队列  →  continuous handler（动画 beat）  →  派发窗口更新（绘制）
 *
 * 本模块把这三步收进**唯一一个 requestAnimationFrame**。任何需要「每帧推进一次」的
 * 逻辑（打字机、立绘动画同步、SKIP / AUTO 的时间累积、Canvas 舞台重绘）都注册成
 * continuous handler，而不是各自开 setInterval / setTimeout。
 *
 * 对外语义：
 *   - 所有 handler 每帧按注册顺序调用一次，参数为 (tick, dt)（毫秒）；
 *   - 单个 handler 抛错只吞掉自己，不影响其它 handler 与本循环；
 *   - handler 可以在回调里 remove 自己（数组遍历用快照）。
 *
 * 输入队列：
 *   - 点击等输入只入队，不当场执行；由节拍在下一帧消费；
 *   - 同一帧内的多个 click **合并为一次**（多次调用等价一次）；
 *   - 只要还有 handler 或待消费输入，循环就一直挂着；空闲时自动停（零空转开销）。
 */
(function (root) {
    'use strict';

    /** continuous handler 列表（每帧调用一次） */
    var handlers = [];
    /** 输入队列：{ type, ... } ；由 inputHandler 消费 */
    var queue = [];
    /** 本帧已入队的 click 事件对象（用于同帧去重与计数累加）；false 表示本帧暂无 */
    var clickPending = false;
    /** 输入消费者（由引擎注册） */
    var inputHandler = null;
    /** rAF 句柄；0 表示未排队 */
    var rafId = 0;
    /** 上一帧时间戳（算 dt 用） */
    var lastTick = 0;
    /** 是否已暂停（页面 hidden 时暂停，避免后台空跑） */
    var paused = false;
    /** 统计：便于性能门禁断言「只有一个 rAF 在跑」 */
    var stats = { frames: 0, coalescedClicks: 0, dispatchedClicks: 0, maxHandlers: 0 };

    function now() {
        if (root.performance && typeof root.performance.now === 'function') return root.performance.now();
        return Date.now();
    }

    function raf(fn) {
        if (typeof root.requestAnimationFrame === 'function') return root.requestAnimationFrame(fn);
        return root.setTimeout(function () { fn(now()); }, 16);
    }

    /** 是否需要继续跑（有 handler 或还有输入待消费） */
    function shouldRun() {
        return !paused && (handlers.length > 0 || queue.length > 0);
    }

    /** 排队下一帧（幂等：已有排队帧时不重复排） */
    function schedule() {
        if (rafId) return;
        if (!shouldRun()) return;
        rafId = raf(frame);
    }

    /** 一帧的完整处理：消费输入 → 推进 handler */
    function frame(t) {
        rafId = 0;
        var tick = (typeof t === 'number') ? t : now();
        var dt = lastTick ? (tick - lastTick) : 16.7;
        // 切页 / 后台回来会得到巨大的 dt，钳到 100ms 以内，避免一次性跳过整段动画
        if (!(dt > 0) || dt > 100) dt = 16.7;
        lastTick = tick;
        stats.frames++;

        // ① 抽干事件队列
        drainInput(tick);

        // ② 推进所有 continuous handler（打字机 / 立绘 / SKIP / AUTO / 绘制）
        if (handlers.length) {
            var snapshot = handlers.slice();
            for (var i = 0; i < snapshot.length; i++) {
                try {
                    snapshot[i](tick, dt);
                } catch (e) {
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('[Tick] continuous handler 抛错（已跳过）', e);
                    }
                }
            }
        }

        // ③ 还有活就继续
        schedule();
    }

    /** 消费输入队列；click 同帧合并为一次（合并后的 count 记录本帧实际点击次数） */
    function drainInput(tick) {
        if (!queue.length) return;
        var batch = queue;
        queue = [];
        clickPending = false;
        if (typeof inputHandler !== 'function') return;

        var clickEv = null;
        var clicks = 0;
        var rest = [];
        for (var i = 0; i < batch.length; i++) {
            var ev = batch[i];
            if (!ev) continue;
            if (ev.type === 'click') {
                // 保留第一个 click 作为派发载体（target 等信息以首次点击为准）；
                // 计数按事件自带的 count 累加（pushInput 已把同帧连点并进这个 count）
                if (!clickEv) clickEv = ev;
                clicks += (ev.count || 1);
            } else {
                rest.push(ev);
            }
        }
        for (var j = 0; j < rest.length; j++) {
            try { inputHandler(rest[j], tick); } catch (e) { /* 单个输入失败不影响其它 */ }
        }
        if (clicks > 0) {
            clickEv.count = clicks;
            stats.dispatchedClicks++;
            try { inputHandler(clickEv, tick); } catch (e) { /* 同上 */ }
        }
    }

    /* ── 对外 API ───────────────────────────────────────────── */

    /**
     * 注册一个每帧回调（continuous handler）。
     * @param {Function} fn 形如 (tick, dt) => void
     * @returns {boolean} 是否注册成功
     */
    function addContinuousHandler(fn) {
        if (typeof fn !== 'function') return false;
        if (handlers.indexOf(fn) >= 0) return true;   // 幂等：重复注册不叠加
        handlers.push(fn);
        if (handlers.length > stats.maxHandlers) stats.maxHandlers = handlers.length;
        schedule();
        return true;
    }

    /**
     * 注销一个 continuous handler（可在回调内自我注销）。
     * @param {Function} fn 之前注册的函数引用
     * @returns {boolean} 是否命中并移除
     */
    function removeContinuousHandler(fn) {
        var i = handlers.indexOf(fn);
        if (i < 0) return false;
        handlers.splice(i, 1);
        return true;
    }

    /**
     * 注册输入消费者（引擎只需注册一次）。签名 (event, tick) => void。
     * @param {Function} fn 消费者
     * @returns {void}
     */
    function setInputHandler(fn) {
        inputHandler = (typeof fn === 'function') ? fn : null;
    }

    /**
     * 入队一条输入。click 在同一帧内会被合并为一次（多次调用等价一次）。
     * @param {object} ev 输入对象，至少含 type；click 可附带 target
     * @returns {void}
     */
    function pushInput(ev) {
        if (!ev || !ev.type) return;
        if (ev.type === 'click') {
            // 同帧合并（同帧多次请求等价一次）：
            // 已有待处理 click 时不再入队，只累加它的 count，避免队列被连点撑爆
            if (clickPending) {
                clickPending.count = (clickPending.count || 1) + 1;
                stats.coalescedClicks++;
                return;
            }
            ev.count = 1;
            clickPending = ev;
        }
        queue.push(ev);
        schedule();
    }

    /** 清空待消费输入（切场景 / 读档时调用，避免旧点击落到新状态上） */
    function clearInput() {
        queue.length = 0;
        clickPending = false;
    }

    /** 暂停节拍（页面 hidden / 打开原生窗口时） */
    function pause() { paused = true; }

    /** 恢复节拍 */
    function resume() {
        paused = false;
        lastTick = 0;   // 丢弃暂停期间的时间差
        schedule();
    }

    /** 诊断快照（性能门禁断言用） */
    function getStats() {
        return {
            frames: stats.frames,
            handlers: handlers.length,
            queued: queue.length,
            coalescedClicks: stats.coalescedClicks,
            dispatchedClicks: stats.dispatchedClicks,
            maxHandlers: stats.maxHandlers,
            running: !!rafId,
            paused: paused
        };
    }

    var api = {
        addContinuousHandler: addContinuousHandler,
        removeContinuousHandler: removeContinuousHandler,
        setInputHandler: setInputHandler,
        pushInput: pushInput,
        clearInput: clearInput,
        pause: pause,
        resume: resume,
        getStats: getStats,
        /** 手动踢一帧（测试 / 立即生效场景用） */
        kick: function () { schedule(); }
    };

    root.ShioriTick = api;

    // 页面隐藏时暂停（对齐引擎既有约定：C# 原生窗口打开时不空跑）
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) pause();
            else resume();
        });
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
