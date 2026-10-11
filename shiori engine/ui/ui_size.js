/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * ============================================================================
 * UI 皮肤尺寸表（UI_SIZE_CONFIG）
 * ============================================================================
 *
 * 表里有条目 = 有这张图。引擎运行时不探测、不解析、不扫描目录 —— 只读这张表生成 CSS。
 *
 * 【为什么手填】
 *   自动扫描 assets/ui/ 反查尺寸看起来更省事，但那只是把一次性的解析成本搬到**每次启动**：
 *   最坏 82 个槽位 × 3 种扩展名 = 246 次请求，外加 4 次渐进重试。所以尺寸由开发者手填写死，
 *   引擎只负责读表。代价是表与图片必须同步。
 *
 * 【填了条目却没有图会怎样】
 *   该元素会被判定为「有皮肤」，带上 `background-color:transparent!important`，
 *   但 background-image 404 → 元素肉眼不可见。运行时不会报错，所以靠构建期自检兜底：
 *
 *       node tools/verify_ui_tables.js            # 三表同源自检（有错误退出码 1）
 *       node tools/verify_ui_tables.js --release  # 发布门禁：断言启用条目 = 0 且 assets/ui 无图
 *
 * 【怎么拿到两个数字】
 *       node tools/measure_ui.js                  # 从图片文件头读出真实像素，直接照抄
 *       node tools/measure_ui.js --fill           # 输出可直接粘贴的条目行
 *   这个工具**只在填表时跑一次**，不进运行时。
 *
 * 【条目格式】
 *   <文件名茎>: { sizex: 442, sizey: 64, x: '10%', y: '10%', zoom: '150%', ext: 'png' }
 *
 *   sizex / sizey  必填。图片真实像素。填 '#' 表示「明确声明没有这张图」（与整条注释等价）。
 *   x / y          可选。相对屏幕左上角的位置百分比，'#' = 沿用 CSS 默认位置。
 *                  ⚠ 一旦填了 x 或 y，该元素会被强制 `position:fixed!important`——
 *                    会脱离原本的布局流（标题页按钮会飞出菜单栏）。不确知后果就别填。
 *   zoom           可选。缩放百分比，'#' = 原始大小（即 100%）。
 *   ext            可选。图片扩展名，默认 'png'。放的是 webp / jpg 时必须写明——
 *                  引擎不探测扩展名，写错就是 404。
 *
 * 【缩放基准】
 *   所有尺寸按 1920×1080 为基准换算成 vw/vh：
 *       1920×1080 窗口 → 元素尺寸 = 图片原始像素（1:1）
 *       1280×720  窗口 → 等比缩小（442×64 → 295×43），比例不变
 *   即「填对了数字，页面就和设计稿等比对齐」。
 *
 * 【回退规则】
 *   缺 hover → 用 normal；缺 on → 用 normal。整组都缺 → 不换肤，保持 style.css 默认观感，不报错。
 *
 * 【发布态】
 *   本引擎是开源模板，默认形态应为「零皮肤」：整张表全部注释掉，assets/ui/ 只留说明文件，
 *   引擎完整回归 style.css 的默认 CSS 观感。发布前跑 `--release` 自检即可确认清零。
 *   当前这张表已全部注释为默认形态（零皮肤），恢复皮肤时按需取消对应条目即可。
 */
