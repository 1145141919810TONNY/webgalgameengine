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
 * 用命名空间把运行时状态分层管理：
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
 *   VarSpace.setSF('clear', 1)             // 通关解锁（只能置 1）；或 VarSpace.sf.clear = 1
 *   VarSpace.get('sf.clear')
 *   VarSpace.setTempAllClear(true)         // 开发者测试：置 tf.allclear，解锁全部鉴赏页；关闭传 false
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
 * sf.clear 是「通关标识」：
 *   0 只是默认初始值，剧本与插件只能把它写成 1，且置 1 后不可回退
 *   （否则玩家通关后再走一段剧情就会把解锁状态撤销）。
 *   唯一能让它回到 0 的是「清除存档」类特殊功能（重置存档 / 宿主清档信号），
 *   它们走 VarSpace.resetSystem()，直接重建 sf. 存储区，因此不受此限制。
 *
 * 在子功能页面中清空存档并不会使 sf.clear 清零，只有在Shiori_debug.exe中使用清除全部存档时，才会将此系统变量清零（不需要更新你的启动器，使用js进行通信）。
 *
 * 回放相关（tf.isReplay 家族）：
 *   tf.isReplay       回放模式开关 + 载荷：由存档页「回放」入口写承载键，剧本不可改写
 *   tf.isReplayBegin  剧本里的回放起点标记，不是真变量（解析层直接丢弃，不落值）
 *   tf.isReplayEnd    剧本里的回放终点标记，同上；正片跑到这里会解锁该回放入口
 *   回放期间 f. / sf. 的一切写入被冻结；解锁记录存 localStorage['shiori_replay_unlocked']。
 *
 * ===============================================================
 * 入口门禁（GATED_PAGES）
 * ---------------------------------------------------------------
 * 列表中的「功能页面」仅在 sf.clear == 1（通关一次）或 tf.allclear 为真
 * （开发者测试开关）后才会在首页按钮中显示；否则对应入口自动隐藏
 * （直接访问也会被重定向回首页）。
 * 该逻辑完全在 vars.js 内完成，无需改动 index.html 的按钮属性。
 * 需要新增/减少受管控页面，直接改下面的 GATED_PAGES 即可。
 * ===============================================================
 */
