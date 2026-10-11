/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 剧本页容器骨架（数据驱动）。
 *
 *   1. **数据源与显示分离**：容器清单 / 菜单条目 / 提示行来自 `ui/ui_layout.js`，
 *      引擎侧只保留一个通用渲染器。增删界面元素不需要改这个文件。
 *   2. **逐元素幂等补齐**：每个容器独立 ensure —— 不存在就建，存在就**收养**
 *      （先读后补，不覆盖页面自己写的属性）。
 *   3. **单项失败降级**：任何一项创建失败只跳过该项并写日志，不中断整块构建。
 *   4. **关键样式内联**：定位 / 尺寸 / 可见性写进内联 style，即使 style.css 404，
 *      UI 也「可见且位置正确」，只是观感劣化。
 *   5. **诊断入口**：diagnoseChrome() 返回缺失清单，把「加载不出来」变成可定位问题。
 */
const PageChrome = (() => {
    'use strict';

    /** 幂等标志：全部容器补齐后置位；任何一次构建里出现缺项都不置位，允许下次重入 */
    let built = false;

    /**
     * UI 状态：DOM 只是这份状态的投影。
     * 目前只有「右键菜单是否展开」，后续新增的可见性 / 尺寸同样挂这里，
     * 保证 rebuildSceneChrome() 之后状态不丢。
     */
    const chromeState = { menuOpen: false };

    /** DOM 快捷查找函数 */
    const byId = (id) => document.getElementById(id);

    /** debug 构建判定：宿主注入 __SHIORI_DEBUG_BUILD（C# 端），浏览器直开回退 ?debug=1 */
    const IS_DEBUG_BUILD = (() => {
        try {
            if (typeof window.__SHIORI_DEBUG_BUILD === 'boolean') return window.__SHIORI_DEBUG_BUILD;
            return new URLSearchParams(window.location.search).get('debug') === '1';
        } catch (e) { return false; }
    })();

    /** 内置兜底布局：ui_layout.js 未加载 / 被作者写坏时仍能建出完整骨架 */
    const FALLBACK_LAYOUT = {
        containers: [
            { id: 'background-container', style: 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;' },
            { id: 'character-container', style: 'position:absolute;bottom:0;left:0;width:100%;height:75%;pointer-events:none;z-index:1;' },
            {
                id: 'text-box-container',
                style: 'position:absolute;bottom:0;left:0;width:100%;display:flex;flex-direction:column;z-index:2;',
                children: [
                    // 说话人小头像：文本框内部，随文本框一起隐藏
                    {
                        id: 'speaker-avatar',
                        style: 'position:absolute;bottom:0;left:0;display:none;pointer-events:none;'
                    },
                    { id: 'name-box', children: [{ tag: 'span', text: '[姓名]' }] },
                    { id: 'text-box', text: '[文本]' }
                ]
            },
            { id: 'options-container', style: 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:none;z-index:15;' },
            {
                id: 'novel-mode-container',
                style: 'position:fixed;top:0;left:0;width:100%;height:100%;display:none;justify-content:center;align-items:center;z-index:50;',
                children: [{ id: 'novel-text-box', text: '[全屏文本]' }]
            },
            { id: 'bgm-player', tag: 'audio', props: { loop: true } },
            { id: 'se-player', tag: 'audio' },
            { id: 'voice-player', tag: 'audio' },
            {
                id: 'video-player',
                style: 'display:none;position:absolute;top:0;left:0;width:100%;height:100%;z-index:100;background-color:black;',
                children: [{
                    id: 'main-video', tag: 'video', props: { controls: true },
                    style: 'width:100%;height:100%;object-fit:contain;', text: '您的浏览器不支持视频播放。'
                }]
            },
            {
                id: 'context-menu-backdrop', cls: 'context-menu-backdrop',
                style: 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;display:none;'
            },
            {
                id: 'context-menu', cls: 'context-menu', attr: { 'data-ui': 'ctx_panel' },
                style: 'position:fixed;top:0;height:100vh;z-index:9999;display:flex;flex-direction:column;justify-content:center;',
                menu: true
            }
        ],
        menu: [
            { label: '保存存档 (F5)', onclick: 'QuickSaveManager.quickSave()' },
            { label: '存档页面', onclick: 'QuickSaveManager.openArchivePage()' },
            { label: '进度管理', onclick: "gameEngine.saveStateSnapshot(); window.location.href='../html/saves.html'" },
            { label: '剧本流程图', onclick: "window.location.href='../html/flowchart.html'" },
            { label: '返回标题页面', onclick: "window.location.href='../index.html'" }
        ],
        hints: [
            { text: 'F1 - 调试面板', debugOnly: true },
            { text: 'F5 - 快速保存' },
            { text: 'Ctrl - 快进模式' },
            { text: '+ / ↑ 增加音量 | - / ↓ 减少音量' }
        ],
        hintStyle: 'padding-top:15px;' +
            'color:rgba(255,215,0,0.6);font-size:12px;line-height:1.8;text-align:center;',
        sepStyle: 'height:0;margin-top:20px;border-top:1px solid rgba(255,215,0,0.3);'
    };

    /** 取当前生效的布局表（ui_layout.js → 内置兜底） */
    function layout() {
        const L = (typeof window !== 'undefined') ? window.SHIORI_UI_LAYOUT : null;
        if (L && typeof L === 'object' && Array.isArray(L.containers) && L.containers.length) return L;
        return FALLBACK_LAYOUT;
    }

    /** 生成 DOM 元素的快捷函数 */
    function el(tag, attrs) {
        const node = document.createElement(tag || 'div');
        if (!attrs) return node;
        Object.keys(attrs).forEach((key) => {
            const val = attrs[key];
            if (val == null) return;
            if (key === 'text') node.textContent = val;
            else node.setAttribute(key, val);
        });
        return node;
    }

    /**
     * 解析内联样式串并按「只补缺」的方式写入节点。
     * 收养已有元素时不能直接覆盖 style.cssText —— 那会抹掉页面自己写的位置 / 皮肤变量。
     * @param {HTMLElement} node 目标节点
     * @param {string} css 形如 'position:absolute;top:0;' 的样式串
     * @returns {void}
     */
    function fillStyle(node, css) {
        if (!node || !node.style || typeof css !== 'string' || !css) return;
        css.split(';').forEach((decl) => {
            const idx = decl.indexOf(':');
            if (idx <= 0) return;
            const prop = decl.slice(0, idx).trim();
            const value = decl.slice(idx + 1).trim();
            if (!prop || !value) return;
            // 已有同属性（内联或由页面显式设置）则不覆盖
            if (node.style.getPropertyValue(prop)) return;
            try { node.style.setProperty(prop, value); } catch (e) { /* 非法属性，忽略 */ }
        });
    }

    /** 追加 class（不覆盖已有） */
    function fillClass(node, cls) {
        if (!node || !cls) return;
        String(cls).split(/\s+/).forEach((c) => {
            if (c && !node.classList.contains(c)) node.classList.add(c);
        });
    }

    /** 追加属性（不覆盖已有） */
    function fillAttr(node, attr) {
        if (!node || !attr) return;
        Object.keys(attr).forEach((k) => {
            if (attr[k] == null) return;
            if (!node.hasAttribute(k)) node.setAttribute(k, attr[k]);
        });
    }

    /**
     * 幂等创建一个容器（含子节点）。
     * 已存在的元素走「收养」路径：只补缺失的 class / 属性 / 内联样式，不覆盖。
     * @param {object} spec 布局条目
     * @param {HTMLElement} parent 父节点
     * @returns {HTMLElement|null} 节点；创建失败返回 null（不抛出）
     */
    function ensureNode(spec, parent) {
        if (!spec || !parent) return null;
        try {
            let node = spec.id ? byId(spec.id) : null;
            if (!node && spec.cls) {
                try { node = document.querySelector('.' + String(spec.cls).split(/\s+/)[0]); } catch (e) { node = null; }
            }
            if (!node) {
                node = el(spec.tag || 'div', null);
                if (spec.id) node.id = spec.id;
                parent.appendChild(node);
            } else if (node.parentNode !== parent && parent === document.body) {
                // 已存在于其他父节点：尊重作者结构，不搬动
            }
            fillClass(node, spec.cls);
            fillAttr(node, spec.attr);
            fillStyle(node, spec.style);
            if (spec.props) {
                Object.keys(spec.props).forEach((k) => {
                    try { node[k] = spec.props[k]; } catch (e) { /* 只读属性，忽略 */ }
                });
            }
            if (spec.text != null && !node.textContent) node.textContent = spec.text;
            (spec.children || []).forEach((child) => ensureNode(child, node));
            return node;
        } catch (e) {
            log('容器构建失败: ' + (spec && spec.id ? spec.id : '?'), e);
            return null;
        }
    }

    /** 统一日志出口（diagnoseChrome 会把 warn 收集起来） */
    const issues = [];
    function log(msg, err) {
        issues.push(msg);
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[PageChrome] ' + msg, err || '');
        }
    }

    /**
     * 重建右键菜单的 ul / 提示区（幂等：先摘掉上次生成的节点，再重建）。
     * 单独重建这两块的原因：它们的子项数量由数据表决定，且 `file://` 下引擎会
     * 对个别条目做 display:none，不能简单「有就不建」。
     * @param {HTMLElement} menu 面板节点
     * @param {object} L 布局表
     * @returns {void}
     */
    function buildMenu(menu, L) {
        if (!menu) return;
        try {
            // 幂等清理：把上一次生成的全部子节点摘掉（ul / sep / hints 都带 data-ui-gen）
            let olds = [];
            try {
                olds = Array.prototype.slice.call(menu.querySelectorAll('[data-ui-gen="1"]'));
            } catch (e) { olds = []; }
            olds.forEach((n) => { if (n && n.parentNode) n.parentNode.removeChild(n); });

            const items = api.menuItems || L.menu || [];
            const ul = document.createElement('ul');
            ul.setAttribute('data-ui-gen', '1');
            items.forEach((item) => {
                try {
                    ul.appendChild(el('li', {
                        onclick: item.onclick,
                        text: item.label,
                        'data-ui': item.ui || 'ctx_item'
                    }));
                } catch (e) { log('菜单项创建失败: ' + (item && item.label), e); }
            });
            menu.appendChild(ul);

            // 分隔线：独立元素，便于单独换肤（ctx_sep）。
            // 间距由 sep 的 margin-top 与提示区的 padding-top 共同构成。
            try {
                const sep = el('div', {
                    'data-ui': 'ctx_sep',
                    style: L.sepStyle || FALLBACK_LAYOUT.sepStyle
                });
                sep.setAttribute('data-ui-gen', '1');
                menu.appendChild(sep);
            } catch (e) { log('菜单分隔线创建失败', e); }

            const hints = el('div', {
                'data-ui': 'ctx_hint',
                style: L.hintStyle || FALLBACK_LAYOUT.hintStyle
            });
            hints.setAttribute('data-ui-gen', '1');
            (L.hints || []).forEach((line) => {
                if (!line) return;
                if (line.debugOnly && !IS_DEBUG_BUILD) return;
                try { hints.appendChild(el('div', { text: line.text })); } catch (e) { /* 跳过该项 */ }
            });
            menu.appendChild(hints);
        } catch (e) {
            log('右键菜单构建失败', e);
        }
    }

    /**
     * 构建 / 补齐剧本页容器骨架（幂等，可随时重入）。
     * @returns {boolean} 全部必需容器均已就位时返回 true
     */
    function buildSceneChrome() {
        if (typeof document === 'undefined') return false;
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', buildSceneChrome);
            return false;
        }
        const L = layout();
        const missingBefore = issues.length;
        (L.containers || []).forEach((spec) => {
            const node = ensureNode(spec, document.body);
            if (spec && spec.menu) buildMenu(node, L);
        });
        // 把本次新产生的诊断信息送给重试闭环
        if (issues.length > missingBefore && typeof window !== 'undefined') {
            window.__SHIORI_CHROME_ISSUES = issues.slice();
        }
        built = diagnoseChrome().length === 0;
        return built;
    }

    /**
     * 诊断入口：返回当前缺失的容器 id 清单。
     * 把「UI 加载不出来」从主观感受变成可断言的数据。
     * @returns {string[]} 缺失的 id 列表；空数组表示骨架完整
     */
    function diagnoseChrome() {
        const L = layout();
        const miss = [];
        (L.containers || []).forEach((spec) => {
            if (!spec || !spec.id) return;
            try {
                if (!byId(spec.id)) miss.push(spec.id);
            } catch (e) { miss.push(spec.id); }
        });
        return miss;
    }

    /** 模块对外 API */
    const api = {
        buildSceneChrome() { return buildSceneChrome(); },
        /** 别名：语义上更贴近「补齐」，供 cacheElements 前调用 */
        ensureChrome() { return buildSceneChrome(); },
        /** 全量重建（先清诊断状态再补齐），不销毁作者已写的节点，并回放 UI 状态 */
        rebuildSceneChrome() {
            issues.length = 0;
            const ok = buildSceneChrome();
            applyChromeState();
            return ok;
        },
        diagnoseChrome,
        /** 返回本次会话内累积的构建问题（供日志浮层展示） */
        issues() { return issues.slice(); },
        /** UI 状态快照（状态存这里，DOM 只是投影） */
        getChromeState() { return Object.assign({}, chromeState); },
        /** 设置右键菜单展开态；内部会同步到 DOM */
        setMenuOpen(open) { chromeState.menuOpen = !!open; applyChromeState(); },
        byId,
        layer(name) { return byId(name); },
        menuItems: null
    };

    /**
     * 把 chromeState 投影到 DOM。
     * 重建后调用它即可恢复「菜单展开 / 遮罩可见」等状态，不需要重建方知道细节。
     * 只碰 class 与 display，不改其它属性。
     * @returns {void}
     */
    function applyChromeState() {
        try {
            const menu = byId('context-menu');
            const backdrop = byId('context-menu-backdrop');
            if (menu) {
                if (chromeState.menuOpen) menu.classList.add('show');
                else menu.classList.remove('show');
            }
            if (backdrop) backdrop.style.display = chromeState.menuOpen ? 'block' : 'none';
        } catch (e) { log('UI 状态投影失败', e); }
    }

    buildSceneChrome();
    applyChromeState();
    return api;
})();
