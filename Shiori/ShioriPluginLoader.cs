// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 文件说明：插件系统核心——扫描 exe 旁 plugin\*.dll 并统一装载托管与原生两类插件。
// 托管插件经可卸载 ALC（AssemblyLoadContext）隔离加载，兼容 IShioriPlugin 契约与鸭子类型；
// 原生插件按 C ABI（ShioriPlugin_GetInfo/Init/Shutdown）通过 PEReader 预检导出表后加载；
// 单条插件失败仅跳过并记录原因，不影响引擎与其余插件。

using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text;

namespace ShioriCSharp;

/// <summary>
/// 一次插件装载批次的结果会话：持有成功与跳过清单，并负责统一关闭全部存活插件。
/// 生命周期：由 <see cref="ShioriPluginLoader.LoadAll"/> 创建，宿主退出时调用一次
/// <see cref="Shutdown"/>（可重复调用，内部幂等）。
/// </summary>
public sealed class ShioriPluginSession
{
    /// <summary>当前存活的插件包装（托管/原生），按加载顺序排列。</summary>
    private readonly List<LivePlugin> _live;
    /// <summary>幂等标记：Shutdown 只允许真正执行一次。</summary>
    private bool _down;

    /// <summary>内部构造，仅供加载器使用。</summary>
    /// <param name="loaded">成功加载的插件记录。</param>
    /// <param name="skipped">被跳过的插件记录（含原因）。</param>
    /// <param name="live">存活插件包装列表（引用由本会话接管）。</param>
    internal ShioriPluginSession(IReadOnlyList<ShioriPluginRecord> loaded, IReadOnlyList<ShioriPluginRecord> skipped, List<LivePlugin> live)
    {
        Loaded = loaded;
        Skipped = skipped;
        _live = live;
    }

    /// <summary>成功加载的插件记录（只读）。</summary>
    public IReadOnlyList<ShioriPluginRecord> Loaded { get; }
    /// <summary>被跳过的插件记录及原因（只读）。</summary>
    public IReadOnlyList<ShioriPluginRecord> Skipped { get; }

    /// <summary>
    /// 逆序关闭全部存活插件（后加载的先关，与加载顺序对称），随后清空列表。
    /// 重复调用安全（幂等）。
    /// </summary>
    public void Shutdown()
    {
        if (_down) return;
        _down = true;
        for (var i = _live.Count - 1; i >= 0; i--)
            _live[i].Shutdown();
        _live.Clear();
    }
}

/// <summary>
/// 单个存活插件的运行时包装：托管插件与原生插件二选一（另一侧为 null），
/// 负责 Shutdown 时的回调通知、原生库释放与 ALC 卸载。
/// </summary>
internal sealed class LivePlugin
{
    /// <summary>宿主接口（用于把托管回调调度到 UI 线程）。</summary>
    private readonly IShioriHost _host;
    /// <summary>托管插件实例（原生插件时为 null）。</summary>
    private readonly IShioriPlugin? _managed;
    /// <summary>托管插件所属的可收集 ALC（原生插件时为 null）。</summary>
    private readonly AssemblyLoadContext? _alc;
    /// <summary>原生库句柄（托管插件时为 IntPtr.Zero）。</summary>
    private readonly IntPtr _native;
    /// <summary>原生插件的 Shutdown 导出函数（可选导出）。</summary>
    private readonly ShutdownFn? _nativeShutdown;
    /// <summary>幂等标记：Shutdown 只执行一次。</summary>
    private bool _down;

    /// <summary>内部构造，仅供加载器使用。</summary>
    /// <param name="host">宿主接口。</param>
    /// <param name="managed">托管插件实例（或 null）。</param>
    /// <param name="alc">托管插件所属 ALC（或 null）。</param>
    /// <param name="native">原生库句柄（或 IntPtr.Zero）。</param>
    /// <param name="nativeShutdown">原生 Shutdown 委托（可 null）。</param>
    internal LivePlugin(IShioriHost host, IShioriPlugin? managed, AssemblyLoadContext? alc, IntPtr native, ShutdownFn? nativeShutdown)
    {
        _host = host;
        _managed = managed;
        _alc = alc;
        _native = native;
        _nativeShutdown = nativeShutdown;
    }

