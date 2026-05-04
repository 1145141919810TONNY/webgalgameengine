# 资源管理与配置指南

统一管理背景、立绘、BGM、音效及视频资源的引用与配置。

## 核心原则：集中化管理

Shiori 引擎采用集中化配置文件来管理所有静态资源。这种方式避免了在每个场景文件中重复硬编码路径，使得资源维护更加高效且不易出错。所有配置文件均位于项目根目录下，并在场景文件的 `<head>` 中引入。

---

## 1. 背景图片 (Backgrounds)

背景图片统一存放在 `assets/bg/` 目录中。

### 配置方式

在场景文件头部引入 `bg_config.js`，该文件定义了 `BG_CONFIG_SUB` 对象：

```html
<script src="../bg_config.js"></script>
```

**配置文件示例 (bg_config.js)：**

```javascript
// 子目录路径配置
const BG_CONFIG_SUB = {
    'school_day': '../assets/bg/school_day.png',
    'classroom_night': '../assets/bg/classroom_night.png'
};
```

**剧本中使用：**

```javascript
const sceneData = {
    background: BG_CONFIG_SUB, // 引用集中配置
    story: [
        {
            text: "切换到学校背景",
            background: "school_day" // 直接使用配置中的键名
        }
    ]
};
```

---

## 2. 背景音乐 (BGM)

BGM 文件统一存放在 `assets/bgm/` 目录中。

### 配置方式

在场景文件头部引入 `bgm_config.js`，该文件定义了 `BGM_CONFIG_SUB` 对象：

```html
<script src="../bgm_config.js"></script>
```

**配置文件示例 (bgm_config.js)：**

```javascript
const BGM_CONFIG_SUB = {
    'theme_romantic': '../assets/bgm/theme_romantic.ogg',
    'battle_theme': '../assets/bgm/battle_theme.ogg'
};
```

**剧本中使用：**

```javascript
const sceneData = {
    bgm: BGM_CONFIG_SUB, // 引用集中配置
    story: [
        {
            text: "播放浪漫音乐",
            bgm: "theme_romantic" // 直接使用配置中的键名
        },
        {
            text: "淡出切换 BGM",
            bgm: "bgm wait battle_theme" // 使用 wait 指令实现平滑过渡
        }
    ]
};
```

---

## 3. 角色立绘 (Characters)

立绘文件统一存放在 `assets/chars/` 目录中。

### 配置方式

在场景文件头部引入 `illustration.js`，该文件定义了 `CHAR_CONFIG_SUB` 对象：

```html
<script src="../illustration.js"></script>
```

**配置文件示例 (illustration.js)：**

```javascript
const CHAR_CONFIG_SUB = {
    'heroine_smile': '../assets/chars/heroine_smile.png',
    'hero_serious': '../assets/chars/hero_serious.png'
};
```

**剧本中使用：**

```javascript
{
    text: "角色出现在左侧",
    chars: "[左 heroine_smile]" // 格式：[位置 资源ID]
},
{
    text: "角色A点头示意",
    chars: "[角色A 中 点头 hero_serious]" // 支持角色标识符和动作指令
}
```

> **提示：** 详细的立绘指令语法（如坐标控制、动作序列）请参考 `illustration.md` 文档或教学网页内的教程。

---

## 4. 音频资源 (Audio - SE/Voice)

音效和语音文件存放在 `assets/audio/` 目录中。

### 零配置管理模式（推荐）

从 V1.2.6 开始，引擎支持音频资源零配置管理。你无需在场景中定义映射，直接使用文件名即可。

```javascript
{
    text: "播放开门声",
    audio: "door_open" // 引擎自动查找 ../assets/audio/door_open.ogg
},
{
    text: "连续播放语音[s]播放第二条语音",
    audio: "voice1[a]voice2" // 依次播放两个音频文件
}
```

---

## 5. 视频资源 (Video)

视频文件存放在 `assets/video/` 目录中。

### 零配置管理模式（推荐）

与音频类似，视频也支持零配置管理。

```javascript
{
    text: "播放开场动画",
    video: "op_video" // 引擎自动查找 ../assets/video/op_video.mp4
}
```

> **注意：** 视频播放时会自动停止当前 BGM，结束后需手动指定新的 BGM。

---

## 6. CG 鉴赏图片 (CG)

CG 图片存放在 `assets/cg/` 目录中。

### 配置方式

在场景文件头部引入 `cg_config.js`，该文件定义了 `CG_CONFIG_SUB` 对象：

```html
<script src="../cg_config.js"></script>
```

**配置文件示例 (cg_config.js)：**

```javascript
const CG_CONFIG_SUB = {
    'ending_cg': '../assets/cg/ending_cg.jpg',
    'special_event': '../assets/cg/special_event.jpg'
};
```

**剧本中使用：**

```javascript
const sceneData = {
    background: BG_CONFIG_SUB, // CG 也是通过 background 属性显示
    story: [
        {
            text: "展示一张精美的 CG",
            background: "ending_cg" // 引用 cg_config.js 中的键名
        }
    ]
};
```

---

## 总结与建议

1. **优先使用零配置**：对于音频和视频，直接使用文件名是最便捷的方式。
2. **保持命名规范**：建议使用有意义的英文或拼音命名资源文件，避免使用特殊字符。
3. **统一入口引入**：确保每个场景文件都正确引入了所需的配置文件（bg, bgm, cg, illustration）。
