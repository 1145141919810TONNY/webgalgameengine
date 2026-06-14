# [wait time] 标签使用指南

## 目录

1. [基础语法](#基础语法)
2. [标签格式要求](#标签格式要求)
3. [核心功能](#核心功能)
4. [各元素类型实现](#各元素类型实现)
   - [Command 元素](#command-元素)
   - [Background 元素](#background-元素)
   - [BGM 元素](#bgm-元素)
   - [Audio 元素](#audio-元素)
   - [SE 元素](#se-元素)
   - [Chars 元素](#chars-元素)
5. [异步处理](#异步处理)
6. [点击跳过行为](#点击跳过行为)
7. [与旧指令的兼容性](#与旧指令的兼容性)
8. [扩展语法](#扩展语法)
9. [注意事项](#注意事项)
10. [错误处理](#错误处理)

---

## 基础语法

### 标签格式

```
[wait time= ${number}]
```

其中 `${number}` 是正整数，表示毫秒（1秒 = 1000毫秒）。

### 正确示例

```
[wait time=1000]      // 等待1秒
[wait time=5000]      // 等待5秒
[wait time=10000]     // 等待10秒
```

### 错误示例

```
[wait time]           // 缺少数值
[wait time=abc]       // 非数字值
[wait time=-1000]    // 负数
[wait time=0]         // 零值
```

---

## 标签格式要求

1. **必须包含数值**：`[wait time]` 单独使用无效，必须指定毫秒数
2. **数值必须为正整数**：0 或负数将被忽略
3. **支持空格变化**：`time` 和 `=` 之间可以有空格
   - `[wait time=1000]`
   - `[wait time =1000]`
   - `[wait time = 1000]`

---

## 核心功能

### 基本行为

- **暂停执行**：标签会暂停当前元素的操作
- **自动继续**：等待指定时间后自动执行下一个操作
- **无需交互**：与 `[s]` 标签不同，不需要用户点击

### 点击跳过

- 用户在等待期间点击屏幕，会立即中断当前等待
- 只中断当前的 wait，继续执行后续内容
- 不影响其他异步元素的执行

---

## 各元素类型实现

### Command 元素

**作用**：作为全局计时器，影响整个行

**语法**：
```javascript
{
    command: "[wait time=1000]"
}
```

**单独使用（空文本）**：
```javascript
{
    text: "",
    command: "[wait time=1000]"
}
```

**特点**：
- 等待结束后自动进入下一行
- 不阻塞 chars 处理
- 点击可立即跳过

**示例**：
```javascript
{
    text: "等待3秒后继续...",
    command: "[wait time=3000]"
}
```

---

### Background 元素

**作用**：背景图片切换序列

**语法**：
```javascript
background: "bg1,[wait time=1000]bg2,[wait time=2000]bg3"
```

**执行流程**：
1. 显示 bg1
2. 等待 1000ms
3. 显示 bg2
4. 等待 2000ms
5. 显示 bg3

**支持转场指令**：
```javascript
background: "bg1,[wait time=1000]转场 bg2,[wait time=2000]左滑 bg3"
```

**完整示例**：
```javascript
{
    text: "背景切换测试",
    speaker: "系统",
    background: "bg_001_00_00,[wait time=1000]bg_002_00_00,[wait time=2000]bg_003_00_00"
}
```

---

### BGM 元素

**基础用法**：
```javascript
bgm: "bgm1,[wait time=10000]bgm2"
```

**执行流程**：
1. 立即播放 bgm1
2. 等待 10000ms
3. 淡入播放 bgm2

**淡入播放（扩展语法）**：
```javascript
// [wait time] 后跟着 BGM 名称时，执行淡入效果
bgm: "[wait time=2000]bgm1"  // 等待2秒后淡入播放 bgm1
```

**淡出停止（扩展语法）**：
```javascript
// bgm stop[wait time=XXX] 格式：淡出指定时间后停止
bgm: "bgm stop[wait time=2000]"  // 2秒内淡出停止
```

**常用组合**：
```javascript
// 播放BGM，等待后切换到另一个BGM
{
    bgm: "bgm1,[wait time=10000]bgm2"
}

// 淡入播放新BGM
{
    bgm: "[wait time=2000]bgm1"
}

// 淡出停止当前BGM
{
    bgm: "bgm stop[wait time=1500]"
}
```

---

### Audio 元素

**基础用法**：
```javascript
audio: "audio1,[wait time=2000]audio2,[wait time=2000]audio3"
```

**停止播放**：
```javascript
audio: "stop"  // 立即停止当前语音
```

**执行流程**：
1. 播放 audio1
2. 等待 2000ms
3. 播放 audio2
4. 等待 2000ms
5. 播放 audio3

**完整示例**：
```javascript
{
    text: "语音序列测试",
    speaker: "角色A",
    audio: "YN100001,[wait time=3000]YN100002"
}
```

**停止示例**：
```javascript
{
    text: "播放语音...",
    speaker: "角色A",
    audio: "YN100001"
},
{
    text: "立即停止！",
    speaker: "系统",
    audio: "stop"
}
```

**重要提示**：
- 默认情况下，音频会播放完毕
- 只有显式使用 `audio: "stop"` 才会立即停止

---

### SE 元素

**基础用法**：
```javascript
se: "SE001,[wait time=1000]SE002,[wait time=1000]SE003"
```

**停止播放**：
```javascript
se: "stop"  // 立即停止当前音效
```

**完整示例**：
```javascript
{
    text: "音效序列测试",
    speaker: "系统",
    se: "SE001,[wait time=1000]SE002,[wait time=1000]SE003"
}
```

**停止示例**：
```javascript
{
    text: "播放音效...",
    speaker: "系统",
    se: "SE001"
},
{
    text: "立即停止！",
    speaker: "系统",
    se: "stop"
}
```

---

### Chars 元素

**基础用法**：
```javascript
chars: "[左 lh1],[wait time=1000],[中 lh2],[右 lh3]"
```

**执行流程**：
1. 显示左侧立绘 lh1
2. 等待 1000ms
3. 显示中间立绘 lh2
4. 显示右侧立绘 lh3

**消失指令**：
```javascript
// [消失 立绘ID] 移除特定立绘
chars: "[左 lh1],[wait time=1000],[消失 lh1][中 lh2],[右 lh3]"
```

**完整示例**：
```javascript
{
    text: "立绘序列测试",
    speaker: "角色A",
    chars: "[左 lh1],[wait time=1000],[中 lh2],[wait time=1000],[右 lh3]"
}
```

**立绘消失示例**：
```javascript
{
    text: "立绘消失测试",
    speaker: "角色A",
    chars: "[左 lh1],[中 lh2],[右 lh3],[wait time=2000],[消失 lh2],[wait time=1000],[消失 lh3]"
}
```

**特点**：
- 元素持续显示，直到被 `[消失]` 指令移除
- 后面的立绘出现时，前面的立绘保持可见
- `[wait time]` 仅作为等待，不显示新立绘

---

## 异步处理

### 多元素异步执行

同一行中的多个元素可以同时执行独立的等待序列：

```javascript
{
    text: "123",
    speaker: "角色A",
    background: "bg1,[wait time=1000]bg2,[wait time=2000]bg3",
    bgm: "bgm1,[wait time=10000]bgm2",
    se: "SE001",
    audio: "YN100001",
    chars: "[左 lh1],[wait time=1000],[中 lh2],[右 lh3],[wait time=1000],[左前 lh4]"
}
```

### 执行特点

- **独立性**：每个元素的等待序列独立运行
- **并发性**：背景、BGM、语音、音效、立绘可以同时进行
- **互不阻塞**：一个元素的等待不会阻止其他元素执行

---

## 点击跳过行为

### 行为说明

- 在等待期间点击，会**只中断当前的 wait**
- 立即执行该元素的后续内容
- **不会**跳过所有内容进入下一行
- **不会**影响其他异步元素的执行

### 示例

```javascript
{
    background: "bg1,[wait time=5000]bg2,[wait time=5000]bg3"
}
```

**点击效果**：
- 如果在第一个 `[wait time=5000]` 期间点击 → 立即显示 bg2，继续等待第二个 `[wait time=5000]`
- 如果在第二个 `[wait time=5000]` 期间点击 → 立即显示 bg3，等待结束

---

## 与旧指令的兼容性

### [s] 标签

**作用**：等待用户点击后继续（阻塞式）

**与 [wait time] 的区别**：
| 特性 | [s] | [wait time] |
|------|-----|-------------|
| 等待方式 | 需点击 | 自动 |
| 阻塞性 | 阻塞整行 | 只阻塞当前元素 |
| 适用场景 | 需要用户确认 | 自动播放 |

### [a] 标签

**作用**：指定当前文字段落对应的音频

**与 [wait time] 的关系**：
- `[a]` 用于配合 `[s]` 指定音频
- `[wait time]` 用于自动等待和序列控制
- 两者可以混合使用


## 扩展语法

### BGM 淡入播放

```javascript
// [wait time] 后跟 BGM 名称 = 淡入播放
bgm: "[wait time=2000]bgm1"  // 等待2秒后淡入播放 bgm1
```
`[wait time]`标签在此处将直接上位替代旧的`bgm wait`的标签。当然，你也可以继续使用旧的`bgm wait`标签。

### BGM 淡出停止

```javascript
// bgm stop[wait time=XXX] = 淡出指定时间后停止
bgm: "bgm stop[wait time=2000]"  // 2秒内淡出停止
```

### 立绘位置

```javascript
[左 立绘ID]    // 左侧
[中 立绘ID]    // 中间
[右 立绘ID]    // 右侧
```

### 立绘消失

```javascript
[消失 立绘ID]  // 移除指定立绘
```

---

## 注意事项

### 1. 数值要求

- **必须为正整数**：0 或负数会被忽略
- **单位为毫秒**：1秒 = 1000毫秒

```javascript
// 错误
[wait time=0]      // 无效
[wait time=-1000]   // 无效
[wait time=abc]     // 无效

// 正确
[wait time=1000]    // 1秒
[wait time=5000]    // 5秒
```

### 2. 空格处理

```javascript
// 支持的格式
[wait time=1000]
[wait time =1000]
[wait time= 1000]
[wait time = 1000]
```

### 3. 异步执行理解

```javascript
{
    background: "bg1,[wait time=5000]bg2",
    chars: "[左 lh1],[wait time=1000],[中 lh2]"
}
```

**执行顺序**（视觉上）：
- 0ms: 显示 bg1, lh1
- 1000ms: 显示 lh2（background 仍在等待）
- 5000ms: 显示 bg2（chars 早已完成）

### 4. 音频停止行为

- **默认**：音频播放完毕后自动结束
- **显式停止**：使用 `audio: "stop"` 或 `se: "stop"` 立即停止
- **不会自动停止**：进入新行不会自动停止 audio/se

### 5. 立绘持续显示

- 立绘显示后会一直保持
- 必须使用 `[消失 立绘ID]` 才能移除
- 不同位置的立绘可以同时存在

### 6. 点击跳过范围

- 点击只跳过**当前的 wait**
- 不是跳过所有内容进入下一行
- 其他异步元素继续执行

### 7. BGM 淡入淡出

- **淡入**：`[wait time=XXX]bgmName` = 等待后淡入播放
- **淡出**：`bgm stop[wait time=XXX]` = 淡出指定时间后停止
- 使用 `requestAnimationFrame` 实现平滑过渡

### 8. Command 元素特性

- **不阻塞 chars**：立绘可以同时处理
- **阻塞行**：等待结束后才进入下一行
- **可单独使用**：配合空文本实现纯等待

---

## 错误处理

### 语法错误

| 错误写法 | 正确写法 | 说明 |
|---------|---------|------|
| `[wait time]` | `[wait time=1000]` | 必须指定数值 |
| `[wait time=abc]` | `[wait time=1000]` | 必须是数字 |
| `[wait time=0]` | `[wait time=1000]` | 必须是正数 |
| `[wait time=-100]` | `[wait time=100]` | 不能是负数 |

### 常见问题

**Q: [wait time] 没有生效？**
A: 检查数值是否为正整数，以及是否有语法错误

**Q: 背景没有切换？**
A: 检查背景 ID 是否正确，确认路径配置

**Q: BGM 没有淡入？**
A: 确保 `[wait time]` 在 BGM 名称之前

**Q: 立绘同时出现而不是依次？**
A: 确认 `[wait time]` 位置正确，应该在两个立绘之间

**Q: 音频没有停止？**
A: 使用 `audio: "stop"` 或 `se: "stop"` 显式停止

---

## 完整示例

### 示例1：复杂场景

```javascript
{
    text: "场景描述",
    speaker: "角色A",
    background: "bg_room,[wait time=2000]转场 bg_outside,[wait time=3000]bg_beach",
    bgm: "[wait time=1000]bgm_peaceful,[wait time=15000]bgm stop[wait time=2000]bgm_adventure",
    chars: "[左 lh1_normal],[中 lh2_smile],[wait time=5000],[消失 lh2_smile][中 lh2_sad],[wait time=3000],[消失 lh1_normal][左前 lh3_angry]",
    se: "se_wind,[wait time=1000]se_birds,[wait time=1000]se_waves",
    audio: "voice_narration"
}
```

### 示例2：对话场景

```javascript
// 第一段：等待后开始对话
{
    text: "",
    command: "[wait time=3000]"
}

// 第二段：角色入场
{
    text: "",
    speaker: null,
    chars: "[左 lh1_stand]"
}

// 第三段：对话
{
    text: "终于等到你了。",
    speaker: "角色A",
    chars: "[左 lh1_stand],[中 lh1_smile]"
}

// 第四段：背景切换
{
    text: "我们去外面走走吧。",
    speaker: "角色A",
    background: "bg_room,[wait time=2000]转场 bg_garden",
    chars: "[左 lh1_smile],[消失 lh1_stand]"
}

// 第五段：音效配合
{
    text: "（微风轻拂）",
    speaker: null,
    bgm: "bgm_nature,[wait time=5000]bgm soft",
    se: "se_wind,[wait time=2000]se_birds"
}

// 第六段：结束
{
    text: "今天真愉快。",
    speaker: "角色A",
    chars: "[左 lh1_happy]",
    bgm: "bgm soft"
}
```

---
