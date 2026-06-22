/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * Shiori 启动器 — 应用程序入口
 * 负责初始化、异常处理及全局资源管理
 */

using System.Windows;

namespace ShioriCSharp
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            // 主窗口关闭时强制退出应用，避免子窗口（如 CharPreviewWindow）阻止退出
            ShutdownMode = ShutdownMode.OnMainWindowClose;
        }
    }
}
