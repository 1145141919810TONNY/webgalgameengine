/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * 图片位图池（主线程侧）+ 批量取图的编排。
 *
 * 设计目标：**打开页面那一刻，图已经是"已解码位图"，渲染退化为纯 drawImage**。
 *   · 取字节：一次 /api/imgpack 批量拿回 N 张缩略图（取代 N 个 <img src> 造成的请求排队）；
 *   · 解码：全部交给 imgpool.worker.js，主线程不做 createImageBitmap；
 *   · 持有：Map<key, ImageBitmap> + 字节上限 LRU，超限 bitmap.close() 显式释放；
 *   · 取消：AbortController（解码队列可随时取消）。
 *
 * 对外 API（挂 window.ShioriImgPool）：
 *   get(key)                 同步取位图，未就绪返回 null（命中时零网络、零解码）
 *   ready(key, cb)           位图就绪时回调（已就绪则立即回调），返回取消函数
 *   request(keys)            Promise：确保这批键进入池（缺失才发网络）
 *   warm(keys)               Promise：只把原始字节灌进 Worker 缓存，不解码（启动预热用）
 *   warmFromManifest(opts)   读 /api/cg-manifest 后按空闲时段分批 warm（标题页调用）
 *   has(key) / stats() / dispose() / clear()
 *
 * 全局配置（在引入本脚本之前设置）：
 *   window.SHIORI_IMGPACK        = '/api/imgpack'  批量端点
 *   window.SHIORI_CG_MANIFEST    = '/api/cg-manifest'
 *   window.SHIORI_BITMAP_LIMIT   = 67108864        位图池字节上限（默认 64 MiB）
 *   window.SHIORI_IMGPACK_CHUNK  = 128             单次批量请求的键数量上限
 */

