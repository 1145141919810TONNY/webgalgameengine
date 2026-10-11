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
 * measure_ui.js —— UI 皮肤图片尺寸取值工具（④，**只跑一次，不进运行时**）
 * ---------------------------------------------------------------------------
 *
 * 用途：扫描 `assets/ui/` 下的皮肤图，从文件头读出真实像素宽高，直接打印成
 *       可粘贴进 `ui/ui_size.js` 的条目行。开发者照抄即可，无需用看图软件点开
 *       每张图去读尺寸。
 *
 * 用法：
 *   node tools/measure_ui.js                 # 打印表格（键名 / 尺寸 / 扩展名）
 *   node tools/measure_ui.js --json          # 打印 JSON（供其它脚本消费）
 *   node tools/measure_ui.js --fill          # 打印可直接粘贴的 UI_SIZE_CONFIG 条目
 *   node tools/measure_ui.js --out=out.json  # 结果另存为 JSON
 *   node tools/measure_ui.js --cache         # 刷新 assets/ui/.skin_cache.json（**纯工具产物**）
 *   node tools/measure_ui.js --dir=<路径>     # 指定 UI 图目录（默认 <引擎根>/assets/ui）
 *
 * 为什么要有它：
 *   本引擎的尺寸表是**手填写死**的（运行时不探测、不解析图片），换皮肤的成本就是
 *   「丢图 + 填两个数字」。这个脚本把「两个数字」自动读出来，把手工成本降到最低；
 *   但**绝对不要把它的逻辑搬回运行时** —— 那就是把一次性的解析成本变成每次启动的成本。
 *
 * 支持的格式：png / jpg / jpeg / webp / gif（其余格式只报文件名，尺寸留 0）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ENGINE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_UI_DIR = path.join(ENGINE_ROOT, 'assets', 'ui');

/* ── 命令行参数 ─────────────────────────────────────────────── */
const argv = process.argv.slice(2);
function argValue(name) {
    const hit = argv.find((a) => a.startsWith('--' + name + '='));
    return hit ? hit.slice(name.length + 3) : null;
}
const AS_JSON = argv.includes('--json');
const AS_FILL = argv.includes('--fill');
const WRITE_CACHE = argv.includes('--cache');
const OUT_FILE = argValue('out');
const UI_DIR = argValue('dir') ? path.resolve(argValue('dir')) : DEFAULT_UI_DIR;

/* ── 各格式文件头解析 ───────────────────────────────────────── */

/** PNG：8 字节签名 + IHDR 块（宽高为偏移 16 / 20 的大端 uint32） */
function pngSize(buf) {
    if (buf.length < 24) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** GIF：偏移 6 起的两个小端 uint16 */
function gifSize(buf) {
    if (buf.length < 10) return null;
    if (buf.toString('ascii', 0, 3) !== 'GIF') return null;
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/** JPEG：顺序扫 marker，遇到 SOFn 即取（段内为 height 在前、width 在后的大端 uint16） */
function jpegSize(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xff) { i++; continue; }
        // 无载荷的 marker
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const segLen = buf.readUInt16BE(i + 2);
        // SOF0..SOF15（跳过 DHT=0xc4 / JPG=0xc8 / DAC=0xcc）
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        if (segLen < 2) return null;
        i += 2 + segLen;
    }
    return null;
}

/** WEBP：RIFF 容器，按 VP8 / VP8L / VP8X 三种块各解析一次 */
function webpSize(buf) {
    if (buf.length < 30) return null;
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
    const fourcc = buf.toString('ascii', 12, 16);
    if (fourcc === 'VP8 ') {
        // 有损：跳过 3 字节 frame tag + 3 字节 start code，再取两个 14 位宽高
        if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L') {
        // 无损：1 字节签名 0x2f，随后 4 字节位域（宽-1 低 14 位，高-1 次 14 位）
        if (buf[20] !== 0x2f) return null;
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8X') {
        // 扩展：3 字节画布宽-1、3 字节画布高-1（小端）
        const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
        const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
        return { width: w + 1, height: h + 1 };
    }
    return null;
}

const PARSERS = {
    png: pngSize, jpg: jpegSize, jpeg: jpegSize, webp: webpSize, gif: gifSize
};

/**
 * 读一张图的像素尺寸。
 * @param {string} file 绝对路径
 * @returns {{width: number, height: number}|null} 解析失败返回 null
 */
function measure(file) {
    const ext = path.extname(file).slice(1).toLowerCase();
    const parser = PARSERS[ext];
    if (!parser) return null;
    let buf;
    try {
        buf = fs.readFileSync(file);
    } catch (e) {
        return null;
    }
    try {
        return parser(buf);
    } catch (e) {
        return null;
    }
}

/* ── 扫描目录 ───────────────────────────────────────────────── */

/** 皮肤图文件名形如 {part}_{state}.{ext}。注意 part 自身可能含下划线（title_start）。 */
const STATE_SUFFIXES = ['_normal', '_hover', '_on', '_disabled', '_selected', '_locked'];

/**
 * 从文件名茎推断 { part, state }。
 * 状态后缀从右往左匹配，未命中则归为 normal。
 * @param {string} stem 不含扩展名的文件名
 * @returns {{part: string, state: string}}
 */
