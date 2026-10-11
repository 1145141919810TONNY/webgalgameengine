/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 立绘字符串解析模块：负责将剧本中的立绘修饰词字符串（中英文混合）解析为结构化的属性对象。
 * 主要职责包括：水平/垂直定位、精确坐标（x:/y:/z:）、百分比缩放、层级（前/后）、
 * 动画与动作指令、渐入渐出、亮度控制，以及差分立绘（CHAR_DIFF_CONFIG）的方位/服装/表情帧解析。
 * 本文件仅做纯解析，不直接操作 DOM；解析结果由渲染层消费。
 */



   /**
    * 解析角色修饰词（差分立绘系统）
    * 
    * 在差分立绘场景下将修饰词字符串解析为渲染所需的完整属性对象。
    * 与 parseCharModifiers 的区别：差分立绘会先把 dress/face 的 id 从修饰词中过滤掉，
    * 并按角色配置动态获取方位关键词；返回值额外携带 orientation/dress/face 等差分字段。
    * 各修饰类别（坐标、缩放、方位、层级、动作、渐变、亮度）在结果中互不覆盖，
    * 且每类均只取第一个匹配项。
    * 
    * @param {string} mods - 修饰词字符串（空格分隔，如 "正面 校服 微笑 左 下 前"）
    * @param {string} charName - 角色名，用于从 CHAR_DIFF_CONFIG 获取可用方位关键词
    * @param {object} dress - 已选定的服装（dress）对象，可为 null
    * @param {object} face - 已选定的表情（face）对象，可为 null
    * @returns {Object} 解析结果，含 orientation/dress/face/position/vertical/zIndexOffset/
    *                   scale/instant/actionType/fadeType/brightness/preciseX/preciseY/preciseZ/
    *                   left/bottom/clipPath，以及 positionExplicit/verticalExplicit/scaleExplicit 标记
    */
