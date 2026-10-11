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
 * 音频播放与控制，处理 BGM/SE/语音的播放、淡入淡出、音量通道管理等。
 * 统一管理 bgmPlayer / voicePlayer / sePlayer 三个播放器，
 * 并负责浏览器自动播放策略的解锁以及序列化音频（含 [wait]/[a] 标签）的执行。
 */


    
    /**
     * 请求音频播放权限
     * 通过监听用户首次交互来解锁音频上下文，解决浏览器自动播放限制；
     * 首次解锁结果记入 localStorage —— 之后每个新页面(场景 html) init 时
     * 若已解锁过则直接尝试解锁，不再等待点击（配合宿主
     * --autoplay-policy=no-user-gesture-required 实现换页 BGM 自动续播）。
     * @returns {void}
     * @sideEffect 注册/移除 document 级事件监听器；写入 localStorage 解锁标记；
     *   通过 unlockAudioContext 触发一次静音播放以解锁音频。
     * @dependency localStorage（可能被禁用，故用 try/catch 包裹）。
     */
gameEngine.requestAudioPlayback = function() {
        // 记录“是否已在历史页面解锁过音频”的 localStorage 键
        const UNLOCK_KEY = 'shiori_audio_unlocked';
        // 首次用户交互回调：写入解锁标记、解锁音频并注销三个监听器
        const handleFirstInteraction = () => {
            try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (e) {}
            this.unlockAudioContext();
            document.removeEventListener('mousedown', handleFirstInteraction);
            document.removeEventListener('touchstart', handleFirstInteraction);
            document.removeEventListener('keydown', handleFirstInteraction);
        };
        try {
            if (localStorage.getItem(UNLOCK_KEY)) {
                // 历史页面已解锁过：直接尝试解锁，不等点击（换页自动播 BGM）
                this.unlockAudioContext();
                return;
            }
        } catch (e) {}
        // 监听多种交互方式（鼠标/触摸/键盘），触发任意一种即可解锁
        document.addEventListener('mousedown', handleFirstInteraction);
        document.addEventListener('touchstart', handleFirstInteraction);
        document.addEventListener('keydown', handleFirstInteraction);
    };


    
    /**
     * 解锁音频上下文
     * 通过先静音播放再恢复音量的方式绕过浏览器自动播放策略
     * @returns {void}
     * @description
     *   将 bgmPlayer 音量临时置 0 后调用 play()，成功（或失败）后统一恢复为
     *   主音量 * BGM 通道音量。此操作可使浏览器将后续播放视为“已授权”，
     *   从而允许跨页面切换时自动续播 BGM。
     * @sideEffect 修改 bgmPlayer.volume 并触发一次播放；控制台输出日志。
     * @dependency systemModule.currentVolume / systemModule.bgmVolume（可选）。
     */
gameEngine.unlockAudioContext = function() {
        try {
            // 静音状态下尝试播放以完成解锁
            this.elements.bgmPlayer.volume = 0;
            this.elements.bgmPlayer.play().then(() => {
                // 使用系统模块保存的音量值（主音量 * BGM通道音量）
                if (typeof systemModule !== 'undefined') {
                    this.elements.bgmPlayer.volume = systemModule.currentVolume * systemModule.bgmVolume;
                } else {
                    this.elements.bgmPlayer.volume = 1;
                }
                console.log("音频上下文已解锁");
            }).catch(() => {
                // 播放被拒绝时同样恢复音量（解锁可能已由其他途径完成）
                // 使用系统模块保存的音量值（主音量 * BGM通道音量）
                if (typeof systemModule !== 'undefined') {
                    this.elements.bgmPlayer.volume = systemModule.currentVolume * systemModule.bgmVolume;
                } else {
                    this.elements.bgmPlayer.volume = 1;
                }
            });
        } catch (e) {
            console.log("尝试解锁音频上下文时出错:", e);
            // 使用系统模块保存的音量值（主音量 * BGM通道音量）
            if (typeof systemModule !== 'undefined') {
                this.elements.bgmPlayer.volume = systemModule.currentVolume * systemModule.bgmVolume;
            } else {
                this.elements.bgmPlayer.volume = 1;
            }
        }
    };


    
    /**
     * 解析音频路径
     * 支持多种音频引用方式：
     * 1. 从 sceneData.bgm 中查找（BGM）
     * 2. 从 sceneData.audio 中查找（传统方式）
     * 3. 自动拼接 assets/audio/ 路径（零配置方式）
     * @param {string} audioKey - 音频键名或文件名（不含扩展名）
     * @returns {object|null} - { path: string, isBgm: boolean } 或 null
     * @sideEffect 零配置兜底命中时会写入 this.audioCache 缓存。
     */
