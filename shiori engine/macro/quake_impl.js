/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 画面震动宏实现（quake_impl.js）。
 * 注册并实现 quake / quake-stop 指令，对舞台、文本框、立绘等目标施加屏幕震动效果。
 * 优先复用引擎原生的 applyShakeAction/stopShakeAction 实现角色层震动，
 * 对非角色元素则注入 CSS @keyframes 动画；同时维护活跃震动记录表，
 * 保证同一目标重复触发时可正确清理，并在引擎重载/读档时清除全部震动。
 */
(function (global) {
    'use strict';

    /* 全局宿主对象（浏览器为 window） */
    var root = global;
    /* 从宿主获取宏注册表：优先 __shiori.reg，回退旧版 __reg */
    var __reg = (root.__shiori && root.__shiori.reg) || root.__reg;
    /* 注册表不可用时静默退出，避免抛错 */
    if (!__reg || typeof __reg.cmd !== 'function' || typeof __reg.impl !== 'function')
        return;

    var STYLE_ID = 'shiori-quake-style';   /* 注入的 <style> 元素 id，用于幂等检测 */
    var LIVE = '_quakeLive';               /* 活跃震动记录在 ctx 上的属性名 */
    var CLASS_NAME = 'shiori-quake';       /* 施加震动动画的 CSS 类名 */

    /**
     * 获取当前文档对象，环境无 document 时返回 null。
     * @returns {?Document} document 对象
     */
    function doc() {
        return root.document || null;
    }

    /**
     * 幂等地向文档头部注入震动动画所需的 CSS 关键帧与类样式。
     * 通过 STYLE_ID 检测避免重复注入；震动偏移量由 CSS 变量
     * --shiori-quake-px 控制（默认 32px），供不同强度级别动态覆盖。
     * @returns {void}
     * @sideeffect 向 document.head 追加 <style> 元素
     */
    function ensureStyle() {
        var d = doc();
        if (!d || d.getElementById(STYLE_ID)) return;
        var el = d.createElement('style');
        el.id = STYLE_ID;
        el.textContent =
            '@keyframes shiori-quake{' +
            '0%,100%{margin-left:0}' +
            '25%{margin-left:var(--shiori-quake-px,32px)}' +
            '50%{margin-left:calc(var(--shiori-quake-px,32px)*-1)}' +
            '75%{margin-left:var(--shiori-quake-px,32px)}' +
            '}' +
            '.shiori-quake{animation:shiori-quake .08s linear infinite}';
        (d.head || d.documentElement).appendChild(el);
    }

    /**
     * 将中文震动强度级别映射为像素偏移量（震动幅度）。
     * 级别与像素：极小/極小 = 8，小 = 16，中（默认）= 32，大 = 56，极大/極大 = 80。
     * 同时兼容简体（极小/极大）与日文汉字（極小/極大）写法，未知值按"中"处理。
     * @param {string} level 强度级别字符串
     * @returns {number} 震动像素幅度
     */
    function levelPx(level) {
        var s = String(level == null || level === '' ? '中' : level);
        if (s === '極小' || s === '极小') return 8;
        if (s === '小') return 16;
        if (s === '大') return 56;
        if (s === '極大' || s === '极大') return 80;
        return 32;
    }

    /**
     * 判断元素是否为角色立绘元素（可交由引擎原生震动实现处理）。
     * 判定条件：带 character-layered 类，或 id 以 "char-" 开头且非 char-stage。
     * @param {HTMLElement} el 待检测元素
     * @returns {boolean} 是否为角色立绘元素
     */
    function isCharEl(el) {
        if (!el) return false;
        if (el.classList && el.classList.contains('character-layered')) return true;
        var id = el.id ? String(el.id) : '';
        return id.indexOf('char-') === 0 && id !== 'char-stage';
    }

    /**
     * 尝试用引擎原生能力启动角色震动。
     * 引擎提供 applyShakeAction 时优先使用，可获得与角色动画更精确的联动。
     * @param {Object} ctx 游戏引擎实例
     * @param {HTMLElement} el 角色元素
     * @returns {boolean} 是否成功交由引擎处理（true 表示调用方无需再注入 CSS 动画）
     * @sideeffect 调用 ctx.applyShakeAction 启动震动
     */
    function engineShakeStart(ctx, el) {
        if (!ctx || typeof ctx.applyShakeAction !== 'function' || !el) return false;
        ctx.applyShakeAction(el, {}, true);
        return true;
    }

    /**
     * 停止引擎原生的角色震动。
     * 目标 id 优先取传入的 who，其次从元素 id（char-xxx）反推角色名。
     * @param {Object} ctx 游戏引擎实例
     * @param {HTMLElement} el 角色元素
     * @param {string} who 角色名（可为空）
     * @returns {void}
     * @sideeffect 调用 ctx.stopShakeAction
     */
    function engineShakeStop(ctx, el, who) {
        if (!ctx || typeof ctx.stopShakeAction !== 'function') return;
        var id = who ? String(who) : '';
        if (!id && el && el.id && String(el.id).indexOf('char-') === 0)
            id = String(el.id).slice(5);
        if (id) ctx.stopShakeAction(id);
    }

    /**
     * 解析指令的 chan（通道）参数为通道名数组。
     * 规则：
     *   显式指定 chan → 按逗号/空白拆分；
     *   未指定但指定了 who → 返回空数组（仅震动该角色）；
     *   全未指定 → 默认返回 ['stage','ev','allchar']（全屏震动）。
     * @param {Object} p 指令参数对象
     * @returns {string[]} 小写前的通道名数组
     */
    function chanList(p) {
        var raw = p && p.chan;
        if (raw == null || String(raw).trim() === '') {
            if (p && p.who) return [];
            return ['stage', 'ev', 'allchar'];
        }
        return String(raw).split(/[,\s]+/).filter(function (x) { return x.length > 0; });
    }

    /**
     * 将元素去重后追加到列表（避免同一元素被多个通道重复选中）。
     * @param {HTMLElement[]} list 目标列表（原地修改）
     * @param {?HTMLElement} el 待追加元素
     * @returns {void}
     */
    function pushUnique(list, el) {
        if (!el) return;
        for (var i = 0; i < list.length; i++)
            if (list[i] === el) return;
        list.push(el);
    }

    /**
     * 收集本次震动需要作用的 DOM 元素列表。
     * 支持的目标来源：
     *   who 参数 → id 为 char-<who> 的角色元素；
     *   chan=stage  → 角色舞台 char-stage 与 characterContainer；
     *   chan=ev     → 对话框 textBox；
     *   chan=allchar → 页面上所有角色立绘元素。
     * @param {Object} ctx 游戏引擎实例（用于取 elements）
     * @param {Object} p 指令参数对象（who / chan）
     * @returns {HTMLElement[]} 去重后的目标元素数组
     */
    function targets(ctx, p) {
        var els = [];
        var d = doc();
        if (!d) return els;
        var who = p && p.who;
        if (who)
            pushUnique(els, d.getElementById('char-' + who));
        var chans = chanList(p);
        for (var i = 0; i < chans.length; i++) {
            var k = String(chans[i]).toLowerCase();
            if (k === 'stage') {
                pushUnique(els, d.getElementById('char-stage'));
                if (ctx && ctx.elements && ctx.elements.characterContainer)
                    pushUnique(els, ctx.elements.characterContainer);
            } else if (k === 'ev') {
                if (ctx && ctx.elements && ctx.elements.textBox)
                    pushUnique(els, ctx.elements.textBox);
            } else if (k === 'allchar') {
                var found = d.querySelectorAll('.character-layered, .character, [id^="char-"]');
                for (var j = 0; j < found.length; j++)
                    pushUnique(els, found[j]);
            }
        }
        return els;
    }

    /**
     * 生成震动记录的唯一键（who + chan 组合）。
     * 相同 who/chan 再次触发时视为同一次震动，可先清理旧记录再重建。
     * @param {Object} p 指令参数对象
     * @returns {string} 记录键，形如 "角色名|通道名"
     */
    function liveKey(p) {
        return String((p && p.who) || '') + '|' + String((p && p.chan) || '');
    }

    /**
     * 获取（必要时惰性初始化）震动的活跃记录表。
     * 记录表挂在 ctx 上，避免多实例互相干扰。
     * @param {Object} ctx 游戏引擎实例
     * @returns {Object} 活跃记录映射（键 → {els, px, who, engine}）
     */
    function liveMap(ctx) {
        var host = ctx || {};
        if (!host[LIVE]) host[LIVE] = Object.create(null);
        return host[LIVE];
    }

    /**
     * 通过设置 CSS 变量与添加类的方式，对元素施加 CSS 震动动画。
     * @param {HTMLElement} el 目标元素
     * @param {number} px 震动像素幅度
     * @returns {void}
     * @sideeffect 修改元素 class 与内联 CSS 变量
     */
    function applyClass(el, px) {
        if (!el || !el.classList) return;
        if (el.style && typeof el.style.setProperty === 'function')
            el.style.setProperty('--shiori-quake-px', px + 'px');
        el.classList.add(CLASS_NAME);
    }

    /**
     * 移除元素上的 CSS 震动动画类与变量，恢复原始状态。
     * @param {HTMLElement} el 目标元素
     * @returns {void}
     * @sideeffect 修改元素 class 与内联样式
     */
    function clearEl(el) {
        if (!el || !el.classList) return;
        el.classList.remove(CLASS_NAME);
        if (el.style && typeof el.style.removeProperty === 'function')
            el.style.removeProperty('--shiori-quake-px');
    }

    /**
     * 清理一条震动记录：分别停止引擎原生震动与 CSS 动画。
     * @param {Object} rec 震动记录 {els, engine, who}
     * @param {Object} ctx 游戏引擎实例
     * @returns {void}
     * @sideeffect 移除元素动画类并调用引擎 stopShakeAction
     */
    function clearRec(rec, ctx) {
        if (!rec) return;
        if (rec.engine && rec.engine.length) {
            for (var e = 0; e < rec.engine.length; e++)
                engineShakeStop(ctx, rec.engine[e], rec.who);
            rec.engine = [];
        }
        if (!rec.els) return;
        for (var i = 0; i < rec.els.length; i++)
            clearEl(rec.els[i]);
    }

    /**
     * [quake] 指令：启动画面震动。
     * 流程：确保样式已注入 → 解析强度与目标 → 清理同键旧记录 →
     * 对角色元素优先走引擎原生震动，其余元素施加 CSS 动画 → 登记活跃记录。
     * @param {Object} ctx 游戏引擎实例
     * @param {Object} p 指令参数对象（who / level / chan）
     * @returns {{type: string}} 动作描述
     * @sideeffect 注入 CSS、修改 DOM、写入活跃记录表
     */
    function start(ctx, p) {
        ensureStyle();
        var px = levelPx(p && p.level);
        var nodes = targets(ctx, p || {});
        var map = liveMap(ctx);
        var key = liveKey(p);
        /* 同一 who/chan 再次触发时先清理旧震动，避免动画叠加与记录泄漏 */
        if (map[key]) clearRec(map[key], ctx);
        var rec = {
            els: nodes,
            px: px,
            who: (p && p.who) ? String(p.who) : '',
            engine: []   /* 交由引擎原生震动的元素子集 */
        };
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (isCharEl(el) && engineShakeStart(ctx, el))
                rec.engine.push(el);
            else
                applyClass(el, px);
        }
        map[key] = rec;
        return { type: 'quake' };
    }

    /**
     * [quake-stop] 指令：停止画面震动。
     * 匹配策略：
     *   既无 who 也无 chan → 停止全部震动；
     *   键完全匹配（who+chan）→ 停止该条记录；
     *   仅有 who → 停止所有 who 相同的记录（忽略 chan）。
     * @param {Object} ctx 游戏引擎实例
     * @param {Object} p 指令参数对象（who / chan）
     * @returns {{type: string}} 动作描述
     * @sideeffect 清理 DOM 动画并删除活跃记录
     */
    function stop(ctx, p) {
        var map = liveMap(ctx);
        var who = p && p.who ? String(p.who) : '';
        var exact = liveKey(p || {});
        /* 无任何定位参数 → 全量停止 */
        if (!who && !(p && p.chan)) {
            Object.keys(map).forEach(function (k) {
                clearRec(map[k], ctx);
                delete map[k];
            });
            return { type: 'quakeStop' };
        }
        /* 精确键命中 → 仅停止该条 */
        if (map[exact]) {
            clearRec(map[exact], ctx);
            delete map[exact];
            return { type: 'quakeStop' };
        }
        /* 退化为按 who 前缀匹配（键格式 "who|chan"） */
        Object.keys(map).forEach(function (k) {
            var sep = k.indexOf('|');
            var kWho = sep < 0 ? k : k.slice(0, sep);
            if (who && kWho === who) {
                clearRec(map[k], ctx);
                delete map[k];
            }
        });
        return { type: 'quakeStop' };
    }

    /**
     * 清除当前上下文中的所有震动（供引擎重载/读档时调用）。
     * @param {Object} ctx 游戏引擎实例
     * @returns {void}
     */
    function clearAll(ctx) {
        stop(ctx, {});
    }

    /**
     * 以"前置钩子"方式包装对象方法：在原方法执行前先调用 before(this)。
     * 通过 _shioriQuakeWrapped 标记保证幂等，避免重复包装。
     * @param {Object} obj 目标对象
     * @param {string} name 方法名
     * @param {Function} before 前置回调，入参为调用时的 this
     * @returns {void}
     * @sideeffect 替换 obj[name] 为包装后的函数
     */
    function wrap(obj, name, before) {
        if (!obj || typeof obj[name] !== 'function' || obj[name]._shioriQuakeWrapped)
            return;
        var orig = obj[name];
        var wrapped = function () {
            before(this);
            return orig.apply(this, arguments);
        };
        wrapped._shioriQuakeWrapped = true;
        obj[name] = wrapped;
    }

    /* 在引擎初始化和读档时自动清除残留震动，避免状态切换后动画卡死 */
    var ge = (typeof gameEngine !== 'undefined') ? gameEngine : root.gameEngine;
    if (ge) {
        wrap(ge, 'init', clearAll);
        wrap(ge, 'loadStateSnapshot', clearAll);
    }

    /* ===== 向 DSL 注册表登记命令与实现 ===== */
    __reg.cmd({ name: 'quake' });       // 画面震动开始
    __reg.cmd({ name: 'quake-stop' });  // 画面震动停止
    __reg.impl({ cmd: 'quake', run: start });
    __reg.impl({ cmd: 'quake-stop', run: stop });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
