/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 剧本页 UI 骨架「数据表」。
 *
 * 把「界面里有哪些容器 / 右键菜单有哪些条目 / 提示区写什么」
 * 从引擎代码里抽出来变成纯数据。作者想增删一个菜单项、加一层容器，改这个文件即可，
 * 不需要动任何 js。
 *
 * 为什么是 .js 而不是 .json：
 *   1. 引擎清单（engine_manifest.json）按 <script> 同步装载，.js 数据不会晚于骨架构建；
 *   2. file:// 直开时 fetch(json) 会被 CORS 拦截，.js 不会；
 *   3. 与 ui_size.js / config/*.js 的数据表风格保持一致。
 *
 * 字段说明（containers 每项）：
 *   id        DOM id（同时也是页内唯一键；被收养时若元素已有 id 则沿用）
 *   tag       新建时的标签名，默认 'div'
 *   cls       追加的 class（收养时只补不覆盖）
 *   attr      追加的属性（收养时只补不覆盖）
 *   props     直接赋值到节点上的属性/属性（如 audio.loop、video.controls）
 *   style     内联样式串（关键定位 / 尺寸 / 可见性兜底；收养时只补缺失的声明）
 *   text      静态文本（placeholder），仅新建时写入
 *   children  子节点（递归同构）
 *   menu      true 表示该容器内部由 layout.menu + layout.hints 生成（右键面板）
 *
 * 缺字段一律按默认值处理，不会出现 0 尺寸或隐形的元素。
 */
window.SHIORI_UI_LAYOUT = {
    version: 1,

    /* 内联样式只写「定位 / 尺寸 / 可见性 / 层叠」这类结构性属性。
       颜色、背景、字号、padding 等留给 style.css 与 ui_skin.css ——
       内联样式会盖过样式表，写多了会把皮肤覆写顶掉。 */
    containers: [
        {
            id: 'background-container',
            style: 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;'
        },
        {
            id: 'character-container',
            style: 'position:absolute;bottom:0;left:0;width:100%;height:75%;pointer-events:none;z-index:1;'
        },
        {
            id: 'text-box-container',
            style: 'position:absolute;bottom:0;left:0;width:100%;display:flex;flex-direction:column;z-index:2;',
            children: [
                {
                    /* 说话人小头像。刻意做成文本框**内部**的绝对定位子节点：
                       文本框一隐藏（小说模式 / [msgoff] / 空行）它就跟着隐藏，不需要额外特判。
                       尺寸 / 半圆裁切 / 阴影 / 过渡全在 ui/style.css（内联只锁定位与可见性，
                       关掉皮肤也能落在正确位置）。关闭态 display:none，不占位。 */
                    id: 'speaker-avatar',
                    style: 'position:absolute;bottom:0;left:0;display:none;pointer-events:none;'
                },
                { id: 'name-box', children: [{ tag: 'span', text: '[姓名]' }] },
                { id: 'text-box', text: '[文本]' }
            ]
        },
        {
            id: 'options-container',
            style: 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:none;z-index:15;'
        },
        {
            id: 'novel-mode-container',
            style: 'position:fixed;top:0;left:0;width:100%;height:100%;display:none;justify-content:center;align-items:center;z-index:50;',
            children: [
                { id: 'novel-text-box', text: '[全屏文本]' }
            ]
        },
        { id: 'bgm-player', tag: 'audio', props: { loop: true } },
        { id: 'se-player', tag: 'audio' },
        { id: 'voice-player', tag: 'audio' },
        {
            id: 'video-player',
            style: 'display:none;position:absolute;top:0;left:0;width:100%;height:100%;z-index:100;background-color:black;',
            children: [
                {
                    id: 'main-video', tag: 'video',
                    props: { controls: true },
                    style: 'width:100%;height:100%;object-fit:contain;',
                    text: '您的浏览器不支持视频播放。'
                }
            ]
        },
        {
            /* 遮罩层：必须带 id。引擎按 getElementById('context-menu-backdrop') 取它，
               否则 elements.contextMenuBackdrop 恒为 null。可见性由
               state.contextMenuEnabled 控制（见 engine_boot.toggleContextMenu）。 */
            id: 'context-menu-backdrop',
            cls: 'context-menu-backdrop',
            attr: { 'data-ui': 'ctx_backdrop' },
            style: 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;display:none;'
        },
        {
            /* 面板：right / width 交由 style.css（含 .show 的滑入过渡），不内联，
               否则内联的 right 会盖掉 .context-menu.show{right:0} 导致永不滑入。 */
            id: 'context-menu',
            cls: 'context-menu',
            attr: { 'data-ui': 'ctx_panel' },
            style: 'position:fixed;top:0;height:100vh;z-index:9999;display:flex;flex-direction:column;justify-content:center;',
            menu: true
        }
    ],

    /* 右键菜单条目（onclick 为内联 JS 字符串，与旧 MENU_ITEMS 完全一致） */
    menu: [
        { label: '保存存档 (F5)', onclick: 'QuickSaveManager.quickSave()' },
        { label: '存档页面', onclick: 'QuickSaveManager.openArchivePage()' },
        { label: '进度管理', onclick: "gameEngine.saveStateSnapshot(); window.location.href='../html/saves.html'" },
        { label: '剧本流程图', onclick: "window.location.href='../html/flowchart.html'" },
        { label: '返回标题页面', onclick: "window.location.href='../index.html'" }
    ],

    /* 提示区：debugOnly 的行只在 debug 构建显示 */
    hints: [
        { text: 'F1 - 调试面板', debugOnly: true },
        { text: 'F5 - 快速保存' },
        { text: 'Ctrl - 快进模式' },
        { text: '+ / ↑ 增加音量 | - / ↓ 减少音量' }
    ],

    /* 提示区样式。分隔线已拆成独立的 ctx_sep 元素（便于单独换肤），
       所以这里不再带 border-top：间距 = sep 的 margin-top(20px) + 本体的 padding-top(15px)，
       与拆分前的「20px 外边距 + 1px 上边框 + 15px 内边距」观感一致。 */
    hintStyle: 'padding-top:15px;' +
        'color:rgba(255,215,0,0.6);font-size:12px;line-height:1.8;text-align:center;',

    /* 分隔线样式（ctx_sep）：height:0 的实心边框，只占 1px */
    sepStyle: 'height:0;margin-top:20px;border-top:1px solid rgba(255,215,0,0.3);'
};
