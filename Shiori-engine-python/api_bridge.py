"""
Python-JS 互操作 API 模块
通过 QWebChannel 暴露给前端 JavaScript
"""
import sys
import json
import base64
from pathlib import Path
from typing import List, Dict, Any, Optional
from PyQt6.QtCore import QObject, pyqtSlot


class ShioriAPI(QObject):
    """暴露给 JavaScript 的 API 对象"""
    
    def __init__(self, app_dir: str, is_debug: bool = False):
        super().__init__()
        self.app_dir = Path(app_dir)
        self.is_debug = is_debug
    
    @pyqtSlot(str, result=str)
    def openFileDialog(self, filter: str = "") -> str:
        """
        弹出系统打开文件对话框
        :param filter: 文件过滤器，如 "Images (*.png *.jpg)"
        :return: 选中文件的绝对路径，取消则返回空字符串
        """
        from PyQt6.QtWidgets import QFileDialog
        
        # 在主线程中执行
        from PyQt6.QtWidgets import QApplication
        parent = QApplication.activeWindow()
        
        file_path, _ = QFileDialog.getOpenFileName(
            parent,
            "选择文件",
            str(self.app_dir),
            filter if filter else "所有文件 (*)"
        )
        
        if self.is_debug:
            print(f"[DEBUG] openFileDialog: {file_path}")
        
        return file_path
    
    @pyqtSlot(result=str)
    def openFolderDialog(self) -> str:
        """
        弹出系统打开文件夹对话框
        :return: 选中文件夹的绝对路径，取消则返回空字符串
        """
        from PyQt6.QtWidgets import QFileDialog, QApplication
        
        parent = QApplication.activeWindow()
        folder_path = QFileDialog.getExistingDirectory(
            parent,
            "选择文件夹",
            str(self.app_dir)
        )
        
        if self.is_debug:
            print(f"[DEBUG] openFolderDialog: {folder_path}")
        
        return folder_path
    
    @pyqtSlot(str, result=str)
    def readFile(self, path: str) -> str:
        """
        读取指定路径的文本文件
        :param path: 文件路径（绝对路径或相对路径）
        :return: 文件内容文本，失败返回 JSON 错误对象
        """
        try:
            file_path = self._resolve_path(path)
            
            if not file_path.exists():
                return json.dumps({"error": f"文件不存在: {path}"})
            
            if not file_path.is_file():
                return json.dumps({"error": f"路径不是文件: {path}"})
            
            content = file_path.read_text(encoding='utf-8')
            
            if self.is_debug:
                print(f"[DEBUG] readFile: {path} ({len(content)} chars)")
            
            return content
            
        except Exception as e:
            error_msg = f"读取文件失败: {str(e)}"
            if self.is_debug:
                print(f"[ERROR] readFile: {error_msg}")
            return json.dumps({"error": error_msg})
    
    @pyqtSlot(str, result=str)
    def readFileBase64(self, path: str) -> str:
        """
        读取指定路径的二进制文件并转为 Base64
        :param path: 文件路径
        :return: Base64 编码字符串，失败返回 JSON 错误对象
        """
        try:
            file_path = self._resolve_path(path)
            
            if not file_path.exists():
                return json.dumps({"error": f"文件不存在: {path}"})
            
            if not file_path.is_file():
                return json.dumps({"error": f"路径不是文件: {path}"})
            
            content = file_path.read_bytes()
            base64_str = base64.b64encode(content).decode('utf-8')
            
            if self.is_debug:
                print(f"[DEBUG] readFileBase64: {path} ({len(base64_str)} chars)")
            
            return base64_str
            
        except Exception as e:
            error_msg = f"读取文件失败: {str(e)}"
            if self.is_debug:
                print(f"[ERROR] readFileBase64: {error_msg}")
            return json.dumps({"error": error_msg})
    
    @pyqtSlot(str, result=str)
    def listDirectory(self, path: str) -> str:
        """
        列出指定目录下的文件和子目录
        :param path: 目录路径
        :return: JSON 格式的文件列表
        """
        try:
            dir_path = self._resolve_path(path)
            
            if not dir_path.exists():
                return json.dumps({"error": f"目录不存在: {path}"})
            
            if not dir_path.is_dir():
                return json.dumps({"error": f"路径不是目录: {path}"})
            
            items = []
            for item in dir_path.iterdir():
                stat = item.stat()
                item_info = {
                    "name": item.name,
                    "type": "directory" if item.is_dir() else "file",
                    "size": stat.st_size if item.is_file() else 0,
                    "modified": stat.st_mtime
                }
                items.append(item_info)
            
            # 按名称排序
            items.sort(key=lambda x: x["name"])
            
            result = json.dumps(items, ensure_ascii=False)
            
            if self.is_debug:
                print(f"[DEBUG] listDirectory: {path} ({len(items)} items)")
            
            return result
            
        except Exception as e:
            error_msg = f"列出目录失败: {str(e)}"
            if self.is_debug:
                print(f"[ERROR] listDirectory: {error_msg}")
            return json.dumps({"error": error_msg})
    
    @pyqtSlot(str, result=bool)
    def fileExists(self, path: str) -> bool:
        """
        检查文件或目录是否存在
        :param path: 文件或目录路径
        :return: 是否存在
        """
        try:
            file_path = self._resolve_path(path)
            exists = file_path.exists()
            
            if self.is_debug:
                print(f"[DEBUG] fileExists: {path} -> {exists}")
            
            return exists
            
        except Exception as e:
            if self.is_debug:
                print(f"[ERROR] fileExists: {str(e)}")
            return False
    
    @pyqtSlot(result=str)
    def getAppDirectory(self) -> str:
        """
        获取程序所在目录的绝对路径
        :return: 程序根目录路径
        """
        path = str(self.app_dir)
        
        if self.is_debug:
            print(f"[DEBUG] getAppDirectory: {path}")
        
        return path
    
    @pyqtSlot(str)
    def writeDebugLog(self, message: str):
        """
        向调试控制台输出日志（仅调试版有效）
        :param message: 日志消息
        """
        if self.is_debug:
            import datetime
            timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            print(f"[{timestamp}] [JS] {message}")
    
    def _resolve_path(self, path: str) -> Path:
        """
        解析路径（支持绝对路径和相对路径）
        :param path: 输入路径
        :return: 解析后的 Path 对象
        """
        p = Path(path)
        
        # 如果是绝对路径，直接返回
        if p.is_absolute():
            return p.resolve()
        
        # 相对路径基于应用目录
        return (self.app_dir / p).resolve()
