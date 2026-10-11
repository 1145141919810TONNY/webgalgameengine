/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 文本显示与打字机效果，处理文本行渲染、分段、选择支、ruby 注音等。
 *
 * 本文件是 Shiori 引擎的「文本与演出主循环」模块，向 gameEngine 原型挂载以下职责：
 *  1. displayLine / nextLine：逐行推进剧本，逐条派发文本、音频、背景、立绘、命令与动作；
 *  2. typeText / typeTextAppend / displayTextSegment：打字机效果与 [s] 分段点击继续；
 *  3. processRubyText / processLineBreaks：注音（ruby）与换行标记的富文本预处理；
 *  4. showChoices / calculateChoicePosition：选择支按钮渲染与静默分支求值入口；
 *  5. 文本框、姓名框、POV 指示器等 UI 状态的显隐控制。
 */


    
    /**
     * 判断给定 DOM 元素是否位于选项按钮容器（#options-container）内部。
     *
     * 用途：全局点击/键盘处理器据此区分「点击选项按钮」与「点击推进剧情」，
     * 避免用户在选择支上点击时被误判为推进到下一行。
     *
     * @param {HTMLElement} element - 要检查的 DOM 元素（可能为 null/undefined）。
     * @returns {boolean} - 该元素或其任一祖先为 #options-container 时返回 true。
     */
gameEngine.isOptionElement = function(element) {
        return element.closest('#options-container') !== null;
    };


    
    
    /**
     * 显示指定行的对话内容（剧本主循环的核心派发函数）。
     *
     * 处理逻辑按顺序如下：
     *  1. 越界检测：index 超出剧本长度时调用 handleEndOfScene 并返回；
     *  2. 标签锚点追踪：记录最近的纯名字标签，供剧本热更新后的定位兜底；
     *  3. 转场预检：提前识别 background 中的转场指令，尽早启动输入屏蔽；
     *  4. 条件跳过：shouldSkipLine 为真时仅更新行号并异步推进；
     *  5. 文本/姓名渲染：非转场且存在可见文本时显示对话框并启动打字机；
     *  6. 依次派发 audio / se / background / bgm / video / command / action / chars；
     *  7. 阻塞判定与状态快照：阻塞命令或跳转发生时提前返回，否则更新行号并保存快照。
     *
     * 副作用：会修改 this.state 中大量字段（currentLine、textFullyDisplayed、
     * isBackgroundTransitioning、nearestLabel 等），并可能触发 DOM 更新、音频播放、
     * 以及通过 systemModule 写入日志。当行内包含视频或转场时，函数可能在派发
     * 途中提前 return，不会执行到行号更新。
     *
     * @param {number} index - 要显示的剧本行索引（this.sceneData.story 的下标）。
     * @returns {void}
     */
