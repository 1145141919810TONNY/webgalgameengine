/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 存读档与状态管理模块：负责场景进度标记（completedScenes）、游戏进度持久化（localStorage）、
 * 运行状态快照（sessionStorage，含缩略图采集与 f. 变量空间）、场景入口快照，
 * 以及基于历史行回溯重建 BGM/BG/立绘状态；另提供 QuickSaveManager 快速存档管理器。
 */



    /**
     * 标记当前场景为已完成
     * 
     * 将当前页面文件名添加到 completedScenes 并保存。
     * 仅当当前页面位于 scenes/ 目录内时才记录，以过滤 CG.html、archive.html 等系统页面。
     * 
     * @returns {void}
     * @sideeffect 首次完成时向 this.state.completedScenes 追加文件名并调用 saveProgress() 写入 localStorage
     */
gameEngine.markSceneCompleted = function() {
        // 回放期冻结进度写入：回放是「重看」，不得改写任何进度数据
        if (this.isReplayMode()) return;
        // 过滤非场景页面（如 CG.html、archive.html 等），避免污染进度数据
        if (!this.isInScenesFolder()) {
            return;
        }
        // 获取当前页面文件名（解码URL编码的中文字符）
        const rawPage = window.location.pathname.split('/').pop();
        const currentPage = decodeURIComponent(rawPage);

        // 如果未记录，则添加并保存
        if (!this.state.completedScenes.includes(currentPage)) {
            this.state.completedScenes.push(currentPage);
            this.saveProgress();
        }
    };


    
    /**
     * 保存游戏进度到 localStorage
     * 
     * 将已完成场景列表、时间戳、好感度(gameState.affinity)封装为 gameProgress 写入本地存储，
     * 并通知宿主层存储已更新。
     * 
     * @returns {void}
     * @sideeffect 写入 localStorage['gameProgress']；调用 notifyStorageOperation('UPDATE', ...)
     */
gameEngine.saveProgress = function() {
        // 回放期冻结进度写入
        if (this.isReplayMode()) return;
        const progressData = {
            completedScenes: this.state.completedScenes,
            // 选过的分支（二周目已读标记）
            readChoices: this.state.readChoices || {},
            timestamp: Date.now(),
            gameState: {
                affinity: this.state.affinity
            }
        };
        
        localStorage.setItem('gameProgress', JSON.stringify(progressData));
        console.log('进度已保存:', progressData);
        
        // 通知宿主层：游戏进度已更新
        this.notifyStorageOperation('UPDATE', 'gameProgress', 'localStorage');
    };


    
    /**
     * 从 localStorage 加载游戏进度
     * 
     * 读取并解析 gameProgress，成功时同步恢复 completedScenes 与 affinity，解析失败捕获异常并返回 null。
     * 
     * @returns {Object|null} - 加载的进度数据，不存在或解析失败返回 null
     * @sideeffect 成功时覆写 this.state.completedScenes 与 this.state.affinity
     */
