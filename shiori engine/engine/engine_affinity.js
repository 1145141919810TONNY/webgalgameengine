/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 文件说明：
 * 好感度系统与小说模式管理：处理好感度变化演出、数值同步（VarSpace）、
 * 小说模式切换，以及好感度升降的视觉效果与音效播放。
 */



    /**
     * 播放好感度变化演出（非阻塞版本，不调用 nextLine）
     * 用于选项点击后的即时视觉反馈
     * @param {string} flag - 变量名
     * @param {number} add - 变化值
     * @returns {void}
     * @description
     *   创建一个浮动的文字特效元素并播放好感度音效：
     *   上升（add > 0）显示金色的 “+X” 并向上飘动淡出；
     *   下降（add < 0）显示红色的 “X” 并向下飘动淡出。
     *   与 affinityUpShow/affinityDownShow 不同，本方法不接管剧情推进，
     *   因此不会调用 nextLine，仅用于纯视觉/听觉反馈。
     * @sideEffect 向 document.body 插入临时 DOM 节点（约 1.05s 后自动移除），
     *   并通过 playAffinitySound 播放音效。
     * @dependency document.body 必须可用；this.state.disableLVE 为真时（关闭演出）直接返回。
     */
gameEngine.playAffinityEffect = function(flag, add) {
        // LVE（演出）被关闭时跳过全部视觉效果
        if (this.state.disableLVE) return;
        // 判断是上升还是下降，决定样式与飘动方向
        var isUp = add > 0;
        // 创建浮动文字特效节点
        var effectDiv = document.createElement('div');
        effectDiv.id = isUp ? 'affinity-up-effect' : 'affinity-down-effect';
        // 上升显示带 + 号，下降直接显示负值文本
        effectDiv.textContent = isUp ? ('+' + add) : String(add);
        // —— 内联样式：居中固定定位、大号粗体、金色/红色 ——
        effectDiv.style.position = 'fixed';
        effectDiv.style.top = '50%';
        effectDiv.style.left = '50%';
        effectDiv.style.fontSize = '48px';
        effectDiv.style.fontWeight = 'bold';
        effectDiv.style.color = isUp ? '#ffcc00' : '#ff3333';
        effectDiv.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        effectDiv.style.zIndex = '1000';
        // 不拦截鼠标事件，避免遮挡点击
        effectDiv.style.pointerEvents = 'none';
        effectDiv.style.opacity = '1';
        // 使用 -50% 偏移实现真正的居中
        effectDiv.style.transform = 'translate(-50%, -50%)';
        // 声明 1s 的缓出过渡，供后续 transform/opacity 变化触发动画
        effectDiv.style.transition = 'all 1s ease-out';
        document.body.appendChild(effectDiv);

        // 播放对应的上升/下降音效
        this.playAffinitySound(isUp ? 'up' : 'down');

        // 延迟 50ms 后触发飘动与淡出（等首帧渲染完成，保证过渡生效）
        setTimeout(() => {
            effectDiv.style.transform = isUp
                ? 'translate(-50%, -100px)'   // 上升：向上飘
                : 'translate(-50%, +100px)';  // 下降：向下飘
            effectDiv.style.opacity = '0';
        }, 50);
        // 动画总时长约 1s，1050ms 后移除节点（先判断是否仍在 DOM 中，避免重复移除报错）
        setTimeout(() => {
            if (document.contains(effectDiv)) document.body.removeChild(effectDiv);
        }, 1050);
    };



    /**
     * 应用好感度变化（走 VarSpace.f.<flag>）
     * 同时同步到 state.affinity 以兼容旧调试面板/演出
     * @param {string} flag - 变量名（不含 f. 前缀）
     * @param {number} add - 变化值
     * @returns {void}
     * @description
     *   好感度数值的统一入口：优先交由 VarSpace.applyAffinity 处理（新版变量空间），
     *   再将结果同步写入旧版 this.state.affinity，保证 F1 调试面板与旧演出仍能读取。
     *   当 flag 非法（空/'#'）或 add 为空时直接忽略。
     * @dependency VarSpace（可选，若存在且提供 applyAffinity 则优先使用）。
     * @sideEffect 修改 this.state.affinity[flag]。
     */
