/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 * 
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 * 
 * 背景图片配置文件
 * 集中管理所有场景背景图片资源路径
 * 仅用于剧本场景（Scene）中通过 background: "key_name" 引用
 * 严禁将这些背景图添加到 html/CG.html 的鉴赏列表中
 * 
 * 说明：此处仅保留少量必要示例，请按需增删。
 *   key = 剧本中引用的标识符；value = 图片路径（根目录用 assets/…，子目录用 ../assets/…）。
 */

// 根目录路径配置（用于 index.html）
const BG_CONFIG = {
    bg1: "assets/bg/bg1.png",
    bg2: "assets/bg/bg2.png",
};

// 子目录路径配置（用于 html/*.html 和 scenes/*.html）
const BG_CONFIG_SUB = {
    bg1: "../assets/bg/bg1.png",
    bg2: "../assets/bg/bg2.png",
};
