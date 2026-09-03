/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * ---------------------------------------------------------------
 * vars.js —— Shiori 引擎变量系统（f. / sf. / tf.）
 * ---------------------------------------------------------------
 * 借鉴 KAG / kirikiri 的命名空间语义，把运行时状态分层管理：
 *   f.  游戏变量：随存档走，每局独立（存档槽内部 + 当前档镜像）
 *   sf. 系统变量：跨关、跨会话留存（独立持久区，绝不进存档槽）
 *   tf. 临时变量：关页即失（纯内存，不进存档、不进系统区）
 *
 * 使用方式：在各页面 <script> 中，必须于 engine.js / system.js 之前引入本文件：
 *   <script src="vars.js"></script>          （根目录页面）
 *   <script src="../vars.js"></script>       （scenes/、html/ 下页面）
 *
 * 之后脚本即可：
 *   VarSpace.set('f.aff_yn', 10)        // 或 VarSpace.f.aff_yn = 10
 *   VarSpace.get('f.aff_yn')
 *   VarSpace.setSF('clear', 1)             // 通关解锁；或 VarSpace.sf.clear = 1
 *   VarSpace.get('sf.clear')
 *   VarSpace.serializeF() / restoreF(obj)  // 供 saveStateSnapshot / restoreFromSnapshot 调用
 *   VarSpace.clearF()                       // 新游戏：只清 f.，保留 sf.
 *   VarSpace.resetSystem()                  // 清除所有存档（C# 启动器触发）：清掉 sf.*（含 sf.clear）
 *   VarSpace.log()                          // 在 F12 控制台打印当前 f./sf./tf. 全量
 *   VarSpace.setVerbose(false)              // 关闭自动日志（默认开启）
 * 
 * 运用在剧本中时，请务必使用JSON的数据格式，避免出现错误。
 *
 * 调试面板说明：引擎自带的 F1 调试面板只读 state.affinity，并不显示
 * VarSpace 的新变量；所有变量运算结果统一通过浏览器控制台（F12）输出。
 * 或使用F2专用调试面板
 * 可用 URL 参数 ?vlog=0 临时关闭日志，?vlog=1 强制开启。
 * 
 * 在子功能页面中清空存档并不会使 sf.clear 清零，只有在Shiori_debug.exe中使用清除全部存档时，才会将此系统变量清零（不需要更新你的启动器，使用js进行通信）。
 *
 * ===============================================================
 * 入口门禁（GATED_PAGES）
 * ---------------------------------------------------------------
 * 列表中的「功能页面」仅在 sf.clear == 1（通关一次）后才会在首页
 * 按钮中显示；否则对应入口自动隐藏（直接访问也会被重定向回首页）。
 * 该逻辑完全在 vars.js 内完成，无需改动 index.html 的按钮属性。
 * 需要新增/减少受管控页面，直接改下面的 GATED_PAGES 即可。
 * ===============================================================
 */
