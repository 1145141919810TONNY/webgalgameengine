/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 鉴赏逐项解锁插件（BGM / CG，可选）。
 * ---------------------------------------------------------------------------
 * 【开关】文件顶部两个开关分别控制 BGM 与 CG，两者彼此独立：
 *     GALLERY_UNLOCK_BGM = true   → BGM 鉴赏逐项解锁生效
 *     GALLERY_UNLOCK_CG  = true   → CG  鉴赏逐项解锁生效
 *   置 false 时该侧既不记录也不加锁，页面与未安装插件时完全一致。
 *
 * 【做两件事】
 *   记录端（剧本页）：BGM 被播放、CG 被展示时，把对应条目写进 sf. 持久区，
 *     键为 sf.gal_bgm_<条目名> / sf.gal_cg_<条目名>，值 1，跨存档跨会话留存。
 *     BGM 取 gameEngine.playAudio 的键（并按解析出的路径与 BGM_MAP/BGM_CONFIG 反查）；
 *     CG  取 gameEngine.setBackground 的背景路径与 gameEngine.eventShow 的事件图路径，
 *         两者都按 CG_CONFIG(_SUB) 反查条目名；因此事件图、作为背景显示的 CG 都算「展示过」。
 *   读取端（鉴赏页）：只有记录过的条目正常显示，未记录的显示锁定态；
 *     歌单循环与 CG 放大翻页自动跳过未解锁项；锁定项在鉴赏页点击不做任何事。
 *
 * 【锁定态外观】BGM 按钮显示 GALLERY_LOCK_TEXT_BGM（默认 ???）；
 *   CG 格子盖一层黑色遮罩，居中显示白色大写英文 GALLERY_LOCK_TEXT_CG（默认 NO DATA）。
 *
 * 【tf.allclear】开发者测试开关打开时（Shiori_debug.exe 调试菜单「开启全部鉴赏」，
 *   或控制台 VarSpace.setTempAllClear(true)），全部条目直接视为已解锁。
 *   页面存活期间该开关被切换时（含从开→关），掩码会即时重算，无需刷新页面：
 *   宿主页有 vars.js 时走 'shiori:allclearchange' 事件；html/bgm.html 这类
 *   未注入 vars.js 的页面（调试菜单直接改 sessionStorage 承载键）则由定时巡检兜底。
 *
 * 【引用方式】任选其一或同时使用，移除引用即完全卸载：
 *   1. 已写入 engine_manifest.json 的 official 列表末尾 —— 剧本页（scenes/*.html）
 *      与 html/CG.html 会被宿主自动注入，无需改页面。
 *   2. html/bgm.html 不在官方注入范围，页面末尾手写一行：
 *        <script src="../plugins/gallery_unlock.js"></script>
 *
 * 【可调】页面可在本文件之前覆盖开关与文案（可选，均在 window 上）：
 *     window.SHIORI_GALLERY_UNLOCK_BGM / SHIORI_GALLERY_UNLOCK_CG
 *     window.SHIORI_GALLERY_LOCK_TEXT_BGM / SHIORI_GALLERY_LOCK_TEXT_CG
 * ---------------------------------------------------------------------------
 */

/* ===== 顶部开关：BGM / CG 相互独立 ===== */
var GALLERY_UNLOCK_BGM = (window.SHIORI_GALLERY_UNLOCK_BGM === undefined) ? true : !!window.SHIORI_GALLERY_UNLOCK_BGM;
var GALLERY_UNLOCK_CG  = (window.SHIORI_GALLERY_UNLOCK_CG  === undefined) ? true : !!window.SHIORI_GALLERY_UNLOCK_CG;

/* ===== 锁定态文案 ===== */
var GALLERY_LOCK_TEXT_BGM = window.SHIORI_GALLERY_LOCK_TEXT_BGM || '???';
var GALLERY_LOCK_TEXT_CG  = window.SHIORI_GALLERY_LOCK_TEXT_CG  || 'NO DATA';

