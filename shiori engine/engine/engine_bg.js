/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 负责背景图片的显示、切换与转场特效，是引擎视觉表现层的核心模块之一。
 * 提供淡入淡出（fade）、滑屏（slide）、扫描擦除（scan）等转场动画，
 * 以及白屏闪动、怀旧滤镜（sepia）、回忆闪回、负片反转、事件 CG 显示等全屏视觉效果。
 * 同时实现背景序列执行（含 [wait] 标签）与转场后的行状态恢复（竞态校验）。
 */


    
    /**
     * 执行背景转场：支持淡入淡出、滑屏及扫描式覆盖
     * 作为背景转场的统一入口，根据 type 分发到 fadeOut/fadeIn、performSlideTransition
     * 或 performScanTransition，并在动画结束后调用 _resumeLineAfterTransition 恢复行状态。
     * @param {string} newBgPath - 新背景图片的路径
     * @param {Object} currentLine - 当前剧情行数据对象（用于转场后恢复该行剩余内容）
     * @param {string} type - 转场类型 ('fade', 'slideL', 'slideR', 'scanL', 'scanR')
     * @returns {void}
     * @sideeffect 设置 state.isBackgroundTransitioning 与 state.transitionStartLine 以屏蔽交互并记录锚点；
     *   立即清除全部立绘并清空文本/姓名框；快进模式下会同步跳过动画。
     */
gameEngine.performBackgroundTransition = function(newBgPath, currentLine, type) {
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

        // 立即清空当前的文本和姓名显示（含说话人小头像），防止转场过程中残留上一行的内容
        this.elements.textBox.textContent = '';
        this.elements.nameBox.textContent = '';
        this.applySpeakerLabel(null);

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
    };



    /**
     * 执行整体位移滑屏转场（左滑/右滑）
     * @param {string} newBgPath - 新背景图片路径
     * @param {Object} currentLine - 当前剧情行数据对象
     * @param {string} type - 转场类型 ('slideL' 左滑 | 'slideR' 右滑)
     * @param {number} duration - 动画时长（毫秒）
     * @returns {void}
     * @deprecated 该实现会被文件后部同名方法（scaleX 扫描擦除版本）覆盖，
     *   实际运行时不会生效；修改背景滑屏行为请参考下方同名方法。
     */
gameEngine.performSlideTransition = function(newBgPath, currentLine, type, duration) {
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
    };



    /**
     * 执行扫描式转场（左转场/右转场）- 使用 Clip-path 防止拉伸
     * 通过 clip-path 的 inset 从一侧逐步揭示新背景，并配合 mask 渐变边缘实现平滑擦除，
     * 避免出现背景拉伸变形。
     * @param {string} newBgPath - 新背景图片路径
     * @param {Object} currentLine - 当前剧情行数据对象
     * @param {string} type - 转场类型 ('scanL' 自左扫入 | 'scanR' 自右扫入)
     * @param {number} duration - 动画时长（毫秒）
     * @returns {void}
     * @sideeffect 设置转场标志与锚点行号、清除全部立绘；
     *   快速模式下直接跳过动画并同步恢复行状态。
     */
gameEngine.performScanTransition = function(newBgPath, currentLine, type, duration) {
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
    };



    /**
     * 执行滑屏转场（扫描式擦除效果，使用 scaleX 由一侧展开覆盖）
     * @param {string} newBgPath - 新背景图片路径
     * @param {Object} currentLine - 当前剧情行数据对象
     * @param {string} type - 转场类型 ('slideL' 自左展开 | 'slideR' 自右展开)
     * @param {number} duration - 动画时长（毫秒）
     * @returns {void}
     * @remarks 本方法与文件前部的同名方法重名，会覆盖前者，是实际生效的实现。
     *   通过 requestAnimationFrame + transformOrigin 控制展开方向，避免图片被拉伸变形。
     */
