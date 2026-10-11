// 版权所有：bilibili月が綺麗ですね_
// SPDX-License-Identifier: LicenseRef-Shiori-Engine
// 作者：bilibili月が綺麗ですね_
// Shiori Engine - Open Source Visual Novel Engine
//
// 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
// 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
//
// 文件说明：设置菜单「渲染」子菜单的构建器。
// 以代码方式向 WPF 设置菜单动态挂载磁盘缓存 / 硬件加速 / 缩略图 / 帧缓存 /
// 立绘渲染器 / 布局模式等选项；同一维度内勾选互斥，跨维度彼此正交、独立生效。

using System;
using System.Windows.Controls;

namespace ShioriCSharp;

/// <summary>
/// 渲染设置菜单构建器。
/// 通过代码向既有 WPF 设置菜单追加「渲染」相关子项，并把用户选择以不可变方式
/// 写回 <see cref="RenderProfile"/>（With* 方法），再经回调通知宿主应用变更。
/// </summary>
internal static class RenderMenu
{
    /// <summary>
    /// 将渲染设置项挂载到指定设置菜单。
    /// 副作用：直接向 <paramref name="settingsMenu"/> 追加 Separator 与各级菜单项；
    /// 用户每次点选都会生成新的 profile 快照并触发 <paramref name="onChanged"/> 回调。
    /// </summary>
    /// <param name="settingsMenu">目标设置菜单（通常是主窗口「设置」MenuItem）。</param>
    /// <param name="profile">初始渲染配置。</param>
    /// <param name="onChanged">
    /// 配置变更回调：参数为变更后的完整 profile 与变更维度种类；
    /// 宿主据此决定是否需要重启或重载（见 RenderChangeKindExtensions）。
    /// </param>
    public static void Attach(MenuItem settingsMenu, RenderProfile profile, Action<RenderProfile, RenderChangeKind> onChanged)
    {
        if (settingsMenu == null) throw new ArgumentNullException(nameof(settingsMenu));
        if (profile == null) throw new ArgumentNullException(nameof(profile));
        if (onChanged == null) throw new ArgumentNullException(nameof(onChanged));

        var current = profile;
        settingsMenu.Items.Add(new Separator());

        // ── 磁盘缓存容量（单选）：三档尺寸互斥，切换后标记 DiskCache 变更 ──
        var diskMenu = new MenuItem { Header = "磁盘缓存" };
        var disk1 = Checkable("1 MB", current.DiskCache == DiskCacheSize.Mb1);
        var disk256 = Checkable("256 MB", current.DiskCache == DiskCacheSize.Mb256);
        var disk1g = Checkable("1 GB", current.DiskCache == DiskCacheSize.Gb1);
        BindExclusive(disk1, () =>
        {
            current = current.WithDiskCache(DiskCacheSize.Mb1);
            onChanged(current, RenderChangeKind.DiskCache);
        }, disk1, disk256, disk1g);
        BindExclusive(disk256, () =>
        {
            current = current.WithDiskCache(DiskCacheSize.Mb256);
            onChanged(current, RenderChangeKind.DiskCache);
        }, disk1, disk256, disk1g);
        BindExclusive(disk1g, () =>
        {
            current = current.WithDiskCache(DiskCacheSize.Gb1);
            onChanged(current, RenderChangeKind.DiskCache);
        }, disk1, disk256, disk1g);
        diskMenu.Items.Add(disk1);
        diskMenu.Items.Add(disk256);
        diskMenu.Items.Add(disk1g);
        settingsMenu.Items.Add(diskMenu);

        // ── 硬件加速模式（单选）：默认 / 强制 GPU / 强制软件，三选一互斥 ──
        var accelMenu = new MenuItem { Header = "硬件加速" };
        var accelDefault = Checkable("默认", current.HardwareAccel == HardwareAccelMode.Default);
        var accelGpu = Checkable("强制 GPU 光栅化", current.HardwareAccel == HardwareAccelMode.ForceGpu);
        var accelSw = Checkable("强制软件（仅诊断）", current.HardwareAccel == HardwareAccelMode.ForceSoftware);
        BindExclusive(accelDefault, () =>
        {
            current = current.WithHardwareAccel(HardwareAccelMode.Default);
            onChanged(current, RenderChangeKind.HardwareAccel);
        }, accelDefault, accelGpu, accelSw);
        BindExclusive(accelGpu, () =>
        {
            current = current.WithHardwareAccel(HardwareAccelMode.ForceGpu);
            onChanged(current, RenderChangeKind.HardwareAccel);
        }, accelDefault, accelGpu, accelSw);
        BindExclusive(accelSw, () =>
        {
            current = current.WithHardwareAccel(HardwareAccelMode.ForceSoftware);
            onChanged(current, RenderChangeKind.HardwareAccel);
        }, accelDefault, accelGpu, accelSw);
        accelMenu.Items.Add(accelDefault);
        accelMenu.Items.Add(accelGpu);
        accelMenu.Items.Add(accelSw);
        settingsMenu.Items.Add(accelMenu);

        // ── 独立开关（复选）：图像缩略图与帧缓存，可自由开关、与其他维度正交 ──
        var thumbs = Checkable("图像缩略图", current.Thumbnails);
        thumbs.Click += (_, _) =>
        {
            current = current.WithThumbnails(thumbs.IsChecked == true);
            onChanged(current, RenderChangeKind.Thumbnails);
        };
        settingsMenu.Items.Add(thumbs);

        var frames = Checkable("帧缓存", current.FrameCache);
        frames.Click += (_, _) =>
        {
            current = current.WithFrameCache(frames.IsChecked == true);
            onChanged(current, RenderChangeKind.FrameCache);
        };
        settingsMenu.Items.Add(frames);

        // ── 立绘渲染器（单选）：DOM / 预合成单图 / Canvas 舞台 / 自动 ──
        var rendererMenu = new MenuItem { Header = "立绘渲染器" };
        var rDom = Checkable("DOM（现状）", current.CharRenderer == CharRendererMode.Dom);
        var rPre = Checkable("预合成单图", current.CharRenderer == CharRendererMode.Precomposed);
        var rCanvas = Checkable("Canvas 舞台", current.CharRenderer == CharRendererMode.Canvas);
        var rAuto = Checkable("自动", current.CharRenderer == CharRendererMode.Auto);
        BindExclusive(rDom, () =>
        {
            current = current.WithCharRenderer(CharRendererMode.Dom);
            onChanged(current, RenderChangeKind.CharRenderer);
        }, rDom, rPre, rCanvas, rAuto);
        BindExclusive(rPre, () =>
        {
            current = current.WithCharRenderer(CharRendererMode.Precomposed);
            onChanged(current, RenderChangeKind.CharRenderer);
        }, rDom, rPre, rCanvas, rAuto);
        BindExclusive(rCanvas, () =>
        {
            current = current.WithCharRenderer(CharRendererMode.Canvas);
            onChanged(current, RenderChangeKind.CharRenderer);
        }, rDom, rPre, rCanvas, rAuto);
        BindExclusive(rAuto, () =>
        {
            current = current.WithCharRenderer(CharRendererMode.Auto);
            onChanged(current, RenderChangeKind.CharRenderer);
        }, rDom, rPre, rCanvas, rAuto);
        rendererMenu.Items.Add(rDom);
        rendererMenu.Items.Add(rPre);
        rendererMenu.Items.Add(rCanvas);
        rendererMenu.Items.Add(rAuto);
        settingsMenu.Items.Add(rendererMenu);

        // ── 布局模式（单选）：流式 / 等比画布 ──
        var layoutMenu = new MenuItem { Header = "布局模式" };
        var layoutFlow = Checkable("流式", current.LayoutMode == LayoutMode.Flow);
        var layoutUniform = Checkable("等比画布", current.LayoutMode == LayoutMode.UniformCanvas);
        BindExclusive(layoutFlow, () =>
        {
            current = current.WithLayoutMode(LayoutMode.Flow);
            onChanged(current, RenderChangeKind.LayoutMode);
        }, layoutFlow, layoutUniform);
        BindExclusive(layoutUniform, () =>
        {
            current = current.WithLayoutMode(LayoutMode.UniformCanvas);
            onChanged(current, RenderChangeKind.LayoutMode);
        }, layoutFlow, layoutUniform);
        layoutMenu.Items.Add(layoutFlow);
        layoutMenu.Items.Add(layoutUniform);
        settingsMenu.Items.Add(layoutMenu);
    }

