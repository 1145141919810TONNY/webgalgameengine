/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 指令解析与动作分发模块。
 * 负责把场景脚本中的标签命令（如 [s]、[wait]、[novel]、[pov xxx] 等）解析为结构化动作对象，
 * 并按顺序分发到 gameEngine 的具体处理方法；同时统一管理“阻塞/非阻塞”语义，
 * 决定命令执行完毕后是否自动推进到下一行。
 * 本模块不直接操作 DOM，实际演出效果委托给 engine_core / engine_text / engine_audio 等模块。
 */


    /**
     * 获取（或惰性编译）某一行对应的 DSL 节点列表
     * 优先复用行对象上已缓存的 `line._dsl.nodes`，避免重复编译；
     * 否则尝试调用全局 DSL 编译器 `window.__shiori.dsl.compile` 即时编译命令字符串。
     * @param {string} command - 原始命令字符串
     * @param {Object} [line] - 当前行对象，若带 `_dsl.nodes` 缓存则直接返回
     * @returns {Array} - DSL 节点数组；无可用编译器或解析失败时返回空数组
     * @sideEffect 可能触发 DSL 编译（依赖全局 `window.__shiori.dsl`，不存在时静默降级）
     */
gameEngine.resolveDslNodes = function(command, line) {
        if (line && line._dsl && Array.isArray(line._dsl.nodes) && line._dsl.nodes.length)
            return line._dsl.nodes;
        const dsl = (typeof window === 'object' && window && window.__shiori && window.__shiori.dsl) ? window.__shiori.dsl : null;
        if (dsl && typeof dsl.compile === 'function')
            return (dsl.compile(command).nodes) || [];
        return [];
    };


    /**
     * 判断 command 字段是否是一段 $ 变量语句区
     * 约定：$ 必须引导整个字段（字段去掉前导空白后以 $ 开头），中段的 $ 不解析。
     * @param {string} command - command 字段原文
     * @returns {boolean}
     */
gameEngine.isVarProgramField = function(command) {
        return typeof command === 'string' && command.trim().charAt(0) === '$';
    };


    /**
     * 执行一段 $ 变量语句区（交给 VarSpace 解析并落地到 f. / sf. / tf.）
     * @param {string} command - command 字段原文
     * @returns {Object|null} VarSpace.runProgram 的解析结果；VarSpace 不可用时返回 null
     */
gameEngine.runVarProgram = function(command) {
        if (typeof VarSpace !== 'undefined' && VarSpace && typeof VarSpace.runProgram === 'function')
            return VarSpace.runProgram(command);
        console.warn('[Var] VarSpace 不可用，变量语句区未执行: ' + command);
        return null;
    };

/**
 * 执行标签命令（单行命令入口）
 * 解析并执行场景文件中的命令标签（如 [s]、[wait]、[novel] 等）。
 * 存在全局 DSL 时优先走 DSL 路径（compile + executeDslNode），否则回退到
 * “逗号分隔多指令 + parseCommand + handleAction”的传统路径。
 * 两种路径都会统计本行是否包含“点击等待类”或“动画类”命令，以此决定返回值语义。
 * @param {string} command - 命令字符串，如 "[fadeout time=500],[wait]"
 * @param {boolean} [shouldAutoNext=true] - 非阻塞命令执行完毕后是否自动进入下一行
 * @param {Array} [nodes] - 预先编译好的 DSL 节点（可复用，避免重复编译）
 * @returns {boolean} - 是否属于阻塞性命令（需等待用户点击或动画完成）；
 *                      true = 调用方不应再主动推进，false = 已自行安排/可立即推进
 * @sideEffect 会调用 this.nextLine()（延时 100ms 自动推进）、handleAction 及其下游演出
 */
