/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 媒体宏实现（media_impl.js）。
 * 注册并实现 bgm / se / voice / background / off / char 六个媒体类指令，
 * 负责背景音乐的播放与淡入淡出、音效与语音的播放/停止、背景图分层渲染
 * （支持 x/y/zoom/size/Ssize 变换与多图层）、媒体层移除以及立绘指令转发。
 * 所有指令实现均通过 __shiori.reg 注册表挂载，等待 DSL 编译器调用。
 */
(function (global) {
    'use strict';

    /* 全局宿主对象（浏览器为 window） */
    var root = global;
    /* 从宿主获取宏注册表：优先 __shiori.reg，回退旧版 __reg */
    var __reg = (root.__shiori && root.__shiori.reg) || root.__reg;
    /* 注册表不可用（未加载 DSL 运行时）时静默退出，避免抛错阻断页面 */
    if (!__reg || typeof __reg.cmd !== 'function' || typeof __reg.impl !== 'function')
        return;

    /**
     * 获取游戏引擎实例（媒体层的宿主）。
     * 优先使用调用方传入的 ctx（便于测试/多实例），
     * 否则回退到全局的 gameEngine 变量或 root.gameEngine 挂载点。
     * @param {Object} [ctx] 调用上下文，通常为 gameEngine 实例
     * @returns {Object} 游戏引擎实例（可能为 undefined）
     */
    function geOf(ctx) {
        return ctx || ((typeof gameEngine !== 'undefined') ? gameEngine : root.gameEngine);
    }

    /**
     * 将数值裁剪到 [0, 1] 区间，用于音量/透明度等归一化值。
     * 非数字、NaN 一律视为 0；这是所有音量计算的最后一道安全阀。
     * @param {number} n 待裁剪数值
     * @returns {number} 落在 0~1 之间的数值
     */
    function clamp01(n) {
        if (typeof n !== 'number' || isNaN(n)) return 0;
        if (n < 0) return 0;
        if (n > 1) return 1;
        return n;
    }

    /**
     * 解析百分比/比例参数并封顶到 100%（如透明度）。
     * 支持三类写法：
     *   "80%"  → 百分数字符串，直接除以 100
     *   0.8    → 裸小数，直接使用
     *   80     → 大于 1 且不超过 100 的裸数字，视为百分数除以 100
     * 空值返回 null（交由调用方决定回退策略），非法值返回 null。
     * @param {string|number} v 原始参数
     * @returns {?number} 0~1 的归一化值，无法解析时为 null
     */
    function parsePercent(v) {
        if (v == null || v === '') return null;
        var s = String(v).trim();
        var m = s.match(/^(-?\d+(?:\.\d+)?)%$/);
        if (m) return clamp01(parseFloat(m[1]) / 100);
        var n = parseFloat(s);
        if (isNaN(n)) return null;
        if (n > 1 && n <= 100) return clamp01(n / 100);
        return clamp01(n);
    }

    /**
     * 解析 zoom 缩放参数（与 parsePercent 不同，不封顶到 100%）。
     * 支持：
     *   带 %   → 百分数，如 50% → 0.5、150% → 1.5、0% → 0（最小 0）
     *   裸数字 → 小于 10 视为倍率（0.5 → 0.5、1.5 → 1.5、2 → 2）
     *            大于等于 10 视为百分数（50 → 0.5、150 → 1.5）
     * 非法值（负数 / NaN / 空）返回 null，由调用方决定回退到上一个 zoom 或 1。
     * @param {string|number} v zoom 原始参数
     * @returns {?number} 缩放倍率（如 0.5 / 1.5），无法解析时为 null
     */
    function parseZoom(v) {
        if (v == null || v === '') return null;
        var s = String(v).trim();
        var m = s.match(/^(\d+(?:\.\d+)?)%$/);
        if (m) return parseFloat(m[1]) / 100;
        var n = parseFloat(s);
        if (isNaN(n) || n < 0) return null;
        if (n < 10) return n;
        return n / 100;
    }

    /**
     * 解析音量参数，支持"渐变"写法。
     * 语法：
     *   "0.5"        → 直接音量，to = 0.5
     *   "0->1"       → 淡入，from = 0、to = 1、ramp = true
     *   "1->0"       → 淡出
     * 返回结构 { from, to, ramp }：
     *   ramp 为 true 表示带起点音量（需做音量渐变），false 表示只有终点音量。
     * @param {string} v 音量原始字符串
     * @returns {{from: ?number, to: ?number, ramp: boolean}} 音量描述对象
     */
    function parseVol(v) {
        if (v == null || v === '') return { from: null, to: null, ramp: false };
        var s = String(v);
        /* 检测 "->" 渐变箭头，左侧为起始音量，右侧为结束音量 */
        var arrow = s.indexOf('->');
        if (arrow >= 0)
            return {
                from: parsePercent(s.substring(0, arrow)),
                to: parsePercent(s.substring(arrow + 2)),
                ramp: true
            };
        return { from: null, to: parsePercent(s), ramp: false };
    }

    /**
     * 解析 "宽x高" 形式的尺寸参数。
     * 支持 * x X × 等多种分隔符（正则在字符类中已同时列出）。
     * 无法匹配时返回传入的默认宽高。
     * @param {string} raw 尺寸原始字符串，如 "1280x720"
     * @param {number} dw 解析失败时的默认宽
     * @param {number} dh 解析失败时的默认高
     * @returns {{w: number, h: number}} 解析后的像素宽高
     */
    function parsePair(raw, dw, dh) {
        if (raw == null || raw === '') return { w: dw, h: dh };
        var m = String(raw).match(/(-?\d+(?:\.\d+)?)\s*[*xX×]\s*(-?\d+(?:\.\d+)?)/);
        if (!m) return { w: dw, h: dh };
        return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
    }

    /**
     * 去掉文件名中的扩展名，仅保留主干。
     * 例如 "theme.mp3" → "theme"、"a/b/c.png" → "a/b/c"。
     * @param {string} name 文件名或路径
     * @returns {string} 去扩展名后的字符串
     */
    function stripExt(name) {
        var s = String(name || '');
        return s.replace(/\.[^.\\/]+$/, '');
    }

    /**
     * 在配置映射表中查找资源路径，支持"带扩展名"与"不带扩展名"两种键。
     * 先按原始键精确命中，失败后去掉扩展名再试一次，提高剧本写作容错率。
     * @param {Object} map 资源映射表（如 sceneData.bgm）
     * @param {string} storage 资源名
     * @returns {?string} 映射到的真实路径，未命中返回 null
     */
    function lookupMap(map, storage) {
        if (!map || !storage) return null;
        if (map[storage]) return map[storage];
        var key = stripExt(storage);
        if (key && map[key]) return map[key];
        return null;
    }

    /**
     * 返回各类媒体资源在未命中映射表时的默认目录前缀。
     * @param {string} kind 媒体类型：'bgm' | 'se' | 'voice' | 'bg'
     * @returns {string} 默认资源目录（以 / 结尾）
     */
    function defaultDir(kind) {
        if (kind === 'bgm') return '../assets/bgm/';
        if (kind === 'se') return '../assets/se/';
        if (kind === 'voice') return '../assets/audio/';
        return '../assets/bg/';
    }

    /**
     * 将剧本中的资源名解析为最终可加载的路径。
     * 解析优先级：
     *   1) 已含路径分隔符（/ 或 \）→ 视为完整路径直接返回；
     *   2) 按类型查剧本映射表（bgm/se/audio/background）与全局配置表
     *      （BG_CONFIG_SUB / CG_CONFIG_SUB，背景同时兼容 bg\ 与 cg\ 目录）；
     *   3) 音效额外尝试引擎的 resolveSEPath 动态解析；
     *   4) 全部失败时落回默认目录前缀 + 原资源名。
     * @param {Object} ctx 游戏引擎实例
     * @param {string} kind 媒体类型：'bgm' | 'se' | 'voice' | 'bg'
     * @param {string} storage 剧本中的资源名
     * @returns {string} 解析后的资源路径（storage 为空时返回空串）
     */
    function resolveStorage(ctx, kind, storage) {
        if (!storage) return '';
        var s = String(storage);
        if (s.indexOf('/') >= 0 || s.indexOf('\\') >= 0) return s;
        var data = ctx && ctx.sceneData ? ctx.sceneData : {};
        var mapped = null;
        if (kind === 'bgm') mapped = lookupMap(data.bgm, s);
        else if (kind === 'se') mapped = lookupMap(data.se, s);
        else if (kind === 'voice') mapped = lookupMap(data.audio, s);
        else {
            // 同时支持 bg\ 与 cg\ 两个文件夹：先查剧本 background 映射与 BG_CONFIG_SUB，
            // 再查 CG_CONFIG_SUB（cg\ 路径）。两个文件夹下文件名不冲突，可安全回退查找。
            mapped = lookupMap(data.background, s)
                || lookupMap(typeof BG_CONFIG_SUB !== 'undefined' ? BG_CONFIG_SUB : null, s)
                || lookupMap(typeof CG_CONFIG_SUB !== 'undefined' ? CG_CONFIG_SUB : null, s);
        }
        if (mapped) return mapped;
        if (kind === 'se' && ctx && typeof ctx.resolveSEPath === 'function') {
            var se = ctx.resolveSEPath(stripExt(s));
            if (se) return se;
        }
        return defaultDir(kind) + s;
    }

    /**
     * 计算某通道的基础音量系数（主音量 × 通道音量）。
     * 通道音量由 systemModule 提供：seVolume / voiceVolume / bgmVolume，
     * 最终播放音量 = 基础系数 × 剧本中指定的相对音量。
     * @param {string} kind 媒体类型：'bgm' | 'se' | 'voice'
     * @returns {number} 基础音量乘积（默认 1）
     */
    function channelBase(kind) {
        var sm = root.systemModule;
        if (!sm) return 1;
        var master = sm.currentVolume != null ? sm.currentVolume : 1;
        var ch = 1;
        if (kind === 'se') ch = sm.seVolume != null ? sm.seVolume : 1;
        else if (kind === 'voice') ch = sm.voiceVolume != null ? sm.voiceVolume : 1;
        else ch = sm.bgmVolume != null ? sm.bgmVolume : 1;
        return master * ch;
    }

    /**
     * 取出指定媒体类型对应的 HTMLAudioElement 播放器。
     * @param {Object} ctx 游戏引擎实例（需含 elements）
     * @param {string} kind 媒体类型：'bgm' | 'se' | 'voice'
     * @returns {?HTMLAudioElement} 播放器元素，缺失时为 null
     */
    function playerOf(ctx, kind) {
        if (!ctx || !ctx.elements) return null;
        if (kind === 'se') return ctx.elements.sePlayer;
        if (kind === 'voice') return ctx.elements.voicePlayer;
        return ctx.elements.bgmPlayer;
    }

    /**
     * 在一段时间内线性渐变播放器音量（from → to）。
     * 基于 requestAnimationFrame 驱动，缺少该 API 时降级为 16ms setTimeout 轮询。
     * 边界处理：
     *   player 为空 → 直接触发 onDone；
     *   ms <= 0    → 立即设置目标音量并触发 onDone（无动画）。
     * @param {HTMLAudioElement} player 目标播放器
     * @param {number} from 起始音量（自动裁剪到 0~1）
     * @param {number} to 目标音量（自动裁剪到 0~1）
     * @param {number} ms 渐变时长（毫秒）
     * @param {Function} [onDone] 渐变完成后的回调（立即完成时也会调用）
     * @returns {void}
     */
    function fadeVolume(player, from, to, ms, onDone) {
        if (!player) {
            if (onDone) onDone();
            return;
        }
        var dur = ms > 0 ? ms : 0;
        if (!dur) {
            player.volume = clamp01(to);
            if (onDone) onDone();
            return;
        }
        var start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        player.volume = clamp01(from);
        var tick = function (now) {
            var t = now != null ? now : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
            var p = Math.min(1, (t - start) / dur);
            player.volume = clamp01(from + (to - from) * p);
            if (p >= 1) {
                if (onDone) onDone();
                return;
            }
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
            else setTimeout(function () { tick(); }, 16);
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
        else setTimeout(function () { tick(); }, 16);
    }

    /**
     * 音频指令（bgm / se / voice）的统一执行入口。
     * 支持的操作：
     *   stop 或仅给出指令名（无 storage）→ 停止播放（time>0 时淡出后再暂停并归零）；
     *   给出 storage → 解析路径并播放；BGM 自动开启循环；
     *                   vol 支持 "a->b" 渐变写法，time>0 时执行音量淡变。
     * @param {string} kind 媒体类型：'bgm' | 'se' | 'voice'
     * @param {Object} ctx 游戏引擎实例（可为 null，回退全局引擎）
     * @param {Object} p 指令参数对象（storage / time / vol / _args）
     * @returns {{type: string}} 返回给调度器的动作描述
     * @sideeffect 修改播放器 src/volume/loop 并触发 play，可能注册 rAF 动画
     */
    function runAudio(kind, ctx, p) {
        var ge = geOf(ctx);
        var op = '';
        if (p && p._args && p._args.length) op = String(p._args[0]).toLowerCase();
        var storage = p && p.storage != null ? String(p.storage) : '';
        var time = p && p.time != null && p.time !== '' ? parseInt(p.time, 10) : 0;
        if (isNaN(time)) time = 0;
        var vol = parseVol(p && p.vol);
        /* 停止分支：显式 stop，或未指定资源名（视为停止当前通道） */
        if (op === 'stop' || (!op && !storage)) {
            var stopPlayer = playerOf(ge, kind);
            if (!stopPlayer) return { type: kind };
            /* 从当前实际音量开始淡出，避免音量突变（跳音） */
            var startVol = stopPlayer.volume || 0;
            if (time > 0) {
                fadeVolume(stopPlayer, startVol, 0, time, function () {
                    stopPlayer.pause();
                    try { stopPlayer.currentTime = 0; } catch (e) {}
                });
            } else if (kind === 'bgm' && ge && typeof ge.stopBGM === 'function') {
                ge.stopBGM();
            } else {
                stopPlayer.pause();
                try { stopPlayer.currentTime = 0; } catch (e2) {}
            }
            return { type: kind };
        }
        var path = resolveStorage(ge, kind, storage);
        var player = playerOf(ge, kind);
        if (!player || !path) return { type: kind };
        var base = channelBase(kind);
        /* 终点音量系数（缺省 1.0） */
        var toMul = vol.to != null ? vol.to : 1;
        /* 起点音量系数：
         *   显式渐变 "a->b" → 用 a；
         *   非渐变且 time>0 → 从 0 开始淡入；
         *   其余情况直接等于终点音量（无渐变） */
        var fromMul = vol.ramp ? (vol.from != null ? vol.from : 0) : (time > 0 ? 0 : toMul);
        player.src = path;
        player.loop = kind === 'bgm';
        player.volume = clamp01(base * fromMul);
        var playP = player.play();
        /* 浏览器自动播放策略可能拒绝 play()，静默吞掉异常避免中断流程 */
        if (playP && typeof playP.catch === 'function') playP.catch(function () {});
        /* 需要渐变且起止音量不同 → 启动音量动画；否则直接落到终点音量 */
        if (time > 0 && fromMul !== toMul) fadeVolume(player, clamp01(base * fromMul), clamp01(base * toMul), time);
        else player.volume = clamp01(base * toMul);
        return { type: kind };
    }

    /**
     * 获取（必要时惰性初始化）引擎状态中的媒体图层容器。
     * 图层容器形如 { storage名: DOM元素 }，用于记录当前已渲染的背景层。
     * @param {Object} ge 游戏引擎实例
     * @returns {Object} mediaLayers 映射对象
     */
    function bag(ge) {
        if (!ge.state) ge.state = {};
        if (!ge.state.mediaLayers || typeof ge.state.mediaLayers !== 'object')
            ge.state.mediaLayers = {};
        return ge.state.mediaLayers;
    }

    /**
     * 获取背景容器元素及其当前像素尺寸，作为图层布局的坐标基准。
     * 容器缺失时依次回退窗口尺寸与 1920×1080 设计分辨率。
     * @param {Object} ge 游戏引擎实例
     * @returns {{el: ?HTMLElement, w: number, h: number}} 容器信息
     */
    function winBox(ge) {
        var box = ge.elements && ge.elements.backgroundContainer;
        return {
            el: box,
            w: (box && box.clientWidth) || root.innerWidth || 1920,
            h: (box && box.clientHeight) || root.innerHeight || 1080
        };
    }

    /**
     * 从位置参数列表中提取第一个可解析为百分比的参数作为透明度。
     * 用于兼容 [background bg.png 0.5] 这类把透明度写成位置参数的写法。
     * @param {Object} p 指令参数对象（取 _args）
     * @returns {?number} 0~1 的透明度，未找到返回 null
     */
    function opacityFrom(p) {
        if (p && p._args) {
            for (var i = 0; i < p._args.length; i++) {
                var a = parsePercent(p._args[i]);
                if (a != null) return a;
            }
        }
        return null;
    }

    /**
     * 将布局描述应用到图层 DOM 元素上。
     * left/top 使用百分比（相对窗口），width/height 使用像素。
     * animateMs > 0 时先强制一次重排（读取 offsetWidth）再设置 transition，
     * 确保过渡从当前样式真实生效；等于 0 时清空 transition 立即定位。
     * @param {HTMLElement} el 图层元素
     * @param {Object} spec 布局描述（含 x/y/w/h/o）
     * @param {number} animateMs 动画时长（毫秒）
     * @returns {void}
     * @sideeffect 修改元素内联样式
     */
    function applyLayerStyle(el, spec, animateMs) {
        if (animateMs > 0) {
            void el.offsetWidth;
            el.style.transition = 'left ' + animateMs + 'ms linear, top ' + animateMs + 'ms linear, opacity ' + animateMs + 'ms linear, width ' + animateMs + 'ms linear, height ' + animateMs + 'ms linear';
        } else {
            el.style.transition = '';
        }
        el.style.left = spec.x + '%';
        el.style.top = spec.y + '%';
        el.style.width = spec.w + 'px';
        el.style.height = spec.h + 'px';
        el.style.opacity = String(spec.o);
    }

    /**
     * 根据指令参数与上一帧状态计算出图层的最终布局描述。
     * 参数继承规则（同一图层重复调用时）：
     *   Ssize 缺省沿用上次基准分辨率，避免多行动画中途缺省导致尺寸跳变；
     *   zoom 缺省沿用上次值，初始为 1（100%）；
     *   x/y/o 缺省沿用上次值，初始分别为 0/0/1。
     * 尺寸换算：像素宽高 = (size ? size × 窗口/基准比 : 窗口尺寸) × zoom。
     * @param {Object} ge 游戏引擎实例
     * @param {?Object} p 本次指令参数（为 null 表示纯重算，如窗口 resize）
     * @param {?Object} prev 上一帧的 spec（含 sizeW/sizeH/ssizeW/ssizeH/zoom 等）
     * @returns {Object} 布局描述 {x,y,o,w,h,sizeW,sizeH,ssizeW,ssizeH,zoom}
     */
    function layerSpec(ge, p, prev) {
        var box = winBox(ge);
        // Ssize 与 size/zoom 一样支持沿用：同图层后续调用缺省时保留上次基准分辨率。
        // 否则多行动画中途缺省 Ssize 会回退默认 1920 基准，造成画面尺寸跳变（如 1980→1920 差 3.125%）。
        var ssizeW = prev && prev.ssizeW != null ? prev.ssizeW : 1920;
        var ssizeH = prev && prev.ssizeH != null ? prev.ssizeH : 1080;
        var ssize = parsePair(p && p.Ssize, ssizeW, ssizeH);
        var size = parsePair(p && p.size, prev && prev.sizeW, prev && prev.sizeH);
        var scale = ssize.w ? (box.w / ssize.w) : 1;
        // zoom：缺省沿用上一次（同一图层重复调用时保持），初始 1（100%）。
        // zoom 与窗口 scale 相乘，保证任意窗口大小下可见内容比例一致。
        var zoom = parseZoom(p && p.zoom);
        if (zoom == null) zoom = prev && prev.zoom != null ? prev.zoom : 1;
        var x = p && p.x != null && p.x !== '' ? parsePercent(p.x) : (prev ? prev.x : 0);
        var y = p && p.y != null && p.y !== '' ? parsePercent(p.y) : (prev ? prev.y : 0);
        if (x == null) x = 0;
        if (y == null) y = 0;
        var o = opacityFrom(p);
        if (o == null) o = prev ? prev.o : 1;
        var w = (size.w ? size.w * scale : box.w) * zoom;
        var h = (size.h ? size.h * scale : box.h) * zoom;
        return {
            x: x * 100,
            y: y * 100,
            o: o,
            w: w,
            h: h,
            sizeW: size.w,
            sizeH: size.h,
            ssizeW: ssize.w,
            ssizeH: ssize.h,
            zoom: zoom
        };
    }

    /**
     * 确保指定资源对应的背景图层元素存在，不存在则创建并挂载。
     * 图层以 storage 名为唯一键缓存于 state.mediaLayers，重复调用复用同一元素。
     * @param {Object} ge 游戏引擎实例
     * @param {string} storage 资源名（图层键）
     * @param {number} layer z-index 层级
     * @returns {?HTMLElement} 图层元素，document/容器缺失时为 null
     * @sideeffect 向背景容器追加 div 元素
     */
    function ensureLayer(ge, storage, layer) {
        var layers = bag(ge);
        if (layers[storage]) return layers[storage];
        var d = root.document;
        var box = ge.elements && ge.elements.backgroundContainer;
        if (!d || !box) return null;
        var el = d.createElement('div');
        el.className = 'shiori-bg-layer';
        el.setAttribute('data-storage', storage);
        el.style.position = 'absolute';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundSize = '100% 100%';
        el.style.pointerEvents = 'none';
        el.style.zIndex = String(layer);
        box.appendChild(el);
        layers[storage] = el;
        return el;
    }

    /**
     * 窗口尺寸变化时，按当前容器尺寸重算所有同层媒体的像素宽高。
     * 保证 zoom / size 内容在任何窗口大小下可见范围一致（比例不变）。
     * @param {Object} ge 游戏引擎实例
     * @returns {void}
     * @sideeffect 重写所有带 _mediaSpec 的图层元素样式
     */
    function reflowLayers(ge) {
        var layers = bag(ge);
        for (var k in layers) {
            var el = layers[k];
            if (el && el._mediaSpec) {
                var spec = layerSpec(ge, null, el._mediaSpec);
                applyLayerStyle(el, spec, 0);
                el._mediaSpec = spec;
            }
        }
    }

    /**
     * 幂等地为窗口注册 resize 监听，触发所有背景图层的尺寸重算。
     * 使用 __mediaResizeHooked 标记避免重复绑定；回调用 pending 做节流，
     * 保证同一帧内多次 resize 事件只重排一次。
     * @param {Object} ge 游戏引擎实例
     * @returns {void}
     * @sideeffect 向 window 注册 resize 事件监听
     */
    function ensureResizeHook(ge) {
        if (ge.__mediaResizeHooked) return;
        ge.__mediaResizeHooked = true;
        if (!root || typeof root.addEventListener !== 'function') return;
        var pending = 0;
        root.addEventListener('resize', function () {
            if (pending) return;
            if (typeof requestAnimationFrame === 'function') {
                pending = requestAnimationFrame(function () { pending = 0; reflowLayers(ge); });
            } else {
                pending = setTimeout(function () { pending = 0; reflowLayers(ge); }, 50);
            }
        });
    }

    /**
     * 背景图指令 [background] 的执行入口。
     * 两种模式：
     *   简单模式：未指定 size/x/y/zoom/透明度/time/layer 时，直接调用引擎
     *             setBackground 替换底层背景（性能最优，覆盖式）；
     *   图层模式：涉及任何变换参数时，创建/复用一个绝对定位图层，
     *             应用尺寸与动画，并记录 _mediaSpec 供 resize 重排使用。
     * storage 缺省时沿用上次背景（state.mediaLastBg）。
     * @param {Object} ctx 游戏引擎实例
     * @param {Object} p 指令参数（storage/size/Ssize/x/y/zoom/layer/time）
     * @returns {{type: string, duration?: number}} 动作描述；带 time 时返回 mediaAnim
     * @sideeffect 修改 DOM 与引擎状态
     */
    function runBackground(ctx, p) {
        var ge = geOf(ctx);
        var storage = p && p.storage != null ? String(p.storage) : (ge.state && ge.state.mediaLastBg) || '';
        var time = p && p.time != null && p.time !== '' ? parseInt(p.time, 10) : 0;
        if (isNaN(time)) time = 0;
        var layer = 0;
        if (p && p.layer != null && p.layer !== '') {
            layer = parseInt(p.layer, 10);
            if (isNaN(layer)) layer = 0;
        }
        var path = resolveStorage(ge, 'bg', storage);
        /* 判断是否需要走图层模式：任一变换参数存在即视为复杂背景 */
        var sized = p && ((p.size && p.size !== '') || (p.x != null && p.x !== '') || (p.y != null && p.y !== '') || (p.zoom != null && p.zoom !== '') || opacityFrom(p) != null || time > 0);
        /* 简单模式：无变换且无 layer 参数，直接走引擎底层背景替换 */
        if (!sized && (!p || p.layer == null || p.layer === '')) {
            if (ge && typeof ge.setBackground === 'function') ge.setBackground(path);
            if (ge.state) ge.state.mediaLastBg = storage;
            return { type: 'background' };
        }
        /* 图层模式：创建/复用元素并应用布局；DOM 缺失时回退底层背景 */
        var el = ensureLayer(ge, storage, layer);
        ensureResizeHook(ge);
        if (!el) {
            if (ge && typeof ge.setBackground === 'function') ge.setBackground(path);
            return { type: 'background' };
        }
        el.style.backgroundImage = path ? ('url("' + path + '")') : 'none';
        el.style.zIndex = String(layer);
        var prev = el._mediaSpec || null;
        var spec = layerSpec(ge, p, prev);
        applyLayerStyle(el, spec, time > 0 ? time : 0);
        el._mediaSpec = spec;
        if (ge.state) ge.state.mediaLastBg = storage;
        /* 带 time 的变换需要等待动画结束，向调度器返回 mediaAnim */
        if (time > 0) return { type: 'mediaAnim', duration: time };
        return { type: 'background' };
    }

    /**
     * [off] 指令：移除指定资源对应的背景图层并清理缓存。
     * @param {Object} ctx 游戏引擎实例
     * @param {Object} p 指令参数（storage 为图层键）
     * @returns {{type: string}} 动作描述
     * @sideeffect 从 DOM 移除图层元素并删除 state.mediaLayers 中的记录
     */
    function runOff(ctx, p) {
        var ge = geOf(ctx);
        var storage = p && p.storage != null ? String(p.storage) : '';
        var layers = bag(ge);
        var el = storage && layers[storage];
        if (el && el.parentNode) el.parentNode.removeChild(el);
        if (storage) delete layers[storage];
        return { type: 'off' };
    }

    /**
     * [char] 指令：将参数拼装为立绘标签并转发给引擎 renderChars。
     * 标签格式为 [who 位置参数... pos]，与引擎内部的立绘解析规则保持一致。
     * @param {Object} ctx 游戏引擎实例
     * @param {Object} p 指令参数（who / _args / pos）
     * @returns {{type: string}} 动作描述；无有效参数时返回空对象
     * @sideeffect 触发引擎立绘渲染
     */
    function runChar(ctx, p) {
        var ge = geOf(ctx);
        var parts = [];
        if (p && p.who) parts.push(String(p.who));
        if (p && p._args && p._args.length) {
            for (var i = 0; i < p._args.length; i++) parts.push(String(p._args[i]));
        }
        if (p && p.pos) parts.push(String(p.pos));
        if (!parts.length) return {};
        var tag = '[' + parts.join(' ') + ']';
        if (ge && typeof ge.renderChars === 'function') ge.renderChars(tag);
        return { type: 'char' };
    }

    /* ===== 向 DSL 注册表登记本模块提供的命令与实现 ===== */
    __reg.cmd({ name: 'bgm' });         // 背景音乐
    __reg.cmd({ name: 'se' });          // 音效
    __reg.cmd({ name: 'voice' });       // 语音
    __reg.cmd({ name: 'background' });  // 背景图
    __reg.cmd({ name: 'off' });         // 移除媒体层
    __reg.cmd({ name: 'char' });        // 立绘（转发）
    __reg.impl({ cmd: 'bgm', run: function (ctx, p) { return runAudio('bgm', ctx, p); } });
    __reg.impl({ cmd: 'se', run: function (ctx, p) { return runAudio('se', ctx, p); } });
    __reg.impl({ cmd: 'voice', run: function (ctx, p) { return runAudio('voice', ctx, p); } });
    __reg.impl({ cmd: 'background', run: runBackground });
    __reg.impl({ cmd: 'off', run: runOff });
    __reg.impl({ cmd: 'char', run: runChar });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