gameEngine.resolveAudioPath = function(audioKey) {
        // 参数校验：非字符串或空值直接返回 null
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
        
        // 直接使用第一个扩展名（.ogg），因为大多数音频文件都是 ogg 格式
        const fullPath = basePath + audioKey + extensions[0];
        // 缓存拼接结果，避免后续重复计算
        this.audioCache[audioKey] = fullPath;
        return { path: fullPath, isBgm: false };
    };


        
    /**
     * 解析音效路径
     * 支持零配置自动加载，统一指向 assets/se/ 目录
     * @param {string} seKey - 音效键名或文件名（不含扩展名）
     * @returns {string|null} - 音效路径或 null
     * @sideEffect 首次解析时写入 this.seCache 缓存。
     */
gameEngine.resolveSEPath = function(seKey) {
        // 参数校验：非字符串或空值直接返回 null
        if (!seKey || typeof seKey !== 'string') {
            return null;
        }
            
        // 尝试从缓存中获取
        if (this.seCache && this.seCache[seKey]) {
            return this.seCache[seKey];
        }
            
        // 零配置模式：自动拼接 assets/se/ 路径
        // 尝试常见的音频扩展名
        const extensions = ['.ogg', '.mp3', '.wav', '.m4a', '.aac'];
        const basePath = '../assets/se/';
            
        for (const ext of extensions) {
            // 尝试原始文件名（保持大小写）
            const fullPath = basePath + seKey + ext;
                
            // 初始化缓存对象
            if (!this.seCache) {
                this.seCache = {};
            }
            // 将路径缓存起来，避免重复计算（循环内首次即返回，实际只取第一个扩展名）
            this.seCache[seKey] = fullPath;
            return fullPath;
        }
            
        // 如果都没找到，返回 null
        console.warn(`音效文件未找到: ${seKey}`);
        return null;
    };


    
    /**
     * 播放音频
     * 根据音频类型（BGM/语音）选择对应的播放器，处理浏览器自动播放限制
     * @param {string} audioKey - 音频键名，从场景数据的bgm或audio中查找
     * @returns {void}
     * @description
     *   BGM 分支：若与当前播放源不同则重设 src、开启循环并播放；
     *   播放被自动播放策略拒绝时会尝试静音解锁后重播（并从头开始）。
     *   非 BGM 分支（语音/音效）：先暂停 voice/se 播放器，再加载到 voicePlayer，
     *   成功播放后回调 systemModule.checkAutoConditions。
     * @sideEffect 修改 bgmPlayer/voicePlayer/sePlayer 的 src、volume、loop 等状态并播放。
     * @dependency systemModule.currentVolume / bgmVolume / voiceVolume、checkAutoConditions（可选）。
     */