gameEngine.applyAffinity = function(flag, add) {
        // 参数校验：flag 为空或为占位符 '#'，或 add 未提供时直接忽略
        if (!flag || flag === '#' || add === undefined || add === null) return;
        // 核心逻辑走 VarSpace
        var newVal = (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.applyAffinity)
            ? VarSpace.applyAffinity(flag, add)
            : undefined;
        // 同步旧 state.affinity（兼容 F1 调试面板/演出读取）
        this.initAffinitySystem();
        var old = this.state.affinity[flag] || 0;
        // VarSpace 返回有效值时以它为准，否则本地累加 add 作为兜底
        this.state.affinity[flag] = (newVal !== undefined) ? newVal : (old + Number(add));
    };


    
    /**
     * 设置全屏小说模式
     * @param {boolean} enabled - 是否启用小说模式
     * @returns {void}
     * @description
     *   在全屏“小说阅读”视图与常规“对话框 + 立绘”视图之间切换。
     *   启用时会隐藏角色立绘与常规对话框、显示全屏小说容器，
     *   并把当前对话框内容拷贝到小说模式的文本框中。
     * @sideEffect 修改 this.state.novelMode，并切换多个 DOM 容器的 display。
     * @dependency this.elements 中需存在 characterContainer、textContainer、
     *   novelModeContainer、novelTextBox、textBox。
     */
gameEngine.setNovelMode = function(enabled) {
        // 记录小说模式开关状态
        this.state.novelMode = enabled;
        
        if (enabled) {
            // 隐藏角色立绘和对话框
            this.elements.characterContainer.style.display = 'none';
            this.elements.textContainer.style.display = 'none';
            
            // 显示全屏小说容器
            this.elements.novelModeContainer.style.display = 'flex';
            
            // 转移文本内容到小说模式文本框
            this.elements.novelTextBox.innerHTML = this.elements.textBox.innerHTML;
        } else {
            // 隐藏全屏小说容器
            this.elements.novelModeContainer.style.display = 'none';
            
            // 恢复角色立绘和对话框（display 置空表示回退到样式表默认值）
            this.elements.characterContainer.style.display = '';
            this.elements.textContainer.style.display = 'flex';
        }
    };


    
    /**
     * 初始化好感度系统
     * 确保affinity对象存在
     * @returns {void}
     * @description 惰性初始化：仅当 this.state.affinity 不存在时创建空对象，
     *   避免覆盖已有好感度数据。
     * @sideEffect 可能创建 this.state.affinity = {}。
     */
gameEngine.initAffinitySystem = function() {
        if (!this.state.affinity) {
            this.state.affinity = {};
        }
    };


    
    /**
     * 好感度变化（向后兼容旧 action: {type:'affinityChange', flag, add} 写法）
     * 内部转调 applyAffinity，走 VarSpace.f.<flag>
     * @param {Object} options - 包含flag（角色标识）、add（变化值）等参数
     * @param {string} options.flag - 好感度变量名（角色标识）
     * @param {number} options.add - 变化值（正为上升，负为下降）
     * @returns {void}
     * @description
     *   兼容旧版脚本 action 写法的入口：先统一应用数值变化，
     *   再根据 add 的正负播放对应的上升/下降演出；add 为 0 时无演出直接推进剧情。
     *   上升/下降演出固定使用 1000ms 时长（time: 1000）。
     * @sideEffect 修改好感度数值；上升/下降分支最终会经演出回调调用 nextLine 推进剧情。
     */
gameEngine.affinityChange = function(options) {
        // 走统一的 applyAffinity（VarSpace + state.affinity 同步）
        this.applyAffinity(options.flag, options.add);

        // 根据变化值正负显示不同演出
        if (options.add > 0) {
            // 好感度上升
            this.affinityUpShow({flag: options.flag, add: options.add, time: 1000});
        } else if (options.add < 0) {
            // 好感度下降
            this.affinityDownShow({flag: options.flag, add: options.add, time: 1000});
        } else {
            // 无变化，直接继续
            this.nextLine();
        }
    };


    
    /**
     * 好感度上升演出效果
     * 显示金色的“+X”文字并向上飘动消失
     * @param {Object} options - 包含flag、add、time等参数
     * @param {string} options.flag - 好感度变量名（本演出不使用，仅透传）
     * @param {number} options.add - 上升数值，用于显示 “+X”
     * @param {number} [options.time=1000] - 演出总时长（毫秒），到期后推进剧情
     * @returns {void}
     * @description
     *   阻塞式演出：显示上升特效并在 time 毫秒后调用 nextLine 推进剧情。
     *   若 VarSpace 中的 AFFINITY_ANIM_ENABLED 为关闭，则跳过动画直接推进。
     * @sideEffect 向 document.body 插入临时 DOM 节点并播放音效；最终调用 nextLine。
     * @dependency VarSpace.isAffinityAnimEnabled（可选）、this.playAffinitySound。
     */
