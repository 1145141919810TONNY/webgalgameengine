// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 宿主配置注入的刷新决策（OPT S5.3 L3）。
// WebView2 DocumentCreated 阶段需要替换注入脚本：新脚本 Add 成功后
// 才能丢弃旧的脚本 id；若 Add 失败或 Core 已释放则不触发 Reload。
// 多次重叠的配置点击通过 generation 串行化，过期代只负责删除自己刚添加的 id。

namespace ShioriCSharp;

/// <summary>
/// 一次宿主配置刷新操作的决策结果。
/// </summary>
/// <param name="CommitId">提交后应视为当前的脚本 id；未成功时沿用旧 id。</param>
/// <param name="RemoveIds">本次需要移除的脚本 id 列表。</param>
/// <param name="Reload">是否应触发页面 Reload 以应用新配置。</param>
/// <param name="InjectFailed">注入是否失败（用于上层记录/重试）。</param>
public sealed record HostConfigRefreshDecision(
    string? CommitId,
    string[] RemoveIds,
    bool Reload,
    bool InjectFailed);

/// <summary>
/// 纯函数式的配置刷新决策器：综合注入结果、Core 存活状态与代次判断如何处理脚本 id。
/// </summary>
/// <remarks>无状态、无副作用，便于单独测试。</remarks>
public static class HostConfigRefresh
{
    /// <summary>
    /// 计算本次配置刷新应执行的动作。
    /// </summary>
    /// <param name="generation">本次操作的代次（由 Gate.Enqueue 分配）。</param>
    /// <param name="latestGeneration">当前最新代次，用于识别过期操作。</param>
    /// <param name="previousId">上一次成功提交的脚本 id，可为空。</param>
    /// <param name="addedId">本次新脚本注入成功后返回的 id；为空表示注入失败。</param>
    /// <param name="coreAlive">宿主 Core 是否仍然存活（已释放则不 Reload）。</param>
    /// <param name="needsReload">调用方评估是否确实需要 Reload。</param>
    /// <returns>包含提交 id、待移除 id、是否 Reload 与是否注入失败的决策。</returns>
    public static HostConfigRefreshDecision Decide(
        int generation,
        int latestGeneration,
        string? previousId,
        string? addedId,
        bool coreAlive,
        bool needsReload)
    {
        // 注入失败：保留旧 id，不移除任何脚本，标记失败
        if (string.IsNullOrEmpty(addedId))
        {
            return new HostConfigRefreshDecision(
                previousId,
                Array.Empty<string>(),
                Reload: false,
                InjectFailed: true);
        }

        // Core 已释放：保留旧 id，但不视为注入失败，也不 Reload
        if (!coreAlive)
        {
            return new HostConfigRefreshDecision(
                previousId,
                Array.Empty<string>(),
                Reload: false,
                InjectFailed: false);
        }

        // 过期代次（已有更新的操作）：丢弃自己刚加入的脚本，不提交、不 Reload
        if (generation != latestGeneration)
        {
            return new HostConfigRefreshDecision(
                previousId,
                new[] { addedId },
                Reload: false,
                InjectFailed: false);
        }

        // 正常路径：若要替换，仅当旧 id 存在且与新 id 不同才移除旧脚本
        var remove = !string.IsNullOrEmpty(previousId) && previousId != addedId
            ? new[] { previousId }
            : Array.Empty<string>();

        return new HostConfigRefreshDecision(
            addedId,
            remove,
            Reload: needsReload,
            InjectFailed: false);
    }
}

/// <summary>
/// 配置刷新的串行化闸门：分配递增代次、维护任务尾部链，并暂存待执行的 Reload 需求。
/// </summary>
/// <remarks>
/// 该类本身不进行线程同步，应由持有者在单一线程（通常是 UI 线程）上使用。
/// </remarks>
public sealed class HostConfigRefreshGate
{
    /// <summary>单调递增的代次计数器，标识最近一次入队的操作。</summary>
    private int _generation;
    /// <summary>上一次操作的 Task，用作下一次入队的前置依赖，实现串行执行。</summary>
    private Task _tail = Task.CompletedTask;
    /// <summary>积压的 Reload 需求标记，由 <see cref="ConsumePendingReload"/> 消费。</summary>
    private bool _pendingReload;

    /// <summary>当前最新代次，供 <see cref="HostConfigRefresh.Decide"/> 判断是否过期。</summary>
    public int Latest => _generation;

    /// <summary>
    /// 入队一次新操作：分配新代次并返回上一次的前置任务。
    /// </summary>
    /// <returns>元组：本次分配到的 <c>Generation</c> 与需等待的 <c>Previous</c> 任务。</returns>
    public (int Generation, Task Previous) Enqueue()
    {
        var generation = ++_generation;
        return (generation, _tail);
    }

    /// <summary>设置任务链尾部为新任务的 Task；null 会被规整为已完成态。</summary>
    /// <param name="tail">本次操作返回的 Task。</param>
    public void SetTail(Task tail) => _tail = tail ?? Task.CompletedTask;

    /// <summary>判断给定代次是否仍为最新（未被后续操作覆盖）。</summary>
    /// <param name="generation">待判断的代次。</param>
    /// <returns>为最新返回 true。</returns>
    public bool IsCurrent(int generation) => generation == _generation;

    /// <summary>记录一次 Reload 需求；仅当参数为 true 时置位，避免被 false 清除。</summary>
    /// <param name="needsReload">是否需要 Reload。</param>
    public void NoteNeedsReload(bool needsReload)
    {
        if (needsReload) _pendingReload = true;
    }

    /// <summary>取出并清除积压的 Reload 标记（一次性消费）。</summary>
    /// <returns>此前是否存在待执行的 Reload 需求。</returns>
    public bool ConsumePendingReload()
    {
        var pending = _pendingReload;
        _pendingReload = false;
        return pending;
    }
}
