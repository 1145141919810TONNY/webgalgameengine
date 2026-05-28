using System;
using System.IO;
using System.Net;
using System.Threading.Tasks;

namespace ShioriCSharp
{
    public class HttpServer
    {
        private readonly string _rootDir;
        private readonly HttpListener _listener;
        private readonly bool _isDebug;

        public HttpServer(string rootDir, int port = 8080, bool isDebug = false)
        {
            _rootDir = rootDir;
            _isDebug = isDebug;
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://localhost:{port}/");
        }

        public void Start()
        {
            _listener.Start();
            Task.Run(() => ListenAsync());
            if (_isDebug) Console.WriteLine($"[INFO] HTTP Server started on port {_listener.Prefixes}");
        }

        public void Stop()
        {
            _listener.Stop();
            _listener.Close();
        }

        private async Task ListenAsync()
        {
            while (_listener.IsListening)
            {
                try
                {
                    var context = await _listener.GetContextAsync();
                    _ = Task.Run(() => ProcessRequest(context));
                }
                catch (Exception ex)
                {
                    if (_isDebug) Console.WriteLine($"[ERROR] Listener error: {ex.Message}");
                }
            }
        }

        private async Task ProcessRequest(HttpListenerContext context)
        {
            var request = context.Request;
            var response = context.Response;

            try
            {
                // 先 URL 解码，再 TrimStart('/')  
                var path = request.Url?.AbsolutePath ?? "/index.html";
                path = Uri.UnescapeDataString(path);  // 先解码（使用 Uri.UnescapeDataString 更可靠）
                path = path.TrimStart('/');  // 再移除开头的 /
                
                // 调试：打印路径信息
                if (_isDebug)
                {
                    Console.WriteLine($"[DEBUG] Raw URL: {request.Url}");
                    Console.WriteLine($"[DEBUG] AbsolutePath (before decode): {request.Url?.AbsolutePath}");
                    Console.WriteLine($"[DEBUG] Decoded path: {path}");
                }

                // 检查是否为 API 请求
                if (path.StartsWith("api/"))
                {
                    await HandleApiRequest(context);
                    return;
                }

                var filePath = Path.GetFullPath(Path.Combine(_rootDir, path));
                
                // 安全校验：防止路径遍历攻击，确保文件在 _rootDir 下
                var normalizedRoot = Path.GetFullPath(_rootDir);
                if (!filePath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
                {
                    if (_isDebug) Console.WriteLine($"[DEBUG] 403 Forbidden (path traversal): {filePath}");
                    response.StatusCode = 403;
                    return;
                }

                // 调试：打印最终文件路径
                if (_isDebug)
                {
                    Console.WriteLine($"[DEBUG] RootDir: {normalizedRoot}");
                    Console.WriteLine($"[DEBUG] FilePath: {filePath}");
                    Console.WriteLine($"[DEBUG] File exists: {File.Exists(filePath)}");
                }

                if (!File.Exists(filePath))
                {
                    if (_isDebug) Console.WriteLine($"[DEBUG] 404: File not found: {filePath}");
                    response.StatusCode = 404;
                    return;
                }

                var fileInfo = new FileInfo(filePath);
                var rangeHeader = request.Headers["Range"];
                var isVideo = IsVideoFile(filePath);

                if (rangeHeader != null && isVideo)
                {
                    await HandleRangeRequest(response, filePath, fileInfo.Length, rangeHeader);
                }
                else
                {
                    await HandleNormalRequest(response, filePath, fileInfo.Length);
                }
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine($"[ERROR] Request processing error: {ex.Message}");
                response.StatusCode = 500;
            }
            finally
            {
                response.Close();
            }
        }

        private async Task HandleRangeRequest(HttpListenerResponse response, string filePath, long fileSize, string rangeHeader)
        {
            var parts = rangeHeader.Replace("bytes=", "").Split('-');
            long start = long.Parse(parts[0]);
            long end = parts.Length > 1 && !string.IsNullOrEmpty(parts[1]) ? long.Parse(parts[1]) : fileSize - 1;

            if (start >= fileSize || end < start)
            {
                response.StatusCode = 416;
                return;
            }

            long contentLength = end - start + 1;
            response.StatusCode = 206;
            response.ContentType = GetContentType(filePath);
            response.Headers.Add("Content-Range", $"bytes {start}-{end}/{fileSize}");
            response.ContentLength64 = contentLength;
            response.Headers.Add("Accept-Ranges", "bytes");

            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                fs.Seek(start, SeekOrigin.Begin);
                var buffer = new byte[8192];
                long remaining = contentLength;
                int bytesRead;

                while (remaining > 0 && (bytesRead = await fs.ReadAsync(buffer, 0, (int)Math.Min(buffer.Length, remaining))) > 0)
                {
                    await response.OutputStream.WriteAsync(buffer, 0, bytesRead);
                    remaining -= bytesRead;
                }
            }
        }