gameEngine.playAudio = function(audioKey) {
        const audioInfo = this.resolveAudioPath(audioKey);
        
        // 路径解析失败则放弃播放
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
                
                // 应用正确的音量（主音量 * BGM通道音量）
                if (typeof systemModule !== 'undefined') {
                    this.elements.bgmPlayer.volume = systemModule.currentVolume * systemModule.bgmVolume;
                }
                
                const playPromise = this.elements.bgmPlayer.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.log("BGM播放失败，请注意浏览器自动播放策略限制，可能需要用户交互后才能播放:", error);
                        
                        // 尝试解锁音频上下文（静音播放后再恢复音量并回到开头）
                        this.elements.bgmPlayer.volume = 0;
                        this.elements.bgmPlayer.play().then(() => {
                            // 使用系统模块保存的音量值（主音量 * BGM通道音量）
                            if (typeof systemModule !== 'undefined') {
                                this.elements.bgmPlayer.volume = systemModule.currentVolume * systemModule.bgmVolume;
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
                // 如果是同一个BGM，确保循环播放并应用正确的音量（不重设 src，避免重新加载）
                this.elements.bgmPlayer.loop = true;
                if (typeof systemModule !== 'undefined') {
                    this.elements.bgmPlayer.volume = systemModule.currentVolume * systemModule.bgmVolume;
                }
            }
        } else {
            // 非BGM音频（语音/音效）处理：先停止其他播放器再加载到 voicePlayer
            this.elements.voicePlayer.pause();
            this.elements.sePlayer.pause();
            this.elements.voicePlayer.loop = false;
            this.elements.voicePlayer.src = audioPath;
            
            // 应用正确的音量（主音量 * Voice通道音量）
            if (typeof systemModule !== 'undefined') {
                this.elements.voicePlayer.volume = systemModule.currentVolume * systemModule.voiceVolume;
            }
            
            const playPromise = this.elements.voicePlayer.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    // 音频播放成功后，通知systemModule检查AUTO条件
                    if (typeof systemModule !== 'undefined' && systemModule.checkAutoConditions) {
                        systemModule.checkAutoConditions();
                    }
                }).catch(error => {
                    console.log("音频播放失败，请注意浏览器自动播放策略限制:", error);
                    
                    // 尝试解锁音频上下文（同 BGM：静音播放后再恢复音量并回到开头）
                    this.elements.voicePlayer.volume = 0;
                    this.elements.voicePlayer.play().then(() => {
                        // 使用系统模块保存的音量值（主音量 * Voice通道音量）
                        if (typeof systemModule !== 'undefined') {
                            this.elements.voicePlayer.volume = systemModule.currentVolume * systemModule.voiceVolume;
                        } else {
                            this.elements.voicePlayer.volume = 1;
                        }
                        this.elements.voicePlayer.currentTime = 0;
                        
                        // 音频播放成功后，通知systemModule检查AUTO条件
                        if (typeof systemModule !== 'undefined' && systemModule.checkAutoConditions) {
                            systemModule.checkAutoConditions();
                        }
                    }).catch(err => {
                        console.log("即使尝试解锁后语音仍无法播放:", err);
                    });
                });
            }
        }
    };


    
    /**
     * 播放音效（SE）
     * 使用独立的 se-player，与 voice-player 互不干扰
     * 支持零配置自动加载，统一指向 assets/se/ 目录
     * @param {string} seKey - 音效键名或文件名（不含扩展名）
     * @returns {void}
     * @description 在独立 sePlayer 上播放指定音效：暂停当前音效、重设 src、应用
     *   SE 通道音量后播放；被自动播放策略拦截时静音解锁重播。
     * @sideEffect 修改 sePlayer 的 src/loop/volume 并播放。
     * @dependency systemModule.currentVolume / seVolume（可选）。
     */
gameEngine.playSE = function(seKey) {
        const sePath = this.resolveSEPath(seKey);
        
        // 路径解析失败则放弃播放
        if (!sePath) {
            console.log("音效文件路径不存在:", seKey);
            return;
        }
        
        console.log("播放音效:", seKey, "路径:", sePath);
        
        // 停止当前正在播放的音效
        this.elements.sePlayer.pause();
        
        // 加载并播放新音效
        this.elements.sePlayer.loop = false;
        this.elements.sePlayer.src = sePath;
        
        // 应用正确的音量（主音量 * SE通道音量）
        if (typeof systemModule !== 'undefined') {
            this.elements.sePlayer.volume = systemModule.currentVolume * systemModule.seVolume;
        }
        
        const playPromise = this.elements.sePlayer.play();
        
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log("音效播放失败，请注意浏览器自动播放策略限制:", error);
                
                // 尝试解锁音频上下文（静音播放后再恢复音量并回到开头）
                this.elements.sePlayer.volume = 0;
                this.elements.sePlayer.play().then(() => {
                    // 使用系统模块保存的音量值（主音量 * SE通道音量）
                    if (typeof systemModule !== 'undefined') {
                        this.elements.sePlayer.volume = systemModule.currentVolume * systemModule.seVolume;
                    } else {
                        this.elements.sePlayer.volume = 1;
                    }
                    this.elements.sePlayer.currentTime = 0;
                }).catch(err => {
                    console.log("即使尝试解锁后音效仍无法播放:", err);
                });
            });
        }
    };


    
    /**
     * 解析音频序列
     * 将包含[a]标签的音频字符串分割成数组
     * @param {string} audioStr - 音频序列字符串，如 "audio1[a]audio2[a]audio3"
     * @returns {Array} - 音频键名数组（已去除空白段）
     * @description
     *   优先使用宿主 DSL 解析器 window.__shiori.dsl.splitInline 进行分词：
     *   [a] 标签表示序列分隔（push 新片段），[s] 原样保留为 '[s]' 文本，其余作为普通文本拼接。
     *   若 DSL 不可用则退化为按 /\[a\]/ 正则切分。最后过滤掉纯空白片段。
     */
