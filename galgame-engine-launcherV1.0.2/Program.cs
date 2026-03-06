using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace GalgameLauncher
{
    class Program
    {
        // HTTP 服务器端口号
        private static readonly int PORT = 8080;
        
        // HttpListener 用于创建简单的 HTTP 服务器
        private static HttpListener _listener;
        private static CancellationTokenSource _cts;
        
        // MIME 类型映射
        private static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html" },
            { ".htm", "text/html" },
            { ".css", "text/css" },
            { ".js", "application/javascript" },
            { ".json", "application/json" },
            { ".png", "image/png" },
            { ".jpg", "image/jpeg" },
            { ".jpeg", "image/jpeg" },
            { ".gif", "image/gif" },
            { ".svg", "image/svg+xml" },
            { ".ico", "image/x-icon" },
            { ".ogg", "audio/ogg" },
            { ".mp3", "audio/mpeg" },
            { ".wav", "audio/wav" },
            { ".mp4", "video/mp4" },
            { ".webm", "video/webm" },
            { ".txt", "text/plain" },
            { ".xml", "application/xml" },
            { ".pdf", "application/pdf" }
        };

        static async Task Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = Encoding.UTF8;
                Console.InputEncoding = Encoding.UTF8;
                
                // 防止窗口立即关闭
                Console.TreatControlCAsInput = true;
                
                Console.WriteLine("=====================================");
                Console.WriteLine("  Galgame 引擎启动器 v1.0.2");
                Console.WriteLine("=====================================");
                Console.WriteLine();

                // 获取当前目录（exe 所在目录）
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                Console.WriteLine($"[信息] 程序目录：{baseDir}");
                Console.WriteLine($"[信息] .NET 版本：{Environment.Version}");
                Console.WriteLine();

                // 检测 index.html 是否存在
                string indexPath = Path.Combine(baseDir, "index.html");
                if (!File.Exists(indexPath))
                {
                    Console.WriteLine($"[错误] 未找到 index.html 文件");
                    Console.WriteLine($"请在 {indexPath} 放置 index.html 文件");
                    Console.WriteLine();
                    Console.WriteLine("按任意键退出...");
                    Console.ReadKey();
                    return;
                }
                
                Console.WriteLine("[成功] 检测到 index.html");
                Console.WriteLine();

                Console.WriteLine("正在启动本地 HTTP 服务器...");
                Console.WriteLine($"服务器将在 http://localhost:{PORT} 上运行");
                Console.WriteLine();

                // 启动 HTTP 服务器
                _cts = new CancellationTokenSource();
                Task serverTask = StartHttpServerAsync(_cts.Token);

                // 等待服务器启动
                await Task.Delay(2000);

                // 打开浏览器访问游戏
                Console.WriteLine("正在启动浏览器并打开游戏...");
                string url = $"http://localhost:{PORT}/index.html";
                
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = url,
                        UseShellExecute = true
                    });
                    Console.WriteLine("[成功] 浏览器已启动");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[警告] 无法自动打开浏览器：{ex.Message}");
                    Console.WriteLine($"请手动访问：{url}");
                }

                Console.WriteLine();
                Console.WriteLine("=====================================");
                Console.WriteLine("  游戏已在浏览器中打开！");
                Console.WriteLine("  请保持此窗口开启以维持服务器运行");
                Console.WriteLine("  按 Ctrl+C 或关闭窗口停止服务器");
                Console.WriteLine("=====================================");
                Console.WriteLine();

                // 等待服务器任务完成或被取消
                await serverTask;
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine();
                Console.WriteLine("[信息] 服务器已正常停止。");
            }
            catch (Exception ex)
            {
                Console.WriteLine();
                Console.WriteLine($"[严重错误] {ex.GetType().Name}: {ex.Message}");
                Console.WriteLine();
                Console.WriteLine($"详细信息:");
                Console.WriteLine(ex.ToString());
                Console.WriteLine();
                // 保持窗口打开以便截图，但不等待按键
            }
            finally
            {
                // 清理资源
                if (_listener != null && _listener.IsListening)
                {
                    _listener.Stop();
                    _listener.Close();
                }
                _cts?.Dispose();
                
                // 只有在非异常情况下才显示结束提示
                if (Console.KeyAvailable == false)
                {
                    Console.WriteLine();
                    Console.WriteLine("程序结束。");
                }
            }
        }


        

        
        /// <summary>
        /// 异步启动 HTTP 服务器
        /// </summary>
        private static async Task StartHttpServerAsync(CancellationToken cancellationToken)
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://localhost:{PORT}/");
            _listener.Start();
            Console.WriteLine("HTTP 服务器已启动。");

            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    // 监听请求
                    var context = await _listener.GetContextAsync();
                    _ = ProcessRequestAsync(context, cancellationToken);
                }
                catch (HttpListenerException) when (cancellationToken.IsCancellationRequested)
                {
                    // 正常取消
                    break;
                }
                catch (ObjectDisposedException)
                {
                    // Listener 已关闭
                    break;
                }
            }
        }

        /// <summary>
        /// 处理单个 HTTP 请求
        /// </summary>
        private static async Task ProcessRequestAsync(HttpListenerContext context, CancellationToken cancellationToken)
        {
            var request = context.Request;
            var response = context.Response;

            try
            {
                // 解析请求路径
                string relativePath = request.Url.AbsolutePath.TrimStart('/');
                
                // URL 解码路径
                relativePath = Uri.UnescapeDataString(relativePath);

                // 构建文件完整路径
                string filePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, relativePath);

                // 安全检查：防止目录遍历攻击
                string fullPath = Path.GetFullPath(filePath);
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                if (!fullPath.StartsWith(baseDir, StringComparison.OrdinalIgnoreCase))
                {
                    // 非法路径访问
                    response.StatusCode = 403;
                    var errorBytes = Encoding.UTF8.GetBytes("403 Forbidden");
                    response.ContentLength64 = errorBytes.Length;
                    await response.OutputStream.WriteAsync(errorBytes, 0, errorBytes.Length, cancellationToken);
                    return;
                }

                // 检查文件是否存在
                if (!File.Exists(filePath))
                {
                    response.StatusCode = 404;
                    var errorBytes = Encoding.UTF8.GetBytes("404 Not Found");
                    response.ContentLength64 = errorBytes.Length;
                    await response.OutputStream.WriteAsync(errorBytes, 0, errorBytes.Length, cancellationToken);
                    return;
                }

                // 设置 Content-Type
                string extension = Path.GetExtension(filePath);
                if (MimeTypes.TryGetValue(extension, out string mimeType))
                {
                    response.ContentType = mimeType;
                }
                else
                {
                    response.ContentType = "application/octet-stream";
                }

                // 读取并发送文件
                byte[] fileBytes = await File.ReadAllBytesAsync(filePath, cancellationToken);
                response.ContentLength64 = fileBytes.Length;
                await response.OutputStream.WriteAsync(fileBytes, 0, fileBytes.Length, cancellationToken);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"处理请求时出错：{ex.Message}");
                response.StatusCode = 500;
                var errorBytes = Encoding.UTF8.GetBytes($"500 Internal Server Error: {ex.Message}");
                response.ContentLength64 = errorBytes.Length;
                await response.OutputStream.WriteAsync(errorBytes, 0, errorBytes.Length, cancellationToken);
            }
            finally
            {
                response.OutputStream.Close();
            }
        }
    }
}