        private async Task HandleNormalRequest(HttpListenerResponse response, string filePath, long fileSize)
        {
            response.StatusCode = 200;
            response.ContentType = GetContentType(filePath);
            response.ContentLength64 = fileSize;
            response.Headers.Add("Accept-Ranges", "bytes");

            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                await fs.CopyToAsync(response.OutputStream);
            }
        }

        private string GetContentType(string filePath)
        {
            var ext = Path.GetExtension(filePath).ToLower();
            return ext switch
            {
                ".html" => "text/html",
                ".css" => "text/css",
                ".js" => "application/javascript",
                ".png" => "image/png",
                ".jpg" => "image/jpeg",
                ".mp4" => "video/mp4",
                ".webm" => "video/webm",
                _ => "application/octet-stream"
            };
        }

        private bool IsVideoFile(string filePath)
        {
            var ext = Path.GetExtension(filePath).ToLower();
            return ext is ".mp4" or ".webm" or ".ogg" or ".mov";
        }

        /// <summary>
        /// 处理 API 请求
        /// </summary>
        private async Task HandleApiRequest(HttpListenerContext context)
        {
            var request = context.Request;
            var response = context.Response;
            var path = request.Url?.AbsolutePath.TrimStart('/');

            try
            {
                if (path == "api/chars/scan")
                {
                    await HandleScanCharsRequest(response);
                }
                else
                {
                    response.StatusCode = 404;
                    response.StatusDescription = "API endpoint not found";
                }
            }
            catch (Exception ex)
            {
                if (_isDebug) Console.WriteLine($"[ERROR] API request error: {ex.Message}");
                response.StatusCode = 500;
                response.StatusDescription = "Internal Server Error";
            }
            finally
            {
                response.Close();
            }
        }

        /// <summary>
        /// 处理角色文件扫描请求
        /// 扫描 assets/chars/ 文件夹，返回文件ID到路径的映射
        /// </summary>
        private async Task HandleScanCharsRequest(HttpListenerResponse response)
        {
            var charFileMap = new Dictionary<string, string>();
            var charPathMap = new Dictionary<string, string>();

            // 扫描 chars 文件夹
            var charsDir = Path.Combine(_rootDir, "assets", "chars");
            if (Directory.Exists(charsDir))
            {
                // 获取所有角色子文件夹
                foreach (var roleDir in Directory.GetDirectories(charsDir))
                {
                    var roleName = Path.GetFileName(roleDir);
                    charPathMap[roleName] = $"assets/chars/{roleName}";

                    // 递归扫描所有图片文件
                    var imageFiles = Directory.GetFiles(roleDir, "*.*", SearchOption.AllDirectories)
                        .Where(f => 
                        {
                            var ext = Path.GetExtension(f).ToLower();
                            return ext is ".png" or ".jpg" or ".jpeg" or ".webp";
                        });

                    foreach (var file in imageFiles)
                    {
                        // 获取相对路径（相对于 _rootDir）
                        var relativePath = file.Substring(_rootDir.Length + 1).Replace('\\', '/');
                        
                        // 生成文件ID：去掉扩展名，保留子路径（用 _ 连接）
                        // 例如：assets/chars/角色A/miyu01/dress1.png → 角色A_miyu01_dress1
                        var fileId = GenerateFileId(roleName, file, roleDir);
                        
                        charFileMap[fileId] = relativePath;
                        
                        // 同时注册裸文件名（不带角色前缀），方便 illustration.js 直接用文件名引用
                        var bareName = Path.GetFileNameWithoutExtension(file);
                        if (!charFileMap.ContainsKey(bareName))
                            charFileMap[bareName] = relativePath;
                    }
                }
            }

            // 构建响应
            var result = new
            {
                success = true,
                charPathMap,
                charFileMap
            };

            var json = System.Text.Json.JsonSerializer.Serialize(result);
            var buffer = System.Text.Encoding.UTF8.GetBytes(json);

            response.StatusCode = 200;
            response.ContentType = "application/json";
            response.ContentLength64 = buffer.Length;

            await response.OutputStream.WriteAsync(buffer, 0, buffer.Length);

            if (_isDebug) Console.WriteLine($"[INFO] Scanned {charFileMap.Count} character files");
        }





        
        /// <summary>
        /// 生成文件ID
        /// 格式：角色名_子路径_文件名（不含扩展名）
        /// </summary>
        private string GenerateFileId(string roleName, string filePath, string roleDir)
        {
            // 获取相对于角色文件夹的路径
            var relativePath = filePath.Substring(roleDir.Length + 1);
            var fileName = Path.GetFileNameWithoutExtension(relativePath);
            var directoryPath = Path.GetDirectoryName(relativePath);

            // 组合ID：角色名_子文件夹_文件名
            if (string.IsNullOrEmpty(directoryPath))
            {
                return $"{roleName}_{fileName}";
            }
            else
            {
                // 将子文件夹路径中的分隔符替换为 _
                var dirPart = directoryPath.Replace('\\', '_').Replace('/', '_');
                return $"{roleName}_{dirPart}_{fileName}";
            }
        }
    }
}
