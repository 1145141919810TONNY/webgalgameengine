/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 立绘（角色精灵）系统核心实现，负责立绘的渲染、更新、移除、动作表演与等待序列调度。
 * 统一以 state.charRuntime 作为运行时状态源，动画统一走 Web Animations API，DOM 样式仅作兜底。
 * 支持旧版单图立绘与新版差分立绘（dress + face 合成），并提供 Dom / Canvas / Precomposed 三种渲染模式。
 * 依赖 engine_core.js、engine_charparse.js，并向 gameEngine 追加本文件内的全部方法。
 */

/**
 * 获取全局立绘运行时状态仓库 API（window.ShioriCharRuntime）。
 * 该 API 负责 charRuntime 状态对象的创建、迁移、补丁与调试投影。
 * @returns {Object|null} 运行时 API 对象；未加载时返回 null。
 */
gameEngine._charRtApi = function() {
    return (typeof window !== 'undefined' && window.ShioriCharRuntime) ? window.ShioriCharRuntime : null;
};
/**
 * 获取全局立绘动画 API（window.ShioriCharAnim），封装 Web Animations API 与预置关键帧。
 * @returns {Object|null} 动画 API 对象；未加载时返回 null。
 */
gameEngine._charAnimApi = function() {
    return (typeof window !== 'undefined' && window.ShioriCharAnim) ? window.ShioriCharAnim : null;
};
/**
 * 获取（必要时惰性初始化）立绘运行时状态容器 state.charRuntime。
 * 该容器以 charId 为键，保存立绘的位置、缩放、旋转、动画句柄等运行时数据，是整个系统的状态源。
 * @returns {Object} 立绘运行时状态字典。
 * @sideeffect 当 state.charRuntime 不存在或类型非法时，就地重置为 {}。
 */
gameEngine._charBag = function() {
    if (!this.state.charRuntime || typeof this.state.charRuntime !== 'object')
        this.state.charRuntime = {};
    return this.state.charRuntime;
};
/**
 * 通知「说话人小头像」模块：某角色的立绘发生了变化。
 *
 * 合成完成 / 角色离场时调用。头像模块内部只在「这角色正是当前说话人」时才重算，
 * 所以引擎侧可以无脑调用，不需要在这里判断谁在说话。
 * 头像属可选增强：模块未加载或内部报错都不应影响立绘本身，故整体 try 住。
 *
 * @param {string} charName - 角色名（与 activeChars 的键一致）。
 * @param {boolean} [removed] - true 表示该角色已离场（隐藏头像），否则是合成完成（重裁）。
 * @returns {void}
 */
gameEngine._notifySpeakerAvatar = function(charName, removed) {
    try {
        if (typeof window === 'undefined') return;
        var sa = window.SpeakerAvatar;
        if (!sa) return;
        if (removed) {
            // charName 为空 = 「场上立绘全清」，走无条件收起的路径
            if (!charName) {
                if (typeof sa.onAllCharsRemoved === 'function') sa.onAllCharsRemoved();
            } else if (typeof sa.onCharRemoved === 'function') {
                sa.onCharRemoved(charName);
            }
        } else if (typeof sa.refresh === 'function') {
            sa.refresh(charName);
        }
    } catch (e) { /* 头像失败不影响立绘 */ }
};

/**
 * 推导立绘 DOM 元素所对应的 charId。
 * 优先通过运行时 API 从元素的调试 dataset 反向解析，失败时回退到调用方给定的 fallback。
 * @param {HTMLElement} charEl - 立绘 DOM 元素。
 * @param {string} [fallback] - 解析失败时使用的备用 ID。
 * @returns {string} charId；均无法确定时返回空字符串。
 */
gameEngine._charIdOf = function(charEl, fallback) {
    var api = this._charRtApi();
    if (api && charEl) {
        var id = api.charIdFromEl(charEl);
        if (id) return id;
    }
    return fallback || '';
};
/**
 * 读取指定立绘的运行时状态对象（不存在时由 API 自动补齐默认值）。
 * @param {string} charId - 立绘 ID。
 * @returns {Object|null} 运行时状态对象；API 未加载或 charId 为空时返回 null。
 */
gameEngine._getCharRt = function(charId) {
    var api = this._charRtApi();
    if (!api || !charId) return null;
    return api.ensure(this._charBag(), charId);
};
/**
 * 以补丁形式合并写入立绘运行时状态，并把最新状态投影到元素的调试 dataset 上。
 * @param {string} charId - 立绘 ID。
 * @param {Object} fields - 待合并的字段集合。
 * @param {HTMLElement} [el] - 需要同步调试 dataset 的 DOM 元素。
 * @returns {Object|null} 更新后的运行时状态对象。
 * @sideeffect 修改 state.charRuntime；可能写入 el 的 dataset 调试属性。
 */
gameEngine._patchCharRt = function(charId, fields, el) {
    var api = this._charRtApi();
    if (!api || !charId) return null;
    var rt = api.patch(this._charBag(), charId, fields);
    if (el) api.projectDebugDataset(el, rt);
    return rt;
};
/**
 * 取消某个立绘上所有正在运行的动画与定时器，并清理发抖/得意等持续动作的状态标记。
 * 在重新布景、移除、渐出等场景下必须先调用本方法，避免旧动画把元素拉回旧状态。
 * @param {HTMLElement} charEl - 立绘 DOM 元素（可为空）。
 * @param {string} charId - 立绘 ID（可为空）。
 * @returns {void}
 * @sideeffect 取消 WAAPI 动画、清空 runtime 中的 anim/timers、删除 shakingChars/proudChars 记录，并请求一次舞台重绘。
 */
gameEngine._cancelCharMotion = function(charEl, charId) {
    var anim = this._charAnimApi();
    if (anim) {
        if (charEl) {
            anim.cancelAll(charEl);
            var composite = charEl.querySelector && charEl.querySelector('.char-composite');
            if (composite) anim.cancelAll(composite);
        }
    }
    var api = this._charRtApi();
    var rt = (charId && api) ? api.ensure(this._charBag(), charId) : null;
    if (rt && api) api.cancelTimers(rt);
    if (charId) this._patchCharRt(charId, { anim: null, timers: [] }, charEl || null);
    if (charId && this.state.shakingChars) delete this.state.shakingChars[charId];
    if (charId && this.state.proudChars) delete this.state.proudChars[charId];
    this._requestCharStagePaint();
};
/**
 * 在立绘（或其合成图层）上播放一段 WAAPI 动画，并把动画句柄写回运行时状态。
 * @param {HTMLElement} charEl - 动画作用的 DOM 元素。
 * @param {string} charId - 立绘 ID。
 * @param {Array|Object} keyframes - 关键帧定义。
 * @param {Object} options - 动画参数（duration/easing/iterations 等）。
 * @returns {Object|null} 动画句柄；动画 API 缺失或元素为空时返回 null。
 * @sideeffect 写入 runtime.anim，并请求一次舞台重绘。
 */
gameEngine._playCharAnim = function(charEl, charId, keyframes, options) {
    var anim = this._charAnimApi();
    if (!anim || !charEl) return null;
    var handle = anim.play(charEl, keyframes, options);
    this._patchCharRt(charId, { anim: handle }, charEl);
    this._requestCharStagePaint();
    return handle;
};
/**
 * 获取全局立绘舞台 API（window.ShioriCharStage），提供 Canvas 合成模式的排序/采样/绘制能力。
 * @returns {Object|null} 舞台 API 对象；未加载时返回 null。
 */
gameEngine._charStageApi = function() {
    return (typeof window !== 'undefined' && window.ShioriCharStage) ? window.ShioriCharStage : null;
};
/**
 * 解析当前实际生效的立绘渲染模式。
 * 宿主要求的模式不是 'Auto' 时直接返回；为 'Auto' 时结合当前活跃立绘数量与场次闩锁
 * 依次委托给 ShioriHostConfig.effectiveCharRenderer 或 ShioriCharStage.effectiveMode 计算，
 * 最后回退到 state.charStageLatch（默认 'Dom'）。
 * @returns {string} 渲染模式：'Dom' | 'Canvas' | 'Precomposed'。
 */
gameEngine._effectiveCharRenderer = function() {
    var hc = (typeof window !== 'undefined') ? window.ShioriHostConfig : null;
    var mode = (hc && typeof hc.charRenderer === 'function') ? hc.charRenderer() : 'Dom';
    if (mode !== 'Auto') return mode;
    var count = (this.state.activeChars && typeof this.state.activeChars === 'object')
        ? Object.keys(this.state.activeChars).length : 0;
    if (hc && typeof hc.effectiveCharRenderer === 'function') {
        return hc.effectiveCharRenderer(null, count, this.state.charStageLatch);
    }
    var stage = this._charStageApi();
    if (stage && typeof stage.effectiveMode === 'function') {
        return stage.effectiveMode({ charRenderer: 'Auto' }, count, this.state.charStageLatch);
    }
    return this.state.charStageLatch || 'Dom';
};
/**
 * 开始一批立绘指令的处理：在 Auto 模式下按本批指令预判场次渲染模式并写入场次闩锁。
 * 闩锁保证同一括号串内（如 [消失 all] 之后继续添加）渲染模式不来回切换。
 * @param {string} charString - 本批原始立绘指令字符串。
 * @returns {void}
 * @sideeffect 可能更新 state.charStageLatch，并同步舞台 DOM 的 Canvas 开关。
 */
gameEngine._beginCharBatch = function(charString) {
        var hc = (typeof window !== 'undefined') ? window.ShioriHostConfig : null;
        var mode = (hc && typeof hc.charRenderer === 'function') ? hc.charRenderer() : 'Dom';
        if (mode === 'Auto') {
            var stage = this._charStageApi();
            var active = (this.state.activeChars && typeof this.state.activeChars === 'object')
                ? Object.keys(this.state.activeChars).length : 0;
            if (stage && typeof stage.hasClearAll === 'function' && stage.hasClearAll(charString))
                active = 0;
            var addCount = (stage && typeof stage.countAddInstructions === 'function')
                ? stage.countAddInstructions(charString) : 0;
            this.state.charStageLatch = (stage && typeof stage.latchForScene === 'function')
                ? stage.latchForScene(this.state.charStageLatch, active, addCount)
                : (addCount >= 2 ? 'Canvas' : 'Dom');
        }
        this._syncCharStageDom();
    };
/**
 * 根据当前渲染模式同步立绘舞台 DOM。
 * Canvas 模式：给容器加 char-stage-on 类、确保 #char-stage 画布存在并请求重绘；
 * 其它模式：移除开关类、停止重绘 RAF 循环，并清空/隐藏遗留画布内容。
 * @returns {void}
 * @sideeffect 增删容器 class、创建或隐藏 canvas、取消动画帧。
 */
gameEngine._syncCharStageDom = function() {
    var container = this.elements && this.elements.characterContainer;
    if (!container || !container.classList) return;
    var mode = this._effectiveCharRenderer();
    if (mode === 'Canvas') {
        container.classList.add('char-stage-on');
        this._ensureCharStageCanvas();
        this._requestCharStagePaint();
    } else {
        container.classList.remove('char-stage-on');
        this._stopCharStageRaf();
        var canvas = container.querySelector('#char-stage');
        if (canvas) {
            canvas.dataset.painted = '';
            canvas.style.display = 'none';
            var ctx = canvas.getContext && canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
};
/**
 * 计算 Canvas 舞台的溢出尺寸，使画布可以容纳比可视框更高的立绘。
 * 优先委托舞台 API 的 overflowStageSize；不可用时退化为与可视框等大、扩展比为 1。
 * @returns {{boxW:number, boxH:number, canvasW:number, canvasH:number, extendRatio:number}} 尺寸信息。
 */
gameEngine._charStageOverflowSize = function() {
        var container = this.elements && this.elements.characterContainer;
        var stageApi = this._charStageApi();
        var boxW = container ? container.clientWidth | 0 : 0;
        var boxH = container ? container.clientHeight | 0 : 0;
        var viewH = (typeof document !== 'undefined' && document.body)
            ? document.body.clientHeight | 0 : boxH;
        if (stageApi && typeof stageApi.overflowStageSize === 'function') {
            return stageApi.overflowStageSize(boxW, boxH, boxW, viewH);
        }
        return { boxW: boxW, boxH: boxH, canvasW: boxW, canvasH: boxH, extendRatio: 1 };
    };
/**
 * 确保立绘舞台画布 #char-stage 存在，并按溢出尺寸同步其 CSS 与像素尺寸。
 * 首次调用时注册 ResizeObserver，监听容器与 body 的尺寸变化以触发重绘。
 * @returns {HTMLCanvasElement|null} 舞台画布；容器不存在时返回 null。
 * @sideeffect 可能创建 canvas 节点、注册 ResizeObserver（保存在 this._charStageRo）。
 */
gameEngine._ensureCharStageCanvas = function() {
    var container = this.elements && this.elements.characterContainer;
    if (!container) return null;
    var canvas = container.querySelector('#char-stage');
    if (!canvas) {
        // 首次进入 Canvas 模式时惰性创建舞台画布
        canvas = document.createElement('canvas');
        canvas.id = 'char-stage';
        container.appendChild(canvas);
    }
    var size = this._charStageOverflowSize();
        canvas.style.display = 'block';
        canvas.style.left = '0';
        canvas.style.right = '0';
        canvas.style.bottom = '0';
        canvas.style.top = 'auto';
        canvas.style.width = '100%';
        canvas.style.height = (size.canvasH > 0 ? size.canvasH : size.boxH) + 'px';
        var w = size.canvasW | 0;
        var h = size.canvasH | 0;
        if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
            canvas.width = w;
            canvas.height = h;
        }
        if (typeof ResizeObserver === 'function' && !this._charStageRo) {
            var self = this;
            this._charStageRo = new ResizeObserver(function () {
                self._requestCharStagePaint();
            });
            this._charStageRo.observe(container);
            if (typeof document !== 'undefined' && document.body && document.body !== container) {
                this._charStageRo.observe(document.body);
            }
        }
        return canvas;
    };
/**
 * 停止 Canvas 舞台的重绘 RAF 循环。
 * 绘制请求可能挂在统一节拍上（`_charStageTickStep`），这里一并摘除，
 * 保证「整页只有一个 rAF（节拍自己）在跑」。
 * @returns {void}
 * @sideeffect 取消已排队的动画帧/节拍 handler 并把句柄置零。
 */
gameEngine._stopCharStageRaf = function() {
    if (this._charStageTickStep) {
        var tickApi = (typeof window !== 'undefined') ? window.ShioriTick : null;
        if (tickApi && typeof tickApi.removeContinuousHandler === 'function') {
            tickApi.removeContinuousHandler(this._charStageTickStep);
        }
        this._charStageTickStep = null;
    }
    this._charStagePending = false;
    if (this._charStageRaf) {
        cancelAnimationFrame(this._charStageRaf);
        this._charStageRaf = 0;
    }
};
/**
 * 请求一次 Canvas 舞台重绘（帧内合并：同一帧内多次调用只执行一次 _paintCharStage）。
 * 非 Canvas 模式直接返回；已有排队帧时也不重复排队。
 *
 * 优先并入统一节拍 —— 整页只保留节拍那一个 rAF，绘制与打字机、输入消费、
 * 立绘动画同步处在同一帧序里。节拍缺席时退回独立 rAF。
 *
 * @returns {void}
 * @sideeffect 可能注册节拍 handler 或 requestAnimationFrame。
 */
gameEngine._requestCharStagePaint = function() {
    if (this._effectiveCharRenderer() !== 'Canvas') return;
    if (this._charStagePending || this._charStageRaf) return;
    var self = this;
    var tickApi = (typeof window !== 'undefined') ? window.ShioriTick : null;
    if (tickApi && typeof tickApi.addContinuousHandler === 'function') {
        var step = function () {
            tickApi.removeContinuousHandler(step);
            if (self._charStageTickStep === step) self._charStageTickStep = null;
            self._charStagePending = false;
            self._paintCharStage();
        };
        this._charStageTickStep = step;
        this._charStagePending = true;
        tickApi.addContinuousHandler(step);
        return;
    }
    this._charStageRaf = requestAnimationFrame(function () {
        self._charStageRaf = 0;
        self._paintCharStage();
    });
};
/**
 * 执行 Canvas 舞台的一次完整重绘。
 * 按 z-index 排序遍历所有分层立绘，对已生成的合成图（dataset.charDiffBlit === '1'）
 * 采样其实时几何（位置/旋转/缩放/透明度/滤镜）后逐张绘制到 #char-stage；
 * 若检测到仍有元素在跑动画，则继续排队下一帧实现逐帧同步。
 * @returns {void}
 * @sideeffect 清空并重绘画布、写入 canvas.dataset.painted 标记、可能继续排队 RAF。
 */
gameEngine._paintCharStage = function() {
        if (this._effectiveCharRenderer() !== 'Canvas') return;
        var stageApi = this._charStageApi();
        var container = this.elements && this.elements.characterContainer;
        if (!stageApi || !container) return;
        var canvas = this._ensureCharStageCanvas();
        if (!canvas) return;
        var size = this._charStageOverflowSize();
        var boxW = size.boxW | 0;
        var boxH = size.boxH | 0;
        var canvasW = size.canvasW | 0;
        var canvasH = size.canvasH | 0;
        if (boxW < 1 || boxH < 1 || canvasW < 1 || canvasH < 1) return;
        if (canvas.width !== canvasW || canvas.height !== canvasH) {
            canvas.width = canvasW;
            canvas.height = canvasH;
        }
        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvasW, canvasH);
        var layered = stageApi.sortByZIndex
            ? stageApi.sortByZIndex(container.querySelectorAll('.character-layered'))
            : container.querySelectorAll('.character-layered');
        var anyAnim = false;
        var painted = 0;
        for (var i = 0; i < layered.length; i++) {
            var el = layered[i];
            var composite = el.querySelector && el.querySelector('.char-composite');
            if (!composite || composite.dataset.charDiffBlit !== '1') continue;
            var bmpW = composite.naturalWidth || composite.width || 0;
            var bmpH = composite.naturalHeight || composite.height || 0;
            if (!(bmpW > 0) || !(bmpH > 0)) continue;
            var live = stageApi.sampleLive(el, composite, boxW, boxH);
            var layout = {
                cx: live.cx,
                yBottom: live.yBottom,
                rotation: live.rotation,
                scale: live.scale,
                dispW: boxH * (bmpW / bmpH),
                dispH: boxH,
                stageH: canvasH,
                opacity: live.opacity,
                filter: live.filter,
                extraX: live.extraX,
                extraY: live.extraY
            };
            try {
                stageApi.drawSprite(ctx, composite, layout, canvasH);
                painted++;
            } catch (e) { /* skip a broken composite; keep other sprites */ }
            if (typeof el.getAnimations === 'function' && el.getAnimations().length) anyAnim = true;
            if (typeof composite.getAnimations === 'function' && composite.getAnimations().length) anyAnim = true;
        }
        canvas.dataset.painted = painted > 0 ? '1' : '';
        if (anyAnim) this._requestCharStagePaint();
    };
