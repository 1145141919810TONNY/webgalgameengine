# Shiori

这是一个基于HTML/JS的视觉小说引擎，具有类似Kirikiri的功能。

在scenes文件夹中，scenes0.html是一个空白模板。

如果要使用本模板，请根据license.txt中的指引进行修改本项目

本引擎的教学网页：[https://1145141919810tonny.github.io/Shioriteaching/](https://1145141919810tonny.github.io/Shioriteaching/)

# Shiori 命名缘起

“Shiori”（栞），在日语中意为“书签”。

在浩瀚的文字海洋中，书签是静默的守护者。它标记着我们曾驻足的风景，珍藏着那些触动心灵的瞬间，并为下一次的相遇留下清晰的指引。

我将这款视觉小说引擎命名为“Shiori”，正是希望它能成为创作者与玩家手中那枚精致的书签：

- **标记进度**：如同书签夹入书页，Shiori 帮助开发者精准记录故事的每一个分支与节点，让复杂的叙事逻辑井井有条。
- **珍藏瞬间**：它承载着精美的立绘、动人的音乐与深刻的对白，将那些稍纵即逝的美好定格为永恒的记忆。
- **指引创作**：在创作的旅途中，Shiori 提供稳定而灵活的框架，如同书签引导读者重返心爱章节，助力创作者从容地构建属于自己的世界。

愿 Shiori 伴随每一位创作者，在视觉小说的篇章中，留下独一无二的标记。

## 快捷键
- esc：打开游戏上下文菜单
- ctrl：快进剧情

# V1.1.3更新内容（2026/4/12 16:00）

## 连续动作指令

### 1. 连续动作序列支持
- 新增使用逗号 `,` 分隔的多状态帧指令，实现立绘的顺序动画与中断跳转。
- 示例：`[左,中,右 lh1]`（依次经过左侧、中间、右侧）。

### 2. 统一化状态帧与属性继承
- 每个片段均为完整的立绘指令，支持属性继承（未指定的属性保持上一帧状态）。
- 示例：`[左 前,右 lh1]`（Step 1 只指定了“右”，因此继承了 Step 0 的“前”层级）。

### 3. 片段内瞬移
- 支持在片段内使用 `瞬`/`instant` 实现无过渡动画的状态切换，并保证标准停留时长。
- 示例：`[左,右 上 后 瞬,中 lh1]`（依次经过左侧、瞬间移动到右侧上方底层、平滑回到中间）。

# V1.1.2更新内容（2026/4/12 13:14）

## 立绘动作指令系统

### 1. 完整动作指令支持
- 新增6种立绘动作指令，支持中英文别名
- **后退/retreat**：Y轴向上+10%，缩放-10%，层级强制变为"后"（zIndex=9）
- **前进/forward**：Y轴向下-10%，缩放+10%（上限2.0），层级强制变为"前"（zIndex=11）
- **吓一跳/scare**：先放大7%再缩小7%，重复2次，总时长约1秒
- **发抖/shake**：X轴左右偏移±2%，重复3次，总时长约480ms
- **持续发抖/cshake**：持续左右抖动，需手动停止
- **结束发抖/sshake**：停止持续发抖，恢复原位
- 示例：`[中 retreat lh01]`, `[中 forward lh01]`, `[中 scare lh01]`
- 详见 [illustration.md](assets/chars/illustration.md) 第11章

### 2. 动作指令优先级规则
- **屏蔽瞬移**：使用动作指令时，`瞬`/`instant` 会被自动忽略，确保动画正常播放
- **多动作取第一个**：同时指定多个动作时，只执行第一个，忽略后续动作
- **与其他修饰词组合**：动作可与位置、缩放、层级等修饰词自由组合
- 示例：
  ```javascript
  chars: "[瞬 retreat lh01]"        // '瞬'被忽略，后退动画正常播放
  chars: "[后退 吓一跳 lh01]"    // 只执行'后退'，忽略'吓一跳'
  chars: "[左 retreat lh01]"        // 左侧位置 + 后退效果
  chars: "[x:10% y:5% shake lh01]" // 精确坐标 + 发抖效果
  ```

### 3. 批量清除所有立绘
- 新增 `[消失 all]` 和 `[消失 全部]` 指令，一键清除屏幕上所有立绘
- 支持英文指令：`[hide all]` 和 `[remove all]`
- 自动清理所有动画状态（如持续发抖的定时器）
- 空状态时调用不会报错，完全兼容原有的单立绘清除功能
- 示例：
  ```javascript
  chars: "[消失 全部]"      // 中文指令
  chars: "[hide all]"       // 英文指令 (hide)
  chars: "[remove all]"     // 英文指令 (remove)
  
  // 实际应用场景
  chars: "[消失 all]"       // 场景切换前清除所有立绘
  ```
- 详见 [illustration.md](assets/chars/illustration.md) 第10.2节

- 同步更新 `scenes/1.html` 测试场景文件，新增动作指令和批量清除功能的完整测试用例

# V1.1.1更新内容（2026/4/11 20:00）

## 立绘指令系统全面增强

### 1. 中英文混合指令支持
- 所有立绘修饰词支持中英文别名，可在同一指令中自由混合使用
- 示例：`[中 front lh01]`, `[left down 前 lh02]`
- 详见 [illustration.md](assets/chars/illustration.md) 第2章

### 2. 精确坐标控制系统
- 新增基于百分比的精确坐标控制：`x:`（水平）和 `y:`（垂直）
- X轴以屏幕中心为0%，Y轴以屏幕底部为0%
- 精确坐标优先于文字指令：`[x:10% 左 lh01]` 使用 x:10%，忽略“左”
- 示例：`[x:10% y:-5% lh01]`, `[瞬 x:-20% y:15% lh02]`
- 详见 [illustration.md](assets/chars/illustration.md) 第3章

### 3. 简化立绘指令
- 支持仅包含角色ID的简化写法，自动应用默认值（居中、底部对齐）
- 示例：`[lh01]` 等同于 `[中 lh01]`
- 详见 [illustration.md](assets/chars/illustration.md) 第1章基本语法

### 4. 向上偏移关键词
- 新增垂直位置的向上偏移指令，与向下偏移对应
- 向上：`上/up` (25%), `中上/upm` (50%), `上上/upu/top` (65%)
- 向下：`下/down` (-25%), `中下/downm` (-50%), `下下/downd/bottom` (-65%)
- 示例：`[中 上 lh01]`, `[middle upm front lh02]`
- 详见 [illustration.md](assets/chars/illustration.md) 第5章

# V1.1.0更新内容（2026/4/11 13:35）
- **立绘指令系统增强**：新增了详细的人物立绘差分控制指令，完整使用说明请参考 [illustration.md](assets/chars/illustration.md)
- **教学网页上线**：提供了系统化的在线教程与代码示例，请访问 https://1145141919810tonny.github.io/Shioriteaching/ 查看

# V1.0.13更新内容（2026/4/10 20:10）
- 将原本混淆的CG与背景图片（BG）进行明确区分
- 无需再手动在assets文件夹中逐个创建文件
- 新增 `bg_config.js` 文件统一管理背景图片资源，这些背景图片不会出现在CG鉴赏页面中
  - 注意：由于同一页面只能显示一张背景图，因此背景图片（BG）与CG图片共享同一个background属性

# V1.0.12更新内容（2026/4/10 16:34）
- 优化了引擎核心代码`engine.js`的注释内容，提升代码可读性和维护性
- 改进了全屏小说模式下的文本选择功能，禁用鼠标选中文本以提升交互体验
- 调整了全屏小说模式下文本的对齐方式，从居中改为左对齐，避免打字效果时文本滚动，提升阅读体验
- 修复了全屏小说模式下快速点击导致文本显示异常的问题

# V1.0.11更新内容（2026/4/9）
- 修复了 `[novel]` 和 `[normal]` 标签的显示问题（全屏小说模式）。使用时请合理搭配 `\n` 和 `[s]` 标签，使文本分段展示效果更佳。

**使用示例：**
```JavaScript
                { 
                    text: "", 
                    command: "[novel]"//开始全屏小说模式
                },
                {
                    text:"这是一大段文本\n[s]这是一大段文本\n[s]这是一大段文本",
                }
                { 
                    text: "", 
                    command: "[normal]"//结束全屏小说模式
                },
```
- 新增“小剧场”页面，该页面属性与`saves.html`大致相同，但该页面内所有的剧本内容将不调用API，会直接显示所有的剧本文件。可用于番外小剧场使用。

# V1.0.10更新内容（2026/4/8 22:18）
- 修复了在Firefox浏览器中，BGM鉴赏页面进度条已播放部分css特效丢失问题
- **发现了在edge浏览器中，BGM鉴赏页面的进度条在拖拽后部分环境下可能无法正确播放至指定位置，松开鼠标后会跳转至00:00播放的问题，目前已尝试修复但尚未解决。请使用时尽量使用Firefox浏览器。**

# V1.0.9更新内容（2026/4/8 15:30）
- 修复了使用`pov`指令时，bgm无法播放的问题
- **重要提示**：所有 `command` 指令应当单独占用一个故事行对象，且该对象的 `text` 字段应为空字符串 (`""`) 或 `null`。详细规范请参考 [COMMAND_USAGE_GUIDELINES.md](COMMAND_USAGE_GUIDELINES.md)

# V1.0.8更新内容（2026/4/8 14:48）
- 新增 `pov` 标签，支持叙事视角显示功能
  - 语法格式：`command: "[pov 角色名]"` 或 `command: "[pov stop]"`
  - 功能说明：在屏幕右上角显示当前叙事视角，帮助玩家理解故事视角
  - 视觉样式：金色文字 (#FFD700)，24px加粗，位置固定在右边缘10px、上边缘100px
  - 行为特性：显示后持续存在，直到遇到 `[pov stop]` 指令或场景切换时自动清除
  - 示例代码：
    ```javascript
    {
        text: "切换到主角视角",
        speaker: "系统",
        command: "[pov 主角]"  // 显示"当前叙事视角 主角"
    },
    {
        text: "停止显示视角",
        speaker: "系统",
        command: "[pov stop]"  // 隐藏视角指示器
    }
    ```
  - 默认字体与样式修改：
    - POV 指示器默认继承全局字体设置（`body` 中定义的 `'Microsoft YaHei'`）
    - 如需全局修改字体，编辑 `style.css` 中的 `body` 或 `*` 选择器的 `font-family` 属性
    - 如仅需修改 POV 指示器样式，直接编辑 `style.css` 中的 `.pov-indicator` 类（可调整 `font-family`、`font-size`、`color` 等属性）
    - `engine.js` 负责逻辑控制（显示/隐藏），不直接定义样式；如需动态修改样式，可通过扩展引擎代码实现
    - 默认显示格式为"当前叙事视角 [角色名]"，如需修改前缀文字或显示格式，需编辑 `engine.js` 中 `showPovIndicator` 函数的模板字符串

# V1.0.7更新内容（2026/4/8 9:40）
- 新增 `bgm wait` 标签，支持 BGM 淡出切换功能
  - 语法格式：`bgm: "bgm wait <新BGM标识符>"`
  - 功能说明：等待当前 BGM 淡出完成后播放新的 BGM，实现平滑过渡效果
  - 示例代码：
    ```javascript
    {
        text: "场景转换中...",
        speaker: "旁白",
        bgm: "bgm wait bgm21",  // 淡出当前 BGM，播放 bgm21
        background: "bg5"
    }
    ```
- 新增 `[a]` 音频同步标签，支持多段音频与文本片段同步播放
  - 语法格式：`audio: "音频1[a]音频2[a]音频3"`
  - 功能说明：按顺序播放多个音频片段，每个音频对应一个文本片段（使用 `[s]` 分隔）
  - 示例代码：
    ```javascript
    {
        text: "第一段文字[s]第二段文字[s]第三段文字",
        speaker: "角色名",
        audio: "voice1[a]voice2[a]voice3"  // 依次播放三个音频文件
    }
    ```
  - 效果说明：显示"第一段文字"时播放 voice1，点击后显示"第二段文字"并切换到 voice2，以此类推
  - 特殊情况：当 `[s]` 标签数量大于 `[a]` 标签数量时，后续文本片段将继续播放最后一个音频，不会切换

# V1.0.6更新内容（2026/4/7）
- 重构了CG配置文件，采用集中化管理方式。此后不再需要在其他文件中多次重复的进行硬编码存储。

# V1.0.5更新内容（2026/3/28）
- 重构了BGM配置文件，采用集中化管理方式。此后不再需要在其他文件中多次重复的进行硬编码存储。

# V1.0.4更新内容（2026/3/9）
- 变更了一些编译逻辑，以适配不同的环境。如果使用V1.0.2版启动器文件无法编译的情况下可以尝试使用V1.0.3版本启动器文件进行编译。
  - 项目主要版本号与启动器版本号相互独立，请根据readme、release的版本号进行区分

# V1.0.3更新内容（2026/3/6）
- 优化了编译逻辑，使编译后的可执行文件由之前的约60mb减少至约30mb（请使用V1.0.2文件夹内的内容）
- 现在你可以在icon文件夹里存放图片来修改你的浏览器图标了（默认命名为icon-32.png）

# V1.0.2更新内容（2026/3/4）
- 修复了剧本中，若点击过快会导致好几句对白乱序混在一起的问题
- 添加了长按ctrl可以快进剧本的快捷键功能

# V1.0.1更新内容(2026/3/3)
- 现在，你可以通过release中下载已经编译好的exe文件以脱离python环境运行。或可在编译前修改 `GalgameLauncher.csproj` 中的相关信息（如版权署名，默认版权署名为bilibili@月が綺麗ですね_）。以运行完整功能
  - 编译部署流程：下载 `galgame-engine-launcher` 文件夹的全部内容，直接双击运行 `build_and_deploy.bat` 进行自动编译。该编译过程无需额外环境配置，甚至无需打开Visual Studio（仅需系统中安装任意版本的Visual Studio即可）。
  - 部署方式：将生成的可执行文件（默认名称： GalgameLauncher.exe ，约60MB）放置于与 index.html 同级目录中，终端用户通过双击该启动器运行引擎。预编译版本作为Release附件分发。

程序底层框架：月が綺麗ですね_
https://space.bilibili.com/87412647?spm_id_from=333.1007.0.0


# 视觉小说引擎完整开发教程



# 1. 项目概述与架构


## 1.1 项目结构解析


galgame-engine/
├── shiori.exe            # Windows 可执行启动器（推荐）<br>
├── index.html            # 主菜单页面<br>
├── engine.js             # 核心 JavaScript 引擎<br>
├── style.css             # 样式文件<br>
├── bg_config.js          # 背景图片集中配置文件<br>
├── bgm_config.js         # BGM 集中配置文件<br>
├── cg_config.js          # CG 集中配置文件<br>
├── illustration.js       # 立绘集中配置文件<br>
├── launch_game.bat       # 批处理启动脚本<br>
├── icon/                 # 浏览器图标文件夹<br>
│   └── icon-32.png       # 浏览器页面图标<br>
├── assets/               # 资源文件目录<br>
│   ├── bg/               # 背景图片<br>
│   ├── chars/            # 角色立绘<br>
│   ├── audio/            # 音效/语音<br>
│   ├── bgm/              # 背景音乐<br>
│   ├── cg/               # CG图片<br>
│   └── video/            # 视频文件<br>
├── scenes/               # 场景剧本 <br>
│   └── scene0.html       # 空白模板<br>
├── html/                 # 功能页面<br>
│   ├── saves.html        # 存档管理<br>
│   ├── bgm.html          # BGM 鉴赏<br>
│   ├── video.html        # 视频鉴赏<br>
│   ├── CG.html           # CG 图鉴<br>
│   └── story.html        # 小故事页面<br>
├── api/                  # API 接口<br>
│   ├── progress.json     # 进度数据<br>
│   └── progress_api.js   # 进度API脚本<br>
└──  plugin/               # 插件扩展目录<br>

# 2. 核心概念详解


## 2.1 场景数据结构


每个场景文件包含一个sceneData对象，基本结构如下：

```javascript
const sceneData = {
    // 背景配置
    background: {
        'bg1': 'assets/bg/background1.jpg',
        'bg2': 'assets/bg/background2.png'
    },
    
    // 音频配置
    audio: {
        'se1': 'assets/audio/sound1.mp3',
        'voice1': 'assets/audio/voice1.ogg'
    },
    
    // BGM 配置（使用集中配置文件）
    bgm: BGM_CONFIG_SUB,  // 在子目录文件中引用
    
    // 视频配置
    videos: {
        'video1': 'assets/video/intro.mp4'
    },
    
    // 故事脚本
    story: [
        {
            text: "对话文本内容",
            speaker: "说话者姓名",
            background: "bg1",      // 背景标识
            audio: "se1",          // 音效标识
            bgm: "bgm1",           // BGM标识
            video: "video1",       // 视频标识
            action: {              // 动作对象
                type: "choice",
                choices: [
                    { text: "选项1", target: "scene2" },
                    { text: "选项2", target: "scene3" }
                ]
            },
            command: "[标签命令]"   // 标签命令
        }
    ]
};
```

2.2 Action动作系统
------------------

Action支持多种类型的动作：

```javascript
// 选择分支
action: {
    type: "choice",
    choices: [
        { text: "接受邀请", target: "scene_accept" },
        { text: "拒绝邀请", target: "scene_reject" }
    ]
}

// 场景跳转
action: {
    type: "nextScene",
    target: "scene2"
}

// 等待控制
action: {
    type: "wait",
    duration: 2000  // 等待2秒
}

// 界面控制
action: { type: "clearName" }    // 清除姓名框
action: { type: "hideText" }     // 隐藏文本框
action: { type: "showText" }     // 显示文本框

// 特殊效果
action: { type: "fadeOut" }      // 淡出效果
action: { type: "fadeIn" }       // 淡入效果
action: { type: "sepiaStart" }   // 怀旧滤镜

// 游戏控制
action: { type: "returnToMenu" } // 返回主菜单
action: { type: "finishGame" }   // 结束游戏
```

2.3 标签命令系统
----------------

**重要说明：标签命令需要通过 `command` 属性执行，不能直接嵌入在 `text` 中**

**正确的使用方式：**
```javascript
// 通过command属性执行标签命令
{
    text: "即将执行淡出效果",
    speaker: "旁白",
    command: "[fadeout time=1000 color=black]"  // ← 正确方式
}

// 等待命令
{
    text: "请等待2秒",
    speaker: "系统", 
    command: "[wait time=2000]"  // ← 正确方式
}
```

**错误的使用方式（当前不支持）：**
```javascript
// 这种方式当前不会工作！
{
    text: "[fadeout time=1000][wait time=2000]这些标签不会被执行",  // ← 错误方式
    speaker: "旁白"
}
```

可用标签命令（通过command属性执行）：
- [bg:identifier] - 切换背景
- [bgm:identifier] - 播放BGM
- [se:identifier] - 播放音效
- [voice:identifier] - 播放语音
- [novel] - 开启小说模式
- [normal] - 关闭小说模式
- [end] - 返回主菜单
- [choice:JSON] - 显示选项
- [jump:url] - 页面跳转
- [video:identifier] - 播放视频

高级标签命令：
- [fadeout time=1000 color=black] - 淡出效果
- [fadein time=1000 color=black] - 淡入效果
- [wait time=1000] - 等待指定时间
- [clearname] - 清除姓名框
- [msgoff] - 隐藏文本框
- [msgon] - 显示文本框
- [finish bgcolor=black time=1500] - 游戏结束淡出
- [finishwhite bgcolor=white time=1500] - 游戏结束淡出到白色

文本格式标签：
- \n - 换行转义字符

这个\n 标签将直接嵌入`text`中，示例如下：
```javascript
{ 
   text: "然而，时光荏苒，岁月如梭。我们终究还是长大了，\n各自奔向不同的道路。",
},
```
那么打印出来的效果就是：

然而，时光荏苒，岁月如梭。我们终究还是长大了，<br>
各自奔向不同的道路。

[s]标签<br>
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

## 2.4 BGM控制功能


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

功能特点：
- 使用 `"bgm stop"` 字符串作为特殊标识符
- 只影响BGM（背景音乐），不影响语音和音效
- 停止后播放位置重置为0，下次播放从头开始
- 向后兼容，不影响现有代码

实现原理：
在引擎的 `displayLine()` 函数中检测 `bgm` 属性是否为 `"bgm stop"`，如果是则调用 `stopBGM()` 方法暂停播放器并重置播放位置。


# 3. 场景制作指南


## 3.1 创建新场景


复制 scene\scene0.html 的模板作为起点：

**请注意：在默认状态下，你需要将游戏第一个html文件命名为scene1.html作为开始游戏的起始文件**

## 3.2 编写故事脚本


基础对话：
```javascript
{
    text: "你好，很高兴见到你！",
    speaker: "名字",
    background: "school_day",
    bgm: "bgm1"
}
```

带选择分支：
```javascript
{
    text: "你愿意和我一起去图书馆吗？",
    speaker: "名字",
    action: {
        type: "choice",
        choices: [
            { 
                text: "当然愿意！", 
                target: "library_scene" 
            },
            { 
                text: "抱歉，我还有其他安排", 
                target: "reject_scene" 
            }
        ]
    }
}
```

现在你只需要在bgm_config.js中按照模板定义好对应的bgm代号即可。该js类似于kirikiri的soundlist.csv的作用。

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
        'yl1': '../assets/bg/yl1.jpg'
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

多行对话：
```javascript
{
    text: "这是一段很长的对话。\n第二行内容。\n第三行内容。",
    speaker: "叙述者"
}
```

## 3.3 好感度系统


```javascript
// 在场景数据中初始化好感度
const sceneData = {
    // ... 其他配置
    affinity: {
        'yurin': 50,  // 好感度初始值
        'other': 30   // 其他角色好感度
    },
    story: [
        {
            text: "你做出了明智的选择！",
            action: {
                type: "affinityChange",
                character: "yurin",
                change: 10  // 好感度增加10点
            }
        }
    ]
};
```

## 3.4 存档系统
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
                        });
                    } else {
                        jumpGrid.innerHTML = '<p style="text-align: center; color: #666;">还没有可以跳转的场景</p>';
                    }
                } else {
                    jumpGrid.innerHTML = '<p style="text-align: center; color: #666;">还没有可以跳转的场景</p>';
                }
            },