gameEngine.parseAudioSequence = function(audioStr) {
        // 参数校验：非字符串或空值返回空数组
        if (!audioStr || typeof audioStr !== 'string') {
            return [];
        }
        
        // 尝试获取宿主的 DSL 分词器（存在时优先使用，以支持更复杂的行内语法）
        const dsl = (typeof window === 'object' && window && window.__shiori && window.__shiori.dsl) ? window.__shiori.dsl : null;
        if (dsl && typeof dsl.splitInline === 'function') {
            const parts = [''];
            // 遍历 DSL 分词结果：a 标签切分、s 保持占位、其余文本累加到当前段
            dsl.splitInline(audioStr).forEach(function (r) {
                if (r && r.a) {
                    parts.push('');
                } else if (r && r.s) {
                    parts[parts.length - 1] += '[s]';
                } else if (r && r.t) {
                    parts[parts.length - 1] += r.t;
                }
            });
            // 过滤掉空白段后返回
            return parts.filter(function (seg) { return seg.trim().length > 0; });
        }
        // 按[a]标签分割并过滤空字符串
        const segments = audioStr.split(/\[a\]/i);
        return segments.filter(seg => seg.trim().length > 0);
    };


    
    /**
     * 停止所有音频（不含BGM）
     * @returns {void}
     * @description 暂停 voicePlayer 与 sePlayer，但不重置播放进度（可快速续播）。
     * @sideEffect 暂停两个播放器。
     */
gameEngine.stopAllAudio = function() {
        this.elements.voicePlayer.pause();
        this.elements.sePlayer.pause();
    };


    
    /**
     * 停止语音播放
     * @returns {void}
     * @description 暂停语音播放器并将播放进度重置到开头。
     * @sideEffect 修改 voicePlayer 的播放状态与 currentTime。
     */
gameEngine.stopAudio = function() {
        this.elements.voicePlayer.pause();
        this.elements.voicePlayer.currentTime = 0;
    };


    
    /**
     * 停止音效播放
     * @returns {void}
     * @description 暂停音效播放器并将播放进度重置到开头。
     * @sideEffect 修改 sePlayer 的播放状态与 currentTime。
     */
gameEngine.stopSE = function() {
        this.elements.sePlayer.pause();
        this.elements.sePlayer.currentTime = 0;
    };


    
    /**
     * 停止所有音频（包括BGM）
     * @returns {void}
     * @description 同时暂停 BGM、音效、语音三个播放器（不重置进度）。
     * @sideEffect 暂停全部三个播放器。
     */
gameEngine.stopAllAudioWithBGM = function() {
        this.elements.bgmPlayer.pause();
        this.elements.sePlayer.pause();
        this.elements.voicePlayer.pause();
    };


    
    /**
     * 停止BGM播放
     * @returns {void}
     * @description 暂停 BGM 并将进度重置到开头；会先判空以避免播放器未初始化时报错。
     * @sideEffect 修改 bgmPlayer 状态；控制台输出日志。
     */
gameEngine.stopBGM = function() {
        if (this.elements.bgmPlayer) {
            this.elements.bgmPlayer.pause();
            this.elements.bgmPlayer.currentTime = 0;
            console.log("BGM已停止播放");
        }
    };


    
    /**
     * 淡出当前BGM并播放新BGM
     * 实现平滑的BGM切换效果
     * @param {string} newBgmKey - 新BGM的键名
     * @returns {void}
     * @description
     *   若当前无 BGM 在播放，则直接加载并播放新 BGM 并推进剧情；
     *   否则在 1 秒内将旧 BGM 音量线性淡出至 0，再切换到新 BGM，
     *   最后由 setTimeout/回调调用 nextLine 推进剧情。
     * @sideEffect 修改 bgmPlayer 的 src/volume/loop 并播放；最终调用 nextLine。
     * @dependency systemModule.currentVolume / bgmVolume（可选）。
     */
gameEngine.fadeOutAndPlayBGM = function(newBgmKey) {
        const bgmPlayer = this.elements.bgmPlayer;
        
        // 查找新BGM路径
        let audioPath = null;
        if (this.sceneData.bgm && this.sceneData.bgm[newBgmKey]) {
            audioPath = this.sceneData.bgm[newBgmKey];
        }
        
        // 路径不存在时无法切换，直接推进剧情
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
            // 使用系统模块保存的音量值（主音量 * BGM通道音量）
            if (typeof systemModule !== 'undefined') {
                bgmPlayer.volume = systemModule.currentVolume * systemModule.bgmVolume;
            } else {
                bgmPlayer.volume = 1;
            }
            bgmPlayer.play().catch(error => {
                console.log("BGM播放失败:", error);
            });
            this.nextLine();
            return;
        }
        
        // 淡出参数设置：总时长 1s，分 20 步（每步约 50ms），音量每步递减固定值
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
                // 使用系统模块保存的音量值（主音量 * BGM通道音量）
                if (typeof systemModule !== 'undefined') {
                    bgmPlayer.volume = systemModule.currentVolume * systemModule.bgmVolume;
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
    };


    
    /**
     * 淡出当前BGM并播放新BGM（不调用nextLine版本）
     * 用于BGM序列中避免提前进入下一行
     * @param {string} newBgmKey - 新BGM的键名
     * @param {Function} onComplete - 完成回调
     * @returns {void}
     * @description 与 fadeOutAndPlayBGM 逻辑相同，但以 onComplete 回调替代 nextLine，
     *   供 BGM 序列内部串联多步切换、避免提前推进剧情。
     * @sideEffect 修改 bgmPlayer 状态；切换完成后调用 onComplete。
     * @dependency systemModule.currentVolume / bgmVolume（可选）。
     */
