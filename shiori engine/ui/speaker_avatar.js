/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 说话人小头像。
 *
 * 头像与场上立绘**自动联动**，不需要在剧本里逐句声明：
 *     speaker  →  场上角色  →  立绘合成画布  →  取框（头肩）
 *
 * 三级来源（除优先级 1 的显式素材外，其余两级零额外素材、零网络请求）：
 *   ① CHAR_AVATAR[角色]          显式头像图（美术精修用）
 *   ② CHAR_AVATAR_CROP 裁切框     相对**整张合成画布**的手工取框（写什么就是什么）
 *   ③ autoCrop 自动头肩窗口       零配置可用：按 DEFAULT_CROP 的比例（默认 40%×40%、
 *                                从画布顶端起）取框，横向按表情层中心对齐 ——
 *                                表情一变头像自动跟着变
 *
 * 三条硬约束：
 *   1. **不进打字机关键路径**：只在「名片更新」与「立绘合成完成」两个时刻刷新，
 *      不做每帧更新。
 *   2. **不做运行时探测**：合成是否就绪看 `dataset.charDiffBlit`（引擎自己写的标记），
 *      不为头像去额外发图片请求、不去解析 naturalWidth 之外的任何东西。
 *   3. 小说模式 / `[msgoff]` 不需要特判：头像容器是文本框容器的子节点，
 *      文本框一隐藏它就跟着隐藏。
 *
 * ── 画布 = 取景框的成品（框与画布永不动）────────────────────
 * 头像框是「宽 = --speaker-avatar-size（默认 220u）、高 = --speaker-avatar-height
 * （默认 1080u，即整个窗口高）」的竖长方形，**底边贴窗口底边**、高度往上长。
 * 引擎先按取景框裁出一张画布：宽度对齐框宽、高度按取景框比例（见 fitInto），
 * 画布**只由取景框的 w / h 决定**，x / y 平移不改 w / h ——
 * 所以画布尺寸与位置（left:0 / bottom:0）都恒定，那个 div 永远不会动。
 * x / y / z 全部作用在**取景框**上（applyTransformToCrop）：
 *   z 以框中心等比放大 / 缩小取景框；x / y 在源图上平移取景框。
 *   「取景框在源图上滑」= 画面里「立绘在框里动」，和主舞台用 [中 上] 挪立绘同构。
 * 取景框可以越出源图边界：越界部分由 srcRectFor 只取交集、留透明（负 y 才能往下走）。
 * 为什么是平移取景框（其余方案都会让「框」看上去在动）：
 *   ① 把裁切结果 cover 进正方形：竖长取框被切掉下半截（"图片大一点头像就被切断一半"）；
 *   ② 把画布挂 CSS transform 去平移 / 缩放：画布跟着 x / y 一起跑，看上去像"框在动"；
 *   ③ 把立绘"画进一张固定屏里"再偏移：立绘一偏就在屏内留下空隙，同样像"框没贴边"。
 * 只有「平移取景框」能让画布本身纹丝不动、又让里面的立绘动起来。
 * 立绘层高度上限见 RENDER_H_MAX，只是兜住极端竖长裁框的位图体积。
 */
