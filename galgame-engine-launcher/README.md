# Galgame 引擎启动器

一个独立的 Windows 程序，用于启动 Galgame 游戏引擎，无需 Python 或 Node.js 环境。

## 特性

- **完全独立** - 无需安装Python、Node.js 或任何其他运行时
- **单文件发布** - 所有依赖打包在一个 exe 中（约 60MB）
- **自动启动** - 自动启动 HTTP 服务器并打开浏览器
- **插件支持** - 支持 `plugin` 文件夹放置 DLL 动态链接库
- **零配置** - 开箱即用，无需手动配置

---

## 编译环境要求

### 必需：
- **Visual Studio 2022**（任意版本，包括免费的 Community 版）
  - 下载地址：https://visualstudio.microsoft.com/zh-hans/downloads/
  
- **.NET 6 SDK**
  - Visual Studio 2022 安装时会自动包含
  - 或单独下载：https://dotnet.microsoft.com/zh-cn/download/dotnet/6.0

---

## 快速开始

### 方法一：一键编译（推荐）

1. **双击运行** `build_and_deploy.bat`
2. **等待编译完成**（约 2-3 分钟）
3. **完成！** exe 已自动生成到 `galgame-engine` 目录

### 方法二：使用 Visual Studio

1. **双击打开** `GalgameLauncher.csproj`
2. **选择 Release 模式**（顶部工具栏）
3. **右键项目 → 发布**
4. **点击"完成" → 再次点击"发布"**
5. **找到生成的 exe**：
   ```
   bin\Release\net6.0-windows\win-x64\publish\GalgameLauncher.exe
   ```
6. **复制到** `galgame-engine` 目录

---

## 部署说明

### 文件结构

```
galgame-engine/
├── GalgameLauncher.exe        ← 启动器（编译生成）
├── index.html                 ← 主页面
├── style.css
├── engine.js
├── plugin/                    ← DLL 插件目录（可选）
│   └── (放置 DLL 文件)
└── ...其他游戏文件
```

### 使用方法

1. **将 `GalgameLauncher.exe` 放在 `galgame-engine` 目录**（与 index.html 同级）
2. **双击运行** `GalgameLauncher.exe`
3. **程序自动**：
   - 启动 HTTP 服务器（端口 8080）
   - 打开默认浏览器访问游戏页面
4. **保持黑色命令行窗口开启**以维持服务器运行
5. **需要停止时**，关闭窗口或按 Ctrl+C

---

## 自定义配置

### 修改端口号

编辑 `Program.cs` 第 15 行：

```csharp
private static readonly int PORT = 8080; // 改为你想要的端口
```

### 添加更多 MIME 类型

编辑 `Program.cs` 第 22-43 行的 `MimeTypes` 字典：

```csharp
private static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
{
    { ".html", "text/html" },
    { ".css", "text/css" },
    { ".js", "application/javascript" },
    // 添加更多类型...
};
```

### 修改应用程序信息

编辑 `GalgameLauncher.csproj` 第 16-29 行：

```xml
<!-- 应用程序信息 -->
<AssemblyName>GalgameLauncher</AssemblyName>
<RootNamespace>GalgameLauncher</RootNamespace>
<Version>1.0.0</Version>              <!-- 版本号 -->
<Authors>bilibili @月が綺麗ですね_</Authors>  <!-- 作者 -->
<Product>Galgame Engine Launcher</Product>
<Description>Galgame 引擎启动器 - 无需 Python/Node.js 环境</Description>
<Copyright>bilibili @月が綺麗ですね_</Copyright>
<Company>bilibili @月が綺麗ですね_</Company>

<!-- 文件属性 -->
<AssemblyTitle>Galgame 引擎启动器</AssemblyTitle>
<AssemblyProduct>Galgame Engine Launcher</AssemblyProduct>
<AssemblyCopyright>Copyright © bilibili @月が綺麗ですね_ 2026</AssemblyCopyright>
<AssemblyTrademark>bilibili @月が綺麗ですね_</AssemblyTrademark>
```

**编译后查看属性：**
- 右键点击生成的 exe → 属性 → 详细信息
- 可以看到版权、公司、产品等信息

---

## 技术原理

### HTTP 服务器实现

使用 .NET Framework 内置的 `HttpListener` 类实现简单的 HTTP 服务器：

```csharp
_listener = new HttpListener();
_listener.Prefixes.Add($"http://localhost:{PORT}/");
_listener.Start();
```

### 工作流程

1. **初始化** - 获取 exe 所在目录作为工作目录
2. **检测文件** - 检查 `index.html` 是否存在
3. **启动服务器** - 监听指定端口的 HTTP 请求
4. **处理请求** - 解析 URL 路径，返回对应文件
5. **打开浏览器** - 自动启动默认浏览器访问游戏页面

### 为什么选择完全独立模式？

| 模式 | 文件大小 | 依赖 | 适用场景 |
|------|---------|------|---------|
| **SelfContained=true** | ~60 MB | 无 | 分发给用户（推荐） |
| SelfContained=false | ~5 MB | 需.NET 6 Runtime | 开发测试 |

**配置位置：** `GalgameLauncher.csproj` 第 11-12 行

```xml
<PublishSingleFile>true</PublishSingleFile>
<SelfContained>true</SelfContained>
```

---

## 高级选项

### 方案 A：减小文件大小（需要运行时）

如果你希望减小 exe 大小，可以修改为框架依赖模式：

编辑 `GalgameLauncher.csproj` 第 12 行：

```xml
<SelfContained>false</SelfContained>
```

重新编译后，exe 大小约 **5MB**，但需要系统安装 .NET 6 Runtime。

### 方案 B：启用压缩（减小体积）

编辑 `GalgameLauncher.csproj` 第 13 行：

```xml
<EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
```

可以进一步减小 exe 大小，但启动时会稍慢一些（需要解压）。

---

## 常见问题

### Q: 编译时提示找不到 .NET SDK？

**A:** 确保已正确安装 .NET 6 SDK，重启 Visual Studio 后再试。

### Q: 运行时提示找不到 DLL？

**A:** 使用 `SelfContained=true` 模式编译，所有依赖都会打包到 exe 中。

### Q: 端口 8080 被占用？

**A:** 修改 `Program.cs` 第 15 行的 `PORT` 值，或关闭占用端口的程序。

### Q: 杀毒软件报毒？

**A:** 这是误报。添加到白名单即可，或使用代码签名证书签名。

### Q: 如何查看编译后的 exe 属性？

**A:** 右键 exe → 属性 → 详细信息，可以看到：
- 版权：bilibili @月が綺麗ですね_
- 产品名称：Galgame Engine Launcher
- 文件描述：Galgame 引擎启动器 - 无需 Python/Node.js 环境

---

## 更新日志

**v1.0.1 (2026-03-03)**
- 初始版本发布
- 支持 HTTP 服务器功能
- 支持自动打开浏览器
- 支持 plugin 插件目录
- 完全独立，无需任何运行时
- 添加完整的版权信息

---

## 技术支持

- **作者**: bilibili @月が綺麗ですね_
- **B 站主页**: https://space.bilibili.com/87412647

---

## 许可证

详情参考项目的license.txt

**版权所有** © bilibili @月が綺麗ですね_ 2026

---

**最后更新**: 2026 年 3 月 3 日  
**版本**: v1.0.1