gameEngine.fadeOutAndPlayBGMNoNextLine = function(newBgmKey, onComplete) {
        const bgmPlayer = this.elements.bgmPlayer;
        let audioPath = null;
        if (this.sceneData.bgm && this.sceneData.bgm[newBgmKey]) {
            audioPath = this.sceneData.bgm[newBgmKey];
        }
        
        // 路径不存在时无法切换，直接回调结束
        if (!audioPath) {
            console.log("新BGM路径不存在:", newBgmKey);
            if (onComplete) onComplete();
            return;
        }
        
        // 当前无 BGM 或已暂停：直接加载播放新 BGM
        if (!bgmPlayer.src || bgmPlayer.paused) {
            bgmPlayer.src = audioPath;
            bgmPlayer.loop = true;
            bgmPlayer.volume = typeof systemModule !== 'undefined' ? systemModule.currentVolume * systemModule.bgmVolume : 1;
            bgmPlayer.play().catch(error => console.log("BGM播放失败:", error));
            if (onComplete) onComplete();
            return;
        }
        
        // 淡出参数：总时长 1s，分 20 步
        const fadeDuration = 1000;
        const fadeSteps = 20;
        const fadeInterval = fadeDuration / fadeSteps;
        const volumeStep = bgmPlayer.volume / fadeSteps;
        let currentStep = 0;
        
        const fadeOutInterval = setInterval(() => {
            currentStep++;
            bgmPlayer.volume = Math.max(0, bgmPlayer.volume - volumeStep);
            if (currentStep >= fadeSteps) {
                clearInterval(fadeOutInterval);
                bgmPlayer.volume = 0;
                bgmPlayer.pause();
                bgmPlayer.currentTime = 0;
                bgmPlayer.src = audioPath;
                bgmPlayer.loop = true;
                bgmPlayer.volume = typeof systemModule !== 'undefined' ? systemModule.currentVolume * systemModule.bgmVolume : 1;
                bgmPlayer.play().catch(error => console.log("新BGM播放失败:", error));
                if (onComplete) onComplete();
            }
        }, fadeInterval);
    };


    
    /**
     * 执行BGM序列（支持 [wait time] 标签）
     * 支持淡入播放：当 [wait time=XXX] 后跟着 bgm 名称时，等待完成后淡入播放
     * @param {Array} segments - 解析后的序列段
     * @returns {void}
     * @description
     *   递归式顺序执行 BGM 序列段，每段处理完通过 processNext 推进下一个：
     *   - wait 段：延时推进（并把等待时间缓存为后续 BGM 的淡入时长）；
     *   - "bgm stop[wait time=XXX]"：按指定时长淡出停止；
     *   - "bgm stop"：立即停止；
     *   - "bgm wait X"：淡出旧 BGM 并播放 X；
     *   - 普通 BGM 键：有待用淡入时长则淡入播放，否则直接播放。
     *   每步都会把 this.state.waitSequences.bgm 设置为可 skip 的对象（支持点击跳过）。
     * @sideEffect 修改 this.state.waitSequences.bgm；操作 bgmPlayer。
     * @dependency this.sceneData.bgm、fadeInBGMWithDuration、fadeOutBGMWithDuration 等。
     */