(function () {
    'use strict';

    if (window.__shioriGalleryUnlockLoaded) return;   // 幂等：重复引用只装一次
    window.__shioriGalleryUnlockLoaded = true;

    /* ── 常量 ─────────────────────────────────────────────── */
    var SF_KEY          = 'shiori_sf';           // 与 vars.js 的系统变量持久区同键
    var TF_ALLCLEAR_KEY = 'shiori_tf_allclear';  // tf.allclear 跨页承载键（sessionStorage）
    var PREFIX_BGM      = 'gal_bgm_';
    var PREFIX_CG       = 'gal_cg_';
    var LOG             = '[GalleryUnlock]';

    /* ── 存档 API 适配 ────────────────────────────────────── */
    /* 优先走 VarSpace（即引擎的变量 / 存档 API）；宿主页未注入 vars.js 时
       （如 html/bgm.html 不在官方注入范围），直接读写同一批存储键，语义一致。 */
    function vs() {
        try { if (typeof VarSpace !== 'undefined' && VarSpace) return VarSpace; } catch (e) { /* TDZ */ }
        return window.VarSpace || null;
    }
    function readSF(name) {
        var v = vs();
        if (v && typeof v.get === 'function') {
            var r = v.get('sf.' + name);
            if (r !== undefined) return r;
        }
        try {
            var o = JSON.parse(localStorage.getItem(SF_KEY) || '{}');
            return o ? o[name] : undefined;
        } catch (e) { return undefined; }
    }
    function writeSF(name, value) {
        var v = vs();
        if (v && typeof v.setSF === 'function') { v.setSF(name, value); return; }
        try {
            var o = JSON.parse(localStorage.getItem(SF_KEY) || '{}') || {};
            o[name] = value;
            localStorage.setItem(SF_KEY, JSON.stringify(o));
        } catch (e) { /* 忽略：存储不可用时静默降级 */ }
    }
    /** tf.allclear：VarSpace 优先，其次 sessionStorage 承载键（跨页面导航后仍有效）。 */
    function allClear() {
        var v = vs();
        if (v && typeof v.get === 'function' && v.get('tf.allclear')) return true;
        try { return sessionStorage.getItem(TF_ALLCLEAR_KEY) === '1'; } catch (e) { return false; }
    }
    /** 条目是否已解锁：tf.allclear 全开，否则看 sf. 里的记录。 */
    function isUnlocked(prefix, key) {
        if (!key) return false;
        if (allClear()) return true;
        var r = readSF(prefix + key);
        return r === 1 || r === '1' || r === true;
    }

    /* ── 路径归一：不同写法（./ ../ 绝对 / 缩略图前缀 / 查询串）折成同一形式 ── */
    function normPath(p) {
        var s = String(p == null ? '' : p).split('?')[0].split('#')[0].replace(/\\/g, '/').trim().toLowerCase();
        var t = s.indexOf('cg-thumb/');
        if (t >= 0) return 'assets/' + s.slice(t + 9).replace(/^\/+/, '');
        var i = s.indexOf('assets/');
        return i >= 0 ? s.slice(i) : s.replace(/^(\.?\/)+/, '');
    }

    /* ── 配置表索引：条目名集合 + 归一化路径 → 条目名 ── */
    function collect(tables) {
        var keySet = {}, pathIndex = {}, order = [];
        for (var t = 0; t < tables.length; t++) {
            var tb = tables[t];
            if (!tb) continue;
            for (var k in tb) {
                if (!Object.prototype.hasOwnProperty.call(tb, k)) continue;
                if (!keySet[k]) { keySet[k] = true; order.push(k); }
                var v = tb[k];
                var arr = Array.isArray(v) ? v : [v];
                for (var i = 0; i < arr.length; i++) {
                    var np = normPath(arr[i]);
                    if (np && pathIndex[np] === undefined) pathIndex[np] = k;
                }
            }
        }
        return { keySet: keySet, pathIndex: pathIndex, order: order };
    }
    /* 配置表在 config/*.js 里以顶层 const 声明 —— 那是全局「词法」绑定，
       不会成为 window 的属性，故 window.BGM_MAP / window.CG_CONFIG_SUB 读不到；
       必须按裸标识符读取（用 typeof 守卫，兼容未声明的情形），宿主若另有
       同名 window 属性才回退到 window。 */
    function table(name) {
        var v;
        try {
            switch (name) {
                case 'BGM_MAP':        v = (typeof BGM_MAP        !== 'undefined') ? BGM_MAP        : undefined; break;
                case 'BGM_CONFIG':     v = (typeof BGM_CONFIG     !== 'undefined') ? BGM_CONFIG     : undefined; break;
                case 'BGM_CONFIG_SUB': v = (typeof BGM_CONFIG_SUB !== 'undefined') ? BGM_CONFIG_SUB : undefined; break;
                case 'CG_CONFIG':      v = (typeof CG_CONFIG      !== 'undefined') ? CG_CONFIG      : undefined; break;
                case 'CG_CONFIG_SUB':  v = (typeof CG_CONFIG_SUB  !== 'undefined') ? CG_CONFIG_SUB  : undefined; break;
                default: break;
            }
        } catch (e) { /* TDZ：声明了但尚未初始化 */ }
        if (v === undefined && typeof window !== 'undefined' && window) v = window[name];
        return (v && typeof v === 'object') ? v : null;
    }

    /* 表格顺序决定「同路径归属哪个条目」的优先级：鉴赏页实际使用的那张表排在最前 */
    var _bgmIdx = null, _cgIdx = null;
    var _cgLastLocked = -1, _cgLastOpen = -1;   // 仅在数量变化时打一条汇总日志，避免每轮刷屏
    function bgmIdx() {
        if (!_bgmIdx || !_bgmIdx.order.length)
            _bgmIdx = collect([table('BGM_MAP'), table('BGM_CONFIG_SUB'), table('BGM_CONFIG')]);
        return _bgmIdx;
    }
    function cgIdx() {
        if (!_cgIdx || !_cgIdx.order.length)
            _cgIdx = collect([table('CG_CONFIG_SUB'), table('CG_CONFIG')]);
        return _cgIdx;
    }

    /* ── 引擎句柄（惰性解析：本文件可能早于引擎装载） ── */
    function eng() {
        try {
            if (typeof gameEngine !== 'undefined' && gameEngine &&
                typeof gameEngine.playAudio === 'function') return gameEngine;
        } catch (e) { /* TDZ */ }
        var w = window.gameEngine;
        return (w && typeof w.playAudio === 'function') ? w : null;
    }
    /** 只在剧本页记录：鉴赏页自己播 BGM 不算「剧本中播放过」。 */
    function isScenePage(e) {
        if (typeof e.isInScenesFolder === 'function') {
            try { return !!e.isInScenesFolder(); } catch (err) { /* 回落路径判定 */ }
        }
        try { return /\/scenes\//i.test(location.pathname); } catch (err) { return false; }
    }

    /* ── 记录端 ───────────────────────────────────────────── */
    function recordBgm(keyArg) {
        if (!GALLERY_UNLOCK_BGM || !keyArg) return;
        var e = eng();
        if (!e || !isScenePage(e)) return;
        var idx = bgmIdx();
        var hit = idx.keySet[keyArg] ? keyArg : null;
        if (!hit && typeof e.resolveAudioPath === 'function') {
            try {
                var info = e.resolveAudioPath(keyArg);
                if (info && info.path) hit = idx.pathIndex[normPath(info.path)] || null;
            } catch (err) { /* 忽略 */ }
        }
        if (hit && !isUnlocked(PREFIX_BGM, hit)) {
            writeSF(PREFIX_BGM + hit, 1);
            console.log(LOG + ' BGM 已解锁 ' + hit);
        }
    }
    function recordCg(path) {
        if (!GALLERY_UNLOCK_CG || !path) return;
        var e = eng();
        if (!e || !isScenePage(e)) return;
        var hit = cgIdx().pathIndex[normPath(path)];
        if (hit && !isUnlocked(PREFIX_CG, hit)) {
            writeSF(PREFIX_CG + hit, 1);
            console.log(LOG + ' CG 已解锁 ' + hit);
        }
    }

    /** 包装引擎的播放 / 显示方法，只读取参数，不改变任何既有行为。 */
    function wrapEngine() {
        var e = eng();
        if (!e) return false;
        if (e.__shioriGalleryHooked) return true;

        if (GALLERY_UNLOCK_BGM && typeof e.playAudio === 'function') {
            var op = e.playAudio;
            e.playAudio = function (key) {
                try { recordBgm(key); } catch (err) { /* 记录失败不得影响播放 */ }
                return op.apply(this, arguments);
            };
        }
        if (GALLERY_UNLOCK_CG && typeof e.setBackground === 'function') {
            var os = e.setBackground;
            e.setBackground = function (path) {
                try { recordCg(path); } catch (err) { /* 同上 */ }
                return os.apply(this, arguments);
            };
        }
        if (GALLERY_UNLOCK_CG && typeof e.eventShow === 'function') {
            var oe = e.eventShow;
            e.eventShow = function (options) {
                try {
                    var f = options && options.file;
                    var ev = this.sceneData && this.sceneData.events;
                    if (f && ev && ev[f]) recordCg(ev[f]);
                } catch (err) { /* 同上 */ }
                return oe.apply(this, arguments);
            };
        }
        e.__shioriGalleryHooked = true;
        return true;
    }

    /* ── 读取端：样式 ─────────────────────────────────────── */
    function injectCss() {
        if (document.getElementById('shiori-gallery-unlock-style')) return;
        var st = document.createElement('style');
        st.id = 'shiori-gallery-unlock-style';
        st.textContent = [
            /* BGM 锁定按钮：黑底白字，不参与 hover 高亮 */
            '#menu-container .menu-btn.gal-locked{background-color:#000 !important;color:#fff !important;border-color:#fff !important;cursor:default;opacity:.9;}',
            '#menu-container .menu-btn.gal-locked:hover{background-color:#000 !important;color:#fff !important;border-color:#fff !important;}',
            /* CG 锁定格子：黑色遮罩 + 居中白色大写英文 */
            '.cg-cell.gal-locked{position:relative;cursor:default;}',
            '.cg-cell.gal-locked .gal-lock{position:absolute;inset:0;display:flex;align-items:center;' +
            'justify-content:center;background:#000;color:#fff;font-weight:700;' +
            'font-size:calc(18 * var(--u, 1px));letter-spacing:.15em;text-transform:uppercase;' +
            'border-radius:calc(10 * var(--u, 1px));z-index:2;pointer-events:none;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    /* ── 读取端：BGM 鉴赏页 ───────────────────────────────── */
    var BGM_ONCLICK_RE = /playBGM\(\s*['"]([^'"]+)['"]\s*\)/;
    function bgmBtnKey(btn) {
        var raw = btn.getAttribute('data-gal-onclick');
        if (raw == null) raw = btn.getAttribute('onclick') || '';
        var m = String(raw).match(BGM_ONCLICK_RE);
        return m ? m[1] : null;
    }
    function setBgmBtnLocked(btn, locked) {
        if (locked) {
            if (btn.getAttribute('data-gal-locked') === '1') return;   // 已是锁定态，不重复写 DOM
            if (btn.getAttribute('data-gal-text') == null)
                btn.setAttribute('data-gal-text', btn.textContent);
            if (btn.getAttribute('data-gal-onclick') == null)
                btn.setAttribute('data-gal-onclick', btn.getAttribute('onclick') || '');
            btn.classList.add('gal-locked');
            btn.setAttribute('data-gal-locked', '1');
            btn.setAttribute('aria-disabled', 'true');
            btn.removeAttribute('onclick');
            btn.textContent = GALLERY_LOCK_TEXT_BGM;
        } else {
            if (btn.getAttribute('data-gal-locked') !== '1') return;   // 已是解锁态
            btn.classList.remove('gal-locked');
            btn.removeAttribute('data-gal-locked');
            btn.removeAttribute('aria-disabled');
            var t = btn.getAttribute('data-gal-text');
            if (t != null) btn.textContent = t;
            var oc = btn.getAttribute('data-gal-onclick');
            if (oc) btn.setAttribute('onclick', oc);
        }
    }
    function applyBgmMask() {
        if (!GALLERY_UNLOCK_BGM || !document.getElementById('menu-container')) return;
        var btns = document.querySelectorAll('#menu-container .menu-btn');
        for (var i = 0; i < btns.length; i++) {
            var key = bgmBtnKey(btns[i]);
            if (!key) continue;
            setBgmBtnLocked(btns[i], !isUnlocked(PREFIX_BGM, key));
        }
    }
    /** 剧本页 / 鉴赏页共用的按钮顺序（取自页面自身，与皮肤无关）。 */
    function bgmKeyOrder() {
        var out = [], btns = document.querySelectorAll('#menu-container .menu-btn');
        for (var i = 0; i < btns.length; i++) {
            var key = bgmBtnKey(btns[i]);
            if (key) out.push(key);
        }
        return out;
    }
    /** currentPlayerState 在 bgm.html 里是顶层 let，只能按裸标识符读。 */
    function bgmState() {
        try { return currentPlayerState; } catch (e) { return null; }
    }
    function wrapBgm() {
        if (typeof window.playBGM !== 'function') return false;
        if (window.__shioriGalleryBgmWrapped) return true;
        window.__shioriGalleryBgmWrapped = true;

        var origPlay = window.playBGM;
        window.playBGM = function (key) {
            if (!isUnlocked(PREFIX_BGM, key)) {
                console.log(LOG + ' BGM 未解锁，忽略播放请求 ' + key);
                return;
            }
            return origPlay.apply(this, arguments);
        };

        var origNext = window.playNextBGM;
        if (typeof origNext === 'function') {
            window.playNextBGM = function () {
                var st = bgmState();
                if (!st || !st.isListLoop) return;          // 与页面原实现一致：非列表循环不推进
                var keys = bgmKeyOrder();
                if (!keys.length) return origNext.apply(this, arguments);
                var n = keys.length;
                var cur = keys.indexOf(st.currentBgm);
                for (var s = 1; s <= n; s++) {              // 从当前项向后找第一首已解锁的
                    var k = keys[((cur + s) % n + n) % n];
                    if (isUnlocked(PREFIX_BGM, k)) { window.playBGM(k); return; }
                }
                console.log(LOG + ' 列表循环：没有已解锁的 BGM 可播放');
            };
        }
        return true;
    }

    /* ── 读取端：CG 鉴赏页 ────────────────────────────────── */
    function cgMgr() {
        try { return (typeof CGManager !== 'undefined' && CGManager) ? CGManager : null; }
        catch (e) { return null; }     // TDZ：CG.html 的内联脚本尚未执行
    }
    function cgTable() { return table('CG_CONFIG_SUB') || table('CG_CONFIG') || {}; }
    function setCgCellLocked(cell, locked) {
        if (locked === (cell.getAttribute('data-gal-locked') === '1')) return;   // 状态未变，不动 DOM
        if (locked) {
            cell.classList.add('gal-locked');
            cell.setAttribute('data-gal-locked', '1');
            var ov = document.createElement('span');
            ov.className = 'gal-lock';
            ov.textContent = GALLERY_LOCK_TEXT_CG;
            cell.appendChild(ov);
        } else {
            cell.classList.remove('gal-locked');
            cell.removeAttribute('data-gal-locked');
            for (var i = cell.children.length - 1; i >= 0; i--) {
                if (cell.children[i].className === 'gal-lock') cell.removeChild(cell.children[i]);
            }
        }
    }
    function applyCgMask() {
        if (!GALLERY_UNLOCK_CG) return;
        var container = document.getElementById('cg-container');
        if (!container) return;
        var cells = container.querySelectorAll('.cg-cell');
        if (!cells.length) return;
        var nLocked = 0, nOpen = 0, nMissing = 0;
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            var child = cell.firstElementChild;
            var path = (child && child.dataset) ? child.dataset.fullPath : null;
            var key = path ? cgIdx().pathIndex[normPath(path)] : null;
            if (!key) { setCgCellLocked(cell, false); continue; }   // 认不出的格子不加锁
            var locked = !isUnlocked(PREFIX_CG, key);
            setCgCellLocked(cell, locked);
            if (locked) { nLocked++; continue; }
            nOpen++;
            /* 已解锁却仍被判「缺失」：那是页面自己的取图失败（缩略图未到），
               此时格子会变暗且不响应点击 —— 与解锁无关，故单独提示一次，便于区分。 */
            if (cell.getAttribute('data-cg-missing') === '1') {
                nMissing++;
                if (!cell.__galMissingWarned) {
                    cell.__galMissingWarned = 1;
                    console.warn(LOG + ' CG ' + path + ' 已解锁，但页面未取到图（标记 missing）——' +
                        '变暗与不可点是页面的缺失判定，与解锁无关');
                }
            }
        }
        if (nLocked !== _cgLastLocked || nOpen !== _cgLastOpen) {
            _cgLastLocked = nLocked; _cgLastOpen = nOpen;
            console.log(LOG + ' CG 掩码：未解锁 ' + nLocked + ' / 已解锁 ' + nOpen +
                (nMissing ? '（其中 ' + nMissing + ' 格页面取图失败）' : ''));
        }
    }
    /** 从当前索引沿 dir 方向找第一张已解锁的 CG 并放大；全未解锁时不跳转。 */
    function stepCg(mgr, dir) {
        var tb = cgTable();
        var keys = Object.keys(tb);
        var n = keys.length;
        if (!n) return false;
        var cur = (typeof mgr.currentImageIndex === 'number') ? mgr.currentImageIndex : 0;
        for (var s = 1; s <= n; s++) {
            var j = ((cur + dir * s) % n + n) % n;
            var key = cgIdx().pathIndex[normPath(tb[keys[j]])] || keys[j];
            if (isUnlocked(PREFIX_CG, key)) {
                mgr.currentImageIndex = j;
                mgr.showFullImage(String(tb[keys[j]]).split('?')[0]);
                return true;
            }
        }
        console.log(LOG + ' 放大翻页：没有已解锁的 CG 可显示');
        return false;
    }
    function wrapCg() {
        var mgr = cgMgr();
        if (!mgr || typeof mgr.loadCGList !== 'function') return false;
        if (mgr.__shioriGalleryWrapped) return true;
        mgr.__shioriGalleryWrapped = true;

        var origLoad = mgr.loadCGList;
        mgr.loadCGList = function () {
            var r = origLoad.apply(this, arguments);
            try { applyCgMask(); } catch (err) { /* 加锁失败不影响列表渲染 */ }
            return r;
        };
        if (typeof mgr.showFullImage === 'function') {
            var origFull = mgr.showFullImage;
            mgr.showFullImage = function (src) {
                if (GALLERY_UNLOCK_CG) {
                    var key = cgIdx().pathIndex[normPath(src)];
                    if (key && !isUnlocked(PREFIX_CG, key)) {
                        console.log(LOG + ' CG 未解锁，忽略放大请求 ' + key);
                        return;
                    }
                }
                return origFull.apply(this, arguments);
            };
        }
        if (GALLERY_UNLOCK_CG) {
            mgr.showPrevImage = function () { stepCg(this, -1); };
            mgr.showNextImage = function () { stepCg(this, +1); };
        }
        return true;
    }

    /* ── 锁定项点击拦截（捕获阶段，先于页面自身的监听） ────── */
    function onCaptureClick(e) {
        var t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        var locked = (GALLERY_UNLOCK_BGM && t.closest('#menu-container .menu-btn.gal-locked')) ||
                     (GALLERY_UNLOCK_CG && t.closest('#cg-container .cg-cell.gal-locked'));
        if (!locked) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }

    /* ── 启动：装载时可能早于引擎 / 页面脚本，故惰性 + 轮询 ── */
    /* 包装（wrap）只需一次，加锁（mask）每次都要重放：
       运行时解锁状态可能变化（剧本推进写入 sf.、tf.allclear 开关），
       两个 set*Locked 都是幂等的，重复调用不产生多余 DOM 写入。 */
    var wrapped = { engine: false };
    function boot() {
        injectCss();
        if (!wrapped.engine) wrapped.engine = wrapEngine();
        if (GALLERY_UNLOCK_BGM) { wrapBgm(); applyBgmMask(); }
        if (GALLERY_UNLOCK_CG) { wrapCg(); applyCgMask(); }
    }

    /* ── 状态巡检：解锁依据（tf.allclear / sf.clear）在页面存活期间可能被外部改写 ──
       调试菜单「开启全部鉴赏」是往页面注入 JS 改 tf.allclear 承载键，页面不会重载，
       掩码也不会自己重算 —— 于是出现「已经放不了 / 展不开，但缩略图与 BGM 名照旧」。
       下面用「签名比对 + 变化才重放」兜住这条路径：
         · 宿主页有 vars.js 时，setTempAllClear 会派发 shiori:allclearchange，即时响应；
         · html/bgm.html 不注入 vars.js（调试菜单走 sessionStorage 直写分支），
           没有事件可听，故保留一个低频巡检；页面重新可见 / 获得焦点时也会立刻比对一次。
       签名只含两个开关量，不随剧本推进变化，因此巡检几乎不产生额外开销。 */
    function stateSig() {
        var c = readSF('clear');
        return (allClear() ? 'A' : '-') + '|' + ((c === 1 || c === '1' || c === true) ? 'c' : '-');
    }
    var _lastSig = null;
    function watchState(force) {
        var sig = stateSig();
        if (!force && sig === _lastSig) return;
        _lastSig = sig;
        boot();
    }
    function installWatch() {
        window.addEventListener('shiori:allclearchange', function () { watchState(true); });
        window.addEventListener('focus', function () { watchState(false); });
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) watchState(false);
        });
        setInterval(function () { watchState(false); }, 800);
    }

    document.addEventListener('click', onCaptureClick, true);

    var delays = [0, 16, 32, 64, 128, 256, 512, 1000, 1600, 2500, 3000];
    var di = 0;
    (function tick() {
        boot();
        if (di >= delays.length) return;
        setTimeout(tick, delays[di++]);
    })();

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    window.addEventListener('load', boot);

    installWatch();
    _lastSig = stateSig();

    /* ── 对外 API：供剧本 / 调试使用（鉴赏页 UI 不接它，不能在页面里解锁） ── */
    window.ShioriGalleryUnlock = {
        version: '1.1.0',
        bgmEnabled: function () { return !!GALLERY_UNLOCK_BGM; },
        cgEnabled: function () { return !!GALLERY_UNLOCK_CG; },
        allClear: allClear,
        isBgmUnlocked: function (key) { return isUnlocked(PREFIX_BGM, key); },
        isCgUnlocked: function (key) { return isUnlocked(PREFIX_CG, key); },
        unlockBgm: function (key) { if (key) writeSF(PREFIX_BGM + key, 1); applyBgmMask(); },
        unlockCg: function (key) { if (key) writeSF(PREFIX_CG + key, 1); applyCgMask(); },
        refresh: function () { boot(); _lastSig = stateSig(); return this; }
    };
})();