gameEngine.loadProgress = function() {
        const progressData = localStorage.getItem('gameProgress');
        if (progressData) {
            try {
                const data = JSON.parse(progressData);
                this.state.completedScenes = data.completedScenes || [];
                // 恢复"选过的分支"。老存档没有这个字段 → 空对象，不影响已读判定
                this.state.readChoices = data.readChoices || {};
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
    };


    
    /**
     * 检查指定场景是否已完成
     * @param {string} sceneFileName - 场景文件名
     * @returns {boolean} - 是否已完成
     */
gameEngine.isSceneCompleted = function(sceneFileName) {
        return this.state.completedScenes.includes(sceneFileName);
    };


    
    /**
     * 获取已完成场景列表的副本
     * @returns {Array} - 已完成场景文件名数组
     */
gameEngine.getCompletedScenes = function() {
        return [...this.state.completedScenes]; 
    };


    
    /**
     * 重置游戏进度
     * 
     * 清除所有存档数据：清空已完成场景、已读分支与好感度，并移除 localStorage 中的 gameProgress。
     * 
     * @returns {void}
     * @sideeffect 覆写 this.state.completedScenes/readChoices/affinity；删除 localStorage['gameProgress']
     */
gameEngine.resetProgress = function() {
        this.state.completedScenes = [];
        this.state.readChoices = {};     // ：连"选过的分支"一起清，否则二周目仍显示已读
        this.state.affinity = {};
        localStorage.removeItem('gameProgress');
        console.log('进度已重置');
    };


    
    /**
     * 保存当前场景标记
     * 
     * 记录玩家已进入过的场景，用于进度追踪。仅当当前页面位于 scenes/ 目录内时才记录。
     * 以页面文件名（去 .html）作为 sceneId，始终刷新 visited 与 lastAccessTime（即使已存在）。
     * 
     * @returns {void}
     * @sideeffect 读取并写回 localStorage['gameProgress']，更新 sceneMarkers 与全局 timestamp
     */
gameEngine.saveCurrentSceneMarker = function() {
        // 回放期冻结进度写入：否则回放一遍就会把「已访问」时间戳等标记刷新掉
        if (this.isReplayMode()) return;
        // 过滤非场景页面（如 CG.html、archive.html 等），避免污染进度数据
        if (!this.isInScenesFolder()) {
            return;
        }
        // 获取当前页面文件名作为场景ID
        // 注意：window.location.pathname可能包含URL编码的中文字符，需要解码
        const rawPage = window.location.pathname.split('/').pop();
        const currentPage = decodeURIComponent(rawPage);
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
    };


    
    /**
     * 获取默认进度数据
     * 
     * 用于进度缺失或读取失败时的兜底初始化，其中 gameState.affinity 引用当前内存状态。
     * 
     * @returns {Object} - 包含 completedScenes、timestamp、gameState、sceneMarkers 的默认对象
     */
gameEngine.getDefaultProgressData = function() {
        return {
            completedScenes: [],
            readChoices: {},
            timestamp: Date.now(),
            gameState: {
                affinity: this.state.affinity
            },
            sceneMarkers: {}
        };
    };



    /**
     * 捕获当前剧本画面的缩略图数据
     * 从实际渲染的 DOM 中提取背景图 URL 与所有立绘 img 元素的 src/样式，
     * bg 与 CG 一视同仁（均通过实际解析后的 URL 获取），
     * 供存档页重建"剧本形态"缩略图（而非截取存档页自身画面）。
     * 
     * 采集顺序：优先采集合成立绘舞台（#char-stage，需先 _paintCharStage 并已 painted）；
     * 否则遍历 .character-layered 分组采集 img/canvas；最后兜底采集容器直系 img（旧版单图立绘）。
     * @returns {Object|null} - 缩略图数据对象 {bg, bgCss, chars, capturedAt}，无背景且无立绘时返回 null
     * @depends this.elements.backgroundContainer / this.elements.characterContainer；canvas.toDataURL 可能因跨域抛错
     */
gameEngine.captureThumbnail = function() {
        try {
            if (!this.elements || !this.elements.backgroundContainer) {
                return null;
            }

            // 1. 提取背景图：从 backgroundContainer 的内联样式中取出
            //    backgroundImage 形如 url("...") 或 url(...)，统一解析出纯 URL
            const bgContainer = this.elements.backgroundContainer;
            const bgImageRaw = bgContainer.style.backgroundImage || '';
            const bgMatch = bgImageRaw.match(/url\(["']?([^"')]+)["']?\)/i);
            const bgUrl = bgMatch ? bgMatch[1] : null;

            // 背景图额外样式（保证 contain/center 等呈现一致）
            const bgExtraCss = [
                bgContainer.style.backgroundSize ? 'background-size:' + bgContainer.style.backgroundSize : '',
                bgContainer.style.backgroundPosition ? 'background-position:' + bgContainer.style.backgroundPosition : '',
                bgContainer.style.backgroundRepeat ? 'background-repeat:' + bgContainer.style.backgroundRepeat : '',
                bgContainer.style.backgroundColor ? 'background-color:' + bgContainer.style.backgroundColor : ''
            ].filter(Boolean).join(';');

            // 2. 提取立绘：按容器分组采集
            //    新版立绘：.character-layered > canvas|img.char-composite（JS blit 或 /char-frame）
            //    旧版单图立绘：直接 <img class="character-img">，无包裹容器
            //    每组 charGroup 包含容器样式（parentCssText）和子 img 列表（imgs）
            const chars = [];
            if (this.elements.characterContainer) {
                const container = this.elements.characterContainer;

                // 分支一：合成舞台模式（#char-stage），需先实时重绘保证 canvas 内容为最新
                const stageCanvas = container.querySelector('#char-stage');
                let usedStage = false;
                if (container.classList.contains('char-stage-on') && stageCanvas) {
                    if (typeof this._paintCharStage === 'function') this._paintCharStage();
                }
                if (container.classList.contains('char-stage-on')
                    && stageCanvas && stageCanvas.dataset.painted === '1') {
                    let src = '';
                    try { src = stageCanvas.toDataURL('image/png'); } catch (e) { src = ''; }
                    if (src) {
                        var boxH = container.clientHeight || 0;
                        var ratio = (boxH > 0 && stageCanvas.height > 0)
                            ? (stageCanvas.height / boxH) : 1;
                        if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
                        var stageCss = 'position:absolute;left:0;bottom:0;top:auto;width:100%;height:'
                            + (ratio * 100) + '%;';
                        chars.push({
                            parentCssText: stageCss,
                            parentClass: 'char-stage',
                            imgs: [{
                                src: src,
                                cssText: stageCss,
                                className: 'char-stage'
                            }]
                        });
                        usedStage = true;
                    }
                }
                if (!usedStage) {
                    container.querySelectorAll('.character-layered').forEach(layered => {
                    const group = {
                        parentCssText: layered.style.cssText || '',
                        parentClass: 'character-layered',
                        imgs: []
                    };
                    layered.querySelectorAll('img, canvas.char-composite').forEach(el => {
                        let src = '';
                        if (el.classList && el.classList.contains('char-composite')
                            && el.dataset.charDiffBlit !== '1') return;
                        if (el.tagName === 'CANVAS') {
                            try { src = el.toDataURL('image/png'); } catch (e) { return; }
                        } else {
                            src = el.src;
                        }
                        if (!src) return;
                        group.imgs.push({
                            src: src,
                            cssText: el.style.cssText || '',
                            className: el.className || ''
                        });
                    });
                    if (group.imgs.length > 0) {
                        chars.push(group);
                    }
                    });
                }

                // 旧版：直接在 characterContainer 下的 img（不属于任何 .character-layered）
                container.querySelectorAll(':scope > img').forEach(img => {
                    if (!img.src) return;
                    chars.push({
                        parentCssText: '',
                        parentClass: 'character-img',
                        imgs: [{
                            src: img.src,
                            cssText: img.style.cssText || '',
                            className: img.className || ''
                        }]
                    });
                });
            }

            // 没有背景也没有立绘则视为无可用画面
            if (!bgUrl && chars.length === 0) {
                return null;
            }

            return {
                bg: bgUrl,
                bgCss: bgExtraCss,
                chars: chars,
                // 记录采集时间，便于排序/调试
                capturedAt: Date.now()
            };
        } catch (e) {
            console.warn('[State Snapshot] captureThumbnail failed:', e);
            return null;
        }
    };



    /**
     * 保存当前游戏状态的完整快照
     * 
     * 用于从存档页精确返回时恢复状态。快照包含剧情进度、预览文本、SKIP/AUTO 状态、
     * 持久化 BGM/BG/立绘、小说模式与 POV、立绘详情、缩略图、好感度、f. 变量空间、
     * 版本号与最近标签锚点等。写入 sessionStorage。
     * 
     * @returns {void}
     * @sideeffect 写入 sessionStorage['gameStateSnapshot']；内部调用 captureThumbnail() 采集画面
     */
gameEngine.saveStateSnapshot = function() {
        // 回放期不写状态快照：回放位置没有存档价值，
        // 写进去反而会让返回存档页时多出一份待清理的残留。
        if (this.isReplayMode()) return;
        // 生成预览文本 - 优先从当前显示的文本片段获取，其次从剧情数据获取
        let previewText = '';
        
        // 1. 尝试从文本片段获取（逐字显示时）
        if (this.state.textSegments && this.state.textSegments.length > 0) {
            previewText = this.state.textSegments.join('');
        } 
        // 2. 尝试从当前行数据获取
        else if (this.sceneData && this.sceneData.story && this.sceneData.story[this.state.currentLine]) {
            const currentLine = this.sceneData.story[this.state.currentLine];
            if (currentLine && currentLine.text) {
                previewText = currentLine.text;
            }
        }
        // 3. 尝试从currentData获取（兼容旧代码）
        else if (this.currentData && this.currentData.text) {
            previewText = this.currentData.text;
        }
        
        // 提取POV视角名称（从 povIndicator DOM元素中提取）
        let povName = null;
        if (this.state.povActive && this.state.povIndicator) {
            const povText = this.state.povIndicator.textContent;
            // 格式: "当前叙事视角 XXX"
            const match = povText.match(/当前叙事视角\s+(.+)/);
            if (match) {
                povName = match[1];
            }
        }
        
        const snapshot = {
            // 基本信息
            pageUrl: window.location.href,
            // 解码URL编码的中文路径
            pagePath: decodeURIComponent(window.location.pathname),
            
            // 剧情进度
            currentLine: this.state.currentLine,
            
            // 当前显示的文本（用于存档预览）
            previewText: previewText,
            
            // SKIP快进状态
            skipMode: this.state.skipMode,
            fastForwardActive: this.state.fastForwardActive,
            
            // AUTO自动推进状态
            autoModeEnabled: (typeof systemModule !== 'undefined') ? systemModule.autoModeEnabled : false,
            autoDelaySeconds: (typeof systemModule !== 'undefined') ? systemModule.autoDelaySeconds : 3,
            autoShowCountdown: (typeof systemModule !== 'undefined') ? systemModule.autoShowCountdown : true,
            
            // 持久化状态(由systemModule维护)
            lastActiveBgm: (typeof systemModule !== 'undefined') ? systemModule.lastActiveBgm : null,
            lastActiveBg: (typeof systemModule !== 'undefined') ? systemModule.lastActiveBg : null,
            lastActiveChars: (typeof systemModule !== 'undefined') ? systemModule.lastActiveChars : null,
            
            // 全屏小说模式状态
            novelMode: this.state.novelMode,
            
            // POV视角状态
            povActive: this.state.povActive,
            povName: povName,

            // 点击锁定状态
            isClickLocked: this.state.isClickLocked,

            // 当前激活的立绘状态（详细）
            activeChars: this.state.activeChars,

            // 缩略图数据：从当前 DOM 提取背景图与立绘元素的呈现信息，
            // 供存档页（archive.html）重建"剧本形态"缩略图（背景图+立绘叠加），
            // 而非截取存档页自身画面。bg/CG 一视同仁，均通过实际渲染的 URL 解析。
            thumbnail: this.captureThumbnail(),

            // 角色好感度数据
            affinity: this.state.affinity,

            // VarSpace.f. 变量空间快照（与 affinity 同步，供跨文件/读档恢复）
            fVars: (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.serializeF)
                ? VarSpace.serializeF() : null,

            // ★ 游戏版本号（读档时检测剧本更新兼容性）
            gameVersion: (typeof ENGINE_VERSION !== 'undefined') ? ENGINE_VERSION : null,

            // ★ 最近的标签锚点（command: "[xxx]" 形式，剧本更新后定位兜底）
            nearestLabel: this.state.nearestLabel || null,

            // ★ 标签对应行号（标签查找失败时回退用 lineIndex）
            nearestLabelLine: (this.state.nearestLabelLine != null) ? this.state.nearestLabelLine : null,

            // 已完成的场景列表
            completedScenes: this.state.completedScenes,

            // 已选过的选项分支（键=场景#行号#下标；缺失时按空对象兜底）
            readChoices: this.state.readChoices || {},

            // 时间戳
            timestamp: Date.now()
        };

        sessionStorage.setItem('gameStateSnapshot', JSON.stringify(snapshot));
        console.log('[State Snapshot] Saved:', snapshot);
    };



    /**
     * 写入场景入口快照（localStorage.shiori_scene_entry_<sceneFile>）
     * 所有“正常剧本流程”跨文件跳转（nextScene / choice / 静默分支，均经 goToScene）
     * 离开当前场景前统一调用，记录进入目标场景那一刻的 f.。
     * 每个场景文件只保留一条记录：再次自然进入时 f. 相同 → 不改变；不同 → 覆盖。
     * 该 json 被 saves.html / flowchart.html / story.html 等“从场景开头播放”的
     * 存档系统读取（经 shiori_scene_entry_jump 信号 + engine.js init 恢复），
     * 与 archive.html 的行级读档（archiveLoadTarget + snapshot.fVars）相互独立。
     * @param {string} targetScene - 目标场景（含 .html / 路径）
     * @returns {void}
     * @sideeffect 写入 localStorage['shiori_scene_entry_<sceneFile>']；f. 未变化时保持原记录不覆盖
     */
gameEngine.writeSceneEntrySnapshot = function(targetScene) {
        // 回放期不写场景入口快照：这份记录是给「正片再次进入时恢复 f.」用的，
        // 回放的数据是基线副本，写进去会把真实入口记录冲掉。
        if (this.isReplayMode()) return;
        // 深比较辅助（键序无关）：判断两次进入同一场景的 f. 是否一致
        function _stableClone(v) {
            if (Array.isArray(v)) return v.map(_stableClone);
            if (v && typeof v === 'object') {
                var r = {};
                Object.keys(v).sort().forEach(function(k) { r[k] = _stableClone(v[k]); });
                return r;
            }
            return v;
        }
        try {
            // 提取目标场景文件名（与 archiveLoadTarget 一致的格式：仅文件名）
            var sceneFile = targetScene;
            var slashIdx = sceneFile.lastIndexOf('/');
            if (slashIdx !== -1) sceneFile = sceneFile.substring(slashIdx + 1);
            var qIdx = sceneFile.indexOf('?');
            if (qIdx !== -1) sceneFile = sceneFile.substring(0, qIdx);
            var hIdx = sceneFile.indexOf('#');
            if (hIdx !== -1) sceneFile = sceneFile.substring(0, hIdx);

            var fVars = (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.serializeF)
                ? VarSpace.serializeF() : null;
            var entry = {
                fVars: fVars,
                fromScene: decodeURIComponent(window.location.pathname.split('/').pop()),
                fromLine: this.state.currentLine,
                timestamp: Date.now(),
                gameVersion: (typeof ENGINE_VERSION !== 'undefined') ? ENGINE_VERSION : null
            };
            var key = 'shiori_scene_entry_' + sceneFile;

            // ★ 每个场景文件只保留一条入口记录；再次经正常流程进入时：
            //   - 本次 f. 与已存记录相同 → 不改变存档（同一路径再次进入）
            //   - 本次 f. 与已存记录不同 → 覆盖（可视为从不同选项 / 分支进入）
            // 读取已存入口记录，做「键序无关」的 f. 深比较，判定是否为同一路径再次进入
            var _sameF = false;
            try {
                var _prevRaw = localStorage.getItem(key);
                if (_prevRaw) {
                    var _prev = JSON.parse(_prevRaw);
                    _sameF = !!(_prev && _prev.fVars && fVars &&
                        JSON.stringify(_stableClone(_prev.fVars)) === JSON.stringify(_stableClone(fVars)));
                }
            } catch (e) { _sameF = false; }

            if (_sameF) {
                console.log('[Scene Entry] f.* unchanged for', sceneFile, '- keep existing entry snapshot');
                return;
            }
            localStorage.setItem(key, JSON.stringify(entry));
            console.log('[Scene Entry] Wrote entry snapshot for', sceneFile, entry);
        } catch (e) {
            console.error('[Scene Entry] Failed to write entry snapshot:', e);
        }
    };



    /**
     * 读取场景入口快照中的 fVars
     * @param {string} sceneFile - 当前场景文件名
     * @returns {Object|null} - fVars 对象，不存在或解析失败返回 null
     */
gameEngine.loadSceneEntryFvars = function(sceneFile) {
        try {
            var key = 'shiori_scene_entry_' + sceneFile;
            var s = localStorage.getItem(key);
            if (!s) return null;
            var entry = JSON.parse(s);
            return (entry && entry.fVars) ? entry.fVars : null;
        } catch (e) {
            console.error('[Scene Entry] Failed to load entry snapshot:', e);
            return null;
        }
    };

    /**
     * 应用场景入口 f.：有记录则 restoreF；无记录则按约定清空。
     * 「从头开始」/saves/flowchart 置 shiori_scene_entry_jump 后由 engine_boot.init 调用。
     * 未记录必须载入为未记录，杜绝残留 shiori_f_runtime / 继承信号导致的数值叠加。
     * @param {string} sceneFile - 当前场景文件名
     * @returns {Object|null} 恢复的 fVars；无记录或解析失败返回 null
     * @sideeffect 有记录时调用 VarSpace.restoreF；无记录时调用 VarSpace.clearF 并移除 shiori_f_runtime
     */
gameEngine.applySceneEntryFvars = function(sceneFile) {
        var fVars = this.loadSceneEntryFvars(sceneFile);
        if (fVars) {
            if (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.restoreF) {
                try { VarSpace.restoreF(fVars); } catch (e) {}
            }
            return fVars;
        }
        try {
            if (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.clearF) VarSpace.clearF();
            sessionStorage.removeItem('shiori_f_runtime');
            console.log('[State Restore] No scene entry snapshot, cleared f.* ');
        } catch (e) {}
        return null;
    };



    /**
     * 从 sessionStorage 加载状态快照
     * 
     * 读取并解析 gameStateSnapshot，供返回游玩/读档恢复时使用；不存在或解析失败返回 null。
     * 
     * @returns {Object|null} - 状态快照对象，不存在则返回 null
     */
gameEngine.loadStateSnapshot = function() {
        try {
            const snapshotStr = sessionStorage.getItem('gameStateSnapshot');
            if (snapshotStr) {
                return JSON.parse(snapshotStr);
            }
        } catch (e) {
            console.error('[State Snapshot] Failed to load:', e);
        }
        return null;
    };


    
    /**
     * 从历史行构建持久状态（用于「从当前行运行」等场景）
     * 
     * 扫描 story[0..startLine-1]，提取最后生效的 BGM、BG、Chars 并应用到运行时，
     * 类比存档系统（archive.html）的读档恢复机制。
     * BGM 兼容 [wait time=...]keys、bgm wait key、bgm stop 等多种指令格式；
     * BG 会剥离 trans/转场/slideL/scanR 等转场前缀后再查表。
     * @param {number} startLine - 起始行索引（从这一行开始播放）
     * @returns {void}
     * @sideeffect 更新 systemModule.lastActiveBgm/Bg/Chars；实际调用 playAudio/stopBGM/setBackground/renderChars
     */
gameEngine.buildStateFromHistory = function(startLine) {
        if (!this.sceneData || !this.sceneData.story) return;
        
        var lastBgm = null;       // 最后一条 bgm 指令原文
        var lastBg = null;        // 最后一条 background 指令原文
        var lastChars = null;     // 最后一条 chars 指令原文
        
        for (var i = 0; i < startLine && i < this.sceneData.story.length; i++) {
            var line = this.sceneData.story[i];
            if (line.bgm !== undefined && line.bgm !== null) {
                lastBgm = line.bgm;
            }
            if (line.background !== undefined && line.background !== null) {
                lastBg = line.background;
            }
            if (line.chars !== undefined && line.chars !== null) {
                lastChars = line.chars;
            }
        }
        
        console.log('[State Build] Scanned history, found BGM:', lastBgm, 'BG:', lastBg, 'Chars:', lastChars);
        
        // 应用 BGM 状态
        if (lastBgm) {
            // 提取实际的 BGM key（支持多种格式：[wait time=...]bgmKey、bgm wait bgmKey、bgmKey 等）
            var actualBgmKey = lastBgm;
            
            // 处理 [wait time=...]BGM_KEY 格式
            if (typeof lastBgm === 'string' && (lastBgm.includes('[wait time=') || lastBgm.includes('[wait time ='))) {
                var waitMatch = lastBgm.match(/\[wait\s+time\s*=\s*\d+\s*\]\s*(.+)/);
                if (waitMatch) {
                    actualBgmKey = waitMatch[1].trim();
                }
            }
            
            if (typeof systemModule !== 'undefined') {
                systemModule.lastActiveBgm = actualBgmKey;
            }
            // 实际播放/停止 BGM
            if (lastBgm === 'bgm stop') {
                this.stopBGM();
            } else if (typeof lastBgm === 'string' && lastBgm.startsWith('bgm wait ')) {
                var newBgmKey = lastBgm.substring('bgm wait '.length).trim();
                if (this.sceneData.bgm && this.sceneData.bgm[newBgmKey]) {
                    this.playAudio(newBgmKey);
                }
            } else if (typeof lastBgm === 'string' && (lastBgm.includes('[wait time=') || lastBgm.includes('[wait time ='))) {
                // [wait time=...]BGM_KEY 格式：提取实际 BGM key 并播放
                if (this.sceneData.bgm && this.sceneData.bgm[actualBgmKey]) {
                    this.playAudio(actualBgmKey);
                }
            } else if (this.sceneData.bgm && this.sceneData.bgm[lastBgm]) {
                this.playAudio(lastBgm);
            }
        }
        
        // 应用背景状态
        if (lastBg && typeof lastBg === 'string') {
            // 解析可能存在的转场前缀
            var bgId = lastBg;
            var prefixes = ['trans ', '转场 ', 'slideL ', '左滑 ', 'slideR ', '右滑 ', 'scanL ', '左转场 ', 'scanR ', '右转场 '];
            for (var p = 0; p < prefixes.length; p++) {
                if (bgId.startsWith(prefixes[p])) {
                    bgId = bgId.substring(prefixes[p].length).trim();
                    break;
                }
            }
            
            if (typeof systemModule !== 'undefined') {
                systemModule.lastActiveBg = bgId;
            }
            
            var bgPath = null;
            if (this.sceneData.background && this.sceneData.background[bgId]) {
                bgPath = this.sceneData.background[bgId];
            } else if (typeof CG_CONFIG_SUB !== 'undefined' && CG_CONFIG_SUB[bgId]) {
                bgPath = CG_CONFIG_SUB[bgId];
            }
            if (bgPath) {
                this.setBackground(bgPath);
            }
        }
        
        // 应用立绘状态
        if (lastChars) {
            if (typeof systemModule !== 'undefined') {
                systemModule.lastActiveChars = lastChars;
            }
            this.renderChars(lastChars);
        }
        
        console.log('[State Build] Applied state from history - BGM:', 
            (typeof systemModule !== 'undefined' ? systemModule.lastActiveBgm : null),
            'BG:', (typeof systemModule !== 'undefined' ? systemModule.lastActiveBg : null));
    };

/**
 * 快速存档管理器
 * 
 * 提供「一键快速保存」能力：采集最新状态快照并追加到存档列表（galgame_archives，
 * 最新在前），同时负责存档管理页跳转、存档读取/格式化与操作提示。
 * 内置冷却机制，防止长按/连击造成的重复存档。
 */
const QuickSaveManager = {
    // 防抖和冷却相关变量
    _isCooldown: false,          // 是否在冷却中
    _hasTriggeredOnPress: false, // 本次按键是否已触发保存
    _cooldownDuration: 1000,     // 冷却时间（毫秒）
    
    /**
     * 快速保存 - 创建新存档
     * 
     * 先刷新最新状态快照并读取 gameStateSnapshot，据其组装存档数据（场景文件、行号、
     * 预览文本、缩略图等），插入存档列表首位后写入 localStorage。
     * 冷却中则直接跳过；无快照时提示错误。
     * 
     * @returns {void}
     * @sideeffect 写入 localStorage['galgame_archives']；调用 gameEngine.saveStateSnapshot()、
     *             notifyStorageOperation('CREATE', ...) 及 showMessage 提示
     */
    quickSave: function() {
        // 检查是否在冷却中
        if (this._isCooldown) {
            console.log('[Quick Save] On cooldown, skipping save');
            return;
        }
        
        // 确保快照是最新的（包含当前剧本画面缩略图）
        // 在场景页 F5 保存时，gameEngine 已在每次推进时更新快照，
        // 但为保险起见这里再保存一次以捕获最新画面
        if (typeof gameEngine !== 'undefined' && gameEngine.saveStateSnapshot) {
            gameEngine.saveStateSnapshot();
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
            snapshot: gameState,
            // 缩略图：剧本形态画面数据（背景图+立绘），由 captureThumbnail 采集
            thumbnail: gameState.thumbnail || null
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
     * 
     * 跳转前停止所有自动/快进模式并刷新状态快照，确保存档页能识别「返回当前游玩」
     * 并可从 snapshot.thumbnail 取到剧本画面。
     * 
     * @returns {void}
     * @sideeffect 调用 systemModule.stopAllAutoSkipModes()、gameEngine.saveStateSnapshot()，并跳转到 ../html/archive.html
     */
    openArchivePage: function() {
        // 停止所有自动/快进模式，防止新页面恢复状态
        if (typeof systemModule !== 'undefined' && systemModule.stopAllAutoSkipModes) {
            systemModule.stopAllAutoSkipModes();
        }
        // 保存当前游戏状态快照（含缩略图），确保存档页面能检测到"返回当前游玩"按钮
        // 并让存档页 createNewArchive 能从 snapshot.thumbnail 获取剧本画面
        if (typeof gameEngine !== 'undefined' && gameEngine.saveStateSnapshot) {
            gameEngine.saveStateSnapshot();
        }
        window.location.href = '../html/archive.html';
    },
    
    /**
     * 加载所有存档
     * 
     * 读取并解析 localStorage 中的 galgame_archives；不存在或解析失败时返回空数组。
     * 
     * @returns {Array} - 存档数据数组
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
     * 
     * 以「存档 (现有数量+1)」生成自增名称。
     * 
     * @returns {string} - 默认存档名，如 "存档 3"
     */
    getDefaultSaveName: function() {
        const archives = this.loadArchives();
        return `存档 ${archives.length + 1}`;
    },
    
    /**
     * 提取场景文件名
     * 
     * 取路径最后一段作为文件名，空路径回退为 'unknown.html'。
     * 
     * @param {string} pagePath - 页面路径
     * @returns {string} - 文件名（含扩展名），无法提取时返回 'unknown.html'
     */
    extractSceneFileName: function(pagePath) {
        const parts = pagePath.split('/');
        return parts[parts.length - 1] || 'unknown.html';
    },
    
    /**
     * 获取当前文本预览
     * 
     * 读取 #text-box 文本并截断（超过 50 字追加省略号）；读取失败或为空时返回占位文案。
     * 
     * @returns {string} - 预览文本，最长 50 字
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
     * 
     * 将毫秒时间戳格式化为 "YYYY-MM-DD HH:mm:ss"；无效时间戳返回 '未知时间'。
     * 
     * @param {number} timestamp - 毫秒时间戳
     * @returns {string} - 格式化的日期时间字符串
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
     * 
     * 在屏幕底部居中弹出一条 Toast（先移除旧提示），2 秒后淡出并自动移除。
     * 
     * @param {string} message - 提示文本
     * @param {string} type - 提示类型：'success'（绿）或其它（红）
     * @returns {void}
     * @sideeffect 向 document.body 插入临时 DOM 节点，并设置定时器移除
     */
    showMessage: function(message, type) {
        // 移除旧消息
        const oldMessage = document.querySelector('.quick-save-message');
        if (oldMessage) {
            oldMessage.remove();
        }
        
        const statusDiv = document.createElement('div');
        statusDiv.className = `quick-save-message ${type === 'success' ? 'success' : 'error'}`;
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
     * 
     * 置位 _isCooldown 并在 _cooldownDuration 毫秒后自动解除，防止快速保存被连续触发。
     * 
     * @returns {void}
     * @sideeffect 设置 _isCooldown 并注册 setTimeout
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
     * 
     * 若存在 window.shiori.api.onStorageOperation，则将操作信息以 JSON 形式上报宿主层，
     * 供宿主侧监控/同步存储变更；桥接不可用时静默跳过。
     * @param {string} operation - 操作类型：'CREATE', 'DELETE', 'UPDATE'
     * @param {string} key - localStorage 的键名
     * @param {string} storageType - 存储类型：'localStorage' 或 'sessionStorage'
     * @returns {void}
     * @sideeffect 调用 window.shiori.api.onStorageOperation(JSON字符串)
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
 * 
 * gameEngine 层面的同功能方法（与 QuickSaveManager.notifyStorageOperation 行为一致）：
 * 宿主桥接可用时把存储操作以 JSON 上报，供宿主侧监控/同步。
 * @param {string} operation - 操作类型：'CREATE', 'DELETE', 'UPDATE'
 * @param {string} key - localStorage 的键名
 * @param {string} storageType - 存储类型：'localStorage' 或 'sessionStorage'
 * @returns {void}
 * @sideeffect 调用 window.shiori.api.onStorageOperation(JSON字符串)
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
