"""
HTTP 服务器模块
使用 Python 内置 http.server 模块提供本地文件服务
"""
import http.server
import socketserver
import threading
import json
from pathlib import Path
from typing import Optional


class ShioriHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """自定义 HTTP 请求处理器"""
    
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
    
    def end_headers(self):
        """添加 CORS 支持"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_OPTIONS(self):
        """处理 OPTIONS 请求（CORS 预检）"""
        self.send_response(200)
        self.end_headers()
    
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
        :param start_port: 起始端口
        :param end_port: 结束端口
        :return: 实际使用的端口号
        """
        if self.is_debug:
            print(f"[INFO] 正在启动 HTTP 服务器...")
            print(f"[INFO] 根目录: {self.root_dir}")
        
        # 尝试多个端口
        for port in range(start_port, end_port + 1):
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
                    print(f"[WARN] 端口 {port} 被占用，尝试下一个端口...")
                continue
        
        # 所有端口都被占用
        raise RuntimeError(f"无法找到可用端口 ({start_port}-{end_port})")
    
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