gameEngine.performSlideTransition = function(newBgPath, currentLine, type, duration) {
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
                // 立绘已在转场开始时清除，此处无需再次调用
                this.setBackground(newBgPath);
                
                // 移除临时层
                if (newLayer.parentNode) newLayer.parentNode.removeChild(newLayer);
                
                this._resumeLineAfterTransition(currentLine, 50);
            }, duration + 50);
        };
    };



    /**
     * 转场结束后恢复当前行剩余逻辑的通用函数
     * 延时 delay 后恢复姓名框、文本渲染、立绘显示以及音频/BGM 指令，随后清除转场标志并刷新调试信息。
     * 关键在于：恢复前会校验转场起始行号与当前行号是否一致，若不一致（用户快速点击导致竞态）
     * 则放弃恢复旧行状态，交由 nextLine 强制同步最新状态。
     * @param {Object} currentLine - 转场发起时所在的剧情行数据对象
     * @param {number} delay - 恢复前的等待时长（毫秒），通常为转场动画耗时
     * @returns {void}
     * @sideeffect 设置 state.isBackgroundTransitioning=false 恢复交互；
     *   会重新渲染立绘、播放音频/BGM；可能调用 systemModule.updateDebugInfo。
     */
gameEngine._resumeLineAfterTransition = function(currentLine, delay) {
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
            
            // 1. 恢复姓名框显示（含说话人小头像）。转场开头会 removeAllChars + 清名片，
            //    所以这里必须把 speaker 重新下发一次，头像才会重建。
            if (currentLine.speaker !== undefined) {
                this.applySpeakerLabel(currentLine.speaker);
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
    };



    /**
     * 淡出效果
     * 创建覆盖层并逐渐增加不透明度，实现淡出到指定颜色的效果
     * @param {number} duration - 淡出持续时间（毫秒）
     * @param {string} backgroundColor - 淡出目标颜色（CSS 颜色值）
     * @param {Function} [callback] - 淡出完成后的回调函数
     * @returns {void}
     * @sideeffect 会在 document.body 上插入 id 为 'fade-overlay' 的固定定位全覆盖层，
     *   若已存在同 id 层会先移除；动画结束后不会自动移除该层（需由 fadeIn 清理）。
     */
gameEngine.fadeOut = function(duration, backgroundColor, callback) {
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
    };


    
    /**
     * 淡入效果
     * 将已存在的淡出遮罩层（id='fade-overlay'）不透明度降为 0，并在动画结束后从 DOM 移除，
     * 从而露出下方内容，实现"淡入"。通常与 fadeOut 成对使用。
     * @param {number} duration - 淡入持续时间（毫秒）
     * @param {string} backgroundColor - 遮罩颜色（用于重置过渡属性，实际颜色沿用已有层）
     * @returns {void}
     * @sideeffect 若不存在 'fade-overlay' 层则打印警告并直接返回；动画结束后移除该层。
     */
gameEngine.fadeIn = function(duration, backgroundColor) {
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
    };


    
    /**
     * 设置背景图片
     * 将指定图片应用到背景容器，采用"信箱模式"（contain 居中、黑底、不重复）。
     * 内部通过递增的加载代次号 _bgLoadGen 处理并发加载，并提供一次失败自动重试
     * （追加时间戳查询参数破除缓存）。
     * @param {string} imagePath - 背景图片路径；传空值时清空背景
     * @returns {void}
     * @sideeffect 直接修改 this.elements.backgroundContainer 的内联样式；
     *   通过 Image 预加载探测加载失败，失败时最多重试一次。
     */
gameEngine.setBackground = function(imagePath) {
        const container = this.elements.backgroundContainer;
        const apply = (url) => {
            container.style.backgroundImage = url ? `url('${url}')` : 'none';
            container.style.backgroundColor = '#000';
            container.style.backgroundSize = 'contain';
            container.style.backgroundPosition = 'center';
            container.style.backgroundRepeat = 'no-repeat';
        };
        this._bgLoadGen = (this._bgLoadGen || 0) + 1;
        const gen = this._bgLoadGen;
        apply(imagePath || '');
        if (!imagePath) return;
        const probe = new Image();
        probe.onload = () => { probe.onload = probe.onerror = null; };
        probe.onerror = () => {
            if (gen !== this._bgLoadGen) return;
            if (probe.dataset.shioriRetried === '1') {
                probe.onload = probe.onerror = null;
                return;
            }
            probe.dataset.shioriRetried = '1';
            const sep = imagePath.indexOf('?') >= 0 ? '&' : '?';
            const retryUrl = imagePath + sep + 'r=' + Date.now();
            apply(retryUrl);
            probe.src = retryUrl;
        };
        probe.src = imagePath;
    };


    
    /**
     * 执行背景转场（序列专用，不阻塞行处理）
     * 用于 executeBackgroundSequence 内部逐段执行转场，动画结束后调用 onComplete 推进序列，
     * 与 performBackgroundTransition 不同，本方法不涉及剧情行状态恢复（不阻塞当前行处理）。
     * @param {string} newBgPath - 新背景图片路径
     * @param {string} type - 转场类型 ('fade' | 'slideL' | 'slideR' | 'scanL' | 'scanR')
     * @param {Function} onComplete - 转场完成后的回调（用于推进到下一段）
     * @returns {void}
     * @sideeffect 转场开始前会调用 this.removeAllChars() 清除全部立绘；
     *   fade 直接作用于背景容器，slide/scan 会临时插入 .slide-layer 覆盖层。
     */
gameEngine.performBackgroundTransitionSequence = function(newBgPath, type, onComplete) {
        const duration = 1000;
        const container = this.elements.backgroundContainer;
        
        // 在转场开始前，立即清除所有旧立绘，确保画面干净（相当于 [消失 all]）
        this.removeAllChars();
        
        if (type === 'fade') {
            container.style.transition = `opacity ${duration}ms ease-in-out`;
            container.style.opacity = '0';
            setTimeout(() => {
                this.setBackground(newBgPath);
                setTimeout(() => {
                    container.style.opacity = '1';
                    setTimeout(() => {
                        container.style.transition = '';
                        if (onComplete) onComplete();
                    }, duration + 50);
                }, 50);
            }, duration + 50);
        } else if (type === 'slideL' || type === 'slideR') {
            const startX = type === 'slideL' ? '-100%' : '100%';
            const endX = type === 'slideL' ? '100%' : '-100%';
            const newLayer = document.createElement('div');
            newLayer.className = 'slide-layer';
            newLayer.style.backgroundImage = `url('${newBgPath}')`;
            newLayer.style.backgroundColor = '#000';
            newLayer.style.backgroundSize = 'contain';
            newLayer.style.backgroundPosition = 'center';
            newLayer.style.backgroundRepeat = 'no-repeat';
            newLayer.style.transform = `translateX(${startX})`;
            container.appendChild(newLayer);
            
            setTimeout(() => {
                newLayer.style.transform = 'translateX(0)';
                container.style.transform = `translateX(${endX})`;
            }, 50);
            
            setTimeout(() => {
                this.setBackground(newBgPath);
                container.style.transition = 'none';
                container.style.transform = 'translateX(0)';
                void container.offsetWidth;
                container.style.transition = 'opacity 1s ease, transform 1s cubic-bezier(0.4, 0.0, 0.2, 1)';
                if (newLayer.parentNode) newLayer.parentNode.removeChild(newLayer);
                if (onComplete) onComplete();
            }, duration + 100);
        } else if (type === 'scanL' || type === 'scanR') {
            const newLayer = document.createElement('div');
            newLayer.className = 'slide-layer';
            newLayer.classList.add(type === 'scanL' ? 'scan-left' : 'scan-right');
            newLayer.style.backgroundImage = `url('${newBgPath}')`;
            newLayer.style.backgroundColor = '#000';
            newLayer.style.backgroundSize = 'contain';
            newLayer.style.backgroundPosition = 'center';
            newLayer.style.backgroundRepeat = 'no-repeat';
            if (type === 'scanL') {
                newLayer.style.clipPath = 'inset(0 100% 0 0)';
            } else {
                newLayer.style.clipPath = 'inset(0 0 0 100%)';
            }
            container.appendChild(newLayer);
            
            setTimeout(() => {
                newLayer.style.clipPath = 'inset(0 0 0 0)';
            }, 50);
            
            setTimeout(() => {
                this.setBackground(newBgPath);
                if (newLayer.parentNode) newLayer.parentNode.removeChild(newLayer);
                if (onComplete) onComplete();
            }, duration + 100);
        } else {
            this.setBackground(newBgPath);
            if (onComplete) onComplete();
        }
    };


    
    /**
     * 执行背景序列（支持 [wait time] 标签）
     * 按顺序逐一处理背景指令段，识别 trans/转场(fade)、slideL/左滑、slideR/右滑、
     * scanL/左转场、scanR/右转场 等前缀并映射为对应转场类型；wait 段会挂起指定时长。
     * 通过 this.state.waitSequences.background 暴露 skip 方法，供用户点击时跳过等待。
     * @param {Array<{type:string, value?:string, duration?:number}>} segments - 解析后的序列段数组
     * @param {Object} line - 当前剧情行数据（保留参数，供扩展/调试使用）
     * @returns {void}
     * @sideeffect 修改 this.state.waitSequences.background；依据 sceneData.background 或
     *   全局 CG_CONFIG_SUB 解析背景别名；会调用 setBackground / performBackgroundTransitionSequence。
     */
gameEngine.executeBackgroundSequence = function(segments, line) {
        let index = 0;
        
        console.log('[executeBackgroundSequence] 开始执行, segments:', segments);
        
        const processNext = () => {
            if (index >= segments.length) {
                console.log('[executeBackgroundSequence] 序列完成');
                this.state.waitSequences.background = null;
                return;
            }
            
            const seg = segments[index++];
            console.log('[executeBackgroundSequence] 处理 segment:', seg);
            
            if (seg.type === 'wait') {
                console.log('[executeBackgroundSequence] 等待', seg.duration, 'ms');
                const timeoutId = setTimeout(processNext, seg.duration);
                this.state.waitSequences.background = {
                    timeoutId,
                    skip: () => { clearTimeout(timeoutId); processNext(); }
                };
                return;
            }
            
            const bgValue = seg.value;
            let bgPath = null;
            let isTransition = false;
            let transitionType = 'fade';
            let targetBgId = null;
            
            if (bgValue.startsWith('trans ') || bgValue.startsWith('转场 ')) {
                isTransition = true;
                transitionType = 'fade';
                targetBgId = bgValue.replace(/^(trans|转场)\s+/, '').trim();
            } else if (bgValue.startsWith('slideL ') || bgValue.startsWith('左滑 ')) {
                isTransition = true;
                transitionType = 'slideL';
                targetBgId = bgValue.replace(/^(slideL|左滑)\s+/, '').trim();
            } else if (bgValue.startsWith('slideR ') || bgValue.startsWith('右滑 ')) {
                isTransition = true;
                transitionType = 'slideR';
                targetBgId = bgValue.replace(/^(slideR|右滑)\s+/, '').trim();
            } else if (bgValue.startsWith('scanL ') || bgValue.startsWith('左转场 ')) {
                isTransition = true;
                transitionType = 'scanL';
                targetBgId = bgValue.replace(/^(scanL|左转场)\s+/, '').trim();
            } else if (bgValue.startsWith('scanR ') || bgValue.startsWith('右转场 ')) {
                isTransition = true;
                transitionType = 'scanR';
                targetBgId = bgValue.replace(/^(scanR|右转场)\s+/, '').trim();
            }
            
            if (!isTransition) {
                if (this.sceneData.background && this.sceneData.background[bgValue]) {
                    bgPath = this.sceneData.background[bgValue];
                } else if (typeof CG_CONFIG_SUB !== 'undefined' && CG_CONFIG_SUB[bgValue]) {
                    bgPath = CG_CONFIG_SUB[bgValue];
                }
            } else {
                if (this.sceneData.background && this.sceneData.background[targetBgId]) {
                    bgPath = this.sceneData.background[targetBgId];
                } else if (typeof CG_CONFIG_SUB !== 'undefined' && CG_CONFIG_SUB[targetBgId]) {
                    bgPath = CG_CONFIG_SUB[targetBgId];
                }
            }
            
            if (bgPath) {
                if (isTransition) {
                    this.performBackgroundTransitionSequence(bgPath, transitionType, processNext);
                } else {
                    this.setBackground(bgPath);
                    processNext();
                }
            } else {
                processNext();
            }
        };
        
        this.state.waitSequences.background = { skip: processNext };
        processNext();
    };


    
    /**
     * 隐藏事件CG和特效层
     * 查找所有 .event-image 与 .effect-layer 元素，将其不透明度置 0 并隐藏。
     * @returns {void}
     * @sideeffect 直接修改匹配元素的内联样式（opacity/visibility），不移除 DOM 节点。
     */
gameEngine.hideEventVisual = function() {
        const eventElements = document.querySelectorAll('.event-image, .effect-layer');
        eventElements.forEach(el => {
            el.style.opacity = '0';
            el.style.visibility = 'hidden';
        });
    };


    
    /**
     * 背景切换（带动画）
     * 先淡出到黑色（200ms），切换背景，再按指定时长淡入，实现平滑过渡。
     * @param {Object} options - 切换选项
     * @param {number} [options.time=1000] - 淡入时长（毫秒）
     * @returns {void}
     * @sideeffect 会清除姓名框、隐藏文本框与全部立绘，再通过 fadeOut/setBackground/fadeIn 完成过渡。
     */
gameEngine.backgroundChangeWithTransition = function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 淡出后切换背景并淡入
        this.fadeOut(200, 'black', () => {
            this.setBackgroundWithPosition(options);
                    
            this.fadeIn(options.time || 1000, 'black');
        });
    };


    
    /**
     * 背景切换（无动画）
     * 直接切换背景，然后以透明色淡入（用于瞬时切换场景）。
     * @param {Object} options - 切换选项
     * @param {number} [options.time=1000] - 淡入时长（毫秒）
     * @returns {void}
     * @sideeffect 清除姓名框、隐藏文本框与全部立绘后调用 setBackgroundWithPosition 与 fadeIn。
     */
