# Command 字段使用规范指南

## 概述

本文档详细说明 Shiori 视觉小说引擎中 `command` 字段的正确使用规范，帮助开发者避免常见的文本显示问题。

---

## 1. 现象描述

### 问题表现

当 `command` 标签（如 `[pov]`、`[wait]`、`[fadeout]` 等）与 `text` 字段同时出现在同一个故事行对象中时，**引擎会优先执行命令并立即跳转到下一行**，导致 `text` 内容被瞬间跳过或完全无法显示。

### 实际案例

参考场景文件中的正确用法：

```javascript
{
    text: "",
    command: "[pov stop]"
},
{
    text: "",
    command: "[pov 角色名]"
}
```

注意：这两个命令行的 `text` 字段均为空字符串 `""`。

---

## 2. 技术原理

### 引擎执行流程

在 `engine.js` 的 `displayLine` 函数中，命令的执行逻辑如下：

```javascript
// 解析并执行标签命令
if (line.command) {
    this.executeCommand(line.command);
    return;  // [关键] 执行命令后立即返回，不再处理后续逻辑
}
```

### 问题分析

1. **优先执行命令**：当检测到 `command` 属性时，引擎调用 `executeCommand()` 函数
2. **提前返回**：执行完命令后直接 `return`，跳过了后续的文本渲染、音频播放等逻辑
3. **文本丢失**：由于提前返回，该行的 `text` 内容永远不会被显示

### executeCommand 的行为

在 `executeCommand` 函数中（第 313-339 行）：

```javascript
executeCommand: function(command) {
    const parsedCommand = this.parseCommand(command);
    
    if (parsedCommand.type) {
        this.handleAction(parsedCommand);
    }
    
    // 检查是否是需要等待用户点击的命令类型
    const waitForClickCommands = ['waitForClick'];
    
    if (waitForClickCommands.includes(parsedCommand.type)) {
        // 显示"点击继续"提示
        this.elements.textBox.textContent = '点击继续';
        this.elements.nameBox.textContent = '系统';
        this.elements.nameBox.style.display = 'block';
    } else {
        // 如果没有后续文本，直接进入下一行
        if (!parsedCommand.text) {
            setTimeout(() => {
                this.nextLine();  // [自动跳转] 到下一行
            }, 100);
        }
    }
}
```

对于非 `waitForClick` 类型的命令（如 `[pov]`、`[fadeout]` 等），引擎会在 100ms 后自动调用 `nextLine()`，进一步确认了**命令行不应包含需要显示的文本**。

---

## 3. 最佳实践

### 核心原则

> **所有 `command` 指令应当单独占用一个故事行对象，且该对象的 `text` 字段应为空字符串 (`""`) 或 `null`。**

### 规则总结

| 场景 | text 字段 | command 字段 | 说明 |
|------|----------|-------------|------|
| 纯文本行 | [正确] 有内容 | [错误] 无 | 正常对话或叙述 |
| 纯命令行 | [正确] 空字符串或 null | [正确] 有 | 执行特效、切换视角等 |
| 等待命令 | [正确] 空字符串或 null | [正确] `[wait]` | 暂停等待用户点击 |
| 混合使用 | [错误] **禁止** | [错误] **禁止** | 会导致文本丢失 |

---

## 4. 代码示例

### [错误] 错误用法

#### 示例 1：命令与文本混用

```javascript
{
    text: "这是一段重要的对话内容",
    speaker: "角色A",
    command: "[pov 角色A]"  // [错误] 文本会被跳过
}
```

**后果**：
- 玩家看不到"这是一段重要的对话内容"
- POV 指示器会显示，但文本瞬间消失
- 造成不良的用户体验

#### 示例 2：淡出效果与文本混用

```javascript
{
    text: "故事即将结束...",
    speaker: "旁白",
    command: "[fadeout time=1500]"  // [错误] 文本无法显示
}
```

**后果**：
- 屏幕直接开始淡出，玩家看不到告别语
- 破坏了叙事节奏

#### 示例 3：等待命令与文本混用

```javascript
{
    text: "请点击继续",
    speaker: "系统",
    command: "[wait]"  // [不规范] 虽然能工作，但不符合最佳实践
}
```

**后果**：
- 虽然 `[wait]` 会显示"点击继续"覆盖原文本
- 但原 `text` 内容仍然被忽略
- 不符合最佳实践

---

### [正确] 正确用法

#### 示例 1：POV 视角切换

```javascript
// 先显示文本
{
    text: "现在切换到主角的视角...",
    speaker: "系统",
    background: "bg_example"
},
// 再执行命令（独立行）
{
    text: "",  // [正确] 空字符串
    command: "[pov 主角]"
},
// 继续剧情
{
    text: "我看到了熟悉的街道...",
    speaker: "主角",
    background: "bg_example"
}
```

