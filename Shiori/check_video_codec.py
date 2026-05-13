"""
视频编解码器诊断工具
检查视频文件的实际编码格式
"""
import subprocess
from pathlib import Path

# 视频文件路径
video_dir = Path(__file__).parent.parent / "shiori engine" / "assets" / "video"
video_files = list(video_dir.glob("*.mp4")) + list(video_dir.glob("*.webm"))

print("=" * 60)
print("视频文件编解码器诊断")
print("=" * 60)

for video_file in video_files:
    print(f"\n文件: {video_file.name}")
    print(f"大小: {video_file.stat().st_size / (1024*1024):.2f} MB")
    
    try:
        # 使用ffprobe检查视频信息
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 
             'stream=codec_name,codec_type,width,height,bit_rate',
             '-of', 'default=noprint_wrappers=1',
             str(video_file)],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            print("视频信息:")
            print(result.stdout)
        else:
            print(f"ffprobe错误: {result.stderr}")
            
    except FileNotFoundError:
        print("ffprobe未找到，尝试使用PyQt6检查...")
        try:
            from PyQt6.QtCore import QUrl
            from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput
            from PyQt6.QtWidgets import QApplication
            import sys
            
            app = QApplication(sys.argv)
            player = QMediaPlayer()
            audio = QAudioOutput()
            player.setAudioOutput(audio)
            player.setSource(QUrl.fromLocalFile(str(video_file)))
            
            if player.mediaStatus() == QMediaPlayer.MediaStatus.LoadedMedia:
                print(f"视频轨道: {player.videoTracksCount()}")
                print(f"音频轨道: {player.audioTracksCount()}")
            else:
                print(f"媒体状态: {player.mediaStatus()}")
                print(f"错误: {player.errorString()}")
        except Exception as e:
            print(f"检查失败: {e}")
    except Exception as e:
        print(f"检查失败: {e}")

print("\n" + "=" * 60)
print("PyQt6-WebEngine视频支持格式:")
print("- H.264 (AVC) - 应该支持")
print("- H.265 (HEVC) - 可能不支持")
print("- VP8 - 应该支持")
print("- VP9 - 可能不支持")
print("- AV1 - 通常不支持")
print("=" * 60)
