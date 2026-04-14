/**
 * Shiori 引擎核心脚本
 * 可按需自由修改
 */

const gameEngine = {
    state: {
        // 当前场景索引
        currentScene: 0,
        // 当前对话行号
        currentLine: 0,
        // 是否启用全屏小说模式
        novelMode: false,
        // 选项菜单是否处于激活状态
        choicesActive: false,
        // 条件判断栈，用于嵌套的条件分支
        conditionalStack: [],
        // 当前条件判断的结果
        currentConditionResult: null,
        // 待显示的选项列表
        pendingSelections: [],
        // 是否禁用Live2D演出效果
        disableLVE: false,
        // 角色好感度数据
        affinity: {},
        // 已完成的场景列表
        completedScenes: [],
        // 右键菜单是否已初始化
        contextMenuInitialized: false,
        // 分段文本数组（支持[s]标签）
        textSegments: null,
        // 当前显示的分段索引
        currentSegment: 0,
        // 是否等待用户点击以继续下一段文本
        waitingForSegmentClick: false,
        // 打字机效果的定时器ID
        typingTimerId: null,
        // 打字机效果是否正在运行
        typingActive: false,
        // 快进模式是否激活
        fastForwardActive: false,
        // 快进模式的定时器ID
        fastForwardTimerId: null,
        // 音频片段数组（支持[a]标签）
        audioSegments: null,
        // 当前播放的音频片段索引
        currentAudioSegment: 0,
        // POV视角指示器是否激活
        povActive: false,
        // POV视角指示器DOM元素
        povIndicator: null,
        // 文本是否已完整显示（用于控制点击行为）
        textFullyDisplayed: false,
        // 当前激活的立绘状态 { id: { path, left, zIndex, clipPath } }
        activeChars: {},
        // 持续发抖的立绘状态 { charId: timerId }
        shakingChars: {},
        // 背景转场标志
        isBackgroundTransitioning: false,
        // 角色名称标识符映射表 { roleName: { charId, domElement } }
        charNameMap: {}
    },
    
    elements: {
        // 背景容器DOM元素
        backgroundContainer: null,
        // 角色立绘容器DOM元素
        characterContainer: null,
        // 角色姓名框DOM元素
        nameBox: null,
        // 对话框DOM元素
        textBox: null,
        // 选项容器DOM元素
        optionsContainer: null,
        // 全屏小说模式文本框DOM元素
        novelTextBox: null,
        // 全屏小说模式容器DOM元素
        novelModeContainer: null,
        // 文本框外层容器DOM元素
        textContainer: null,
        // BGM音频播放器DOM元素
        bgmPlayer: null,
        // 音效播放器DOM元素
        sePlayer: null,
        // 语音播放器DOM元素
        voicePlayer: null
    },
    
    // 当前场景数据对象
    sceneData: null,
    
    /**
     * 初始化游戏引擎
     * @param {Object} data - 场景数据对象，包含story、background、audio等配置
     */
    init: function(data) {
        // 缓存场景数据
        this.sceneData = data;
        // 缓存DOM元素引用
        this.cacheElements();
        // 绑定事件监听器
        this.bindEvents();
        // 加载存档进度
        this.loadProgress();
        // 保存当前场景标记
        this.saveCurrentSceneMarker();
        // 隐藏视频播放器
        if (this.elements.videoPlayer) {
            this.elements.videoPlayer.style.display = 'none';
        }
        
        // 重置调试状态（切换场景时）
        if (typeof systemModule !== 'undefined' && systemModule.resetDebugState) {
            systemModule.resetDebugState();
        }
        
        // 显示第一行对话
        this.displayLine(this.state.currentLine);
        // 请求音频播放权限（处理浏览器自动播放策略）
        this.requestAudioPlayback();
    },
    
    /**
     * 请求音频播放权限
     * 通过监听用户首次交互来解锁音频上下文，解决浏览器自动播放限制
     */
    requestAudioPlayback: function() {
        const handleFirstInteraction = () => {
            this.unlockAudioContext();
            document.removeEventListener('mousedown', handleFirstInteraction);
            document.removeEventListener('touchstart', handleFirstInteraction);
            document.removeEventListener('keydown', handleFirstInteraction);
        };
        document.addEventListener('mousedown', handleFirstInteraction);
        document.addEventListener('touchstart', handleFirstInteraction);
        document.addEventListener('keydown', handleFirstInteraction);
    },
    
    /**
     * 解锁音频上下文
     * 通过先静音播放再恢复音量的方式绕过浏览器自动播放策略
     */
    unlockAudioContext: function() {
        try {
            this.elements.bgmPlayer.volume = 0;
            this.elements.bgmPlayer.play().then(() => {
                this.elements.bgmPlayer.volume = 1;
                console.log("音频上下文已解锁");
            }).catch(() => {
                this.elements.bgmPlayer.volume = 1;
            });
        } catch (e) {
            console.log("尝试解锁音频上下文时出错:", e);
            this.elements.bgmPlayer.volume = 1;
        }
    },
    
    /**
     * 缓存DOM元素引用
     * 将所有常用的DOM元素一次性获取并存储，避免重复查询提升性能
     */
    cacheElements: function() {
        this.elements = {
            backgroundContainer: document.getElementById('background-container'),
            characterContainer: document.getElementById('character-container'),
            nameBox: document.getElementById('name-box'),
            textBox: document.getElementById('text-box'),
            optionsContainer: document.getElementById('options-container'),
            novelTextBox: document.getElementById('novel-text-box'),
            novelModeContainer: document.getElementById('novel-mode-container'),
            textContainer: document.getElementById('text-box-container'),
            bgmPlayer: document.getElementById('bgm-player'),
            sePlayer: document.getElementById('se-player'),
            voicePlayer: document.getElementById('voice-player'),
            videoPlayer: document.getElementById('video-player'),
            mainVideo: document.getElementById('main-video'),
            contextMenu: document.getElementById('context-menu'),
            contextMenuBackdrop: document.getElementById('context-menu-backdrop')
        };
    },
    
    /**
     * 绑定全局事件监听器
     * 包括点击、右键、键盘等交互事件的处理
     */
    bindEvents: function() {
        // 左键点击事件：推进对话或显示完整文本
        document.body.addEventListener('click', (e) => {
            if (!this.state.choicesActive && !this.isOptionElement(e.target)) {
                if (this.state.waitingForSegmentClick) {
                    if (this.state.typingActive) {
                        // 如果正在打字，立即显示完整文本
                        if (this.state.typingTimerId !== null) {
                            clearTimeout(this.state.typingTimerId);
                            this.state.typingTimerId = null;
                        }
                        this.state.typingActive = false;
                        const targetBox = this.state.novelMode ? this.elements.novelTextBox : this.elements.textBox;
                        let fullText = '';
                        if (this.state.textSegments) {
                            for (let i = 0; i <= this.state.currentSegment; i++) {
                                fullText += this.state.textSegments[i];
                            }
                        } else {
                            const currentLine = this.sceneData.story[this.state.currentLine];
                            if (currentLine && currentLine.text) {
                                fullText = this.processLineBreaks(currentLine.text);
                            }
                        }
                        targetBox.innerHTML = fullText;
                        this.state.audioSegments = null;
                        this.state.currentAudioSegment = 0;
                        return;
                    }
                    this.handleSegmentClick();
                } else {
                    this.nextLine();
                }
            }
        });
        
        // 右键点击事件：跳过视频或推进对话
        document.body.addEventListener('contextmenu', (e) => {
            if (this.elements.videoPlayer && this.elements.videoPlayer.style.display === 'block') {
                // 视频播放时，右键跳过
                e.preventDefault();
                this.skipVideo();
            } else if (!this.state.choicesActive && !this.isOptionElement(e.target)) {
                // 非选项状态时，右键推进对话
                e.preventDefault();
                this.nextLine();
            }
        });
        
        // 键盘按下事件：ESC键切换菜单，Ctrl键快进
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // ESC键切换右键菜单
                e.preventDefault();
                this.toggleContextMenu();
            }
                    
            if (e.key === 'Control' && !this.state.fastForwardActive) {
                // Ctrl键开始快进
                e.preventDefault();
                this.startFastForward();
            }
        });
                
        // 键盘释放事件：停止快进
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                // 释放Ctrl键停止快进
                e.preventDefault();
                this.stopFastForward();
            }
        });
        
        // 右键菜单背景点击事件：关闭菜单
        if (this.elements.contextMenuBackdrop) {
            this.elements.contextMenuBackdrop.addEventListener('click', () => {
                this.toggleContextMenu();
            });
        }
    },
    
    /**
     * 检查元素是否为选项元素
     * @param {HTMLElement} element - 要检查的DOM元素
     * @returns {boolean} - 是否为选项容器内的元素
     */
    isOptionElement: function(element) {
        return element.closest('#options-container') !== null;
    },
    
    
    /**
     * 显示指定行的对话内容
     * 处理文本、背景、BGM、视频等多种元素的显示逻辑
     * @param {number} index - 要显示的行索引
     */
    displayLine: function(index) {
        // 检查是否到达场景末尾
        if (index >= this.sceneData.story.length) {
            console.log("故事结束或到达场景末尾");
            this.handleEndOfScene();
            return;
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
        
        const line = this.sceneData.story[index];

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

        // 只有在非转场行才立即渲染文本和姓名
        if (!isTransition) {
            // 设置说话者姓名
            if (line.speaker) {
                this.elements.nameBox.textContent = line.speaker;
                this.elements.nameBox.style.display = 'block';
            } else {
                this.elements.nameBox.style.display = 'none';
            }

            // 显示文本（支持分段和打字机效果）
            this.typeTextWithSplits(line.text);
        }
        
        // 解析并播放音频序列（支持[a]标签的多段音频）
        if (line.audio && typeof line.audio === 'string' && line.audio.includes('[a]')) {
            this.state.audioSegments = this.parseAudioSequence(line.audio);
            this.state.currentAudioSegment = 0;
            
            if (this.state.audioSegments.length > 0) {
                this.playAudio(this.state.audioSegments[0]);
            }
        } else if (line.audio) {
            // 播放单个音频文件
            if (this.sceneData.audio && this.sceneData.audio[line.audio] && 
                !(this.sceneData.bgm && this.sceneData.bgm[line.audio])) {
                this.playAudio(line.audio);
            }
        }
        
        // 切换背景图片
        if (line.background) {
            let bgPath = null;
            let isTransition = false;
            let transitionType = 'fade'; // 默认为淡入淡出
            let targetBgId = null;

            // 检查是否为转场语法："trans/转场", "slideL/左滑", "slideR/右滑", "scanL/左转场", "scanR/右转场"
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
            }

            // 查找背景路径
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
                    // 执行原子化阻塞转场
                    this.performBackgroundTransition(bgPath, line, transitionType);
                    return; // 【关键】立即返回，阻断当前行后续所有指令（chars, text, audio等）
                } else {
                    this.setBackground(bgPath);
                }
            }
        }
        
        // 处理BGM播放逻辑
        if (line.bgm) {
            if (line.bgm === 'bgm stop') {
                // 停止当前BGM
                this.stopBGM();
            } else if (typeof line.bgm === 'string' && line.bgm.startsWith('bgm wait ')) {
                // 淡出旧BGM并播放新BGM
                const newBgmKey = line.bgm.substring('bgm wait '.length).trim();
                this.fadeOutAndPlayBGM(newBgmKey);
            } else if (this.sceneData.bgm && this.sceneData.bgm[line.bgm]) {
                // 直接播放指定BGM
                this.playAudio(line.bgm);
            }
        }
        
        // 播放视频
        if (line.video && this.sceneData.videos && this.sceneData.videos[line.video]) {
            this.playVideo(line.video);
        }
        
        // 解析并执行标签命令（如[s]、[wait]等）
        if (line.command) {
            this.executeCommand(line.command);
            return;
        }
        
        // 处理动作指令（如背景切换、特效等）
        if (line.action) {
            this.handleAction(line.action);
        }
        
        // 处理立绘指令
        if (line.chars) {
            // 如果当前行正在执行背景转场，则跳过本行的立绘渲染
            // 避免在淡出过程中出现立绘闪烁或状态冲突
            if (!this.state.isBackgroundTransitioning) {
                this.renderChars(line.chars);
            }
        }
        
        // 更新当前行号
        this.state.currentLine = index;
        
        // 更新调试日志信息（如果系统模块已加载）
        if (typeof systemModule !== 'undefined' && systemModule.updateDebugInfo) {
            systemModule.updateDebugInfo();
        }
    },
    
    /**
     * 执行标签命令
     * 解析并执行场景文件中的命令标签（如[s]、[wait]、[novel]等）
     * @param {string} command - 命令字符串
     */
    executeCommand: function(command) {
        // 解析命令字符串为结构化对象
        const parsedCommand = this.parseCommand(command);
        
        // 执行解析后的命令
        if (parsedCommand.type) {
            this.handleAction(parsedCommand);
        }
        
        // 定义需要等待用户点击的命令类型
        const waitForClickCommands = ['waitForClick'];
        
        // 如果命令需要等待用户点击，显示提示信息
        if (waitForClickCommands.includes(parsedCommand.type)) {
            this.elements.textBox.textContent = '点击继续';
            this.elements.nameBox.textContent = '系统';
            this.elements.nameBox.style.display = 'block';
        } else {
            // 如果没有后续文本，自动进入下一行
            if (!parsedCommand.text) {
                setTimeout(() => {
                    this.nextLine();
                }, 100);
            }
        }
    },
    
    
    /**
     * 解析命令字符串
     * 将类似 [command param=value] 格式的标签解析为结构化对象
     * @param {string} commandStr - 命令字符串，如 "[wait click]" 或 "[fadeout time=1000]"
     * @returns {Object} - 解析后的命令对象，包含type和参数
     */
    parseCommand: function(commandStr) {
        // 使用正则表达式提取命令内容
        const cmdMatch = commandStr.match(/\[([^\]]+)\]/);
        if (!cmdMatch) return {};
            
        const fullCmd = cmdMatch[1];
        const parts = fullCmd.split(' ');
        const cmdName = parts[0].toLowerCase();
            
        // 解析键值对参数
        const params = {};
        for (let i = 1; i < parts.length; i++) {
            const paramMatch = parts[i].match(/([a-zA-Z0-9]+)=(.+)/);
            if (paramMatch) {
                params[paramMatch[1]] = paramMatch[2].replace(/"/g, '');
            }
        }
            
        // 根据命令名称调用专门的解析函数
        return this.parseCommandByName(cmdName, params, parts);
    },
        
    /**
     * 根据命令名称解析命令
     * 将不同标签命令转换为统一的动作对象格式
     * @param {string} cmdName - 命令名称（小写）
     * @param {Object} params - 键值对参数对象
     * @param {Array} parts - 分割后的命令部分数组
     * @returns {Object} - 标准化的动作对象
     */
    parseCommandByName: function(cmdName, params, parts) {
        switch(cmdName) {
            case 'fadeout':
                // 淡出效果
                return {
                    type: 'fadeOut',
                    duration: parseInt(params.time) || 1000,
                    backgroundColor: params.color || 'black'
                };
                    
            case 'clearname':
                // 清除姓名框
                return {
                    type: 'clearName'
                };
                    
            case 'msgoff':
                // 隐藏文本框
                return {
                    type: 'hideText'
                };
                    
            case 'msgon':
                // 显示文本框
                return {
                    type: 'showText'
                };
                    
            case 'fadein':
                // 淡入效果
                return {
                    type: 'fadeIn',
                    duration: parseInt(params.time) || 1000,
                    backgroundColor: params.color || 'black'
                };
                    
            case 'clear':
                // 清除姓名框（clearname的别名）
                return {
                    type: 'clearName'
                };
                    
            case 'finish':
                // 游戏结束（黑色背景）
                return {
                    type: 'finishGame',
                    bgColor: params.bgcolor || 'black',
                    duration: parseInt(params.time) || 1500
                };
                    
            case 'finishwhite':
                // 游戏结束（白色背景）
                return {
                    type: 'finishGame',
                    bgColor: params.bgcolor || 'white',
                    duration: parseInt(params.time) || 1500
                };
                    
            case 's':
                // 分段等待标签
                return {
                    type: 'waitForClick'
                };
            
            case 'wait':
                // 等待用户点击
                return {
                    type: 'waitForClick'
                };
            
            case 'pov':
                // 处理POV视角指令
                if (parts.length >= 2 && parts[1].toLowerCase() === 'stop') {
                    return {
                        type: 'povStop'
                    };
                } else if (parts.length >= 2) {
                    // 提取视角名称（去除引号）
                    const povName = parts.slice(1).join(' ').replace(/"/g, '').trim();
                    return {
                        type: 'povShow',
                        povName: povName
                    };
                }
                break;
            
            case 'novel':
                // 开启全屏小说模式
                return {
                    type: 'novelOn'
                };
            
            case 'normal':
                // 关闭全屏小说模式，恢复正常模式
                return {
                    type: 'novelOff'
                };
        }
            
        // 如果没有识别到命令，返回空对象
        return {};
    },
    
    /**
     * 显示选项菜单
     * @param {Array} choices - 选项数组，每个选项包含text和target属性
     */
    showChoices: function(choices) {
        this.state.choicesActive = true;
        this.elements.optionsContainer.innerHTML = '';
        
        choices.forEach((choice, index) => {
            const button = document.createElement('button');
            button.className = 'choice-btn';
            button.textContent = choice.text;
            button.dataset.target = choice.target;
            
            // 设置选项按钮位置（由CSS Grid控制）
            button.style.gridArea = this.calculateChoicePosition(index, choices.length);
            
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToScene(choice.target);
            });
            
            this.elements.optionsContainer.appendChild(button);
        });
        
        this.elements.optionsContainer.style.display = 'grid';
    },
    
    /**
     * 计算选项位置（已由CSS Grid替代）
     * @deprecated 此方法不再使用，保留用于向后兼容
     */
    calculateChoicePosition: function(index, total) {
        return '';
    },
    
    /**
     * 处理动作指令
     * 根据动作类型执行相应的游戏逻辑（如切换背景、播放音效、显示选项等）
     * @param {Object} action - 动作对象，包含type和相应参数
     */
    handleAction: function(action) {
        switch(action.type) {
            case 'choice':
                // 显示选项菜单
                this.showChoices(action.choices);
                break;
            case 'novelOn':
                // 开启全屏小说模式
                this.setNovelMode(true);
                break;
            case 'novelOff':
                // 关闭全屏小说模式
                this.setNovelMode(false);
                break;
            case 'nextScene':
                // 跳转到下一个场景
                if(action.target) {
                    this.goToScene(action.target);
                }
                break;
            case 'fadeOut':
                this.fadeOut(action.duration || 1000, action.backgroundColor || 'black');
                break;
            case 'fadeIn':
                this.fadeIn(action.duration || 1000, action.backgroundColor || 'black');
                break;
            case 'clearName':
                this.clearNameBox();
                break;
            case 'hideText':
                this.hideTextBox();
                break;
            case 'showText':
                this.showTextBox();
                break;
            case 'hideAllCharacters':
                this.hideAllCharacters();
                break;
            case 'hideEventVisual':
                this.hideEventVisual();
                break;
            case 'finishGame':
                this.finishGame(action.bgColor, action.duration);
                break;
            case 'finishGameNoTransition':
                this.finishGameNoTransition(action.bgColor, action.duration);
                break;
            case 'chapterEnd':
                this.chapterEnd(action.bgColor, action.duration);
                break;
            case 'fadeOutWhite':
                // 淡出到白色
                this.fadeOut(action.duration || 1000, 'white');
                break;
            case 'windowMode':
                // 窗口模式切换
                this.setWindowMode(action.visible);
                break;
            case 'novelMode':
                // 小说模式切换
                this.setNovelMode(action.visible);
                break;
            case 'backgroundChange':
                // 背景切换（带动画）
                this.backgroundChangeWithTransition(action);
                break;
            case 'backgroundChangeNoTransition':
                // 背景切换（无动画）
                this.backgroundChangeWithoutTransition(action);
                break;
            case 'backgroundErase':
                this.backgroundErase(action);
                break;
            case 'eventShow':
                this.eventShow(action);
                break;
            case 'eventHide':
                this.eventHide(action);
                break;
            case 'whiteOut':
                this.whiteOut(action.time);
                break;
            case 'hideCharacter':
                this.hideCharacter(action.time);
                break;
            case 'betaFuraShow':
                this.betaFuraShow(action);
                break;
            case 'betaFuraEnd':
                this.betaFuraEnd(action);
                break;
            case 'eventBlurShow':
                this.eventBlurShow(action);
                break;
            case 'eventBlurRestore':
                this.eventBlurRestore(action);
                break;
            case 'sepiaStart':
                this.sepiaStart();
                break;
            case 'sepiaEnd':
                this.sepiaEnd();
                break;
            case 'sepiaStartWithWhiteout':
                this.sepiaStartWithWhiteout(action.time);
                break;
            case 'sepiaEndWithWhiteout':
                this.sepiaEndWithWhiteout(action.time);
                break;
            case 'fadeoutSepiaEnd':
                this.fadeoutSepiaEnd();
                break;
            case 'flashbackStart':
                this.flashbackStart(action);
                break;
            case 'flashbackEnd':
                this.flashbackEnd(action);
                break;
            case 'negaposiFlip':
                this.negaposiFlip(action);
                break;
            case 'negaposiFlipEnd':
                this.negaposiFlipEnd(action);
                break;
            case 'affinityChange':
                this.affinityChange(action);
                break;
            case 'affinityUpShow':
                this.affinityUpShow(action);
                break;
            case 'affinityDownShow':
                this.affinityDownShow(action);
                break;
            case 'conditional':
                // 条件判断开始
                this.handleConditional(action);
                break;
            case 'conditionalElse':
                // 条件判断else分支
                this.handleConditionalElse();
                break;
            case 'conditionalEnd':
                // 条件判断结束
                this.handleConditionalEnd();
                break;
            case 'addSelection':
                this.addSelection(action);
                break;
            case 'showSelections':
                this.showSelections();
                break;
            case 'returnToMenu':
                this.returnToMenu();
                break;
            case 'waitForClick':
                // 等待用户点击（不执行任何操作）
                break;
            case 'povShow':
                this.showPovIndicator(action.povName);
                break;
            case 'povStop':
                this.hidePovIndicator();
                break;
            default:
                console.log('未知动作类型:', action.type);
        }
    },
    
    /**
     * 执行背景转场：支持淡入淡出、滑屏及扫描式覆盖
     * @param {string} newBgPath - 新背景图片的路径
     * @param {Object} currentLine - 当前剧情行数据对象
     * @param {string} type - 转场类型 ('fade', 'slideL', 'slideR', 'scanL', 'scanR')
     */
    performBackgroundTransition: function(newBgPath, currentLine, type) {
        const duration = 1000; // 默认 1s 动画时长
        
        console.log(`开始原子化背景转场 (${type}):`, newBgPath);

        // 设置背景转场标志
        this.state.isBackgroundTransitioning = true;

        // 立即清空当前的文本和姓名显示，防止转场过程中残留上一行的内容
        this.elements.textBox.textContent = '';
        this.elements.nameBox.textContent = '';
        this.elements.nameBox.style.display = 'none';

        if (type === 'fade') {
            // 原有的淡入淡出逻辑
            this.fadeOut(duration, 'black', () => {
                this.removeAllChars();
                this.setBackground(newBgPath);
                setTimeout(() => {
                    this.fadeIn(duration, 'black');
                }, 50);
                this._resumeLineAfterTransition(currentLine, duration + 100);
            });
        } else if (type === 'slideL' || type === 'slideR') {
            // 整体位移滑屏逻辑
            this.performSlideTransition(newBgPath, currentLine, type, duration);
        } else if (type === 'scanL' || type === 'scanR') {
            // 扫描式覆盖逻辑
            this.performScanTransition(newBgPath, currentLine, type, duration);
        }
    },

    /**
     * 执行整体位移滑屏转场（左滑/右滑）
     */
    performSlideTransition: function(newBgPath, currentLine, type, duration) {
        const bgContainer = this.elements.backgroundContainer;
        
        // 预加载新背景图片
        const img = new Image();
        img.src = newBgPath;
        img.onload = () => {
            const newLayer = document.createElement('div');
            newLayer.className = 'slide-layer';
            newLayer.style.backgroundImage = `url('${newBgPath}')`;
            
            // 设置初始位置：根据滑动方向决定新背景从哪边进来
            if (type === 'slideL') {
                // 左滑：新背景从左侧 (-100%) 进入
                newLayer.style.transform = 'translateX(-100%)';
            } else {
                // 右滑：新背景从右侧 (100%) 进入
                newLayer.style.transform = 'translateX(100%)';
            }
            
            bgContainer.appendChild(newLayer);

            setTimeout(() => {
                // 触发动画：新背景归位，旧背景向反方向移出
                newLayer.style.transform = 'translateX(0)';
                
                // 旧背景容器向相反方向移动
                if (type === 'slideL') {
                    bgContainer.style.transform = 'translateX(100%)';
                } else {
                    bgContainer.style.transform = 'translateX(-100%)';
                }
            }, 50);

            // 动画结束后清理
            setTimeout(() => {
                this.removeAllChars();
                this.setBackground(newBgPath);
                
                // 重置旧背景容器的状态
                bgContainer.style.transition = 'none';
                bgContainer.style.transform = 'translateX(0)';
                void bgContainer.offsetWidth; // 强制重绘以应用重置
                bgContainer.style.transition = 'opacity 1s ease, transform 1s cubic-bezier(0.4, 0.0, 0.2, 1)';
                
                if (newLayer.parentNode) newLayer.parentNode.removeChild(newLayer);
                
                this._resumeLineAfterTransition(currentLine, 50);
            }, duration + 100);
        };
    },

    /**
     * 执行扫描式转场（左转场/右转场）- 使用 Clip-path 防止拉伸
     */
    performScanTransition: function(newBgPath, currentLine, type, duration) {
        const bgContainer = this.elements.backgroundContainer;
        
        // 预加载新背景图片
        const img = new Image();
        img.src = newBgPath;
        img.onload = () => {
            const newLayer = document.createElement('div');
            newLayer.className = 'slide-layer';
            
            // 根据转场类型添加特定的扫描线样式类
            if (type === 'scanL') {
                newLayer.classList.add('scan-left');
            } else if (type === 'scanR') {
                newLayer.classList.add('scan-right');
            }
            
            newLayer.style.backgroundImage = `url('${newBgPath}')`;
            
            // 设置初始裁剪区域：完全隐藏
            if (type === 'scanL') {
                // 左转场：从左侧开始扫描，初始裁剪掉右侧 100% 的内容
                newLayer.style.clipPath = 'inset(0 100% 0 0)';
                // 初始 mask 位置：渐变在右侧边缘
                newLayer.style.maskImage = 'linear-gradient(to right, black 0%, black 85%, rgba(0,0,0,0) 100%)';
                newLayer.style.webkitMaskImage = 'linear-gradient(to right, black 0%, black 85%, rgba(0,0,0,0) 100%)';
            } else {
                // 右转场：从右侧开始扫描，初始裁剪掉左侧 100% 的内容
                newLayer.style.clipPath = 'inset(0 0 0 100%)';
                // 初始 mask 位置：渐变在左侧边缘
                newLayer.style.maskImage = 'linear-gradient(to left, black 0%, black 85%, rgba(0,0,0,0) 100%)';
                newLayer.style.webkitMaskImage = 'linear-gradient(to left, black 0%, black 85%, rgba(0,0,0,0) 100%)';
            }
            
            bgContainer.appendChild(newLayer);

            // 强制重绘
            void newLayer.offsetWidth; 

            // 触发动画：显示全部内容
            requestAnimationFrame(() => {
                newLayer.style.clipPath = 'inset(0 0 0 0)';
                // 动画结束时，mask 渐变移到另一侧，实现平滑过渡
                if (type === 'scanL') {
                    // 左转场完成时，渐变移到左侧
                    newLayer.style.maskImage = 'linear-gradient(to right, rgba(0,0,0,0) 0%, black 15%, black 100%)';
                    newLayer.style.webkitMaskImage = 'linear-gradient(to right, rgba(0,0,0,0) 0%, black 15%, black 100%)';
                } else {
                    // 右转场完成时，渐变移到右侧
                    newLayer.style.maskImage = 'linear-gradient(to left, rgba(0,0,0,0) 0%, black 15%, black 100%)';
                    newLayer.style.webkitMaskImage = 'linear-gradient(to left, rgba(0,0,0,0) 0%, black 15%, black 100%)';
                }
            });

            // 动画结束后清理
            setTimeout(() => {
                this.removeAllChars();
                this.setBackground(newBgPath);
                if (newLayer.parentNode) newLayer.parentNode.removeChild(newLayer);
                this._resumeLineAfterTransition(currentLine, 50);
            }, duration + 50);
        };
    },

    /**
     * 执行滑屏转场（扫描式擦除效果）
     */
    performSlideTransition: function(newBgPath, currentLine, type, duration) {
        const bgContainer = this.elements.backgroundContainer;
        
        // 预加载新背景图片，防止闪烁
        const img = new Image();
        img.src = newBgPath;
        img.onload = () => {
            // 创建新背景层
            const newLayer = document.createElement('div');
            newLayer.className = 'slide-layer';
            newLayer.style.backgroundImage = `url('${newBgPath}')`;
            
            // 设置扫描起始状态：宽度为0，根据方向设置变换原点
            if (type === 'slideL') {
                // 左滑：从左侧开始扫描，原点在左
                newLayer.style.transformOrigin = 'left center';
                newLayer.style.transform = 'scaleX(0)';
            } else {
                // 右滑：从右侧开始扫描，原点在右
                newLayer.style.transformOrigin = 'right center';
                newLayer.style.transform = 'scaleX(0)';
            }
            
            bgContainer.appendChild(newLayer);

            // 强制重绘：确保浏览器应用了初始的 scaleX(0)
            void newLayer.offsetWidth; 

            // 触发动画：展开至全屏 (scaleX 1)
            requestAnimationFrame(() => {
                newLayer.style.transform = 'scaleX(1)';
            });

            // 动画结束后清理
            setTimeout(() => {
                this.removeAllChars();
                this.setBackground(newBgPath);
                
                // 移除临时层
                if (newLayer.parentNode) newLayer.parentNode.removeChild(newLayer);
                
                this._resumeLineAfterTransition(currentLine, 50);
            }, duration + 50);
        };
    },

    /**
     * 转场结束后恢复当前行剩余逻辑的通用函数
     */
    _resumeLineAfterTransition: function(currentLine, delay) {
        setTimeout(() => {
            console.log('转场结束，恢复渲染当前行剩余内容');
            
            // 清除背景转场标志
            this.state.isBackgroundTransitioning = false;
            
            // 1. 恢复姓名框显示
            if (currentLine.speaker !== undefined) {
                if (currentLine.speaker === null) {
                    this.elements.nameBox.style.display = 'none';
                } else {
                    this.elements.nameBox.textContent = currentLine.speaker;
                    this.elements.nameBox.style.display = 'block';
                }
            }

            // 2. 恢复文本渲染
            if (currentLine.text) {
                this.typeTextWithSplits(currentLine.text);
            }

            // 3. 渲染立绘（使用渐变效果）
            if (currentLine.chars) {
                // 临时设置标志，让立绘以渐变方式出现
                const originalTransitionState = this.state.isBackgroundTransitioning;
                this.state.isBackgroundTransitioning = false; // 允许渐变效果
                this.renderChars(currentLine.chars);
                this.state.isBackgroundTransitioning = originalTransitionState;
            }
            
            // 4. 处理音频与 BGM
            if (currentLine.audio) {
                 if (this.sceneData.audio && this.sceneData.audio[currentLine.audio]) {
                    this.playAudio(currentLine.audio);
                 }
            }

            // 处理 BGM 切换逻辑
            if (currentLine.bgm) {
                if (currentLine.bgm === 'bgm stop') {
                    this.stopBGM();
                } else if (typeof currentLine.bgm === 'string' && currentLine.bgm.startsWith('bgm wait ')) {
                    const newBgmKey = currentLine.bgm.substring('bgm wait '.length).trim();
                    this.fadeOutAndPlayBGM(newBgmKey);
                } else if (this.sceneData.bgm && this.sceneData.bgm[currentLine.bgm]) {
                    this.playAudio(currentLine.bgm);
                }
            }

            // 更新行号，准备进入下一行
            this.state.currentLine = this.state.currentLine; 
            
            // 更新调试日志信息（如果系统模块已加载）
            if (typeof systemModule !== 'undefined' && systemModule.updateDebugInfo) {
                systemModule.updateDebugInfo();
            }
        }, delay);
    },

    /**
     * 淡出效果
     * 创建覆盖层并逐渐增加不透明度，实现淡出到指定颜色的效果
     * @param {number} duration - 淡出持续时间（毫秒）
     * @param {string} backgroundColor - 淡出目标颜色
     * @param {Function} [callback] - 淡出完成后的回调函数
     */
    fadeOut: function(duration, backgroundColor, callback) {
        // 如果已有覆盖层，先移除
        const existingOverlay = document.getElementById('fade-overlay');
        if (existingOverlay) {
            document.body.removeChild(existingOverlay);
        }

        // 创建淡出覆盖层
        const overlay = document.createElement('div');
        overlay.id = 'fade-overlay';
        overlay.style.position = 'fixed'; // 改为 fixed 确保覆盖全屏且不受滚动影响
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = backgroundColor;
        overlay.style.zIndex = '9999'; // 提高层级确保在最上层
        overlay.style.opacity = '0';
        overlay.style.transition = `opacity ${duration}ms ease-in-out`; // 使用 ease-in-out 更平滑
        overlay.style.pointerEvents = 'none';
        document.body.appendChild(overlay);
        
        // 强制重绘并触发动画
        // 使用 setTimeout 0 确保 DOM 渲染完成后再设置 opacity
        setTimeout(() => {
            overlay.style.opacity = '1';
        }, 10);

        setTimeout(() => {
            if (callback && typeof callback === 'function') {
                callback();
            }
        }, duration + 50); // 稍微增加一点等待时间确保动画完全结束
    },
    
    /**
     * 淡入效果
     */
    fadeIn: function(duration, backgroundColor) {
        const overlay = document.getElementById('fade-overlay');
        if (!overlay) {
            console.warn('fadeIn: 未找到遮罩层，跳过淡入');
            return;
        }
        
        overlay.style.transition = `opacity ${duration}ms ease-in-out`;
        
        // 强制重绘并触发动画
        setTimeout(() => {
            overlay.style.opacity = '0';
        }, 10);

        setTimeout(() => {
            if (overlay.parentNode) {
                document.body.removeChild(overlay);
            }
        }, duration + 50);
    },
    
    /**
     * 清除姓名框
     * 清空姓名文本并隐藏姓名框
     */
    clearNameBox: function() {
        this.elements.nameBox.textContent = '';
        this.elements.nameBox.style.display = 'none';
    },
    
    /**
     * 隐藏文本框
     */
    hideTextBox: function() {
        this.elements.textContainer.style.display = 'none';
    },
    
    /**
     * 显示文本框
     */
    showTextBox: function() {
        this.elements.textContainer.style.display = 'flex';
    },
    
    /**
     * 处理场景结束逻辑
     * 标记场景完成并显示点击提示
     */
    handleEndOfScene: function() {
        // 标记当前场景为已完成
        this.markSceneCompleted();
        
        console.log("场景结束，等待用户操作或自动跳转");
        
        // 显示点击提示
        this.addClickPrompt();
    },
    
    /**
     * 添加点击提示
     * 在屏幕上显示“点击继续”提示，3秒后自动消失
     */
    addClickPrompt: function() {
        let prompt = document.querySelector('.click-prompt');
        if (!prompt) {
            prompt = document.createElement('div');
            prompt.className = 'click-prompt';
            prompt.textContent = '点击继续';
            document.body.appendChild(prompt);
        }
        
        // 3秒后自动移除提示
        setTimeout(() => {
            if (prompt && prompt.parentNode) {
                prompt.parentNode.removeChild(prompt);
            }
        }, 3000);
    },
    
    /**
     * 带分段等待的文本显示
     * 支持文本内的[s]标签，实现分段显示和点击继续功能
     * @param {string} text - 要显示的文本内容
     */
    typeTextWithSplits: function(text) {
        // 根据模式选择文本容器并清空
        if (this.state.novelMode) {
            this.elements.novelTextBox.textContent = '';
        } else {
            this.elements.textBox.textContent = '';
        }
        
        // 按[s]标签分割文本
        const segments = text.split(/\[s\]/i);
        
        if (segments.length <= 1) {
            // 没有[s]标签，使用普通打字机效果
            this.typeText(text);
            return;
        }
        
        // 存储分段信息到状态中
        this.state.textSegments = segments;
        this.state.currentSegment = 0;
        this.state.waitingForSegmentClick = false;
        
        // 显示第一段
        this.displayTextSegment(0);
    },
    
    /**
     * 显示文本片段（累积显示模式）
     * 逐段显示文本，每段显示后等待用户点击
     * @param {number} segmentIndex - 要显示的分段索引
     */
    displayTextSegment: function(segmentIndex) {
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
            
            this.state.waitingForSegmentClick = true;
            this.showClickPrompt();
        } else {
            // 空片段，直接进入下一段
            setTimeout(() => {
                this.displayNextSegment();
            }, 100);
        }
    },
    
    /**
     * 显示累积文本
     * 先显示已有内容，然后对新增部分使用打字效果
     * @param {string} fullText - 完整的累积文本
     * @param {number} currentSegment - 当前分段索引
     */
    showCumulativeText: function(fullText, currentSegment) {
        // 计算之前的内容长度
        let previousLength = 0;
        for (let i = 0; i < currentSegment; i++) {
            previousLength += this.state.textSegments[i].length;
        }
        
        const targetBox = this.state.novelMode ? this.elements.novelTextBox : this.elements.textBox;
        
        // 显示已有的内容
        targetBox.textContent = fullText.substring(0, previousLength);
        
        // 对新增部分使用打字效果
        const newText = fullText.substring(previousLength);
        if (newText) {
            this.typeTextAppend(newText);
        } else {
            this.state.typingActive = false;
        }
    },
    
    /**
     * 追加打字效果
     * 在现有文本基础上继续打字显示
     * @param {string} text - 要追加显示的文本
     */
    typeTextAppend: function(text) {
        let i = 0;
        const speed = 30;
        
        const targetBox = this.state.novelMode ? this.elements.novelTextBox : this.elements.textBox;
        
        this.state.typingActive = true;
        
        const typeWriter = () => {
            if (i < text.length) {
                targetBox.textContent += text.charAt(i);
                i++;
                this.state.typingTimerId = setTimeout(typeWriter, speed);
            } else {
                this.state.typingActive = false;
                this.state.typingTimerId = null;
                this.state.textFullyDisplayed = true;
            }
        };
        
        typeWriter();
    },
    
    /**
     * 显示下一段文本
     */
    displayNextSegment: function() {
        if (this.state.textSegments && this.state.currentSegment < this.state.textSegments.length - 1) {
            this.displayTextSegment(this.state.currentSegment + 1);
        } else {
            // 所有片段显示完毕，重置状态
            this.state.textSegments = null;
            this.state.currentSegment = 0;
            this.state.waitingForSegmentClick = false;
            this.state.audioSegments = null;      
            this.state.currentAudioSegment = 0;   
        }
    },
    
    /**
     * 显示点击提示（占位函数）
     */
    showClickPrompt: function() {
        console.log("等待点击继续...");
    },
    
    /**
     * 处理分段文本的点击事件
     * 用户点击后显示下一段文本并切换音频
     */
    handleSegmentClick: function() {
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
    },
    
    /**
     * 隐藏点击提示（占位函数）
     */
    hideClickPrompt: function() {
        console.log("点击提示已隐藏");
    },
    
    /**
     * 打字机效果显示文本
     * 逐字符显示文本，支持HTML标签处理
     * @param {string} text - 要显示的文本内容
     */
    typeText: function(text) {
        let processedText = this.processLineBreaks(text);
        
        const targetBox = this.state.novelMode ? this.elements.novelTextBox : this.elements.textBox;
            
        targetBox.innerHTML = '';
        let i = 0;
        const speed = 30; // 打字速度，毫秒
            
        this.state.typingActive = true;
            
        const typeWriter = () => {
            if (i < processedText.length) {
                // 处理 HTML 标签，确保不会在标签中间断开
                let charToAdd = processedText.charAt(i);
                    
                // 如果遇到<，需要找到对应的>
                if (charToAdd === '<') {
                    let tagEnd = processedText.indexOf('>', i);
                    if (tagEnd !== -1) {
                        // 添加整个标签
                        targetBox.innerHTML += processedText.substring(i, tagEnd + 1);
                        i = tagEnd + 1;
                    } else {
                        // 如果没有找到>，当作普通字符处理
                        targetBox.innerHTML += charToAdd;
                        i++;
                    }
                } else {
                    targetBox.innerHTML += charToAdd;
                    i++;
                }
                    
                this.state.typingTimerId = setTimeout(typeWriter, speed);
            } else {
                this.state.typingActive = false;
                this.state.typingTimerId = null;
                this.state.textFullyDisplayed = true;
            }
        };
            
        typeWriter();
    },
    
    /**
     * 处理换行标签
     * 将多种换行标记格式统一转换为HTML <br> 标签
     * @param {string} text - 原始文本
     * @returns {string} - 处理后的文本
     */
    processLineBreaks: function(text) {
        if (!text) return text;
        
        // 支持多种换行标记格式
        return text
            .replace(/\[br\]/gi, '<br>')      // [br] 标签
            .replace(/\\n/g, '<br>')         // \n 转义字符
            .replace(/<br\s*\/?>/gi, '<br>') // HTML <br> 标签（标准化）
            .replace(/\n/g, '<br>');          // 普通换行符
    },
    
    /**
     * 推进到下一行对话
     * 处理打字机效果、文本完整显示、场景结束等逻辑
     */
    nextLine: function() {
        // 如果选项菜单激活，不处理
        if (this.state.choicesActive) return; 
        
        // 中断所有正在进行的连续动作指令，并跳转到最终状态
        this.interruptCharSequences();
        
        // 清除音频序列状态
        this.state.audioSegments = null;
        this.state.currentAudioSegment = 0;
        
        // 如果正在打字，立即停止并显示完整文本
        if (this.state.typingActive) {
            // 清除定时器
            if (this.state.typingTimerId !== null) {
                clearTimeout(this.state.typingTimerId);
                this.state.typingTimerId = null;
            }
            this.state.typingActive = false;
            
            // 根据模式选择文本容器
            const targetBox = this.state.novelMode ? this.elements.novelTextBox : this.elements.textBox;
            
            // 获取当前应该显示的完整文本
            let fullText = '';
            if (this.state.textSegments) {
                // 对于分段文本，累积显示到当前段
                for (let i = 0; i <= this.state.currentSegment; i++) {
                    fullText += this.state.textSegments[i];
                }
            } else {
                // 对于普通文本，从当前行获取
                const currentLine = this.sceneData.story[this.state.currentLine];
                if (currentLine && currentLine.text) {
                    fullText = this.processLineBreaks(currentLine.text);
                }
            }
            
            // 立即显示完整文本
            targetBox.innerHTML = fullText;
            
            // 设置标志，表示文本已完整显示，下次点击才进入下一行
            this.state.textFullyDisplayed = true;
            return;
        }
        
        // 检查是否已经完整显示了当前文本
        if (this.state.textFullyDisplayed) {
            this.state.textFullyDisplayed = false;
            // 重置分段状态
            this.state.textSegments = null;
            this.state.currentSegment = 0;
            this.state.waitingForSegmentClick = false;
        }
        
        // 推进到下一行
        this.state.currentLine++;
        
        if (this.state.currentLine < this.sceneData.story.length) {
            this.displayLine(this.state.currentLine);
        } else {
            // 到达场景末尾
            console.log("到达场景末尾，准备跳转...");
        }
    },
    
    /**
     * 开始快进模式
     * 按住Ctrl键时快速推进对话
     */
    startFastForward: function() {
        if (this.state.fastForwardActive || this.state.choicesActive) return;
        
        this.state.fastForwardActive = true;
        console.log("开始快进...");
        
        // 立即执行一次
        this.nextLine();
        
        // 每50ms自动执行一次，实现快进效果
        this.state.fastForwardTimerId = setInterval(() => {
            if (!this.state.fastForwardActive || this.state.choicesActive) {
                this.stopFastForward();
                return;
            }
            this.nextLine();
        }, 50); 
    },
    
    /**
     * 停止快进模式
     */
    stopFastForward: function() {
        if (!this.state.fastForwardActive) return;
        
        this.state.fastForwardActive = false;
        
        if (this.state.fastForwardTimerId !== null) {
            clearInterval(this.state.fastForwardTimerId);
            this.state.fastForwardTimerId = null;
        }
        
        console.log("停止快进");
    },
    
    /**
     * 跳转到指定场景
     * @param {string} sceneUrl - 目标场景的URL
     */
    goToScene: function(sceneUrl) {
        // 停止所有音频
        this.stopAllAudioWithBGM();
        // 清除POV状态
        this.clearPovState();
        // 跳转页面
        window.location.href = sceneUrl;
    },
    
    /**
     * 设置背景图片
     * @param {string} imagePath - 背景图片路径
     */
    setBackground: function(imagePath) {
        this.elements.backgroundContainer.style.backgroundImage = `url('${imagePath}')`;
        this.elements.backgroundContainer.style.backgroundSize = 'cover';
        this.elements.backgroundContainer.style.backgroundPosition = 'center';
    },
    
    /**
     * 播放音频
     * 根据音频类型（BGM/语音）选择对应的播放器，处理浏览器自动播放限制
     * @param {string} audioKey - 音频键名，从场景数据的bgm或audio中查找
     */
    playAudio: function(audioKey) {
        let audioPath = null;
        let isBgm = false;
        
        // 优先检查是否为BGM
        if (this.sceneData.bgm && this.sceneData.bgm[audioKey]) {
            audioPath = this.sceneData.bgm[audioKey];
            isBgm = true;  
        } 
        // 否则检查是否为普通音频
        else if (this.sceneData.audio && this.sceneData.audio[audioKey]) {
            audioPath = this.sceneData.audio[audioKey];
            isBgm = false;
        }
        
        if (!audioPath) {
            console.log("音频文件路径不存在:", audioKey);
            return;
        }
        
        console.log("播放音频:", audioKey, "路径:", audioPath, "是否为BGM:", isBgm);
        
        // BGM处理逻辑
        if (isBgm) {
            // 如果当前播放的不是同一个BGM，则重新加载
            if (this.elements.bgmPlayer.src !== audioPath) {
                this.elements.bgmPlayer.src = audioPath;
                this.elements.bgmPlayer.loop = true;
                
                const playPromise = this.elements.bgmPlayer.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.log("BGM播放失败，请注意浏览器自动播放策略限制，可能需要用户交互后才能播放:", error);
                        
                        // 尝试解锁音频上下文
                        this.elements.bgmPlayer.volume = 0;
                        this.elements.bgmPlayer.play().then(() => {
                            this.elements.bgmPlayer.volume = 1;
                            this.elements.bgmPlayer.currentTime = 0;
                        }).catch(err => {
                            console.log("即使尝试解锁后BGM仍无法播放:", err);
                        });
                    });
                }
            } else {
                // 如果是同一个BGM，确保循环播放
                this.elements.bgmPlayer.loop = true;
            }
        } else {
            // 非BGM音频（语音/音效）处理
            this.elements.voicePlayer.pause();
            this.elements.sePlayer.pause();
            this.elements.voicePlayer.loop = false;
            this.elements.voicePlayer.src = audioPath;
            const playPromise = this.elements.voicePlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log("音频播放失败，请注意浏览器自动播放策略限制:", error);
                    
                    // 尝试解锁音频上下文
                    this.elements.voicePlayer.volume = 0;
                    this.elements.voicePlayer.play().then(() => {
                        this.elements.voicePlayer.volume = 1;
                        this.elements.voicePlayer.currentTime = 0;
                    }).catch(err => {
                        console.log("即使尝试解锁后语音仍无法播放:", err);
                    });
                });
            }
        }
    },
    
    /**
     * 解析音频序列
     * 将包含[a]标签的音频字符串分割成数组
     * @param {string} audioStr - 音频序列字符串，如 "audio1[a]audio2[a]audio3"
     * @returns {Array} - 音频键名数组
     */
    parseAudioSequence: function(audioStr) {
        if (!audioStr || typeof audioStr !== 'string') {
            return [];
        }
        
        // 按[a]标签分割并过滤空字符串
        const segments = audioStr.split(/\[a\]/i);
        return segments.filter(seg => seg.trim().length > 0);
    },
    
    /**
     * 停止所有音频（不含BGM）
     */
    stopAllAudio: function() {
        this.elements.voicePlayer.pause();
        this.elements.sePlayer.pause();
    },
    
    /**
     * 停止所有音频（包括BGM）
     */
    stopAllAudioWithBGM: function() {
        this.elements.bgmPlayer.pause();
        this.elements.sePlayer.pause();
        this.elements.voicePlayer.pause();
    },
    
    /**
     * 停止BGM播放
     */
    stopBGM: function() {
        if (this.elements.bgmPlayer) {
            this.elements.bgmPlayer.pause();
            this.elements.bgmPlayer.currentTime = 0;
            console.log("BGM已停止播放");
        }
    },
    
    /**
     * 淡出当前BGM并播放新BGM
     * 实现平滑的BGM切换效果
     * @param {string} newBgmKey - 新BGM的键名
     */
    fadeOutAndPlayBGM: function(newBgmKey) {
        const bgmPlayer = this.elements.bgmPlayer;
        
        // 查找新BGM路径
        let audioPath = null;
        if (this.sceneData.bgm && this.sceneData.bgm[newBgmKey]) {
            audioPath = this.sceneData.bgm[newBgmKey];
        }
        
        if (!audioPath) {
            console.log("新BGM路径不存在:", newBgmKey);
            this.nextLine();
            return;
        }
        
        console.log("开始BGM淡出切换，新BGM:", newBgmKey);
        
        // 如果当前没有播放BGM，直接播放新的
        if (!bgmPlayer.src || bgmPlayer.paused) {
            bgmPlayer.src = audioPath;
            bgmPlayer.loop = true;
            bgmPlayer.volume = 1;
            bgmPlayer.play().catch(error => {
                console.log("BGM播放失败:", error);
            });
            this.nextLine();
            return;
        }
        
        // 淡出参数设置
        const fadeDuration = 1000; // 1秒淡出
        const fadeSteps = 20; 
        const fadeInterval = fadeDuration / fadeSteps;
        const volumeStep = bgmPlayer.volume / fadeSteps;
        let currentStep = 0;
        
        // 执行淡出动画
        const fadeOutInterval = setInterval(() => {
            currentStep++;
            bgmPlayer.volume = Math.max(0, bgmPlayer.volume - volumeStep);
            
            if (currentStep >= fadeSteps) {
                clearInterval(fadeOutInterval);
                bgmPlayer.volume = 0;
                bgmPlayer.pause();
                bgmPlayer.currentTime = 0;
                
                // 加载并播放新BGM
                bgmPlayer.src = audioPath;
                bgmPlayer.loop = true;
                bgmPlayer.volume = 1;
                bgmPlayer.play().catch(error => {
                    console.log("新BGM播放失败:", error);
                });
                
                console.log("BGM切换完成:", newBgmKey);
                
                // 继续下一行
                this.nextLine();
            }
        }, fadeInterval);
    },
    
    /**
     * 播放视频
     * @param {string} videoKey - 视频键名，从场景数据的videos中查找
     */
    playVideo: function(videoKey) {
        if (!this.elements.videoPlayer || !this.elements.mainVideo) {
            console.log('视频播放器未找到');
            return;
        }
        
        const videoPath = this.sceneData.videos ? this.sceneData.videos[videoKey] : null;
        
        if (!videoPath) {
            console.log('视频路径未找到:', videoKey);
            return;
        }
        
        // 设置视频源
        this.elements.mainVideo.src = videoPath;
        
        // 显示视频播放器
        this.elements.videoPlayer.style.display = 'block';
        
        this.elements.mainVideo.play().catch(e => console.log('视频播放失败:', e));
        
        // 设置跳过视频的快捷键
        this.setupVideoSkip();
    },
    
    /**
     * 设置视频跳过功能
     * 支持右键点击和ESC键跳过视频
     */
    setupVideoSkip: function() {
        const self = this;
        
        // 右键点击跳过
        this.elements.videoPlayer.oncontextmenu = function(e) {
            e.preventDefault();
            self.skipVideo();
        };
        
        // ESC键跳过
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && self.elements.videoPlayer.style.display === 'block') {
                self.skipVideo();
            }
        });
    },
    
    /**
     * 跳过视频
     * 隐藏视频播放器并继续下一行
     */
    skipVideo: function() {
        if (this.elements.videoPlayer && this.elements.mainVideo) {
            this.elements.videoPlayer.style.display = 'none';
            this.elements.mainVideo.pause();
            this.elements.mainVideo.currentTime = 0;
            
            // 继续下一行
            this.nextLine();
        }
    },
    
    /**
     * 设置全屏小说模式
     * @param {boolean} enabled - 是否启用小说模式
     */
    setNovelMode: function(enabled) {
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
            
            // 恢复角色立绘和对话框
            this.elements.characterContainer.style.display = '';
            this.elements.textContainer.style.display = 'flex';
        }
    },
    
    /**
     * 隐藏所有角色立绘
     */
    hideAllCharacters: function() {
        const characters = this.elements.characterContainer.querySelectorAll('.character');
        characters.forEach(char => {
            char.style.opacity = '0';
            char.style.visibility = 'hidden';
        });
    },
    
    /**
     * 隐藏事件CG和特效层
     */
    hideEventVisual: function() {
        const eventElements = document.querySelectorAll('.event-image, .effect-layer');
        eventElements.forEach(el => {
            el.style.opacity = '0';
            el.style.visibility = 'hidden';
        });
    },
    
    /**
     * 游戏结束（带淡出效果）
     * @param {string} bgColor - 淡出背景颜色
     * @param {number} duration - 淡出持续时间
     */
    finishGame: function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 执行淡出效果
        this.fadeOut(duration || 1500, bgColor || 'black');
    },
    
    /**
     * 游戏结束（无转场效果）
     * @param {string} bgColor - 背景颜色
     * @param {number} duration - 持续时间
     */
    finishGameNoTransition: function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 创建覆盖层，直接显示不淡出
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
    },
    
    /**
     * 章节结束
     * 淡出后返回主菜单
     * @param {string} bgColor - 淡出背景颜色
     * @param {number} duration - 淡出持续时间
     */
    chapterEnd: function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 淡出后返回主菜单
        this.fadeOut(duration || 1500, bgColor || 'black', () => {
            setTimeout(() => {
                this.returnToMenu();
            }, 100);
        });
    },
    
    /**
     * 设置窗口模式
     * @param {boolean} visible - 是否显示文本框
     */
    setWindowMode: function(visible) {
        this.hideTextBox();
        
        if (visible) {
            this.showTextBox();
        }
    },
    
    /**
     * 背景切换（带动画）
     * 先淡出，切换背景，再淡入
     * @param {Object} options - 切换选项
     */
    backgroundChangeWithTransition: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 淡出后切换背景并淡入
        this.fadeOut(200, 'black', () => {
            this.setBackgroundWithPosition(options);
                    
            this.fadeIn(options.time || 1000, 'black');
        });
    },
    
    /**
     * 背景切换（无动画）
     * 直接切换背景，然后淡入
     * @param {Object} options - 切换选项
     */
    backgroundChangeWithoutTransition: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 直接设置背景
        this.setBackgroundWithPosition(options);
        
        this.fadeIn(options.time || 1000, 'transparent');
    },
    
    /**
     * 根据配置设置背景位置
     * @param {Object} options - 背景配置选项
     */
    setBackgroundWithPosition: function(options) {
        // 使用通配符背景（如果存在）
        if (this.sceneData.background['*']) {
            this.setBackground(this.sceneData.background['*']);
        }
    },
    
    /**
     * 背景消除
     * 隐藏背景并淡入指定颜色
     * @param {Object} options - 消除选项，包含time和transition
     */
    backgroundErase: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 隐藏背景容器
        this.elements.backgroundContainer.style.visibility = 'hidden';
        
        // 淡入过渡色
        this.fadeIn(options.time || 1000, options.transition || 'black');
    },
    
    /**
     * 显示事件CG
     * 创建并淡入事件图片
     * @param {Object} options - 显示选项，包含file、opacity、time等
     */
    eventShow: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        if (options.file && this.sceneData.events && this.sceneData.events[options.file]) {
            // 创建事件图片元素
            const eventImg = document.createElement('img');
            eventImg.id = 'event-image';
            eventImg.src = this.sceneData.events[options.file];
            eventImg.style.position = 'absolute';
            eventImg.style.top = '50%';
            eventImg.style.left = '50%';
            eventImg.style.transform = 'translate(-50%, -50%)';
            eventImg.style.maxWidth = '100%';
            eventImg.style.maxHeight = '100%';
            eventImg.style.opacity = '0';
            eventImg.style.zIndex = '500';
            
            document.body.appendChild(eventImg);
            
            // 执行淡入动画
            let opacity = 0;
            const fadeInInterval = setInterval(() => {
                opacity += 0.05;
                if (opacity >= options.opacity / 255) {
                    opacity = options.opacity / 255;
                    clearInterval(fadeInInterval);
                    
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                eventImg.style.opacity = opacity;
            }, options.time / 20);
        } else {
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    /**
     * 隐藏事件CG
     * 淡出并移除事件图片
     * @param {Object} options - 隐藏选项
     */
    eventHide: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 查找并淡出事件图片
        const eventImg = document.getElementById('event-image');
        if (eventImg) {
            let opacity = parseFloat(eventImg.style.opacity) || 1;
            const fadeOutInterval = setInterval(() => {
                opacity -= 0.05;
                if (opacity <= 0) {
                    opacity = 0;
                    clearInterval(fadeOutInterval);
                    eventImg.remove();
                    
                    // 继续下一行
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                eventImg.style.opacity = opacity;
            }, options.time / 20);
        } else {
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    /**
     * 白色闪屏效果
     * 先淡入白色覆盖层，再淡出，实现闪屏转场效果
     * @param {number} time - 动画持续时间（毫秒）
     */
    whiteOut: function(time) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 创建白色覆盖层
        const overlay = document.createElement('div');
        overlay.id = 'white-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'white';
        overlay.style.zIndex = '700';
        overlay.style.opacity = '0';
        document.body.appendChild(overlay);
        
        // 执行淡入动画
        let opacity = 0;
        const fadeInterval = setInterval(() => {
            opacity += 0.05;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(fadeInterval);
                
                // 淡入完成后执行淡出动画
                const fadeOutInterval = setInterval(() => {
                    opacity -= 0.05;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeOutInterval);
                        overlay.remove();
                        
                        // 继续下一行
                        setTimeout(() => {
                            this.nextLine();
                        }, 100);
                    }
                    overlay.style.opacity = opacity;
                }, time / 20);
            }
            overlay.style.opacity = opacity;
        }, time / 20);
    },
    
    /**
     * 隐藏角色立绘（带动画）
     * 所有角色同时淡出
     * @param {number} time - 淡出持续时间（毫秒）
     */
    hideCharacter: function(time) {
        const characters = this.elements.characterContainer.querySelectorAll('.character');
        if (characters.length > 0) {
            let completedCount = 0;
            // 对所有角色执行淡出动画
            characters.forEach(char => {
                let opacity = parseFloat(char.style.opacity) || 1;
                const fadeInterval = setInterval(() => {
                    opacity -= 0.05;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeInterval);
                        char.style.visibility = 'hidden';
                        completedCount++;
                        
                        // 所有角色都淡出完成后继续下一行
                        if (completedCount === characters.length) {
                            setTimeout(() => {
                                this.nextLine();
                            }, 100);
                        }
                    }
                    char.style.opacity = opacity;
                }, time / 20);
            });
        } else {
            // 没有角色时直接继续
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    /**
     * 单色显示效果（淡出黑色覆盖层）
     * 创建黑色覆盖层并逐渐淡出
     * @param {Object} options - 包含time参数
     */
    betaFuraShow: function(options) {
        // 创建黑色覆盖层
        const overlay = document.createElement('div');
        overlay.id = 'circle-expand-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'black';
        overlay.style.zIndex = '800';
        overlay.style.opacity = '1';
        document.body.appendChild(overlay);
        
        // 执行淡出动画
        let opacity = 1;
        const intervalTime = 16;
        const steps = options.time / intervalTime;
        const opacityStep = 1 / steps;
        
        const animate = () => {
            opacity -= opacityStep;
            if (opacity <= 0) {
                opacity = 0;
                clearInterval(animInterval);
                overlay.remove();
                
                setTimeout(() => {
                    this.nextLine();
                }, 100);
            }
            overlay.style.opacity = opacity;
        };
        
        const animInterval = setInterval(animate, intervalTime);
    },
    
    /**
     * 单色效果结束（淡入黑色覆盖层）
     * 清除UI元素，创建黑色覆盖层并淡入
     * @param {Object} options - 配置选项
     */
    betaFuraEnd: function(options) {
        // 清除UI元素
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 创建黑色覆盖层
        const overlay = document.createElement('div');
        overlay.id = 'temp-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'black';
        overlay.style.zIndex = '800';
        overlay.style.opacity = '0';
        document.body.appendChild(overlay);
        
        // 执行淡入动画
        let opacity = 0;
        const intervalTime = 16;
        const steps = 500 / intervalTime; 
        const opacityStep = 1 / steps;
        
        const fadeIn = () => {
            opacity += opacityStep;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(fadeInInterval);
                
                
                const fadeOut = () => {
                    opacity -= opacityStep;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeOutInterval);
                        overlay.remove();
                                        
                        setTimeout(() => {
                            this.nextLine();
                        }, 100);
                    }
                    overlay.style.opacity = opacity;
                };
                
                const fadeOutInterval = setInterval(fadeOut, intervalTime);
            }
            overlay.style.opacity = opacity;
        };
        
        const fadeInInterval = setInterval(fadeIn, intervalTime);
    },
    
    /**
     * 显示模糊事件CG
     * 创建带有模糊效果的事件图片并淡入
     * @param {Object} options - 包含file、blur、time等参数
     */
    eventBlurShow: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 如果存在事件图片，创建并淡入
        if (options.file && this.sceneData.events && this.sceneData.events[options.file]) {
            const eventImg = document.createElement('img');
            eventImg.id = 'event-blur-image';
            eventImg.src = this.sceneData.events[options.file];
            eventImg.style.position = 'absolute';
            eventImg.style.top = '50%';
            eventImg.style.left = '50%';
            eventImg.style.transform = 'translate(-50%, -50%)';
            eventImg.style.maxWidth = '100%';
            eventImg.style.maxHeight = '100%';
            // 应用模糊滤镜
            eventImg.style.filter = `blur(${options.blur}px)`;
            eventImg.style.opacity = '0';
            eventImg.style.zIndex = '500';
            
            document.body.appendChild(eventImg);
            
            // 执行淡入动画
            let opacity = 0;
            const intervalTime = 16;
            const steps = options.time / intervalTime;
            const opacityStep = 1 / steps;
            
            const fadeInInterval = setInterval(() => {
                opacity += opacityStep;
                if (opacity >= 1) {
                    opacity = 1;
                    clearInterval(fadeInInterval);
                    
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                eventImg.style.opacity = opacity;
            }, intervalTime);
        } else {
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    /**
     * 恢复模糊事件CG（清除模糊并淡出）
     * @param {Object} options - 包含time参数
     */
    eventBlurRestore: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 查找模糊事件图片
        const eventImg = document.getElementById('event-blur-image');
        if (eventImg) {
            // 清除模糊效果
            eventImg.style.filter = 'blur(0px)';
            
            // 执行淡出动画
            let opacity = 1;
            const intervalTime = 16;
            const steps = options.time / intervalTime;
            const opacityStep = 1 / steps;
            
            const fadeInterval = setInterval(() => {
                opacity -= opacityStep;
                if (opacity <= 0) {
                    opacity = 0;
                    clearInterval(fadeInterval);
                    eventImg.remove();
                    
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                eventImg.style.opacity = opacity;
            }, intervalTime);
        } else {
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    /**
     * 开始怀旧滤镜（棕褐色调）
     * 对整个页面应用grayscale和sepia滤镜
     */
    sepiaStart: function() {
        // 应用怀旧滤镜
        document.body.style.filter = 'grayscale(100%) sepia(100%)';
        
        setTimeout(() => {
            this.nextLine();
        }, 100);
    },
    
    /**
     * 结束怀旧滤镜
     * 移除所有CSS滤镜效果
     */
    sepiaEnd: function() {
        // 清除滤镜
        document.body.style.filter = 'none';
        
        setTimeout(() => {
            this.nextLine();
        }, 100);
    },
    
    /**
     * 怀旧滤镜开始（带白屏转场）
     * 先应用怀旧滤镜，然后执行白屏闪动效果
     * @param {number} time - 动画持续时间
     */
    sepiaStartWithWhiteout: function(time) {
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 应用怀旧滤镜
        document.body.style.filter = 'grayscale(100%) sepia(100%)';
        
        // 创建白色覆盖层并执行淡入淡出动画
        const overlay = document.createElement('div');
        overlay.id = 'white-overlay-temp';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'white';
        overlay.style.zIndex = '750';
        overlay.style.opacity = '0';
        document.body.appendChild(overlay);
        
        let opacity = 0;
        const intervalTime = 16;
        const steps = time / intervalTime / 2; 
        const opacityStep = 1 / steps;
        
        const fadeIn = () => {
            opacity += opacityStep;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(fadeInInterval);
                
                const fadeOut = () => {
                    opacity -= opacityStep;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeOutInterval);
                        overlay.remove();
                                        
                        setTimeout(() => {
                            this.nextLine();
                        }, 100);
                    }
                    overlay.style.opacity = opacity;
                };
                
                const fadeOutInterval = setInterval(fadeOut, intervalTime);
            }
            overlay.style.opacity = opacity;
        };
        
        const fadeInInterval = setInterval(fadeIn, intervalTime);
    },
    
    /**
     * 怀旧滤镜结束（带白屏转场）
     * 清除怀旧滤镜，执行白屏闪动效果
     * @param {number} time - 动画持续时间
     */
    sepiaEndWithWhiteout: function(time) {
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 清除怀旧滤镜
        document.body.style.filter = 'none';
        
        const overlay = document.createElement('div');
        overlay.id = 'white-overlay-end';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'white';
        overlay.style.zIndex = '750';
        overlay.style.opacity = '0';
        document.body.appendChild(overlay);
        
        let opacity = 0;
        const intervalTime = 16;
        const steps = time / intervalTime / 2;
        const opacityStep = 1 / steps;
        
        const fadeIn = () => {
            opacity += opacityStep;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(fadeInInterval);
                
                const fadeOut = () => {
                    opacity -= opacityStep;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeOutInterval);
                        overlay.remove();
                                        
                        setTimeout(() => {
                            this.nextLine();
                        }, 100);
                    }
                    overlay.style.opacity = opacity;
                };
                
                const fadeOutInterval = setInterval(fadeOut, intervalTime);
            }
            overlay.style.opacity = opacity;
        };
        
        const fadeInInterval = setInterval(fadeIn, intervalTime);
    },
    
    /**
     * 暗转怀旧滤镜结束
     * 先淡出到黑色，然后清除怀旧滤镜
     */
    fadeoutSepiaEnd: function() {
        // 淡出到黑色
        this.fadeOut(1000, 'black', () => {
            // 清除怀旧滤镜
            document.body.style.filter = 'none';
            
            // 继续下一行
            this.nextLine();
        });
    },
    
    /**
     * 回忆场景开始
     * 创建黑屏收缩、内容展开、应用怀旧滤镜和白色边框的效果
     * @param {Object} options - 包含time参数
     */
    flashbackStart: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 创建黑色背景层
        const blackBg = document.createElement('div');
        blackBg.id = 'flashback-black-bg';
        blackBg.style.position = 'absolute';
        blackBg.style.top = '0';
        blackBg.style.left = '0';
        blackBg.style.width = '100%';
        blackBg.style.height = '100%';
        blackBg.style.backgroundColor = 'black';
        blackBg.style.zIndex = '600';
        blackBg.style.opacity = '1';
        document.body.appendChild(blackBg);
        
        
        let opacity = 1;
        const intervalTime = 16;
        const steps = options.time / intervalTime / 2;
        const opacityStep = 1 / steps;
        
        const closeInterval = setInterval(() => {
            opacity -= opacityStep;
            if (opacity <= 0) {
                opacity = 0;
                clearInterval(closeInterval);
                
                blackBg.style.opacity = opacity;
                
                // 黑屏收缩完成后，创建回忆内容层
                const recallContent = document.createElement('div');
                recallContent.id = 'recall-content';
                recallContent.style.position = 'absolute';
                recallContent.style.top = '0';
                recallContent.style.left = '0';
                recallContent.style.width = '100%';
                recallContent.style.height = '100%';
                recallContent.style.zIndex = '601';
                recallContent.style.opacity = '0';
                document.body.appendChild(recallContent);
                
                // 执行回忆内容展开动画
                let contentOpacity = 0;
                const openInterval = setInterval(() => {
                    contentOpacity += opacityStep;
                    if (contentOpacity >= 1) {
                        contentOpacity = 1;
                        clearInterval(openInterval);
                        recallContent.style.opacity = contentOpacity;
                        
                        // 应用怀旧滤镜
                        document.body.style.filter = 'grayscale(100%) sepia(100%)';
                        
                        // 添加白色边框
                        const whiteFrame = document.createElement('div');
                        whiteFrame.id = 'white-frame';
                        whiteFrame.style.position = 'absolute';
                        whiteFrame.style.top = '0';
                        whiteFrame.style.left = '0';
                        whiteFrame.style.width = '100%';
                        whiteFrame.style.height = '100%';
                        whiteFrame.style.border = '15px solid rgba(255, 255, 255, 0.3)';
                        whiteFrame.style.boxSizing = 'border-box';
                        whiteFrame.style.zIndex = '602';
                        document.body.appendChild(whiteFrame);
                        
                        setTimeout(() => {
                            this.nextLine();
                        }, 100);
                    } else {
                        recallContent.style.opacity = contentOpacity;
                    }
                }, intervalTime);
            }
            blackBg.style.opacity = opacity;
        }, intervalTime);
    },
    
    /**
     * 回忆场景结束
     * 移除白色边框，执行黑屏展开效果，清除怀旧滤镜
     * @param {Object} options - 包含time参数
     */
    flashbackEnd: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 移除白色边框
        const whiteFrame = document.getElementById('white-frame');
        if (whiteFrame) {
            whiteFrame.remove();
        }
        
        // 创建黑色背景层用于过渡
        const blackBg = document.createElement('div');
        blackBg.id = 'flashback-end-black-bg';
        blackBg.style.position = 'absolute';
        blackBg.style.top = '0';
        blackBg.style.left = '0';
        blackBg.style.width = '100%';
        blackBg.style.height = '100%';
        blackBg.style.backgroundColor = 'black';
        blackBg.style.zIndex = '650';
        blackBg.style.opacity = '0';
        document.body.appendChild(blackBg);
        
        
        let opacity = 0;
        const intervalTime = 16;
        const steps = options.time / intervalTime / 2;
        const opacityStep = 1 / steps;
        
        const closeInterval = setInterval(() => {
            opacity += opacityStep;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(closeInterval);
                blackBg.style.opacity = opacity;
                
                // 黑屏完全展开后，清除怀旧滤镜
                document.body.style.filter = 'none';
                
                // 执行黑屏收缩动画
                let openOpacity = 1;
                const openInterval = setInterval(() => {
                    openOpacity -= opacityStep;
                    if (openOpacity <= 0) {
                        openOpacity = 0;
                        clearInterval(openInterval);
                        blackBg.remove();
                        
                        setTimeout(() => {
                            this.nextLine();
                        }, 100);
                    } else {
                        blackBg.style.opacity = openOpacity;
                    }
                }, intervalTime);
            } else {
                blackBg.style.opacity = opacity;
            }
        }, intervalTime);
    },
    
    /**
     * 负片反转效果开始
     * 对页面应用invert滤镜实现颜色反转
     * @param {Object} options - 配置选项
     */
    negaposiFlip: function(options) {
        // 如果尚未应用反转滤镜，则添加
        const currentFilter = document.body.style.filter;
        if (!currentFilter.includes('invert')) {
            document.body.style.filter = currentFilter + ' invert(100%)';
        }
        
        setTimeout(() => {
            this.nextLine();
        }, 100);
    },
    
    /**
     * 负片反转效果结束
     * 移除invert滤镜恢复正常显示
     * @param {Object} options - 配置选项
     */
    negaposiFlipEnd: function(options) {
        // 移除反转滤镜
        let currentFilter = document.body.style.filter;
        if (currentFilter.includes('invert(100%)')) {
            currentFilter = currentFilter.replace(' invert(100%)', '').replace('invert(100%)', '');
            document.body.style.filter = currentFilter;
        }
        
        setTimeout(() => {
            this.nextLine();
        }, 100);
    },
    
    /**
     * 初始化好感度系统
     * 确保affinity对象存在
     */
    initAffinitySystem: function() {
        if (!this.state.affinity) {
            this.state.affinity = {};
        }
    },
    
    /**
     * 好感度变化
     * 修改指定角色的好感度值，并显示相应的演出效果
     * @param {Object} options - 包含flag（角色标识）、add（变化值）等参数
     */
    affinityChange: function(options) {
        this.initAffinitySystem();
        
        // 获取当前好感度并累加
        const currentValue = this.state.affinity[options.flag] || 0;
        this.state.affinity[options.flag] = currentValue + options.add;
        
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
    },
    
    /**
     * 好感度上升演出效果
     * 显示金色的“+X”文字并向上飘动消失
     * @param {Object} options - 包含flag、add、time等参数
     */
    affinityUpShow: function(options) {
        this.playAffinitySound('up');
        
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
        
        // 执行上升和淡出动画
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
        
        setTimeout(() => {
            this.nextLine();
        }, options.time || 1000);
    },
    
    /**
     * 好感度下降演出效果
     * 显示红色的“X”文字并向下飘动消失
     * @param {Object} options - 包含flag、add、time等参数
     */
    affinityDownShow: function(options) {
        this.playAffinitySound('down');
        
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
        
        // 执行下降和淡出动画
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
        
        setTimeout(() => {
            this.nextLine();
        }, options.time || 1000);
    },
    
    /**
     * 播放好感度变化音效
     * @param {string} type - 音效类型，'up'或'down'
     */
    playAffinitySound: function(type) {
        // TODO: 实现好感度音效播放
        if (type === 'up') {
            console.log('播放好感度上升音效');
        } else if (type === 'down') {
            console.log('播放好感度下降音效');
        }
    },
    
    /**
     * 评估条件表达式
     * 支持f.variableName语法访问好感度值
     * @param {string} conditionStr - 条件表达式字符串，如 "f.love > 5"
     * @returns {boolean} - 条件评估结果
     */
    evaluateCondition: function(conditionStr) {
        try {
            let expr = conditionStr.trim();
            
            // 将f.variableName替换为实际的好感度值
            expr = expr.replace(/f\.([a-zA-Z0-9_]+)/g, (match, varName) => {
                return `(this.state.affinity['${varName}'] || 0)`;
            });
            
            // 执行表达式并返回布尔结果
            const result = new Function('game', `return ${expr}`).call(null, this);
            return !!result;
        } catch (e) {
            console.error('条件表达式评估错误:', e, '表达式:', conditionStr);
            return false;
        }
    },
    
    /**
     * 处理条件判断开始
     * 评估条件并将结果压入栈中
     * @param {Object} action - 包含condition属性的动作对象
     */
    handleConditional: function(action) {
        const result = this.evaluateCondition(action.condition);
        this.state.conditionalStack.push(result);
        this.state.currentConditionResult = result;
        
        // 如果条件为假，跳过条件块
        if (!result) {
            this.skipConditionalBlock();
        } else {
            this.nextLine();
        }
    },
    
    /**
     * 处理条件判断else分支
     * 根据之前的条件结果决定是否跳过else块
     */
    handleConditionalElse: function() {
        // 获取上一个条件的结果
        const conditionResult = this.state.conditionalStack[this.state.conditionalStack.length - 1];
        
        if (conditionResult) {
            // 如果之前条件为真，跳过else块
            this.skipConditionalBlock();
        } else {
            // 如果之前条件为假，执行else块
            this.nextLine();
        }
    },
    
    /**
     * 处理条件判断结束
     * 弹出条件栈并继续下一行
     */
    handleConditionalEnd: function() {
        this.state.conditionalStack.pop();
        this.nextLine();
    },
    
    /**
     * 跳过条件块
     * 推进到下一行（实际跳过逻辑由shouldSkipLine处理）
     */
    skipConditionalBlock: function() {
        this.nextLine();
    },
    
    /**
     * 添加选项到待显示列表
     * 只在条件为真时添加
     * @param {Object} action - 包含text和target的选项对象
     */
    addSelection: function(action) {
        if (this.state.currentConditionResult !== false) {
            // 将选项添加到待显示列表
            this.state.pendingSelections.push({
                text: action.text,
                target: action.target
            });
        }
        
        this.nextLine();
    },
    
    /**
     * 显示所有待选选项
     * 将pendingSelections转换为选项菜单
     */
    showSelections: function() {
        if (this.state.pendingSelections.length > 0) {
            // 显示选项菜单
            this.showChoices(this.state.pendingSelections.map(sel => ({
                text: sel.text,
                target: sel.target
            })));
            
            // 清空待选列表
            this.state.pendingSelections = [];
        }
    },
    
    /**
     * 检查当前行是否应该被跳过
     * 基于条件判断栈的状态决定
     * @param {number} index - 行索引
     * @returns {boolean} - 是否应该跳过
     */
    shouldSkipLine: function(index) {
        const line = this.sceneData.story[index];
        
        // 如果有活跃的条件判断
        if (this.state.conditionalStack.length > 0) {
            // 检查是否为条件命令
            if (line.command) {
                const parsedCommand = this.parseCommand(line.command);
                
                if (parsedCommand.type === 'conditional') {
                    // 评估新条件
                    const result = this.evaluateCondition(parsedCommand.condition);
                    if (!result) {
                        // 条件为假，压入false并跳过
                        this.state.conditionalStack.push(false);
                        return true;
                    } else {
                        // 条件为真，压入true并继续
                        this.state.conditionalStack.push(true);
                        return false;
                    }
                } else if (parsedCommand.type === 'conditionalElse') {
                    // 检查上一个条件结果
                    const prevResult = this.state.conditionalStack[this.state.conditionalStack.length - 1];
                    // 如果上一个条件为真，跳过else块
                    return prevResult === true;
                } else if (parsedCommand.type === 'conditionalEnd') {
                    // 条件块结束，弹出栈
                    this.state.conditionalStack.pop();
                    return false; 
                }
            }
            
            // 检查条件栈中是否有false，如果有则跳过当前行
            for (let i = 0; i < this.state.conditionalStack.length; i++) {
                if (!this.state.conditionalStack[i]) {
                    // 外层条件为假，跳过此行
                    return true;
                }
            }
        }
        
        return false;
    },
    
    /**
     * 返回主菜单
     * 保存进度、清除POV状态，然后跳转到index.html
     */
    returnToMenu: function() {
        this.markSceneCompleted();
        
        this.clearPovState();
        
        // 延迟跳转以确保音频停止
        setTimeout(() => {
            this.stopAllAudioWithBGM();
            window.location.href = '../index.html';
        }, 1000); 
    },
    
    /**
     * 标记当前场景为已完成
     * 将当前页面文件名添加到completedScenes并保存
     */
    markSceneCompleted: function() {
        // 获取当前页面文件名
        const currentPage = window.location.pathname.split('/').pop();
        
        // 如果未记录，则添加并保存
        if (!this.state.completedScenes.includes(currentPage)) {
            this.state.completedScenes.push(currentPage);
            this.saveProgress();
        }
    },
    
    /**
     * 保存游戏进度到localStorage
     * 包括已完成场景列表、好感度等数据
     */
    saveProgress: function() {
        const progressData = {
            completedScenes: this.state.completedScenes,
            timestamp: Date.now(),
            gameState: {
                affinity: this.state.affinity
            }
        };
        
        localStorage.setItem('gameProgress', JSON.stringify(progressData));
        console.log('进度已保存:', progressData);
    },
    
    /**
     * 从localStorage加载游戏进度
     * @returns {Object|null} - 加载的进度数据，失败返回null
     */
    loadProgress: function() {
        const progressData = localStorage.getItem('gameProgress');
        if (progressData) {
            try {
                const data = JSON.parse(progressData);
                this.state.completedScenes = data.completedScenes || [];
                if (data.gameState && data.gameState.affinity) {
                    this.state.affinity = data.gameState.affinity;
                }
                console.log('进度已加载:', data);
                return data;
            } catch (e) {
                console.error('加载进度失败:', e);
                return null;
            }
        }
        return null;
    },
    
    /**
     * 检查指定场景是否已完成
     * @param {string} sceneFileName - 场景文件名
     * @returns {boolean} - 是否已完成
     */
    isSceneCompleted: function(sceneFileName) {
        return this.state.completedScenes.includes(sceneFileName);
    },
    
    /**
     * 获取已完成场景列表的副本
     * @returns {Array} - 已完成场景文件名数组
     */
    getCompletedScenes: function() {
        return [...this.state.completedScenes]; 
    },
    
    /**
     * 重置游戏进度
     * 清除所有存档数据，包括已完成场景和好感度
     */
    resetProgress: function() {
        this.state.completedScenes = [];
        this.state.affinity = {};
        localStorage.removeItem('gameProgress');
        console.log('进度已重置');
    },
    
    /**
     * 保存当前场景标记
     * 记录玩家已进入过的场景，用于进度追踪
     */
    saveCurrentSceneMarker: function() {
        // 获取当前页面文件名作为场景ID
        const currentPage = window.location.pathname.split('/').pop();
        const sceneId = currentPage.replace('.html', '');
        
        // 加载现有进度或使用默认数据
        const progressData = this.loadProgress() || this.getDefaultProgressData();
        
        // 确保sceneMarkers对象存在
        progressData.sceneMarkers = progressData.sceneMarkers || {};
        
        // 如果该场景尚未标记，则添加标记
        if (!progressData.sceneMarkers.hasOwnProperty(sceneId)) {
            progressData.sceneMarkers[sceneId] = 1;
            
            // 更新时间戳
            progressData.timestamp = Date.now();
            
            // 保存到localStorage
            localStorage.setItem('gameProgress', JSON.stringify(progressData));
            console.log(`场景标识符已保存: ${sceneId} = 1`);
        }
    },
    
    /**
     * 获取默认进度数据
     * @returns {Object} - 包含completedScenes、timestamp、gameState、sceneMarkers的默认对象
     */
    getDefaultProgressData: function() {
        return {
            completedScenes: [],
            timestamp: Date.now(),
            gameState: {
                affinity: this.state.affinity
            },
            sceneMarkers: {}
        };
    },
    
    /**
     * 切换右键菜单显示/隐藏
     */
    toggleContextMenu: function() {
        if (!this.elements.contextMenu || !this.elements.contextMenuBackdrop) {
            console.warn('上下文菜单元素未找到');
            return;
        }
        
        if (this.elements.contextMenu.classList.contains('show')) {
            // 隐藏菜单
            this.elements.contextMenu.classList.remove('show');
            this.elements.contextMenuBackdrop.style.display = 'none';
        } else {
            // 显示菜单
            this.elements.contextMenu.classList.add('show');
            this.elements.contextMenuBackdrop.style.display = 'block';
        }
    },
    
    /**
     * 显示POV视角指示器
     * 在屏幕上显示当前叙事视角名称
     * @param {string} povName - 视角名称
     */
    showPovIndicator: function(povName) {
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
    },
    
    /**
     * 隐藏POV视角指示器
     * 移除指示器并重置状态
     */
    hidePovIndicator: function() {
        if (this.state.povIndicator && this.state.povIndicator.parentNode) {
            this.state.povIndicator.parentNode.removeChild(this.state.povIndicator);
        }
        
        this.state.povActive = false;
        this.state.povIndicator = null;
        
        console.log('POV视角已隐藏');
    },
    
    /**
     * 清除POV状态
     * 隐藏POV指示器并重置相关状态
     */
    clearPovState: function() {
        this.hidePovIndicator();
    },

    /**
     * 解析并渲染立绘指令
     * @param {string} charString - 立绘指令字符串，如 "[左 lh01],[右 前 lh02]" 或 "[消失 lh01]"
     * 支持空格分隔的修饰词，顺序无关
     */
    renderChars: function(charString) {
        if (!charString || typeof charString !== 'string') return;

        // 匹配所有 [内容] 格式的指令
        const instructions = charString.match(/\[([^\]]+)\]/g);
        if (!instructions) return;

        instructions.forEach(instr => {
            // 去除方括号
            const content = instr.slice(1, -1).trim();
            
            // 检查是否为连续动作指令（包含逗号）
            if (content.includes(',')) {
                this.executeCharSequence(content);
                return;
            }

            const parts = content.split(/\s+/);
            
            // 处理消失指令（支持中英文及角色名称）
            if ((parts[0] === '消失' || parts[0] === 'hide' || parts[0] === 'remove') && parts.length >= 2) {
                const target = parts[1];
                
                // 检查是否为清除所有立绘的指令
                if (target === 'all' || target === '全部') {
                    this.removeAllChars();
                } else {
                    // 检查 target 是否为角色名称标识符
                    let actualCharId = target;
                    if (this.state.charNameMap[target]) {
                        actualCharId = this.state.charNameMap[target].charId;
                        delete this.state.charNameMap[target];
                    }
                    this.removeChar(actualCharId);
                }
                return;
            }
            
            // 处理渐出指令（支持中英文及角色名称）
            if ((parts[0] === '渐出' || parts[0] === 'fadeOut') && parts.length >= 2) {
                const target = parts[1];
                
                // 检查是否为清除所有立绘的指令
                if (target === 'all' || target === '全部') {
                    this.fadeOutAllChars();
                } else {
                    // 检查 target 是否为角色名称标识符
                    let actualCharId = target;
                    if (this.state.charNameMap[target]) {
                        actualCharId = this.state.charNameMap[target].charId;
                        delete this.state.charNameMap[target];
                    }
                    this.fadeOutChar(actualCharId);
                }
                return;
            }

            // 处理显示/更新指令
            if (parts.length >= 1) {
                let roleName = null;
                let modifiersParts = [];
                let charId = null;

                // 检查第一个部分是否为角色名称标识符（非关键词且非资源ID）
                const firstPart = parts[0];
                if (!this.isModifierKeyword(firstPart) && !firstPart.match(/^lh\d+$/)) {
                    roleName = firstPart;
                    modifiersParts = parts.slice(1);
                } else {
                    modifiersParts = parts;
                }

                if (modifiersParts.length === 0) return; // 如果没有剩余部分，则无法确定资源ID

                // 最后一个部分是图片ID，前面的是修饰词
                charId = modifiersParts[modifiersParts.length - 1];
                
                // 如果角色ID也是关键词，则视为无效指令或纯关键词指令（如 [消失]）
                if (this.isModifierKeyword(charId)) return;

                const modifiers = modifiersParts.slice(0, -1).join(' ');
                this.updateChar(charId, modifiers, false, roleName);
            }
        });
    },

    /**
     * 中断所有正在进行的连续动作指令
     * 将立绘直接设置为指令序列中最后一个片段所定义的状态
     */
    interruptCharSequences: function() {
        if (!this.state.charActionQueues) return;

        Object.keys(this.state.charActionQueues).forEach(charId => {
            const queue = this.state.charActionQueues[charId];
            if (queue && queue.segments) {
                // 获取最后一段的内容
                const lastSegment = queue.segments[queue.segments.length - 1];
                if (lastSegment) {
                    // 瞬间应用最后一段的状态
                    this.updateChar(charId, lastSegment.replace(/瞬|instant|moment/g, '').trim(), true);
                }
            }
            // 清除定时器
            if (queue.timeoutId) {
                clearTimeout(queue.timeoutId);
            }
        });

        // 清空队列
        this.state.charActionQueues = {};
    },

    /**
     * 执行连续动作序列（统一化状态帧模式）
     * @param {string} sequenceContent - 逗号分隔的完整指令内容
     */
    executeCharSequence: function(sequenceContent) {
        const segments = sequenceContent.split(',').map(s => s.trim());
        if (segments.length === 0) return;

        // 提取角色ID和角色名称标识符
        let roleName = null;
        let lastSegmentParts = segments[segments.length - 1].split(/\s+/);
        
        // 检查第一个片段是否包含角色名称标识符
        const firstSegmentParts = segments[0].split(/\s+/);
        const firstPart = firstSegmentParts[0];
        if (!this.isModifierKeyword(firstPart) && !firstPart.match(/^lh\d+$/)) {
            roleName = firstPart;
            // 从所有片段中移除角色名称标识符（如果它出现在开头）
            for (let i = 0; i < segments.length; i++) {
                if (segments[i].startsWith(roleName + ' ')) {
                    segments[i] = segments[i].substring(roleName.length + 1).trim();
                }
            }
            // 重新获取最后一段的部分
            lastSegmentParts = segments[segments.length - 1].split(/\s+/);
        }

        const charId = lastSegmentParts[lastSegmentParts.length - 1];
        
        if (!charId || this.isModifierKeyword(charId)) {
            console.warn(`连续动作指令中未找到有效的角色ID: ${sequenceContent}`);
            return;
        }

        // 初始化队列状态
        if (!this.state.charActionQueues) this.state.charActionQueues = {};
        if (this.state.charActionQueues[charId]) clearTimeout(this.state.charActionQueues[charId].timeoutId);

        this.state.charActionQueues[charId] = {
            segments: segments,
            timeoutId: null,
            nextIsInstant: false
        };

        let currentIndex = 0;
        const totalSegments = segments.length;

        const processNext = () => {
            if (currentIndex >= totalSegments) {
                delete this.state.charActionQueues[charId];
                return;
            }

            const currentSegment = segments[currentIndex];
            
            // 1. 检查瞬移标记 (独立片段)
            if (currentSegment === '瞬' || currentSegment === 'instant' || currentSegment === 'moment') {
                this.state.charActionQueues[charId].nextIsInstant = true;
                currentIndex++;
                processNext();
                return;
            }

            // 2. 处理瞬移标记与冲突检测
            const segmentParts = currentSegment.split(/\s+/);
            const hasInstantInSegment = segmentParts.some(p => ['瞬', 'instant', 'moment'].includes(p));
            
            if (hasInstantInSegment) {
                // 如果片段内混用了瞬移标记与其他修饰词（如 "右 瞬"），则视为有效状态帧
                // 我们需要过滤掉 "瞬" 关键字，只保留样式修饰词
                const validModifiers = segmentParts.filter(p => !['瞬', 'instant', 'moment'].includes(p)).join(' ');
                
                if (validModifiers.trim() === '') {
                    // 如果过滤后为空（即片段仅为 "瞬"），则仅作为控制标记，不应用样式
                    this.state.charActionQueues[charId].nextIsInstant = true;
                    currentIndex++;
                    processNext();
                    return;
                } else {
                    // 存在有效修饰词，应用该状态并强制瞬移
                    const queueState = this.state.charActionQueues[charId];
                    this.updateChar(charId, validModifiers, true, roleName); // forceInstant = true
                    queueState.nextIsInstant = false; // 重置，避免影响下一步
                }
            } else {
                // 普通片段，正常应用
                const queueState = this.state.charActionQueues[charId];
                const forceInstant = queueState.nextIsInstant;
                this.updateChar(charId, currentSegment, forceInstant, roleName);
                queueState.nextIsInstant = false;
            }

            currentIndex++;
            
            if (currentIndex < totalSegments) {
                // 关键修正：无论是否瞬移，都保持标准延时以展示当前状态
                const delay = 500; 
                const timeoutId = setTimeout(processNext, delay);
                this.state.charActionQueues[charId].timeoutId = timeoutId;
            } else {
                delete this.state.charActionQueues[charId];
            }
        };

        processNext();
    },

    /**
     * 判断是否为修饰词关键词
     * @param {string} word - 待检查的单词
     * @returns {boolean} - 如果是修饰词关键词返回true，否则返回false
     */
    isModifierKeyword: function(word) {
        // 水平位置关键词
        const positionKeywords = ['左左', 'leftl', '左', 'left', '左右', 'leftr', '中', 'middle', 'center', '右左', 'rightl', '右', 'right', '右右', 'rightr'];
        // 垂直位置关键词
        const verticalKeywords = ['下', 'down', '中下', 'downm', '下下', 'downd', 'bottom', '上', 'up', '中上', 'upm', '上上', 'upu', 'top'];
        // 层级关键词
        const layerKeywords = ['前', 'front', '后', 'back'];
        // 动画关键词
        const animationKeywords = ['瞬', 'moment', 'instant'];
        // 消失指令关键词
        const removeKeywords = ['消失', 'hide', 'remove'];
        // 渐入渐出关键词
        const fadeKeywords = ['渐入', 'fadeIn', '渐出', 'fadeOut'];
        
        // 检查是否匹配任何关键词
        if (positionKeywords.includes(word)) return true;
        if (verticalKeywords.includes(word)) return true;
        if (layerKeywords.includes(word)) return true;
        if (animationKeywords.includes(word)) return true;
        if (removeKeywords.includes(word)) return true;
        if (fadeKeywords.includes(word)) return true;
        
        // 检查是否以 x: 或 y: 开头
        if (word.startsWith('x:') || word.startsWith('y:')) return true;
        
        // 检查是否为百分比缩放（以%结尾且不是x:或y:格式）
        if (word.endsWith('%') && !word.startsWith('x:') && !word.startsWith('y:')) {
            const percentValue = parseFloat(word.slice(0, -1));
            if (!isNaN(percentValue)) return true;
        }
        
        return false;
    },

    /**
     * 更新或创建单个立绘
     * @param {string} charId - 立绘ID (如 lh01)
     * @param {string} modifiers - 修饰词组合 (如 "左 前" 或 "中 10% 后" 或 "瞬 左" 或 "left front" 等中英文混合)
     * @param {boolean} forceInstant - 是否强制瞬间切换（用于连续动作指令）
     * @param {string} roleName - 角色名称标识符（可选，用于实现自动替换与属性继承）
     */
    updateChar: function(charId, modifiers, forceInstant = false, roleName = null) {
        // 获取路径
        let path = null;
        if (typeof CHAR_CONFIG_SUB !== 'undefined' && CHAR_CONFIG_SUB[charId]) {
            path = CHAR_CONFIG_SUB[charId];
        } else if (typeof CHAR_CONFIG !== 'undefined' && CHAR_CONFIG[charId]) {
            path = CHAR_CONFIG[charId];
        }

        if (!path) {
            console.warn(`立绘 ${charId} 未在配置文件中找到`);
            return;
        }

        // 查找或创建 DOM 元素
        let charEl = null;
        let isNewChar = false;

        if (roleName && this.state.charNameMap[roleName]) {
            // 角色名称标识符存在，复用旧立绘的 DOM 节点
            const oldInfo = this.state.charNameMap[roleName];
            charEl = document.getElementById(`char-${oldInfo.charId}`);
            
            // 如果旧 ID 与新 ID 不同，需要更新映射和 ID
            if (oldInfo.charId !== charId) {
                // 移除旧的 activeChars 记录
                delete this.state.activeChars[oldInfo.charId];
                // 更新 DOM ID
                if (charEl) charEl.id = `char-${charId}`;
                // 更新映射表
                this.state.charNameMap[roleName] = { charId, domElement: charEl };
            }
        } else {
            // 查找现有 DOM 或创建新元素
            charEl = document.getElementById(`char-${charId}`);
            if (!charEl) {
                charEl = document.createElement('img');
                charEl.id = `char-${charId}`;
                charEl.className = 'character-img';
                this.elements.characterContainer.appendChild(charEl);
                isNewChar = true;
            }
        }

        // 注册到 charNameMap（如果提供了 roleName）
        if (roleName) {
            this.state.charNameMap[roleName] = { charId, domElement: charEl };
        }

        // 更新图片源（如果需要）
        if (charEl.src !== path) {
            charEl.src = path;
        }

        // 解析修饰词并应用样式
        const props = this.parseCharModifiers(modifiers);
                        
        // 属性继承逻辑：如果复用了 DOM 节点且新指令未指定某些属性，则继承旧状态
        if (!isNewChar && charEl) {
            const currentLeft = charEl.style.left;
            const currentBottom = charEl.style.bottom;
            const currentZIndex = charEl.style.zIndex;
            const currentHeight = charEl.style.height;

            // 只有当 modifiers 中没有显式指定位置/层级/缩放时，才继承
            // 注意：parseCharModifiers 返回的是计算后的值，我们需要判断用户是否输入了关键词
            const hasExplicitLeft = modifiers.match(/(左|右|中|left|right|middle|x:)/i);
            const hasExplicitBottom = modifiers.match(/(上|下|up|down|y:)/i);
            const hasExplicitLayer = modifiers.match(/(前|后|front|back)/i);
            const hasExplicitScale = modifiers.match(/\d+%$/);

            if (!hasExplicitLeft && currentLeft) props.left = currentLeft;
            if (!hasExplicitBottom && currentBottom) props.bottom = currentBottom;
            if (!hasExplicitLayer && currentZIndex) props.zIndex = parseInt(currentZIndex);
            if (!hasExplicitScale && currentHeight) {
                const oldScale = parseFloat(currentHeight) / 100;
                if (!isNaN(oldScale)) props.scale = oldScale;
            }
        }
                        
        // 检查是否包含"瞬"指令或外部强制瞬间
        const isInstant = props.instant || forceInstant;
                        
        if (isInstant) {
            // 禁用过渡动画，实现瞬间切换
            charEl.style.transition = 'none';
        }
                        
        // 应用样式
        charEl.style.left = props.left;
        charEl.style.bottom = props.bottom;
        charEl.style.zIndex = props.zIndex;
        charEl.style.visibility = 'visible';
                
        // 处理渐入/渐出指令
        if (props.fadeType === 'fadeOut') {
            // 渐出指令：执行渐出动画
            this.fadeOutChar(charId, charEl);
            return; // 直接返回，不继续执行后续逻辑
        } else if (props.fadeType === 'fadeIn') {
            // 渐入指令：从透明渐变到不透明
            charEl.style.opacity = '0';
            // 强制重绘以确保透明度变化生效
            void charEl.offsetHeight;
            // 设置渐变效果
            charEl.style.transition = 'all 0.5s ease, opacity 0.8s ease-in-out';
            charEl.style.opacity = '1';
        } else {
            // 检查是否应该使用默认渐变出现效果
            const shouldFadeIn = !isInstant && !this.state.isBackgroundTransitioning;
                    
            if (shouldFadeIn) {
                // 先设置为透明，然后渐变到不透明
                charEl.style.opacity = '0';
                // 强制重绘以确保透明度变化生效
                void charEl.offsetHeight;
                // 设置渐变效果
                charEl.style.transition = 'all 0.5s ease, opacity 0.8s ease-in-out';
                charEl.style.opacity = '1';
            } else {
                charEl.style.opacity = '1';
            }
        }
                
        // 应用缩放：通过调整实际高度来实现，确保放大后的图片完整显示
        // 基准高度为容器的 100%，根据 scale 比例调整
        charEl.style.height = `${props.scale * 100}%`;
                
        // 应用水平对齐变换
        // 无论是否使用精确坐标，都需要translateX(-50%)来让立绘的中心点对齐
        // 文字指令模式：left为百分比值（如50%），需要translateX(-50%)居中
        // 精确坐标模式：left为calc(50% + x%)，也需要translateX(-50%)让立绘中心对齐到计算后的位置
        charEl.style.transform = 'translateX(-50%)';
                
        if (isInstant) {
            // 强制浏览器重绘，确保样式立即应用
            void charEl.offsetHeight;
                    
            // 短暂延时后恢复过渡动画，确保后续移动仍有平滑效果
            setTimeout(() => {
                charEl.style.transition = 'all 0.5s ease';
            }, 50);
        }
        
        // 处理动作指令
        if (props.actionType) {
            this.applyCharAction(charId, charEl, props.actionType, props);
        }
        
        // 更新状态记录
        this.state.activeChars[charId] = { path, ...props };
    },

    /**
     * 移除指定立绘
     * @param {string} charId - 立绘ID
     */
    removeChar: function(charId) {
        const charEl = document.getElementById(`char-${charId}`);
        if (charEl) {
            charEl.remove();
        }
        // 清除持续发抖状态
        if (this.state.shakingChars && this.state.shakingChars[charId]) {
            clearInterval(this.state.shakingChars[charId]);
            delete this.state.shakingChars[charId];
        }
        // 清除连续动作队列
        if (this.state.charActionQueues && this.state.charActionQueues[charId]) {
            clearTimeout(this.state.charActionQueues[charId].timeoutId);
            delete this.state.charActionQueues[charId];
        }
        delete this.state.activeChars[charId];
    },

    /**
     * 渐出指定立绘
     * @param {string} charId - 立绘ID
     * @param {HTMLElement} charEl - 可选，立绘DOM元素，如果不提供则自动获取
     */
    fadeOutChar: function(charId, charEl = null) {
        // 如果未提供 DOM 元素，则自动获取
        if (!charEl) {
            charEl = document.getElementById(`char-${charId}`);
        }
        
        if (!charEl) {
            console.warn(`立绘 ${charId} 不存在，无法执行渐出`);
            return;
        }
        
        // 设置渐出动画
        charEl.style.transition = 'opacity 0.8s ease-in-out';
        charEl.style.opacity = '0';
        
        // 动画结束后移除元素
        setTimeout(() => {
            // 再次检查元素是否还存在（可能已被其他操作移除）
            const existingEl = document.getElementById(`char-${charId}`);
            if (existingEl) {
                existingEl.remove();
            }
            // 清除持续发抖状态
            if (this.state.shakingChars && this.state.shakingChars[charId]) {
                clearInterval(this.state.shakingChars[charId]);
                delete this.state.shakingChars[charId];
            }
            // 清除连续动作队列
            if (this.state.charActionQueues && this.state.charActionQueues[charId]) {
                clearTimeout(this.state.charActionQueues[charId].timeoutId);
                delete this.state.charActionQueues[charId];
            }
            delete this.state.activeChars[charId];
        }, 800); // 与 transition 时长一致
    },

    /**
     * 渐出所有立绘
     * 使屏幕上所有活跃立绘同时执行渐出动画并清除
     */
    fadeOutAllChars: function() {
        // 获取所有活跃立绘的 ID
        const charIds = Object.keys(this.state.activeChars);
        
        if (charIds.length === 0) {
            console.log('没有活跃立绘，无需渐出');
            return;
        }
        
        console.log(`开始渐出 ${charIds.length} 个立绘`);
        
        // 对所有立绘执行渐出动画
        charIds.forEach(charId => {
            this.fadeOutChar(charId);
        });
    },

    /**
     * 移除所有立绘
     * 清除屏幕上所有活跃立绘，包括动画状态和连续动作队列
     */
    removeAllChars: function() {
        // 获取所有活跃立绘的 ID
        const charIds = Object.keys(this.state.activeChars);
        
        // 逐个移除立绘（会自动清理动画状态和动作队列）
        charIds.forEach(charId => {
            this.removeChar(charId);
        });
        
        // 确保状态已清空（理论上 removeChar 已经处理，但这里做双重保险）
        this.state.activeChars = {};
        this.state.shakingChars = {};
        this.state.charActionQueues = {};
    },

    /**
     * 应用立绘动作指令
     * @param {string} charId - 立绘ID
     * @param {HTMLElement} charEl - 立绘DOM元素
     * @param {string} actionType - 动作类型
     * @param {Object} props - 解析后的修饰词属性
     */
    applyCharAction: function(charId, charEl, actionType, props) {
        switch(actionType) {
            case 'back':
                this.applyRetreatAction(charEl, props);
                break;
            case 'forward':
                this.applyForwardAction(charEl, props);
                break;
            case 'scare':
                this.applyJumpscareAction(charEl, props);
                break;
            case 'shake':
                this.applyShakeAction(charEl, props, false);
                break;
            case 'cshake':
                this.applyShakeAction(charEl, props, true);
                break;
            case 'sshake':
                this.stopShakeAction(charId);
                break;
        }
    },

    /**
     * 应用“后退”动作
     * Y轴向上偏移 +10%，缩放比例减小 -10%，层级强制变为“后”
     */
    applyRetreatAction: function(charEl, props) {
        // 计算新的 bottom 值（向上偏移 10%）
        const currentBottom = parseFloat(props.bottom) || 0;
        const newBottom = currentBottom + 10;
        charEl.style.bottom = `${newBottom}%`;
        
        // 计算新的缩放比例（减小 10%）
        const newScale = Math.max(0.1, props.scale - 0.1);
        charEl.style.height = `${newScale * 100}%`;
        
        // 如果当前层级不是“后”，则强制设置为“后”
        const currentZIndex = parseInt(charEl.style.zIndex) || 10;
        if (currentZIndex !== 9) {
            charEl.style.zIndex = 9;
        }
    },

    /**
     * 应用“前进”动作
     * Y轴向下偏移 -10%，缩放比例增大 +10%，层级强制变为“前”
     */
    applyForwardAction: function(charEl, props) {
        // 计算新的 bottom 值（向下偏移 10%）
        const currentBottom = parseFloat(props.bottom) || 0;
        const newBottom = currentBottom - 10;
        charEl.style.bottom = `${newBottom}%`;
        
        // 计算新的缩放比例（增大 10%，上限为 2.0）
        const newScale = Math.min(2.0, props.scale + 0.1);
        charEl.style.height = `${newScale * 100}%`;
        
        // 如果当前层级不是“前”，则强制设置为“前”
        const currentZIndex = parseInt(charEl.style.zIndex) || 10;
        if (currentZIndex !== 11) {
            charEl.style.zIndex = 11;
        }
    },

    /**
     * 应用“吓一跳”动作
     * 先放大7%，再缩小7%，重复2次
     */
    applyJumpscareAction: function(charEl, props) {
        const baseScale = props.scale;
        const scaleUp = baseScale * 1.07;  // 放大7%
        const scaleDown = baseScale * 0.93; // 缩小7%
        
        let step = 0;
        const maxSteps = 10; // 5个阶段 x 2次循环 = 10步
        
        const animate = () => {
            if (step >= maxSteps) {
                // 动画结束，恢复到基准缩放
                charEl.style.height = `${baseScale * 100}%`;
                return;
            }
            
            const phase = step % 5;
            if (phase === 0 || phase === 4) {
                // 基准状态
                charEl.style.height = `${baseScale * 100}%`;
            } else if (phase === 1 || phase === 3) {
                // 放大7%
                charEl.style.height = `${scaleUp * 100}%`;
            } else if (phase === 2) {
                // 缩小7%
                charEl.style.height = `${scaleDown * 100}%`;
            }
            
            step++;
            setTimeout(animate, 100); // 每100ms切换一次
        };
        
        animate();
    },

    /**
     * 应用“发抖”或“持续发抖”动作
     * X轴左右偏移 -2% / +2%，重复3次（非持续）或持续进行
     */
    applyShakeAction: function(charEl, props, isContinuous) {
        const currentLeft = charEl.style.left;
        const offsetPercent = 2; // 偏移2%
        
        // 如果是持续发抖，先停止之前的定时器
        if (isContinuous && this.state.shakingChars) {
            const charId = charEl.id.replace('char-', '');
            if (this.state.shakingChars[charId]) {
                clearInterval(this.state.shakingChars[charId]);
            }
        }
        
        let step = 0;
        const maxSteps = isContinuous ? Infinity : 6; // 3次循环 x 2步 = 6步
        
        const animate = () => {
            if (!isContinuous && step >= maxSteps) {
                // 非持续模式，动画结束后恢复原位
                charEl.style.left = currentLeft;
                return;
            }
            
            const phase = step % 2;
            if (phase === 0) {
                // 向左偏移2%
                charEl.style.left = `calc(${currentLeft} - ${offsetPercent}%)`;
            } else {
                // 向右偏移2%
                charEl.style.left = `calc(${currentLeft} + ${offsetPercent}%)`;
            }
            
            step++;
            
            if (isContinuous) {
                // 持续模式，使用定时器
                const charId = charEl.id.replace('char-', '');
                if (!this.state.shakingChars) {
                    this.state.shakingChars = {};
                }
                this.state.shakingChars[charId] = setTimeout(animate, 80); // 每80ms切换一次
            } else {
                // 非持续模式
                setTimeout(animate, 80);
            }
        };
        
        animate();
    },

    /**
     * 停止“持续发抖”动作
     */
    stopShakeAction: function(charId) {
        if (this.state.shakingChars && this.state.shakingChars[charId]) {
            clearTimeout(this.state.shakingChars[charId]);
            delete this.state.shakingChars[charId];
            
            // 恢复立绘到正常位置
            const charEl = document.getElementById(`char-${charId}`);
            if (charEl && this.state.activeChars[charId]) {
                const props = this.state.activeChars[charId];
                charEl.style.left = props.left;
            }
        }
    },

    /**
     * 解析立绘修饰词（支持中英文混合 + 精确坐标）
     * @param {string} mods - 修饰词字符串 (如 "左 下" 或 "中 10% 前" 或 "瞬 左" 或 "left down" 或 "x:10% y:-5%" 等)，空格分隔
     * @returns {Object} - 包含 left, zIndex, clipPath, scale, bottom, instant, preciseX, preciseY 的对象
     * 
     * 支持的关键词映射：
     * 水平位置：左左/leftl, 左/left, 左右/leftr, 中/middle/center, 右左/rightl, 右/right, 右右/rightr
     * 垂直位置：下/down, 中下/downm, 下下/downd/bottom
     * 层级：前/front, 后/back
     * 动画：瞬/moment/instant
     * 消失：消失/hide/remove (在 renderChars 中处理)
     * 精确坐标：x:百分比 (以中心为基准), y:百分比 (以底部为基准)
     * 
     * 优先级规则：
     * - 如果指定了 x: 参数，则忽略所有水平位置文字关键词
     * - 如果指定了 y: 参数，则忽略所有垂直位置文字关键词
     */
    parseCharModifiers: function(mods) {
        let left = '50%'; // 默认中
        let zIndexOffset = 0;
        let clipPath = 'none'; // 默认不裁剪
        let scale = 1; // 默认缩放比例 100%
        let bottom = '0'; // 默认底部位置
        let instant = false; // 默认不禁用动画
        let preciseX = null; // 精确X坐标（以屏幕中心为0%）
        let preciseY = null; // 精确Y坐标（以屏幕底部为0%）
        let actionType = null; // 动作类型指令
    
        // 将修饰词按空格分割为数组，便于精确匹配
        const modArray = mods.split(' ').filter(Boolean);
    
        // 定义中英文关键词映射表
        const positionMap = {
            '左左': 'leftl', 'leftl': 'leftl',
            '左': 'left', 'left': 'left',
            '左右': 'leftr', 'leftr': 'leftr',
            '中': 'middle', 'middle': 'middle', 'center': 'middle',
            '右左': 'rightl', 'rightl': 'rightl',
            '右': 'right', 'right': 'right',
            '右右': 'rightr', 'rightr': 'rightr'
        };
    
        const verticalMap = {
            '下': 'down', 'down': 'down',
            '中下': 'downm', 'downm': 'downm',
            '下下': 'downd', 'downd': 'downd', 'bottom': 'downd',
            '上': 'up', 'up': 'up',
            '中上': 'upm', 'upm': 'upm',
            '上上': 'upu', 'upu': 'upu', 'top': 'upu'
        };
    
        const layerMap = {
            '前': 'front', 'front': 'front',
            '后': 'back', 'back': 'back'
        };
    
        const animationMap = {
            '瞬': 'instant', 'moment': 'instant', 'instant': 'instant'
        };
    
        const actionMap = {
            '后退': 'retreat', 'retreat': 'retreat',
            '前进': 'forward', 'forward': 'forward',
            '吓一跳': 'scare', 'scare': 'scare',
            '发抖': 'shake', 'shake': 'shake',
            '持续发抖': 'cshake', 'cshake': 'cshake',
            '结束发抖': 'sshake', 'sshake': 'sshake'
        };
    
        const fadeMap = {
            '渐入': 'fadeIn', 'fadeIn': 'fadeIn',
            '渐出': 'fadeOut', 'fadeOut': 'fadeOut'
        };
    
        // 第一步：检测精确坐标指令（具有最高优先级）
        for (const mod of modArray) {
            // 检测 x: 格式
            if (mod.startsWith('x:')) {
                const value = mod.substring(2);
                if (value.endsWith('%')) {
                    const percentValue = parseFloat(value.slice(0, -1));
                    if (!isNaN(percentValue)) {
                        preciseX = percentValue;
                    }
                }
            }
            // 检测 y: 格式
            if (mod.startsWith('y:')) {
                const value = mod.substring(2);
                if (value.endsWith('%')) {
                    const percentValue = parseFloat(value.slice(0, -1));
                    if (!isNaN(percentValue)) {
                        preciseY = percentValue;
                    }
                }
            }
        }
    
        // 第二步：如果没有精确X坐标，则解析水平位置关键词
        if (preciseX === null) {
            for (const mod of modArray) {
                if (positionMap.hasOwnProperty(mod)) {
                    const normalized = positionMap[mod];
                    switch(normalized) {
                        case 'leftl': left = '15%'; break;
                        case 'left': left = '25%'; break;
                        case 'leftr': left = '35%'; break;
                        case 'middle': left = '50%'; break;
                        case 'rightl': left = '65%'; break;
                        case 'right': left = '75%'; break;
                        case 'rightr': left = '85%'; break;
                    }
                    break; // 取第一个匹配的位置
                }
            }
        } else {
            // 如果有精确X坐标，计算left值（以50%为中心点）
            left = `calc(50% + ${preciseX}%)`;
        }
    
        // 第三步：如果没有精确Y坐标，则解析垂直位置关键词
        if (preciseY === null) {
            for (const mod of modArray) {
                if (verticalMap.hasOwnProperty(mod)) {
                    const normalized = verticalMap[mod];
                    switch(normalized) {
                        case 'down': bottom = '-25%'; break;
                        case 'downm': bottom = '-50%'; break;
                        case 'downd': bottom = '-65%'; break;
                        case 'up': bottom = '25%'; break;
                        case 'upm': bottom = '50%'; break;
                        case 'upu': bottom = '65%'; break;
                    }
                    break; // 取第一个匹配的垂直位置
                }
            }
        } else {
            // 如果有精确Y坐标，直接使用（正值向上，负值向下）
            bottom = `${preciseY}%`;
        }
    
        // 第四步：提取层级关键词（取第一个匹配的）
        for (const mod of modArray) {
            if (layerMap.hasOwnProperty(mod)) {
                const normalized = layerMap[mod];
                if (normalized === 'front') zIndexOffset = 1;
                if (normalized === 'back') zIndexOffset = -1;
                break; // 取第一个匹配的层级
            }
        }
    
        // 第五步：提取“瞬”指令关键词（取第一个匹配的）
        for (const mod of modArray) {
            if (animationMap.hasOwnProperty(mod)) {
                instant = true;
                break; // 取第一个匹配的动画指令
            }
        }
    
        // 第六步：提取百分比缩放关键词
        for (const mod of modArray) {
            // 检查是否以 % 结尾，但不是 x: 或 y: 格式
            if (mod.endsWith('%') && !mod.startsWith('x:') && !mod.startsWith('y:')) {
                const percentValue = parseFloat(mod.slice(0, -1));
                if (!isNaN(percentValue)) {
                    // 计算公式：最终缩放比例 = 1 + (输入百分比数值 / 100)
                    // 0 或 0% 仍保持 100% 大小
                    scale = 1 + (percentValue / 100);
                    // 确保缩放比例为正数
                    if (scale <= 0) {
                        console.warn(`缩放比例不能为负数或零，已重置为默认值 100%`);
                        scale = 1;
                    }
                    break; // 只使用第一个百分比值
                }
            }
        }
    
        // 第七步：提取动作类型指令（取第一个匹配的）
        let hasAction = false;
        for (const mod of modArray) {
            if (actionMap.hasOwnProperty(mod)) {
                actionType = actionMap[mod];
                hasAction = true;
                break; // 取第一个匹配的动作指令
            }
        }
    
        // 第八步：提取渐入/渐出指令（取第一个匹配的）
        let fadeType = null;
        for (const mod of modArray) {
            if (fadeMap.hasOwnProperty(mod)) {
                fadeType = fadeMap[mod];
                break; // 取第一个匹配的渐入/渐出指令
            }
        }
    
        // 如果存在动作指令，自动屏蔽“瞬”指令
        if (hasAction) {
            instant = false;
        }
    
        return {
            left,
            zIndex: 10 + zIndexOffset,
            clipPath,
            scale,
            bottom,
            instant,
            preciseX,
            preciseY,
            actionType,
            fadeType
        };
    }
};
