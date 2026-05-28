/**
 * CG 配置文件
 * 集中管理所有 CG 鉴赏图片资源路径
 */

// 根目录路径配置（用于 index.html）
const CG_CONFIG = {
    'cg': 'assets/cg/cg.jpg',
    //根据需要自行添加其他资源路径
};

// 子目录路径配置（用于 html/*.html 和 scenes/*.html）
// 注意：为了与主页面共享浏览器缓存，我们需要确保最终解析的URL一致
// 由于浏览器缓存基于完整URL，不同路径会导致重复加载
const CG_CONFIG_SUB = {
    'cg': '../assets/cg/cg.jpg',
    //根据需要自行添加其他资源路径
};
