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
