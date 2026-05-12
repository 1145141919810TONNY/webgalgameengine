"""
视频解码器模块 - 使用OpenCV解码视频并传输到前端
用于QtWebEngine环境中的视频播放
"""
import cv2
import numpy as np
import base64
import json
from pathlib import Path
from typing import Optional
from PyQt6.QtCore import QObject, pyqtSlot


class VideoDecoder(QObject):
    """视频解码器 - 通过QWebChannel暴露给JavaScript"""
    
    # 视频环境映射表 {videoName: 'html'|'python'}
    video_env_map = {}
    
    def __init__(self, app_dir: str, is_debug: bool = False):
        super().__init__()
        self.app_dir = Path(app_dir)
        self.is_debug = is_debug
        self.cap = None
        self.video_path = None
        self.video_file_name = None  # 保存视频文件名用于音频播放
        self.fps = 30
        self.total_frames = 0
        self.current_frame = 0
        self.is_playing = False
        self.width = 0
        self.height = 0
    
    @pyqtSlot(str, result=str)
    def loadVideo(self, video_file_name: str) -> str:
        """
        加载视频文件
        :param video_file_name: 视频文件名（可带或不带扩展名，如'OP'或'OP.mp4'）
        :return: JSON格式的加载结果
        """
        try:
            # 如果没有扩展名，根据环境智能选择格式
            if '.' not in video_file_name:
                # Python环境优先使用.webm格式（MP4会导致闪退）
                video_file_name_with_ext = video_file_name + '.webm'
            else:
                video_file_name_with_ext = video_file_name
            
            # 构建视频文件路径
            video_path = self.app_dir / "shiori engine" / "assets" / "video" / video_file_name_with_ext
            
            # 如果.webm不存在，尝试.mp4
            if not video_path.exists():
                if video_file_name_with_ext.endswith('.webm'):
                    video_file_name_with_ext = video_file_name + '.mp4'
                    video_path = self.app_dir / "shiori engine" / "assets" / "video" / video_file_name_with_ext
            
            if not video_path.exists():
                return json.dumps({
                    "success": False,
                    "error": f"视频文件不存在: {video_file_name} (尝试了 {video_file_name}.mp4 和 {video_file_name}.webm)"
                })
            
            # 打开视频文件
            self.cap = cv2.VideoCapture(str(video_path))
            
            if not self.cap.isOpened():
                error_msg = f"无法打开视频文件: {video_file_name_with_ext}"
                return json.dumps({
                    "success": False,
                    "error": error_msg
                })
            
            # 获取视频信息
            self.fps = self.cap.get(cv2.CAP_PROP_FPS)
            self.total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
            self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            self.current_frame = 0
            self.is_playing = False
            self.video_path = video_path
            self.video_file_name = video_file_name_with_ext  # 保存文件名
            
            return json.dumps({
                "success": True,
                "fps": self.fps,
                "totalFrames": self.total_frames,
                "width": self.width,
                "height": self.height,
                "duration": self.total_frames / self.fps if self.fps > 0 else 0,
                "videoUrl": f"http://localhost:8080/assets/video/{self.video_file_name}"
            })
            
        except Exception as e:
            error_msg = f"加载视频失败: {str(e)}"
            return json.dumps({
                "success": False,
                "error": error_msg
            })
    
    @pyqtSlot(result=str)
    def getNextFrame(self) -> str:
        """
        获取下一帧并转换为Base64
        :return: JSON格式的帧数据
        """
        if not self.cap or not self.cap.isOpened():
            return json.dumps({
                "success": False,
                "error": "视频未加载"
            })
        
        if self.current_frame >= self.total_frames:
            return json.dumps({
                "success": False,
                "end": True,
                "message": "视频播放完毕"
            })
        
        try:
            # 读取帧
            ret, frame = self.cap.read()
            
            if not ret:
                return json.dumps({
                    "success": False,
                    "end": True,
                    "message": "无法读取更多帧"
                })
            
            # 方法1: 尝试直接使用BGR格式，因为有些视频编码可能已经是RGB
            # 方法2: 使用OpenCV的标准BGR到RGB转换
            
            # 检查像素值分布来判断是否需要转换
            # 如果B通道值普遍大于R通道，说明是BGR格式需要转换
            avg_b = frame[:,:,0].mean()
            avg_r = frame[:,:,2].mean()
            
            if avg_b > avg_r * 1.1:  # B通道明显大于R通道，说明是BGR格式
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            else:
                frame_rgb = frame  # 已经是RGB格式
            
            # 使用PNG格式无损压缩（压缩级别1-9，1表示较快压缩）
            _, buffer = cv2.imencode('.png', frame_rgb, [cv2.IMWRITE_PNG_COMPRESSION, 1])
            base64_str = base64.b64encode(buffer).decode('utf-8')
            
            self.current_frame += 1
            
            return json.dumps({
                "success": True,
                "frame": f"data:image/png;base64,{base64_str}",
                "currentFrame": self.current_frame,
                "totalFrames": self.total_frames,
                "currentTime": self.current_frame / self.fps if self.fps > 0 else 0
            })
            
        except Exception as e:
            error_msg = f"获取帧失败: {str(e)}"
            return json.dumps({
                "success": False,
                "error": error_msg
            })
    
    @pyqtSlot()
    def startPlayback(self):
        """开始播放"""
        self.is_playing = True
    
    @pyqtSlot()
    def pausePlayback(self):
        """暂停播放"""
        self.is_playing = False
    
    @pyqtSlot()
    def stopPlayback(self):
        """停止播放并重置"""
        self.is_playing = False
        if self.cap:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            self.current_frame = 0
    
    @pyqtSlot(result=str)
    def closeVideo(self) -> str:
        """关闭视频并释放资源"""
        if self.cap:
            self.cap.release()
            self.cap = None
        
        self.is_playing = False
        self.current_frame = 0
        self.video_path = None
        
        return json.dumps({"success": True})
    
    @pyqtSlot(result=str)
    def getVideoEnvMap(self) -> str:
        """
        获取视频环境映射表
        :return: JSON格式的视频环境映射 {videoName: 'html'|'python'}
        """
        return json.dumps(VideoDecoder.video_env_map)
    
    @pyqtSlot(float, result=str)
    def seekToTime(self, time_seconds: float) -> str:
        """
        跳转到指定时间
        :param time_seconds: 时间（秒）
        :return: JSON格式的结果
        """
        if not self.cap or not self.cap.isOpened():
            return json.dumps({
                "success": False,
                "error": "视频未加载"
            })
        
        try:
            # 计算目标帧
            target_frame = int(time_seconds * self.fps)
            target_frame = max(0, min(target_frame, self.total_frames - 1))
            
            # 设置帧位置
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
            self.current_frame = target_frame
            
            return json.dumps({
                "success": True,
                "currentFrame": self.current_frame,
                "currentTime": self.current_frame / self.fps if self.fps > 0 else 0
            })
            
        except Exception as e:
            error_msg = f"跳转失败: {str(e)}"
            return json.dumps({
                "success": False,
                "error": error_msg
            })