(function (root) {
    'use strict';

    /** 输出画布宽度（固定值）。384 是「典型上屏宽度 220u 的 1.7 倍」，够清晰又不至于占内存。
     *  宽度恒定 ⇒ 缓存键里的「宽」分量恒定，窗口缩放不会击穿缓存。
     *  （画布高度随裁切框比例走，所以缓存键里还要带上实际尺寸。） */
    var RENDER_W = 384;

    /** 输出画布高度上限。框宽:框高 = 220:1080（ui/style.css 里
     *  --speaker-avatar-size : --speaker-avatar-height 的比），换算成画布像素就是 384 × (1080/220)。
     *  只在裁切框极端竖长（比 1:4.9 还窄）时起作用，用来兜住位图体积 ——
     *  上屏观感不受影响（CSS 会把整张画布等比缩回去，见 style.css 的 max-height:100%）。 */
    var RENDER_H_MAX = Math.round(RENDER_W * 1080 / 220);   // ≈ 1885

    /** 头像缓存条数上限。一条最大 384×1885×4B ≈ 2.9MB —— 但真正缓存的是
     *  「裁切框等比缩到框宽」后的画布（高度按比例，多数情况只有这个上限的一半以内），
     *  12 条实测在 10~20MB 量级。缓存条数比画布质量更值得抠：换装 / 换表情时重裁一次
     *  只是一次 drawImage，不会卡。 */
    var CACHE_MAX = 12;

    /** 零配置自动取框的**窗口比例**（相对整张合成画布，单位 %）。
     *  y=0 是关键：从画布顶端起，发际线以上的头发才会一起进画布，头顶永远不被裁。
     *  w/h 给的是「头肩」范围：40% × 40% 大致是头 + 上胸，对绝大多数立绘都成立。
     *  横向位置由 autoCrop 按表情层中心对齐（拿不到就用这里的 x）。 */
    var DEFAULT_CROP = { x: 30, y: 0, w: 40, h: 40 };

    /** 合成画布就绪标记（engine_chars.js 在 blit 完成后写入） */
    var BLIT_FLAG = 'charDiffBlit';

    // ── 模块状态 ────────────────────────────────────────────────
    /** 总开关真值。对外暴露的是 api.enabled 访问器，内部刻意换个名字，避免读代码时误以为在写访问器。 */
    var isEnabled = true;
    /** 当前说话人（名片文本），null 表示无对白 / 旁白 */
    var currentSpeaker = null;
    /** 当前头像对应的角色名，null 表示没有头像 */
    var currentAvatarChar = null;
    /** 当前挂进容器的画布 */
    var currentCanvas = null;
    /** 显式素材加载记录：path → { ok, img }；ok=false 也缓存，避免每句都重发一次失败请求 */
    var explicitImgs = Object.create(null);
    var explicitPending = Object.create(null);
    /** 头像缓存：key → canvas（LRU，插入序即新旧序） */
    var cache = new Map();
    /** 统计 / 诊断 */
    var stats = { crops: 0, cacheHits: 0, shows: 0, hides: 0, misses: 0 };
    var issues = [];
    /** 运行期临时覆盖的显示变换（setTransform 用）；null = 走 CHAR_AVATAR_TRANSFORM 配置 */
    var overrideTransform = null;
    /** 当前生效的显示变换与其来源（'override' | 'config'），供 getTransform / diagnose 读取 */
    var currentTransform = { x: 0, y: 0, z: 0 };
    var currentTransformSource = 'config';

    // ── 基础工具 ────────────────────────────────────────────────

    /** 取引擎对象。engine_core.js 里是顶层 `const gameEngine`（不挂 window），
     *  因此只能用「按名解析 + try」而不是 window.gameEngine。 */
    function engine() {
        try {
            if (typeof gameEngine !== 'undefined' && gameEngine) return gameEngine;
        } catch (e) { /* TDZ / 未定义，走 window 兜底 */ }
        try {
            if (typeof window !== 'undefined' && window.gameEngine) return window.gameEngine;
        } catch (e) { /* ignore */ }
        return null;
    }

    /** 安全读取一张全局配置表 */
    function table(name) {
        try {
            var t = (typeof window !== 'undefined') ? window[name] : null;
            return (t && typeof t === 'object') ? t : null;
        } catch (e) { return null; }
    }

    function text(v) {
        return (v === null || v === undefined) ? '' : String(v).trim();
    }

    function num(v, dflt) {
        var n = Number(v);
        return Number.isFinite(n) ? n : dflt;
    }

    function log(msg, err) {
        issues.push(msg);
        if (typeof console !== 'undefined' && console.warn) console.warn('[SpeakerAvatar] ' + msg, err || '');
    }

    /** 只报一次的告警（同一 key 不重复刷屏） */
    var warned = Object.create(null);
    function warnOnce(key, msg) {
        if (warned[key]) return;
        warned[key] = 1;
        log(msg);
    }

    function byId(id) {
        try {
            if (typeof document === 'undefined') return null;
            return document.getElementById(id);
        } catch (e) { return null; }
    }

    function container() { return byId('speaker-avatar'); }
    function textBoxContainer() { return byId('text-box-container'); }

    function classOn(node, cls, on) {
        if (!node || !node.classList) return;
        try {
            if (on) node.classList.add(cls);
            else node.classList.remove(cls);
        } catch (e) { /* ignore */ }
    }

    // ── 配置解析 ────────────────────────────────────────────────

    /**
     * 规范化一个裁切框，统一成 0~1 的小数（相对整张合成画布）。
     * 接受两种写法：百分比（与 CHAR_DIFF_CONFIG 一致）与 0~1 小数——四项都 ≤1 视为小数。
     * 越界按边界收缩；宽或高非正则判为无效（返回 null），由调用方逐级回退。
     * @param {object} raw - { x, y, w, h }
     * @returns {{x:number,y:number,w:number,h:number}|null} 规范化后的框；无效返回 null
     */
    function normCrop(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var x = Number(raw.x), y = Number(raw.y), w = Number(raw.w), h = Number(raw.h);
        if (!Number.isFinite(x) || !Number.isFinite(y) ||
            !Number.isFinite(w) || !Number.isFinite(h)) return null;
        // 0~1 小数写法 → 百分比
        var maxv = Math.max(Math.abs(x), Math.abs(y), Math.abs(w), Math.abs(h));
        if (maxv > 0 && maxv <= 1) { x *= 100; y *= 100; w *= 100; h *= 100; }
        if (!(w > 0) || !(h > 0)) return null;
        var r = { x: x / 100, y: y / 100, w: w / 100, h: h / 100 };
        r.x = Math.min(Math.max(r.x, 0), 1);
        r.y = Math.min(Math.max(r.y, 0), 1);
        r.w = Math.min(Math.max(r.w, 0), 1 - r.x);
        r.h = Math.min(Math.max(r.h, 0), 1 - r.y);
        if (!(r.w > 0) || !(r.h > 0)) return null;
        return r;
    }

    /**
     * 按「角色 → 方位」两级取裁切框，逐级回退到全局。
     * 顺序：CROP[角色][方位] → CROP[角色]["默认"] → CROP[角色]["全局"] → CROP["全局"]
     * @param {string} charName - 角色名
     * @param {string} orientation - 方位（与 CHAR_DIFF_CONFIG 同一套方位名）
     * @returns {{x:number,y:number,w:number,h:number}|null}
     */
    function pickCrop(charName, orientation) {
        var t = table('CHAR_AVATAR_CROP');
        if (!t) return null;
        var per = (charName && t[charName] && typeof t[charName] === 'object') ? t[charName] : null;
        var ori = text(orientation) || '默认';
        var cands = [];
        if (per) cands.push(per[ori], per['默认'], per['全局']);
        cands.push(t['全局']);

        var badSeen = false;
        for (var i = 0; i < cands.length; i++) {
            if (cands[i] === undefined || cands[i] === null) continue;
            var n = normCrop(cands[i]);
            if (n) return n;
            badSeen = true;      // 键存在但字段不合法（w/h ≤ 0、非数字…）
        }
        if (badSeen) {
            warnOnce('bad-crop', 'CHAR_AVATAR_CROP[' + charName + '][' + ori + '] 的 x/y/w/h 不合法，已跳过该框');
        }
        return null;
    }

    // ── 显示位置与缩放 ──────────────────────────────────────────

    /** 没有变换时的零值（原地不动、原始大小） */
    function zeroTransform() { return { x: 0, y: 0, z: 0 }; }

    /**
     * 规范化「显示位置 / 缩放」——头像框内的立绘指令。
     *   x = 立绘在框内的水平位移，%，正值向右   —— 相对**头像框宽**
     *   y = 立绘在框内的垂直位移，%，正值向上   —— 相对**头像框宽**
     *   z = 取景缩放增量，%，0 = 原始大小，换算与差分一致：(100 + z) / 100
     * 任一项不是有限数就取 0（而不是整条判废）：这样少写一个字段不会连带丢掉另外两个。
     * @param {object} raw
     * @returns {{x:number,y:number,z:number}|null} 非对象返回 null（由调用方继续回退）
     */
    function normTransform(raw) {
        if (!raw || typeof raw !== 'object') return null;
        return { x: num(raw.x, 0), y: num(raw.y, 0), z: num(raw.z, 0) };
    }

    /** 该对象是否是一份「变换本身」（而不是按方位分组的二级表） */
    function isTransformShape(o) {
        return !!o && typeof o === 'object' &&
            (o.x !== undefined || o.y !== undefined || o.z !== undefined);
    }

    /**
     * 取某个角色 / 方位的显示变换，逐级回退：
     *   T[角色][方位] → T[角色]["默认"] → T[角色]["全局"] → T[角色]（扁平 {x,y,z}）→ T["全局"]
     * 全部落空时返回零值（= 原地不动，等同没配这一项），因此调用方不需要判空。
     * @param {string} charName - 角色标识符
     * @param {string} orientation - 方位
     * @returns {{x:number,y:number,z:number}}
     */
    function pickTransform(charName, orientation) {
        var t = table('CHAR_AVATAR_TRANSFORM');
        if (!t) return zeroTransform();
        var per = (charName && t[charName] && typeof t[charName] === 'object') ? t[charName] : null;
        var cands = [];
        if (per) {
            // 扁平写法优先于二级写法：写了 x/y/z 就说明这一层本来就是变换
            if (isTransformShape(per)) cands.push(per);
            else cands.push(per[text(orientation) || '默认'], per['默认'], per['全局']);
        }
        cands.push(t['全局']);
        for (var i = 0; i < cands.length; i++) {
            var n = normTransform(cands[i]);
            if (n) return n;
        }
        return zeroTransform();
    }

    /**
     * 把显示变换（x / y / z）施加到**取景框**上 —— 全部三轴都只动取景框，不动画布。
     *
     * 设计前提：**头像框与画布永远是固定尺寸、固定位置，绝不变**。
     * 画布尺寸只由取景框的 w / h 决定，所以：
     *   z 改 w / h → 画布尺寸会变（这是"缩放"，上屏就是脸变大 / 变小）；
     *   x / y 只改位置、不改 w / h → 画布尺寸不变，画面里只有内容在动。
     * 语义对标主舞台立绘的「[中 上] 方位 + x/y/z 偏移」。
     *
     *   z 正 = 放大取景：取景框按比例缩小 → 脸更大（特写）；
     *   z 负 = 缩小取景：取景框按比例放大 → 脸更小、露出更多身体。
     *   x 正 = 立绘向右（取景框左移）；y 正 = 立绘向上（取景框下移）。
     *
     * 默认 {0,0,0} = 原取景框原样（autoCrop 的头肩窗口或显式裁切框），即中性基准。
     * 取景框尺寸夹到 ≤ 1（放大到超出整张源图就会顶到边）；**位置不夹** ——
     * autoCrop 窗口顶在 y=0，若夹位置则"立绘往下"永远不生效，所以越界交给 srcRectFor 留透明。
     *
     * @param {{x:number,y:number,w:number,h:number}} crop - 0~1 的取景框（已是 auto / 显式结果）
     * @param {{x:number,y:number,z:number}} t - 规范化后的显示变换（currentTransform）
     * @param {{w:number,h:number}} comp - 合成画布像素尺寸（用于换算步长）
     * @returns {{x:number,y:number,w:number,h:number}} 变换后的取景框（位置可越界）
     */
    function applyTransformToCrop(crop, t, comp) {
        if (!crop || !t) return crop;
        var zoom = (100 + num(t.z, 0)) / 100;
        if (!(zoom > 0)) zoom = 1;                    // z 非有限数 → 不缩放
        // z：以原中心等比放大 / 缩小取景框（z 正 = 放大取景 = 裁更小一块 → 脸更大）
        var cw = crop.w / zoom;
        var ch = crop.h / zoom;
        if (cw > 1) cw = 1;
        if (ch > 1) ch = 1;
        // x / y：平移取景框 —— 取景框在源图上滑动，画面里看到的就是「立绘在框里动」。
        //   方向：x 正 = 立绘向右（取景框向左）；y 正 = 立绘向上（取景框向下）。
        //   步长都用 cw/100（不是 ch）：上屏后取景框宽 = 头像框宽，所以 x 与 y 都换算成
        //   「相对头像框宽的百分比」，与文档口径一致，两轴手感也一样。
        var step = cw / 100;
        var cx = crop.x + crop.w / 2 - num(t.x, 0) * step;
        var cy = crop.y + crop.h / 2 + num(t.y, 0) * step;
        // **位置不夹边界**：取景框挪到源图外时，越界部分由 srcRectFor 只取交集、留透明。
        //   否则 autoCrop 窗口顶在 y = 0，负 y 一上来就被夹回 0，"立绘往下"永远不生效。
        return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
    }

    /**
     * 把变换写到 #text-box-container 的自定义属性上（仅供调试查看 / 自检读取）。
     * x / y / z 的实际效果都在 JS 里（applyTransformToCrop 改取景框），不走 CSS：
     * 头像框与画布永远是固定尺寸、固定位置。这里落原始数字只是保留一份可读快照。
     * @param {{x:number,y:number,z:number}} t
     */
    function applyTransform(t) {
        var box = textBoxContainer();
        if (!box || !box.style || typeof box.style.setProperty !== 'function') return;
        var v = t || zeroTransform();
        try {
            box.style.setProperty('--speaker-avatar-x', String(v.x));
            box.style.setProperty('--speaker-avatar-y', String(v.y));
            box.style.setProperty('--speaker-avatar-z', String(v.z));
        } catch (e) { /* ignore */ }
    }

    /**
     * 零配置自动取框：**头肩窗口**（比例见 DEFAULT_CROP），横向按表情层中心对齐。
     *
     * 为什么不直接拿表情层矩形当裁切框：那是「表情差分图贴在合成画布上的位置」，
     * 在真实素材里通常只有眉眼嘴那么大（例如差分图 110×90 放到 8.5% 缩放，
     * 矩形就是 106×87 像素），拿它当头像只会得到一张"放大版眼睛"，
     * 而且它的上边界在发际线以下 —— 这正是「头顶被裁掉」的来源。
     * 但它的**中心**是有用的信息：侧身 / 转头时脸会偏，用中心对齐头像才不会偏。
     *
     * y 固定从画布顶端起（DEFAULT_CROP.y = 0）：发际线以上的头发也一起进画布，
     * 配合「等比缩放 + 不裁切」（fitInto）与竖长方形的头像框，
     * 无论立绘多大，头顶都不会被裁。
     *
     * @param {{w:number,h:number}} comp - 合成画布像素尺寸
     * @param {{x:number,w:number}} [faceRect] - 表情层矩形（像素）；没有则用 DEFAULT_CROP 的 x
     * @returns {{x:number,y:number,w:number,h:number}|null} 0~1 的裁切框
     */
    function autoCrop(comp, faceRect) {
        var base = normCrop(DEFAULT_CROP);
        if (!base) return null;
        if (!comp || !(comp.w > 0)) return base;
        var fw = faceRect ? num(faceRect.w, 0) : 0;
        if (!(fw > 0)) return base;
        var wPx = base.w * comp.w;
        // 让表情层中心落在窗口中心，再夹在画布内（越界就贴边）
        var cxPx = num(faceRect.x, 0) + fw / 2;
        var xPx = Math.min(Math.max(cxPx - wPx / 2, 0), comp.w - wPx);
        return { x: xPx / comp.w, y: base.y, w: base.w, h: base.h };
    }

    /** 读取立绘运行时状态（不改写；_getCharRt 会补默认值，作为兜底） */
    function runtimeOf(charName) {
        var ge = engine();
        if (!ge || !charName) return null;
        var bag = ge.state && ge.state.charRuntime;
        if (bag && bag[charName]) return bag[charName];
        if (typeof ge._getCharRt === 'function') {
            try { return ge._getCharRt(charName); } catch (e) { /* ignore */ }
        }
        return null;
    }

    /** 场上立绘表（角色名 → 记录） */
    function activeChars() {
        var ge = engine();
        var bag = ge && ge.state && ge.state.activeChars;
        return (bag && typeof bag === 'object') ? bag : null;
    }

    function activeCharNames() {
        var bag = activeChars();
        if (!bag) return [];
        var out = [];
        for (var k in bag) {
            if (Object.prototype.hasOwnProperty.call(bag, k)) out.push(k);
        }
        return out;
    }

    /**
     * 说话人 → 场上角色标识符。**只认精确一致**：
     *   1. SPEAKER_ALIAS 一级映射（值给空串 / null = 明确不显示头像）
     *   2. 与场上立绘的标识符精确相等（activeChars 的键，即 `#char-{id}` 的 id 部分）
     * 对不上就隐藏，不做任何猜测。
     *
     * 为什么不做「场上只有一个立绘就用它」的兜底：那等于「屏幕里有立绘就显示头像」，
     * 旁白、未登记说话的配角、名字写得不一致的说话人都会错误地顶出别人的头像，
     * 而且全程静默 —— 作者只看到"头像错了"，查不出原因。
     * 想让昵称 / 别称指向某个角色，用 SPEAKER_ALIAS 显式声明。
     *
     * @param {string} speaker - 名片文本
     * @returns {string|null} 角色标识符；无法确定时 null
     */
    function resolveCharName(speaker) {
        var s = text(speaker);
        if (!s) return null;

        var aliases = table('SPEAKER_ALIAS');
        if (aliases && Object.prototype.hasOwnProperty.call(aliases, s)) {
            var mapped = aliases[s];
            // 空串 / null = 作者明确要求这个说话人不带头像（如引擎自己产出的"系统"）
            if (mapped === '' || mapped === null || mapped === undefined) return null;
            var ms = text(mapped);
            if (ms) s = ms;
        }

        return (activeCharNames().indexOf(s) >= 0) ? s : null;
    }

    // ── 合成画布 ────────────────────────────────────────────────

    /**
     * 取角色的「立绘来源节点」并确认「已画完」。引擎有两条立绘路径，这里都要认：
     *
     *   ① 分层立绘（updateCharDiff）：宿主 #char-{角色}（.character-layered），
     *      内部一张 .char-composite —— Dom 模式是 canvas（按 dress 原图像素尺寸绘制），
     *      Precomposed 模式是 img。就绪判据 = 引擎自己写的 dataset.charDiffBlit === '1'
     *      （未写说明首帧还是空画布 / 图还在加载，等的完成回调再来）。
     *
     *   ② 单图立绘（updateChar）：**宿主本身就是那张 <img>**
     *      （id=char-{charId}、class="character-img"），没有 .char-composite 也没有 blit 标记。
     *      就绪判据 = complete && naturalWidth > 0 —— 这两个都是浏览器已经算好的现成值，
     *      不额外发请求、不解析图片尺寸去做布局，符合「不做运行时探测」的约束。
     *
     * 两种宿主都要认：合成画布宿主只有 .char-composite 子节点，
     * 单图宿主本身就是那个 <img>，没有 .char-composite 也没有 blit 标记。
     *
     * @param {string} charName - 角色名（activeChars 的键，与 DOM id 的 `char-` 后缀一致）
     * @returns {{el:Element,w:number,h:number,source:string}|null}
     *          source: 'composite'（合成画布）| 'legacy'（单图）；取不到返回 null
     */
    function compositeOf(charName) {
        var host = byId('char-' + charName);
        if (!host) return null;

        // 绑定成函数再往下传：宿主本身没有 querySelector 时（理论上的老宿主）要能安全跳过
        var query = (typeof host.querySelector === 'function')
            ? host.querySelector.bind(host) : null;

        // ① 新版分层立绘
        var el = null;
        if (query) {
            try { el = host.querySelector('.char-composite'); } catch (e) { el = null; }
        }
        if (el) {
            var ds = el.dataset;
            if (ds && String(ds[BLIT_FLAG]) === '1') {
                var w = 0, h = 0;
                if (String(el.tagName).toUpperCase() === 'CANVAS') {
                    w = num(el.width, 0);
                    h = num(el.height, 0);
                } else {
                    w = num(el.naturalWidth, 0);
                    h = num(el.naturalHeight, 0);
                }
                if (w > 0 && h > 0) return { el: el, w: w, h: h, source: 'composite' };
            }
        }

        // ② 旧版单图立绘（宿主持有 img 本身；也兼容将来把 img 挪进子节点的写法）
        var legacy = (String(host.tagName).toUpperCase() === 'IMG') ? host
            : (query ? query('.character-img') : null);
        if (legacy && String(legacy.tagName).toUpperCase() === 'IMG') {
            var lw = num(legacy.naturalWidth, 0), lh = num(legacy.naturalHeight, 0);
            if (legacy.complete && lw > 0 && lh > 0) {
                return { el: legacy, w: lw, h: lh, source: 'legacy' };
            }
        }
        return null;
    }

    // ── 画布生成 ────────────────────────────────────────────────

    function createCanvas(w, h) {
        try {
            if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
            var cv = document.createElement('canvas');
            if (!cv) return null;
            cv.width = w;
            cv.height = h;
            return cv;
        } catch (e) { return null; }
    }

    /**
     * 把 0~1 的取景框换算成「源图上的采样矩形 + 输出画布里的落点」。
     *
     * 采样矩形取整：分数像素会让 drawImage 走插值、边缘发虚；取整后采样点确定。
     * 取景框可以**越出源图**（x / y 平移会把它推出去）：此时只取与源图的交集，
     * 越界的那部分不采样、留透明 —— 画布尺寸仍按整个取景框算，所以框不会被撑动。
     *
     * 输出尺寸由 fitInto 给出（只由取景框 w / h 决定，与平移无关），
     * 所以**缓存键必须带上整个取景框**（不同取景 → 不同内容）。
     *
     * @param {{x:number,y:number,w:number,h:number}} crop - 0~1 的取景框（可越界）
     * @param {{w:number,h:number}} comp - 合成画布像素尺寸
     * @returns {{sx:number,sy:number,sw:number,sh:number,
     *            dx:number,dy:number,dw:number,dh:number,w:number,h:number}|null}
     *          w / h = 输出画布尺寸；sx..sh = 源图采样矩形（空则 sw/sh = 0）；
     *          dx..dh = 该采样矩形在输出画布里的落点。
     */
    function srcRectFor(crop, comp) {
        if (!crop || !comp || !(comp.w > 0) || !(comp.h > 0)) return null;
        var cwPx = Math.max(1, Math.round(crop.w * comp.w));
        var chPx = Math.max(1, Math.round(crop.h * comp.h));
        // 输出画布尺寸只由取景框的 w / h 决定（平移不改尺寸），所以平移不会改变上屏尺寸 ——
        // 这正是「框不动、只换框里的内容」的前提。
        var fit = fitInto(cwPx, chPx, RENDER_W, RENDER_H_MAX);
        if (!fit) return null;
        var outW = Math.max(1, Math.round(fit.w));
        var outH = Math.max(1, Math.round(fit.h));
        var scale = fit.w / cwPx;
        // 取景框与源图求交：x / y 平移允许取景框越出源图，越界部分不采样、留透明。
        var cl = crop.x * comp.w;
        var ct = crop.y * comp.h;
        var sx = Math.round(Math.max(0, cl));
        var sy = Math.round(Math.max(0, ct));
        var ex = Math.round(Math.min(comp.w, cl + cwPx));
        var ey = Math.round(Math.min(comp.h, ct + chPx));
        var sw = ex - sx;
        var sh = ey - sy;
        if (!(sw > 0) || !(sh > 0)) {
            // 整块都在源图外：给一张对尺寸的全透明画布（框依然不会被撑动）
            return { sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 0, dh: 0, w: outW, h: outH };
        }
        return {
            sx: sx, sy: sy, sw: sw, sh: sh,
            dx: Math.round((sx - cl) * scale), dy: Math.round((sy - ct) * scale),
            dw: Math.max(1, Math.round(sw * scale)), dh: Math.max(1, Math.round(sh * scale)),
            w: outW, h: outH
        };
    }

    /**
     * 等比缩放到输出尺寸（**只缩放，不裁切**），返回 drawImage 的目标矩形 ——
     * 输出画布正好等于这个矩形，所以每张头像画布里都没有留白、也没有画外内容。
     *
     * 缩放系数由**宽度**决定：源宽 → dw。于是：
     *   - 上屏宽度恒等于头像框宽（CSS 给的 width:100%）；
     *   - 上屏高度 = 框宽 × 源矩形高宽比 —— 裁切框多高，能显示的内容就多高。
     * 这就是「头像框做成竖向长方形」的落点：竖长的裁切框不再被正方形切掉下半截，
     * 头发与身体完整地留在画布里，超出框的部分交给 CSS 等比缩回去（而不是裁掉）。
     *
     * 唯一的例外是源矩形极端竖长（缩放后高 > dhMax）时改由高度定缩放：
     * 那只是为了兜住位图体积（384 × 5000 这种画布纯属浪费），上屏观感不变 ——
     * 画布比例没变，CSS 照旧按比例缩回去。
     *
     * @param {number} sw - 源宽（像素）
     * @param {number} sh - 源高（像素）
     * @param {number} dw - 输出宽
     * @param {number} dhMax - 输出高上限
     * @returns {{x:number,y:number,w:number,h:number}|null}
     */
    function fitInto(sw, sh, dw, dhMax) {
        if (!(sw > 0) || !(sh > 0) || !(dw > 0) || !(dhMax > 0)) return null;
        var s = dw / sw;
        var h = sh * s;
        if (h > dhMax) { s = dhMax / sh; h = dhMax; }
        var w = sw * s;
        if (!Number.isFinite(w) || !Number.isFinite(h) || !(w > 0) || !(h > 0)) return null;
        return { x: 0, y: 0, w: w, h: h };
    }

    function cacheGet(key) {
        if (!cache.has(key)) return null;
        var v = cache.get(key);
        // 触碰即刷新 LRU 序
        cache.delete(key);
        cache.set(key, v);
        return v;
    }

    function cachePut(key, canvas) {
        if (cache.has(key)) cache.delete(key);
        cache.set(key, canvas);
        while (cache.size > CACHE_MAX) {
            var oldest = cache.keys().next().value;
            cache.delete(oldest);
        }
    }

    /**
     * 缓存键：角色|faceId|dressId|方位|取景框|来源|来源签名。
     * 带上「来源」（tag）是因为同一个角色可能这一刻走手工裁切框、下一刻走 faceRect，
     * 两者像素不同，不能互相命中。
     * 取景框 = 变换后的 0~1 矩形（x/y/w/h 四舍五入到千分之一）—— 它同时包含了 z（改 w/h）
     * 与 x/y（改位置），所以任一参数不同都会各自命中 / 生成对应画布，平移不会命中旧位置的缓存。
     *
     * sig 是给**旧版单图立绘**用的：那条路径没有 face/dress 差分字段，
     * 换一张立绘（换装 / 换表情图）时 faceId、dressId 可能原样不变，
     * 只用前五个分量会让缓存把旧头像当成命中、头像停在上一张脸上。
     * 新版走差分，face/dress 已经足够区分，传空串即可。
     *
     * @param {string} charName - 角色名
     * @param {string} faceId - 表情 ID
     * @param {string} dressId - 服装 ID
     * @param {string} orientation - 方位
     * @param {string} tag - 来源标记：explicit（显式素材）/ crop（手工裁切框）/ auto（自动头肩窗口）
     * @param {string} [sig] - 来源签名（旧版传立绘路径）
     * @param {{x:number,y:number,w:number,h:number}} [crop] - 变换后的取景框
     * @returns {string}
     */
    function keyOf(charName, faceId, dressId, orientation, tag, sig, crop) {
        // 键里必须带**整个取景框**（x / y / w / h）：平移（x/y 变、w/h 不变）也要能区分，
        // 否则挪到新位置会命中旧位置的缓存画布。取景框已完整包含 z 的影响。
        var box = (crop && crop.w > 0 && crop.h > 0)
            ? [Math.round(crop.x * 1000), Math.round(crop.y * 1000),
                Math.round(crop.w * 1000), Math.round(crop.h * 1000)].join(',')
            : '-';
        return [charName, faceId || '-', dressId || '-', orientation || '-',
            box, tag, sig || '-'].join('|');
    }

    /**
     * 从合成节点上裁一块并缩放进输出画布（带缓存）。
     * @param {{el:Element,w:number,h:number}} comp - 合成节点及其像素尺寸
     * @param {{sx:number,sy:number,sw:number,sh:number,w:number,h:number}} src - srcRectFor 的结果
     * @param {string} key - 缓存键
     * @returns {HTMLCanvasElement|null}
     */
    function cropFromComposite(comp, src, key) {
        var hit = cacheGet(key);
        if (hit) { stats.cacheHits++; return hit; }
        if (!comp || !comp.el || !src) return null;

        var cv = createCanvas(src.w, src.h);
        if (!cv || typeof cv.getContext !== 'function') return null;
        var ctx = cv.getContext('2d');
        if (!ctx || typeof ctx.drawImage !== 'function') return null;
        if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, src.w, src.h);
        if (src.sw > 0 && src.sh > 0) {
            try {
                ctx.drawImage(comp.el, src.sx, src.sy, src.sw, src.sh,
                    src.dx, src.dy, src.dw, src.dh);
            } catch (e) {
                warnOnce('draw-fail', '头像裁切失败（合成节点不可绘制）：' + (e && e.message));
                return null;
            }
        }
        stats.crops++;
        cachePut(key, cv);
        return cv;
    }

    /** 把一整张已解码的显式头像图缩放进输出画布（带缓存） */
    function fromImage(img, src, key) {
        var hit = cacheGet(key);
        if (hit) { stats.cacheHits++; return hit; }
        if (!img || !src) return null;

        var cv = createCanvas(src.w, src.h);
        if (!cv || typeof cv.getContext !== 'function') return null;
        var ctx = cv.getContext('2d');
        if (!ctx || typeof ctx.drawImage !== 'function') return null;
        if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, src.w, src.h);
        if (src.sw > 0 && src.sh > 0) {
            try {
                ctx.drawImage(img, src.sx, src.sy, src.sw, src.sh,
                    src.dx, src.dy, src.dw, src.dh);
            } catch (e) {
                warnOnce('draw-fail-img', '头像素材绘制失败：' + (e && e.message));
                return null;
            }
        }
        stats.crops++;
        cachePut(key, cv);
        return cv;
    }

    // ── 显式素材加载 ────────────────────────────────────────────

    function flushExplicit(path, img) {
        explicitImgs[path] = img ? { ok: true, img: img } : { ok: false, img: null };
        var q = explicitPending[path] || [];
        delete explicitPending[path];
        for (var i = 0; i < q.length; i++) {
            try { q[i](img); } catch (e) { /* ignore */ }
        }
    }

    function loadExplicit(path, cb) {
        var rec = explicitImgs[path];
        if (rec) { cb(rec.ok ? rec.img : null); return; }
        if (explicitPending[path]) { explicitPending[path].push(cb); return; }
        explicitPending[path] = [cb];

        var hadImage = (typeof Image !== 'undefined');
        if (!hadImage) { flushExplicit(path, null); return; }
        try {
            var img = new Image();
            img.onload = function () { flushExplicit(path, img); };
            img.onerror = function () { flushExplicit(path, null); };
            img.src = path;
        } catch (e) {
            flushExplicit(path, null);
        }
    }

    // ── 渲染 ────────────────────────────────────────────────────

    /** 把画布挂进容器（同一个画布已在容器里则不动） */
    function mount(canvas) {
        var cont = container();
        if (!cont) return false;
        if (canvas === currentCanvas && canvas.parentNode) return true;
        // 画布是「取景框等比缩到框宽」的成品，上屏靠 CSS 的 width:100% + height:auto。
        // canvas 本身就有内在宽高比，这里再显式写一条 aspect-ratio，
        // 是为了让 height:auto 在实现不完整的环境里也有确定依据
        // （engine_chars.js 的合成画布用的是同一套写法）。
        try {
            if (canvas.style && canvas.width > 0 && canvas.height > 0) {
                canvas.style.aspectRatio = canvas.width + ' / ' + canvas.height;
            }
        } catch (e) { /* ignore */ }
        // 清掉容器里可能残留的旧画布（页面上手写的、或上一张缓存画布）
        try {
            while (cont.firstChild) cont.removeChild(cont.firstChild);
            cont.appendChild(canvas);
        } catch (e) {
            log('头像挂载失败', e);
            return false;
        }
        currentCanvas = canvas;
        return true;
    }

    function show(canvas) {
        if (!mount(canvas)) return false;
        var cont = container();
        if (cont) {
            cont.style.display = 'block';
            classOn(cont, 'on', true);
        }
        classOn(textBoxContainer(), 'has-speaker-avatar', true);
        stats.shows++;
        return true;
    }

    function hide() {
        var cont = container();
        if (cont) {
            cont.style.display = 'none';
            classOn(cont, 'on', false);
        }
        classOn(textBoxContainer(), 'has-speaker-avatar', false);
        currentCanvas = null;
        stats.hides++;
    }

    /** 记下「当前头像属于谁」；传 null 表示当前没有头像 */
    function setCurrent(charName, canvas) {
        currentAvatarChar = charName || null;
        if (!charName) currentCanvas = null;
        else if (canvas) currentCanvas = canvas;
    }

    /** 显式素材加载完成后的重入：说话人没变才继续 */
    function scheduleRender(forSpeaker) {
        if (currentSpeaker !== forSpeaker) return;
        render();
    }

    /**
     * 按当前 speaker 重算并显示头像。同步路径，不做任何网络请求（显式素材除外）。
     * @returns {boolean} 是否显示了头像
     */
    function render() {
        if (!isEnabled) { setCurrent(null, null); hide(); return false; }

        var sp = currentSpeaker;
        var charName = resolveCharName(sp);
        if (!charName) { setCurrent(null, null); hide(); stats.misses++; return false; }

        var bag = activeChars() || {};
        var rec = bag[charName] || {};
        var orientation = text(rec.orientation) || '默认';
        var faceId = text(rec.face);
        var dressId = text(rec.dress);

        // 显示位置 / 缩放：运行期覆盖优先于配置。每次 render 都重算，
        // 于是换角色（方位可能不同）时配置会自动切到该角色那一档。
        currentTransform = overrideTransform || pickTransform(charName, orientation);
        currentTransformSource = overrideTransform ? 'override' : 'config';
        applyTransform(currentTransform);

        // ① 显式素材（优先级 1）
        var explicit = text((table('CHAR_AVATAR') || {})[charName]);
        if (explicit) {
            var rec2 = explicitImgs[explicit];
            if (rec2 && rec2.ok) {
                // 整张素材当裁切框（框就是全图），仍然按宽度等比缩到框宽 ——
                // 美术精修的头像多是竖构图，这样它才不会被压成正方形。
                var compDim = {
                    w: num(rec2.img.naturalWidth, 0) || num(rec2.img.width, 0),
                    h: num(rec2.img.naturalHeight, 0) || num(rec2.img.height, 0)
                };
                // 显式素材也走同一套「框内取景」：z 放大 / x y 平移，默认 {0,0,0} 即整图
                var baseCrop = { x: 0, y: 0, w: 1, h: 1 };
                var xfCrop = applyTransformToCrop(baseCrop, currentTransform, compDim);
                var ir = srcRectFor(xfCrop, compDim);
                // 画布尺寸只由取景框 w/h 决定，平移不改尺寸 ⇒ 画布（那个 div）永远不动，
                // 动的只是它里面被取景到的内容。
                var cv1 = ir
                    ? fromImage(rec2.img, ir,
                        keyOf(charName, faceId, dressId, orientation, 'explicit', '', xfCrop))
                    : null;
                if (cv1 && show(cv1)) { setCurrent(charName, cv1); return true; }
            } else if (!rec2) {
                var loading = true;
                loadExplicit(explicit, function () { loading = false; scheduleRender(sp); });
                // 异步未回：先隐藏，避免残留上一句的头像；同步已回则由上面那次 render 处理
                if (loading) { setCurrent(null, null); hide(); }
                return currentAvatarChar === charName;
            } else {
                warnOnce('explicit-fail:' + explicit,
                    'CHAR_AVATAR[' + charName + '] 的素材不可用，改用裁切：' + explicit);
            }
        }

        // ②③ 从立绘节点裁（新版合成画布 / 旧版单图立绘）
        var comp = compositeOf(charName);
        if (!comp) { setCurrent(null, null); hide(); stats.misses++; return false; }

        var isLegacy = (comp.source === 'legacy');
        var crop = pickCrop(charName, orientation);
        var tag = 'crop';
        if (!crop) {
            // 零配置：按 autoCrop 的头肩窗口取框。
            // faceRect 是「新版合成画布」的坐标系（由 computeCharDiffFaceRect 按 dress 原图算出），
            // 旧版单图的原图尺寸与它无关，套过来会把头像对到别处去 —— 旧版只按默认比例居中。
            var rt = isLegacy ? null : runtimeOf(charName);
            crop = autoCrop(comp, rt && rt.faceRect);
            tag = 'auto';
        }
        if (!crop) { setCurrent(null, null); hide(); stats.misses++; return false; }

        // x / y / z 全部作用在取景框上（画布尺寸只跟 w / h 走，平移不动尺寸）：
        //   z 改 w/h（缩放），x / y 改位置（平移）；画布本身因此永远不动。
        // 默认 {0,0,0} = 上面 autoCrop / 显式裁切框的原样，即中性基准。
        crop = applyTransformToCrop(crop, currentTransform, comp);

        // 旧版单图没有差分字段，换一张立绘时 faceId/dressId 可能原样不变，
        // 用立绘路径当签名，保证换图后重新裁而不是命中旧头像。
        var sig = isLegacy ? text(rec.path) : '';
        var src = srcRectFor(crop, comp);
        if (!src) { setCurrent(null, null); hide(); stats.misses++; return false; }
        var cv = cropFromComposite(comp, src,
            keyOf(charName, faceId, dressId, orientation, tag, sig, crop));
        if (!cv || !show(cv)) { setCurrent(null, null); hide(); stats.misses++; return false; }
        setCurrent(charName, cv);
        return true;
    }

    // ── 对外 API ────────────────────────────────────────────────

    var api = {
        /** 总开关 */
        get enabled() { return isEnabled; },
        set enabled(v) { isEnabled = !!v; if (!isEnabled) hide(); },

        /**
         * 名片更新时调用。speaker 为空 → 隐藏头像并让文本框回位。
         * @param {string|null|undefined} speaker - 名片文本（剧本的 line.speaker）
         * @returns {boolean} 是否显示了头像
         */
        setSpeaker(speaker) {
            var s = text(speaker);
            currentSpeaker = s || null;
            return render();
        },

        /**
         * 立绘合成完成后调用。只在该角色正是当前头像角色时才重算，
         * 因此可以在每次合成后无脑调用，成本是一次字符串解析 + 缓存查表。
         * @param {string} [charName] - 刚合成完的角色名；省略则无条件重算
         * @returns {boolean} 是否显示了头像
         */
        refresh(charName) {
            if (!isEnabled || !currentSpeaker) return false;
            var target = text(charName);
            if (target && resolveCharName(currentSpeaker) !== target) return false;
            return render();
        },

        /** 角色离场时调用：正是当前头像角色 → 隐藏 */
        onCharRemoved(charName) {
            var id = text(charName);
            if (!id) return false;
            if (currentAvatarChar !== id && resolveCharName(currentSpeaker) !== id) return false;
            setCurrent(null, null);
            hide();
            return true;
        },

        /** 场上立绘清空时调用：无条件隐藏 */
        onAllCharsRemoved() {
            setCurrent(null, null);
            hide();
        },

        /** 立即隐藏（不改 speaker，便于外部临时收起） */
        hide,

        /**
         * 调整头像框内的立绘（对标主舞台立绘的「[中 上] 方位 + x/y/z 偏移」）：
         * 头像框永远固定不动，变的是框里的立绘。
         *   setTransform(-5, 8, 10)                 // 框内左移 5%、上移 8%、放大取景到 110%（脸更大）
         *   setTransform({ x: 0, y: 5, z: 0 })      // 也可以直接给对象
         *
         * 语义：x / y 为立绘在框内的平移，相对**头像框宽**的百分比（正值 = 向右 / 向上）；
         *       z 为取景缩放增量，0 = 原始大小、+20 = 放大取景到 120%、-50 = 缩小取景到 50%
         *       （换算同差分：(100 + z) / 100）。
         * 三者都通过平移 / 缩放**取景框**实现（applyTransformToCrop）：画布的 w / h 只跟 z 走、
         * 位置完全不动，所以那个 div 与框本身恒不动，动的只是它里面被取景到的立绘。
         * 调用后**优先于** CHAR_AVATAR_TRANSFORM 配置，直到 clearTransform() 为止 ——
         * 所以可以在控制台反复试值调参，不用改文件。
         * @param {number|object} x - 取景水平平移 %，或 { x, y, z }
         * @param {number} [y] - 取景垂直平移 %
         * @param {number} [z] - 取景缩放增量 %
         * @returns {{x:number,y:number,z:number}} 生效值
         */
        setTransform(x, y, z) {
            var t = (x && typeof x === 'object')
                ? normTransform(x)
                : normTransform({ x: x, y: y, z: z });
            overrideTransform = t || zeroTransform();
            if (currentSpeaker) render();
            else applyTransform(overrideTransform);
            return {
                x: overrideTransform.x,
                y: overrideTransform.y,
                z: overrideTransform.z
            };
        },

        /** 撤销 setTransform 的覆盖，回到 CHAR_AVATAR_TRANSFORM 配置 */
        clearTransform() {
            overrideTransform = null;
            if (currentSpeaker) render();
            return true;
        },

        /**
         * 当前生效的显示变换。
         * @returns {{x:number,y:number,z:number,source:string}} source: 'override' | 'config'
         */
        getTransform() {
            return {
                x: currentTransform.x,
                y: currentTransform.y,
                z: currentTransform.z,
                source: currentTransformSource
            };
        },

        /** 求解结果，便于调试与测试 */
        resolveCharName,

        /** 当前状态快照 */
        stats() {
            return {
                enabled: isEnabled,
                speaker: currentSpeaker,
                char: currentAvatarChar,
                shown: !!(currentCanvas && currentAvatarChar),
                cacheSize: cache.size,
                crops: stats.crops,
                cacheHits: stats.cacheHits,
                shows: stats.shows,
                hides: stats.hides,
                misses: stats.misses
            };
        },

        /** 诊断入口：把「头像不出来」变成可断言的数据 */
        diagnose() {
            var sp = currentSpeaker;
            var name = resolveCharName(sp);
            var bag = activeChars() || {};
            var rec = name ? (bag[name] || {}) : {};
            var ori = text(rec.orientation);
            var comp = name ? compositeOf(name) : null;
            var host = name ? byId('char-' + name) : null;
            return {
                speaker: sp,
                char: name,
                /** 场上立绘的标识符清单。speaker 必须与其中一个精确一致才出头像，否则一律不出 */
                onStage: activeCharNames(),
                orientation: ori || null,
                /** 立绘宿主是否找到（#char-{标识符}）；false = speaker 与标识符对不上 */
                hostFound: !!host,
                hostTagName: host ? String(host.tagName) : null,
                /** 头像来源：composite（合成画布）/ legacy（单图）*/
                source: comp ? comp.source : null,
                sourceSize: comp ? (comp.w + 'x' + comp.h) : null,
                /** 当前上屏的画布像素尺寸（宽恒 384，高按取景框比例）。
                 *  上屏高度 = 框宽 × 高/宽，所以这里的比值就是取景框（上屏头像）的高宽比。 */
                renderSize: (currentCanvas && currentCanvas.width)
                    ? (currentCanvas.width + 'x' + currentCanvas.height) : null,
                cropConfigured: !!(name && pickCrop(name, ori)),
                /** 有没有表情层矩形。它不再当裁切框用，只用来给自动头肩窗口做横向对齐 */
                faceRect: !!(name && runtimeOf(name) && runtimeOf(name).faceRect),
                compositeReady: !!comp,
                avatarShown: !!(currentCanvas && currentAvatarChar),
                /** 当前生效的显示变换（x/y/z 的百分比与来源） */
                transform: {
                    x: currentTransform.x,
                    y: currentTransform.y,
                    z: currentTransform.z,
                    source: currentTransformSource
                },
                issues: issues.slice()
            };
        },

        /** 清空缓存与统计（测试与「重载界面」用） */
        reset() {
            // 先收起界面，再清状态 —— 否则 hide() 会把刚归零的统计又 +1
            setCurrent(null, null);
            hide();
            cache.clear();
            explicitImgs = Object.create(null);
            explicitPending = Object.create(null);
            warned = Object.create(null);
            issues.length = 0;
            stats = { crops: 0, cacheHits: 0, shows: 0, hides: 0, misses: 0 };
            currentSpeaker = null;
            overrideTransform = null;
            currentTransform = zeroTransform();
            currentTransformSource = 'config';
            applyTransform(currentTransform);
        }
    };

    root.SpeakerAvatar = api;

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
