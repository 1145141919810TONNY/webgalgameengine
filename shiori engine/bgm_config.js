/**
 * BGM 配置文件
 * 集中管理所有背景音乐资源路径
 */

// 根目录路径配置（用于 index.html）
const BGM_CONFIG = {
    'bgm1': 'assets/bgm/bgm1.ogg',//根据需要自行添加其他资源路径
};

// 子目录路径配置（用于 html/*.html 和 scenes/*.html）
const BGM_CONFIG_SUB = {
    'bgm1': '../assets/bgm/bgm1.ogg',//根据需要自行添加其他资源路径
};

// 兼容旧版本的 bgmMap 格式（带数组的版本，用于 html/bgm.html）
const BGM_MAP = {
    'bgm1': ['../assets/bgm/bgm1.ogg'],//根据需要自行添加其他资源路径
};