/**
 * 订阅动画结束事件（兼容无动画句柄的降级路径）。
 * 若句柄提供 finished Promise，则在正常结束时调用 fn，被取消时按 alsoOnCancel 决定是否也调用 fn；
 * 无有效句柄时同步立即执行 fn，保证调用方逻辑不会因缺少动画而中断。
 * @param {Object} handle - WAAPI 动画句柄（可为空）。
 * @param {Function} fn - 动画结束（或降级）后执行的回调。
 * @param {boolean} [alsoOnCancel] - 为 true 时动画被取消也执行 fn（调用方自行负责清理）。
 * @returns {void}
 */
gameEngine._onAnimFinished = function(handle, fn, alsoOnCancel) {
    if (handle && handle.finished && typeof handle.finished.then === 'function') {
        handle.finished.then(fn).catch(alsoOnCancel ? fn : function () { /* cancelled: caller owns teardown */ });
        return;
    }
    fn();
};

    /**
     * 解析立绘字符串中的 [wait time=...] 序列为结构化数组。
     *
     * 双轨解析：优先走 DSL 编译器（window.__shiori.dsl.compile），当单个 part 被编译为
     * 唯一的 wait/mode=time 节点时直接生成等待段；否则回退到正则匹配 [wait time=N]。
     * 其余片段按 [xxx] 切分为立绘指令段，供 executeCharWaitSequence 顺序执行。
     *
     * @param {string} charString - 原始立绘字符串。
     * @returns {Array|null} 序列数组（元素为 {type:'wait',duration} 或 {type:'item',instructions}）；
     *                       不包含 wait 标签或输入非法时返回 null。
     */

gameEngine.parseCharWaitSequence = function(charString) {
        if (!charString || typeof charString !== 'string') return null;
        // 检查是否包含 [wait time= 或 [wait time =（允许 time 和 = 之间有空格）
        const hasWaitTag = /\[\s*wait\s+time\s*=/i.test(charString) || /@wait\s+time\s*=/i.test(charString);
        if (!hasWaitTag && !charString.includes('[wait time=') && !charString.includes('[wait time =')) return null;
        
        const segments = [];
        const parts = charString.split(',').map(s => s.trim()).filter(s => s);
        
        console.log('[parseCharWaitSequence] 输入:', charString);
        console.log('[parseCharWaitSequence] parts:', parts);
        
        for (const part of parts) {
            const dsl = (typeof window === 'object' && window && window.__shiori && window.__shiori.dsl) ? window.__shiori.dsl : null;
            if (dsl && typeof dsl.compile === 'function') {
                const waitNodes = (dsl.compile(part).nodes) || [];
                if (waitNodes.length === 1 && waitNodes[0].kind === 'wait' && waitNodes[0].mode === 'time') {
                    const duration = parseInt(waitNodes[0].ms, 10);
                    if (!isNaN(duration) && duration > 0) {
                        segments.push({ type: 'wait', duration });
                    }
                    continue;
                }
            }
            // 更新正则以允许 time 和 = 之间有空格
            const waitMatch = part.match(/^\[wait\s+time\s*=\s*(\d+)\s*\]$/);
            console.log('[parseCharWaitSequence] part:', part, 'waitMatch:', waitMatch);
            if (waitMatch) {
                const duration = parseInt(waitMatch[1], 10);
                console.log('[parseCharWaitSequence] wait 匹配成功, duration:', duration);
                if (!isNaN(duration) && duration > 0) {
                    segments.push({ type: 'wait', duration });
                }
                continue;
            }
            
            const instructions = part.match(/\[([^\]]+)\]/g);
            if (instructions && instructions.length > 0) {
                console.log('[parseCharWaitSequence] instructions 匹配:', instructions);
                segments.push({ type: 'item', instructions: instructions.map(i => i.slice(1, -1).trim()) });
            }
        }
        
        console.log('[parseCharWaitSequence] 结果 segments:', segments);
        return segments;
    };


    
    /**
     * 执行立绘序列（支持 [wait time] 标签）。
     *
     * 递归 processNext 逐段推进：wait 段注册 setTimeout 并把 {timeoutId, skip} 写入
     * state.waitSequences.chars 以支持玩家点击跳过；item 段直接下发立绘指令后立即继续。
     * 执行前先调用 _beginCharBatch 预判场次渲染模式，保证整段序列共享同一次闩锁。
     *
     * @param {Array} segments - parseCharWaitSequence 解析后的序列段数组。
     * @returns {void}
     * @sideeffect 读写 state.waitSequences.chars；注册定时器；调用 renderSingleCharInstruction。
     */
gameEngine.executeCharWaitSequence = function(segments) {
        let index = 0;
        
        console.log('[executeCharWaitSequence] 开始执行, segments:', segments);
        
        // 递归推进器：每调用一次消费一个序列段，wait 段借 setTimeout 恢复，item 段同步继续
        const processNext = () => {
            // 全部消费完毕，清空跳过句柄表示序列结束
            if (index >= segments.length) {
                console.log('[executeCharWaitSequence] 序列完成');
                this.state.waitSequences.chars = null;
                return;
            }
            
            const seg = segments[index++];
            console.log('[executeCharWaitSequence] 处理 segment:', seg);
            
            // 等待段：注册定时器并暴露 skip 供点击跳过（跳过会取消定时器并立即推进）
            if (seg.type === 'wait') {
                console.log('[executeCharWaitSequence] 等待', seg.duration, 'ms');
                const timeoutId = setTimeout(processNext, seg.duration);
                this.state.waitSequences.chars = {
                    timeoutId,
                    skip: () => { clearTimeout(timeoutId); processNext(); }
                };
                return;
            }
            
            // 立绘段：逐条下发渲染，不做等待，完成后立即推进
            if (seg.instructions) {
                console.log('[executeCharWaitSequence] 执行指令:', seg.instructions);
                seg.instructions.forEach(instr => {
                    this.renderSingleCharInstruction(instr);
                });
            }
            
            processNext();
        };
        
        this.state.waitSequences.chars = { skip: processNext };
        // 汇总所有立绘段指令，一次性交给 _beginCharBatch 预判整批的渲染模式
        var batchParts = [];
        for (var si = 0; si < segments.length; si++) {
            var ins = segments[si] && segments[si].instructions;
            if (!ins) continue;
            for (var ii = 0; ii < ins.length; ii++) batchParts.push('[' + ins[ii] + ']');
        }
        this._beginCharBatch(batchParts.join(''));
        processNext();
    };


    
    /**
     * 隐藏所有角色立绘（无动画，直接置为透明且不可见）。
     * 注意：仅操作 .character 单图立绘，不处理新版 .character-layered 分层立绘。
     * @returns {void}
     * @sideeffect 直接改写各立绘元素的内联 opacity / visibility。
     */
gameEngine.hideAllCharacters = function() {
        const characters = this.elements.characterContainer.querySelectorAll('.character');
        characters.forEach(char => {
            char.style.opacity = '0';
            char.style.visibility = 'hidden';
        });
    };


    
    /**
     * 隐藏角色立绘（带动画）：所有角色同时淡出。
     * 采用 setInterval 以 5% 步长逐帧降低 opacity（间隔 time/20），全部淡完后置 hidden。
     * 所有角色（或本就无角色）处理完毕后延时 100ms 触发 nextLine() 推进剧情。
     * @param {number} time - 淡出持续时间（毫秒），决定步进间隔。
     * @returns {void}
     * @sideeffect 反复改写元素 opacity/visibility，并调用 this.nextLine()。
     */
gameEngine.hideCharacter = function(time) {
        const characters = this.elements.characterContainer.querySelectorAll('.character');
        if (characters.length > 0) {
            let completedCount = 0;
            // 对所有角色执行淡出动画（各自独立计时，用 completedCount 汇合）
            characters.forEach(char => {
                let opacity = parseFloat(char.style.opacity) || 1;
                const fadeInterval = setInterval(() => {
                    opacity -= 0.05;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeInterval);
                        char.style.visibility = 'hidden';
                        completedCount++;
                        
                        // 所有角色都淡出完成后继续下一行
                        if (completedCount === characters.length) {
                            setTimeout(() => {
                                this.nextLine();
                            }, 100);
                        }
                    }
                    char.style.opacity = opacity;
                }, time / 20); // 20 步均匀走完 time 毫秒
            });
        } else {
            // 没有角色时直接继续
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    };



    /**
     * 渲染单条立绘指令（方括号内部内容），是立绘 DSL 的分发入口。
     *
     * 分发优先级：
     *  1. 含逗号 → 视为连续动作序列，转交 executeCharSequence；
     *  2. 消失 / hide / remove → removeAllChars 或 removeChar（支持角色名标识符映射）；
     *  3. 渐出 / fadeOut → fadeOutAllChars 或 fadeOutChar；
     *  4. 左渐出/右渐出（lfadeOut/rfadeOut）→ 带方向的 fadeOut；
     *  5. 其余 → 解析 [角色名] [修饰词...] 图片ID：
     *     命中差分系统（resolveCharDiffFrame）走 updateCharDiff，否则走旧版 updateChar。
     *
     * @param {string} content - 指令内容（已去掉首尾方括号）。
     * @returns {void}
     * @sideeffect 依据指令类型调用对应的立绘渲染/移除方法；可能消费 state.charNameMap 中的角色名映射。
     */
gameEngine.renderSingleCharInstruction = function(content) {
        if (!content) return;
        
        // 检查是否为连续动作指令（包含逗号）
        if (content.includes(',')) {
            this.executeCharSequence(content);
            return;
        }

        const parts = content.split(/\s+/);
        
        // 处理消失指令（支持中英文及角色名称）
        if ((parts[0] === '消失' || parts[0] === 'hide' || parts[0] === 'remove') && parts.length >= 2) {
            const target = parts[1];
            
            // 检查是否为清除所有立绘的指令
            if (target === 'all' || target === '全部') {
                this.removeAllChars();
            } else {
                // 检查 target 是否为角色名称标识符
                let actualCharId = target;
                if (this.state.charNameMap[target]) {
                    actualCharId = this.state.charNameMap[target].charId;
                    delete this.state.charNameMap[target];
                }
                this.removeChar(actualCharId);
            }
            return;
        }
        
        // 处理渐出指令（支持中英文及角色名称）
        if ((parts[0] === '渐出' || parts[0] === 'fadeOut') && parts.length >= 2) {
            const target = parts[1];
            
            // 检查是否为清除所有立绘的指令
            if (target === 'all' || target === '全部') {
                this.fadeOutAllChars();
            } else {
                // 检查 target 是否为角色名称标识符
                let actualCharId = target;
                if (this.state.charNameMap[target]) {
                    actualCharId = this.state.charNameMap[target].charId;
                    delete this.state.charNameMap[target];
                }
                this.fadeOutChar(actualCharId);
            }
            return;
        }

        // 处理方向渐出指令（左渐出/右渐出）
        if ((parts[0] === '左渐出' || parts[0] === 'lfadeOut' || parts[0] === '右渐出' || parts[0] === 'rfadeOut') && parts.length >= 2) {
            const direction = (parts[0] === '左渐出' || parts[0] === 'lfadeOut') ? 'left' : 'right';
            const target = parts[1];

            // 检查是否为清除所有立绘的指令
            if (target === 'all' || target === '全部') {
                this.fadeOutAllChars(direction);
            } else {
                // 检查 target 是否为角色名称标识符
                let actualCharId = target;
                if (this.state.charNameMap[target]) {
                    actualCharId = this.state.charNameMap[target].charId;
                    delete this.state.charNameMap[target];
                }
                this.fadeOutChar(actualCharId, null, direction);
            }
            return;
        }

        // 处理显示/更新指令
        if (parts.length >= 1) {
            let roleName = null;
            let modifiersParts = [];
            let charId = null;

            // 检查第一个部分是否为角色名称标识符（非关键词）
            // 注意：仅当指令有多个部分时才可能是"角色名 + 修饰词"格式
            const firstPart = parts[0];
            if (parts.length > 1 && !this.isModifierKeyword(firstPart)) {
                roleName = firstPart;
                modifiersParts = parts.slice(1);
            } else {
                modifiersParts = parts;
            }

            if (modifiersParts.length === 0) return; // 如果没有剩余部分，则无法确定资源ID

            // 最后一个部分是图片ID，前面的是修饰词
            charId = modifiersParts[modifiersParts.length - 1];
            
            // 如果角色ID也是关键词，则视为无效指令或纯关键词指令（如 [消失]）
            if (this.isModifierKeyword(charId)) return;

            // 修饰词组 = 去掉末位图片ID后的部分（如 "左 前"）
            const modifiers = modifiersParts.slice(0, -1).join(' ');

            // 检测是否使用新系统（立绘差分系统）
            let isNewSystem = false;
            let newSystemParams = null;

            // 差分系统要求有角色名，且能把"角色名+修饰词+faceID"解析为 dress/face 组合
            if (roleName && typeof this.resolveCharDiffFrame === 'function') {
                newSystemParams = this.resolveCharDiffFrame(roleName, modifiersParts);
                if (newSystemParams) isNewSystem = true;
            }

            if (isNewSystem) {
                // 新系统：调用 updateCharDiff，传入完整 modifiersParts（包含 face ID）
                const fullModifiers = modifiersParts.join(' ');
                this.updateCharDiff(roleName, newSystemParams.orientation, newSystemParams.dress, newSystemParams.face, fullModifiers);
            } else {
                // 旧系统：使用原有逻辑
                this.updateChar(charId, modifiers, false, roleName);
            }
        }
    };



    /**
     * 检查文件名是否已包含已知图片扩展名
     * @param {string} filename
     * @returns {boolean}
     */
