"""
HTTP 服务器模块
使用 Python 内置 http.server 模块提供本地文件服务
支持视频 Range 请求（范围请求）
"""
import http.server
import socketserver
import threading
import json
import os
from pathlib import Path
from typing import Optional
import mimetypes


class ShioriHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """自定义 HTTP 请求处理器"""
    
    # 添加视频格式的 MIME 类型支持
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **{
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.ogv': 'video/ogg',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.wmv': 'video/x-ms-wmv',
        '.m4v': 'video/mp4',
        '.mkv': 'video/x-matroska',
    }}
    
    def __init__(self, *args, root_dir: str = None, is_debug: bool = False, **kwargs):
        self.root_dir = Path(root_dir) if root_dir else Path.cwd()
        self.is_debug = is_debug
        super().__init__(*args, directory=str(self.root_dir), **kwargs)
    
    def translate_path(self, path: str) -> str:
        """转换 URL 路径为文件系统路径"""
        # 调用父类方法获取基础路径
        translated = super().translate_path(path)
        
        # 确保路径在根目录内（安全检查）
        try:
            translated_path = Path(translated).resolve()
            root_resolved = self.root_dir.resolve()
            
            # 如果路径不在根目录内，返回根目录
            if not str(translated_path).startswith(str(root_resolved)):
                return str(root_resolved / 'index.html')
            
            return str(translated_path)
        except Exception:
            return str(self.root_dir / 'index.html')
    
    def do_GET(self):
        """处理 GET 请求，支持视频 Range 请求"""
        try:
            # 获取文件路径
            file_path = self.translate_path(self.path)
            
            # 检查文件是否存在
            if not os.path.isfile(file_path):
                self.send_error(404, "File not found")
                return
            
            # 获取文件大小
            file_size = os.path.getsize(file_path)
            
            # 检查是否是视频文件
            path_lower = self.path.lower()
            is_video = any(path_lower.endswith(ext) for ext in ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.avi', '.wmv', '.m4v', '.mkv'])
            
            # 检查是否有 Range 请求头
            range_header = self.headers.get('Range')
            
            if range_header and is_video:
                # 处理 Range 请求
                self._handle_range_request(file_path, file_size, range_header)
            else:
                # 普通 GET 请求
                self._handle_normal_request(file_path, file_size)
                
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] 处理 GET 请求时出错: {e}")
            self.send_error(500, "Internal server error")
    
    def _handle_range_request(self, file_path, file_size, range_header):
        """处理 Range 请求（范围请求）"""
        try:
            # 解析 Range 头: Range: bytes=start-end
            if not range_header.startswith('bytes='):
                self.send_error(400, "Invalid Range header")
                return
            
            range_str = range_header[6:]  # 去掉 'bytes='
            
            # 支持单个范围（大多数情况）
            if ',' in range_str:
                # 多范围请求不支持
                self.send_error(400, "Multiple ranges not supported")
                return
            
            # 解析 start 和 end
            parts = range_str.split('-')
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if parts[1] else file_size - 1
            
            # 验证范围
            if start < 0 or start >= file_size or end < start or end >= file_size:
                self.send_error(416, "Range not satisfiable")
                return
            
            # 计算实际要读取的字节数
            content_length = end - start + 1
            
            # 发送 206 状态码（部分内容）
            self.send_response(206)
            
            # 设置响应头
            content_type = self._get_content_type(self.path)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(content_length))
            self.send_header(
                'Content-Range',
                f'bytes {start}-{end}/{file_size}'
            )
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'public, max-age=31536000')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            # 读取并发送文件部分内容
            with open(file_path, 'rb') as f:
                f.seek(start)
                remaining = content_length
                chunk_size = 8192  # 8KB 块大小
                
                while remaining > 0:
                    read_size = min(chunk_size, remaining)
                    data = f.read(read_size)
                    if not data:
                        break
                    try:
                        self.wfile.write(data)
                        remaining -= len(data)
                    except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                        # 客户端断开连接，正常情况（比如用户拖动进度条）
                        if self.is_debug:
                            print(f"[INFO] 客户端断开连接（Range 请求）")
                        return
                    except OSError as e:
                        if self.is_debug:
                            print(f"[WARN] 发送数据时出错: {e}")
                        return
                        
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            # 连接被客户端关闭，静默处理
            if self.is_debug:
                print(f"[INFO] 连接已关闭")
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] 处理 Range 请求时出错: {e}")
            try:
                self.send_error(500, "Internal server error")
            except:
                pass
    
    def _handle_normal_request(self, file_path, file_size):
        """处理普通 GET 请求"""
        try:
            # 发送 200 状态码
            self.send_response(200)
            
            # 设置响应头
            content_type = self._get_content_type(self.path)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(file_size))
            self.send_header('Accept-Ranges', 'bytes')
            
            # 视频文件添加缓存头
            path_lower = self.path.lower()
            if any(path_lower.endswith(ext) for ext in ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.avi', '.wmv', '.m4v', '.mkv']):
                self.send_header('Cache-Control', 'public, max-age=31536000')
            
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            # 发送文件内容
            with open(file_path, 'rb') as f:
                chunk_size = 8192
                while True:
                    data = f.read(chunk_size)
                    if not data:
                        break
                    try:
                        self.wfile.write(data)
                    except (ConnectionAbortedError, BrokenPipeError):
                        if self.is_debug:
                            print(f"[INFO] 客户端断开连接")
                        break
                        
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] 处理普通请求时出错: {e}")
            try:
                self.send_error(500, "Internal server error")
            except:
                pass
    
    def _get_content_type(self, path):
        """获取文件的 Content-Type"""
        # 自定义 MIME 类型映射
        custom_mime = {
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.ogg': 'video/ogg',
            '.ogv': 'video/ogg',
            '.mov': 'video/quicktime',
            '.avi': 'video/x-msvideo',
            '.wmv': 'video/x-ms-wmv',
            '.m4v': 'video/mp4',
            '.mkv': 'video/x-matroska',
        }
        
        ext = os.path.splitext(path)[1].lower()
        return custom_mime.get(ext, mimetypes.guess_type(path)[0] or 'application/octet-stream')
    
    def log_message(self, format, *args):
        """日志输出（仅调试模式）"""
        if self.is_debug:
            import datetime
            timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            message = format % args
            print(f"[{timestamp}] [HTTP] {message}")


