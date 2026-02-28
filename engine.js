/**
 * 视觉小说引擎核心脚本
 * 实现类似Kirikiri的功能
 */

const gameEngine = {
    // 游戏状态
    state: {
        currentScene: 0,           // 当前场景索引
        currentLine: 0,            // 当前台词索引
        novelMode: false,          // 是否为全屏小说模式
        choicesActive: false,      // 是否正在显示选项
        conditionalStack: [],      // 条件判断栈
        currentConditionResult: null,  // 当前条件结果
        pendingSelections: [],     // 待处理的选项
        disableLVE: false,         // 是否禁用演出效果
        affinity: {},              // 好感度系统
        completedScenes: [],       // 完成的场景列表
        contextMenuInitialized: false,  // 上下文菜单是否已初始化
        textSegments: null,        // 文本分段数组
        currentSegment: 0,         // 当前文本段索引
        waitingForSegmentClick: false  // 是否在等待分段点击
    },
    
    // DOM元素引用
    elements: {
        backgroundContainer: null,
        characterContainer: null,
        nameBox: null,
        textBox: null,
        optionsContainer: null,
        novelTextBox: null,
        novelModeContainer: null,
        textContainer: null,
        bgmPlayer: null,
        sePlayer: null,
        voicePlayer: null
    },
    
    // 场景数据
    sceneData: null,
    
    // 初始化引擎
    init: function(data) {
        this.sceneData = data;
        this.cacheElements();
        this.bindEvents();
        
        // 加载之前的进度
        this.loadProgress();
        
        // 检查并保存当前场景的唯一标识符到存档
        this.saveCurrentSceneMarker();
        
        // 如果有视频元素，初始化视频播放器
        if (this.elements.videoPlayer) {
            this.elements.videoPlayer.style.display = 'none';
        }
        
        this.displayLine(this.state.currentLine);
        
        // 请求用户交互以启用音频播放
        this.requestAudioPlayback();
    },
    
    // 请求音频播放权限
    requestAudioPlayback: function() {
        // 某些浏览器需要在用户交互后才能播放音频
        // 设置监听器以响应用户首次交互并尝试解锁音频
        const handleFirstInteraction = () => {
            // 尝试播放一个无声的音频片段来解锁音频上下文
            this.unlockAudioContext();
            
            // 移除事件监听器
            document.removeEventListener('mousedown', handleFirstInteraction);
            document.removeEventListener('touchstart', handleFirstInteraction);
            document.removeEventListener('keydown', handleFirstInteraction);
        };
        
        // 监听用户的第一次交互
        document.addEventListener('mousedown', handleFirstInteraction);
        document.addEventListener('touchstart', handleFirstInteraction);
        document.addEventListener('keydown', handleFirstInteraction);
    },
    
    // 尝试解锁音频上下文
    unlockAudioContext: function() {
        // 某些浏览器需要先播放一个无声的音频片段来解锁音频上下文
        try {
            // 尝试播放一个无声的音频
            this.elements.bgmPlayer.volume = 0;
            this.elements.bgmPlayer.play().then(() => {
                // 播放成功后恢复音量
                this.elements.bgmPlayer.volume = 1;
                console.log("音频上下文已解锁");
            }).catch(() => {
                // 如果失败，恢复音量
                this.elements.bgmPlayer.volume = 1;
            });
        } catch (e) {
            console.log("尝试解锁音频上下文时出错:", e);
            this.elements.bgmPlayer.volume = 1;
        }
    },
    
    // 缓存DOM元素
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
    
    // 绑定事件
    bindEvents: function() {
        // 点击继续故事
        document.body.addEventListener('click', (e) => {
            if (!this.state.choicesActive && !this.isOptionElement(e.target)) {
                // 优先处理分段文本点击
                if (this.state.waitingForSegmentClick) {
                    // 如果正在打字新增内容，立即完成打字
                    if (this.state.typingActive) {
                        // 完成当前段落的打字
                        if (this.state.textSegments && this.state.currentSegment < this.state.textSegments.length) {
                            let cumulativeText = '';
                            for (let i = 0; i <= this.state.currentSegment; i++) {
                                cumulativeText += this.state.textSegments[i];
                            }
                            this.elements.textBox.textContent = cumulativeText;
                            this.state.typingActive = false;
                        }
                        return;
                    }
                    this.handleSegmentClick();
                } else {
                    this.nextLine();
                }
            }
        });
        
        // 右键跳过视频或继续故事
        document.body.addEventListener('contextmenu', (e) => {
            // 如果视频正在播放，跳过视频
            if (this.elements.videoPlayer && this.elements.videoPlayer.style.display === 'block') {
                e.preventDefault();
                this.skipVideo();
            } else if (!this.state.choicesActive && !this.isOptionElement(e.target)) {
                // 如果没有选项激活，右键也可以继续故事
                e.preventDefault();
                this.nextLine();
            }
        });
        
        // ESC键呼出上下文菜单
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.toggleContextMenu();
            }
        });
        
        // 点击遮罩层关闭菜单
        if (this.elements.contextMenuBackdrop) {
            this.elements.contextMenuBackdrop.addEventListener('click', () => {
                this.toggleContextMenu();
            });
        }
    },
    
    // 检查是否点击了选项元素
    isOptionElement: function(element) {
        return element.closest('#options-container') !== null;
    },
    
    // 显示当前行
    displayLine: function(index) {
        if (index >= this.sceneData.story.length) {
            console.log("故事结束或到达场景末尾");
            this.handleEndOfScene();
            return;
        }
        
        // 检查当前行是否应该被跳过（基于条件判断）
        if (this.shouldSkipLine(index)) {
            this.state.currentLine = index;
            setTimeout(() => {
                this.nextLine();
            }, 10); // 短暂延迟以避免阻塞
            return;
        }
        
        const line = this.sceneData.story[index];
        
        // 解析并执行标签命令
        if (line.command) {
            this.executeCommand(line.command);
            return;
        }
        
        // 设置说话者
        if (line.speaker) {
            this.elements.nameBox.textContent = line.speaker;
            this.elements.nameBox.style.display = 'block';
        } else {
            this.elements.nameBox.style.display = 'none';
        }
        
        // 设置文本（带打字机效果）
        this.typeTextWithSplits(line.text);
        
        // 切换背景
        if (line.background && this.sceneData.background[line.background]) {
            this.setBackground(this.sceneData.background[line.background]);
        }
        
        // 处理BGM（优先级更高）
        if (line.bgm) {
            if (line.bgm === 'bgm stop') {
                // 停止当前BGM播放
                this.stopBGM();
            } else if (this.sceneData.bgm && this.sceneData.bgm[line.bgm]) {
                // 播放指定的BGM
                this.playAudio(line.bgm);
            }
        }
        
        // 播放音频（如果该音频不在bgm数组中）
        if (line.audio && this.sceneData.audio && this.sceneData.audio[line.audio] && !(this.sceneData.bgm && this.sceneData.bgm[line.audio])) {
            this.playAudio(line.audio);
        }
        
        // 播放视频
        if (line.video && this.sceneData.videos && this.sceneData.videos[line.video]) {
            this.playVideo(line.video);
        }
        
        // 处理动作
        if (line.action) {
            this.handleAction(line.action);
        }
        
        // 更新当前行
        this.state.currentLine = index;
    },
    
    // 执行标签命令
    executeCommand: function(command) {
        // 解析命令字符串
        const parsedCommand = this.parseCommand(command);
        
        // 执行解析后的命令
        if (parsedCommand.type) {
            this.handleAction(parsedCommand);
        }
        
        // 检查是否是需要等待用户点击的命令类型
        const waitForClickCommands = ['waitForClick'];
        
        // 如果命令类型是需要等待用户点击的，不要自动继续
        if (waitForClickCommands.includes(parsedCommand.type)) {
            // 显示提示信息，告诉用户需要点击继续
            this.elements.textBox.textContent = '点击继续';
            this.elements.nameBox.textContent = '系统';
            this.elements.nameBox.style.display = 'block';
        } else {
            // 如果没有后续文本，直接进入下一行
            if (!parsedCommand.text) {
                setTimeout(() => {
                    this.nextLine();
                }, 100);
            }
        }
    },
    
    // 解析标签命令
    parseCommand: function(commandStr) {
        // 解析命令，支持类似 [command param=value] 的格式
        const cmdMatch = commandStr.match(/\[([^\]]+)\]/);
        if (!cmdMatch) return {};
            
        const fullCmd = cmdMatch[1];
        const parts = fullCmd.split(' ');
        const cmdName = parts[0].toLowerCase();
            
        // 解析参数
        const params = {};
        for (let i = 1; i < parts.length; i++) {
            const paramMatch = parts[i].match(/([a-zA-Z0-9]+)=(.+)/);
            if (paramMatch) {
                params[paramMatch[1]] = paramMatch[2].replace(/"/g, '');
            }
        }
            
        // 调用专门的命令解析函数
        return this.parseCommandByName(cmdName, params, parts);
    },
        
    // 根据命令名称解析具体命令
    parseCommandByName: function(cmdName, params, parts) {
        switch(cmdName) {
            case 'fadeout':
                return {
                    type: 'fadeOut',
                    duration: parseInt(params.time) || 1000,
                    backgroundColor: params.color || 'black'
                };
                    
            case 'clearname':
                return {
                    type: 'clearName'
                };
                    
            case 'msgoff':
                return {
                    type: 'hideText'
                };
                    
            case 'msgon':
                return {
                    type: 'showText'
                };
                    
            case 'fadein':
                return {
                    type: 'fadeIn',
                    duration: parseInt(params.time) || 1000,
                    backgroundColor: params.color || 'black'
                };
                    
            case 'clear':
                return {
                    type: 'clearName'
                };
                    
            case 'finish':
                return {
                    type: 'finishGame',
                    bgColor: params.bgcolor || 'black',
                    duration: parseInt(params.time) || 1500
                };
                    
            case 'finishwhite':
                return {
                    type: 'finishGame',
                    bgColor: params.bgcolor || 'white',
                    duration: parseInt(params.time) || 1500
                };
                    
            case 's':
                return {
                    type: 'waitForClick'
                };
        }
            
        // 如果没有识别到命令，返回空对象
        return {};
    },
    
    // 显示选项
    showChoices: function(choices) {
        this.state.choicesActive = true;
        this.elements.optionsContainer.innerHTML = '';
        
        choices.forEach((choice, index) => {
            const button = document.createElement('button');
            button.className = 'choice-btn';
            button.textContent = choice.text;
            button.dataset.target = choice.target;
            
            // 根据选项数量调整按钮位置
            button.style.gridArea = this.calculateChoicePosition(index, choices.length);
            
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToScene(choice.target);
            });
            
            this.elements.optionsContainer.appendChild(button);
        });
        
        this.elements.optionsContainer.style.display = 'grid';
    },
    
    // 计算选项位置
    calculateChoicePosition: function(index, total) {
        // 此方法不再用于CSS Grid布局
        // CSS Grid布局由CSS负责
        return '';
    },
    
    // 处理动作
    handleAction: function(action) {
        switch(action.type) {
            case 'choice':
                this.showChoices(action.choices);
                break;
            case 'novelOn':
                this.setNovelMode(true);
                break;
            case 'novelOff':
                this.setNovelMode(false);
                break;
            case 'nextScene':
                // 这是[next]指令的模拟，会在最后一条线后触发
                if(action.target) {
                    this.goToScene(action.target);
                }
                break;
            case 'fadeOut':
                // 淡出效果
                this.fadeOut(action.duration || 1000, action.backgroundColor || 'black');
                break;
            case 'fadeIn':
                // 淡入效果
                this.fadeIn(action.duration || 1000, action.backgroundColor || 'black');
                break;
            case 'clearName':
                // 清除姓名框
                this.clearNameBox();
                break;
            case 'hideText':
                // 隐藏文本框
                this.hideTextBox();
                break;
            case 'showText':
                // 显示文本框
                this.showTextBox();
                break;
            case 'hideAllCharacters':
                // 隐藏所有角色
                this.hideAllCharacters();
                break;
            case 'hideEventVisual':
                // 隐藏事件画面
                this.hideEventVisual();
                break;
            case 'finishGame':
                // 游戏结束（淡出到指定颜色）
                this.finishGame(action.bgColor, action.duration);
                break;
            case 'finishGameNoTransition':
                // 游戏结束（无转场效果）
                this.finishGameNoTransition(action.bgColor, action.duration);
                break;
            case 'chapterEnd':
                // 章节结束
                this.chapterEnd(action.bgColor, action.duration);
                break;
            case 'fadeOutWhite':
                // 淡出到白色
                this.fadeOut(action.duration || 1000, 'white');
                break;
            case 'windowMode':
                // 窗口模式
                this.setWindowMode(action.visible);
                break;
            case 'novelMode':
                // 小说模式
                this.setNovelMode(action.visible);
                break;
            case 'backgroundChange':
                // 背景变更
                this.backgroundChangeWithTransition(action);
                break;
            case 'backgroundChangeNoTransition':
                // 背景变更无转场
                this.backgroundChangeWithoutTransition(action);
                break;
            case 'backgroundErase':
                // 背景消除
                this.backgroundErase(action);
                break;
            case 'eventShow':
                // 事件显示
                this.eventShow(action);
                break;
            case 'eventHide':
                // 事件消除
                this.eventHide(action);
                break;
            case 'whiteOut':
                // 白色覆盖
                this.whiteOut(action.time);
                break;
            case 'hideCharacter':
                // 隐藏角色
                this.hideCharacter(action.time);
                break;
            case 'betaFuraShow':
                // 单色显示
                this.betaFuraShow(action);
                break;
            case 'betaFuraEnd':
                // 单色结束
                this.betaFuraEnd(action);
                break;
            case 'eventBlurShow':
                // 事件模糊显示
                this.eventBlurShow(action);
                break;
            case 'eventBlurRestore':
                // 事件模糊恢复
                this.eventBlurRestore(action);
                break;
            case 'sepiaStart':
                // 怀旧滤镜开始
                this.sepiaStart();
                break;
            case 'sepiaEnd':
                // 怀旧滤镜结束
                this.sepiaEnd();
                break;
            case 'sepiaStartWithWhiteout':
                // 怀旧滤镜开始・白色覆盖
                this.sepiaStartWithWhiteout(action.time);
                break;
            case 'sepiaEndWithWhiteout':
                // 怀旧滤镜结束・白色覆盖
                this.sepiaEndWithWhiteout(action.time);
                break;
            case 'fadeoutSepiaEnd':
                // 暗转怀旧滤镜结束
                this.fadeoutSepiaEnd();
                break;
            case 'flashbackStart':
                // 回忆开始
                this.flashbackStart(action);
                break;
            case 'flashbackEnd':
                // 回忆结束
                this.flashbackEnd(action);
                break;
            case 'negaposiFlip':
                // 负正反转
                this.negaposiFlip(action);
                break;
            case 'negaposiFlipEnd':
                // 负正反转结束
                this.negaposiFlipEnd(action);
                break;
            case 'affinityChange':
                // 好感度变化
                this.affinityChange(action);
                break;
            case 'affinityUpShow':
                // 好感度上升演出
                this.affinityUpShow(action);
                break;
            case 'affinityDownShow':
                // 好感度下降演出
                this.affinityDownShow(action);
                break;
            case 'conditional':
                // 条件判断
                this.handleConditional(action);
                break;
            case 'conditionalElse':
                // 条件否则
                this.handleConditionalElse();
                break;
            case 'conditionalEnd':
                // 条件结束
                this.handleConditionalEnd();
                break;
            case 'addSelection':
                // 添加选项
                this.addSelection(action);
                break;
            case 'showSelections':
                // 显示选项
                this.showSelections();
                break;
            case 'returnToMenu':
                // 返回主菜单
                this.returnToMenu();
                break;
            case 'waitForClick':
                // 等待用户点击继续
                // 不执行任何操作，等待用户点击
                break;
            default:
                console.log('未知动作类型:', action.type);
        }
    },
    
    // 淡出效果
    fadeOut: function(duration, backgroundColor, callback) {
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
        
        // 动画效果
        let startOpacity = 0;
        const interval = 16; // 约60fps
        const steps = duration / interval;
        const opacityStep = 1 / steps;
        
        const fadeStep = () => {
            startOpacity += opacityStep;
            if (startOpacity >= 1) {
                overlay.style.opacity = '1';
                // 淡出完成后执行回调或继续下一行
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
    
    // 淡入效果
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
        
        // 动画效果
        let startOpacity = 1;
        const interval = 16; // 约60fps
        const steps = duration / interval;
        const opacityStep = 1 / steps;
        
        const fadeStep = () => {
            startOpacity -= opacityStep;
            if (startOpacity <= 0) {
                overlay.style.opacity = '0';
                document.body.removeChild(overlay);
                // 淡入完成后自动执行下一行
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
    
    // 清除姓名框
    clearNameBox: function() {
        this.elements.nameBox.textContent = '';
        this.elements.nameBox.style.display = 'none';
    },
    
    // 隐藏文本框
    hideTextBox: function() {
        this.elements.textContainer.style.display = 'none';
    },
    
    // 显示文本框
    showTextBox: function() {
        this.elements.textContainer.style.display = 'flex';
    },
    
    // 处理场景结束
    handleEndOfScene: function() {
        // 标记当前场景为已完成
        this.markSceneCompleted();
        
        // 在实际游戏中，这里可能需要跳转到下一个场景
        // 或者显示一个提示让玩家手动跳转
        console.log("场景结束，等待用户操作或自动跳转");
        
        // 添加一个点击提示
        this.addClickPrompt();
    },
    
    // 添加点击提示
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
    
    // 带分段等待的文本显示（支持文本内的[s]标签）
    typeTextWithSplits: function(text) {
        // 重置文本框
        this.elements.textBox.textContent = '';
        
        // 分割文本，按[s]标签分段
        const segments = text.split(/\[s\]/i);
        
        if (segments.length <= 1) {
            // 没有[s]标签，使用原来的方式
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
    
    // 显示文本片段（累积显示模式-优化版）
    displayTextSegment: function(segmentIndex) {
        if (segmentIndex >= this.state.textSegments.length) {
            // 所有片段都显示完毕
            this.state.textSegments = null;
            this.state.currentSegment = 0;
            this.state.waitingForSegmentClick = false;
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
            
            // 只对新增的部分使用打字效果
            if (segmentIndex === 0) {
                // 第一段，使用完整打字效果
                this.typeText(cumulativeText);
            } else {
                // 后续段落，先显示已有的内容，只对新增部分打字
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
    
    // 显示累积文本（优化版-部分打字）
    showCumulativeText: function(fullText, currentSegment) {
        // 计算之前的内容长度
        let previousLength = 0;
        for (let i = 0; i < currentSegment; i++) {
            previousLength += this.state.textSegments[i].length;
        }
        
        // 显示已有的内容
        this.elements.textBox.textContent = fullText.substring(0, previousLength);
        
        // 对新增部分使用打字效果
        const newText = fullText.substring(previousLength);
        if (newText) {
            this.typeTextAppend(newText);
        } else {
            this.state.typingActive = false;
        }
    },
    
    // 追加打字效果
    typeTextAppend: function(text) {
        let i = 0;
        const speed = 30;
        
        this.state.typingActive = true;
        
        const typeWriter = () => {
            if (i < text.length) {
                this.elements.textBox.textContent += text.charAt(i);
                i++;
                setTimeout(typeWriter, speed);
            } else {
                this.state.typingActive = false;
            }
        };
        
        typeWriter();
    },
    
    // 显示下一段
    displayNextSegment: function() {
        if (this.state.textSegments && this.state.currentSegment < this.state.textSegments.length - 1) {
            this.displayTextSegment(this.state.currentSegment + 1);
        } else {
            // 所有片段显示完毕
            this.state.textSegments = null;
            this.state.currentSegment = 0;
            this.state.waitingForSegmentClick = false;
        }
    },
    
    // 显示点击提示
    showClickPrompt: function() {
        // 可以在这里添加视觉提示，比如闪烁光标等
        console.log("等待点击继续...");
    },
    
    // 处理分段文本的点击
    handleSegmentClick: function() {
        if (this.state.waitingForSegmentClick) {
            this.state.waitingForSegmentClick = false;
            this.hideClickPrompt();
            this.displayNextSegment();
        }
    },
    
    // 隐藏点击提示
    hideClickPrompt: function() {
        // 清除点击提示
        console.log("点击提示已隐藏");
    },
    
    // 打字机效果显示文本
    typeText: function(text) {
        let processedText = this.processLineBreaks(text);
        
        this.elements.textBox.innerHTML = '';
        let i = 0;
        const speed = 30; // 打字速度，毫秒
        
        this.state.typingActive = true;
        
        const typeWriter = () => {
            if (i < processedText.length) {
                // 处理HTML标签，确保不会在标签中间断开
                let charToAdd = processedText.charAt(i);
                
                // 如果遇到<，需要找到对应的>
                if (charToAdd === '<') {
                    let tagEnd = processedText.indexOf('>', i);
                    if (tagEnd !== -1) {
                        // 添加整个标签
                        this.elements.textBox.innerHTML += processedText.substring(i, tagEnd + 1);
                        i = tagEnd + 1;
                    } else {
                        // 如果没有找到>，当作普通字符处理
                        this.elements.textBox.innerHTML += charToAdd;
                        i++;
                    }
                } else {
                    this.elements.textBox.innerHTML += charToAdd;
                    i++;
                }
                
                setTimeout(typeWriter, speed);
            } else {
                this.state.typingActive = false;
            }
        };
        
        typeWriter();
    },
    
    // 处理换行标签
    processLineBreaks: function(text) {
        if (!text) return text;
        
        // 支持多种换行标记格式
        return text
            .replace(/\[br\]/gi, '<br>')      // [br] 标签
            .replace(/\\n/g, '<br>')         // \n 转义字符
            .replace(/<br\s*\/?>/gi, '<br>') // HTML <br> 标签（标准化）
            .replace(/\n/g, '<br>');          // 普通换行符
    },
    
    // 下一行
    nextLine: function() {
        if (this.state.choicesActive) return; // 如果正在显示选项，则不处理
        
        // 如果正在打字，立即完成打字
        if (this.state.typingActive) {
            // 完成打字，直接显示完整文本（包含换行标签处理）
            const line = this.sceneData.story[this.state.currentLine];
            if (line) {
                const processedText = this.processLineBreaks(line.text);
                this.elements.textBox.innerHTML = processedText;
                this.state.typingActive = false;
                return; // 只完成打字，不进入下一行
            }
        }
        
        this.state.currentLine++;
        
        if (this.state.currentLine < this.sceneData.story.length) {
            this.displayLine(this.state.currentLine);
        } else {
            // 如果已经到了故事的最后一行，触发[next]行为
            console.log("到达场景末尾，准备跳转...");
            // 在实际应用中，这里应该跳转到下一个场景
            // this.goToNextScene(); 
        }
    },
    
    // 跳转到下一个场景
    goToScene: function(sceneUrl) {
        // 在跳转前停止所有音频，包括BGM
        this.stopAllAudioWithBGM();
        window.location.href = sceneUrl;
    },
    
    // 设置背景
    setBackground: function(imagePath) {
        this.elements.backgroundContainer.style.backgroundImage = `url('${imagePath}')`;
        this.elements.backgroundContainer.style.backgroundSize = 'cover';
        this.elements.backgroundContainer.style.backgroundPosition = 'center';
    },
    
    // 播放音频
    playAudio: function(audioKey) {
        let audioPath = null;
        let isBgm = false;
        
        // 首先检查bgm对象中是否存在该音频
        if (this.sceneData.bgm && this.sceneData.bgm[audioKey]) {
            audioPath = this.sceneData.bgm[audioKey];
            isBgm = true;  // 严格根据是否在bgm数组内判断
        } 
        // 如果不是BGM，则检查audio对象
        else if (this.sceneData.audio && this.sceneData.audio[audioKey]) {
            audioPath = this.sceneData.audio[audioKey];
            // 不再根据音频键名判断，只有在bgm数组内的才算BGM
            isBgm = false;
        }
        
        if (!audioPath) {
            console.log("音频文件路径不存在:", audioKey);
            return;
        }
        
        console.log("播放音频:", audioKey, "路径:", audioPath, "是否为BGM:", isBgm);
        
        // 根据是否为背景音乐决定播放方式
        if (isBgm) {
            // 背景音乐，使用循环播放
            // 检查是否已经在播放相同的BGM，如果是则无需重新播放
            if (this.elements.bgmPlayer.src !== audioPath) {
                this.elements.bgmPlayer.src = audioPath;
                this.elements.bgmPlayer.loop = true;
                // 仅在更换BGM时尝试播放，捕获可能的自动播放策略错误
                const playPromise = this.elements.bgmPlayer.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.log("BGM播放失败，请注意浏览器自动播放策略限制，可能需要用户交互后才能播放:", error);
                        // 在自动播放被阻止时，设置音量为0来“解锁”音频
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
                // 如果BGM相同且已在播放，只需确保loop属性设置正确
                this.elements.bgmPlayer.loop = true;
            }
        } else {
            // 音效或语音，不循环
            // 只停止语音和音效，保留BGM播放
            this.elements.voicePlayer.pause();
            this.elements.sePlayer.pause();
            this.elements.voicePlayer.loop = false;
            this.elements.voicePlayer.src = audioPath;
            const playPromise = this.elements.voicePlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log("音频播放失败，请注意浏览器自动播放策略限制:", error);
                    // 同样尝试解锁语音播放
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
    
    // 停止所有音频（保留BGM）
    stopAllAudio: function() {
        this.elements.voicePlayer.pause();
        this.elements.sePlayer.pause();
    },
    
    // 停止所有音频（包括BGM）
    stopAllAudioWithBGM: function() {
        this.elements.bgmPlayer.pause();
        this.elements.sePlayer.pause();
        this.elements.voicePlayer.pause();
    },
    
    // 停止单独的BGM播放
    stopBGM: function() {
        if (this.elements.bgmPlayer) {
            this.elements.bgmPlayer.pause();
            this.elements.bgmPlayer.currentTime = 0;
            console.log("BGM已停止播放");
        }
    },
    
    // 播放视频
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
        
        // 设置视频源并播放
        this.elements.mainVideo.src = videoPath;
        
        // 显示视频播放器
        this.elements.videoPlayer.style.display = 'block';
        
        // 播放视频
        this.elements.mainVideo.play().catch(e => console.log('视频播放失败:', e));
        
        // 添加右键跳过功能
        this.setupVideoSkip();
    },
    
    // 设置视频跳过功能（右键）
    setupVideoSkip: function() {
        const self = this;
        
        // 阻止右键菜单
        this.elements.videoPlayer.oncontextmenu = function(e) {
            e.preventDefault();
            self.skipVideo();
        };
        
        // 监听键盘事件（ESC键跳过）
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && self.elements.videoPlayer.style.display === 'block') {
                self.skipVideo();
            }
        });
    },
    
    // 跳过视频
    skipVideo: function() {
        if (this.elements.videoPlayer && this.elements.mainVideo) {
            this.elements.videoPlayer.style.display = 'none';
            this.elements.mainVideo.pause();
            this.elements.mainVideo.currentTime = 0;
            
            // 继续游戏
            this.nextLine();
        }
    },
    
    // 设置全屏小说模式
    setNovelMode: function(enabled) {
        this.state.novelMode = enabled;
        
        if (enabled) {
            // 显示全屏小说模式
            this.elements.novelModeContainer.style.display = 'flex';
            this.elements.textContainer.style.display = 'none';
            
            // 将当前文本复制到全屏模式（保持HTML格式）
            this.elements.novelTextBox.innerHTML = this.elements.textBox.innerHTML;
        } else {
            // 隐藏全屏小说模式
            this.elements.novelModeContainer.style.display = 'none';
            this.elements.textContainer.style.display = 'flex';
        }
    },
    
    // 隐藏所有角色
    hideAllCharacters: function() {
        const characters = this.elements.characterContainer.querySelectorAll('.character');
        characters.forEach(char => {
            char.style.opacity = '0';
            char.style.visibility = 'hidden';
        });
    },
    
    // 隐藏事件画面
    hideEventVisual: function() {
        // 在当前实现中，这可能涉及特定的事件图像层
        // 目前简化为清除背景容器的一些效果
        const eventElements = document.querySelectorAll('.event-image, .effect-layer');
        eventElements.forEach(el => {
            el.style.opacity = '0';
            el.style.visibility = 'hidden';
        });
    },
    
    // 游戏结束（淡出到指定颜色）
    finishGame: function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
        this.hideAllCharacters();
        
        // 淡出到指定背景色
        this.fadeOut(duration || 1500, bgColor || 'black');
    },
    
    // 游戏结束（无转场效果）
    finishGameNoTransition: function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
        this.hideAllCharacters();
        
        // 直接设置背景色，无过渡效果
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
    
    // 章节结束
    chapterEnd: function(bgColor, duration) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
        this.hideAllCharacters();
        
        // 使用左右wipe效果淡出
        // 由于我们没有具体的wipe效果，使用普通的淡出代替
        // 使用回调函数在淡出完成后执行下一步
        this.fadeOut(duration || 1500, bgColor || 'black', () => {
            // 淡出完成后，可以返回主菜单或其他操作
            setTimeout(() => {
                this.returnToMenu();
            }, 100);
        });
    },
    
    // 窗口模式
    setWindowMode: function(visible) {
        this.hideTextBox();
        
        if (visible) {
            this.showTextBox();
        }
    },
    
    // 背景变更（带转场）
    backgroundChangeWithTransition: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
        this.hideAllCharacters();
        
        // 先淡出到黑色
        this.fadeOut(200, 'black', () => {
            // 更改背景
            this.setBackgroundWithPosition(options);
            
            // 然后淡入
            this.fadeIn(options.time || 1000, 'black');
        });
    },
    
    // 背景变更（无转场）
    backgroundChangeWithoutTransition: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
        this.hideAllCharacters();
        
        // 直接更改背景
        this.setBackgroundWithPosition(options);
        
        // 然后淡入
        this.fadeIn(options.time || 1000, 'transparent');
    },
    
    // 带位置参数的背景设置
    setBackgroundWithPosition: function(options) {
        // 这里可以扩展以支持背景的位置和缩放参数
        // 暂时仅使用默认背景设置
        if (this.sceneData.background['*']) {
            this.setBackground(this.sceneData.background['*']);
        }
    },
    
    // 背景消除
    backgroundErase: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
        this.hideAllCharacters();
        
        // 隐藏背景
        this.elements.backgroundContainer.style.visibility = 'hidden';
        
        // 使用转场效果
        this.fadeIn(options.time || 1000, options.transition || 'black');
    },
    
    // 事件显示
    eventShow: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
        this.hideAllCharacters();
        
        // 显示事件图像
        if (options.file && this.sceneData.events && this.sceneData.events[options.file]) {
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
            
            // 淡入效果
            let opacity = 0;
            const fadeInInterval = setInterval(() => {
                opacity += 0.05;
                if (opacity >= options.opacity / 255) {
                    opacity = options.opacity / 255;
                    clearInterval(fadeInInterval);
                    
                    // 淡入完成后继续
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                eventImg.style.opacity = opacity;
            }, options.time / 20);
        } else {
            // 如果没有找到事件图像，直接继续
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    // 事件消除
    eventHide: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 获取事件图像并淡出
        const eventImg = document.getElementById('event-image');
        if (eventImg) {
            let opacity = parseFloat(eventImg.style.opacity) || 1;
            const fadeOutInterval = setInterval(() => {
                opacity -= 0.05;
                if (opacity <= 0) {
                    opacity = 0;
                    clearInterval(fadeOutInterval);
                    eventImg.remove();
                    
                    // 淡出完成后继续
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                eventImg.style.opacity = opacity;
            }, options.time / 20);
        } else {
            // 如果没有找到事件图像，直接继续
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    // 白色覆盖
    whiteOut: function(time) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
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
        
        // 淡入效果
        let opacity = 0;
        const fadeInterval = setInterval(() => {
            opacity += 0.05;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(fadeInterval);
                
                // 淡出效果
                const fadeOutInterval = setInterval(() => {
                    opacity -= 0.05;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeOutInterval);
                        overlay.remove();
                        
                        // 完成后继续
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
    
    // 隐藏角色
    hideCharacter: function(time) {
        const characters = this.elements.characterContainer.querySelectorAll('.character');
        if (characters.length > 0) {
            let completedCount = 0;
            characters.forEach(char => {
                let opacity = parseFloat(char.style.opacity) || 1;
                const fadeInterval = setInterval(() => {
                    opacity -= 0.05;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeInterval);
                        char.style.visibility = 'hidden';
                        completedCount++;
                        
                        // 当所有角色都隐藏后继续
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
            // 如果没有角色需要隐藏，直接继续
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    // 自定义淡出函数，支持回调
    fadeOut: function(duration, backgroundColor, callback) {
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
        
        // 动画效果
        let startOpacity = 0;
        const interval = 16; // 约60fps
        const steps = duration / interval;
        const opacityStep = 1 / steps;
        
        const fadeStep = () => {
            startOpacity += opacityStep;
            if (startOpacity >= 1) {
                overlay.style.opacity = '1';
                // 淡出完成后执行回调或继续下一行
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
    
    // 单色显示
    betaFuraShow: function(options) {
        // 显示当前背景，使用圆形展开效果
        // 由于无法直接实现圆形展开，使用淡入效果模拟
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
        
        // 模拟圆形展开效果，逐渐降低遮罩透明度
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
                
                // 执行下一步
                setTimeout(() => {
                    this.nextLine();
                }, 100);
            }
            overlay.style.opacity = opacity;
        };
        
        const animInterval = setInterval(animate, intervalTime);
    },
    
    // 单色结束
    betaFuraEnd: function(options) {
        // 隐藏所有内容并使用普通过渡效果
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 创建一个临时遮罩
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
        
        // 淡入遮罩
        let opacity = 0;
        const intervalTime = 16;
        const steps = 500 / intervalTime; // 使用固定500ms
        const opacityStep = 1 / steps;
        
        const fadeIn = () => {
            opacity += opacityStep;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(fadeInInterval);
                
                // 然后淡出
                const fadeOut = () => {
                    opacity -= opacityStep;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeOutInterval);
                        overlay.remove();
                        
                        // 执行下一步
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
    
    // 事件模糊显示
    eventBlurShow: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 隐藏所有角色
        this.hideAllCharacters();
        
        // 显示事件图像并应用模糊效果
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
            eventImg.style.filter = `blur(${options.blur}px)`;
            eventImg.style.opacity = '0';
            eventImg.style.zIndex = '500';
            
            document.body.appendChild(eventImg);
            
            // 淡入效果
            let opacity = 0;
            const intervalTime = 16;
            const steps = options.time / intervalTime;
            const opacityStep = 1 / steps;
            
            const fadeInInterval = setInterval(() => {
                opacity += opacityStep;
                if (opacity >= 1) {
                    opacity = 1;
                    clearInterval(fadeInInterval);
                    
                    // 淡入完成后继续
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                eventImg.style.opacity = opacity;
            }, intervalTime);
        } else {
            // 如果没有找到事件图像，直接继续
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    // 事件模糊恢复
    eventBlurRestore: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        // 获取事件图像并移除模糊效果
        const eventImg = document.getElementById('event-blur-image');
        if (eventImg) {
            eventImg.style.filter = 'blur(0px)';
            
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
                    
                    // 执行下一步
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                eventImg.style.opacity = opacity;
            }, intervalTime);
        } else {
            // 如果没有找到事件图像，直接继续
            setTimeout(() => {
                this.nextLine();
            }, 100);
        }
    },
    
    // 怀旧滤镜开始
    sepiaStart: function() {
        // 应用怀旧滤镜效果（棕褐色调）
        document.body.style.filter = 'grayscale(100%) sepia(100%)';
        
        // 效果应用完成后继续
        setTimeout(() => {
            this.nextLine();
        }, 100);
    },
    
    // 怀旧滤镜结束
    sepiaEnd: function() {
        // 移除怀旧滤镜效果
        document.body.style.filter = 'none';
        
        // 效果移除完成后继续
        setTimeout(() => {
            this.nextLine();
        }, 100);
    },
    
    // 怀旧滤镜开始・白色覆盖
    sepiaStartWithWhiteout: function(time) {
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 先应用怀旧滤镜
        document.body.style.filter = 'grayscale(100%) sepia(100%)';
        
        // 然后白色覆盖
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
        
        // 淡入淡出效果
        let opacity = 0;
        const intervalTime = 16;
        const steps = time / intervalTime / 2; // 分为两半，一半淡入一半淡出
        const opacityStep = 1 / steps;
        
        const fadeIn = () => {
            opacity += opacityStep;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(fadeInInterval);
                
                // 淡出
                const fadeOut = () => {
                    opacity -= opacityStep;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeOutInterval);
                        overlay.remove();
                        
                        // 执行下一步
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
    
    // 怀旧滤镜结束・白色覆盖
    sepiaEndWithWhiteout: function(time) {
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 移除怀旧滤镜
        document.body.style.filter = 'none';
        
        // 白色覆盖
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
        
        // 淡入淡出效果
        let opacity = 0;
        const intervalTime = 16;
        const steps = time / intervalTime / 2;
        const opacityStep = 1 / steps;
        
        const fadeIn = () => {
            opacity += opacityStep;
            if (opacity >= 1) {
                opacity = 1;
                clearInterval(fadeInInterval);
                
                // 淡出
                const fadeOut = () => {
                    opacity -= opacityStep;
                    if (opacity <= 0) {
                        opacity = 0;
                        clearInterval(fadeOutInterval);
                        overlay.remove();
                        
                        // 执行下一步
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
    
    // 暗转怀旧滤镜结束
    fadeoutSepiaEnd: function() {
        // 先应用暗转
        this.fadeOut(1000, 'black', () => {
            // 暗转完成后移除怀旧滤镜
            document.body.style.filter = 'none';
            
            // 然后继续执行下一行
            this.nextLine();
        });
    },
    
    // 回忆开始
    flashbackStart: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 创建黑色背景
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
        
        // 涡旋闭合效果（用淡出模拟）
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
                
                // 然后显示回忆内容（显示正常背景和可能的事件图像）
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
                
                // 涡旋开启效果（用淡入模拟）
                let contentOpacity = 0;
                const openInterval = setInterval(() => {
                    contentOpacity += opacityStep;
                    if (contentOpacity >= 1) {
                        contentOpacity = 1;
                        clearInterval(openInterval);
                        recallContent.style.opacity = contentOpacity;
                        
                        // 应用怀旧滤镜
                        document.body.style.filter = 'grayscale(100%) sepia(100%)';
                        
                        // 添加白色框架效果
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
                        
                        // 执行下一步
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
    
    // 回忆结束
    flashbackEnd: function(options) {
        this.clearNameBox();
        this.hideTextBox();
        this.hideAllCharacters();
        
        // 移除白色框架
        const whiteFrame = document.getElementById('white-frame');
        if (whiteFrame) {
            whiteFrame.remove();
        }
        
        // 涡旋闭合效果（先回到黑屏）
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
        
        // 涡旋闭合效果
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
                
                // 结束怀旧滤镜
                document.body.style.filter = 'none';
                
                // 涡旋开启效果（恢复正常场景）
                let openOpacity = 1;
                const openInterval = setInterval(() => {
                    openOpacity -= opacityStep;
                    if (openOpacity <= 0) {
                        openOpacity = 0;
                        clearInterval(openInterval);
                        blackBg.remove();
                        
                        // 执行下一步
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
    
    // 负正反转
    negaposiFlip: function(options) {
        // 应用负正反转效果
        const currentFilter = document.body.style.filter;
        if (!currentFilter.includes('invert')) {
            document.body.style.filter = currentFilter + ' invert(100%)';
        }
        
        // 效果应用完成后继续
        setTimeout(() => {
            this.nextLine();
        }, 100);
    },
    
    // 负正反转结束
    negaposiFlipEnd: function(options) {
        // 移除负正反转效果
        let currentFilter = document.body.style.filter;
        if (currentFilter.includes('invert(100%)')) {
            currentFilter = currentFilter.replace(' invert(100%)', '').replace('invert(100%)', '');
            document.body.style.filter = currentFilter;
        }
        
        // 效果移除完成后继续
        setTimeout(() => {
            this.nextLine();
        }, 100);
    },
    
    // 初始化好感度系统
    initAffinitySystem: function() {
        if (!this.state.affinity) {
            this.state.affinity = {};
        }
    },
    
    // 好感度变化
    affinityChange: function(options) {
        // 初始化好感度系统
        this.initAffinitySystem();
        
        // 更新指定flag的好感度值
        const currentValue = this.state.affinity[options.flag] || 0;
        this.state.affinity[options.flag] = currentValue + options.add;
        
        // 显示演出效果（根据增加或减少）
        if (options.add > 0) {
            // 好感度上升
            this.affinityUpShow({flag: options.flag, add: options.add, time: 1000});
        } else if (options.add < 0) {
            // 好感度下降
            this.affinityDownShow({flag: options.flag, add: options.add, time: 1000});
        } else {
            // 如果没有变化，直接继续
            this.nextLine();
        }
    },
    
    // 好感度上升演出
    affinityUpShow: function(options) {
        // 播放音效
        this.playAffinitySound('up');
        
        // 如果禁用了演出效果则跳过
        if (this.state.disableLVE) {
            return;
        }
        
        // 创建好感度上升视觉效果
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
        
        // 动画效果：向上移动并淡出
        setTimeout(() => {
            effectDiv.style.transform = 'translate(-50%, -100px)';
            effectDiv.style.opacity = '0';
        }, 50);
        
        // 移除元素
        setTimeout(() => {
            if (document.contains(effectDiv)) {
                document.body.removeChild(effectDiv);
            }
        }, 1050);
        
        // 等待演出结束后继续
        setTimeout(() => {
            this.nextLine();
        }, options.time || 1000);
    },
    
    // 好感度下降演出
    affinityDownShow: function(options) {
        // 播放音效
        this.playAffinitySound('down');
        
        // 如果禁用了演出效果则跳过
        if (this.state.disableLVE) {
            return;
        }
        
        // 创建好感度下降视觉效果
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
        
        // 动画效果：向下移动并淡出
        setTimeout(() => {
            effectDiv.style.transform = 'translate(-50%, +100px)';
            effectDiv.style.opacity = '0';
        }, 50);
        
        // 移除元素
        setTimeout(() => {
            if (document.contains(effectDiv)) {
                document.body.removeChild(effectDiv);
            }
        }, 1050);
        
        // 等待演出结束后继续
        setTimeout(() => {
            this.nextLine();
        }, options.time || 1000);
    },
    
    // 播放好感度音效
    playAffinitySound: function(type) {
        // 这里可以播放特定的音效，暂时使用系统音效或跳过
        // 在实际实现中，可以根据type播放不同的音效
        if (type === 'up') {
            // 播放好感度上升音效
            console.log('播放好感度上升音效');
        } else if (type === 'down') {
            // 播放好感度下降音效
            console.log('播放好感度下降音效');
        }
    },
    
    // 解析并计算条件表达式
    evaluateCondition: function(conditionStr) {
        try {
            // 替换表达式中的特殊符号和变量引用
            // 例如将 f.yurina 替换为 this.state.affinity['yurina']
            let expr = conditionStr.trim();
            
            // 处理 f.变量名 的情况
            expr = expr.replace(/f\.([a-zA-Z0-9_]+)/g, (match, varName) => {
                return `(this.state.affinity['${varName}'] || 0)`;
            });
            
            // 评估表达式
            // 注意：在生产环境中，应使用更安全的表达式解析库
            // 这里使用 Function 构造器以避免直接使用 eval
            const result = new Function('game', `return ${expr}`).call(null, this);
            return !!result;
        } catch (e) {
            console.error('条件表达式评估错误:', e, '表达式:', conditionStr);
            return false;
        }
    },
    
    // 处理条件判断
    handleConditional: function(action) {
        const result = this.evaluateCondition(action.condition);
        this.state.conditionalStack.push(result);
        this.state.currentConditionResult = result;
        
        // 如果条件为假，跳过后续内容直到遇到else或endif
        if (!result) {
            // 查找匹配的endif或else
            this.skipConditionalBlock();
        } else {
            this.nextLine();
        }
    },
    
    // 处理条件否则
    handleConditionalElse: function() {
        // 获取栈顶的条件结果
        const conditionResult = this.state.conditionalStack[this.state.conditionalStack.length - 1];
        
        if (conditionResult) {
            // 如果前面的条件为真，则跳过else块
            this.skipConditionalBlock();
        } else {
            // 如果前面的条件为假，则执行else块
            this.nextLine();
        }
    },
    
    // 处理条件结束
    handleConditionalEnd: function() {
        // 弹出条件栈
        this.state.conditionalStack.pop();
        this.nextLine();
    },
    
    // 跳过条件块
    skipConditionalBlock: function() {
        // 这里需要跳过到匹配的endif或else
        // 由于我们的架构限制，我们需要在解析层面处理
        // 当前实现是在解析时处理，所以只需继续到下一行
        // 实际的跳过逻辑需要在解析story数组时实现
        this.nextLine();
    },
    
    // 添加选项
    addSelection: function(action) {
        if (this.state.currentConditionResult !== false) {
            // 只有条件为真时才添加选项
            this.state.pendingSelections.push({
                text: action.text,
                target: action.target
            });
        }
        
        this.nextLine();
    },
    
    // 显示选项
    showSelections: function() {
        if (this.state.pendingSelections.length > 0) {
            // 显示收集到的选项
            this.showChoices(this.state.pendingSelections.map(sel => ({
                text: sel.text,
                target: sel.target
            })));
            
            // 清空待处理选项列表
            this.state.pendingSelections = [];
        }
    },
    
    // 检查是否应该跳过当前行（基于条件判断）
    shouldSkipLine: function(index) {
        const line = this.sceneData.story[index];
        
        // 如果有活动的条件判断，检查当前行是否在被跳过的块内
        if (this.state.conditionalStack.length > 0) {
            // 检查是否是条件相关的命令
            if (line.command) {
                const parsedCommand = this.parseCommand(line.command);
                
                if (parsedCommand.type === 'conditional') {
                    // 如果当前条件为false，需要跳过此行及之后的内容直到else或endif
                    const result = this.evaluateCondition(parsedCommand.condition);
                    if (!result) {
                        // 将结果压入栈中
                        this.state.conditionalStack.push(false);
                        return true; // 跳过此行
                    } else {
                        // 条件为真，执行此行
                        this.state.conditionalStack.push(true);
                        return false;
                    }
                } else if (parsedCommand.type === 'conditionalElse') {
                    // 获取上一个条件的结果
                    const prevResult = this.state.conditionalStack[this.state.conditionalStack.length - 1];
                    // 如果之前条件为真，则跳过else块
                    return prevResult === true;
                } else if (parsedCommand.type === 'conditionalEnd') {
                    // 弹出条件栈
                    this.state.conditionalStack.pop();
                    return false; // endif行本身不跳过
                }
            }
            
            // 检查当前条件栈状态
            for (let i = 0; i < this.state.conditionalStack.length; i++) {
                if (!this.state.conditionalStack[i]) {
                    // 如果任何一层条件为false，则跳过当前行
                    return true;
                }
            }
        }
        
        return false;
    },
    
    // 返回主菜单
    returnToMenu: function() {
        // 标记当前场景为已完成
        this.markSceneCompleted();
        
        // 延迟跳转，给用户时间阅读最后的文本
        setTimeout(() => {
            // 在跳转前停止所有音频，包括BGM
            this.stopAllAudioWithBGM();
            window.location.href = '../index.html';
        }, 1000); // 1秒后跳转
    },
    
    // 标记当前场景为已完成
    markSceneCompleted: function() {
        // 获取当前页面的文件名
        const currentPage = window.location.pathname.split('/').pop();
        
        // 检查是否已经在完成列表中
        if (!this.state.completedScenes.includes(currentPage)) {
            this.state.completedScenes.push(currentPage);
            this.saveProgress();
        }
    },
    
    // 保存进度到本地存储
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
    
    // 加载进度从本地存储
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
    
    // 获取特定场景的完成状态
    isSceneCompleted: function(sceneFileName) {
        return this.state.completedScenes.includes(sceneFileName);
    },
    
    // 获取所有完成的场景列表
    getCompletedScenes: function() {
        return [...this.state.completedScenes]; // 返回副本以防止意外修改
    },
    
    // 重置进度
    resetProgress: function() {
        this.state.completedScenes = [];
        this.state.affinity = {};
        localStorage.removeItem('gameProgress');
        console.log('进度已重置');
    },
    
    // 保存当前场景的唯一标识符到存档
    saveCurrentSceneMarker: function() {
        // 自动获取当前页面文件名作为场景ID
        const currentPage = window.location.pathname.split('/').pop();
        const sceneId = currentPage.replace('.html', '');
        
        // 将当前场景ID和值保存到存档数据中
        const progressData = this.loadProgress() || this.getDefaultProgressData();
        
        // 添加场景标识符到存档数据
        progressData.sceneMarkers = progressData.sceneMarkers || {};
        
        // 只有当前场景还没有标记时才设置
        if (!progressData.sceneMarkers.hasOwnProperty(sceneId)) {
            progressData.sceneMarkers[sceneId] = 1;
            
            // 更新时间戳
            progressData.timestamp = Date.now();
            
            // 保存回localStorage
            localStorage.setItem('gameProgress', JSON.stringify(progressData));
            console.log(`场景标识符已保存: ${sceneId} = 1`);
        }
    },
    
    // 获取默认的进度数据
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
    
    // 切换上下文菜单显示/隐藏
    toggleContextMenu: function() {
        if (!this.elements.contextMenu || !this.elements.contextMenuBackdrop) {
            console.warn('上下文菜单元素未找到');
            return;
        }
        
        if (this.elements.contextMenu.classList.contains('show')) {
            this.elements.contextMenu.classList.remove('show');
            this.elements.contextMenuBackdrop.style.display = 'none';
        } else {
            this.elements.contextMenu.classList.add('show');
            this.elements.contextMenuBackdrop.style.display = 'block';
        }
    }
};