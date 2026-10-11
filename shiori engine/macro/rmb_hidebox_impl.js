/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 右键隐藏文本框 / 左键恢复（开放 API 零侵入扩展样例）。
 *
 * 行为（仅在剧本页生效）：
 *   右键 · 文本框可见       → 隐藏文本框（普通模式）／隐藏遮罩层与文字（全屏小说模式）
 *   右键 · 文本框已隐藏     → 呼出上下文菜单
 *   右键 · 上下文菜单已呼出 → 收起上下文菜单
 *   左键 · 由右键隐藏期间   → 恢复文本框（或遮罩层与文字）并还原隐藏前已打印的文字，且不推进剧情
 *
 * 约束与实现约定：
 *   1. 不改动引擎任何既有源文件；只读取并调用 API 文档已公开的对象与方法
 *      （gameEngine.state / elements / hideTextBox / showTextBox / toggleContextMenu /
 *        isInScenesFolder / isOptionElement / processLineBreaks）。
 *   2. 需要改变既有逻辑时，以「包装（wrap）公开方法」的方式修改，而不是重写引擎代码。
 *   3. 本文件可放在 engine_manifest.json 序列的任意位置（前 / 中 / 后均可）；
 *      删除或移除引用即不再加载，引擎与其它功能照常运行，不产生任何硬依赖。
 *
 * ── 用到的开放 API（章节号对应 teachnew/html/API.html） ────────────────
 *   2  引擎核心 gameEngine：状态与元素
 *        - gameEngine.state：novelMode、choicesActive（判定模式与是否让位）
 *        - gameEngine.state：typingActive / typingTimerId / textSegments /
 *          currentSegment / currentLine / textFullyDisplayed /
 *          audioSegments / currentAudioSegment（隐藏前补齐打字机）
 *        - gameEngine.elements：textContainer、textBox、nameBox、
 *          novelModeContainer、novelTextBox、contextMenu、
 *          contextMenuBackdrop、videoPlayer（隐藏 / 恢复的操作对象）
 *        - gameEngine.sceneData（打字机无分段时回读当前行原文）
 *   3  生命周期与初始化
 *        - gameEngine.toggleContextMenu()（右键第二、三态的呼出 / 收起）
 *   5  剧情推进、跳转与视频
 *        - gameEngine.displayLine(index) / nextLine()（包装：隐藏期间推进则作废隐藏态）
 *        - gameEngine.isInScenesFolder()（只在剧本页生效）
 *   6  文本、选项与演出
 *        - gameEngine.hideTextBox() / showTextBox()（普通模式主容器的隐藏 / 恢复）
 *        - gameEngine.setWindowMode(visible)（包装：[msgoff]/[msgon] 时作废隐藏态）
 *        - gameEngine.setNovelMode(enabled)（包装：切换小说模式时作废隐藏态）
 *        - gameEngine.processLineBreaks(text)（回读原文时统一换行标记）
 *        - gameEngine.isOptionElement(element)（点在选项上时让位）
 *   11 系统模块 systemModule
 *        - stopAllAutoSkipModes()（隐藏时停止 AUTO / SKIP；探测式调用，缺失即跳过）
 *   16 UI 骨架 PageChrome
 *        - 骨架由 buildSceneChrome() 幂等创建，本模块只读取其产物（容器与名片节点）
 *   18 注意事项「加载顺序敏感」
 *        - 文档要求「在引擎清单与 macro 脚本之后访问 gameEngine」；本模块可能被排
 *          在 engine_core.js 之前，故采取惰性解析 + 轮询（见 resolveEngine 注释）。
 *
 * ── 非 API 部分（标准 DOM，不属于开放 API） ───────────────────────────
 *   - document.addEventListener('contextmenu'/'click', fn, true)：捕获阶段监听。
 *     引擎的同类监听挂在 document.body 冒泡阶段，捕获必然先于冒泡，故可接管。
 *   - document.getElementById / querySelector / getComputedStyle：元素兜底与可见性判定。
 *   - 运行时补齐：骨架的 .context-menu-backdrop 只有 class 没有 id，导致
 *     elements.contextMenuBackdrop 为 null、toggleContextMenu() 告警返回；
 *     本模块补 id 并回填，属运行时修复，未改动 page-chrome.js 源文件。
 */
