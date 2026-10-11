/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 场景流转与跳转控制模块。
 * 负责剧本在“行 → 标签 → 场景文件”之间的推进：包括统一跳转入口 goTarget
 * （区分同文件标签跳转与跨文件场景跳转）、快进/SKIP 模式、视频播放流程、
 * 章节/游戏结束与返回主菜单。
 * 跨文件跳转会同步落盘 f. 变量与场景入口快照，保证新页面正确继承状态。
 */


    /**
     * 开始快进模式
     * 按住 Ctrl 键或点击 SKIP 按钮时快速推进对话：立即执行一次 nextLine，
     * 随后每 50ms 自动执行一次。SKIP/2 模式在遇到选项时自动停止。
     * @param {number} [mode] - 快进档位：1=SKIP/1（普通快进），2=SKIP/2（选项处停止）；
     *                          缺省时沿用 this.state.skipMode
     * @returns {void}
     * @sideEffect 置位 state.fastForwardActive、创建 50ms 定时器、通知 systemModule 更新按钮、推进剧行
     */
gameEngine.startFastForward = function(mode) {
        mode = mode || this.state.skipMode || 1;
        if (this.state.fastForwardActive || this.state.choicesActive) return;
        
        this.state.fastForwardActive = true;
        console.log("开始快进...模式:", mode === 2 ? "SKIP/2" : "SKIP/1");
        
        // 通知systemModule更新SKIP按钮状态
        if (typeof systemModule !== 'undefined' && systemModule.updateSkipButton) {
            systemModule.updateSkipButton(mode);
        }
        
        // 立即执行一次
        this.nextLine();
        
        // 快进由统一节拍驱动（每累计 50ms 推进一次），
        // 与输入消费、打字机处在同一帧序里，避免与 rAF 抢时序。
        // 节拍缺失时退回 setInterval(50) 降级路径。
        var self = this;
        var acc = 0;
        var tickApi = (typeof window !== 'undefined') ? window.ShioriTick : null;
        if (tickApi && typeof tickApi.removeContinuousHandler === 'function' && this._skipTickStep) {
            tickApi.removeContinuousHandler(this._skipTickStep);
        }
        this._skipTickStep = function (tick, dt) {
            if (!self.state.fastForwardActive) return;
            acc += (dt > 0 ? dt : 16.7);
            if (acc < 50) return;
            var steps = Math.floor(acc / 50);
            acc -= steps * 50;
            for (var i = 0; i < steps; i++) {
                if (!self.state.fastForwardActive) return;
                // SKIP/2模式：检测到选项时停止
                if (self.state.skipMode === 2 && self.state.choicesActive) {
                    self.stopFastForward();
                    return;
                }
                self.nextLine();
            }
        };
        if (tickApi && typeof tickApi.addContinuousHandler === 'function') {
            tickApi.addContinuousHandler(this._skipTickStep);
        } else {
            this.state.fastForwardTimerId = setInterval(function () { self._skipTickStep(0, 50); }, 50);
        }
    };


    
    /**
     * 停止快进模式
     */
gameEngine.stopFastForward = function() {
        if (!this.state.fastForwardActive) return;
        
        this.state.fastForwardActive = false;
        this.state.skipMode = 0; // 重置SKIP模式
        
        // 先摘掉节拍里的快进 handler，再清降级定时器
        var tickApi = (typeof window !== 'undefined') ? window.ShioriTick : null;
        if (this._skipTickStep && tickApi && typeof tickApi.removeContinuousHandler === 'function') {
            tickApi.removeContinuousHandler(this._skipTickStep);
        }
        this._skipTickStep = null;
        if (this.state.fastForwardTimerId !== null) {
            clearInterval(this.state.fastForwardTimerId);
            this.state.fastForwardTimerId = null;
        }
        
        // 通知systemModule更新SKIP按钮状态
        if (typeof systemModule !== 'undefined' && systemModule.updateSkipButton) {
            systemModule.updateSkipButton(0);
        }
        
        // 清除sessionStorage中的快进状态key，防止页面重新加载时恢复快进
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('galgame_fast_forward');
        }
        
        console.log("停止快进");
    };


    
    /**
     * 切换SKIP模式
     * 行为规则：同档位再点 → 关闭快进；切换档位 → 先停当前快进再开新档位；
     * 开启 SKIP 前会先关闭 AUTO 模式（两者互斥）。
     * @param {number} mode - 1=SKIP/1（普通快进），2=SKIP/2（选项处停止）
     * @returns {void}
     * @sideEffect 修改 state.skipMode、可能调用 stopFastForward/startFastForward 与 systemModule.toggleAutoMode
     */