gameEngine.backgroundChangeWithoutTransition = function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 直接设置背景
        this.setBackgroundWithPosition(options);
        
        this.fadeIn(options.time || 1000, 'transparent');
    };


    
    /**
     * 根据配置设置背景位置
     * 目前仅处理通配符背景：当场景配置中存在 background['*'] 时直接应用该背景。
     * @param {Object} options - 背景配置选项（保留参数，供后续扩展定位逻辑）
     * @returns {void}
     * @sideeffect 可能调用 this.setBackground 应用通配符背景。
     */
gameEngine.setBackgroundWithPosition = function(options) {
        // 使用通配符背景（如果存在）
        if (this.sceneData.background['*']) {
            this.setBackground(this.sceneData.background['*']);
        }
    };


    
    /**
     * 背景消除
     * 将背景容器设为隐藏，再淡入指定过渡色，实现"背景消失"的视觉效果。
     * @param {Object} options - 消除选项
     * @param {number} [options.time=1000] - 淡入时长（毫秒）
     * @param {string} [options.transition='black'] - 过渡颜色
     * @returns {void}
     * @sideeffect 清除姓名框、隐藏文本框与全部立绘，并将背景容器 visibility 置为 hidden。
     */
gameEngine.backgroundErase = function(options) {
        this.clearNameBox();
        this.hideTextBox();
        
        this.hideAllCharacters();
        
        // 隐藏背景容器
        this.elements.backgroundContainer.style.visibility = 'hidden';
        
        // 淡入过渡色
        this.fadeIn(options.time || 1000, options.transition || 'black');
    };


    
    /**
     * 显示事件CG
     * 创建并淡入事件图片（居中、限制最大宽高、z-index 500）。
     * 淡入完成后自动调用 this.nextLine() 推进剧情。
     * @param {Object} options - 显示选项
     * @param {string} options.file - 事件图片键名（对应 sceneData.events 中的映射）
     * @param {number} options.opacity - 目标不透明度（0-255）
     * @param {number} options.time - 淡入时长（毫秒）
     * @returns {void}
     * @sideeffect 在 document.body 插入 id='event-image' 的 img 元素；
     *   会清除姓名框、隐藏文本框与全部立绘；动画结束推进下一行。
     */