gameEngine.displayLine = function(index) {
        // 检查是否到达场景末尾
        if (index >= this.sceneData.story.length) {
            console.log("故事结束或到达场景末尾");
            this.handleEndOfScene();
            return;
        }

        // 记录执行前的 currentLine，用于结尾跳转检测
        // 如果 action 执行中 currentLine 被改变（跳转），则不覆盖
        var lineIndexBefore = this.state.currentLine;

        const line = this.sceneData.story[index];

        // ★ 追踪最近的标签锚点（command: "[xxx]" 形式，剧本更新后定位兜底）
        // 仅追踪"纯名字标签"（不含空格、=），排除 [wait click] / [fadeout time=1000] 等控制指令
        if (line.command && typeof line.command === 'string') {
            var _cmdTrim = line.command.trim();
            var _labelMatch = _cmdTrim.match(/^\[([^\]\s=]+)\]$/);
            if (_labelMatch) {
                this.state.nearestLabel = _labelMatch[1];
                this.state.nearestLabelLine = index;
            }
        }

        // ── 转场预检 ───────────────────────────────────────────────
        // 在获取行数据后立即检测转场指令（fade/slideL/slideR/scanL/scanR，含中文别名），
        // 尽早启动输入屏蔽，防止转场动画期间用户点击导致的竞态；
        // 屏蔽标志 isBackgroundTransitioning 会在后续真正执行转场时再次被设置。
        let isTransitionEarly = false;
        let transitionTypeEarly = 'fade';
        if (line.background && typeof line.background === 'string') {
            if (line.background.startsWith('trans ') || line.background.startsWith('转场 ')) {
                isTransitionEarly = true;
                transitionTypeEarly = 'fade';
            } else if (line.background.startsWith('slideL ') || line.background.startsWith('左滑 ')) {
                isTransitionEarly = true;
                transitionTypeEarly = 'slideL';
            } else if (line.background.startsWith('slideR ') || line.background.startsWith('右滑 ')) {
                isTransitionEarly = true;
                transitionTypeEarly = 'slideR';
            } else if (line.background.startsWith('scanL ') || line.background.startsWith('左转场 ')) {
                isTransitionEarly = true;
                transitionTypeEarly = 'scanL';
            } else if (line.background.startsWith('scanR ') || line.background.startsWith('右转场 ')) {
                isTransitionEarly = true;
                transitionTypeEarly = 'scanR';
            }
            
            // 一旦检测到转场指令，立即设置屏蔽标志（最早可能的时机）
            if (isTransitionEarly) {
                this.state.isBackgroundTransitioning = true;
                console.log(`[最早屏蔽] 在 displayLine 开始处检测到转场(${transitionTypeEarly})，立即启动输入屏蔽`);
            }
        }
        
        // 重置文本完整显示标志
        this.state.textFullyDisplayed = false;
        
        // 检查当前行是否应该被跳过（基于条件判断）
        if (this.shouldSkipLine(index)) {
            this.state.currentLine = index;
            setTimeout(() => {
                this.nextLine();
            }, 10);
            return;
        }
        
        // line 已在函数开始处声明，此处无需重复声明

        // 提前检测是否为转场指令，如果是则跳过本行的文本和姓名渲染
        let isTransition = false;
        if (line.background && typeof line.background === 'string') {
            if (line.background.startsWith('trans ') || line.background.startsWith('转场 ')) {
                isTransition = true;
            } else if (line.background.startsWith('slideL ') || line.background.startsWith('左滑 ')) {
                isTransition = true;
            } else if (line.background.startsWith('slideR ') || line.background.startsWith('右滑 ')) {
                isTransition = true;
            } else if (line.background.startsWith('scanL ') || line.background.startsWith('左转场 ')) {
                isTransition = true;
            } else if (line.background.startsWith('scanR ') || line.background.startsWith('右转场 ')) {
                isTransition = true;
            }
        }

        // 检测是否为纯命令行（只有 command 属性，没有可见文本）
        // 空/空白 text（如 index/CG 的 BGM 行）也视为无对白，必须藏框，否则 style.css 的 flex 会露出底边黑条。
        const hasVisibleText = (typeof this.lineHasVisibleText === 'function')
            ? this.lineHasVisibleText(line)
            : !!(line && typeof line.text === 'string' && line.text.trim());
        const isPureCommand = line.command && !hasVisibleText;

        // ── 表现层渲染：有可见文本且非转场行 ───────────────────────
        // 只有在非转场行且有可见文本时才立即渲染文本和姓名。
        // 注意：空文本行会走 hideTextBox() 分支，避免 style.css 的 flex 布局露出底边黑条。
        if (!isTransition && hasVisibleText) {
            // 空文本曾 hideTextBox 写成 inline none；有对白时必须恢复，但不能拆掉 [msgoff]/小说模式。
            if (!this.state.novelMode && !this.state.msgOff) {
                this.showTextBox();
            }
            // 设置说话者姓名。统一走 applySpeakerLabel：名片与小头像必须同源，
            // 否则转场恢复 / 系统提示那几条旁路会让头像停留在上一个说话人身上。
            this.applySpeakerLabel(line.speaker);

            // 记录对话到日志（通过systemModule）
            if (typeof systemModule !== 'undefined' && systemModule.addLogEntry) {
                systemModule.addLogEntry({
                    speaker: line.speaker,
                    text: line.text,
                    audio: line.audio // 传递音频数据
                });
            }

            // 显示文本（支持分段和打字机效果）
            this.typeTextWithSplits(line.text);
        } else {
            if (!hasVisibleText) this.hideTextBox();
            if (isPureCommand || !hasVisibleText) {
                if (line.speaker === null || line.speaker === undefined) {
                    this.applySpeakerLabel(null);
                }
            }
        }
        
        // ── 音频派发 ───────────────────────────────────────────────
        // 解析并播放音频序列，支持三种形态：
        //   1. 'stop'           → 立即停止当前语音；
        //   2. 含 [wait time]   → 交给 executeAudioSequence 按时间轴异步播放；
        //   3. 含 [a]           → 拆分为多段，随分段点击逐段切换。
        if (line.audio && typeof line.audio === 'string') {
            // 支持 stop 指令
            if (line.audio === 'stop') {
                this.stopAudio();
            } else {
                const audioWaitSegments = this.parseWaitTaggedString(line.audio);
                if (audioWaitSegments) {
                    this.executeAudioSequence(audioWaitSegments);
                } else if (line.audio.includes('[a]')) {
                    this.state.audioSegments = this.parseAudioSequence(line.audio);
                    this.state.currentAudioSegment = 0;
                    if (this.state.audioSegments.length > 0) {
                        this.playAudio(this.state.audioSegments[0]);
                    }
                } else {
                    this.playAudio(line.audio);
                }
            }
        }
        
        // ── 音效派发 ───────────────────────────────────────────────
        // 播放音效（SE）走独立音频通道，与语音/ BGM 互不干扰；
        // 支持 'stop'、字符串数组批量播放，以及 [wait time] / [a] 组合序列。
        if (line.se) {
            if (line.se === 'stop') {
                // 支持 stop 指令
                this.stopSE();
            } else if (Array.isArray(line.se)) {
                line.se.forEach(seKey => {
                    this.playSE(seKey);
                });
            } else if (typeof line.se === 'string') {
                const seWaitSegments = this.parseWaitTaggedString(line.se);
                if (seWaitSegments) {
                    this.executeSESequence(seWaitSegments);
                } else if (line.se.includes('[a]')) {
                    const seSegments = this.parseAudioSequence(line.se);
                    seSegments.forEach(seKey => {
                        this.playSE(seKey);
                    });
                } else {
                    this.playSE(line.se);
                }
            }
        }
        
        // ── 背景派发 ───────────────────────────────────────────────
        // 切换背景图片。若含 [wait time] 标签则交给 executeBackgroundSequence 异步执行；
        // 否则解析目标背景 id（支持 背景表 sceneData.background 与 CG_CONFIG_SUB 两套来源），
        // 普通切换直接 setBackground，转场则调用 performBackgroundTransition 并提前 return，
        // 让转场动画独占本行的后续流程（由转场完成回调再推进剧情）。
        if (line.background) {
            const bgWaitSegments = this.parseWaitTaggedString(line.background);
            if (bgWaitSegments) {
                this.executeBackgroundSequence(bgWaitSegments, line);
            } else {
                let bgPath = null;
                let isTransition = false;
                let transitionType = 'fade';
                let targetBgId = null;

                if (typeof line.background === 'string') {
                    if (line.background.startsWith('trans ') || line.background.startsWith('转场 ')) {
                        isTransition = true;
                        transitionType = 'fade';
                        targetBgId = line.background.replace(/^(trans|转场)\s+/, '').trim();
                    } else if (line.background.startsWith('slideL ') || line.background.startsWith('左滑 ')) {
                        isTransition = true;
                        transitionType = 'slideL';
                        targetBgId = line.background.replace(/^(slideL|左滑)\s+/, '').trim();
                    } else if (line.background.startsWith('slideR ') || line.background.startsWith('右滑 ')) {
                        isTransition = true;
                        transitionType = 'slideR';
                        targetBgId = line.background.replace(/^(slideR|右滑)\s+/, '').trim();
                    } else if (line.background.startsWith('scanL ') || line.background.startsWith('左转场 ')) {
                        isTransition = true;
                        transitionType = 'scanL';
                        targetBgId = line.background.replace(/^(scanL|左转场)\s+/, '').trim();
                    } else if (line.background.startsWith('scanR ') || line.background.startsWith('右转场 ')) {
                        isTransition = true;
                        transitionType = 'scanR';
                        targetBgId = line.background.replace(/^(scanR|右转场)\s+/, '').trim();
                    }
                    
                    if (isTransition) {
                        this.state.isBackgroundTransitioning = true;
                        console.log(`[前置屏蔽] 检测到转场指令(${transitionType})，立即启动输入屏蔽`);
                    }
                }

                if (!isTransition) {
                    if (this.sceneData.background[line.background]) {
                        bgPath = this.sceneData.background[line.background];
                    } else if (typeof CG_CONFIG_SUB !== 'undefined' && CG_CONFIG_SUB[line.background]) {
                        bgPath = CG_CONFIG_SUB[line.background];
                    }
                } else {
                    if (this.sceneData.background[targetBgId]) {
                        bgPath = this.sceneData.background[targetBgId];
                    } else if (typeof CG_CONFIG_SUB !== 'undefined' && CG_CONFIG_SUB[targetBgId]) {
                        bgPath = CG_CONFIG_SUB[targetBgId];
                    }
                }
                
                if (bgPath) {
                    if (isTransition) {
                        this.performBackgroundTransition(bgPath, line, transitionType);
                        return;
                    } else {
                        this.setBackground(bgPath);
                    }
                }
            }
        }
        
        // ── BGM 派发 ───────────────────────────────────────────────
        // 支持四种写法：bgm stop（停止）、'bgm wait <key>'（淡出后播放新曲）、
        // 普通 key（直接播放）、含 [wait time] 的序列（异步执行）。
        if (line.bgm) {
            const bgmWaitSegments = this.parseWaitTaggedString(line.bgm);
            console.log('[BGM] 原始值:', line.bgm, '解析结果:', bgmWaitSegments);
            if (bgmWaitSegments) {
                this.executeBgmSequence(bgmWaitSegments);
            } else {
                if (line.bgm === 'bgm stop') {
                    this.stopBGM();
                } else if (typeof line.bgm === 'string' && line.bgm.startsWith('bgm wait ')) {
                    const newBgmKey = line.bgm.substring('bgm wait '.length).trim();
                    this.fadeOutAndPlayBGM(newBgmKey);
                } else if (this.sceneData.bgm && this.sceneData.bgm[line.bgm]) {
                    this.playAudio(line.bgm);
                }
            }
        }
        
        // ── 视频派发 ───────────────────────────────────────────────
        // 播放视频（playVideo 内部会自动解析路径）。
        // 视频为强阻塞：播放成功时直接 return，本行不再推进；
        // 播放失败（环境不匹配）时返回 false，继续执行后续流程。
        if (line.video) {
            const isPlaying = this.playVideo(line.video);
            if (isPlaying) {
                return; // 视频开始播放，阻塞当前行，等待视频结束后再进入下一行
            }
            // 如果isPlaying为false，说明环境不匹配，继续执行下一行
        }
        
        // ── 命令派发（DSL 指令）────────────────────────────────────
        // 解析并执行标签命令（如 [s]、[wait]、[off] 等）。
        // 首先通过 resolveDslNodes 取得已编译的 AST 节点；若调用方未提供，
        // 则回退到 window.__shiori.dsl.compile 现场编译，以判定是否含
        // 「需要按时间轴顺序执行」的节点（wait time / off / background time=），
        // 从而决定走 executeCommandSequence（顺序序列）还是 executeCommand（即时执行）。
        // hasBlockingCommand 表示存在需用户交互或异步完成的阻塞指令，
        // hasWaitTimeCommand 则标记该阻塞来自 [wait time]，后者不阻止行推进。
        let hasBlockingCommand = false;
        let hasWaitTimeCommand = false;
        if (line.command) {
            const shouldAutoNext = !line.action;
            const cmdNodes = typeof this.resolveDslNodes === 'function'
                ? this.resolveDslNodes(line.command, line)
                : [];
            let useWaitSequence = line.command.includes('[wait time=');
            // 判定单个 AST 节点是否必须走顺序执行序列
            const nodeNeedsSequence = function (n) {
                if (!n) return false;
                if (n.kind === 'wait' && n.mode === 'time') return true;
                if (n.kind !== 'inst') return false;
                var cmd = String(n.cmd || '').toLowerCase();
                if (cmd === 'off') return true;
                if (cmd === 'background' && n.kv && n.kv.time != null && n.kv.time !== '') return true;
                return false;
            };
            if (cmdNodes.length) {
                useWaitSequence = cmdNodes.some(nodeNeedsSequence);
            } else {
                const dsl = (typeof window === 'object' && window && window.__shiori && window.__shiori.dsl) ? window.__shiori.dsl : null;
                if (dsl && typeof dsl.compile === 'function') {
                    const compiled = (dsl.compile(line.command).nodes) || [];
                    useWaitSequence = compiled.some(nodeNeedsSequence);
                }
            }
            if (useWaitSequence) {
                hasWaitTimeCommand = true;
                hasBlockingCommand = this.executeCommandSequence(line.command, shouldAutoNext, cmdNodes);
            } else {
                hasBlockingCommand = this.executeCommand(line.command, shouldAutoNext, cmdNodes);
            }
        }
        
        // ── 动作派发（action）──────────────────────────────────────
        // 处理动作指令（如背景切换、特效等）。
        // action 为数组时表示一条 else-if 链：按序求值，首个命中项被执行，其余项整体跳过；
        // 数组项自身的动作体可以是任意 action（含 choice），所以各分支的后续可以完全不同。
        // command 与 action 可同时存在，执行顺序固定为：先 command，再 action。
        // 若实际执行的动作是 choice 类型，则强制标记为阻塞，等待用户完成选择。
        var resolvedAction = null;
        if (line.action) {
            var resolved = this.resolveLineAction(line.action, index);
            if (resolved.all) {
                // 开发者全开：列出全部组合，点哪条走哪条
                this.showActionChain(resolved.all);
                hasBlockingCommand = true;
            } else if (resolved.action) {
                resolvedAction = resolved.action;
                this.handleAction(resolvedAction);
                if (resolvedAction.type === 'choice') {
                    hasBlockingCommand = true; // 选项需要等待用户选择
                }
            }
        }
        
        // ── 立绘派发（chars）────────────────────────────────────────
        // 处理立绘指令，[wait time] command 不阻塞 chars 处理。
        // 背景转场进行中时跳过立绘渲染，避免与转场动画产生视觉与状态冲突。
        if (line.chars) {
            if (!this.state.isBackgroundTransitioning) {
                const charWaitSegments = this.parseCharWaitSequence(line.chars);
                if (charWaitSegments) {
                    this.executeCharWaitSequence(charWaitSegments);
                } else {
                    this.renderChars(line.chars);
                }
            }
        }
        
        // 如果执行了阻塞性命令（如动画、选项等），不自动进入下一行
        // 注意：[wait time] command 不阻塞行处理，因为它有自己的异步处理逻辑
        if (hasBlockingCommand && !hasWaitTimeCommand) {
            return;
        }

        // ── 跳转检测（边界处理）────────────────────────────────────
        // nextScene action 执行后 currentLine 已被 jumpToLabel/goToScene 改变，
        // 此时若继续覆盖 currentLine，会把刚跳转到的目标行号冲掉，
        // 因此检测到行号变化时直接返回，且不保存快照。
        if (resolvedAction && resolvedAction.type === 'nextScene' && this.state.currentLine !== lineIndexBefore) {
            return;
        }

        // 更新当前行号
        this.state.currentLine = index;

        // 更新调试日志信息（如果系统模块已加载）
        if (typeof systemModule !== 'undefined' && systemModule.updateDebugInfo) {
            systemModule.updateDebugInfo();
        }
        // 同步刷新 F2 变量观察面板（如果可见）
        if (typeof systemModule !== 'undefined' && systemModule.updateVarsInfo) {
            systemModule.updateVarsInfo();
        }

        // 自动保存游戏状态快照（用于存档功能）
        this.saveStateSnapshot();
    };


    
    /* ===== 选项的状态反馈与"已读"标记=================================
       CHOICE_READ_MARK 开关：作者可在引入 engine_text.js 之前设
       `window.CHOICE_READ_MARK = false` 关闭已读标记。
       开启后，玩家选过的分支在下一周目会带 `.choice-read`，从而命中 choice 部件的
       `_on` 图（`--ui-choice-on`）。记录写在 state.readChoices：
            键 = 场景文件名 # 行号 # 选项下标
       用「场景+行号+下标」而不是选项文案做键 —— 改文案不会让已读记录失配。
       记录随 gameProgress 一起持久化（与 completedScenes 同期）。
       ======================================================================= */
    var CHOICE_READ_MARK = (typeof window !== 'undefined' && typeof window.CHOICE_READ_MARK !== 'undefined')
        ? !!window.CHOICE_READ_MARK
        : true;
    // 点击选项后的跳转反馈窗口（毫秒）：先亮 .choice-selected 让玩家看见选中再跳页。
    // 0 = 立即跳页（关掉反馈）。这段时间里 choicesActive 仍为 true，所以点其它地方
    // 不会推进剧情（handleAdvanceClick 有 choicesActive 守卫）。
    var CHOICE_FEEDBACK_MS = 120;

    /** 构造某个选项的唯一键（跨会话稳定） */
