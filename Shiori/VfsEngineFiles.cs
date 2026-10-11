// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
//
// VfsEngineFiles — IEngineFiles 的"磁盘 + .sgd 容器"合并视图实现。
// 职责：让脚本层（macro 扫描、readFile）以站点根相对路径寻址，不关心资源实际在磁盘还是包内。
// 开发期（散文件）与发行期（仅 .sgd）返回完全一致的视图，因此打包不会改变脚本可见性。
// 合并规则：磁盘优先，容器补充，同路径去重（磁盘为准）。

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Shiori.Scripting.Load;

namespace ShioriCSharp
{
    internal sealed class VfsEngineFiles : IEngineFiles
    {
        private readonly string _root;
        private readonly ContainerVfs? _vfs;

        public VfsEngineFiles(string engineRoot, ContainerVfs? vfs)
        {
            _root = Path.GetFullPath(engineRoot);
            _vfs = vfs;
        }

        public bool DirectoryExists(string relDir)
        {
            var dir = Norm(relDir);
            if (dir == null) return false;
            if (Directory.Exists(Path.Combine(_root, dir.Replace('/', Path.DirectorySeparatorChar)))) return true;
            return HasContainerEntryUnder(dir);
        }

        public IEnumerable<string> EnumerateFiles(string relDir)
        {
            var dir = Norm(relDir);
            if (dir == null) yield break;

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // 1) 磁盘散文件（开发期形态）
            var diskDir = Path.Combine(_root, dir.Replace('/', Path.DirectorySeparatorChar));
            if (Directory.Exists(diskDir))
            {
                foreach (var path in Directory.EnumerateFiles(diskDir, "*", SearchOption.AllDirectories))
                {
                    var rel = ToRel(path);
                    if (rel == null) continue;
                    if (seen.Add(rel)) yield return rel;
                }
            }

            // 2) 容器 entry（发行形态）：同一逻辑目录下可能跨多个包
            if (_vfs != null)
            {
                foreach (var rel in _vfs.Enumerate(dir))
                {
                    if (string.IsNullOrEmpty(rel)) continue;
                    if (seen.Add(rel)) yield return rel;
                }
            }
        }

        public bool FileExists(string relPath)
        {
            var rel = Norm(relPath);
            if (rel == null) return false;
            if (File.Exists(Path.Combine(_root, rel.Replace('/', Path.DirectorySeparatorChar)))) return true;
            return _vfs != null && _vfs.Contains(rel);
        }

        public string ReadAllText(string relPath)
        {
            var rel = Norm(relPath);
            if (rel == null) throw new FileNotFoundException("invalid path", relPath);

            var disk = Path.Combine(_root, rel.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(disk)) return File.ReadAllText(disk, Encoding.UTF8);

            if (_vfs != null && _vfs.TryRead(rel, out var bytes))
                return Encoding.UTF8.GetString(bytes);

            throw new FileNotFoundException("not found on disk or in container", rel);
        }

        /// <summary>判断容器内是否存在该前缀下的 entry（用于"目录是否存在"的虚拟判定）。</summary>
        private bool HasContainerEntryUnder(string dir)
        {
            if (_vfs == null) return false;
            foreach (var _ in _vfs.Enumerate(dir))
                return true;
            return false;
        }

        private static string? Norm(string relPath)
        {
            if (string.IsNullOrWhiteSpace(relPath)) return null;
            var p = relPath.Replace('\\', '/').Trim('/');
            if (p.Length == 0) return null;
            // 阻止向上穿越
            if (p.StartsWith("..", StringComparison.Ordinal)) return null;
            return p;
        }

        private string? ToRel(string full)
        {
            try
            {
                var root = _root;
                if (!root.EndsWith(Path.DirectorySeparatorChar)) root += Path.DirectorySeparatorChar;
                var p = Path.GetFullPath(full);
                if (!p.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return null;
                return p.Substring(root.Length).Replace('\\', '/');
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
