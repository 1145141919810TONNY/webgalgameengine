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
        textFullyDisplayed: false
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
        
        // 设置说话者姓名
        if (line.speaker) {
            this.elements.nameBox.textContent = line.speaker;
            this.elements.nameBox.style.display = 'block';
        } else {
            this.elements.nameBox.style.display = 'none';
        }

        // 显示文本（支持分段和打字机效果）
        this.typeTextWithSplits(line.text);
        
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
            // 优先从场景数据中查找背景路径
            if (this.sceneData.background[line.background]) {
                bgPath = this.sceneData.background[line.background];
            } else if (typeof CG_CONFIG_SUB !== 'undefined' && CG_CONFIG_SUB[line.background]) {
                // 如果场景数据中没有，则从CG配置中查找
                bgPath = CG_CONFIG_SUB[line.background];
            }
            
            if (bgPath) {
                this.setBackground(bgPath);
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
        
        // 更新当前行号
        this.state.currentLine = index;
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
     * 淡出效果
     * 创建覆盖层并逐渐增加不透明度，实现淡出到指定颜色的效果
     * @param {number} duration - 淡出持续时间（毫秒）
     * @param {string} backgroundColor - 淡出目标颜色
     * @param {Function} [callback] - 淡出完成后的回调函数
     */
    fadeOut: function(duration, backgroundColor, callback) {
        // 创建淡出覆盖层
        const overlay = document.createElement('div');
        overlay.id = 'fade-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = backgroundColor;
        overlay.style.zIndex = '999';
        overlay.style.opacity = '0';
        document.body.appendChild(overlay);
        
        // 计算动画参数
        let startOpacity = 0;
        const interval = 16; // 约60fps
        const steps = duration / interval;
        const opacityStep = 1 / steps;
        
        const fadeStep = () => {
            startOpacity += opacityStep;
            if (startOpacity >= 1) {
                overlay.style.opacity = '1';
                if (callback && typeof callback === 'function') {
                    callback();
                } else {
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
            } else {
                overlay.style.opacity = startOpacity;
                requestAnimationFrame(fadeStep);
            }
        };
        
        requestAnimationFrame(fadeStep);
    },
    
    /**
     * 淡入效果
     * 创建覆盖层并逐渐降低不透明度，实现从指定颜色淡入的效果
     * @param {number} duration - 淡入持续时间（毫秒）
     * @param {string} backgroundColor - 淡入起始颜色
     */
    fadeIn: function(duration, backgroundColor) {
        const overlay = document.createElement('div');
        overlay.id = 'fade-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = backgroundColor;
        overlay.style.zIndex = '999';
        overlay.style.opacity = '1';
        document.body.appendChild(overlay);
        
        let startOpacity = 1;
        const interval = 16; // 约60fps
        const steps = duration / interval;
        const opacityStep = 1 / steps;
        
        const fadeStep = () => {
            startOpacity -= opacityStep;
            if (startOpacity <= 0) {
                overlay.style.opacity = '0';
                document.body.removeChild(overlay);
                
                setTimeout(() => {
                    this.nextLine();
                }, 100);
            } else {
                overlay.style.opacity = startOpacity;
                requestAnimationFrame(fadeStep);
            }
        };
        
        requestAnimationFrame(fadeStep);
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
    }
};
