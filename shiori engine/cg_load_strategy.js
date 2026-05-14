/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * CG 加载策略配置
 * 用于优化大量 CG 图片的加载性能
 */

const CG_LOAD_STRATEGY = {
    // 主页面预加载策略
    INDEX_PAGE: {
        // 立即预加载的图片数量（关键图片）
        eagerLoadCount: 5,
        
        // 是否启用懒加载剩余图片
        enableLazyLoad: true,
        
        // 懒加载延迟时间（毫秒）
        lazyLoadDelay: 500
    },
    
    // CG 鉴赏页面策略 - 应用内模式（QtWebEngine）
    CG_PAGE: {
        // 内存中最大缓存图片数量
        maxCacheSize: 8,
        
        // 预加载相邻图片范围（前后各几张）
        preloadRange: 3,
        
        // 首屏立即加载的缩略图数量
        eagerThumbnailCount: 3,
        
        // 懒加载视口边距（像素）
        viewportMargin: 200,
        
        // 是否启用交叉观察器懒加载
        enableIntersectionObserver: true,
        
        // 是否允许点击未加载完成的缩略图
        allowClickUnloadedThumbnails: true
    },
    
    // CG 鉴赏页面策略 - 外部浏览器模式（Chrome/Edge等）
    CG_PAGE_EXTERNAL: {
        // 内存中最大缓存图片数量（外部浏览器可以更激进）
        maxCacheSize: 15,
        
        // 预加载相邻图片范围（前后各几张）
        preloadRange: 5,
        
        // 首屏立即加载的缩略图数量（外部浏览器可以加载更多）
        eagerThumbnailCount: 8,
        
        // 懒加载视口边距（像素）
        viewportMargin: 400,
        
        // 是否启用交叉观察器懒加载
        enableIntersectionObserver: true,
        
        // 是否允许点击未加载完成的缩略图
        allowClickUnloadedThumbnails: true
    },
    
    // 性能监控配置
    PERFORMANCE: {
        // 加载超时阈值（毫秒）
        loadTimeout: 5000,
        
        // 缓存命中率监控
        enableCacheHitMonitoring: true,
        
        // 日志级别: 'debug', 'info', 'warn', 'error'
        logLevel: 'info'
    }
};

// 导出配置（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CG_LOAD_STRATEGY;
}
