/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * Shiori 启动器 — 视频桥接服务
 * 基于 OpenCV 实现 WebView2 与视频帧数据的采集与传递
 */

using System;
using System.IO;
using System.Text.Json;
using OpenCvSharp;

namespace ShioriCSharp
{
    public class VideoBridge
    {
        private readonly string _appDir;
        private VideoCapture? _cap;
        private bool _isDebug;

        public VideoBridge(string appDir, bool isDebug = false)
        {
            _appDir = appDir;
            _isDebug = isDebug;
        }

        public string LoadVideo(string videoFileName)
        {
            try
            {
                // _appDir 现在是 engine 目录（由 MainWindow 传入）
                var videoPath = Path.Combine(_appDir, "assets", "video", videoFileName);
                
                if (!File.Exists(videoPath))
                {
                    // 尝试添加扩展名
                    var webmPath = videoPath + ".webm";
                    var mp4Path = videoPath + ".mp4";
                    
                    if (File.Exists(webmPath)) videoPath = webmPath;
                    else if (File.Exists(mp4Path)) videoPath = mp4Path;
                    else return JsonSerializer.Serialize(new { success = false, error = "视频文件不存在" });
                }

                _cap = new VideoCapture(videoPath);
                if (!_cap.IsOpened())
                {
                    return JsonSerializer.Serialize(new { success = false, error = "无法打开视频文件" });
                }

                var fps = _cap.Fps;
                var totalFrames = (int)_cap.FrameCount;
                var width = (int)_cap.FrameWidth;
                var height = (int)_cap.FrameHeight;

                return JsonSerializer.Serialize(new 
                { 
                    success = true, 
                    fps, 
                    totalFrames, 
                    width, 
                    height,
                    duration = totalFrames / fps
                });
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { success = false, error = ex.Message });
            }
        }

        public string GetNextFrame()
        {
            if (_cap == null || !_cap.IsOpened())
                return JsonSerializer.Serialize(new { success = false, error = "视频未加载" });

            using var frame = new Mat();
            if (!_cap.Read(frame) || frame.Empty())
            {
                return JsonSerializer.Serialize(new { success = false, end = true });
            }

            // BGR to RGB
            Cv2.CvtColor(frame, frame, ColorConversionCodes.BGR2RGB);
            
            // Encode to PNG Base64
            var buffer = frame.ImEncode(".png", new int[] { (int)ImwriteFlags.PngCompression, 1 });
            var base64 = Convert.ToBase64String(buffer);

            return JsonSerializer.Serialize(new 
            { 
                success = true, 
                frame = $"data:image/png;base64,{base64}" 
            });
        }

        public void CloseVideo()
        {
            _cap?.Release();
            _cap?.Dispose();
            _cap = null;
        }
    }
}
