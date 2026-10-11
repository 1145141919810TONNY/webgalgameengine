/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * UI 皮肤系统：基于角色（ROLES）和部件（PARTS）的动态 CSS 生成、图片预加载与状态管理。
 * 把图放到 assets/ui/{part}_{state}.{webp|png|jpg}，缺图回退 _normal；整 part 都缺则不报错。
 */
/* 全局皮肤规格：null = 使用默认文件名映射（assets/ui/{part}_{state}.{ext}）。
   如需自定义文件名，可参考下方注释中的对象格式（部件 → 文件名茎，或 状态 → 文件名茎映射）。 */
var UI_SKIN = null;
/*
var UI_SKIN = {
    textbox: 'textbox',
    namebox: 'namebox',
    choice: 'choice',
    btn: 'btn',
    auto: { normal: 'auto_off', hover: 'auto_hi', on: 'auto_on' },
    skip1: 'skip1',
    skip2: 'skip2'
};
*/

/* ===== UI 皮肤核心模块（IIFE，挂载到 window.ShioriUISkin / loadUISkin / resetUISkin） ===== */
(function (root) {
    'use strict';

    // PARTS：跨页面复用的通用部件清单，对应 assets/ui/{part}_{state}.{ext} 系列图片
    //   前三行是跨页面的结构部件；后两组是剧本页 HUD / 浮层的**独立皮肤位**——
    //   它们默认共用 `btn` 的图（现状不变），只有放了专属图时才单独生效：
    //   专属规则的选择器带 #id，特异性高于通用的 `html[data-ui-part-btn="on"] .galgame-ui-btn`。
    var PARTS = [
        'textbox', 'namebox', 'novel', 'options', 'choice',
        'btn', 'auto', 'skip1', 'skip2',
        // HUD 按钮组
        'save', 'dropdown', 'dd_item', 'option', 'system', 'log', 'help', 'back', 'quit',
        // 浮层与提示
        'log_panel', 'log_btn', 'log_back', 'toast', 'prompt', 'pov', 'progbar', 'vol'
    ];
    // STATES：各部件支持的状态列表（normal 必有；hover / on 可选，缺图时回退 normal）
    //
    //   注意 textbox / namebox 的 `hover` **不是** CSS `:hover` —— 文本框占屏底约 1/4，
    //   鼠标长期停留在其中，用 `:hover` 会让高亮图变成常态、常态图反而永远看不到。
    //   它们由显式状态标记驱动：文本框见 TEXTBOX_HIGHLIGHT_MODE，姓名框见 nameboxSpeaking()。
    //   choice 的 `on` 同时承担"已选"与"已读"两种语义（.choice-selected / .choice-read）。
    var STATES = {
        textbox: ['normal', 'hover', 'on'],
        namebox: ['normal', 'hover', 'on'],
        novel: ['normal'],
        options: ['normal'],
        choice: ['normal', 'hover', 'on'],
        btn: ['normal', 'hover'],
        auto: ['normal', 'hover', 'on'],
        skip1: ['normal', 'hover', 'on'],
        skip2: ['normal', 'hover', 'on'],
        // ── HUD 按钮组
        save: ['normal', 'hover'],
        dropdown: ['normal', 'hover', 'on'],       // on = 展开态（.show，属面板类）
        dd_item: ['normal', 'hover'],              // 下拉里的 SCENES / MAP / STORY
        option: ['normal', 'hover'],
        system: ['normal', 'hover'],
        log: ['normal', 'hover'],
        help: ['normal', 'hover'],
        back: ['normal', 'hover'],
        quit: ['normal', 'hover'],
        // ── 浮层与提示
        log_panel: ['normal'],                     // 日志浮层底
        log_btn: ['normal', 'hover', 'on'],        // on = 该条语音正在播放
        log_back: ['normal', 'hover'],
        toast: ['normal', 'success', 'error'],     // 快捷保存提示的三种形态
        prompt: ['normal'],                        // 「点击继续」
        pov: ['normal'],                           // POV 视角指示器
        progbar: ['normal'],                       // 语音进度条
        vol: ['normal']                            // 音量浮层
    };

    // 页面角色接口：HTML 元素标 data-ui="角色名"，对应图 assets/ui/{角色}_{状态}.{ext}。
    // normal 必有；hover 可省（回退 normal）；on 在元素带 .active / .playing / .ui-on 时生效。
    // LATE_ROLES 的元素由页面脚本后生成（querySelector 探不到），始终参与探测。
    var ROLES = {
        // 标题页（index.html）
        title_start: ['normal', 'hover'],
        title_save: ['normal', 'hover'],
        title_progress: ['normal', 'hover'],
        title_flow: ['normal', 'hover'],
        title_story: ['normal', 'hover'],
        title_bgm: ['normal', 'hover'],
        title_video: ['normal', 'hover'],
        title_cg: ['normal', 'hover'],
        title_copy: ['normal', 'hover'],
        // 分页面通用
        sub_back: ['normal', 'hover'],
        sub_return: ['normal', 'hover'],
        // 游戏内右键菜单（由 ui/page-chrome.js 注入；全部属"晚生成"角色）
        ctx_backdrop: ['normal'],                  // 遮罩层
        ctx_panel: ['normal', 'hover'],            // 面板底板（展开时带 .show → 见 PANEL_ON_PARTS）
        ctx_item: ['normal', 'hover', 'on', 'disabled'],  // 菜单条目
        ctx_hint: ['normal'],                      // 快捷键提示区
        ctx_sep: ['normal'],                       // 分隔线
        // CG 鉴赏页（CG.html）
        cg_item: ['normal', 'hover'],
        cg_nav: ['normal', 'hover'],
        cg_close: ['normal', 'hover'],
        // BGM 鉴赏页（bgm.html）
        bgm_item: ['normal', 'hover', 'on'],
        bgm_ctrl: ['normal', 'hover', 'on'],
        // 视频鉴赏页（video.html）
        video_item: ['normal', 'hover'],
        video_ctrl: ['normal', 'hover'],
        // 小故事页（story.html）
        story_item: ['normal', 'hover'],
        // 进度管理页（saves.html）
        prog_act: ['normal', 'hover'],
        prog_jump: ['normal', 'hover'],
        // 存档页（archive.html）
        arc_act: ['normal', 'hover'],
        arc_slot: ['normal', 'hover'],
        arc_load: ['normal', 'hover'],
        arc_del: ['normal', 'hover', 'disabled'],   // 置灰时走 _disabled 图
        arc_ow: ['normal', 'hover', 'disabled'],
        // 流程图页（flowchart.html / flowchart_debug.html）
        flow_act: ['normal', 'hover'],
        flow_node: ['normal', 'hover', 'on'],       // on = 当前游玩节点（.current-playing）
        // 版权信息页（copy.html）
        copy_act: ['normal', 'hover'],
        copy_nav: ['normal', 'hover'],
        copy_head: ['normal', 'hover']
    };

    // LATE_ROLES：由页面脚本动态后生成的角色（存档卡、CG 缩略图、流程图节点、右键菜单等），
    // 加载时 DOM 中尚不存在（querySelector 探测不到），因此始终参与图片探测。
    var LATE_ROLES = {
        cg_item: true,
        story_item: true,
        prog_jump: true,
        arc_slot: true,
        arc_load: true,
        arc_del: true,
        arc_ow: true,
        flow_node: true,
        // 右键菜单由 ui/page-chrome.js 注入，菜单还可能被 rebuildSceneChrome() 重建
        ctx_backdrop: true,
        ctx_panel: true,
        ctx_item: true,
        ctx_hint: true,
        ctx_sep: true
    };
    // EXTS：图片扩展名探测优先级（webp 体积最小优先，其次 png、jpg）
    var EXTS = ['webp', 'png', 'jpg'];
    // CONTAINER_PARTS：容器类部件标记（需整体铺满、尺寸注入时跳过固定 vw/vh）
    var CONTAINER_PARTS = {
        textbox: true, namebox: true, novel: true,
        log_panel: true        // 日志浮层：整屏覆盖，按图铺满而不是钉成图片像素
    };

    /* ===== 文本框高亮=================================================
       文本框是**容器**，占屏底约 1/4：用 CSS `:hover` 会让"悬停高亮"事实上永远成立 ——
       常态图反而看不到；而且它走 100% 100% 铺满，不能按 hover 图尺寸改 vw/vh（否则每次
       悬停都会抖动/位移）。所以高亮改用**显式状态标记**写在 <html> 上：

           html[data-ui-part-textbox="on"][data-textbox-state="hl"] #text-box-container { … }

       容器同时会被加上 `.ui-hl` 类，方便作者改用类选择器。

       TEXTBOX_HIGHLIGHT_MODE 四档（作者可在引入 ui_skin.js 之前设 window.TEXTBOX_HIGHLIGHT_MODE）：

           'wait'  等待玩家点击推进时高亮（与 .click-prompt 同步；推进 / 隐藏文本框后复位）
           'hover' 鼠标悬停在文本框范围内时高亮（给"文本框可交互"类皮肤用）
           'read'  打字机进行中高亮（"正在阅读"的视觉反馈）
           'off'   关闭（**当前默认**）

       为什么默认取 off 而不是 wait：若美术给的 textbox_hover 与 textbox_normal 差异很大
       （例如整框换色），wait 档会让对话框长期停在高亮态，观感很跳。作者看过素材、确认
       这是想要的效果后再显式开启即可。只放 textbox_normal 时，四档行为完全一致。
       ======================================================================= */
    var TEXTBOX_HIGHLIGHT_MODE = (function () {
        var m = String((root && root.TEXTBOX_HIGHLIGHT_MODE) || 'off').toLowerCase();
        return (m === 'wait' || m === 'hover' || m === 'read') ? m : 'off';
    })();
    /** 文本框当前高亮态（幂等去重，避免同一状态反复写 DOM） */
    var _textboxHl = false;

    /**
     * 写入 / 清除文本框高亮标记（不做档位过滤，内部与作者均可直接调用）。
     * @param {boolean} on 是否高亮
     * @returns {void}
     */
    function applyTextboxHighlight(on) {
        if (typeof document === 'undefined' || !document.documentElement) return;
        on = !!on;
        if (on === _textboxHl) return;
        _textboxHl = on;
        var html = document.documentElement;
        try {
            if (on) html.setAttribute('data-textbox-state', 'hl');
            else html.removeAttribute('data-textbox-state');
        } catch (e) { /* ignore */ }
        ['text-box-container', 'novel-mode-container'].forEach(function (id) {
            var node = document.getElementById(id);
            if (node && node.classList) {
                if (on) node.classList.add('ui-hl');
                else node.classList.remove('ui-hl');
            }
        });
    }

    /**
     * 文本框高亮状态入口。engine_text.js 在触发点调用，按当前档位过滤：
     * 只有与档位同源的信号（source）才生效，避免多个触发源互相打架。
     * @param {boolean} on 是否进入高亮
     * @param {string} [source] 触发源：'wait'（等待点击）/ 'read'（打字中）；省略=直接生效
     * @returns {void}
     */
    function textboxHighlight(on, source) {
        if (TEXTBOX_HIGHLIGHT_MODE === 'off') return;
        if (source && source !== TEXTBOX_HIGHLIGHT_MODE) return;
        applyTextboxHighlight(on);
    }

    /**
     * 姓名框 `on` 态：**该说话人正在发声**（voice-player 播放中）。
     * 姓名框没有 speaker 时是 display:none，悬停无从谈起，所以它的高亮语义取"正在发声"。
     * @param {boolean} on 是否正在发声
     * @returns {void}
     */
    function nameboxSpeaking(on) {
        if (typeof document === 'undefined') return;
        var box = document.getElementById('name-box');
        if (!box || !box.classList) return;
        if (on) box.classList.add('ui-on');
        else box.classList.remove('ui-on');
    }

    // 'hover' 档：ui_skin.js 早于 page-chrome.js 装载（此时 #text-box-container 尚不存在），
    // 所以用 document 上的委托监听，不依赖容器已就绪。
    function bindTextboxHover() {
        if (TEXTBOX_HIGHLIGHT_MODE !== 'hover') return;
        if (typeof document === 'undefined' || !document.addEventListener) return;
        function inside(node) {
            if (!node || node === document) return false;
            if (typeof node.closest === 'function') return !!node.closest('#text-box-container');
            while (node && node.nodeType === 1) {
                if (node.id === 'text-box-container') return true;
                node = node.parentNode;
            }
            return false;
        }
        document.addEventListener('mouseover', function (e) {
            if (inside(e.target)) applyTextboxHighlight(true);
        }, true);
        document.addEventListener('mouseout', function (e) {
            if (inside(e.target) && !inside(e.relatedTarget)) applyTextboxHighlight(false);
        }, true);
    }

    /**
     * 净化文件名茎（stem），防止路径穿越和非法字符
     * @param {*} value - 待检查的值
     * @returns {string} 合法的茎，或空字符串表示无效
     */
    function sanitizeStem(value) {
        if (typeof value !== 'string') return '';
        var s = value.trim();
        if (!s || s.length > 80) return '';
        if (/[.\/\\?#&%]/.test(s)) return '';
        if (s.indexOf('..') !== -1) return '';
        if (/\s/.test(s)) return '';
        if (!/^[A-Za-z0-9_\u4e00-\u9fff-]+$/.test(s)) return '';
        return s;
    }

    /**
     * 根据部件名、状态和皮肤规格计算图片文件名
     * @param {string} part - 部件名（如 'textbox', 'btn'）
     * @param {string} state - 状态名（如 'normal', 'hover', 'on'）
     * @param {object|null} spec - 皮肤规格（UI_SKIN 对象）
     * @returns {string} 文件名（不含扩展名），如 'btn_normal'
     */
    function fileBody(part, state, spec) {
        var override = spec && typeof spec === 'object' ? spec[part] : null;
        if (typeof override === 'string') {
            var stem = sanitizeStem(override);
            return stem ? stem + '_' + state : '';
        }
        if (override && typeof override === 'object' && typeof override[state] === 'string') {
            return sanitizeStem(override[state]);
        }
        return part + '_' + state;
    }

    /**
     * 将 URL 转为 CSS url() 函数格式，转义反斜杠和引号
     * @param {string} url - 图片路径
     * @returns {string} CSS url() 字符串
     */
    function cssUrl(url) {
        return 'url("' + String(url).replace(/\\/g, '/').replace(/"/g, '') + '")';
    }

    /**
     * 由尺寸表条目拼出图片 URL（预加载与 CSS 生成必须用同一个扩展名）。
     *
     * 扩展名取自条目的 `ext` 字段 —— 构建期由 `tools/measure_ui.js` 从真实文件读出来写进表。
     * 缺省 `'png'`（表没有 ext 字段时行为不变）。
     *
     * **运行时不做任何扩展名探测**：表即真相。预加载与探测必须用同一个扩展名 ——
     * 只放 `auto_normal.webp` 而扩展名不一致时，预加载会 404，首次悬停仍要等下载。
     *
     * @param {string} body 文件名茎（如 'auto_normal'）
     * @param {object} cfg 尺寸表条目
     * @returns {string} 形如 '/assets/ui/auto_normal.webp'
     */
    function assetUrl(body, cfg) {
        var ext = cfg && cfg.ext ? String(cfg.ext).replace(/[^A-Za-z0-9]/g, '').toLowerCase() : '';
        return '/assets/ui/' + body + '.' + (ext || 'png');
    }

    /**
     * 部件的 CSS 自定义属性名：`--ui-{part}-{suffix}`，**部件名里的下划线换成连字符**。
     *
     * 两套写法的分工（别再混）：
     *   文件名        log_panel_normal.webp     ← 下划线（文件名茎就是表里的键）
     *   CSS 变量      --ui-log-panel-normal     ← 连字符
     *   data 属性     data-ui-part-log-panel    ← 连字符
     * 单字部件（textbox / btn / auto …）两者完全相同，所以这个转换只对
     * log_panel / dd_item / log_btn / log_back 这类多字部件有意义。
     *
     * @param {string} part 部件名
     * @param {string} [suffix] 状态名或 'bg'
     * @returns {string} 形如 '--ui-log-panel-normal'
     */
    function partVar(part, suffix) {
        return '--ui-' + String(part).replace(/_/g, '-') + (suffix ? '-' + suffix : '');
    }

    /**
     * 在元素上同时设置 dataset 属性和 data-* 特性（兼容旧浏览器）
     * @param {Element} el - 目标元素
     * @param {string} camelName - 驼峰命名（如 'uiPartTextbox'）
     * @param {string} value - 属性值
     */
    function setData(el, camelName, value) {
        if (!el) return;
        if (el.dataset) el.dataset[camelName] = value;
        if (typeof el.setAttribute === 'function') {
            var attr = 'data-' + camelName.replace(/[A-Z]/g, function (c) {
                return '-' + c.toLowerCase();
            });
            el.setAttribute(attr, value);
        }
    }

    // 渐进重试探测：WebView2 页面切换后资源可能尚未就绪（尤其是返回主菜单时），
    // 按 4 次递增延迟重试（200ms → 500ms → 1s → 2s）。
    var PROBE_DELAYS = [200, 500, 1000, 2000];

    /**
     * 默认图片探测函数：通过 new Image() 加载图片，失败时渐进重试（200ms→500ms→1s→2s）
     * 若无 Image 对象则回退到 fetch API
     * @param {string} url - 图片 URL
     * @returns {Promise<{ok: boolean, width: number, height: number}>}
     */
    function defaultProbe(url) {
        if (typeof Image === 'undefined') {
            if (typeof fetch === 'function') {
                return fetch(url, { method: 'GET', cache: 'no-store' })
                    .then(function (r) {
                        return r.ok ? { ok: true, width: 0, height: 0 } : { ok: false, width: 0, height: 0 };
                    })
                    .catch(function () { return { ok: false, width: 0, height: 0 }; });
            }
            return Promise.resolve({ ok: false, width: 0, height: 0 });
        }
        return new Promise(function (resolve) {
            var attempt = 0;
            function tryLoad() {
                var img = new Image();
                img.onload = function () {
                    resolve({
                        ok: true,
                        width: img.naturalWidth || img.width || 0,
                        height: img.naturalHeight || img.height || 0
                    });
                };
                img.onerror = function () {
                    attempt++;
                    if (attempt >= PROBE_DELAYS.length) {
                        resolve({ ok: false, width: 0, height: 0 });
                        return;
                    }
                    setTimeout(tryLoad, PROBE_DELAYS[attempt]);
                };
                img.src = url;
            }
            tryLoad();
        });
    }

    /**
     * 用指定的探测函数安全地探测 URL，捕获所有异常
     * @param {Function} probe - 探测函数
     * @param {string} url - 待探测的 URL
     * @returns {Promise<{ok: boolean, width: number, height: number}>}
     */
    function probeUrl(probe, url) {
        try {
            return Promise.resolve(probe(url)).then(function (result) {
                if (result && typeof result === 'object') return result;
                return { ok: !!result, width: 0, height: 0 };
            }, function () { return { ok: false, width: 0, height: 0 }; });
        } catch (e) {
            return Promise.resolve({ ok: false, width: 0, height: 0 });
        }
    }

    /**
     * 按扩展名优先级（webp → png → jpg）解析图片文件，返回首个可加载的 URL 及尺寸
     * @param {string} body - 文件名（不含扩展名）
     * @param {Function} probe - 探测函数
     * @returns {Promise<{url: string, width: number, height: number}>}
     */
    function resolveBody(body, probe) {
        if (!body) return Promise.resolve({ url: '', width: 0, height: 0 });
        var i = 0;
        function next() {
            if (i >= EXTS.length) return Promise.resolve({ url: '', width: 0, height: 0 });
            var url = '/assets/ui/' + body + '.' + EXTS[i];
            i += 1;
            return probeUrl(probe, url).then(function (result) {
                return result.ok ? { url: url, width: result.width, height: result.height } : next();
            });
        }
        return next();
    }

    /**
     * 获取当前皮肤规格：优先用 opts.spec，其次用全局 UI_SKIN
     * @param {object} [opts] - 选项
     * @returns {object|null} 皮肤规格对象或 null
     */
    function currentSpec(opts) {
        if (opts && Object.prototype.hasOwnProperty.call(opts, 'spec')) return opts.spec;
        if (typeof root.UI_SKIN !== 'undefined') return root.UI_SKIN;
        return null;
    }

    /**
     * 将解析到的图片 URL 应用到元素上：设置 CSS 自定义属性（--ui-{part}-normal/hover/on）和 data 标记
     * @param {Element} el - 目标元素（通常是 document.documentElement）
     * @param {string} part - 部件名
     * @param {object} urls - 各状态图片信息 { normal, hover, on, disabled, … }
     * @returns {object|false} 各状态尺寸信息，无 normal 图时返回 false
     */
    function applyPart(el, part, urls) {
        var normalInfo = urls.normal;
        if (!normalInfo || !normalInfo.url) return false;
        var normal = normalInfo.url;
        el.style.setProperty(partVar(part, 'normal'), cssUrl(normal));

        // 按 STATES[part] 声明逐状态写变量：缺图的槽位回退为 normal 图，
        // 这样 CSS 里 `var(--ui-x-hover)` 永远不会是空值（不会出现隐形/无背景）。
        var dims = { normal: { width: normalInfo.width || 0, height: normalInfo.height || 0 } };
        (STATES[part] || ['normal']).forEach(function (state) {
            if (state === 'normal') return;
            var info = urls[state] || normalInfo;
            el.style.setProperty(partVar(part, state), cssUrl(info.url || normal));
            dims[state] = { width: info.width || 0, height: info.height || 0 };
        });

        // 容器类额外提供 --ui-{part}-bg（ui_skin.css 里 textbox/namebox/novel/log_panel 消费它）
        if (CONTAINER_PARTS[part]) {
            el.style.setProperty(partVar(part, 'bg'), cssUrl(normal));
        }
        // 启用标记：权威属性名是 `data-ui-part-{part}`，且**下划线换成连字符**
        // （部件名 log_panel / dd_item / log_btn / log_back 都含下划线，
        //  属性名写成 data-ui-part-log_panel 会与 CSS / 作者文档里的写法不一致）。
        // 同时保留 setData 的驼峰 dataset 镜像，兼容既有调用。
        var camel = 'uiPart' + part.charAt(0).toUpperCase() + part.slice(1);
        setData(el, camel, 'on');
        try { el.setAttribute('data-ui-part-' + part.replace(/_/g, '-'), 'on'); } catch (e) { /* ignore */ }
        return dims;
    }

    // 角色皮肤 CSS 规则注入的目标 <style> 节点 ID（幂等，避免重复创建）
    var ROLE_STYLE_ID = 'shiori-ui-role-skin';

    /* debug 构建判定（与 ui/page-chrome.js 同源）：宿主注入 __SHIORI_DEBUG_BUILD，
       浏览器直开回退 ?debug=1。
       用途：无 UI_SIZE_CONFIG 时是否允许走降级探测路径。探测最坏是
       「98 个槽位 × 3 种扩展名 + 4 次渐进重试」，只该在排错时用 ——
       release 构建下直接跳过探测、保持 style.css 默认 CSS。 */
    var IS_DEBUG_BUILD = (function () {
        try {
            if (root && typeof root.__SHIORI_DEBUG_BUILD === 'boolean') return root.__SHIORI_DEBUG_BUILD;
            if (typeof location !== 'undefined' && location.search) {
                return new URLSearchParams(location.search).get('debug') === '1';
            }
        } catch (e) { /* ignore */ }
        return false;
    })();

    // 基准分辨率 1920×1080。
    // 宽用 vw（相对视口宽），高用 vh（相对视口高），
    // 1920×1080 时元素恰好 = 图片原始像素；其他分辨率随窗口等比缩放。
    // 例：442×64 图片 → width:23.0208vw height:5.9259vh
    //   1920×1080 窗口 → 442×64px（原始像素 1:1）
    //   1280×720  窗口 → 295×43px（等比缩小，比例不变）
    var BASE_W = 1920;
    var BASE_H = 1080;

    /**
     * 根据图片尺寸生成 vw/vh 响应式 CSS 片段（基于 1920×1080 基准分辨率）
     * @param {{width: number, height: number}} info - 图片尺寸信息
     * @returns {string} CSS 样式片段
     */
    function sizeCssForState(info) {
        var w = info && info.width || 0;
        var h = info && info.height || 0;
        if (w > 0 && h > 0) {
            return 'width:' + (w / BASE_W * 100).toFixed(4) + 'vw!important;'
                + 'height:' + (h / BASE_H * 100).toFixed(4) + 'vh!important;'
                + 'background-size:100% 100%!important;';
        }
        return 'background-size:100% 100%!important;';
    }

    /* ===== 状态选择器词表============================================
       `_on` 图的触发选择器必须覆盖引擎实际在用的激活类名：
       `.skip-active` / `.current-playing` / `.current-playing-highlight` /
       `.locked` / `.disabled` / `.show` / `.has-thumbnail` / `.video-playing`。

       放宽白名单会让 `_on` 图的触发点变多。其中 `.show`（"容器可见"）语义特别宽，
       任何"一显示就常亮"的元素都会误命中，所以它**不进通用白名单**，只按部件加给
       面板类（PANEL_ON_PARTS）。

       状态后缀 `_disabled` / `_selected` / `_locked`：各自有固定触发选择器。
       ======================================================================= */
    var ON_STATE_SELECTORS = [
        '.active', '.playing', '.ui-on',
        '.skip-active',                       // SKIP 快进进行中
        '.current-playing',                   // 流程图当前游玩节点 / BGM 当前曲目
        '.current-playing-highlight',
        '.locked', '.disabled', '[disabled]', // 置灰（存档删除等）
        '.selected',                          // 通用已选
        '.video-playing',
        '.has-thumbnail'
    ];
    // 面板类部件/角色：额外允许 `.show`（展开态）触发 `_on` 图
    var PANEL_ON_PARTS = { dropdown: true, ctx_panel: true, copy_head: true, ctx_hint: true };

    /** 状态 → 触发选择器后缀（normal / hover 单独处理） */
    var STATE_SELECTORS = {
        on: ON_STATE_SELECTORS,
        disabled: ['.disabled', '.locked', '[disabled]'],
        locked: ['.locked'],
        selected: ['.selected', '.choice-selected', '.choice-read'],
        // 快捷保存提示（toast）的两种结果形态
        success: ['.success', '.quick-save-success'],
        error: ['.error', '.quick-save-error']
    };

    /**
     * 求某状态在某基选择器上的全部触发选择器。
     * @param {string} owner 部件名或角色名（用于 PANEL_ON_PARTS 判定）
     * @param {string} state 状态名
     * @param {string} baseSel 基选择器
     * @returns {string[]} 选择器数组；状态词不认识时返回空数组
     */
    function stateSelectors(owner, state, baseSel) {
        if (state === 'normal') return [baseSel];
        if (state === 'hover') return [baseSel + ':hover'];
        var list = STATE_SELECTORS[state];
        if (!list) return [];
        var sels = list.map(function (suffix) { return baseSel + suffix; });
        if (state === 'on' && PANEL_ON_PARTS[owner]) sels.push(baseSel + '.show');
        return sels;
    }

    /** 把选择器数组拼成 CSS 规则（空数组 = 不生成） */
    function cssRule(selectors, body) {
        if (!selectors || !selectors.length || !body) return '';
        return selectors.join(',') + '{' + body + '}';
    }

    // BGM 页例外：bgm.html 中即使有皮肤图也保留原文字
    var _hideText = !(typeof location !== 'undefined' && location.pathname &&
        location.pathname.toLowerCase().indexOf('bgm.html') >= 0);

    /* ===== 文字保留规则===============================================
       `_hideText === true` 时，命中的元素会被加上 color:transparent / font-size:0 ——
       即"贴了皮肤图就隐藏原文字"，因为图里已经烤好了文案。

       但选项框不能这么处理：`.choice-btn` 的文字是**脚本动态写入**的
       （engine_text.js：button.textContent = choice.text），选项内容来自剧本，
       图上不可能自带。所以选项框（choice）与选项容器（options）必须保留文字 ——
       与 bgm.html 曲目列表的处理保持一致（那边是页面级例外，这里是部件级）。

       代价：作者若在 choice_normal 图上自己烤了字，会出现"图上的字 + DOM 的字"
       双重叠加。请在作者文档里写明"选项框请提供无字底图"。
       ======================================================================= */
    var KEEP_TEXT_PARTS = {
        choice: true, options: true,      // 选项文字来自剧本，图上不可能自带
        novel: true, textbox: true, namebox: true,
        // 下列部件承载**动态文字**，贴图后必须保留 DOM 文字，否则内容会消失：
        toast: true,      // 快捷保存提示（"已快速保存 / 未选中存档"…）
        vol: true,        // 音量浮层（显示当前音量百分比）
        pov: true,        // POV 视角指示器（显示角色名）
        log_panel: true,  // 日志浮层（整段历史文本）
        dd_item: true     // 下拉条目（SCENES / MAP / STORY 三个不同文案共用一张图）
    };
    /** 角色侧的文字保留名单（本期为空，预留） */
    var KEEP_TEXT_ROLES = {};

    /**
     * 该部件/角色的原文字是否应当隐藏。
     * @param {string} owner 部件名或角色名
     * @param {boolean} [isRole] true 表示 owner 是角色名
     * @returns {boolean} true = 隐藏原文字（贴图自带文案）
     */
    function shouldHideText(owner, isRole) {
        if (!_hideText) return false;                                  // 页面级例外（bgm.html）
        if (isRole ? KEEP_TEXT_ROLES[owner] : KEEP_TEXT_PARTS[owner]) return false;  // 部件级例外
        return true;
    }

    /** 隐藏原文字的 CSS 片段 */
    var HIDE_TEXT_CSS = 'color:transparent!important;text-shadow:none!important;'
        + 'font-size:0!important;line-height:0!important;';

    /**
     * 为指定角色构建完整的 CSS 规则字符串（含 normal/hover/on 及各状态后缀）
     * @param {string} role - 角色名（对应 data-ui 属性值）
     * @param {object} urls - 各状态图片信息 { normal, hover, on, disabled, ... }
     * @returns {string} CSS 规则字符串，无 normal 图时返回空字符串
     */
    function buildRoleCss(role, urls) {
        var sel = '[data-ui="' + role + '"]';
        var normalInfo = urls.normal;
        var normalUrl = normalInfo && normalInfo.url;
        if (!normalUrl) return '';
        var hoverInfo = urls.hover || normalInfo;
        var hoverUrl = (hoverInfo && hoverInfo.url) || normalUrl;

        var baseCss = 'background-color:transparent!important;border-color:transparent!important;'
            + 'background-repeat:no-repeat!important;background-position:center!important;';

        // 有皮肤图时隐藏原有文字（BGM 页整页例外 + 部件级例外）
        if (shouldHideText(role, true)) baseCss += HIDE_TEXT_CSS;

        // normal 状态
        var css = cssRule([sel], baseCss + sizeCssForState(normalInfo)
            + 'background-image:url("' + normalUrl + '")!important;');

        // hover 状态：如果图片尺寸不同，div 跟着变
        css += cssRule([sel + ':hover'], sizeCssForState(hoverInfo)
            + 'background-image:url("' + hoverUrl + '")!important;');

        // 其余状态：只在「该状态已声明、图确实存在且与 normal 不同」时生成，避免无谓规则
        var declared = rangeStates(role);
        Object.keys(urls).forEach(function (state) {
            if (state === 'normal' || state === 'hover') return;
            if (!declared[state]) return;
            var info = urls[state];
            var url = info && info.url;
            if (!url || url === normalUrl) return;
            css += cssRule(stateSelectors(role, state, sel),
                sizeCssForState(info) + 'background-image:url("' + url + '")!important;');
        });
        return css;
    }

    /**
     * 该角色声明了哪些状态（ROLES[role]）→ 便于校验，未知角色返回空对象。
     * @param {string} role 角色名
     * @returns {object} { 状态名: true }
     */
    function rangeStates(role) {
        var declared = ROLES[role] || [];
        var map = {};
        declared.forEach(function (s) { map[s] = true; });
        return map;
    }

    // PARTS 尺寸注入：扫描页面 CSS 找到使用 var(--ui-{part}-*) 的选择器，
    // 对这些选择器注入 vw/vh 尺寸规则，使 PARTS 也按图片原始像素等比缩放。
    // 容器类（textbox / namebox / novel）跳过 — 它们需要 100% 铺满，不适合固定尺寸。
    /**
     * PARTS 尺寸注入：扫描页面已有 CSS 规则，找到使用 var(--ui-{part}-*) 的选择器，
     * 对这些选择器注入 vw/vh 尺寸规则，使 PARTS 也按图片原始像素等比缩放。
     * 容器类（textbox/namebox/novel）跳过——它们需要 100% 铺满，不适合固定尺寸。
     * @param {object} partDims - 各部件的尺寸信息
     * @returns {string} 生成的 CSS 字符串
     */
    function buildPartsCss(partDims) {
        if (typeof document === 'undefined' || !document.styleSheets) return '';
        var css = '';
        PARTS.forEach(function (part) {
            if (CONTAINER_PARTS[part]) return;
            var dims = partDims[part];
            if (!dims || !dims.normal || !dims.normal.width || !dims.normal.height) return;

            var varName = partVar(part, 'normal');
            var selectors = [];
            try {
                for (var si = 0; si < document.styleSheets.length; si++) {
                    var sheet = document.styleSheets[si];
                    try {
                        var rules = sheet.cssRules || sheet.rules;
                        if (!rules) continue;
                        for (var ri = 0; ri < rules.length; ri++) {
                            var rule = rules[ri];
                            if (rule.type !== 1) continue; // CSSStyleRule only
                            if (rule.style && rule.style.cssText.indexOf(varName) >= 0) {
                                selectors.push(rule.selectorText);
                            }
                        }
                    } catch (e) { /* cross-origin stylesheet */ }
                }
            } catch (e) { return; }
            if (!selectors.length) return;

            var sel = selectors.join(',');
            var hideTextCss = shouldHideText(part, false) ? HIDE_TEXT_CSS : '';
            css += cssRule([sel], sizeCssForState(dims.normal) + hideTextCss);
            if (dims.hover && dims.hover.width && dims.hover.height) {
                css += cssRule([sel + ':hover'], sizeCssForState(dims.hover));
            }
            // 其余状态（on / disabled / selected …）各自按词表展开触发选择器
            Object.keys(dims).forEach(function (state) {
                if (state === 'normal' || state === 'hover') return;
                var info = dims[state];
                if (!info || !info.width || !info.height) return;
                css += cssRule(stateSelectors(part, state, sel), sizeCssForState(info));
            });
        });
        return css;
    }

    // 角色探测：先探 normal，命中才补 hover / on。规则写进单个 <style>，
    // 晚生成的元素（存档卡、CG 缩略图等）由 CSS 自动命中，无需重跑 JS。
    /**
     * 角色探测入口：先探 normal 状态，命中后才补探 hover/on。
     * 结果写入单个 <style id="shiori-ui-role-skin"> 节点，晚生成的元素由 CSS 自动命中。
     * @param {Function} probe - 探测函数
     * @param {object|null} spec - 皮肤规格
     * @param {object} [partDims] - PARTS 尺寸信息
     * @returns {Promise<object>} 已发现的角色映射
     */
    function applyRoles(probe, spec, partDims) {
        if (typeof document === 'undefined') return Promise.resolve({});
        var roles = Object.keys(ROLES).filter(function (role) {
            if (LATE_ROLES[role]) return true;
            try {
                return !!document.querySelector('[data-ui="' + role + '"]');
            } catch (e) {
                return false;
            }
        });
        var found = {};
        return Promise.all(roles.map(function (role) {
            return resolveBody(fileBody(role, 'normal', spec), probe).then(function (normalResult) {
                if (!normalResult.url) return null;
                var urls = { normal: normalResult };
                return Promise.all(ROLES[role].map(function (state) {
                    if (state === 'normal') return null;
                    return resolveBody(fileBody(role, state, spec), probe).then(function (result) {
                        if (result.url) urls[state] = result;
                    });
                })).then(function () {
                    found[role] = urls;
                });
            });
        })).then(function () {
            var css = buildPartsCss(partDims || {});
            Object.keys(found).forEach(function (role) { css += buildRoleCss(role, found[role]); });
            if (!css) return found;
            var style = document.getElementById(ROLE_STYLE_ID);
            if (!style) {
                style = document.createElement('style');
                style.id = ROLE_STYLE_ID;
                (document.head || document.documentElement).appendChild(style);
            }
            style.textContent = css;
            return found;
        }).catch(function () {
            return found;
        });
    }

    // 预加载所有引用的图片：CSS background-image 是懒加载的，hover 图只有在鼠标悬停时
    // 才开始下载，首次悬停会有延迟甚至失败。用 new Image() 提前加载进浏览器缓存。
    /**
     * 预加载单张图片，失败时自动重试（最多 maxAttempts 次，间隔 300ms）
     * @param {string} url - 图片 URL
     * @param {number} [maxAttempts=2] - 最大尝试次数
     * @returns {Promise<{url: string, ok: boolean}>}
     */
    function preloadImage(url, maxAttempts) {
        maxAttempts = maxAttempts || 2;
        return new Promise(function (resolve) {
            var attempt = 0;
            function tryLoad() {
                var img = new Image();
                img.onload = function () { resolve({ url: url, ok: true }); };
                img.onerror = function () {
                    attempt++;
                    if (attempt < maxAttempts) {
                        setTimeout(tryLoad, 300);
                    } else {
                        resolve({ url: url, ok: false });
                    }
                };
                img.src = url;
            }
            tryLoad();
        });
    }

    /**
     * 批量预加载所有已配置的图片（ROLES + PARTS），去重后并行加载
     * @param {object} config - 尺寸配置表（UI_SIZE_CONFIG）
     * @param {object|null} spec - 皮肤规格
     * @returns {Promise<Array<{url: string, ok: boolean}>>}
     */
    function preloadAllImages(config, spec) {
        var urls = [];
        var seen = {};

        Object.keys(ROLES).forEach(function (role) {
            ROLES[role].forEach(function (state) {
                var body = fileBody(role, state, spec);
                if (body && config[body]) {
                    var cfg = config[body];
                    var w = parseInt(cfg.sizex, 10);
                    var h = parseInt(cfg.sizey, 10);
                    if (w > 0 && h > 0) {
                        // 与 applyPreloaded 用同一个扩展名，否则预加载暖不到 CSS 要用的那个 URL
                        var url = assetUrl(body, cfg);
                        if (!seen[url]) { seen[url] = true; urls.push(url); }
                    }
                }
            });
        });

        PARTS.forEach(function (part) {
            STATES[part].forEach(function (state) {
                var body = fileBody(part, state, spec);
                if (body && config[body]) {
                    var cfg = config[body];
                    var w = parseInt(cfg.sizex, 10);
                    var h = parseInt(cfg.sizey, 10);
                    if (w > 0 && h > 0) {
                        // 与 applyPreloaded 用同一个扩展名，否则预加载暖不到 CSS 要用的那个 URL
                        var url = assetUrl(body, cfg);
                        if (!seen[url]) { seen[url] = true; urls.push(url); }
                    }
                }
            });
        });

        if (!urls.length) return Promise.resolve([]);

        return Promise.all(urls.map(function (url) {
            return preloadImage(url).then(function (result) {
                if (!result.ok && typeof console !== 'undefined') {
                    console.warn('[UISkin] 图片加载失败: ' + url);
                }
                return result;
            });
        }));
    }

    // 预加载路径：C# HttpServer 注入 ui_size.js 配置（UI_SIZE_CONFIG）。
    // JS 直接读取生成 CSS，零网络探测。生成 CSS 后主动预加载所有图片进缓存。
    /**
     * 预加载路径：使用 C# HttpServer 注入的 UI_SIZE_CONFIG 直接生成 CSS，无需网络探测。
     * 生成 CSS 后主动预加载所有图片进浏览器缓存，3 秒超时后 resolve。
     * @param {object} config - 尺寸配置表
     * @param {Element} el - 目标元素（通常为 document.documentElement）
     * @returns {Promise<boolean>|undefined} 预加载完成后 resolve true
     */
    function applyPreloaded(config, el) {
        var spec = currentSpec();
        var partDims = {};

        // 辅助函数：解析尺寸值（数字或 '#'）
        function parseDim(value, defaultVal) {
            if (value === '#' || value === null || value === undefined) return defaultVal;
            var num = parseInt(value, 10);
            return isNaN(num) ? defaultVal : num;
        }

        // 辅助函数：解析位置/缩放（百分比字符串或 '#'）
        function parsePercent(value) {
            if (value === '#' || value === null || value === undefined) return null;
            if (typeof value === 'string' && value.indexOf('%') >= 0) {
                return value;
            }
            return value + '%';
        }

        // PARTS：从配置查尺寸，设 CSS 变量
        PARTS.forEach(function (part) {
            var urls = {};
            STATES[part].forEach(function (state) {
                var body = fileBody(part, state, spec);
                if (body && config[body]) {
                    var cfg = config[body];
                    var w = parseDim(cfg.sizex, 0);
                    var h = parseDim(cfg.sizey, 0);
                    if (w > 0 && h > 0) {
                        urls[state] = {
                            url: assetUrl(body, cfg),
                            width: w,
                            height: h
                        };
                    }
                }
            });
            if (urls.normal) {
                var dims = applyPart(el, part, urls);
                if (dims) partDims[part] = dims;
            }
        });

        // ROLES：从配置查尺寸，生成 CSS 规则（含 x/y/zoom）
        var css = buildPartsCss(partDims);
        Object.keys(ROLES).forEach(function (role) {
            var urls = {};
            var normalCfg = null;
            ROLES[role].forEach(function (state) {
                var body = fileBody(role, state, spec);
                if (body && config[body]) {
                    var cfg = config[body];
                    var w = parseDim(cfg.sizex, 0);
                    var h = parseDim(cfg.sizey, 0);
                    if (w > 0 && h > 0) {
                        urls[state] = {
                            url: assetUrl(body, cfg),
                            width: w,
                            height: h
                        };
                        if (state === 'normal') normalCfg = cfg;
                    }
                }
            });
            if (urls.normal) {
                css += buildRoleCss(role, urls);
                // 如果有 x/y/zoom 配置，追加定位和缩放规则
                if (normalCfg) {
                    var x = parsePercent(normalCfg.x);
                    var y = parsePercent(normalCfg.y);
                    var zoom = parsePercent(normalCfg.zoom);
                    var sel = '[data-ui="' + role + '"]';
                    var posCss = '';
                    // x/y 需要 fixed 定位才能相对于屏幕生效
                    if (x !== null || y !== null) posCss += 'position:fixed!important;';
                    if (x !== null) posCss += 'left:' + x + '!important;';
                    if (y !== null) posCss += 'top:' + y + '!important;';
                    if (zoom !== null) posCss += 'transform:scale(' + (parseInt(zoom, 10) / 100) + ')!important;';
                    if (posCss) css += sel + '{' + posCss + '}';
                }
            }
        });

        if (css) {
            var style = document.getElementById(ROLE_STYLE_ID);
            if (!style) {
                style = document.createElement('style');
                style.id = ROLE_STYLE_ID;
                (document.head || document.documentElement).appendChild(style);
            }
            style.textContent = css;
        }

        setData(el, 'uiSkin', 'on');

        // CSS 已注入，主动预加载所有图片（含 hover）进浏览器缓存
        // 返回 Promise：图片预加载完成或 3 秒超时后 resolve
        var preloadPromise = preloadAllImages(config, spec);
        var timeoutPromise = new Promise(function (resolve) {
            setTimeout(function () { resolve([]); }, 3000);
        });

        return Promise.race([preloadPromise, timeoutPromise]).then(function () {
            return true;
        });
    }

    // system.js 的显式调用与分页面自启动共享同一个 Promise，探测只跑一次。
    // 若结果为空（全部探测失败），重置 Promise，允许下次调用重新探测。
    var startedPromise = null;

    /**
     * 加载 UI 皮肤入口（单例 Promise）。system.js 的显式调用与分页面自启动共享同一个 Promise，探测只跑一次。
     * @param {object} [opts] - 选项，forceReload=true 时丢弃旧结果强制重新探测
     * @returns {Promise<object>} 探测结果映射
     */
    function loadUISkin(opts) {
        // forceReload: 丢弃旧 Promise，强制重新探测（用于手动重试）
        if (opts && opts.forceReload) {
            startedPromise = null;
            root.__SHIORI_UISKIN_AUTO_RAN = false;
        }
        if (startedPromise) return startedPromise;
        startedPromise = runUISkin(opts).then(function (result) {
            // 如果什么都没探测到，重置 Promise，让下次调用（system.js 等）可以重试
            if (!result || Object.keys(result).length === 0) {
                startedPromise = null;
            }
            return result;
        });
        return startedPromise;
    }

    // 外部可调用：强制重置并重新探测
    /**
     * 强制重置 UI 皮肤：清除缓存 Promise、移除已注入的角色样式节点，然后重新探测
     * @returns {Promise<object>} 重新探测的结果
     */
    function resetUISkin() {
        startedPromise = null;
        root.__SHIORI_UISKIN_AUTO_RAN = false;
        // 清除已注入的角色样式
        if (typeof document !== 'undefined') {
            var old = document.getElementById(ROLE_STYLE_ID);
            if (old && old.parentNode) old.parentNode.removeChild(old);
        }
        return loadUISkin();
    }

    /**
     * 实际执行皮肤加载逻辑：优先走预加载路径（UI_SIZE_CONFIG），失败或无配置时降级到网络探测
     * @param {object} [opts] - 选项，可指定 root 元素和自定义探测函数
     * @returns {Promise<object>} 已应用的皮肤映射
     */
    function runUISkin(opts) {
        opts = opts || {};
        var el = opts.root || (typeof document !== 'undefined' ? document.documentElement : null);
        if (!el || !el.style || typeof el.style.setProperty !== 'function') {
            return Promise.resolve({});
        }

        // 优先路径：C# 端已注入 ui_size.js 配置，直接生成 CSS + 预加载图片
        var config = root.UI_SIZE_CONFIG;
        if (config && typeof config === 'object' && !opts.probe) {
            try {
                var result = applyPreloaded(config, el);
                // applyPreloaded 返回 Promise（等待图片预加载完成）
                if (result && typeof result.then === 'function') {
                    return result.then(function () { return { preloaded: true }; });
                }
                return Promise.resolve({ preloaded: true });
            } catch (e) {
                // 预加载失败 → 降级到网络探测
            }
        }

        // 降级路径：没有 UI_SIZE_CONFIG（浏览器直开等）。
        // release 构建**直接跳过探测**、保持默认 CSS —— 探测的成本是「98 槽位 × 3 扩展名
        // + 4 次渐进重试」，只该在排错时用。显式传入 opts.probe（测试）或 opts.forceProbe
        // 时不受此限。
        if (!opts.probe && !opts.forceProbe && !IS_DEBUG_BUILD) {
            return Promise.resolve({});
        }

        // 降级路径：无缓存数据时走网络探测（渐进重试）
        var probe = opts.probe || defaultProbe;
        var spec = currentSpec(opts);
        var applied = {};
        var partDims = {};
        return Promise.all(PARTS.map(function (part) {
            return Promise.all(STATES[part].map(function (state) {
                return resolveBody(fileBody(part, state, spec), probe).then(function (result) {
                    return { state: state, url: result.url, width: result.width, height: result.height };
                });
            })).then(function (rows) {
                var urls = {};
                rows.forEach(function (row) {
                    if (row.url) urls[row.state] = { url: row.url, width: row.width, height: row.height };
                });
                var dims = applyPart(el, part, urls);
                if (dims) {
                    applied[part] = {
                        normal: urls.normal,
                        hover: urls.hover || urls.normal,
                        on: urls.on || urls.normal
                    };
                    partDims[part] = dims;
                }
            });
        })).then(function () {
            return applyRoles(probe, spec, partDims);
        }).then(function (roles) {
            Object.keys(roles || {}).forEach(function (role) {
                applied[role] = roles[role];
            });
            if (Object.keys(applied).length > 0) setData(el, 'uiSkin', 'on');
            return applied;
        }).catch(function () {
            return applied;
        });
    }

    // 自启动：bgm / video / 存档等分页面不跑 system.js，由这里兜底。
    // C# 端已缓存皮肤数据，loadUISkin 同步完成，无需延迟。
    // 降级到网络探测时，defaultProbe 内置渐进重试。
    // 可设 window.__SHIORI_UISKIN_NO_AUTO = true 关闭。
    if (typeof document !== 'undefined' && !root.__SHIORI_UISKIN_NO_AUTO) {
        var autoRun = function () {
            if (root.__SHIORI_UISKIN_AUTO_RAN) return;
            root.__SHIORI_UISKIN_AUTO_RAN = true;
            var p = loadUISkin();
            if (p && typeof p.catch === 'function') p.catch(function () {});
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', autoRun);
        } else {
            autoRun();
        }

        // bfcache 恢复：WebView2 前进/后退可能从缓存恢复页面，此时 JS 状态保留但
        // DOM 样式节点可能丢失。persisted=true 时重新注入皮肤。
        window.addEventListener('pageshow', function (e) {
            if (e.persisted) {
                root.__SHIORI_UISKIN_AUTO_RAN = false;
                startedPromise = null;
                autoRun();
            }
        });

    }

    // 兜底导出：确保全局 UI_SKIN 变量存在（页面可能提前自定义）
    if (typeof root.UI_SKIN === 'undefined') root.UI_SKIN = UI_SKIN;

    // 模块对外 API：挂到 window.ShioriUISkin / window.loadUISkin / window.resetUISkin，
    // 并兼容 CommonJS 导出（Node 测试环境）
    var api = {
        UI_SKIN: UI_SKIN,
        PARTS: PARTS,
        STATES: STATES,
        ROLES: ROLES,
        LATE_ROLES: LATE_ROLES,
        EXTS: EXTS,
        CONTAINER_PARTS: CONTAINER_PARTS,
        IS_DEBUG_BUILD: IS_DEBUG_BUILD,
        ON_STATE_SELECTORS: ON_STATE_SELECTORS,
        STATE_SELECTORS: STATE_SELECTORS,
        PANEL_ON_PARTS: PANEL_ON_PARTS,
        KEEP_TEXT_PARTS: KEEP_TEXT_PARTS,
        KEEP_TEXT_ROLES: KEEP_TEXT_ROLES,
        PROBE_DELAYS: PROBE_DELAYS,
        TEXTBOX_HIGHLIGHT_MODE: TEXTBOX_HIGHLIGHT_MODE,
        sanitizeStem: sanitizeStem,
        fileBody: fileBody,
        assetUrl: assetUrl,
        partVar: partVar,
        shouldHideText: shouldHideText,
        stateSelectors: stateSelectors,
        applyTextboxHighlight: applyTextboxHighlight,
        textboxHighlight: textboxHighlight,
        nameboxSpeaking: nameboxSpeaking,
        loadUISkin: loadUISkin,
        resetUISkin: resetUISkin
    };
    root.ShioriUISkin = api;
    root.loadUISkin = loadUISkin;
    root.resetUISkin = resetUISkin;
    // 便于作者在控制台查看当前档位
    if (typeof root.TEXTBOX_HIGHLIGHT_MODE === 'undefined') root.TEXTBOX_HIGHLIGHT_MODE = TEXTBOX_HIGHLIGHT_MODE;
    bindTextboxHover();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