gameEngine._hasImageExtension = function(filename) {
        return /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(filename);
    };



    /**
     * 将图片基础路径统一为 /assets/chars/xxx 格式，用于查缓存
     * 支持 ./assets/chars/xxx、assets/chars/xxx、../assets/chars/xxx
     * @param {string} basePath
     * @returns {string}
     */
gameEngine._normalizeCharBasePath = function(basePath) {
        if (!basePath) return basePath;
        // 去除相对路径前缀（./ 与 ../），保证以 / 开头的绝对根路径形式进入缓存
        var normalized = basePath;
        if (normalized.indexOf('./') === 0) normalized = normalized.substring(2);
        if (normalized.indexOf('../') === 0) normalized = normalized.substring(3);
        if (normalized.indexOf('/') !== 0) normalized = '/' + normalized;
        return normalized;
    };



    /**
     * 加载图片，自动尝试多个扩展名
     *
     * 查找顺序：
     *  1. 路径已有扩展名 → 规范化为 /assets/... 后加载；onerror 时 ?r= cache-bust 重试一次
     *     （WebView2 进程首次 img.src 可能命中空磁盘缓存体，标题背景 / setBackground 同策略）
     *  2. 命中 C# 注入的全局映射 _SHIORI_EXT_MAP → 直接加载（零延迟）
     *  3. 命中本地缓存 _charExtCache → 直接加载
     *  4. 以上均未命中 → 顺序 onerror 链尝试 .png→.jpg→.jpeg→.webp→.bmp
     *     （命中后写入本地缓存）
     *
     * @param {HTMLImageElement} imgEl - img 元素（本方法只设置其 src 与 onload/onerror）。
     * @param {string} basePath - 基本路径（可能含或不含扩展名）。
     * @returns {void}
     * @sideeffect 修改 imgEl.src / imgEl.onload / imgEl.onerror，命中扩展名后写入 this._charExtCache。
     */
gameEngine._loadImageWithFallback = function(imgEl, basePath) {
        var self = this;
        if (!imgEl || !basePath) return;

        var normalized = self._normalizeCharBasePath(basePath);

        // 1. 已有已知扩展名：根路径加载 + 失败时 cache-bust 一次
        if (self._hasImageExtension(basePath)) {
            if (!imgEl.dataset) imgEl.dataset = {};
            imgEl.dataset.shioriCharRetried = '';
            var origOnerror = imgEl.onerror;
            if (origOnerror && origOnerror.name === 'onCharImgError') origOnerror = null;
            imgEl.onerror = function onCharImgError() {
                if (imgEl.dataset.shioriCharRetried === '1') {
                    imgEl.onerror = (origOnerror && origOnerror !== onCharImgError)
                        ? origOnerror : null;
                    if (imgEl.onerror) imgEl.onerror.call(imgEl);
                    return;
                }
                imgEl.dataset.shioriCharRetried = '1';
                var sep = normalized.indexOf('?') >= 0 ? '&' : '?';
                imgEl.src = normalized + sep + 'r=' + Date.now();
            };
            imgEl.src = normalized;
            return;
        }

        var shioriMap = window._SHIORI_EXT_MAP;
        var basePathNoExt = basePath;

        // 2. 查缓存：优先原始路径，再 normalized
        var ext = (shioriMap && shioriMap[basePathNoExt]) || self._charExtCache[basePathNoExt]
               || (shioriMap && shioriMap[normalized]) || self._charExtCache[normalized];

        if (ext) {
            self._charExtCache[basePathNoExt] = ext;
            if (normalized !== basePathNoExt) self._charExtCache[normalized] = ext;
            imgEl.src = normalized + ext;
            return;
        }

        // 3. 缓存未命中 → 顺序 onerror 链回退（可靠，无异步竞争）
        var exts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
        var idx = 0;

        var tryNext = function() {
            idx++;
            if (idx < exts.length) {
                imgEl.src = normalized + exts[idx];
            } else {
                imgEl.src = normalized + '.png';
                console.warn('[Engine] 所有扩展名加载失败:', normalized);
            }
        };

        var origOnload = imgEl.onload;
        imgEl.onload = function() {
            if (!self._charExtCache[basePathNoExt]) {
                self._charExtCache[basePathNoExt] = exts[idx >= 0 ? idx : 0];
                if (normalized !== basePathNoExt) {
                    self._charExtCache[normalized] = exts[idx >= 0 ? idx : 0];
                }
            }
            if (origOnload && origOnload !== imgEl.onload) origOnload.call(imgEl);
        };

        imgEl.onerror = tryNext;
        imgEl.src = normalized + exts[0];
    };



    /**
     * 角色资源路径解析（新系统）
     * 根据文件ID或完整路径，返回实际可用的文件路径
     * 注意：若文件名不含扩展名，则不拼接任何扩展名，由 _loadImageWithFallback 自动尝试
     * @param {string} fileIdOrPath - 文件ID或路径。
     * @param {string} charName - 角色名（用于拼接路径）。
     * @returns {string} 可用的文件路径（可能不含扩展名，交由 _loadImageWithFallback 探测）。
     * @sideeffect 首次调用时按 CHAR_DIFF_CONFIG 预填充 window.CHAR_FILE_MAP（懒加载）。
     */
