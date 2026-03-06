# 图标文件夹占位文件

## 使用说明

1. **创建 icon 文件夹**
   在 `galgame-engine/` 目录下创建名为 `icon` 的文件夹

2. **放入图标文件**
   将你的图标图片放入此文件夹，支持以下格式：
   - `icon-32.png`

3. **重启程序**
   重新启动 GalgameLauncher.exe，图标会自动应用

## 注意事项

- 图标文件夹必须命名为 `icon-32.png`（全小写，默认名可到html中修改）
- 推荐使用 PNG 格式，支持透明背景
- 修改图标后需要重启程序才能生效
- 浏览器可能缓存 favicon，按 Ctrl+F5 强制刷新

## 示例目录结构

```
galgame-engine/
├── icon/
│   └── icon-32.png 
├── index.html
├── GalgameLauncher.exe
└── ...
```

---
此文件仅用于占位，实际使用时请删除此文件并放入真实的图标图片。