    /// <summary>
    /// 创建一个可勾选菜单项。
    /// <see cref="MenuItem.StaysOpenOnClick"/> 设为 true，避免点击后菜单整体收起，
    /// 方便用户连续调整多个渲染选项。
    /// </summary>
    /// <param name="header">菜单显示文本。</param>
    /// <param name="isChecked">初始勾选状态。</param>
    /// <returns>配置好的可勾选 MenuItem。</returns>
    private static MenuItem Checkable(string header, bool isChecked) =>
        new MenuItem { Header = header, IsCheckable = true, IsChecked = isChecked, StaysOpenOnClick = true };

    /// <summary>
    /// 将若干同类菜单项绑定为单选互斥组：点击某项时强制整组只勾选该项。
    /// 若点击的正是当前已勾选项（等效"取消勾选"），则仅恢复勾选、不触发 apply，
    /// 保证单选组任何时刻都恰有一个生效值。
    /// </summary>
    /// <param name="item">被点击的菜单项。</param>
    /// <param name="apply">确认切换后要执行的动作（通常为更新 profile 并回调）。</param>
    /// <param name="group">互斥组内的全部菜单项（含 item 自身）。</param>
    private static void BindExclusive(MenuItem item, Action apply, params MenuItem[] group)
    {
        item.Click += (_, _) =>
        {
            // IsCheckable 在 Click 前已翻转：原先勾选的项此时 IsChecked==false。
            var alreadySelected = item.IsChecked != true;
            foreach (var m in group)
                m.IsChecked = m == item;
            if (!alreadySelected)
                apply();
        };
    }
}