gameEngine.resolveCharFilePath = function(fileIdOrPath, charName) {
        const CHAR_DIFF_CONFIG = window.CHAR_DIFF_CONFIG;
        const CHAR_PATH_MAP = window.CHAR_PATH_MAP || {};
        const CHAR_FILE_MAP = window.CHAR_FILE_MAP || {};

        // 懒加载预填充：仅首次调用时执行
        // 遍历配置中的每个角色/方位/服装/表情文件，建立 "角色名_文件名" → 完整路径 的反查表
        if (!this._charFileMapPrefilled) {
            this._charFileMapPrefilled = true;
            if (CHAR_DIFF_CONFIG) {
                for (const cfgCharName in CHAR_DIFF_CONFIG) {
                    const charConfig = CHAR_DIFF_CONFIG[cfgCharName];
                    const base = CHAR_PATH_MAP[cfgCharName]
                        ? CHAR_PATH_MAP[cfgCharName] + '/'
                        : `/assets/chars/${cfgCharName}/`;

                    for (const orientation in charConfig) {
                        const orientConfig = charConfig[orientation];
                        const fileLists = [orientConfig.dress, orientConfig.face];
                        for (const list of fileLists) {
                            if (!list) continue;
                            for (const item of list) {
                                const nsKey = `${cfgCharName}_${item.file}`;
                                const fullPath = (item.file && (item.file.startsWith('/') || item.file.includes('://')))
                                    ? item.file
                                    : base + item.file; // 不含扩展名，由 _loadImageWithFallback 自动尝试
                                if (!CHAR_FILE_MAP[nsKey]) {
                                    CHAR_FILE_MAP[nsKey] = fullPath;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 1. 完整路径直接返回
        if (fileIdOrPath && (fileIdOrPath.startsWith('/') || fileIdOrPath.includes('://'))) {
            return fileIdOrPath;
        }

        // 2. 命名空间 key 查找
        if (charName && CHAR_FILE_MAP[charName + '_' + fileIdOrPath]) {
            return CHAR_FILE_MAP[charName + '_' + fileIdOrPath];
        }

        // 3. 带角色名前缀的路径（不含扩展名，由 _loadImageWithFallback 处理）
        if (charName && CHAR_PATH_MAP[charName]) {
            return CHAR_PATH_MAP[charName] + '/' + fileIdOrPath;
        }

        // 4. 回退到根目录（不含扩展名，由 _loadImageWithFallback 处理）
        return '/assets/chars/' + charName + '/' + fileIdOrPath;
    };



    /**
     * 更新新系统立绘（dress+face 合成单张 canvas 后再整体变换）
     * @param {string} charName - 角色名
     * @param {string} orientation - 方位
     * @param {object} dress - dress 对象
     * @param {object} face - face 对象
     * @param {string} charName - 角色名（同时作为 charId 与 DOM id 后缀）。
     * @param {string} orientation - 方位。
     * @param {object} dress - dress 配置对象（含 file/x/y/z 等）。
     * @param {object} face - face 配置对象（含 file/x/y/z 等）。
     * @param {string} modifiers - 修饰词字符串。
     * @returns {void}
     * @sideeffect 创建/更新 .character-layered 容器与合成图层、写入 charRuntime、注册 activeChars 与 charNameMap。
     */
gameEngine.updateCharDiff = function(charName, orientation, dress, face, modifiers) {
        if (!dress || !face) {
            console.error('[CharDiff] 缺少 dress 或 face 参数');
            return;
        }

        const dressPath = this.resolveCharFilePath(dress.file, charName);
        const facePath = this.resolveCharFilePath(face.file, charName);

        // 创建或更新角色容器
        let charContainer = document.getElementById(`char-${charName}`);
        const isNewChar = !charContainer;
        if (isNewChar) {
            charContainer = document.createElement('div');
            charContainer.id = `char-${charName}`;
            charContainer.className = 'character-layered';
            charContainer.style.position = 'absolute';
            charContainer.style.width = '100%';
            charContainer.style.height = '100%';
            charContainer.style.pointerEvents = 'none';
            this.elements.characterContainer.appendChild(charContainer);
        }

        // 拼接后只保留一张合成图，避免 dress/face 两张 img 在快进时各自过渡而错位。
        // 读 L3 charRenderer；Precomposed 走 /char-frame 单 img；
        // Canvas/Auto 闩锁后走 JS blit + 单层 #char-stage。
        const renderer = this._effectiveCharRenderer();
        charContainer.dataset.charRenderer = renderer;
        const compositeEl = this._ensureCharCompositeEl(charContainer, renderer);

        // 解析修饰词
        const props = this.parseCharDiffModifiers(modifiers, charName, dress, face);

        // 位置计算：dress 自带的 x/y/z 作为基准，z 为相对 100% 的百分比增量
        let finalLeft = (dress && dress.x !== undefined) ? dress.x + '%' : '50%';
        let finalBottom = (dress && dress.y !== undefined) ? dress.y + '%' : '0';
        const dressScale = (dress && dress.z !== undefined) ? (100 + dress.z) / 100 : 1;
        let finalScale = dressScale * (props.scale || 1);
        // 缩放非法（NaN/<=0）时回退为 1，避免元素消失
        if (!Number.isFinite(finalScale) || finalScale <= 0) {
            finalScale = 1;
        }

        // 精确坐标（x:/y:）在同基准上叠加偏移
        if (props.preciseX !== null) {
            const baseLeft = parseFloat(finalLeft) || 50;
            finalLeft = (baseLeft + props.preciseX) + '%';
        }
        if (props.preciseY !== null) {
            const baseBottom = parseFloat(finalBottom) || 0;
            finalBottom = (baseBottom + props.preciseY) + '%';
        }

        // 位置关键词：以 1/6.4 舞台宽（15.625%）为一档，仅当未给出精确坐标时生效
        if (props.preciseX === null) {
            const X_KEYWORD_STEP = 15.625;
            let leftValue = parseFloat(finalLeft) || 50;
            if (props.position === 'leftl') leftValue -= X_KEYWORD_STEP * 2;
            else if (props.position === 'left') leftValue -= X_KEYWORD_STEP;
            else if (props.position === 'leftr') leftValue -= X_KEYWORD_STEP / 2;
            else if (props.position === 'rightl') leftValue += X_KEYWORD_STEP / 2;
            else if (props.position === 'right') leftValue += X_KEYWORD_STEP;
            else if (props.position === 'rightr') leftValue += X_KEYWORD_STEP * 2;
            finalLeft = leftValue + '%';
        }

        // 纵向关键词：以 37.037%（约屏高 1/2.7）为一档，自上而下逐档偏移 bottom
        if (props.preciseY === null) {
            const Y_KEYWORD_STEP = 37.037;
            let bottomValue = parseFloat(finalBottom) || 0;
            if (props.vertical === 'upu') bottomValue += Y_KEYWORD_STEP * 2;
            else if (props.vertical === 'upm') bottomValue += Y_KEYWORD_STEP * 1.5;
            else if (props.vertical === 'up') bottomValue += Y_KEYWORD_STEP;
            else if (props.vertical === 'downd') bottomValue -= Y_KEYWORD_STEP * 2;
            else if (props.vertical === 'downm') bottomValue -= Y_KEYWORD_STEP * 1.5;
            else if (props.vertical === 'down') bottomValue -= Y_KEYWORD_STEP;
            finalBottom = bottomValue + '%';
        }

        // 位置继承：runtime 是源，style 仅兜底
        if (!isNewChar) {
            const prevRt = this._getCharRt(charName);
            if (!props.positionExplicit) {
                finalLeft = (prevRt && prevRt.left) || charContainer.style.left || finalLeft;
            }
            if (!props.verticalExplicit) {
                finalBottom = (prevRt && prevRt.bottom) || charContainer.style.bottom || finalBottom;
            }
        }

        // 旋转：站立动作保持当前角度，其余按 standFromRotation 归一到 [-90,90] 区间
        const prevLayout = this._getCharRt(charName);
        const fromRot = (prevLayout && Number.isFinite(prevLayout.rotation)) ? prevLayout.rotation : 0;
        const layoutRot = (props.actionType === 'stand')
            ? fromRot
            : this.standFromRotation(prevLayout, props.preciseZ);
        const rotCss = (deg) => {
            const n = Number.isFinite(deg) ? deg : 0;
            return `translateX(-50%) rotate(${n}deg)`;
        };
        const transformValue = rotCss(layoutRot);

        // 非瞬切且位置/角度确有变化时，先播一段 500ms 的布局过渡动画，再把终值落到内联样式
        const isInstant = props.instant;
        charContainer.style.transition = 'none';
        if (!isInstant && !isNewChar && prevLayout &&
            this.shouldAnimateCharLayout(prevLayout, finalLeft, finalBottom, layoutRot)) {
            this._playCharAnim(charContainer, charName, [
                {
                    left: prevLayout.left || charContainer.style.left || finalLeft,
                    bottom: prevLayout.bottom || charContainer.style.bottom || finalBottom,
                    transform: charContainer.style.transform || rotCss(fromRot)
                },
                { left: finalLeft, bottom: finalBottom, transform: transformValue }
            ], { duration: 500, easing: 'ease' });
        }
        charContainer.style.left = finalLeft;
        charContainer.style.bottom = finalBottom;
        charContainer.style.zIndex = 10 + (props.zIndexOffset || 0);
        charContainer.style.transform = transformValue;
        charContainer.style.transformOrigin = 'bottom center';
        charContainer.style.visibility = 'visible';

        // 合成几何：face 相对 dress 的偏移与缩放写入 charRuntime，blit 时画进单张 canvas。
        const faceScaleFactor = (face && face.z !== undefined) ? (100 + face.z) / 100 : 1;
        const dressX = dress && dress.x !== undefined ? dress.x : 50;
        const dressY = dress && dress.y !== undefined ? dress.y : 0;
        let faceOffsetX = (face && face.x !== undefined) ? face.x - dressX : 0;
        let faceOffsetY = (face && face.y !== undefined) ? face.y - dressY : 0;

        // 应用校正偏移：叠加"全局"、"角色"、"角色+方位"三级人工微调，用于补偿素材对齐误差
        if (typeof CHAR_DIFF_OFFSET !== 'undefined') {
            const globalOffset = CHAR_DIFF_OFFSET["全局"] || {};
            faceOffsetX += globalOffset.x || 0;
            faceOffsetY += globalOffset.y || 0;

            const charOffset = CHAR_DIFF_OFFSET[charName] || {};
            const orientOffset = charOffset[orientation] || {};
            faceOffsetX += orientOffset.x || 0;
            faceOffsetY += orientOffset.y || 0;
        }

        // face.x/y 是按 dress 的基础 z 比例校准的坐标，因此偏移只需要
        // 乘以“当前比例 / 基础比例”，不能直接乘总缩放比例。
        const safeBaseScale = Number.isFinite(dressScale) && dressScale > 0 ? dressScale : 1;
        // blitSig 为合成图签名：任一组成要素变化都需重新合成图层，否则复用已有合成图
        const blitSig = [
            dressPath, facePath,
            faceOffsetX, faceOffsetY, faceScaleFactor, renderer
        ].join('|');
        const prevRt = this._getCharRt(charName);
        this._patchCharRt(charName, {
            left: finalLeft,
            bottom: finalBottom,
            rotation: layoutRot,
            baseScale: safeBaseScale,
            faceScale: faceScaleFactor,
            faceOffsetX: faceOffsetX,
            faceOffsetY: faceOffsetY,
            blitSig: blitSig,
            charRenderer: renderer
        }, charContainer);

        compositeEl.style.transition = 'none';
        // scale 由 updateLayeredCharScale 写入，以便读到 patch 前的 prev.scale 做 WAAPI。
        this.updateLayeredCharScale(charContainer, finalScale, isInstant || isNewChar ? 'none' : 'waapi');

        // 合成依据发生变化（或首次创建）时重新加载拼接 dress/face 图层。
        // isNewChar 必须纳入判断：容器是本次新建的，其内的合成节点必然是空白画布。
        // 外部脚本（如立绘预览页）可能只清空 DOM 而保留 state.charRuntime，
        // 此时 blitSig 未变但画布无内容，若在此复用就会显示空白立绘。
        if (isNewChar || !prevRt || prevRt.blitSig !== blitSig) {
            this._loadCharDiffLayers(charContainer, dressPath, facePath);
        }

        // 应用亮度控制
        if (props.brightness === 'dim') {
            charContainer.style.filter = 'brightness(50%)';
        } else if (props.brightness === 'bright') {
            charContainer.style.filter = 'brightness(100%)';
        }

        // 应用动作
        if (props.actionType) {
            this.applyCharAction(charName, charContainer, props.actionType, props);
        }

        // 应用渐变。charId 必须与 DOM id / activeChars / charRuntime 一致（charName）。
        if (props.fadeType) {
            switch (props.fadeType) {
                case 'fadeOut':
                    this.fadeOutChar(charName, charContainer);
                    break;
                case 'leftFadeOut':
                    this.fadeOutChar(charName, charContainer, 'left');
                    break;
                case 'rightFadeOut':
                    this.fadeOutChar(charName, charContainer, 'right');
                    break;
                case 'fadeIn':
                    this.fadeInChar(charName, charContainer, null);
                    break;
                case 'leftFadeIn':
                    this.fadeInChar(charName, charContainer, 'left');
                    break;
                case 'rightFadeIn':
                    this.fadeInChar(charName, charContainer, 'right');
                    break;
            }
        }

        console.log(`[CharDiff] 更新立绘: ${charName} ${orientation} dress=${dress.id} face=${face.id}`);

        // 注册到 state，使 removeAllChars / removeChar / syncDebugCharsState 能正确管理新版立绘
        // 注意：新版立绘的 charId 与 charName 相同（DOM ID 为 char-${charName}）
        this.state.activeChars[charName] = {
            path: dressPath,
            orientation,
            dress: dress.id,
            face: face.id,
            isNewSystem: true,
            domElement: charContainer
        };
        this.state.charNameMap[charName] = { charId: charName, domElement: charContainer };

        // 更新调试日志中的立绘状态
        this.syncDebugCharsState();
        this._requestCharStagePaint();
    };



    /**
     * 更新新版立绘的实际缩放。
     * 服装+表情已合成到单张 canvas，缩放只作用在合成图上，避免两层各自过渡。
     * 过渡模式（'waapi'）下从上一次记录的 prev.scale 平滑动画到目标值，'none' 则直接落值。
     * @param {HTMLElement} charContainer - 分层立绘容器。
     * @param {number} scale - 身体层的实际缩放比例（非正数回退为 1）。
     * @param {string|undefined} transition - 图层过渡样式；省略时保持当前设置。
     * @returns {boolean} 是否为合法的分层立绘容器（true 表示已处理）。
     * @sideeffect 写入 runtime.scale、改写合成图 transform、可能播放缩放动画并请求重绘。
     */
gameEngine.updateLayeredCharScale = function(charContainer, scale, transition) {
        if (!charContainer || !charContainer.classList ||
            !charContainer.classList.contains('character-layered')) {
            return false;
        }

        const numericScale = Number(scale);
        const actualScale = Number.isFinite(numericScale) && numericScale > 0
            ? numericScale
            : 1;
        const charId = this._charIdOf(charContainer);
        const prev = this._getCharRt(charId);
        const prevScale = prev && Number.isFinite(prev.scale) ? prev.scale : actualScale;
        this._patchCharRt(charId, { scale: actualScale }, charContainer);

        const compositeEl = charContainer.querySelector('.char-composite');
        if (!compositeEl) return true;

        compositeEl.style.transition = 'none';
        const target = `translateX(-50%) scale(${actualScale})`;
        // 需要过渡且缩放确有变化时，用 WAAPI 从旧值补一段 500ms 动画
        if (transition && transition !== 'none' && prevScale !== actualScale) {
            this._charAnimApi() && this._charAnimApi().cancelAll(compositeEl);
            this._playCharAnim(compositeEl, charId, [
                { transform: `translateX(-50%) scale(${prevScale})` },
                { transform: target }
            ], { duration: 500, easing: 'ease' });
        }
        compositeEl.style.transform = target;
        this._requestCharStagePaint();
        return true;
    };



    /**
     * 确保角色容器内只有一张合成节点（Dom=canvas，Precomposed=img），去掉遗留的 dress/face img。
     * 当已有节点标签类型与目标渲染模式不符时会重建，保证容器内始终只有一个 .char-composite。
     * @param {HTMLElement} charContainer - 分层立绘容器。
     * @param {string} [renderer] - 渲染模式；'Precomposed' 使用 img，其余使用 canvas。
     * @returns {HTMLElement} 合成节点（canvas 或 img），已应用统一定位样式。
     * @sideeffect 删除遗留节点、可能创建新节点并追加到容器。
     */
gameEngine._ensureCharCompositeEl = function(charContainer, renderer) {
        const leftover = charContainer.querySelectorAll('.char-dress, .char-face');
        for (let i = 0; i < leftover.length; i++) leftover[i].remove();

        const wantImg = renderer === 'Precomposed';
        let el = charContainer.querySelector('.char-composite');
        if (el && ((wantImg && el.tagName !== 'IMG') || (!wantImg && el.tagName !== 'CANVAS'))) {
            el.remove();
            el = null;
        }
        if (!el) {
            el = document.createElement(wantImg ? 'img' : 'canvas');
            el.className = 'char-composite';
            charContainer.appendChild(el);
        }
        el.style.position = 'absolute';
        el.style.left = '50%';
        el.style.bottom = '0';
        el.style.height = '100%';
        el.style.width = 'auto';
        el.style.display = 'block';
        el.style.transformOrigin = 'bottom center';
        el.style.zIndex = 1;
        return el;
    };



    /**
     * 将已解码的 dress/face 画到合成 canvas。gen 不匹配则丢弃过期帧。
     *
     * 先用 ShioriCharDiffMath.computeCharDiffFaceRect 按舞台尺寸与基础缩放换算出 face 的
     * 目标绘制矩形，再依次绘制 dress 与 face 到与 dress 同尺寸的 canvas 上。
     * 舞台尚未完成布局（宽高 <1）时通过 rAF 延后重试，避免画出零尺寸合成图。
     *
     * @param {HTMLElement} charContainer - 分层立绘容器。
     * @param {HTMLImageElement} dressImg - 已解码的服装层图片。
     * @param {HTMLImageElement} faceImg - 已解码的表情层图片。
     * @param {string|number} gen - 本次加载的世代号，用于丢弃过期回调。
     * @returns {void}
     * @sideeffect 重绘合成 canvas、设置 charDiffBlit 标记、同步缩放并请求舞台重绘。
     */
gameEngine._blitCharDiffComposite = function(charContainer, dressImg, faceImg, gen) {
        const charId = this._charIdOf(charContainer);
        const rt = this._getCharRt(charId);
        // 世代不匹配说明已有更新的一次加载发起，本次结果作废
        if (!charContainer || !rt || String(rt.gen) !== String(gen)) return;
        if (!dressImg || !faceImg || !dressImg.naturalWidth || !faceImg.naturalWidth) return;

        const stage = this.elements && this.elements.characterContainer;
        const stageW = stage ? stage.clientWidth : 0;
        const stageH = stage ? stage.clientHeight : 0;
        // 舞台尚无可测尺寸：等待下一帧布局完成后再画
        if (stageW < 1 || stageH < 1) {
            const self = this;
            requestAnimationFrame(function() {
                self._blitCharDiffComposite(charContainer, dressImg, faceImg, gen);
            });
            return;
        }

        const math = window.ShioriCharDiffMath;
        if (!math || typeof math.computeCharDiffFaceRect !== 'function') return;

        const dW = dressImg.naturalWidth;
        const dH = dressImg.naturalHeight;
        const faceScaleFactor = Number.isFinite(rt.faceScale) ? rt.faceScale : 1;
        const faceOffsetX = Number.isFinite(rt.faceOffsetX) ? rt.faceOffsetX : 0;
        const faceOffsetY = Number.isFinite(rt.faceOffsetY) ? rt.faceOffsetY : 0;
        const baseScale = Number.isFinite(rt.baseScale) && rt.baseScale > 0 ? rt.baseScale : 1;
        const rect = math.computeCharDiffFaceRect(
            dW, dH, faceImg.naturalWidth, faceImg.naturalHeight,
            faceOffsetX, faceOffsetY, faceScaleFactor,
            stageW, stageH, baseScale
        );

        // 以 dress 原图尺寸建立画布，face 按换算矩形叠加，避免二次缩放失真
        const canvas = this._ensureCharCompositeEl(charContainer, 'Dom');
        canvas.width = dW;
        canvas.height = dH;
        canvas.style.aspectRatio = dW + ' / ' + dH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, dW, dH);
        ctx.drawImage(dressImg, 0, 0, dW, dH);
        ctx.drawImage(faceImg, rect.destX, rect.destY, rect.destW, rect.destH);
        canvas.dataset.charDiffBlit = '1';

        // 顺手记下表情层在合成画布上的矩形。说话人小头像的「零配置」来源就是它 ——
        // 与真正画进 canvas 的 rect 是同一个值，不存在「两套坐标系各自漂移」的问题。
        this._patchCharRt(charId, {
            faceRect: { x: rect.destX, y: rect.destY, w: rect.destW, h: rect.destH }
        }, charContainer);

        const scale = Number.isFinite(rt.scale) && rt.scale > 0 ? rt.scale : 1;
        this.updateLayeredCharScale(charContainer, scale, 'none');
        this._requestCharStagePaint();
        // 合成已完成 → 若这角色正是当前说话人，小头像重裁一次。
        // 刻意放在合成之后而不是打字机/每帧路径里：每换一次表情只多一次 drawImage。
        this._notifySpeakerAvatar(charId);
    };



    /**
     * 加载 dress/face：Precomposed 向宿主要一张 PNG，其余走 JS canvas blit。
     * @param {HTMLElement} charContainer - 分层立绘容器。
     * @param {string} dressPath - 服装层路径。
     * @param {string} facePath - 表情层路径。
     * @returns {void}
     * @sideeffect 依渲染模式分发到 _loadCharDiffPrecomposed 或 _loadCharDiffLayersDom。
     */
gameEngine._loadCharDiffLayers = function(charContainer, dressPath, facePath) {
        const charId = this._charIdOf(charContainer);
        const rt = this._getCharRt(charId);
        if (rt && rt.charRenderer === 'Precomposed') {
            this._loadCharDiffPrecomposed(charContainer, dressPath, facePath);
            return;
        }
        this._loadCharDiffLayersDom(charContainer, dressPath, facePath);
    };

    /**
     * Precomposed 模式：请求宿主生成/取回预合成 PNG，单 img 直接显示。
     * 通过 gen 世代号防止过期回调覆盖新状态；尺寸未就绪时延后一帧重试；
     * 宿主能力缺失、URL 生成失败或图片加载出错时统一降级回 JS blit（_loadCharDiffLayersDom）。
     * @param {HTMLElement} charContainer - 分层立绘容器。
     * @param {string} dressPath - 服装层路径。
     * @param {string} facePath - 表情层路径。
     * @param {string} [reuseGen] - 复用已有世代号（重试时传入，避免自增导致自身结果被丢弃）。
     * @returns {void}
     * @sideeffect 写入 runtime.gen、改写合成 img 的 src/onload/onerror。
     */
    gameEngine._loadCharDiffPrecomposed = function(charContainer, dressPath, facePath, reuseGen) {
        const self = this;
        const charId = this._charIdOf(charContainer);
        const prev = this._getCharRt(charId);
        // 每次加载自增世代号，作为"最新请求"的凭证
        const gen = reuseGen || String((Number(prev && prev.gen) || 0) + 1);
        if (!reuseGen) this._patchCharRt(charId, { gen: gen }, charContainer);

        const stage = this.elements && this.elements.characterContainer;
        const stageW = stage ? stage.clientWidth : 0;
        const stageH = stage ? stage.clientHeight : 0;
        // 舞台尺寸未就绪：下一帧以同一世代号重试（reuseGen 保证不产生新世代）
        if (stageW < 1 || stageH < 1) {
            requestAnimationFrame(function () {
                const latest = self._getCharRt(charId);
                if (!latest || String(latest.gen) !== gen) return;
                self._loadCharDiffPrecomposed(charContainer, dressPath, facePath, gen);
            });
            return;
        }

        const hc = window.ShioriHostConfig;
        if (!hc || typeof hc.charFrameUrl !== 'function') {
            this._loadCharDiffLayersDom(charContainer, dressPath, facePath);
            return;
        }
        const rt = this._getCharRt(charId) || {};
        const url = hc.charFrameUrl({
            dress: dressPath,
            face: facePath,
            ox: rt.faceOffsetX,
            oy: rt.faceOffsetY,
            fs: rt.faceScale,
            sw: stageW,
            sh: stageH,
            bs: rt.baseScale
        });
        if (!url) {
            this._loadCharDiffLayersDom(charContainer, dressPath, facePath);
            return;
        }

        const img = this._ensureCharCompositeEl(charContainer, 'Precomposed');
        img.onload = function () {
            const latest = self._getCharRt(charId);
            // 世代已过期（期间又发起了新加载）：丢弃本次结果
            if (!latest || String(latest.gen) !== gen) return;
            img.dataset.charDiffBlit = '1';
            if (img.naturalWidth && img.naturalHeight)
                img.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
            const scale = Number.isFinite(latest.scale) && latest.scale > 0 ? latest.scale : 1;
            self.updateLayeredCharScale(charContainer, scale, 'none');
            self._requestCharStagePaint();
            // 宿主预合成图就绪 → 小头像重裁。Precomposed 拿不到 faceRect，
            // 所以这条路走的是 CHAR_AVATAR_CROP 或内置默认框。
            self._notifySpeakerAvatar(charId);
        };
        img.onerror = function () {
            const latest = self._getCharRt(charId);
            if (!latest || String(latest.gen) !== gen) return;
            // 宿主预合成失败：降级为 JS 端 canvas 拼接
            self._loadCharDiffLayersDom(charContainer, dressPath, facePath);
        };
        img.src = url;
    };

    /**
     * Dom 模式：分别加载 dress/face 两张图片，全部解码完成后在 canvas 上合成。
     * 使用 pending 计数等待两张图都到达，任一图片失败则不触发合成（避免半成品）。
     * @param {HTMLElement} charContainer - 分层立绘容器。
     * @param {string} dressPath - 服装层路径。
     * @param {string} facePath - 表情层路径。
     * @returns {void}
     * @sideeffect 写入 runtime.gen，创建两个 Image 并触发带扩展名回退的加载。
     */
    gameEngine._loadCharDiffLayersDom = function(charContainer, dressPath, facePath) {
        const self = this;
        const charId = this._charIdOf(charContainer);
        const prev = this._getCharRt(charId);
        const gen = String((Number(prev && prev.gen) || 0) + 1);
        this._patchCharRt(charId, { gen: gen }, charContainer);

        const dressImg = new Image();
        const faceImg = new Image();
        // 两张图都 onload 后才执行合成（计数归零触发）
        let pending = 2;
        const done = function() {
            pending -= 1;
            if (pending !== 0) return;
            self._blitCharDiffComposite(charContainer, dressImg, faceImg, gen);
        };
        dressImg.onload = done;
        faceImg.onload = done;
        this._loadImageWithFallback(dressImg, dressPath);
        this._loadImageWithFallback(faceImg, facePath);
    };



    /**
     * 解析并渲染立绘指令（立绘系统的对外总入口）。
     * 先用 _beginCharBatch 预判本行渲染模式，再按出现顺序逐条下发 [内容] 指令。
     * @param {string} charString - 立绘指令字符串，如 "[左 char_a],[右 前 char_b]" 或 "[消失 char_a]"；
     *                              支持空格分隔的修饰词，顺序无关。
     * @returns {void}
     * @sideeffect 可能更新场次闩锁、创建/更新/移除立绘 DOM，并请求一次舞台重绘。
     */
gameEngine.renderChars = function(charString) {
        if (!charString || typeof charString !== 'string') return;

        // 匹配所有 [内容] 格式的指令
        const instructions = charString.match(/\[([^\]]+)\]/g);
        if (!instructions) return;

        this._beginCharBatch(charString);
        instructions.forEach(instr => {
            const content = instr.slice(1, -1).trim();
            this.renderSingleCharInstruction(content);
        });
        this._requestCharStagePaint();
    };



    /**
     * 中断所有正在进行的连续动作指令。
     * 快进/跳过时调用：不再逐帧播放，而是把每个角色的连续动作直接结算到
     * 序列最后一个片段所定义的状态（强制瞬切），并清理定时器与队列。
     * @returns {void}
     * @sideeffect 对本帧下发 applyCharSequenceFrame（forceInstant=true），清空 state.charActionQueues。
     */
gameEngine.interruptCharSequences = function() {
        if (!this.state.charActionQueues) return;

        Object.keys(this.state.charActionQueues).forEach(charId => {
            const queue = this.state.charActionQueues[charId];
            if (queue && queue.segments) {
                // 取末帧并剥离"瞬"标记后瞬间应用，保证快进后状态与正常播放一致
                const lastSegment = queue.segments[queue.segments.length - 1];
                if (lastSegment) {
                    const cleaned = lastSegment.replace(/瞬|instant|moment/g, '').trim();
                    this.applyCharSequenceFrame({
                        useDiff: !!queue.useDiff,
                        roleName: queue.roleName || null,
                        queueKey: charId
                    }, cleaned, true);
                }
            }
            // 清除定时器
            if (queue.timeoutId) {
                clearTimeout(queue.timeoutId);
            }
            // 同时摘除挂在统一节拍上的调度（若有）
            _shioriUnscheduleCharQueue(charId);
        });

        // 清空队列
        this.state.charActionQueues = {};
    };



    /**
     * 应用连续动作的一帧。新系统走 updateCharDiff，旧系统走 updateChar。
     * @param {Object} parsed - parseCharSequence 的解析结果（含 useDiff/roleName/queueKey）。
     * @param {string} segment - 本帧的修饰词片段。
     * @param {boolean} [forceInstant] - 是否强制瞬切（追加"瞬"标记，不做过渡动画）。
     * @returns {void}
     * @sideeffect 调用 updateCharDiff 或 updateChar 更新立绘。
     */
gameEngine.applyCharSequenceFrame = function(parsed, segment, forceInstant) {
        if (!parsed || !segment) return;
        if (parsed.useDiff && parsed.roleName) {
            const parts = String(segment).split(/\s+/).filter(Boolean);
            const resolved = (typeof this.resolveCharDiffFrame === 'function')
                ? this.resolveCharDiffFrame(parsed.roleName, parts)
                : null;
            if (!resolved) {
                console.warn(`连续动作新系统帧无法解析: ${parsed.roleName} ${segment}`);
                return;
            }
            let mods = parts.join(' ');
            // 强制瞬切：把"瞬"追加进修饰词，交给解析层识别
            if (forceInstant) mods = mods ? (mods + ' 瞬') : '瞬';
            this.updateCharDiff(parsed.roleName, resolved.orientation, resolved.dress, resolved.face, mods);
            return;
        }
        this.updateChar(parsed.queueKey, segment, !!forceInstant, parsed.roleName || null);
    };

    /* ── 连续动作队列的节拍调度────────────────────────────
       把「累计 500ms 后推进一步」挂进统一节拍；节拍缺失时才退回 setTimeout。
       队列键与 state.charActionQueues 的 queueKey 一致，便于中断时一并摘除。 */
    var _shioriCharQueueTicks = {};

    /**
     * 摘除某角色队列的节拍 handler（幂等）。
     * @param {string} queueKey 角色队列键
     * @returns {void}
     */
function _shioriUnscheduleCharQueue(queueKey) {
        var st = _shioriCharQueueTicks[queueKey];
        if (!st) return;
        var tickApi = (typeof window !== 'undefined') ? window.ShioriTick : null;
        if (tickApi && typeof tickApi.removeContinuousHandler === 'function' && st.step) {
            tickApi.removeContinuousHandler(st.step);
        }
        _shioriCharQueueTicks[queueKey] = null;
    }

    /**
     * 安排下一帧连续动作。
     * @param {string} queueKey 角色队列键
     * @param {Function} fn 到点后执行的回调
     * @param {number} delay 延迟毫秒
     * @returns {number|null} 退回 setTimeout 时返回定时器 id，走节拍时返回 null
     */
function _shioriScheduleCharQueue(queueKey, fn, delay) {
        _shioriUnscheduleCharQueue(queueKey);
        var tickApi = (typeof window !== 'undefined') ? window.ShioriTick : null;
        if (tickApi && typeof tickApi.addContinuousHandler === 'function') {
            var st = { acc: 0, fn: fn, delay: delay, step: null };
            st.step = function (t, dt) {
                st.acc += (dt > 0 ? dt : 16.7);
                if (st.acc < st.delay) return;
                st.acc -= st.delay;
                tickApi.removeContinuousHandler(st.step);
                if (_shioriCharQueueTicks[queueKey] === st) _shioriCharQueueTicks[queueKey] = null;
                st.fn();
            };
            _shioriCharQueueTicks[queueKey] = st;
            tickApi.addContinuousHandler(st.step);
            return null;
        }
        return setTimeout(fn, delay);
    }

    /**
     * 执行连续动作序列（统一化状态帧模式）。
     *
     * 以 500ms 为节拍逐段播放修饰词帧；独立的"瞬"帧只设置 nextIsInstant 标记，
     * 使下一帧强制瞬切；含"瞬"的帧剥离标记后立即瞬切。队列按 queueKey（角色）隔离，
     * 同一角色重复下发时先取消旧队列，保证不会出现两套定时器竞态。
     *
     * @param {string} sequenceContent - 逗号分隔的完整指令内容。
     * @returns {void}
     * @sideeffect 读写 state.charActionQueues，注册 setTimeout 定时器，调用 applyCharSequenceFrame。
     */
gameEngine.executeCharSequence = function(sequenceContent) {
        const parsed = (typeof this.parseCharSequence === 'function')
            ? this.parseCharSequence(sequenceContent)
            : null;
        if (!parsed || !parsed.valid) {
            console.warn(`连续动作指令中未找到有效的角色ID: ${sequenceContent}`);
            return;
        }

        const queueKey = parsed.queueKey;
        const segments = parsed.segments;
        // 同一角色的旧序列先取消，避免定时器叠加导致跳帧
        if (!this.state.charActionQueues) this.state.charActionQueues = {};
        if (this.state.charActionQueues[queueKey]) clearTimeout(this.state.charActionQueues[queueKey].timeoutId);
        // 旧序列可能挂在节拍上，一并摘除
        _shioriUnscheduleCharQueue(queueKey);

        this.state.charActionQueues[queueKey] = {
            segments: segments,
            timeoutId: null,
            nextIsInstant: false,
            useDiff: parsed.useDiff,
            roleName: parsed.roleName,
            queueKey: queueKey
        };

        let currentIndex = 0;
        const totalSegments = segments.length;

        // 逐帧推进器：每次消费一个修饰词片段，并安排 500ms 后的下一帧
        const processNext = () => {
            // 队列被外部清空（如中断/移除）则停止推进
            if (!this.state.charActionQueues[queueKey]) return;
            if (currentIndex >= totalSegments) {
                delete this.state.charActionQueues[queueKey];
                return;
            }

            const currentSegment = segments[currentIndex];

            // 纯"瞬"帧：仅设置标记，交由下一帧生效
            if (currentSegment === '瞬' || currentSegment === 'instant' || currentSegment === 'moment') {
                this.state.charActionQueues[queueKey].nextIsInstant = true;
                currentIndex++;
                processNext();
                return;
            }

            const segmentParts = currentSegment.split(/\s+/);
            const hasInstantInSegment = segmentParts.some(p => ['瞬', 'instant', 'moment'].includes(p));

            if (hasInstantInSegment) {
                // "瞬 + 修饰词"混写：剥离"瞬"后立即瞬切本次修饰词
                const validModifiers = segmentParts.filter(p => !['瞬', 'instant', 'moment'].includes(p)).join(' ');
                if (validModifiers.trim() === '') {
                    // 剥离后为空，等价纯"瞬"帧，标记给下一帧
                    this.state.charActionQueues[queueKey].nextIsInstant = true;
                    currentIndex++;
                    processNext();
                    return;
                }
                this.applyCharSequenceFrame(parsed, validModifiers, true);
                this.state.charActionQueues[queueKey].nextIsInstant = false;
            } else {
                // 普通帧：继承上一帧遗留的瞬切标记
                const queueState = this.state.charActionQueues[queueKey];
                const forceInstant = queueState.nextIsInstant;
                this.applyCharSequenceFrame(parsed, currentSegment, forceInstant);
                queueState.nextIsInstant = false;
            }

            currentIndex++;

            // 还有后续帧则 500ms 后继续，否则销毁队列
            if (currentIndex < totalSegments) {
                // 优先挂统一节拍（累计 500ms 推进一步），节拍缺失时退回 setTimeout
                const timeoutId = _shioriScheduleCharQueue(queueKey, processNext, 500);
                if (this.state.charActionQueues[queueKey]) {
                    this.state.charActionQueues[queueKey].timeoutId = timeoutId;
                }
            } else {
                delete this.state.charActionQueues[queueKey];
            }
        };

        processNext();
    };



    /**
     * 更新或创建单个立绘（旧版单图立绘路径）。
     *
     * 完整流程：查配置得图片路径 → 复用/创建 DOM（同 roleName 换图走双缓冲交叉淡入淡出）
     * → 解析修饰词 → 未显式指定项按 runtime/DOM 继承 → 防重复渲染比对 → 应用样式/过渡动画
     * → 处理渐入渐出与动作 → 写入 activeChars / charRuntime 状态。
     *
     * @param {string} charId - 立绘ID (如 char_a)。
     * @param {string} modifiers - 修饰词组合 (如 "左 前" 或 "中 10% 后" 或 "瞬 左" 或 "left front" 等中英文混合)。
     * @param {boolean} [forceInstant] - 是否强制瞬间切换（用于连续动作指令）。
     * @param {string} [roleName] - 角色名称标识符（可选，用于实现自动替换与属性继承）。
     * @returns {void}
     * @sideeffect 增删改立绘 DOM、写入 activeChars/charNameMap/charRuntime、播放动画。
     */
gameEngine.updateChar = function(charId, modifiers, forceInstant = false, roleName = null) {
        console.log(`[updateChar] charId=${charId}, modifiers="${modifiers}", roleName=${roleName}`);
        
        // 获取路径：优先子配置 CHAR_CONFIG_SUB，再回退主配置 CHAR_CONFIG
        let path = null;
        if (typeof CHAR_CONFIG_SUB !== 'undefined' && CHAR_CONFIG_SUB[charId]) {
            path = CHAR_CONFIG_SUB[charId];
        } else if (typeof CHAR_CONFIG !== 'undefined' && CHAR_CONFIG[charId]) {
            path = CHAR_CONFIG[charId];
        }

        if (!path) {
            console.warn(`立绘 ${charId} 未在配置文件中找到`);
            return;
        }

        // 查找或创建 DOM 元素
        let charEl = null;
        let isNewChar = false;
        let isSameRoleDifferentImage = false; // 标记是否为同标识符切换不同图片
        // 补充：该标记用于后续走"双缓冲交叉淡入淡出"分支，避免直接改 src 造成闪烁

        if (roleName && this.state.charNameMap[roleName]) {
            // 角色名称标识符存在，复用旧立绘的 DOM 节点
            const oldInfo = this.state.charNameMap[roleName];
            charEl = document.getElementById(`char-${oldInfo.charId}`);
            
            // 检测是否为同标识符但不同图片资源的切换
            if (oldInfo.charId !== charId) {
                // 检查旧图片与新图片是否不同
                if (charEl && charEl.src !== path) {
                    isSameRoleDifferentImage = true;
                }
                
                // 移除旧的 activeChars 记录
                delete this.state.activeChars[oldInfo.charId];
                // 更新 DOM ID
                if (charEl) charEl.id = `char-${charId}`;
                // 更新映射表
                this.state.charNameMap[roleName] = { charId, domElement: charEl };
                // 把运行时状态从旧 charId 迁移到新 charId，保证位置/缩放等属性被继承
                const api = this._charRtApi();
                if (api) {
                    const moved = api.migrate(this._charBag(), oldInfo.charId, charId);
                    if (charEl && moved) api.projectDebugDataset(charEl, moved);
                }
            }
        } else {
            // 查找现有 DOM 或创建新元素
            charEl = document.getElementById(`char-${charId}`);
            if (!charEl) {
                charEl = document.createElement('img');
                charEl.id = `char-${charId}`;
                charEl.className = 'character-img';
                this.elements.characterContainer.appendChild(charEl);
                isNewChar = true;
            }
        }

        // 注册到 charNameMap（如果提供了 roleName）
        if (roleName) {
            this.state.charNameMap[roleName] = { charId, domElement: charEl };
        }

        // 更新图片源（如果需要）
        if (charEl.src !== path) {
            // 如果是同标识符切换不同图片，执行双缓冲交叉淡入淡出过渡
            if (isSameRoleDifferentImage) {
                // 创建临时新元素实现真正的双缓冲交叉淡入淡出
                // 旧元素渐隐的同时新元素渐显，动画结束后再删除旧节点、把 id 转交给新节点
                const newCharEl = document.createElement('img');
                newCharEl.id = `char-${charId}-temp`;
                newCharEl.className = 'character-img';
                newCharEl.src = path; // 先设置src，让浏览器开始加载
                
                // 复制当前位置和样式
                newCharEl.style.left = charEl.style.left;
                newCharEl.style.bottom = charEl.style.bottom;
                newCharEl.style.zIndex = charEl.style.zIndex;
                newCharEl.style.height = charEl.style.height;
                newCharEl.style.transform = charEl.style.transform;
                newCharEl.style.opacity = '0'; // 初始透明
                
                // 插入到容器中（在旧元素后面）
                this.elements.characterContainer.appendChild(newCharEl);
                
                // 处理图片加载完成后的交叉淡入淡出
                const handleCrossFade = () => {
                    // 解析新指令的修饰词
                    const newProps = this.parseCharModifiers(modifiers);
                    
                    // 属性继承逻辑：仅当修饰词中显式给出对应关键词时才采用新值，否则继承旧元素
                    const hasExplicitLeft = modifiers.match(/(左|右|中|left|right|middle|x:)/i);
                    const hasExplicitBottom = modifiers.match(/(上|下|up|down|y:)/i);
                    const hasExplicitLayer = modifiers.match(/(前|后|front|back)/i);
                    const hasExplicitScale = modifiers.match(/\d+%$/);
                    const hasExplicitZ = modifiers.match(/z:/i);
                    
                    // 应用样式属性（带继承逻辑）
                    newCharEl.style.left = hasExplicitLeft ? newProps.left : (charEl.style.left || newProps.left);
                    newCharEl.style.bottom = hasExplicitBottom ? newProps.bottom : (charEl.style.bottom || newProps.bottom);
                    newCharEl.style.zIndex = hasExplicitLayer ? newProps.zIndex : (charEl.style.zIndex || newProps.zIndex);
                    
                    // 缩放处理
                    if (hasExplicitScale) {
                        newCharEl.style.height = `${newProps.scale * 100}%`;
                    } else if (charEl.style.height) {
                        newCharEl.style.height = charEl.style.height;
                    } else {
                        newCharEl.style.height = `${newProps.scale * 100}%`;
                    }
                    
                    // 构建transform属性，包含水平对齐和Z轴旋转
                    let transformValue = 'translateX(-50%)';
                    if (hasExplicitZ) {
                        // 如果新指令指定了z:，使用新的旋转角度
                        if (newProps.preciseZ !== null && newProps.preciseZ !== undefined) {
                            transformValue += ` rotate(${newProps.preciseZ}deg)`;
                        }
                    } else {
                        // 否则继承旧的transform（包含旋转）
                        const oldTransform = charEl.style.transform || 'translateX(-50%)';
                        // 检查旧transform是否包含rotate
                        if (oldTransform.includes('rotate')) {
                            transformValue = oldTransform;
                        }
                    }
                    newCharEl.style.transform = transformValue;
                    newCharEl.style.visibility = 'visible';
                    
                    charEl.style.transition = 'none';
                    newCharEl.style.transition = 'none';
                    const animApi = this._charAnimApi();
                    const fadeOutH = animApi ? animApi.play(charEl, animApi.fadeOpacity(1, 0), { duration: 150, easing: 'ease-out' }) : null;
                    const fadeInH = animApi ? animApi.play(newCharEl, animApi.fadeOpacity(0, 1), { duration: 150, easing: 'ease-in' }) : null;
                    charEl.style.opacity = '0';
                    newCharEl.style.opacity = '1';

                    // 交叉淡入淡出结束后的收尾：结算继承值、删除旧节点、把 id 交给新节点并登记状态
                    const finishCrossFade = () => {
                        const inheritedLeft = hasExplicitLeft ? newProps.left : (charEl.style.left || newProps.left);
                        const inheritedBottom = hasExplicitBottom ? newProps.bottom : (charEl.style.bottom || newProps.bottom);
                        const inheritedZ = hasExplicitLayer ? newProps.zIndex : (charEl.style.zIndex || newProps.zIndex);
                        const inheritedScale = hasExplicitScale
                            ? newProps.scale
                            : (charEl.style.height ? parseFloat(charEl.style.height) / 100 : newProps.scale);
                        this._cancelCharMotion(charEl, charId);
                        charEl.remove();
                        newCharEl.id = `char-${charId}`;
                        if (newProps.actionType) {
                            this.applyCharAction(charId, newCharEl, newProps.actionType, newProps);
                        }
                        const finalProps = {
                            left: inheritedLeft,
                            bottom: inheritedBottom,
                            zIndex: inheritedZ,
                            scale: inheritedScale
                        };
                        this.state.activeChars[charId] = { path, ...finalProps };
                        this._patchCharRt(charId, {
                            left: finalProps.left,
                            bottom: finalProps.bottom,
                            scale: finalProps.scale || 1
                        }, newCharEl);
                        // 交叉淡入收尾：新图已经顶上（id 已转交），刷新头像。
                        // 放在 _patchCharRt 之后，保证头像读到的运行时状态已经是新立绘的。
                        this._notifySpeakerAvatar(charId);
                    };
                    this._onAnimFinished(fadeInH || fadeOutH, finishCrossFade);
                };
                
                // 检查图片是否已缓存
                if (newCharEl.complete && newCharEl.naturalWidth > 0) {
                    // 图片已缓存，直接执行
                    handleCrossFade();
                } else {
                    // 等待图片加载
                    newCharEl.onload = handleCrossFade;
                    newCharEl.onerror = () => {
                        console.error(`[updateChar] 图片加载失败: ${path}`);
                        newCharEl.remove();
                        // 回退到原逻辑
                        charEl.src = path;
                    };
                }
                
                // 重要：对于同标识符切换，我们已经在异步回调中处理了所有逻辑
                // 因此直接返回，跳过后续的样式应用和透明度处理
                return;
            } else {
                // 非同标识符切换，使用扩展名回退加载（支持 jpg/webp 等非 PNG 格式）
                this._loadImageWithFallback(charEl, path);
            }
        }

        // 解析修饰词并应用样式
        const props = this.parseCharModifiers(modifiers);
                        
        // 属性继承逻辑：runtime 是源；DOM style 仅兜底
        if (!isNewChar && charEl) {
            const rt = this._getCharRt(charId);
            const currentLeft = (rt && rt.left) || charEl.style.left;
            const currentBottom = (rt && rt.bottom) || charEl.style.bottom;
            const currentZIndex = charEl.style.zIndex;
            const currentHeight = charEl.style.height;

            // 只有当 modifiers 中没有显式指定位置/层级/缩放/旋转/亮度时，才继承
            // 注意：parseCharModifiers 返回的是计算后的值，我们需要判断用户是否输入了关键词
            // 特殊处理：排除方向渐入/渐出指令中的"左"和"右"
            // 特殊处理：排除旋转动作指令中的"左"和"右"（左倒、右倒）
            const hasExplicitLeft = modifiers.match(/(左|右|中|left|right|middle|x:)/i) && 
                                   !modifiers.match(/(左渐出|右渐出|lfadeOut|rfadeOut|左渐入|右渐入|lfadeIn|rfadeIn|左倒|右倒|ltilt|rtilt)/i);
            const hasExplicitBottom = modifiers.match(/(上|下|up|down|y:)/i);
            const hasExplicitLayer = modifiers.match(/(前|后|front|back)/i);
            const hasExplicitScale = modifiers.match(/\d+%$/);
            const hasExplicitZ = modifiers.match(/z:/i);
            const hasExplicitBrightness = modifiers.match(/(明|暗|bright|dim|dark)/i);

            console.log(`[updateChar] Inheritance check for ${charId}: hasExplicitLeft=${hasExplicitLeft}, currentLeft=${currentLeft}, props.left before=${props.left}`);

            if (!hasExplicitLeft && currentLeft) props.left = currentLeft;
            if (!hasExplicitBottom && currentBottom) props.bottom = currentBottom;
            if (!hasExplicitLayer && currentZIndex) props.zIndex = parseInt(currentZIndex);
            if (!hasExplicitScale) {
                if (rt && Number.isFinite(rt.scale)) props.scale = rt.scale;
                else if (currentHeight) {
                    const oldScale = parseFloat(currentHeight) / 100;
                    if (!isNaN(oldScale)) props.scale = oldScale;
                }
            }
            // Z轴旋转继承
            if (!hasExplicitZ) {
                if (rt && Number.isFinite(rt.rotation)) {
                    props.preciseZ = rt.rotation;
                } else if (charEl.style.transform) {
                    const transformMatch = charEl.style.transform.match(/rotate\(([^)]+)deg\)/);
                    if (transformMatch) {
                        const oldRotation = parseFloat(transformMatch[1]);
                        if (!isNaN(oldRotation)) {
                            props.preciseZ = oldRotation;
                        }
                    }
                }
            }
            // 亮度状态继承：从当前filter中提取亮度设置
            if (!hasExplicitBrightness && charEl.style.filter) {
                const filterMatch = charEl.style.filter.match(/brightness\(([^)]+)\)/);
                if (filterMatch) {
                    const brightnessValue = filterMatch[1];
                    // 如果当前是50%亮度，设置为'dim'；如果是100%，设置为'bright'
                    if (brightnessValue === '50%') {
                        props.brightness = 'dim';
                    } else if (brightnessValue === '100%') {
                        props.brightness = 'bright';
                    }
                }
            }
            
            console.log(`[updateChar] After inheritance: props.left=${props.left}, props.bottom=${props.bottom}`);
        }
        
        // 防重复渲染机制：检查立绘状态是否真的需要更新
        // 如果不是新立绘，且所有属性都与当前状态相同，则跳过更新以避免闪烁
        // 任一动作/渐变指令都视为需要更新（它们是一次性事件，即使视觉属性相同也要执行）
        if (!isNewChar && !isSameRoleDifferentImage) {
            const currentState = this.state.activeChars[charId];
            if (currentState) {
                console.log(`[updateChar] 防重复检查: currentState.left=${currentState.left}, props.left=${props.left}`);
                console.log(`[updateChar] 防重复检查: currentState.bottom=${currentState.bottom}, props.bottom=${props.bottom}`);
                // 比较关键属性是否相同
                const isSameState = (
                    currentState.path === path &&
                    currentState.left === props.left &&
                    currentState.bottom === props.bottom &&
                    currentState.zIndex === props.zIndex &&
                    Math.abs((currentState.scale || 1) - props.scale) < 0.01 && // 允许小的浮点数误差
                    Math.abs((currentState.preciseZ || 0) - (props.preciseZ || 0)) < 0.01 && // 允许小的浮点数误差
                    (currentState.brightness || null) === (props.brightness || null) && // 亮度状态必须相同
                    !props.actionType && // 如果有动作指令，总是需要更新
                    !props.fadeType // 如果有渐入/渐出指令，总是需要更新
                );
                
                console.log(`[updateChar] isSameState=${isSameState}`);
                
                if (isSameState) {
                    console.log(`[updateChar] 立绘 ${charId} 状态未改变，跳过重复渲染`);
                    // 状态未改变，跳过更新以避免闪烁
                    return;
                }
            }
        }
                        
        // 检查是否包含“瞬”指令或外部强制瞬间
        const isInstant = props.instant || forceInstant;
                                
        // 区分初次渲染与状态更新
        // 如果是新立绘（isNewChar）或同标识符切换不同图片（isSameRoleDifferentImage），
        // 需要在应用初始状态时禁用 transition，防止从默认值渐变到目标值
        const isFirstRender = isNewChar || isSameRoleDifferentImage;
                
        console.log(`[updateChar] charId=${charId}, isNewChar=${isNewChar}, isFirstRender=${isFirstRender}, isInstant=${isInstant}`);
        console.log(`[updateChar] 当前 left=${charEl.style.left}, 目标 left=${props.left}`);
                                                
        charEl.style.transition = 'none';
        // 非瞬切且非首次渲染时，若布局确有变化则播放 500ms 的位置过渡动画（先动画后落值）
        if (!isInstant && !isFirstRender) {
            const prevRt = this._getCharRt(charId);
            const fromRot = (prevRt && Number.isFinite(prevRt.rotation)) ? prevRt.rotation : 0;
            const toRot = (props.actionType === 'stand')
                ? fromRot
                : this.standFromRotation(prevRt, props.preciseZ);
            const rotCss = (deg) => `translateX(-50%) rotate(${Number.isFinite(deg) ? deg : 0}deg)`;
            if (this.shouldAnimateCharLayout(prevRt, props.left, props.bottom, toRot)) {
                const fromKf = {
                    left: (prevRt && prevRt.left) || charEl.style.left || props.left,
                    bottom: (prevRt && prevRt.bottom) || charEl.style.bottom || props.bottom
                };
                const toKf = { left: props.left, bottom: props.bottom };
                // 站立由 applyStandAction 负责旋转；布局动画只动位置，避免 500ms 把角度拉回去。
                if (props.actionType !== 'stand') {
                    fromKf.transform = charEl.style.transform || rotCss(fromRot);
                    toKf.transform = rotCss(toRot);
                }
                this._playCharAnim(charEl, charId, [fromKf, toKf], { duration: 500, easing: 'ease' });
            }
        }
                                        
        // 应用样式
        charEl.style.left = props.left;
        charEl.style.bottom = props.bottom;
        charEl.style.zIndex = props.zIndex;
        charEl.style.visibility = 'visible';
                
        // 处理渐入/渐出指令
        if (props.fadeType === 'fadeOut') {
            // 渐出指令：执行渐出动画
            this.fadeOutChar(charId, charEl);
            return; // 直接返回，不继续执行后续逻辑
        } else if (props.fadeType === 'leftFadeOut' || props.fadeType === 'rightFadeOut') {
            // 方向渐出指令：需要先应用位置继承，再执行渐出动画
            console.log(`[updateChar] Directional fade out for ${charId}, props.left=${props.left}, current left=${charEl.style.left}`);
            
            // 应用样式（位置继承已在上面完成）
            charEl.style.left = props.left;
            charEl.style.bottom = props.bottom;
            charEl.style.zIndex = props.zIndex;
            charEl.style.visibility = 'visible';
            
            // 应用缩放
            charEl.style.height = `${props.scale * 100}%`;
            
            // 应用水平对齐变换
            charEl.style.transform = 'translateX(-50%)';
            
            // 确定渐出方向
            const direction = props.fadeType === 'leftFadeOut' ? 'left' : 'right';
            
            console.log(`[updateChar] Applying ${direction} fade out, final left=${charEl.style.left}`);
            
            // 执行方向渐出动画
            this.fadeOutChar(charId, charEl, direction);
            return; // 直接返回，不继续执行后续逻辑
        } else if (props.fadeType === 'leftFadeIn' || props.fadeType === 'rightFadeIn') {
            // 方向渐入指令：需要先应用位置继承，再执行渐入动画
            console.log(`[updateChar] Directional fade in for ${charId}, props.left=${props.left}, current left=${charEl.style.left}`);
            
            // 应用样式（位置继承已在上面完成）
            charEl.style.left = props.left;
            charEl.style.bottom = props.bottom;
            charEl.style.zIndex = props.zIndex;
            charEl.style.visibility = 'visible';
            
            // 应用缩放
            charEl.style.height = `${props.scale * 100}%`;
            
            // 应用水平对齐变换
            charEl.style.transform = 'translateX(-50%)';
            
            // 确定渐入方向
            const direction = props.fadeType === 'leftFadeIn' ? 'left' : 'right';
            
            console.log(`[updateChar] Applying ${direction} fade in, final left=${charEl.style.left}`);
            
            // 执行方向渐入动画
            this.fadeInChar(charId, charEl, direction);
            return; // 直接返回，不继续执行后续逻辑
        } else if (props.fadeType === 'fadeIn') {
            this.fadeInChar(charId, charEl, null);
        } else {
            charEl.style.opacity = '1';
        }
                
        // 应用缩放：通过调整实际高度来实现，确保放大后的图片完整显示
        // 基准高度为容器的 100%，根据 scale 比例调整
        charEl.style.height = `${props.scale * 100}%`;
                
        // 应用水平对齐变换
        // 无论是否使用精确坐标，都需要translateX(-50%)来让立绘的中心点对齐
        // 文字指令模式：left为百分比值（如50%），需要translateX(-50%)居中
        // 精确坐标模式：left为calc(50% + x%)，也需要translateX(-50%)让立绘中心对齐到计算后的位置
        
        // 构建transform属性，包含水平对齐和Z轴旋转
        const standKeepRot = this.standFromRotation(this._getCharRt(charId),
            props.actionType === 'stand' ? null : props.preciseZ);
        let transformValue = `translateX(-50%) rotate(${standKeepRot}deg)`;
        charEl.style.transform = transformValue;
                
        // 应用亮度控制（明/暗）
        if (props.brightness === 'dim') {
            // 变暗：应用50%亮度滤镜
            charEl.style.filter = 'brightness(50%)';
        } else if (props.brightness === 'bright') {
            // 明亮：恢复100%亮度
            charEl.style.filter = 'brightness(100%)';
        } else {
            // 未指定亮度：只清理由亮度产生的 filter，保留其它滤镜效果
            // 未指定亮度控制，保持当前状态或清除滤镜
            // 如果立绘已有filter且不是因为亮度设置的，保留它
            // 否则清除filter
            if (!charEl.style.filter || charEl.style.filter.includes('brightness')) {
                charEl.style.filter = '';
            }
        }
                
        this._patchCharRt(charId, {
            left: props.left,
            bottom: props.bottom,
            rotation: standKeepRot,
            scale: props.scale || 1,
            opacity: 1,
            filter: charEl.style.filter || ''
        }, charEl);

        // 处理动作指令
        if (props.actionType) {
            this.applyCharAction(charId, charEl, props.actionType, props);
        }
        
        // 更新状态记录
        this.state.activeChars[charId] = { path, ...props };

        // 旧版单图立绘：这条路径没有「合成完成」这一步，图片就绪即是最早可裁时刻。
        // 用 addEventListener('load', { once:true }) 去挂，而不是覆盖 onload ——
        // _loadImageWithFallback 已经占了 onerror 做扩展名重试，这里不能抢它的回调。
        // 已就绪的图（走缓存直出）就同步通知，不白等一个永远不会再来的 load。
        if (charEl) {
            const notifyLegacyAvatar = () => this._notifySpeakerAvatar(charId);
            if (charEl.complete && charEl.naturalWidth > 0) {
                notifyLegacyAvatar();
            } else {
                charEl.addEventListener('load', notifyLegacyAvatar, { once: true });
            }
        }
    };



    /**
     * 移除指定立绘（立即删除，无淡出动画）。
     * 依次停止持续动作、取消动画与定时器、删除 DOM、清理连续动作队列与全部状态记录。
     * @param {string} charId - 立绘ID。
     * @returns {void}
     * @sideeffect 删除 DOM 节点、清空 activeChars/charActionQueues/charRuntime 中的相关记录，刷新调试面板。
     */
gameEngine.removeChar = function(charId) {
        const charEl = document.getElementById(`char-${charId}`);
        this._patchCharRt(charId, { shakeStopped: true, proudStopped: true }, charEl);
        this._cancelCharMotion(charEl, charId);
        if (charEl) charEl.remove();
        // 终止未播完的连续动作队列，避免定时器在元素已删除后继续推进
        if (this.state.charActionQueues && this.state.charActionQueues[charId]) {
            clearTimeout(this.state.charActionQueues[charId].timeoutId);
            delete this.state.charActionQueues[charId];
        }
        delete this.state.activeChars[charId];
        const api = this._charRtApi();
        if (api) api.clear(this._charBag(), charId);
        // 头像跟随离场：若这角色正是当前头像角色 → 立即收掉
        this._notifySpeakerAvatar(charId, true);
        this.syncDebugCharsState();
        this._requestCharStagePaint();
    };



    /**
     * 渐出指定立绘（800ms 淡出，可选左右位移方向）。
     * 动画结束后删除 DOM 并清理全部状态；动画句柄缺失时降级为直接置透明。
     * 最后一个参数传 true 表示动画被取消时也执行收尾，避免残留幽灵节点。
     * @param {string} charId - 立绘ID。
     * @param {HTMLElement} [charEl] - 立绘DOM元素，不提供则自动获取。
     * @param {string} [direction] - 渐出方向 ('left' 或 'right')，默认为原地淡出。
     * @returns {void}
     * @sideeffect 播放淡出动画、删除 DOM、清理 runtime/activeChars 并刷新调试面板。
     */
gameEngine.fadeOutChar = function(charId, charEl = null, direction = null) {
        if (!charEl) charEl = document.getElementById(`char-${charId}`);
        if (!charEl) {
            console.warn(`立绘 ${charId} 不存在，无法执行渐出`);
            return;
        }
        const resolvedId = this._charIdOf(charEl, charId);

        this._patchCharRt(resolvedId, { shakeStopped: true, proudStopped: true, opacity: 0 }, charEl);
        this._cancelCharMotion(charEl, resolvedId);
        // 渐出即退场，终止该角色未播完的连续动作队列
        if (this.state.charActionQueues && this.state.charActionQueues[resolvedId]) {
            clearTimeout(this.state.charActionQueues[resolvedId].timeoutId);
            delete this.state.charActionQueues[resolvedId];
        }

        // 按方向选择关键帧：左/右渐出在淡出的同时向对应方向位移 10%
        const animApi = this._charAnimApi();
        const currentTransform = charEl.style.transform || 'translateX(-50%)';
        let kf;
        if (direction === 'left') {
            kf = animApi ? animApi.fadeSlideKeyframes(1, 0, currentTransform, currentTransform + ' translateX(-10%)') : null;
        } else if (direction === 'right') {
            kf = animApi ? animApi.fadeSlideKeyframes(1, 0, currentTransform, currentTransform + ' translateX(10%)') : null;
        } else {
            kf = animApi ? animApi.fadeOpacity(1, 0) : null;
        }
        charEl.style.transition = 'none';
        const handle = kf ? this._playCharAnim(charEl, resolvedId, kf, { duration: 800, easing: 'ease-in-out' }) : null;
        if (!handle) charEl.style.opacity = '0';
        const self = this;
        // 无论动画正常结束还是被取消，都要完成 DOM 与状态清理
        this._onAnimFinished(handle, function () {
            if (charEl && charEl.parentNode) charEl.remove();
            delete self.state.activeChars[resolvedId];
            const api = self._charRtApi();
            if (api) api.clear(self._charBag(), resolvedId);
            // 渐出结束即离场，头像同步收掉
            self._notifySpeakerAvatar(resolvedId, true);
            self.syncDebugCharsState();
            self._requestCharStagePaint();
        }, true);
    };



    /**
     * 渐入指定立绘（800ms 淡入，支持方向位移）。
     * 先置透明再播放关键帧动画；句柄缺失时直接落到终值，保证元素依然可见。
     * @param {string} charId - 立绘ID。
     * @param {HTMLElement} [charEl] - 立绘DOM元素，不提供则自动获取。
     * @param {string} [direction] - 渐入方向 ('left' 或 'right')，默认为原地淡入。
     * @returns {void}
     * @sideeffect 播放淡入动画、写入 runtime.opacity，动画结束后同步调试面板。
     */
gameEngine.fadeInChar = function(charId, charEl = null, direction = null) {
        if (!charEl) charEl = document.getElementById(`char-${charId}`);
        if (!charEl) {
            console.warn(`立绘 ${charId} 不存在，无法执行渐入`);
            return;
        }
        const resolvedId = this._charIdOf(charEl, charId);

        // 按方向选择关键帧：左/右渐入从对应方向 10% 位移处滑入
        const animApi = this._charAnimApi();
        const currentTransform = charEl.style.transform || 'translateX(-50%)';
        charEl.style.transition = 'none';
        charEl.style.opacity = '0';
        let kf;
        if (direction === 'left') {
            kf = animApi ? animApi.fadeSlideKeyframes(0, 1, currentTransform + ' translateX(-10%)', currentTransform) : null;
        } else if (direction === 'right') {
            kf = animApi ? animApi.fadeSlideKeyframes(0, 1, currentTransform + ' translateX(10%)', currentTransform) : null;
        } else {
            kf = animApi ? animApi.fadeOpacity(0, 1) : null;
        }
        const handle = kf ? this._playCharAnim(charEl, resolvedId, kf, { duration: 800, easing: 'ease-in-out' }) : null;
        charEl.style.opacity = '1';
        this._patchCharRt(resolvedId, { opacity: 1 }, charEl);
        const self = this;
        this._onAnimFinished(handle, function () {
            self.syncDebugCharsState();
        });
    };



    /**
     * 渐出所有立绘：使屏幕上所有活跃立绘同时执行渐出动画并清除。
     * @param {string} [direction] - 可选渐出方向 ('left' 或 'right')，省略为原地淡出。
     * @returns {void}
     * @sideeffect 对每个活跃立绘调用 fadeOutChar。
     */
gameEngine.fadeOutAllChars = function(direction) {
        // 获取所有活跃立绘的 ID
        const charIds = Object.keys(this.state.activeChars);
        
        if (charIds.length === 0) {
            console.log('没有活跃立绘，无需渐出');
            return;
        }
        
        console.log(`开始渐出 ${charIds.length} 个立绘${direction ? ` (方向: ${direction})` : ''}`);
        
        // 对所有立绘执行渐出动画
        charIds.forEach(charId => {
            this.fadeOutChar(charId, null, direction);
        });
    };



    /**
     * 移除所有立绘：清除屏幕上所有活跃立绘，包括动画状态和连续动作队列。
     * @returns {void}
     * @sideeffect 逐个调用 removeChar，并整体重置 activeChars/shakingChars/proudChars/charActionQueues/charRuntime。
     */
gameEngine.removeAllChars = function() {
        // 获取所有活跃立绘的 ID
        const charIds = Object.keys(this.state.activeChars);
        
        // 逐个移除立绘（会自动清理动画状态和动作队列）
        charIds.forEach(charId => {
            this.removeChar(charId);
        });
        
        // 确保状态已清空（理论上 removeChar 已经处理，但这里做双重保险）
        this.state.activeChars = {};
        this.state.shakingChars = {};
        this.state.proudChars = {};
        this.state.charActionQueues = {};
        this.state.charRuntime = {};
        // 立绘全清 → 头像无条件收掉。removeChar 已逐个通知过，
        // 这里兜底「activeChars 本来就是空的、头像却还挂在屏幕上」的边角情况。
        this._notifySpeakerAvatar(null, true);
        // 不在这里清 charStageLatch：同一括号串里的 [消失 all] 后仍要沿用 _beginCharBatch 的场次闩锁。
        // 下一场 _beginCharBatch 在 activeCount=0 时会按 add 数重算。
        
        // 更新调试日志中的立绘状态（此时 activeChars 已为空）
        this.syncDebugCharsState();
        this._syncCharStageDom();
    };



    /**
     * 同步调试日志中的立绘状态。
     * 根据当前 activeChars 和 charNameMap 重建 lastActiveChars 字符串，
     * 并直接重写调试面板 innerHTML（不走 updateDebugInfo，避免被当前行数据覆盖）。
     * 在立绘新增/移除/清除后调用，确保 F1 调试面板显示正确的状态。
     * @returns {void}
     * @sideeffect 写入 systemModule.lastActiveChars，可能更新 #debug-content 的 DOM。
     */
gameEngine.syncDebugCharsState = function() {
        if (typeof systemModule === 'undefined') {
            return; // systemModule 未加载
        }
        
        const activeCharIds = Object.keys(this.state.activeChars);
        
        if (activeCharIds.length === 0) {
            // 没有活跃立绘，清空 lastActiveChars
            systemModule.lastActiveChars = null;
        } else {
            // 重建 chars 指令字符串
            // 优先使用 charNameMap 中的角色标识符，如果没有则使用 charId
            const charInstructions = [];
            
            activeCharIds.forEach(charId => {
                // 查找是否有角色名称标识符映射到这个 charId
                let roleName = null;
                for (const [name, info] of Object.entries(this.state.charNameMap || {})) {
                    if (info.charId === charId) {
                        roleName = name;
                        break;
                    }
                }
                
                // 构建指令字符串
                if (roleName) {
                    // 如果有角色名称标识符，使用它
                    charInstructions.push(`[${roleName} ${charId}]`);
                } else {
                    // 否则直接使用 charId
                    charInstructions.push(`[${charId}]`);
                }
            });
            
            systemModule.lastActiveChars = charInstructions.join('');
        }
        
        // 直接更新调试面板 DOM，而不是调用 updateDebugInfo()
        // 因为 updateDebugInfo() 会基于当前行的 chars 字段重新设置 lastActiveChars，导致覆盖
        if (systemModule.debugVisible && systemModule.debugPanel) {
            const debugContent = document.getElementById('debug-content');
            if (debugContent) {
                // 获取当前场景文件名（解码URL编码的中文字符）
                const rawPage = window.location.pathname.split('/').pop() || 'unknown.html';
                const currentPage = decodeURIComponent(rawPage);
                const currentIndex = this.state.currentLine;
                
                let info = `<div style="color: #FFFF00; margin-bottom: 5px;">${currentPage}</div>`;
                info += `<div style="margin-bottom: 3px;">Index: ${currentIndex}</div>`;
                
                // BGM 信息
                if (systemModule.lastActiveBgm) {
                    info += `<div style="margin-bottom: 3px;">BGM: ${systemModule.lastActiveBgm}</div>`;
                } else {
                    info += `<div style="margin-bottom: 3px; color: #888;">BGM: None</div>`;
                }
                
                // 背景图片信息
                if (systemModule.lastActiveBg) {
                    info += `<div style="margin-bottom: 3px;">BG: ${systemModule.lastActiveBg}</div>`;
                } else {
                    info += `<div style="margin-bottom: 3px; color: #888;">BG: None</div>`;
                }
                
                // 立绘信息
                if (systemModule.lastActiveChars) {
                    const charsList = systemModule.parseCharsInfo(systemModule.lastActiveChars);
                    info += `<div style="margin-bottom: 3px;">Chars:</div>`;
                    charsList.forEach(char => {
                        info += `<div style="margin-left: 15px; margin-bottom: 2px;">${char}</div>`;
                    });
                } else {
                    info += `<div style="margin-bottom: 3px; color: #888;">Chars: None</div>`;
                }
                
                debugContent.innerHTML = info;
            }
        }
    };



    /**
     * 应用立绘动作指令（动作类型到具体实现的统一分发）。
     * 支持：retreat/forward（前后退）、scare（惊吓）、shake/cshake/sshake（发抖/持续/停止）、
     * nod（点头）、ltilt/rtilt（左右倒）、stand（站起）、proud/cproud/sproud（得意/持续/停止）。
     * @param {string} charId - 立绘ID。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {string} actionType - 动作类型标识。
     * @param {Object} props - 解析后的修饰词属性。
     * @returns {void}
     * @sideeffect 依动作类型调用对应的 applyXxxAction / stopXxxAction。
     */
gameEngine.applyCharAction = function(charId, charEl, actionType, props) {
        switch(actionType) {
            case 'retreat':
                this.applyRetreatAction(charEl, props);
                break;
            case 'forward':
                this.applyForwardAction(charEl, props);
                break;
            case 'scare':
                this.applyJumpscareAction(charEl, props);
                break;
            case 'shake':
                this.applyShakeAction(charEl, props, false);
                break;
            case 'cshake':
                this.applyShakeAction(charEl, props, true);
                break;
            case 'sshake':
                this.stopShakeAction(charId);
                break;
            case 'nod':
                this.applyNodAction(charEl, props);
                break;
            case 'ltilt':
                this.applyLeftTiltAction(charEl, props);
                break;
            case 'rtilt':
                this.applyRightTiltAction(charEl, props);
                break;
            case 'stand':
                this.applyStandAction(charEl, props);
                break;
            case 'proud':
                this.applyProudAction(charEl, props, false);
                break;
            case 'cproud':
                this.applyProudAction(charEl, props, true);
                break;
            case 'sproud':
                this.stopProudAction(charId);
                break;
        }
    };



    /**
     * 应用“后退”动作。
     * Y轴向上偏移 +10%，缩放比例减小 -10%，层级强制变为“后”（z-index 9）。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性（本动作未使用）。
     * @returns {void}
     * @sideeffect 改写 bottom/height/zIndex 或合成图缩放，并写入 runtime。
     */
gameEngine.applyRetreatAction = function(charEl, props) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const currentBottom = parseFloat((rt && rt.bottom) || charEl.style.bottom || '0') || 0;
        const newBottom = currentBottom + 10;
        charEl.style.bottom = `${newBottom}%`;
        const curScale = (rt && Number.isFinite(rt.scale)) ? rt.scale : 1;
        // 分层立绘走合成图缩放；旧版立绘走 height 百分比
        if (this.updateLayeredCharScale(charEl, Math.max(0.1, curScale - 0.1), 'waapi')) {
            // layered
        } else {
            const currentHeightStr = charEl.style.height || '100%';
            const currentScale = parseFloat(currentHeightStr) / 100 || 1;
            const newScale = Math.max(0.1, currentScale - 0.1);
            charEl.style.height = `${newScale * 100}%`;
            this._patchCharRt(charId, { scale: newScale }, charEl);
        }
        this._patchCharRt(charId, { bottom: newBottom + '%' }, charEl);
        const currentZIndex = parseInt(charEl.style.zIndex) || 10;
        if (currentZIndex !== 9) charEl.style.zIndex = 9;
    };



    /**
     * 应用“前进”动作。
     * Y轴向下偏移 -10%，缩放比例增大 +10%，层级强制变为“前”（z-index 11）。
     * 分层立绘的缩放目标取"基准+1 与 2.0 的较大者"作为上限，再叠加当前 +0.1，避免前景放大失控。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性（本动作未使用）。
     * @returns {void}
     * @sideeffect 改写 bottom/height/zIndex 或合成图缩放，并写入 runtime。
     */
gameEngine.applyForwardAction = function(charEl, props) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const currentBottom = parseFloat((rt && rt.bottom) || charEl.style.bottom || '0') || 0;
        const newBottom = currentBottom - 10;
        charEl.style.bottom = `${newBottom}%`;
        const isLayeredChar = charEl && charEl.classList &&
            charEl.classList.contains('character-layered');
        const currentLayeredScale = isLayeredChar
            ? ((rt && Number.isFinite(rt.scale)) ? rt.scale : 1)
            : null;
        const layeredBaseScale = isLayeredChar
            ? ((rt && Number.isFinite(rt.baseScale)) ? rt.baseScale : 1)
            : null;
        // 分层立绘的缩放上限：不低于 2.0，且不小于"基准+1"
        const nextLayeredScale = isLayeredChar
            ? Math.min(Math.max(2.0, layeredBaseScale + 1.0), currentLayeredScale + 0.1)
            : null;
        if (this.updateLayeredCharScale(charEl, isLayeredChar ? nextLayeredScale : null, 'waapi')) {
            // layered
        } else {
            const currentHeightStr = charEl.style.height || '100%';
            const currentScale = parseFloat(currentHeightStr) / 100 || 1;
            const newScale = Math.min(2.0, currentScale + 0.1);
            charEl.style.height = `${newScale * 100}%`;
            this._patchCharRt(charId, { scale: newScale }, charEl);
        }
        this._patchCharRt(charId, { bottom: newBottom + '%' }, charEl);
        const currentZIndex = parseInt(charEl.style.zIndex) || 10;
        if (currentZIndex !== 11) charEl.style.zIndex = 11;
    };



    /**
     * 应用“吓一跳”动作：先放大7%，再缩小7%，关键帧拼接两次共 1000ms。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性（用于取基准缩放）。
     * @returns {void}
     * @sideeffect 在分层立绘的合成图上（或旧版元素上）播放缩放抖动动画。
     */
gameEngine.applyJumpscareAction = function(charEl, props) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const isLayeredChar = charEl && charEl.classList &&
            charEl.classList.contains('character-layered');
        const baseScale = (rt && Number.isFinite(rt.scale)) ? rt.scale : (props.scale || 1);
        const animApi = this._charAnimApi();
        const target = isLayeredChar
            ? (charEl.querySelector && charEl.querySelector('.char-composite')) || charEl
            : charEl;
        // 分层合成图用 transform 承载缩放；旧版 img 已用 height 缩放，关键帧只叠相对 1 的抖动。
        const kfBase = isLayeredChar ? baseScale : 1;
        const kf = animApi ? animApi.jumpscareScaleKeyframes(kfBase) : null;
        if (kf) {
            this._playCharAnim(target, charId, kf.concat(kf), { duration: 1000, easing: 'ease-in-out' });
        }
    };



    /**
     * 应用“点头”动作。
     * Y轴向上移动2%，再向下移动4%（到初始位置下方2%），最后回到原位。
     * 只执行一次完整的“上-下-回”序列，时长 450ms。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性（本动作未使用）。
     * @returns {void}
     * @sideeffect 播放基于 baseBottom 的关键帧动画。
     */