    /// <summary>
    /// 关闭该插件并释放其占用的原生资源：
    /// 托管插件先在 UI 线程调用 OnShutdown；随后释放原生库句柄，最后卸载插件 ALC。
    /// 顺序保证：先回调、后卸载，避免插件代码在其程序集被卸载后继续执行。
    /// 所有步骤的异常均被隔离（吞掉），保证单个插件关闭失败不影响其他插件。
    /// 幂等：重复调用直接返回。
    /// </summary>
    internal void Shutdown()
    {
        if (_down) return;
        _down = true;
        try
        {
            if (_managed != null)
            {
                try
                {
                    _host.InvokeOnUi(() => { try { _managed.OnShutdown(); } catch { /* isolate */ } });
                }
                catch { /* isolate */ }
            }
            else
                _nativeShutdown?.Invoke();
        }
        catch { /* isolate */ }
        if (_native != IntPtr.Zero)
        {
            try { NativeLibrary.Free(_native); } catch { /* isolate */ }
        }
        if (_alc != null)
        {
            try { _alc.Unload(); } catch { /* isolate */ }
        }
    }
}

/// <summary>原生插件导出：int __cdecl ShioriPlugin_GetInfo(out ShioriPluginInfo)。由插件回填信息结构。</summary>
[UnmanagedFunctionPointer(CallingConvention.Cdecl)]
internal delegate int GetInfoFn(out ShioriPluginInfo info);

/// <summary>v1 ABI: int __cdecl ShioriPlugin_Init(void). 不传宿主指针。</summary>
[UnmanagedFunctionPointer(CallingConvention.Cdecl)]
internal delegate int InitFn();

/// <summary>原生插件导出：void __cdecl ShioriPlugin_Shutdown(void)。宿主退出时调用（可选导出）。</summary>
[UnmanagedFunctionPointer(CallingConvention.Cdecl)]
internal delegate void ShutdownFn();

/// <summary>
/// 原生插件通过 GetInfo 回填的固定布局信息结构（与原生端头文件逐字节对齐，Pack=1）。
/// 字符串为 Ansi 内联定长缓冲（ByValTStr），因此 Name/Version 有硬性长度上限。
/// </summary>
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi, Pack = 1)]
internal struct ShioriPluginInfo
{
    /// <summary>插件期望的原生 ABI 版本，必须与 <see cref="ShioriPluginLoader.NativeAbiVersion"/> 精确相等。</summary>
    public int AbiVersion;
    /// <summary>插件支持的最低宿主 API 版本。</summary>
    public int MinHostApiVersion;
    /// <summary>插件支持的最高宿主 API 版本。</summary>
    public int MaxHostApiVersion;
    /// <summary>插件名（Ansi 定长 64 字节，含终止符）。</summary>
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
    public string Name;
    /// <summary>插件版本字符串（Ansi 定长 32 字节，含终止符）。</summary>
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string Version;
}

/// <summary>
/// 插件装载器：扫描插件目录下全部 *.dll，自动识别托管/原生并按统一流程装载。
/// 设计要点：单条失败只跳过不中断；托管插件使用可收集 ALC 隔离并支持卸载；
/// 原生插件先用 PEReader 检查导出表再加载，避免误把任意 dll 当插件 LoadLibrary。
/// </summary>
public static class ShioriPluginLoader
{
    /// <summary>宿主 API 版本（IShioriPlugin 契约），用于与插件做区间协商。</summary>
    public const int HostApiVersion = 1;
    /// <summary>原生 C ABI 版本；GetInfo 回填的 AbiVersion 必须与之精确相等。</summary>
    public const int NativeAbiVersion = 1;

    /// <summary>
    /// 计算插件目录：appDir 下的 "plugin" 子目录。
    /// </summary>
    /// <param name="appDir">应用（exe）所在目录。</param>
    /// <returns>插件目录路径；appDir 为空时返回相对路径 "plugin"。</returns>
    public static string DirectoryBesideExe(string appDir)
    {
        if (string.IsNullOrWhiteSpace(appDir)) return "plugin";
        return Path.Combine(Path.GetFullPath(appDir), "plugin");
    }

    /// <summary>
    /// 解析原生依赖库名到插件目录内的具体 dll 路径。
    /// 只取文件名部分（丢弃任何目录成分）并强制 .dll 结尾，
    /// 从而把原生依赖定位约束在插件目录内。
    /// </summary>
    /// <param name="pluginDir">插件目录。</param>
    /// <param name="libraryName">库名或相对路径（如 "native_core" 或 "sub/native_core.dll"）。</param>
    /// <returns>插件目录下该 dll 的完整路径（不检查存在性）。</returns>
    public static string ResolveNativeFile(string pluginDir, string libraryName)
    {
        var root = Path.GetFullPath(string.IsNullOrWhiteSpace(pluginDir) ? "." : pluginDir);
        var raw = (libraryName ?? "").Trim().Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
        var name = Path.GetFileName(raw);
        if (string.IsNullOrEmpty(name)) name = "plugin.dll";
        if (!name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) name += ".dll";
        return Path.Combine(root, name);
    }