gameEngine.parseCharDiffModifiers = function(mods, charName, dress, face) {
        const result = {
            orientation: null,
            dress: dress,
            face: face,
            position: 'middle',
            positionExplicit: false,
            vertical: 'middle',
            verticalExplicit: false,
            zIndexOffset: 0,
            scale: 1,
            scaleExplicit: false,
            instant: false,
            actionType: null,
            fadeType: null,
            brightness: null,
            preciseX: null,
            preciseY: null,
            preciseZ: null,
            left: '50%',
            bottom: '0',
            clipPath: 'none'
        };

        const modArray = mods.split(' ').filter(Boolean);
        const dressId = dress ? dress.id : null;
        const faceId = face ? face.id : null;
        const filteredModArray = modArray.filter(mod => mod !== dressId && mod !== faceId);

        // 动态获取方位关键词
        const orientationKeywords = (typeof CHAR_DIFF_CONFIG !== 'undefined' && CHAR_DIFF_CONFIG[charName])
            ? Object.keys(CHAR_DIFF_CONFIG[charName]) : ['正面', '侧面'];

        // 关键词映射表
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
           '平': 'flat', 'flat': 'flat',
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
            '点头': 'nod', 'nod': 'nod',
            '左倒': 'ltilt', 'ltilt': 'ltilt',
            '右倒': 'rtilt', 'rtilt': 'rtilt',
            '站立': 'stand', 'stand': 'stand',
            '得意': 'proud', 'proud': 'proud',
            '持续得意': 'cproud', 'cproud': 'cproud',
            '结束得意': 'sproud', 'sproud': 'sproud'
        };

        const fadeMap = {
            '渐入': 'fadeIn', 'fadeIn': 'fadeIn',
            '渐出': 'fadeOut', 'fadeOut': 'fadeOut',
            '左渐出': 'leftFadeOut', 'lfadeOut': 'leftFadeOut',
            '右渐出': 'rightFadeOut', 'rfadeOut': 'rightFadeOut',
            '左渐入': 'leftFadeIn', 'lfadeIn': 'leftFadeIn',
            '右渐入': 'rightFadeIn', 'rfadeIn': 'rightFadeIn'
        };

        const brightnessMap = {
            '明': 'bright', 'bright': 'bright',
            '暗': 'dim', 'dim': 'dim', 'dark': 'dim'
        };

        // 精确坐标
        for (const mod of filteredModArray) {
            if (mod.startsWith('x:')) {
                const value = mod.substring(2);
                if (value.endsWith('%')) {
                    const percentValue = parseFloat(value.slice(0, -1));
                    if (!isNaN(percentValue)) {
                        result.preciseX = percentValue;
                        result.positionExplicit = true;
                    }
                }
            }
            if (mod.startsWith('y:')) {
                const value = mod.substring(2);
                if (value.endsWith('%')) {
                    const percentValue = parseFloat(value.slice(0, -1));
                    if (!isNaN(percentValue)) {
                        result.preciseY = percentValue;
                        result.verticalExplicit = true;
                    }
                }
            }
            if (mod.startsWith('z:')) {
                const value = mod.substring(2);
                const angleValue = parseFloat(value);
                if (!isNaN(angleValue)) {
                    result.preciseZ = Math.max(-360, Math.min(360, angleValue));
                }
            }
        }

        // 百分比缩放：与旧版立绘保持一致，支持正数、负数和小数。
        // x:/y: 坐标中的百分号不能被当作缩放处理。
        for (const mod of filteredModArray) {
            if (!mod.endsWith('%') || mod.startsWith('x:') || mod.startsWith('y:')) {
                continue;
            }

            const percentValue = parseFloat(mod.slice(0, -1));
            if (isNaN(percentValue)) {
                continue;
            }

            const scaleValue = 1 + (percentValue / 100);
            if (scaleValue <= 0) {
                console.warn(`[CharDiffParser] Invalid scale value ${mod}, reset to 100%`);
                result.scale = 1;
            } else {
                result.scale = scaleValue;
                result.scaleExplicit = true;
            }
            break;
        }

        // 方位
        for (const mod of filteredModArray) {
            if (orientationKeywords.includes(mod)) {
                result.orientation = mod;
                break;
            }
        }

        // 水平位置
        for (const mod of filteredModArray) {
            if (positionMap.hasOwnProperty(mod)) {
                result.position = positionMap[mod];
                switch (result.position) {
                    case 'leftl': result.left = '15%'; break;
                    case 'left': result.left = '25%'; break;
                    case 'leftr': result.left = '35%'; break;
                    case 'middle': result.left = '50%'; break;
                    case 'rightl': result.left = '65%'; break;
                    case 'right': result.left = '75%'; break;
                    case 'rightr': result.left = '85%'; break;
                }
                result.positionExplicit = true;
                break;
            }
        }

        // 垂直位置
        for (const mod of filteredModArray) {
            if (verticalMap.hasOwnProperty(mod)) {
                result.vertical = verticalMap[mod];
                switch (result.vertical) {
                    case 'down': result.bottom = '-25%'; break;
                    case 'downm': result.bottom = '-50%'; break;
                    case 'downd': result.bottom = '-65%'; break;
                    case 'up': result.bottom = '25%'; break;
                    case 'upm': result.bottom = '50%'; break;
                    case 'upu': result.bottom = '65%'; break;
                }
                result.verticalExplicit = true;
                break;
            }
        }

        // 层级
        for (const mod of filteredModArray) {
            if (layerMap.hasOwnProperty(mod)) {
                result.zIndexOffset = layerMap[mod] === 'front' ? 1 : -1;
                break;
            }
        }

        // 动画指令
        for (const mod of filteredModArray) {
            if (animationMap.hasOwnProperty(mod)) {
                result.instant = true;
                break;
            }
        }

        // 动作类型
        for (const mod of filteredModArray) {
            if (actionMap.hasOwnProperty(mod)) {
                result.actionType = actionMap[mod];
                break;
            }
        }

        // 渐变类型
        for (const mod of filteredModArray) {
            if (fadeMap.hasOwnProperty(mod)) {
                result.fadeType = fadeMap[mod];
                break;
            }
        }

        // 亮度控制
        for (const mod of filteredModArray) {
            if (brightnessMap.hasOwnProperty(mod)) {
                result.brightness = brightnessMap[mod];
                break;
            }
        }

        return result;
    };



    /**
     * 判断是否为修饰词关键词
     * 
     * 用于区分「角色ID」与「修饰词」：解析角色序列时，末尾 token 若不是关键词则视为角色ID。
     * 覆盖水平/垂直位置、层级、动画、消失、渐入渐出、动作、亮度，以及 x:/y:/z:/百分比 等格式。
     * 
     * @param {string} word - 待检查的单词
     * @returns {boolean} - 如果是修饰词关键词返回true，否则返回false
     */
