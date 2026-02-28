# 视觉小说引擎

这是一个基于HTML/JS的视觉小说引擎，具有类似Kirikiri的功能。

在scenes文件夹中，scenes0.html是一个空白模板。

如果要使用本模板，请根据license.txt中的指引进行修改本项目

## 快捷键
- esc：打开游戏上下文菜单


文件结构，请至少在assets文件夹中创建如下对应文件夹

galgame-engine/<br>
├── index.html          # 主菜单页面<br>
├── engine.js           # 核心JavaScript引擎<br>
├── style.css           # 样式文件<br>
├── assets/             # 资源文件<br>
│   ├── bg/             # 背景图片<br>
│   ├── audio/          # 音频文件<br>
│   ├── bgm/            # BGM文件<br>
│   ├── video/          # 视频文件<br>
│   └── chars/          # 角色立绘<br>
├── scenes/             # 场景文件<br>
│   └── scene0.html     # 场景模板<br>
└── html/               # 功能页面<br>
    ├── bgm.html        # BGM鉴赏页面<br>
    ├── CG.html        # CG鉴赏页面<br>
    ├── copy.html        # 版权声明页面<br>
    ├── saves.html        # 存档页面<br>
    └── video.html      # 视频鉴赏页面<br>


程序底层框架：月が綺麗ですね_
https://space.bilibili.com/87412647?spm_id_from=333.1007.0.0


# 视觉小说引擎完整开发教程



# 1. 项目概述与架构


## 1.1 项目结构解析


galgame-engine/<br>
├── index.html          # 主菜单页面<br>
├── engine.js           # 核心JavaScript引擎<br>
├── style.css           # 样式文件<br>
├── assets/             # 资源文件<br>
│   ├── bg/             # 背景图片<br>
│   ├── audio/          # 音频文件<br>
│   ├── bgm/            # BGM文件<br>
│   ├── video/          # 视频文件<br>
│   └── chars/          # 角色立绘<br>
├── scenes/             # 场景文件<br>
│   └── scene0.html     # 场景模板<br>
└── html/               # 功能页面<br>
    ├── bgm.html        # BGM鉴赏页面<br>
    ├── CG.html        # CG鉴赏页面<br>
    ├── copy.html        # 版权声明页面<br>
    ├── saves.html        # 存档页面<br>
    └── video.html      # 视频鉴赏页面<br>

1.2 核心架构模式
----------------

引擎采用模块化设计，支持两种运行模式：

A. 单文件模式（传统）
   - 所有功能集成在 engine.js 中
   - 适合简单项目快速开发
   - 文件结构简洁

B. 模块化模式（推荐）
   - 功能拆分为独立模块
   - 更好的代码组织和维护性
   - 支持ES6模块导入导出


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
    
    // BGM配置
    bgm: {
        'bgm1': 'assets/bgm/music1.mp3'
    },
    
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

// 小说模式控制
action: { type: "novelOn" }   // 开启小说模式
action: { type: "novelOff" }  // 关闭小说模式

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

[s]标签
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


复制 scene0.html 模板作为起点：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>场景模板</title>
    <link rel="stylesheet" href="../style.css">
    <script src="../modules/progress_api.js"></script>
</head>
<body>
    <!-- 背景容器 -->
    <div id="background-container"></div>
    
    <!-- 角色立绘容器 -->
    <div id="character-container"></div>
    
    <!-- 文本框区域 -->
    <div id="text-box-container">
        <div id="name-box">[姓名]</div>
        <div id="text-box">[文本]</div>
    </div>
    
    <!-- 选项容器 -->
    <div id="options-container"></div>
    
    <!-- 全屏文本模式 -->
    <div id="novel-mode-container">
        <div id="novel-text-box">[全屏文本]</div>
    </div>
    
    <!-- 音频播放器 -->
    <audio id="bgm-player" loop></audio>
    <audio id="se-player"></audio>
    <audio id="voice-player"></audio>
    
    <!-- 视频播放器 -->
    <div id="video-player" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; z-index:100; background-color:black;">
        <video id="main-video" style="width:100%; height:100%; object-fit:contain;" controls>
            您的浏览器不支持视频播放。
        </video>
    </div>
    
    <!-- 上下文菜单遮罩层 -->
    <div id="context-menu-backdrop" class="context-menu-backdrop"></div>
    
    <!-- 上下文菜单 -->
    <div id="context-menu" class="context-menu">
        <ul>
            <li onclick="window.location.href='../saves.html'">进度管理</li>
            <li onclick="window.location.href='../index.html'">返回标题页面</li>
        </ul>
    </div>
    
    <!-- 引擎脚本 -->
    <script src="../engine.js"></script>
    <script>
        // 场景模板数据
        const sceneData = {
            background: {
                // 背景图片定义示例
                // 'bg1': '../assets/bg/background1.jpg',
                // 'bg2': '../assets/bg/background2.png'
            },
            bgm: {
                // BGM定义示例
                // 'theme1': '../assets/bgm/theme1.ogg',
                // 'theme2': '../assets/bgm/theme2.mp3'
            },
            audio: {
                // 音效和语音定义示例
                // 'sfx1': '../assets/audio/sound_effect1.wav',
                // 'voice1': '../assets/audio/voice1.mp3'
            },
            story: [
                { 
                    text: "欢迎使用场景模板", 
                    speaker: "系统",   //如果不要显示名字的话，删除此项
                    background: null,  // 设置背景，若为null则不改变当前背景
                    bgm: null,        // 设置BGM，若为null则不改变当前BGM
                    audio: null,      // 设置音效或语音，若为null则不播放
                    command: null, //这里加入类kirikiri的ks指令
                    action: null      // 执行动作，如选项、转场等
                },
                { 
                    text: "这是一个基本的场景模板，您可以复制此文件开始编写新的剧情", 
                    speaker: "系统", 
                    background: null,
                    bgm: null,
                    audio: null,
                    action: null
                },
                /*这是直接跳转下一个页面
                { 
                    text: "她生气地离开了...（这是一个坏结局）", 
                    speaker: "旁白", 
                    background: "badend1",
                    audio: null,
                    action: {
                        type: "nextScene",
                        target: "../index.html"
                    }
                }
                    */
                   /*这是选项跳转
                { 
                    text: "请在下面添加您的剧情内容", 
                    speaker: "系统", 
                    background: null,
                    bgm: null,
                    audio: null,
                    action: {
                        type: "choice",
                        choices: [
                            { text: "前往场景1", target: "scene1.html" },
                            { text: "返回主菜单", target: "../index.html" }
                        ]
                    }
                }
                    */
            ]
        };
        
        // 初始化游戏
        document.addEventListener('DOMContentLoaded', () => {
            gameEngine.init(sceneData);
        });
        
    </script>
</body>
</html>
```

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
                                    'scene4': '场景4',
                                    'scene5': '场景5',
                                    'scene6': '场景6',
                                    'scene7': '场景7',
                                    'scene8': '场景8',
                                    'scene9': '场景9',
                                    'scene10': '场景10',
                                    'ending1': '结局1',
                                    'ending2': '结局2',
                                    'ending3': '结局3',
                                    'sub_scene1': '分支场景1',
                                    'sub_scene2': '分支场景2',
                                    'sub_scene3': '分支场景3'
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

禁止商用，仅供学习交流使用。