gameEngine.choiceReadKey = function(index) {
        var page = (typeof location !== 'undefined' && location.pathname)
            ? String(location.pathname).split('/').pop() : '';
        return page + '#' + this.state.currentLine + '#' + index;
    };

    /**
     * 该选项是否被玩家选过（已读）
     * @param {number} index 选项下标
     * @returns {boolean}
     */
gameEngine.isChoiceRead = function(index) {
        if (!CHOICE_READ_MARK) return false;
        var marks = this.state.readChoices;
        return !!(marks && marks[this.choiceReadKey(index)]);
    };

    /**
     * 记下该选项被选过。首次记录时立刻落盘一次，避免每次点击都写 localStorage。
     * @param {number} index 选项下标
     * @returns {void}
     */
gameEngine.markChoiceRead = function(index) {
        if (!CHOICE_READ_MARK) return;
        if (!this.state.readChoices) this.state.readChoices = {};
        var key = this.choiceReadKey(index);
        if (this.state.readChoices[key]) return;
        this.state.readChoices[key] = 1;
        if (typeof this.saveProgress === 'function') this.saveProgress();
    };

    /**
     * 显示选项菜单（集成式分支 DSL）
     * 支持两种模式：
     * 1. 交互模式（默认）：choices 中 text 非空 → 显示按钮，点击后 applyAffinity + goTarget
     * 2. 静默模式：action.silent === true 或 choices 的 text 全空 → 不显示按钮，
     *    引擎按序求值（if/else-if），首个命中即 applyAffinity + goTarget
     * @param {Array} choices - 选项数组，每项可含 { text, target, flag, add, when }
     * @param {Object} action  - 可选，含 silent 标志
     */