gameEngine.toggleSkipMode = function(mode) {
        console.log(`[SKIP] toggleSkipMode called, mode: ${mode}, current skipMode: ${this.state.skipMode}`);
        
        // 如果当前是同一种模式，则关闭
        if (this.state.skipMode === mode) {
            console.log(`[SKIP] Same mode clicked, stopping. mode: ${mode}`);
            this.stopFastForward();
            return;
        }
        
        // 如果当前有其他快进模式，先停止
        if (this.state.fastForwardActive) {
            console.log('[SKIP] Different mode clicked, stopping current fast forward first');
            this.stopFastForward();
        }
        
        // 如果要开启SKIP模式，先关闭AUTO模式（互斥）
        if (mode > 0 && typeof systemModule !== 'undefined' && systemModule.autoModeEnabled) {
            console.log('[SKIP] AUTO mode active, disabling it first');
            systemModule.toggleAutoMode();
        }
        
        // 设置新的快进模式
        this.state.skipMode = mode;
        console.log(`[SKIP] Starting fast forward with mode: ${mode === 2 ? 'SKIP/2' : 'SKIP/1'}`);
        this.startFastForward(mode);
    };


    
    /**
     * 处理选项的 target 跳转逻辑（统一走 goTarget）
     * 支持三种跳转方式：
     * 1. target: "#" — 不跳转，直接继续运行下一行
     * 2. target: "标签名" — 在本文件 story 数组中查找 [标签名] 并跳转
     * 3. target: "xxx.html" — 跳转到其他场景页面
     * @param {string} target - 选项的 target 值
     * @param {Object} choice - 可选，原始选项对象（用于调试日志）
     */
gameEngine.handleChoiceTarget = function(target, choice) {
        // 关闭选项菜单
        this.state.choicesActive = false;
        if (this.elements.optionsContainer) {
            this.elements.optionsContainer.style.display = 'none';
            this.elements.optionsContainer.innerHTML = '';
        }
        // 统一走 goTarget
        this.goTarget(target);
    };


    
    /**
     * 统一跳转入口：根据 target 形式决定跳转方式
     * - target 含 .html / / / \  → 跨文件导航（goToScene）
     * - target === "#"          → 不跳转，继续下一行
     * - 否则                    → 本文件标签跳转（jumpToLabel）
     * @param {string} target - 跳转目标
     * @returns {void}
     * @sideEffect 按分支调用 goToScene / jumpToLabel / nextLine
     */
gameEngine.goTarget = function(target) {
        // 空目标：视为无跳转，直接推进
        if (!target) {
            this.nextLine();
            return;
        }
        // "#" 为占位目标：表示“原地继续”，不跳转
        if (target === '#') {
            console.log('[goTarget] # 不跳转，继续运行下一行');
            this.nextLine();
            return;
        }
        // 判定是否为跨文件目标：含 .html 扩展名或路径分隔符（/ 或 \）
        var isUrl = /\.html/i.test(target) || target.indexOf('/') !== -1 || target.indexOf('\\') !== -1;
        if (isUrl) {
            this.goToScene(target);
            return;
        }
        // 其余情况视为同文件标签跳转
        this.jumpToLabel(target);
    };



    /**
     * 跳转到当前场景 story 数组中的指定标签位置
     * 查找 command: "[标签名]" 的行，从该行的下一行开始执行。
     * 边界处理：标签位于 story 末尾时按“场景结束”处理；未找到标签时告警并继续下一行。
     * @param {string} label - 标签名（不含方括号，区分大小写）
     * @returns {void}
     * @sideEffect 修改 state.currentLine，触发 nextLine 或 handleEndOfScene
     */
