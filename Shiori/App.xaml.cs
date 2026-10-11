// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// Shiori 启动器 — WPF 应用程序入口。
// 负责应用级生命周期设置，当前主要工作是确定主窗口的关闭语义，
// 保证关闭主窗口时整个进程退出，而不会被仍存活的辅助窗口阻止。
// 该文件不参与渲染/引擎逻辑，仅承担启动阶段的全局配置。

using System.Windows;

namespace ShioriCSharp
{
    /// <summary>
    /// WPF 应用对象（由 App.xaml 的 x:Class 关联）。
    /// 承载启动、退出等应用级生命周期事件，并作为全局资源与退出策略的挂载点。
    /// </summary>
    public partial class App : Application
    {
        /// <summary>
        /// 应用启动回调。调用基类实现后，将关闭模式设置为「主窗口关闭即退出」。
        /// </summary>
        /// <param name="e">启动事件参数，包含命令行参数等信息（此处未使用）。</param>
        /// <remarks>
        /// 副作用：修改 <see cref="Application.ShutdownMode"/> 为
        /// <see cref="ShutdownMode.OnMainWindowClose"/>，从而改变进程的退出时机。
        /// 之所以显式设置，是因为默认的 OnLastWindowClose 会在
        /// CharPreviewWindow 等子窗口仍存活时导致进程无法退出。
        /// </remarks>
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            // 主窗口关闭时强制退出应用，避免子窗口（如 CharPreviewWindow）阻止退出
            ShutdownMode = ShutdownMode.OnMainWindowClose;
        }
    }
}
