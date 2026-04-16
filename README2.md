# Shiori 基本语法教学

**重要说明：**

由于引擎在早期开发阶段缺乏完整的资源测试环境，旧版 README 中可能包含部分已废弃或不支持的语法。本文档将全面罗列当前版本（V1.2.3）所有可用的语法与指令。**若与其他文档存在冲突，请以本文档为准。**

在更新日志中的内容本文件不再赘述。

## F1 - 开发者调试面板
按 F1 可快速查看当前游戏状态，包括场景文件名、剧情索引、BGM、背景图片和立绘列表等关键信息。
![img](https://github.com/1145141919810TONNY/webgalgameengine/blob/main/img/1.png)

## F12 - 浏览器开发者工具
按 F12 打开浏览器控制台，查看详细报错信息、立绘指令解析日志及运行时警告，便于深度调试。
![img](https://github.com/1145141919810TONNY/webgalgameengine/blob/main/img/2.png)

更新时间：2026/4/16 V1.2.3

- 立绘类命令请参考[illustration.md](assets/chars/illustration.md) 
- 背景类命令请参考[background.md](assets/bg/background.md)
- 本引擎的教学网页：[https://1145141919810tonny.github.io/Shioriteaching/](https://1145141919810tonny.github.io/Shioriteaching/)

## 基本语法
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

其中，`text`中，可以为空。当你想让玩家进行一次空白的鼠标点击时，可以：
```javascript
{
    text: "",
}
```
以及一些特殊情况下也需要如此调用，比如：
```javascript
{
    text: "",
    bgm:"bgm wait bgm1"
}
```
在 `chars` 元素中，你可以和 Kirikiri 的 KAGScript 一致，使用中文/英文来对你的立绘进行位置差分的设置。这里不赘述。这里建议使用以下格式书写：
```javascript
{
    chars:"[角色标识符 其他位置指令 立绘文件ID]"
}
```
**格式说明：**
- **修饰词顺序灵活**：除角色标识符外，其他修饰词（如位置、缩放、层级等）可以任意顺序排列，引擎均能正确识别。
- **推荐规范格式**：为提升代码可读性和维护性，建议按照 `[角色标识符 位置指令 缩放指令 层级指令 立绘ID]` 的顺序书写。
- **标识符严格约束**：角色标识符必须紧贴在左方括号 `[` 右侧，中间不能有空格，否则引擎将无法识别！

如果需要将网页跳转到下一个文件时，你可以：
- 直接跳转到下一个页面：
```javascript
{ 
                    text: "", 
                    action: {
                        type: "nextScene",
                        target: "scene2.html"//在这输入你需要跳转的网页名称
                    }
                }
```
- 如果需要通过选项跳转到对应页面：
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