var UI_SIZE_CONFIG = {

    /* ==================== 通用部件（PARTS）====================
       被多个页面复用，走 CSS 变量 --ui-{part}-{state} 注入，
       消费规则写在 ui/ui_skin.css 里（没有消费规则 = 尺寸不生效）。 */

    /* ---- textbox：对白文本框底图（容器）---------------------------------
       图按 100% 100% 拉伸铺满容器，sizex/sizey 不参与尺寸注入，仅作记录。
       hover 态**不是** CSS :hover，而是由 TEXTBOX_HIGHLIGHT_MODE 驱动的显式状态：
           wait 等待点击推进 / hover 鼠标悬停 / read 打字机进行中 / off 关闭（当前默认）。
       on 态保留给作者手动置位（.ui-on），引擎无自动触发点。
       注意这三条消费的是 --ui-textbox-bg / -hover / -on，不是 -normal。 */
    // textbox_normal:        { sizex: '#', sizey: '#' },
    // textbox_hover:         { sizex: '#', sizey: '#' },
    // textbox_on:            { sizex: '#', sizey: '#' },

    /* ---- namebox：说话人姓名框底图（容器）-------------------------------
       同样 100% 铺满。hover 走真正的 :hover；on = **该说话人正在发声**
       （voice-player 播放中，由 system.js 的语音链路置位）。 */
    // namebox_normal:        { sizex: '#', sizey: '#' },
    // namebox_hover:         { sizex: '#', sizey: '#' },
    // namebox_on:            { sizex: '#', sizey: '#' },

    /* ---- novel：全屏小说模式容器底图（容器）-----------------------------
       覆盖 #novel-mode-container 与 #novel-text-box，与对白框换肤互不影响。 */
    // novel_normal:          { sizex: '#', sizey: '#' },

    /* ---- options：选项容器底图（#options-container）----------------------
       与 choice 同属 KEEP_TEXT_PARTS：贴图后选项文字仍然显示。
       注意它**不是** 100% 铺满的容器类 —— 会按 sizex/sizey 注入固定尺寸，
       请按「整块选项列表区域」的尺寸填，不要填成单条选项的大小。 */
    // options_normal:        { sizex: '#', sizey: '#' },

    /* ---- choice：选项按钮 -----------------------------------------------
       ⚠ 有图时**仍然显示选项文字**（与 BGM 鉴赏页曲目列表一致），
        请提供**无字底图**，否则会出现「图上的字 + DOM 的文字」双重叠加。
       on 态同时承担两种语义：点击后的跳转反馈（.choice-selected）与二周目的
       已读标记（.choice-read，由 CHOICE_READ_MARK 开关控制是否标记）。 */
    // choice_normal:         { sizex: '#', sizey: '#' },
    // choice_hover:          { sizex: '#', sizey: '#' },
    // choice_on:             { sizex: '#', sizey: '#' },

    /* ---- btn：顶栏通用功能按钮（存档/设置/日志…，AUTO 与 SKIP 另有专属位） */
    // btn_normal:            { sizex: '#', sizey: '#' },
    // btn_hover:             { sizex: '#', sizey: '#' },

    /* ---- auto：AUTO 自动播放按钮（三态） ---- */
    // auto_normal:           { sizex: '#', sizey: '#' },
    // auto_hover:            { sizex: '#', sizey: '#' },
    // auto_on:               { sizex: '#', sizey: '#' },

    /* ---- skip1：SKIP 快进按钮（第一组，三态）----
       on 态对应元素带 .skip-active（快进进行中）。 */
    // skip1_normal:          { sizex: '#', sizey: '#' },
    // skip1_hover:           { sizex: '#', sizey: '#' },
    // skip1_on:              { sizex: '#', sizey: '#' },

    /* ---- skip2：SKIP 快进按钮（第二组：已读/未读切换，三态）---- */
    // skip2_normal:          { sizex: '#', sizey: '#' },
    // skip2_hover:           { sizex: '#', sizey: '#' },
    // skip2_on:              { sizex: '#', sizey: '#' },

    /* ==================== 剧本页 HUD 按钮组 ====================
       这 17 个部件**默认共用 btn 的图**（只配 btn 时行为不变），放了专属图才单独生效。
       每个按钮单独配图时，sizex/sizey 就是该按钮图片的像素尺寸。
       注意它们的 CSS 属性名：部件名里的下划线在 data 属性里换成连字符，
       例如 log_panel → html[data-ui-part-log-panel="on"]。 */

    // save：SAVE 按钮（#ui-save）
    // save_normal:           { sizex: '#', sizey: '#' },
    // save_hover:            { sizex: '#', sizey: '#' },

    // dropdown：SAVE 的下拉容器（.galgame-ui-dropdown）；on = 展开（.show）
    // dropdown_normal:       { sizex: '#', sizey: '#' },
    // dropdown_hover:        { sizex: '#', sizey: '#' },
    // dropdown_on:           { sizex: '#', sizey: '#' },

    // dd_item：下拉条目 SCENES / MAP / STORY（.dd-item）——三条文案共用一张图，
    // 所以贴图后**仍保留文字**，请提供无字底图。
    // dd_item_normal:        { sizex: '#', sizey: '#' },
    // dd_item_hover:         { sizex: '#', sizey: '#' },

    // option / system / log / help / back / quit：HUD 其余按钮
    // option_normal:         { sizex: '#', sizey: '#' },
    // option_hover:          { sizex: '#', sizey: '#' },
    // system_normal:         { sizex: '#', sizey: '#' },
    // system_hover:          { sizex: '#', sizey: '#' },
    // log_normal:            { sizex: '#', sizey: '#' },
    // log_hover:             { sizex: '#', sizey: '#' },
    // help_normal:           { sizex: '#', sizey: '#' },
    // help_hover:            { sizex: '#', sizey: '#' },
    // back_normal:           { sizex: '#', sizey: '#' },
    // back_hover:            { sizex: '#', sizey: '#' },
    // quit_normal:           { sizex: '#', sizey: '#' },
    // quit_hover:            { sizex: '#', sizey: '#' },

    /* ==================== 浮层与提示 ==================== */

    // log_panel：日志浮层底（#log-overlay）。整屏遮罩，图按 100% 铺满，
    // sizex/sizey 不参与尺寸注入（与 textbox 一样属容器类）；内部是动态历史文本，保留文字。
    // log_panel_normal:      { sizex: '#', sizey: '#' },

    // log_btn：日志里的语音播放按钮（.log-audio-btn）；on = 该条语音正在播放。
    // 贴图后引擎会自动隐藏 CSS 画的三角播放符，别把三角画进图里。
    // log_btn_normal:        { sizex: '#', sizey: '#' },
    // log_btn_hover:         { sizex: '#', sizey: '#' },
    // log_btn_on:            { sizex: '#', sizey: '#' },

    // log_back：日志返回按钮（#log-back-btn）
    // log_back_normal:       { sizex: '#', sizey: '#' },
    // log_back_hover:        { sizex: '#', sizey: '#' },

    // toast：快捷保存提示（.quick-save-message）——文字是动态消息，保留文字。
    // toast_normal:          { sizex: '#', sizey: '#' },
    // toast_success:         { sizex: '#', sizey: '#' },
    // toast_error:           { sizex: '#', sizey: '#' },

    // prompt：屏幕上的「点击继续」提示（.click-prompt）
    // prompt_normal:         { sizex: '#', sizey: '#' },

    // pov：POV 视角指示器（.pov-indicator）——显示角色名，保留文字
    // pov_normal:            { sizex: '#', sizey: '#' },

    // progbar：语音进度条**轨道**（#voice-progress-bar）。填充条 #voice-progress-fill
    // 仍由 CSS 渐变绘制 —— 它是"进度"本身，图片表达不了当前百分比。
    // progbar_normal:        { sizex: '#', sizey: '#' },

    // vol：音量浮层（#volume-overlay）——显示当前音量百分比，保留文字
    // vol_normal:            { sizex: '#', sizey: '#' },

    /* ==================== 标题页 index.html ====================
       页面元素标 data-ui="{角色}"。缺 hover 时悬停沿用 normal。 */

    // title_start：开始游戏
    // title_start_normal:    { sizex: '#', sizey: '#' },
    // title_start_hover:     { sizex: '#', sizey: '#' },

    // title_save：存档
    // title_save_normal:     { sizex: '#', sizey: '#' },
    // title_save_hover:      { sizex: '#', sizey: '#' },

    // title_progress：进度管理
    // title_progress_normal: { sizex: '#', sizey: '#' },
    // title_progress_hover:  { sizex: '#', sizey: '#' },

    // title_flow：剧本流程图
    // title_flow_normal:     { sizex: '#', sizey: '#' },
    // title_flow_hover:      { sizex: '#', sizey: '#' },

    // title_story：小故事
    // title_story_normal:    { sizex: '#', sizey: '#' },
    // title_story_hover:     { sizex: '#', sizey: '#' },

    // title_bgm：BGM 鉴赏
    // title_bgm_normal:      { sizex: '#', sizey: '#' },
    // title_bgm_hover:       { sizex: '#', sizey: '#' },

    // title_video：视频鉴赏
    // title_video_normal:    { sizex: '#', sizey: '#' },
    // title_video_hover:     { sizex: '#', sizey: '#' },

    // title_cg：CG 鉴赏
    // title_cg_normal:       { sizex: '#', sizey: '#' },
    // title_cg_hover:        { sizex: '#', sizey: '#' },

    // title_copy：版权信息
    // title_copy_normal:     { sizex: '#', sizey: '#' },
    // title_copy_hover:      { sizex: '#', sizey: '#' },

    /* ==================== 分页面通用按钮 ==================== */

    // sub_back：返回主菜单
    // sub_back_normal:       { sizex: '#', sizey: '#' },
    // sub_back_hover:        { sizex: '#', sizey: '#' },

    // sub_return：返回当前页面（智能返回）
    // sub_return_normal:     { sizex: '#', sizey: '#' },
    // sub_return_hover:      { sizex: '#', sizey: '#' },

    /* ==================== 游戏内右键菜单 ====================
       元素由 ui/page-chrome.js 注入，属「晚生成」，加载时 DOM 里探不到。
       菜单可能在 rebuildSceneChrome() 时被整体重建，CSS 规则按属性命中，不受影响。 */

    // ctx_backdrop：整屏遮罩（面板弹出时压暗背景）
    // ctx_backdrop_normal:   { sizex: '#', sizey: '#' },

    // ctx_panel：右键面板底板。展开时面板带 .show 类，因此 on 图（若提供）
    // 也可用来做「展开态」底图 —— ctx_panel 属面板类，享有 .show 触发。
    // ctx_panel_normal:      { sizex: '#', sizey: '#' },
    // ctx_panel_hover:       { sizex: '#', sizey: '#' },

    // ctx_item：菜单条目。on = 当前项（.active/.ui-on）；disabled = 被禁用的项
    // （非剧本页隐藏的条目在 file:// 下用 display:none 硬隐藏，不占位、不出图）。
    // ctx_item_normal:       { sizex: '#', sizey: '#' },
    // ctx_item_hover:        { sizex: '#', sizey: '#' },
    // ctx_item_on:           { sizex: '#', sizey: '#' },
    // ctx_item_disabled:     { sizex: '#', sizey: '#' },

    // ctx_hint：面板底部的快捷键提示区
    // ctx_hint_normal:       { sizex: '#', sizey: '#' },

    // ctx_sep：提示区上方的分隔线
    // ctx_sep_normal:        { sizex: '#', sizey: '#' },

    /* ==================== CG 鉴赏页 CG.html ==================== */

    // cg_item：缩略图
    // cg_item_normal:        { sizex: '#', sizey: '#' },
    // cg_item_hover:         { sizex: '#', sizey: '#' },

    // cg_nav：翻页箭头
    // cg_nav_normal:         { sizex: '#', sizey: '#' },
    // cg_nav_hover:          { sizex: '#', sizey: '#' },

    // cg_close：关闭大图
    // cg_close_normal:       { sizex: '#', sizey: '#' },
    // cg_close_hover:        { sizex: '#', sizey: '#' },

    /* ==================== BGM 鉴赏页 bgm.html ====================
       ⚠ 本页的曲目列表即使贴了底图也**保留文字**（图不可能自带动态曲名）。 */

    // bgm_item：曲目条目（on = 播放中）
    // bgm_item_normal:       { sizex: '#', sizey: '#' },
    // bgm_item_hover:        { sizex: '#', sizey: '#' },
    // bgm_item_on:           { sizex: '#', sizey: '#' },

    // bgm_ctrl：播放控制（暂停/循环/停止，on = 已激活）
    // bgm_ctrl_normal:       { sizex: '#', sizey: '#' },
    // bgm_ctrl_hover:        { sizex: '#', sizey: '#' },
    // bgm_ctrl_on:           { sizex: '#', sizey: '#' },

    /* ==================== 视频鉴赏页 video.html ==================== */

    // video_item：视频条目
    // video_item_normal:     { sizex: '#', sizey: '#' },
    // video_item_hover:      { sizex: '#', sizey: '#' },

    // video_ctrl：退出播放
    // video_ctrl_normal:     { sizex: '#', sizey: '#' },
    // video_ctrl_hover:      { sizex: '#', sizey: '#' },

    /* ==================== 小故事页 story.html ==================== */

    // story_item：场景卡片
    // story_item_normal:     { sizex: '#', sizey: '#' },
    // story_item_hover:      { sizex: '#', sizey: '#' },

    /* ==================== 进度管理页 saves.html ==================== */

    // prog_act：操作按钮
    // prog_act_normal:       { sizex: '#', sizey: '#' },
    // prog_act_hover:        { sizex: '#', sizey: '#' },

    // prog_jump：快速跳转卡片
    // prog_jump_normal:      { sizex: '#', sizey: '#' },
    // prog_jump_hover:       { sizex: '#', sizey: '#' },

    /* ==================== 存档页 archive.html ==================== */

    // arc_act：操作按钮
    // arc_act_normal:        { sizex: '#', sizey: '#' },
    // arc_act_hover:         { sizex: '#', sizey: '#' },

    // arc_slot：存档卡片
    // arc_slot_normal:       { sizex: '#', sizey: '#' },
    // arc_slot_hover:        { sizex: '#', sizey: '#' },

    // arc_load：加载
    // arc_load_normal:       { sizex: '#', sizey: '#' },
    // arc_load_hover:        { sizex: '#', sizey: '#' },

    // arc_del：删除（disabled = 置灰不可点，走 _disabled 图）
    // arc_del_normal:        { sizex: '#', sizey: '#' },
    // arc_del_hover:         { sizex: '#', sizey: '#' },
    // arc_del_disabled:      { sizex: '#', sizey: '#' },

    // arc_ow：覆盖（disabled = 置灰不可点）
    // arc_ow_normal:         { sizex: '#', sizey: '#' },
    // arc_ow_hover:          { sizex: '#', sizey: '#' },
    // arc_ow_disabled:       { sizex: '#', sizey: '#' },

    /* ==================== 流程图页 flowchart(.debug).html ==================== */

    // flow_act：操作按钮
    // flow_act_normal:       { sizex: '#', sizey: '#' },
    // flow_act_hover:        { sizex: '#', sizey: '#' },

    // flow_node：场景节点（on = 当前游玩节点，元素带 .current-playing）
    // flow_node_normal:      { sizex: '#', sizey: '#' },
    // flow_node_hover:       { sizex: '#', sizey: '#' },
    // flow_node_on:          { sizex: '#', sizey: '#' },

    /* ==================== 版权信息页 copy.html ==================== */

    // copy_act：操作按钮
    // copy_act_normal:       { sizex: '#', sizey: '#' },
    // copy_act_hover:        { sizex: '#', sizey: '#' },

    // copy_nav：侧栏导航
    // copy_nav_normal:       { sizex: '#', sizey: '#' },
    // copy_nav_hover:        { sizex: '#', sizey: '#' },

    // copy_head：折叠标题
    // copy_head_normal:      { sizex: '#', sizey: '#' },
    // copy_head_hover:       { sizex: '#', sizey: '#' }
};
