# Shiori

这是一个基于HTML/JS的视觉小说引擎，具有类似Kirikiri的功能。

在scenes文件夹中，scenes0.html是一个空白模板，在scenes文件夹中，charsnew.html是一个包含新旧立绘的新版测试文件

高级版立绘系统更推荐想认真做，做大型游戏的用户使用，优点是可以大量节省美术资源，缺点是配置难度较大/基础立绘系统更推荐做着玩的，做小型游戏的用户使用，优点是配置简单易上手

如果要使用本模板，请根据license.txt中的指引进行修改本项目

本引擎的教学网页：[https://1145141919810tonny.github.io/Shioriteaching/](https://1145141919810tonny.github.io/Shioriteaching/)

本引擎的一键式管理器：[https://github.com/1145141919810TONNY/Shiori-manager](https://github.com/1145141919810TONNY/Shiori-manager)

本引擎专用可视化编辑器链接：[https://github.com/1145141919810TONNY/Shiori-editor](https://github.com/1145141919810TONNY/Shiori-editor)

本引擎的插件仓库：[https://github.com/1145141919810TONNY/ShioriPlugin](https://github.com/1145141919810TONNY/ShioriPlugin)

如果你在编译启动器时因网络问题编译失败时，可以前往release下载`离线编译依赖补丁`补丁包进行编译，


# Shiori 命名缘起

“Shiori”（栞），在日语中意为“书签”。

在浩瀚的文字海洋中，书签是静默的守护者。它标记着我们曾驻足的风景，珍藏着那些触动心灵的瞬间，并为下一次的相遇留下清晰的指引。

我将这款视觉小说引擎命名为“Shiori”，正是希望它能成为创作者与玩家手中那枚精致的书签：

- **标记进度**：如同书签夹入书页，Shiori 帮助开发者精准记录故事的每一个分支与节点，让复杂的叙事逻辑井井有条。
- **珍藏瞬间**：它承载着精美的立绘、动人的音乐与深刻的对白，将那些稍纵即逝的美好定格为永恒的记忆。
- **指引创作**：在创作的旅途中，Shiori 提供稳定而灵活的框架，如同书签引导读者重返心爱章节，助力创作者从容地构建属于自己的世界。

愿 Shiori 伴随每一位创作者，在视觉小说的篇章中，留下独一无二的标记。

**本readme文档不再存放更新日志，详细的更新日志请前往教学网站查看；由于引擎的内容已经变的非常的多，md文件也不再满足需求，因此详细的教学内容也请到教学网页中查看**

## 目录结构

```
project/
├── Shiori/                               # 启动器本体 (WPF, net8.0-windows)
│   ├── ShioriC#.csproj                   # 工程文件，引用关系都定义在这里
│   ├── *.cs / *.xaml                     # 31 个源码文件 (27 个 .cs + 4 个 .xaml)
│   ├── ico/                              # 5 个图标 (16/32/64/128/256)
│   ├── build_csharp.bat                  # 一键编译脚本
│   └── 缺失依赖.txt                       # 离线 NuGet 包清单
├── ScriptingCore/                        # DSL 编译核心 (netstandard2.1 类库)
├── SHA256Tool/Shared/EmbeddedKeyCodec.cs # 密钥载荷的混淆编解码
├── license.txt
└── .gitignore
```

## 三者的关系

```
Shiori/ShioriC#.csproj
├── ProjectReference ──> ScriptingCore/ScriptingCore.csproj
└── Compile Include ───> SHA256Tool/Shared/EmbeddedKeyCodec.cs
```

| 部件 | 角色 | 被谁用 | 引用方式 |
|---|---|---|---|
| `Shiori/` | 启动器本体，负责起 HTTP 服务、托管网页、加载插件 | 直接编译为 `Shiori.exe` | 根工程 |
| `ScriptingCore/` | 把 .ks / DSL 剧本编译成运行时 JSON 的共享类库 | `Shiori` | `ProjectReference` |
| `SHA256Tool/Shared/EmbeddedKeyCodec.cs` | 内嵌密钥载荷的混淆解码（SplitMix64） | `Shiori` | `Compile Include` |

两种引用的差别：`ProjectReference` 是工程级引用，`ScriptingCore` 会先编译成 `ScriptingCore.dll` 再被引用；`Compile Include` 是源码级引用，那个 `.cs` 被当成 `Shiori` 自己的一个文件，一起编进 `Shiori.exe`。这是为了让发布器、原生内核与启动器共用同一份源码。

## 层级不能随手改

两个引用都是相对 `Shiori/` 的路径，向上找一层：

```
..\ScriptingCore\ScriptingCore.csproj
..\SHA256Tool\Shared\EmbeddedKeyCodec.cs
```

所以 `ScriptingCore/` 与 `SHA256Tool/` 必须与 `Shiori/` **同级**，且目录名不能改（改了就要同步改 csproj，否则报 CS2001 找不到源文件）。`ScriptingCore` 自身没有任何外部路径引用，随手放哪都行；有约束的只有上面这两条。


## 怎么编译

需要 .NET 8 SDK。在 `Shiori/` 目录下执行：

```
build_csharp.bat
```

脚本先还原 NuGet 包（本地 `nupkg/` 齐全时完全离线），再依次发布 Release 与 Debug 两个版本，产物在 `Shiori/dist/`，并自动清掉 `ico/`、`*.pdb` 等多余文件。

注意：编译出的 exe 要跑起来，还需要同级放一份引擎网页目录 `shiori engine/`，否则只有窗口没有内容。

程序底层框架：月が綺麗ですね_
https://space.bilibili.com/87412647?spm_id_from=333.1007.0.0














