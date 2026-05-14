/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * Shiori 引擎核心脚本
 * 提供视觉小说的核心渲染、剧情推进、资源管理等功能
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
        charNameMap: {},
        // F5按键防抖标记
        _f5Pressed: false,
        // 鼠标点击锁定状态（用于 [阻止]/[lock] 和 [解锁]/[free] 标签）
        isClickLocked: false
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
    
    // 音频资源缓存映射表 { audioKey: audioPath }
    audioCache: {},
    
    // 视频资源缓存映射表 { videoKey: videoPath }
    videoCache: {},
    
    /**
     * 为剧情数组中的每个对象添加源码行号范围
     * 通过正则表达式解析 HTML 文件内容，找到每个剧情对象的物理位置
     */
    annotateStoryLineNumbers: function() {
        if (!this.sceneData || !this.sceneData.story) {
            return;
        }
        
        // 获取当前页面URL
        const currentPage = window.location.pathname.split('/').pop();
        console.log(`[Line Numbers] Annotating story for ${currentPage}`);
        
        // 异步加载当前HTML文件并解析行号
        fetch(currentPage)
            .then(response => response.text())
            .then(htmlContent => {
                this.parseStoryLineNumbers(htmlContent);
            })
            .catch(error => {
                console.warn('[Line Numbers] Failed to load HTML file:', error);
            });
    },
    
    /**
     * 解析HTML内容，提取story数组中每个对象的行号范围
     * @param {string} htmlContent - HTML文件内容
     */
    parseStoryLineNumbers: function(htmlContent) {
        const lines = htmlContent.split('\n');
        const storyObjects = [];
        
        // 查找 story: [ 的位置
        let inStoryArray = false;
        let braceDepth = 0;
        let currentObjectStart = -1;
        let objectBraceDepth = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // 检测是否进入 story 数组
            if (!inStoryArray && line.includes('story:')) {
                inStoryArray = true;
                continue;
            }
            
            if (!inStoryArray) continue;
            
            // 检测数组结束
            if (line.trim() === ']' || (line.trim().endsWith(']') && braceDepth === 0)) {
                break;
            }
            
            // 检测对象开始 {
            const openBraces = (line.match(/{/g) || []).length;
            const closeBraces = (line.match(/}/g) || []).length;
            
            if (openBraces > 0 && currentObjectStart === -1) {
                // 新的剧情对象开始
                currentObjectStart = i + 1; // 行号从1开始
                objectBraceDepth = openBraces - closeBraces;
            } else if (currentObjectStart !== -1) {
                objectBraceDepth += openBraces - closeBraces;
                
                // 当brace深度回到0时，对象结束
                if (objectBraceDepth <= 0) {
                    storyObjects.push({
                        startLine: currentObjectStart,
                        endLine: i + 1 // 行号从1开始
                    });
                    currentObjectStart = -1;
                    objectBraceDepth = 0;
                }
            }
        }
        
        // 将行号信息添加到 story 数组中的每个对象
        storyObjects.forEach((range, index) => {
            if (this.sceneData.story[index]) {
                this.sceneData.story[index].__lineRange = range;
            }
        });
        
        console.log(`[Line Numbers] Annotated ${storyObjects.length} story objects`);
        if (storyObjects.length > 0) {
            console.log(`[Line Numbers] First object: lines ${storyObjects[0].startLine}-${storyObjects[0].endLine}`);
        }
    },

    /**
     * 初始化游戏引擎
     * @param {Object} data - 场景数据对象，包含story、background、audio等配置
     * @param {number} startLine - 可选的起始行号,默认为0
     */
    init: function(data, startLine = 0) {
        // 缓存场景数据
        this.sceneData = data;
        
        // 为每个剧情对象添加源码行号范围
        this.annotateStoryLineNumbers();
        
        // 设置起始行号
        this.state.currentLine = startLine;
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
        
        // 检查是否有状态快照需要恢复
        const snapshot = this.loadStateSnapshot();
        if (snapshot && snapshot.pagePath === window.location.pathname && startLine > 0) {
            console.log('[State Restore] Detected state snapshot, restoring full state...');
            
            // 1. 恢复systemModule中的状态变量
            if (typeof systemModule !== 'undefined') {
                if (snapshot.lastActiveBgm) {
                    systemModule.lastActiveBgm = snapshot.lastActiveBgm;
                    console.log('[State Restore] Restored BGM:', snapshot.lastActiveBgm);
                }
                if (snapshot.lastActiveBg) {
                    systemModule.lastActiveBg = snapshot.lastActiveBg;
                    console.log('[State Restore] Restored BG:', snapshot.lastActiveBg);
                }
                if (snapshot.lastActiveChars) {
                    systemModule.lastActiveChars = snapshot.lastActiveChars;
                    console.log('[State Restore] Restored Chars:', snapshot.lastActiveChars);
                }
            }
            
            // 2. 实际渲染恢复的状态
            // 恢复背景
            if (snapshot.lastActiveBg) {
                let bgPath = null;
                if (this.sceneData.background && this.sceneData.background[snapshot.lastActiveBg]) {
                    bgPath = this.sceneData.background[snapshot.lastActiveBg];
                } else if (typeof CG_CONFIG_SUB !== 'undefined' && CG_CONFIG_SUB[snapshot.lastActiveBg]) {
                    bgPath = CG_CONFIG_SUB[snapshot.lastActiveBg];
                }
                
                if (bgPath) {
                    this.setBackground(bgPath);
                    console.log('[State Restore] Applied background:', bgPath);
                }
            }
            
            // 恢复BGM
            if (snapshot.lastActiveBgm && this.sceneData.bgm && this.sceneData.bgm[snapshot.lastActiveBgm]) {
                this.playAudio(snapshot.lastActiveBgm);
                console.log('[State Restore] Playing BGM:', snapshot.lastActiveBgm);
            }
            
            // 恢复立绘
            if (snapshot.lastActiveChars) {
                this.renderChars(snapshot.lastActiveChars);
                console.log('[State Restore] Rendered characters:', snapshot.lastActiveChars);
            }
            
            // 清除快照(避免重复使用)
            sessionStorage.removeItem('gameStateSnapshot');
            
            console.log('[State Restore] Full state restored successfully, starting at line:', startLine);
            
            // 状态恢复后立即同步调试日志，基于实际渲染的立绘状态
            // 延迟一小段时间，确保 renderChars 已完成，activeChars 已更新
            setTimeout(() => {
                this.syncDebugCharsState();
                console.log('[State Restore] Debug chars state synced after state restore');
            }, 150);
        } else if (snapshot && snapshot.pagePath === window.location.pathname) {
            // startLine为0的情况,只恢复systemModule状态变量
            if (typeof systemModule !== 'undefined') {
                if (snapshot.lastActiveBgm) systemModule.lastActiveBgm = snapshot.lastActiveBgm;
                if (snapshot.lastActiveBg) systemModule.lastActiveBg = snapshot.lastActiveBg;
                if (snapshot.lastActiveChars) systemModule.lastActiveChars = snapshot.lastActiveChars;
            }
            sessionStorage.removeItem('gameStateSnapshot');
            console.log('[State Restore] Restored state variables only (startLine=0)');
            
            // 状态恢复后立即同步调试日志
            setTimeout(() => {
                this.syncDebugCharsState();
                console.log('[State Restore] Debug chars state synced after state restore (startLine=0)');
            }, 150);
        }
        
        // 显示指定行的对话
        this.displayLine(this.state.currentLine);
        // 请求音频播放权限（处理浏览器自动播放策略）
        this.requestAudioPlayback();
        
        // 检测file协议并隐藏存档相关功能
        if (window.location.protocol === 'file:') {
            this.hideArchiveMenuItems();
        }
        
        // 加载视频环境映射（已移除，现在仅使用HTML原生播放）
        // this.loadVideoEnvironmentMap();
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
                // 使用系统模块保存的音量值
                if (typeof systemModule !== 'undefined') {
                    this.elements.bgmPlayer.volume = systemModule.currentVolume;
                } else {
                    this.elements.bgmPlayer.volume = 1;
                }
                console.log("音频上下文已解锁");
            }).catch(() => {
                // 使用系统模块保存的音量值
                if (typeof systemModule !== 'undefined') {
                    this.elements.bgmPlayer.volume = systemModule.currentVolume;
                } else {
                    this.elements.bgmPlayer.volume = 1;
                }
            });
        } catch (e) {
            console.log("尝试解锁音频上下文时出错:", e);
            // 使用系统模块保存的音量值
            if (typeof systemModule !== 'undefined') {
                this.elements.bgmPlayer.volume = systemModule.currentVolume;
            } else {
                this.elements.bgmPlayer.volume = 1;
            }
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
     * 隐藏存档相关菜单项（file协议下）
     */
    hideArchiveMenuItems: function() {
        // 隐藏右键菜单中的存档相关项
        const contextMenu = document.getElementById('context-menu');
        if (!contextMenu) return;
        
        // 查找并隐藏存档相关的 li 元素
        const menuItems = contextMenu.querySelectorAll('ul li');
        menuItems.forEach(function(item) {
            const onclickAttr = item.getAttribute('onclick') || '';
            if (onclickAttr.includes('QuickSaveManager') || 
                onclickAttr.includes('saves.html')) {
                item.style.display = 'none';
            }
        });
        
        // 隐藏快捷键提示区域中包含 F5 的 div
        // 只选择提示区域内的直接子 div 元素
        const hintContainer = contextMenu.querySelector('div[style*="margin-top"]');
        if (hintContainer) {
            const hintDivs = hintContainer.querySelectorAll('div');
            hintDivs.forEach(function(div) {
                const text = div.textContent.trim();
                // 只隐藏包含 "F5" 的行
                if (text.includes('F5')) {
                    div.style.display = 'none';
                }
            });
        }
        
        console.log('[Engine] Archive menu items hidden for file:// protocol');
    },
    
    /**
     * 绑定全局事件监听器
     * 包括点击、右键、键盘等交互事件的处理
     */
    bindEvents: function() {
        // 左键点击事件：推进对话或显示完整文本
        document.body.addEventListener('click', (e) => {
            // 如果上下文菜单正在显示，屏蔽所有点击事件
            if (this.elements.contextMenu && this.elements.contextMenu.classList.contains('show')) {
                return;
            }
            
            // 如果鼠标点击被锁定，屏蔽点击事件（除非是Ctrl快进模式）
            if (this.state.isClickLocked && !this.state.fastForwardActive) {
                console.log('[点击锁定] 点击被屏蔽，按住Ctrl键可强制快进');
                return;
            }
            
            // 如果背景转场正在进行，屏蔽点击事件（除非是Ctrl快进模式）
            if (this.state.isBackgroundTransitioning && !this.state.fastForwardActive) {
                console.log('背景转场进行中，屏蔽点击事件');
                return;
            }
            
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
            // 如果上下文菜单正在显示，屏蔽右键事件
            if (this.elements.contextMenu && this.elements.contextMenu.classList.contains('show')) {
                e.preventDefault();
                return;
            }
            
            // 如果背景转场正在进行，屏蔽右键事件（除非是Ctrl快进模式）
            if (this.state.isBackgroundTransitioning && !this.state.fastForwardActive) {
                e.preventDefault();
                console.log('背景转场进行中，屏蔽右键事件');
                return;
            }
            
            // 如果鼠标点击被锁定，屏蔽右键事件（除非是Ctrl快进模式）
            if (this.state.isClickLocked && !this.state.fastForwardActive) {
                e.preventDefault();
                console.log('[点击锁定] 右键被屏蔽，按住Ctrl键可强制快进');
                return;
            }
            
            // 如果点击的是右键菜单本身或其子元素，不处理
            if (e.target.closest('#context-menu') || e.target.closest('#context-menu-backdrop')) {
                return;
            }
            
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
        
        // 键盘按下事件：ESC键切换菜单，Ctrl键快进，F5快速存档
        document.addEventListener('keydown', (e) => {
            // 如果上下文菜单正在显示，只允许 ESC 关闭菜单，屏蔽其他按键
            const isContextMenuShowing = this.elements.contextMenu && this.elements.contextMenu.classList.contains('show');
            
            if (e.key === 'Escape') {
                // ESC键切换右键菜单（无论菜单是否显示都响应）
                e.preventDefault();
                this.toggleContextMenu();
                return;
            }
            
            // 如果菜单正在显示，屏蔽其他所有按键
            if (isContextMenuShowing) {
                return;
            }
                    
            if (e.key === 'Control' && !this.state.fastForwardActive) {
                // Ctrl键开始快进
                e.preventDefault();
                this.startFastForward();
            }
            
            // F5 - 快速保存（file协议下禁用）
            if (e.key === 'F5' && window.location.protocol !== 'file:') {
                e.preventDefault();
                // 防止长按重复触发：只在第一次按下时触发
                if (!gameEngine.state._f5Pressed) {
                    gameEngine.state._f5Pressed = true;
                    if (typeof QuickSaveManager !== 'undefined') {
                        QuickSaveManager.quickSave();
                    }
                }
            }
        });
                
        // 键盘释放事件：停止快进，重置 F5 防抖标记
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                // 释放Ctrl键停止快进
                e.preventDefault();
                this.stopFastForward();
            }
            
            // F5 键释放：启动冷却计时器
            if (e.key === 'F5' && window.location.protocol !== 'file:') {
                e.preventDefault();
                gameEngine.state._f5Pressed = false; // 重置防抖标记
                
                // 启动冷却计时器
                if (typeof QuickSaveManager !== 'undefined') {
                    QuickSaveManager._startCooldown();
                }
            }
        });
        
        // 右键菜单背景点击事件：关闭菜单
        if (this.elements.contextMenuBackdrop) {
            this.elements.contextMenuBackdrop.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡，防止触发 body 的点击事件
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
        
        const line = this.sceneData.story[index];
        
        // 在获取行数据后立即检测转场指令，尽早启动屏蔽
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

        // 检测是否为纯命令行（只有 command 属性，没有 text 或 text 为空）
        const isPureCommand = line.command && (!line.text || line.text.trim() === '');

        // 只有在非转场行且非纯命令行时才立即渲染文本和姓名
        if (!isTransition && !isPureCommand) {
            // 设置说话者姓名
            if (line.speaker) {
                this.elements.nameBox.textContent = line.speaker;
                this.elements.nameBox.style.display = 'block';
            } else {
                this.elements.nameBox.style.display = 'none';
            }

            // 显示文本（支持分段和打字机效果）
            this.typeTextWithSplits(line.text);
        } else if (isPureCommand) {
            // 纯命令行：确保姓名框和文本框的状态正确
            if (line.speaker === null || line.speaker === undefined) {
                this.elements.nameBox.style.display = 'none';
            }
        }
        
        // 解析并播放音频序列（支持[a]标签的多段音频）
        if (line.audio && typeof line.audio === 'string' && line.audio.includes('[a]')) {
            this.state.audioSegments = this.parseAudioSequence(line.audio);
            this.state.currentAudioSegment = 0;
            
            if (this.state.audioSegments.length > 0) {
                this.playAudio(this.state.audioSegments[0]);
            }
        } else if (line.audio) {
            // 播放单个音频文件（直接使用 playAudio，它会自动解析路径）
            this.playAudio(line.audio);
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
                
                // 一旦检测到转场指令，立即设置屏蔽标志，消除时序窗口
                if (isTransition) {
                    this.state.isBackgroundTransitioning = true;
                    console.log(`[前置屏蔽] 检测到转场指令(${transitionType})，立即启动输入屏蔽`);
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
                    return; // 立即返回，阻断当前行后续所有指令（chars, text, audio等）
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
        
        // 播放视频（直接使用 playVideo，它会自动解析路径）
        if (line.video) {
            const isPlaying = this.playVideo(line.video);
            if (isPlaying) {
                return; // 视频开始播放，阻塞当前行，等待视频结束后再进入下一行
            }
            // 如果isPlaying为false，说明环境不匹配，继续执行下一行
        }
        
        // 解析并执行标签命令（如[s]、[wait]等）
        let hasBlockingCommand = false;
        if (line.command) {
            // 如果同时存在 action，告诉 executeCommand 不要自动进入下一行
            const shouldAutoNext = !line.action;
            hasBlockingCommand = this.executeCommand(line.command, shouldAutoNext);
        }
        
        // 处理动作指令（如背景切换、特效等）
        // 支持 command 和 action 同时存在：先执行 command，再执行 action
        if (line.action) {
            this.handleAction(line.action);
            // 如果 action 是 choice 类型，需要激活选项状态
            if (line.action.type === 'choice') {
                hasBlockingCommand = true; // 选项需要等待用户选择
            }
        }
        
        // 如果执行了阻塞性命令（如动画、选项等），不自动进入下一行
        if (hasBlockingCommand) {
            return;
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
        
        // 自动保存游戏状态快照（用于存档功能）
        this.saveStateSnapshot();
    },
    
    /**
     * 执行标签命令
     * 解析并执行场景文件中的命令标签（如[s]、[wait]、[novel]等）
     * @param {string} command - 命令字符串
     * @param {boolean} shouldAutoNext - 是否应该在非阻塞命令执行后自动进入下一行（默认 true）
     * @returns {boolean} - 如果是阻塞性命令（需要等待用户交互或动画完成），返回 true
     */
    executeCommand: function(command, shouldAutoNext = true) {
        // 支持多指令并行解析：使用逗号分隔多个指令
        // 例如：command: "[normal],[lock]" 或 command: "[pov 友凛],[阻止]"
        const commands = command.split(',').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
        
        // 定义需要等待用户点击的命令类型
        const waitForClickCommands = ['waitForClick'];
        
        // 定义需要等待动画完成的命令类型（这些命令不应自动进入下一行）
        const animationCommands = ['fadeOut', 'fadeIn', 'finishGame', 'waitForTime'];
        
        let hasAnimationCommand = false;
        let hasWaitForClickCommand = false;
        
        // 依次执行每个指令
        commands.forEach(cmd => {
            // 解析命令字符串为结构化对象
            const parsedCommand = this.parseCommand(cmd);
            
            // 执行解析后的命令
            if (parsedCommand.type) {
                this.handleAction(parsedCommand);
                
                // 检查命令类型
                if (waitForClickCommands.includes(parsedCommand.type)) {
                    hasWaitForClickCommand = true;
                }
                if (animationCommands.includes(parsedCommand.type)) {
                    hasAnimationCommand = true;
                }
            }
        });
        
        // 如果有任何命令需要等待用户点击，显示提示信息
        if (hasWaitForClickCommand) {
            this.elements.textBox.textContent = '点击继续';
            this.elements.nameBox.textContent = '系统';
            this.elements.nameBox.style.display = 'block';
            return true; // 阻塞性命令
        } else if (hasAnimationCommand) {
            // 如果有动画命令，也是阻塞性的
            return true;
        } else {
            // 非阻塞性命令，根据 shouldAutoNext 参数决定是否自动进入下一行
            if (shouldAutoNext) {
                setTimeout(() => {
                    this.nextLine();
                }, 100);
            }
            return false; // 非阻塞性命令
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
                // 等待用户点击或指定时间
                if (params.time) {
                    // 如果有 time 参数，等待指定时间后自动继续
                    return {
                        type: 'waitForTime',
                        duration: parseInt(params.time)
                    };
                } else {
                    // 否则等待用户点击
                    return {
                        type: 'waitForClick'
                    };
                }
            
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
            
            case '阻止':
            case 'lock':
                // 锁定鼠标点击（屏蔽非快进模式的点击事件）
                return {
                    type: 'clickLock'
                };
            
            case '解锁':
            case 'free':
                // 解除鼠标点击锁定
                return {
                    type: 'clickUnlock'
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
            case 'waitForTime':
                // 等待指定时间后自动继续
                setTimeout(() => {
                    this.nextLine();
                }, action.duration || 1000);
                break;
            case 'clickLock':
                // 锁定鼠标点击
                this.state.isClickLocked = true;
                console.log('[点击锁定] 已启用，非快进模式的点击将被屏蔽');
                break;
            case 'clickUnlock':
                // 解除鼠标点击锁定
                this.state.isClickLocked = false;
                console.log('[点击解锁] 已解除，恢复正常点击交互');
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
                this.fadeOut(action.duration || 1000, action.backgroundColor || 'black', () => {
                    // 淡出完成后自动进入下一行
                    setTimeout(() => {
                        this.nextLine();
                    }, 50);
                });
                break;
            case 'fadeIn':
                this.fadeIn(action.duration || 1000, action.backgroundColor || 'black');
                // 淡入完成后自动进入下一行
                setTimeout(() => {
                    this.nextLine();
                }, (action.duration || 1000) + 100);
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

        // 如果处于 Ctrl 快进模式，立即跳过所有转场动画
        if (this.state.fastForwardActive) {
            console.log('快进模式下跳过背景转场动画');
            this.removeAllChars();
            this.setBackground(newBgPath);
            
            // 直接同步执行后续逻辑，不等待动画结束
            this._resumeLineAfterTransition(currentLine, 0);
            return;
        }

        // 立即设置背景转场标志，屏蔽用户点击交互
        this.state.isBackgroundTransitioning = true;
        
        // 记录转场起始行号作为锚点，用于后续校验
        this.state.transitionStartLine = this.state.currentLine;
        console.log(`[转场锚点] 记录起始行号: ${this.state.transitionStartLine}`);
        
        // 在转场动画正式开始前，立即清除所有旧立绘，确保画面干净
        this.removeAllChars();

        // 立即清空当前的文本和姓名显示，防止转场过程中残留上一行的内容
        this.elements.textBox.textContent = '';
        this.elements.nameBox.textContent = '';
        this.elements.nameBox.style.display = 'none';

        if (type === 'fade') {
            // 原有的淡入淡出逻辑
            this.fadeOut(duration, 'black', () => {
                // 立绘已在转场开始时清除，此处无需再次调用
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
        // 如果处于 Ctrl 快进模式，立即跳过动画并同步执行状态更新
        if (this.state.fastForwardActive) {
            console.log('快进模式下跳过滑动转场动画');
            this.removeAllChars();
            this.setBackground(newBgPath);
            this._resumeLineAfterTransition(currentLine, 0);
            return;
        }

        // 立即设置背景转场标志，屏蔽用户点击交互
        this.state.isBackgroundTransitioning = true;
        
        // 记录转场起始行号作为锚点，用于后续校验
        this.state.transitionStartLine = this.state.currentLine;
        console.log(`[转场锚点-滑屏] 记录起始行号: ${this.state.transitionStartLine}`);
        
        // 在转场动画正式开始前，立即清除所有旧立绘，确保画面干净
        this.removeAllChars();

        const bgContainer = this.elements.backgroundContainer;
        
        // 预加载新背景图片
        const img = new Image();
        img.src = newBgPath;
        img.onload = () => {
            const newLayer = document.createElement('div');
            newLayer.className = 'slide-layer';
            newLayer.style.backgroundImage = `url('${newBgPath}')`;
            newLayer.style.backgroundColor = '#000'; // 黑色背景，用于信箱模式
            newLayer.style.backgroundSize = 'contain'; // 信箱模式：保持图片完整显示
            newLayer.style.backgroundPosition = 'center'; // 居中显示
            newLayer.style.backgroundRepeat = 'no-repeat'; // 防止重复
            
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
                // 立绘已在转场开始时清除，此处无需再次调用
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
        // 如果处于 Ctrl 快进模式，立即跳过动画并同步执行状态更新
        if (this.state.fastForwardActive) {
            console.log('快进模式下跳过扫描转场动画');
            this.removeAllChars();
            this.setBackground(newBgPath);
            this._resumeLineAfterTransition(currentLine, 0);
            return;
        }

        // 立即设置背景转场标志，屏蔽用户点击交互
        this.state.isBackgroundTransitioning = true;
        
        // 记录转场起始行号作为锚点，用于后续校验
        this.state.transitionStartLine = this.state.currentLine;
        console.log(`[转场锚点-扫描] 记录起始行号: ${this.state.transitionStartLine}`);
        
        // 在转场动画正式开始前，立即清除所有旧立绘，确保画面干净
        this.removeAllChars();

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
            newLayer.style.backgroundColor = '#000'; // 黑色背景，用于信箱模式
            newLayer.style.backgroundSize = 'contain'; // 信箱模式：保持图片完整显示
            newLayer.style.backgroundPosition = 'center'; // 居中显示
            newLayer.style.backgroundRepeat = 'no-repeat'; // 防止重复
            
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
                // 立绘已在转场开始时清除，此处无需再次调用
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
        // 如果处于 Ctrl 快进模式，立即跳过动画并同步执行状态更新
        if (this.state.fastForwardActive) {
            console.log('快进模式下跳过滑动转场动画');
            this.removeAllChars();
            this.setBackground(newBgPath);
            this._resumeLineAfterTransition(currentLine, 0);
            return;
        }

        const bgContainer = this.elements.backgroundContainer;
        
        // 预加载新背景图片，防止闪烁
        const img = new Image();
        img.src = newBgPath;
        img.onload = () => {
            // 创建新背景层
            const newLayer = document.createElement('div');
            newLayer.className = 'slide-layer';
            newLayer.style.backgroundImage = `url('${newBgPath}')`;
            newLayer.style.backgroundColor = '#000'; // 黑色背景，用于信箱模式
            newLayer.style.backgroundSize = 'contain'; // 信箱模式：保持图片完整显示
            newLayer.style.backgroundPosition = 'center'; // 居中显示
            newLayer.style.backgroundRepeat = 'no-repeat'; // 防止重复
            
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
            
            // 校验行号一致性，防止因用户快速点击导致的状态错乱
            const transitionStartLine = this.state.transitionStartLine;
            const currentActualLine = this.state.currentLine;
            
            if (transitionStartLine !== undefined && transitionStartLine !== currentActualLine) {
                console.warn(`[竞态检测] 转场起始行号(${transitionStartLine})与当前行号(${currentActualLine})不一致，放弃恢复旧行状态`);
                console.log('[竞态修复] 清除转场标志，由 nextLine 强制同步最新状态');
                
                // 清除转场标志，允许用户交互
                this.state.isBackgroundTransitioning = false;
                
                // 不清理锚点，让 nextLine 在下一次转场时覆盖
                return; // 直接返回，不执行任何恢复逻辑
            }
            
            console.log('[竞态校验] 行号一致，继续恢复转场前行状态');
            
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
            } else {
                // 如果当前行没有 chars 指令，但系统中有活跃立绘状态，需要重新渲染以保持立绘显示
                // 这是为了防止转场后立绘丢失的问题
                const activeCharIds = Object.keys(this.state.activeChars || {});
                if (activeCharIds.length > 0) {
                    console.log('当前行无立绘指令，但存在活跃立绘，重新渲染以保持显示');
                    // 重新构建 chars 指令字符串并渲染
                    const charInstructions = [];
                    activeCharIds.forEach(charId => {
                        // 查找是否有角色名称标识符映射到这个 charId
                        let roleName = null;
                        if (this.state.charNameMap) {
                            for (const [name, info] of Object.entries(this.state.charNameMap)) {
                                if (info.charId === charId) {
                                    roleName = name;
                                    break;
                                }
                            }
                        }
                        
                        // 构建指令字符串
                        if (roleName) {
                            charInstructions.push(`[${roleName} ${charId}]`);
                        } else {
                            charInstructions.push(`[${charId}]`);
                        }
                    });
                    
                    if (charInstructions.length > 0) {
                        const charsString = charInstructions.join('');
                        const originalTransitionState = this.state.isBackgroundTransitioning;
                        this.state.isBackgroundTransitioning = false; // 允许渐变效果
                        this.renderChars(charsString);
                        this.state.isBackgroundTransitioning = originalTransitionState;
                    }
                }
            }
            
            // 4. 处理音频与 BGM
            if (currentLine.audio) {
                this.playAudio(currentLine.audio);
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

            // 在所有渲染完成后，才清除背景转场标志，允许用户交互
            this.state.isBackgroundTransitioning = false;
            console.log('背景转场标志已清除，恢复用户交互');

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
            this.elements.novelTextBox.innerHTML = '';
        } else {
            this.elements.textBox.innerHTML = '';
        }
        
        // 先处理注音标签，再处理换行符，最后按[s]标签分割文本
        const rubyProcessedText = this.processRubyText(text);
        const processedText = this.processLineBreaks(rubyProcessedText);
        const segments = processedText.split(/\[s\]/i);
        
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
                // 处理 HTML 标签，确保不会在标签中间断开
                let charToAdd = text.charAt(i);
                    
                // 如果遇到<，需要找到对应的>
                if (charToAdd === '<') {
                    // 检查是否是 <ruby> 标签
                    if (text.substring(i, i + 6) === '<ruby>') {
                        // 找到对应的 </ruby> 标签
                        let rubyEnd = text.indexOf('</ruby>', i);
                        if (rubyEnd !== -1) {
                            // 添加整个 ruby 结构
                            targetBox.innerHTML += text.substring(i, rubyEnd + 7);
                            i = rubyEnd + 7;
                        } else {
                            // 如果没有找到，当作普通标签处理
                            let tagEnd = text.indexOf('>', i);
                            if (tagEnd !== -1) {
                                targetBox.innerHTML += text.substring(i, tagEnd + 1);
                                i = tagEnd + 1;
                            } else {
                                targetBox.innerHTML += charToAdd;
                                i++;
                            }
                        }
                    } else {
                        // 普通标签处理
                        let tagEnd = text.indexOf('>', i);
                        if (tagEnd !== -1) {
                            // 添加整个标签
                            targetBox.innerHTML += text.substring(i, tagEnd + 1);
                            i = tagEnd + 1;
                        } else {
                            // 如果没有找到>，当作普通字符处理
                            targetBox.innerHTML += charToAdd;
                            i++;
                        }
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
        // 先处理注音标签，再处理换行符
        let processedText = this.processRubyText(text);
        processedText = this.processLineBreaks(processedText);
        
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
                    // 检查是否是 <ruby> 标签
                    if (processedText.substring(i, i + 6) === '<ruby>') {
                        // 找到对应的 </ruby> 标签
                        let rubyEnd = processedText.indexOf('</ruby>', i);
                        if (rubyEnd !== -1) {
                            // 添加整个 ruby 结构
                            targetBox.innerHTML += processedText.substring(i, rubyEnd + 7);
                            i = rubyEnd + 7;
                        } else {
                            // 如果没有找到，当作普通标签处理
                            let tagEnd = processedText.indexOf('>', i);
                            if (tagEnd !== -1) {
                                targetBox.innerHTML += processedText.substring(i, tagEnd + 1);
                                i = tagEnd + 1;
                            } else {
                                targetBox.innerHTML += charToAdd;
                                i++;
                            }
                        }
                    } else {
                        // 普通标签处理
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
     * 处理注音标签（Ruby/Furigana）
     * 将 [汉字,拼音] 格式的注音标签转换为 <ruby>汉字<rt>拼音</rt></ruby>
     * @param {string} text - 原始文本
     * @returns {string} - 处理后的文本
     */
    processRubyText: function(text) {
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
    },
    
    /**
     * 推进到下一行对话
     * 处理打字机效果、文本完整显示、场景结束等逻辑
     */
    nextLine: function() {
        // 如果背景转场正在进行，强制重置转场状态
        // 这确保了用户快速点击推进剧情时，能够中断旧转场并同步最新状态
        if (this.state.isBackgroundTransitioning && !this.state.fastForwardActive) {
            console.warn('[竞态修复] 检测到转场期间用户推进剧情，强制重置转场状态');
            this.state.isBackgroundTransitioning = false;
            // 不清理 transitionStartLine，让下一次转场时覆盖
        }
        
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
                    // 先处理注音标签，再处理换行符
                    fullText = this.processRubyText(currentLine.text);
                    fullText = this.processLineBreaks(fullText);
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
        this.elements.backgroundContainer.style.backgroundColor = '#000'; // 黑色背景，用于信箱模式
        this.elements.backgroundContainer.style.backgroundSize = 'contain'; // 信箱模式：保持图片完整显示
        this.elements.backgroundContainer.style.backgroundPosition = 'center'; // 居中显示
        this.elements.backgroundContainer.style.backgroundRepeat = 'no-repeat'; // 防止重复
    },
    
    /**
     * 解析音频路径
     * 支持多种音频引用方式：
     * 1. 从 sceneData.bgm 中查找（BGM）
     * 2. 从 sceneData.audio 中查找（传统方式）
     * 3. 自动拼接 assets/audio/ 路径（零配置方式）
     * @param {string} audioKey - 音频键名或文件名（不含扩展名）
     * @returns {Object|null} - { path: string, isBgm: boolean } 或 null
     */
    resolveAudioPath: function(audioKey) {
        if (!audioKey || typeof audioKey !== 'string') {
            return null;
        }
        
        // 优先检查是否为BGM
        if (this.sceneData.bgm && this.sceneData.bgm[audioKey]) {
            return { path: this.sceneData.bgm[audioKey], isBgm: true };
        }
        
        // 检查是否在 sceneData.audio 中定义（传统方式）
        if (this.sceneData.audio && this.sceneData.audio[audioKey]) {
            return { path: this.sceneData.audio[audioKey], isBgm: false };
        }
        
        // 尝试从缓存中获取
        if (this.audioCache[audioKey]) {
            return { path: this.audioCache[audioKey], isBgm: false };
        }
        
        // 零配置模式：自动拼接 assets/audio/ 路径
        // 尝试常见的音频扩展名
        const extensions = ['.ogg', '.mp3', '.wav', '.m4a', '.aac'];
        const basePath = '../assets/audio/';
        
        for (const ext of extensions) {
            // 尝试原始文件名（保持大小写）
            const fullPath = basePath + audioKey + ext;
            
            // 将路径缓存起来，避免重复计算
            this.audioCache[audioKey] = fullPath;
            return { path: fullPath, isBgm: false };
        }
        
        // 如果都没找到，返回 null
        console.warn(`音频文件未找到: ${audioKey}`);
        return null;
    },
    
    /**
     * 解析视频路径
     * 支持多种视频引用方式：
     * 1. 从 sceneData.videos 中查找（传统方式）
     * 2. 自动拼接 assets/video/ 路径（零配置方式）
     * 3. 自动拼接 assets/video/ 路径（零配置方式）
     * @param {string} videoKey - 视频键名或文件名（不含扩展名）
     * @returns {string|null} - 视频路径或 null
     */
    resolveVideoPath: function(videoKey) {
        if (!videoKey || typeof videoKey !== 'string') {
            return null;
        }
        
        // 检查是否在 sceneData.videos 中定义（传统方式）
        if (this.sceneData.videos && this.sceneData.videos[videoKey]) {
            return this.sceneData.videos[videoKey];
        }
        
        // 尝试从缓存中获取
        if (this.videoCache[videoKey]) {
            return this.videoCache[videoKey];
        }
        
        // 零配置模式：自动拼接 assets/video/ 路径
        // 如果已经是完整路径，直接返回
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
    },
    
    /**
     * 播放音频
     * 根据音频类型（BGM/语音）选择对应的播放器，处理浏览器自动播放限制
     * @param {string} audioKey - 音频键名，从场景数据的bgm或audio中查找
     */
    playAudio: function(audioKey) {
        const audioInfo = this.resolveAudioPath(audioKey);
        
        if (!audioInfo) {
            console.log("音频文件路径不存在:", audioKey);
            return;
        }
        
        const audioPath = audioInfo.path;
        const isBgm = audioInfo.isBgm;
        
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
                            // 使用系统模块保存的音量值
                            if (typeof systemModule !== 'undefined') {
                                this.elements.bgmPlayer.volume = systemModule.currentVolume;
                            } else {
                                this.elements.bgmPlayer.volume = 1;
                            }
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
                        // 使用系统模块保存的音量值
                        if (typeof systemModule !== 'undefined') {
                            this.elements.voicePlayer.volume = systemModule.currentVolume;
                        } else {
                            this.elements.voicePlayer.volume = 1;
                        }
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
            // 使用系统模块保存的音量值
            if (typeof systemModule !== 'undefined') {
                bgmPlayer.volume = systemModule.currentVolume;
            } else {
                bgmPlayer.volume = 1;
            }
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
                // 使用系统模块保存的音量值
                if (typeof systemModule !== 'undefined') {
                    bgmPlayer.volume = systemModule.currentVolume;
                } else {
                    bgmPlayer.volume = 1;
                }
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
     * 播放视频（使用HTML原生video标签播放）
     * @param {string} videoKey - 视频键名，从场景数据的videos中查找或直接使用文件名
     * @returns {boolean} - 如果开始播放视频返回true（阻塞），否则返回false
     */
    playVideo: function(videoKey) {
        console.log('[Video] playVideo 被调用, videoKey:', videoKey);
        
        if (!this.elements.videoPlayer) {
            console.error('[Video] videoPlayer元素不存在');
            return false;
        }
        
        this.playVideoNative(videoKey);
        
        // 视频开始播放，阻塞当前行
        return true;
    },
    
    /**
     * HTML环境：使用原生video标签播放视频
     * @param {string} videoKey - 视频键名或文件名
     */
    playVideoNative: function(videoKey) {
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
        
        // 停止当前 BGM 播放
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
        
        // 监听视频加载错误
        this.elements.mainVideo.onerror = function(e) {
            console.error('[Video] 视频加载错误:', e);
            console.error('[Video] 视频错误代码:', self.elements.mainVideo.error ? self.elements.mainVideo.error.code : 'N/A');
            console.error('[Video] 视频错误信息:', self.elements.mainVideo.error ? self.elements.mainVideo.error.message : 'N/A');
            console.error('[Video] 视频当前src:', self.elements.mainVideo.currentSrc);
            console.error('[Video] 视频网络状态:', self.elements.mainVideo.networkState);
            // 加载失败，跳过视频
            self.skipVideo();
        };
        
        // 添加视频播放结束事件监听器
        const onVideoEnded = function() {
            self.elements.mainVideo.removeEventListener('ended', onVideoEnded);
            self.elements.mainVideo.removeEventListener('error', self.elements.mainVideo.onerror);
            self.elements.videoPlayer.style.display = 'none';
            self.nextLine();
        };
        this.elements.mainVideo.addEventListener('ended', onVideoEnded);
        
        // 尝试播放视频
        this.elements.mainVideo.play().catch(e => {
            console.error('[Video] 播放失败:', e.name, e.message);
            self.skipVideo();
        });
        
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
        
        // 同步调试日志状态（虽然只是隐藏，但为了保持一致性）
        this.syncDebugCharsState();
        
        // 执行淡出效果，完成后自动进入下一行
        this.fadeOut(duration || 1500, bgColor || 'black', () => {
            setTimeout(() => {
                this.nextLine();
            }, 50);
        });
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
        
        // 同步调试日志状态
        this.syncDebugCharsState();
        
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
        
        // 通知宿主层：游戏进度已更新
        this.notifyStorageOperation('UPDATE', 'gameProgress', 'localStorage');
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
        
        // 始终更新场景标记和时间戳(即使已存在)
        progressData.sceneMarkers[sceneId] = {
            visited: 1,
            lastAccessTime: Date.now()
        };
        
        // 更新全局时间戳
        progressData.timestamp = Date.now();
        
        // 保存到localStorage
        localStorage.setItem('gameProgress', JSON.stringify(progressData));
        console.log(`场景标识符已保存: ${sceneId}, 时间: ${new Date().toLocaleTimeString()}`);
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
     * 保存当前游戏状态的完整快照
     * 用于从存档页精确返回时恢复状态
     */
    saveStateSnapshot: function() {
        const snapshot = {
            // 基本信息
            pageUrl: window.location.href,
            pagePath: window.location.pathname,
            
            // 剧情进度
            currentLine: this.state.currentLine,
            
            // 持久化状态(由systemModule维护)
            lastActiveBgm: (typeof systemModule !== 'undefined') ? systemModule.lastActiveBgm : null,
            lastActiveBg: (typeof systemModule !== 'undefined') ? systemModule.lastActiveBg : null,
            lastActiveChars: (typeof systemModule !== 'undefined') ? systemModule.lastActiveChars : null,
            
            // 时间戳
            timestamp: Date.now()
        };
        
        sessionStorage.setItem('gameStateSnapshot', JSON.stringify(snapshot));
        console.log('[State Snapshot] Saved:', snapshot);
    },
    
    /**
     * 从sessionStorage加载状态快照
     * @returns {Object|null} - 状态快照对象,不存在则返回null
     */
    loadStateSnapshot: function() {
        try {
            const snapshotStr = sessionStorage.getItem('gameStateSnapshot');
            if (snapshotStr) {
                return JSON.parse(snapshotStr);
            }
        } catch (e) {
            console.error('[State Snapshot] Failed to load:', e);
        }
        return null;
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
        const fadeKeywords = ['渐入', 'fadeIn', '渐出', 'fadeOut', '左渐出', 'lfadeOut', '右渐出', 'rfadeOut', '左渐入', 'lfadeIn', '右渐入', 'rfadeIn'];
        // 动作指令关键词
        const actionKeywords = ['后退', 'retreat', '前进', 'forward', '吓一跳', 'scare', '发抖', 'shake', '持续发抖', 'cshake', '结束发抖', 'sshake', '点头', 'nod'];
        
        // 检查是否匹配任何关键词
        if (positionKeywords.includes(word)) return true;
        if (verticalKeywords.includes(word)) return true;
        if (layerKeywords.includes(word)) return true;
        if (animationKeywords.includes(word)) return true;
        if (removeKeywords.includes(word)) return true;
        if (fadeKeywords.includes(word)) return true;
        if (actionKeywords.includes(word)) return true;
        
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
        console.log(`[updateChar] charId=${charId}, modifiers="${modifiers}", roleName=${roleName}`);
        
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
        let isSameRoleDifferentImage = false; // 标记是否为同标识符切换不同图片

        if (roleName && this.state.charNameMap[roleName]) {
            // 角色名称标识符存在，复用旧立绘的 DOM 节点
            const oldInfo = this.state.charNameMap[roleName];
            charEl = document.getElementById(`char-${oldInfo.charId}`);
            
            // 检测是否为同标识符但不同图片资源的切换
            if (oldInfo.charId !== charId) {
                // 检查旧图片与新图片是否不同
                if (charEl && charEl.src !== path) {
                    isSameRoleDifferentImage = true;
                }
                
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
            // 如果是同标识符切换不同图片，执行双缓冲交叉淡入淡出过渡
            if (isSameRoleDifferentImage) {
                // 【优化】创建临时新元素实现真正的双缓冲交叉淡入淡出
                const newCharEl = document.createElement('img');
                newCharEl.id = `char-${charId}-temp`;
                newCharEl.className = 'character-img';
                newCharEl.src = path; // 先设置src，让浏览器开始加载
                
                // 复制当前位置和样式
                newCharEl.style.left = charEl.style.left;
                newCharEl.style.bottom = charEl.style.bottom;
                newCharEl.style.zIndex = charEl.style.zIndex;
                newCharEl.style.height = charEl.style.height;
                newCharEl.style.transform = charEl.style.transform;
                newCharEl.style.opacity = '0'; // 初始透明
                
                // 插入到容器中（在旧元素后面）
                this.elements.characterContainer.appendChild(newCharEl);
                
                // 处理图片加载完成后的交叉淡入淡出
                const handleCrossFade = () => {
                    // 解析新指令的修饰词
                    const newProps = this.parseCharModifiers(modifiers);
                    
                    // 属性继承逻辑
                    const hasExplicitLeft = modifiers.match(/(左|右|中|left|right|middle|x:)/i);
                    const hasExplicitBottom = modifiers.match(/(上|下|up|down|y:)/i);
                    const hasExplicitLayer = modifiers.match(/(前|后|front|back)/i);
                    const hasExplicitScale = modifiers.match(/\d+%$/);
                    
                    // 应用样式属性（带继承逻辑）
                    newCharEl.style.left = hasExplicitLeft ? newProps.left : (charEl.style.left || newProps.left);
                    newCharEl.style.bottom = hasExplicitBottom ? newProps.bottom : (charEl.style.bottom || newProps.bottom);
                    newCharEl.style.zIndex = hasExplicitLayer ? newProps.zIndex : (charEl.style.zIndex || newProps.zIndex);
                    
                    // 缩放处理
                    if (hasExplicitScale) {
                        newCharEl.style.height = `${newProps.scale * 100}%`;
                    } else if (charEl.style.height) {
                        newCharEl.style.height = charEl.style.height;
                    } else {
                        newCharEl.style.height = `${newProps.scale * 100}%`;
                    }
                    
                    newCharEl.style.transform = 'translateX(-50%)';
                    newCharEl.style.visibility = 'visible';
                    
                    // 强制重绘以确保样式应用
                    void newCharEl.offsetHeight;
                    
                    // 开始交叉淡入淡出（0.15秒）
                    charEl.style.transition = 'opacity 0.15s ease-out';
                    newCharEl.style.transition = 'opacity 0.15s ease-in';
                    
                    charEl.style.opacity = '0';
                    newCharEl.style.opacity = '1';
                    
                    // 淡出完成后移除旧元素，重命名新元素
                    setTimeout(() => {
                        charEl.remove();
                        newCharEl.id = `char-${charId}`; // 恢复正式ID
                        
                        // 处理动作指令（如果存在）
                        if (newProps.actionType) {
                            this.applyCharAction(charId, newCharEl, newProps.actionType, newProps);
                        }
                        
                        // 过渡完成后恢复默认过渡效果
                        setTimeout(() => {
                            newCharEl.style.transition = 'all 0.5s ease';
                        }, 50);
                        
                        // 更新最终应用的属性到状态记录
                        const finalProps = {
                            left: hasExplicitLeft ? newProps.left : (charEl.style.left || newProps.left),
                            bottom: hasExplicitBottom ? newProps.bottom : (charEl.style.bottom || newProps.bottom),
                            zIndex: hasExplicitLayer ? newProps.zIndex : (charEl.style.zIndex || newProps.zIndex),
                            scale: hasExplicitScale ? newProps.scale : (charEl.style.height ? parseFloat(charEl.style.height) / 100 : newProps.scale)
                        };
                        this.state.activeChars[charId] = { path, ...finalProps };
                    }, 150);
                };
                
                // 检查图片是否已缓存
                if (newCharEl.complete && newCharEl.naturalWidth > 0) {
                    // 图片已缓存，直接执行
                    handleCrossFade();
                } else {
                    // 等待图片加载
                    newCharEl.onload = handleCrossFade;
                    newCharEl.onerror = () => {
                        console.error(`[updateChar] 图片加载失败: ${path}`);
                        newCharEl.remove();
                        // 回退到原逻辑
                        charEl.src = path;
                    };
                }
                
                // 重要：对于同标识符切换，我们已经在异步回调中处理了所有逻辑
                // 因此直接返回，跳过后续的样式应用和透明度处理
                return;
            } else {
                // 非同标识符切换，直接更新图片源
                charEl.src = path;
            }
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
            // 特殊处理：排除方向渐入/渐出指令中的"左"和"右"
            const hasExplicitLeft = modifiers.match(/(左|右|中|left|right|middle|x:)/i) && 
                                   !modifiers.match(/(左渐出|右渐出|lfadeOut|rfadeOut|左渐入|右渐入|lfadeIn|rfadeIn)/i);
            const hasExplicitBottom = modifiers.match(/(上|下|up|down|y:)/i);
            const hasExplicitLayer = modifiers.match(/(前|后|front|back)/i);
            const hasExplicitScale = modifiers.match(/\d+%$/);

            console.log(`[updateChar] Inheritance check for ${charId}: hasExplicitLeft=${hasExplicitLeft}, currentLeft=${currentLeft}, props.left before=${props.left}`);

            if (!hasExplicitLeft && currentLeft) props.left = currentLeft;
            if (!hasExplicitBottom && currentBottom) props.bottom = currentBottom;
            if (!hasExplicitLayer && currentZIndex) props.zIndex = parseInt(currentZIndex);
            if (!hasExplicitScale && currentHeight) {
                const oldScale = parseFloat(currentHeight) / 100;
                if (!isNaN(oldScale)) props.scale = oldScale;
            }
            
            console.log(`[updateChar] After inheritance: props.left=${props.left}, props.bottom=${props.bottom}`);
        }
        
        // 防重复渲染机制：检查立绘状态是否真的需要更新
        // 如果不是新立绘，且所有属性都与当前状态相同，则跳过更新以避免闪烁
        if (!isNewChar && !isSameRoleDifferentImage) {
            const currentState = this.state.activeChars[charId];
            if (currentState) {
                // 比较关键属性是否相同
                const isSameState = (
                    currentState.path === path &&
                    currentState.left === props.left &&
                    currentState.bottom === props.bottom &&
                    currentState.zIndex === props.zIndex &&
                    Math.abs((currentState.scale || 1) - props.scale) < 0.01 && // 允许小的浮点数误差
                    !props.actionType && // 如果有动作指令，总是需要更新
                    !props.fadeType // 如果有渐入/渐出指令，总是需要更新
                );
                
                if (isSameState) {
                    console.log(`[updateChar] 立绘 ${charId} 状态未改变，跳过重复渲染`);
                    // 状态未改变，跳过更新以避免闪烁
                    return;
                }
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
        } else if (props.fadeType === 'leftFadeOut' || props.fadeType === 'rightFadeOut') {
            // 方向渐出指令：需要先应用位置继承，再执行渐出动画
            console.log(`[updateChar] Directional fade out for ${charId}, props.left=${props.left}, current left=${charEl.style.left}`);
            
            // 应用样式（位置继承已在上面完成）
            charEl.style.left = props.left;
            charEl.style.bottom = props.bottom;
            charEl.style.zIndex = props.zIndex;
            charEl.style.visibility = 'visible';
            
            // 应用缩放
            charEl.style.height = `${props.scale * 100}%`;
            
            // 应用水平对齐变换
            charEl.style.transform = 'translateX(-50%)';
            
            // 确定渐出方向
            const direction = props.fadeType === 'leftFadeOut' ? 'left' : 'right';
            
            console.log(`[updateChar] Applying ${direction} fade out, final left=${charEl.style.left}`);
            
            // 执行方向渐出动画
            this.fadeOutChar(charId, charEl, direction);
            return; // 直接返回，不继续执行后续逻辑
        } else if (props.fadeType === 'leftFadeIn' || props.fadeType === 'rightFadeIn') {
            // 方向渐入指令：需要先应用位置继承，再执行渐入动画
            console.log(`[updateChar] Directional fade in for ${charId}, props.left=${props.left}, current left=${charEl.style.left}`);
            
            // 应用样式（位置继承已在上面完成）
            charEl.style.left = props.left;
            charEl.style.bottom = props.bottom;
            charEl.style.zIndex = props.zIndex;
            charEl.style.visibility = 'visible';
            
            // 应用缩放
            charEl.style.height = `${props.scale * 100}%`;
            
            // 应用水平对齐变换
            charEl.style.transform = 'translateX(-50%)';
            
            // 确定渐入方向
            const direction = props.fadeType === 'leftFadeIn' ? 'left' : 'right';
            
            console.log(`[updateChar] Applying ${direction} fade in, final left=${charEl.style.left}`);
            
            // 执行方向渐入动画
            this.fadeInChar(charId, charEl, direction);
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
        // 先设置停止标记，通知正在执行的回调停止
        if (charEl) {
            charEl.dataset.shakeStopped = 'true';
        }
        // 清除持续发抖状态
        if (this.state.shakingChars && this.state.shakingChars[charId]) {
            clearTimeout(this.state.shakingChars[charId]);
            delete this.state.shakingChars[charId];
        }
        // 移除 DOM 元素
        if (charEl) {
            charEl.remove();
        }
        // 清除连续动作队列
        if (this.state.charActionQueues && this.state.charActionQueues[charId]) {
            clearTimeout(this.state.charActionQueues[charId].timeoutId);
            delete this.state.charActionQueues[charId];
        }
        delete this.state.activeChars[charId];
        
        // 更新调试日志中的立绘状态
        this.syncDebugCharsState();
    },

    /**
     * 渐出指定立绘
     * @param {string} charId - 立绘ID
     * @param {HTMLElement} charEl - 可选，立绘DOM元素，如果不提供则自动获取
     * @param {string} direction - 可选，渐出方向 ('left' 或 'right')，默认为普通渐出
     */
    fadeOutChar: function(charId, charEl = null, direction = null) {
        // 如果未提供 DOM 元素，则自动获取
        if (!charEl) {
            charEl = document.getElementById(`char-${charId}`);
        }
        
        if (!charEl) {
            console.warn(`立绘 ${charId} 不存在，无法执行渐出`);
            return;
        }
        
        // 先设置停止标记，通知正在执行的回调停止
        charEl.dataset.shakeStopped = 'true';
        // 清除持续发抖状态
        if (this.state.shakingChars && this.state.shakingChars[charId]) {
            clearTimeout(this.state.shakingChars[charId]);
            delete this.state.shakingChars[charId];
        }
        // 清除连续动作队列
        if (this.state.charActionQueues && this.state.charActionQueues[charId]) {
            clearTimeout(this.state.charActionQueues[charId].timeoutId);
            delete this.state.charActionQueues[charId];
        }
        
        // 根据方向设置不同的动画效果
        if (direction === 'left') {
            // 左渐出：向左移动10%的同时渐出
            charEl.style.transition = 'opacity 0.8s ease-in-out, transform 0.8s ease-in-out';
            charEl.style.opacity = '0';
            // 在现有transform基础上增加向左移动10%
            const currentTransform = charEl.style.transform || 'translateX(-50%)';
            charEl.style.transform = `${currentTransform} translateX(-10%)`;
        } else if (direction === 'right') {
            // 右渐出：向右移动10%的同时渐出
            charEl.style.transition = 'opacity 0.8s ease-in-out, transform 0.8s ease-in-out';
            charEl.style.opacity = '0';
            // 在现有transform基础上增加向右移动10%
            const currentTransform = charEl.style.transform || 'translateX(-50%)';
            charEl.style.transform = `${currentTransform} translateX(10%)`;
        } else {
            // 普通渐出：只改变透明度
            charEl.style.transition = 'opacity 0.8s ease-in-out';
            charEl.style.opacity = '0';
        }
        
        // 动画结束后移除元素
        setTimeout(() => {
            // 再次检查元素是否还存在（可能已被其他操作移除）
            const existingEl = document.getElementById(`char-${charId}`);
            if (existingEl) {
                existingEl.remove();
            }
            delete this.state.activeChars[charId];
            
            // 更新调试日志中的立绘状态
            this.syncDebugCharsState();
        }, 800); // 与 transition 时长一致
    },

    /**
     * 渐入指定立绘（支持方向）
     * @param {string} charId - 立绘ID
     * @param {HTMLElement} charEl - 可选，立绘DOM元素，如果不提供则自动获取
     * @param {string} direction - 可选，渐入方向 ('left' 或 'right')，默认为普通渐入
     */
    fadeInChar: function(charId, charEl = null, direction = null) {
        // 如果未提供 DOM 元素，则自动获取
        if (!charEl) {
            charEl = document.getElementById(`char-${charId}`);
        }
        
        if (!charEl) {
            console.warn(`立绘 ${charId} 不存在，无法执行渐入`);
            return;
        }
        
        // 根据方向设置不同的动画效果
        if (direction === 'left') {
            // 左渐入：从左侧10%的位置向右移动到当前位置并渐入
            // 初始状态：透明 + 向左偏移10%
            charEl.style.opacity = '0';
            const currentTransform = charEl.style.transform || 'translateX(-50%)';
            charEl.style.transform = `${currentTransform} translateX(-10%)`;
            
            // 强制重绘以确保初始状态生效
            void charEl.offsetHeight;
            
            // 开始动画：渐变到不透明 + 移回原位
            charEl.style.transition = 'opacity 0.8s ease-in-out, transform 0.8s ease-in-out';
            charEl.style.opacity = '1';
            charEl.style.transform = currentTransform;
        } else if (direction === 'right') {
            // 右渐入：从右侧10%的位置向左移动到当前位置并渐入
            // 初始状态：透明 + 向右偏移10%
            charEl.style.opacity = '0';
            const currentTransform = charEl.style.transform || 'translateX(-50%)';
            charEl.style.transform = `${currentTransform} translateX(10%)`;
            
            // 强制重绘以确保初始状态生效
            void charEl.offsetHeight;
            
            // 开始动画：渐变到不透明 + 移回原位
            charEl.style.transition = 'opacity 0.8s ease-in-out, transform 0.8s ease-in-out';
            charEl.style.opacity = '1';
            charEl.style.transform = currentTransform;
        } else {
            // 普通渐入：只改变透明度
            charEl.style.opacity = '0';
            // 强制重绘以确保透明度变化生效
            void charEl.offsetHeight;
            charEl.style.transition = 'opacity 0.8s ease-in-out';
            charEl.style.opacity = '1';
        }
        
        // 动画结束后更新状态
        setTimeout(() => {
            // 恢复默认过渡效果
            charEl.style.transition = 'all 0.5s ease';
            
            // 更新调试日志中的立绘状态
            this.syncDebugCharsState();
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
        
        // 延迟同步调试状态（等待渐出动画完成）
        setTimeout(() => {
            this.syncDebugCharsState();
        }, 850); // 略大于 fadeOutChar 的 800ms
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
        
        // 更新调试日志中的立绘状态（此时 activeChars 已为空）
        this.syncDebugCharsState();
    },

    /**
     * 同步调试日志中的立绘状态
     * 根据当前 activeChars 和 charNameMap 重建 lastActiveChars 字符串
     * 在立绘移除、清除等操作后调用，确保 F1 调试面板显示正确的状态
     */
    syncDebugCharsState: function() {
        if (typeof systemModule === 'undefined') {
            return; // systemModule 未加载
        }
        
        const activeCharIds = Object.keys(this.state.activeChars);
        
        if (activeCharIds.length === 0) {
            // 没有活跃立绘，清空 lastActiveChars
            systemModule.lastActiveChars = null;
        } else {
            // 重建 chars 指令字符串
            // 优先使用 charNameMap 中的角色标识符，如果没有则使用 charId
            const charInstructions = [];
            
            activeCharIds.forEach(charId => {
                // 查找是否有角色名称标识符映射到这个 charId
                let roleName = null;
                for (const [name, info] of Object.entries(this.state.charNameMap || {})) {
                    if (info.charId === charId) {
                        roleName = name;
                        break;
                    }
                }
                
                // 构建指令字符串
                if (roleName) {
                    // 如果有角色名称标识符，使用它
                    charInstructions.push(`[${roleName} ${charId}]`);
                } else {
                    // 否则直接使用 charId
                    charInstructions.push(`[${charId}]`);
                }
            });
            
            systemModule.lastActiveChars = charInstructions.join('');
        }
        
        // 直接更新调试面板 DOM，而不是调用 updateDebugInfo()
        // 因为 updateDebugInfo() 会基于当前行的 chars 字段重新设置 lastActiveChars，导致覆盖
        if (systemModule.debugVisible && systemModule.debugPanel) {
            const debugContent = document.getElementById('debug-content');
            if (debugContent) {
                // 获取当前场景文件名
                const currentPage = window.location.pathname.split('/').pop() || 'unknown.html';
                const currentIndex = this.state.currentLine;
                
                let info = `<div style="color: #FFFF00; margin-bottom: 5px;">${currentPage}</div>`;
                info += `<div style="margin-bottom: 3px;">Index: ${currentIndex}</div>`;
                
                // BGM 信息
                if (systemModule.lastActiveBgm) {
                    info += `<div style="margin-bottom: 3px;">BGM: ${systemModule.lastActiveBgm}</div>`;
                } else {
                    info += `<div style="margin-bottom: 3px; color: #888;">BGM: None</div>`;
                }
                
                // 背景图片信息
                if (systemModule.lastActiveBg) {
                    info += `<div style="margin-bottom: 3px;">BG: ${systemModule.lastActiveBg}</div>`;
                } else {
                    info += `<div style="margin-bottom: 3px; color: #888;">BG: None</div>`;
                }
                
                // 立绘信息
                if (systemModule.lastActiveChars) {
                    const charsList = systemModule.parseCharsInfo(systemModule.lastActiveChars);
                    info += `<div style="margin-bottom: 3px;">Chars:</div>`;
                    charsList.forEach(char => {
                        info += `<div style="margin-left: 15px; margin-bottom: 2px;">${char}</div>`;
                    });
                } else {
                    info += `<div style="margin-bottom: 3px; color: #888;">Chars: None</div>`;
                }
                
                debugContent.innerHTML = info;
            }
        }
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
            case 'retreat':
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
            case 'nod':
                this.applyNodAction(charEl, props);
                break;
        }
    },

    /**
     * 应用“后退”动作
     * Y轴向上偏移 +10%，缩放比例减小 -10%，层级强制变为“后”
     */
    applyRetreatAction: function(charEl, props) {
        // 从 DOM 元素读取当前实际状态，而不是从 props 中读取
        // 这样可以确保连续调用时的累积效果
        const currentBottomStr = charEl.style.bottom || '0%';
        const currentBottom = parseFloat(currentBottomStr) || 0;
        const newBottom = currentBottom + 10;
        charEl.style.bottom = `${newBottom}%`;
        
        // 从 DOM 读取当前缩放比例
        const currentHeightStr = charEl.style.height || '100%';
        const currentScale = parseFloat(currentHeightStr) / 100 || 1;
        const newScale = Math.max(0.1, currentScale - 0.1);
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
        // 从 DOM 元素读取当前实际状态，而不是从 props 中读取
        // 这样可以确保连续调用时的累积效果
        const currentBottomStr = charEl.style.bottom || '0%';
        const currentBottom = parseFloat(currentBottomStr) || 0;
        const newBottom = currentBottom - 10;
        charEl.style.bottom = `${newBottom}%`;
        
        // 从 DOM 读取当前缩放比例
        const currentHeightStr = charEl.style.height || '100%';
        const currentScale = parseFloat(currentHeightStr) / 100 || 1;
        const newScale = Math.min(2.0, currentScale + 0.1);
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
     * 应用“点头”动作
     * Y轴向上移动2%，再向下移动4%（到初始位置下方2%），最后回到原位
     * 只执行一次完整的“上-下-回”序列
     */
    applyNodAction: function(charEl, props) {
        // 从 DOM 读取当前 bottom 值作为基准位置
        const currentBottomStr = charEl.style.bottom || '0%';
        const baseBottom = parseFloat(currentBottomStr) || 0;
        
        // 保存原始的 transition 设置
        const originalTransition = charEl.style.transition;
        
        // 定义动画阶段：0=上移2%, 1=下移4%, 2=回到原位
        let step = 0;
        const maxSteps = 3;
        
        const animate = () => {
            if (step >= maxSteps) {
                // 动画结束，恢复到基准位置并恢复原始 transition
                charEl.style.bottom = `${baseBottom}%`;
                charEl.style.transition = originalTransition;
                return;
            }
            
            // 设置过渡效果
            charEl.style.transition = 'bottom 0.15s ease-in-out';
            
            if (step === 0) {
                // 第一步：向上移动 2%
                charEl.style.bottom = `${baseBottom + 2}%`;
            } else if (step === 1) {
                // 第二步：向下移动 4%（相对于第一步的位置，即基准位置下方 2%）
                charEl.style.bottom = `${baseBottom - 2}%`;
            } else if (step === 2) {
                // 第三步：回到基准位置
                charEl.style.bottom = `${baseBottom}%`;
            }
            
            step++;
            setTimeout(animate, 150); // 每150ms执行下一步
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
        const charId = charEl.id.replace('char-', '');
        
        console.log(`[持续发抖] 启动 char-${charId}, isContinuous=${isContinuous}, 当前位置: ${currentLeft}`);
        
        // 如果是持续发抖，先停止之前的定时器
        if (isContinuous && this.state.shakingChars) {
            if (this.state.shakingChars[charId]) {
                console.log(`[持续发抖] 清除旧的定时器`);
                clearTimeout(this.state.shakingChars[charId]);
                delete this.state.shakingChars[charId];
            }
        }
        
        let step = 0;
        const maxSteps = isContinuous ? Infinity : 6; // 3次循环 x 2步 = 6步
        
        const animate = () => {
            // 检查是否已被外部停止（通过 DOM 元素上的标记）
            if (isContinuous && charEl.dataset.shakeStopped === 'true') {
                console.log(`[持续发抖] char-${charId} 检测到停止标记，退出动画`);
                // 已被停止，恢复原位并退出
                charEl.style.left = currentLeft;
                delete charEl.dataset.shakeStopped; // 清理标记
                return;
            }
            
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
     * 停止"持续发抖"动作
     */
    stopShakeAction: function(charId) {
        console.log(`[停止发抖] 尝试停止 char-${charId}`);
        if (this.state.shakingChars && this.state.shakingChars[charId]) {
            console.log(`[停止发抖] 清除定时器，设置停止标记`);
            clearTimeout(this.state.shakingChars[charId]);
            delete this.state.shakingChars[charId];
                
            // 恢复立绘到正常位置
            const charEl = document.getElementById(`char-${charId}`);
            if (charEl && this.state.activeChars[charId]) {
                const props = this.state.activeChars[charId];
                charEl.style.left = props.left;
                // 设置停止标记
                charEl.dataset.shakeStopped = 'true';
                console.log(`[停止发抖] 已设置停止标记，当前位置: ${charEl.style.left}`);
            }
        } else {
            console.log(`[停止发抖] char-${charId} 没有活跃的定时器`);
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
        console.log(`[CharParser] Parsing modifiers: "${mods}"`);
        
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
        console.log(`[CharParser] Modifier tokens: [${modArray.join(', ')}]`);
    
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
            '结束发抖': 'sshake', 'sshake': 'sshake',
            '点头': 'nod', 'nod': 'nod'
        };
    
        const fadeMap = {
            '渐入': 'fadeIn', 'fadeIn': 'fadeIn',
            '渐出': 'fadeOut', 'fadeOut': 'fadeOut',
            '左渐出': 'leftFadeOut', 'lfadeOut': 'leftFadeOut',
            '右渐出': 'rightFadeOut', 'rfadeOut': 'rightFadeOut',
            '左渐入': 'leftFadeIn', 'lfadeIn': 'leftFadeIn',
            '右渐入': 'rightFadeIn', 'rfadeIn': 'rightFadeIn'
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
                        console.log(`[CharParser] Detected precise X coordinate: x:${preciseX}%`);
                    } else {
                        console.warn(`[CharParser] Invalid X coordinate format: ${mod}`);
                    }
                } else {
                    console.warn(`[CharParser] Invalid X coordinate format (missing %): ${mod}`);
                }
            }
            // 检测 y: 格式
            if (mod.startsWith('y:')) {
                const value = mod.substring(2);
                if (value.endsWith('%')) {
                    const percentValue = parseFloat(value.slice(0, -1));
                    if (!isNaN(percentValue)) {
                        preciseY = percentValue;
                        console.log(`[CharParser] Detected precise Y coordinate: y:${preciseY}%`);
                    } else {
                        console.warn(`[CharParser] Invalid Y coordinate format: ${mod}`);
                    }
                } else {
                    console.warn(`[CharParser] Invalid Y coordinate format (missing %): ${mod}`);
                }
            }
        }
    
        // 第二步：如果没有精确X坐标，则解析水平位置关键词
        if (preciseX === null) {
            let positionKeywordFound = false;
            for (const mod of modArray) {
                if (positionMap.hasOwnProperty(mod)) {
                    if (positionKeywordFound) {
                        console.warn(`[CharParser] Conflict: Horizontal position '${mod}' ignored. First match retained.`);
                    } else {
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
                        console.log(`[CharParser] Horizontal position set: '${mod}' -> ${left}`);
                        positionKeywordFound = true;
                    }
                    break; // 取第一个匹配的位置
                }
            }
        } else {
            // 如果有精确X坐标，计算left值（以50%为中心点）
            left = `calc(50% + ${preciseX}%)`;
            
            // 检查是否有水平位置关键词被忽略
            const ignoredPositions = [];
            for (const mod of modArray) {
                if (positionMap.hasOwnProperty(mod)) {
                    ignoredPositions.push(mod);
                }
            }
            if (ignoredPositions.length > 0) {
                console.log(`[CharParser] Precise X coordinate overrides horizontal keywords: [${ignoredPositions.join(', ')}] ignored.`);
            }
        }
    
        // 第三步：如果没有精确Y坐标，则解析垂直位置关键词
        if (preciseY === null) {
            let verticalKeywordFound = false;
            for (const mod of modArray) {
                if (verticalMap.hasOwnProperty(mod)) {
                    if (verticalKeywordFound) {
                        console.warn(`[CharParser] Conflict: Vertical position '${mod}' ignored. First match retained.`);
                    } else {
                        const normalized = verticalMap[mod];
                        switch(normalized) {
                            case 'down': bottom = '-25%'; break;
                            case 'downm': bottom = '-50%'; break;
                            case 'downd': bottom = '-65%'; break;
                            case 'up': bottom = '25%'; break;
                            case 'upm': bottom = '50%'; break;
                            case 'upu': bottom = '65%'; break;
                        }
                        console.log(`[CharParser] Vertical position set: '${mod}' -> ${bottom}`);
                        verticalKeywordFound = true;
                    }
                    break; // 取第一个匹配的垂直位置
                }
            }
        } else {
            // 如果有精确Y坐标，直接使用（正值向上，负值向下）
            bottom = `${preciseY}%`;
            
            // 检查是否有垂直位置关键词被忽略
            const ignoredVerticals = [];
            for (const mod of modArray) {
                if (verticalMap.hasOwnProperty(mod)) {
                    ignoredVerticals.push(mod);
                }
            }
            if (ignoredVerticals.length > 0) {
                console.log(`[CharParser] Precise Y coordinate overrides vertical keywords: [${ignoredVerticals.join(', ')}] ignored.`);
            }
        }
    
        // 第四步：提取层级关键词（取第一个匹配的）
        let layerKeywordFound = false;
        for (const mod of modArray) {
            if (layerMap.hasOwnProperty(mod)) {
                if (layerKeywordFound) {
                    console.warn(`[CharParser] Conflict: Layer keyword '${mod}' ignored. First match retained.`);
                } else {
                    const normalized = layerMap[mod];
                    if (normalized === 'front') zIndexOffset = 1;
                    if (normalized === 'back') zIndexOffset = -1;
                    console.log(`[CharParser] Layer set: '${mod}' -> zIndex offset ${zIndexOffset}`);
                    layerKeywordFound = true;
                }
                break; // 取第一个匹配的层级
            }
        }
    
        // 第五步：提取“瞬”指令关键词（取第一个匹配的）
        let instantKeywordFound = false;
        for (const mod of modArray) {
            if (animationMap.hasOwnProperty(mod)) {
                if (instantKeywordFound) {
                    console.warn(`[CharParser] Conflict: Animation keyword '${mod}' ignored. First match retained.`);
                } else {
                    instant = true;
                    console.log(`[CharParser] Instant mode enabled by: '${mod}'`);
                    instantKeywordFound = true;
                }
                break; // 取第一个匹配的动画指令
            }
        }
    
        // 第六步：提取百分比缩放关键词
        let scaleKeywordFound = false;
        for (const mod of modArray) {
            // 检查是否以 % 结尾，但不是 x: 或 y: 格式
            if (mod.endsWith('%') && !mod.startsWith('x:') && !mod.startsWith('y:')) {
                const percentValue = parseFloat(mod.slice(0, -1));
                if (!isNaN(percentValue)) {
                    if (scaleKeywordFound) {
                        console.warn(`[CharParser] Conflict: Scale modifier '${mod}' ignored. First match retained.`);
                    } else {
                        // 计算公式：最终缩放比例 = 1 + (输入百分比数值 / 100)
                        // 0 或 0% 仍保持 100% 大小
                        scale = 1 + (percentValue / 100);
                        // 确保缩放比例为正数
                        if (scale <= 0) {
                            console.warn(`[CharParser] Invalid scale value ${percentValue}%, reset to 100%`);
                            scale = 1;
                        } else {
                            console.log(`[CharParser] Scale set: ${percentValue}% -> final scale ${(scale * 100).toFixed(0)}%`);
                        }
                        scaleKeywordFound = true;
                    }
                    break; // 只使用第一个百分比值
                } else {
                    console.warn(`[CharParser] Invalid scale format: ${mod}`);
                }
            }
        }
    
        // 第七步：提取动作类型指令（取第一个匹配的）
        let hasAction = false;
        let actionKeywordFound = false;
        for (const mod of modArray) {
            if (actionMap.hasOwnProperty(mod)) {
                if (actionKeywordFound) {
                    console.warn(`[CharParser] Conflict: Action keyword '${mod}' ignored. First match retained.`);
                } else {
                    actionType = actionMap[mod];
                    hasAction = true;
                    console.log(`[CharParser] Action detected: '${mod}' -> ${actionType}`);
                    actionKeywordFound = true;
                }
                break; // 取第一个匹配的动作指令
            }
        }
    
        // 第八步：提取渐入/渐出指令（取第一个匹配的）
        let fadeType = null;
        let fadeKeywordFound = false;
        for (const mod of modArray) {
            if (fadeMap.hasOwnProperty(mod)) {
                if (fadeKeywordFound) {
                    console.warn(`[CharParser] Conflict: Fade keyword '${mod}' ignored. First match retained.`);
                } else {
                    fadeType = fadeMap[mod];
                    console.log(`[CharParser] Fade effect detected: '${mod}' -> ${fadeType}`);
                    fadeKeywordFound = true;
                }
                break; // 取第一个匹配的渐入/渐出指令
            }
        }
    
        // 如果存在动作指令，自动屏蔽“瞬”指令
        if (hasAction && instant) {
            console.log(`[CharParser] Action '${actionType}' executed. 'instant' flag ignored due to action priority.`);
            instant = false;
        }
    
        // 检测未识别的修饰词
        const allKnownKeywords = [
            ...Object.keys(positionMap),
            ...Object.keys(verticalMap),
            ...Object.keys(layerMap),
            ...Object.keys(animationMap),
            ...Object.keys(actionMap),
            ...Object.keys(fadeMap)
        ];
        
        for (const mod of modArray) {
            // 跳过已知的关键词
            if (allKnownKeywords.includes(mod)) continue;
            // 跳过精确坐标
            if (mod.startsWith('x:') || mod.startsWith('y:')) continue;
            // 跳过百分比缩放
            if (mod.endsWith('%')) continue;
            // 跳过角色ID（最后一个部分，在 updateChar 中处理）
            
            // 如果都不是，可能是未知关键词
            console.warn(`[CharParser] Warning: Unknown modifier '${mod}' in '[${mods} lhX]'. Ignored.`);
        }
    
        console.log(`[CharParser] Final result: left=${left}, bottom=${bottom}, zIndex=${10 + zIndexOffset}, scale=${(scale * 100).toFixed(0)}%, instant=${instant}, action=${actionType || 'none'}, fade=${fadeType || 'none'}`);
    
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

/**
 * 快速存档管理器 - 集成到游戏引擎中
 */
const QuickSaveManager = {
    // 防抖和冷却相关变量
    _isCooldown: false,          // 是否在冷却中
    _hasTriggeredOnPress: false, // 本次按键是否已触发保存
    _cooldownDuration: 1000,     // 冷却时间（毫秒）
    
    /**
     * 快速保存 - 创建新存档
     */
    quickSave: function() {
        // 检查是否在冷却中
        if (this._isCooldown) {
            console.log('[Quick Save] On cooldown, skipping save');
            return;
        }
        
        // 获取当前游戏状态
        const snapshot = sessionStorage.getItem('gameStateSnapshot');
        if (!snapshot) {
            console.warn('[Quick Save] No game state to save');
            this.showMessage('无法保存：没有游戏状态', 'error');
            return;
        }
        
        const gameState = JSON.parse(snapshot);
        
        // 构建存档数据
        const saveData = {
            saveName: this.getDefaultSaveName(),
            sceneFile: this.extractSceneFileName(gameState.pagePath),
            lineIndex: gameState.currentLine,
            previewText: this.getCurrentPreviewText(),
            snapshot: gameState
        };
        
        // 添加到存档列表
        const archives = this.loadArchives();
        saveData.id = Date.now().toString();
        saveData.timestamp = Date.now();
        saveData.formattedTime = this.formatTimestamp(saveData.timestamp);
        
        // 添加到数组开头（最新的在前）
        archives.unshift(saveData);
        
        try {
            localStorage.setItem('galgame_archives', JSON.stringify(archives));
            console.log('[Quick Save] Created new archive');
            
            // 通知宿主层：存档已创建
            this.notifyStorageOperation('CREATE', 'galgame_archives', 'localStorage');
            
            this.showMessage('已创建新存档', 'success');
        } catch (e) {
            console.error('[Quick Save] Failed to save:', e);
            this.showMessage('快速保存失败', 'error');
        }
    },
    
    /**
     * 打开存档管理页面
     */
    openArchivePage: function() {
        window.location.href = '../html/archive.html';
    },
    
    /**
     * 加载所有存档
     */
    loadArchives: function() {
        try {
            const data = localStorage.getItem('galgame_archives');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('[Quick Save] Failed to load archives:', e);
            return [];
        }
    },
    
    /**
     * 获取默认存档名称
     */
    getDefaultSaveName: function() {
        const archives = this.loadArchives();
        return `存档 ${archives.length + 1}`;
    },
    
    /**
     * 提取场景文件名
     */
    extractSceneFileName: function(pagePath) {
        const parts = pagePath.split('/');
        return parts[parts.length - 1] || 'unknown.html';
    },
    
    /**
     * 获取当前文本预览
     */
    getCurrentPreviewText: function() {
        try {
            const textBox = document.getElementById('text-box');
            if (textBox && textBox.textContent) {
                const text = textBox.textContent.trim();
                return text.length > 50 ? text.substring(0, 50) + '...' : text;
            }
        } catch (e) {
            console.warn('[Quick Save] Could not get preview text:', e);
        }
        return '暂无文本预览';
    },
    
    /**
     * 格式化时间戳
     */
    formatTimestamp: function(timestamp) {
        if (!timestamp) return '未知时间';
        
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    },
    
    /**
     * 显示消息提示
     */
    showMessage: function(message, type) {
        // 移除旧消息
        const oldMessage = document.querySelector('.quick-save-message');
        if (oldMessage) {
            oldMessage.remove();
        }
        
        const statusDiv = document.createElement('div');
        statusDiv.className = `quick-save-message`;
        statusDiv.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 30px;
            border-radius: 25px;
            font-size: 14px;
            font-weight: bold;
            z-index: 3000;
            animation: slideUp 0.3s ease;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            background: ${type === 'success' ? 'rgba(76, 175, 80, 0.9)' : 'rgba(244, 67, 54, 0.9)'};
            color: #fff;
            border: 2px solid ${type === 'success' ? '#4CAF50' : '#f44336'};
        `;
        statusDiv.textContent = message;
        
        document.body.appendChild(statusDiv);
        
        setTimeout(() => {
            statusDiv.style.opacity = '0';
            statusDiv.style.transition = 'opacity 0.3s ease';
            setTimeout(() => statusDiv.remove(), 300);
        }, 2000);
    },
    
    /**
     * 启动冷却计时器 - 从松开按键时开始计时
     */
    _startCooldown: function() {
        this._isCooldown = true;
        console.log('[Quick Save] Cooldown started');
        
        setTimeout(() => {
            this._isCooldown = false;
            console.log('[Quick Save] Cooldown ended');
        }, this._cooldownDuration);
    },
    
    /**
     * 通知宿主层存储操作（通过 WebView2/通用桥接）
     * @param {string} operation - 操作类型：'CREATE', 'DELETE', 'UPDATE'
     * @param {string} key - localStorage 的键名
     * @param {string} storageType - 存储类型：'localStorage' 或 'sessionStorage'
     */
    notifyStorageOperation: function(operation, key, storageType) {
        try {
            if (typeof window.shiori !== 'undefined' && 
                window.shiori.api && 
                typeof window.shiori.api.onStorageOperation === 'function') {
                const data = {
                    operation: operation,
                    key: key,
                    storageType: storageType,
                    timestamp: new Date().toISOString()
                };
                window.shiori.api.onStorageOperation(JSON.stringify(data));
                console.log(`[Storage Monitor] Notified Host: ${operation} ${key} (${storageType})`);
            }
        } catch (e) {
            console.warn('[Storage Monitor] Failed to notify Host:', e);
        }
    }
};

/**
 * 通知宿主层存储操作（通过 WebView2/通用桥接）
 * @param {string} operation - 操作类型：'CREATE', 'DELETE', 'UPDATE'
 * @param {string} key - localStorage 的键名
 * @param {string} storageType - 存储类型：'localStorage' 或 'sessionStorage'
 */
gameEngine.notifyStorageOperation = function(operation, key, storageType) {
    try {
        if (typeof window.shiori !== 'undefined' && 
            window.shiori.api && 
            typeof window.shiori.api.onStorageOperation === 'function') {
            const data = {
                operation: operation,
                key: key,
                storageType: storageType,
                timestamp: new Date().toISOString()
            };
            window.shiori.api.onStorageOperation(JSON.stringify(data));
            console.log(`[Storage Monitor] Notified Host: ${operation} ${key} (${storageType})`);
        }
    } catch (e) {
        console.warn('[Storage Monitor] Failed to notify Host:', e);
    }
};

// 添加CSS动画
if (!document.getElementById('quick-save-styles')) {
    const style = document.createElement('style');
    style.id = 'quick-save-styles';
    style.textContent = `
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateX(-50%) translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        }
    `;
    document.head.appendChild(style);
}