gameEngine.isModifierKeyword = function(word) {
        // 水平位置关键词
        const positionKeywords = ['左左', 'leftl', '左', 'left', '左右', 'leftr', '中', 'middle', 'center', '右左', 'rightl', '右', 'right', '右右', 'rightr'];
        // 垂直位置关键词
        const verticalKeywords = ['平', 'flat', '下', 'down', '中下', 'downm', '下下', 'downd', 'bottom', '上', 'up', '中上', 'upm', '上上', 'upu', 'top'];
        // 层级关键词
        const layerKeywords = ['前', 'front', '后', 'back'];
        // 动画关键词
        const animationKeywords = ['瞬', 'moment', 'instant'];
        // 消失指令关键词
        const removeKeywords = ['消失', 'hide', 'remove'];
        // 渐入渐出关键词
        const fadeKeywords = ['渐入', 'fadeIn', '渐出', 'fadeOut', '左渐出', 'lfadeOut', '右渐出', 'rfadeOut', '左渐入', 'lfadeIn', '右渐入', 'rfadeIn'];
        // 动作指令关键词
        const actionKeywords = ['后退', 'retreat', '前进', 'forward', '吓一跳', 'scare', '发抖', 'shake', '持续发抖', 'cshake', '结束发抖', 'sshake', '点头', 'nod', '左倒', 'ltilt', '右倒', 'rtilt', '站立', 'stand', '得意', 'proud', '持续得意', 'cproud', '结束得意', 'sproud'];
        // 亮度控制关键词
        const brightnessKeywords = ['明', 'bright', '暗', 'dim', 'dark'];
        
        // 检查是否匹配任何关键词
        if (positionKeywords.includes(word)) return true;
        if (verticalKeywords.includes(word)) return true;
        if (layerKeywords.includes(word)) return true;
        if (animationKeywords.includes(word)) return true;
        if (removeKeywords.includes(word)) return true;
        if (fadeKeywords.includes(word)) return true;
        if (actionKeywords.includes(word)) return true;
        if (brightnessKeywords.includes(word)) return true;
        
        // 检查是否以 x: 或 y: 或 z: 开头
        if (word.startsWith('x:') || word.startsWith('y:') || word.startsWith('z:')) return true;
        
        // 检查是否为百分比缩放（以%结尾且不是x:或y:格式）
        if (word.endsWith('%') && !word.startsWith('x:') && !word.startsWith('y:')) {
            const percentValue = parseFloat(word.slice(0, -1));
            if (!isNaN(percentValue)) return true;
        }
        
        return false;
    };



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
     * 
     * 执行流程（按顺序）：
     * 1. 扫描精确坐标 x:/y:/z:（最高优先级，z 角度限制在 -360~360）
     * 2~3. 无精确坐标时解析水平/垂直位置关键词
     * 4~9. 依次解析层级、瞬(instant)、百分比缩放、动作、渐变、亮度（每类只取第一个匹配）
     * 收尾：若存在动作指令则自动屏蔽「瞬」；最后输出未识别修饰词警告并返回结果。
     */