gameEngine.showChoices = function(choices, action) {
        // 静默模式判定：显式 action.silent === true，
        // 或所有选项的 text 均为空（视为纯逻辑分支，无需 UI 交互）。
        var silent = (action && action.silent === true) || false;
        if (!silent) {
            // 检查 choices 的 text 是否全空
            var allEmpty = choices.every(function(c) {
                return !c.text || String(c.text).trim() === '';
            });
            if (allEmpty && choices.length > 0) silent = true;
        }

        if (silent) {
            // 开发者全开：不静默求值，把每条选项列成按钮，点哪条走哪条
            if (this.isAllClear()) {
                this.showSilentChoicesAllClear(choices);
                return;
            }
            this.resolveSilentBranch(choices);
            return;
        }

        // 交互模式：清空容器并逐个渲染选项按钮
        this.state.choicesActive = true;
        this.elements.optionsContainer.innerHTML = '';

        choices.forEach((choice, index) => {
            const button = document.createElement('button');
            // 二周目读过的分支加 .choice-read（走 choice 的 `_on` 图）
            const readMark = this.isChoiceRead(index);
            button.className = readMark ? 'choice-btn choice-read' : 'choice-btn';
            button.textContent = choice.text;
            button.dataset.target = choice.target;

            // 设置选项按钮位置（由CSS Grid控制）
            button.style.gridArea = this.calculateChoicePosition(index, choices.length);

            // 选项点击处理：阻止冒泡以免被全局点击推进剧情；
            // 先结算好感度（flag + add），再执行导演跳转。
            // 跳转前留 CHOICE_FEEDBACK_MS 的反馈窗口（.choice-selected 亮起）。
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                if (button.dataset.choiceLocked === '1') return;   // 反馈窗口内重复点击无效
                button.dataset.choiceLocked = '1';
                if (button.classList && button.classList.add) button.classList.add('choice-selected');
                // 记下"这个分支选过了"（下一周目走已读态）
                this.markChoiceRead(index);
                // 应用好感度变化（如有 flag + add）
                if (choice.flag && choice.flag !== '#' && choice.add !== undefined && choice.add !== null) {
                    this.applyAffinity(choice.flag, choice.add);
                    // 触发演出（非阻塞，不调用 nextLine）
                    this.playAffinityEffect(choice.flag, Number(choice.add));
                }
                // 跳转
                if (CHOICE_FEEDBACK_MS > 0) {
                    setTimeout(() => { this.handleChoiceTarget(choice.target, choice); }, CHOICE_FEEDBACK_MS);
                } else {
                    this.handleChoiceTarget(choice.target, choice);
                }
            });

            this.elements.optionsContainer.appendChild(button);
        });

        this.elements.optionsContainer.style.display = 'grid';
    };

    /**
     * 由分支项拼出按钮文字（仅在项自身没有文案时使用）
     * 规则：label 优先；否则「when 原文 → 去向」；无 when 时只写去向。
     * @param {Object} entry - 分支项
     * @returns {string} 按钮文字
     */
gameEngine.branchButtonLabel = function(entry) {
        if (entry && entry.label) return String(entry.label);
        var dest = this.branchDestinationText(entry);
        var when = (entry && entry.when) ? String(entry.when).trim() : '';
        return when ? (when + ' → ' + dest) : dest;
    };

    /**
     * 分支项的去向文字：选项类显示选项条数，其余显示 target 原值
     * @param {Object} entry - 分支项
     * @returns {string} 去向文字
     */
gameEngine.branchDestinationText = function(entry) {
        if (!entry) return '（空）';
        if (entry.type === 'choice' && Array.isArray(entry.choices)) {
            return '选项组(' + entry.choices.length + ' 项)';
        }
        if (entry.target !== undefined && entry.target !== null && entry.target !== '') {
            return String(entry.target);
        }
        return entry.type ? String(entry.type) : '（无去向）';
    };

    /**
     * 把分支项逐条渲染成按钮（开发者全开时的统一渲染入口）
     * 按钮文字优先取项自身的 text，没有 text 时才用分支文字规则拼。
     * @param {Array} entries - 分支项数组
     * @param {Function} onPick - 点击回调，参数 (entry, index)
     * @returns {void}
     * @sideEffect 激活选项状态、清空并填充 optionsContainer
     */
gameEngine.renderBranchButtons = function(entries, onPick) {
        this.state.choicesActive = true;
        this.elements.optionsContainer.innerHTML = '';

        entries.forEach((entry, index) => {
            const button = document.createElement('button');
            button.className = 'choice-btn';
            button.textContent = (entry && entry.text) ? entry.text : this.branchButtonLabel(entry);

            button.addEventListener('click', (e) => {
                e.stopPropagation();
                if (button.dataset.choiceLocked === '1') return;   // 反馈窗口内重复点击无效
                button.dataset.choiceLocked = '1';
                if (button.classList && button.classList.add) button.classList.add('choice-selected');
                if (CHOICE_FEEDBACK_MS > 0) {
                    setTimeout(() => { onPick(entry, index); }, CHOICE_FEEDBACK_MS);
                } else {
                    onPick(entry, index);
                }
            });

            this.elements.optionsContainer.appendChild(button);
        });

        this.elements.optionsContainer.style.display = 'grid';
    };

    /**
     * 开发者全开：列出一条分支链的全部项
     * 单项本身是 choice 时，点中后继续渲染它自己的选项（先选组合，再选选项）。
     * @param {Array} entries - 分支链的全部项
     * @returns {void}
     */
gameEngine.showActionChain = function(entries) {
        this.renderBranchButtons(entries, (entry) => {
            this.runChainEntry(this.chainEntryAction(entry));
        });
    };

    /**
     * 执行一个分支项的动作体：选项类继续渲染它的选项，其余交给 handleAction
     * @param {Object} body - 已去掉 when / label 的动作对象
     * @returns {void}
     */
gameEngine.runChainEntry = function(body) {
        this.state.choicesActive = false;
        if (this.elements.optionsContainer) {
            this.elements.optionsContainer.style.display = 'none';
            this.elements.optionsContainer.innerHTML = '';
        }
        if (body && body.type === 'choice') {
            this.showChoices(body.choices, body);
            return;
        }
        if (body) this.handleAction(body);
    };

    /**
     * 开发者全开：列出静默选项组的每条选项（正常流程下它按序求值后自动跳转）
     * 点击结算与交互模式一致：记已读、应用 flag + add、跳转 target
     * @param {Array} choices - 选项数组
     * @returns {void}
     */
gameEngine.showSilentChoicesAllClear = function(choices) {
        this.renderBranchButtons(choices, (choice, index) => {
            this.markChoiceRead(index);
            if (choice.flag && choice.flag !== '#' && choice.add !== undefined && choice.add !== null) {
                this.applyAffinity(choice.flag, choice.add);
                this.playAffinityEffect(choice.flag, Number(choice.add));
            }
            this.handleChoiceTarget(choice.target, choice);
        });
    };


    
    /**
     * 计算选项按钮的网格位置（已由 CSS Grid 自动排版替代）。
     *
     * @deprecated 此方法不再使用，保留用于向后兼容；始终返回空字符串，
     * 由 CSS 的 grid-area 自动布局决定按钮位置。
     *
     * @param {number} index - 选项在列表中的下标。
     * @param {number} total - 选项总数。
     * @returns {string} - 始终为空字符串。
     */
gameEngine.calculateChoicePosition = function(index, total) {
        return '';
    };


    
    /**
     * 设置名片（说话人）文本，并同步说话人小头像。
     *
     * 这是全引擎唯一的「当前说话人」出入口：正文渲染（engine_text）、转场恢复（engine_bg）、
     * 引擎自造的系统提示（engine_command）都走它，头像才不会与名片脱钩。
     * speaker 为空（null / undefined / 纯空白）→ 名片与头像一起隐藏，文本框左缩进回位。
     *
     * 小说模式 / [msgoff] 不需要在这里特判：头像容器挂在文本框容器内部，
     * 文本框一隐藏它就跟着隐藏。
     *
     * @param {string|null|undefined} speaker - 说话人文本。
     * @returns {boolean} 是否有说话人（true = 名片可见）。
     * @sideeffect 改写 elements.nameBox 的文本与 display；把结果转交给 SpeakerAvatar。
     */
