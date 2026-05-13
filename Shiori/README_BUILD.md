# Shiori Engine Launcher - 编译与部署指南

> **获取方式：**
> - **方式一（推荐）**：从 GitHub Release 页面下载已编译的完整文件
> - **方式二**：自行编译项目（需要安装 Python 3.10+）
> - 采用多文件打包模式，生成 exe + _internal 文件夹结构

## 从 Release 下载（推荐）

如果您不想自行编译，可以直接从 GitHub Release 页面下载：

1. 访问项目的 [Releases 页面](https://github.com/1145141919810TONNY/webgalgameengine/releases)
2. 下载最新版本的压缩包（通常命名为 `Shiori engine python exe VX.X.X.zip`）
3. 解压到任意位置
4. 确保 `shiori engine` 文件夹与 `Shiori.exe` 同级
5. 双击 `Shiori.exe` 运行

**下载内容包含：**
- `Shiori.exe` - 主程序
- `_internal/` - 依赖库文件夹
- （注意：`shiori engine` 文件夹需要单独准备或从源码中获取）

---

## 自行编译

### 1. 编译程序

双击运行 `build_fix.bat` 即可开始编译。

```bash
cd Shiori
.\build_fix.bat
```

**首次编译说明：**
- `build_fix.bat` 会自动检测并安装缺失的依赖（PyQt6、PyQt6-WebEngine、OpenCV、PyInstaller）
- 首次编译需要下载依赖，耗时约 5-10 分钟（取决于网络速度）
- 后续编译只需 1-2 分钟
- **自动检测流程**：
  1. 检查 Python 是否安装（需要 3.10+）
  2. 检测 PyQt6 是否已安装，如未安装则自动执行 `pip install pyqt6 pyqt6-webengine pyinstaller opencv-python`
  3. 检测 PyQt6-WebEngine 是否可用
  4. 检测 OpenCV (cv2) 是否可用（用于视频解码）
  5. 清理旧的 build/dist 文件夹
  6. 使用 PyInstaller 进行多文件打包

**编译输出：**
编译完成后，会在 `Shiori/dist/Shiori/` 目录生成以下结构：
```
dist/Shiori/
├── Shiori.exe              # 主程序
├── Shiori_debug.exe        # 主程序（调试版）
└── _internal/              # 依赖库文件夹
    ├── PyQt6/
    ├── python3xx.dll
    └── ...（其他依赖文件）
```


---

## 打包模式：多文件打包

当前项目使用**多文件打包模式**（`onedir`），生成 exe 文件和 `_internal` 依赖文件夹。

**优点：**
- 启动速度快：无需解压到临时目录
- 不占用临时空间
- 便于调试和查看依赖
- 体积相对较小（exe 本身只有 10-20MB）

**缺点：**
- 部署时需要保持文件夹结构完整
- 必须同时复制 exe 和 `_internal` 文件夹
- 文件数量较多

---

## 依赖说明

### 核心依赖

| 依赖项 | 最低版本 | 说明 |
|--------|---------|------|
| Python | 3.10.0+ | 必须安装 Python 运行时 |
| PyQt6 | 6.5.0+ | GUI 框架 |
| PyQt6-WebEngine | 最新 | 内置 Chromium 浏览器引擎 |
| PyInstaller | 6.0.0+ | Python 打包工具 |

### 自动检测与安装

`build_fix.bat` 脚本会自动执行以下操作：
1. 检测 Python 是否安装
2. 检查 PyQt6 和 PyQt6-WebEngine 是否已安装
3. 如果缺少依赖，自动使用 pip 安装
4. 验证安装是否成功

**无需手动安装依赖！** 只需确保已安装 Python 3.10+ 即可。

---

## 部署说明

### 编译后的文件位置

编译完成后，可执行文件位于：
- `Shiori/dist/Shiori/Shiori.exe` + `_internal/` - 标准版
- `Shiori/dist/Shiori_debug/Shiori_debug.exe` + `_internal/` - 调试版

**注意：** 必须同时复制 exe 文件和 `_internal` 文件夹，缺一不可！

### 运行要求

**必须确保以下目录结构：**

```
项目根目录/
├── Shiori.exe                   # 从 dist/Shiori/ 复制出来
├── _internal/                   # 从 dist/Shiori/ 复制出来（必须同级）
└── shiori engine/               # 引擎文件夹
    ├── index.html
    └── ...
```

**重要提示：**
- `Shiori.exe` 和 `_internal` 文件夹必须在同一目录下
- `shiori engine` 文件夹必须与 exe 同级，且**不能**被打包进 exe
- 用户可以随时修改 `shiori engine` 中的内容，无需重新编译
- **部署时必须复制整个 `dist/Shiori/` 文件夹，或分别复制 exe 和 `_internal`**

---

## 版本迁移说明

### 技术栈迁移

本项目使用 Python (PyQt6 + QtWebEngine) 技术栈：

| 项目 | 技术选型 |
|------|----------|
| 编程语言 | Python |
| GUI 框架 | PyQt6 |
| 浏览器引擎 | QtWebEngine（内置 Chromium） |
| 打包工具 | PyInstaller |

---

## 常见问题

### Q: 我应该下载 Release 还是自行编译？

**A:** 
- **普通用户**：推荐从 Release 下载，简单快捷，无需安装 Python
- **开发者/定制需求**：可以自行编译，方便修改源代码

### Q: Release 版本在哪里下载？

**A:** 访问项目的 GitHub 页面，点击右侧的 "Releases" 链接，下载最新版本的压缩包。

### Q: 编译后为什么有 _internal 文件夹？

**A:** 这是多文件打包模式的正常结构。`_internal` 文件夹包含所有 Python 和 Qt 依赖库，必须与 exe 一起部署。

### Q: 首次启动为什么很快？

**A:** 多文件模式下，依赖已经在 `_internal` 文件夹中，无需解压，启动速度比单文件模式快很多。

### Q: 如何修改游戏内容？

**A:** 直接修改 `shiori engine` 文件夹中的文件即可：
- 修改 HTML 场景：编辑 `scenes/*.html`
- 替换图片：覆盖 `assets/bg/`、`assets/cg/` 等
- 添加音频：放入 `assets/bgm/`、`assets/audio/`

**无需重新编译 exe！**

### Q: 版权信息在哪里查看？

**A:** 
1. 右键 `Shiori.exe` → 属性 → 详细信息
2. 或在程序中点击"帮助" → "关于"

提示：你可以根据需要修改你想要的内容，当然如果能保留原本的版权信息就更好了！

### Q: 调试版和标准版有什么区别？

| 特性 | 标准版 | 调试版 |
|------|--------|--------|
| 控制台窗口 | 无 | 有 |
| 调试日志 | 不输出 | 输出到控制台 |
| 开发者工具 | F12 可用 | F12 可用 |
| 文件夹大小 | 约 200MB | 约 200MB |

**建议使用：**
- 发布给用户：标准版（`dist/Shiori/Shiori.exe` + `_internal` 文件夹）
- 开发调试：调试版（`dist/Shiori_debug/Shiori_debug.exe` + `_internal` 文件夹）

---

## 技术信息

### 版本信息

- **启动器:** V1.1.3
- **引擎核心:** V2.0.3
- **Python 最低版本:** 3.10.0
- **PyQt6 最低版本:** 6.5.0

### 版权信息

- **作者:** bilibili @月が綺麗ですね_
- **版权:** Copyright © bilibili @月が綺麗ですね_ 2026
- **描述:** Shiori 引擎启动器

---

## 下一步操作

### 方式一：使用 Release 版本（推荐）

1. 从 GitHub Release 页面下载最新版本
2. 解压到任意位置
3. 确保 `shiori engine` 文件夹与 exe 同级
4. 双击 `Shiori.exe` 启动程序
5. 享受游戏！

### 方式二：自行编译

1. 双击 `build_fix.bat` 编译程序
2. 从 `dist/Shiori/` 文件夹复制所有内容（包括 exe 和 _internal）到合适的位置
3. 确保 `shiori engine` 文件夹与 exe 同级
4. 双击 `Shiori.exe` 启动程序
5. 享受游戏！

---