gameEngine.executeBgmSequence = function(segments) {
        let index = 0;
        let pendingFadeInDuration = 0; // 待应用的淡入时间
        
        console.log('[executeBgmSequence] 开始执行，segments:', JSON.stringify(segments));
        
        // 处理下一段（也是本序列的驱动函数）
        const processNext = () => {
            console.log('[executeBgmSequence] processNext, index:', index, 'pendingFadeInDuration:', pendingFadeInDuration);
            if (index >= segments.length) {
                console.log('[executeBgmSequence] 序列完成');
                this.state.waitSequences.bgm = null;
                return;
            }
            
            const seg = segments[index++];
            console.log('[executeBgmSequence] 处理 segment:', JSON.stringify(seg));
            
            // 处理 wait segment，保存等待时间用于后续淡入
            if (seg.type === 'wait') {
                pendingFadeInDuration = seg.duration; // 保存等待时间，用于后续bgm的淡入
                const timeoutId = setTimeout(processNext, seg.duration);
                // 注册可跳过的等待句柄：点击时会清除定时器并立即推进
                this.state.waitSequences.bgm = {
                    timeoutId,
                    skip: () => { clearTimeout(timeoutId); processNext(); }
                };
                return;
            }
            
            const bgmValue = seg.value;
            // 检查是否为 bgm stop[wait time=XXX] 格式（带淡出时间的停止）
            const stopFadeMatch = bgmValue.match(/^bgm\s+stop\[wait\s+time\s*=\s*(\d+)\s*\]$/i);
            if (stopFadeMatch) {
                const fadeDuration = parseInt(stopFadeMatch[1], 10);
                console.log('[BGM] 执行带淡出的停止，淡出时间:', fadeDuration, 'ms');
                this.fadeOutBGMWithDuration(fadeDuration, processNext);
                pendingFadeInDuration = 0; // 重置淡入时间
                return;
            }
            
            if (bgmValue === 'bgm stop') {
                // 立即停止 BGM
                this.stopBGM();
                processNext();
                pendingFadeInDuration = 0;
            } else if (bgmValue.startsWith('bgm wait ')) {
                // 淡出旧 BGM 并播放新 BGM（不推进剧情，由 processNext 继续序列）
                const newBgmKey = bgmValue.substring('bgm wait '.length).trim();
                this.fadeOutAndPlayBGMNoNextLine(newBgmKey, processNext);
                pendingFadeInDuration = 0;
            } else if (this.sceneData.bgm && this.sceneData.bgm[bgmValue]) {
                // 如果有待应用的淡入时间，使用淡入播放
                if (pendingFadeInDuration > 0) {
                    console.log('[BGM] 执行淡入播放，淡入时间:', pendingFadeInDuration, 'ms，BGM:', bgmValue);
                    this.fadeInBGMWithDuration(bgmValue, pendingFadeInDuration, processNext);
                    pendingFadeInDuration = 0;
                } else {
                    // 无淡入要求：直接播放并继续下一段
                    this.playAudio(bgmValue);
                    processNext();
                }
            } else {
                // 未识别的段：跳过并重置淡入时间
                processNext();
                pendingFadeInDuration = 0;
            }
        };
        
        // 初始化等待序列句柄，并启动序列执行
        this.state.waitSequences.bgm = { skip: processNext };
        processNext();
    };


    
    /**
     * 带指定时间的BGM淡入播放
     * 在指定时间内将音量从0平滑增加到当前配置的音量水平
     * 使用 requestAnimationFrame 实现平滑过渡
     * @param {string} bgmKey - BGM的键名
     * @param {number} fadeDuration - 淡入时间（毫秒）
     * @param {function} callback - 淡入完成后的回调函数
     * @returns {void}
     * @description
     *   暂停当前 BGM、切换到新源并以音量 0 起播，随后用 requestAnimationFrame
     *   在 fadeDuration 内将音量按 ease-in-out 缓动提升到目标音量。
     *   期间在 this.state.waitSequences.bgm 注册可中断句柄（skip 会立即跳到目标音量）。
     * @sideEffect 修改 bgmPlayer 状态；修改 this.state.waitSequences.bgm；完成后调用 callback。
     * @dependency performance.now、requestAnimationFrame、systemModule（音量）。
     */