gameEngine.applyNodAction = function(charEl, props) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const baseBottom = parseFloat((rt && rt.bottom) || charEl.style.bottom || '0') || 0;
        const animApi = this._charAnimApi();
        const kf = animApi ? animApi.nodKeyframes(baseBottom) : null;
        charEl.style.transition = 'none';
        if (kf) this._playCharAnim(charEl, charId, kf, { duration: 450, easing: 'ease-in-out' });
    };



    /**
     * 应用“左倒”动作：立绘逆时针旋转 90 度，模拟向左侧倒下（500ms）。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性（本动作未使用）。
     * @returns {void}
     * @sideeffect 播放旋转动画并把 runtime.rotation 置为 -90。
     */
gameEngine.applyLeftTiltAction = function(charEl, props) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const from = (rt && Number.isFinite(rt.rotation)) ? rt.rotation : 0;
        const animApi = this._charAnimApi();
        charEl.style.transition = 'none';
        if (animApi) this._playCharAnim(charEl, charId, animApi.tiltKeyframes(from, -90), { duration: 500, easing: 'ease-in-out' });
        this._patchCharRt(charId, { rotation: -90 }, charEl);
    };



    /**
     * 应用“右倒”动作：立绘顺时针旋转 90 度，模拟向右侧倒下（500ms）。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性（本动作未使用）。
     * @returns {void}
     * @sideeffect 播放旋转动画并把 runtime.rotation 置为 90。
     */
