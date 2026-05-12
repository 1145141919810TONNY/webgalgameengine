/**
 * Shiori 引擎系统功能模块
 * 提供音量控制、系统设置等全局功能
 */

const systemModule = {
    // 当前音量值 (0.0 - 1.0)
    currentVolume: 1.0,
    // 音量提示框DOM元素
    volumeOverlay: null,
    // 音量提示框隐藏定时器
    volumeHideTimer: null,
    // 调试日志面板DOM元素
    debugPanel: null,
    // 调试日志是否显示
    debugVisible: false,
    // 状态持久化变量 - 追踪当前生效的状态
    lastActiveBgm: null,      // 最后激活的 BGM ID
    lastActiveBg: null,       // 最后激活的背景图片 ID
    lastActiveChars: null,    // 最后激活的立绘指令字符串
    // 音量存储键名
    VOLUME_STORAGE_KEY: 'galgame_volume',
    // 调试模式存储键名
    DEBUG_MODE_STORAGE_KEY: 'galgame_debug_mode',
    
    /**
     * 初始化系统模块
     */
    init: function() {
        this.loadVolume();  // 从 localStorage 加载音量设置
        this.loadDebugMode();  // 从 localStorage 加载调试模式状态
        this.createVolumeOverlay();
        this.createDebugPanel();
        this.bindVolumeControls();
        this.bindDebugToggle();
        this.bindFullscreenDetection();
        
        // 如果之前调试模式是开启的，自动显示面板
        if (this.debugVisible && this.debugPanel) {
            this.debugPanel.style.display = 'block';
            // 立即更新一次调试信息
            if (typeof gameEngine !== 'undefined' && gameEngine.sceneData) {
                this.updateDebugInfo();
            }
        }
        
        // 延迟应用音量到所有音频元素，确保引擎已初始化
        setTimeout(() => {
            this.applyVolumeToAllAudio();
            console.log('[System] Applied saved volume to all audio elements:', Math.round(this.currentVolume * 100) + '%');
        }, 100);
        
        // 检测初始全屏状态
        this.updateFullscreenClass();
        
        console.log("系统模块已初始化，当前音量:", Math.round(this.currentVolume * 100) + "%");
        console.log("调试模式状态:", this.debugVisible ? "开启" : "关闭");
    },
    
    /**
     * 从 localStorage 加载音量设置
     */
    loadVolume: function() {
        try {
            const savedVolume = localStorage.getItem(this.VOLUME_STORAGE_KEY);
            if (savedVolume !== null) {
                const volume = parseFloat(savedVolume);
                // 验证音量值的有效性
                if (!isNaN(volume) && volume >= 0.0 && volume <= 1.0) {
                    this.currentVolume = volume;
                    console.log('[Volume] Loaded from localStorage:', Math.round(volume * 100) + '%');
                    return;
                }
            }
        } catch (e) {
            console.warn('[Volume] Failed to load volume from localStorage:', e);
        }
        // 如果没有保存的音量或加载失败，使用默认值 1.0
        this.currentVolume = 1.0;
        console.log('[Volume] Using default volume: 100%');
    },
    
    /**
     * 保存音量设置到 localStorage
     */
    saveVolume: function() {
        try {
            localStorage.setItem(this.VOLUME_STORAGE_KEY, this.currentVolume.toString());
            console.log('[Volume] Saved to localStorage:', Math.round(this.currentVolume * 100) + '%');
            
            // 通知 Python 层：音量设置已更新
            this.notifyPythonStorageOperation('UPDATE', this.VOLUME_STORAGE_KEY, 'localStorage');
        } catch (e) {
            console.warn('[Volume] Failed to save volume to localStorage:', e);
        }
    },
    
    /**
     * 从 localStorage 加载调试模式状态
     */
    loadDebugMode: function() {
        try {
            const savedDebugMode = localStorage.getItem(this.DEBUG_MODE_STORAGE_KEY);
            if (savedDebugMode !== null) {
                this.debugVisible = savedDebugMode === 'true';
                console.log('[Debug Mode] Loaded from localStorage:', this.debugVisible ? 'ON' : 'OFF');
                // 如果之前是开启状态，需要在面板创建后显示
                return;
            }
        } catch (e) {
            console.warn('[Debug Mode] Failed to load from localStorage:', e);
        }
        // 如果没有保存的状态或加载失败，使用默认值 false
        this.debugVisible = false;
        console.log('[Debug Mode] Using default state: OFF');
    },
    
    /**
     * 保存调试模式状态到 localStorage
     */
    saveDebugMode: function() {
        try {
            localStorage.setItem(this.DEBUG_MODE_STORAGE_KEY, this.debugVisible.toString());
            console.log('[Debug Mode] Saved to localStorage:', this.debugVisible ? 'ON' : 'OFF');
            
            // 通知 Python 层：调试模式已更新
            this.notifyPythonStorageOperation('UPDATE', this.DEBUG_MODE_STORAGE_KEY, 'localStorage');
        } catch (e) {
            console.warn('[Debug Mode] Failed to save to localStorage:', e);
        }
    },
    
    /**
     * 创建音量提示框DOM元素
     */
    createVolumeOverlay: function() {
        const overlay = document.createElement('div');
        overlay.id = 'volume-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 50px;
            left: 50%;
            transform: translateX(-50%);
            background-color: rgba(0, 0, 0, 0.8);
            color: #FFD700;
            padding: 15px 30px;
            border-radius: 10px;
            font-size: 24px;
            font-weight: bold;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
            user-select: none;
            border: 2px solid #FFD700;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        `;
        overlay.textContent = '100%';
        document.body.appendChild(overlay);
        this.volumeOverlay = overlay;
    },
    
    /**
     * 创建调试日志面板DOM元素
     */
    createDebugPanel: function() {
        const panel = document.createElement('div');
        panel.id = 'debug-panel';
        panel.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background-color: rgba(0, 0, 0, 0.7);
            color: #00FF00;
            padding: 15px;
            border-radius: 5px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.6;
            z-index: 9999;
            min-width: 300px;
            max-width: 500px;
            display: none;
            user-select: text;
            cursor: default;
            border: 1px solid #00FF00;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
        `;
        panel.innerHTML = '<div style="font-weight: bold; margin-bottom: 10px; color: #FFFF00;">开发者调试日志（F1）</div><div id="debug-content"></div>';
        document.body.appendChild(panel);
        this.debugPanel = panel;
    },
    
    /**
     * 绑定音量控制键盘事件
     */
    bindVolumeControls: function() {
        document.addEventListener('keydown', (e) => {
            // 如果选项菜单激活，不处理音量控制
            if (gameEngine.state.choicesActive) {
                return;
            }
            
            let volumeChanged = false;
            
            // 增加音量: + 键、= 键、上箭头
            if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.changeVolume(0.01); // 增加 1%
                volumeChanged = true;
            }
            // 减少音量: - 键、下箭头
            else if (e.key === '-' || e.key === 'ArrowDown') {
                e.preventDefault();
                this.changeVolume(-0.01); // 减少 1%
                volumeChanged = true;
            }
            
            if (volumeChanged) {
                this.applyVolumeToAllAudio();
                this.showVolumeOverlay();
                this.saveVolume();  // 保存到 localStorage
            }
        });
    },
    
    /**
     * 绑定调试日志开关快捷键 (F1)
     */
    bindDebugToggle: function() {
        document.addEventListener('keydown', (e) => {
            // F1 键切换调试面板显示/隐藏
            if (e.key === 'F1') {
                e.preventDefault();
                this.toggleDebugPanel();
            }
        });
    },
    
    /**
     * 改变音量值
     * @param {number} delta - 音量变化量 (-1.0 到 1.0)
     */
    changeVolume: function(delta) {
        this.currentVolume += delta;
        
        // 限制音量范围在 0.0 到 1.0 之间
        if (this.currentVolume > 1.0) {
            this.currentVolume = 1.0;
        } else if (this.currentVolume < 0.0) {
            this.currentVolume = 0.0;
        }
        
        // 四舍五入到两位小数，避免浮点数精度问题
        this.currentVolume = Math.round(this.currentVolume * 100) / 100;
    },
    
    /**
     * 将音量应用到所有音频元素
     */
    applyVolumeToAllAudio: function() {
        // 应用音量到 BGM 播放器
        if (gameEngine.elements.bgmPlayer) {
            gameEngine.elements.bgmPlayer.volume = this.currentVolume;
        }
        
        // 应用音量到音效播放器
        if (gameEngine.elements.sePlayer) {
            gameEngine.elements.sePlayer.volume = this.currentVolume;
        }
        
        // 应用音量到语音播放器
        if (gameEngine.elements.voicePlayer) {
            gameEngine.elements.voicePlayer.volume = this.currentVolume;
        }
        
        // 应用音量到页面上所有的 audio 元素（包括动态创建的）
        const allAudioElements = document.querySelectorAll('audio');
        allAudioElements.forEach(audio => {
            audio.volume = this.currentVolume;
        });
    },
    
    /**
     * 显示音量提示框
     */
    showVolumeOverlay: function() {
        // 清除之前的隐藏定时器
        if (this.volumeHideTimer) {
            clearTimeout(this.volumeHideTimer);
        }
        
        // 更新提示框文本
        const percentage = Math.round(this.currentVolume * 100);
        this.volumeOverlay.textContent = `${percentage}%`;
        
        // 显示提示框
        this.volumeOverlay.style.opacity = '1';
        
        // 1.5秒后自动隐藏
        this.volumeHideTimer = setTimeout(() => {
            this.volumeOverlay.style.opacity = '0';
        }, 1500);
    },
    
    /**
     * 获取当前音量值
     * @returns {number} 当前音量 (0.0 - 1.0)
     */
    getVolume: function() {
        return this.currentVolume;
    },
    
    /**
     * 设置音量值
     * @param {number} volume - 音量值 (0.0 - 1.0)
     */
    setVolume: function(volume) {
        if (volume >= 0.0 && volume <= 1.0) {
            this.currentVolume = volume;
            this.applyVolumeToAllAudio();
            this.showVolumeOverlay();
            this.saveVolume();  // 保存到 localStorage
        }
    },
    
    /**
     * 切换调试日志面板显示/隐藏
     */
    toggleDebugPanel: function() {
        this.debugVisible = !this.debugVisible;
        if (this.debugVisible) {
            this.debugPanel.style.display = 'block';
            // 立即更新一次调试信息
            this.updateDebugInfo();
        } else {
            this.debugPanel.style.display = 'none';
        }
        this.saveDebugMode();  // 保存到 localStorage
    },
    
    /**
     * 解析BGM指令，提取实际的BGM名称
     * @param {string} bgmInstruction - BGM指令字符串，如 "bgm wait bgm21" 或 "bgm21"
     * @returns {string|null} - 实际的BGM名称，如果是停止指令则返回null
     */
    parseBgmInstruction: function(bgmInstruction) {
        if (!bgmInstruction || typeof bgmInstruction !== 'string') {
            return null;
        }
        
        // 处理停止指令
        if (bgmInstruction === 'bgm stop' || bgmInstruction === '') {
            return null;
        }
        
        // 处理淡出切换指令
        if (bgmInstruction.startsWith('bgm wait ')) {
            return bgmInstruction.substring('bgm wait '.length).trim();
        }
        
        // 其他情况，直接返回（可能是普通的BGM名称）
        return bgmInstruction;
    },
    
    /**
     * 更新调试日志信息
     * 由 engine.js 在剧情推进时调用
     */
    updateDebugInfo: function() {
        // 获取当前行数据
        const currentIndex = gameEngine.state.currentLine;
        const currentLineData = gameEngine.sceneData?.story?.[currentIndex];
        
        console.log('[Debug Log] Current index:', currentIndex);
        console.log('[Debug Log] Current line data keys:', currentLineData ? Object.keys(currentLineData) : 'null');
        
        if (!currentLineData) {
            return;
        }
        
        // ===== 状态持久化逻辑：始终更新缓存的状态变量 =====
        
        // 1. 更新 BGM 状态
        if (currentLineData.bgm !== undefined) {
            // 使用辅助函数解析BGM指令，提取实际的BGM名称
            this.lastActiveBgm = this.parseBgmInstruction(currentLineData.bgm);
        }
        // 如果当前行没有 bgm 字段，保持 lastActiveBgm 不变
        
        // 2. 更新背景状态
        if (currentLineData.background !== undefined && currentLineData.background !== null) {
            let bgInfo = currentLineData.background;
            console.log('[Debug Log] Raw background:', bgInfo);
            // 解析转场指令，提取目标背景 ID
            if (typeof bgInfo === 'string') {
                if (bgInfo.startsWith('trans ') || bgInfo.startsWith('转场 ')) {
                    bgInfo = bgInfo.split(' ')[1];
                    console.log('[Debug Log] Parsed trans, extracted bg:', bgInfo);
                } else if (bgInfo.startsWith('slideL ') || bgInfo.startsWith('左滑 ')) {
                    bgInfo = bgInfo.split(' ')[1];
                    console.log('[Debug Log] Parsed slideL, extracted bg:', bgInfo);
                } else if (bgInfo.startsWith('slideR ') || bgInfo.startsWith('右滑 ')) {
                    bgInfo = bgInfo.split(' ')[1];
                    console.log('[Debug Log] Parsed slideR, extracted bg:', bgInfo);
                } else if (bgInfo.startsWith('scanL ') || bgInfo.startsWith('左转场 ')) {
                    bgInfo = bgInfo.split(' ')[1];
                    console.log('[Debug Log] Parsed scanL, extracted bg:', bgInfo);
                } else if (bgInfo.startsWith('scanR ') || bgInfo.startsWith('右转场 ')) {
                    bgInfo = bgInfo.split(' ')[1];
                    console.log('[Debug Log] Parsed scanR, extracted bg:', bgInfo);
                }
            }
            this.lastActiveBg = bgInfo;
            console.log('[Debug Log] Updated lastActiveBg to:', this.lastActiveBg);
        } else {
            console.log('[Debug Log] No background in this line, keeping:', this.lastActiveBg);
        }
        // 如果当前行没有 background 字段，保持 lastActiveBg 不变
        
        // 3. 更新立绘状态
        if (currentLineData.chars !== undefined && currentLineData.chars !== null && currentLineData.chars !== '') {
            console.log('[Debug Log] Updating chars:', currentLineData.chars);
            this.lastActiveChars = currentLineData.chars;
        } else {
            console.log('[Debug Log] No chars in this line, keeping:', this.lastActiveChars);
        }
        // 如果当前行没有 chars 字段，保持 lastActiveChars 不变
        
        // ===== 如果面板可见，则更新显示 =====
        if (!this.debugVisible || !this.debugPanel) {
            return;
        }
        
        const debugContent = document.getElementById('debug-content');
        if (!debugContent) {
            return;
        }
        
        // 获取当前场景文件名
        const currentPage = window.location.pathname.split('/').pop() || 'unknown.html';
        
        // ===== 构建调试信息显示 =====
        
        let info = `<div style="color: #FFFF00; margin-bottom: 5px;">${currentPage}</div>`;
        
        // 获取当前剧情对象的行号范围（currentLineData 已在函数开头定义）
        const lineRange = currentLineData?.__lineRange;
        
        // 显示 Index 和行号范围
        if (lineRange) {
            info += `<div style="margin-bottom: 3px;">Index: ${currentIndex} {${lineRange.startLine}~${lineRange.endLine}}</div>`;
        } else {
            info += `<div style="margin-bottom: 3px;">Index: ${currentIndex}</div>`;
        }
        
        // BGM 信息（始终显示）
        if (this.lastActiveBgm) {
            info += `<div style="margin-bottom: 3px;">BGM: ${this.lastActiveBgm}</div>`;
        } else {
            info += `<div style="margin-bottom: 3px; color: #888;">BGM: None</div>`;
        }
        
        // 背景图片信息（始终显示）
        console.log('[Debug Log] Displaying BG:', this.lastActiveBg);
        if (this.lastActiveBg) {
            info += `<div style="margin-bottom: 3px;">BG: ${this.lastActiveBg}</div>`;
        } else {
            info += `<div style="margin-bottom: 3px; color: #888;">BG: None</div>`;
        }
        
        // 立绘信息（始终显示）
        console.log('[Debug Log] Displaying chars:', this.lastActiveChars);
        if (this.lastActiveChars) {
            const charsList = this.parseCharsInfo(this.lastActiveChars);
            info += `<div style="margin-bottom: 3px;">Chars:</div>`;
            charsList.forEach(char => {
                info += `<div style="margin-left: 15px; margin-bottom: 2px;">${char}</div>`;
            });
        } else {
            info += `<div style="margin-bottom: 3px; color: #888;">Chars: None</div>`;
        }
        
        debugContent.innerHTML = info;
    },
    
    /**
     * 解析立绘信息字符串为数组
     * @param {string} charsStr - 立绘指令字符串，如 "[角色B 中 lh3][角色A lh1]"
     * @returns {Array<string>} 立绘指令数组
     */
    parseCharsInfo: function(charsStr) {
        if (!charsStr || typeof charsStr !== 'string') {
            return [];
        }
        
        // 使用正则表达式匹配所有 [...] 格式的指令
        const matches = charsStr.match(/\[[^\]]+\]/g);
        return matches || [];
    },
    
    /**
     * 重置调试状态（切换场景时调用）
     */
    resetDebugState: function() {
        this.lastActiveBgm = null;
        this.lastActiveBg = null;
        this.lastActiveChars = null;
    },
    
    /**
     * 通知 Python 层存储操作（通过 QWebChannel）
     * @param {string} operation - 操作类型：'CREATE', 'DELETE', 'UPDATE'
     * @param {string} key - localStorage 的键名
     * @param {string} storageType - 存储类型：'localStorage' 或 'sessionStorage'
     */
    notifyPythonStorageOperation: function(operation, key, storageType) {
        try {
            // 检查 ShioriAPI 是否可用
            if (typeof ShioriAPI !== 'undefined' && ShioriAPI.onStorageOperation) {
                const data = {
                    operation: operation,
                    key: key,
                    storageType: storageType,
                    timestamp: new Date().toISOString()
                };
                ShioriAPI.onStorageOperation(JSON.stringify(data));
                console.log(`[Storage Monitor] Notified Python: ${operation} ${key} (${storageType})`);
            }
        } catch (e) {
            console.warn('[Storage Monitor] Failed to notify Python:', e);
        }
    },
    
    /**
     * 绑定全屏状态检测事件
     */
    bindFullscreenDetection: function() {
        // 监听全屏状态变化事件
        const fullscreenEvents = [
            'fullscreenchange',
            'webkitfullscreenchange',
            'mozfullscreenchange',
            'MSFullscreenChange'
        ];
        
        fullscreenEvents.forEach(event => {
            document.addEventListener(event, () => {
                console.log('[System] Fullscreen change event detected');
                this.updateFullscreenClass();
            });
        });
        
        // 监听窗口大小变化，检测最大化状态
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                console.log('[System] Resize event, checking states...');
                // 先更新全屏状态，再检测最大化
                this.updateFullscreenClass();
                this.checkMaximizedState();
            }, 50); // 缩短延迟时间，提高响应速度
        });
        
        // 监听窗口获得焦点事件（从其他应用切换回来时）
        window.addEventListener('focus', () => {
            console.log('[System] Window focused, rechecking states...');
            setTimeout(() => {
                this.updateFullscreenClass();
                this.checkMaximizedState();
            }, 100);
        });
        
        // 页面加载完成后立即检测一次状态
        window.addEventListener('load', () => {
            console.log('[System] Page loaded, initial state check...');
            setTimeout(() => {
                this.updateFullscreenClass();
                this.checkMaximizedState();
            }, 200);
        });
    },
    
    /**
     * 检测窗口是否处于最大化状态
     */
    checkMaximizedState: function() {
        // 如果处于全屏状态，不检测最大化
        const isFullscreen = document.fullscreenElement || 
                            document.webkitFullscreenElement || 
                            document.mozFullScreenElement || 
                            document.msFullscreenElement;
        
        if (isFullscreen) {
            document.body.classList.remove('is-maximized');
            console.log('[System] In fullscreen, skip maximized detection');
            return;
        }
        
        // 通过比较窗口尺寸和屏幕可用尺寸来判断是否最大化
        // 允许一定的误差范围（5px）
        const widthDiff = Math.abs(window.innerWidth - window.screen.availWidth);
        const heightDiff = Math.abs(window.innerHeight - window.screen.availHeight);
        
        const isMaximized = (widthDiff <= 5 && heightDiff <= 50);
        
        if (isMaximized) {
            document.body.classList.add('is-maximized');
            console.log(`[System] Window maximized detected (${window.innerWidth}x${window.innerHeight})`);
        } else {
            document.body.classList.remove('is-maximized');
            console.log(`[System] Window not maximized (${window.innerWidth}x${window.innerHeight}, avail: ${window.screen.availWidth}x${window.screen.availHeight})`);
        }
    },
    
    /**
     * 更新全屏状态的 CSS 类
     */
    updateFullscreenClass: function() {
        const isFullscreen = document.fullscreenElement || 
                            document.webkitFullscreenElement || 
                            document.mozFullScreenElement || 
                            document.msFullscreenElement;
        
        if (isFullscreen) {
            document.body.classList.add('is-fullscreen');
            document.body.classList.remove('is-maximized');
            console.log('[Fullscreen] Entered fullscreen mode');
        } else {
            document.body.classList.remove('is-fullscreen');
            // 退出全屏后重新检测最大化状态
            this.checkMaximizedState();
            console.log('[Fullscreen] Exited fullscreen mode');
        }
    }
};

// DOM 加载完成后自动初始化
document.addEventListener('DOMContentLoaded', function() {
    systemModule.init();
});