gameEngine.jumpToLabel = function(label) {
        if (!this.sceneData || !this.sceneData.story) {
            console.warn('[ChoiceTarget] 无法跳转：sceneData 或 story 数组不存在');
            this.nextLine();
            return;
        }

        var story = this.sceneData.story;
        var targetCommand = '[' + label + ']';

        // 精确查找 command === "[标签名]" 的行（trim 后全等匹配，避免误命中含该文本的普通行）
        for (var i = 0; i < story.length; i++) {
            var line = story[i];
            if (line.command && line.command.trim() === targetCommand) {
                // 找到标签，从下一行开始执行
                var nextLine = i + 1;
                console.log('[ChoiceTarget] 找到标签 "' + label + '" 在第 ' + i + ' 行，跳转到第 ' + nextLine + ' 行');

                if (nextLine < story.length) {
                    this.state.currentLine = nextLine - 1; // nextLine 内部会自动 +1
                    this.nextLine();
                } else {
                    console.warn('[ChoiceTarget] 标签 "' + label + '" 已是 story 数组末尾');
                    // 到达末尾，正常结束场景
                    this.state.currentLine = story.length;
                    this.handleEndOfScene();
                }
                return;
            }
        }

        // 未找到标签：容错处理，继续下一行而非抛出异常
        console.warn('[ChoiceTarget] 未找到标签 "' + label + '"（command: "' + targetCommand + '"），回退为继续下一行');
        this.nextLine();
    };



    /**
     * 查找标签锚点在 story 数组中的行号
     * （与 jumpToLabel 的查找逻辑一致：command.trim() === "[label]"）
     * @param {string} label - 标签名（不含方括号）
     * @returns {number} 行号；未找到返回 -1
     */
gameEngine.findLabelLine = function(label) {
        if (!this.sceneData || !this.sceneData.story || !label) return -1;
        var target = '[' + label + ']';
        for (var i = 0; i < this.sceneData.story.length; i++) {
            var line = this.sceneData.story[i];
            if (line && line.command && line.command.trim() === target) {
                return i;
            }
        }
        return -1;
    };


    
    /**
     * 跳转到指定场景（跨文件导航统一入口）
     * 导航前会完成三件事：
     * 1) 区分系统页面/游戏场景：系统页面先停止 SKIP/AUTO，游戏场景则落盘 f. 并写入跳转信号；
     * 2) 写入目标场景入口快照（供 saves/flowchart/story 等入口恢复 f.）；
     * 3) 停止音频、清 POV、保存状态快照后执行 location 跳转。
     * @param {string} sceneUrl - 目标场景的 URL（相对路径，如 "xxx.html" 或 "../scenes/xxx.html"）
     * @returns {void}
     * @sideEffect 操作 sessionStorage / localStorage、停止音频、清除 POV、清空页面并导航
     */