```

同时需要修改`progress_api.js`里对应的内容，详情请参照文件内注释

# 4. 资源管理与配置


## 4.1 资源文件组织


推荐的资源文件命名规范：

背景图片 (assets/bg/)：
- school_day.jpg    # 日间学校
- school_night.png  # 夜间学校
- home_room.jpg     # 家中房间

音频文件 (assets/audio/)：
- se_door_open.mp3  # 开门声
- se_phone_ring.wav # 电话铃声
- voice_name_001.ogg # 语音1

BGM文件 (assets/bgm/)：
- bgm_main_theme.mp3  # 主题曲
- bgm_romantic.ogg    # 浪漫场景
- bgm_sad_theme.wav   # 悲伤主题

视频文件 (assets/video/)：
- intro_sequence.mp4  # 开场动画
- memory_flashback.webm # 回忆片段

## 4.2 资源加载优化


预加载重要资源：
```javascript
// 在场景初始化时预加载
const preloadAssets = () => {
    const images = ['bg1.jpg', 'bg2.jpg'];
    const audios = ['bgm1.mp3', 'se1.mp3'];
    
    images.forEach(src => {
        const img = new Image();
        img.src = `../assets/bg/${src}`;
    });
    
    audios.forEach(src => {
        const audio = new Audio();
        audio.src = `../assets/bgm/${src}`;
    });
};
```


# 5. 高级功能实现


## 5.1 条件分支系统


```javascript
{
    text: "根据你之前的选择...",
    action: {
        type: "conditional",
        condition: "affinity.name > 80",
        trueBranch: [
            {
                text: "你们关系很好！",
                target: "good_ending"
            }
        ],
        falseBranch: [
            {
                text: "还需要努力提升关系。",
                target: "continue_story"
            }
        ]
    }
}
```

## 5.2 复杂特效组合


```javascript
{
    text: "回忆涌现...",
    action: {
        type: "chain",  // 自定义链式动作
        actions: [
            { type: "flashbackStart" },
            { type: "sepiaStart" },
            { type: "fadeIn", duration: 2000 },
            { type: "wait", duration: 3000 }
        ]
    }
}
```

## 5.3 存档系统集成


```javascript
// 保存游戏进度
const saveProgress = (sceneId, lineIndex) => {
    const progress = {
        currentScene: sceneId,
        currentLine: lineIndex,
        timestamp: Date.now(),
        affinity: gameEngine.state.affinity
    };
    localStorage.setItem('gameProgress', JSON.stringify(progress));
};