gameEngine.parseCharModifiers = function(mods) {
        console.log(`[CharParser] Parsing modifiers: "${mods}"`);
        
        let left = '50%'; // 默认中
        let zIndexOffset = 0;
        let clipPath = 'none'; // 默认不裁剪
        let scale = 1; // 默认缩放比例 100%
        let bottom = '0'; // 默认底部位置
        let instant = false; // 默认不禁用动画
        let preciseX = null; // 精确X坐标（以屏幕中心为0%）
        let preciseY = null; // 精确Y坐标（以屏幕底部为0%）
        let preciseZ = null; // 精确Z轴旋转角度（度）
        let actionType = null; // 动作类型指令
        let brightness = null; // 亮度控制：'bright'(明亮/100%) 或 'dim'(变暗/50%)
    
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
           '平': 'flat', 'flat': 'flat',
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
            '点头': 'nod', 'nod': 'nod',
            '左倒': 'ltilt', 'ltilt': 'ltilt',
            '右倒': 'rtilt', 'rtilt': 'rtilt',
            '站立': 'stand', 'stand': 'stand',
            '得意': 'proud', 'proud': 'proud',
            '持续得意': 'cproud', 'cproud': 'cproud',
            '结束得意': 'sproud', 'sproud': 'sproud'
        };
    
        const fadeMap = {
            '渐入': 'fadeIn', 'fadeIn': 'fadeIn',
            '渐出': 'fadeOut', 'fadeOut': 'fadeOut',
            '左渐出': 'leftFadeOut', 'lfadeOut': 'leftFadeOut',
            '右渐出': 'rightFadeOut', 'rfadeOut': 'rightFadeOut',
            '左渐入': 'leftFadeIn', 'lfadeIn': 'leftFadeIn',
            '右渐入': 'rightFadeIn', 'rfadeIn': 'rightFadeIn'
        };
    
        const brightnessMap = {
            '明': 'bright', 'bright': 'bright',
            '暗': 'dim', 'dim': 'dim', 'dark': 'dim'
        };
    
        // 第一步：检测精确坐标指令（具有最高优先级，将覆盖后续位置关键词）
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
            // 检测 z: 格式
            if (mod.startsWith('z:')) {
                const value = mod.substring(2);
                // z: 不需要百分比符号，直接是角度值
                const angleValue = parseFloat(value);
                if (!isNaN(angleValue)) {
                    // 限制角度范围在 -360 到 360 度之间
                    preciseZ = Math.max(-360, Math.min(360, angleValue));
                    console.log(`[CharParser] Detected precise Z rotation: z:${preciseZ}°`);
                } else {
                    console.warn(`[CharParser] Invalid Z rotation format: ${mod}`);
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
    
        // 第九步：提取亮度控制指令（取第一个匹配的）
        let brightnessKeywordFound = false;
        for (const mod of modArray) {
            if (brightnessMap.hasOwnProperty(mod)) {
                if (brightnessKeywordFound) {
                    console.warn(`[CharParser] Conflict: Brightness keyword '${mod}' ignored. First match retained.`);
                } else {
                    brightness = brightnessMap[mod];
                    console.log(`[CharParser] Brightness control detected: '${mod}' -> ${brightness}`);
                    brightnessKeywordFound = true;
                }
                break; // 取第一个匹配的亮度控制指令
            }
        }
    
        // 如果存在动作指令，自动屏蔽"瞬"指令
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
            ...Object.keys(fadeMap),
            ...Object.keys(brightnessMap)
        ];
        
        for (const mod of modArray) {
            // 跳过已知的关键词
            if (allKnownKeywords.includes(mod)) continue;
            // 跳过精确坐标和旋转
            if (mod.startsWith('x:') || mod.startsWith('y:') || mod.startsWith('z:')) continue;
            // 跳过百分比缩放
            if (mod.endsWith('%')) continue;
            // 跳过角色ID（最后一个部分，在 updateChar 中处理）
            
            // 如果都不是，可能是未知关键词
            console.warn(`[CharParser] Warning: Unknown modifier '${mod}' in '[${mods} lhX]'. Ignored.`);
        }
    
        console.log(`[CharParser] Final result: left=${left}, bottom=${bottom}, zIndex=${10 + zIndexOffset}, scale=${(scale * 100).toFixed(0)}%, instant=${instant}, action=${actionType || 'none'}, fade=${fadeType || 'none'}, brightness=${brightness || 'none'}`);
    
        return {
            left,
            zIndex: 10 + zIndexOffset,
            clipPath,
            scale,
            bottom,
            instant,
            preciseX,
            preciseY,
            preciseZ,
            actionType,
            fadeType,
            brightness
        };
    };

    /**
     * 解析角色指令序列
     * 
     * 将 chars 指令按逗号切分为多个「片段(segment)」，并判定首个片段中的角色名：
     * - 若首段首词命中 CHAR_DIFF_CONFIG 则走差分立绘模式（useDiff=true）；
     * - 否则若首词不是修饰词关键词，则视为普通角色名；
     * 若识别出角色名，会从每个片段开头剥离该角色名前缀。
     * 非差分模式下，取最后一个片段的最后一个 token 作为角色ID（须不是修饰词关键词）。
     * 
     * @param {string} sequenceContent - 原始序列字符串（逗号分隔多个立绘片段）
     * @returns {{valid:boolean, roleName:(string|null), useDiff:boolean, queueKey:(string|null), segments:string[]}}
     *          解析结果；非法输入（空串/非字符串/无法定位角色ID）返回 valid=false 的空结构
     * @sideeffect 无（纯解析，不产生副作用）
     */