(function (root) {
    'use strict';

    if (!root || !root.document) return;

    /** 批量取字节端点。 */
    var PACK_URL = root.SHIORI_IMGPACK || '/api/imgpack';
    /** CG 清单端点。 */
    var MANIFEST_URL = root.SHIORI_CG_MANIFEST || '/api/cg-manifest';
    /** 位图池字节上限：默认 64 MiB（256px 宽的缩略图位图约 0.15 MB/张，可容纳数千张）。 */
    var BITMAP_LIMIT = Number(root.SHIORI_BITMAP_LIMIT) > 0 ? Number(root.SHIORI_BITMAP_LIMIT) : 64 * 1024 * 1024;
    /** 单次批量请求的键数量上限（与宿主侧 ImgPackMaxKeys 对齐）。 */
    var PACK_CHUNK = Number(root.SHIORI_IMGPACK_CHUNK) > 0 ? Math.min(Number(root.SHIORI_IMGPACK_CHUNK), 512) : 128;
    /** 是否输出诊断日志（宿主调试构建或 ?debug=1 时打开）。 */
    var DEBUG = !!(root.__SHIORI_DEBUG_BUILD) || /[?&]debug=1/.test(String(root.location && root.location.search || ''));

    /** 位图池：key → { bmp, bytes }；Map 的插入序即 LRU 顺序。 */
    var pool = new Map();
    /** 池内位图总字节数。 */
    var poolBytes = 0;
    /** 等待某个键就绪的回调：key → [cb, ...]。 */
    var waiters = new Map();
    /** 在一次 request 批次内是否已经发过该键的网络请求（避免重复排队）。 */
    var inflight = new Set();
    /** 本脚本自身的 URL，用于正确解析 Worker 路径（CG 页在 html/ 子目录）。 */
    var SELF_SRC = (function () {
        try {
            if (root.document.currentScript && root.document.currentScript.src) return root.document.currentScript.src;
            var ss = root.document.getElementsByTagName('script');
            for (var i = ss.length - 1; i >= 0; i--) {
                if (ss[i].src && /imgpool\.js(\?|#|$)/i.test(ss[i].src)) return ss[i].src;
            }
        } catch (e) { /* 取不到就退回绝对路径 */ }
        return '';
    })();
    var WORKER_URL = SELF_SRC
        ? SELF_SRC.replace(/imgpool\.js(\?[^#]*)?(#.*)?$/i, 'imgpool.worker.js')
        : '/ui/imgpool.worker.js';

    // ============================================================
    //  工具
    // ============================================================

    function log() {
        if (!DEBUG) return;
        try { console.log.apply(console, ['[ImgPool]'].concat(Array.prototype.slice.call(arguments))); } catch (e) { }
    }

    /**
     * 把各种写法归一成"相对 assets/ 的路径"（如 cg/bg1.jpg）：
     * 兼容 'assets/cg/x.jpg'、'../assets/cg/x.jpg'、'/cg-thumb/cg/x.jpg'、带 query 的压测路径。
     * @param {string} p 原始路径。
     * @returns {string} 归一化后的键；无法识别时返回 ''。
     */
    function normKey(p) {
        var s = String(p == null ? '' : p).trim().replace(/\\/g, '/');
        var q = s.indexOf('?');
        if (q >= 0) s = s.slice(0, q);
        var h = s.indexOf('#');
        if (h >= 0) s = s.slice(0, h);
        var m = s.match(/(?:^|\/)assets\/(.+)$/i);
        if (m) s = m[1];
        s = s.replace(/^\/+/, '');
        // 也接受缩略图路由的写法（/cg-thumb/cg/x.jpg）—— 宿主 C# 与 ShioriHostConfig.assetThumbUrl
        // 产出的都是这种形态，调用方直接把它丢进来也必须能归一化到同一把键。
        if (/^cg-thumb\//i.test(s)) s = s.slice('cg-thumb/'.length);
        // 路径遍历防护：出现空段 / . / .. 一律拒绝（与宿主侧 ImgPackFormat.ParseKeys 同一套规则）
        if (!s) return '';
        // 含冒号 → 盘符绝对路径或 "javascript:" 之类，一律拒绝
        if (s.indexOf(':') >= 0) return '';
        var segs = s.split('/');
        for (var i = 0; i < segs.length; i++) {
            if (!segs[i] || segs[i] === '.' || segs[i] === '..') return '';
        }
        return s;
    }

    /**
     * 位图池写入：超限时从最久未使用端淘汰并 <c>close()</c> 释放。
     */
    function poolPut(key, bmp) {
        var bytes = 0;
        try { bytes = (bmp.width || 0) * (bmp.height || 0) * 4; } catch (e) { bytes = 0; }
        var old = pool.get(key);
        if (old) {
            poolBytes -= old.bytes;
            pool.delete(key);
            try { old.bmp.close(); } catch (e) { }
        }
        pool.set(key, { bmp: bmp, bytes: bytes });
        poolBytes += bytes;
        while (poolBytes > BITMAP_LIMIT && pool.size > 1) {
            var oldestKey = pool.keys().next().value;
            var e = pool.get(oldestKey);
            pool.delete(oldestKey);
            poolBytes -= e.bytes;
            try { e.bmp.close(); } catch (err) { }
        }
    }

    /** 位图池读取（命中即提升 LRU 顺序）。 */
    function poolGet(key) {
        var e = pool.get(key);
        if (!e) return null;
        pool.delete(key);
        pool.set(key, e);
        return e.bmp;
    }

    /** 触发某个键的就绪回调（只触发一次）。 */
    function fireReady(key) {
        var list = waiters.get(key);
        if (!list || !list.length) return;
        waiters.delete(key);
        var bmp = poolGet(key);
        for (var i = 0; i < list.length; i++) {
            try { list[i](bmp); } catch (e) { log('ready cb error', e); }
        }
    }

    /**
     * 放行某个键的全部等待者（传 null 表示该键最终拿不到位图）。
     * 存在的唯一目的：**任何失败路径都必须最终放行**，否则调用方的 ready 回调会永远挂着。
     */
    function releaseWaiters(key, value) {
        var list = waiters.get(key);
        if (!list || !list.length) return;
        waiters.delete(key);
        for (var i = 0; i < list.length; i++) {
            try { list[i](value); } catch (e) { log('waiter cb error', e); }
        }
    }

    // ============================================================
    //  Worker 连接（SharedWorker 优先：跨页面复用字节缓存）
    // ============================================================

    var worker = null;
    var port = null;
    /** 'shared' | 'dedicated' | 'none'；'none' 时退化为主线程解码。 */
    var workerMode = 'none';
    /** 已连接的 Worker 端口集合（SharedWorker 下只有一个，保持结构一致便于断开重连）。 */
    var reqSeq = 0;
    /** 请求 id → { resolve }：worker 回包的汇合点。 */
    var pendingMsgs = new Map();

    function connectWorker() {
        if (port || workerMode !== 'none') return port;
        try {
            if (typeof root.SharedWorker !== 'undefined') {
                worker = new root.SharedWorker(WORKER_URL, { name: 'shiori-imgpool' });
                port = worker.port;
                workerMode = 'shared';
            } else if (typeof root.Worker !== 'undefined') {
                worker = new root.Worker(WORKER_URL);
                port = worker;
                workerMode = 'dedicated';
            }
        } catch (e) {
            // file:// 或受限环境：Worker 不可用 → 主线程解码兜底
            log('worker unavailable, fallback to main thread:', e && e.message);
            worker = null; port = null;
        }
        if (port) {
            port.onmessage = onWorkerMessage;
            if (port.start) { try { port.start(); } catch (e) { } }
            log('worker mode =', workerMode, WORKER_URL);
        }
        return port;
    }

    function onWorkerMessage(ev) {
        var m = ev && ev.data;
        if (!m || !m.t) return;
        if (m.t === 'bitmap') {
            poolPut(m.key, m.bmp);
            fireReady(m.key);
            var p = pendingMsgs.get(m.id);
            if (p) { pendingMsgs.delete(m.id); p.resolve(m.key); }
            return;
        }
        if (m.t === 'warmed') {
            var pw = pendingMsgs.get(m.id);
            if (pw) { pendingMsgs.delete(m.id); pw.resolve(m.n); }
            return;
        }
        if (m.t === 'has') {
            var ph = pendingMsgs.get(m.id);
            if (ph) { pendingMsgs.delete(m.id); ph.resolve(m.hit || []); }
            return;
        }
        if (m.t === 'stats') {
            var ps = pendingMsgs.get(m.id);
            if (ps) { pendingMsgs.delete(m.id); ps.resolve(m); }
            return;
        }
        if (m.t === 'error') {
            log('decode failed:', m.key, m.message);
            var pe = pendingMsgs.get(m.id);
            if (pe) { pendingMsgs.delete(m.id); pe.resolve(null); }
            // 解码失败也要放行等待者，否则调用方永远等不到（拿到 null 自己画占位）
            releaseWaiters(m.key, null);
        }
    }

    /** 向 Worker 发消息并等待指定类型回包。 */
    function askWorker(msg, transfer) {
        var p = connectWorker();
        if (!p) return Promise.resolve(null);
        var id = ++reqSeq;
        msg.id = id;
        return new Promise(function (resolve) {
            pendingMsgs.set(id, { resolve: resolve });
            try { p.postMessage(msg, transfer || []); }
            catch (e) { pendingMsgs.delete(id); resolve(null); }
        });
    }

    // ============================================================
    //  批量取字节
    // ============================================================

    /**
     * 解析 imgpack 响应体。
     * 格式见宿主侧 HandleImgPackRequest：magic "SIPK" | u32 版本 | u32 条数 |
     * 重复（u16 键长 | 键 | u32 数据长 | 数据）。
     * @param {ArrayBuffer} buf 响应体。
     * @returns {Array<{key:string, buf:ArrayBuffer|null}>}
     */
    function parseImgPack(buf) {
        var dv = new DataView(buf);
        if (dv.byteLength < 12) throw new Error('imgpack too short');
        if (dv.getUint32(0) !== 0x5349504B) throw new Error('imgpack bad magic');
        var count = dv.getUint32(8);
        var off = 12;
        var out = [];
        var dec = new TextDecoder();
        for (var i = 0; i < count; i++) {
            if (off + 2 > dv.byteLength) break;
            var klen = dv.getUint16(off); off += 2;
            var key = dec.decode(new Uint8Array(buf, off, klen)); off += klen;
            var dlen = dv.getUint32(off); off += 4;
            var data = null;
            if (dlen > 0 && off + dlen <= dv.byteLength) {
                // slice 拷贝一份：原 buffer 要留给下一条，不能直接 transfer 子视图
                data = buf.slice(off, off + dlen);
            }
            off += dlen;
            out.push({ key: key, buf: data });
        }
        return out;
    }

    /**
     * 一次批量取回若干键的原始字节。
     * @param {string[]} keys 归一化后的键。
     * @param {AbortSignal} [signal] 取消信号。
     * @returns {Promise<Array<{key:string, buf:ArrayBuffer|null}>>}
     */
    function fetchPack(keys, signal) {
        if (!keys.length) return Promise.resolve([]);
        var qs = keys.map(function (k) { return encodeURIComponent(k); }).join(',');
        return root.fetch(PACK_URL + '?keys=' + qs, { signal: signal, credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) throw new Error('imgpack http ' + r.status);
                return r.arrayBuffer();
            })
            .then(parseImgPack);
    }

    /** 分组执行：把 keys 按 PACK_CHUNK 切片依次请求（保持顺序）。 */
    function fetchPackChunked(keys, signal) {
        if (keys.length <= PACK_CHUNK) return fetchPack(keys, signal);
        var chunks = [];
        for (var i = 0; i < keys.length; i += PACK_CHUNK) chunks.push(keys.slice(i, i + PACK_CHUNK));
        return chunks.reduce(function (acc, c) {
            return acc.then(function (all) {
                return fetchPack(c, signal).then(function (part) { return all.concat(part); });
            });
        }, Promise.resolve([]));
    }

    /** 主线程兜底解码（Worker 不可用时）。 */
    function decodeOnMainThread(key, buf) {
        try {
            var blob = new Blob([buf]);
            return root.createImageBitmap(blob).then(function (bmp) {
                poolPut(key, bmp);
                fireReady(key);
                return key;
            }).catch(function () {
                releaseWaiters(key, null);
                return null;
            });
        } catch (e) {
            releaseWaiters(key, null);
            return Promise.resolve(null);
        }
    }

    // ============================================================
    //  对外 API
    // ============================================================

    var api = {
        /** Worker 形态：'shared' / 'dedicated' / 'none'（未连接时为 null）。 */
        get mode() { return port ? workerMode : null; },

        /** 同步取位图；未就绪返回 null。 */
        get: function (key) { return poolGet(normKey(key)); },

        /** 池内是否已有该键的位图。 */
        has: function (key) { return pool.has(normKey(key)); },

        /** 归一化键（供调用方复用同一套路径规则）。 */
        key: normKey,

        /** imgpack 响应体解析器（导出供离线测试与调试复用；协议定义见宿主 ImgPackFormat.cs）。 */
        parseImgPack: parseImgPack,

        /**
         * 位图就绪时回调。已就绪则同步回调一次。
         * @returns {Function} 取消函数。
         */
        ready: function (key, cb) {
            var k = normKey(key);
            if (!k) { cb(null); return function () { }; }
            var bmp = poolGet(k);
            if (bmp) { cb(bmp); return function () { }; }
            var list = waiters.get(k);
            if (!list) { list = []; waiters.set(k, list); }
            list.push(cb);
            return function () {
                var l = waiters.get(k);
                if (!l) return;
                var i = l.indexOf(cb);
                if (i >= 0) l.splice(i, 1);
            };
        },

        /**
         * 确保这批键进入位图池：已在池中的零开销，缺失的一次批量取回并解码。
         * @param {string[]} keys 路径（任意写法，内部归一化）。
         * @param {{signal?:AbortSignal, timeoutMs?:number}} [opts]
         * @returns {Promise<{requested:number, loaded:number, bytes:number}>}
         */
        request: function (keys, opts) {
            opts = opts || {};
            var list = [];
            var seen = Object.create(null);
            for (var i = 0; i < (keys || []).length; i++) {
                var k = normKey(keys[i]);
                if (!k || seen[k]) continue;
                seen[k] = 1;
                if (pool.has(k)) { fireReady(k); continue; }
                if (inflight.has(k)) continue;
                list.push(k);
            }
            if (!list.length) {
                return Promise.resolve({ requested: 0, loaded: 0, bytes: poolBytes });
            }
            list.forEach(function (k) { inflight.add(k); });

            // 【必须最先连接】否则 port 恒为 null，整条链路会静默退化到主线程解码，
            // Worker 与被其承载的跨页面字节缓存全部失效（性能门禁直接落空）。
            connectWorker();

            return fetchPackChunked(list, opts.signal).then(function (items) {
                var jobs = [];
                var withData = Object.create(null);
                for (var i = 0; i < items.length; i++) {
                    var it = items[i];
                    if (!it.buf) continue;          // 宿主回 dataLen=0：走下面的"放行"分支
                    withData[it.key] = 1;
                    if (port) {
                        jobs.push(askWorker({ t: 'decode', key: it.key, buf: it.buf }, [it.buf]));
                    } else {
                        jobs.push(decodeOnMainThread(it.key, it.buf));
                    }
                }
                // 没有数据可解的键（含宿主明确回 0 长度、以及压根没回的键）：立即放行等待者，
                // 让调用方画占位底，而不是永远等一个不会到来的位图。
                list.forEach(function (k) {
                    if (!withData[k]) releaseWaiters(k, null);
                });
                return Promise.all(jobs).then(function () {
                    var loaded = 0;
                    list.forEach(function (k) { if (pool.has(k)) loaded++; });
                    return { requested: list.length, loaded: loaded, bytes: poolBytes };
                });
            }).catch(function (err) {
                log('request failed:', err && err.message);
                // 失败也要放行等待者
                list.forEach(function (k) { releaseWaiters(k, null); });
                return { requested: list.length, loaded: 0, bytes: poolBytes, error: String(err && err.message || err) };
            }).then(function (r) {
                list.forEach(function (k) { inflight.delete(k); });
                return r;
            });
        },

        /**
         * 只把原始字节灌进 Worker 的字节缓存（不解码）—— 启动预热的低开销形态。
         * @param {string[]} keys
         * @param {{signal?:AbortSignal}} [opts]
         * @returns {Promise<number>} 实际入缓存的条数。
         */
        warm: function (keys, opts) {
            opts = opts || {};
            var list = [];
            var seen = Object.create(null);
            for (var i = 0; i < (keys || []).length; i++) {
                var k = normKey(keys[i]);
                if (!k || seen[k]) continue;
                seen[k] = 1;
                list.push(k);
            }
            if (!list.length) return Promise.resolve(0);
            // 同 request：先连接 Worker，否则 port 恒为 null，字节缓存无处可放
            connectWorker();
            if (!port) return Promise.resolve(0);   // 无 Worker 时字节缓存无处可放，直接跳过
            return fetchPackChunked(list, opts.signal).then(function (items) {
                var keep = [];
                for (var i = 0; i < items.length; i++) if (items[i].buf) keep.push(items[i]);
                if (!keep.length) return 0;
                return askWorker({ t: 'warm', items: keep }, keep.map(function (x) { return x.buf; })).then(function (n) {
                    log('warm', keep.length, '→', n);
                    return n || 0;
                });
            }).catch(function (e) {
                log('warm failed:', e && e.message);
                return 0;
            });
        },

        /**
         * 启动预热：读 CG 清单后按空闲时段分批 warm。
         * 默认延到浏览器空闲（requestIdleCallback），避免与首帧争带宽与主线程。
         * @param {{defer?:boolean, chunk?:number, signal?:AbortSignal}} [opts]
         * @returns {Promise<number>} 入缓存的条数。
         */
        warmFromManifest: function (opts) {
            opts = opts || {};
            var self = this;
            var run = function () {
                if (!port) connectWorker();
                if (!port) return Promise.resolve(0);
                return root.fetch(MANIFEST_URL, { credentials: 'same-origin' })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (j) {
                        if (!j || !j.ok || !j.thumbnailsEnabled || !j.items || !j.items.length) return 0;
                        var chunk = Number(opts.chunk) > 0 ? Number(opts.chunk) : PACK_CHUNK;
                        // 分片：每片之间让出主线程，避免一次性解析几百 KB
                        var total = 0;
                        var i = 0;
                        var step = function () {
                            if (opts.signal && opts.signal.aborted) return Promise.resolve(total);
                            if (i >= j.items.length) return Promise.resolve(total);
                            var slice = j.items.slice(i, i + chunk);
                            i += chunk;
                            return self.warm(slice, opts).then(function (n) {
                                total += n;
                                return new Promise(function (res) { defer(res); }).then(step);
                            });
                        };
                        return step();
                    })
                    .catch(function (e) { log('warmFromManifest failed:', e && e.message); return 0; });
            };
            return opts.defer === false ? run() : new Promise(function (resolve) {
                defer(function () { resolve(run()); });
            });
        },

        /** 诊断统计。 */
        stats: function () {
            var s = { mode: workerMode, portReady: !!port, poolKeys: pool.size, poolBytes: poolBytes, waiting: waiters.size };
            if (DEBUG) log('stats', s);
            return s;
        },

        /** 丢弃指定位图（翻页/关闭时清理）。 */
        drop: function (keys) {
            var ks = Array.isArray(keys) ? keys : [keys];
            ks.forEach(function (k) {
                var kk = normKey(k);
                var e = pool.get(kk);
                if (!e) return;
                pool.delete(kk);
                poolBytes -= e.bytes;
                try { e.bmp.close(); } catch (err) { }
            });
            if (port) { try { port.postMessage({ t: 'drop', keys: ks.map(normKey) }); } catch (e) { } }
        },

        /** 清空位图池与 Worker 字节缓存。 */
        clear: function () {
            pool.forEach(function (e) { try { e.bmp.close(); } catch (err) { } });
            pool.clear();
            poolBytes = 0;
            if (port) { try { port.postMessage({ t: 'clear' }); } catch (e) { } }
        },

        /** 释放 Worker 连接（页面卸载时可调用）。 */
        dispose: function () {
            this.clear();
            try { if (worker && workerMode === 'shared' && worker.port) worker.port.close(); } catch (e) { }
            try { if (worker && workerMode === 'dedicated') worker.terminate(); } catch (e) { }
            worker = null; port = null; workerMode = 'none';
        }
    };

    /** 空闲调度：优先 requestIdleCallback，退化到 setTimeout(0)。 */
    function defer(fn) {
        if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(function () { fn(); }, { timeout: 2000 });
        else root.setTimeout(fn, 0);
    }

    root.ShioriImgPool = api;
    // 调试期暴露：控制台可直接 ShioriImgPool.stats()
    if (DEBUG) log('ready; PACK_URL=', PACK_URL, 'WORKER_URL=', WORKER_URL);
})(typeof window !== 'undefined' ? window : this);