    /// <summary>
    /// 与 <see cref="ResolveNativeFile"/> 相同的定位规则，但要求文件实际存在。
    /// </summary>
    /// <param name="pluginDir">插件目录。</param>
    /// <param name="libraryName">库名。</param>
    /// <returns>存在的 dll 全路径；不存在返回 null。</returns>
    public static string? MapUnmanaged(string pluginDir, string libraryName)
    {
        var path = ResolveNativeFile(pluginDir, libraryName);
        return File.Exists(path) ? path : null;
    }

    /// <summary>
    /// 通过 PEReader 只读解析 PE 导出表，判断 dll 是否导出 "ShioriPlugin_GetInfo"。
    /// 用于在真正 LoadLibrary 之前识别“这是否是 Shiori 原生插件”，
    /// 避免把普通原生 dll 强行加载进进程。
    /// </summary>
    /// <param name="path">dll 路径。</param>
    /// <returns>导出表中含 ShioriPlugin_GetInfo 返回 true；解析失败或无导出返回 false。</returns>
    public static bool HasNativePluginExport(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            using var pe = new PEReader(fs);
            var header = pe.PEHeaders.PEHeader;
            if (header == null) return false;
            // 导出目录必须存在且至少能容纳 Export Directory 结构（40 字节）。
            var export = header.ExportTableDirectory;
            if (export.RelativeVirtualAddress == 0 || export.Size < 40) return false;

            var dir = pe.GetSectionData(export.RelativeVirtualAddress);
            if (dir.Length < 40) return false;
            var r = dir.GetReader();
            r.ReadInt32();
            r.ReadInt32();
            r.ReadUInt16();
            r.ReadUInt16();
            r.ReadInt32();
            r.ReadInt32();
            r.ReadInt32();
            // 按 Export Directory 布局跳过 TimeStamp / OrdinalBase 等前置字段，
            // 读出“按名导出”的数量与名称指针数组的 RVA。
            var numberOfNames = r.ReadInt32();
            r.ReadInt32();
            var addressOfNames = r.ReadInt32();
            // 数量上限 8192 属防御式约束：名称指针数组至少需 4*count 字节可读。
            if (numberOfNames <= 0 || numberOfNames > 8192 || addressOfNames == 0) return false;

            var names = pe.GetSectionData(addressOfNames);
            if (names.Length < numberOfNames * 4) return false;
            var nr = names.GetReader();
            for (var i = 0; i < numberOfNames; i++)
            {
                var nameRva = nr.ReadInt32();
                if (nameRva == 0) continue;
                if (ReadAsciiZ(pe.GetSectionData(nameRva)) == "ShioriPlugin_GetInfo")
                    return true;
            }
            return false;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// 扫描插件目录并装载全部插件，返回结果会话。
    /// 流程：目录不存在则返回空会话；否则按文件名排序逐个处理，
    /// 用 PEReader 元数据区分托管/原生程序集并分派到 TryManaged / TryNative；
    /// 任一插件抛出异常只记入 Skipped，不影响其余插件。
    /// </summary>
    /// <param name="pluginDir">插件目录（通常是 exe 旁的 plugin 目录）。</param>
    /// <param name="host">宿主接口；null 时使用空实现 NullHost（日志被丢弃）。</param>
    /// <param name="log">日志回调；null 时回退到 host.Log。</param>
    /// <returns>包含成功/跳过清单与存活插件句柄的结果会话。</returns>
    public static ShioriPluginSession LoadAll(string pluginDir, IShioriHost host, Action<string>? log)
    {
        host ??= new NullHost();
        log ??= host.Log;
        var loaded = new List<ShioriPluginRecord>();
        var skipped = new List<ShioriPluginRecord>();
        var live = new List<LivePlugin>();
        if (string.IsNullOrWhiteSpace(pluginDir) || !Directory.Exists(pluginDir))
            return new ShioriPluginSession(loaded, skipped, live);

        var root = Path.GetFullPath(pluginDir);
        string[] files;
        try { files = Directory.GetFiles(root, "*.dll", SearchOption.TopDirectoryOnly); }
        catch (Exception ex)
        {
            log("[plugin] scan failed: " + ex.Message);
            return new ShioriPluginSession(loaded, skipped, live);
        }
        // 排序保证加载顺序稳定（消除目录枚举顺序差异带来的不确定性）。
        Array.Sort(files, StringComparer.OrdinalIgnoreCase);

        foreach (var file in files)
        {
            // 逃逸检查：候选文件必须确实位于插件目录之内（防符号链接/路径重定向）。
            if (!IsUnder(file, root))
            {
                Skip(skipped, log, file, "", "", "", "path outside plugin dir");
                continue;
            }
            try
            {
                if (IsManagedAssembly(file))
                    TryManaged(file, root, host, log, loaded, skipped, live);
                else
                    TryNative(file, host, log, loaded, skipped, live);
            }
            catch (Exception ex)
            {
                Skip(skipped, log, file, "", "", "", ex.Message);
            }
        }
        return new ShioriPluginSession(loaded, skipped, live);
    }

    private static void TryManaged(string file, string pluginDir, IShioriHost host, Action<string> log,
        List<ShioriPluginRecord> loaded, List<ShioriPluginRecord> skipped, List<LivePlugin> live)
    {
        var alc = new PluginAlc(file, pluginDir);
        var committed = false;
        try
        {
            Assembly asm;
            try { asm = alc.LoadFromAssemblyPath(Path.GetFullPath(file)); }
            catch (Exception ex)
            {
                Skip(skipped, log, file, "", "", "managed", ex.Message);
                return;
            }
            try
            {
                NativeLibrary.SetDllImportResolver(asm, (lib, _, _) =>
                {
                    var local = MapUnmanaged(pluginDir, lib);
                    if (local == null) return IntPtr.Zero;
                    return alc.LoadNative(local);
                });
            }
            catch (InvalidOperationException) { /* already set */ }

            Type[] types;
            try { types = asm.GetExportedTypes(); }
            catch (Exception ex)
            {
                Skip(skipped, log, file, "", "", "managed", ex.Message);
                return;
            }

            var bound = new List<IShioriPlugin>();
            foreach (var t in types)
            {
                if (!LooksLikePlugin(t)) continue;
                object? raw;
                try { raw = Activator.CreateInstance(t); }
                catch { continue; }
                if (raw == null) continue;
                var plugin = Bind(raw);
                if (plugin == null) continue;
                bound.Add(plugin);
            }
            if (bound.Count == 0)
            {
                Skip(skipped, log, file, "", "", "managed", "no plugin contract");
                return;
            }

            AssemblyLoadContext? alcOwner = alc;
            foreach (var plugin in bound)
            {
                var reason = Negotiate(host.ApiVersion, plugin.MinHostApiVersion, plugin.MaxHostApiVersion);
                if (reason != null)
                {
                    Skip(skipped, log, file, plugin.Name, plugin.Version, "managed", reason);
                    continue;
                }
                try
                {
                    host.InvokeOnUi(() => plugin.OnHostReady(host));
                }
                catch (Exception ex)
                {
                    IsolateCall(host, plugin.OnShutdown);
                    Skip(skipped, log, file, plugin.Name, plugin.Version, "managed", Unwrap(ex).Message);
                    continue;
                }
                loaded.Add(new ShioriPluginRecord(file, plugin.Name, plugin.Version, "managed", null));
                live.Add(new LivePlugin(host, plugin, alcOwner, IntPtr.Zero, null));
                if (alcOwner != null)
                {
                    committed = true;
                    alcOwner = null;
                }
                log("[plugin] loaded managed " + plugin.Name + " " + plugin.Version);
            }
        }
        catch (Exception ex)
        {
            Skip(skipped, log, file, "", "", "managed", ex.Message);
        }
        finally
        {
            if (!committed)
            {
                try { alc.Unload(); } catch { /* isolate */ }
            }
        }
    }

    private static void TryNative(string file, IShioriHost host, Action<string> log,
        List<ShioriPluginRecord> loaded, List<ShioriPluginRecord> skipped, List<LivePlugin> live)
    {
        if (!HasNativePluginExport(file))
        {
            Skip(skipped, log, file, "", "", "native", "no ShioriPlugin_GetInfo export");
            return;
        }
        if (!NativeLibrary.TryLoad(Path.GetFullPath(file), out var lib) || lib == IntPtr.Zero)
        {
            Skip(skipped, log, file, "", "", "native", "native load failed");
            return;
        }
        var committed = false;
        try
        {
            if (!NativeLibrary.TryGetExport(lib, "ShioriPlugin_GetInfo", out var getInfoPtr)
                || !NativeLibrary.TryGetExport(lib, "ShioriPlugin_Init", out var initPtr))
            {
                Skip(skipped, log, file, "", "", "native", "native exports missing");
                return;
            }
            var getInfo = Marshal.GetDelegateForFunctionPointer<GetInfoFn>(getInfoPtr);
            var init = Marshal.GetDelegateForFunctionPointer<InitFn>(initPtr);
            ShioriPluginInfo info;
            int rc;
            try { rc = getInfo(out info); }
            catch (Exception ex)
            {
                Skip(skipped, log, file, "", "", "native", ex.Message);
                return;
            }
            if (rc != 0)
            {
                Skip(skipped, log, file, "", "", "native", "GetInfo rc=" + rc);
                return;
            }
            if (info.AbiVersion != NativeAbiVersion)
            {
                Skip(skipped, log, file, info.Name, info.Version, "native", "abi " + info.AbiVersion);
                return;
            }
            var reason = Negotiate(host.ApiVersion, info.MinHostApiVersion, info.MaxHostApiVersion);
            if (reason != null)
            {
                Skip(skipped, log, file, info.Name, info.Version, "native", reason);
                return;
            }
            try { rc = init(); }
            catch (Exception ex)
            {
                Skip(skipped, log, file, info.Name, info.Version, "native", ex.Message);
                return;
            }
            if (rc != 0)
            {
                Skip(skipped, log, file, info.Name, info.Version, "native", "Init rc=" + rc);
                return;
            }
            ShutdownFn? shutdown = null;
            if (NativeLibrary.TryGetExport(lib, "ShioriPlugin_Shutdown", out var shutPtr))
                shutdown = Marshal.GetDelegateForFunctionPointer<ShutdownFn>(shutPtr);
            var name = string.IsNullOrWhiteSpace(info.Name) ? Path.GetFileNameWithoutExtension(file) : info.Name;
            var ver = string.IsNullOrWhiteSpace(info.Version) ? "0" : info.Version;
            loaded.Add(new ShioriPluginRecord(file, name, ver, "native", null));
            live.Add(new LivePlugin(host, null, null, lib, shutdown));
            committed = true;
            log("[plugin] loaded native " + name + " " + ver);
        }
        catch (Exception ex)
        {
            Skip(skipped, log, file, "", "", "native", ex.Message);
        }
        finally
        {
            if (!committed && lib != IntPtr.Zero)
            {
                try { NativeLibrary.Free(lib); } catch { /* isolate */ }
            }
        }
    }

    private static bool LooksLikePlugin(Type t)
    {
        if (t == null || !t.IsClass || t.IsAbstract || t.ContainsGenericParameters) return false;
        if (t.GetConstructor(Type.EmptyTypes) == null) return false;
        if (typeof(IShioriPlugin).IsAssignableFrom(t)) return true;
        var nameProp = t.GetProperty("Name", BindingFlags.Public | BindingFlags.Instance);
        if (nameProp == null || nameProp.GetIndexParameters().Length != 0) return false;
        return FindReady(t) != null;
    }

    private static MethodInfo? FindReady(Type t)
    {
        foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Instance))
        {
            if (m.Name == "OnHostReady" && m.GetParameters().Length == 1)
                return m;
        }
        return null;
    }

    private static IShioriPlugin? Bind(object instance)
    {
        if (instance is IShioriPlugin typed) return typed;
        var t = instance.GetType();
        var nameProp = t.GetProperty("Name", BindingFlags.Public | BindingFlags.Instance);
        var ready = FindReady(t);
        if (nameProp == null || ready == null) return null;
        var name = nameProp.GetValue(instance) as string;
        if (string.IsNullOrWhiteSpace(name)) return null;
        return new DuckPlugin(instance, t, nameProp, ready);
    }

    private static Exception Unwrap(Exception ex)
    {
        while (ex is TargetInvocationException t && t.InnerException != null)
            ex = t.InnerException;
        return ex;
    }

    private static void IsolateCall(IShioriHost host, Action action)
    {
        try
        {
            host.InvokeOnUi(() =>
            {
                try { action(); }
                catch { /* isolate */ }
            });
        }
        catch { /* isolate */ }
    }

    private static string? Negotiate(int host, int min, int max)
    {
        if (min > max) return "api range inverted";
        if (host < min || host > max) return "api version " + host + " outside " + min + "-" + max;
        return null;
    }

    private static void Skip(List<ShioriPluginRecord> skipped, Action<string> log, string path, string name, string version, string kind, string reason)
    {
        skipped.Add(new ShioriPluginRecord(path, name, version, kind, reason));
        log("[plugin] skip " + Path.GetFileName(path) + ": " + reason);
    }

    private static bool IsManagedAssembly(string path)
    {
        using var fs = File.OpenRead(path);
        using var pe = new PEReader(fs);
        return pe.HasMetadata && pe.PEHeaders.CorHeader != null;
    }

    private static bool IsUnder(string path, string root)
    {
        try
        {
            var full = Path.GetFullPath(path);
            var r = Path.GetFullPath(root);
            if (!r.EndsWith(Path.DirectorySeparatorChar))
                r += Path.DirectorySeparatorChar;
            return full.StartsWith(r, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static string ReadAsciiZ(PEMemoryBlock block)
    {
        var r = block.GetReader();
        var sb = new StringBuilder(32);
        while (r.RemainingBytes > 0)
        {
            var b = r.ReadByte();
            if (b == 0) break;
            if (b < 32 || b > 126) break;
            sb.Append((char)b);
            if (sb.Length > 80) break;
        }
        return sb.ToString();
    }

    private sealed class PluginAlc : AssemblyLoadContext
    {
        private readonly AssemblyDependencyResolver _resolver;
        private readonly string _pluginDir;

        public PluginAlc(string path, string pluginDir) : base("plugin:" + path, isCollectible: true)
        {
            _resolver = new AssemblyDependencyResolver(path);
            _pluginDir = pluginDir;
        }

        protected override Assembly? Load(AssemblyName assemblyName)
        {
            if (assemblyName.Name == typeof(IShioriPlugin).Assembly.GetName().Name)
                return typeof(IShioriPlugin).Assembly;
            var resolved = _resolver.ResolveAssemblyToPath(assemblyName);
            if (resolved == null || !IsUnder(resolved, _pluginDir)) return null;
            return LoadFromAssemblyPath(resolved);
        }

        internal IntPtr LoadNative(string fullPath)
        {
            try { return LoadUnmanagedDllFromPath(fullPath); }
            catch { return IntPtr.Zero; }
        }

        protected override IntPtr LoadUnmanagedDll(string unmanagedDllName)
        {
            var local = MapUnmanaged(_pluginDir, unmanagedDllName);
            if (local != null) return LoadNative(local);
            var resolved = _resolver.ResolveUnmanagedDllToPath(unmanagedDllName);
            if (resolved == null || !IsUnder(resolved, _pluginDir) || !File.Exists(resolved))
                return IntPtr.Zero;
            return LoadNative(resolved);
        }
    }

    private sealed class DuckPlugin : IShioriPlugin
    {
        private readonly object _target;
        private readonly MethodInfo _ready;
        private readonly MethodInfo? _shutdown;
        private readonly PropertyInfo? _version;
        private readonly PropertyInfo? _min;
        private readonly PropertyInfo? _max;

        public DuckPlugin(object target, Type t, PropertyInfo nameProp, MethodInfo ready)
        {
            _target = target;
            _ready = ready;
            Name = nameProp.GetValue(target) as string ?? "";
            _version = t.GetProperty("Version", BindingFlags.Public | BindingFlags.Instance);
            _min = t.GetProperty("MinHostApiVersion", BindingFlags.Public | BindingFlags.Instance);
            _max = t.GetProperty("MaxHostApiVersion", BindingFlags.Public | BindingFlags.Instance);
            _shutdown = t.GetMethod("OnShutdown", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
        }

        public string Name { get; }
        public string Version => (_version?.GetValue(_target) as string) ?? "0";
        public int MinHostApiVersion => ReadInt(_min, 1);
        public int MaxHostApiVersion => ReadInt(_max, MinHostApiVersion);

        public void OnHostReady(IShioriHost host) =>
            _ready.Invoke(_target, new object[] { host });

        public void OnShutdown() => _shutdown?.Invoke(_target, Array.Empty<object>());

        private int ReadInt(PropertyInfo? p, int fallback)
        {
            if (p == null) return fallback;
            var v = p.GetValue(_target);
            if (v is int i) return i;
            return fallback;
        }
    }

    private sealed class NullHost : IShioriHost
    {
        public int ApiVersion => HostApiVersion;
        public string AppDirectory => "";
        public string EngineDirectory => "";
        public string PluginDirectory => "";
        public void Log(string message) { }
        public void InvokeOnUi(Action action) => action();
    }
}
