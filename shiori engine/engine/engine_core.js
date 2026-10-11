/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 引擎核心骨架：定义引擎版本号常量 ENGINE_VERSION，以及全局单例 gameEngine 对象。
 * gameEngine 统一承载运行时状态（state）、DOM 元素引用（elements）、场景数据与资源缓存，
 * 并以挂载方法的方式（gameEngine.<name> = function…）由各模块后续追加能力。
 * 本文件另提供剧情源码行号标注等通用工具方法，是所有 engine 模块的加载前置依赖。
 */

/**
 * 引擎核心版本号 —— Shiori Manager 通过此常量识别引擎版本。
 * 格式：V主版本.次版本.修订号  （与 GameScanner 中的正则 ENGINE_VERSION\s*=\s*["'] 匹配）
 * 请勿删除或重命名此变量，否则管理器将无法正确识别基准的引擎版本。
 */
const ENGINE_VERSION = "V3.0.0";

const gameEngine = {
    state: {
        // 当前场景索引
        currentScene: 0,
        // 当前对话行号
        currentLine: 0,
        // 是否启用全屏小说模式
        novelMode: false,
        // [msgoff] 闩锁：空文本藏框不得在下一句对白时擅自 [msgon]
        msgOff: false,
        // 选项菜单是否处于激活状态
        choicesActive: false,
        // 待显示的选项列表
        pendingSelections: [],
        // 是否禁用Live2D演出效果
        disableLVE: false,
        // 角色好感度数据
        affinity: {},
        // 已完成的场景列表
        completedScenes: [],
        // 已选过的选项分支（键=场景#行号#下标），用于二周目的"已读"标记
        readChoices: {},
        // 右键菜单是否已初始化
        contextMenuInitialized: false,
        // 上下文菜单开关（null=未初始化，由 initContextMenuSwitch 按页面类型写入）
        contextMenuEnabled: null,
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
        // SKIP模式：0=无快进，1=SKIP/1（普通快进），2=SKIP/2（选项处停止）
        skipMode: 0,
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
        // 立绘运行时（动作/缩放/动画）。DOM dataset 只作调试投影。
        charRuntime: {},
        // Auto 立绘舞台闩锁：'Dom' | 'Canvas' | null。场次内不切换，removeAll 清空。
        charStageLatch: null,
        // 持续发抖的立绘状态 { charId: timerId }（由 charRuntime.anim 接管，保留清空兼容）
        shakingChars: {},
        // 立绘动画进行中点击的策略：'settle'=落终态后推进（默认）/ 'ignore'=忽略本次点击
        charAnimClickPolicy: 'settle',
        // 背景转场标志
        isBackgroundTransitioning: false,
        // 角色名称标识符映射表 { roleName: { charId, domElement } }
        charNameMap: {},
        // F5按键防抖标记
        _f5Pressed: false,
        // 鼠标点击锁定状态（用于 [阻止]/[lock] 和 [解锁]/[free] 标签）
        isClickLocked: false,
        // 活跃的 [wait time] 序列状态 { background, bgm, audio, se, chars, command }
        waitSequences: {},
        // 命令元素全局等待定时器ID
        commandWaitTimerId: null
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
     * 图片扩展名缓存：basePath → '.ext'
     * _SHIORI_EXT_MAP 由 C# 在启动时扫描文件系统注入（全覆盖）
     * _charExtCache 为运行时动态填补的本地缓存
     */
    _charExtCache: {},
};

/**
 * 方法追加：gameEngine.<name> = function…（QuickSaveManager 在 engine_save.js）。
 */

    
    /**
     * 为剧情数组中的每个对象添加源码行号范围。
     * 通过 fetch 异步加载当前页面的 HTML 源码，再交给 parseStoryLineNumbers
     * 解析出每个剧情对象在源文件中的物理行区间，供报错定位/编辑器跳转使用。
     * @returns {void}
     * @sideeffect 发起网络请求，并异步写入 sceneData.story[i].__lineRange；失败时仅告警不中断
     * @depends 依赖 this.sceneData.story 已就绪
     */
gameEngine.annotateStoryLineNumbers = function() {
        if (!this.sceneData || !this.sceneData.story) {
            return;
        }
        
        // 获取当前页面URL（解码URL编码的中文字符）
        const rawPage = window.location.pathname.split('/').pop();
        const currentPage = decodeURIComponent(rawPage);
        console.log(`[Line Numbers] Annotating story for ${currentPage}`);
        
        // 异步加载当前HTML文件并解析行号
        fetch(rawPage)
            .then(response => response.text())
            .then(htmlContent => {
                this.parseStoryLineNumbers(htmlContent);
            })
            .catch(error => {
                console.warn('[Line Numbers] Failed to load HTML file:', error);
            });
    };


    
    /**
     * 解析 HTML 内容，提取 story 数组中每个对象的行号范围。
     * 采用花括号配平的方式逐行扫描：定位到 story: 后开始计数，
     * 遇到顶层 `{` 记录对象起始行，当括号深度重新归零时记录结束行。
     * @param {string} htmlContent 页面 HTML 源码
     * @returns {void}
     * @sideeffect 为 this.sceneData.story[i] 注入 __lineRange = { startLine, endLine }（行号从 1 开始）
     */
gameEngine.parseStoryLineNumbers = function(htmlContent) {
        const lines = htmlContent.split('\n');
        const storyObjects = [];
        
        // 查找 story: [ 的位置
        let inStoryArray = false;
        let braceDepth = 0;
        let currentObjectStart = -1;
        let objectBraceDepth = 0;
        
        // 逐行状态机：inStoryArray 标记是否已进入 story 数组；
        // currentObjectStart 为当前对象起始行；objectBraceDepth 跟踪对象内花括号平衡
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
    };

