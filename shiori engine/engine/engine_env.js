/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 外部依赖自检与启动初始化：检测 VarSpace 变量系统是否可用，
 * 并在引擎启动时执行幂等初始化，确保后续模块能正常访问变量空间。
 */
/* =========================================================
 * 变量系统（VarSpace / f.·sf.·tf.）接入说明：
 * ---------------------------------------------------------------
 * vars.js 须先于本文件加载（启动器按 engine_manifest.json 在 system.js 之后、engine_core 之前注入）。
 * 引擎后续阶段（好感度 f. / 鉴赏解锁 sf. / 临时态 tf.）将统一通过全局 window.VarSpace 访问。
 * f.  = 游戏变量（剧情内使用，跟随存档）
 * sf. = 系统变量（跨剧情持久化，用于鉴赏解锁等）
 * tf. = 临时变量（仅在当前会话有效，不写入存档）
 * 详见同目录 VAR_SYSTEM_PLAN.md。
 * ========================================================= */

/**
 * VarSpace 变量系统可用性检测与初始化。
 * 变量系统是后续模块（好感度 f.、鉴赏 sf.、临时态 tf.）的前置依赖，
 * 此处做一次启动自检：缺失则给出明确错误日志，存在则确保 init 已执行。
 * 注意：本块为启动期的一次性副作用代码，无导出。
 * @returns {void}
 * @sideeffect 缺失时向控制台输出 error；存在时幂等调用 VarSpace.init()
 */
if (typeof VarSpace === 'undefined' || !VarSpace) {
    console.error('[VarSpace] 未检测到 vars.js：请确保在 engine.js 之前引入 vars.js（否则变量系统不可用）');
} else if (VarSpace.init) {
    /* 幂等调用：vars.js 加载时已初始化，此处仅确保 init 已执行 */
    VarSpace.init();
}