gameEngine.applySpeakerLabel = function(speaker) {
        const raw = (speaker === null || speaker === undefined) ? '' : String(speaker).trim();
        const box = this.elements && this.elements.nameBox;
        if (box) {
            if (raw) {
                box.textContent = raw;
                box.style.display = 'block';
            } else {
                box.style.display = 'none';
            }
        }
        if (typeof window !== 'undefined' && window.SpeakerAvatar &&
            typeof window.SpeakerAvatar.setSpeaker === 'function') {
            window.SpeakerAvatar.setSpeaker(raw || null);
        }
        return !!raw;
    };


    
    /**
     * 清除姓名框。
     *
     * 清空姓名文本并隐藏姓名框，用于无说话者的旁白、纯命令行等场景。
     * 副作用：直接修改 this.elements.nameBox 的文本与 display 样式。
     *
     * @returns {void}
     */
gameEngine.clearNameBox = function() {
        this.applySpeakerLabel(null);
        if (this.elements.nameBox) this.elements.nameBox.textContent = '';
    };


    
    /**
     * 文本框皮肤高亮开关。
     *
     * 只是把状态转交给 ui_skin.js 的 textboxHighlight()：档位过滤（
     * TEXTBOX_HIGHLIGHT_MODE = wait / hover / read / off）与 DOM 标记都由皮肤模块负责，
     * 引擎侧只管在正确的时机发信号。
     *
     * @param {boolean} on 是否进入高亮
     * @param {string} [source] 触发源：'wait'（等待点击推进）/ 'read'（打字机进行中）；
     *                          省略表示无条件生效（用于复位）
     * @returns {void}
     */
gameEngine._setTextboxHL = function(on, source) {
        var skin = (typeof window !== 'undefined') ? window.ShioriUISkin : null;
        if (skin && typeof skin.textboxHighlight === 'function') {
            skin.textboxHighlight(on, source);
        }
    };

    
    /**
     * 隐藏文本框。
     *
     * 副作用：将 this.elements.textContainer 设为 display:none。
     * 注意本方法使用 none 而非 flex，重新显示需调用 showTextBox。
     *
     * @returns {void}
     */
gameEngine.hideTextBox = function() {
        this._setTextboxHL(false);
        this.elements.textContainer.style.display = 'none';
    };


    
    /**
     * 显示文本框。
     *
     * 副作用：将 this.elements.textContainer 设为 display:flex，
     * 与 CSS 中文本框的布局方式保持一致（因此不能用 block 恢复）。
     *
     * @returns {void}
     */
gameEngine.showTextBox = function() {
        this._setTextboxHL(false);      // 刚恢复显示时先回常态，由后续打字/等待重新点亮
        this.elements.textContainer.style.display = 'flex';
    };


    
    /**
     * 处理场景结束逻辑。
     *
     * 当 displayLine 检测到行号越界时调用：先把当前场景标记为已完成
     * （供存档 / 场景解锁使用），随后在界面上显示「点击继续」提示，
     * 等待用户手动操作或由上层自动跳转。
     *
     * 副作用：调用 markSceneCompleted 修改完成状态，并在 DOM 中插入提示元素。
     *
     * @returns {void}
     */
gameEngine.handleEndOfScene = function() {
        // 标记当前场景为已完成
        this.markSceneCompleted();
        
        console.log("场景结束，等待用户操作或自动跳转");
        
        // 显示点击提示
        this.addClickPrompt();
    };

    
    /**
     * 添加点击提示。
     *
     * 在屏幕上显示「点击继续」提示元素；若已存在则复用，避免重复插入。
     * 提示会在 3 秒后自动从 DOM 中移除（即使已被外部提前移除也不会报错）。
     *
     * 副作用：向 document.body 追加 .click-prompt 元素，并注册一个 3 秒定时器。
     *
     * @returns {void}
     */
gameEngine.addClickPrompt = function() {
        let prompt = document.querySelector('.click-prompt');
        if (!prompt) {
            prompt = document.createElement('div');
            prompt.className = 'click-prompt';
            prompt.textContent = '点击继续';
            document.body.appendChild(prompt);
        }
        
        // 场景结束 = 正等待玩家点击推进，与提示元素同步点亮文本框高亮
        this._setTextboxHL(true, 'wait');
        
        // 3秒后自动移除提示
        setTimeout(() => {
            if (prompt && prompt.parentNode) {
                prompt.parentNode.removeChild(prompt);
            }
            // 提示消失即不再"等待点击"，同步复位（与 .click-prompt 生命周期一致）
            this._setTextboxHL(false, 'wait');
        }, 3000);
    };


    
    /**
     * 带分段等待的文本显示（[s] 分段点击继续）。
     *
     * 处理流程：
     *  1. 清空当前模式对应的文本容器；
     *  2. 先做注音转换 processRubyText，再做换行处理 processLineBreaks；
     *  3. 优先使用 DSL 的 splitInline 按行内结构切分（可精确保留 ruby 与 [a] 标签），
     *     否则回退到按正则 /\[s\]/i 简单切分；
     *  4. 无分段时直接走普通打字机 typeText；
     *  5. 有分段时写入 state.textSegments 并显示第一段，进入点击等待状态。
     *
     * 副作用：修改 state.textSegments / currentSegment / waitingForSegmentClick，
     * 并可能触发打字机定时器。
     *
     * @param {string} text - 要显示的原始文本（可能含 ruby、换行与 [s] 标签）。
     * @returns {void}
     */
gameEngine.typeTextWithSplits = function(text) {
        // 根据模式选择文本容器并清空
        if (this.state.novelMode) {
            this.elements.novelTextBox.innerHTML = '';
        } else {
            this.elements.textBox.innerHTML = '';
        }
        
        // 先处理注音标签，再处理换行符，最后按[s]标签分割文本
        const rubyProcessedText = this.processRubyText(text);
        const processedText = this.processLineBreaks(rubyProcessedText);
        const dsl = (typeof window === 'object' && window && window.__shiori && window.__shiori.dsl) ? window.__shiori.dsl : null;
        let segments;
        // 优先走 DSL splitInline：按 run 逐项重建分段，遇到 s 段标记则开新段，
        // 保持 [a]（音频标记）与 <ruby> 结构不被切断
        if (dsl && typeof dsl.splitInline === 'function') {
            const runs = dsl.splitInline(processedText);
            segments = [''];
            for (let i = 0; i < runs.length; i++) {
                const r = runs[i];
                if (r && r.s) {
                    segments.push('');
                } else if (r && r.a) {
                    segments[segments.length - 1] += '[a]';
                } else if (r && r.base != null) {
                    segments[segments.length - 1] += '<ruby>' + r.base + '<rt>' + (r.ruby || '') + '</rt></ruby>';
                } else {
                    segments[segments.length - 1] += (r && r.t) ? r.t : '';
                }
            }
        } else {
            // 回退方案：按 [s] 标签直接切分
            segments = processedText.split(/\[s\]/i);
        }
        
        if (segments.length <= 1) {
            // 没有[s]标签，使用普通打字机效果（传入原始文本，由 typeText 自行预处理）
            this.typeText(text);
            return;
        }
        
        // 存储分段信息到状态中
        this.state.textSegments = segments;
        this.state.currentSegment = 0;
        this.state.waitingForSegmentClick = false;
        
        // 显示第一段
        this.displayTextSegment(0);
    };


    
    /**
     * 显示文本片段（累积显示模式）。
     *
     * 逐段显示文本：每段显示后设置 waitingForSegmentClick 并提示点击，
     * 由 handleSegmentClick 触发下一段。文本采用「累积显示」策略，
     * 即第 N 段会连同前 N-1 段一起呈现，只对新增部分做打字机效果。
     * 空片段会被跳过（延迟 100ms 后直接进入下一段）。
     *
     * 副作用：修改 currentSegment / waitingForSegmentClick / textFullyDisplayed 等状态，
     * 并可能启动打字机定时器；全部段显示完毕后会重置音频分段并标记文本已完整显示。
     *
     * @param {number} segmentIndex - 要显示的分段索引（this.state.textSegments 的下标）。
     * @returns {void}
     */