gameEngine.goToScene = function(sceneUrl) {
        // 判断目标是否为系统页面（非游戏场景页面）
        // 系统页面包括：主菜单 ../index.html 、html/ 目录下的存档/流程图/剧情页面等
        var isSystemPage = false;
        if (sceneUrl) {
            // 主菜单 ../index.html 或任何非 scenes/ 目录下的 index.html
            if (/\/index\.html$/i.test(sceneUrl) || /\\index\.html$/i.test(sceneUrl)) {
                isSystemPage = true;
            }
            // html/ 目录下的系统页面
            else if (sceneUrl.indexOf('/html/') !== -1 || sceneUrl.indexOf('\\html\\') !== -1) {
                isSystemPage = true;
            }
        }

        if (isSystemPage && typeof systemModule !== 'undefined' && systemModule.stopAllAutoSkipModes) {
            // 导航到系统页面前，停止所有SKIP/AUTO模式，防止新页面恢复状态
            systemModule.stopAllAutoSkipModes();
        }

        // ★ 跳转到游戏场景（非系统页面）时，立即把 f. 写入 sessionStorage 并设置跳转信号，
        // 确保新页面能正确继承 f.（不依赖 beforeunload，绕过 150ms 防抖）。
        if (!isSystemPage) {
            if (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.flushF) {
                VarSpace.flushF();
            }
            try {
                sessionStorage.setItem('shiori_next_scene_target', JSON.stringify({
                    target: sceneUrl,
                    fromScene: decodeURIComponent(window.location.pathname.split('/').pop()),
                    fromLine: this.state.currentLine,
                    timestamp: Date.now()
                }));
            } catch (e) {}

            // ★ 场景入口快照：所有“正常剧本流程离开本场景”的跨文件跳转
            //   （nextScene / choice / 静默分支）最终都汇聚到 goToScene，
            //   在此统一把当前 f. 记入目标场景的 shiori_scene_entry_<目标文件>（localStorage），
            //   供 saves.html / flowchart.html / story.html 等“从该场景开头播放”的入口恢复 f.。
            //   每次自然进入都会经过这里：f. 相同 → 不改动存档；不同 → 覆盖（可视为从不同选项/分支进入）。
            this.writeSceneEntrySnapshot(sceneUrl);
        }

        // 停止所有音频
        this.stopAllAudioWithBGM();
        // 清除POV状态
        this.clearPovState();
        // 保存当前游戏状态快照（用于恢复AUTO、SKIP等状态）
        this.saveStateSnapshot();
        // 跳转页面
        window.location.href = sceneUrl;
    };


    
    /**
     * 解析视频路径
     * 支持多种视频引用方式：
     * 1. 从 sceneData.videos 中查找（传统方式）
     * 2. 已解析过的路径命中 this.videoCache（缓存加速）
     * 3. 自动拼接 assets/video/ 路径（零配置方式）：完整路径直用、含扩展名拼接、
     *    否则默认补 .mp4（WebView2/Chromium 原生支持）
     * @param {string} videoKey - 视频键名或文件名（可含扩展名）
     * @returns {string|null} - 视频路径或 null（入参非法时）
     * @sideEffect 写入 this.videoCache 缓存解析结果
     */
gameEngine.resolveVideoPath = function(videoKey) {
        // 入参保护：非字符串或空值无法解析
        if (!videoKey || typeof videoKey !== 'string') {
            return null;
        }
        
        // 检查是否在 sceneData.videos 中定义（传统方式，优先级最高）
        if (this.sceneData.videos && this.sceneData.videos[videoKey]) {
            return this.sceneData.videos[videoKey];
        }
        
        // 尝试从缓存中获取
        if (this.videoCache[videoKey]) {
            return this.videoCache[videoKey];
        }
        
        // 零配置模式：自动拼接 assets/video/ 路径
        // 如果已经是完整路径（相对上级或绝对路径），直接返回并缓存
        if (videoKey.startsWith('../') || videoKey.startsWith('/')) {
            this.videoCache[videoKey] = videoKey;
            return videoKey;
        }
        
        const basePath = '../assets/video/';
        
        // 如果文件名包含扩展名，直接使用
        if (videoKey.includes('.')) {
            const fullPath = basePath + videoKey;
            this.videoCache[videoKey] = fullPath;
            return fullPath;
        }
        
        // 统一使用 .mp4 格式（WebView2/Chromium 完美支持）
        const preferredPath = basePath + videoKey + '.mp4';
        console.log('[Video] resolveVideoPath:', videoKey, '→', preferredPath);
        this.videoCache[videoKey] = preferredPath;
        
        return preferredPath;
    };


    

    /**
     * 播放视频（使用HTML原生video标签播放）
     * 委托给 playVideoNative 执行具体加载与播放；本函数只做能力校验与返回值语义。
     * @param {string} videoKey - 视频键名，从场景数据的 videos 中查找或直接使用文件名
     * @returns {boolean} - true=已开始播放（阻塞当前行，由 ended 事件推进）；false=播放器缺失
     * @sideEffect 触发视频加载播放、暂停 BGM、绑定 ended/error/右键跳过等事件
     */
