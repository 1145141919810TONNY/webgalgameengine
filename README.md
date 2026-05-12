# Shiori

这是一个基于HTML/JS的视觉小说引擎，具有类似Kirikiri的功能。

在scenes文件夹中，scenes0.html是一个空白模板。

如果要使用本模板，请根据license.txt中的指引进行修改本项目

本引擎的教学网页：[https://1145141919810tonny.github.io/Shioriteaching/](https://1145141919810tonny.github.io/Shioriteaching/)

由于引擎在早期开发阶段缺乏完整的资源测试环境，本 README 中可能包含部分已废弃或不支持的语法。**若与本文档存在冲突，请以README2.MD文档为准。**
[README2.md](README2.md)

资源的详细配置方案请参照[assets.md](assets.md)

交付给用户时，最小的文件数量架构（Shiori_debug.exe可以选择不放入）：

![img](https://github.com/1145141919810TONNY/webgalgameengine/blob/main/img/4.png)

用户运行了一次游戏后的文件架构：

![img](https://github.com/1145141919810TONNY/webgalgameengine/blob/main/img/5.png)

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

# 版本更新内容 （2026/5/12）

## 启动器 V1.1.2 更新内容
### 功能调整
- **正式版（Shiori.exe）**：移除了 F12 快捷键功能，相关选项和快捷键已统一整合至"调试"菜单中
- **调试版（Shiori_debug.exe）**：新增"调试"功能模块：
  - **从头开始**：仅适用于 scenes 文件夹内的剧本文件，可重新加载指定文件并重置代码执行状态
  - **加载指定文件**：通过弹窗直接选择剧本文件，引擎将立即加载并运行所选文件

### 问题修复
- 修复了 F10/F11/F12 快捷键失效的问题
- 解决了从 F11（全屏）切换回 F10（窗口化）时，以及通过 UI 菜单最大化窗口时，窗口被导航栏遮挡的显示异常

### 性能优化
- 优化了 CG.html 页面的图片加载机制，降低缩略图分辨率并启用 GPU 加速，有效缓解卡顿现象

## 引擎核心 V2.0.2 更新内容
### 响应式设计改进
- 全面优化所有 HTML 页面的 CSS 响应式布局，确保在极小屏幕尺寸下文字内容仍能完整显示，提升多设备兼容性
- 在 video.html 视频播放界面中实现了智能 UI 隐藏机制：播放时控制按钮自动隐藏，鼠标悬停至按钮区域时即时显示

# 版本更新内容 （2026/5/11）

## 重要说明

**1. 新版 Python 启动器已全面取代旧版启动器，旧版将逐步停止支持**

**2. file:// 协议模式已完全停止支持，请勿直接双击 HTML 文件运行**

**3. 部分核心功能（如视频播放、存档管理等）无法在 file:// 模式下正常工作**

### 过渡期说明

由于新版启动器仍处于测试阶段，可能存在未知问题。在正式宣布完全停用旧版启动器之前，我们仍会继续提供旧版启动器的相关优化与 bug 修复服务，以确保您的使用体验。


## 启动器 V1.1.1 更新内容

### 系统变更
- **架构优化**：新版启动器改为多文件运行模式。虽然文件总大小有所增加，但显著提升了运行与启动速度。
  - **部署说明**：请将 `Shiori\dist` 目录中的所有内容复制粘贴到项目根目录即可

### 功能新增
- **窗口比例锁定**：支持 16:9 和 4:3 两种长宽比模式，并提供常用分辨率预设，可通过菜单按需调整
- **菜单集成**：新版启动器菜单中集成了相关链接的快速访问入口
- **引擎完整性验证**：新增 `验证引擎完整性.bat` 工具，用于检测基本引擎文件架构，开发者可根据需求自定义修改

### 问题修复
- **视频播放修复**：修复了新版启动器无法播放视频的问题
  - Python 端推荐使用 WebM 格式（VP9 编码）
  - HTML 端保持原有 H.264 格式不变
- **快捷键冲突修复**：解决了 F5 快捷键冲突问题，现在 F5 绑定为快速保存存档功能
- **进程残留修复**：修复了关闭独立窗口后进程残留导致存档读取失败的问题
  - 退出游戏后将自动静默运行 `check_process.bat` 清理后台进程
  - 也可手动双击该脚本进行进程清理

## 引擎核心 V2.0.1 更新内容

### 内容优化
- **样式适配**：优化了 `index.html` 的 CSS 样式，更好地适配新版启动器（主要针对 16:9 分辨率进行优化）
- **视频播放重构**：完全重写了 `video.html` 的视频播放逻辑
  - 支持 HTML/Python 双端统一播放
  - 屏蔽非标准视频控制按钮
  - 具体实现方式请参考 `video.html` 相关代码注释
- **智能内容过滤**：剧本系统将自动根据 `video.html` 的配置，屏蔽不兼容的视频播放内容


# V2.0.0 更新内容（2026/5/9）

- **目前新版启动器存在无法播放的问题，目前正在尝试修复**
- **启动器技术栈升级**：从 C# (.NET) 迁移至 Python (PyQt6 + QtWebEngine)，内置 Chromium 内核，无需外部浏览器，兼容性更好。
- **单文件打包**：新版启动器采用单文件打包（约 200MB+），包含所有 Python/Qt 依赖，只需复制 exe 文件即可运行。
- **启动器放置位置说明**：
  - **新版启动器**（Python/PyQt6）：放置在**项目根目录**（与 `shiori engine` 文件夹同级），运行 `Shiori.exe` 即可（下载Shiori文件夹内的所有内容）
  - **旧版启动器**（C#/.NET）：放置在 `shiori engine/` 文件夹内（即 `shiori engine/shiori.exe`），仍可按原有方式正常使用
  - 两个版本的启动器可同时存在，互不影响
- **重要提示**：新版启动器要求引擎文件夹必须命名为 `shiori engine`（全小写，中间有空格），不可更改为其他名称，否则启动器将无法找到引擎入口文件。
- **完全兼容旧版开发方式**：游戏内容（HTML/场景/资源）的修改方式与之前完全一致，无需改变开发习惯
- 启动器版本跃升至V1.1.0
- 该启动器还在测试阶段，可能会存在一些bug。日后更新的重心会侧重于新版的启动器。
详情请参照文件[README_BUILD.md](Shiori-engine-python/README_BUILD.md) 

# V1.2.7 更新内容（2026/5/8）
- 修复`[后退]`指令映射错误导致的执行失效问题。

# V1.2.6 更新内容（2026/5/4）
- **音频/视频零配置管理**：新增资源自动解析功能，支持在 `audio` 和 `video` 属性中直接使用文件名（如 `voice1`, `video1`），引擎将自动从 `assets/audio/` 和 `assets/video/` 目录下查找对应文件，不再需要手动定义映射路径。

# V1.2.5 更新内容（2026/5/3）
- **文本显示优化**：默认状态下，调整常规模式剧本显示字号从 18px 提升至 25px，全屏小说模式字号从 20px 提升至 30px，姓名框字号从 25px 提升至 32px。
- **注音功能支持**：新增文本注音（Ruby/Furigana）功能，支持使用 `[汉字,拼音]` 语法为文本添加注音标注。该功能类似于日语假名标注效果，不仅可用于中文拼音标注，还可用于其他语言的注音需求（如 `[日语,假名]`），适用于所有HTML支持的语言。此功能将自动适配常规模式和全屏小说模式，确保在不同显示模式下都能正确呈现注音效果。<br>
大致效果如图：<br>
![img](https://github.com/1145141919810TONNY/webgalgameengine/blob/main/img/3.png)

# V1.2.4 更新内容（2026/4/29）

## 指令新增
- **鼠标点击锁定/解锁指令**：
  - `[阻止]` / `[lock]`：锁定鼠标点击，屏蔽所有非快进模式的点击事件（按住 Ctrl 键仍可快进）
  - `[解锁]` / `[free]`：解除鼠标点击锁定，恢复正常点击交互
  - **使用场景**：在播放重要动画、视频或显示选项时防止用户误触跳过剧情
  - **示例**：
    ```javascript
    { text: "", command: "[阻止]" },  // 锁定点击
    { text: "关键剧情正在播放..." },
    { text: "", command: "[解锁]" }   // 解锁点击
    ```
## Bug 修复与优化
- **转场期间点击竞态问题修复**：
  - **问题描述**：在使用背景转场效果（淡入淡出、滑屏、扫描等）时，如果用户在转场动画开始前快速点击鼠标，可能导致立绘无法正常显示或剧情被意外跳过
  - **优化方案**：现在引擎会在检测到转场指令时立即启动输入屏蔽机制，在转场动画执行期间自动禁止鼠标点击交互，确保画面渲染的完整性和剧情流程的稳定性
  - **注意事项**：当转场指令前存在纯命令行的剧情块（仅包含 `command` 属性而无文本内容）时，由于 JavaScript 事件循环的执行时序，输入屏蔽可能存在几十毫秒的延迟窗口。建议在关键转场场景前使用 `[阻止]` 指令提前锁定点击，以确保万无一失
  - **灵活控制**：如需在特定场景下允许用户交互，可配合使用 `[阻止]` / `[解锁]` 指令进行精确控制
  - **示例**：在转场前锁定点击，转场后解锁，确保过渡期间不会误触
    ```javascript
    {
        text: "",
        command: "[normal],[pov 主角],[lock]"  // 切换到普通模式、显示POV指示器、锁定点击
    },
    {
        text: "",
        background: "转场 bg1",  // 执行背景转场
        bgm: "bgm wait bgm13",   // 淡出旧BGM并播放新BGM
    },
    {
        text: "",
        command: "[free]"  // 转场完成后解锁点击
    },
    ```
## 指令系统优化
- **command 与 action 共存支持**：
  - **功能说明**：现在可以在同一个剧情对象中同时使用 `command` 和 `action` 属性，引擎会按顺序执行两者，无需拆分为多个独立的剧情块
  - **优势**：简化代码结构，提高可读性，减少冗余的剧情对象定义
  - **执行顺序**：先执行 `command` 指定的指令，再执行 `action` 指定的动作
  - **兼容性说明**：**旧的写法仍然完全支持**，已有的项目代码无需修改，可根据需要选择是否采用新写法
  
  **示例对比**：
  
  **之前的写法**（需要拆分为两个剧情对象）：
  ```javascript
  {
      text: "",
      command: "[msgoff]",  // 第一步：隐藏文本框
  },
  { 
      text: "", 
      action: {  // 第二步：显示选项菜单
          type: "choice",
          choices: [
              { text: "选项1", target: "scene2.html" },
              { text: "选项2", target: "scene3.html" },
          ]
      }
  }
  ```
  
  **现在的写法**（合并为一个剧情对象）：
  ```javascript
  { 
      text: "", 
      command: "[msgoff]",  // 先隐藏文本框
      action: {  // 然后显示选项菜单
          type: "choice",
          choices: [
              { text: "选项1", target: "scene2.html" },
              { text: "选项2", target: "scene3.html" },
          ]
      }
  }
  ```

  - **适用场景**：常用于在显示选项前执行一些预处理指令，如隐藏文本框、切换模式、锁定点击等

- **command 多指令并行支持**：
  - **功能说明**：现在可以在单个 `command` 属性中使用逗号分隔多个指令，引擎会按顺序依次执行，无需拆分为多个剧情对象
  - **优势**：大幅减少代码行数，提高编写效率，使相关指令的逻辑关系更加清晰
  - **语法格式**：使用英文逗号 `,` 分隔多个指令，如 `"[指令1],[指令2],[指令3]"`
  - **兼容性说明**：**旧的写法仍然完全支持**，已有的项目代码无需修改，可根据需要选择是否采用新写法
  
  **示例对比**：
  
  **之前的写法**（需要拆分为三个剧情对象）：
  ```javascript
  {
      text: "",
      command: "[normal]"  // 第一个剧情块
  },
  {
      text: "",
      command: "[pov 主角]"      // 第二个剧情块
  },
  {
      text: "",
      command: "[lock]"          // 第三个剧情块
  }
  ```
  
  **现在的写法**（合并为一个剧情对象）：
  ```javascript
  {
      text: "",
      command: "[normal],[pov 主角],[lock]"  // 一条指令完成所有操作
  }
  ```
  
  - **注意事项**：
    - 多个指令会在同一帧内按顺序执行，适合不需要间隔的连续操作
    - 如果需要在指令之间等待用户点击或动画完成，仍需拆分为独立的剧情对象
    - 支持与 `action` 属性同时使用，执行顺序为：先执行所有 command，再执行 action

# V1.2.3 更新内容（2026/4/16 17:00）

## 文档优化
- 全面更新 README.md 文档，修正场景数据结构示例代码
- 统一资源引用规范，推荐使用集中化配置文件（BG_CONFIG_SUB、BGM_CONFIG_SUB）
- 补充常见问题解答，新增视频播放控制、立绘动作指令、背景转场效果等问答

## 视频播放与 BGM 控制
- 视频播放前会自动停止当前 BGM（暂停并重置到开头），避免音频冲突
- 视频结束后不会自动恢复 BGM，开发者需在后续剧情行中通过 `bgm` 属性手动指定

## Bug 修复
- 修复了文本分段标签 `[s]` 与换行符 `\n` 组合使用时的显示问题
- 现在在分段文本中，换行符会正确渲染为 HTML `<br>` 标签，保持预期的排版效果
- 示例：`text: "第一段第一行。\n第一段第二行。[s]第二段第一行。"`

# V1.2.2 更新内容（2026/4/16 12:00）

## F1 调试面板增强
- **新增源码行号显示**：F1 调试面板现在会在剧情索引（Index）旁显示该行在源代码文件中的物理行号范围，格式为 `Index: 5 {56~61}`，便于快速定位和调试特定剧情行

## F12 开发者控制台日志
- **立绘指令解析日志系统**：新增 `[CharParser]` 前缀的详细调试日志，完整追踪立绘指令的解析过程
  - **冲突检测**：当出现同类关键词冲突时（如 `[左 右 lh1]`），明确标注被保留和被忽略的关键词及其原因
  - **优先级说明**：精确坐标优先于文字指令、动作指令屏蔽瞬移等规则均有清晰日志输出
  - **错误警告**：对无效语法、未知修饰词、格式错误等情况提供明确的警告信息
  - **结果汇总**：每步解析完成后输出最终生效的属性值（left, bottom, zIndex, scale 等）
- **示例输出**：
  ```
  [CharParser] Parsing modifiers: "x:10% 中 左"
  [CharParser] Detected precise X coordinate: x:10%
  [CharParser] Precise X coordinate overrides horizontal keywords: [中, 左] ignored.
  [CharParser] Final result: left=calc(50% + 10%), bottom=0, zIndex=10, scale=100%
  ```

## Bug 修复
- 修复`[持续发抖]`状态无法正常停止的问题

# V1.2.1 更新内容（2026/4/15 21:00）

## 立绘动作系统增强
- **新增“点头”动画指令**：
  - 支持 `[点头]` / `[nod]` 关键词
  - 动画逻辑：执行一次完整的“上移 2% → 下移 4% → 回归原位”序列
  - 严格只执行一次，不循环，动画结束后自动恢复到原始状态
  - 可与其他修饰词组合使用，如 `[角色A 中 点头 lh15]`

## F1 调试日志状态同步修复
- **修复页面刷新后状态残留问题**：
  - 刷新页面后，调试面板现在能正确显示当前实际渲染的立绘状态
  - 不再显示刷新前的旧 `chars` 信息
- **修复清除立绘后状态不同步问题**：
  - 在全屏小说模式或执行 `[消失 all]` 等清除指令后，调试面板立即同步清空 `chars` 状态
  - 解决了清除操作后面板仍显示旧立绘信息的问题

## 立绘动作指令逻辑优化
- **修复连续动作指令累积效应问题**：
  - 修复了连续调用相同动作指令（如连续两次 `[前进]`）时无法产生叠加效果的问题
  - 现在每次动作都基于 DOM 元素的当前实际状态进行增量计算
  - 确保了“前进/后退”等指令的数学计算正确性，支持真正的累积效应

# V1.2.0 更新内容（2026/4/15 18:45）

## 存档系统更新
- **剧本文件菜单优化**：
  - 在右键上下文菜单中新增"保存存档 (F5)"、"存档页面"选项
  - 添加 F5 快捷键支持，可快速创建新存档（带防抖和 1 秒冷却机制，防止长按重复触发）
  - 在 file:// 协议下自动屏蔽存档相关功能（菜单项、快捷键提示、F5 按键），避免本地文件模式下的功能异常
- **进度管理页面优化**：
  - 当玩家从剧情页进入时，显示“当前游玩页面”提示框和“返回当前页面”按钮
  - 点击返回按钮可跳转回原场景并恢复到对应行号
  - 高亮显示当前正在游玩的场景卡片（蓝色边框）
  - 从主菜单进入时不显示提示框
- **新增存档管理页面 `archive.html`**：
  - 采用动态存档列表设计，支持无限数量的存档（受限于浏览器存储容量）
  - 存档卡片显示：序号、自定义名称、场景名、保存时间、进度行数、文本预览
  - 支持双击编辑存档名称、加载存档、删除存档等操作
  - 顶部操作栏固定，存档列表支持垂直滚动
  - 提供导出/导入所有存档功能（JSON 格式）
  - 空状态时显示友好提示和引导信息
  - 集成智能返回功能，从剧情页进入时显示返回按钮

可按开发所需保留或删除存档管理或进度管理页面。

# V1.1.7 更新内容（2026/4/14 14:58）

## bug修复
- 修复了音量控制状态及开发者调试窗口在页面切换时被重置的问题
- 修复了开发者调试窗口中背景图片（BG）属性在某些情况下无法实时更新的问题

# V1.1.6 更新内容（2026/4/14 11:00）

## 系统功能增强
- **音量控制**：支持通过 `+`/`↑` 增加音量，`-`/`↓` 减少音量（步进 1%）
- **调试模式**：按 `F1` 可开关开发者调试面板，实时显示当前剧情状态（BGM、背景、立绘等）

# V1.1.5 更新内容（2026/4/14 8:00）

## 角色名称标识符 (Role Name Identifier)
- 新增立绘指令中的“角色名称标识符”功能，支持基于角色的自动替换与状态继承。
- **语法格式**：`[标识符 修饰词 资源ID]`，标识符必须紧挨着左方括号 `[`。
- **互斥显示**：当使用相同标识符时，新立绘会自动替换旧立绘，保持屏幕整洁。
- **属性继承**：若新指令未指定位置或缩放，新立绘将自动继承旧立绘的当前状态。
- **示例**：
  - `[角色A 左 lh3]`：在左侧显示“角色A”。
  - `[角色A lh4]`：替换为 `lh4`，但保持在左侧。
  - `[消失 角色A]`：通过名称精准移除立绘。

- 详见 [illustration.md](assets/chars/illustration.md) 

# V1.1.4 更新内容（2026/4/13）

## 渐入与渐出指令
- 新增立绘指令 `[渐入]` / `[fadeIn]` 和 `[渐出]` / `[fadeOut]`。
- 支持立绘以平滑的淡入淡出效果出现或消失，替代生硬的瞬间刷新。
- **注意**：使用 `[渐出]` 时建议保持指令纯净（如 `[渐出 lh1]`），避免添加位置修饰词导致先闪动再消失。

## 背景转场系统
- 新增多种背景切换动画，包括淡入淡出（Fade）、滑动（Slide）及扫描（Scan）效果。
- 支持中英文指令，例如：`trans bg_01`、`左滑 bg_02`、`scanR bg_03`。
- 详细用法请参考 [background.md](assets/bg/background.md) 文档。

# V1.1.3更新内容（2026/4/12）

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

# V1.1.2更新内容（2026/4/11）

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


## 1.1 项目总览


```
project/                              # 项目根目录<br>
├── Shiori.exe                        # Python启动器主程序（正式版）<br>
├── Shiori_debug.exe                  # Python启动器调试版<br>
├── README.md                         # 项目主文档（本文件）<br>
├── README2.md                        # 补充说明文档<br>
├── license.txt                       # 许可证文件<br>
├── check_process.bat                 # 进程检查脚本<br>
├── check_process.vbs                 # VBScript进程检查<br>
├── test_persistence.bat              # 持久化测试脚本<br>
├── 验证引擎完整性.bat                 # 引擎完整性验证脚本<br>
├── 运行游戏前请先看我.txt             # 使用前必读说明<br>
├── _internal/                        # 引擎的依赖文件<br>
├── shiori_cache                      # 第一次运行exe时自动生成的文件夹（打包分发时无需包含此文件夹）<br>
├── shiori_data                       # 第一次运行exe时自动生成的文件夹（打包分发时无需包含此文件夹）<br>
├── img/                              # 图片资源目录<br>
├── Shiori/                           # Python启动器源代码目录<br>
└── shiori engine/                    # Shiori视觉小说引擎（核心）<br>

```

---

## 1.2 Shiori Engine 详细结构


```
shiori engine/<br>
├── shiori.exe            # Windows 可执行启动器（推荐）<br>
├── index.html            # 主菜单页面<br>
├── engine.js             # 核心 JavaScript 引擎<br>
├── system.js             # 系统功能模块<br>
├── style.css             # 样式文件<br>
├── bg_config.js          # 背景图片集中配置文件<br>
├── bgm_config.js         # BGM 集中配置文件<br>
├── cg_config.js          # CG 集中配置文件<br>
├── illustration.js       # 立绘集中配置文件<br>
├── icon-32.png           # 浏览器页面图标<br>
├── background.md         # 背景配置说明文档<br>
├── assets.md             # 资源管理说明文档<br>
├── illustration.md       # 立绘指令说明文档<br>
├── BGM_CONFIG_README.md  # BGM配置说明文档<br>
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
│   ├── archive.html      # 存档管理<br>
│   ├── saves.html        # 进度管理<br>
│   ├── bgm.html          # BGM 鉴赏<br>
│   ├── video.html        # 视频鉴赏<br>
│   ├── CG.html           # CG 图鉴<br>
│   └── story.html        # 小故事页面<br>
├── api/                  # API 接口<br>
│   ├── progress.json     # 进度数据<br>
│   └── progress_api.js   # 进度API脚本<br>

```

---

## 1.3 Shiori Python 启动器结构


```
Shiori/<br>
├── main.py                   # 主入口文件<br>
├── shiori_app.py             # 应用主逻辑（PyQt6）<br>
├── api_bridge.py             # API桥接模块<br>
├── http_server.py            # HTTP服务器模块<br>
├── video_decoder.py          # 视频解码模块<br>
├── check_video_codec.py      # 视频编解码检查<br>
├── reorganize_output.py      # 输出重组工具<br>
├── version.py                # 版本信息<br>
├── check_ico.py              # 图标检查工具<br>
├── requirements.txt          # Python依赖列表<br>
├── shiori.spec               # PyInstaller打包配置<br>
├── shiori_debug.spec         # 调试版打包配置<br>
├── build_fix.bat             # 构建修复脚本<br>
├── test_video.py             # 视频测试工具<br>
├── version.txt               # 版本文本文件<br>
├── 详细信息                   # 详细信息文件<br>
├── .gitignore                # Git忽略配置<br>
├── README_BUILD.md/txt       # 构建说明文档<br>
├── ico/                      # 图标资源目录<br>
└── plugins/                  # 插件目录（可选）<br>
```

---

# 2. 核心概念详解


## 2.1 场景数据结构


每个场景文件包含一个sceneData对象，基本结构如下：

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
        'op_video': '../assets/video/OP.mp4',      // OP 视频
        'ending_video': '../assets/video/ED.mp4'   // ED 视频
    },
    
    // 故事脚本
    story: [
        // 示例 1：基础对话
        {
            text: "你好，很高兴见到你！",
            speaker: "角色A",
            background: "bg_001_00_00",  // 背景 ID（引用自 BG_CONFIG_SUB）
            bgm: "bgm1"                  // BGM ID（引用自 BGM_CONFIG_SUB）
        },
        
        // 示例 2：播放音效或语音
        {
            text: "门打开了。",
            speaker: "系统",
            audio: "se_door"  // 音效 ID（引用自 sceneData.audio）
        },
        
        // 示例 3：BGM 控制
        {
            text: "背景音乐切换中...",
            speaker: "系统",
            bgm: "bgm wait bgm2"  // 淡出当前 BGM，播放新 BGM
        },
        {
            text: "停止背景音乐。",
            speaker: "系统",
            bgm: "bgm stop"  // 特殊标识符，停止 BGM 播放
        },
        
        // 示例 4：立绘控制
        {
            text: "角色出现在左侧。",
            speaker: "系统",
            chars: "[左 角色A]"  // 立绘指令（详见 illustration.md）
        },
        
        // 示例 5：标签命令
        {
            text: "即将进入全屏小说模式。",
            speaker: "系统"
        },
        {
            text: "",  // 纯命令行建议留空 text
            command: "[novel]"  // 开启全屏小说模式
        },
        
        // 示例 6：选项分支
        {
            text: "你要选择哪条路？",
            speaker: "角色A",
            action: {
                type: "choice",
                choices: [
                    { text: "向左走", target: "scene_left.html" },
                    { text: "向右走", target: "scene_right.html" }
                ]
            }
        },
        
        // 示例 7：视频播放
        {
            text: "即将播放开场动画。",
            speaker: "系统",
            video: "op_video"  // 视频 ID（引用自 sceneData.videos）
        },
        
        // 示例 8：转场效果
        {
            text: "场景切换中...",
            speaker: "系统",
            background: "fade bg_002_00_00"  // 淡入淡出转场
        },
        {
            text: "使用滑动转场。",
            speaker: "系统",
            background: "slideL bg_003_00_00"  // 从左滑入
        }
    ]
};
```

2.2 Action动作系统
------------------

Action支持多种类型的动作（通过 `action` 属性使用）：

```javascript
// 选择分支
action: {
    type: "choice",
    choices: [
        { text: "接受邀请", target: "scene_accept.html" },
        { text: "拒绝邀请", target: "scene_reject.html" }
    ]
}

// 场景跳转
action: {
    type: "nextScene",
    target: "scene2.html"
}

// 界面控制
action: { type: "clearName" }    // 清除姓名框
action: { type: "hideText" }     // 隐藏文本框
action: { type: "showText" }     // 显示文本框

// 特殊效果
action: { 
    type: "fadeOut",
    duration: 1000,              // 可选：持续时间（毫秒）
    backgroundColor: "black"     // 可选：背景颜色
}
action: { 
    type: "fadeIn",
    duration: 1000,
    backgroundColor: "black"
}

// 游戏控制
action: { type: "returnToMenu" } // 返回主菜单
action: { 
    type: "finishGame",
    bgColor: "black",            // 可选：淡出背景颜色
    duration: 1500               // 可选：淡出持续时间
}
```

**注意：**
- 等待控制应使用 `command` 属性的 `[wait]` 标签，而非 `action`。
- 淡入淡出等动画命令推荐使用 `command` 属性（如 `[fadeout time=1000]`），会自动在动画完成后继续下一行。
- `sepiaStart` 等怀旧滤镜功能在当前版本中可能未实现，请使用 CSS 滤镜或其他方案替代。

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
- [fadeout time=1000 color=black] - 淡出效果（动画完成后自动继续）
- [fadein time=1000 color=black] - 淡入效果（动画完成后自动继续）
- [wait time=1000] - 等待指定时间后自动继续；不带 time 参数时等待用户点击
- [clearname] - 清除姓名框
- [msgoff] - 隐藏文本框（建议在单独的命令行中使用，text 留空）
- [msgon] - 显示文本框
- [finish bgcolor=black time=1500] - 游戏结束淡出（动画完成后自动继续）
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

**注意：`\n` 与 `[s]` 可以组合使用**
```javascript
{
    text: "第一段第一行。\n第一段第二行。[s]第二段第一行。\n第二段第二行。",
    speaker: "系统"
}
```
换行符在分段显示中会正常生效。

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

3. **动画命令会自动继续**

`[fadeout]`、`[fadein]`、`[finish]` 等动画命令在执行完成后会自动进入下一行，无需额外点击。

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
- ↑ / +: 增加音量（步进 1%）
- ↓ / -: 减少音量（步进 1%）
- 鼠标点击: 继续剧情/选择选项
- 视频播放时右键或 ESC: 跳过视频

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


