gameEngine.eventShow = function(options) {
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
    };


    
    /**
     * 隐藏事件CG
     * 找到 id='event-image' 的图片，逐渐降低不透明度至 0 后从 DOM 移除，并推进下一行。
     * @param {Object} options - 隐藏选项
     * @param {number} options.time - 淡出时长（毫秒）
     * @returns {void}
     * @sideeffect 清除姓名框、隐藏文本框；若不存在事件图片则延时 100ms 直接推进下一行。
     */
gameEngine.eventHide = function(options) {
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
    };


    
    /**
     * 白色闪屏效果
     * 先淡入白色覆盖层，再淡出，实现闪屏转场效果，结束后推进下一行。
     * @param {number} time - 单程（淡入/淡出）动画时长（毫秒）
     * @returns {void}
     * @sideeffect 在 document.body 插入 id='white-overlay' 的覆盖层，动画后自动移除；
     *   会清除姓名框、隐藏文本框与全部立绘。
     */
gameEngine.whiteOut = function(time) {
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
    };


    
    /**
     * 单色显示效果（淡出黑色覆盖层）
     * 创建黑色全覆盖层并逐渐淡出（16ms 步进），动画结束后推进下一行。
     * @param {Object} options - 配置选项
     * @param {number} options.time - 淡出时长（毫秒）
     * @returns {void}
     * @sideeffect 在 document.body 插入 id='circle-expand-overlay' 的覆盖层，动画后自动移除。
     */