gameEngine.playVideo = function(videoKey) {
        console.log('[Video] playVideo 被调用, videoKey:', videoKey);
        
        if (!this.elements.videoPlayer) {
            console.error('[Video] videoPlayer元素不存在');
            return false;
        }
        
        this.playVideoNative(videoKey);
        
        // 视频开始播放，阻塞当前行
        return true;
    };


    
    /**
     * HTML环境：使用原生video标签播放视频
     * 完整流程：路径解析 → 暂停 BGM → 设置 src 并显示播放器 → 绑定错误/结束事件 →
     * 调用 play()（被浏览器策略拒绝时静默跳过）→ 注册跳过快捷键。
     * @param {string} videoKey - 视频键名或文件名
     * @returns {void}
     * @sideEffect 操作 video 元素与 BGM、绑定/解绑 DOM 事件、可能调用 skipVideo/nextLine
     */
gameEngine.playVideoNative = function(videoKey) {
        // 播放器元素缺失时无法播放
        if (!this.elements.videoPlayer || !this.elements.mainVideo) {
            console.error('[Video] videoPlayer或mainVideo元素不存在');
            return;
        }
        
        // 使用路径解析函数
        const videoPath = this.resolveVideoPath(videoKey);
        
        if (!videoPath) {
            console.error('[Video] 无法解析视频路径:', videoKey);
            return;
        }
        
        console.log('[Video] 开始加载视频:', videoKey, '路径:', videoPath);
        
        // 停止当前 BGM 播放（视频播放期间不应有背景音乐干扰）
        const bgmPlayer = this.elements.bgmPlayer;
        if (bgmPlayer && !bgmPlayer.paused) {
            bgmPlayer.pause();
            bgmPlayer.currentTime = 0;
        }
        
        // 设置视频源
        this.elements.mainVideo.src = videoPath;
        
        // 显示视频播放器
        this.elements.videoPlayer.style.display = 'block';
        
        const self = this;
        
        // 监听视频加载错误：打详细诊断日志后跳过视频，避免流程卡死
        this.elements.mainVideo.onerror = function(e) {
            console.error('[Video] 视频加载错误:', e);
            console.error('[Video] 视频错误代码:', self.elements.mainVideo.error ? self.elements.mainVideo.error.code : 'N/A');
            console.error('[Video] 视频错误信息:', self.elements.mainVideo.error ? self.elements.mainVideo.error.message : 'N/A');
            console.error('[Video] 视频当前src:', self.elements.mainVideo.currentSrc);
            console.error('[Video] 视频网络状态:', self.elements.mainVideo.networkState);
            // 加载失败，跳过视频
            self.skipVideo();
        };
        
        // 添加视频播放结束事件监听器（一次性：结束后解绑并推进剧本）
        const onVideoEnded = function() {
            self.elements.mainVideo.removeEventListener('ended', onVideoEnded);
            self.elements.mainVideo.removeEventListener('error', self.elements.mainVideo.onerror);
            self.elements.videoPlayer.style.display = 'none';
            self.nextLine();
        };
        this.elements.mainVideo.addEventListener('ended', onVideoEnded);
        
        // 尝试播放视频（自动播放被策略拒绝时按跳过处理，保证流程可持续）
        this.elements.mainVideo.play().catch(e => {
            console.error('[Video] 播放失败:', e.name, e.message);
            self.skipVideo();
        });
        
        // 设置跳过视频的快捷键
        this.setupVideoSkip();
    };


    
    /**
     * 设置视频跳过功能
     * 右键点击跳过视频（事件自身处理，不冒泡到 body 的“呼出上下文菜单”逻辑）。
     * ESC 跳过视频由 bindEvents 的主 keydown 统一处理（避免与呼出菜单重复触发）。
     */
gameEngine.setupVideoSkip = function() {
        const self = this;
        
        // 右键点击跳过
        // 注意：skipVideo 会同步隐藏播放器，若事件继续冒泡到 body，
        // 会导致 body 的“右键呼出/收起上下文菜单”逻辑误判（以为非视频状态）。
        // 因此这里阻止冒泡，右键跳过视频由本 handler 独立完成。
        this.elements.videoPlayer.oncontextmenu = function(e) {
            e.preventDefault();
            e.stopPropagation();
            self.skipVideo();
        };
    };


    
    /**
     * 跳过视频
     * 隐藏视频播放器、暂停并复位播放进度，然后推进到下一行。
     * 仅在播放器与视频元素均存在时生效（否则静默返回，避免重复推进）。
     * @returns {void}
     * @sideEffect 修改 DOM 显示、暂停并回退视频、调用 nextLine
     */
