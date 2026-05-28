/**
 * 背景图片配置文件
 * 集中管理所有场景背景图片资源路径
 * 仅用于剧本场景（Scene）中通过 background: "key_name" 引用
 * 严禁将这些背景图添加到 html/CG.html 的鉴赏列表中
 */

// 根目录路径配置（用于 index.html）
const BG_CONFIG = {
    'bg1': 'assets/bg/bg1.png',//根据需要自行添加其他资源路径
};

// 子目录路径配置（用于 html/*.html 和 scenes/*.html）
const BG_CONFIG_SUB = {
    'bg1': '../assets/bg/bg1.png',//根据需要自行添加其他资源路径
};
