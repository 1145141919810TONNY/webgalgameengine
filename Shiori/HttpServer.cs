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
                var path = request.Url?.AbsolutePath.TrimStart('/') ?? "index.html";
                var filePath = Path.Combine(_rootDir, path);

                if (!File.Exists(filePath))
                {
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
    }
}