gameEngine.affinityUpShow = function(options) {
        // ★ 好感度动画开关检测（vars.js 中的 AFFINITY_ANIM_ENABLED）
        // 开关关闭时不做任何动画，直接推进剧情
        if (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.isAffinityAnimEnabled && !VarSpace.isAffinityAnimEnabled()) {
            this.nextLine();
            return;
        }

        // 播放上升音效
        this.playAffinitySound('up');

        // LVE 关闭时不展示视觉特效（注意：此分支不推进剧情）
        if (this.state.disableLVE) {
            return;
        }
        
        // 创建好感度上升特效元素
        const effectDiv = document.createElement('div');
        effectDiv.id = 'affinity-up-effect';
        effectDiv.textContent = `+${options.add || 1}`;
        effectDiv.style.position = 'fixed';
        effectDiv.style.top = '50%';
        effectDiv.style.left = '50%';
        effectDiv.style.fontSize = '48px';
        effectDiv.style.fontWeight = 'bold';
        effectDiv.style.color = '#ffcc00';
        effectDiv.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        effectDiv.style.zIndex = '1000';
        effectDiv.style.pointerEvents = 'none';
        effectDiv.style.opacity = '1';
        effectDiv.style.transform = 'translate(-50%, -50%)';
        effectDiv.style.transition = 'all 1s ease-out';
        
        document.body.appendChild(effectDiv);
        
        // 执行上升和淡出动画（延迟 50ms 触发，保证过渡生效）
        setTimeout(() => {
            effectDiv.style.transform = 'translate(-50%, -100px)';
            effectDiv.style.opacity = '0';
        }, 50);
        
        // 动画结束后移除元素
        setTimeout(() => {
            if (document.contains(effectDiv)) {
                document.body.removeChild(effectDiv);
            }
        }, 1050);
        
        // 演出结束后推进剧情（默认 1000ms）
        setTimeout(() => {
            this.nextLine();
        }, options.time || 1000);
    };


    
    /**
     * 好感度下降演出效果
     * 显示红色的“X”文字并向下飘动消失
     * @param {Object} options - 包含flag、add、time等参数
     * @param {string} options.flag - 好感度变量名（本演出不使用，仅透传）
     * @param {number} options.add - 下降数值（负数），用于显示文本
     * @param {number} [options.time=1000] - 演出总时长（毫秒），到期后推进剧情
     * @returns {void}
     * @description
     *   阻塞式演出：显示下降特效并在 time 毫秒后调用 nextLine 推进剧情。
     *   若 VarSpace 中的 AFFINITY_ANIM_ENABLED 为关闭，则跳过动画直接推进。
     * @sideEffect 向 document.body 插入临时 DOM 节点并播放音效；最终调用 nextLine。
     * @dependency VarSpace.isAffinityAnimEnabled（可选）、this.playAffinitySound。
     */
gameEngine.affinityDownShow = function(options) {
        // ★ 好感度动画开关检测（vars.js 中的 AFFINITY_ANIM_ENABLED）
        // 开关关闭时不做任何动画，直接推进剧情
        if (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.isAffinityAnimEnabled && !VarSpace.isAffinityAnimEnabled()) {
            this.nextLine();
            return;
        }

        // 播放下降音效
        this.playAffinitySound('down');

        // LVE 关闭时不展示视觉特效（注意：此分支不推进剧情）
        if (this.state.disableLVE) {
            return;
        }
        
        // 创建好感度下降特效元素
        const effectDiv = document.createElement('div');
        effectDiv.id = 'affinity-down-effect';
        effectDiv.textContent = `${options.add || -1}`;
        effectDiv.style.position = 'fixed';
        effectDiv.style.top = '50%';
        effectDiv.style.left = '50%';
        effectDiv.style.fontSize = '48px';
        effectDiv.style.fontWeight = 'bold';
        effectDiv.style.color = '#ff3333';
        effectDiv.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        effectDiv.style.zIndex = '1000';
        effectDiv.style.pointerEvents = 'none';
        effectDiv.style.opacity = '1';
        effectDiv.style.transform = 'translate(-50%, -50%)';
        effectDiv.style.transition = 'all 1s ease-out';
        
        document.body.appendChild(effectDiv);
        
        // 执行下降和淡出动画（延迟 50ms 触发，保证过渡生效）
        setTimeout(() => {
            effectDiv.style.transform = 'translate(-50%, +100px)';
            effectDiv.style.opacity = '0';
        }, 50);
        
        // 动画结束后移除元素
        setTimeout(() => {
            if (document.contains(effectDiv)) {
                document.body.removeChild(effectDiv);
            }
        }, 1050);
        
        // 演出结束后推进剧情（默认 1000ms）
        setTimeout(() => {
            this.nextLine();
        }, options.time || 1000);
    };


    
    /**
     * 播放好感度变化音效
     * @param {string} type - 音效类型，'up'或'down'
     * @returns {void}
     * @description 好感度上升/下降音效的占位实现，当前仅在控制台打印日志。
     *   后续可接入 playSE 播放实际音效资源。
     * @sideEffect 控制台输出日志。
     */
gameEngine.playAffinitySound = function(type) {
        // TODO: 实现好感度音效播放
        if (type === 'up') {
            console.log('播放好感度上升音效');
        } else if (type === 'down') {
            console.log('播放好感度下降音效');
        }
    };