(function (global) {
    'use strict';

    var SF_KEY          = 'shiori_sf';            // 系统变量持久区键（localStorage）
    var S_F_RUNTIME_KEY = 'shiori_f_runtime';    // f. 运行时镜像键（sessionStorage，标签页关闭即消失）
    // 注：localStorage.shiori_f_current 已废弃 —— 改用 sessionStorage 承载 f. 镜像，
    //     避免绕过 index 直接加载剧本（saves/启动器加载文件）时旧值残留。
    var SF_DEBOUNCE = 300;                // sf 落盘防抖 (ms)
    var F_DEBOUNCE  = 150;                // f  镜像落盘防抖 (ms)

    // ★ 好感度加减动画开关（true=显示 +X/-X 飘动动画，false=关闭动画直接推进）
    // 修改此常量即可全局控制，无需改动 engine.js
    var AFFINITY_ANIM_ENABLED = true;

    // ---------- 入口门禁：受 sf.clear 管控的功能页面（相对站点根目录，小写）----------
    // 仅在「通关一次（sf.clear == 1）」后，这些页面才会在首页按钮中显示，可根据实际情况进行增减。
    var GATED_PAGES = [
        'html/bgm.html',    // BGM鉴赏
        'html/video.html',  // 视频鉴赏
        'html/cg.html',     // CG鉴赏
        'html/story.html'   // 小故事
    ];
    // 由 GATED_PAGES 派生的「文件名」集合，用于「直接访问管控页时重定向」判断
    var GATED_BASENAMES = GATED_PAGES.map(function (p) {
        var m = p.match(/([^\/\\]+)$/);
        return (m ? m[1] : p).toLowerCase();
    });

    // 三块存储（引用保持稳定，内部内容可变；切勿整体重新赋值）
    var stores = { f: {}, sf: {}, tf: {} };
    var _initialized = false;
    var _sfTimer = null, _fTimer = null;
    var memFallback = {};   // 持久化完全不可用时的兜底（仅本次会话有效）

    // ============================================================
    // 包装 window.alert 检测 C# 启动器「清除所有存档」操作
    // ---------------------------------------------------------------
    // C# 的 ClearAllSaves 用 ExecuteScriptAsync 注入 JS 直接清 localStorage，
    // 不发 postMessage；清除列表里没有 shiori_sf；且有 getItem !== null 守卫，
    // 若键不存在则不调 removeItem，导致 sf. 残留。
    //
    // 但 C# 脚本最后必定调用 alert('已清除 X 项游戏数据...')（见 MainWindow.xaml.cs:458），
    // 文本硬编码稳定。此处包装 alert：检测到「清除」+「游戏数据」关键词时，
    // 同步清空 shiori_sf 持久化键 + 内存 stores.sf，确保随后 location.reload()
    // 重新加载时 init() 从 localStorage 读到空 sf.
    // ============================================================
    (function _wrapAlert() {
        if (typeof global.alert !== 'function') return;
        var _origAlert = global.alert;
        global.alert = function (msg) {
            try {
                var s = (msg == null) ? '' : String(msg);
                var lower = s.toLowerCase();
                var hasClear = (lower.indexOf('清除') !== -1 || lower.indexOf('清空') !== -1 || lower.indexOf('clear') !== -1);
                var hasData = (lower.indexOf('游戏数据') !== -1 || lower.indexOf('存档') !== -1 || lower.indexOf('saves') !== -1);
                if (hasClear && hasData && global.localStorage) {
                    // C# 清档操作检测：同步清空 sf. 持久化键和内存
                    global.localStorage.removeItem(SF_KEY);
                    try { clearObj(stores.sf); } catch (e) {}
                    console.log('[VarSpace] alert 检测到 C# 清档信号，已同步清空 sf.* 持久化与内存');
                }
            } catch (e) { /* 忽略检测错误，不影响原生 alert */ }
            return _origAlert.apply(this, arguments);
        };
        // 静默挂载（不输出日志，避免正常刷新时干扰控制台）
    })();

    // ---------- 日志（F12 控制台输出）----------
    var _verbose = true;
    function readVerbose() {
        try {
            var p = new URLSearchParams(global.location.search);
            if (p.has('vlog')) {
                var v = String(p.get('vlog')).toLowerCase();
                return !(v === '0' || v === 'false' || v === 'off');
            }
        } catch (e) { /* 忽略 */ }
        return true; // 默认开启
    }
    function _log(tag, name, value) {
        if (!_verbose) return;
        try {
            console.log(
                '%c[VarSpace]%c ' + tag + ' %c%s%c =',
                'color:#2a7;font-weight:bold',            // [VarSpace]
                'color:inherit',                          // 空格+tag
                'color:#07a;font-weight:bold',            // 变量名
                name,
                'color:inherit',                          // " ="
                value
            );
        } catch (e) {
            console.log('[VarSpace]', tag, name, '=', value);
        }
    }

    // ---------- 存储抽象：localStorage → WebView2 桥 → 内存兜底 ----------
    function safeGet(key) {
        try {
            if (global.localStorage) {
                var v = global.localStorage.getItem(key);
                if (v !== null) return v;
            }
        } catch (e) { /* file:// 等场景可能抛错，忽略 */ }
        return (key in memFallback) ? memFallback[key] : null;
    }

    function safeSet(key, val) {
        var ok = false;
        try {
            if (global.localStorage) { global.localStorage.setItem(key, val); ok = true; }
        } catch (e) { ok = false; }
        // 可选：经 C# 宿主（shiori.exe / WebView2）落盘为本地 JSON
        if (!ok && global.chrome && global.chrome.webview) {
            try {
                global.chrome.webview.postMessage(JSON.stringify({
                    type: 'vars', action: 'save', key: key, value: val
                }));
                ok = true;
            } catch (e) { ok = false; }
        }
        if (!ok) { memFallback[key] = val; }
        return ok;
    }

    function loadJSON(key, def) {
        var s = safeGet(key);
        if (!s) return def;
        try { return JSON.parse(s); } catch (e) { return def; }
    }
    function saveJSON(key, obj) {
        try { safeSet(key, JSON.stringify(obj)); } catch (e) {}
    }

    function clearObj(o) { Object.keys(o).forEach(function (k) { delete o[k]; }); }

    function persistSF() {
        if (_sfTimer) clearTimeout(_sfTimer);
        _sfTimer = setTimeout(function () { saveJSON(SF_KEY, stores.sf); }, SF_DEBOUNCE);
    }
    // 立即落盘版本（绕过防抖）：用于 clearF / resetSystem 等需要即时生效的场景，
    // 避免宿主清档后立即刷新页面时，防抖未触发导致 localStorage 仍是旧值。
    function persistSFImmediate() {
        if (_sfTimer) { clearTimeout(_sfTimer); _sfTimer = null; }
        saveJSON(SF_KEY, stores.sf);
    }
    function persistF() {
        if (_fTimer) clearTimeout(_fTimer);
        _fTimer = setTimeout(function () {
            // f. 镜像写入 sessionStorage（标签页关闭即消失，避免跨会话残留）
            try {
                if (global.sessionStorage) {
                    global.sessionStorage.setItem(S_F_RUNTIME_KEY, JSON.stringify(stores.f));
                }
            } catch (e) { /* 忽略：file:// 等场景可能抛错 */ }
        }, F_DEBOUNCE);
    }
    // 立即落盘版本（绕过防抖）：用于 clearF / restoreF 等需要即时生效的场景。
    function persistFImmediate() {
        if (_fTimer) { clearTimeout(_fTimer); _fTimer = null; }
        try {
            if (global.sessionStorage) {
                global.sessionStorage.setItem(S_F_RUNTIME_KEY, JSON.stringify(stores.f));
            }
        } catch (e) { /* 忽略 */ }
    }

    function parseName(name) {
        if (typeof name !== 'string') return null;
        if (name.indexOf('f.')  === 0) return { ns: 'f',  key: name.slice(2) };
        if (name.indexOf('sf.') === 0) return { ns: 'sf', key: name.slice(3) };
        if (name.indexOf('tf.') === 0) return { ns: 'tf', key: name.slice(3) };
        return null;
    }

    // ---------- 命名空间 Proxy：支持 VarSpace.f.xxx = ... 这种写法 ----------
    function makeProxy(store) {
        return new Proxy({}, {
            get: function (_, k) { return (k in store) ? store[k] : undefined; },
            set: function (_, k, v) {
                store[k] = v;
                if (store === stores.f)  { _log('SET', 'f.'  + k, v); persistF(); }
                else if (store === stores.sf) { _log('SET', 'sf.' + k, v); persistSF(); }
                else { _log('SET', 'tf.' + k, v); }
                return true;
            },
            has: function (_, k) { return k in store; },
            deleteProperty: function (_, k) {
                delete store[k];
                if (store === stores.f) persistF();
                else if (store === stores.sf) persistSF();
                return true;
            }
        });
    }

    // ============================================================
    // 入口门禁（GATED_PAGES）
    // ============================================================
    function normalizeHref(href) {
        if (!href) return '';
        href = String(href).split('#')[0].split('?')[0];
        if (/^[a-z]+:\/\//i.test(href)) return '';   // 外链
        if (/^(mailto|tel|javascript):/i.test(href)) return '';
        href = href.replace(/^\.\//, '').replace(/^\//, '');
        return href.toLowerCase();
    }

    function currentPageBasename() {
        var href = global.location.href.split('#')[0].split('?')[0];
        var m = href.match(/([^\/\\]+)\.html?$/i);
        return m ? m[1].toLowerCase() + '.html' : '';
    }

    function isUnlocked() {
        return VarSpace.get('sf.clear') === 1;
    }

    /**
     * 应用入口门禁：
     *  - 隐藏/显示首页等页面里指向 GATED_PAGES 的 <a> 入口
     *  - 若当前页本身是受管控页且未解锁，重定向回首页
     * 不改动任何 HTML 的按钮属性，全部在 JS 内完成。
     */
    function applyPageGating() {
        if (typeof document === 'undefined') return;
        var unlocked = isUnlocked();

        // 1) 扫描所有 <a href>，对命中 GATED_PAGES 的入口做隐藏/显示
        var links = document.querySelectorAll('a[href]');
        if (links && links.forEach) {
            links.forEach(function (a) {
                var norm = normalizeHref(a.getAttribute('href'));
                if (GATED_PAGES.indexOf(norm) !== -1) {
                    a.style.display = unlocked ? '' : 'none';
                }
            });
        }

        // 2) 直接访问「受管控页」且未解锁 → 重定向回首页
        if (!unlocked) {
            var base = currentPageBasename();
            if (GATED_BASENAMES.indexOf(base) !== -1) {
                var back = (global.location.href.indexOf('/html/') !== -1) ? '../index.html' : 'index.html';
                console.log('[VarSpace] 入口未解锁，重定向：' + base + ' -> ' + back);
                global.location.href = back;
                return;
            }
        }

        console.log('[VarSpace] 入口门禁：unlocked=' + unlocked +
                    '，管控页 ' + (unlocked ? '显示' : '隐藏') + '（' + GATED_PAGES.length + ' 项）');
    }

    function whenReady(fn) {
        if (typeof document === 'undefined') return;
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    var VarSpace = {
        version: '1.2.0',
        f:  makeProxy(stores.f),
        sf: makeProxy(stores.sf),
        tf: makeProxy(stores.tf),

        /** 好感度加减动画是否启用（读取顶部 AFFINITY_ANIM_ENABLED 开关） */
        isAffinityAnimEnabled: function () { return AFFINITY_ANIM_ENABLED; },
        /** 运行时切换好感度动画开关（可选，供调试/设置页调用） */
        setAffinityAnimEnabled: function (v) { AFFINITY_ANIM_ENABLED = !!v; return this; },

        /** 启动时载入持久区；可在 engine.js 顶部再次调用（幂等） */
        init: function () {
            if (_initialized) return this;
            clearObj(stores.sf); Object.assign(stores.sf, loadJSON(SF_KEY, {}));

            // —— f. 入口信号检测 ——
            // 只有以下入口才继承 sessionStorage 中的 f. 运行时镜像：
            //   1. nextScene 跨文件跳转（shiori_next_scene_target）
            //   2. 存档读档（archiveLoadTarget，engine.js 会用 snapshot.fVars 覆盖恢复）
            // 其他入口（从 index 开始游戏、从启动器"加载指定文件"、直接打开 URL）一律清零，
            // 避免 WebView2 实例不关闭时 sessionStorage 跨页面残留导致 f. 误继承。
            var _shouldInheritF = false;
            try {
                if (global.sessionStorage) {
                    if (global.sessionStorage.getItem('shiori_next_scene_target') ||
                        global.sessionStorage.getItem('archiveLoadTarget')) {
                        _shouldInheritF = true;
                    }
                }
            } catch (e) { /* 忽略 */ }

            clearObj(stores.f);
            if (_shouldInheritF) {
                // 从 sessionStorage 加载 f. 镜像（nextScene 跳转或读档）
                try {
                    if (global.sessionStorage) {
                        var s = global.sessionStorage.getItem(S_F_RUNTIME_KEY);
                        if (s) Object.assign(stores.f, JSON.parse(s));
                    }
                } catch (e) { /* 忽略 */ }
            } else {
                // 无跳转信号：清除 sessionStorage 中的旧 f. 镜像，避免下次加载时被误用
                try {
                    if (global.sessionStorage) {
                        global.sessionStorage.removeItem(S_F_RUNTIME_KEY);
                    }
                } catch (e) { /* 忽略 */ }
            }

            stores.tf = {};
            _initialized = true;
            console.log('[VarSpace] initialized (verbose=' + _verbose + '). sf keys:',
                        Object.keys(stores.sf).length, ' f keys:', Object.keys(stores.f).length,
                        ' inheritF=', _shouldInheritF);
            return this;
        },

        /** 按完整名（含前缀）取值 */
        get: function (name) {
            var p = parseName(name); if (!p) return undefined;
            return (p.key in stores[p.ns]) ? stores[p.ns][p.key] : undefined;
        },
        /** 按完整名（含前缀）赋值 */
        set: function (name, value) {
            var p = parseName(name); if (!p) return false;
            stores[p.ns][p.key] = value;
            _log('SET', name, value);
            if (p.ns === 'f') persistF();
            else if (p.ns === 'sf') persistSF();
            return true;
        },
        /** 按完整名判断是否存在 */
        has: function (name) {
            var p = parseName(name); if (!p) return false;
            return p.key in stores[p.ns];
        },

        // ---- f. 与存档相关 ----
        /** 导出当前 f. 供存入存档槽（深拷贝，绝不含 sf.） */
        serializeF: function () { return JSON.parse(JSON.stringify(stores.f)); },
        /** 从存档槽还原 f.（深拷贝写入；不影响 sf.） */
        restoreF: function (obj) {
            clearObj(stores.f);
            if (obj && typeof obj === 'object') Object.assign(stores.f, obj);
            _log('RESTORE', 'f.*', stores.f);
            persistFImmediate();
        },
        /** 新游戏：只清空 f.，保留 sf. */
        clearF: function () {
            clearObj(stores.f);
            _log('CLEAR', 'f.*', {});
            persistFImmediate();
            console.log('[VarSpace] f.* cleared (sf.* preserved)');
        },
        /** 立即把 f. 写入 sessionStorage（绕过 150ms 防抖）。
         *  用于 nextScene 跨文件跳转前，确保 B 页面能读到最新的 f. 值，
         *  不依赖 beforeunload（WebView2 中 beforeunload 的 sessionStorage.setItem 可能不可靠）。 */
        flushF: function () {
            persistFImmediate();
            return this;
        },

        // ---- sf. 系统相关 ----
        getSF: function (name) { return (name in stores.sf) ? stores.sf[name] : undefined; },
        setSF: function (name, value) { stores.sf[name] = value; _log('SET', 'sf.' + name, value); persistSF(); return true; },

        /**
         * 清除所有存档时调用（由 C# 启动器「清除所有存档」经宿主消息触发，
         * 或 localStorage 被整体清空时于下次加载自动生效）：
         * 重置全部 sf.*（含 sf.clear 解锁标记）。不触动 f.*。
         */
        resetSystem: function () {
            clearObj(stores.sf);
            _log('CLEAR', 'sf.*', {});
            persistSFImmediate();
            console.log('[VarSpace] sf.* cleared（系统变量 / 解锁标记已重置）');
            return this;
        },

        /** 可选：场景脚本表达式求值（f./sf./tf. 直接可用） */
        eval: function (exp) {
            try {
                var fn = new Function('f', 'sf', 'tf', 'return (' + exp + ');');
                var r = fn(this.f, this.sf, this.tf);
                _log('EVAL', exp, r);
                return r;
            } catch (e) {
                console.error('[VarSpace.eval] failed:', exp, e);
                return undefined;
            }
        },

        /** 调试：在控制台打印当前 f./sf./tf. 全量（控制台 VarSpace.log()） */
        log: function () {
            var d = this.dump();
            console.log('%c[VarSpace] 当前变量（f=游戏变量 / sf=系统变量 / tf=临时变量）',
                        'color:#2a7;font-weight:bold');
            console.log('  f. :', JSON.parse(JSON.stringify(d.f)));
            console.log('  sf.:', JSON.parse(JSON.stringify(d.sf)));
            console.log('  tf.:', JSON.parse(JSON.stringify(d.tf)));
            return d;
        },

        /** 重新应用入口门禁（页面内 sf.clear 变化后手动刷新时调用） */
        refreshGating: function () { applyPageGating(); return this; },

        /** 开关自动日志（默认开启；URL ?vlog=0 可关） */
        setVerbose: function (v) { _verbose = !!v; return _verbose; },

        /** 调试：导出全部命名空间（对象） */
        dump: function () {
            return {
                f:  JSON.parse(JSON.stringify(stores.f)),
                sf: JSON.parse(JSON.stringify(stores.sf)),
                tf: JSON.parse(JSON.stringify(stores.tf))
            };
        },

        // ============================================================
        // 好感度 / 分支判定核心 API
        // 引擎无关的纯逻辑：apply / get / check / resolveBranch
        // engine.js 只做薄集成（调用这些 API + 视觉演出 + 跳转）
        // ============================================================

        /**
         * 应用好感度变化（写入 f.<flag>）
         * @param {string} flag - 变量名（不含 f. 前缀）
         * @param {number} add  - 变化值（正/负/零）
         * @returns {number} 变化后的值
         */
        applyAffinity: function (flag, add) {
            if (!flag || flag === '#') return undefined;
            var num = Number(add);
            if (isNaN(num)) return undefined;
            var cur = stores.f[flag] || 0;
            stores.f[flag] = cur + num;
            _log('AFFINITY', 'f.' + flag, (num >= 0 ? '+' : '') + num + ' → ' + stores.f[flag]);
            persistF();
            return stores.f[flag];
        },

        /**
         * 读取好感度变量值
         * @param {string} flag - 变量名（不含 f. 前缀）
         * @returns {number} 当前值（未定义返回 0）
         */
        getAffinity: function (flag) {
            if (!flag || flag === '#') return 0;
            return stores.f[flag] || 0;
        },

        /**
         * 判定条件表达式是否成立（走 eval）
         * @param {string} cond - 表达式（如 "f.yn >= 5"、"sf.clear == 1"）
         * @returns {boolean}
         */
        checkCondition: function (cond) {
            var r = this.eval(cond);
            return !!r;
        },

        /**
         * 解析静默分支：按序求值，首个命中即返回其 target
         * 规则（与 engine.js resolveSilentBranch 对齐）：
         *   1. c.when 存在      → 用 checkCondition(c.when) 求值
         *   2. c.flag === '#'   → 恒真（兜底，应放最后）
         *   3. c.flag 存在      → f.<flag> 真值判定（非 0 / 非空）
         *   4. 无 flag 无 when  → 视为恒真
         * 命中项若有 add，同时调用 applyAffinity
         * @param {Array} choices - 选项数组
         * @returns {string|null} 命中项的 target；全部未命中返回 null
         */
        resolveBranch: function (choices) {
            if (!choices || !choices.length) return null;
            for (var i = 0; i < choices.length; i++) {
                var c = choices[i] || {};
                var hit = false;

                if (c.when) {
                    hit = this.checkCondition(c.when);
                } else if (c.flag === '#' || c.target === '#') {
                    hit = true;
                } else if (c.flag) {
                    var v = stores.f[c.flag];
                    hit = (v !== undefined && v !== null && v !== 0 && v !== false && v !== '');
                } else {
                    hit = true;
                }

                if (hit) {
                    if (c.flag && c.flag !== '#' && c.add !== undefined && c.add !== null) {
                        this.applyAffinity(c.flag, c.add);
                    }
                    _log('BRANCH', '命中 #' + i, c.target);
                    return (c.target !== undefined && c.target !== null) ? c.target : null;
                }
            }
            _log('BRANCH', '全部未命中', null);
            return null;
        }
    };

    global.VarSpace = VarSpace;

    // 依据 URL 参数决定日志开关
    _verbose = readVerbose();

    // 页面卸载前强制落盘，避免防抖未触发导致丢失
    global.addEventListener('beforeunload', function () {
        // 检测 localStorage 是否被宿主（C# 启动器）外部清空：
        // 若 sf 键已被外部删除，不要把内存里的旧值写回（否则会覆盖宿主的清档操作）
        try {
            var sfOnDisk = global.localStorage ? global.localStorage.getItem(SF_KEY) : null;
            if (sfOnDisk === null && Object.keys(stores.sf).length > 0) {
                // localStorage 中的 sf 已被外部清空，且内存里还有值 → 宿主已清档
                // 不写回 sf.，保持 localStorage 为空
                console.log('[VarSpace] beforeunload: 检测到 localStorage.sf 已被外部清空，跳过回写');
            } else {
                saveJSON(SF_KEY, stores.sf);
            }
        } catch (e) {
            saveJSON(SF_KEY, stores.sf);
        }
        // f. 镜像写入 sessionStorage（标签页关闭即消失，避免跨会话残留）
        try {
            if (global.sessionStorage) {
                global.sessionStorage.setItem(S_F_RUNTIME_KEY, JSON.stringify(stores.f));
            }
        } catch (e) { /* 忽略 */ }
    });

    // 应用入口门禁（DOM 就绪后执行）
    whenReady(applyPageGating);

    // ============================================================
    // 与宿主（C# 启动器 / WebView2）通信：
    // 当宿主「清除所有存档」时，应经 window.chrome.webview 发送信号，
    // JS 侧据此重置 sf.*（含 sf.clear）。不改动 C# 代码。
    // 协议（宿主 -> JS，postMessage）：
    //   { "type": "clearAllSaves" }   或 { "action": "clearAllSaves" }
    //   或 { "command": "clearAllSaves" } 或 { "op": "clearAllSaves" } 或字符串 "clearAllSaves"
    // 注：若宿主直接清空了 WebView2 的 localStorage，则 sf.* 会在下次加载时自动归零，
    //     此处监听用于「页面未刷新时」即时重置并刷新首页入口显示。
    // ============================================================
    if (global.chrome && global.chrome.webview && typeof global.chrome.webview.addEventListener === 'function') {
        global.chrome.webview.addEventListener('message', function (ev) {
            var data = ev && ev.data;
            var msg = data;
            if (typeof data === 'string') {
                try { msg = JSON.parse(data); } catch (e) { msg = { raw: data }; }
            }
            // 清档信号关键词（大小写不敏感，匹配 type/action/command/op 四种字段 + 纯字符串）
            var CLEAR_KEYWORDS = ['clearallsaves', 'clearsaves', 'clearall', 'resetallsaves',
                                  'resetsaves', 'clearstorage', 'clearlocalstorage', 'reset'];
            function _matchClear(s) {
                if (!s || typeof s !== 'string') return false;
                var lower = s.toLowerCase();
                for (var i = 0; i < CLEAR_KEYWORDS.length; i++) {
                    if (lower === CLEAR_KEYWORDS[i]) return true;
                }
                return false;
            }
            var isClear = false;
            if (msg && typeof msg === 'object') {
                isClear = _matchClear(msg.type) || _matchClear(msg.action) ||
                          _matchClear(msg.command) || _matchClear(msg.op) ||
                          (msg.raw && _matchClear(msg.raw));
            } else if (typeof msg === 'string') {
                isClear = _matchClear(msg);
            }
            if (isClear) {
                // 重置 sf.*（含 sf.clear 解锁标记）
                VarSpace.resetSystem();
                // 同时清空 localStorage 中的 galgame_archives（存档槽）
                try {
                    global.localStorage.removeItem('galgame_archives');
                } catch (e) {}
                applyPageGating();
                console.log('[VarSpace] 收到宿主「清除所有存档」信号：已重置 sf.* + 清除 galgame_archives 并刷新入口显示');
            }
        });
        // 静默挂载（不输出日志，避免正常刷新时干扰控制台）
    }

    // 脚本加载即初始化（若 engine.js 顶部再次调用 init 则为幂等空操作）
    if (!_initialized) VarSpace.init();

})(window);
