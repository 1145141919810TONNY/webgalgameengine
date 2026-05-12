"""
视频诊断工具 - 检查视频文件的色彩和音频信息
"""
import cv2
import numpy as np
from pathlib import Path

def check_video(video_name):
    app_dir = Path(__file__).parent.parent
    video_path = app_dir / "shiori engine" / "assets" / "video" / video_name
    
    print(f"检查视频: {video_path}")
    print(f"文件存在: {video_path.exists()}")
    
    if not video_path.exists():
        print("视频文件不存在！")
        return
    
    # 打开视频
    cap = cv2.VideoCapture(str(video_path))
    
    if not cap.isOpened():
        print("无法打开视频文件")
        return
    
    # 获取视频信息
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    print(f"分辨率: {width}x{height}")
    print(f"FPS: {fps}")
    print(f"总帧数: {total_frames}")
    print(f"时长: {total_frames/fps:.2f}秒")
    
    # 读取第一帧
    ret, frame = cap.read()
    if ret:
        print(f"\n第一帧信息:")
        print(f"  形状: {frame.shape}")
        print(f"  数据类型: {frame.dtype}")
        print(f"  像素值范围: [{frame.min()}, {frame.max()}]")
        
        # 检查中心区域的像素值
        h, w, _ = frame.shape
        center_region = frame[h//4:3*h//4, w//4:3*w//4]
        avg_color = center_region.mean(axis=(0, 1))
        print(f"  中心区域平均颜色 (BGR): [{avg_color[0]:.1f}, {avg_color[1]:.1f}, {avg_color[2]:.1f}]")
        print(f"  说明: 如果B值明显高于R和G，可能是视频本身偏蓝")
        
        # 转换为RGB并检查
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        avg_color_rgb = frame_rgb[h//4:3*h//4, w//4:3*w//4].mean(axis=(0, 1))
        print(f"  转换RGB后平均颜色: [{avg_color_rgb[0]:.1f}, {avg_color_rgb[1]:.1f}, {avg_color_rgb[2]:.1f}]")
        
        # 保存原始帧和转换后的帧用于对比
        cv2.imwrite(str(app_dir / "test_frame_bgr.png"), frame)
        cv2.imwrite(str(app_dir / "test_frame_rgb.png"), frame_rgb)
        print(f"\n已保存测试帧:")
        print(f"  {app_dir / 'test_frame_bgr.png'} (BGR原始)")
        print(f"  {app_dir / 'test_frame_rgb.png'} (RGB转换后)")
    
    cap.release()
    
    # 检查音频（使用ffprobe）
    try:
        import subprocess
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_streams', '-select_streams', 'a', str(video_path)],
            capture_output=True,
            text=True
        )
        if result.stdout:
            print(f"\n音频信息:")
            print(result.stdout[:500])
        else:
            print("\n警告: 视频可能没有音频轨道")
    except Exception as e:
        print(f"\n无法检查音频 (ffprobe未安装?): {e}")

if __name__ == "__main__":
    # 测试OP视频
    check_video("OP.mp4")
    print("\n" + "="*50 + "\n")
    check_video("chdljt.mp4")