gameEngine.applyRightTiltAction = function(charEl, props) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const from = (rt && Number.isFinite(rt.rotation)) ? rt.rotation : 0;
        const animApi = this._charAnimApi();
        charEl.style.transition = 'none';
        if (animApi) this._playCharAnim(charEl, charId, animApi.tiltKeyframes(from, 90), { duration: 500, easing: 'ease-in-out' });
        this._patchCharRt(charId, { rotation: 90 }, charEl);
    };



    /**
     * 应用“站立”动作：重置立绘的旋转角度到 0°，使其恢复垂直站立状态（300ms）。
     * 已是 0° 时直接返回，避免无意义的动画。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性（本动作未使用）。
     * @returns {void}
     * @sideeffect 播放旋转回正动画并把 runtime.rotation 置为 0。
     */
gameEngine.applyStandAction = function(charEl, props) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const from = (rt && Number.isFinite(rt.rotation)) ? rt.rotation : 0;
        if (from === 0) return;
        const animApi = this._charAnimApi();
        charEl.style.transition = 'none';
        if (animApi) this._playCharAnim(charEl, charId, animApi.tiltKeyframes(from, 0), { duration: 300, easing: 'ease-in-out' });
        this._patchCharRt(charId, { rotation: 0 }, charEl);
    };



    /**
     * 应用"得意"或"持续得意"动作。
     * 动画序列：z:-5 同时 y:5% → y:-5% → z:5 同时 y:5%（单轮 1200ms）。
     * 普通模式播放 2 轮后回正；持续模式无限循环且保持动画状态（persist）。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性。
     * @param {boolean} isContinuous - 是否为持续模式。
     * @returns {void}
     * @sideeffect 取消既有动画、置 proudStopped 标记、播放无限/有限循环动画。
     */
