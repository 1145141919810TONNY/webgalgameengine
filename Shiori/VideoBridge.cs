// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// Shiori 启动器 — 视频桥接服务。
// 基于 OpenCV (OpenCvSharp) 实现 WebView2 与视频帧数据的采集与传递：
// 加载视频后逐帧解码为 PNG Base64 Data URL 返回前端绘制。
// 所有方法均返回 JSON 字符串，异常被捕获并转为 error 字段，不向上抛出。

using System;
using System.IO;
using System.Text.Json;
using OpenCvSharp;

namespace ShioriCSharp
{
    /// <summary>
    /// 视频桥接：管理一个 OpenCV <see cref="VideoCapture"/> 会话，向 WebView2 前端逐帧供给视频画面。
    /// </summary>
    /// <remarks>
    /// 该类持有非托管视频解码资源，非线程安全：同一实例的调用应由单一调用方串行进行，
    /// 并在用完后调用 <see cref="CloseVideo"/> 释放。
    /// </remarks>
    public class VideoBridge
    {
        /// <summary>引擎目录（由 MainWindow 传入），视频资源位于其下的 assets/video 子目录。</summary>
        private readonly string _appDir;
        /// <summary>当前打开的视频捕获对象；未加载时为 null。</summary>
        private VideoCapture? _cap;
        /// <summary>是否处于调试模式（保留字段，当前逻辑未使用）。</summary>
        private bool _isDebug;

        /// <summary>
        /// 构造视频桥。
        /// </summary>
        /// <param name="appDir">引擎目录，用于拼装视频资源路径。</param>
        /// <param name="isDebug">是否调试模式，默认 false。</param>
        public VideoBridge(string appDir, bool isDebug = false)
        {
            _appDir = appDir;
            _isDebug = isDebug;
        }

        /// <summary>
        /// 加载指定视频并返回其元信息（帧率、总帧数、尺寸、时长）。
        /// </summary>
        /// <param name="videoFileName">相对 assets/video 的文件名，可省略扩展名。</param>
        /// <returns>
        /// JSON 字符串。成功时为 <c>{ success:true, fps, totalFrames, width, height, duration }</c>；
        /// 文件不存在或打开失败时为 <c>{ success:false, error:"..." }</c>。
        /// </returns>
        /// <remarks>
        /// 副作用：成功时替换并持有新的 <see cref="VideoCapture"/>（旧的不会被自动释放，
        /// 调用方应先 <see cref="CloseVideo"/>）。若未找到文件，会依次尝试补 .webm / .mp4 扩展名。
        /// </remarks>
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
                // 解码器缺失、文件损坏等统一以错误 JSON 返回，避免异常穿透到 UI
                return JsonSerializer.Serialize(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// 读取并返回下一帧，编码为 PNG 的 Base64 Data URL。
        /// </summary>
        /// <returns>
        /// JSON 字符串。成功时为 <c>{ success:true, frame:"data:image/png;base64,..." }</c>；
        /// 未加载视频时返回错误；已到视频末尾时返回 <c>{ success:false, end:true }</c>。
        /// </returns>
        /// <remarks>
        /// 处理流程：读取 BGR 帧 → 转换为 RGB → PNG 编码（压缩级别 1，偏重速度）→ Base64。
        /// 中间帧对象通过 using 及时释放，避免非托管内存堆积。
        /// </remarks>
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

        /// <summary>
        /// 关闭并释放当前视频捕获对象。
        /// </summary>
        /// <remarks>
        /// 先后调用 Release 与 Dispose 以确保底层解码器资源被回收，
        /// 随后将字段置空，使实例可安全地重新 <see cref="LoadVideo"/>。可重复调用。
        /// </remarks>
        public void CloseVideo()
        {
            _cap?.Release();
            _cap?.Dispose();
            _cap = null;
        }
    }
}
