// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
//
// ContainerVfs — .sgd 容器的虚拟文件系统层（fail-closed）。
// 职责：
//  - 递归扫描站点根下所有 "<名>.sgd"，把每个包映射到"其 entry 所在的前缀目录"：
//      · 顶层目录包：system.sgd     → key "system"
//      · assets 子包：assets/cg.sgd → key "assets/cg"
//      · 根包(约定名 code.sgd)：根目录散文件 → key ""（entry 直接是站点根相对路径）
//    映射只看 .sgd 自身的位置，**不要求同名明文目录存在**：
//    发行形态下站点根只有 .sgd，没有 system/、assets/cg/ 等目录，若要求兄弟目录会导致整包读不到。
//  - 对外以"相对站点根的正斜杠路径"为键提供读取，按最长前缀匹配命中最具体的包
//    （assets/cg 优先于 assets，避免父包抢走子包的路径）。
//  - 【fail-closed】包存在但打开失败（密钥错误/被篡改/损坏）→ 该包锁定：
//    读取一律失败，绝不放宽到磁盘上的散文件。

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ShioriCSharp
{
    /// <summary>
    /// 站点根下的 .sgd 分包虚拟文件系统。每个映射：站点根相对路径 → 原生容器（或锁定）。
    /// </summary>
    public sealed class ContainerVfs : IDisposable
    {
        /// <summary>约定的"根包"名：根目录散文件统一打成 code.sgd，其 entry 直接映射站点根。</summary>
        public const string RootPackName = "code";

        // 站点根相对路径(正斜杠,小写比较) → 原生容器；null 表示锁定(fail-closed)
        private readonly Dictionary<string, NativeSgdContainer?> _map =
            new(StringComparer.OrdinalIgnoreCase);
        // 同上 key → 该容器内 entry 名集合(小写)，用于 O(1) 存在性判定
        private readonly Dictionary<string, HashSet<string>> _index =
            new(StringComparer.OrdinalIgnoreCase);
        // 按 key 长度降序：保证最长前缀优先匹配（assets/cg 先于 assets；根包 "" 长度 0 兜底最后）
        private readonly List<string> _keysDesc = new();

        /// <summary>
        /// 递归扫描 rootDir 下所有 *.sgd 并建立映射。
        /// </summary>
        /// <param name="rootDir">站点根目录（游戏资源目录）。</param>
        /// <param name="launcherKeyPem">启动器私钥 PEM，用于解包 DEK 并验证 header 签名。</param>
        public ContainerVfs(string rootDir, string launcherKeyPem)
        {
            foreach (var sgd in Directory.GetFiles(rootDir, "*.sgd", SearchOption.AllDirectories))
            {
                string baseName = Path.GetFileNameWithoutExtension(sgd);
                if (string.IsNullOrEmpty(baseName)) continue;

                string dirRel = Path.GetRelativePath(rootDir, Path.GetDirectoryName(sgd)!);
                string normDir = dirRel == "." ? string.Empty : dirRel.Replace('\\', '/').Trim('/');
                string key = normDir.Length == 0 ? baseName : normDir + "/" + baseName;

                // 兄弟目录：<sgd 所在目录>/<包名>
                string sibling = normDir.Length == 0
                    ? Path.Combine(rootDir, baseName)
                    : Path.Combine(rootDir, normDir.Replace('/', Path.DirectorySeparatorChar), baseName);

                // 【发行形态】发布目录里只有 .sgd、没有同名明文目录，因此映射不能依赖兄弟目录是否存在。
                // 包的语义是"其 entry 位于 <key>/ 下"，与磁盘上是否还留着明文目录无关：
                // 开发期（散文件+兄弟包）与发行期（仅 .sgd）必须映射到同一套 key。
                string mapKey = key;
                if (normDir.Length == 0
                    && string.Equals(baseName, RootPackName, StringComparison.OrdinalIgnoreCase)
                    && !Directory.Exists(sibling))
                {
                    // 约定的根包 code.sgd（根目录且无同名 code\ 目录）：entry 直接映射站点根
                    mapKey = string.Empty;
                }

                try
                {
                    var c = new NativeSgdContainer(sgd, launcherKeyPem);
                    _map[mapKey] = c;
                    _index[mapKey] = new HashSet<string>(c.EntryNames, StringComparer.OrdinalIgnoreCase);
                }
                catch (Exception ex)
                {
                    // fail-closed：包存在但打不开 → 锁定，不回落散文件
                    _map[mapKey] = null;
                    _index[mapKey] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    Console.WriteLine($"[ContainerVfs] LOCKED {sgd} (open failed): {ex.Message}");
                }
            }

            _keysDesc.AddRange(_map.Keys.OrderByDescending(k => k.Length));
        }

        /// <summary>该路径对应的包是否已被 .sgd 接管（无论是否锁定）。传 "assets/cg" 这类完整相对路径。</summary>
        public bool IsPackagedSubdir(string subdir)
        {
            if (string.IsNullOrEmpty(subdir)) return _map.ContainsKey(string.Empty);
            return _map.ContainsKey(subdir.Replace('\\', '/').Trim('/'));
        }

        /// <summary>
        /// 按最长前缀匹配，把站点根相对路径解析为 (包 key, 容器内 entry 名, 容器)。
        /// </summary>
        private bool TryMatch(string relPath, out string key, out string entry, out NativeSgdContainer? container)
        {
            key = string.Empty;
            entry = string.Empty;
            container = null;

            string p = (relPath ?? string.Empty).Replace('\\', '/').TrimStart('/');
            if (p.Length == 0) return false;

            foreach (var k in _keysDesc)
            {
                if (k.Length == 0)
                {
                    // 根包兜底（长度 0，排序在最后）
                    key = k;
                    entry = p;
                    container = _map[k];
                    return true;
                }
                if (p.StartsWith(k + "/", StringComparison.OrdinalIgnoreCase))
                {
                    key = k;
                    entry = p.Substring(k.Length + 1);
                    container = _map[k];
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// 按相对站点根的正斜杠路径读取明文。命中包且 entry 存在时返回 true。
        /// 锁定的包或被篡改 entry 一律返回 false（fail-closed）。
        /// </summary>
        public bool TryRead(string relPath, out byte[] data)
        {
            data = Array.Empty<byte>();
            if (!TryMatch(relPath, out var key, out var entry, out var c) || c == null) return false;
            if (!_index[key].Contains(entry)) return false;
            try { data = c.ReadEntry(entry); return true; }
            catch (Exception ex)
            {
                Console.WriteLine($"[ContainerVfs] read failed {relPath}: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// 取容器内 entry 的明文字节数（不解密数据）。用于 Range 请求先拿到资源总长。
        /// </summary>
        public bool TryGetSize(string relPath, out long size)
        {
            size = 0;
            if (!TryMatch(relPath, out var key, out var entry, out var c) || c == null) return false;
            if (!_index[key].Contains(entry)) return false;
            try { size = c.GetEntrySize(entry); return true; }
            catch (Exception ex)
            {
                Console.WriteLine($"[ContainerVfs] size failed {relPath}: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// 按明文区间读取：只解密 [offset, offset+count) 这一段。
        /// 媒体 Range 请求走这条路，避免把整条 entry（可能几十 MB）全量解密。
        /// </summary>
        public bool TryReadRange(string relPath, long offset, int count, out byte[] data)
        {
            data = Array.Empty<byte>();
            if (!TryMatch(relPath, out var key, out var entry, out var c) || c == null) return false;
            if (!_index[key].Contains(entry)) return false;
            try
            {
                data = c.ReadRange(entry, offset, count);
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ContainerVfs] range read failed {relPath}: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// 取该路径在容器内的存储下标（= 物理偏移顺序）。
        /// 打包器按 <c>string.CompareOrdinal(rel)</c> 排序后依次累加 <c>DataOffset</c>
        /// （<c>SgdPack.cs:65-83</c>），所以下标顺序就是磁盘布局顺序 —— 批量请求按它排序即可顺序读。
        /// </summary>
        /// <param name="relPath">站点根相对路径。</param>
        /// <param name="order">存储下标；未命中时为 <see cref="int.MaxValue"/>（排到最后）。</param>
        /// <returns>命中可读包且 entry 存在时返回 true。</returns>
        public bool TryGetReadOrder(string relPath, out int order)
        {
            order = int.MaxValue;
            if (!TryMatch(relPath, out var key, out var entry, out var c) || c == null) return false;
            if (!_index[key].Contains(entry)) return false;
            int o = c.OrderOf(entry);
            if (o < 0) return false;
            order = o;
            return true;
        }

        /// <summary>
        /// 取该路径所属 .sgd 的"包戳"（包文件自身的最后写入时间与长度）。
        /// 用作缩略图缓存键的一部分：容器重打包 → 包戳变化 → 键变化 → 旧缓存自然失效，
        /// 不必依赖"文件名不变则内容不变"这种在开发期不成立的假设。
        /// </summary>
        /// <param name="relPath">站点根相对路径。</param>
        /// <param name="lastWriteUtc">包文件最后写入时间（UTC）。</param>
        /// <param name="length">包文件字节长度。</param>
        /// <returns>命中可读包时返回 true；根包/未命中返回 false（调用方用默认值兜底）。</returns>
        public bool TryGetPackStamp(string relPath, out DateTime lastWriteUtc, out long length)
        {
            lastWriteUtc = default;
            length = 0;
            if (!TryMatch(relPath, out _, out _, out var c) || c == null) return false;
            lastWriteUtc = c.PackLastWriteUtc;
            length = c.PackLength;
            return true;
        }

        /// <summary>
        /// 按容器存储顺序批量读取若干路径的完整明文（T3.9 的批量端点用）。
        /// 排序把一批随机读变成一趟顺序读，对机械硬盘与 SSD 都更友好；
        /// 生成器是**惰性**的：每张图读完、交给调用方解码后即可被回收，
        /// 因此几百张 CG 也不会一次性把源图全灌进内存。
        /// 缺项（不在容器内 / 读取失败）直接跳过，不抛异常。
        /// </summary>
        /// <param name="relPaths">站点根相对路径集合（调用方可先自行去重）。</param>
        /// <returns>(站点根相对路径, 明文字节) 流，顺序为容器存储顺序。</returns>
        public IEnumerable<(string Rel, byte[] Data)> ReadBatchOrdered(IEnumerable<string> relPaths)
        {
            var plan = new List<(int Order, string Rel)>();
            foreach (var p in relPaths ?? Enumerable.Empty<string>())
            {
                if (string.IsNullOrEmpty(p)) continue;
                if (TryGetReadOrder(p, out int order)) plan.Add((order, p));
            }
            plan.Sort((a, b) => a.Order.CompareTo(b.Order));

            foreach (var (_, rel) in plan)
            {
                if (TryRead(rel, out var bytes)) yield return (rel, bytes);
            }
        }

        /// <summary>路径是否落在已打包且可读的容器内。</summary>
        public bool Contains(string relPath)
        {
            if (!TryMatch(relPath, out var key, out var entry, out var c) || c == null) return false;
            return _index[key].Contains(entry);
        }

        /// <summary>
        /// 枚举某前缀下的全部 entry（站点根相对路径形式）。支持跨包合并：
        /// 传 "assets" 可一次拿到 assets 下所有子包(cg/chars/...)的 entry。
        /// 用于 api/chars/scan 与 CG 缩略图预热的容器化替代。
        /// </summary>
        public IEnumerable<string> Enumerate(string relPrefix)
        {
            string prefix = (relPrefix ?? string.Empty).Replace('\\', '/').Trim('/');

            foreach (var k in _map.Keys)
            {
                var c = _map[k];
                if (c == null) continue;

                // 判断该包是否落在请求前缀下，并算出容器内需要过滤的剩余前缀
                string rest;
                if (k.Length == 0)
                {
                    rest = prefix;                  // 根包：按给定前缀过滤 entry
                }
                else if (prefix.Length == 0
                         || k.Equals(prefix, StringComparison.OrdinalIgnoreCase)
                         || k.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase))
                {
                    rest = string.Empty;            // 请求的是该包本身或其父目录 → 整包纳入
                }
                else
                {
                    continue;                       // 包不在该前缀下
                }

                foreach (var e in c.EntryNames)
                {
                    if (rest.Length == 0
                        || e.Equals(rest, StringComparison.OrdinalIgnoreCase)
                        || e.StartsWith(rest + "/", StringComparison.OrdinalIgnoreCase))
                    {
                        yield return k.Length == 0 ? e : k + "/" + e;
                    }
                }
            }
        }

        public void Dispose()
        {
            foreach (var c in _map.Values)
                c?.Dispose();
            _map.Clear();
            _index.Clear();
            _keysDesc.Clear();
        }
    }
}
