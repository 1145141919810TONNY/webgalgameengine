// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 按字节预算的 LRU 缓存。
// 缓存编码后的 JPEG 等字节数据，当超出预算时从最久未使用端连续淘汰，
// 直至容纳新条目或清空缓存。
// 所有公开操作均在内部锁下执行，可安全用于多线程（如 HttpServer 工作线程）。

using System;
using System.Collections.Generic;

namespace ShioriCSharp;

/// <summary>
/// 以总字节数为容量上限的线程安全 LRU 缓存，用于保存编码后的图片字节（例如 JPEG）。
/// </summary>
/// <remarks>
/// 内部由哈希表（键 → 链表节点）与双向链表（访问/插入顺序）组成：
/// 链表头部为最近使用，尾部为最久未使用。淘汰时从尾部开始。
/// 所有读写均在 <see cref="_gate"/> 监视器锁内进行，因此实例是线程安全的。
/// </remarks>
public sealed class ByteLruCache
{
    /// <summary>默认字节上限：32 MiB。</summary>
    public const long DefaultLimitBytes = 32L * 1024 * 1024;

    /// <summary>保护内部状态的一致性锁；所有公开成员都需持有它。</summary>
    private readonly object _gate = new();
    /// <summary>键到链表节点的索引，支持 O(1) 查找与删除。</summary>
    private readonly Dictionary<string, LinkedListNode<Entry>> _map;
    /// <summary>按使用顺序排列的节点链表；头部最新，尾部最旧（淘汰端）。</summary>
    private readonly LinkedList<Entry> _order;
    /// <summary>当前缓存的总字节数（受 <see cref="_gate"/> 保护）。</summary>
    private long _total;

    /// <summary>
    /// 构造缓存实例。
    /// </summary>
    /// <param name="limitBytes">字节上限；负值会被钳制为 0（表示不缓存任何内容）。</param>
    public ByteLruCache(long limitBytes = DefaultLimitBytes)
    {
        LimitBytes = limitBytes < 0 ? 0 : limitBytes;
        _map = new Dictionary<string, LinkedListNode<Entry>>(StringComparer.Ordinal);
        _order = new LinkedList<Entry>();
    }

    /// <summary>缓存的字节容量上限（构造后不可变）。</summary>
    public long LimitBytes { get; }

    /// <summary>当前缓存占用的总字节数（线程安全读取）。</summary>
    public long TotalBytes
    {
        get { lock (_gate) return _total; }
    }

    /// <summary>当前缓存中的条目数量（线程安全读取）。</summary>
    public int Count
    {
        get { lock (_gate) return _map.Count; }
    }

    /// <summary>
    /// 尝试读取指定键对应的字节数组；命中时会将该条目提升为最近使用。
    /// </summary>
    /// <param name="key">缓存键。</param>
    /// <param name="value">命中时输出缓存的字节数组；未命中时输出 null。</param>
    /// <returns>命中返回 true，未命中返回 false。</returns>
    /// <exception cref="ArgumentNullException"><paramref name="key"/> 为 null 时抛出。</exception>
    public bool TryGet(string key, out byte[] value)
    {
        if (key == null) throw new ArgumentNullException(nameof(key));
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var node))
            {
                // 命中：移到链表头部，标记为最近使用
                _order.Remove(node);
                _order.AddFirst(node);
                value = node.Value.Bytes;
                return true;
            }
        }
        value = null!;
        return false;
    }

    /// <summary>
    /// 尝试写入键值对，必要时按 LRU 顺序淘汰尾部条目以腾出空间。
    /// </summary>
    /// <param name="key">缓存键；已存在时会先移除旧值再插入。</param>
    /// <param name="bytes">要缓存的字节数组。</param>
    /// <returns>
    /// 写入成功返回 true；若容量上限为 0 或单条数据本身超过上限（无法缓存）则返回 false。
    /// </returns>
    /// <exception cref="ArgumentNullException"><paramref name="key"/> 或 <paramref name="bytes"/> 为 null 时抛出。</exception>
    public bool TryAdd(string key, byte[] bytes)
    {
        if (key == null) throw new ArgumentNullException(nameof(key));
        if (bytes == null) throw new ArgumentNullException(nameof(bytes));
        lock (_gate)
        {
            // 缓存被禁用，或单条数据大于总量上限：直接拒绝
            if (LimitBytes <= 0 || bytes.LongLength > LimitBytes)
                return false;

            // 已存在同键：先减去旧占用并摘除旧节点，避免重复计数
            if (_map.TryGetValue(key, out var existing))
            {
                _total -= existing.Value.Bytes.LongLength;
                _order.Remove(existing);
                _map.Remove(key);
            }

            // 从最久未使用端（尾部）持续淘汰，直到能容纳新数据
            while (_total + bytes.LongLength > LimitBytes && _order.Last != null)
            {
                var last = _order.Last;
                _order.RemoveLast();
                _map.Remove(last.Value.Key);
                _total -= last.Value.Bytes.LongLength;
            }

            // 插入到头部（最近使用）并更新总字节数
            var node = _order.AddFirst(new Entry(key, bytes));
            _map[key] = node;
            _total += bytes.LongLength;
            return true;
        }
    }

    /// <summary>清空缓存，释放所有条目并将总字节数归零。</summary>
    public void Clear()
    {
        lock (_gate)
        {
            _map.Clear();
            _order.Clear();
            _total = 0;
        }
    }

    /// <summary>缓存条目：保存键与其字节数据，供链表与字典共用。</summary>
    private sealed class Entry
    {
        /// <summary>构造条目。</summary>
        /// <param name="key">缓存键。</param>
        /// <param name="bytes">字节数据。</param>
        public Entry(string key, byte[] bytes)
        {
            Key = key;
            Bytes = bytes;
        }

        /// <summary>缓存键（用于从字典中定位并移除自身）。</summary>
        public string Key { get; }
        /// <summary>缓存的字节数据。</summary>
        public byte[] Bytes { get; }
    }
}
