/**
 * 进度API - 用于流程图功能的数据接口
 * 从localStorage获取游戏进度并提供JSON格式的数据
 */

// 检查是否为file协议
const isFileProtocol = window.location.protocol === 'file:';

// 模拟服务器端API响应（在客户端环境中）
function getProgressData() {
    let progressData;
    
    if (isFileProtocol) {
        // 在file://协议下，尝试多种存储方式
        try {
            // 首先尝试localStorage
            progressData = localStorage.getItem('gameProgress');
        } catch (e) {
            console.warn('在file://协议下localStorage可能受限:', e);
            progressData = null;
        }
    } else {
        try {
            // 在HTTP协议下，正常使用localStorage
            progressData = localStorage.getItem('gameProgress');
        } catch (e) {
            console.error('获取进度数据失败:', e);
            progressData = null;
        }
    }
    
    if (progressData) {
        try {
            const data = JSON.parse(progressData);
            
            // 计算完成率
            const totalScenes = 6; // 假设有6个场景
            const completedCount = data.completedScenes ? data.completedScenes.length : 0;
            const completionRate = totalScenes > 0 ? Math.round((completedCount / totalScenes) * 100) : 0;
            
            return {
                lastUpdated: new Date(data.timestamp || Date.now()).toISOString(),
                completedScenes: data.completedScenes || [],
                sceneMarkers: data.sceneMarkers || {}, // 添加场景标识符数据
                totalScenes: totalScenes,
                completionRate: completionRate,
                gameStats: {
                    totalPlayTime: 0, // 暂时无法统计，可根据需要实现
                    lastPlayed: new Date(data.timestamp || Date.now()).toISOString(),
                    affinityValues: data.gameState && data.gameState.affinity ? data.gameState.affinity : {}
                }
            };
        } catch (e) {
            console.error('解析进度数据失败:', e);
            return getDefaultProgressData();
        }
    } else {
        return getDefaultProgressData();
    }
}

function getDefaultProgressData() {
    return {
        lastUpdated: new Date().toISOString(),
        completedScenes: [],
        totalScenes: 6,
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
        getProgress: getProgressData,
        
        // 获取简化的进度数据，适合流程图使用
        getFlowchartData: function() {
            const progress = getProgressData();
            
            // 自动检测所有可能的场景文件
            const allPossibleScenes = [
                'scene1', 'scene2', 'scene3', 
                'scene_demo', 'scene_demo_advanced',
                'scene4', 'scene5', 'scene6', 'scene7', 'scene8', 'scene9', 'scene10',
                'ending1', 'ending2', 'ending3',
                'sub_scene1', 'sub_scene2', 'sub_scene3'
            ];
            
            // 为流程图生成节点数据
            const flowNodes = [
                { id: 'start', label: '游戏开始', type: 'start', completed: true }
            ];
            
            // 为每个可能的场景创建节点
            allPossibleScenes.forEach(sceneId => {
                const completed = progress.sceneMarkers && progress.sceneMarkers[sceneId] === 1;
                flowNodes.push({
                    id: sceneId,
                    label: sceneId.replace('_', ' '),
                    type: 'scene',
                    completed: completed
                });
            });
            
            flowNodes.push({ id: 'end', label: '游戏结束', type: 'end', completed: false });
            
            // 生成连接线数据（这里使用通用的连接模式，实际可根据游戏逻辑调整）
            const flowEdges = [
                { from: 'start', to: 'scene1' },
                { from: 'scene1', to: 'scene2' },
                { from: 'scene2', to: 'scene3' },
                { from: 'scene1', to: 'scene_demo' },
                // 可以根据具体游戏逻辑添加更多连接
            ];
            
            return {
                nodes: flowNodes,
                edges: flowEdges,
                completionRate: progress.completionRate,
                completedScenes: progress.completedScenes,
                sceneMarkers: progress.sceneMarkers
            };
        },
        
        // 导出进度数据
        exportSaveData: function() {
            return getProgressData();
        },
        
        // 重置进度
        resetProgress: function() {
            try {
                localStorage.removeItem('gameProgress');
            } catch (e) {
                if (isFileProtocol) {
                    console.warn('在file://协议下无法删除localStorage:', e);
                } else {
                    console.error('删除进度数据失败:', e);
                }
            }
            return this.getProgress();
        }
    };
}

// 如果在Node.js环境中（服务端），则导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getProgressData,
        getDefaultProgressData
    };
}