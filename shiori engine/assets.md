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

音效和语音文件分别存放在 `assets/se/` 和 `assets/audio/` 目录中。

### 4.1 零配置管理模式（推荐）

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

### 4.2 独立音频通道

Shiori 引擎提供了三种独立的音频通道，可以在同一剧情行中同时触发：

| 属性 | 用途 | 文件路径 | 播放器 | 特性 |
| :--- | :--- | :--- | :--- | :--- |
| `bgm` | 背景音乐 | `assets/bgm/` | bgmPlayer | 循环播放，切换场景时自动过渡 |
| `voice` | 人物语音 | `assets/audio/` | voicePlayer | 单次播放，不与音效冲突 |
| `se` | 音效 | `assets/se/` | sePlayer | 单次播放，可与语音同时播放 |

**重要特性：**
- **独立性**：`voice` 和 `se` 使用不同的播放器，可以同时播放而不会互相打断
- **零配置加载**：所有音频文件无需在 `sceneData` 中预定义映射，引擎会根据文件名自动拼接路径并播放
- **多格式支持**：`.ogg`, `.mp3`, `.wav`, `.m4a`, `.aac`

### 4.3 使用示例

#### 基础用法

```javascript
// 单个语音
{
    text: "你好！",
    speaker: "主角",
    voice: "hello"  // 自动播放 assets/audio/hello.ogg/mp3/wav...
}

// 单个音效
{
    text: "点击按钮",
    se: "click"     // 自动播放 assets/se/click.ogg/mp3/wav...
}

// 背景音乐
{
    text: "场景开始",
    bgm: "theme"    // 自动播放 assets/bgm/theme.ogg/mp3/wav...（循环）
}
```

#### 组合使用

```javascript
// 同时播放语音和音效
{
    text: "攻击！",
    speaker: "战士",
    voice: "attack_voice",  // 播放语音
    se: "sword_hit"         // 同时播放音效（互不干扰）
}

// 完整示例：BGM + 语音 + 音效
{
    text: "欢迎来到这个世界！",
    speaker: "向导",
    bgm: "opening_theme",       // 背景音乐（循环）
    voice: "welcome",           // 人物语音
    se: "magic_sparkle"         // 魔法音效
}
```

#### 多个音效

```javascript
// 支持数组形式播放多个音效
{
    text: "连击！",
    se: ["hit1", "hit2", "hit3"]  // 依次播放三个音效
}
```

### 4.4 注意事项

1. **独立性**：`voice` 和 `se` 使用不同的播放器，可以同时播放而不会互相打断
2. **BGM 特殊性**：BGM 会循环播放，切换场景时会自动淡出并播放新的 BGM
3. **音量控制**：所有音频通道的音量由系统模块统一管理
4. **自动播放限制**：浏览器可能阻止自动播放，需要用户交互后才能播放音频
5. **文件命名**：建议使用小写字母和下划线，避免特殊字符

### 4.5 与传统 audio 属性的区别

**旧版方式**（仍兼容）：
```javascript
{
    text: "测试",
    audio: "sound_file"  // 混用 voicePlayer，会与语音冲突
}
```

**新版方式**（推荐）：
```javascript
{
    text: "测试",
    voice: "voice_file",  // 独立语音通道
    se: "se_file"         // 独立音效通道
}
```

**优势**：
- 语音和音效可以同时播放
- 更清晰的语义表达
- 更好的音频管理
- 向后兼容旧版 `audio` 属性

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