gameEngine.fadeInBGMWithDuration = function(bgmKey, fadeDuration, callback) {
        const bgmPlayer = this.elements.bgmPlayer;
        
        // 查找BGM路径
        let audioPath = null;
        if (this.sceneData.bgm && this.sceneData.bgm[bgmKey]) {
            audioPath = this.sceneData.bgm[bgmKey];
        }
        
        // 路径不存在时无法播放，直接回调结束
        if (!audioPath) {
            console.log('[BGM] BGM路径不存在:', bgmKey);
            if (callback) callback();
            return;
        }
        
        // 获取目标音量（主音量 * BGM通道音量）
        const targetVolume = typeof systemModule !== 'undefined' ? systemModule.currentVolume * systemModule.bgmVolume : 1;
        
        console.log('[BGM] 开始淡入播放，时长:', fadeDuration, 'ms，目标音量:', targetVolume);
        
        // 先停止当前播放的BGM
        bgmPlayer.pause();
        
        // 设置新的BGM源
        bgmPlayer.src = audioPath;
        bgmPlayer.loop = true;
        bgmPlayer.volume = 0; // 从音量0开始
        
        // 开始播放（失败同样回调，避免序列卡死）
        bgmPlayer.play().catch(error => {
            console.log('[BGM] 播放失败:', error);
            if (callback) callback();
            return;
        });
        
        // 使用 requestAnimationFrame 实现平滑淡入
        const startTime = performance.now();
        let animationId = null;
        let isCompleted = false; // 防止动画与手动跳过重复完成
        
        // 每帧回调：根据已用时间计算进度并设置音量
        const animateFadeIn = (currentTime) => {
            if (isCompleted) return;
            
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / fadeDuration, 1);
            
            // 使用缓动函数使过渡更平滑（ease-in-out）
            const easedProgress = progress < 0.5 
                ? 2 * progress * progress 
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            
            bgmPlayer.volume = easedProgress * targetVolume;
            
            if (progress >= 1) {
                // 淡入完成：锁定目标音量并清理等待序列
                isCompleted = true;
                bgmPlayer.volume = targetVolume;
                console.log('[BGM] 淡入完成，当前音量:', bgmPlayer.volume);
                this.state.waitSequences.bgm = null;
                if (callback) callback();
            } else {
                animationId = requestAnimationFrame(animateFadeIn);
            }
        };
        
        animationId = requestAnimationFrame(animateFadeIn);
        
        // 设置等待序列状态，支持中断
        this.state.waitSequences.bgm = {
            animationId: animationId,
            skip: () => {
                // 中断动画：直接跳到目标音量并回调
                isCompleted = true;
                if (animationId) cancelAnimationFrame(animationId);
                bgmPlayer.volume = targetVolume;
                console.log('[BGM] 淡入被中断，立即设置为目标音量');
                if (callback) callback();
            }
        };
    };


    
    /**
     * 带指定时间的BGM淡出停止
     * 在指定时间内将音量从当前水平平滑降低至0，然后停止播放
     * 使用 requestAnimationFrame 实现平滑过渡
     * @param {number} fadeDuration - 淡出时间（毫秒）
     * @param {function} callback - 淡出完成后的回调函数
     * @returns {void}
     * @description
     *   从当前音量出发，用 requestAnimationFrame 在 fadeDuration 内按 ease-in-out
     *   缓动降到 0，然后暂停并复位进度。若当前无 BGM 播放则直接回调。
     *   期间注册可中断句柄 this.state.waitSequences.bgm（skip 会立即停止）。
     * @sideEffect 修改 bgmPlayer 状态；修改 this.state.waitSequences.bgm；完成后调用 callback。
     * @dependency performance.now、requestAnimationFrame。
     */
gameEngine.fadeOutBGMWithDuration = function(fadeDuration, callback) {
        const bgmPlayer = this.elements.bgmPlayer;
        
        // 如果当前没有播放BGM，直接执行回调
        if (!bgmPlayer.src || bgmPlayer.paused) {
            console.log('[BGM] 当前无BGM播放，跳过淡出');
            if (callback) callback();
            return;
        }
        
        console.log('[BGM] 开始淡出，时长:', fadeDuration, 'ms，当前音量:', bgmPlayer.volume);
        
        // 保存当前音量作为起始点
        const startVolume = bgmPlayer.volume;
        
        // 使用 requestAnimationFrame 实现平滑淡出
        const startTime = performance.now();
        let animationId = null;
        let isCompleted = false; // 防止动画与手动跳过重复完成
        
        // 每帧回调：按进度将音量从起始值线性降到 0
        const animateFadeOut = (currentTime) => {
            if (isCompleted) return;
            
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / fadeDuration, 1);
            
            // 使用缓动函数使过渡更平滑（ease-in-out）
            const easedProgress = progress < 0.5 
                ? 2 * progress * progress 
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            
            bgmPlayer.volume = startVolume * (1 - easedProgress);
            
            if (progress >= 1) {
                // 淡出完成：归零音量并停止播放
                isCompleted = true;
                bgmPlayer.volume = 0;
                bgmPlayer.pause();
                bgmPlayer.currentTime = 0;
                console.log('[BGM] 淡出完成，已停止播放');
                this.state.waitSequences.bgm = null;
                if (callback) callback();
            } else {
                animationId = requestAnimationFrame(animateFadeOut);
            }
        };
        
        animationId = requestAnimationFrame(animateFadeOut);
        
        // 设置等待序列状态，支持中断
        this.state.waitSequences.bgm = {
            animationId: animationId,
            skip: () => {
                // 中断动画：立即归零并停止播放
                isCompleted = true;
                if (animationId) cancelAnimationFrame(animationId);
                bgmPlayer.volume = 0;
                bgmPlayer.pause();
                bgmPlayer.currentTime = 0;
                console.log('[BGM] 淡出被中断，立即停止');
                if (callback) callback();
            }
        };
    };


    
    /**
     * 执行音频序列（支持 [wait time] 标签）
     * 点击跳过时会立即中断当前音频并播放下一个
     * @param {Array} segments - 解析后的序列段
     * @returns {void}
     * @description
     *   顺序播放语音序列：wait 段用定时器延时推进；音频段则立即中断当前语音、
     *   播放新音频，并监听其 'ended' 事件以推进下一段。
     *   每步把 this.state.waitSequences.audio 注册为可 skip 对象，
     *   点击跳过时会移除事件监听、停止当前语音并立即推进。
     * @sideEffect 操作 voicePlayer；增删 'ended' 事件监听；修改 this.state.waitSequences.audio。
     */
