/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * CG 鉴赏页「极限压测」插件（可选，默认不加载）。
 * ---------------------------------------------------------------------------
 * 【启用方法】在 html/CG.html 中，把下面这行取消注释即可（放在页面主 <script> 之后）：
 *     <script src="../plugins/cg_stress_patch.js"></script>
 * 不需要时保持注释即可；引擎与 CG 页照常运行，不产生任何硬依赖。
 *
 * 【作用】真实 CG 清单通常只有几十张，压不出浏览器在高图片量下的表现。
 * 本插件把清单按倍率**重复输出**成一长串格子，每一格都是独立的 DOM 节点 +
 * 独立的 URL（带 ?dup= 后缀），各自发起自己的请求、不复用节点、不共享位图池，
 * 用来观察极端图片数量下的建格耗时 / 加载进度 / 帧率 / 内存。
 *
 * 【HUD】启用后右上角出现一个只读面板，实时显示：
 *   清单条目 / DOM 格子 / 已加载(失败) / 建格耗时 / 运行时长 / FPS / JS 堆。
 *
 * 【参数】倍率默认取下面的 DEFAULT_MULTI（设为 0 即关闭）。也可用 URL hash 临时覆盖：
 *   #cgstress=10   → 倍率 10
 *   #cgstress=0    → 临时关闭（按正常列表渲染）
 *
 * 【注意】压测会显著增加内存与网络占用，测完请把倍率改回 0 或移除引用。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    /** 默认压测倍率；0 = 关闭。 */
    var DEFAULT_MULTI = 20;

    /** 解析倍率：URL hash 优先，其次 DEFAULT_MULTI；返回 0 表示不压测。 */
    function parseMulti() {
        var m = String(location.hash || '').match(/cgstress(?:=(\d+))?/i);
        var n = m ? Math.max(0, parseInt(m[1] == null ? String(DEFAULT_MULTI) : m[1], 10) || 0)
                  : DEFAULT_MULTI;
        return n;
    }

    /** 取缩略图 URL：优先宿主提供的方法，不可用时按 /cg-thumb/ 规则拼接。 */
    function thumbUrl(p) {
        if (window.ShioriHostConfig && typeof ShioriHostConfig.assetThumbUrl === 'function')
            return ShioriHostConfig.assetThumbUrl(p);
        var raw = String(p);
        var q = raw.indexOf('?');
        var base = q >= 0 ? raw.slice(0, q) : raw;
        var query = q >= 0 ? raw.slice(q) : '';
        var m = base.match(/(?:^|\/)assets\/(.+)$/);
        return m ? '/cg-thumb/' + m[1] + query : p;
    }

    /** 注入 HUD 样式（只注入一次）。 */
    function injectCss() {
        if (document.getElementById('cg-stress-style')) return;
        var st = document.createElement('style');
        st.id = 'cg-stress-style';
        st.textContent =
            '#cg-stress-hud{position:fixed;top:8px;right:8px;z-index:9999;' +
            'padding:6px 10px;background:rgba(0,0,0,.75);color:#7CFC00;' +
            'font:12px/1.5 Consolas,Menlo,monospace;white-space:pre;' +
            'border-radius:6px;pointer-events:none;}';
        document.head.appendChild(st);
    }

    /** 建 HUD（rAF 采样帧率 + 250ms 刷新文本）。 */
    function startHud(total) {
        injectCss();
        var hud = document.createElement('div');
        hud.id = 'cg-stress-hud';
        document.body.appendChild(hud);

        var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
        var frames = 0, fps = 0, last = t0;

        (function loop() {
            frames++;
            var now = (window.performance && performance.now) ? performance.now() : Date.now();
            if (now - last >= 500) {
                fps = Math.round(frames * 1000 / (now - last));
                frames = 0;
                last = now;
            }
            requestAnimationFrame(loop);
        })();

        return {
            /** 用最新计数刷新面板 */
            set: function (cells, loaded, errors, buildMs) {
                var now = (window.performance && performance.now) ? performance.now() : Date.now();
                var mem = '—';
                var pm = window.performance && window.performance.memory;
                if (pm && pm.usedJSHeapSize) mem = (pm.usedJSHeapSize / 1048576).toFixed(1) + ' MiB';
                hud.textContent = [
                    'CG 极限压测 ×' + parseMulti(),
                    '清单条目  : ' + Object.keys(CG_CONFIG_SUB).length,
                    'DOM 格子  : ' + cells + ' / ' + total,
                    '已加载    : ' + loaded + ' / ' + total + '　失败 ' + errors,
                    '建格耗时  : ' + buildMs + ' ms',
                    '运行时长  : ' + Math.round(now - t0) + ' ms',
                    'FPS       : ' + fps,
                    'JS 堆     : ' + mem
                ].join('\n');
            }
        };
    }

    /** 建格：每格一个独立 <img>，各自发起自己的请求。 */
    function buildIndependent(manager, container, paths) {
        container.innerHTML = '';
        manager._cells = [];
        manager._inflight = null;
        manager._thumbPaths = paths;

        var loaded = 0, errors = 0;
        paths.forEach(function (path, index) {
            var img = document.createElement('img');
            img.alt = 'CG ' + (index + 1);
            img.className = 'cg-thumbnail';
            img.decoding = 'async';
            img.dataset.fullPath = path;
            img.dataset.index = index;
            img.addEventListener('click', function (e) {
                var idx = parseInt(e.target.dataset.index, 10);
                manager.currentImageIndex = idx;
                var src = String(manager._thumbPaths[idx] || '');
                if (typeof manager.showFullImage === 'function') manager.showFullImage(src.split('?')[0]);
            });
            img.addEventListener('load', function () { loaded++; });
            img.addEventListener('error', function () {
                errors++;
                var cell = img.parentElement;
                if (cell && cell.dataset) cell.dataset.cgMissing = '1';  // 压测保留格子只打标记
            });
            img.src = thumbUrl(path);

            var cell = document.createElement('span');
            cell.className = 'cg-cell';
            cell.dataset.ui = 'cg_item';
            cell.appendChild(img);
            container.appendChild(cell);
        });

        return { loaded: function () { return loaded; }, errors: function () { return errors; } };
    }

    /** 安装：包装 CGManager.loadCGList。CGManager 未就绪时返回 false（由轮询重试）。 */
    function install() {
        var mgr;
        try { mgr = CGManager; } catch (e) { return false; }   // 尚未初始化（TDZ）：稍后重试
        if (!mgr || typeof mgr.loadCGList !== 'function') return false;
        if (mgr.__cgStressHooked) return true;

        var orig = mgr.loadCGList;
        mgr.loadCGList = function () {
            var multi = parseMulti();
            if (!multi) return orig.apply(this, arguments);   // 关闭：走引擎正常列表

            var container = document.getElementById('cg-container');
            if (!container) return orig.apply(this, arguments);

            var base = Object.values(CG_CONFIG_SUB);
            var paths = [];
            for (var m = 0; m < multi; m++) {
                for (var i = 0; i < base.length; i++) {
                    paths.push(base[i] + '?dup=' + m + '_' + i);
                }
            }
            console.log('[CG] 极限压测 ×' + multi + '：' + base.length + ' 张 × ' +
                multi + ' = ' + paths.length + ' 格，每格独立加载一次');

            var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
            var builder = buildIndependent(this, container, paths);
            var buildMs = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - t0);

            var hud = startHud(paths.length);
            hud.set(container.children.length, builder.loaded(), builder.errors(), buildMs);
            setInterval(function () {
                hud.set(container.children.length, builder.loaded(), builder.errors(), buildMs);
            }, 250);
        };
        mgr.__cgStressHooked = true;
        return true;
    }

    // CGManager 由 CG.html 的内联脚本定义；本插件可能先于或后于它就绪，
    // 因此先立即尝试一次，未就绪则以 25ms 间隔轮询等待（最多约 5 秒）。
    if (!install()) {
        var tries = 0;
        var timer = setInterval(function () {
            if (install() || ++tries > 200) clearInterval(timer);
        }, 25);
    }
})();