gameEngine.betaFuraShow = function(options) {
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
    };


    
    /**
     * 单色效果结束（淡入黑色覆盖层）
     * 清除 UI 元素后，创建黑色覆盖层先淡入（固定 500ms）再淡出，结束后推进下一行。
     * @param {Object} options - 配置选项（保留参数，时长内部固定）
     * @returns {void}
     * @sideeffect 会清除姓名框、隐藏文本框与全部立绘；
     *   在 document.body 插入 id='temp-overlay' 的覆盖层，动画后自动移除。
     */
gameEngine.betaFuraEnd = function(options) {
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
    };


    
    /**
     * 显示模糊事件CG
     * 创建带有 CSS blur 滤镜的事件图片（居中、z-index 500）并按 time 淡入，结束后推进下一行。
     * @param {Object} options - 配置选项
     * @param {string} options.file - 事件图片键名（对应 sceneData.events）
     * @param {number} options.blur - 模糊半径（像素）
     * @param {number} options.time - 淡入时长（毫秒）
     * @returns {void}
     * @sideeffect 在 document.body 插入 id='event-blur-image' 的 img；
     *   会清除姓名框、隐藏文本框与全部立绘。
     */
gameEngine.eventBlurShow = function(options) {
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
    };


    
    /**
     * 恢复模糊事件CG（清除模糊并淡出）
     * 找到 id='event-blur-image' 的图片，清除 blur 滤镜后逐渐淡出并移除，结束后推进下一行。
     * @param {Object} options - 配置选项
     * @param {number} options.time - 淡出时长（毫秒）
     * @returns {void}
     * @sideeffect 清除姓名框、隐藏文本框；若不存在模糊图片则延时 100ms 直接推进下一行。
     */