#### 示例 2：淡出转场

```javascript
// 显示告别语
{
    text: "再见了，我的朋友...",
    speaker: "角色A",
    background: "bg_example"
},
// 短暂停顿（可选）
{
    text: "",
    command: "[wait]"
},
// 执行淡出
{
    text: "",  // [正确] 空字符串
    command: "[fadeout time=1500 color=black]"
}
```

#### 示例 3：BGM 切换

```javascript
{
    text: "音乐渐渐变化...",
    speaker: "旁白"
},
{
    text: "",  // [正确] 空字符串
    bgm: "bgm wait bgm_example"  // 这也是一种命令形式
}
```

#### 示例 4：多个命令组合

```javascript
{
    text: "场景即将转换",
    speaker: "系统"
},
{
    text: "",
    command: "[wait]"
},
{
    text: "",
    command: "[pov stop]"
},
{
    text: "",
    background: "new_bg",
    bgm: "bgm wait new_bgm"
},
{
    text: "",
    command: "[pov 新角色]"
},
{
    text: "新的场景开始了...",
    speaker: "新角色"
}
```

---

## 5. 特殊情况说明

### 5.1 [s] 标签 vs [wait] 命令

虽然两者都能实现"等待点击"的效果，但使用场景不同：

| 特性 | `[s]` 标签 | `[wait]` 命令 |
|------|-----------|--------------|
| 使用位置 | 嵌入在 `text` 中 | 独立的 `command` 字段 |
| 文本显示 | 累积显示多段文本 | 不显示文本（或显示"点击继续"） |
| 适用场景 | 同一段对话的分段显示 | 场景间的停顿、强调 |
| 示例 | `"第一段[s]第二段"` | `text: "", command: "[wait]"` |

**正确对比**：

```javascript
// [正确] 使用 [s] 标签：分段显示同一段对话
{
    text: "你好[s]我是示例角色[s]很高兴认识你",
    speaker: "角色A"
}

// [正确] 使用 [wait] 命令：在对话间制造停顿
{
    text: "你好，我是示例角色。",
    speaker: "角色A"
},
{
    text: "",
    command: "[wait]"  // 等待玩家准备好
},
{
    text: "很高兴认识你！",
    speaker: "角色A"
}
```

### 5.2 命令后的文本衔接

如果需要在命令执行后显示文本，应将其放在**下一行**：

```javascript
// [错误]
{
    text: "这段文字不会显示",
    command: "[fadein time=1000]"
}

// [正确]
{
    text: "",
    command: "[fadein time=1000]"
},
{
    text: "淡入完成后显示这段文字",
    speaker: "旁白"
}
```

---

## 6. 常见命令类型

以下命令都应遵循"独立成行，text 为空"的原则：

### 界面控制命令
- `[fadeout time=1000 color=black]` - 淡出
- `[fadein time=1000 color=black]` - 淡入
- `[clearname]` - 清除姓名框
- `[msgoff]` - 隐藏文本框
- `[msgon]` - 显示文本框

### 视角控制命令
- `[pov 角色名]` - 显示视角指示器
- `[pov stop]` - 隐藏视角指示器

### 流程控制命令
- `[wait]` 或 `[wait click]` - 等待用户点击
- `[finish bgcolor=black time=1500]` - 游戏结束

### 其他命令
- 所有通过 `command` 字段执行的标签命令

---

## 7. 调试技巧

### 如何发现错误用法

如果在测试时发现某段文本"一闪而过"或完全不显示：

1. **检查该行是否有 `command` 属性**
2. **查看浏览器控制台**，确认是否有命令执行日志
3. **将 `text` 和 `command` 分离到两行**

### 验证方法

```javascript
// 临时测试：添加延迟观察
{
    text: "测试文本",
    speaker: "测试",
    action: {
        type: "wait",
        duration: 3000  // 等待 3 秒，观察文本是否显示
    }
}
```

---

## 8. 总结

### 黄金法则

> **一行只做一件事：要么显示文本，要么执行命令，不要混用。**

### 记忆口诀

```
有命令，text 空；
要文本，无命令；
分开写，才正确；
混一起，必出错。
```

### 检查清单

在提交场景文件前，请确认：

- [ ] 所有包含 `command` 的行，`text` 字段是否为空？
- [ ] 需要显示的文本是否在独立的行中？
- [ ] 命令执行后的文本衔接是否自然？
- [ ] 是否使用了正确的命令格式（方括号包裹）？

---

## 相关文档

- `WAIT_COMMAND_USAGE.md` - [wait] 指令详细使用说明
- `README.md` - 引擎完整开发教程
- `engine.js` - 引擎核心代码

---

**最后更新**：2026/4/8  
**版本**：V1.0.9