gameEngine.displayTextSegment = function(segmentIndex) {
        // 越界即视为全部片段显示完毕，统一重置分段与音频序列状态
        if (segmentIndex >= this.state.textSegments.length) {
            // 所有片段都显示完毕，重置状态
            this.state.textSegments = null;
            this.state.currentSegment = 0;
            this.state.waitingForSegmentClick = false;
            this.state.audioSegments = null;      
            this.state.currentAudioSegment = 0;   
            this.state.textFullyDisplayed = true;
            return;
        }
        
        const segment = this.state.textSegments[segmentIndex];
        this.state.currentSegment = segmentIndex;
        
        // 非空片段才做渲染；空片段直接跳过，避免出现无内容的点击等待
        if (segment.trim()) {
            // 累积显示：显示从第一段到当前段的所有内容
            let cumulativeText = '';
            for (let i = 0; i <= segmentIndex; i++) {
                cumulativeText += this.state.textSegments[i];
            }
            
            // 根据是否为第一段选择不同的显示方式
            if (segmentIndex === 0) {
                // 第一段，使用完整打字效果
                this.typeText(cumulativeText);
            } else {
                // 后续段落，先显示已有内容，只对新增部分打字
                this.showCumulativeText(cumulativeText, segmentIndex);
            }
            
            // 进入等待点击状态，由 handleSegmentClick 推进到下一段
            this.state.waitingForSegmentClick = true;
            this.showClickPrompt();
        } else {
            // 空片段，直接进入下一段
            setTimeout(() => {
                this.displayNextSegment();
            }, 100);
        }
    };


    
    /**
     * 显示累积文本。
     *
     * 先一次性写入此前所有段落的内容（直接 innerHTML，以支持 <br> 等标签），
     * 再仅对本次新增的部分调用 typeTextAppend 做打字机追加，
     * 从而避免重复打字造成的闪烁。
     *
     * 注意：长度按字符数（含 HTML 标签）计算，因此只在各段拼接位置精确时才有效。
     *
     * 副作用：直接修改目标文本框的 innerHTML，并可能启动追加打字定时器。
     *
     * @param {string} fullText - 完整的累积文本（第 0 段到当前段拼接结果）。
     * @param {number} currentSegment - 当前分段索引（从 0 开始）。
     * @returns {void}
     */
gameEngine.showCumulativeText = function(fullText, currentSegment) {
        // 计算之前的内容长度（基于字符数，包括HTML标签）
        let previousLength = 0;
        for (let i = 0; i < currentSegment; i++) {
            previousLength += this.state.textSegments[i].length;
        }
        
        const targetBox = this.state.novelMode ? this.elements.novelTextBox : this.elements.textBox;
        
        // 显示已有的内容（使用 innerHTML 以支持 <br> 等 HTML 标签）
        targetBox.innerHTML = fullText.substring(0, previousLength);
        
        // 对新增部分使用打字效果
        const newText = fullText.substring(previousLength);
        if (newText) {
            this.typeTextAppend(newText);
        } else {
            this.state.typingActive = false;
        }
    };


    
    /**
     * 追加打字效果。
     *
     * 在目标文本框已有内容的基础上继续逐字符追加 text，
     * 与 typeText 的区别在于不清空原内容、且不触发 onTypingComplete 回调。
     * 同样对 HTML 标签做整体跳过处理：普通标签跳到 '>'，
     * <ruby> 结构整体跳到 '</ruby>' 之后，保证注音不会被打断显示。
     *
     * 副作用：逐帧修改文本框 innerHTML；维护 state.typingActive / typingTimerId，
     * 结束时置 state.textFullyDisplayed = true。
     *
     * @param {string} text - 要追加显示的文本片段（可含 HTML 标签）。
     * @returns {void}
     */
gameEngine.typeTextAppend = function(text) {
        // 追加模式：传入的 text 已是预处理后的片段（见 showCumulativeText），
        // 因此这里不再重复 processRubyText / processLineBreaks。
        if (!text) {
            this.state.typingActive = false;
            return;
        }
        this._runTypewriter(text, true);
    };


    
    /**
     * 显示下一段文本。
     *
     * 若还有后续分段则继续 displayTextSegment；否则重置分段与音频序列状态，
     * 并主动调用 nextLine 推进到下一行——这样即使在非 AUTO 模式下，
     * 用户也无需为最后一段多付一次「空点击」。
     *
     * 副作用：重置多个 state 字段，并触发 nextLine 推进剧情。
     *
     * @returns {void}
     */
gameEngine.displayNextSegment = function() {
        if (this.state.textSegments && this.state.currentSegment < this.state.textSegments.length - 1) {
            this.displayTextSegment(this.state.currentSegment + 1);
        } else {
            // 所有片段显示完毕，重置状态
            this.state.textSegments = null;
            this.state.currentSegment = 0;
            this.state.waitingForSegmentClick = false;
            this.state.audioSegments = null;      
            this.state.currentAudioSegment = 0;
            // 所有分段显示完毕，自动推进到下一行
            // 非AUTO模式下也避免用户需要多余的"空点击"
            this.nextLine();
        }
    };


    
    /**
     * 显示点击提示（占位函数）。
     *
     * 仅输出日志，实际的「点击继续」视觉提示由 addClickPrompt 负责；
     * 保留此空实现是为了统一分段流程的调用点，便于后续扩展。
     *
     * @returns {void}
     */
gameEngine.showClickPrompt = function() {
        console.log("等待点击继续...");
    };


    
    /**
     * 处理分段文本的点击事件。
     *
     * 仅在 waitingForSegmentClick 为真时生效（即当前正等待用户点击以继续分段）：
     *  1. 复位等待标志并隐藏点击提示；
     *  2. 若存在音频分段，则同步切换到下一个语音片段；
     *  3. 调用 displayNextSegment 展示下一段文本。
     *
     * 副作用：推进 currentAudioSegment、播放音频、修改分段状态。
     * 非等待状态下的点击会被本次调用直接忽略（不报错）。
     *
     * @returns {void}
     */
gameEngine.handleSegmentClick = function() {
        if (this.state.waitingForSegmentClick) {
            this.state.waitingForSegmentClick = false;
            this.hideClickPrompt();
            
            // 切换到下一个音频片段
            if (this.state.audioSegments && 
                this.state.currentAudioSegment < this.state.audioSegments.length - 1) {
                this.state.currentAudioSegment++;
                const nextAudio = this.state.audioSegments[this.state.currentAudioSegment];
                this.playAudio(nextAudio);
            }
            
            this.displayNextSegment();
        }
    };


    
    /**
     * 隐藏点击提示（占位函数）。
     *
     * 仅输出日志；点击提示的实际 DOM 移除由 addClickPrompt 的定时器完成，
     * 保留空实现以统一分段流程的调用点。
     *
     * @returns {void}
     */