gameEngine.parseCharSequence = function(sequenceContent) {
        const empty = { valid: false, roleName: null, useDiff: false, queueKey: null, segments: [] };
        if (!sequenceContent || typeof sequenceContent !== 'string') return empty;
        const raw = sequenceContent.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        if (raw.length === 0) return empty;

        const firstSegmentParts = raw[0].split(/\s+/).filter(Boolean);
        const firstPart = firstSegmentParts[0];
        let roleName = null;
        let useDiff = false;
        let segments = raw.slice();
        const diffConfig = (typeof CHAR_DIFF_CONFIG !== 'undefined') ? CHAR_DIFF_CONFIG : null;
        const isMod = (typeof this.isModifierKeyword === 'function')
            ? this.isModifierKeyword.bind(this)
            : function() { return false; };

        if (firstSegmentParts.length > 1 && firstPart) {
            if (diffConfig && diffConfig[firstPart]) {
                roleName = firstPart;
                useDiff = true;
            } else if (!isMod(firstPart)) {
                roleName = firstPart;
            }
            if (roleName) {
                segments = raw.map(function(seg) {
                    if (seg.indexOf(roleName + ' ') === 0) return seg.substring(roleName.length + 1).trim();
                    return seg;
                }).filter(Boolean);
            }
        }

        if (useDiff) {
            if (segments.length === 0) return empty;
            return { valid: true, roleName: roleName, useDiff: true, queueKey: roleName, segments: segments };
        }

        const lastParts = (segments[segments.length - 1] || '').split(/\s+/).filter(Boolean);
        const charId = lastParts[lastParts.length - 1];
        if (!charId || isMod(charId)) return empty;
        return { valid: true, roleName: roleName, useDiff: false, queueKey: charId, segments: segments };
    };

    /**
     * 解析差分立绘帧
     * 
     * 依据角色名与修饰词片段，从 CHAR_DIFF_CONFIG 中定位：
     * 1) 方位(orientation)：取 parts 中第一个命中的方位关键词；
     * 2) 服装(dress) 与 表情(face)：优先按 id 精确匹配，未命中则回退到该方位下的第一项。
     * 三者缺一（未识别方位，或 dress/face 缺失）即返回 null，表示无法构成有效差分帧。
     * 
     * @param {string} roleName - 角色名（CHAR_DIFF_CONFIG 的键）
     * @param {string[]} modifiersParts - 修饰词片段数组
     * @returns {{orientation:string, dress:Object, face:Object}|null} 差分帧描述；无法解析时返回 null
     * @depends CHAR_DIFF_CONFIG 全局配置
     */
