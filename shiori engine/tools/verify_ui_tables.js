/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * ---------------------------------------------------------------------------
 * verify_ui_tables.js —— UI 皮肤三表同源自检（**只在构建期跑，不进运行时**）
 * ---------------------------------------------------------------------------
 *
 * 背景：本引擎的皮肤尺寸是**手填写死**进 `ui/ui_size.js` 的，运行时只读表、不探测、
 *       不解析图片。代价是「表与图片必须同步」：填了条目却没有图 → 元素会带上
 *       `background-color:transparent!important` 却加载不到底图 → **肉眼不可见**。
 *       这份自检就是那个代价的兜底。
 *
 * 用法：
 *   node tools/verify_ui_tables.js                # 打印报告；有错误则退出码 1
 *   node tools/verify_ui_tables.js --strict       # 有警告也退出码 1（CI 用）
 *   node tools/verify_ui_tables.js --json         # 机器可读报告（C# 侧可复用）
 *   node tools/verify_ui_tables.js --release      # 发布门禁：额外断言「启用条目 = 0 且 assets/ui 无图」
 *   node tools/verify_ui_tables.js --out=ui_report.json
 *
 * 检查项：
 *   ① 孤立配置 —— ui_size.js 有条目，但 PARTS / ROLES 里没有这个部件（或状态未声明）
 *   ② 缺图     —— 条目已启用（sizex/sizey 均为正数）但 assets/ui 里没有对应文件
 *                 （这是唯一会导致「元素隐形」的硬错误）
 *   ③ 扩展名   —— 条目写了 ext，但磁盘上是另一种扩展名（运行时会 404）
 *   ④ 消费规则 —— 部件有图，却没有 `ui_skin.css` 里 `var(--ui-{part}-normal)` 的消费规则
 *                 （`buildPartsCss` 扫不到 → 尺寸/底图都不生效）
 *   ⑤ 未登记图 —— assets/ui 里有图，但尺寸表里没有启用条目（丢了图忘了填表 → 不会换肤）
 *   ⑥ 待填     —— 声明了槽位但表里没条目（模板态下属正常，仅提示）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE_ROOT = path.resolve(__dirname, '..');
const UI_DIR = path.join(ENGINE_ROOT, 'assets', 'ui');
const SKIN_JS = path.join(ENGINE_ROOT, 'ui', 'ui_skin.js');
const SIZE_JS = path.join(ENGINE_ROOT, 'ui', 'ui_size.js');
const SKIN_CSS = path.join(ENGINE_ROOT, 'ui', 'ui_skin.css');

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const STRICT = argv.includes('--strict');
const RELEASE = argv.includes('--release');
const OUT_FILE = (function () {
    const hit = argv.find((a) => a.startsWith('--out='));
    return hit ? hit.slice(6) : null;
})();

/* ── 读表 ───────────────────────────────────────────────────── */

/** 载入 ui_skin.js（CommonJS 导出），拿到 PARTS / STATES / ROLES 等三张表 */
function loadSkinTables() {
    delete require.cache[require.resolve(SKIN_JS)];
    return require(SKIN_JS);
}

/**
 * 载入 ui_size.js。它声明的是裸 `var UI_SIZE_CONFIG = {...}`（供 C# 注入 <script> 用），
 * 在 vm 里跑一遍才能取到那个变量。
 */
function loadSizeTable() {
    const src = fs.readFileSync(SIZE_JS, 'utf8');
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'ui_size.js' });
    return ctx.UI_SIZE_CONFIG || {};
}

/** 读 ui_skin.css（消费规则唯一的所在地） */
function loadSkinCss() {
    try {
        return fs.readFileSync(SKIN_CSS, 'utf8');
    } catch (e) {
        return '';
    }
}

/* ── 工具 ───────────────────────────────────────────────────── */

function toDim(v) {
    if (v === '#' || v === null || v === undefined || v === '') return 0;
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
}

/** 条目是否「启用」（sizex/sizey 均为正数 = 声称有这张图） */
function isEnabled(cfg) {
    return !!cfg && toDim(cfg.sizex) > 0 && toDim(cfg.sizey) > 0;
}

