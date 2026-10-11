/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 立绘运行时状态管理：以纯数据对象（bag）保存每个角色的动作队列、定时器、
 * 动画句柄、缩放/偏移/旋转/滤镜等状态。DOM 上的 dataset 仅作为调试投影，
 * 不作为读写数据源，避免样式与状态相互污染。
 */
(function (root) {
    'use strict';

    /**
     * 创建一个空白的立绘运行时状态对象（蓝图 / 默认值工厂）。
     * @returns {Object} 运行时状态对象
     * @property {Array} actionQueue 待执行动作队列
     * @property {Array} timers 由本状态持有的定时器 ID 列表，用于统一清理
     * @property {Animation|null} anim 当前动画句柄
     * @property {number} scale 当前实际缩放
     * @property {number} baseScale 基础缩放（z 分层缩放）
     * @property {number} faceScale 表情层相对缩放
     * @property {number} faceOffsetX 表情层水平偏移（百分比）
     * @property {number} faceOffsetY 表情层垂直偏移（百分比）
     * @property {number|null} left 立绘 left 定位值
     * @property {number|null} bottom 立绘 bottom 定位值
     * @property {number} rotation 旋转角（度）
     * @property {number} opacity 不透明度
     * @property {string} filter CSS filter 字符串
     * @property {string} blitSig 位图合成签名，用于判断能否复用缓存
     * @property {number} gen 合成代次，自增用于使旧回调失效
     * @property {{x:number,y:number,w:number,h:number}|undefined} faceRect
     *           表情层在合成画布上的绘制矩形（像素，非默认值；由 engine_chars 的合成阶段写入）。
     *           说话人小头像的零配置裁切框直接读它。Dom 模式才有；
     *           Precomposed 模式由宿主预合成，引擎拿不到该矩形。
     * @property {boolean} shakeStopped 发抖动作是否已停止
     * @property {boolean} proudStopped 得意动作是否已停止
     * @property {string} charRenderer 当前立绘渲染器（Dom / Canvas / Precomposed）
     */
    function empty() {
        return {
            actionQueue: [],
            timers: [],
            anim: null,
            scale: 1,
            baseScale: 1,
            faceScale: 1,
            faceOffsetX: 0,
            faceOffsetY: 0,
            left: null,
            bottom: null,
            rotation: 0,
            opacity: 1,
            filter: '',
            blitSig: '',
            gen: 0,
            shakeStopped: false,
            proudStopped: false,
            charRenderer: 'Dom'
        };
    }

    /**
     * 获取指定角色的运行时状态，不存在则惰性创建。
     * @param {Object} bag 运行时状态容器 { charId: runtime }
     * @param {string} charId 角色 ID
     * @returns {Object} 该角色的运行时状态对象（bag 非法时返回一个游离的临时对象）
     * @sideeffect bag 合法时会在其上写入新状态
     */
    function ensure(bag, charId) {
        if (!bag || typeof bag !== 'object') return empty();
        if (!bag[charId]) bag[charId] = empty();
        return bag[charId];
    }

    /**
     * 以不可变方式更新角色运行时状态：浅拷贝旧状态后合并 fields，再写回 bag。
     * 若 fields 显式传入 actionQueue / timers 但值不是数组，则回退为空数组，保证类型安全。
     * @param {Object} bag 运行时状态容器
     * @param {string} charId 角色 ID
     * @param {Object} [fields] 需要覆盖的字段
     * @returns {Object} 合并后的新状态对象
     * @sideeffect 覆盖 bag[charId]
     */
    function patch(bag, charId, fields) {
        var cur = ensure(bag, charId);
        var next = Object.assign({}, cur, fields || {});
        // 类型兜底：这两个字段必须保持数组语义，避免后续 push/forEach 崩溃
        if (fields && Object.prototype.hasOwnProperty.call(fields, 'actionQueue') && !Array.isArray(next.actionQueue))
            next.actionQueue = [];
        if (fields && Object.prototype.hasOwnProperty.call(fields, 'timers') && !Array.isArray(next.timers))
            next.timers = [];
        bag[charId] = next;
        return next;
    }

    /**
     * 取消并清空该运行时状态持有的全部定时器，防止角色被移除后回调仍在执行。
     * @param {Object} runtime 角色运行时状态
     * @returns {void}
     * @sideeffect 逐个 clearTimeout 并把 timers 重置为空数组
     */
    function cancelTimers(runtime) {
        if (!runtime || !runtime.timers) return;
        runtime.timers.forEach(function (id) {
            try { clearTimeout(id); } catch (e) { /* ignore */ }
        });
        runtime.timers = [];
    }

    /**
     * 清除指定角色的运行时状态。
     * @param {Object} bag 运行时状态容器
     * @param {string} charId 角色 ID
     * @param {Function} [cancelAnims] 可选的动画清理回调，接收该角色状态对象（通常用于取消 WAAPI 动画）
     * @returns {void}
     * @sideeffect 取消定时器、触发动画清理并从 bag 中删除该角色
     */
    function clear(bag, charId, cancelAnims) {
        var cur = bag && bag[charId];
        if (cur) {
            cancelTimers(cur);
            if (typeof cancelAnims === 'function') cancelAnims(cur);
        }
        if (bag) delete bag[charId];
    }

    /**
     * 角色换 ID（如角色名/别名变化）时迁移运行时状态，保证动作与缩放不丢失。
     * 迁移时会清空 anim 句柄，因为该动画仍绑定旧 DOM 元素，需要由调用方重新播放。
     * @param {Object} bag 运行时状态容器
     * @param {string} fromId 原角色 ID
     * @param {string} toId 新角色 ID
     * @returns {Object|null} 迁移后的状态对象；toId 为空时返回 null
     * @sideeffect 写入 bag[toId] 并删除 bag[fromId]
     */
    function migrate(bag, fromId, toId) {
        if (!bag || !fromId) return toId ? ensure(bag, toId) : null;
        if (fromId === toId) return ensure(bag, toId);
        var cur = bag[fromId];
        if (!cur) return ensure(bag, toId);
        bag[toId] = Object.assign({}, cur, { anim: null });
        delete bag[fromId];
        return bag[toId];
    }

    /**
     * 将运行时状态单向投影到 DOM 的 dataset 上，仅供调试/排查使用。
     * 重要：该投影是只写不读的，引擎逻辑不得从 dataset 反读状态。
     * @param {HTMLElement} el 立绘 DOM 元素
     * @param {Object} runtime 角色运行时状态
     * @returns {void}
     * @sideeffect 写入 el.dataset 上的 charDiff* / shakeStopped / proudStopped / charRenderer 字段
     */
    function projectDebugDataset(el, runtime) {
        if (!el || !el.dataset || !runtime) return;
        el.dataset.charDiffScale = String(runtime.scale);
        el.dataset.charDiffBaseScale = String(runtime.baseScale);
        el.dataset.charDiffFaceScale = String(runtime.faceScale);
        el.dataset.charDiffFaceOffsetX = String(runtime.faceOffsetX);
        el.dataset.charDiffFaceOffsetY = String(runtime.faceOffsetY);
        el.dataset.charDiffSig = String(runtime.blitSig || '');
        el.dataset.charDiffGen = String(runtime.gen || 0);
        el.dataset.shakeStopped = runtime.shakeStopped ? 'true' : '';
        el.dataset.proudStopped = runtime.proudStopped ? 'true' : '';
        if (runtime.charRenderer) el.dataset.charRenderer = String(runtime.charRenderer);
    }

    /**
     * 从立绘 DOM 元素的 id（形如 char-xxx）解析出角色 ID。
     * @param {HTMLElement} el 立绘 DOM 元素
     * @returns {string} 角色 ID；无 id 时返回空字符串
     */
    function charIdFromEl(el) {
        if (!el || !el.id) return '';
        return String(el.id).replace(/^char-/, '');
    }

    // 对外导出：浏览器挂载至 root.ShioriCharRuntime，Node 环境导出供测试使用
    var api = {
        empty: empty,
        ensure: ensure,
        patch: patch,
        cancelTimers: cancelTimers,
        clear: clear,
        migrate: migrate,
        projectDebugDataset: projectDebugDataset,
        charIdFromEl: charIdFromEl
    };
    root.ShioriCharRuntime = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