class ShioriHTTPServer:
    """Shiori HTTP 服务器管理类"""
    
    def __init__(self, root_dir: str, is_debug: bool = False):
        self.root_dir = Path(root_dir)
        self.is_debug = is_debug
        self.server: Optional[socketserver.ThreadingTCPServer] = None
        self.server_thread: Optional[threading.Thread] = None
        self.port: int = 0
    
    def start(self, start_port: int = 8080, end_port: int = 8099) -> int:
        """
        启动 HTTP 服务器
        :param start_port: 起始端口（固定使用此端口以确保localStorage持久化）
        :param end_port: 结束端口（保留参数但不使用）
        :return: 实际使用的端口号
        """
        if self.is_debug:
            print(f"[INFO] 正在启动 HTTP 服务器...")
            print(f"[INFO] 根目录: {self.root_dir}")
            print(f"[INFO] 注意: 使用固定端口 {start_port} 以确保localStorage持久化")
        
        # 重要：必须使用固定端口，因为localStorage与Origin(协议+域名+端口)绑定
        # 如果每次使用不同端口，会导致localStorage数据隔离，无法持久化
        port = start_port
        
        try:
            # 创建服务器
            handler = lambda *args, **kwargs: ShioriHTTPRequestHandler(
                *args, 
                root_dir=str(self.root_dir), 
                is_debug=self.is_debug,
                **kwargs
            )
            
            self.server = socketserver.ThreadingTCPServer(
                ('localhost', port), 
                handler
            )
            self.server.allow_reuse_address = True
            
            # 启动服务器线程
            self.server_thread = threading.Thread(
                target=self.server.serve_forever,
                daemon=True
            )
            self.server_thread.start()
            
            self.port = port
            
            if self.is_debug:
                print(f"[INFO] HTTP 服务器启动成功")
                print(f"[INFO] 监听端口: {port}")
                print(f"[INFO] 访问地址: http://localhost:{port}/index.html")
            
            return port
            
        except OSError as e:
            if self.is_debug:
                print(f"[ERROR] 端口 {port} 被占用: {e}")
                print(f"[ERROR] 请关闭占用端口的程序后重试")
            raise RuntimeError(f"端口 {port} 已被占用，无法启动服务器")
    
    def stop(self):
        """停止 HTTP 服务器"""
        if self.server:
            if self.is_debug:
                print(f"[INFO] 正在关闭 HTTP 服务器...")
            
            try:
                # 先shutdown再server_close，确保快速关闭
                self.server.shutdown()
            except Exception as e:
                if self.is_debug:
                    print(f"[WARN] shutdown时出错: {e}")
            
            try:
                self.server.server_close()
            except Exception as e:
                if self.is_debug:
                    print(f"[WARN] server_close时出错: {e}")
            
            if self.server_thread:
                try:
                    # 减少等待时间，加快退出速度
                    self.server_thread.join(timeout=2)
                except Exception as e:
                    if self.is_debug:
                        print(f"[WARN] join线程时出错: {e}")
            
            # 清理引用
            self.server = None
            self.server_thread = None
            
            if self.is_debug:
                print(f"[INFO] HTTP 服务器已关闭")