gameEngine.hideClickPrompt = function() {
        console.log("点击提示已隐藏");
    };


    
    /**
     * 打字机效果显示文本（主显示入口）。
     *
     * 流程：预处理（注音 → 换行）→ 清空目标文本框 → 以 30ms/字符逐字追加。
     * 对 HTML 标签做整体跳过处理：普通标签直接跳到 '>' 之后，
     * <ruby>...</ruby> 结构整体写入，避免注音在打字过程中被拆断。
     * 全部输出完成后置 textFullyDisplayed = true，并通知 systemModule.onTypingComplete。
     *
     * 副作用：清空并重建文本框 innerHTML，维护 state.typingActive / typingTimerId；
     * 可通过 nextLine 中的清定时器逻辑被中途打断（此时直接显示完整文本）。
     *
     * @param {string} text - 要显示的原始文本（可含 ruby 注音与换行标记）。
     * @returns {void}
     */
    /**
     * 按「可见字符数」推进打字索引，同时保证 HTML 标签不被截断。
     * 规则：普通标签整体跳过（不计字符数），
     * <ruby>…</ruby> 结构整体跳过并计 1 个字符（避免注音被拆断）。
     *
     * @param {string} text 已预处理的文本（含 <br> / <ruby>）
     * @param {number} start 起始索引
     * @param {number} count 本次要推进的可见字符数
     * @returns {number} 推进后的索引（保证落在标签边界上）
     */
gameEngine._advanceTypingIndex = function(text, start, count) {
        var i = start | 0;
        var shown = 0;
        var n = (count | 0);
        if (!text || n <= 0) return i;
        while (i < text.length && shown < n) {
            var ch = text.charAt(i);
            if (ch !== '<') {
                i++;
                shown++;
                continue;
            }
            // <ruby> 结构整体写入，计 1 个字符
            if (text.substring(i, i + 6) === '<ruby>') {
                var rubyEnd = text.indexOf('</ruby>', i);
                if (rubyEnd !== -1) {
                    i = rubyEnd + 7;
                    shown++;
                    continue;
                }
            }
            var tagEnd = text.indexOf('>', i);
            if (tagEnd !== -1) {
                i = tagEnd + 1;   // 普通标签不计字符
            } else {
                i++;              // 未闭合的 '<' 当普通字符处理
                shown++;
            }
        }
        return i;
    };

    /**
     * 打字机核心：按**时间配额**逐帧推进，而不是逐字符 setTimeout。
     *
     * 每帧按 `elapsed / SPEED` 算出应显示的字符数，只做**一次** `innerHTML` 写入；
     * 写入次数从「字符数」降到「帧数」，长句时也不会随字符数线性增长。
     *
     * 驱动源优先用统一节拍（window.ShioriTick），使打字与立绘动画、输入消费处在
     * 同一帧序里；节拍缺失时（纯网页打开）退回 setTimeout 降级路径，行为等价。
     *
     * @param {string} processedText 已预处理的文本
     * @param {boolean} append true=在现有内容之后追加；false=清空后重打
     * @returns {void}
     * @sideEffect 维护 state.typingActive / textFullyDisplayed，逐帧写入目标文本框
     */
gameEngine._runTypewriter = function(processedText, append) {
        var targetBox = this.state.novelMode ? this.elements.novelTextBox : this.elements.textBox;
        if (!targetBox) return;
        if (processedText == null) processedText = '';

        var tick = (typeof window !== 'undefined') ? window.ShioriTick : null;
        var self = this;

        // 摘掉上一段打字 handler，避免两段同时写同一个框
        if (tick && typeof tick.removeContinuousHandler === 'function' && this._typewriterStep) {
            tick.removeContinuousHandler(this._typewriterStep);
        }
        if (this.state.typingTimerId !== null && this.state.typingTimerId !== undefined) {
            clearTimeout(this.state.typingTimerId);
            this.state.typingTimerId = null;
        }

        var SPEED = 30;                             // 毫秒/字符（与原实现一致）
        var baseHtml = append ? targetBox.innerHTML : '';
        if (!append) targetBox.innerHTML = '';

        var i = 0;
        var acc = 0;
        this.state.typingActive = true;
        this.state.textFullyDisplayed = false;
        this.state.typingTimerId = null;

        // 新一段开始打字 —— 先撤掉上一段遗留的"等待点击"高亮，再按 read 档点亮
        this._setTextboxHL(false, 'wait');
        this._setTextboxHL(true, 'read');

        function stop() {
            if (tick && typeof tick.removeContinuousHandler === 'function') {
                tick.removeContinuousHandler(step);
            }
            self.state.typingTimerId = null;
            if (self._typewriterStep === step) self._typewriterStep = null;
        }

        function finish() {
            self.state.typingActive = false;
            self.state.textFullyDisplayed = true;
            stop();
            // 打字结束 —— 撤 read 高亮；wait 档下切换为"等待玩家点击推进"
            self._setTextboxHL(false, 'read');
            self._setTextboxHL(true, 'wait');
            // 通知systemModule打字机完成
            if (typeof systemModule !== 'undefined' && systemModule.onTypingComplete) {
                systemModule.onTypingComplete();
            }
        }

        function step(nowTick, dt) {
            if (!self.state.typingActive) { stop(); return; }
            acc += (dt > 0 ? dt : 16.7);
            if (acc < SPEED) return;
            var count = Math.floor(acc / SPEED);
            acc -= count * SPEED;
            var ni = self._advanceTypingIndex(processedText, i, count);
            if (ni !== i) {
                i = ni;
                targetBox.innerHTML = baseHtml + processedText.substring(0, i);
            }
            if (i >= processedText.length) finish();
        }

        this._typewriterStep = step;
        if (tick && typeof tick.addContinuousHandler === 'function') {
            tick.addContinuousHandler(step);
        } else {
            // 降级：无节拍模块时按 SPEED 步进（每步可能跨多字符）
            (function fallback() {
                step(0, SPEED);
                if (self.state.typingActive) {
                    self.state.typingTimerId = setTimeout(fallback, SPEED);
                }
            })();
        }
    };

    /**
     * 打字机效果显示文本（主显示入口）。
     *
     * 流程：预处理（注音 → 换行）→ 清空目标文本框 → 以 30ms/字符逐字追加。
     * 对 HTML 标签做整体跳过处理：普通标签直接跳到 '>' 之后，
     * <ruby>...</ruby> 结构整体写入，避免注音在打字过程中被拆断。
     * 全部输出完成后置 textFullyDisplayed = true，并通知 systemModule.onTypingComplete。
     *
     * 副作用：清空并重建文本框 innerHTML，维护 state.typingActive / typingTimerId；
     * 可通过 nextLine 中的清定时器逻辑被中途打断（此时直接显示完整文本）。
     *
     * @param {string} text - 要显示的原始文本（可含 ruby 注音与换行标记）。
     * @returns {void}
     */
gameEngine.typeText = function(text) {
        // 先处理注音标签，再处理换行符（与原实现一致：单次预处理，之后只按索引推进）
        var processedText = this.processLineBreaks(this.processRubyText(text));
        this._runTypewriter(processedText, false);
    };


    
    /**
     * 处理换行标签。
     *
     * 将多种换行标记格式统一规范化为 HTML `<br>`，
     * 依次替换：[br] 标签 → `\n` 转义序列 → 已有 `<br>` 标签标准化 → 真实换行符。
     *
     * @param {string} text - 原始文本。
     * @returns {string} - 换行标记统一为 `<br>` 后的文本；text 为假值时原样返回。
     */
