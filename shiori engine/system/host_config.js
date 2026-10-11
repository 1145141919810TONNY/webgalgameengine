/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 宿主渲染配置模块，提供页面级渲染策略统一读取接口（缩略图、立绘渲染器、布局模式等）。
 */
(function (root) {
    'use strict';

    // localStorage 存储键名 —— 宿主可通过此键持久化渲染配置
    var KEY = 'shiori_render_settings';

    // 默认配置项（当宿主注入和 localStorage 均无配置时作为兜底）
    var DEFAULTS = {
        thumbnails: true,         // 是否启用缩略图（CG / 存档预览使用）
        frameCache: false,        // 是否启用帧缓存（立绘合成优化）
        charRenderer: 'Dom',      // 立绘渲染器类型：'Dom' | 'Canvas' | 'Precomposed'
        diskCache: 'Mb1',         // 磁盘缓存策略标识
        hardwareAccel: 'Default', // 硬件加速模式
        layoutMode: 'Flow'        // 布局模式：'Flow'（流式布局）等
    };

    /**
     * 读取并合并渲染配置
     * 优先级：window.__shioriHostConfig > localStorage > DEFAULTS
     * 返回值经过规范化，确保各字段类型正确
     * @returns {Object} 规范化后的配置对象
     */
    function read() {
        // 第一优先级：从 C# 启动器注入的全局对象读取
        var src = root.__shioriHostConfig;
        
        // 第二优先级：从 localStorage 读取持久化配置
        if (!src || typeof src !== 'object') {
            try {
                if (typeof localStorage !== 'undefined') {
                    src = JSON.parse(localStorage.getItem(KEY) || 'null');
                }
            } catch (e) {
                // JSON 解析失败时使用 null，后续会回退到默认值
                src = null;
            }
        }
        
        // 第三优先级：使用内置默认值
        if (!src || typeof src !== 'object') src = DEFAULTS;
        
        // 规范化各字段类型，确保返回值类型一致
        return {
            thumbnails: src.thumbnails !== false,  // 默认为 true，只有显式 false 才关闭
            frameCache: !!src.frameCache,          // 布尔化
            charRenderer: String(src.charRenderer || DEFAULTS.charRenderer),
            diskCache: String(src.diskCache || DEFAULTS.diskCache),
            hardwareAccel: String(src.hardwareAccel || DEFAULTS.hardwareAccel),
            layoutMode: String(src.layoutMode || DEFAULTS.layoutMode)
        };
    }

    /**
     * 根据配置生成资源缩略图 URL
     * 当启用缩略图（thumbnails=true）时，将 /assets/xxx 路径替换为 /cg-thumb/xxx
     * 支持 data: URI 和 blob: URI 的直接透传（不做路径转换）
     * @param {string} path - 原始资源路径
     * @param {Object} [cfg] - 可选的预读取配置对象，省略时自动调用 read()
     * @returns {string} 转换后的缩略图或原始路径
     */
    function assetThumbUrl(path, cfg) {
        var raw = String(path == null ? '' : path);
        // data: 和 blob: URI 直接返回，不做路径转换
        if (/^(data:|blob:)/i.test(raw)) return raw;
        // 分离路径和查询参数，避免缩略图路径拼接丢失 query string
        var q = raw.indexOf('?');
        var base = q >= 0 ? raw.slice(0, q) : raw;
        var query = q >= 0 ? raw.slice(q) : '';
        // 只处理包含 /assets/ 的标准路径
        var m = base.match(/(?:^|\/)assets\/(.+)$/i);
        if (!m) return raw;
        var thumbs = (cfg || read()).thumbnails !== false;
        // 启用缩略图时使用 /cg-thumb/ 前缀，否则使用原始 /assets/ 路径
        return (thumbs ? '/cg-thumb/' : '/assets/') + m[1] + query;
    }

    // 自动切换到 Canvas 渲染器的角色数量阈值
    // 当立绘角色数 >= 此值时，自动使用 Canvas 渲染以提升性能
    var AUTO_CANVAS_MIN_CHARS = 2;

    /**
     * 获取当前配置的立绘渲染器类型
     * @param {Object} [cfg] - 可选的预读取配置
     * @returns {string} 渲染器类型字符串
     */
    function charRenderer(cfg) {
        return String((cfg || read()).charRenderer || DEFAULTS.charRenderer);
    }

    /**
     * 获取当前配置的布局模式
     * @param {Object} [cfg] - 可选的预读取配置
     * @returns {string} 布局模式字符串
     */
    function layoutMode(cfg) {
        return String((cfg || read()).layoutMode || DEFAULTS.layoutMode);
    }

    /**
     * 计算实际生效的立绘渲染器
     * 当配置为 'Auto' 时，根据角色数量和锁存状态动态决定：
     *   - 角色数 >= AUTO_CANVAS_MIN_CHARS → 使用 Canvas
     *   - 否则使用 Dom
     * 若已有锁存值（latched），优先使用锁存值以保持渲染一致性
     * @param {Object} cfg - 配置对象
     * @param {number} count - 当前立绘角色数量
     * @param {string} latched - 已锁存的渲染器类型
     * @returns {string} 实际使用的渲染器：'Precomposed' | 'Canvas' | 'Dom'
     */
    function effectiveCharRenderer(cfg, count, latched) {
        var mode = charRenderer(cfg);
        // 显式指定渲染器时直接使用，不做自动切换
        if (mode === 'Precomposed' || mode === 'Canvas' || mode === 'Dom') return mode;
        // 已有锁存值时优先使用，避免渲染中途切换导致画面闪烁
        if (latched === 'Canvas' || latched === 'Dom') return latched;
        // Auto 模式：根据角色数量动态决定
        var n = Number(count);
        if (!Number.isFinite(n) || n < 0) n = 0;
        return n >= AUTO_CANVAS_MIN_CHARS ? 'Canvas' : 'Dom';
    }

    /**
     * 从资源路径中剥离 assets/ 前缀，提取相对路径
     * 同时进行安全校验：过滤路径遍历（..）、空段、盘符等非法路径
     * @param {string} path - 原始资源路径
     * @returns {string} 清理后的安全相对路径，非法路径返回空字符串
     */
    function stripAssetsRel(path) {
        // 统一路径分隔符为正斜杠
        var s = String(path == null ? '' : path).replace(/\\/g, '/');
        // 提取 assets/ 之后的相对路径部分
        var m = s.match(/(?:^|\/)assets\/(.+)$/i);
        if (m) s = m[1];
        // 去除前导斜杠
        s = s.replace(/^\/+/, '');
        if (!s) return '';
        // 安全校验：逐段检查，拒绝空段、.、.. 等路径遍历攻击
        var parts = s.split('/');
        for (var i = 0; i < parts.length; i++) {
            if (!parts[i] || parts[i] === '.' || parts[i] === '..') return '';
        }
        // 拒绝 Windows 绝对路径（如 C:\...）
        if (/^[a-zA-Z]:/.test(s)) return '';
        return parts.join('/');
    }

    /**
     * 生成立绘帧合成请求 URL
     * 将服装（dress）、表情（face）、尺寸、偏移等参数编码为查询字符串
     * 供 C# 宿主端或 Canvas 渲染器进行立绘帧合成
     * @param {Object} parts - 立绘部件参数
     * @param {string} parts.dress - 服装资源路径
     * @param {string} parts.face - 表情资源路径
     * @param {number} parts.sw - 服装宽度
     * @param {number} parts.sh - 服装高度
     * @param {number} [parts.ox=0] - X 偏移量
     * @param {number} [parts.oy=0] - Y 偏移量
     * @param {number} [parts.fs=1] - 面部缩放
     * @param {number} [parts.bs=1] - 身体缩放
     * @returns {string} 帧合成请求 URL，参数不合法时返回空字符串
     */
    function charFrameUrl(parts) {
        parts = parts || {};
        var dress = stripAssetsRel(parts.dress);
        var face = stripAssetsRel(parts.face);
        var sw = Number(parts.sw);
        var sh = Number(parts.sh);
        // 必需参数校验：服装、表情路径和尺寸缺一不可
        if (!dress || !face || !(sw > 0) || !(sh > 0)) return '';
        /**
         * 数值规范化辅助函数：有效有限数值原样返回，否则使用兜底值
         * @param {*} v - 待检查的值（数字或可转换为数字的字符串）
         * @param {number} fallback - 值无效（NaN / Infinity / 非数字）时的兜底值
         * @returns {number} 规范化后的有限数值
         */
        function num(v, fallback) {
            var n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        }
        var ox = num(parts.ox, 0);
        var oy = num(parts.oy, 0);
        var fs = num(parts.fs, 1);
        var bs = num(parts.bs, 1);
        // 缩放因子必须为正数
        if (!(fs > 0) || !(bs > 0)) return '';
        return '/char-frame?dress=' + encodeURIComponent(dress)
            + '&face=' + encodeURIComponent(face)
            + '&ox=' + ox
            + '&oy=' + oy
            + '&fs=' + fs
            + '&sw=' + sw
            + '&sh=' + sh
            + '&bs=' + bs;
    }

    // 组装并导出公共 API 对象，挂载到全局（window.ShioriHostConfig）
    var api = {
        LOCAL_STORAGE_KEY: KEY,             // 暴露存储键名供外部读写
        DEFAULTS: DEFAULTS,                 // 暴露默认值供外部参考
        AUTO_CANVAS_MIN_CHARS: AUTO_CANVAS_MIN_CHARS, // Canvas 自动切换阈值
        read: read,                         // 读取合并后的配置
        assetThumbUrl: assetThumbUrl,       // 资源缩略图路径转换
        charRenderer: charRenderer,         // 获取立绘渲染器配置
        layoutMode: layoutMode,             // 获取布局模式配置
        effectiveCharRenderer: effectiveCharRenderer, // 计算实际生效的渲染器
        charFrameUrl: charFrameUrl          // 生成立绘帧合成 URL
    };
    // 挂载到全局对象（浏览器环境为 window），供其他模块通过 window.ShioriHostConfig 访问
    root.ShioriHostConfig = api;
    // 兼容 CommonJS 模块导出（Node.js 环境或构建工具）
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
