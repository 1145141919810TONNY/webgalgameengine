/**
 * 进度API - 用于流程图功能的数据接口
 * 从localStorage获取游戏进度并提供JSON格式的数据
 *
 * 场景列表通过自动检测 scenes/ 目录下的 .html 文件获得，
 * 不再使用任何硬编码的场景列表。
 */

// 检查是否为file协议
const isFileProtocol = window.location.protocol === 'file:';

// scenes/ 目录检测结果的缓存（Promise），避免重复请求
let detectedScenesCache = null;

/**
 * 从localStorage的sceneMarkers中提取已记录的场景ID
 * 作为目录检测失败时的回退数据源
 * @returns {string[]} - 场景ID数组（不含 .html 扩展名）
 */
function getScenesFromMarkers() {
    try {
        const progressData = localStorage.getItem('gameProgress');
        if (progressData) {
            const data = JSON.parse(progressData);
            if (data.sceneMarkers && typeof data.sceneMarkers === 'object') {
                return Object.keys(data.sceneMarkers).sort((a, b) => a.localeCompare(b));
            }
        }
    } catch (e) {
        console.error('[ProgressAPI] 从 sceneMarkers 提取场景失败:', e);
    }
    return [];
}

/**
 * 自动检测 scenes/ 目录下的所有 .html 场景文件
 * 通过解析目录列表响应提取文件名，不依赖任何硬编码列表。
 *
 * 兼容性说明：
 * - file:// 协议下 Chrome 会返回 HTML 目录列表
 * - HTTP 服务器下若未开启目录列表则可能失败，此时回退到 sceneMarkers 中已记录的场景
 *
 * @returns {Promise<string[]>} - 场景ID数组（不含 .html 扩展名），已去重并排序
 */
function detectScenesFromFolder() {
    if (detectedScenesCache) return detectedScenesCache;

    detectedScenesCache = (async () => {
        try {
            const response = await fetch('../scenes/');
            if (!response.ok) throw new Error('scenes/ 目录不可访问: HTTP ' + response.status);
            const html = await response.text();

            // 解析目录列表中的 .html 文件引用（形如 <a href="scene1.html">）
            const sceneSet = new Set();
            const hrefRegex = /href="([^"]+\.html)"/gi;
            let match;
            while ((match = hrefRegex.exec(html)) !== null) {
                let name = match[1];
                // 跳过绝对路径与上级目录引用
                if (name.indexOf('//') !== -1 || name.charAt(0) === '/' || name.indexOf('../') === 0) {
                    continue;
                }
                // 去除可能的查询串/锚点
                name = name.split('#')[0].split('?')[0];
                // 解码 URL 编码的中文文件名
                try { name = decodeURIComponent(name); } catch (e) { /* 保持原样 */ }
                // 取纯文件名（去除可能的子路径）
                const base = name.split('/').pop();
                // 去掉 .html 扩展名作为场景ID
                const sceneId = base.replace(/\.html$/i, '');
                if (sceneId) sceneSet.add(sceneId);
            }

            const scenes = Array.from(sceneSet).sort((a, b) => a.localeCompare(b));
            if (scenes.length === 0) throw new Error('目录列表未解析到任何场景文件');
            return scenes;
        } catch (e) {
            console.warn('[ProgressAPI] 自动检测 scenes/ 失败，回退到 sceneMarkers 中已记录的场景:', e);
            return getScenesFromMarkers();
        }
    })();

    return detectedScenesCache;
}

/**
 * 获取游戏进度数据（异步）
 * 场景总数通过自动检测 scenes/ 目录获得，无硬编码。
 * @returns {Promise<Object>} - 进度数据对象
 */
async function getProgressData() {
    // 自动检测 scenes/ 目录内的场景总数
    const allScenes = await detectScenesFromFolder();
    const totalScenes = allScenes.length;

    let raw = null;
    try {
        raw = localStorage.getItem('gameProgress');
    } catch (e) {
        if (isFileProtocol) {
            console.warn('在file://协议下localStorage可能受限:', e);
        } else {
            console.error('获取进度数据失败:', e);
        }
    }

    if (!raw) {
        return Object.assign(getDefaultProgressData(), { totalScenes: totalScenes });
    }

    try {
        const data = JSON.parse(raw);
        const sceneMarkers = data.sceneMarkers || {};
        const completedScenes = data.completedScenes || [];

        // 仅统计自动检测到的场景中已完成的数量，过滤历史脏数据
        // completedScenes 可能以 'xxx.html' 或 'xxx' 形式记录，两种都兼容
        const completedCount = allScenes.filter(id =>
            completedScenes.includes(id + '.html') || completedScenes.includes(id)
        ).length;
        const completionRate = totalScenes > 0 ? Math.round((completedCount / totalScenes) * 100) : 0;

        return {
            lastUpdated: new Date(data.timestamp || Date.now()).toISOString(),
            completedScenes: completedScenes,
            sceneMarkers: sceneMarkers,
            totalScenes: totalScenes,
            completionRate: completionRate,
            gameStats: {
                totalPlayTime: 0,
                lastPlayed: new Date(data.timestamp || Date.now()).toISOString(),
                affinityValues: data.gameState && data.gameState.affinity ? data.gameState.affinity : {}
            }
        };
    } catch (e) {
        console.error('解析进度数据失败:', e);
        return Object.assign(getDefaultProgressData(), { totalScenes: totalScenes });
    }
}

