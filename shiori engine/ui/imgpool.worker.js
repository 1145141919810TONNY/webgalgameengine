/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 图片解码 Worker —— 把 createImageBitmap 的活从主线程搬走。
 *
 * 解码不在主线程做，主线程只负责把拿到的 ImageBitmap 画到 canvas 上。
 *
 * 两种宿主形态（同一份脚本，自动识别）：
 *   · SharedWorker：跨页面共享。字节缓存（Blob）留在 Worker 里，标题页预热一次，
 *     之后打开 CG 页可以做到**零网络请求**。
 *   · 专用 Worker：SharedWorker 不可用时的退化形态，缓存只在当前页面生命周期内有效。
 *
 * 消息协议（主线程 → Worker）：
 *   { t:'decode', id, key, buf }  buf 为 JPEG 字节（ArrayBuffer，transfer 过来）
 *                                 → 存入字节缓存并解码，回 { t:'bitmap', id, key, bmp }
 *   { t:'warm',   id, items }     items = [{key, buf}]，只存字节不解码 → 回 { t:'warmed', id, n }
 *   { t:'has',    id, keys }      查询字节缓存命中情况 → 回 { t:'has', id, hit:[...] }
 *   { t:'drop',   keys }          丢弃指定键的字节缓存（翻页/关闭时清理）
 *   { t:'clear' }                 清空字节缓存
 *   { t:'stats',  id }            → 回 { t:'stats', id, keys, bytes }
 *
 * 回包（Worker → 主线程）：
 *   { t:'bitmap', id, key, bmp, w, h }（bmp 以 transferable 移交，零拷贝）
 *   { t:'error',  id, key, message }
 */

'use strict';

(function () {
    /**
     * 字节缓存的总上限（这里是原始字节，不是解码后的位图）。
     * 允许通过 `self.SHIORI_IMGPACK_BYTELIMIT` 覆盖 —— 离线测试用它把上限压到几百字节来验证淘汰路径。
     */
    var BYTE_LIMIT = (function () {
        var n = Number(self.SHIORI_IMGPACK_BYTELIMIT);
        return (Number.isFinite(n) && n > 0) ? n : 96 * 1024 * 1024;
    })();

    /** key → Blob（原始 JPEG/PNG 字节）。用 Blob 而不是 ArrayBuffer：createImageBitmap 可直接吃 Blob。 */
    var byteCache = new Map();
    /** key → 字节数，用于 LRU 记账。 */
    var byteSizes = new Map();
    /** 当前缓存占用。 */
    var totalBytes = 0;
    /** LRU 访问顺序（Map 的插入序即顺序，命中时重新 set 提升）。 */
    function touch(key, blob, size) {
        if (byteCache.has(key)) {
            totalBytes -= byteSizes.get(key) || 0;
            byteCache.delete(key);
            byteSizes.delete(key);
        }
        byteCache.set(key, blob);
        byteSizes.set(key, size);
        totalBytes += size;
        // 超限：从最久未使用端连续淘汰
        while (totalBytes > BYTE_LIMIT && byteCache.size > 0) {
            var oldest = byteCache.keys().next().value;
            totalBytes -= byteSizes.get(oldest) || 0;
            byteCache.delete(oldest);
            byteSizes.delete(oldest);
        }
    }

    /** 把一批字节塞进缓存（不解码），返回实际新增条数。 */
    function storeBytes(items) {
        var n = 0;
        if (!items || !items.length) return n;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (!it || !it.key || !it.buf) continue;
            try {
                var blob = new Blob([it.buf], { type: guessMime(it.key) });
                touch(it.key, blob, it.buf.byteLength || it.buf.size || 0);
                n++;
            } catch (e) { /* 单条失败不影响其余 */ }
        }
        return n;
    }

    /** 由扩展名猜 MIME。Blob type 只影响 createImageBitmap 的提示，猜错也能解。 */
    function guessMime(key) {
        var s = String(key || '').toLowerCase();
        if (s.endsWith('.png')) return 'image/png';
        if (s.endsWith('.webp')) return 'image/webp';
        if (s.endsWith('.gif')) return 'image/gif';
        if (s.endsWith('.bmp')) return 'image/bmp';
        return 'image/jpeg';
    }

    /** 解码一个键：命中字节缓存直接用，否则回错误（网络职责在主线程，Worker 不发请求）。 */
    function decodeKey(port, id, key) {
        var blob = byteCache.get(key);
        if (!blob) {
            port.postMessage({ t: 'error', id: id, key: key, message: 'not-warmed' });
            return;
        }
        // 命中即提升 LRU 顺序
        touch(key, blob, byteSizes.get(key) || blob.size || 0);
        createImageBitmap(blob).then(function (bmp) {
            port.postMessage({ t: 'bitmap', id: id, key: key, bmp: bmp, w: bmp.width, h: bmp.height }, [bmp]);
        }).catch(function (err) {
            port.postMessage({ t: 'error', id: id, key: key, message: String(err && err.message || err) });
        });
    }

    /** 统一的端口消息处理（所有宿主形态共用）。 */
    function handle(port, msg) {
        if (!msg || !msg.t) return;
        switch (msg.t) {
            case 'decode':
                storeBytes([{ key: msg.key, buf: msg.buf }]);
                decodeKey(port, msg.id, msg.key);
                break;
            case 'warm': {
                var n = storeBytes(msg.items);
                port.postMessage({ t: 'warmed', id: msg.id, n: n });
                break;
            }
            case 'has': {
                var hit = [];
                var keys = msg.keys || [];
                for (var i = 0; i < keys.length; i++) if (byteCache.has(keys[i])) hit.push(keys[i]);
                port.postMessage({ t: 'has', id: msg.id, hit: hit });
                break;
            }
            case 'drop': {
                var ks = msg.keys || [];
                for (var j = 0; j < ks.length; j++) {
                    if (!byteCache.has(ks[j])) continue;
                    totalBytes -= byteSizes.get(ks[j]) || 0;
                    byteCache.delete(ks[j]);
                    byteSizes.delete(ks[j]);
                }
                break;
            }
            case 'clear':
                byteCache.clear();
                byteSizes.clear();
                totalBytes = 0;
                break;
            case 'stats':
                port.postMessage({ t: 'stats', id: msg.id, keys: byteCache.size, bytes: totalBytes });
                break;
            default:
                break;
        }
    }

    var isShared = (typeof SharedWorkerGlobalScope !== 'undefined') && (self instanceof SharedWorkerGlobalScope);

    if (isShared) {
        // SharedWorker：每个页面一条 port，广播式处理（缓存是跨页面共享的）
        self.onconnect = function (ev) {
            var port = ev.ports && ev.ports[0];
            if (!port) return;
            port.onmessage = function (e) { handle(port, e.data); };
            if (port.start) port.start();
        };
    } else {
        self.onmessage = function (e) { handle(self, e.data); };
    }
})();