(function () {
    'use strict';

    /* ── 可调整开关 ───────────────────────────────────────── */
    var CONFIG = {
        menuWhenHidden: true,    // 已隐藏时再次右键是否改为呼出上下文菜单
        restoreOnLeft: true,     // 由右键隐藏后，左键是否恢复（并阻断本次推进）
        hideNameBox: true,       // 隐藏时是否连人物名片（name-box）一并隐藏
        stopAutoOnHide: true,    // 隐藏时是否顺带停止 AUTO / SKIP 自动推进
        bootRetryMs: 2500        // 引擎对象最长探测时长（毫秒）
    };

    /* ── 运行期状态 ───────────────────────────────────────── */
    var engine = null;             // 2 gameEngine 引用（延迟解析，见 resolveEngine）
    var hiddenByRight = false;     // 当前隐藏是否由本模块的右键触发（[msgoff] 隐藏时为 false）
    var snapshotHtml = null;       // 隐藏前已打印的文字（innerHTML）
    var snapshotNodes = null;      // 隐藏前各节点的 display，用于对称还原
    var internalCall = false;      // 重入保护：区分引擎自身调用与本模块调用
    var installed = false;         // 事件挂接幂等标志
    var wrapped = false;           // 方法包装幂等标志

    /* ── 基础工具 ─────────────────────────────────────────── */

    function win() { return typeof window !== 'undefined' ? window : null; }

    /**
     * 解析 gameEngine。
     * 引擎在 engine_core.js 中以顶层 `const gameEngine = {...}` 声明，顶层 const 只进入
     * 全局词法环境、不会挂到 window 上，因此必须按以下顺序探测：
     *   ① 裸标识符（本文件排在 engine_core.js 之后时命中）
     *   ② window 属性（个别构建方式 / 后续版本改写时命中）
     * 本文件若排在 engine_core.js 之前，① 会命中 TDZ 并抛 ReferenceError，此处吞掉，
     * 交由事件触发时的重新解析与启动轮询补齐。
     * 对应 API.html 18 注意事项「加载顺序敏感」：文档要求「在引擎清单与 macro 脚本之后
     * 访问 gameEngine」，而本模块可能被排在 engine_core.js 之前，故不能一次性取用。
     * 判定就绪与否用的是 6 hideTextBox 是否存在（2 gameEngine 的核心方法之一）。
     */
    function resolveEngine() {
        try {
            if (typeof gameEngine !== 'undefined' && gameEngine &&
                typeof gameEngine.hideTextBox === 'function') return gameEngine;
        } catch (err) { /* TDZ / 未装载：静默 */ }
        var w = win();
        if (w && w.gameEngine && typeof w.gameEngine.hideTextBox === 'function') return w.gameEngine;
        return null;
    }

    /** 取得引擎引用（惰性解析，每次调用都重试，直到成功）—— 2 gameEngine */
    function eng() {
        if (!engine) engine = resolveEngine();
        return engine;
    }

    /** 取得 gameEngine.elements（2 gameEngine.elements —— DOM 引用） */
    function els() {
        var e = eng();
        return e && e.elements ? e.elements : null;
    }

    /** 节点当前是否可见（内联样式优先，回落到计算样式，避免只认 style.display） */
    function shown(node) {
        if (!node) return false;
        if (node.style && node.style.display === 'none') return false;
        var w = win();
        if (w && typeof w.getComputedStyle === 'function' && node.ownerDocument) {
            try { return w.getComputedStyle(node).display !== 'none'; } catch (err) { /* 回落 */ }
        }
        return true;
    }

    /* ── 元素与状态判定 ───────────────────────────────────── */

    /**
     * 是否处于剧本页（scenes 目录内且骨架已构建）。
     * API：5 gameEngine.isInScenesFolder()；2 gameEngine.elements（骨架由 16 PageChrome 创建）。
     */
    function isScenePage() {
        var e = eng();
        if (!e) return false;
        if (typeof e.isInScenesFolder === 'function' && !e.isInScenesFolder()) return false;
        var el = els();
        if (!el) return false;
        return !!(el.textContainer || el.novelModeContainer);
    }

    /** 是否全屏小说模式。API：2 gameEngine.state.novelMode */
    function isNovel() {
        var e = eng();
        return !!(e && e.state && e.state.novelMode);
    }

    /**
     * 引擎侧是否允许呼出上下文菜单。
     * API：2 gameEngine.isContextMenuEnabled()（按页面类型收敛：剧本页可用 / 非剧本页隐藏）。
     * 引擎未提供该方法时回退为 true —— 本模块本身已限定只在剧本页生效。
     */
    function menuAllowed() {
        var e = eng();
        if (!e) return false;
        if (typeof e.isContextMenuEnabled === 'function') return !!e.isContextMenuEnabled();
        return true;
    }

    /**
     * 主容器：小说模式为 novel-mode-container（遮罩层），普通模式为 text-box-container。
     * API：2 gameEngine.elements.novelModeContainer / .textContainer
     *     （小说模式的显示值 flex 与 6 setNovelMode 保持一致）
     */
    function primaryEl() {
        var el = els();
        if (!el) return null;
        if (isNovel()) return el.novelModeContainer || el.textContainer;
        return el.textContainer;
    }

    /** 正文节点：小说模式为 novel-text-box，普通模式为 text-box。API：2 gameEngine.elements */
    function textEl() {
        var el = els();
        if (!el) return null;
        if (isNovel()) return el.novelTextBox || el.textBox;
        return el.textBox;
    }

    /**
     * 需要一并隐藏的附属节点（人物名片）。
     * API：2 gameEngine.elements.nameBox（姓名框）；缺失时回落标准 DOM getElementById。
     * 官方骨架（16 PageChrome）里 name-box 位于 text-box-container 内部，随父级一起隐藏；
     * 自定义页面可能把名片放在容器之外，此处显式纳入，保证隐藏 / 恢复集合完全对称。
     */
    function extraEls() {
        var out = [];
        if (!CONFIG.hideNameBox) return out;
        var el = els();
        if (!el) return out;
        var nb = el.nameBox;
        if (!nb) {
            var d = typeof document !== 'undefined' ? document : null;
            nb = d ? d.getElementById('name-box') : null;
        }
        var p = primaryEl();
        if (nb && (!p || (typeof p.contains === 'function' ? !p.contains(nb) : true))) out.push(nb);
        return out;
    }

    /** 隐藏 / 恢复的完整节点集合（主容器 + 附属节点） */
    function targetEls() {
        var list = [];
        var p = primaryEl();
        if (p) list.push(p);
        var ex = extraEls();
        for (var i = 0; i < ex.length; i++) list.push(ex[i]);
        return list;
    }

    /**
     * 上下文菜单是否正在显示。
     * API：2 gameEngine.elements.contextMenu；其 show 类由 3 toggleContextMenu() 维护。
     */
    function menuVisible() {
        var el = els();
        var m = el && el.contextMenu;
        return !!(m && m.classList && m.classList.contains('show'));
    }

    /**
     * 存在覆盖层时不介入：日志 / 帮助浮层，以及视频播放（右键为其「跳过视频」专用）。
     * API：2 gameEngine.elements.videoPlayer；两个浮层用标准 DOM getElementById 判定。
     */
    function overlayBusy() {
        if (typeof document === 'undefined') return true;
        var log = document.getElementById('log-overlay');
        if (log && log.style.display === 'flex') return true;
        var help = document.getElementById('help-overlay');
        if (help && help.style.display === 'flex') return true;
        var el = els();
        var vp = el && el.videoPlayer;
        if (vp && vp.style && vp.style.display === 'block') return true;
        return false;
    }

    /** 点在底栏按钮 / 菜单 / 链接上时让位，避免吞掉系统 UI 的点击 */
    function inUiChrome(target) {
        if (!target || typeof target.closest !== 'function') return false;
        return !!target.closest('#galgame-ui-menu, #context-menu, button, a');
    }

    /**
     * 补齐右键菜单遮罩层的元素引用。
     * API：2 gameEngine.elements.contextMenuBackdrop；3 toggleContextMenu() 依赖它。
     * 16 PageChrome 生成的 .context-menu-backdrop 只有 class 没有 id，而引擎按
     * getElementById('context-menu-backdrop') 取元素；缺失时在此补一次映射，
     * 使公开的 toggleContextMenu() 可用（属运行时补齐，不改动源文件）。
     */
    function ensureBackdrop() {
        var el = els();
        if (!el) return null;
        if (!el.contextMenuBackdrop && typeof document !== 'undefined') {
            var b = document.querySelector('.context-menu-backdrop');
            if (b) {
                if (!b.id) b.id = 'context-menu-backdrop';
                el.contextMenuBackdrop = b;
            }
        }
        return el.contextMenuBackdrop || null;
    }

    /* ── 行为实现 ─────────────────────────────────────────── */

    /**
     * 隐藏前先把打字机补完，保证恢复出来的是「这一行的完整文字」而不是半句。
     * 逻辑与引擎点击补全一致：清定时器 → 拼接已展开分段 → 写回 → 复位音频分段。
     *
     * API：
     *   2 gameEngine.state.typingTimerId / typingActive（定时器与运行标志）
     *   2 gameEngine.state.textSegments / currentSegment（分段文本，支持 [s]）
     *   2 gameEngine.state.currentLine（无分段时用于回读原文）
     *   2 gameEngine.state.textFullyDisplayed / audioSegments / currentAudioSegment（音频分段 [a]）
     *   2 gameEngine.sceneData（story[currentLine].text 原文）
     *   6 gameEngine.processLineBreaks(text)（回读原文时把换行标记统一为 <br>）
     */
    function finishTyping() {
        var e = eng();
        var st = e && e.state;
        if (!st || !st.typingActive) return;
        if (st.typingTimerId != null) {
            clearTimeout(st.typingTimerId);
            st.typingTimerId = null;
        }
        st.typingActive = false;
        st.textFullyDisplayed = true;

        var t = textEl();
        if (!t) return;
        var full = '';
        if (st.textSegments) {
            for (var i = 0; i <= st.currentSegment; i++) full += st.textSegments[i];
        } else {
            var story = e.sceneData && e.sceneData.story;
            var line = story ? story[st.currentLine] : null;
            if (line && line.text) {
                full = (typeof e.processLineBreaks === 'function')
                    ? e.processLineBreaks(line.text)
                    : line.text;
            }
        }
        t.innerHTML = full;
        st.audioSegments = null;
        st.currentAudioSegment = 0;
    }

    /**
     * 停止 AUTO / SKIP 自动推进（探测式调用，命中不到即静默）。
     * API：11 systemModule.stopAllAutoSkipModes()；按 18「宿主能力可选」的精神，
     *      对象缺失时不视为错误（相关状态见 2 state.skipMode / fastForwardActive）。
     */
    function stopAutoSkip() {
        if (!CONFIG.stopAutoOnHide) return;
        var w = win();
        var cands = [eng(), w, w && w.GalgameUI, w && w.galgameUI, w && w.systemModule, w && w.SystemModule];
        for (var i = 0; i < cands.length; i++) {
            var o = cands[i];
            try {
                if (o && typeof o.stopAllAutoSkipModes === 'function') { o.stopAllAutoSkipModes(); return; }
            } catch (err) { /* 忽略 */ }
        }
    }

    /**
     * 右键第一步：隐藏主容器与名片，并记录隐藏前的文字与各节点 display。
     * API：6 gameEngine.hideTextBox()（普通模式主容器）；
     *      小说模式无对应 API，直接切 display，取值与 6 setNovelMode 的 flex 对称。
     */
    function hideByRight() {
        var e = eng();
        finishTyping();
        var t = textEl();
        snapshotHtml = t ? t.innerHTML : null;

        var set = targetEls();
        snapshotNodes = [];
        internalCall = true;
        try {
            for (var i = 0; i < set.length; i++) {
                var n = set[i];
                snapshotNodes.push({ node: n, display: n.style.display });
                /* 普通模式的主容器走公开 API；小说模式与名片直接切 display */
                if (n === primaryEl() && !isNovel() && e && typeof e.hideTextBox === 'function') {
                    e.hideTextBox();
                } else {
                    n.style.display = 'none';
                }
            }
        } finally {
            internalCall = false;
        }
        hiddenByRight = true;
        stopAutoSkip();
    }

    /**
     * 恢复：还原主容器、名片与隐藏前已打印的文字。
     * API：6 gameEngine.showTextBox()（普通模式主容器；小说模式按快照原值还原）。
     * @param {boolean} keepText true 写回隐藏前的文字；false 仅还原显示（用于剧情已推进的场景）
     * @returns {boolean} 是否实际执行了恢复
     */
    function restore(keepText) {
        if (!hiddenByRight) return false;
        hiddenByRight = false;

        var e = eng();
        var p = primaryEl();
        internalCall = true;
        try {
            var list = snapshotNodes || [];
            for (var i = 0; i < list.length; i++) {
                var s = list[i];
                if (!s.node) continue;
                if (s.node === p && !isNovel() && e && typeof e.showTextBox === 'function') {
                    e.showTextBox();          // 普通模式主容器走公开 API
                } else {
                    s.node.style.display = s.display;  // 对称还原到隐藏前的原值
                }
            }
            if (keepText && snapshotHtml != null) {
                var t = textEl();
                if (t) t.innerHTML = snapshotHtml;
            }
        } finally {
            internalCall = false;
        }
        snapshotNodes = null;
        snapshotHtml = null;
        return true;
    }

    /** 左键恢复：连同文字一起还原 */
    function restoreByLeft() { return restore(true); }

    /** 作废隐藏态：只还原显示，不写回旧文字（用于剧情推进 / 模式切换等边界） */
    function abortHide() { return restore(false); }

    /* ── 事件处理（捕获阶段，先于引擎的 body 冒泡监听） ────── */

    /**
     * 右键三态循环（捕获阶段）。
     * API：3 gameEngine.toggleContextMenu()（呼出 / 收起上下文菜单）；
     *      2 gameEngine.state.choicesActive（选项激活时让位，避免锁死选项）；
     *      5 gameEngine.isInScenesFolder()（只在剧本页生效）。
     */
    function onContextMenu(e) {
        if (!eng()) return;
        if (!isScenePage() || overlayBusy()) return;
        var st = eng().state;
        if (st && st.choicesActive) return;    // 选项激活时让位，避免锁死选项

        /* 接管右键：屏蔽浏览器菜单，并阻止引擎默认的「一律呼出菜单」逻辑 */
        e.preventDefault();
        e.stopPropagation();

        if (menuVisible()) {                   // 已调出上下文菜单 → 隐藏上下文菜单
            eng().toggleContextMenu();
            return;
        }
        if (shown(primaryEl())) {              // 文本框显示 → 隐藏文本框（含名片 / 遮罩层与文字）
            hideByRight();
            return;
        }
        if (CONFIG.menuWhenHidden && menuAllowed() && ensureBackdrop() && els().contextMenu) {
            eng().toggleContextMenu();         // 文本框已隐藏 → 调出上下文菜单
        }
    }

    /**
     * 左键恢复（捕获阶段）：还原显示与文字，并吞掉本次点击使引擎不推进剧情。
     * API：6 gameEngine.isOptionElement(element)（点在选项上时让位）；
     *      2 gameEngine.state.choicesActive；5 gameEngine.isInScenesFolder()。
     */
    function onClickCapture(e) {
        if (!CONFIG.restoreOnLeft || !hiddenByRight || !eng()) return;
        if (!isScenePage() || overlayBusy()) return;
        if (e.button !== 0) return;                 // 只认左键
        if (menuVisible()) return;                  // 菜单展开时交给遮罩的关闭逻辑
        if (eng().state && eng().state.choicesActive) return;
        if (inUiChrome(e.target)) return;
        if (typeof eng().isOptionElement === 'function' && eng().isOptionElement(e.target)) return;

        /* 恢复并吞掉本次点击，使引擎的 body 监听收不到事件 → 不推进剧情 */
        if (restoreByLeft()) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        }
    }

    /**
     * 挂接事件监听（标准 DOM，非开放 API）。
     * 捕获阶段挂在 document；引擎的 click / contextmenu 监听挂在 document.body 的冒泡阶段，
     * 捕获必然先于冒泡，因此本模块能先接管并按需 stopPropagation 吞掉事件。
     */
    function install() {
        if (installed || typeof document === 'undefined') return;
        installed = true;
        document.addEventListener('contextmenu', onContextMenu, true);
        document.addEventListener('click', onClickCapture, true);
    }

    /* ── 通过包装公开方法修改既有逻辑（不改动源文件） ──────── */

    /**
     * 包装 gameEngine 上的公开方法：外部（剧本指令 / 引擎内部）调用时同步本模块状态，
     * 本模块自身发起的调用（internalCall）跳过，避免自相抵消。
     */
    function wrap(name, onExternalCall) {
        var e = eng();
        var orig = e && e[name];
        if (typeof orig !== 'function') return;
        e[name] = function () {
            if (!internalCall) {
                try { onExternalCall.apply(null, arguments); }
                catch (err) { /* 状态同步失败不得影响原方法 */ }
            }
            return orig.apply(this, arguments);
        };
    }

    function applyWraps() {
        if (wrapped || !eng()) return;
        wrapped = true;
        /* [msgoff] / 空文本行等由引擎侧隐藏时，不能算作「右键隐藏」，左键不得恢复
           —— 6 gameEngine.hideTextBox() */
        wrap('hideTextBox', function () { abortHide(); });
        /* [msgon] / 下一句对白由引擎侧恢复时，清除本模块的隐藏态
           —— 6 gameEngine.showTextBox() */
        wrap('showTextBox', function () { abortHide(); });
        /* msg on / msg off 统一入口：无论如何都重置隐藏态
           —— 6 gameEngine.setWindowMode(visible) */
        wrap('setWindowMode', function () { abortHide(); });
        /* 进出全屏小说模式会切换容器，隐藏态一并作废
           —— 6 gameEngine.setNovelMode(enabled) */
        wrap('setNovelMode', function () { abortHide(); });
        /* 隐藏期间若发生推进，自动还原显示且不写回旧文字，避免文字与行号错位
           —— 5 gameEngine.displayLine(index) / nextLine() */
        wrap('displayLine', function () { abortHide(); });
        wrap('nextLine', function () { abortHide(); });
    }

    /* ── 启动：本文件可能早于引擎装载，故全程惰性 + 轮询 ─────
     * 事件监听在装载时立即挂接（不依赖引擎对象）；只有「包装 5 / 6 方法」需要等引擎出现。
     */

    function boot() {
        if (!eng()) return false;
        applyWraps();
        install();
        return true;
    }

    var delays = [0, 16, 32, 64, 128, 256, 512, 1000, 1600, 2500];
    var idx = 0;
    function tick() {
        if (boot()) return;
        if (idx >= delays.length) return;
        var d = delays[idx++];
        setTimeout(tick, d);
    }

    install();   // 事件即时挂接；处理函数内部会惰性解析引擎
    tick();

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { boot(); });
        } else {
            boot();
        }
    }
    var w0 = win();
    if (w0 && typeof w0.addEventListener === 'function') {
        w0.addEventListener('load', function () { boot(); });
    }

    /* ── 对外样例 API：供剧本 / 其它扩展调用 ────────────────
     * 说明：以下 window.ShioriRightClickHide 是**本模块自定义**的扩展入口，
     * 并非 API.html 收录的引擎 API；它内部转调上面列出的 2 / 3 / 5 / 6 / 11 接口。
     */
    var api = {
        version: '1.1.0',
        config: CONFIG,
        /** 当前是否处于「由右键隐藏」状态 */
        isHidden: function () { return hiddenByRight; },
        /** 引擎是否已解析到（排查装载顺序问题时可用） */
        isReady: function () { return !!eng(); },
        /** 以右键同等方式隐藏（可见时才生效） */
        hide: function () { if (isScenePage() && shown(primaryEl())) hideByRight(); },
        /** 以左键同等方式恢复；返回是否实际恢复 */
        restore: function () { return restoreByLeft(); },
        /** 放弃隐藏态：只还原显示，不还原文字 */
        abort: function () { return abortHide(); }
    };
    var w = win();
    if (w) w.ShioriRightClickHide = api;
})();