/**
 * 获取默认进度数据
 * totalScenes 默认为 0（实际总数由 getProgressData 通过自动检测填充）
 * @returns {Object} - 默认进度对象
 */
function getDefaultProgressData() {
    return {
        lastUpdated: new Date().toISOString(),
        completedScenes: [],
        sceneMarkers: {},
        totalScenes: 0,
        completionRate: 0,
        gameStats: {
            totalPlayTime: 0,
            lastPlayed: null,
            affinityValues: {}
        }
    };
}

// 如果在浏览器环境中，添加一个全局函数供其他脚本调用
if (typeof window !== 'undefined') {
    window.GalgameProgressAPI = {
        // 获取进度数据（异步，因需自动检测 scenes/ 目录）
        getProgress: getProgressData,

        // 自动检测 scenes/ 目录下的所有场景（暴露供外部使用）
        detectScenes: detectScenesFromFolder,

        // 获取简化的进度数据，适合流程图使用（异步）
        getFlowchartData: async function() {
            const progress = await getProgressData();
            const allScenes = await detectScenesFromFolder();
            const sceneMarkers = progress.sceneMarkers || {};

            // 为流程图生成节点数据：start + 自动检测到的所有场景 + end
            const flowNodes = [
                { id: 'start', label: '游戏开始', type: 'start', completed: true }
            ];

            allScenes.forEach(sceneId => {
                const marker = sceneMarkers[sceneId];
                // 新格式: {visited: 1, lastAccessTime: ...}；旧格式: 1
                const visited = (typeof marker === 'object' && marker.visited === 1) || marker === 1;
                flowNodes.push({
                    id: sceneId,
                    label: sceneId.replace(/_/g, ' '),
                    type: 'scene',
                    completed: visited
                });
            });

            flowNodes.push({ id: 'end', label: '游戏结束', type: 'end', completed: false });

            // 生成连接线（通用线性模式：start → 场景1 → 场景2 → ... → end）
            // 实际游戏分支结构应由专门的流程图配置提供，这里仅给出无硬编码的默认布局
            const flowEdges = [];
            if (allScenes.length > 0) {
                flowEdges.push({ from: 'start', to: allScenes[0] });
                for (let i = 0; i < allScenes.length - 1; i++) {
                    flowEdges.push({ from: allScenes[i], to: allScenes[i + 1] });
                }
                flowEdges.push({ from: allScenes[allScenes.length - 1], to: 'end' });
            }

            return {
                nodes: flowNodes,
                edges: flowEdges,
                completionRate: progress.completionRate,
                completedScenes: progress.completedScenes,
                sceneMarkers: progress.sceneMarkers
            };
        },

        // 导出进度数据（异步）
        exportSaveData: async function() {
            return await getProgressData();
        },

        // 重置进度（异步）
        resetProgress: async function() {
            try {
                localStorage.removeItem('gameProgress');
                // 清空检测缓存，以便下次重新检测
                detectedScenesCache = null;
            } catch (e) {
                if (isFileProtocol) {
                    console.warn('在file://协议下无法删除localStorage:', e);
                } else {
                    console.error('删除进度数据失败:', e);
                }
            }
            return await this.getProgress();
        },

        /**
         * UI 偏好：背景遮罩透明度（archive.html 缩略图黑色遮罩层）
         * 范围 0-100（百分比整数，0=不显示，100=全黑），默认 50。
         * 独立持久化在 localStorage 的 'archiveBgMaskOpacity' 键中。
         * @returns {number} - 0-100 的遮罩透明度
         */
        getBgMaskOpacity: function() {
            try {
                const v = localStorage.getItem('archiveBgMaskOpacity');
                if (v === null || v === '') return 50;
                const n = parseInt(v, 10);
                if (isNaN(n)) return 50;
                return Math.max(0, Math.min(100, n));
            } catch (e) {
                return 50;
            }
        },

        /**
         * 保存背景遮罩透明度
         * @param {number} opacity - 0-100 的整数
         */
        setBgMaskOpacity: function(opacity) {
            const n = Math.max(0, Math.min(100, parseInt(opacity, 10) || 0));
            try {
                localStorage.setItem('archiveBgMaskOpacity', String(n));
            } catch (e) {
                if (isFileProtocol) {
                    console.warn('在file://协议下无法保存遮罩透明度:', e);
                } else {
                    console.error('保存遮罩透明度失败:', e);
                }
            }
            return n;
        }
    };
}

// 如果在Node.js环境中（服务端），则导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getProgressData,
        getDefaultProgressData,
        detectScenesFromFolder,
        getScenesFromMarkers
    };
}