gameEngine.applyProudAction = function(charEl, props, isContinuous) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const baseBottom = parseFloat((rt && rt.bottom) || charEl.style.bottom || '0') || 0;
        // 基准旋转：优先取本次指令的精确角度，其次 runtime，最后 0
        const baseRotation = (props && Number.isFinite(props.preciseZ))
            ? props.preciseZ
            : ((rt && Number.isFinite(rt.rotation)) ? rt.rotation : 0);
        this._cancelCharMotion(charEl, charId);
        this._patchCharRt(charId, { proudStopped: false }, charEl);
        const animApi = this._charAnimApi();
        const kf = animApi ? animApi.proudKeyframes(baseBottom, baseRotation) : null;
        charEl.style.transition = 'none';
        const handle = kf ? this._playCharAnim(charEl, charId, kf, {
            duration: 1200,
            easing: 'ease-in-out',
            iterations: isContinuous ? Infinity : 2,
            persist: !!isContinuous
        }) : null;
        // 非持续模式：两轮播完后回正到基准位置与角度
        if (!isContinuous) {
            const self = this;
            this._onAnimFinished(handle, function () {
                self.resetProudState(charEl, baseBottom, baseRotation);
            });
        }
    };


    
    /**
     * 重置得意状态，恢复到基准位置与角度。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {number} baseBottom - 基准bottom值（百分比数值）。
     * @param {number} baseRotation - 基准旋转角度（度）。
     * @returns {void}
     * @sideeffect 播放 300ms 回正动画，并把 bottom/rotation 写回内联样式与 runtime。
     */