/** 认得出来的图片扩展名（默认值；main 里会以 ui_skin.js 导出的 EXTS 为准覆盖） */
let EXTS = ['webp', 'png', 'jpg'];

/** 扫描 assets/ui，返回 { byStem: { stem: {ext, file} }, images: [...] } */
function scanImages() {
    const byStem = {};
    const images = [];
    if (!fs.existsSync(UI_DIR)) return { byStem, images };
    fs.readdirSync(UI_DIR).sort().forEach((name) => {
        if (name.startsWith('.')) return;
        const full = path.join(UI_DIR, name);
        if (!fs.statSync(full).isFile()) return;
        const ext = path.extname(name).slice(1).toLowerCase();
        if (!EXTS.includes(ext)) return;                 // 说明文件等，不算图
        const stem = path.basename(name, path.extname(name));
        byStem[stem] = { ext, file: name };
        images.push({ stem, ext, file: name });
    });
    return { byStem, images };
}

/* ── 主流程 ─────────────────────────────────────────────────── */

function main() {
    const skin = loadSkinTables();
    EXTS = (skin.EXTS || EXTS).slice();
    const PARTS = skin.PARTS || [];
    const STATES = skin.STATES || {};
    const ROLES = skin.ROLES || {};
    const CONTAINER_PARTS = skin.CONTAINER_PARTS || {};
    const spec = skin.UI_SKIN || null;
    const fileBody = skin.fileBody;

    const config = loadSizeTable();
    const css = loadSkinCss();
    const { byStem, images } = scanImages();

    /** 全部「已声明槽位」：key → { kind, part, state } */
    const slots = {};
    PARTS.forEach((part) => {
        (STATES[part] || []).forEach((state) => {
            const key = fileBody(part, state, spec);
            if (key) slots[key] = { kind: 'part', part, state };
        });
    });
    Object.keys(ROLES).forEach((role) => {
        (ROLES[role] || []).forEach((state) => {
            const key = fileBody(role, state, spec);
            if (key) slots[key] = { kind: 'role', part: role, state };
        });
    });

    const E = [];   // 错误：会导致换肤失效 / 元素隐形
    const W = [];   // 警告：可疑，但当前不影响观感
    const I = [];   // 提示

    /* ① 孤立配置 + ② 缺图 + ③ 扩展名 */
    Object.keys(config).forEach((key) => {
        const cfg = config[key];
        const slot = slots[key];
        if (!slot) {
            E.push('[孤立配置] ' + key + '：ui_size.js 有条目，但 PARTS/ROLES 里没有这个部件或状态未声明'
                + '（该条目永远不会被读到）');
            return;
        }
        if (!isEnabled(cfg)) return;                       // sizex/sizey 为 '#' = 明确声明无图
        const hit = byStem[key];
        if (!hit) {
            E.push('[缺图] ' + key + '：' + slot.part + '(' + slot.kind + ') 声明了尺寸 '
                + toDim(cfg.sizex) + '×' + toDim(cfg.sizey) + '，但 assets/ui/ 里没有 '
                + key + '.{' + EXTS.join('|') + '} —— 该元素会隐形');
            return;
        }
        const wantExt = cfg.ext ? String(cfg.ext).toLowerCase() : '';
        if (wantExt && wantExt !== hit.ext) {
            E.push('[扩展名] ' + key + '：表里 ext=' + wantExt + '，磁盘上却是 ' + hit.ext
                + '（' + hit.file + '）—— 运行时会 404');
        }
    });

    /* ④ 消费规则：部件有图，但 ui_skin.css 里没有消费它的规则 */
    const partsWithArt = {};
    Object.keys(config).forEach((key) => {
        const slot = slots[key];
        if (!slot || slot.kind !== 'part' || !isEnabled(config[key])) return;
        partsWithArt[slot.part] = true;
    });
    Object.keys(partsWithArt).forEach((part) => {
        // 变量名里的部件名用连字符（文件名才用下划线）：log_panel → --ui-log-panel-bg
        const vPart = String(part).replace(/_/g, '-');
        const varName = CONTAINER_PARTS[part]
            ? 'var(--ui-' + vPart + '-bg)'
            : 'var(--ui-' + vPart + '-normal)';
        if (css.indexOf(varName) < 0) {
            E.push('[消费规则] ' + part + '：有皮肤图，但 ui/ui_skin.css 里找不到 ' + varName
                + ' 的消费规则 —— buildPartsCss 扫不到，尺寸与底图都不会生效');
        }
    });

    /* ⑤ 未登记图：assets/ui 里有图，但表里没有启用条目 */
    images.forEach((img) => {
        const cfg = config[img.stem];
        if (!cfg || !isEnabled(cfg)) {
            W.push('[未登记图] assets/ui/' + img.file + '：尺寸表里没有启用条目'
                + '（丢了图忘了填表 → 不会换肤；若是有意留的样例，请填表或删图）');
        }
    });

    /* ⑥ 待填提示：声明了槽位但表里完全没条目 */
    Object.keys(slots).forEach((key) => {
        if (!config[key]) I.push('[待填] ' + key + '（' + slots[key].part + '，无图属正常）');
    });

    /* 统计 */
    const enabledKeys = Object.keys(config).filter((k) => isEnabled(config[k]));
    const summary = {
        partsDeclared: PARTS.length,
        rolesDeclared: Object.keys(ROLES).length,
        slotsDeclared: Object.keys(slots).length,
        configEntries: Object.keys(config).length,
        configEnabled: enabledKeys.length,
        configDisabled: Object.keys(config).length - enabledKeys.length,
        imageFiles: images.length,
        enabledKeys: enabledKeys,
        errors: E,
        warnings: W,
        infos: I
    };

    /* ⑦ 发布门禁 */
    if (RELEASE) {
        if (enabledKeys.length > 0) {
            summary.errors.push('[发布门禁] UI_SIZE_CONFIG 还有 ' + enabledKeys.length
                + ' 条启用条目（' + enabledKeys.slice(0, 6).join(', ')
                + (enabledKeys.length > 6 ? ' …' : '') + '）—— 正式态必须为 0');
        }
        if (images.length > 0) {
            summary.errors.push('[发布门禁] assets/ui/ 里还有 ' + images.length
                + ' 张皮肤图 —— 正式态必须清空（只留说明文件）');
        }
    }

    if (OUT_FILE) {
        fs.writeFileSync(path.resolve(OUT_FILE), JSON.stringify(summary, null, 2), 'utf8');
    }

    if (AS_JSON) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        console.log('[verify_ui_tables] 引擎根：' + ENGINE_ROOT);
        console.log('声明：PARTS ' + summary.partsDeclared + ' / ROLES ' + summary.rolesDeclared
            + ' / 槽位 ' + summary.slotsDeclared);
        console.log('尺寸表：条目 ' + summary.configEntries + '（启用 ' + summary.configEnabled
            + '，禁用 ' + summary.configDisabled + '）');
        console.log('皮肤图：' + summary.imageFiles + ' 张' + (RELEASE ? '   [发布门禁模式]' : ''));
        console.log('');
        const dump = (title, arr) => {
            console.log(title + '（' + arr.length + '）');
            arr.forEach((line, i) => console.log('  ' + (i + 1) + '. ' + line));
            console.log('');
        };
        dump('错误', summary.errors);
        dump('警告', summary.warnings);
        if (summary.infos.length) {
            console.log('提示（' + summary.infos.length + '）：表里没有条目的已声明槽位，无图属正常');
            summary.infos.slice(0, 8).forEach((l) => console.log('  · ' + l));
            if (summary.infos.length > 8) console.log('  · …还有 ' + (summary.infos.length - 8) + ' 条');
            console.log('');
        }
        console.log(summary.errors.length === 0
            ? (summary.warnings.length === 0 ? '自检通过。' : '自检通过（有 ' + summary.warnings.length + ' 条警告）。')
            : '自检发现 ' + summary.errors.length + ' 个错误 —— 这些会让换肤失效或元素隐形，必须修。');
    }

    const bad = summary.errors.length > 0 || (STRICT && summary.warnings.length > 0);
    process.exit(bad ? 1 : 0);
}

main();
