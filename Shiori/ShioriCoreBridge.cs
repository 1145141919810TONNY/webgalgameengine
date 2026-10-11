// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
//
// ShioriCoreBridge — 启动器侧对原生 ShioriCore.dll 的 P/Invoke 桥接。
// 设计要点：
//  - Shiori.exe 是 net8.0，SgdFormatShared 是 net10.0，二者 TFM 不兼容，无法托管引用；
//    因此启动器只能通过原生 ShioriCore.dll（AOT 产出的非托管共享库）共享 .sgd 格式逻辑。
//  - 原生 DLL 解析：默认在 Shiori.exe 同级或 plugin/ 子目录下查找 ShioriCore.dll；
//    通过 NativeLibrary.SetDllImportResolver 把 "ShioriCore" 映射到 plugin/ 下的完整路径，
//    满足"把 DLL 放在 plugin/ 文件夹被读取"的部署约定。
//  - 容器读取 API（open/name/size/read/close）与 ShioriCore Exports.cs 逐字节对应；
//    校验 API（load_pubkey/verify_*）供签名校验使用。

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace ShioriCSharp
{
    /// <summary>
    /// 原生 ShioriCore.dll 的 P/Invoke 声明 + 解析器注册。
    /// 仅声明启动器实际使用的导出（容器读取 8 个 + 验签 4 个）。
    /// </summary>
    internal static class ShioriCoreBridge
    {
        private const string DllName = "ShioriCore";

        static ShioriCoreBridge()
        {
            // 把 "ShioriCore" 解析到 plugin/ 子目录下的完整路径（含 exe 同级兜底）。
            // SetDllImportResolver 第一个参数是 Assembly，不是 Type
            NativeLibrary.SetDllImportResolver(typeof(ShioriCoreBridge).Assembly, (name, assembly, path) =>
            {
                if (!string.Equals(name, DllName, StringComparison.OrdinalIgnoreCase))
                    return IntPtr.Zero;
                string exeDir = AppContext.BaseDirectory;
                string[] candidates =
                {
                    Path.Combine(exeDir, "plugin", "ShioriCore.dll"),
                    Path.Combine(exeDir, "ShioriCore.dll"),
                };
                foreach (var c in candidates)
                {
                    // 拆成两步：&& 短路时 out var 会被编译器判定为"可能未赋值"(CS0165)
                    if (!File.Exists(c)) continue;
                    if (NativeLibrary.TryLoad(c, out IntPtr h))
                        return h;
                }
                return IntPtr.Zero;
            });
        }

        // ---- 容器读取（与 ShioriCore Exports.cs 对应）----
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern IntPtr shiori_core_open_container(IntPtr priv, int privLen, IntPtr path, int pathLen);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int shiori_core_container_count(IntPtr ctx);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int shiori_core_container_name(IntPtr ctx, int index, IntPtr outPtr, int outCap, IntPtr outLenPtr);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern IntPtr shiori_core_open_entry(IntPtr ctx, IntPtr namePtr, int nameLen);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int shiori_core_entry_size(IntPtr eh, IntPtr outSizePtr);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int shiori_core_entry_read(IntPtr eh, long offset, IntPtr outPtr, int outCap, IntPtr outGotPtr);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern void shiori_core_close_entry(IntPtr eh);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern void shiori_core_close_container(IntPtr ctx);

        // ---- 验签（供将来 manifest/.sig 校验使用）----
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern IntPtr shiori_core_load_pubkey(IntPtr pem, int pemLen);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int shiori_core_verify_file(IntPtr ctx, IntPtr sig, int sigLen, IntPtr target, int targetLen);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int shiori_core_verify_manifest(IntPtr ctx, IntPtr manifest, int mLen, IntPtr sigDir, int sLen, IntPtr rootDir, int rLen);
        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern void shiori_core_free(IntPtr ctx);

        /// <summary>
        /// 把 UTF-8 字符串分配非托管内存（调用方负责 FreeHGlobal）。
        /// </summary>
        internal static IntPtr ToUtf8(string s, out int len)
        {
            byte[] b = Encoding.UTF8.GetBytes(s);
            len = b.Length;
            IntPtr p = Marshal.AllocHGlobal(b.Length);
            Marshal.Copy(b, 0, p, b.Length);
            return p;
        }
    }

    /// <summary>
    /// 对一个 .sgd 容器的托管封装：打开、枚举 entry 名、按名读回明文（CTR 解密由原生侧完成）。
    /// 所有原生句柄在 Dispose 时释放，线程安全由调用方保证（HttpServer 单容器实例复用）。
    /// </summary>
    internal sealed class NativeSgdContainer : IDisposable
    {
        /// <summary>
        /// entry 句柄池容量 8：一次 <c>open_entry</c> 要线性查找 entry 表并
        /// <c>GCHandle.Alloc</c> 一个托管对象，批量读图时开销明显；命中即复用。
        /// </summary>
        private const int MaxCachedHandles = 8;

        private IntPtr _ctx;
        private readonly List<string> _names;
        /// <summary>entry 名（Ordinal 精确匹配）→ 在 <see cref="_names"/> 中的下标，用于把请求序列排成容器存储顺序。</summary>
        private readonly Dictionary<string, int> _orderOf;
        /// <summary>该 .sgd 文件自身的最后写入时间与长度，作为"包戳"参与缩略图缓存键，重打包即失效。</summary>
        private readonly DateTime _packLastWriteUtc;
        private readonly long _packLength;
        /// <summary>
        /// 读锁：原生 EntryRead 是「Seek + Read」两步，而所有 entry 共享同一个 Core.Stream，
        /// 并发调用会互相踩 seek 位置。因此每次 seek+read 必须在锁内原子完成
        /// （长读循环按块加锁，块间让出，避免大文件读把整包堵住）。
        /// </summary>
        private readonly object _io = new();
        /// <summary>已缓存的 entry 句柄：entry 名 → 句柄与在用计数（仅在 <see cref="_io"/> 下访问）。</summary>
        private readonly Dictionary<string, HandleRef> _handles = new(StringComparer.Ordinal);
        /// <summary>句柄的 LRU 顺序（末尾最近使用，淘汰从头部开始）。</summary>
        private readonly LinkedList<string> _handleOrder = new();

        /// <summary>池内一条 entry 句柄：原生句柄指针 + 当前在用计数（&gt;0 时不可被淘汰）。</summary>
        private sealed class HandleRef
        {
            public IntPtr Eh;
            public int RefCount;
        }

        /// <summary>用启动器私钥 PEM 打开 .sgd。私钥用于解包 DEK（OAEP）并验证 header 签名。</summary>
        public NativeSgdContainer(string sgdPath, string launcherKeyPem)
        {
            IntPtr kp = ShioriCoreBridge.ToUtf8(launcherKeyPem, out int kl);
            IntPtr pp = ShioriCoreBridge.ToUtf8(sgdPath, out int pl);
            try
            {
                _ctx = ShioriCoreBridge.shiori_core_open_container(kp, kl, pp, pl);
            }
            finally
            {
                Marshal.FreeHGlobal(kp);
                Marshal.FreeHGlobal(pp);
            }
            if (_ctx == IntPtr.Zero)
                throw new InvalidDataException("open_container failed: wrong key / tampered / bad file");

            int n = ShioriCoreBridge.shiori_core_container_count(_ctx);
            _names = new List<string>(n);
            for (int i = 0; i < n; i++)
            {
                IntPtr lp = Marshal.AllocHGlobal(4);
                ShioriCoreBridge.shiori_core_container_name(_ctx, i, IntPtr.Zero, 0, lp);
                int nameLen = Marshal.ReadInt32(lp);
                Marshal.FreeHGlobal(lp);
                IntPtr nb = Marshal.AllocHGlobal(nameLen);
                ShioriCoreBridge.shiori_core_container_name(_ctx, i, nb, nameLen, IntPtr.Zero);
                _names.Add(Marshal.PtrToStringUTF8(nb, nameLen)!);
                Marshal.FreeHGlobal(nb);
            }

            // entry 下标 = 容器存储顺序：打包器按 string.CompareOrdinal(rel) 排序后
            // 依次累加 DataOffset（SgdPack.cs:65-83），因此"按下标顺序读"就等于"按物理偏移顺序读"，
            // 批量请求据此排序即可把随机读变成顺序读，无需额外导出偏移字段。
            _orderOf = new Dictionary<string, int>(_names.Count, StringComparer.Ordinal);
            for (int i = 0; i < _names.Count; i++) _orderOf[_names[i]] = i;

            // 包戳：文件级元数据（不读内容），用于让缩略图缓存随重打包失效
            try
            {
                var fi = new FileInfo(sgdPath);
                _packLastWriteUtc = fi.LastWriteTimeUtc;
                _packLength = fi.Length;
            }
            catch
            {
                _packLastWriteUtc = default;
                _packLength = 0;
            }
        }

        public IReadOnlyList<string> EntryNames => _names;

        /// <summary>entry 在容器内的存储下标（= 物理偏移顺序）；不存在时返回 -1。</summary>
        public int OrderOf(string name) =>
            _orderOf.TryGetValue(name ?? string.Empty, out int i) ? i : -1;

        /// <summary>该 .sgd 自身的最后写入时间与长度（"包戳"，参与缩略图缓存键）。</summary>
        public DateTime PackLastWriteUtc => _packLastWriteUtc;

        /// <summary>该 .sgd 自身的字节长度（"包戳"，参与缩略图缓存键）。</summary>
        public long PackLength => _packLength;

        /// <summary>
        /// 取（或复用）entry 句柄并加一次在用计数。调用方必须在 finally 里
        /// <see cref="ReleaseHandle"/>；池满时淘汰最久未使用且不在用的句柄。
        /// </summary>
        /// <param name="name">entry 名。</param>
        /// <returns>原生句柄；entry 不存在时返回 <see cref="IntPtr.Zero"/>。</returns>
        private IntPtr AcquireHandle(string name)
        {
            lock (_io)
            {
                if (_handles.TryGetValue(name, out var hit))
                {
                    hit.RefCount++;
                    TouchOrder(name);
                    return hit.Eh;
                }

                IntPtr np = ShioriCoreBridge.ToUtf8(name, out int nl);
                IntPtr eh = ShioriCoreBridge.shiori_core_open_entry(_ctx, np, nl);
                Marshal.FreeHGlobal(np);
                if (eh == IntPtr.Zero) return IntPtr.Zero;

                if (_handles.Count >= MaxCachedHandles) EvictHandlesLocked();
                _handles[name] = new HandleRef { Eh = eh, RefCount = 1 };
                _handleOrder.AddLast(name);
                return eh;
            }
        }

        /// <summary>释放一次句柄在用计数（句柄继续留在池里复用）。</summary>
        private void ReleaseHandle(string name)
        {
            lock (_io)
            {
                if (_handles.TryGetValue(name, out var e) && e.RefCount > 0) e.RefCount--;
            }
        }

        /// <summary>把某 entry 在 LRU 链表中移到末尾（最近使用）。调用方持有 <see cref="_io"/>。</summary>
        private void TouchOrder(string name)
        {
            var node = _handleOrder.Find(name);
            if (node == null) _handleOrder.AddLast(name);
            else { _handleOrder.Remove(node); _handleOrder.AddLast(node); }
        }

        /// <summary>
        /// 从最久未使用端起淘汰，直到池内条目数低于上限。只在用的句柄（RefCount &gt; 0）跳过，
        /// 因为调用方可能正在读它；若全部在用则本轮不淘汰（池暂时超额，靠后续调用收敛）。
        /// 调用方持有 <see cref="_io"/>。
        /// </summary>
        private void EvictHandlesLocked()
        {
            var node = _handleOrder.First;
            while (node != null && _handles.Count >= MaxCachedHandles)
            {
                var next = node.Next;
                if (_handles.TryGetValue(node.Value, out var e) && e.RefCount == 0)
                {
                    ShioriCoreBridge.shiori_core_close_entry(e.Eh);
                    _handles.Remove(node.Value);
                    _handleOrder.Remove(node);
                }
                node = next;
            }
        }

        /// <summary>在一次锁内完成 seek + read（原生侧两步操作，必须原子）。</summary>
        private int ReadRaw(IntPtr eh, long offset, IntPtr buf, int cap, IntPtr gotPtr)
        {
            lock (_io) return ShioriCoreBridge.shiori_core_entry_read(eh, offset, buf, cap, gotPtr);
        }

        /// <summary>
        /// 取 entry 的明文字节数（只开句柄读长度，不解密任何数据）。
        /// 用于 Range 请求在读取前先拿到资源总长（Content-Range 需要）。
        /// </summary>
        public long GetEntrySize(string name)
        {
            if (_ctx == IntPtr.Zero) throw new ObjectDisposedException(nameof(NativeSgdContainer));
            // 句柄走池（T3.7）：entry_size 只读 entry 表字段，不碰共享 Stream，无需额外加锁
            IntPtr eh = AcquireHandle(name);
            if (eh == IntPtr.Zero) throw new FileNotFoundException("entry not found: " + name);

            try
            {
                IntPtr szp = Marshal.AllocHGlobal(8);
                ShioriCoreBridge.shiori_core_entry_size(eh, szp);
                long size = Marshal.ReadInt64(szp);
                Marshal.FreeHGlobal(szp);
                return size;
            }
            finally
            {
                ReleaseHandle(name);
            }
        }

        /// <summary>
        /// 按明文偏移读取指定长度（原生侧完成 AES-CTR 解密，CTR 支持随机访问）。
        /// 【性能关键】媒体 Range 请求只解密被请求的区间，而不是整条 entry——
        /// 否则拖动进度条 / 播放 BGM 会把几十 MB 的音频整个解密一遍。
        /// </summary>
        public byte[] ReadRange(string name, long offset, int count)
        {
            if (_ctx == IntPtr.Zero) throw new ObjectDisposedException(nameof(NativeSgdContainer));
            if (count <= 0 || offset < 0) return Array.Empty<byte>();

            IntPtr eh = AcquireHandle(name);
            if (eh == IntPtr.Zero) throw new FileNotFoundException("entry not found: " + name);

            try
            {
                var all = new byte[count];
                long off = offset;
                int done = 0;
                while (done < count)
                {
                    int chunk = (int)Math.Min(1 << 20, count - done);
                    IntPtr buf = Marshal.AllocHGlobal(chunk);
                    IntPtr gotp = Marshal.AllocHGlobal(4);
                    // 按块加锁：块间让出读锁，几十 MB 的媒体 Range 不会把其它 entry 的读取堵死
                    int rc = ReadRaw(eh, off, buf, chunk, gotp);
                    int got = Marshal.ReadInt32(gotp);
                    Marshal.FreeHGlobal(gotp);
                    if (rc != 0 || got <= 0)
                    {
                        Marshal.FreeHGlobal(buf);
                        break;   // EOF 或读取失败：返回已读到的部分
                    }
                    Marshal.Copy(buf, all, done, got);
                    Marshal.FreeHGlobal(buf);
                    done += got;
                    off += got;
                }
                if (done != count) Array.Resize(ref all, done);
                return all;
            }
            finally
            {
                ReleaseHandle(name);
            }
        }

        /// <summary>按 entry 名读回完整明文（原生侧已经完成 AES-CTR 解密）。</summary>
        public byte[] ReadEntry(string name)
        {
            if (_ctx == IntPtr.Zero) throw new ObjectDisposedException(nameof(NativeSgdContainer));
            IntPtr eh = AcquireHandle(name);
            if (eh == IntPtr.Zero) throw new FileNotFoundException("entry not found: " + name);

            try
            {
                IntPtr szp = Marshal.AllocHGlobal(8);
                ShioriCoreBridge.shiori_core_entry_size(eh, szp);
                long size = Marshal.ReadInt64(szp);
                Marshal.FreeHGlobal(szp);

                byte[] all = new byte[size];
                long off = 0;
                while (off < size)
                {
                    int chunk = (int)Math.Min(1 << 20, size - off);
                    IntPtr buf = Marshal.AllocHGlobal(chunk);
                    IntPtr gotp = Marshal.AllocHGlobal(4);
                    int rc = ReadRaw(eh, off, buf, chunk, gotp);
                    int got = Marshal.ReadInt32(gotp);
                    Marshal.FreeHGlobal(gotp);
                    if (rc != 0) { Marshal.FreeHGlobal(buf); throw new IOException("entry_read rc=" + rc); }
                    Marshal.Copy(buf, all, (int)off, got);
                    Marshal.FreeHGlobal(buf);
                    off += got;
                }
                return all;
            }
            finally
            {
                ReleaseHandle(name);
            }
        }

        public void Dispose()
        {
            // 先归还池内全部句柄（GCHandle），再关容器；否则句柄表随容器一起被释放，
            // 留在池里的句柄会变成悬垂指针（后续误用即崩溃）。
            lock (_io)
            {
                foreach (var e in _handles.Values)
                {
                    try { ShioriCoreBridge.shiori_core_close_entry(e.Eh); } catch { }
                }
                _handles.Clear();
                _handleOrder.Clear();
            }
            if (_ctx != IntPtr.Zero)
            {
                ShioriCoreBridge.shiori_core_close_container(_ctx);
                _ctx = IntPtr.Zero;
            }
        }
    }
}