// 加载游戏进度
const loadProgress = () => {
    const saved = localStorage.getItem('gameProgress');
    if (saved) {
        return JSON.parse(saved);
    }
    return null;
};
```



# 6. 发布与部署


## 6.1 本地测试


使用提供的启动脚本：
```
# Windows
双击 launch_game.bat

# file
双击 index.html
```

## 6.3 移动端适配


响应式设计：
```css
/* 移动端优化 */
@media (max-width: 768px) {
    #text-box-container {
        padding: 5px 10px 10px;
        font-size: 14px;
    }
    
    .choice-btn {
        font-size: 16px;
        padding: 12px;
    }
}
```

# 重要提醒


**关于标签命令的重要说明：**

当前版本的引擎中，所有的标签命令都必须通过 `command` 属性来执行，不能直接嵌入在 `text` 属性中。

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

这个限制是因为引擎的文本处理机制只会在 `line.command` 存在时调用命令解析器，而不会解析 `line.text` 中的标签内容。

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

Q: 能否让标签命令支持嵌入在文本中？
A: 技术上可以实现，但需要修改引擎的文本解析机制。目前的设计是将标签命令和文本内容分离处理。

## 附录B：快捷键参考


- ESC: 打开上下文菜单
- 鼠标点击: 继续/选择选项

## 附录C：资源推荐


免费素材网站：
- pixabay.com - 免费图片
- freesound.org - 免费音效
- opengameart.org - 游戏素材

开发工具：
- VS Code - 代码编辑器
- Chrome DevTools - 调试工具
- Audacity - 音频编辑

## 版权信息：

作者：月が綺麗ですね_
Bilibili: https://space.bilibili.com/87412647


