gameEngine.eventBlurRestore = function(options) {
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
    };


    
    /**
     * 开始怀旧滤镜（棕褐色调）
     * 对整个页面（document.body）应用 grayscale + sepia 滤镜，实现老照片/回忆质感，
     * 随后延时 100ms 推进下一行。
     * @returns {void}
     * @sideeffect 直接覆盖 document.body.style.filter（会与 invert 等其它滤镜叠加/覆盖）。
     */
gameEngine.sepiaStart = function() {
        // 应用怀旧滤镜
        document.body.style.filter = 'grayscale(100%) sepia(100%)';
        
        setTimeout(() => {
            this.nextLine();
        }, 100);
    };


    
    /**
     * 结束怀旧滤镜
     * 将 document.body 的 filter 置为 'none' 移除所有 CSS 滤镜效果，随后推进下一行。
     * @returns {void}
     * @sideeffect 会一并清除 invert 等其它已应用的 body 滤镜（整体重置）。
     */
gameEngine.sepiaEnd = function() {
        // 清除滤镜
        document.body.style.filter = 'none';
        
        setTimeout(() => {
            this.nextLine();
        }, 100);
    };


    
    /**
     * 怀旧滤镜开始（带白屏转场）
     * 先应用怀旧滤镜（grayscale + sepia），再叠加白色覆盖层执行淡入淡出闪屏，结束后推进下一行。
     * @param {number} time - 闪屏动画总时长（毫秒，内部按半程计算淡入/淡出步长）
     * @returns {void}
     * @sideeffect 清除姓名框、隐藏文本框与全部立绘；覆盖 document.body 滤镜；
     *   插入 id='white-overlay-temp' 覆盖层，动画后自动移除。
     */