gameEngine.processLineBreaks = function(text) {
        if (!text) return text;
        
        // 支持多种换行标记格式
        return text
            .replace(/\[br\]/gi, '<br>')      // [br] 标签
            .replace(/\\n/g, '<br>')         // \n 转义字符
            .replace(/<br\s*\/?>/gi, '<br>') // HTML <br> 标签（标准化）
            .replace(/\n/g, '<br>');          // 普通换行符
    };


    
    /**
     * 处理注音标签（Ruby / Furigana）。
     *
     * 将 `[汉字,拼音]` 形式的注音语法转换为标准 HTML
     * `<ruby>汉字<rt>拼音</rt></ruby>`，随后由浏览器的 ruby 排版渲染。
     *
     * 正则要点：`[^\[,\s]+` 保证基文字不含空格与逗号（避免误吞控制指令），
     * 读音部分 `[^\]]+` 允许包含空格（如 `[复杂词,fu za ci]`）。
     *
     * @param {string} text - 原始文本。
     * @returns {string} - 注音已转换后的文本；text 为假值时原样返回。
     */
gameEngine.processRubyText = function(text) {
        if (!text) return text;
        
        // 正则表达式匹配 [文本,读音] 格式
        // 支持拼音中包含空格的情况，例如：[复杂词,fu za ci]
        // 使用贪婪匹配确保正确捕获内容
        const rubyRegex = /\[([^\[,\s]+)\s*,\s*([^\]]+)\]/g;
        
        return text.replace(rubyRegex, (match, baseText, rubyText) => {
            // 去除首尾空格
            const cleanBase = baseText.trim();
            const cleanRuby = rubyText.trim();
            
            // 返回标准的 ruby HTML 结构
            return `<ruby>${cleanBase}<rt>${cleanRuby}</rt></ruby>`;
        });
    };


    
    /**
     * 推进到下一行对话（用户点击 / 自动推进的统一入口）。
     *
     * 采用「两段式点击」语义：
     *  - 若正在打字，则本次调用只做「立即显示完整文本」并返回，不换行；
     *  - 若文本已完整显示，则本次调用才真正推进 currentLine 并显示下一行。
     *
     * 在推进前会依次：处理转场竞态、忽略选项激活状态、处理 AUTO 模式开关、
     * 中断未完成的 [wait time] 序列与立绘序列、清理音频分段状态。
     *
     * 副作用：大量重置 this.state 字段；可能调用 systemModule.toggleAutoMode
     * 关闭 AUTO、中断定时器、直接改写文本框 innerHTML，并最终调用 displayLine。
     *
     * @returns {void}
     */
gameEngine.nextLine = function() {
        // 竞态修复：如果背景转场正在进行，强制重置转场状态。
        // 这确保了用户快速点击推进剧情时，能够中断旧转场并同步最新状态；
        // 但快进（fastForwardActive）模式下不打断，交由快进逻辑自行处理。
        if (this.state.isBackgroundTransitioning && !this.state.fastForwardActive) {
            console.warn('[竞态修复] 检测到转场期间用户推进剧情，强制重置转场状态');
            this.state.isBackgroundTransitioning = false;
            // 不清理 transitionStartLine，让下一次转场时覆盖
        }
        
        // 如果选项菜单激活，不处理（必须等待用户完成选择）
        if (this.state.choicesActive) return; 
        
        // 如果AUTO模式开启，检查是否是AUTO触发的点击
        const isAutoClick = typeof systemModule !== 'undefined' && systemModule.autoClickTriggered;
        
        // 如果是用户手动点击（不是AUTO触发的），关闭AUTO模式
        if (typeof systemModule !== 'undefined' && systemModule.autoModeEnabled && !isAutoClick) {
            systemModule.toggleAutoMode();
        }
        
        // 重置AUTO点击标志位
        if (typeof systemModule !== 'undefined') {
            systemModule.autoClickTriggered = false;
        }
        
        // 中断所有正在进行的 [wait time] 序列（防止旧定时器污染新行）
        this.interruptAllWaitSequences();
        
        // 中断所有正在进行的连续动作指令，并跳转到最终状态
        this.interruptCharSequences();
        
        // 清除音频序列状态
        this.state.audioSegments = null;
        this.state.currentAudioSegment = 0;
        
        // ── 第一段点击：正在打字时「补全」而非换行 ─────────────────
        // 共用 finishTypingNow()：与「点击补全」「右键隐藏」保持同一份实现，避免三处漂移
        if (this.state.typingActive) {
            this.finishTypingNow();
            return;
        }
        
        // ── 第二段点击：文本已完整显示，清理分段状态并真正换行 ─────
        // 检查是否已经完整显示了当前文本
        if (this.state.textFullyDisplayed) {
            this.state.textFullyDisplayed = false;
            // 重置分段状态
            this.state.textSegments = null;
            this.state.currentSegment = 0;
            this.state.waitingForSegmentClick = false;
        }
        
        // 推进前先把立绘动画落到终态，
        // 而不是取消后停在半途 —— 快进 100 行后的立绘位置必须与逐行播放一致。
        var charAnim = (typeof window !== 'undefined') ? window.ShioriCharAnim : null;
        if (charAnim && typeof charAnim.finishAll === 'function') {
            try { charAnim.finishAll(); } catch (e) { /* 动画结算失败不阻塞推进 */ }
        }

        // 推进到下一行
        this.state.currentLine++;
        
        if (this.state.currentLine < this.sceneData.story.length) {
            this.displayLine(this.state.currentLine);
        } else {
            // 到达场景末尾
            console.log("到达场景末尾，准备跳转...");
        }
    };


    
    /**
     * 设置窗口（文本框）显示模式。
     *
     * 对应剧本中的 msg on / msg off 类指令：先统一隐藏文本框，
     * 若要求可见再重新显示。state.msgOff 会同步记录屏蔽状态，
     * 供 displayLine 在空文本行判断是否需要恢复文本框。
     *
     * 副作用：修改 state.msgOff，并直接切换文本框的 display 样式。
     *
     * @param {boolean} visible - true 显示文本框，false 隐藏文本框。
     * @returns {void}
     */
gameEngine.setWindowMode = function(visible) {
        this.state.msgOff = !visible;
        this.hideTextBox();
        
        if (visible) {
            this.showTextBox();
        }
    };


    
    /**
     * 显示 POV（叙事视角）指示器。
     *
     * 在屏幕上创建一个 .pov-indicator 元素并显示「当前叙事视角 xxx」。
     * 若已存在旧的指示器会先移除，保证同一时刻至多一个。
     *
     * 副作用：修改 DOM（移除旧节点、向 body 追加新节点），
     * 并把元素引用与激活标志写入 state.povIndicator / state.povActive。
     *
     * @param {string} povName - 要展示的视角名称。
     * @returns {void}
     */
gameEngine.showPovIndicator = function(povName) {
        // 如果已有POV指示器，先移除
        if (this.state.povIndicator && this.state.povIndicator.parentNode) {
            this.state.povIndicator.parentNode.removeChild(this.state.povIndicator);
        }
        
        // 创建新的POV指示器元素
        const povElement = document.createElement('div');
        povElement.className = 'pov-indicator';
        povElement.textContent = `当前叙事视角 ${povName}`;
        
        document.body.appendChild(povElement);
        
        this.state.povActive = true;
        this.state.povIndicator = povElement;
        
        console.log('POV视角已显示:', povName);
    };


    
    /**
     * 隐藏 POV 视角指示器。
     *
     * 从 DOM 中移除指示器元素（若存在），并把 state.povIndicator 置空、
     * state.povActive 置为 false。可安全重复调用。
     *
     * @returns {void}
     */
gameEngine.hidePovIndicator = function() {
        if (this.state.povIndicator && this.state.povIndicator.parentNode) {
            this.state.povIndicator.parentNode.removeChild(this.state.povIndicator);
        }
        
        this.state.povActive = false;
        this.state.povIndicator = null;
        
        console.log('POV视角已隐藏');
    };


    
    /**
     * 清除 POV 状态。
     *
     * 语义化封装：当前等价于调用 hidePovIndicator，
     * 用于剧本切换 / 存档读档时统一清理视角指示器的入口。
     *
     * @returns {void}
     */
gameEngine.clearPovState = function() {
        this.hidePovIndicator();
    };

