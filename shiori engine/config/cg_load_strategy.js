/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * CG 加载策略配置，管理大量 CG 图片的预加载与懒加载策略
 */

/**
 * CG 加载策略配置对象
 * 按使用场景分为四组策略：
 *   INDEX_PAGE        — 主页面（首页）的预加载与懒加载策略
 *   CG_PAGE           — CG 鉴赏页面在应用内 QtWebEngine 中的加载策略（内存受限）
 *   CG_PAGE_EXTERNAL  — CG 鉴赏页面在外部浏览器（Chrome/Edge）中的加载策略（内存更充裕）
 *   PERFORMANCE       — 性能监控与日志配置
 */
const CG_LOAD_STRATEGY = {
    // ========================
    // 主页面预加载策略
    // 控制首页进入时图片的加载节奏，避免一次性加载过多图片阻塞渲染
    // ========================
    INDEX_PAGE: {
        // 立即预加载的图片数量（关键图片），其余图片走懒加载流程
        eagerLoadCount: 5,
        
        // 是否启用懒加载剩余图片。设为 false 则所有图片一次性全部加载
        enableLazyLoad: true,
        
        // 懒加载延迟时间（毫秒），在页面加载完成后延迟该时间再开始加载剩余图片
        lazyLoadDelay: 500
    },
    
    // ========================
    // CG 鉴赏页面策略 — 应用内模式（QtWebEngine）
    // QtWebEngine 内存限制较严格，需要更保守的缓存与预加载参数
    // ========================
    CG_PAGE: {
        // 内存中最大缓存图片数量，超出后按 LRU 策略淘汰旧图片
        maxCacheSize: 8,
        
        // 预加载相邻图片范围（前后各几张），用于翻页时的无缝体验
        preloadRange: 3,
        
        // 首屏立即加载的缩略图数量，保证用户第一时间看到内容
        eagerThumbnailCount: 3,
        
        // 懒加载视口边距（像素），图片进入视口该范围时提前触发加载
        viewportMargin: 200,
        
        // 是否启用 IntersectionObserver API 实现高效懒加载
        // 关闭时回退到 scroll 事件监听方案
        enableIntersectionObserver: true,
        
        // 是否允许点击未加载完成的缩略图
        // true: 点击后等待加载完成再展示；false: 未加载完成时点击无效
        allowClickUnloadedThumbnails: true
    },
    
    // ========================
    // CG 鉴赏页面策略 — 外部浏览器模式（Chrome/Edge 等）
    // 外部浏览器内存管理更宽松，可设置更激进的参数提升体验
    // ========================
    CG_PAGE_EXTERNAL: {
        // 内存中最大缓存图片数量（外部浏览器可以更激进）
        maxCacheSize: 15,
        
        // 预加载相邻图片范围（前后各几张），范围更大以提供更流畅的翻页体验
        preloadRange: 5,
        
        // 首屏立即加载的缩略图数量（外部浏览器渲染性能更好，可加载更多）
        eagerThumbnailCount: 8,
        
        // 懒加载视口边距（像素），更大的边距让图片更早开始加载
        viewportMargin: 400,
        
        // 是否启用 IntersectionObserver API 实现高效懒加载
        enableIntersectionObserver: true,
        
        // 是否允许点击未加载完成的缩略图
        allowClickUnloadedThumbnails: true
    },
    
    // ========================
    // 性能监控配置
    // 用于开发调试阶段追踪图片加载性能与缓存效率
    // ========================
    PERFORMANCE: {
        // 单张图片加载超时阈值（毫秒），超时后触发降级或重试逻辑
        loadTimeout: 5000,
        
        // 是否启用缓存命中率监控，用于评估加载策略的效率
        enableCacheHitMonitoring: true,
        
        // 日志级别: 'debug'（详细）, 'info'（常规）, 'warn'（仅警告）, 'error'（仅错误）
        logLevel: 'info'
    }
};

/**
 * 模块导出 — 兼容 CommonJS（Node.js）与浏览器全局变量两种模式
 * 在浏览器环境中 CG_LOAD_STRATEGY 作为全局变量可直接访问；
 * 在 Node.js 环境中通过 module.exports 导出，供构建工具或单元测试使用。
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CG_LOAD_STRATEGY;
}
