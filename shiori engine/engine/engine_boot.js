/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 引擎启动与初始化模块（engine_boot）。
 * 负责：委托宿主（C#/WebView2）编译 DSL 剧本、引擎 init 全流程编排、
 * DOM 元素引用缓存、全局交互事件绑定（点击/右键/键盘/可见性）、
 * 右键上下文菜单的呼出收起。是引擎运行时最先执行的一批入口逻辑。
 */



    /**
     * 委托宿主端（C#/WebView2）编译剧本 DSL，并把编译结果回写到剧情对象
     * 引擎自身不做 DSL 解析，改为调用宿主 window.shioriHost.invoke('compileScene', ...)，
     * 由原生侧编译后返回逐行指令（lines），再写回 data.story[i]._dsl 供演出读取。
     *
     * @param {Object} data - 场景数据对象，须含 data.story 剧情行数组；缺失或为空时直接返回
     * @returns {void}
     * @sideEffect 修改入参 data.story[i]._dsl；可能写入 window.__shiori.dsl.lastCompile
     * @depends window.shioriHost（宿主注入的原生桥接对象，不存在时静默跳过）
     */
gameEngine.attachHostCompile = function(data) {
        // 前置校验：无剧情数据或宿主桥接不可用时不做任何事，保证纯网页环境可降级运行
        if (!data || !data.story || !data.story.length) return;
        var host = (typeof window !== 'undefined') ? window.shioriHost : null;
        if (!host || typeof host.invoke !== 'function') return;
        try {
            var file = '';
            if (typeof window !== 'undefined' && window.location && window.location.pathname)
                file = decodeURIComponent(String(window.location.pathname).replace(/^\//, ''));
            var raw = host.invoke('compileScene', JSON.stringify({ file: file, story: data.story }));
            var result = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            if (!result || !result.ok || !result.data || !result.data.lines) return;
            var lines = result.data.lines;
            for (var i = 0; i < data.story.length && i < lines.length; i++)
                data.story[i]._dsl = lines[i];
            // 每行编译结果自带 macros（本行实际展开命中的宏），F1/F2 面板按"当前行"读取，
            // 剧情推进到下一行时列表随之整体切换。此处只做一次旧宿主自检：
            if (lines.length && !Object.prototype.hasOwnProperty.call(lines[0], 'macros')) {
                // 响应里缺 lines[].macros：说明启动器早于该功能，面板只会显示 None
                console.warn('[DSL] 宿主未回报逐行宏清单（compileScene 响应缺 lines[].macros 字段）：'
                    + '当前启动器版本早于该功能，需重新编译 ShioriC# 后 F1/F2 的 Catalog 才能按当前行显示宏。');
            }
            if (typeof window !== 'undefined' && window.__shiori && window.__shiori.dsl)
                window.__shiori.dsl.lastCompile = result.data;
        } catch (e) {
            console.warn('[DSL] compileScene failed', e);
        }
    };

    /**
     * 初始化游戏引擎（场景入口总编排）
     *
     * 执行流程：
     *   1. 委托宿主编译 DSL → 缓存场景数据 → 标注源码行号范围；
     *   2. 缓存 DOM 引用、绑定全局事件、加载存档进度、标记当前场景、隐藏视频层；
     *   3. 依据会话信号恢复状态（存档加载目标 / 场景入口跳入 / 游戏状态快照）；
     *   4. startLine>0 时从历史行重建 BGM/BG/立绘等持久演出状态；
     *   5. 显示目标行对话并请求音频播放权限。
     *
     * @param {Object} data - 场景数据对象，包含 story、background、audio 等配置
     * @param {number} [startLine=0] - 起始行号；>0 表示「从当前行运行」，需重建历史状态
     * @returns {void}
     * @sideEffect 初始化 this.sceneData / this.elements，写入 sessionStorage、触发渲染与音频解锁
     * @depends systemModule、VarSpace、QuickSaveManager（均做 typeof 存在性判空）
     */
gameEngine.init = function(data, startLine = 0) {
        this.attachHostCompile(data);
        // 缓存场景数据
        this.sceneData = data;
        
        // 为每个剧情对象添加源码行号范围
        this.annotateStoryLineNumbers();
        
        // 设置起始行号
        this.state.currentLine = startLine;
        // 回放模式初始化：校验回放链、收掉残留快进、把起点锁定在存档页算出的行
        this.initReplayMode();
        // 缓存DOM元素引用
        this.cacheElements();
        // 上下文菜单开关：按页面类型（是否在 scenes/ 内）决定是否允许呼出
        this.initContextMenuSwitch();
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
        
        // ============================================================
        // 状态恢复总控：按优先级决定本次进入要用哪份快照
        //   A. archiveLoadTarget（sessionStorage）→ 玩家主动读档，最高优先级
        //   B. shiori_scene_entry_jump → 场景入口快照跳入（saves/flowchart 卡片）
        //   C. gameStateSnapshot → 当前游戏状态镜像（普通切换/返回游玩）
        // 三者互斥判断，最终得到 snapshot + isArchiveLoad 两个变量供后续分支使用
        // ============================================================
        // 检查是否有状态快照需要恢复
        // 优先从 archiveLoadTarget 获取（存档加载），其次从 gameStateSnapshot 获取（当前游戏状态）
        let snapshot = null;
        let isArchiveLoad = false;
        
        // 1. 检查存档加载目标
        try {
            const archiveLoadTargetStr = sessionStorage.getItem('archiveLoadTarget');
            if (archiveLoadTargetStr) {
                // 消费即删(无论是否匹配、是否成功恢复),杜绝跨页残留导致下次误继承 f. 镜像
                sessionStorage.removeItem('archiveLoadTarget');
                const archiveLoadTarget = JSON.parse(archiveLoadTargetStr);
                // 检查文件名是否匹配（只比较文件名，避免路径格式差异，解码URL编码的中文字符）
                const rawCurrentFile = window.location.pathname.split('/').pop();
                const currentFileName = decodeURIComponent(rawCurrentFile);
                if (archiveLoadTarget.sceneFile === currentFileName && archiveLoadTarget.snapshot) {
                    snapshot = archiveLoadTarget.snapshot;
                    isArchiveLoad = true;
                    console.log('[State Restore] Using snapshot from archiveLoadTarget:', snapshot);
                }
            }
        } catch (e) {
            console.error('[State Restore] Failed to parse archiveLoadTarget:', e);
        }

        // —— f. 入口恢复（在 gameStateSnapshot 加载之前）——
        // vars.js 的 init() 已根据信号决定是否继承 sessionStorage 镜像：
        //   - nextScene 跳转 / 读档 → 继承（vars.js 已处理）
        //   - 其他入口 → 清零（vars.js 已 clearF）
        // 此处仅处理"场景入口快照"恢复：需要 saves.html / flowchart.html 显式设置
        // shiori_scene_entry_jump 信号才执行，避免从启动器"加载指定文件"时
        // 误用 scene_entry 覆盖 vars.js 的 clearF。
        if (!isArchiveLoad) {
            var _currentFile = decodeURIComponent(window.location.pathname.split('/').pop());
            var _isNextSceneJump = false;
            try {
                var _nextTargetStr = sessionStorage.getItem('shiori_next_scene_target');
                if (_nextTargetStr) {
                    _isNextSceneJump = true;
                    sessionStorage.removeItem('shiori_next_scene_target');
                    console.log('[State Restore] nextScene jump detected, f. inherited from sessionStorage runtime mirror');
                }
            } catch (e) {}

            var _entryJumpRestored = false;
            if (!_isNextSceneJump) {
                // 仅在有显式跳入信号时才用场景入口快照恢复 f.
                // （saves.html / flowchart.html / story.html 点击场景卡片时设置 shiori_scene_entry_jump）
                // 从启动器"加载指定文件"、直接打开 URL 等无信号入口 → 不恢复，f. 保持清零
                try {
                    var _entryJumpStr = sessionStorage.getItem('shiori_scene_entry_jump');
                    if (_entryJumpStr) {
                        sessionStorage.removeItem('shiori_scene_entry_jump');
                        var _entryFvars = this.applySceneEntryFvars(_currentFile);
                        if (_entryFvars) {
                            try {
                                _entryJumpRestored = true;
                                // 同步旧 state.affinity 镜像（兼容 F1 调试面板 / 旧演出读取）
                                this.initAffinitySystem();
                                var _hasEntryF = false;
                                for (var _fk in _entryFvars) {
                                    if (Object.prototype.hasOwnProperty.call(_entryFvars, _fk)) {
                                        this.state.affinity[_fk] = _entryFvars[_fk];
                                        _hasEntryF = true;
                                    }
                                }
                                if (!_hasEntryF) this.state.affinity = {};
                                console.log('[State Restore] Restored f.* from scene entry snapshot:', _entryFvars);
                            } catch (e) {}
                        }
                    }
                } catch (e) {}
            }
        }

        // 2. 如果没有存档加载目标，检查当前游戏状态快照
        if (!snapshot) {
            snapshot = this.loadStateSnapshot();
            console.log('[State Restore] Using snapshot from gameStateSnapshot:', snapshot);
        }
        
        // 路径匹配检查（只比较文件名，解码URL编码的中文字符）
        const rawCurrentFile = window.location.pathname.split('/').pop();
        const currentFileName = decodeURIComponent(rawCurrentFile);
        const snapshotFileName = snapshot && snapshot.pagePath ? snapshot.pagePath.split('/').pop() : null;
        const pathMatch = snapshotFileName === currentFileName;

        // ★ 读档兼容保险：gameVersion 检测 + nearestLabel 兜底定位
        if (snapshot && pathMatch && isArchiveLoad) {
            // 1. gameVersion 不匹配 → 提示玩家（不阻塞，由玩家自行决定是否继续）
            var _curVer = (typeof ENGINE_VERSION !== 'undefined') ? ENGINE_VERSION : null;
            var _snapVer = snapshot.gameVersion || null;
            if (_snapVer && _curVer && _snapVer !== _curVer) {
                console.warn('[State Restore] gameVersion mismatch: snapshot=' + _snapVer + ' current=' + _curVer +
                             ' —— 此存档由旧版本创建，定位可能失效，将由玩家自行决定是否继续');
            }

            // 2. lineIndex 有效性检测：越界或失效时用 nearestLabel 兜底
            //    - lineIndex 有效 → 精确恢复到存档行（首选）
            //    - lineIndex 越界/失效 → 查找 nearestLabel，跳到标签下一行（兜底）
            var _storyLen = (this.sceneData && this.sceneData.story) ? this.sceneData.story.length : 0;
            var _lineIdx = (snapshot.currentLine != null) ? snapshot.currentLine : -1;
            var _lineValid = (_lineIdx >= 0 && _lineIdx < _storyLen);

            // 版本不一致时，lineIndex 可信度降低（剧本可能已变更），倾向用 nearestLabel 兜底
            var _versionMismatch = (_snapVer && _curVer && _snapVer !== _curVer);

            if (!_lineValid || _versionMismatch) {
                if (snapshot.nearestLabel) {
                    var _labelLine = this.findLabelLine(snapshot.nearestLabel);
                    if (_labelLine !== -1) {
                        var _targetLine = _labelLine + 1;
                        if (_targetLine < _storyLen) {
                            console.log('[State Restore] nearestLabel "' + snapshot.nearestLabel +
                                        '" located at line ' + _labelLine + ', jumping to ' + _targetLine +
                                        (_lineValid ? ' (version mismatch fallback)' : ' (invalid lineIndex fallback)'));
                            this.state.currentLine = _targetLine;
                            _lineValid = true; // 标记已恢复
                        } else {
                            console.warn('[State Restore] nearestLabel "' + snapshot.nearestLabel +
                                         '" at end of story');
                        }
                    } else {
                        console.warn('[State Restore] nearestLabel "' + snapshot.nearestLabel +
                                     '" not found in current scene');
                    }
                }
                if (!_lineValid) {
                    console.warn('[State Restore] lineIndex=' + _lineIdx +
                                 ' invalid (storyLen=' + _storyLen + '), no nearestLabel fallback');
                }
            } else {
                // lineIndex 有效且版本一致 → 精确恢复
                console.log('[State Restore] lineIndex=' + _lineIdx + ' valid, precise restore');
            }
        }

        if (snapshot && pathMatch && startLine > 0) {
            console.log('[State Restore] Detected state snapshot, restoring full state...');

            // 1. 注意：不从此处恢复systemModule的BGM/BG/Chars持久状态
            //    这些状态将由 buildStateFromHistory 从历史行（0..startLine-1）重建，
            //    以确保「从当前行运行」时获得正确的上下文状态，
            //    避免前一次运行的过期快照污染。

            // 2. 恢复引擎内部状态变量
            // 恢复全屏小说模式状态
            if (snapshot.novelMode !== undefined) {
                this.state.novelMode = snapshot.novelMode;
                console.log('[State Restore] Restored novelMode:', snapshot.novelMode);
            }
            
            // 恢复POV视角状态
            if (snapshot.povActive !== undefined) {
                this.state.povActive = snapshot.povActive;
                console.log('[State Restore] Restored povActive:', snapshot.povActive);
            }
            
            // 恢复SKIP快进状态
            if (snapshot.skipMode !== undefined) {
                this.state.skipMode = snapshot.skipMode;
                console.log('[State Restore] Restored skipMode:', snapshot.skipMode);
            }
            
            // 恢复AUTO自动推进状态
            if (typeof systemModule !== 'undefined') {
                if (snapshot.autoModeEnabled !== undefined) {
                    systemModule.autoModeEnabled = snapshot.autoModeEnabled;
                    console.log('[State Restore] Restored autoModeEnabled:', snapshot.autoModeEnabled);
                }
                if (snapshot.autoDelaySeconds !== undefined) {
                    systemModule.autoDelaySeconds = snapshot.autoDelaySeconds;
                    console.log('[State Restore] Restored autoDelaySeconds:', snapshot.autoDelaySeconds);
                }
                if (snapshot.autoShowCountdown !== undefined) {
                    systemModule.autoShowCountdown = snapshot.autoShowCountdown;
                    console.log('[State Restore] Restored autoShowCountdown:', snapshot.autoShowCountdown);
                }
                
                // 如果AUTO模式被恢复，更新UI按钮状态
                if (snapshot.autoModeEnabled) {
                    systemModule.updateAutoButton();
                    console.log('[State Restore] Updated AUTO button state');
                }
            }
            
            // 恢复点击锁定状态
            if (snapshot.isClickLocked !== undefined) {
                this.state.isClickLocked = snapshot.isClickLocked;
                console.log('[State Restore] Restored isClickLocked:', snapshot.isClickLocked);
            }
            
            // 恢复角色好感度数据
            if (snapshot.affinity) {
                this.state.affinity = snapshot.affinity;
                console.log('[State Restore] Restored affinity:', snapshot.affinity);
            }

            // 恢复 VarSpace.f. 变量空间（与 affinity 同步，跨文件/读档后保留好感度）
            if (snapshot.fVars && typeof VarSpace !== 'undefined' && VarSpace && VarSpace.restoreF) {
                try {
                    VarSpace.restoreF(snapshot.fVars);
                    console.log('[State Restore] Restored VarSpace.f.*:', snapshot.fVars);
                } catch (e) {}
            }
            
            // 恢复已完成的场景列表
            if (snapshot.completedScenes) {
                this.state.completedScenes = snapshot.completedScenes;
                console.log('[State Restore] Restored completedScenes:', snapshot.completedScenes);
            }

            // 恢复"选过的选项分支"（二周目已读标记）
            if (snapshot.readChoices) this.state.readChoices = snapshot.readChoices;

            // 3. 注意：BGM/BG/Chars的实际渲染已移至 buildStateFromHistory 中处理
            //    这里不再从快照恢复持久内容状态，避免「从当前行运行」时使用过期状态

            // 恢复全屏小说模式（实际渲染）
            if (snapshot.novelMode) {
                this.setNovelMode(true);
                console.log('[State Restore] Enabled novel mode');
            }

            // 恢复POV视角指示器（实际渲染）
            if (snapshot.povActive && snapshot.povName) {
                this.showPovIndicator(snapshot.povName);
                console.log('[State Restore] Showed POV indicator:', snapshot.povName);
            }

            // 清除快照(避免重复使用)
            sessionStorage.removeItem('gameStateSnapshot');
            sessionStorage.removeItem('archiveLoadTarget');

            console.log('[State Restore] Full state restored successfully, starting at line:', startLine);

            // 状态恢复后立即同步调试日志,基于实际渲染的立绘状态
            // 延迟一小段时间,确保 renderChars 已完成,activeChars 已更新
            setTimeout(() => {
                this.syncDebugCharsState();
                console.log('[State Restore] Debug chars state synced after state restore');
            }, 150);
        } else if (snapshot && pathMatch) {
            // startLine为0的情况,只恢复systemModule状态变量
            if (typeof systemModule !== 'undefined') {
                if (snapshot.lastActiveBgm) systemModule.lastActiveBgm = snapshot.lastActiveBgm;
                if (snapshot.lastActiveBg) systemModule.lastActiveBg = snapshot.lastActiveBg;
                if (snapshot.lastActiveChars) systemModule.lastActiveChars = snapshot.lastActiveChars;
            }
            
            // 恢复引擎内部状态变量
            if (snapshot.novelMode !== undefined) this.state.novelMode = snapshot.novelMode;
            if (snapshot.povActive !== undefined) this.state.povActive = snapshot.povActive;
            if (snapshot.isClickLocked !== undefined) this.state.isClickLocked = snapshot.isClickLocked;
            if (snapshot.activeChars) this.state.activeChars = snapshot.activeChars;
            // 经“场景入口快照”跳入时，f./affinity 已按该场景入口值恢复；
            // 不再用同场景中途离开时的旧快照覆盖（避免好感度等重复累积）
            if (!_entryJumpRestored && snapshot.affinity) this.state.affinity = snapshot.affinity;
            if (snapshot.completedScenes) this.state.completedScenes = snapshot.completedScenes;
            // 已读分支同样随快照恢复
            if (snapshot.readChoices) this.state.readChoices = snapshot.readChoices;

            // 恢复 VarSpace.f. 变量空间（与 affinity 同步，跨文件/读档后保留好感度）
            if (!_entryJumpRestored && snapshot.fVars && typeof VarSpace !== 'undefined' && VarSpace && VarSpace.restoreF) {
                try { VarSpace.restoreF(snapshot.fVars); } catch (e) {}
            }
            
            sessionStorage.removeItem('gameStateSnapshot');
            sessionStorage.removeItem('archiveLoadTarget');
            console.log('[State Restore] Restored state variables only (startLine=0)');
            
            // 状态恢复后立即同步调试日志
            setTimeout(() => {
                this.syncDebugCharsState();
                console.log('[State Restore] Debug chars state synced after state restore (startLine=0)');
            }, 150);
        }
        
        // ============================================
        // 无论路径是否匹配，都恢复AUTO和SKIP状态（全局设置）
        // ============================================
        if (snapshot) {
            // 恢复SKIP快进状态
            if (snapshot.skipMode !== undefined) {
                this.state.skipMode = snapshot.skipMode;
                console.log('[State Restore] Restored skipMode:', snapshot.skipMode);
                
                // 如果 skipMode > 0，启动快进
                if (this.state.skipMode > 0 && !this.state.fastForwardActive) {
                    console.log('[State Restore] Starting fast forward after state restore, mode:', this.state.skipMode);
                    // 延迟一点启动，确保 displayLine 完成初始化
                    setTimeout(() => {
                        this.startFastForward(this.state.skipMode);
                    }, 100);
                }
            }
            
            // 恢复AUTO自动推进状态
            if (typeof systemModule !== 'undefined') {
                if (snapshot.autoModeEnabled !== undefined) {
                    systemModule.autoModeEnabled = snapshot.autoModeEnabled;
                    console.log('[State Restore] Restored autoModeEnabled:', snapshot.autoModeEnabled);
                }
                if (snapshot.autoDelaySeconds !== undefined) {
                    systemModule.autoDelaySeconds = snapshot.autoDelaySeconds;
                    console.log('[State Restore] Restored autoDelaySeconds:', snapshot.autoDelaySeconds);
                }
                if (snapshot.autoShowCountdown !== undefined) {
                    systemModule.autoShowCountdown = snapshot.autoShowCountdown;
                    console.log('[State Restore] Restored autoShowCountdown:', snapshot.autoShowCountdown);
                }
                
                // 如果AUTO或SKIP模式被恢复，更新UI按钮状态
                if (snapshot.autoModeEnabled || snapshot.skipMode) {
                    systemModule.updateAllButtons();
                    console.log('[State Restore] Updated UI buttons for AUTO/SKIP state');
                }
            }
        }
        
        // ============================================
        // 如果 startLine > 0，始终从历史行扫描持久元素（BGM/BG/Chars）
        // 不再依赖快照恢复，确保「从当前行运行」时获得正确的上下文状态
        // ============================================
        if (startLine > 0) {
            console.log('[State Build] Building state from history lines 0-' + (startLine - 1));
            this.buildStateFromHistory(startLine);
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
    };


    /**
     * 回放模式初始化（在 init 里、起始行号确定之后调用）。
     *
     * 回放由存档页写承载键进入，vars.js 已把载荷恢复进 tf.isReplay；
     * 这里只做三件事：校验本次进入是否合法、把残留快进收干净、告知起点行。
     * 任何一步不成立都只是「静默退回普通播放」，不抛错、不弹窗。
     *
     * 起点行由 URL 的 ?startLine= 提供（engine_boot 的 startLine 机制），
     * 与读档的行级恢复走的是同一条路，因此历史演出状态会一并重建。
     *
     * @returns {boolean} 是否确实处于回放模式
     */
gameEngine.initReplayMode = function() {
        if (!this.isReplayMode()) return false;

        var rp = (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.getReplay)
            ? VarSpace.getReplay() : null;
        var file = decodeURIComponent(window.location.pathname.split('/').pop()).replace(/\.html?$/i, '');

        // 载荷不可用 / 当前文件不在回放链内 → 判定失效并清掉（玩家中途离开再进别的剧本即走这里）
        if (!rp || !Array.isArray(rp.chain) || rp.chain.indexOf(file) === -1) {
            console.log('[Replay] 载荷无效或当前文件不在回放链内，回放模式已清除: ' + file);
            try { if (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.clearReplay) VarSpace.clearReplay(); } catch (e) {}
            return false;
        }

        // 回放期禁快进：把可能残留的快进状态收干净
        try { if (this.state.fastForwardActive) this.stopFastForward(); } catch (e) { /* 忽略 */ }

        this.state._replayExitPending = false;
        console.log('[Replay] 进入回放模式: ' + (rp.title || '(无标题)') +
                    ' 链=' + rp.chain.join(' → ') + ' 起点行=' + this.state.currentLine);
        return true;
    };


    /**
     * 结束回放并返回存档页。
     *
     * 三条口径：
     *  1. 不写任何解锁记录 —— 解锁由正片跑到 isReplayEnd 时负责；
     *  2. 不还原、不覆盖 f. / sf. —— 回放期写入已被 VarSpace 冻结，没有需要还原的东西，
     *     用一份快照去覆盖真实进度反而更危险；
     *  3. 清掉 gameStateSnapshot / archiveLoadTarget 残留，避免存档页误判「从剧情页进入」
     *     而弹出智能返回框与覆盖按钮。
     *
     * @returns {void}
     */
gameEngine.returnFromReplay = function() {
        console.log('[Replay] 回放结束，返回存档页');

        // 1. 收掉快进与自动推进，避免离开瞬间还在推进剧情
        try { if (this.state.fastForwardActive) this.stopFastForward(); } catch (e) { /* 忽略 */ }
        try {
            if (typeof systemModule !== 'undefined' && systemModule.autoModeEnabled && systemModule.toggleAutoMode)
                systemModule.toggleAutoMode();
        } catch (e) { /* 忽略 */ }

        // 2. 清回放模式（含承载键）—— 不写解锁
        this.state._replayExitPending = false;
        try { if (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.clearReplay) VarSpace.clearReplay(); } catch (e) { /* 忽略 */ }

        // 3. 清快照残留：存档页靠这两个键判断「是不是从剧情页进来的」
        try {
            sessionStorage.removeItem('gameStateSnapshot');
            sessionStorage.removeItem('archiveLoadTarget');
        } catch (e) { /* 忽略 */ }

        // 4. 回存档页
        try { window.location.href = '../html/saves.html'; } catch (e) { /* 忽略 */ }
    };


    
    /**
     * 缓存DOM元素引用
     * 将所有常用的DOM元素一次性获取并存储到 this.elements，避免运行时重复查询以提升性能。
     * 引擎其余模块统一通过 this.elements.* 访问这些节点。
     *
     * 缓存前先 ensureChrome（逐元素幂等补齐骨架），缓存后若关键元素仍缺失，
     * 登记到 pendingElements 并由统一节拍重试若干次，失败后走恢复路径 ——
     * 避免「脚本比 DOM 早」导致 elements 永久为 null。
     *
     * @returns {void}
     * @sideEffect 重建 this.elements 对象（覆盖旧引用）；可能触发骨架补齐与重试登记
     */
gameEngine.cacheElements = function() {
        // 先补齐骨架（幂等）：页面只手写过部分容器时，其余容器也会被建出来
        try {
            if (typeof PageChrome !== 'undefined' && PageChrome && typeof PageChrome.ensureChrome === 'function') {
                PageChrome.ensureChrome();
            } else if (typeof window !== 'undefined' && window.PageChrome && typeof window.PageChrome.ensureChrome === 'function') {
                window.PageChrome.ensureChrome();
            }
        } catch (e) {
            console.warn('[Engine] ensureChrome failed', e);
        }
        this._cacheElementsNow();
        // 缓存后仍有缺项 → 交给节拍重试（DOM 延迟注入 / 骨架部分失败时兜底）
        this._scheduleChromeRetry();
    };

    /**
     * 实际抓取 DOM 引用（纯读取，不做任何补齐）
     * @returns {void}
     * @sideEffect 覆盖 this.elements
     */
gameEngine._cacheElementsNow = function() {
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
    };

    /**
     * 缓存后自检并登记重试。
     * 关键元素（文本容器 / 名片 / 选项容器）缺失时，最多重试 3 次（间隔 60/150/400ms），
     * 每次重试前重新 ensureChrome + 重新抓取引用；仍失败则写日志并交给 diagnoseChrome。
     *
     * @returns {void}
     * @sideEffect 可能创建定时器；可能覆盖 this.elements
     */
gameEngine._scheduleChromeRetry = function() {
        var self = this;
        var CRITICAL = ['textContainer', 'nameBox', 'textBox', 'optionsContainer'];
        function missing() {
            var e = self.elements || {};
            return CRITICAL.filter(function (k) { return !e[k]; });
        }
        if (!missing().length) return;
        var DELAYS = [60, 150, 400];
        var attempt = 0;
        function retry() {
            try {
                if (typeof PageChrome !== 'undefined' && PageChrome && PageChrome.ensureChrome) PageChrome.ensureChrome();
                else if (typeof window !== 'undefined' && window.PageChrome && window.PageChrome.ensureChrome) window.PageChrome.ensureChrome();
            } catch (e) { /* 补齐失败：继续按原引用判断 */ }
            self._cacheElementsNow();
            var miss = missing();
            if (!miss.length) {
                console.log('[Engine] chrome retry succeeded on attempt ' + (attempt + 1));
                return;
            }
            attempt++;
            if (attempt < DELAYS.length) {
                setTimeout(retry, DELAYS[attempt]);
            } else {
                console.warn('[Engine] chrome elements still missing after retries: ' + miss.join(', '));
                try {
                    if (typeof PageChrome !== 'undefined' && PageChrome && PageChrome.diagnoseChrome) {
                        console.warn('[Engine] PageChrome.diagnoseChrome → missing: ' + PageChrome.diagnoseChrome().join(', '));
                    }
                } catch (e) { /* 诊断本身失败不致命 */ }
            }
        }
        setTimeout(retry, DELAYS[0]);
    };


    
    /**
     * 隐藏存档相关菜单项（file:// 协议下）
     * 浏览器以 file 协议打开时存档功能不可用，故隐藏右键菜单中的存档项
     * （含 QuickSaveManager、saves.html 的 li）与快捷键提示中含 F5 的说明行。
     *
     * @returns {void}
     * @sideEffect 将命中的菜单项/提示行 style.display 置为 'none'
     */
gameEngine.hideArchiveMenuItems = function() {
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
    };


    
    /**
     * 绑定全局事件监听器
     * 统一注册交互相关事件：左键点击推进、右键菜单呼出、键盘按下/释放、
     * 菜单遮罩点击、菜单项捕获阶段拦截、页面可见性变化。
     * 注意：重复调用会重复绑定，应在 init 中仅调用一次。
     *
     * @returns {void}
     * @sideEffect 在 document/body/contextMenu 上注册多个事件监听器
     */
gameEngine.bindEvents = function() {
        // ============================================================
        // ① 左键点击：对话推进的主入口
        //    屏蔽优先级：日志遮罩 > 帮助弹窗 > 上下文菜单 > 点击锁定 > 背景转场
        //    未处于选项状态且未点中选项元素时：
        //      - 等待分段点击中且正在打字 → 立即补全全文（不推进）
        //      - 等待分段点击中且已打完   → 处理分段点击（进入下一段）
        //      - 否则                     → 推进到下一行
        //
        //    输入队列化：这里只入队，真正的判定与推进由统一节拍在下一帧
        //    消费。同一帧内的多次点击合并为一次。
        //    这样做的好处是「判定读到的状态」永远是本帧最新的，不会出现连点时
        //    半途状态被反复误判。
        // ============================================================
        document.body.addEventListener('click', (e) => {
            const tick = (typeof window !== 'undefined') ? window.ShioriTick : null;
            if (tick && typeof tick.pushInput === 'function') {
                tick.pushInput({ type: 'click', target: e.target });
                return;
            }
            // 节拍模块缺失（纯网页降级）：退回同步处理
            this.handleAdvanceClick({ type: 'click', target: e.target });
        });

        // 注册统一节拍的输入消费者（幂等，只注册一次）
        const tickApi = (typeof window !== 'undefined') ? window.ShioriTick : null;
        if (tickApi && typeof tickApi.setInputHandler === 'function' && !this._tickInputBound) {
            this._tickInputBound = true;
            const self = this;
            tickApi.setInputHandler(function (ev) { self.handleAdvanceClick(ev); });
        }
        
        // 右键点击事件：呼出/收起上下文菜单
        // 播放视频时由 videoPlayer 自身的 oncontextmenu（跳过视频）处理，不会冒泡到这里
        document.body.addEventListener('contextmenu', (e) => {
            // 屏蔽浏览器默认右键菜单
            e.preventDefault();
            
            // 无上下文菜单元素的页面（部分系统页）不响应
            if (!this.elements.contextMenu || !this.elements.contextMenuBackdrop) {
                return;
            }
            
            // 呼出/收起上下文菜单
            this.toggleContextMenu();
        });
        
        // ============================================================
        // ③ 键盘按下：全局快捷键分发
        //    ESC → 关日志/跳视频/呼出菜单（按当前界面状态分级）
        //    Ctrl（首次按下）→ 开始快进
        //    F5 → 快速存档（file 协议禁用，_f5Pressed 防长按重复触发）
        // ============================================================
        // 键盘按下事件：ESC键切换菜单，Ctrl键快进，F5快速存档
        document.addEventListener('keydown', (e) => {
            // 检查日志遮罩层是否显示
            const logOverlay = document.getElementById('log-overlay');
            const isLogShowing = logOverlay && logOverlay.style.display === 'flex';
            
            // 如果日志弹窗正在显示，只允许 ESC 关闭弹窗
            if (isLogShowing) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    logOverlay.style.display = 'none';
                }
                return; // 屏蔽其他所有按键
            }
            
            // 如果上下文菜单正在显示，只允许 ESC 关闭菜单，屏蔽其他按键
            const isContextMenuShowing = this.elements.contextMenu && this.elements.contextMenu.classList.contains('show');
            
            if (e.key === 'Escape') {
                e.preventDefault();
                // 上下文菜单已显示：ESC 先收起菜单
                if (isContextMenuShowing) {
                    this.toggleContextMenu();
                    return;
                }
                // 视频播放中：ESC 仅跳过视频，不呼出上下文菜单
                if (this.elements.videoPlayer && this.elements.videoPlayer.style.display === 'block') {
                    this.skipVideo();
                    return;
                }
                // 普通剧情状态：ESC 呼出上下文菜单
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
                
        // ============================================================
        // ④ 键盘释放：Ctrl 抬起停止快进；F5 抬起重置防抖标记并启动存档冷却
        // ============================================================
        // 键盘释放事件：停止快进，重置 F5 防抖标记
        document.addEventListener('keyup', (e) => {
            // 检查日志弹窗是否显示
            const logOverlay = document.getElementById('log-overlay');
            const isLogShowing = logOverlay && logOverlay.style.display === 'flex';
            
            // 如果日志弹窗正在显示，屏蔽键盘释放事件
            if (isLogShowing) {
                return;
            }
            
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
        
        // ============================================================
        // ⑤ 右键菜单项点击拦截（捕获阶段）
        //    场景 HTML 中菜单项带 onclick="window.location.href=..." 等直接跳转，
        //    不经过 goToScene，故须在捕获阶段先停 SKIP/AUTO 并存快照，
        //    确保跳去 archive/flowchart/saves/story 后能回到「返回当前游玩」
        // ============================================================
        // 右键菜单项点击拦截（捕获阶段）- 导航到系统页面前停止 SKIP/AUTO
        // 场景 HTML 中的 context-menu 有 onclick="window.location.href=..." 等直接跳转，
        // 这些跳转不经过 goToScene，需要在捕获阶段提前拦截
        if (this.elements.contextMenu) {
            this.elements.contextMenu.addEventListener('click', (e) => {
                var li = e.target.closest('li');
                if (!li) return;
                var onclickAttr = li.getAttribute('onclick') || '';
                // 检测是否为导航类操作（window.location.href 或 openArchivePage）
                if (onclickAttr.indexOf('window.location.href') !== -1 ||
                    onclickAttr.indexOf('openArchivePage') !== -1) {
                    if (typeof systemModule !== 'undefined' && systemModule.stopAllAutoSkipModes) {
                        systemModule.stopAllAutoSkipModes();
                    }
                    // 自动保存游戏状态快照，确保所有存档相关页面（archive/flowchart/saves/story）
                    // 都能检测到"返回当前游玩"按钮
                    this.saveStateSnapshot();
                }
            }, true); // true = 捕获阶段，在 inline onclick 之前执行
        }
        
        // ============================================================
        // ⑥ 页面可见性变化：C# 原生窗口（设置/帮助等）打开时页面转 hidden，
        //    此时强制停止 SKIP/AUTO，避免在后台继续空跑剧情
        // ============================================================
        // 页面可见性变化事件 - C# 窗口打开时停止 SKIP/AUTO
        // WebView2 中，当 C# 原生窗口（设置、帮助等）打开时页面会变为 hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (typeof systemModule !== 'undefined' && systemModule.stopAllAutoSkipModes) {
                    systemModule.stopAllAutoSkipModes();
                    console.log('[State] Stopped SKIP/AUTO on page hide (C# window opened)');
                }
            }
        });
    };

    /**
     * 处理一次「推进点击」（输入消费 / 动画屏蔽）。
     *
     * 由统一节拍（window.ShioriTick）在帧内调用，也可由缺失节拍时的同步降级路径直接调用。
     * 把「判定」与「事件派发」解耦：本方法只做判定与推进，事件注册在 bindEvents 中。
     *
     * @param {Object} ev - { type:'click', target: Element }
     * @returns {void}
     * @sideEffect 可能补全打字机文本、推进分行、或调用 nextLine
     */
gameEngine.handleAdvanceClick = function(ev) {
        var target = ev && ev.target;

        // 如果日志遮罩层正在显示，屏蔽点击事件
        var logOverlay = document.getElementById('log-overlay');
        if (logOverlay && logOverlay.style.display === 'flex') return;

        // 如果帮助弹窗正在显示，屏蔽点击事件
        var helpOverlay = document.getElementById('help-overlay');
        if (helpOverlay && helpOverlay.style.display === 'flex') return;

        // 如果上下文菜单正在显示，屏蔽所有点击事件
        if (this.elements.contextMenu && this.elements.contextMenu.classList.contains('show')) return;

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

        // 立绘动画进行中：默认「先落终态再推进」，可配为 ignore。
        var anim = (typeof window !== 'undefined') ? window.ShioriCharAnim : null;
        if (anim && typeof anim.getMoveCount === 'function') {
            var pending = 0;
            try { pending = anim.getMoveCount() || 0; } catch (e) { pending = 0; }
            if (pending > 0 && !this.state.fastForwardActive) {
                if ((this.state.charAnimClickPolicy || 'settle') === 'ignore') {
                    console.log('[点击屏蔽] 立绘动画进行中，本次点击忽略（策略=ignore）');
                    return;
                }
                if (typeof anim.finishAll === 'function') anim.finishAll();
            }
        }

        if (this.state.choicesActive || this.isOptionElement(target)) return;

        if (this.state.waitingForSegmentClick) {
            if (this.state.typingActive) {
                // 正在打字：立即补全全文（不推进）
                this.finishTypingNow();
                return;
            }
            this.handleSegmentClick();
        } else {
            this.nextLine();
        }
    };

    /**
     * 立即终止打字机并补全当前应显示的全部文本（不改变行号）。
     * 被「点击补全」「右键隐藏」「存档快照」三条链路共用，避免三份近似实现漂移。
     *
     * @returns {void}
     * @sideEffect 摘掉节拍里的打字 handler、清定时器、写满目标文本框、复位音频分段状态
     */
gameEngine.finishTypingNow = function() {
        if (!this.state.typingActive) return;
        if (typeof window !== 'undefined' && window.ShioriTick && window.ShioriTick.removeContinuousHandler && this._typewriterStep) {
            window.ShioriTick.removeContinuousHandler(this._typewriterStep);
        }
        if (this.state.typingTimerId !== null && this.state.typingTimerId !== undefined) {
            clearTimeout(this.state.typingTimerId);
            this.state.typingTimerId = null;
        }
        this.state.typingActive = false;

        var targetBox = this.state.novelMode ? this.elements.novelTextBox : this.elements.textBox;
        if (!targetBox) return;
        var fullText = '';
        if (this.state.textSegments) {
            for (var i = 0; i <= this.state.currentSegment; i++) fullText += this.state.textSegments[i];
        } else {
            var currentLine = (this.sceneData && this.sceneData.story) ? this.sceneData.story[this.state.currentLine] : null;
            if (currentLine && currentLine.text) {
                fullText = this.processRubyText(currentLine.text);
                fullText = this.processLineBreaks(fullText);
            }
        }
        targetBox.innerHTML = fullText;
        this.state.textFullyDisplayed = true;
        this.state.audioSegments = null;
        this.state.currentAudioSegment = 0;
        // 补全即"打字结束"，高亮态与 _runTypewriter 的 finish() 保持一致
        this._setTextboxHL(false, 'read');
        this._setTextboxHL(true, 'wait');
    };



    /**
     * 切换右键上下文菜单的显示/隐藏
     * 呼出时把 F2 变量观察面板压到菜单之下（zIndex 9990），
     * 收起时还原 F2 层级（9999），避免面板遮挡菜单。
     *
     * 入口按页面类型收敛 —— 只有剧本页（isInScenesFolder()）允许呼出。
     * 非剧本页（html/CG.html、标题页、鉴赏页等）维持「隐藏」这一刻意设计，
     * 因此这里直接静默返回，不再告警。
     *
     * @returns {void}
     * @sideEffect 切换 contextMenu 的 'show' 类与背景遮罩 display，并调整 varsPanel 的 zIndex
     * @depends this.elements.contextMenu / contextMenuBackdrop（缺失时告警返回）
     */
gameEngine.toggleContextMenu = function() {
        if (!this.elements.contextMenu || !this.elements.contextMenuBackdrop) {
            console.warn('上下文菜单元素未找到');
            return;
        }

        // 页面类型闸门：非剧本页不呼出（保持产品原有的隐藏行为）
        if (!this.isContextMenuEnabled()) {
            return;
        }

        // F2 变量观察面板（z-index:9999，后插入 DOM，会盖住同层级的菜单）
        // 呼出菜单时将其层级让给菜单（被遮挡），关闭时还原
        var varsPanel = (typeof systemModule !== 'undefined' && systemModule.varsPanel)
            ? systemModule.varsPanel
            : document.getElementById('vars-panel');
        
        if (this.elements.contextMenu.classList.contains('show')) {
            // 隐藏菜单
            this.elements.contextMenu.classList.remove('show');
            this.elements.contextMenuBackdrop.style.display = 'none';
            if (varsPanel) {
                varsPanel.style.zIndex = '9999'; // 还原 F2 层级
            }
            this._syncChromeMenuState(false);
        } else {
            // 显示菜单，先把 F2 压到菜单之下
            if (varsPanel) {
                varsPanel.style.zIndex = '9990';
            }
            this.elements.contextMenu.classList.add('show');
            this.elements.contextMenuBackdrop.style.display = 'block';
            this._syncChromeMenuState(true);
        }
    };

    /**
     * 把「菜单展开态」同步给 UI 状态仓库（DOM 只是投影）。
     * PageChrome 不存在时静默跳过（纯网页测试环境）。
     * @param {boolean} open 是否展开
     * @returns {void}
     */
gameEngine._syncChromeMenuState = function(open) {
        try {
            var pc = (typeof PageChrome !== 'undefined' && PageChrome) ? PageChrome
                : (typeof window !== 'undefined' ? window.PageChrome : null);
            if (pc && typeof pc.setMenuOpen === 'function') pc.setMenuOpen(!!open);
        } catch (e) { /* 状态同步失败不影响菜单本身 */ }
    };

    /**
     * 是否允许呼出上下文菜单。
     * 判定条件 = 当前位于 scenes/ 目录内。剧本页保持可用（右键入口已验证可用，属回归项，
     * 不得回退）；其余页面维持隐藏。
     *
     * 未初始化时给出「按页面类型即时判定」的兜底，保证任何调用时序下都得到正确结果。
     *
     * @returns {boolean} true 表示允许呼出
     */
gameEngine.isContextMenuEnabled = function() {
        var v = this.state ? this.state.contextMenuEnabled : undefined;
        if (typeof v === 'boolean') return v;
        try {
            if (typeof this.isInScenesFolder === 'function') return !!this.isInScenesFolder();
        } catch (e) { /* 路径判定失败：保守拒绝 */ }
        return false;
    };

    /**
     * 初始化上下文菜单开关。
     * 在 init() 中调用一次；也可在页面切换后手动重算。
     * @returns {boolean} 初始化后的开关值
     * @sideEffect 写入 state.contextMenuEnabled
     */
gameEngine.initContextMenuSwitch = function() {
        var enabled = false;
        try {
            enabled = (typeof this.isInScenesFolder === 'function') ? !!this.isInScenesFolder() : false;
        } catch (e) { enabled = false; }
        this.state.contextMenuEnabled = enabled;
        console.log('[Engine] contextMenuEnabled = ' + enabled + ' (isInScenesFolder)');
        return enabled;
    };


// 添加CSS动画
// 顶层副作用：向 <head> 注入快速存档提示的上滑动画（slideUp）。
// 以 id 幂等判重，避免脚本重复加载时注入重复样式。
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