gameEngine.resolveCharDiffFrame = function(roleName, modifiersParts) {
        if (!roleName || typeof CHAR_DIFF_CONFIG === 'undefined' || !CHAR_DIFF_CONFIG[roleName]) return null;
        const parts = Array.isArray(modifiersParts) ? modifiersParts : [];
        const orientationKeywords = Object.keys(CHAR_DIFF_CONFIG[roleName]);
        let orientation = null;
        for (let i = 0; i < parts.length; i++) {
            if (orientationKeywords.indexOf(parts[i]) !== -1) {
                orientation = parts[i];
                break;
            }
        }
        if (!orientation) return null;
        const orientationConfig = CHAR_DIFF_CONFIG[roleName][orientation];
        if (!orientationConfig) return null;

        let dress = null;
        let face = null;
        if (orientationConfig.dress) {
            for (let i = 0; i < parts.length; i++) {
                const foundDress = orientationConfig.dress.find(function(d) { return d.id === parts[i]; });
                if (foundDress) { dress = foundDress; break; }
            }
            if (!dress && orientationConfig.dress.length > 0) dress = orientationConfig.dress[0];
        }
        if (orientationConfig.face) {
            for (let i = 0; i < parts.length; i++) {
                const foundFace = orientationConfig.face.find(function(f) { return f.id === parts[i]; });
                if (foundFace) { face = foundFace; break; }
            }
            if (!face && orientationConfig.face.length > 0) face = orientationConfig.face[0];
        }
        if (!dress || !face) return null;
        return { orientation: orientation, dress: dress, face: face };
    };

    /**
     * 判断剧本行是否含有可见文本
     * 
     * 供渲染/推进逻辑判断当前行是否需要显示对话框文本。
     * 
     * @param {Object} line - 剧本行对象
     * @returns {boolean} - line 有效且其 text 为非空白字符串时返回 true
     */
gameEngine.lineHasVisibleText = function(line) {
        if (!line || typeof line !== 'object') return false;
        if (typeof line.text !== 'string') return false;
        return line.text.trim() !== '';
    };

    /**
     * 判断立绘布局是否需要播放过渡动画
     * 
     * 对比上一次记录的布局与本次目标值，仅在水平位置、垂直位置或旋转角度发生变化时返回 true，
     * 从而避免无意义的重复动画。旋转差异采用 0.01 的容差以过滤浮点抖动。
     * 
     * @param {Object|null} prev - 上一次的立绘布局记录（含 left/bottom/rotation）
     * @param {string} left - 本次水平位置
     * @param {string} bottom - 本次垂直位置
     * @param {number} rotation - 本次旋转角度（度）
     * @returns {boolean} - 需要动画返回 true；无历史记录或布局未变化返回 false
     */
gameEngine.shouldAnimateCharLayout = function(prev, left, bottom, rotation) {
        if (!prev) return false;
        const prevRot = Number.isFinite(prev.rotation) ? prev.rotation : 0;
        const nextRot = Number.isFinite(rotation) ? rotation : 0;
        return prev.left !== left || prev.bottom !== bottom || Math.abs(prevRot - nextRot) > 0.01;
    };

    /**
     * 计算「站立」动作结束时应恢复的旋转角度
     * 
     * 优先采用显式指定的 z: 角度；否则沿用运行时记录(rt)中的当前旋转；两者皆无则回退为 0 度。
     * 
     * @param {Object|null} rt - 运行时立绘状态对象（含 rotation 字段）
     * @param {number|string|null} explicitZ - 显式指定的旋转角度（来自 z: 修饰词）
     * @returns {number} - 归一化后的旋转角度（度）
     */
gameEngine.standFromRotation = function(rt, explicitZ) {
        if (explicitZ !== null && explicitZ !== undefined && Number.isFinite(Number(explicitZ))) {
            return Number(explicitZ);
        }
        if (rt && Number.isFinite(rt.rotation)) return rt.rotation;
        return 0;
    };