gameEngine.executeCommand = function(command, shouldAutoNext = true, nodes) {
        // —— $ 变量语句区：整个 command 字段即一段变量语句 ——
        // 不走标签编译路径，因此不依赖 DSL 编译器在线（纯网页环境同样可执行）。
        if (this.isVarProgramField(command)) {
            this.runVarProgram(command);
            if (shouldAutoNext) setTimeout(() => this.nextLine(), 100);
            return false;
        }

        // —— DSL 路径：编译为节点后逐个执行 ——
        const dsl = (typeof window === 'object' && window && window.__shiori && window.__shiori.dsl) ? window.__shiori.dsl : null;
        if (dsl && typeof dsl.compile === 'function' && typeof dsl.executeDslNode === 'function') {
            const compiled = (nodes && nodes.length) ? nodes : ((dsl.compile(command).nodes) || []);
            // 阻塞类命令集合：命中后本行需停下等待用户点击
            const waitForClickCommands = ['waitForClick'];
            // 动画/计时类命令集合：命中后本行需停下等待动画结束（注意此处包含 mediaAnim）
            const animationCommands = ['fadeOut', 'fadeIn', 'finishGame', 'waitForTime', 'mediaAnim'];
            let hasAnimationCommand = false;
            let hasWaitForClickCommand = false;
            // 逐个执行节点并标记命令类型（executeDslNode 内部会完成实际演出调用）
            compiled.forEach(node => {
                const parsedCommand = dsl.executeDslNode(node, this);
                if (parsedCommand && parsedCommand.type) {
                    if (waitForClickCommands.includes(parsedCommand.type)) {
                        hasWaitForClickCommand = true;
                    }
                    if (animationCommands.includes(parsedCommand.type)) {
                        hasAnimationCommand = true;
                    }
                }
            });
            // 优先级最高：需要用户点击 → 切换文本框为“点击继续”提示并阻塞
            if (hasWaitForClickCommand) {
                this.elements.textBox.textContent = '点击继续';
                // 引擎自造的系统名片。SPEAKER_ALIAS 里默认把"系统"映射成空值，
                // 所以它不会顶出场上角色的头像（见 config/illustration.js）。
                this.applySpeakerLabel('系统');
                return true;
            } else if (hasAnimationCommand) {
                // 动画/计时类命令：交由动画自身完成后推进，此处同样视为阻塞
                return true;
            } else {
                // 纯瞬时命令：按需延时 100ms 自动推进（留出渲染/动画启动时间）
                if (shouldAutoNext) {
                    setTimeout(() => {
                        this.nextLine();
                    }, 100);
                }
                return false;
            }
        }
        // 支持多指令并行解析：使用逗号分隔多个指令
        // 例如：command: "[normal],[lock]" 或 command: "[pov 角色A],[阻止]"
        const commands = command.split(',').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
        
        // 定义需要等待用户点击的命令类型
        const waitForClickCommands = ['waitForClick'];
        
        // 定义需要等待动画完成的命令类型（这些命令不应自动进入下一行）
        const animationCommands = ['fadeOut', 'fadeIn', 'finishGame', 'waitForTime'];
        
        let hasAnimationCommand = false;
        let hasWaitForClickCommand = false;
        
        // 依次执行每个指令：解析 → 分发 → 标记命令类型
        commands.forEach(cmd => {
            // 解析命令字符串为结构化对象
            const parsedCommand = this.parseCommand(cmd);
            
            // 执行解析后的命令
            if (parsedCommand.type) {
                this.handleAction(parsedCommand);
                
                // 检查命令类型，用于决定本行是否为阻塞性
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
            this.applySpeakerLabel('系统');
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
    };


    
    
    /**
     * 解析命令字符串
     * 将类似 [command param=value] 格式的标签解析为结构化动作对象。
     * 优先使用 DSL（compile → lowerToAction），失败时回退到正则 + 空格分词的传统解析。
     * @param {string} commandStr - 命令字符串，如 "[wait time=1000]" 或 "[pov 角色A]"
     * @returns {Object} - 解析后的动作对象（含 type 与参数）；无法识别时返回空对象 {}
     * @sideEffect 无（纯函数，不修改外部状态）
     */
gameEngine.parseCommand = function(commandStr) {
        // —— DSL 路径：编译后仅取首个节点降级为动作对象 ——
        const dsl = (typeof window === 'object' && window && window.__shiori && window.__shiori.dsl) ? window.__shiori.dsl : null;
        if (dsl && typeof dsl.compile === 'function' && typeof dsl.lowerToAction === 'function') {
            const nodes = (dsl.compile(commandStr).nodes) || [];
            if (!nodes.length) return {};
            return dsl.lowerToAction(nodes[0]) || {};
        }
        // —— 传统路径：正则提取方括号内的命令全文 ——
        // 使用正则表达式提取命令内容
        const cmdMatch = commandStr.match(/\[([^\]]+)\]/);
        if (!cmdMatch) return {};
            
        const fullCmd = cmdMatch[1];
        const parts = fullCmd.split(' ');
        const cmdName = parts[0].toLowerCase();
            
        // 解析键值对参数（支持 time= 1000 这类“等号后带空格”被拆断的写法）
        const params = {};
        for (let i = 1; i < parts.length; i++) {
            // 若当前片段以 '=' 结尾（说明值被空格拆到了下一个片段），先与下一片段合并
            if (parts[i].endsWith('=') && i + 1 < parts.length) {
                parts[i] = parts[i] + parts[i + 1];
                parts.splice(i + 1, 1);
            }
            const paramMatch = parts[i].match(/([a-zA-Z0-9]+)=\s*(.+)/);
            if (paramMatch) {
                params[paramMatch[1]] = paramMatch[2].replace(/"/g, '');
            }
        }
            
        // 根据命令名称调用专门的解析函数
        return this.parseCommandByName(cmdName, params, parts);
    };


        
    /**
     * 根据命令名称解析命令
     * 将不同标签命令转换为统一的动作对象格式（type + 参数），供 handleAction 分发。
     * 支持中英文别名（如 阻止/lock、解锁/free、clear/clearname）。
     * @param {string} cmdName - 命令名称（已转小写）
     * @param {Object} params - 键值对参数对象（如 { time: '1000', color: 'black' }）
     * @param {Array} parts - 空格分割后的命令片段数组（用于取值型命令，如 pov）
     * @returns {Object} - 标准化的动作对象；未识别时返回空对象 {}
     * @sideEffect 无（纯映射函数）
     */
gameEngine.parseCommandByName = function(cmdName, params, parts) {
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
                // 处理POV视角指令：[pov stop] 结束视角；[pov 角色名] 显示视角标识
                if (parts.length >= 2 && parts[1].toLowerCase() === 'stop') {
                    return {
                        type: 'povStop'
                    };
                } else if (parts.length >= 2) {
                    // 提取视角名称（去除引号，允许名称本身包含空格）
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
    };



    /**
     * 静默条件分支：按序求值，首个命中即跳转
     * 规则：
     * 1. 若有 when：用 evaluateCondition 求值（支持 f.变量名 / sf. / tf.）
     * 2. 否则若 flag === '#'：恒真（兜底，必须放最后）
     * 3. 否则：VarSpace.get('f.'+flag) 为真即命中
     * 命中后：若有 add 则 applyAffinity，然后 goTarget
     * @param {Array} choices - 选项数组，每项形如 { when?, flag?, add?, target? }
     * @returns {void}
     * @sideEffect 关闭选项 UI、可能修改好感度（applyAffinity）、可能跳转场景或推进下一行
     */
gameEngine.resolveSilentBranch = function(choices) {
        // 关闭选项菜单状态（静默分支不向玩家展示任何选项 UI）
        this.state.choicesActive = false;
        if (this.elements.optionsContainer) {
            this.elements.optionsContainer.style.display = 'none';
            this.elements.optionsContainer.innerHTML = '';
        }

        // 核心判定逻辑走 VarSpace.resolveBranch（不可用时回退到本文件的 _fallbackResolveBranch）
        var target = (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.resolveBranch)
            ? VarSpace.resolveBranch(choices)
            : this._fallbackResolveBranch(choices);

        if (target !== null && target !== undefined) {
            // 命中分支：跳转到目标（target 为 null 之外的合法值）
            console.log('[SilentBranch] 命中 → ' + target);
            this.handleChoiceTarget(target, null);
        } else {
            // 全部未命中：属异常剧本（通常应有 flag:'#' 兜底），仅告警并继续
            console.warn('[SilentBranch] 全部未命中，继续下一行');
            this.nextLine();
        }
    };



    /**
     * 回退实现：VarSpace 不可用时的静默分支判定
     * 按 choices 顺序求值，首个命中项即为结果：
     * - 含 when：调用 evaluateCondition 求值
     * - flag/target 为 '#'：恒真兜底（应置于末尾）
     * - 含 flag：读取 state.affinity[flag]，非 0 即命中
     * - 均无：视为恒真
     * 命中后若带 add 则先累加好感度，再返回 target。
     * @param {Array} choices - 选项数组
     * @returns {string|null} - 命中的 target；无命中返回 null
     * @sideEffect 命中项含 add 时会调用 applyAffinity 修改好感度
     */
gameEngine._fallbackResolveBranch = function(choices) {
        if (!choices || !choices.length) return null;
        for (var i = 0; i < choices.length; i++) {
            var c = choices[i] || {};
            var hit = false;
            if (c.when) {
                // 条件表达式优先
                hit = this.evaluateCondition(c.when);
            } else if (c.flag === '#' || c.target === '#') {
                // 兜底项：恒真
                hit = true;
            } else if (c.flag) {
                // 好感度/标记变量：非 0 视为命中
                var val = this.state.affinity ? (this.state.affinity[c.flag] || 0) : 0;
                hit = !!val && val !== 0;
            } else {
                // 无任何条件：默认命中
                hit = true;
            }
            if (hit) {
                // 命中且声明了增加值时，先结算好感度变化
                if (c.flag && c.flag !== '#' && c.add !== undefined && c.add !== null) {
                    this.applyAffinity(c.flag, c.add);
                }
                return (c.target !== undefined && c.target !== null) ? c.target : null;
            }
        }
        return null;
    };


    /**
     * 查询开发者全开开关（tf.allclear）
     * @returns {boolean} 开启返回 true
     */
gameEngine.isAllClear = function() {
        return (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.isTempAllClear)
            ? !!VarSpace.isTempAllClear() : false;
    };


    /**
     * 查询当前是否处于回放模式（tf.isReplay 存在）
     * 回放由存档页写入承载键后进入，VarSpace 不可用时一律视为非回放。
     * @returns {boolean}
     */
gameEngine.isReplayMode = function() {
        return (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.isReplaying)
            ? !!VarSpace.isReplaying() : false;
    };


    /**
     * 回退实现：VarSpace 不可用时的分支链求值
     * 判定口径与 VarSpace.resolveEntry 一致，同样返回首个命中项本身
     * @param {Array} entries - 分支项数组
     * @returns {Object|null}
     */
gameEngine._fallbackResolveEntry = function(entries) {
        if (!entries || !entries.length) return null;
        for (var i = 0; i < entries.length; i++) {
            var c = entries[i] || {};
            var hit = false;
            if (c.when) {
                hit = this.evaluateCondition(c.when);
            } else if (c.flag === '#' || c.target === '#') {
                hit = true;
            } else if (c.flag) {
                var val = this.state.affinity ? (this.state.affinity[c.flag] || 0) : 0;
                hit = !!val && val !== 0;
            } else {
                hit = true;
            }
            if (hit) return c;
        }
        return null;
    };


    /**
     * 取分支项的动作体：去掉链本身的两个字段，其余原样保留
     * when 只参与求值，label 只参与按钮文字，都不是动作参数。
     * @param {Object} entry - 分支项
     * @returns {Object} 可直接交给 handleAction 的动作对象
     */
gameEngine.chainEntryAction = function(entry) {
        var body = {};
        for (var k in entry) {
            if (!Object.prototype.hasOwnProperty.call(entry, k)) continue;
            if (k === 'when' || k === 'label') continue;
            body[k] = entry[k];
        }
        return body;
    };


    /**
     * 解析一行的去向（action 字段）
     * action 为数组时表示一条 else-if 链：按序求值，首个命中项即本行的动作，其余项整体跳过；
     * action 为对象时原样返回，等同于只有一项的链。
     * 开发者全开（tf.allclear）时不求值，把全部项交给渲染层逐条列出。
     * @param {Object|Array} action - 行的 action 值
     * @param {number} [lineIndex] - 行号，仅用于告警定位
     * @returns {{action: (Object|null), all: (Array|null)}} all 非空 = 需逐条渲染全部组合
     */
gameEngine.resolveLineAction = function(action, lineIndex) {
        if (!Array.isArray(action)) return { action: action || null, all: null };
        var entries = action.filter(function (e) { return e && typeof e === 'object'; });
        if (!entries.length) return { action: null, all: null };
        // 开发者全开：不自动求值，也不自动跳转，全部项都交给玩家点。
        // 回放期必须旁路这条：回放要靠正常控制流自动走完，按钮会停下来等人点。
        if (this.isAllClear() && !this.isReplayMode()) return { action: null, all: entries };

        var hit = (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.resolveEntry)
            ? VarSpace.resolveEntry(entries)
            : this._fallbackResolveEntry(entries);
        if (!hit) {
            // 全部未命中：属剧本缺兜底项，告警并继续下一行
            console.warn('[ActionChain] 无分支命中，行 ' + lineIndex + ' 继续执行下一行');
            return { action: null, all: null };
        }
        return { action: this.chainEntryAction(hit), all: null };
    };


    
    /**
     * 处理动作指令
     * 根据动作类型（action.type）分发到 gameEngine 对应的演出/系统方法。
     * 这是“解析结果 → 实际执行”的统一出口，本函数自身不含演出细节。
     * @param {Object} action - 动作对象，至少包含 type 字段，其余字段随类型而定
     * @returns {void}
     * @sideEffect 取决于 action.type：可能切换背景/文本/角色、播放音频、修改变量、
     *             显示选项、跳转场景，或安排下一行推进（setTimeout → nextLine）
     */
gameEngine.handleAction = function(action) {
        switch(action.type) {
            case 'choice':
                // 显示选项菜单（集成式分支 DSL，支持静默模式）
                this.showChoices(action.choices, action);
                break;
            case 'waitForTime':
                // 等待指定时间后自动继续（命令序列自己推进时不要抢 nextLine）
                if (this.state.waitSequences && this.state.waitSequences.command) break;
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
                // 跳转到下一个场景/标签（支持携带 flag/add 好感度变化）
                // 使用 goTarget 统一识别：含 .html / 斜杠 → 跨文件 goToScene，否则 → 同文件 jumpToLabel
                if (action.flag && action.add !== undefined && action.add !== null) {
                    this.applyAffinity(action.flag, action.add);
                }
                if(action.target) {
                    // 场景入口快照（shiori_scene_entry_<目标文件>）与 f. 继承信号（shiori_next_scene_target）
                    // 统一在 goToScene 中写入 —— 覆盖 nextScene / choice / 静默分支三条“正常流程”入口
                    this.goTarget(action.target);
                }
                break;
            case 'varProgram':
                // $ 变量语句区（由 ScriptingCore 编译成 vars 节点时经此执行）
                if (typeof VarSpace !== 'undefined' && VarSpace && typeof VarSpace.runProgram === 'function') {
                    var program = action.program;
                    if (typeof program === 'string') VarSpace.runProgram(program);
                    else if (program) VarSpace.runBranches(program);
                }
                break;
            case 'vars':
                // 直接操作 VarSpace 变量空间
                if (typeof VarSpace !== 'undefined' && VarSpace) {
                    if (action.op === 'setSF')      VarSpace.setSF(action.name, action.value);
                    else if (action.op === 'setF')  VarSpace.set('f.' + action.name, action.value);
                    else if (action.op === 'setTF') VarSpace.set('tf.' + action.name, action.value);
                    else if (action.op === 'clearF') VarSpace.clearF();
                    else if (action.op === 'resetSystem') VarSpace.resetSystem();
                    console.log('[vars action]', action.op, action.name, '=', action.value);
                }
                break;
            case 'fadeOut':
                this.fadeOut(action.duration || 1000, action.backgroundColor || 'black', () => {
                    if (this.state.waitSequences && this.state.waitSequences.command) return;
                    setTimeout(() => {
                        this.nextLine();
                    }, 50);
                });
                break;
            case 'fadeIn':
                this.fadeIn(action.duration || 1000, action.backgroundColor || 'black');
                if (this.state.waitSequences && this.state.waitSequences.command) break;
                setTimeout(() => {
                    this.nextLine();
                }, (action.duration || 1000) + 100);
                break;
            case 'clearName':
                this.clearNameBox();
                break;
            case 'hideText':
                this.state.msgOff = true;
                this.hideTextBox();
                break;
            case 'showText':
                this.state.msgOff = false;
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
    };


    
    /**
     * 解析带 [wait time=...] 标签的字符串为序列
     * 适用于 background, bgm, audio, se 等元素
     * @param {string} str - 原始字符串，如 "bg1,[wait time=1000]bg2"
     * @returns {Array|null} - 序列数组（元素为 {type:'wait',duration} 或 {type:'item',value}）；
     *                         不含任何 [wait time] 标签时返回 null，交由调用方按普通字符串处理
     * @sideEffect 无（纯解析，含调试日志输出）
     */
gameEngine.parseWaitTaggedString = function(str) {
        // 空值与类型保护
        if (!str || typeof str !== 'string') return null;
        // 快速预检：检查是否包含 [wait time= 或 [wait time =（允许 time 和 = 之间有空格）
        if (!str.includes('[wait time=') && !str.includes('[wait time =')) return null;
        
        const segments = [];
        // 以逗号切分为独立片段，去除空白并过滤空串
        const parts = str.split(',').map(s => s.trim()).filter(s => s);
        
        console.log('[parseWaitTaggedString] 输入:', str);
        console.log('[parseWaitTaggedString] parts:', JSON.stringify(parts));
        
        for (const part of parts) {
            // 匹配形如 "[wait time=1000]剩余内容"：允许 time 与 = 之间有空格，
            // 并把同一片段中标签之后的剩余内容捕获到第 2 组
            const waitMatch = part.match(/^\[wait\s+time\s*=\s*(\d+)\s*\]\s*(.*)$/);
            if (waitMatch) {
                const duration = parseInt(waitMatch[1], 10);
                const remaining = waitMatch[2].trim();
                console.log('[parseWaitTaggedString] waitMatch 成功:', part, 'duration:', duration, 'remaining:', remaining);
                if (!isNaN(duration) && duration > 0) {
                    // 合法的等待片段：入队等待段
                    segments.push({ type: 'wait', duration });
                } else {
                    // 时间非法（NaN 或 <=0）：忽略该等待段
                    console.warn('[wait time] 无效的时间值:', part);
                }
                if (remaining) {
                    // 标签后紧跟的内容（如 "[wait time=1000]bg2"）作为普通项入队
                    segments.push({ type: 'item', value: remaining });
                }
            } else {
                // 非等待片段：作为普通项处理
                console.log('[parseWaitTaggedString] waitMatch 失败，作为普通item处理:', part);
                segments.push({ type: 'item', value: part });
            }
        }
        console.log('[parseWaitTaggedString] 结果 segments:', JSON.stringify(segments));
        return segments;
    };


    
    /**
     * 中断所有活跃的 [wait time] 序列
     * 遍历 waitSequences 中的每个序列并调用其 skip()（skip 内部会清定时器并立即推进），
     * 再清除 commandWaitTimerId，最后重置 waitSequences 容器。效果类似玩家触发 [s] 标签。
     * @returns {void}
     * @sideEffect 清除定时器、触发序列跳过回调（可能推进到下一行）、重置 this.state.waitSequences
     */
gameEngine.interruptAllWaitSequences = function() {
        if (this.state.waitSequences) {
            Object.keys(this.state.waitSequences).forEach(key => {
                const seq = this.state.waitSequences[key];
                if (seq && typeof seq.skip === 'function') {
                    seq.skip();
                }
            });
        }
        if (this.state.commandWaitTimerId !== null) {
            clearTimeout(this.state.commandWaitTimerId);
            this.state.commandWaitTimerId = null;
        }
        // 重置等待序列状态
        this.state.waitSequences = {};
    };


    
    /**
     * 执行命令序列（支持 [wait time] 标签）
     * [wait time] 作为全局计时器，等待结束后自动进入下一行
     * 每条命令执行完后再递归处理下一条（processNext 串行推进），
     * 遇到 [wait time]/媒体动画/淡入淡出等需要计时的命令时注册可中断的定时器到
     * state.waitSequences.command（含 skip 回调），以便快捷键或 [s] 中断。
     * @param {string} commandStr - 命令字符串（逗号分隔）
     * @param {boolean} [shouldAutoNext=true] - 序列走完后是否自动进入下一行
     * @param {Array} [nodes] - 预算好的 DSL 节点，可复用以避免重复编译
     * @returns {boolean} - 序列中是否包含阻塞性命令（点击等待/动画/计时）
     * @sideEffect 注册/清除定时器、写入 state.waitSequences.command、可能调用 nextLine
     */
gameEngine.executeCommandSequence = function(commandStr, shouldAutoNext = true, nodes) {
        // —— $ 变量语句区：整段原地执行，不参与串行时间轴 ——
        if (this.isVarProgramField(commandStr)) {
            this.runVarProgram(commandStr);
            if (shouldAutoNext) setTimeout(() => this.nextLine(), 100);
            return false;
        }

        // —— DSL 路径：按节点顺序串行执行 ——
        const dsl = (typeof window === 'object' && window && window.__shiori && window.__shiori.dsl) ? window.__shiori.dsl : null;
        if (dsl && typeof dsl.compile === 'function' && typeof dsl.lowerToAction === 'function') {
            const compiled = (nodes && nodes.length) ? nodes : ((dsl.compile(commandStr).nodes) || []);
            let index = 0;
            let hasWaitForClick = false;
            let hasAnimation = false;
            let hasWaitTime = false;
            // 串行推进器：每次只处理一个节点，遇到计时类命令则挂起等待
            const processNext = () => {
                if (index >= compiled.length) {
                    // 全部执行完毕：清理序列标记，按需自动进入下一行
                    this.state.waitSequences.command = null;
                    if (shouldAutoNext && (hasWaitTime || (!hasWaitForClick && !hasAnimation))) {
                        setTimeout(() => this.nextLine(), 100);
                    }
                    return;
                }
                const node = compiled[index++];
                // 显式 [wait time=N] 节点：注册可中断定时器，到时后继续后续节点
                if (node && node.kind === 'wait' && node.mode === 'time') {
                    const parsedWait = dsl.lowerToAction(node);
                    hasWaitTime = true;
                    const duration = (parsedWait && parsedWait.duration) || 1000;
                    const timeoutId = setTimeout(() => {
                        this.state.waitSequences.command = null;
                        processNext();
                    }, duration);
                    this.state.waitSequences.command = {
                        timeoutId,
                        skip: () => { clearTimeout(timeoutId); processNext(); }
                    };
                    return;
                }
                // 执行节点并取得其对应的动作描述
                const parsed = dsl.executeDslNode
                    ? dsl.executeDslNode(node, this)
                    : dsl.lowerToAction(node);
                if (!parsed || !parsed.type) {
                    // 无动作（注释/空节点等）：跳过继续
                    processNext();
                    return;
                }
                // executeDslNode 内部已完成执行；非 DSL 路径才需要显式分发
                if (!dsl.executeDslNode) this.handleAction(parsed);
                if (parsed.type === 'waitForClick') {
                    // 点击等待：标记阻塞，但不推进（由玩家点击触发）
                    hasWaitForClick = true;
                } else if (parsed.type === 'mediaAnim') {
                    // 媒体动画：按时长挂起后可中断
                    hasWaitTime = true;
                    const duration = parsed.duration || 1000;
                    const timeoutId = setTimeout(() => processNext(), duration);
                    this.state.waitSequences.command = {
                        timeoutId,
                        skip: () => { clearTimeout(timeoutId); processNext(); }
                    };
                    return;
                } else if (['fadeOut', 'fadeIn', 'finishGame', 'chapterEnd'].includes(parsed.type)) {
                    // 转场类动画：同样按时长挂起，保证顺序执行
                    hasAnimation = true;
                    const duration = parsed.duration || 1000;
                    const timeoutId = setTimeout(() => processNext(), duration);
                    this.state.waitSequences.command = {
                        timeoutId,
                        skip: () => { clearTimeout(timeoutId); processNext(); }
                    };
                    return;
                }
                processNext();
            };
            // 注册序列占位（skip=processNext），便于外部中断
            this.state.waitSequences.command = { skip: processNext };
            processNext();
            return hasWaitForClick || hasAnimation || hasWaitTime;
        }
        // —— 传统路径：按逗号切分后串行解析执行 ——
        const commands = commandStr.split(',').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
        let index = 0;
        let hasWaitForClick = false;
        let hasAnimation = false;
        let hasWaitTime = false;
        
        // 串行推进器（传统路径版本）
        const processNext = () => {
            if (index >= commands.length) {
                this.state.waitSequences.command = null;
                // 如果有 [wait time]，等待结束后自动进入下一行
                // 如果没有阻塞性命令，也自动进入下一行
                if (shouldAutoNext && (hasWaitTime || (!hasWaitForClick && !hasAnimation))) {
                    setTimeout(() => this.nextLine(), 100);
                }
                return;
            }
            
            const cmd = commands[index++];
            const parsed = this.parseCommand(cmd);
            
            if (!parsed.type) {
                // 未识别命令：跳过
                processNext();
                return;
            }
            
            if (parsed.type === 'waitForTime') {
                // 定时等待：注册可中断定时器，到时后清理标记并继续
                hasWaitTime = true;
                const duration = parsed.duration || 1000;
                const timeoutId = setTimeout(() => {
                    this.state.waitSequences.command = null;
                    processNext();
                }, duration);
                this.state.waitSequences.command = {
                    timeoutId,
                    skip: () => { clearTimeout(timeoutId); processNext(); }
                };
                return;
            }
            
            this.handleAction(parsed);
            
            // 标记阻塞类型（仅用于返回值判断，不打断后续非阻塞命令的顺序执行）
            if (parsed.type === 'waitForClick') {
                hasWaitForClick = true;
            } else if (['fadeOut', 'fadeIn', 'finishGame', 'chapterEnd'].includes(parsed.type)) {
                hasAnimation = true;
            }
            
            processNext();
        };
        
        // 注册序列占位并启动
        this.state.waitSequences.command = { skip: processNext };
        processNext();
        return hasWaitForClick || hasAnimation || hasWaitTime;
    };


    
    /**
     * 评估条件表达式
     * 支持 f./sf./tf. 变量名语法，统一通过 VarSpace 求值
     * 向后兼容：若无 VarSpace，回退到 state.affinity['varName']
     * @param {string} conditionStr - 条件表达式字符串，如 "f.love > 5"
     * @returns {boolean} - 条件评估结果（表达式出错时安全返回 false）
     * @sideEffect 无（回退实现会编译并执行动态表达式，存在 eval 限制）
     */
gameEngine.evaluateCondition = function(conditionStr) {
        try {
            // 优先走 VarSpace.checkCondition（内部用 eval，支持 f./sf./tf.）
            if (typeof VarSpace !== 'undefined' && VarSpace && VarSpace.checkCondition) {
                return VarSpace.checkCondition(conditionStr);
            }
            // 回退：仅支持 f. → state.affinity（把 f.xxx 替换为好感度读取表达式）
            let expr = conditionStr.trim();
            expr = expr.replace(/f\.([a-zA-Z0-9_]+)/g, (match, varName) => {
                return `(this.state.affinity['${varName}'] || 0)`;
            });
            // 以 game 为形参编译表达式，并把 this 作为参数传入
            const result = new Function('game', `return ${expr}`).call(null, this);
            return !!result;
        } catch (e) {
            // 表达式非法或运行出错：记录日志并按“条件不成立”处理，避免中断剧本
            console.error('条件表达式评估错误:', e, '表达式:', conditionStr);
            return false;
        }
    };



    /**
     * 检查当前行是否应该被跳过
     * 条件分支走静默分支 + 标签跳转（resolveSilentBranch / goTarget），不经过行级跳过；
     * 此函数保留仅为兼容既有调用点。
     * @param {number} index - 行索引（保留参数，当前未使用）
     * @returns {boolean} - 是否应该跳过（恒为 false）
     * @deprecated 行级跳过逻辑已废弃，请改用标签跳转
     */
gameEngine.shouldSkipLine = function(index) {
        return false;
    };