gameEngine.skipVideo = function() {
        if (this.elements.videoPlayer && this.elements.mainVideo) {
            this.elements.videoPlayer.style.display = 'none';
            this.elements.mainVideo.pause();
            this.elements.mainVideo.currentTime = 0;
            
            // 继续下一行
            this.nextLine();
        }
    };


    
    /**
     * 游戏结束（带淡出效果）
     * @param {string} bgColor - 淡出背景颜色
     * @param {number} duration - 淡出持续时间
     */
gameEngine.finishGame = function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 同步调试日志状态（虽然只是隐藏，但为了保持一致性）
        this.syncDebugCharsState();
        
        // 执行淡出效果，完成后自动进入下一行
        this.fadeOut(duration || 1500, bgColor || 'black', () => {
            setTimeout(() => {
                this.nextLine();
            }, 50);
        });
    };


    
    /**
     * 游戏结束（无转场效果）
     * 与 finishGame 的清理逻辑一致，但直接创建不透明的覆盖层（无淡入淡出），
     * 按时长后推进下一行。
     * @param {string} [bgColor='black'] - 覆盖层背景颜色
     * @param {number} [duration=1500] - 覆盖层停留时长（毫秒）
     * @returns {void}
     * @sideEffect 向 document.body 追加 #fade-overlay 元素、推进剧行
     */
gameEngine.finishGameNoTransition = function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 同步调试日志状态
        this.syncDebugCharsState();
        
        // 创建覆盖层，直接显示不淡出（整屏遮挡）
        const overlay = document.createElement('div');
        overlay.id = 'fade-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = bgColor || 'black';
        overlay.style.zIndex = '999';
        overlay.style.opacity = '1';
        document.body.appendChild(overlay);
        
        setTimeout(() => {
            this.nextLine();
        }, duration || 1500);
    };


    
    /**
     * 章节结束
     * 清理 UI 后执行淡出，淡出完成延时 100ms 返回主菜单。
     * @param {string} [bgColor='black'] - 淡出背景颜色
     * @param {number} [duration=1500] - 淡出持续时间（毫秒）
     * @returns {void}
     * @sideEffect 隐藏文本框/角色、执行淡出动画、调用 returnToMenu 导航
     */
gameEngine.chapterEnd = function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 淡出后返回主菜单
        this.fadeOut(duration || 1500, bgColor || 'black', () => {
            setTimeout(() => {
                this.returnToMenu();
            }, 100);
        });
    };


    
    /**
     * 返回主菜单
     * 保存进度、清除POV状态，然后跳转到index.html
     */
gameEngine.returnToMenu = function() {
        this.markSceneCompleted();
        
        this.clearPovState();
        
        // 清除状态快照（返回主菜单时不需要恢复AUTO/SKIP状态）
        sessionStorage.removeItem('gameStateSnapshot');
        console.log('[State] Cleared state snapshot before returning to menu');
        
        // 延迟跳转以确保音频停止
        setTimeout(() => {
            this.stopAllAudioWithBGM();
            window.location.href = '../index.html';
        }, 1000); 
    };


    
    /**
     * 检查当前页面是否位于 scenes/ 目录内
     * 用于过滤非场景页面（如 html/ 目录下的 CG.html、archive.html、saves.html 等系统页面），
     * 避免它们被错误地写入游戏进度（completedScenes / sceneMarkers）。
     * 浏览器中 window.location.pathname 始终使用正斜杠分隔，即使在 Windows 下也会归一化。
     * @returns {boolean} - 当前页面是否在 scenes/ 目录内
     * @sideEffect 无（只读当前 location）
     */
gameEngine.isInScenesFolder = function() {
        const path = decodeURIComponent(window.location.pathname || '');
        return path.indexOf('/scenes/') !== -1;
    };