gameEngine.executeAudioSequence = function(segments) {
        let index = 0;
        
        // 处理下一段（序列驱动函数）
        const processNext = () => {
            // 序列结束：清理等待句柄
            if (index >= segments.length) {
                this.state.waitSequences.audio = null;
                return;
            }
            
            const seg = segments[index++];
            if (seg.type === 'wait') {
                // 等待段：定时推进，跳过时清除定时器并停止当前语音
                const timeoutId = setTimeout(processNext, seg.duration);
                this.state.waitSequences.audio = {
                    timeoutId,
                    skip: () => {
                        clearTimeout(timeoutId);
                        this.elements.voicePlayer.pause();
                        processNext();
                    }
                };
                return;
            }
            
            // 立即停止当前正在播放的语音
            this.elements.voicePlayer.pause();
            this.elements.voicePlayer.currentTime = 0;
            
            // 播放当前音频
            this.playAudio(seg.value);
            
            // 设置音频结束或点击跳过的处理
            const handleCompletion = () => {
                // 移除事件监听器以防止重复触发
                this.elements.voicePlayer.removeEventListener('ended', handleCompletion);
                processNext();
            };
            
            // 设置监听，音频结束后自动播放下一个
            this.elements.voicePlayer.addEventListener('ended', handleCompletion);
            
            // 设置跳过功能：点击时立即停止当前音频并播放下一个
            this.state.waitSequences.audio = {
                skip: () => {
                    this.elements.voicePlayer.removeEventListener('ended', handleCompletion);
                    this.elements.voicePlayer.pause();
                    this.elements.voicePlayer.currentTime = 0;
                    processNext();
                }
            };
        };
        
        // 初始化等待序列句柄，并启动序列执行
        this.state.waitSequences.audio = { skip: processNext };
        processNext();
    };


    
    /**
     * 执行音效序列（支持 [wait time] 标签）
     * 点击跳过时会立即中断当前音效并播放下一个
     * @param {Array} segments - 解析后的序列段
     * @returns {void}
     * @description
     *   顺序播放音效序列：wait 段定时推进；音效段调用 playSE 后立即推进
     *   （不等待音效播完）。每步把 this.state.waitSequences.se 注册为可 skip 对象。
     * @sideEffect 操作 sePlayer；修改 this.state.waitSequences.se。
     */
gameEngine.executeSESequence = function(segments) {
        let index = 0;
        
        // 处理下一段（序列驱动函数）
        const processNext = () => {
            // 序列结束：清理等待句柄
            if (index >= segments.length) {
                this.state.waitSequences.se = null;
                return;
            }
            
            const seg = segments[index++];
            if (seg.type === 'wait') {
                // 等待段：定时推进，跳过时清除定时器并停止当前音效
                const timeoutId = setTimeout(processNext, seg.duration);
                this.state.waitSequences.se = {
                    timeoutId,
                    skip: () => {
                        clearTimeout(timeoutId);
                        this.elements.sePlayer.pause();
                        processNext();
                    }
                };
                return;
            }
            
            // 播放音效后立即推进下一段（音效播放本身不阻塞）
            this.playSE(seg.value);
            processNext();
        };
        
        // 初始化等待序列句柄，并启动序列执行
        this.state.waitSequences.se = { skip: processNext };
        processNext();
    };