gameEngine.sepiaStartWithWhiteout = function(time) {
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
    };


    
    /**
     * 怀旧滤镜结束（带白屏转场）
     * 先清除怀旧滤镜（filter='none'），再叠加白色覆盖层执行淡入淡出闪屏，结束后推进下一行。
     * @param {number} time - 闪屏动画总时长（毫秒，内部按半程计算淡入/淡出步长）
     * @returns {void}
     * @sideeffect 清除姓名框、隐藏文本框与全部立绘；
     *   插入 id='white-overlay-end' 覆盖层，动画后自动移除。
     */
gameEngine.sepiaEndWithWhiteout = function(time) {
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
    };


    
    /**
     * 暗转怀旧滤镜结束
     * 先淡出到黑色（1000ms），在回调中清除怀旧滤镜并推进下一行，实现"暗转"退出效果。
     * @returns {void}
     * @sideeffect 依赖 fadeOut 生成遮罩层；重置 document.body.style.filter。
     */
gameEngine.fadeoutSepiaEnd = function() {
        // 淡出到黑色
        this.fadeOut(1000, 'black', () => {
            // 清除怀旧滤镜
            document.body.style.filter = 'none';
            
            // 继续下一行
            this.nextLine();
        });
    };


    
    /**
     * 回忆场景开始
     * 依次执行：黑屏层淡出收缩 → 回忆内容层淡入展开 → 应用怀旧滤镜（grayscale+sepia）
     * → 叠加 15px 半透明白色边框，结束后推进下一行，营造闪回（回忆）观感。
     * @param {Object} options - 配置选项
     * @param {number} options.time - 动画总时长（毫秒，收缩/展开各占半程）
     * @returns {void}
     * @sideeffect 清除姓名框、隐藏文本框与全部立绘；
     *   插入 id='flashback-black-bg'、id='recall-content'、id='white-frame' 等覆盖层；
     *   覆盖 document.body 滤镜。
     */
gameEngine.flashbackStart = function(options) {
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
    };


    
    /**
     * 回忆场景结束
     * 移除白色边框（id='white-frame'），创建黑色过渡层先淡入展开、再淡出收缩，
     * 并在黑屏完全展开时清除怀旧滤镜，结束后推进下一行。
     * @param {Object} options - 配置选项
     * @param {number} options.time - 动画总时长（毫秒，展开/收缩各占半程）
     * @returns {void}
     * @sideeffect 清除姓名框、隐藏文本框与全部立绘；
     *   插入 id='flashback-end-black-bg' 过渡层并自动移除；重置 document.body.style.filter。
     */
gameEngine.flashbackEnd = function(options) {
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
    };


    
    /**
     * 负片反转效果开始
     * 若当前 body 滤镜中尚无 invert，则追加 invert(100%) 实现颜色反转（负片）效果，
     * 随后延时 100ms 推进下一行。
     * @param {Object} options - 配置选项（保留参数）
     * @returns {void}
     * @sideeffect 追加写入 document.body.style.filter，可与 sepia 等滤镜叠加。
     */
gameEngine.negaposiFlip = function(options) {
        // 如果尚未应用反转滤镜，则添加
        const currentFilter = document.body.style.filter;
        if (!currentFilter.includes('invert')) {
            document.body.style.filter = currentFilter + ' invert(100%)';
        }
        
        setTimeout(() => {
            this.nextLine();
        }, 100);
    };


    
    /**
     * 负片反转效果结束
     * 从 body 滤镜字符串中移除 invert(100%)（同时兼容带前导空格与不带空格两种形式），
     * 恢复正常显示，随后延时 100ms 推进下一行。
     * @param {Object} options - 配置选项（保留参数）
     * @returns {void}
     * @sideeffect 仅移除 invert 滤镜，不影响 sepia 等其它已应用的滤镜。
     */
gameEngine.negaposiFlipEnd = function(options) {
        // 移除反转滤镜
        let currentFilter = document.body.style.filter;
        if (currentFilter.includes('invert(100%)')) {
            currentFilter = currentFilter.replace(' invert(100%)', '').replace('invert(100%)', '');
            document.body.style.filter = currentFilter;
        }
        
        setTimeout(() => {
            this.nextLine();
        }, 100);
    };