function splitStem(stem) {
    for (const suffix of STATE_SUFFIXES) {
        if (stem.length > suffix.length && stem.endsWith(suffix)) {
            return { part: stem.slice(0, -suffix.length), state: suffix.slice(1) };
        }
    }
    return { part: stem, state: 'normal' };
}

function scan() {
    if (!fs.existsSync(UI_DIR)) {
        console.error('[measure_ui] 目录不存在：' + UI_DIR);
        process.exit(2);
    }
    const rows = [];
    const skipped = [];
    fs.readdirSync(UI_DIR).sort().forEach((name) => {
        if (name.startsWith('.')) return;                       // .skin_cache.json 之类
        const full = path.join(UI_DIR, name);
        if (!fs.statSync(full).isFile()) return;
        const ext = path.extname(name).slice(1).toLowerCase();
        if (!PARSERS[ext]) { skipped.push(name); return; }       // 说明文件等
        const stem = path.basename(name, path.extname(name));
        const size = measure(full);
        const parts = splitStem(stem);
        rows.push({
            body: stem,
            part: parts.part,
            state: parts.state,
            ext: ext,
            sizex: size ? size.width : 0,
            sizey: size ? size.height : 0,
            file: name,
            ok: !!size
        });
    });
    return { rows, skipped };
}

/* ── 输出 ───────────────────────────────────────────────────── */

function pad(s, n) {
    s = String(s);
    return s + ' '.repeat(Math.max(0, n - s.length));
}

function main() {
    const { rows, skipped } = scan();

    if (OUT_FILE) {
        fs.writeFileSync(path.resolve(OUT_FILE), JSON.stringify({ dir: UI_DIR, rows, skipped }, null, 2), 'utf8');
        console.log('[measure_ui] 已写出 ' + path.resolve(OUT_FILE));
    }

    if (WRITE_CACHE) {
        // 明确一点：这个文件是**工具产物**，运行时零读取（引擎只读 ui/ui_size.js 那一张表）。
        // 它存在的唯一意义是给构建脚本 / 外部工具（例如 C# 侧的资源校验）一个机器可读快照。
        const dims = {};
        let maxMtime = 0;
        rows.forEach((r) => {
            dims[r.body] = { w: r.sizex, h: r.sizey, ext: r.ext };
            try {
                const m = fs.statSync(path.join(UI_DIR, r.file)).mtimeMs;
                if (m > maxMtime) maxMtime = m;
            } catch (e) { /* ignore */ }
        });
        const cachePath = path.join(UI_DIR, '.skin_cache.json');
        fs.writeFileSync(cachePath, JSON.stringify({
            note: '工具产物，运行时零读取；由 tools/measure_ui.js --cache 生成',
            generated: new Date().toISOString(),
            fileCount: rows.length,
            maxMtime: maxMtime,
            dims: dims
        }), 'utf8');
        console.log('[measure_ui] 已刷新 ' + cachePath);
    }

    if (AS_JSON) {
        console.log(JSON.stringify(rows, null, 2));
        return;
    }

    const wBody = Math.max(20, ...rows.map((r) => r.body.length));
    if (AS_FILL) {
        // 直接可粘贴的 UI_SIZE_CONFIG 条目
        console.log('/* 由 tools/measure_ui.js 生成，值取自图片真实像素（勿手工改错） */');
        rows.forEach((r) => {
            const key = r.body + ':';
            // ext 只在非 png 时写出（png 是表里的默认值，写出来只是噪音）
            const extPart = r.ext === 'png' ? '' : ", ext: '" + r.ext + "'";
            console.log('    ' + pad(key, wBody + 3) + "{ sizex: " + r.sizex + ', sizey: ' + r.sizey
                + ", x: '#', y: '#', zoom: '#'" + extPart + ' },');
        });
        return;
    }

    console.log('[measure_ui] 目录：' + UI_DIR);
    console.log(pad('文件名茎', wBody + 2) + pad('sizex', 8) + pad('sizey', 8) + 'ext');
    console.log('-'.repeat(wBody + 2 + 8 + 8 + 5));
    rows.forEach((r) => {
        console.log(pad(r.body, wBody + 2) + pad(r.sizex, 8) + pad(r.sizey, 8) + r.ext + (r.ok ? '' : '   << 读取失败'));
    });
    console.log('');
    console.log('共 ' + rows.length + ' 张；按 part 分组：');
    const byPart = {};
    rows.forEach((r) => { (byPart[r.part] = byPart[r.part] || []).push(r.state); });
    Object.keys(byPart).sort().forEach((p) => {
        console.log('  ' + pad(p, 18) + byPart[p].join(' / '));
    });
    if (skipped.length) {
        console.log('');
        console.log('跳过（非图片格式）：' + skipped.join(', '));
    }
    console.log('');
    console.log('下一步：把上面的数字填进 ui/ui_size.js 的 UI_SIZE_CONFIG（sizex/sizey 为字符串或数字均可，');
    console.log('        推荐数字省去引号；有图就必须填，填错会拉伸元素；扩展名用 --fill 一并带出）。');
}

main();