gameEngine.resetProudState = function(charEl, baseBottom, baseRotation) {
        const charId = this._charIdOf(charEl);
        const animApi = this._charAnimApi();
        charEl.style.transition = 'none';
        if (animApi) {
            this._playCharAnim(charEl, charId, [
                { bottom: charEl.style.bottom || (baseBottom + '%'), transform: charEl.style.transform || 'translateX(-50%)' },
                { bottom: baseBottom + '%', transform: `translateX(-50%) rotate(${baseRotation}deg)` }
            ], { duration: 300, easing: 'ease-in-out' });
        }
        charEl.style.bottom = `${baseBottom}%`;
        charEl.style.transform = `translateX(-50%) rotate(${baseRotation}deg)`;
        this._patchCharRt(charId, { bottom: baseBottom + '%', rotation: baseRotation, proudStopped: false }, charEl);
    };


    
    /**
     * 停止得意动作：终止持续动画并回正到基准位置。
     * @param {string} charId - 立绘ID。
     * @returns {void}
     * @sideeffect 标记 proudStopped、取消动画并调用 resetProudState。
     */
gameEngine.stopProudAction = function(charId) {
        const charEl = document.getElementById(`char-${charId}`);
        this._patchCharRt(charId, { proudStopped: true }, charEl);
        this._cancelCharMotion(charEl, charId);
        if (!charEl) return;
        const rt = this._getCharRt(charId);
        const props = this.state.activeChars[charId] || {};
        const baseBottom = parseFloat((rt && rt.bottom) || props.bottom || 0) || 0;
        const baseRotation = (rt && Number.isFinite(rt.rotation)) ? rt.rotation : (props.preciseZ || 0);
        this.resetProudState(charEl, baseBottom, baseRotation);
    };



    /**
     * 应用“发抖”或“持续发抖”动作。
     * X轴左右偏移 ±2%，单次 160ms，交替方向；非持续模式重复 3 次后回正，持续模式无限循环。
     * @param {HTMLElement} charEl - 立绘DOM元素。
     * @param {Object} props - 解析后的属性（本动作未使用）。
     * @param {boolean} isContinuous - 是否为持续模式。
     * @returns {void}
     * @sideeffect 取消既有动画、置 shakeStopped 标记、播放抖动动画并在结束后复位 left。
     */
gameEngine.applyShakeAction = function(charEl, props, isContinuous) {
        const charId = this._charIdOf(charEl);
        const rt = this._getCharRt(charId);
        const currentLeft = (rt && rt.left) || charEl.style.left || '50%';
        this._cancelCharMotion(charEl, charId);
        this._patchCharRt(charId, { shakeStopped: false, left: currentLeft }, charEl);
        const animApi = this._charAnimApi();
        const kf = animApi ? animApi.shakeKeyframes(currentLeft, 2) : null;
        charEl.style.transition = 'none';
        const handle = kf ? this._playCharAnim(charEl, charId, kf, {
            duration: 160,
            easing: 'linear',
            iterations: isContinuous ? Infinity : 3,
            direction: 'alternate',
            persist: !!isContinuous
        }) : null;
        // 非持续模式：抖动结束后把 left 复位，消除关键帧残留偏移
        if (!isContinuous) {
            this._onAnimFinished(handle, function () {
                if (charEl) charEl.style.left = currentLeft;
            });
        }
    };



    /**
     * 停止"持续发抖"动作：取消抖动动画并把 left 复位到记录值。
     * @param {string} charId - 立绘ID。
     * @returns {void}
     * @sideeffect 标记 shakeStopped、取消动画并复位内联 left。
     */
gameEngine.stopShakeAction = function(charId) {
        const charEl = document.getElementById(`char-${charId}`);
        this._patchCharRt(charId, { shakeStopped: true }, charEl);
        this._cancelCharMotion(charEl, charId);
        const rt = this._getCharRt(charId);
        const props = this.state.activeChars[charId] || {};
        const left = (rt && rt.left) || props.left;
        if (charEl && left) charEl.style.left = left;
    };

