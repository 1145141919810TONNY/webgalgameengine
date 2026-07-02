/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * Shiori 引擎系统功能模块
 * 提供音量控制、系统设置等全局功能
 */

const systemModule = {
    // 当前音量值 (0.0 - 1.0) - 主音量
    currentVolume: 1.0,
    // 各通道音量 (0.0 - 1.0)
    bgmVolume: 1.0,
    seVolume: 1.0,
    voiceVolume: 1.0,
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
    // 系统设置窗口相关
    systemSettingsOverlay: null,
    systemSettingsVisible: false,
    // 音频测试相关
    testAudioPlayers: {},     // 存储测试音频播放器 { type: audioElement }
    // 音频暂停状态（打开系统设置时暂停）
    audioPausedState: null,   // { bgmPaused: bool, bgmCurrentTime: number }
    // 音量存储键名
    VOLUME_STORAGE_KEY: 'galgame_volume',
    BGM_VOLUME_STORAGE_KEY: 'galgame_bgm_volume',
    SE_VOLUME_STORAGE_KEY: 'galgame_se_volume',
    VOICE_VOLUME_STORAGE_KEY: 'galgame_voice_volume',
    // 调试模式存储键名
    DEBUG_MODE_STORAGE_KEY: 'galgame_debug_mode',
    // 人物音频进度条相关
    voiceProgressBar: null,       // 进度条元素
    voiceProgressContainer: null, // 进度条容器
    voiceProgressUpdateTimer: null, // 进度更新定时器
    // AUTO模式相关
    autoModeEnabled: false,       // AUTO模式是否开启
    autoDelaySeconds: 3,          // AUTO延迟时间（秒），默认3秒
    autoShowCountdown: true,      // 是否显示倒计时
    autoCountdownTimer: null,     // 倒计时定时器
    autoCountdownElement: null,   // 倒计时显示元素
    autoCountdownRemaining: 0,    // 剩余倒计时秒数
    autoWaitForAudio: false,      // 是否正在等待音频播放完成
    autoWaitForTyping: false,     // 是否正在等待打字机完成
    // AUTO设置存储键名
    AUTO_DELAY_KEY: 'galgame_auto_delay',
    AUTO_SHOW_COUNTDOWN_KEY: 'galgame_auto_show_countdown',
    
    /**
     * 初始化系统模块
     */
    init: function() {
        this.loadVolume();  // 从 localStorage 加载音量设置
        this.loadDebugMode();  // 从 localStorage 加载调试模式状态
        this.loadAutoSettings();  // 从 localStorage 加载 AUTO 设置
        console.log('[AUTO] init called, autoDelaySeconds:', this.autoDelaySeconds);
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
            this.applyBgmVolume();
            this.applySeVolume();
            this.applyVoiceVolume();
            console.log('[System] Applied saved volume to all audio elements:');
            console.log('  Main:', Math.round(this.currentVolume * 100) + '%');
            console.log('  BGM:', Math.round(this.bgmVolume * 100) + '%');
            console.log('  SE:', Math.round(this.seVolume * 100) + '%');
            console.log('  Voice:', Math.round(this.voiceVolume * 100) + '%');
        }, 100);
        
        // 检测初始全屏状态
        this.updateFullscreenClass();
        
        // 初始化人物音频进度条
        this.createVoiceProgressBar();
        this.bindVoicePlayerEvents();
        
        console.log("系统模块已初始化，当前音量:", Math.round(this.currentVolume * 100) + "%");
        console.log("调试模式状态:", this.debugVisible ? "开启" : "关闭");
    },
    
    /**
     * 从 localStorage 加载所有音量设置
     */
    loadVolume: function() {
        try {
            // 加载主音量
            const savedVolume = localStorage.getItem(this.VOLUME_STORAGE_KEY);
            if (savedVolume !== null) {
                const volume = parseFloat(savedVolume);
                if (!isNaN(volume) && volume >= 0.0 && volume <= 1.0) {
                    this.currentVolume = volume;
                    console.log('[Volume] Main volume loaded:', Math.round(volume * 100) + '%');
                }
            }
            
            // 加载BGM音量
            const savedBgmVolume = localStorage.getItem(this.BGM_VOLUME_STORAGE_KEY);
            if (savedBgmVolume !== null) {
                const volume = parseFloat(savedBgmVolume);
                if (!isNaN(volume) && volume >= 0.0 && volume <= 1.0) {
                    this.bgmVolume = volume;
                    console.log('[Volume] BGM volume loaded:', Math.round(volume * 100) + '%');
                }
            }
            
            // 加载SE音量
            const savedSeVolume = localStorage.getItem(this.SE_VOLUME_STORAGE_KEY);
            if (savedSeVolume !== null) {
                const volume = parseFloat(savedSeVolume);
                if (!isNaN(volume) && volume >= 0.0 && volume <= 1.0) {
                    this.seVolume = volume;
                    console.log('[Volume] SE volume loaded:', Math.round(volume * 100) + '%');
                }
            }
            
            // 加载Voice音量
            const savedVoiceVolume = localStorage.getItem(this.VOICE_VOLUME_STORAGE_KEY);
            if (savedVoiceVolume !== null) {
                const volume = parseFloat(savedVoiceVolume);
                if (!isNaN(volume) && volume >= 0.0 && volume <= 1.0) {
                    this.voiceVolume = volume;
                    console.log('[Volume] Voice volume loaded:', Math.round(volume * 100) + '%');
                }
            }
        } catch (e) {
            console.warn('[Volume] Failed to load volumes from localStorage:', e);
        }
    },
    
    /**
     * 保存主音量设置到 localStorage
     */
    saveVolume: function() {
        try {
            localStorage.setItem(this.VOLUME_STORAGE_KEY, this.currentVolume.toString());
            console.log('[Volume] Main volume saved:', Math.round(this.currentVolume * 100) + '%');
            
            // 通知 C# 启动器：音量设置已更新
            this.notifyStorageOperation('UPDATE', this.VOLUME_STORAGE_KEY, 'localStorage');
        } catch (e) {
            console.warn('[Volume] Failed to save volume to localStorage:', e);
        }
    },
    
    /**
     * 保存BGM音量设置到 localStorage
     */
    saveBgmVolume: function() {
        try {
            localStorage.setItem(this.BGM_VOLUME_STORAGE_KEY, this.bgmVolume.toString());
            console.log('[Volume] BGM volume saved:', Math.round(this.bgmVolume * 100) + '%');
            this.notifyStorageOperation('UPDATE', this.BGM_VOLUME_STORAGE_KEY, 'localStorage');
        } catch (e) {
            console.warn('[Volume] Failed to save BGM volume:', e);
        }
    },
    
    /**
     * 保存SE音量设置到 localStorage
     */
    saveSeVolume: function() {
        try {
            localStorage.setItem(this.SE_VOLUME_STORAGE_KEY, this.seVolume.toString());
            console.log('[Volume] SE volume saved:', Math.round(this.seVolume * 100) + '%');
            this.notifyStorageOperation('UPDATE', this.SE_VOLUME_STORAGE_KEY, 'localStorage');
        } catch (e) {
            console.warn('[Volume] Failed to save SE volume:', e);
        }
    },
    
    /**
     * 保存Voice音量设置到 localStorage
     */
    saveVoiceVolume: function() {
        try {
            localStorage.setItem(this.VOICE_VOLUME_STORAGE_KEY, this.voiceVolume.toString());
            console.log('[Volume] Voice volume saved:', Math.round(this.voiceVolume * 100) + '%');
            this.notifyStorageOperation('UPDATE', this.VOICE_VOLUME_STORAGE_KEY, 'localStorage');
        } catch (e) {
            console.warn('[Volume] Failed to save Voice volume:', e);
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
            
            // 通知 C# 启动器：调试模式已更新
            this.notifyStorageOperation('UPDATE', this.DEBUG_MODE_STORAGE_KEY, 'localStorage');
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
        panel.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 10px; color: #FFFF00;">
                开发者调试日志（F1）
            </div>
            <div id="debug-content"></div>`;
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
        // 应用音量到 BGM 播放器（主音量 * BGM通道音量）
        if (gameEngine.elements.bgmPlayer) {
            gameEngine.elements.bgmPlayer.volume = this.currentVolume * this.bgmVolume;
        }
        
        // 应用音量到音效播放器（主音量 * SE通道音量）
        if (gameEngine.elements.sePlayer) {
            gameEngine.elements.sePlayer.volume = this.currentVolume * this.seVolume;
        }
        
        // 应用音量到语音播放器（主音量 * Voice通道音量）
        if (gameEngine.elements.voicePlayer) {
            gameEngine.elements.voicePlayer.volume = this.currentVolume * this.voiceVolume;
        }
        
        // 应用音量到页面上所有的 audio 元素（包括动态创建的）
        // 根据元素的 ID 或类名判断类型应用对应的通道音量
        const allAudioElements = document.querySelectorAll('audio');
        allAudioElements.forEach(audio => {
            let volume = this.currentVolume;
            if (audio.id && audio.id.includes('bgm')) {
                volume *= this.bgmVolume;
            } else if (audio.id && (audio.id.includes('se') || audio.id.includes('sound'))) {
                volume *= this.seVolume;
            } else if (audio.id && audio.id.includes('voice')) {
                volume *= this.voiceVolume;
            }
            audio.volume = volume;
        });
    },
    
    /**
     * 单独更新BGM音量
     */
    applyBgmVolume: function() {
        if (gameEngine.elements.bgmPlayer) {
            gameEngine.elements.bgmPlayer.volume = this.currentVolume * this.bgmVolume;
        }
        const bgmElements = document.querySelectorAll('audio[id*="bgm"], audio.bgm');
        bgmElements.forEach(audio => {
            audio.volume = this.currentVolume * this.bgmVolume;
        });
    },
    
    /**
     * 单独更新SE音量
     */
    applySeVolume: function() {
        if (gameEngine.elements.sePlayer) {
            gameEngine.elements.sePlayer.volume = this.currentVolume * this.seVolume;
        }
        const seElements = document.querySelectorAll('audio[id*="se"], audio[id*="sound"], audio.se');
        seElements.forEach(audio => {
            audio.volume = this.currentVolume * this.seVolume;
        });
    },
    
    /**
     * 单独更新Voice音量
     */
    applyVoiceVolume: function() {
        if (gameEngine.elements.voicePlayer) {
            gameEngine.elements.voicePlayer.volume = this.currentVolume * this.voiceVolume;
        }
        const voiceElements = document.querySelectorAll('audio[id*="voice"], audio.voice');
        voiceElements.forEach(audio => {
            audio.volume = this.currentVolume * this.voiceVolume;
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
        
        // 获取当前场景文件名（解码URL编码的中文字符）
        const rawPage = window.location.pathname.split('/').pop() || 'unknown.html';
        const currentPage = decodeURIComponent(rawPage);
        
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
    },
    
    // ========================================
    // 人物音频进度条功能
    // ========================================
    
    /**
     * 创建人物音频进度条
     * 在 name-box 右边显示，只在有音频时显示
     */
    createVoiceProgressBar: function() {
        // 查找 name-box 元素
        const nameBox = document.getElementById('name-box');
        if (!nameBox) {
            console.log('[VoiceProgress] name-box not found');
            return;
        }
        
        // 创建一个水平容器来包裹 name-box 和进度条
        const nameProgressRow = document.createElement('div');
        nameProgressRow.id = 'name-progress-row';
        nameProgressRow.style.display = 'flex';
        nameProgressRow.style.flexDirection = 'row';
        nameProgressRow.style.alignItems = 'center';
        nameProgressRow.style.alignSelf = 'flex-start';
        nameProgressRow.style.marginBottom = '5px';
        
        // 创建进度条容器
        this.voiceProgressContainer = document.createElement('div');
        this.voiceProgressContainer.id = 'voice-progress-container';
        this.voiceProgressContainer.style.display = 'none'; // 默认隐藏
        
        // 创建进度条
        this.voiceProgressBar = document.createElement('div');
        this.voiceProgressBar.id = 'voice-progress-bar';
        
        // 创建进度条填充部分
        const progressFill = document.createElement('div');
        progressFill.id = 'voice-progress-fill';
        
        this.voiceProgressBar.appendChild(progressFill);
        this.voiceProgressContainer.appendChild(this.voiceProgressBar);
        
        // 将 name-box 移动到新容器中
        const parent = nameBox.parentNode;
        parent.insertBefore(nameProgressRow, nameBox);
        nameProgressRow.appendChild(nameBox);
        nameProgressRow.appendChild(this.voiceProgressContainer);
        
        console.log('[VoiceProgress] Progress bar created');
    },
    
    /**
     * 绑定 voice-player 的播放事件
     */
    bindVoicePlayerEvents: function() {
        const voicePlayer = document.getElementById('voice-player');
        if (!voicePlayer) {
            console.log('[VoiceProgress] voice-player not found');
            return;
        }
        
        // 播放开始时显示进度条
        voicePlayer.addEventListener('play', () => {
            this.showVoiceProgress();
            this.startVoiceProgressUpdate();
            console.log('[VoiceProgress] Audio started, showing progress bar');
        });
        
        // 播放结束时隐藏进度条
        voicePlayer.addEventListener('ended', () => {
            this.hideVoiceProgress();
            this.stopVoiceProgressUpdate();
            console.log('[VoiceProgress] Audio ended, hiding progress bar');
        });
        
        // 播放暂停时也隐藏进度条
        voicePlayer.addEventListener('pause', () => {
            // 如果是自然结束（ended事件已触发），不处理
            if (voicePlayer.currentTime >= voicePlayer.duration - 0.1) {
                return;
            }
            // 暂停时也隐藏进度条
            this.hideVoiceProgress();
            this.stopVoiceProgressUpdate();
            console.log('[VoiceProgress] Audio paused, hiding progress bar');
        });
        
        // 加载新音频时重置进度条
        voicePlayer.addEventListener('loadstart', () => {
            this.resetVoiceProgress();
            console.log('[VoiceProgress] New audio loading, resetting progress');
        });
        
        console.log('[VoiceProgress] Voice player events bound');
    },
    
    /**
     * 显示人物音频进度条
     */
    showVoiceProgress: function() {
        if (this.voiceProgressContainer) {
            this.voiceProgressContainer.style.display = 'flex';
        }
    },
    
    /**
     * 隐藏人物音频进度条
     */
    hideVoiceProgress: function() {
        if (this.voiceProgressContainer) {
            this.voiceProgressContainer.style.display = 'none';
        }
    },
    
    /**
     * 重置进度条
     */
    resetVoiceProgress: function() {
        if (this.voiceProgressBar) {
            const fill = this.voiceProgressBar.querySelector('#voice-progress-fill');
            if (fill) {
                fill.style.width = '0%';
            }
        }
    },
    
    /**
     * 开始更新进度条
     */
    startVoiceProgressUpdate: function() {
        // 先停止之前的定时器
        this.stopVoiceProgressUpdate();
        
        // 每100ms更新一次进度
        this.voiceProgressUpdateTimer = setInterval(() => {
            this.updateVoiceProgress();
        }, 100);
    },
    
    /**
     * 停止更新进度条
     */
    stopVoiceProgressUpdate: function() {
        if (this.voiceProgressUpdateTimer) {
            clearInterval(this.voiceProgressUpdateTimer);
            this.voiceProgressUpdateTimer = null;
        }
    },
    
    /**
     * 更新进度条位置
     */
    updateVoiceProgress: function() {
        const voicePlayer = document.getElementById('voice-player');
        if (!voicePlayer || !voicePlayer.duration) {
            return;
        }
        
        const currentTime = voicePlayer.currentTime;
        const duration = voicePlayer.duration;
        const progress = (currentTime / duration) * 100;
        
        if (this.voiceProgressBar) {
            const fill = this.voiceProgressBar.querySelector('#voice-progress-fill');
            if (fill) {
                fill.style.width = progress + '%';
            }
        }
    },
    
    // ========================================
    // Galgame UI 菜单功能
    // ========================================
    
    // 快进状态存储键名
    FAST_FORWARD_STORAGE_KEY: 'galgame_fast_forward',
    
    // UI菜单DOM元素
    uiMenu: null,
    skipBtn: null,
    
    // 日志相关
    logData: [],  // 存储已显示的对话数据
    logOverlay: null,
    logContent: null,
    
    /**
     * 检测当前页面是否为场景文件（位于 scenes/ 目录下）
     * @returns {boolean}
     */
    isSceneFile: function() {
        const pathname = window.location.pathname;
        // 检测路径是否包含 '/scenes/' 
        return pathname.includes('/scenes/') || pathname.includes('\\scenes\\');
    },
    
    /**
     * 创建Galgame UI菜单
     */
    createGalgameUiMenu: function() {
        // 如果已经创建过，直接返回
        if (document.getElementById('galgame-ui-menu')) {
            return;
        }
        
        // 创建菜单容器
        const menu = document.createElement('div');
        menu.id = 'galgame-ui-menu';
        
        // 创建按钮容器
        const buttons = document.createElement('div');
        buttons.id = 'galgame-ui-buttons';
        
        // 创建SKIP/1按钮（普通快进）
        const skip1Btn = document.createElement('button');
        skip1Btn.id = 'ui-skip1';
        skip1Btn.className = 'galgame-ui-btn';
        skip1Btn.textContent = 'SKIP/1';
        skip1Btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 向engine发送消息，切换SKIP/1模式
            if (typeof gameEngine !== 'undefined') {
                gameEngine.toggleSkipMode(1);
            }
        });
        
        // 创建SKIP/2按钮（选项处停止的快进）
        const skip2Btn = document.createElement('button');
        skip2Btn.id = 'ui-skip2';
        skip2Btn.className = 'galgame-ui-btn';
        skip2Btn.textContent = 'SKIP/2';
        skip2Btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 向engine发送消息，切换SKIP/2模式
            if (typeof gameEngine !== 'undefined') {
                gameEngine.toggleSkipMode(2);
            }
        });
        
        // 创建AUTO按钮（自动推进剧情）
        const autoBtn = document.createElement('button');
        autoBtn.id = 'ui-auto';
        autoBtn.className = 'galgame-ui-btn';
        autoBtn.textContent = 'AUTO';
        autoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleAutoMode();
        });
        
        // 创建SAVE按钮（带二级菜单）
        const saveMenu = document.createElement('div');
        saveMenu.id = 'ui-save-menu';
        saveMenu.style.position = 'relative';
        
        const saveBtn = document.createElement('button');
        saveBtn.id = 'ui-save';
        saveBtn.className = 'galgame-ui-btn';
        saveBtn.textContent = 'SAVE';
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openArchive();
        });
        
        // 创建二级菜单
        const dropdown = document.createElement('div');
        dropdown.className = 'galgame-ui-dropdown';
        
        // SCENES按钮
        const scenesBtn = document.createElement('button');
        scenesBtn.className = 'galgame-ui-btn';
        scenesBtn.textContent = 'SCENES';
        scenesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 停止所有自动/快进模式
            this.stopAllAutoSkipModes();
            // 重新保存游戏状态快照（stopAllAutoSkipModes会清除它，需要补保存）
            if (typeof gameEngine !== 'undefined' && gameEngine.saveStateSnapshot) {
                gameEngine.saveStateSnapshot();
            }
            window.location.href = '../html/saves.html';
        });

        // MAP按钮
        const mapBtn = document.createElement('button');
        mapBtn.className = 'galgame-ui-btn';
        mapBtn.textContent = 'MAP';
        mapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 停止所有自动/快进模式
            this.stopAllAutoSkipModes();
            // 重新保存游戏状态快照（stopAllAutoSkipModes会清除它，需要补保存）
            if (typeof gameEngine !== 'undefined' && gameEngine.saveStateSnapshot) {
                gameEngine.saveStateSnapshot();
            }
            window.location.href = '../html/flowchart.html';
        });

        // STORY按钮
        const storyBtn = document.createElement('button');
        storyBtn.className = 'galgame-ui-btn';
        storyBtn.textContent = 'STORY';
        storyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 停止所有自动/快进模式
            this.stopAllAutoSkipModes();
            // 重新保存游戏状态快照（stopAllAutoSkipModes会清除它，需要补保存）
            if (typeof gameEngine !== 'undefined' && gameEngine.saveStateSnapshot) {
                gameEngine.saveStateSnapshot();
            }
            window.location.href = '../html/story.html';
        });
        
        // 组装二级菜单
        dropdown.appendChild(scenesBtn);
        dropdown.appendChild(mapBtn);
        dropdown.appendChild(storyBtn);
        
        // 组装SAVE菜单
        saveMenu.appendChild(saveBtn);
        saveMenu.appendChild(dropdown);
        
        // 修复菜单消失逻辑：使用JavaScript实现智能显示/隐藏
        let hideTimeout = null;
        
        // 鼠标进入SAVE菜单区域（包括二级菜单）
        const showMenu = () => {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            dropdown.classList.add('show');
        };
        
        // 鼠标离开时延迟隐藏
        const hideMenu = () => {
            hideTimeout = setTimeout(() => {
                dropdown.classList.remove('show');
                hideTimeout = null;
            }, 150); // 150ms延迟，给用户足够时间移动鼠标
        };
        
        // SAVE按钮进入
        saveBtn.addEventListener('mouseenter', showMenu);
        // SAVE按钮离开（延迟隐藏）
        saveBtn.addEventListener('mouseleave', hideMenu);
        
        // 二级菜单进入（取消隐藏）
        dropdown.addEventListener('mouseenter', showMenu);
        // 二级菜单离开
        dropdown.addEventListener('mouseleave', hideMenu);
        
        // 创建OPTION按钮
        const optionBtn = document.createElement('button');
        optionBtn.id = 'ui-option';
        optionBtn.className = 'galgame-ui-btn';
        optionBtn.textContent = 'OPTION';
        optionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openOptions();
        });
        
        // 创建SYSTEM按钮（放在option和log之间）
        const systemBtn = document.createElement('button');
        systemBtn.id = 'ui-system';
        systemBtn.className = 'galgame-ui-btn';
        systemBtn.textContent = 'SYSTEM';
        systemBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showSystemSettings();
        });
        
        // 创建LOG按钮
        const logBtn = document.createElement('button');
        logBtn.id = 'ui-log';
        logBtn.className = 'galgame-ui-btn';
        logBtn.textContent = 'LOG';
        logBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openLog();
        });
        
        // 创建HELP按钮
        const helpBtn = document.createElement('button');
        helpBtn.id = 'ui-help';
        helpBtn.className = 'galgame-ui-btn';
        helpBtn.textContent = 'HELP';
        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 停止所有自动/快进模式
            this.stopAllAutoSkipModes();
            // 向C#发送消息，显示原生帮助窗口
            if (window.chrome && window.chrome.webview) {
                window.chrome.webview.postMessage({ action: 'showHelp' });
            }
        });
        
        // 创建BACK按钮
        const backBtn = document.createElement('button');
        backBtn.id = 'ui-back';
        backBtn.className = 'galgame-ui-btn';
        backBtn.textContent = 'BACK';
        backBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 停止所有自动/快进模式
            this.stopAllAutoSkipModes();
            // 向C#发送消息，返回主菜单（会弹出确认）
            if (window.chrome && window.chrome.webview) {
                window.chrome.webview.postMessage({ action: 'goHome' });
            }
        });
        
        // 创建QUIT按钮
        const quitBtn = document.createElement('button');
        quitBtn.id = 'ui-quit';
        quitBtn.className = 'galgame-ui-btn';
        quitBtn.textContent = 'QUIT';
        quitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 停止所有自动/快进模式
            this.stopAllAutoSkipModes();
            // 向C#发送消息，退出游戏（会弹出确认）
            if (window.chrome && window.chrome.webview) {
                window.chrome.webview.postMessage({ action: 'quit' });
            }
        });
        
        // 组装DOM结构
        buttons.appendChild(skip1Btn);
        buttons.appendChild(skip2Btn);
        buttons.appendChild(autoBtn);
        buttons.appendChild(saveMenu);
        buttons.appendChild(optionBtn);
        buttons.appendChild(systemBtn);
        buttons.appendChild(logBtn);
        buttons.appendChild(helpBtn);
        buttons.appendChild(backBtn);
        buttons.appendChild(quitBtn);
        menu.appendChild(buttons);
        document.body.appendChild(menu);
        
        // 保存引用
        this.uiMenu = menu;
        this.skip1Btn = skip1Btn;
        this.skip2Btn = skip2Btn;
        
        // 绑定点击非UI区域停止快进的事件
        this.bindUiClickHandler();
        
        console.log('[Galgame UI] Menu created');
    },
    
    /**
     * 绑定点击处理：点击非UI区域时停止快进
     */
    bindUiClickHandler: function() {
        document.addEventListener('click', (e) => {
            // 检查点击目标是否在UI菜单内
            const isUiElement = e.target.closest('#galgame-ui-menu') || 
                               e.target.closest('#options-container') ||
                               e.target.closest('.context-menu');
            
            // 如果不在UI区域内且快进状态激活，停止快进
            if (!isUiElement && this.isFastForwardActive()) {
                this.stopFastForward();
            }
        });
    },
    
    /**
     * 切换快进状态
     */
    toggleFastForward: function() {
        if (this.isFastForwardActive()) {
            this.stopFastForward();
        } else {
            this.startFastForward();
        }
    },
    
    /**
     * 启动快进
     */
    startFastForward: function() {
        if (typeof gameEngine !== 'undefined') {
            gameEngine.startFastForward();
        }
        
        // 更新按钮状态
        if (this.skipBtn) {
            this.skipBtn.classList.add('skip-active');
        }
        
        // 保存到sessionStorage（跨页面持久化）
        sessionStorage.setItem(this.FAST_FORWARD_STORAGE_KEY, 'true');
        
        console.log('[Galgame UI] Fast forward started');
    },
    
    /**
     * 停止快进
     */
    stopFastForward: function() {
        if (typeof gameEngine !== 'undefined') {
            gameEngine.stopFastForward();
        }
        
        // 更新按钮状态
        if (this.skipBtn) {
            this.skipBtn.classList.remove('skip-active');
        }
        
        // 从sessionStorage移除
        sessionStorage.removeItem(this.FAST_FORWARD_STORAGE_KEY);
        
        console.log('[Galgame UI] Fast forward stopped');
    },
    
    /**
     * 检查快进是否激活
     * @returns {boolean}
     */
    isFastForwardActive: function() {
        if (typeof gameEngine !== 'undefined' && gameEngine.state) {
            return gameEngine.state.fastForwardActive;
        }
        return false;
    },
    
    /**
     * 恢复快进状态（页面加载时调用）
     */
    restoreFastForwardState: function() {
        const savedState = sessionStorage.getItem(this.FAST_FORWARD_STORAGE_KEY);
        if (savedState === 'true') {
            // 延迟启动，确保引擎已初始化
            setTimeout(() => {
                this.startFastForward();
            }, 500);
        }
    },
    
    /**
     * 打开存档页面
     */
    openArchive: function() {
        // 停止所有自动/快进模式（不需要在新页面继续）
        this.stopAllAutoSkipModes();
        
        // 在打开存档页面之前，先保存当前游戏状态快照
        // 这样存档页面才能获取到最新的预览文本
        if (typeof gameEngine !== 'undefined' && gameEngine.saveStateSnapshot) {
            gameEngine.saveStateSnapshot();
        }
        
        // 构建存档页面路径
        const currentPath = window.location.pathname;
        // 找到shiori engine目录
        let basePath = currentPath;
        if (basePath.includes('/scenes/')) {
            basePath = basePath.substring(0, basePath.indexOf('/scenes/'));
        } else if (basePath.includes('\\scenes\\')) {
            basePath = basePath.substring(0, basePath.indexOf('\\scenes\\'));
        }
        
        // 导航到存档页面
        window.location.href = basePath + '/html/archive.html';
    },
    
    /**
     * 打开选项菜单（上下文菜单）
     */
    openOptions: function() {
        if (typeof gameEngine !== 'undefined') {
            gameEngine.toggleContextMenu();
        }
    },
    
    /**
     * 更新SKIP按钮状态（由engine.js调用）
     */
    updateSkipButton: function(mode) {
        // mode: 0=无快进，1=SKIP/1，2=SKIP/2
        
        // 更新SKIP/1按钮
        if (this.skip1Btn) {
            if (mode === 1) {
                this.skip1Btn.classList.add('skip-active');
            } else {
                this.skip1Btn.classList.remove('skip-active');
            }
        }
        
        // 更新SKIP/2按钮
        if (this.skip2Btn) {
            if (mode === 2) {
                this.skip2Btn.classList.add('skip-active');
            } else {
                this.skip2Btn.classList.remove('skip-active');
            }
        }
    },
    
    // ========================================
    // 日志功能
    // ========================================
    
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
     * 处理换行符
     * 将各种格式的换行符转换为 <br> 标签
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
     * 添加日志条目
     * @param {Object} data - 对话数据，包含 speaker 和 text 属性
     */
    addLogEntry: function(data) {
        if (!data || (!data.speaker && !data.text)) {
            return;
        }
        
        let processedText = '';
        if (data.text) {
            // 移除 [s] 标签（用于分段显示的标记，不打印在日志中）
            let textWithoutSegments = data.text.replace(/\[s\]/gi, '');
            
            // 处理注音标签，将 [汉字,拼音] 转换为 <ruby> 结构
            let textWithRuby = this.processRubyText(textWithoutSegments);
            
            // 处理换行符，将各种格式的换行符转换为 <br> 标签
            processedText = this.processLineBreaks(textWithRuby);
        }
        
        // 保存音频数据（支持 [a] 标签分隔多个音频）
        let audioSegments = null;
        if (data.audio && typeof data.audio === 'string' && data.audio !== 'stop') {
            // 解析 [a] 标签分隔的音频序列
            audioSegments = data.audio.split('[a]').map(s => s.trim()).filter(s => s.length > 0);
        }
        
        this.logData.push({
            speaker: data.speaker || null,
            text: processedText,
            audio: audioSegments // 保存音频分段
        });
    },
    
    /**
     * 创建日志遮罩层
     */
    createLogOverlay: function() {
        if (document.getElementById('log-overlay')) {
            return;
        }
        
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.id = 'log-overlay';
        
        // 创建内容区域
        const content = document.createElement('div');
        content.id = 'log-content';
        
        // 创建底部控制栏
        const bottomBar = document.createElement('div');
        bottomBar.id = 'log-bottom-bar';
        
        // 创建返回按钮
        const backBtn = document.createElement('button');
        backBtn.id = 'log-back-btn';
        backBtn.textContent = 'BACK';
        backBtn.addEventListener('click', () => {
            this.closeLog();
        });
        
        // 组装DOM
        bottomBar.appendChild(backBtn);
        overlay.appendChild(content);
        overlay.appendChild(bottomBar);
        document.body.appendChild(overlay);
        
        // 保存引用
        this.logOverlay = overlay;
        this.logContent = content;
        
        console.log('[Galgame UI] Log overlay created');
    },
    
    /**
     * 打开日志
     */
    openLog: function() {
        // 确保遮罩层已创建
        this.createLogOverlay();
        
        // 更新日志内容
        this.updateLogContent();
        
        // 显示遮罩层
        this.logOverlay.style.display = 'flex';
        
        // 自动滚动到底部
        setTimeout(() => {
            this.logContent.scrollTop = this.logContent.scrollHeight;
        }, 100);
        
        console.log('[Galgame UI] Log opened');
    },
    
    /**
     * 关闭日志
     */
    closeLog: function() {
        if (this.logOverlay) {
            this.logOverlay.style.display = 'none';
        }
        console.log('[Galgame UI] Log closed');
    },
    
    /**
     * 更新日志内容显示
     */
    updateLogContent: function() {
        if (!this.logContent) {
            return;
        }
        
        let html = '';
        
        this.logData.forEach((entry, index) => {
            // 如果没有文本内容，跳过
            if (!entry.text || entry.text.trim() === '') {
                return;
            }
            
            // 如果有说话人
            if (entry.speaker && entry.speaker.trim() !== '') {
                html += `<div class="log-speaker">【${entry.speaker}】</div>`;
                html += this.createLogTextWithAudioButtons(entry.text, entry.audio);
            } else {
                // 没有说话人，直接显示文本
                html += `<div class="log-text-no-speaker">${entry.text}</div>`;
            }
        });
        
        this.logContent.innerHTML = html;
        
        // 绑定播放按钮事件
        this.bindLogAudioButtons();
    },
    
    /**
     * 创建带音频播放按钮的日志文本
     * @param {string} text - 文本内容
     * @param {Array|null} audioSegments - 音频分段数组
     * @returns {string} HTML字符串
     */
    createLogTextWithAudioButtons: function(text, audioSegments) {
        // 如果没有音频，直接返回带容器的文本
        if (!audioSegments || audioSegments.length === 0) {
            return `
                <div class="log-text-container">
                    <div class="log-text">${text}</div>
                </div>
            `;
        }
        
        // 创建播放按钮
        let buttonsHtml = '';
        audioSegments.forEach((audioPath, segmentIndex) => {
            const audioId = `log-audio-${Date.now()}-${segmentIndex}`;
            buttonsHtml += `
                <button class="log-audio-btn" data-audio="${encodeURIComponent(audioPath)}" data-index="${segmentIndex}">
                    ▶
                </button>
            `;
        });
        
        return `
            <div class="log-text-container">
                <div class="log-audio-buttons">${buttonsHtml}</div>
                <div class="log-text">${text}</div>
            </div>
        `;
    },
    
    /**
     * 绑定日志中音频播放按钮的事件
     */
    bindLogAudioButtons: function() {
        const buttons = document.querySelectorAll('.log-audio-btn');
        buttons.forEach(btn => {
            btn.removeEventListener('click', this.handleLogAudioButtonClick);
            btn.addEventListener('click', (e) => {
                this.handleLogAudioButtonClick(e);
            });
        });
    },
    
    /**
     * 处理日志音频播放按钮点击
     * @param {Event} e - 点击事件
     */
    handleLogAudioButtonClick: function(e) {
        const btn = e.target;
        const audioPath = decodeURIComponent(btn.getAttribute('data-audio'));
        
        if (!audioPath) {
            return;
        }
        
        // 构建完整的音频路径
        // 如果路径已经包含扩展名，则直接使用
        let fullAudioPath = audioPath;
        if (!audioPath.includes('.')) {
            // 如果没有扩展名，添加 .ogg 扩展名
            // 使用绝对路径，从根目录开始
            fullAudioPath = `/assets/audio/${audioPath}.ogg`;
        } else if (!audioPath.startsWith('assets/') && !audioPath.startsWith('/')) {
            // 如果有扩展名但没有路径前缀，添加 /assets/audio/ 绝对路径前缀
            fullAudioPath = `/assets/audio/${audioPath}`;
        } else if (audioPath.startsWith('assets/') && !audioPath.startsWith('/')) {
            // 如果以 assets/ 开头但不是绝对路径，添加 / 前缀
            fullAudioPath = `/${audioPath}`;
        }
        
        console.log('[Log Audio] Playing:', fullAudioPath);
        
        // 暂停当前播放的语音
        const voicePlayer = document.getElementById('voice-player');
        if (voicePlayer) {
            voicePlayer.pause();
            voicePlayer.currentTime = 0;
        }
        
        // 播放新音频
        voicePlayer.src = fullAudioPath;
        voicePlayer.play().catch(error => {
            console.log("日志音频播放失败:", error);
        });
    },
    
    /**
     * 清空日志（切换场景时调用）
     */
    clearLog: function() {
        this.logData = [];
    },
    
    // ========================================
    // 系统设置功能（通过 C# 窗口实现）
    // ========================================
    
    /**
     * 显示系统设置窗口（调用 C# 原生窗口）
     */
    showSystemSettings: function() {
        // 停止所有自动/快进模式并清除状态快照（打开设置窗口时不需要继续）
        this.stopAllAutoSkipModes();
        
        // 向 C# 发送消息，显示系统设置窗口
        if (window.chrome && window.chrome.webview) {
            // 发送当前音量设置给 C#，以便窗口显示当前值
            const volumeData = {
                main: Math.round(this.currentVolume * 100),
                bgm: Math.round(this.bgmVolume * 100),
                se: Math.round(this.seVolume * 100),
                voice: Math.round(this.voiceVolume * 100)
            };
            
            window.chrome.webview.postMessage({ 
                action: 'showSystemSettings',
                data: volumeData
            });
            
            console.log('[System Settings] Requested C# window');
        }
    },
    
    /**
     * 暂停所有音频（用于打开设置窗口时）- 已禁用，不再截断主界面音频
     */
    pauseAllAudioForSettings: function() {
        // 空函数 - 不再暂停任何音频
        console.log('[System Settings] Audio pause disabled');
    },
    
    /**
     * 从 C# 接收音量设置更新
     * @param {Object} volumeData - 包含各通道音量的对象
     */
    updateVolumeFromSettings: function(volumeData) {
        if (volumeData.main !== undefined) {
            this.currentVolume = Math.max(0, Math.min(1, volumeData.main / 100));
            this.saveVolume();
        }
        if (volumeData.bgm !== undefined) {
            this.bgmVolume = Math.max(0, Math.min(1, volumeData.bgm / 100));
            this.saveBgmVolume();
        }
        if (volumeData.se !== undefined) {
            this.seVolume = Math.max(0, Math.min(1, volumeData.se / 100));
            this.saveSeVolume();
        }
        if (volumeData.voice !== undefined) {
            this.voiceVolume = Math.max(0, Math.min(1, volumeData.voice / 100));
            this.saveVoiceVolume();
        }
        
        // 应用新的音量设置
        this.applyVolumeToAllAudio();
        
        console.log('[System Settings] Volume updated from C#:', volumeData);
    },
    
    /**
     * 系统设置窗口关闭时的回调
     */
    onSystemSettingsClosed: function() {
        // 不再恢复音频（因为不再暂停）
        console.log('[System Settings] Window closed');
        console.log('[AUTO] Current delay after settings closed:', this.autoDelaySeconds + 's');
        console.log('[AUTO] Current showCountdown after settings closed:', this.autoShowCountdown);
    },
    
    /**
     * 获取当前所有音量设置（供 C# 调用）
     * @returns {Object}
     */
    getVolumeSettings: function() {
        return {
            main: Math.round(this.currentVolume * 100),
            bgm: Math.round(this.bgmVolume * 100),
            se: Math.round(this.seVolume * 100),
            voice: Math.round(this.voiceVolume * 100)
        };
    },
    
    /**
     * 设置单个音量通道（供 C# 调用）
     * @param {string} channel - 通道名称: 'main', 'bgm', 'se', 'voice'
     * @param {number} value - 音量值 (0-100)
     */
    setVolumeChannel: function(channel, value) {
        const volume = Math.max(0, Math.min(1, value / 100));
        
        switch (channel) {
            case 'main':
                this.currentVolume = volume;
                this.applyVolumeToAllAudio();
                this.saveVolume();
                break;
            case 'bgm':
                this.bgmVolume = volume;
                this.applyBgmVolume();
                this.saveBgmVolume();
                break;
            case 'se':
                this.seVolume = volume;
                this.applySeVolume();
                this.saveSeVolume();
                break;
            case 'voice':
                this.voiceVolume = volume;
                this.applyVoiceVolume();
                this.saveVoiceVolume();
                break;
        }
        
        console.log(`[System Settings] ${channel} volume set to ${value}%`);
    },
    
    /**
     * 播放测试音频（供 C# 调用）
     * @param {string} type - 音频类型: 'bgm', 'se', 'voice'
     * @param {boolean} play - true 播放, false 停止
     */
    playTestAudio: function(type, play) {
        console.log(`[Test Audio] Request: type=${type}, play=${play}`);
        
        if (play) {
            // 如果已经在播放，先停止
            if (this.testAudioPlayers[type]) {
                this.testAudioPlayers[type].pause();
                this.testAudioPlayers[type].src = '';
                delete this.testAudioPlayers[type];
            }
            
            // 创建新的测试音频播放器
            const audio = new Audio();
            audio.loop = true;
            audio.preload = 'auto';
            audio.crossOrigin = 'anonymous';
            
            // 根据类型设置音频源（使用项目中已有的资源）
            const audioPaths = {
                bgm: 'assets/bgm/bgm1.ogg',
                se: 'assets/audio/YN100001.ogg',
                voice: 'assets/audio/YN100002.ogg'
            };
            
            const relativePath = audioPaths[type] || 'assets/bgm/bgm1.ogg';
            
            // 尝试多种路径格式
            const basePath = window.location.pathname;
            const dirPath = basePath.substring(0, basePath.lastIndexOf('/'));
            const fullPath = dirPath + '/' + relativePath;
            
            console.log(`[Test Audio] Trying path: ${fullPath}`);
            
            audio.src = fullPath;
            
            // 根据类型设置音量（转换为 0-1 范围）
            let volume = this.currentVolume / 100;
            switch (type) {
                case 'bgm':
                    volume *= this.bgmVolume / 100;
                    break;
                case 'se':
                    volume *= this.seVolume / 100;
                    break;
                case 'voice':
                    volume *= this.voiceVolume / 100;
                    break;
            }
            audio.volume = Math.max(0, Math.min(1, volume));
            console.log(`[Test Audio] Volume set to: ${audio.volume}`);
            
            // 监听加载完成事件
            audio.addEventListener('loadedmetadata', () => {
                console.log(`[Test Audio] Loaded metadata for ${type}, duration: ${audio.duration}s`);
            });
            
            audio.addEventListener('canplaythrough', () => {
                console.log(`[Test Audio] Can play through for ${type}`);
            });
            
            audio.addEventListener('error', (err) => {
                console.error('[Test Audio] Error loading:', audio.src, err);
                console.error('[Test Audio] Error code:', err.target?.error?.code);
                
                // 尝试直接使用相对路径
                console.log(`[Test Audio] Retrying with relative path: ${relativePath}`);
                audio.src = relativePath;
                
                audio.play().then(() => {
                    this.testAudioPlayers[type] = audio;
                    console.log(`[Test Audio] ${type} started with fallback path`);
                }).catch(e => {
                    console.error('[Test Audio] Fallback also failed:', e);
                });
            });
            
            // 尝试播放
            const playAudio = () => {
                audio.play().then(() => {
                    this.testAudioPlayers[type] = audio;
                    console.log(`[Test Audio] ${type} started successfully`);
                }).catch((err) => {
                    console.warn('[Test Audio] First play attempt failed:', err.message);
                    
                    // 尝试其他路径格式
                    const altPaths = [
                        '/' + relativePath,
                        './' + relativePath,
                        '../shiori engine/' + relativePath
                    ];
                    
                    let retryIndex = 0;
                    const tryNextPath = () => {
                        if (retryIndex >= altPaths.length) {
                            console.error('[Test Audio] All paths failed');
                            return;
                        }
                        
                        const altPath = altPaths[retryIndex++];
                        console.log(`[Test Audio] Trying alternative path: ${altPath}`);
                        audio.src = altPath;
                        
                        audio.play().then(() => {
                            this.testAudioPlayers[type] = audio;
                            console.log(`[Test Audio] ${type} started with path: ${altPath}`);
                        }).catch(e => {
                            console.warn(`[Test Audio] Path ${altPath} failed:`, e.message);
                            tryNextPath();
                        });
                    };
                    
                    tryNextPath();
                });
            };
            
            // 检查是否需要用户交互
            playAudio();
            
        } else {
            // 停止播放
            if (this.testAudioPlayers[type]) {
                this.testAudioPlayers[type].pause();
                this.testAudioPlayers[type].src = '';
                delete this.testAudioPlayers[type];
                console.log(`[Test Audio] ${type} stopped`);
            }
        }
    },
    
    /**
     * 停止所有测试音频（供 C# 调用）
     */
    stopAllTestAudio: function() {
        Object.keys(this.testAudioPlayers).forEach(type => {
            if (this.testAudioPlayers[type]) {
                this.testAudioPlayers[type].pause();
                this.testAudioPlayers[type].src = '';
                delete this.testAudioPlayers[type];
            }
        });
        console.log('[Test Audio] All stopped');
    },
    
    // ========================================
    // AUTO模式功能
    // ========================================
    
    /**
     * 加载 AUTO 设置
     */
    loadAutoSettings: function() {
        try {
            console.log('[AUTO] loadAutoSettings called');
            console.log('[AUTO] Current delay before loading:', this.autoDelaySeconds + 's');
            
            // 加载延迟时间
            const savedDelay = localStorage.getItem(this.AUTO_DELAY_KEY);
            console.log('[AUTO] Saved delay from localStorage:', savedDelay);
            
            if (savedDelay !== null) {
                const delay = parseFloat(savedDelay);
                if (!isNaN(delay) && delay >= 0.5 && delay <= 10) {
                    this.autoDelaySeconds = delay;
                    console.log('[AUTO] Delay loaded:', delay + 's');
                } else {
                    console.log('[AUTO] Invalid delay value:', savedDelay);
                }
            } else {
                console.log('[AUTO] No saved delay found');
            }
            
            // 加载是否显示倒计时
            const savedShowCountdown = localStorage.getItem(this.AUTO_SHOW_COUNTDOWN_KEY);
            console.log('[AUTO] Saved showCountdown from localStorage:', savedShowCountdown);
            
            if (savedShowCountdown !== null) {
                this.autoShowCountdown = savedShowCountdown === 'true';
                console.log('[AUTO] Show countdown:', this.autoShowCountdown);
            }
            
            console.log('[AUTO] Final delay after loading:', this.autoDelaySeconds + 's');
        } catch (e) {
            console.warn('[AUTO] Failed to load settings:', e);
        }
    },
    
    /**
     * 保存 AUTO 设置
     */
    saveAutoSettings: function() {
        try {
            console.log('[AUTO] Saving settings...');
            console.log('[AUTO] Current delay to save:', this.autoDelaySeconds + 's');
            console.log('[AUTO] Current showCountdown to save:', this.autoShowCountdown);
            
            localStorage.setItem(this.AUTO_DELAY_KEY, this.autoDelaySeconds.toString());
            localStorage.setItem(this.AUTO_SHOW_COUNTDOWN_KEY, this.autoShowCountdown.toString());
            
            console.log('[AUTO] Settings saved:', this.autoDelaySeconds + 's, showCountdown:' + this.autoShowCountdown);
            
            // 验证保存是否成功
            const savedDelay = localStorage.getItem(this.AUTO_DELAY_KEY);
            const savedCountdown = localStorage.getItem(this.AUTO_SHOW_COUNTDOWN_KEY);
            console.log('[AUTO] Verified - Saved delay:', savedDelay);
            console.log('[AUTO] Verified - Saved showCountdown:', savedCountdown);
        } catch (e) {
            console.warn('[AUTO] Failed to save settings:', e);
        }
    },
    
    /**
     * 切换 AUTO 模式
     */
    toggleAutoMode: function() {
        this.autoModeEnabled = !this.autoModeEnabled;
        
        // 更新按钮状态
        const autoBtn = document.getElementById('ui-auto');
        if (autoBtn) {
            if (this.autoModeEnabled) {
                autoBtn.classList.add('active');
                console.log('[AUTO] AUTO mode enabled');
            } else {
                autoBtn.classList.remove('active');
                this.stopAutoCountdown();
                console.log('[AUTO] AUTO mode disabled');
            }
        }
        
        // 如果开启了AUTO模式，先关闭SKIP模式（互斥）
        if (this.autoModeEnabled && typeof gameEngine !== 'undefined') {
            gameEngine.toggleSkipMode(0); // 停止SKIP
        }
        
        // 如果关闭了AUTO模式，停止倒计时
        if (!this.autoModeEnabled) {
            this.stopAutoCountdown();
            return;
        }
        
        // 如果刚开启AUTO模式，检查当前是否可以立即触发倒计时
        if (this.autoModeEnabled) {
            // 检查打字机是否已经完成
            const typingComplete = typeof gameEngine !== 'undefined' && 
                                  gameEngine.state && 
                                  gameEngine.state.textFullyDisplayed && 
                                  !gameEngine.state.typingActive;
            
            if (typingComplete) {
                // 打字机已完成，检查音频状态并可能触发倒计时
                this.checkAutoConditions();
            }
        }
    },
    
    /**
     * 更新 AUTO 按钮状态（供外部调用）
     */
    updateAutoButton: function(enabled) {
        this.autoModeEnabled = enabled;
        const autoBtn = document.getElementById('ui-auto');
        if (autoBtn) {
            if (enabled) {
                autoBtn.classList.add('active');
            } else {
                autoBtn.classList.remove('active');
            }
        }
    },
    
    /**
     * 更新所有按钮状态（SKIP和AUTO）
     * 用于从快照恢复状态后更新UI
     */
    updateAllButtons: function() {
        // 更新SKIP按钮
        if (typeof gameEngine !== 'undefined') {
            this.updateSkipButton(gameEngine.state.skipMode);
        }
        
        // 更新AUTO按钮
        this.updateAutoButton(this.autoModeEnabled);
    },
    
    /**
     * 停止所有自动/快进模式
     * 用于导航到非游戏页面（HTML文件）或打开C#窗口时
     * 确保SKIP和AUTO状态不会在新页面/窗口中继续运行
     */
    stopAllAutoSkipModes: function() {
        // 停止SKIP快进模式
        if (this.isFastForwardActive()) {
            this.stopFastForward();
            console.log('[State] Stopped SKIP mode before navigation');
        }
        
        // 停止AUTO自动模式
        if (this.autoModeEnabled) {
            this.toggleAutoMode();
            console.log('[State] Stopped AUTO mode before navigation');
        }
        
    },
    
    /**
     * 开始 AUTO 倒计时（当打字机完成且音频播放完成时调用）
     * @param {boolean} hasAudio - 是否有人物音频
     */
    startAutoCountdown: function(hasAudio) {
        // 如果AUTO模式未开启，直接返回
        if (!this.autoModeEnabled) {
            return;
        }
        
        // 停止之前的倒计时
        this.stopAutoCountdown();
        
        this.autoCountdownRemaining = this.autoDelaySeconds;
        
        // 如果需要显示倒计时，创建或更新倒计时元素
        if (this.autoShowCountdown) {
            this.createAutoCountdownElement();
            this.updateAutoCountdownDisplay();
        }
        
        // 设置倒计时定时器（每100ms更新一次，实现0.1秒精度）
        this.autoCountdownTimer = setInterval(() => {
            this.autoCountdownRemaining -= 0.1;
            
            if (this.autoShowCountdown) {
                this.updateAutoCountdownDisplay();
            }
            
            if (this.autoCountdownRemaining <= 0) {
                this.handleAutoClick();
            }
        }, 100);
        
        console.log('[AUTO] Countdown started:', this.autoDelaySeconds + 's, hasAudio:' + hasAudio);
    },
    
    /**
     * 停止 AUTO 倒计时
     */
    stopAutoCountdown: function() {
        if (this.autoCountdownTimer) {
            clearInterval(this.autoCountdownTimer);
            this.autoCountdownTimer = null;
        }
        
        // 隐藏倒计时显示
        if (this.autoCountdownElement) {
            this.autoCountdownElement.style.display = 'none';
        }
        
        this.autoCountdownRemaining = 0;
    },
    
    /**
     * 更新倒计时显示
     */
    updateAutoCountdownDisplay: function() {
        if (this.autoCountdownElement) {
            // 显示0.1秒精度，不带单位
            this.autoCountdownElement.textContent = Math.max(0, this.autoCountdownRemaining).toFixed(1);
            this.autoCountdownElement.style.display = 'block';
        }
    },
    
    /**
     * 创建倒计时显示元素
     */
    createAutoCountdownElement: function() {
        if (this.autoCountdownElement) {
            return;
        }
        
        // 创建倒计时元素
        this.autoCountdownElement = document.createElement('div');
        this.autoCountdownElement.id = 'auto-countdown';
        this.autoCountdownElement.className = 'auto-countdown';
        
        // 找到name-progress-row容器（包含姓名和voice进度条），将倒计时添加到最后
        const nameProgressRow = document.getElementById('name-progress-row');
        if (nameProgressRow) {
            nameProgressRow.appendChild(this.autoCountdownElement);
        } else {
            // 如果找不到容器，添加到body
            document.body.appendChild(this.autoCountdownElement);
        }
        
        console.log('[AUTO] Countdown element created');
    },
    
    /**
     * 执行自动点击（推进剧情）
     */
    handleAutoClick: function() {
        // 停止倒计时
        this.stopAutoCountdown();
        
        // 如果AUTO模式已关闭，不执行点击
        if (!this.autoModeEnabled) {
            return;
        }
        
        // 设置标志位，表示这次点击是AUTO触发的
        this.autoClickTriggered = true;
        
        // 模拟点击屏幕推进剧情
        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        
        // 找到合适的元素触发点击
        const textWindow = document.getElementById('text-window');
        if (textWindow) {
            textWindow.dispatchEvent(clickEvent);
        } else {
            document.body.dispatchEvent(clickEvent);
        }
        
        console.log('[AUTO] Auto click executed');
    },
    
    /**
     * 打字机完成回调（供engine调用）
     */
    onTypingComplete: function() {
        // 如果AUTO模式未开启，直接返回
        if (!this.autoModeEnabled) {
            return;
        }
        
        this.checkAutoConditions();
    },
    
    /**
     * 检查AUTO触发条件
     */
    checkAutoConditions: function() {
        // 检查是否需要等待音频
        const voicePlayer = document.getElementById('voice-player');
        const hasAudio = voicePlayer && voicePlayer.src && !voicePlayer.paused && !voicePlayer.ended;
        
        if (hasAudio && voicePlayer.duration > 0) {
            // 有人物音频，等待音频播放完成
            const checkAudioComplete = () => {
                if (voicePlayer.ended || voicePlayer.paused) {
                    voicePlayer.removeEventListener('timeupdate', checkAudioComplete);
                    voicePlayer.removeEventListener('ended', checkAudioComplete);
                    this.startAutoCountdown(true);
                } else if (voicePlayer.currentTime >= voicePlayer.duration - 0.1) {
                    // 音频接近结束
                    voicePlayer.removeEventListener('timeupdate', checkAudioComplete);
                    voicePlayer.removeEventListener('ended', checkAudioComplete);
                    this.startAutoCountdown(true);
                }
            };
            
            voicePlayer.addEventListener('timeupdate', checkAudioComplete);
            voicePlayer.addEventListener('ended', checkAudioComplete);
        } else {
            // 没有音频，直接开始倒计时
            this.startAutoCountdown(false);
        }
    },
    
    /**
     * 更新 AUTO 设置（从 C# 接收）
     * @param {Object} settings - 包含 delay 和 showCountdown 的对象
     */
    updateAutoSettings: function(settings) {
        // 记录当前值用于对比
        const oldDelay = this.autoDelaySeconds;
        const oldShowCountdown = this.autoShowCountdown;
        
        if (settings.delay !== undefined) {
            const delay = parseFloat(settings.delay);
            if (!isNaN(delay) && delay >= 0.5 && delay <= 10) {
                this.autoDelaySeconds = delay;
                console.log('[AUTO] Delay updated from C#:', delay + 's');
            }
        }
        
        if (settings.showCountdown !== undefined) {
            this.autoShowCountdown = settings.showCountdown;
            console.log('[AUTO] Show countdown updated from C#:', this.autoShowCountdown);
        }
        
        // 只有当值真的改变了才保存
        if (oldDelay !== this.autoDelaySeconds || oldShowCountdown !== this.autoShowCountdown) {
            console.log('[AUTO] Settings changed, saving...');
            this.saveAutoSettings();
        } else {
            console.log('[AUTO] Settings unchanged, not saving');
        }
    },
    
    /**
     * 获取 AUTO 设置（供 C# 调用）
     * @returns {Object}
     */
    getAutoSettings: function() {
        const settings = {
            delay: this.autoDelaySeconds,
            showCountdown: this.autoShowCountdown
        };
        console.log('[AUTO] getAutoSettings called, returning:', settings);
        return settings;
    }
};

// DOM 加载完成后自动初始化
document.addEventListener('DOMContentLoaded', function() {
    systemModule.init();
    
    // 如果是场景文件，创建UI菜单
    if (systemModule.isSceneFile()) {
        systemModule.createGalgameUiMenu();
        systemModule.restoreFastForwardState();
    }
});

// 鼠标滚轮快捷键：向上滚动打开日志
document.addEventListener('wheel', function(e) {
    // 只在场景文件中生效
    if (!systemModule.isSceneFile()) {
        return;
    }
    
    // 只在非日志遮罩层中生效
    const logOverlay = document.getElementById('log-overlay');
    if (logOverlay && logOverlay.style.display === 'flex') {
        return;
    }
    
    // 向上滚动打开日志
    if (e.deltaY < 0) {
        e.preventDefault();
        systemModule.openLog();
    }
}, { passive: false });
