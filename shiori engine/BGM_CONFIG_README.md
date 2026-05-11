# BGM 配置文件使用说明

## 概述

`bgm_config.js` 文件集中管理项目中所有的背景音乐（BGM）资源路径，避免了在多个 HTML 文件中硬编码音频路径。

## 文件结构

该文件导出了三个配置对象：

### 1. `BGM_CONFIG`
根目录路径，简洁的键值对格式，适用于 index.html：
```javascript
{
    'bgm1': 'assets/bgm/bgm1.ogg',
    'bgm2': 'assets/bgm/bgm2.ogg',
    // ... 共 28 首 BGM
}
```

### 2. `BGM_CONFIG_SUB`
子目录路径（../assets/...），适用于 html/*.html 和 scenes/*.html：
```javascript
{
    'bgm1': '../assets/bgm/bgm1.ogg',
    'bgm2': '../assets/bgm/bgm2.ogg',
    // ... 共 28 首 BGM
}
```

### 3. `BGM_MAP`
兼容旧版本的数组格式，适用于 bgm.html 的播放器：
```javascript
{
    'bgm1': ['../assets/bgm/bgm1.ogg'],
    'bgm2': ['../assets/bgm/bgm2.ogg'],
    // ... 共 28 首 BGM
}
```

## 使用方法

### 在 HTML 文件中引入

在需要播放 BGM 的 HTML 文件的 `<head>` 部分添加：

```html
<script src="bgm_config.js"></script>
```

### 在 sceneData 中使用（scenes/*.html）

```javascript
const sceneData = {
    background: {
        'yl1': '../assets/cg/yl1.jpg'
    },
    bgm: BGM_CONFIG_SUB,  // 使用子目录配置
    audio: {
        'theme': '../assets/audio/theme.mp3'
    },
    story: [
        {
            text: "剧情文本",
            speaker: "说话者",
            background: "yl1",
            bgm: "bgm1",  // 引用配置的 BGM 键名
            action: null
        }
    ]
};
```

### 在 html/*.html 中使用（如 CG.html）

```javascript
const indexData = {
    bgm: BGM_CONFIG_SUB,  // 使用子目录配置
    story: [...]
};
```

### 在 index.html 中使用

```javascript
const indexData = {
    bgm: BGM_CONFIG,  // 直接引用配置对象
    story: [...]
};
```

### 在 bgm.html 中使用

```javascript
// 使用 BGM_MAP 兼容旧代码
const bgmMap = BGM_MAP;

function playBGM(bgmName) {
    if (bgmMap[bgmName]) {
        // 播放逻辑
    }
}
```

## 添加新的 BGM

如需添加新的 BGM，只需在 `bgm_config.js` 中同时添加新的键值对到三个配置对象：

```javascript
const BGM_CONFIG = {
    // ... 现有配置
    'bgm29': 'assets/bgm/bgm29.ogg'  // 新增（根目录路径）
};

const BGM_CONFIG_SUB = {
    // ... 现有配置
    'bgm29': '../assets/bgm/bgm29.ogg'  // 新增（子目录路径）
};

const BGM_MAP = {
    // ... 现有配置
    'bgm29': ['../assets/bgm/bgm29.ogg']  // 新增（数组格式）
};
```

## 优势

1. **集中管理**：所有 BGM 路径在一个文件中定义，便于维护
2. **避免重复**：无需在每个 HTML 文件中重复定义相同的路径
3. **易于修改**：修改路径时只需更新一个文件
4. **向后兼容**：提供两种格式，兼容新旧代码
5. **类型清晰**：明确区分 BGM 和其他音频资源

## 注意事项

1. 确保 BGM 文件名使用小写，遵循统一的命名规范
2. 路径相对于项目根目录
3. 在不同层级的 HTML 文件中引用时，注意调整相对路径（如 `../bgm_config.js`）
4. 修改配置后，刷新浏览器即可生效，无需其他操作
