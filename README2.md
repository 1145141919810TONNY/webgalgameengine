# Shiori 基本语法教学

**重要说明：**

由于引擎在早期开发阶段缺乏完整的资源测试环境，旧版 README 中可能包含部分已废弃或不支持的语法。本文档将全面罗列当前版本（V1.2.3）所有可用的语法与指令。**若与其他文档存在冲突，请以本文档为准。**

在更新日志中的内容本文件不再赘述，原README.md中正确的指令此文件也不再赘述。

更新时间：2026/4/16 V1.2.3

- 立绘类命令请参考[illustration.md](assets/chars/illustration.md) 
- 背景类命令请参考[background.md](assets/bg/background.md)
- 本引擎的教学网页：[https://1145141919810tonny.github.io/Shioriteaching/](https://1145141919810tonny.github.io/Shioriteaching/)

## 1. 开发者工具

### 1.1 F1 - 开发者调试面板
按 F1 可快速查看当前游戏状态，包括场景文件名、剧情索引、BGM、背景图片和立绘列表等关键信息。
![img](https://github.com/1145141919810TONNY/webgalgameengine/blob/main/img/1.png)

### 1.2 F12 - 浏览器开发者工具
按 F12 打开浏览器控制台，查看详细报错信息、立绘指令解析日志及运行时警告，便于深度调试。
![img](https://github.com/1145141919810TONNY/webgalgameengine/blob/main/img/2.png)

## 2. 基本语法

在数组中，有以下元素：
```javascript
{ 
    text: "你的剧本", //必须要有此项，否则里面的代码将无法生效
    speaker: "角色A",   // [可选] 说话人姓名，若不显示名字请删除此项
    background: "背景_示例",  // [可选] 背景图 ID，引用自 bg_config.js；设为 null 则不改变当前背景
    bgm: "bgm_示例",         // [可选] BGM ID，引用自 bgm_config.js；设为 null 则不改变当前 BGM
    audio: "音效_示例",      // [可选] 音效或语音 ID，引用自 sceneData.audio；设为 null 则不播放
    chars: "[中 角色_示例]",  // [可选] 立绘指令，支持位置、缩放等控制（详见 illustration.md）
    command: "[pov 视角示例]",// [可选] 引擎指令，如 [pov]等
    action: null             // [可选] 动作对象，用于分支选项、场景跳转等
},
```
如果不需要某些选项，可以设置为null或直接将对应的元素删除

### 2.1 text 属性说明

`text` 字段可以为空字符串 `""`。在以下场景中，建议使用空文本：

1. **等待玩家点击**：当需要玩家进行一次空白点击以继续剧情时
```javascript
{
    text: "",
}
```

2. **纯指令执行**：执行某些特殊指令（如 BGM 淡入、标签命令等）而不显示文本时
```javascript
{
    text: "",
    bgm: "bgm wait bgm1"  // 仅执行 BGM 淡入，不显示文本
}
```

### 2.2 立绘指令格式

在 `chars` 元素中，你可以和 Kirikiri 的 KAGScript 一致，使用中文/英文来对你的立绘进行位置差分的设置。这里不赘述。这里建议使用以下格式书写：

**基础格式：**
```javascript
{
    chars: "[角色标识符 其他位置指令 立绘文件ID]"
}
```

**完整示例（包含所有可用修饰词）：**
```javascript
{
    // 最完整的立绘指令示例：
    // [角色标识符 水平位置 垂直位置 层级 缩放 动作/瞬移 立绘ID]
    chars: "[主角 右 上 前 15% nod lh01]"
    
    // 说明：
    // - 主角：角色标识符（必须紧贴左方括号）
    // - 右：水平位置（75%）
    // - 上：垂直位置（向上偏移25%）
    // - 前：层级（zIndex: 11，置顶显示）
    // - 15%：缩放比例（放大15%，即原尺寸的115%）
    // - nod：动作指令（执行一次点头动画）
    // - lh01：立绘资源ID
}
```

**简化示例（仅必需项）：**
```javascript
{
    chars: "[lh01]"  // 仅指定立绘ID，自动居中、底部对齐、无缩放
}
```
**格式说明：**
- **修饰词顺序灵活**：除角色标识符外，其他修饰词（如位置、缩放、层级等）可以任意顺序排列，引擎均能正确识别。
- **推荐规范格式**：为提升代码可读性和维护性，建议按照 `[角色标识符 位置指令 缩放指令 层级指令 立绘ID]` 的顺序书写。
- **标识符严格约束**：角色标识符必须紧贴在左方括号 `[` 右侧，中间不能有空格，否则引擎将无法识别！

### 2.3 页面跳转

如果需要将网页跳转到下一个文件时，你可以：

**直接跳转到下一个页面：**
```javascript
{ 
    text: "", 
    action: {
        type: "nextScene",
        target: "scene2.html"//在这输入你需要跳转的网页名称
    }
}
```

**通过选项跳转到对应页面：**
```javascript
{ 
    text: "", 
    action: {
        type: "choice",
        choices: [
            { text: "前往场景1", target: "scene1.html" },
            { text: "返回主菜单", target: "../index.html" }//这个是返回主菜单
        ]
    }
}
```

**保持选项页面整洁：**
```javascript
{ 
    text: "", 
    command: "[msgoff]",
    action: {
        type: "choice",
        choices: [
            { text: "前往场景1", target: "scene1.html" },
            { text: "返回主菜单", target: "../index.html" }//这个是返回主菜单
        ]
    }
}
```

## 3. 可用指令集合

### 3.1 标签命令
- [novel]、[normal]：开启，结束全屏小说模式
- [msgoff] - 隐藏文本框（在单独的命令行中使用，text 留空，并且再设置一个空的text）
- [msgon] - 显示文本框
- [clearname] - 清除姓名框
- [lock]、[阻止] - 锁定鼠标点击，屏蔽所有非快进模式的点击事件（按住 Ctrl 键仍可快进）
- [free]、[解锁] - 解除鼠标点击锁定，恢复正常点击交互

### 3.2 BGM控制
```javascript
bgm:"bgm wait bgm1",//淡入bgm1
bgm:"bgm stop",//停止播放bgm
```

### 3.3 资源配置

配置时，BGM和背景、CG无需再每个文件中重复引用，但是音效和视频需要。
```javascript
const sceneData = {
    // 背景配置（推荐使用集中配置文件）
    background: BG_CONFIG_SUB,  // 引用 bg_config.js 中的配置
    
    // BGM 配置（推荐使用集中配置文件）
    bgm: BGM_CONFIG_SUB,        // 引用 bgm_config.js 中的配置
    
    // 音效和语音配置（可在场景中直接定义）
    audio: {
        'se_door': '../assets/audio/door_open.ogg',   // 音效示例
        'voice_greeting': '../assets/audio/voice1.ogg' // 语音示例
    },
    
    // 视频配置（需在场景中定义视频文件路径）
    videos: {
        'op': '../assets/video/OP.mp4',      // OP 视频
        'ed': '../assets/video/ED.mp4'   // ED 视频
    },
};
```

### 3.4 文本格式标签

**换行转义字符 \n**

这个\n 标签将直接嵌入`text`中，示例如下：
```javascript
{ 
   text: "然而，时光荏苒，岁月如梭。我们终究还是长大了，\n各自奔向不同的道路。",
},
```
那么打印出来的效果就是：

然而，时光荏苒，岁月如梭。我们终究还是长大了，<br>
各自奔向不同的道路。

**分段显示标签 [s]**

在这里的[s]标签与kirikiri有一些不同，它将直接嵌入`text`中，示例如下：
```javascript
{ 
   text: "然而，时光荏苒，[s]岁月如梭。我们终究还是长大了，[s]各自奔向不同的道路。",
},
```

在这里的效果是：运行到这一句话时，首先只会展示文字：
然而，时光荏苒，

然后鼠标点击一下后展示文字：
然而，时光荏苒，岁月如梭。我们终究还是长大了，

最后再点击一下：
然而，时光荏苒，岁月如梭。我们终究还是长大了，各自奔向不同的道路。<br>
此时如果再次点击鼠标则会进行下一段剧情

**注意：`\n` 与 `[s]` 可以组合使用**
```javascript
{
    text: "第一段第一行。\n第一段第二行。[s]第二段第一行。\n第二段第二行。",
    speaker: "系统"
}
```
换行符在分段显示中会正常生效。

## 4. BGM控制功能

BGM停止功能，可以在剧情中动态控制背景音乐：

```javascript
// 停止当前BGM播放
{
    text: "现在停止背景音乐",
    speaker: "旁白",
    bgm: "bgm stop",  // 特殊标识符，用于停止BGM
    action: null
}

// 播放指定BGM
{
    text: "播放浪漫音乐",
    speaker: "旁白",
    bgm: "romantic_bgm",  // 播放已配置的BGM
    action: null
}
```

**功能特点：**
- 使用 `"bgm stop"` 字符串作为特殊标识符
- 只影响BGM（背景音乐），不影响语音和音效
- 停止后播放位置重置为0，下次播放从头开始
- 向后兼容，不影响现有代码

**实现原理：**
在引擎的 `displayLine()` 函数中检测 `bgm` 属性是否为 `"bgm stop"`，如果是则调用 `stopBGM()` 方法暂停播放器并重置播放位置。

## 5. 场景制作指南

### 5.1 创建新场景

复制 scene\scene0.html 的模板作为起点：

**请注意：在默认状态下，你需要将游戏第一个html文件命名为scene1.html作为开始游戏的起始文件**

现在你只需要在bgm_config.js中按照模板定义好对应的bgm代号即可。该js类似于kirikiri的soundlist.csv的作用。

### 5.2 BGM配置使用方法

#### 在 HTML 文件中引入

在需要播放 BGM 的 HTML 文件的 `<head>` 部分添加：

```html
<script src="bgm_config.js"></script>
```

#### 在 html/*.html 中使用（如 CG.html）

```javascript
const indexData = {
    bgm: BGM_CONFIG_SUB,  // 使用子目录配置
    story: [...]
};
```

#### 在 index.html 中使用

```javascript
const indexData = {
    bgm: BGM_CONFIG,  // 直接引用配置对象
    story: [...]
};
```

#### 在 bgm.html 中使用

```javascript
// 使用 BGM_MAP 兼容旧代码
const bgmMap = BGM_MAP;

function playBGM(bgmName) {
    if (bgmMap[bgmName]) {
        // 播放逻辑
    }
}
```

### 5.3 添加新的 BGM

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

## 6. 存档系统

### 6.1 存档系统1（硬编码方式）

目前的存档系统使用的是硬编码的方式，你需要在`saves.html`中写入所有你需要导入的剧本文件。
比如：

```javascript
if (this.isValidSceneFile(sceneFileName)) {
    // 自定义场景名称映射 - 为每个HTML文件提供自定义名称
    const sceneNames = {
        'scene1': '1初次相遇',
        'scene2': '场景2',
        'scene3': '场景3 ',
        // 可以按需继续添加更多场景
    };
    
    const displayName = sceneNames[sceneId] || sceneId.replace(/_/g, ' ').replace('scene', '场景 ');
    
    const cardDiv = document.createElement('div');
    cardDiv.className = 'scene-card';
    cardDiv.innerHTML = `
        <div class="scene-name">${displayName}</div>
        <button onclick="SaveManager.jumpToScene('${sceneFileName}')">
            跳转
        </button>
    `;
    jumpGrid.appendChild(cardDiv);
}
```

同时需要修改`progress_api.js`里对应的内容，详情请参照文件内注释

### 6.2 存档系统2（动态列表）

动态存档列表系统，支持无限数量的存档，无需硬编码场景文件。

如需自定义场景显示名称，在 `archive.html` 的 `sceneNames` 对象中添加映射：

```javascript
sceneNames: {
    'scene1': '1初次相遇',
    // 按需继续添加更多场景
}
```

未配置的场景将默认显示文件名。

## 7. 重要提醒

**重要提醒：**

1. **标签命令必须通过 `command` 属性执行**，不能直接嵌入在 `text` 属性中。

正确的使用方式：
```javascript
{
    text: "即将执行淡出效果",
    speaker: "旁白",
    command: "[fadeout time=1000 color=black]"  // 通过command属性执行
}
```

错误的使用方式（当前不支持）：
```javascript
{
    text: "[fadeout time=1000]这种嵌入方式不会工作",  // 标签不会被解析
    speaker: "旁白"
}
```

2. **纯命令行建议使用空文本**

对于只执行命令而不显示文本的情况，建议将 `text` 留空或设为 `null`，以避免界面闪烁：

```javascript
// 推荐方式：纯命令行
{
    text: "",
    command: "[msgoff]"  // 隐藏文本框
}

// 或者
{
    text: null,
    command: "[clearname]"  // 清除姓名框
}
```

3. **command 多指令并行支持**

可以在单个 `command` 属性中使用英文逗号 `,` 分隔多个指令，引擎会按顺序依次执行：

```javascript
// 多条指令合并为一个剧情对象
{
    text: "",
    command: "[normal],[pov 主角],[lock]"  // 切换模式、显示POV、锁定点击
}
```

这种方式可以大幅减少代码行数，提高编写效率。多个指令会在同一帧内按顺序执行，适合不需要间隔的连续操作。

4. **command 与 action 共存支持**

可以在同一个剧情对象中同时使用 `command` 和 `action` 属性，引擎会先执行 `command` 指定的指令，再执行 `action` 指定的动作：

```javascript
{
    text: "",
    command: "[msgoff]",  // 先隐藏文本框
    action: {  // 然后显示选项菜单
        type: "choice",
        choices: [
            { text: "选项1", target: "scene2.html" },
            { text: "选项2", target: "scene3.html" }
        ]
    }
}
```

这种写法简化了代码结构，提高了可读性，常用于在显示选项前执行一些预处理指令（如隐藏文本框、切换模式、锁定点击等）。

## 附录A：常见问题解答

Q: 如何添加新的角色立绘？
A: 在 assets/chars/ 目录下放置立绘文件，在CSS中添加相应的类名。

Q: 存档功能为什么在本地文件模式下不能使用？
A: 浏览器安全策略限制，需要通过HTTP服务器运行。

Q: 如何优化大场景的加载速度？
A: 使用分页加载、资源预加载和懒加载技术。

Q: 支持哪些音频格式？
A: 推荐使用 MP3 和 OGG 格式以获得最佳兼容性。

Q: 如何在剧情中停止背景音乐？
A: 使用 `bgm: "bgm stop"` 属性。这是一个特殊标识符，会调用引擎的stopBGM()方法停止当前BGM播放。

Q: BGM停止功能会影响语音和音效吗？
A: 不会。该功能只针对背景音乐(BGM)，语音和音效会继续正常播放。

Q: 为什么我写的[tag]标签在文本中不生效？
A: 标签命令必须通过 `command` 属性执行，不能直接写在 `text` 属性中。请使用 `{text: "内容", command: "[tag]"}` 的格式。

Q: `[wait]` 命令如何使用？
A: `[wait]` 命令有两种用法：
   - 不带参数：`command: "[wait]"` - 等待用户点击后继续
   - 带时间参数：`command: "[wait time=2000]"` - 等待2秒后自动继续

Q: `[fadeout]` 和 `[fadein]` 命令需要额外点击吗？
A: 不需要。这些动画命令在执行完成后会自动进入下一行。

Q: `[finish]` 命令后为什么需要额外点击？
A: 已修复。现在 `[finish]` 命令在淡出完成后会自动进入下一行，无需额外点击。

Q: `[msgoff]` 命令会导致文本框一闪而过吗？
A: 已修复。现在建议在纯命令行中将 `text` 留空，这样可以避免界面闪烁。

Q: `\n` 和 `[s]` 可以一起使用吗？
A: 可以。换行符在分段显示中会正常生效，例如：`text: "第一行。\n第二行。[s]第三行。"`

Q: 视频播放时 BGM 会如何处理？
A: 视频播放前会自动停止当前 BGM（暂停并重置到开头）。视频结束后不会自动恢复 BGM，如需继续播放 BGM，请在后续剧情行中指定 `bgm` 属性。

Q: 如何控制视频播放？
A: 视频支持以下控制方式：
   - 右键点击视频区域：跳过视频
   - 按 ESC 键：跳过视频
   - 视频自然播放结束后：自动继续下一行剧情

Q: 立绘动作指令有哪些？
A: 立绘支持多种动作指令，包括：
   - `[点头]` / `[nod]`：执行一次点头动画
   - `[后退]` / `[retreat]`：向上移动并缩小
   - `[前进]` / `[forward]`：向下移动并放大
   - `[吓一跳]` / `[scare]`：快速放大缩小
   - `[发抖]` / `[shake]`：左右抖动
   - `[持续发抖]` / `[cshake]`：持续抖动（需手动停止）
   - `[结束发抖]` / `[sshake]`：停止持续发抖
   详见 [illustration.md](assets/chars/illustration.md) 文档。

Q: 背景转场有哪些效果？
A: 背景支持多种转场效果：
   - `fade` / `转场`：淡入淡出
   - `slideL` / `左滑`：从左滑入
   - `slideR` / `右滑`：从右滑入
   - `scanL` / `左转场`：扫描式左转场
   - `scanR` / `右转场`：扫描式右转场
   示例：`background: "slideL bg_002_00_00"`
   详见 [background.md](assets/bg/background.md) 文档。

## 附录B：快捷键参考

- ESC: 打开上下文菜单
- F1: 开关开发者调试面板
- F5: 快速保存（需 HTTP 环境）
- Ctrl: 按住快进剧情
- + / ↑: 增加音量（步进 1%）
- - / ↓: 减少音量（步进 1%）
- 鼠标点击: 继续剧情/选择选项
- 视频播放时右键或 ESC: 跳过视频

## 版权信息

作者：月が綺麗ですね_
Bilibili: https://space.bilibili.com/87412647