(function (global) {
    'use strict';

    var SF_KEY          = 'shiori_sf';            // 系统变量持久区键（localStorage）
    var S_F_RUNTIME_KEY = 'shiori_f_runtime';    // f. 运行时镜像键（sessionStorage，标签页关闭即消失）
    var TF_ALLCLEAR_KEY = 'shiori_tf_allclear';  // tf.allclear 跨页承载键（sessionStorage，标签页关闭即消失）
    var TF_ISREPLAY_KEY = 'shiori_tf_isreplay';  // tf.isReplay 承载键（sessionStorage，仅回放期间存在，抵达终点即清）
    var REPLAY_UNLOCKED_KEY = 'shiori_replay_unlocked'; // 回放解锁记录（localStorage，键 = 记录的 end 文件名）
    // 注：localStorage.shiori_f_current 已废弃 —— 改用 sessionStorage 承载 f. 镜像，
    //     避免绕过 index 直接加载剧本（saves/启动器加载文件）时旧值残留。
    var SF_DEBOUNCE = 300;                // sf 落盘防抖 (ms)
    var F_DEBOUNCE  = 150;                // f  镜像落盘防抖 (ms)

    // ★ 好感度加减动画开关（true=显示 +X/-X 飘动动画，false=关闭动画直接推进）
    // 修改此常量即可全局控制，无需改动 engine.js
    var AFFINITY_ANIM_ENABLED = true;

    // ---------- 入口门禁：受 sf.clear / tf.allclear 管控的功能页面（相对站点根目录，小写）----------
    // 仅在「通关一次（sf.clear == 1）」或「开发者测试开启（tf.allclear）」后，
    // 这些页面才会在首页按钮中显示，可根据实际情况进行增减。
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
    // 回放模式（tf.isReplay）
    // ---------------------------------------------------------------
    // 由存档页写入承载键后进入：回放只需「重看已看过的内容」，因此期间
    // 必须冻结 f. / sf. 的一切剧本写入，避免重看一遍就把好感度、通关标识
    // 之类的进度改写掉。tf. 不冻结 —— 回放本身就是靠 tf. 承载状态。
    // ============================================================

    /**
     * 是否处于回放模式（tf.isReplay 存在即为真）
     * @returns {boolean}
     */
    function isReplayMode() { return !!(stores.tf && stores.tf.isReplay); }

    /**
     * 回放期是否应丢弃这次写入（只拦 f. / sf.，tf. 放行）
     * 不产生诊断、不弹提示，只在控制台留一行，符合「运行期静默」口径。
     * @param {string} ns - 命名空间（'f' | 'sf' | 'tf'）
     * @param {string} name - 变量名
     * @returns {boolean} true = 本次写入应被丢弃
     */
    function replayBlocksWrite(ns, name) {
        if (!isReplayMode()) return false;
        if (ns !== 'f' && ns !== 'sf') return false;
        console.log('[VarSpace] 回放中，已丢弃写入 ' + ns + '.' + name);
        return true;
    }

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
                    // 回放解锁记录同属「清除所有存档」的清理范围，一并清掉
                    global.localStorage.removeItem(REPLAY_UNLOCKED_KEY);
                    try { clearObj(stores.sf); } catch (e) {}
                    console.log('[VarSpace] alert 检测到 C# 清档信号，已同步清空 sf.* 与回放解锁记录');
                }
            } catch (e) { /* 忽略检测错误，不影响原生 alert */ }
            return _origAlert.apply(this, arguments);
        };
        // 静默挂载（不输出日志，避免正常刷新时干扰控制台）
    })();

    // ---------- 日志（F12 控制台输出）----------
    var _verbose = true;
    /**
     * 读取日志开关（URL 参数 ?vlog 优先）
     * 支持的关闭取值：0 / false / off（大小写不敏感），其余任意取值均视为开启
     * @returns {boolean} 是否启用控制台日志（URL 未指定时默认 true）
     */
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
    /**
     * 输出一条带高亮样式的变量日志到 F12 控制台
     * 输出格式：[VarSpace] tag 变量名 = 值（[VarSpace] 为绿色加粗，变量名为蓝色加粗）
     * @param {string} tag - 操作标签（SET / CLEAR / RESTORE / AFFINITY / BRANCH / EVAL 等）
     * @param {string} name - 变量名（含命名空间前缀，如 'f.aff_yn'）
     * @param {*} value - 变量当前值（原样传递给 console.log 打印）
     * @returns {void} 无返回值；_verbose 关闭时静默跳过；样式输出异常时降级为纯文本
     */
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
    /**
     * 安全读取持久化数据（localStorage 优先，失败时回退内存兜底区）
     * 读取链路：localStorage → memFallback（仅当 localStorage 抛错或不可用时）
     * @param {string} key - 存储键名
     * @returns {string|null} 读取到的字符串值；键不存在或读取失败返回 null
     */
    function safeGet(key) {
        try {
            if (global.localStorage) {
                var v = global.localStorage.getItem(key);
                if (v !== null) return v;
            }
        } catch (e) { /* file:// 等场景可能抛错，忽略 */ }
        return (key in memFallback) ? memFallback[key] : null;
    }

    /**
     * 安全写入持久化数据（三级降级：localStorage → WebView2 桥 → 内存兜底）
     * 写入链路依次尝试：
     *   1. localStorage（正常浏览器 / WebView2 环境）
     *   2. chrome.webview.postMessage（C# 宿主桥接，由宿主落盘为本地 JSON 文件）
     *   3. memFallback 内存兜底（仅本次会话有效，页面刷新即丢失）
     * @param {string} key - 存储键名
     * @param {string} val - 要写入的字符串值
     * @returns {boolean} 前两级任一成功返回 true；仅落到内存兜底返回 false
     */
    function safeSet(key, val) {
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

    /**
     * 读取并反序列化 JSON 数据
     * @param {string} key - 存储键名
     * @param {*} def - 键不存在或 JSON 解析失败时返回的默认值
     * @returns {*} 解析成功返回数据对象；否则返回 def
     */
    function loadJSON(key, def) {
        var s = safeGet(key);
        if (!s) return def;
        try { return JSON.parse(s); } catch (e) { return def; }
    }
    /**
     * 序列化对象并写入持久化（经 safeSet 三级降级链路）
     * @param {string} key - 存储键名
     * @param {Object} obj - 要序列化保存的对象
     * @returns {void} 无返回值；写入异常时静默忽略（不抛出）
     */
    function saveJSON(key, obj) {
        try { safeSet(key, JSON.stringify(obj)); } catch (e) {}
    }

    /**
     * 原地清空对象的所有自有键（保持对象引用不变）
     * 用于重置命名空间内容：外部持有的引用（如 Proxy 捕获的 store）依然有效
     * @param {Object} o - 要清空的目标对象
     * @returns {void} 直接修改入参对象，无返回值
     */
    function clearObj(o) { Object.keys(o).forEach(function (k) { delete o[k]; }); }

    /**
     * 防抖落盘 sf. 系统变量到 localStorage（防抖间隔 SF_DEBOUNCE=300ms）
     * 连续多次写入只会在最后一次写入后 300ms 触发实际落盘，降低 IO 压力
     * @returns {void} 无返回值；副作用是重置内部 _sfTimer 定时器
     */
    function persistSF() {
        if (_sfTimer) clearTimeout(_sfTimer);
        _sfTimer = setTimeout(function () { saveJSON(SF_KEY, stores.sf); }, SF_DEBOUNCE);
    }
    /**
     * sf. 立即落盘版本（绕过防抖）：用于 resetSystem 等需要即时生效的场景，
     * 避免宿主清档后立即刷新页面时，防抖未触发导致 localStorage 仍是旧值。
     * @returns {void} 无返回值；副作用是取消待执行的防抖定时器并同步写入 localStorage
     */
    function persistSFImmediate() {
        if (_sfTimer) { clearTimeout(_sfTimer); _sfTimer = null; }
        saveJSON(SF_KEY, stores.sf);
    }
    /**
     * 防抖落盘 f. 镜像到 sessionStorage（防抖间隔 F_DEBOUNCE=150ms）
     * 镜像仅存于 sessionStorage：标签页关闭即消失，避免跨会话残留旧值
     * @returns {void} 无返回值；副作用是重置内部 _fTimer 定时器
     */
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
    /**
     * f. 镜像立即落盘版本（绕过防抖）
     * 用于 clearF / restoreF / flushF 等需要即时生效的场景，
     * 特别是 nextScene 跨文件跳转前必须同步写入，确保目标页面读到最新值。
     * @returns {void} 无返回值；副作用是取消待执行的防抖定时器并同步写入 sessionStorage
     */
    function persistFImmediate() {
        if (_fTimer) { clearTimeout(_fTimer); _fTimer = null; }
        try {
            if (global.sessionStorage) {
                global.sessionStorage.setItem(S_F_RUNTIME_KEY, JSON.stringify(stores.f));
            }
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 解析带命名空间前缀的完整变量名
     * 支持的前缀：f.（游戏变量）/ sf.（系统变量）/ tf.（临时变量）
     * @param {string} name - 完整变量名，如 'f.aff_yn'、'sf.clear'
     * @returns {{ns: string, key: string}|null} 解析结果对象；
     *          非字符串或前缀不属于三种命名空间时返回 null
     */
    function parseName(name) {
        if (typeof name !== 'string') return null;
        if (name.indexOf('f.')  === 0) return { ns: 'f',  key: name.slice(2) };
        if (name.indexOf('sf.') === 0) return { ns: 'sf', key: name.slice(3) };
        if (name.indexOf('tf.') === 0) return { ns: 'tf', key: name.slice(3) };
        return null;
    }

    // ---------- 命名空间 Proxy：支持 VarSpace.f.xxx = ... 这种写法 ----------
    /**
     * 为指定内部存储对象创建命名空间代理
     * 代理拦截 get / set / has / deleteProperty 四种操作，
     * 使 VarSpace.f.xxx 读写直接映射到内部 store，并在写入 / 删除时
     * 自动触发对应命名空间的控制台日志与防抖落盘（f.→sessionStorage，sf.→localStorage，tf.→仅内存）
     * @param {Object} store - 内部真实存储对象（stores.f / stores.sf / stores.tf 之一）
     * @returns {Proxy} 命名空间代理对象；对 f./sf. 的写操作自动持久化
     */
    function makeProxy(store) {
        return new Proxy({}, {
            get: function (_, k) { return (k in store) ? store[k] : undefined; },
            set: function (_, k, v) {
                // 回放期冻结 f. / sf. 的直写（插件与调试控制台走的是这条路，只拦 set/setSF 挡不住）
                if (store === stores.f  && replayBlocksWrite('f', k))  return true;
                if (store === stores.sf && replayBlocksWrite('sf', k)) return true;
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
    /**
     * 规范化超链接地址，用于与 GATED_PAGES 列表做精确匹配
     * 处理规则：去掉锚点(#)与查询串(?)、剥离 ./ 或 / 前缀、统一转小写；
     * 协议外链（http:// 等）与 mailto:/tel:/javascript: 伪协议一律返回空串（不参与门禁）
     * @param {string} href - <a> 元素的原始 href 属性值
     * @returns {string} 规范化后的相对路径；外链 / 伪协议 / 空值返回空字符串
     */
    function normalizeHref(href) {
        if (!href) return '';
        href = String(href).split('#')[0].split('?')[0];
        if (/^[a-z]+:\/\//i.test(href)) return '';   // 外链
        if (/^(mailto|tel|javascript):/i.test(href)) return '';
        href = href.replace(/^\.\//, '').replace(/^\//, '');
        return href.toLowerCase();
    }

    /**
     * 获取当前页面的文件名（统一小写，形如 'bgm.html'）
     * 用于判断「用户直接访问受管控页」的场景（与 GATED_BASENAMES 匹配）
     * @returns {string} 当前页文件名；URL 不以 .html/.htm 结尾时返回空字符串
     */
    function currentPageBasename() {
        var href = global.location.href.split('#')[0].split('?')[0];
        var m = href.match(/([^\/\\]+)\.html?$/i);
        return m ? m[1].toLowerCase() + '.html' : '';
    }

    /**
     * 判断功能页是否已解锁
     * @returns {boolean} sf.clear === 1（通关一次），或 tf.allclear 为真（开发者测试）时返回 true
     */
    function isUnlocked() {
        return VarSpace.get('sf.clear') === 1 || !!VarSpace.get('tf.allclear');
    }

    /**
     * 应用入口门禁：
     *  - 隐藏/显示首页等页面里指向 GATED_PAGES 的 <a> 入口
     *  - 若当前页本身是受管控页且未解锁，重定向回首页
     * 不改动任何 HTML 的按钮属性，全部在 JS 内完成。
     * @returns {void} 无返回值；副作用是批量修改 <a> 的 display 样式，
     *                 未解锁直访管控页时触发 location.href 重定向
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

    /**
     * DOM 就绪回调封装：loading 阶段挂 DOMContentLoaded 监听，否则立即执行
     * @param {Function} fn - DOM 就绪后要执行的回调函数
     * @returns {void} 无返回值；副作用是注册一次性事件监听或直接调用 fn
     */
    function whenReady(fn) {
        if (typeof document === 'undefined') return;
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    // ============================================================
    // 条件表达式规则
    // 条件表达式最终交给 JS 求值，因此只放行 f. / sf. / tf. 变量、数字与
    // 比较 / 逻辑运算符（白名单）；条件区里单独的 = 按 == 处理 ——
    // = 在 JS 里是赋值，写进条件会恒真，并且真的把变量改掉。
    // 与 ScriptingCore 的 Validate/ConditionRules 保持同一套口径。
    // ============================================================
    var COND_IDENT     = '(?:f|sf|tf)\\.[A-Za-z_\\u4e00-\\u9fff][A-Za-z0-9_\\u4e00-\\u9fff]*';
    var COND_TOKEN_RE  = new RegExp(COND_IDENT + '|\\d+(?:\\.\\d+)?|==|!=|>=|<=|&&|\\|\\||[><!()]', 'g');
    var COND_SINGLE_EQ = /(^|[^=<>!])=(?!=)/g;

    /**
     * 把条件区里单独的 = 归一化为 ==（条件区以外不受影响）
     * @param {string} exp - 条件表达式
     * @returns {string} 归一化后的表达式
     */
    function normalizeCondition(exp) {
        if (typeof exp !== 'string' || exp === '') return exp;
        return exp.replace(COND_SINGLE_EQ, '$1==');
    }

    /**
     * 找出条件表达式里不属于白名单的片段
     * @param {*} exp - 条件表达式
     * @returns {string} 不受支持的片段（去掉空白）；完全合法时为空串
     */
    function conditionUnsupported(exp) {
        var rest = normalizeCondition(exp == null ? '' : String(exp)).replace(COND_TOKEN_RE, ' ');
        return rest.replace(/\s+/g, '');
    }

    // ============================================================
    // 运行期诊断
    // 条件写错、变量语句写错时会直接表现为「分支永远走兜底」「变量没变化」，
    // 只在控制台留一行很难被发现。这里把问题收集起来，供 F1/F2 面板读取，
    // 同时在画面上给一次醒目提示（同一问题只提示一次，避免推进剧本时刷屏）。
    // ============================================================
    var DIAG_LIMIT = 50;
    var _diagnostics = [];
    var _diagSeen = {};

    /**
     * 记录一条运行期诊断，并在画面上提示一次
     * @param {string} level - 'error' | 'warn'
     * @param {string} message - 问题描述
     * @param {string} [detail] - 补充信息（建议写法、出错原因等）
     * @returns {void}
     */
    function pushDiagnostic(level, message, detail) {
        var key = level + '|' + message;
        if (_diagSeen[key]) return;
        _diagSeen[key] = true;

        var item = {
            level: level,
            message: message,
            detail: (detail == null) ? '' : String(detail)
        };
        if (_diagnostics.length >= DIAG_LIMIT) _diagnostics.shift();
        _diagnostics.push(item);

        var line = '[VarSpace/' + level + '] ' + message + (item.detail ? ' — ' + item.detail : '');
        if (level === 'error') console.error(line);
        else console.warn(line);

        try {
            var eng = global.gameEngine;
            if (eng && typeof eng.showMessage === 'function')
                eng.showMessage('剧本变量 / 条件有问题（详见控制台）', level === 'error' ? 'error' : 'warning');
        } catch (e) { /* 无宿主时忽略 */ }
    }

    // ============================================================
    // $ 变量语句区
    // 只解析引擎自己定义的语句，不执行任意 JS，因此没有注入面：
    //   $语句; 语句; 语句
    //   $?条件 | 真分支语句组 | 假分支语句组     （假分支可省）
    // 语句：ns.name = 值 / += -= *= /= 值 / ++ / -- / ~（保持不变）
    // 值只接受数字、true、false、引号字符串，或另一个 f. / sf. / tf. 变量。
    // ============================================================
    var VP_ID        = '[A-Za-z_\\u4e00-\\u9fff][A-Za-z0-9_\\u4e00-\\u9fff]*';
    var VP_INC       = new RegExp('^(f|sf|tf)\\.(' + VP_ID + ')\\s*(\\+\\+|--)$');
    var VP_COMPOUND  = new RegExp('^(f|sf|tf)\\.(' + VP_ID + ')\\s*(\\+=|-=|\\*=|\\/=)\\s*(.+)$');
    var VP_COMPARE   = new RegExp('^(f|sf|tf)\\.(' + VP_ID + ')\\s*==\\s*(.+)$');
    var VP_ASSIGN    = new RegExp('^(f|sf|tf)\\.(' + VP_ID + ')\\s*=\\s*(.+)$');
    var VP_SHORT     = new RegExp('^(f|sf|tf)\\.(' + VP_ID + ')\\s*([+-])\\s*(\\d+(?:\\.\\d+)?)$');
    var VP_REF       = new RegExp('^(f|sf|tf)\\.(' + VP_ID + ')$');
    var VP_NUMBER    = /^-?\d+(?:\.\d+)?$/;

    /**
     * 按分隔符切分，但把成对的分隔符当一个整体（条件里的 || 不会被当成 | 分隔符）
     * @param {string} text - 待切分文本
     * @param {string} sep - 单字符分隔符
     * @returns {Array<string>}
     */
    function splitTopLevel(text, sep) {
        var parts = [], buf = '', i;
        for (i = 0; i < text.length; i++) {
            if (text[i] === sep && text[i + 1] === sep) { buf += sep + sep; i++; continue; }
            if (text[i] === sep) { parts.push(buf); buf = ''; continue; }
            buf += text[i];
        }
        parts.push(buf);
        return parts;
    }

    /**
     * 解析语句右侧的值
     * @param {string} raw - 原始文本
     * @returns {{kind?: string, value?: *, error?: string}}
     */
    function parseVarValue(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { error: '赋值为空' };
        var m = VP_REF.exec(s);
        if (m) return { kind: 'ref', value: m[1] + '.' + m[2] };
        if (s === 'true')  return { kind: 'lit', value: true };
        if (s === 'false') return { kind: 'lit', value: false };
        if (VP_NUMBER.test(s)) return { kind: 'lit', value: parseFloat(s) };
        if (s.length >= 2 && (s.charAt(0) === '"' || s.charAt(0) === "'") && s.charAt(s.length - 1) === s.charAt(0))
            return { kind: 'lit', value: s.slice(1, -1) };
        return { error: s };
    }

    /**
     * 解析单条变量语句
     * @param {string} raw - 语句原文
     * @param {Array} errors - 语法问题收集数组
     * @returns {Object|null} 语句对象；无法解析时返回 null
     */
    function parseVarStatement(raw, errors) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return null;
        if (s === '~') return { ns: '', name: '', op: 'noop', kind: 'lit', value: null };

        var m = VP_INC.exec(s);
        if (m) return buildStatement(m[1], m[2], m[3], 'lit', 1, errors);

        m = VP_COMPOUND.exec(s);
        if (m) {
            var cv = parseVarValue(m[4]);
            if (cv.error) { errors.push({ message: '赋值不受支持: ' + cv.error, suggestion: VALUE_HINT }); return null; }
            return buildStatement(m[1], m[2], m[3], cv.kind, cv.value, errors);
        }

        if (VP_COMPARE.test(s)) {
            errors.push({ message: '变量语句里的 == 不是赋值: ' + s, suggestion: '赋值用 =，== 只出现在条件区' });
            return null;
        }

        m = VP_ASSIGN.exec(s);
        if (m) {
            var av = parseVarValue(m[3]);
            if (av.error) { errors.push({ message: '赋值不受支持: ' + av.error, suggestion: VALUE_HINT }); return null; }
            return buildStatement(m[1], m[2], '=', av.kind, av.value, errors);
        }

        // 简写形式 sf.dead+1 / sf.dead-1，等价于 += 1 / -= 1
        m = VP_SHORT.exec(s);
        if (m) return buildStatement(m[1], m[2], m[3] === '+' ? '+=' : '-=', 'lit', parseFloat(m[4]), errors);

        errors.push({ message: '无法识别的变量语句: ' + s, suggestion: '形如 sf.dead += 1 / f.flag = 1 / tf.n++' });
        return null;
    }

    var VALUE_HINT = '值只接受数字 / true / false / 引号字符串 / 另一个 f. sf. tf 变量';

    function buildStatement(ns, name, op, kind, value, errors) {
        // tf.isReplayBegin / tf.isReplayEnd 是剧本里的回放范围标记，不是真变量：
        // 这里直接丢弃（不落值、不记诊断），实际识别由 engine_text.js 按整行严格形完成。
        if (ns === 'tf' && (name === 'isReplayBegin' || name === 'isReplayEnd')) return null;
        // tf.isReplay 是回放模式开关（存档页入口写入），剧本不可改写
        if (ns === 'tf' && name === 'isReplay') {
            errors.push({
                message: '变量语句企图改写系统变量 ' + ns + '.' + name,
                suggestion: 'tf.isReplay 由存档页「回放」入口维护，剧本不可改写'
            });
            return null;
        }
        // tf.allclear 是宿主调试菜单「开启全部鉴赏」的开关，剧本不可改写
        if (ns === 'tf' && name === 'allclear') {
            errors.push({
                message: '变量语句企图改写系统变量 ' + ns + '.' + name,
                suggestion: 'tf.allclear 由宿主调试菜单维护，剧本不可改写'
            });
            return null;
        }
        // sf.clear 是通关标识，剧本只能置 1；0 只是默认值，不允许由剧本回退
        if (ns === 'sf' && name === 'clear' &&
            !(op === '=' && kind === 'lit' && value === 1)) {
            errors.push({
                message: '变量语句里的 sf.clear 只能置 1',
                suggestion: '0 只是默认值；清零请用设置的「清除存档」功能，不要写在剧本里'
            });
            return null;
        }
        return { ns: ns, name: name, op: op, kind: kind, value: value };
    }

    /**
     * 解析整段 $ 区
     * @param {string} text - command 字段原文（以 $ 引导）
     * @returns {{branches: Array, errors: Array}}
     */
    function parseVarProgram(text) {
        var raw = String(text == null ? '' : text).trim();
        if (raw.charAt(0) === '$') raw = raw.slice(1).trim();

        var errors = [], branches = [];
        if (!raw) {
            errors.push({ message: '$ 之后没有任何变量语句' });
            return { branches: branches, errors: errors };
        }

        var cond = null, thenText = '', elseText = null;
        if (raw.charAt(0) === '?') {
            var parts = splitTopLevel(raw.slice(1), '|');
            if (parts.length > 3)
                errors.push({ message: '$ 区里的 | 最多出现两次（?条件 | 真分支 | 假分支）' });
            cond = parts[0].trim();
            thenText = parts.length > 1 ? parts[1] : '';
            elseText = parts.length > 2 ? parts[2] : null;

            if (!cond) {
                errors.push({ message: '$ 区的 ? 之后缺少条件表达式' });
            } else if (cond !== '#') {
                var bad = conditionUnsupported(cond);
                if (bad) {
                    errors.push({ message: '$ 区条件含不受支持的写法: ' + bad, suggestion: COND_WHITELIST_HINT, level: 'error' });
                } else if (normalizeCondition(cond) !== cond) {
                    errors.push({ message: '$ 区条件区里的 = 已按 == 处理: ' + cond, suggestion: '等值比较请写 ==', level: 'warn' });
                }
            }
        } else {
            thenText = raw;
        }

        branches.push({
            cond: cond,
            then: collectStatements(thenText, errors),
            else: elseText === null ? null : collectStatements(elseText, errors)
        });
        return { branches: branches, errors: errors };
    }

    var COND_WHITELIST_HINT = '条件区只允许 f. / sf. / tf. 变量、数字与 == != > >= < <= && || ! ( )';

    function collectStatements(text, errors) {
        var out = [], pieces = String(text == null ? '' : text).split(';'), i;
        for (i = 0; i < pieces.length; i++) {
            var st = parseVarStatement(pieces[i], errors);
            if (st) out.push(st);
        }
        return out;
    }

    // ============================================================
    // VarSpace：对外暴露的变量系统统一 API 对象（挂载到 window.VarSpace）
    // ============================================================
    var VarSpace = {
        /** 模块版本号 */
        version: '1.2.0',
        /** f. 游戏变量命名空间代理（随存档走，镜像写入 sessionStorage） */
        f:  makeProxy(stores.f),
        /** sf. 系统变量命名空间代理（跨会话留存，持久化到 localStorage） */
        sf: makeProxy(stores.sf),
        /** tf. 临时变量命名空间代理（纯内存，关页即失） */
        tf: makeProxy(stores.tf),

        /**
         * 查询好感度加减动画是否启用（读取顶部 AFFINITY_ANIM_ENABLED 常量开关）
         * @returns {boolean} true=显示 +X/-X 飘动动画，false=关闭动画直接推进
         */
        isAffinityAnimEnabled: function () { return AFFINITY_ANIM_ENABLED; },
        /**
         * 运行时切换好感度动画开关（供调试 / 设置页动态调用，无需改源码）
         * @param {boolean} v - true 启用动画，false 关闭动画
         * @returns {Object} 返回 VarSpace 自身，支持链式调用
         */
        setAffinityAnimEnabled: function (v) { AFFINITY_ANIM_ENABLED = !!v; return this; },

        /**
         * 启动时初始化：载入 sf. 持久区、按入口信号决定是否继承 f. 镜像、清空 tf.
         * 幂等：已初始化则直接返回，engine.js 顶部可再次调用（空操作）
         * @returns {Object} 返回 VarSpace 自身，支持链式调用
         * @sideEffect 写入 stores.sf / stores.f / stores.tf，并置位 _initialized 标记
         */
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
                        global.sessionStorage.getItem('archiveLoadTarget') ||
                        global.sessionStorage.getItem(TF_ISREPLAY_KEY)) {
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
            // 恢复顺序：先 allclear，再 isReplay（两者各用独立承载键，互不覆盖）。
            // tf.allclear：由 C# 调试菜单「开启全部鉴赏」写入，靠 sessionStorage 承载键跨页面生效；
            // 标签页关闭即消失，与 tf. 纯内存语义一致，仅用于开发者测试，不影响存档与 sf.clear。
            try {
                if (global.sessionStorage && global.sessionStorage.getItem(TF_ALLCLEAR_KEY) === '1') {
                    stores.tf.allclear = 1;
                }
            } catch (e) { /* 忽略 */ }
            // tf.isReplay：由存档页写入承载键后进入回放模式，同样靠 sessionStorage 跨页面延续；
            // 抵达终点返回存档页时清掉。载荷损坏或版本不符一律视为失效并清理（静默）。
            try {
                if (global.sessionStorage) {
                    var _rpRaw = global.sessionStorage.getItem(TF_ISREPLAY_KEY);
                    if (_rpRaw) {
                        var _rpObj = null;
                        try { _rpObj = JSON.parse(_rpRaw); } catch (e) { _rpObj = null; }
                        if (_rpObj && _rpObj.v === 1) stores.tf.isReplay = _rpObj;
                        else global.sessionStorage.removeItem(TF_ISREPLAY_KEY);
                    }
                }
            } catch (e) { /* 忽略 */ }
            _initialized = true;
            console.log('[VarSpace] initialized (verbose=' + _verbose + '). sf keys:',
                        Object.keys(stores.sf).length, ' f keys:', Object.keys(stores.f).length,
                        ' inheritF=', _shouldInheritF);
            return this;
        },

        /**
         * 按完整名（含命名空间前缀）读取变量值
         * @param {string} name - 完整变量名，如 'f.aff_yn'、'sf.clear'
         * @returns {*} 变量当前值；前缀非法或变量未定义时返回 undefined
         */
        get: function (name) {
            var p = parseName(name); if (!p) return undefined;
            return (p.key in stores[p.ns]) ? stores[p.ns][p.key] : undefined;
        },
        /**
         * 按完整名（含命名空间前缀）写入变量值
         * 写 f. / sf. 时自动触发对应命名空间的防抖落盘；写 tf. 仅存内存
         * @param {string} name - 完整变量名，如 'f.aff_yn'
         * @param {*} value - 要写入的值（剧本中请使用 JSON 兼容类型）
         * @returns {boolean} 写入成功返回 true；前缀非法返回 false
         */
        set: function (name, value) {
            var p = parseName(name); if (!p) return false;
            // 回放期冻结 f. / sf. 写入（剧本、插件、控制台一视同仁）
            if (replayBlocksWrite(p.ns, p.key)) return false;
            // tf.isReplay 由存档页回放入口维护，外部写入一律拒绝
            if (p.ns === 'tf' && p.key === 'isReplay') {
                pushDiagnostic('error', 'tf.isReplay 由存档页维护，本次写入被拒绝',
                    '要进入回放请使用存档页「回放」区域里的条目');
                return false;
            }
            // sf.clear 是通关标识：只接受置 1；0 只是默认值，不允许由剧本回退。
            // 清零的唯一通道是 resetSystem()（设置的「清除存档」/ 宿主清档信号），
            // 它直接重建 sf. 存储区，不经过这里。
            if (p.ns === 'sf' && p.key === 'clear' && value !== 1) {
                pushDiagnostic('error',
                    'sf.clear 只能置 1，本次写入被拒绝: ' + value,
                    '0 只是默认值；清零请用设置的「清除存档」功能');
                return false;
            }
            stores[p.ns][p.key] = value;
            _log('SET', name, value);
            if (p.ns === 'f') persistF();
            else if (p.ns === 'sf') persistSF();
            return true;
        },
        /**
         * 按完整名（含命名空间前缀）判断变量是否已定义
         * @param {string} name - 完整变量名，如 'tf.tmpFlag'
         * @returns {boolean} 变量存在返回 true；前缀非法或未定义返回 false
         */
        has: function (name) {
            var p = parseName(name); if (!p) return false;
            return p.key in stores[p.ns];
        },

        // ---- f. 与存档相关 ----
        /**
         * 导出当前 f. 全量数据供存入存档槽（saveStateSnapshot 调用）
         * 深拷贝实现：返回值与内部 stores.f 完全隔离，且绝不含 sf. / tf. 数据
         * @returns {Object} f. 命名空间的深拷贝对象
         */
        serializeF: function () { return JSON.parse(JSON.stringify(stores.f)); },
        /**
         * 从存档槽还原 f.（restoreFromSnapshot / 读档流程调用）
         * 深拷贝写入：先清空再合并，切断与存档数据的引用关系；不影响 sf.
         * @param {Object} obj - 存档中保存的 f. 数据（serializeF 的产物）
         * @returns {void} 无返回值；副作用是整体替换 stores.f 并立即写 sessionStorage 镜像
         */
        restoreF: function (obj) {
            clearObj(stores.f);
            if (obj && typeof obj === 'object') Object.assign(stores.f, obj);
            _log('RESTORE', 'f.*', stores.f);
            persistFImmediate();
        },
        /**
         * 新游戏开始：只清空 f. 游戏变量，保留 sf. 系统变量（含 sf.clear 解锁标记）
         * @returns {void} 无返回值；副作用是清空 stores.f 并立即清除 sessionStorage 镜像
         */
        clearF: function () {
            // 回放期忽略「新游戏」清空：回放要读 f. 基线与正片保持一致，
            // 清空后镜像也会被覆盖，导致后续读值失真
            if (isReplayMode()) {
                console.log('[VarSpace] 回放中，已忽略 clearF()');
                return;
            }
            clearObj(stores.f);
            _log('CLEAR', 'f.*', {});
            persistFImmediate();
            console.log('[VarSpace] f.* cleared (sf.* preserved)');
        },
        /**
         * 立即把 f. 写入 sessionStorage（绕过 150ms 防抖）。
         * 用于 nextScene 跨文件跳转前，确保 B 页面能读到最新的 f. 值，
         * 不依赖 beforeunload（WebView2 中 beforeunload 的 sessionStorage.setItem 可能不可靠）。
         * @returns {Object} 返回 VarSpace 自身，支持链式调用
         */
        flushF: function () {
            persistFImmediate();
            return this;
        },

        // ---- sf. 系统相关 ----
        /**
         * 读取 sf. 系统变量（简写形式，等价于 get('sf.' + name)）
         * @param {string} name - 变量名（不含 sf. 前缀），如 'clear'
         * @returns {*} 变量值；变量不存在时返回 undefined
         */
        getSF: function (name) { return (name in stores.sf) ? stores.sf[name] : undefined; },
        /**
         * 写入 sf. 系统变量（简写形式，等价于 set('sf.' + name, value)）
         * 自动触发防抖落盘到 localStorage，实现跨会话留存
         * @param {string} name - 变量名（不含 sf. 前缀）
         * @param {*} value - 要写入的值
         * @returns {boolean} 固定返回 true
         */
        setSF: function (name, value) {
            // 回放期冻结 sf. 写入（剧本、插件、控制台一视同仁）
            if (replayBlocksWrite('sf', name)) return false;
            // sf.clear 是通关标识：只接受置 1；0 只是默认值，不允许由剧本回退
            if (name === 'clear' && value !== 1) {
                pushDiagnostic('error',
                    'sf.clear 只能置 1，本次写入被拒绝: ' + value,
                    '0 只是默认值；清零请用设置的「清除存档」功能');
                return false;
            }
            stores.sf[name] = value; _log('SET', 'sf.' + name, value); persistSF(); return true;
        },

        /**
         * 清除所有存档时调用（由 C# 启动器「清除所有存档」经宿主消息触发，
         * 或 localStorage 被整体清空时于下次加载自动生效）：
         * 重置全部 sf.*（含 sf.clear 解锁标记）。不触动 f.*。
         * 这是 sf.clear 唯一能回到 0 的通道：直接重建 sf. 存储区，
         * 不经过 set / setSF 的「只能置 1」校验。
         * @returns {Object} 返回 VarSpace 自身，支持链式调用
         * @sideEffect 清空 stores.sf 并立即写入空的持久化键（绕过防抖）
         */
        resetSystem: function () {
            clearObj(stores.sf);
            _log('CLEAR', 'sf.*', {});
            persistSFImmediate();
            // 回放解锁记录同属「清除所有存档」的管理范围：清掉后已看过的回放重新上锁（预期行为）。
            // 注意：本函数是玩家 / 宿主的主动清空动作，回放期不禁用，否则会出现「点了没反应」。
            try { if (global.localStorage) global.localStorage.removeItem(REPLAY_UNLOCKED_KEY); } catch (e) { /* 忽略 */ }
            console.log('[VarSpace] sf.* cleared（系统变量 / 回放解锁记录已重置）');
            return this;
        },

        /**
         * 场景脚本表达式求值（f. / sf. / tf. 三个命名空间在表达式中直接可用）
         * 求值前先按条件规则处理：白名单外的写法直接判失败，
         * 条件区里单独的 = 按 == 处理；两者都会记录一条诊断（条件错了若被静默吞掉，
         * 剧本表现是「分支永远走兜底」，很难反查）。
         * @param {string} exp - 表达式字符串，如 'f.yn >= 5'、'sf.clear == 1'
         * @returns {*} 表达式求值结果；语法不受支持或执行异常时返回 undefined
         */
        eval: function (exp) {
            var bad = conditionUnsupported(exp);
            if (bad) {
                pushDiagnostic('error', '条件表达式含不受支持的写法: ' + bad + '（原表达式: ' + exp + '）',
                    COND_WHITELIST_HINT);
                return undefined;
            }
            var src = normalizeCondition(exp);
            if (src !== exp) {
                pushDiagnostic('warn', '条件区里的 = 已按 == 处理: ' + exp, '等值比较请写 ==');
            }
            try {
                var fn = new Function('f', 'sf', 'tf', 'return (' + src + ');');
                var r = fn(this.f, this.sf, this.tf);
                _log('EVAL', src, r);
                return r;
            } catch (e) {
                pushDiagnostic('error', '条件表达式求值失败: ' + exp,
                    e && e.message ? e.message : String(e));
                return undefined;
            }
        },

        /**
         * 调试：在 F12 控制台分类打印当前 f. / sf. / tf. 全量数据
         * 用法：控制台输入 VarSpace.log() 即可查看三个命名空间的完整快照
         * @returns {{f: Object, sf: Object, tf: Object}} 与 dump() 相同的三命名空间深拷贝对象
         */
        log: function () {
            var d = this.dump();
            console.log('%c[VarSpace] 当前变量（f=游戏变量 / sf=系统变量 / tf=临时变量）',
                        'color:#2a7;font-weight:bold');
            console.log('  f. :', JSON.parse(JSON.stringify(d.f)));
            console.log('  sf.:', JSON.parse(JSON.stringify(d.sf)));
            console.log('  tf.:', JSON.parse(JSON.stringify(d.tf)));
            return d;
        },

        /**
         * 重新应用入口门禁（页面内 sf.clear 变化后手动刷新入口显隐时调用）
         * @returns {Object} 返回 VarSpace 自身，支持链式调用
         */
        refreshGating: function () { applyPageGating(); return this; },

        /**
         * 开关 tf.allclear（开发者测试：解锁全部鉴赏页，绕过 sf.clear 门禁）
         * true 置 tf.allclear = 1 并写入 sessionStorage 承载键，跨页面导航后仍生效；
         * false 删除 tf.allclear 与承载键。不改动 sf.clear 与任何存档。
         * 切换后会重新应用入口门禁，并在 window 上派发 'shiori:allclearchange'
         * （detail.on = 切换后的状态），供页面内监听者即时重算依赖 tf.allclear 的显示。
         * @param {boolean} on - true 开启，false 关闭
         * @returns {boolean} 切换后的开启状态
         * @sideEffect 写入 stores.tf.allclear 与 sessionStorage，重新应用入口门禁，派发事件
         */
        setTempAllClear: function (on) {
            var v = !!on;
            try {
                if (v) {
                    stores.tf.allclear = 1;
                    if (global.sessionStorage) global.sessionStorage.setItem(TF_ALLCLEAR_KEY, '1');
                } else {
                    delete stores.tf.allclear;
                    if (global.sessionStorage) global.sessionStorage.removeItem(TF_ALLCLEAR_KEY);
                }
            } catch (e) { /* 忽略 */ }
            _log(v ? 'SET' : 'CLEAR', 'tf.allclear', v ? 1 : 0);
            applyPageGating();
            // 通知页面内监听者（如鉴赏逐项解锁插件）重算依赖 tf.allclear 的显示状态
            try {
                if (global.dispatchEvent && typeof global.CustomEvent === 'function') {
                    global.dispatchEvent(new global.CustomEvent('shiori:allclearchange', { detail: { on: v } }));
                }
            } catch (e) { /* 事件不可用时静默跳过 */ }
            return v;
        },

        /**
         * 查询 tf.allclear 是否开启（开发者测试开关状态）
         * @returns {boolean} 开启返回 true，否则 false
         */
        isTempAllClear: function () { return !!stores.tf.allclear; },

        /**
         * 判定「全部鉴赏」是否开启：内存优先，再直读 sessionStorage 承载键。
         * 宿主「开启全部鉴赏」是注入 JS 直接写该键，页面不重载时内存未同步，
         * 因此写解锁前必须两个来源都看一遍。
         * @returns {boolean}
         */
        _isAllClearOn: function () {
            if (stores.tf.allclear) return true;
            try {
                if (global.sessionStorage && global.sessionStorage.getItem(TF_ALLCLEAR_KEY) === '1') return true;
            } catch (e) { /* 忽略 */ }
            return false;
        },

        // ============================================================
        // 回放（tf.isReplay 的读写方）
        // ---------------------------------------------------------------
        // 存档页（saves.html）不加载本文件，进入回放时它只写承载键；
        // 场景页 init() 把承载键恢复进 stores.tf，下面这组 API 供场景页与检查器使用。
        // ============================================================

        /**
         * 查询当前是否处于回放模式（tf.isReplay 存在）
         * @returns {boolean}
         */
        isReplaying: function () { return isReplayMode(); },

        /**
         * 取回放载荷本体（只读用途）
         * @returns {Object|null} 载荷对象；非回放期返回 null
         */
        getReplay: function () { return isReplayMode() ? stores.tf.isReplay : null; },

        /**
         * 退出回放模式：清 tf.isReplay 与 sessionStorage 承载键。
         * 不触碰 f. / sf.，不写任何解锁记录（回放永不写解锁）。
         * @returns {void}
         */
        clearReplay: function () {
            try { delete stores.tf.isReplay; } catch (e) { /* 忽略 */ }
            try { if (global.sessionStorage) global.sessionStorage.removeItem(TF_ISREPLAY_KEY); } catch (e) { /* 忽略 */ }
            _log('CLEAR', 'tf.isReplay', 0);
        },

        /**
         * 读回放解锁记录（localStorage，键 = 记录的 end 文件名）
         * @returns {Object} 形如 { "4": 1 }；键不存在或损坏返回空对象
         */
        readReplayUnlocked: function () {
            var o = loadJSON(REPLAY_UNLOCKED_KEY, {});
            return (o && typeof o === 'object') ? o : {};
        },

        /**
         * 判断某个 end 文件名对应的回放是否已解锁
         * @param {string} file - 记录的 end 字段（不含 .html）
         * @returns {boolean}
         */
        isReplayUnlocked: function (file) {
            return !!this.readReplayUnlocked()[String(file)];
        },

        /**
         * 正片跑到 isReplayEnd 时写解锁（回放模式永不到这里）。
         * 硬性前提：tf.allclear 开启时一律不写 —— allclear 只改「显示 / 可点」，
         * 绝不写存档、绝不解锁任何进度。
         * @param {string} file - 当前剧本文件名（不含 .html）
         * @returns {boolean} 实际写入返回 true；被 allclear 拦截 / 回放期 / 写失败返回 false
         */
        unlockReplay: function (file) {
            if (isReplayMode()) return false;                  // 回放不写解锁
            if (this._isAllClearOn()) {                        // allclear 不碰存档
                console.log('[VarSpace] allclear 开启中，跳过回放解锁写入: ' + file);
                return false;
            }
            var f = String(file == null ? '' : file);
            if (!f) return false;
            try {
                var o = loadJSON(REPLAY_UNLOCKED_KEY, {});
                if (!o || typeof o !== 'object') o = {};
                if (o[f]) return false;                        // 幂等：重复经过不重复写
                o[f] = 1;
                saveJSON(REPLAY_UNLOCKED_KEY, o);
                _log('SET', 'replay_unlocked[' + f + ']', 1);
                return true;
            } catch (e) { return false; }                      // 写入失败静默
        },

        /**
         * 开关自动日志输出（默认开启；也可用 URL 参数 ?vlog=0 临时关闭）
         * @param {boolean} v - true 开启日志，false 关闭日志
         * @returns {boolean} 切换后的日志开关状态
         */
        setVerbose: function (v) { _verbose = !!v; return _verbose; },

        /**
         * 调试：深拷贝导出 f. / sf. / tf. 全部命名空间数据
         * @returns {{f: Object, sf: Object, tf: Object}} 三命名空间的深拷贝快照
         */
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
         * 判定单个分支项是否命中。四条规则按优先级取第一条成立的：
         *   1. 有 when        → checkCondition(when) 求值
         *   2. flag === '#'   → 恒真（兜底）
         *   3. 有 flag        → f.<flag> 真值判定（非 0 / 非空）
         *   4. 都没有          → 恒真
         * 纯判定，不产生任何副作用（不改变量、不结算好感度）。
         * @param {Object} c - 分支项，可含 when / flag / target，也可是整条动作对象
         * @returns {boolean}
         */
        _matchEntry: function (c) {
            if (!c || typeof c !== 'object') return false;
            if (c.when) return this.checkCondition(c.when);
            if (c.flag === '#' || c.target === '#') return true;
            if (c.flag) {
                var v = stores.f[c.flag];
                return (v !== undefined && v !== null && v !== 0 && v !== false && v !== '');
            }
            return true;
        },

        /**
         * 解析分支链：按序求值，返回首个命中项本身（整个对象，不只是 target）
         * 数组顺序即优先级，首个命中项之后不再求值；返回值为原对象引用，调用方可直接当动作执行。
         * @param {Array} entries - 分支项数组
         * @returns {Object|null} 首个命中项；全部未命中返回 null
         */
        resolveEntry: function (entries) {
            if (!entries || !entries.length) return null;
            for (var i = 0; i < entries.length; i++) {
                var c = entries[i] || {};
                if (this._matchEntry(c)) {
                    _log('BRANCH', '命中 #' + i, c.target || c.type || '');
                    return c;
                }
            }
            _log('BRANCH', '全部未命中', null);
            return null;
        },

        /**
         * 解析静默分支：取首个命中项，返回其 target，并结算其 add
         * 命中项若有 flag + add，同时调用 applyAffinity
         * @param {Array} choices - 选项数组
         * @returns {string|null} 命中项的 target；全部未命中返回 null
         */
        resolveBranch: function (choices) {
            var c = this.resolveEntry(choices);
            if (!c) return null;
            if (c.flag && c.flag !== '#' && c.add !== undefined && c.add !== null) {
                this.applyAffinity(c.flag, c.add);
            }
            return (c.target !== undefined && c.target !== null) ? c.target : null;
        },

        // ============================================================
        // $ 变量语句区执行
        // ============================================================

        /**
         * 解析一段 $ 变量语句区（不执行）
         * @param {string} text - command 字段原文（以 $ 引导）
         * @returns {{branches: Array, errors: Array}}
         */
        parseProgram: function (text) {
            return parseVarProgram(text);
        },

        /**
         * 执行一段 $ 变量语句区
         * 语法问题逐条记入运行期诊断；已解析出的合法语句照常执行，
         * 因此一句话写错不会导致整段静默失效。
         * @param {string} text - command 字段原文（以 $ 引导）
         * @returns {{branches: Array, errors: Array}} 解析结果（便于调用方/测试断言）
         * @sideEffect 写入 f. / sf. / tf. 变量并按各自命名空间落盘
         */
        runProgram: function (text) {
            var program = parseVarProgram(text);
            var i;
            for (i = 0; i < program.errors.length; i++) {
                var err = program.errors[i] || {};
                pushDiagnostic(err.level === 'warn' ? 'warn' : 'error',
                    '变量语句区: ' + err.message, err.suggestion || '');
            }
            this.runBranches(program);
            return program;
        },

        /**
         * 执行一份已解析的变量语句区（{ branches: [...] }，与编译产物同一形状）
         * @param {Object} program - 解析结果
         * @returns {void}
         * @sideEffect 写入 f. / sf. / tf. 变量
         */
        runBranches: function (program) {
            if (!program || !program.branches) return;
            var i, j;
            for (i = 0; i < program.branches.length; i++) {
                var br = program.branches[i];
                if (!br) continue;
                var take = true;
                if (br.cond != null && br.cond !== '')
                    take = (br.cond === '#') ? true : this.checkCondition(br.cond);
                var list = take ? br.then : br.else;
                if (!list) continue;
                for (j = 0; j < list.length; j++) this.applyVarStatement(list[j]);
            }
        },

        /**
         * 执行单条变量语句
         * @param {Object} st - { ns, name, op, kind, value }
         * @returns {void}
         * @sideEffect 写入对应命名空间
         */
        applyVarStatement: function (st) {
            if (!st || st.op === 'noop' || !st.ns) return;
            // 回放期冻结 f. / sf. 的剧本写入（tf. 放行：回放本身靠 tf. 承载状态）
            if (replayBlocksWrite(st.ns, st.name)) return;
            var full = st.ns + '.' + st.name;
            var next = (st.kind === 'ref') ? this.get(st.value) : st.value;

            // sf.clear 是通关标识：只接受置 1；0 只是默认值，不允许由剧本回退
            if (st.ns === 'sf' && st.name === 'clear' && (st.op !== '=' || next !== 1)) {
                pushDiagnostic('error',
                    'sf.clear 只能置 1，本条已忽略: ' + st.op + ' ' + next,
                    '0 只是默认值；清零请用设置的「清除存档」功能');
                return;
            }

            if (st.op === '=') { this.set(full, next); return; }

            var cur = Number(this.get(full));
            if (isNaN(cur)) cur = 0;
            var num = Number(next);
            if (isNaN(num)) num = 0;

            switch (st.op) {
                case '+=': this.set(full, cur + num); break;
                case '-=': this.set(full, cur - num); break;
                case '*=': this.set(full, cur * num); break;
                case '/=': this.set(full, num === 0 ? cur : cur / num); break;
                case '++': this.set(full, cur + 1); break;
                case '--': this.set(full, cur - 1); break;
            }
        },

        /**
         * 取运行期诊断（条件写法不受支持 / 条件求值失败 / 变量语句有问题）
         * @returns {Array<{level: string, message: string, detail: string}>}
         */
        getDiagnostics: function () { return _diagnostics.slice(); },

        /** 清空运行期诊断 */
        clearDiagnostics: function () { _diagnostics.length = 0; _diagSeen = {}; return this; }
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
            /**
             * 判断给定字符串是否命中清档关键词（全等匹配，大小写不敏感）
             * @param {string} s - 待检测字符串（来自消息的 type/action/command/op/raw 字段）
             * @returns {boolean} 命中任一关键词返回 true；空值 / 非字符串返回 false
             */
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
