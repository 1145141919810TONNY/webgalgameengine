/**
 * 版权所有：bilibili月が綺麗ですね_
 * SPDX-License-Identifier: LicenseRef-Shiori-Engine
 * 作者：bilibili月が綺麗ですね_
 * Shiori Engine - Open Source Visual Novel Engine
 *
 * 本引擎采用宽松开源协议，允许用户根据项目需求自由修改、定制和发布衍生作品。
 * 使用时请保留上述版权声明，具体授权条款详见 license.txt 文件。
 *
 * DSL 宏系统运行时（shiori_dsl.js）。
 * 本文件是整个宏系统的核心，提供数据驱动的注册、编译与执行框架，包含：
 *   1. 词法分析（tokenize）与语法分析（parseField/parseCallBody）；
 *   2. 指令注册表 Registry（命令 schema、宏定义、运行时实现、别名）；
 *   3. 宏展开引擎（参数绑定、模板替换、递归展开与循环/深度保护）；
 *   4. 编译降级（lowerCall）与内置指令到 Action 的映射（lowerToAction）；
 *   5. 对外 API（__shiori.dsl / __shiori.reg），供各 impl 文件注册实现。
 */
(function (global) {
    'use strict';

    /* DSL 协议版本号，用于引擎侧兼容性探测 */
    var SHIORI_DSL_VERSION = 'DSL1.0';
    /* 宏递归展开深度不设上限：循环嵌套由 stack 检测拦住，深度只受已注册宏总数自然约束。 */

    /**
     * 将指令名称规范化为小写.trim() 字符串，作为注册表统一键。
     * null / undefined 会被安全地转为空字符串。
     */
    function keyOf(name) {
        return String(name == null ? '' : name).trim().toLowerCase();
    }

    /**
     * 判断一个值是否为空白（null、undefined 或纯空白字符串）。
     * 用于编译阶段跳过空指令名。
     */
    function isBlank(s) {
        return s == null || String(s).trim() === '';
    }

    /**
     * 将字符串值强制转换为合适的 JS 类型：
     * - 纯整数 → parseInt
     * - "true" / "false" → 布尔值
     * - 其余保持字符串
     * 数字和布尔值直接透传。
     */
    function coerce(value) {
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        var s = String(value == null ? '' : value);
        if (/^-?\d+$/.test(s)) return parseInt(s, 10);
        if (s === 'true') return true;
        if (s === 'false') return false;
        return s;
    }

    /**
     * 词法分析器（Lexer）：将 DSL 原始文本拆分为 token 序列。
     * 支持的 token 类型：
     *   lbr/rbr  → [ ]
     *   at       → @
     *   comma    → ,
     *   eq       → =
     *   string   → 单/双引号包裹的字符串（支持反斜杠转义）
     *   number   → 整数或小数（支持负号）
     *   ident    → 标识符（不含特殊字符的连续文本）
     *   eof      → 结束标记
     * @param {string} input DSL 原始文本
     * @returns {Array<{kind: string, value: string, column: number}>} token 序列（末尾必带 eof）
     */
    function tokenize(input) {
        var tokens = [];
        /* 空输入直接返回只含 eof 的 token 列表 */
        if (input == null || input === '') {
            tokens.push({ kind: 'eof', value: '', column: 0 });
            return tokens;
        }
        var i = 0;
        var s = String(input);
        while (i < s.length) {
            var c = s.charAt(i);
            /* 跳过空白字符（空格、制表符、换行、回车） */
            if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
            var col = i;
            /* 单字符 token：方括号 */
            if (c === '[') { tokens.push({ kind: 'lbr', value: '[', column: col }); i++; continue; }
            if (c === ']') { tokens.push({ kind: 'rbr', value: ']', column: col }); i++; continue; }
            /* @ 标记行内指令（如 @wait time=500） */
            if (c === '@') { tokens.push({ kind: 'at', value: '@', column: col }); i++; continue; }
            if (c === ',') { tokens.push({ kind: 'comma', value: ',', column: col }); i++; continue; }
            if (c === '=') { tokens.push({ kind: 'eq', value: '=', column: col }); i++; continue; }
            /* 字符串字面量：支持单引号和双引号，内部可反斜杠转义 */
            if (c === '"' || c === "'") {
                var quote = c;
                i++;
                var buf = '';
                while (i < s.length && s.charAt(i) !== quote) {
                    if (s.charAt(i) === '\\' && i + 1 < s.length) {
                        i++;
                        buf += s.charAt(i);
                        i++;
                    } else {
                        buf += s.charAt(i);
                        i++;
                    }
                }
                if (i < s.length) i++; /* 跳过闭合引号 */
                tokens.push({ kind: 'string', value: buf, column: col });
                continue;
            }
            /* 数字字面量：整数或小数，支持负号前缀 */
            if ((c >= '0' && c <= '9') || (c === '-' && i + 1 < s.length && s.charAt(i + 1) >= '0' && s.charAt(i + 1) <= '9')) {
                var start = i;
                if (c === '-') i++;
                while (i < s.length && ((s.charAt(i) >= '0' && s.charAt(i) <= '9') || s.charAt(i) === '.')) i++;
                tokens.push({ kind: 'number', value: s.substring(start, i), column: col });
                continue;
            }
            /* 标识符：读取直到遇到分隔符为止 */
            var ident = '';
            while (i < s.length) {
                var ch = s.charAt(i);
                if (ch === '[' || ch === ']' || ch === '@' || ch === ',' || ch === '=' ||
                    ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') break;
                ident += ch;
                i++;
            }
            tokens.push({ kind: 'ident', value: ident, column: col });
        }
        tokens.push({ kind: 'eof', value: '', column: i });
        return tokens;
    }

    /**
     * 跳过空白和逗号，返回新的游标位置。
     * 用于在 field 字符串中定位下一个有效 token 起始位置。
     * @param {string} field 待扫描字符串
     * @param {number} i 起始游标
     * @returns {number} 跳过空白/逗号后的游标位置
     */
    function skipWsComma(field, i) {
        while (i < field.length) {
            var c = field.charAt(i);
            if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') i++;
            else break;
        }
        return i;
    }

    /**
     * 查找 @ 指令体的结束位置（遇到 [ @ , 或字符串末尾为止）。
     * @param {string} field 待扫描字符串
     * @param {number} i @ 之后的起始游标
     * @returns {number} 指令体结束游标
     */
    function findAtEnd(field, i) {
        while (i < field.length) {
            var c = field.charAt(i);
            if (c === '[' || c === '@' || c === ',') return i;
            i++;
        }
        return field.length;
    }

    /**
     * 按空白/逗号拆分字符串，同时正确处理引号包裹的子串。
     * 这是 parseCallBody 的基础分词方法，保证 "hello world" 不会被空格拆断。
     * @param {string} body 指令体原始文本
     * @returns {string[]} 拆分后的 token 数组（引号已去除、内部转义已还原）
     */
    function splitWsQuoted(body) {
        var parts = [];
        var s = body == null ? '' : String(body);
        var i = 0;
        while (i < s.length) {
            /* 跳过分隔符（空白和逗号） */
            while (i < s.length && (s.charAt(i) === ' ' || s.charAt(i) === '\t' || s.charAt(i) === '\n' || s.charAt(i) === '\r' || s.charAt(i) === ',')) i++;
            if (i >= s.length) break;
            var c = s.charAt(i);
            /* 引号包裹的字符串：保留内部内容（含空白），去除引号 */
            if (c === '"' || c === "'") {
                var q = c;
                i++;
                var buf = '';
                while (i < s.length && s.charAt(i) !== q) {
                    if (s.charAt(i) === '\\' && i + 1 < s.length) {
                        i++;
                        buf += s.charAt(i);
                        i++;
                    } else {
                        buf += s.charAt(i);
                        i++;
                    }
                }
                if (i < s.length) i++;
                parts.push(buf);
                continue;
            }
            /* 普通 token：按空白或逗号截断 */
            var start = i;
            while (i < s.length) {
                var ch = s.charAt(i);
                if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') break;
                i++;
            }
            parts.push(s.substring(start, i));
        }
        return parts;
    }

    /**
     * 解析单个指令体（括号内或 @ 后的文本），生成调用描述对象。
     * 返回 { name, args, kv, surface }：
     *   name    → 指令名
     *   args    → 位置参数列表
     *   kv      → 键值对参数（name=value 形式）
     *   surface → 原始语法形式（'bracket' 或 'at'）
     * @param {string} body 指令体文本（不含外层 [ ] 或 @ 符号）
     * @param {string} [surface] 语法来源：'bracket' | 'at'
     * @returns {{name: string, args: string[], kv: Object, surface: string}} 调用描述对象
     */
    function parseCallBody(body, surface) {
        var call = { name: '', args: [], kv: Object.create(null), surface: surface || 'bracket' };
        var parts = splitWsQuoted(body);
        if (!parts.length) return call;
        /* 第一个 token 始终为指令名 */
        call.name = parts[0];
        var idx = 1;
        while (idx < parts.length) {
            var p = parts[idx];
            if (p === ',') { idx++; continue; }
            /* 形式一：token 内含 =（如 "time=500"） */
            var eq = p.indexOf('=');
            if (eq > 0) {
                call.kv[p.substring(0, eq)] = p.substring(eq + 1);
                idx++;
                continue;
            }
            /* 形式二：token = token（如 "time = 500"，= 独立成 token） */
            if (idx + 2 < parts.length && parts[idx + 1] === '=') {
                call.kv[p] = parts[idx + 2];
                idx += 3;
                continue;
            }
            /* 形式三：= 粘在后一个 token 头部（如 "=500" 附着在 key 后） */
            if (idx + 1 < parts.length && parts[idx + 1].charAt(0) === '=' && parts[idx + 1].length > 1) {
                call.kv[p] = parts[idx + 1].substring(1);
                idx += 2;
                continue;
            }
            /* 以上都不是 → 当作位置参数 */
            call.args.push(p);
            idx++;
        }
        return call;
    }

    /**
     * 解析整个 field 字符串，提取其中所有指令调用。
     * 支持两种语法：[指令名 参数...] 和 @指令名 参数...
     * 返回 parseCallBody 结果组成的数组。
     * 边界处理：方括号未闭合时按行尾（length-1）截断，避免越界。
     * @param {string} field 整段剧本字段文本
     * @returns {Array<Object>} 解析出的调用描述数组
     */
    function parseField(field) {
        var calls = [];
        if (isBlank(field)) return calls;
        var s = String(field);
        var i = 0;
        while (i < s.length) {
            i = skipWsComma(s, i);
            if (i >= s.length) break;
            if (s.charAt(i) === '[') {
                /* 方括号语法：[cmd arg=val ...] */
                var start = i;
                var end = s.indexOf(']', i + 1);
                if (end < 0) end = s.length - 1;
                else end += 1;
                var inner = end > start + 1 ? s.substring(start + 1, end - 1) : '';
                calls.push(parseCallBody(inner, 'bracket'));
                i = end;
            } else if (s.charAt(i) === '@') {
                /* @ 语法：@cmd arg=val ... */
                i++;
                var atEnd = findAtEnd(s, i);
                var atInner = s.substring(i, atEnd).trim();
                calls.push(parseCallBody(atInner, 'at'));
                i = atEnd;
            } else {
                i++; /* 跳过无法识别的字符 */
            }
        }
        return calls;
    }

    /**
     * 指令注册表（Registry）：存储所有已注册的命令 schema、宏定义和运行时实现。
     * commands  → 命令名 → schema 的映射（含别名）
     * macros    → 宏名 → 宏定义的映射
     * impls     → 命令名 → 运行时执行函数的映射
     * unknownPolicy → 遇到未注册指令时的策略：'warn' | 'error' | 'ignore'
     * @constructor
     */
    function Registry() {
        this.commands = Object.create(null);
        this.macros = Object.create(null);
        this.impls = Object.create(null);
        this.unknownPolicy = 'warn';
    }

    /**
     * 注册一个命令 schema（含名称和别名列表）。
     * 主名称和所有别名都会映射到同一个 schema 对象。
     * @param {{name: string, aliases?: string[]}} schema 命令声明
     * @returns {void}
     */
    Registry.prototype.add = function (schema) {
        var self = this;
        var names = [schema.name].concat(schema.aliases || []);
        names.forEach(function (n) {
            self.commands[keyOf(n)] = schema;
        });
    };

    /**
     * 注册一个宏定义（名称 + 参数列表 + 展开步骤）。
     * @param {{name: string, parameters?: Array, steps?: Array}} macro 宏定义
     * @returns {void}
     */
    Registry.prototype.addMacro = function (macro) {
        this.macros[keyOf(macro.name)] = macro;
    };

    /**
     * 按名称查找命令 schema（大小写不敏感）。
     * @param {string} name 命令名
     * @returns {?Object} 命中的 schema，未注册返回 null
     */
    Registry.prototype.tryGet = function (name) {
        return this.commands[keyOf(name)] || null;
    };

    /**
     * 按名称查找宏定义（大小写不敏感）。
     * @param {string} name 宏名
     * @returns {?Object} 命中的宏定义，未注册返回 null
     */
    Registry.prototype.tryGetMacro = function (name) {
        return this.macros[keyOf(name)] || null;
    };

    /**
     * 向注册表写入引擎内置的命令 schema 和宏定义。
     * 命令 schema 仅声明名称和别名（实际执行逻辑由对应 impl 文件提供）。
     * 宏定义则包含参数列表和展开步骤，可在编译期自动展开为底层指令。
     * @param {Registry} registry 目标注册表
     * @returns {void}
     * @sideeffect 向注册表写入内置命令 schema 与内置宏
     */
    function seedBuiltin(registry) {
        /* ---- 内置命令 schema 注册 ---- */
        registry.add({ name: 'wait' });      // 等待（定时或点击）
        registry.add({ name: 'pov' });       // 视角（第一人称旁白名称）
        registry.add({ name: 'char' });      // 立绘显示
        registry.add({ name: 'quake' });     // 画面震动开始
        registry.add({ name: 'quake-stop' }); // 画面震动停止
        registry.add({ name: 's' });         // 点击等待（等同于 [wait]）
        registry.add({ name: 'msgoff' });    // 隐藏文本框
        registry.add({ name: 'msgon' });     // 显示文本框
        registry.add({ name: 'clearname', aliases: ['clear'] }); // 清除角色名
        registry.add({ name: 'fadeout' });   // 淡出
        registry.add({ name: 'fadein' });    // 淡入
        registry.add({ name: 'finish' });    // 结局（黑底）
        registry.add({ name: 'finishwhite' }); // 结局（白底）
        registry.add({ name: 'novel' });     // 小说模式（全屏文本）
        registry.add({ name: 'normal' });    // 普通模式（退出小说模式）
        registry.add({ name: 'lock', aliases: ['阻止'] }); // 锁定点击
        registry.add({ name: 'free', aliases: ['解锁'] }); // 解锁点击
        registry.add({ name: 'bgm' });       // 背景音乐
        registry.add({ name: 'se' });        // 音效
        registry.add({ name: 'voice' });     // 语音
        registry.add({ name: 'background' }); // 背景图
        registry.add({ name: 'off' });       // 移除媒体层

        /* ---- 内置宏定义注册 ---- */
        /* "发抖" 宏：展开为 quake + wait，模拟角色抖动效果 */
        registry.addMacro({
            name: '发抖',
            parameters: [
                { name: 'who', def: '' },     // 目标角色名
                { name: 'level', def: '中' }, // 震动强度：极小/小/中/大/极大
                { name: 'time', def: 600 },   // 持续时间（毫秒）
                { name: 'chan', def: '' }     // 通道（stage/ev/allchar）
            ],
            steps: [
                { cmd: 'quake', kv: { who: '%who', level: '%level', chan: '%chan' } },
                { cmd: 'wait', kv: { time: '%time' } }
            ]
        });
        /* "发抖-stop" 宏：停止指定角色或通道的震动效果 */
        registry.addMacro({
            name: '发抖-stop',
            parameters: [
                { name: 'who', def: '' },
                { name: 'chan', def: '' }
            ],
            steps: [
                { cmd: 'quake-stop', kv: { who: '%who', chan: '%chan' } }
            ]
        });
    }

    /**
     * 将宏调用与宏定义绑定：把调用时的实参映射到宏的形参上。
     * 优先使用命名参数（kv），其次使用位置参数（args），最后使用默认值（def）。
     * 返回 { 形参名(小写): 实参值(字符串) } 的映射表。
     * @param {Object} macro 宏定义（含 parameters）
     * @param {Object} call 宏调用（含 args 位置参数、kv 命名参数）
     * @returns {Object} 形参名到实参字符串的绑定表
     */
    function bindMacro(macro, call) {
        var bound = Object.create(null);
        var pos = 0;
        (macro.parameters || []).forEach(function (p) {
            var named = kvGet(call.kv, p.name);
            if (named !== undefined)
                bound[keyOf(p.name)] = String(named);
            else if (pos < call.args.length)
                bound[keyOf(p.name)] = String(call.args[pos++]);
            else
                bound[keyOf(p.name)] = p.def == null ? '' : String(p.def);
        });
        return bound;
    }

    /**
     * 模板替换：将 "%参数名" 形式的占位符替换为绑定后的实际值。
     * 不以 % 开头的模板原样返回（作为字面量）。
     * @param {string} template 模板字符串，如 "%who"
     * @param {Object} bound 形参绑定表
     * @returns {string} 替换后的值；绑定表中无此参数时返回空串
     */
    function substitute(template, bound) {
        if (template == null || template === '' || String(template).charAt(0) !== '%')
            return template == null ? '' : String(template);
        var k = keyOf(String(template).substring(1));
        return Object.prototype.hasOwnProperty.call(bound, k) ? bound[k] : '';
    }

    /**
     * 递归展开宏调用为底层指令序列。
     * - 如果 call.name 不是已注册宏，直接返回原调用
     * - 递归深度不设上限（仅由循环嵌套检测兜底）
     * - 如果检测到宏循环嵌套（同一宏在展开链中重复出现），报错并返回空
     * - 展开过程中对每个 step 进行参数替换，若 step 本身也是宏则继续递归展开
     * @param {Registry} registry 指令注册表
     * @param {Object} call 待展开的宏调用
     * @param {Array} diagnostics 诊断信息收集数组（原地追加）
     * @param {number} depth 当前递归深度
     * @param {Object} stack 展开链上的宏名集合，用于循环嵌套检测
     * @returns {Array<Object>} 展开后的底层调用数组（出错时为空数组）
     */
    function expandMacro(registry, call, diagnostics, depth, stack) {
        var macro = registry.tryGetMacro(call.name);
        if (!macro) return [call];
        var folded = keyOf(call.name);
        if (stack[folded]) {
            diagnostics.push({ severity: 'error', message: '宏循环嵌套: ' + call.name });
            return [];
        }
        stack[folded] = true;
        var bound = bindMacro(macro, call);
        var out = [];
        (macro.steps || []).forEach(function (step) {
            /* 构造展开后的调用对象，替换模板参数 */
            var next = { name: step.cmd, args: [], kv: Object.create(null), surface: call.surface };
            var kv = step.kv || {};
            Object.keys(kv).forEach(function (k) {
                next.kv[k] = substitute(kv[k], bound);
            });
            (step.args || []).forEach(function (a) {
                next.args.push(substitute(a, bound));
            });
            /* 如果展开结果本身仍是宏，继续递归展开 */
            if (registry.tryGetMacro(next.name)) {
                expandMacro(registry, next, diagnostics, depth + 1, stack).forEach(function (x) { out.push(x); });
            } else {
                out.push(next);
            }
        });
        delete stack[folded]; /* 回溯：移除当前宏的循环检测标记 */
        return out;
    }

    /**
     * 将 wait 调用降级为中间表示（IR）节点。
     * 若指定了 time 参数 → 定时等待 { kind:'wait', mode:'time', ms:N }
     * 否则 → 点击等待 { kind:'wait', mode:'click' }
     * @param {Object} call wait 调用描述
     * @returns {{kind: string, mode: string, ms: ?number}} 等待型 IR 节点
     */
    function toWait(call) {
        var timeRaw = kvGet(call.kv, 'time');
        if (timeRaw !== undefined && !isBlank(timeRaw)) {
            var ms = coerce(timeRaw);
            return { kind: 'wait', mode: 'time', ms: typeof ms === 'number' ? ms : 0 };
        }
        return { kind: 'wait', mode: 'click', ms: null };
    }

    /**
     * 从 kv 对象中按名称取值（大小写不敏感）。
     * 先尝试精确匹配，再尝试忽略大小写的回退查找。
     * @param {Object} kv 键值对对象
     * @param {string} name 键名
     * @returns {*} 命中的值，未找到返回 undefined
     */
    function kvGet(kv, name) {
        if (!kv) return undefined;
        if (Object.prototype.hasOwnProperty.call(kv, name)) return kv[name];
        var want = keyOf(name);
        var keys = Object.keys(kv);
        for (var i = 0; i < keys.length; i++) {
            if (keyOf(keys[i]) === want) return kv[keys[i]];
        }
        return undefined;
    }

    /**
     * 检测是否为"资源关闭"语法（如 bgm.off、se.off）。
     * 判定条件：第一个位置参数为 "off" 且指令名中包含 "."。
     * @param {Object} call 调用描述
     * @returns {boolean} 是否为资源关闭语法
     */
    function isResourceOff(call) {
        if (!call.args || !call.args.length) return false;
        if (keyOf(call.args[0]) !== 'off') return false;
        return String(call.name || '').indexOf('.') >= 0;
    }

    /**
     * 将单个调用降级（lower）为可执行的 IR 节点。
     * 处理三类特殊语法：
     *   wait / s → 直接生成等待型节点；
     *   xxx.off  → 改写为 off 指令并把原指令名作为 storage；
     *   未注册但带位置参数的指令 → 视为立绘简写，改写为 char 指令。
     * 同时对未知指令按 unknownPolicy 记录 warn/error 诊断。
     * @param {Registry} registry 指令注册表
     * @param {Object} call 调用描述（可能被就地改写）
     * @param {Array} diagnostics 诊断信息收集数组
     * @returns {Object} IR 节点（kind='inst'）或等待节点
     */
    function lowerCall(registry, call, diagnostics) {
        var name = call.name;
        if (keyOf(name) === 'wait') return toWait(call);
        if (keyOf(name) === 's') return { kind: 'wait', mode: 'click', ms: null };
        if (isResourceOff(call)) {
            /* bgm.off → off storage=bgm */
            call.kv.storage = name;
            call.args = [];
            name = 'off';
            call.name = name;
        } else if (!registry.tryGet(name) && !registry.tryGetMacro(name) && call.args && call.args.length) {
            /* 未注册指令 + 带位置参数 → 立绘简写，改写为 char "name arg..." */
            call.args = [name].concat(call.args);
            name = 'char';
            call.name = name;
        }
        var schema = registry.tryGet(name);
        /* 仍未注册：按 unknownPolicy 记录诊断（ignore 策略下静默） */
        if (!schema && !registry.tryGetMacro(name)) {
            var msg = '未注册指令: ' + name;
            if (registry.unknownPolicy === 'error')
                diagnostics.push({ severity: 'error', message: msg });
            else if (registry.unknownPolicy !== 'ignore')
                diagnostics.push({ severity: 'warn', message: msg });
        }
        /* 组装 IR 节点：位置参数与键值对统一做类型强转（coerce） */
        var inst = {
            kind: 'inst',
            cmd: schema ? schema.name : name,
            args: (call.args || []).map(coerce),
            kv: Object.create(null),
            source: 'builtin'
        };
        Object.keys(call.kv || {}).forEach(function (k) {
            inst.kv[k] = coerce(call.kv[k]);
        });
        /* pov 特例：位置参数转为 name（或 stop），方便后续统一处理 */
        if (keyOf(name) === 'pov' && inst.args.length > 0 && kvGet(inst.kv, 'name') == null) {
            if (keyOf(String(inst.args[0])) === 'stop')
                inst.kv.stop = true;
            else
                inst.kv.name = inst.args.map(function (x) { return String(x); }).join(' ');
        }
        return inst;
    }

    /**
     * 将一个调用追加到节点列表：先递归展开宏，再逐个降级为 IR 节点。
     * 空指令名直接忽略。
     * @param {Registry} registry 指令注册表
     * @param {Object} call 调用描述
     * @param {Array} nodes 节点输出数组（原地追加）
     * @param {Array} diagnostics 诊断输出数组
     * @returns {void}
     */
    function appendCall(registry, call, nodes, diagnostics) {
        if (isBlank(call.name)) return;
        var expanded = expandMacro(registry, call, diagnostics, 0, Object.create(null));
        expanded.forEach(function (item) {
            nodes.push(lowerCall(registry, item, diagnostics));
        });
    }

    /**
     * 编译整段剧本字段文本为 IR 节点序列。
     * @param {Registry} registry 指令注册表
     * @param {string} field 剧本字段文本
     * @returns {{nodes: Array, diagnostics: Array}} 编译结果（节点 + 诊断）
     */
    function compileField(registry, field) {
        var diagnostics = [];
        var nodes = [];
        parseField(field).forEach(function (call) {
            appendCall(registry, call, nodes, diagnostics);
        });
        return { nodes: nodes, diagnostics: diagnostics };
    }

    /**
     * 编译结构化指令数组（ks/ops 形式）为 IR 节点序列。
     * 与 compileField 共用展开与降级逻辑，区别在于输入是对象数组而非文本。
     * @param {Registry} registry 指令注册表
     * @param {Array<Object>} ops 指令对象数组（每项含 cmd 及其余 kv 字段）
     * @returns {{nodes: Array, diagnostics: Array}} 编译结果
     */
    function compileOps(registry, ops) {
        var diagnostics = [];
        var nodes = [];
        if (!ops || !ops.length) return { nodes: nodes, diagnostics: diagnostics };
        ops.forEach(function (el) {
            if (!el || typeof el !== 'object' || el.cmd == null) return;
            var call = { name: String(el.cmd), args: [], kv: Object.create(null), surface: 'ops' };
            /* cmd 之外的所有字段都视为键值对参数 */
            Object.keys(el).forEach(function (k) {
                if (k === 'cmd') return;
                call.kv[k] = el[k] == null ? '' : String(el[k]);
            });
            appendCall(registry, call, nodes, diagnostics);
        });
        return { nodes: nodes, diagnostics: diagnostics };
    }

    /**
     * 将文本按行内富文本标记拆分为 run 序列。
     * 识别的标记：
     *   [s]                     → 等待点（{s:true}）
     *   [a]                     → 点击点（{a:true}）
     *   <ruby>base<rt>注音</rt></ruby> → 注音 run（{base, ruby}）
     *   其余文本                → 普通文本 run（{t: 文本}）
     * @param {string} text 原始文本
     * @returns {Array<Object>} run 序列数组
     */
    function splitInline(text) {
        var runs = [];
        if (text == null || text === '') {
            runs.push({ t: text == null ? '' : text });
            return runs;
        }
        var s = String(text);
        var re = /\[s\]|\[a\]|<ruby>([\s\S]*?)<rt>([\s\S]*?)<\/rt><\/ruby>/gi;
        var idx = 0;
        var m;
        while ((m = re.exec(s)) !== null) {
            if (m.index > idx)
                runs.push({ t: s.substring(idx, m.index) });
            var raw = m[0];
            if (raw.toLowerCase() === '[s]')
                runs.push({ s: true });
            else if (raw.toLowerCase() === '[a]')
                runs.push({ a: true });
            else
                runs.push({ base: m[1], ruby: m[2] });
            idx = m.index + raw.length;
        }
        if (idx < s.length)
            runs.push({ t: s.substring(idx) });
        if (runs.length === 0)
            runs.push({ t: s });
        return runs;
    }

    /**
     * 将值安全转换为整数，失败时返回兜底值。
     * @param {*} v 待转换值
     * @param {number} fallback 解析失败时的兜底值
     * @returns {number} 整数结果
     */
    function intOr(v, fallback) {
        var n = typeof v === 'number' ? v : parseInt(v, 10);
        return isNaN(n) ? fallback : n;
    }

    /**
     * 将内置指令的 IR 节点映射为引擎可执行的高层 Action 对象。
     * 覆盖 fadein/fadeout、finish、novel、pov、lock/free 等纯 UI 指令；
     * 未覆盖的指令返回空对象（由 executeDslNode 走注册表 impl 执行）。
     * @param {Object} node IR 节点
     * @returns {Object} Action 描述对象，无法映射时为 {}
     */
    function lowerToAction(node) {
        if (!node) return {};
        if (node.kind === 'wait') {
            if (node.mode === 'time')
                return { type: 'waitForTime', duration: intOr(node.ms, 0) };
            return { type: 'waitForClick' };
        }
        /* $ 变量语句区：节点自带解析结果，直接交给 handleAction 执行 */
        if (node.kind === 'vars') return { type: 'varProgram', program: node.program };
        if (node.kind !== 'inst') return {};
        var cmd = keyOf(node.cmd);
        var kv = node.kv || {};
        var args = node.args || [];
        switch (cmd) {
            case 'fadeout':
                return {
                    type: 'fadeOut',
                    duration: intOr(kvGet(kv, 'time'), 1000),
                    backgroundColor: kvGet(kv, 'color') || 'black'
                };
            case 'clearname':
            case 'clear':
                return { type: 'clearName' };
            case 'msgoff':
                return { type: 'hideText' };
            case 'msgon':
                return { type: 'showText' };
            case 'fadein':
                return {
                    type: 'fadeIn',
                    duration: intOr(kvGet(kv, 'time'), 1000),
                    backgroundColor: kvGet(kv, 'color') || 'black'
                };
            case 'finish':
                return {
                    type: 'finishGame',
                    bgColor: kvGet(kv, 'bgcolor') || 'black',
                    duration: intOr(kvGet(kv, 'time'), 1500)
                };
            case 'finishwhite':
                return {
                    type: 'finishGame',
                    bgColor: kvGet(kv, 'bgcolor') || 'white',
                    duration: intOr(kvGet(kv, 'time'), 1500)
                };
            case 's':
                return { type: 'waitForClick' };
            case 'pov':
                if (kv.stop === true || (args.length && keyOf(String(args[0])) === 'stop'))
                    return { type: 'povStop' };
                return {
                    type: 'povShow',
                    povName: kvGet(kv, 'name') != null ? String(kvGet(kv, 'name')) : args.map(function (x) { return String(x); }).join(' ')
                };
            case 'novel':
                return { type: 'novelOn' };
            case 'normal':
                return { type: 'novelOff' };
            case 'lock':
            case '阻止':
                return { type: 'clickLock' };
            case 'free':
            case '解锁':
                return { type: 'clickUnlock' };
            default:
                return {};
        }
    }

    /**
     * 执行单个 DSL 节点（对外统一执行入口）。
     * 执行优先级：
     *   1) 注册表中存在该指令的 impl → 直接调用（音频/背景/震动等媒体类指令）；
     *   2) 否则映射为高层 Action 并交给 ctx.handleAction 处理（UI 类指令）。
     * @param {Object} node IR 节点
     * @param {Object} ctx 游戏引擎实例
     * @returns {Object} 指令返回的动作描述（可能为空对象）
     * @sideeffect 可能触发播放器、DOM 变更或引擎状态更新
     */
    function executeDslNode(node, ctx) {
        if (!node) return {};
        /* wait 节点没有 cmd 字段，统一归一为 'wait' 查找实现 */
        var cmd = node.kind === 'wait' ? 'wait' : (node.cmd || '');
        var impl = registry.impls[keyOf(cmd)];
        if (typeof impl === 'function')
            return impl(ctx, node) || {};
        var action = lowerToAction(node);
        if (action && action.type && ctx && typeof ctx.handleAction === 'function')
            ctx.handleAction(action);
        return action || {};
    }

    /**
     * 注册一个 Action 型指令（含可选运行时实现与别名）。
     * manifest.run 若存在，会被包装为接收 (ctx, node) 的 impl：
     * 将 node.kv 展开为扁平参数对象后传入。
     * @param {{name: string, alias?: string|string[], run?: Function}} manifest 指令声明
     * @returns {void}
     */
    function registerAction(manifest) {
        if (!manifest || isBlank(manifest.name)) return;
        var schema = { name: manifest.name, aliases: manifest.alias ? [].concat(manifest.alias) : [] };
        registry.add(schema);
        if (typeof manifest.run === 'function')
            registry.impls[keyOf(manifest.name)] = function (ctx, node) {
                var p = {};
                Object.keys(node.kv || {}).forEach(function (k) { p[k] = node.kv[k]; });
                return manifest.run(ctx, p);
            };
    }

    /**
     * 注册一个宏定义（外部/宿主下发）。
     * 兼容两种参数声明形式：
     *   parameters: [{name, def, defaultValue}, ...]
     *   params:     { 形参名: {def, defaultValue}, ... }
     * 兼容两种步骤声明形式：
     *   step.kv 对象，或步骤对象中的平铺 kv 字段。
     * 已存在的同名宏或命令会被跳过（不覆盖内置定义）。
     * @param {Object} manifest 宏清单
     * @returns {void}
     */
    function registerMacro(manifest) {
        if (!manifest || isBlank(manifest.name)) return;
        if (registry.tryGetMacro(manifest.name) || registry.tryGet(manifest.name)) return;
        var params = [];
        if (Array.isArray(manifest.parameters)) {
            manifest.parameters.forEach(function (p) {
                if (!p || isBlank(p.name)) return;
                params.push({
                    name: p.name,
                    def: p.defaultValue != null ? p.defaultValue : (p.def != null ? p.def : '')
                });
            });
        } else if (manifest.params) {
            Object.keys(manifest.params).forEach(function (k) {
                var p = manifest.params[k] || {};
                params.push({ name: k, def: p.def != null ? p.def : (p.defaultValue != null ? p.defaultValue : '') });
            });
        }
        if (!Array.isArray(manifest.steps)) return;
        var steps = manifest.steps.map(function (st) {
            if (!st || typeof st !== 'object') return { cmd: '', kv: {}, args: [] };
            var kv = {};
            if (st.kv && typeof st.kv === 'object') {
                Object.keys(st.kv).forEach(function (k) { kv[k] = st.kv[k]; });
            } else {
                Object.keys(st).forEach(function (k) {
                    if (k === 'cmd' || k === 'args') return;
                    kv[k] = st[k];
                });
            }
            var args = [];
            if (Array.isArray(st.args)) {
                st.args.forEach(function (a) { args.push(a == null ? '' : String(a)); });
            }
            return { cmd: st.cmd, kv: kv, args: args };
        }).filter(function (st) { return !isBlank(st.cmd); });
        if (!steps.length) return;
        registry.addMacro({ name: manifest.name, parameters: params, steps: steps });
    }

    /**
     * 吸收宿主（如 C# 层）下发的注册表：记录引用并注册其中所有宏。
     * @param {Object} host 宿主注册表对象（含 macros 数组）
     * @returns {void}
     * @sideeffect 写入 dsl.hostRegistry 并注册宿主宏
     */
    function ingestHostRegistry(host) {
        if (!host || typeof host !== 'object') return;
        dsl.hostRegistry = host;
        var macros = host.macros || [];
        for (var i = 0; i < macros.length; i++)
            registerMacro(macros[i]);
    }

    /**
     * 将 impl 的 run 函数包装为注册表标准签名 (ctx, node)。
     * 包装过程中把 node.kv 展平为参数对象 p，并把位置参数放入 p._args，
     * 使各 impl 文件无需感知 IR 节点结构。
     * @param {Function} run 原始实现函数 (ctx, p)
     * @returns {Function} 包装后的实现函数 (ctx, node)
     */
    function bindImplRun(run) {
        return function (ctx, node) {
            var p = {};
            Object.keys(node.kv || {}).forEach(function (k) { p[k] = node.kv[k]; });
            if (node.args && node.args.length) p._args = node.args.slice();
            return run(ctx, p);
        };
    }

    /**
     * 注册命令 schema（仅名称与别名，不含实现）。
     * 供 impl 文件通过 __shiori.reg.cmd 声明命令。
     * @param {{name: string, alias?: string|string[], aliases?: string|string[]}} manifest 命令声明
     * @returns {void}
     */
    function regCmd(manifest) {
        if (!manifest || isBlank(manifest.name)) return;
        var aliases = manifest.alias
            ? [].concat(manifest.alias)
            : (manifest.aliases ? [].concat(manifest.aliases) : []);
        registry.add({ name: manifest.name, aliases: aliases });
    }

    /**
     * 注册指令的运行时实现。
     * 供 impl 文件通过 __shiori.reg.impl 挂载执行函数。
     * @param {{cmd: string, run: Function}} spec 实现声明
     * @returns {void}
     */
    function regImpl(spec) {
        if (!spec || isBlank(spec.cmd) || typeof spec.run !== 'function') return;
        registry.impls[keyOf(spec.cmd)] = bindImplRun(spec.run);
    }

    /**
     * 为已存在的命令补充别名；命令不存在时以 name 为主名新建 schema。
     * @param {{name: string, alias: string}} spec 别名声明
     * @returns {void}
     */
    function regAlias(spec) {
        if (!spec || isBlank(spec.name) || isBlank(spec.alias)) return;
        var existing = registry.tryGet(spec.name);
        if (existing)
            registry.commands[keyOf(spec.alias)] = existing;
        else
            registry.add({ name: spec.name, aliases: [spec.alias] });
    }

    /**
     * .ks 脚本注册入口（占位实现）。
     * 说明：.ks 由 C# 层 MacroCatalog 在编译期装载，运行期登记为空操作。
     * @returns {void}
     */
    function regKs() {
        /* .ks 由 C# MacroCatalog 编译期装载，运行期登记为空操作 */
    }

    /* ===== 运行时初始化：创建注册表并载入内置命令/宏 ===== */
    var registry = new Registry();
    seedBuiltin(registry);

    var root = global;
    /* 若脚本被重复加载，保留上一次的宿主注册表与编译缓存引用 */
    var prevDsl = (typeof root.__shiori === 'object' && root.__shiori) ? root.__shiori.dsl : null;
    var prevHostRegistry = prevDsl && prevDsl.hostRegistry;
    var prevLastCompile = prevDsl && prevDsl.lastCompile;

    /* 供各 impl 文件使用的注册 API（cmd/impl/alias/ks） */
    var regApi = { cmd: regCmd, impl: regImpl, alias: regAlias, ks: regKs };

    /* 对外暴露的 DSL 门面对象，聚合编译、执行与注册相关方法 */
    var dsl = {
        version: SHIORI_DSL_VERSION,
        registry: registry,
        hostRegistry: prevHostRegistry,
        lastCompile: prevLastCompile,
        compile: function (field) { return compileField(registry, field); },
        compileOps: function (ops) { return compileOps(registry, ops); },
        splitInline: splitInline,
        lowerToAction: lowerToAction,
        executeDslNode: executeDslNode,
        registerAction: registerAction,
        registerMacro: registerMacro,
        ingestHostRegistry: ingestHostRegistry,
        reg: regApi
    };
    /* 重新吸收上一次的宿主注册表，保证热重载后宿主宏不丢失 */
    ingestHostRegistry(prevHostRegistry);

    /* 挂载到全局：__shiori.dsl / __shiori.reg / __reg 三个入口 */
    if (typeof root.__shiori !== 'object' || root.__shiori === null)
        root.__shiori = {};
    root.__shiori.dsl = dsl;
    root.__shiori.reg = regApi;
    root.__reg = regApi;
    /* 当全局对象与 window 不同（如 iframe/Worker 场景）时同步挂载到 window */
    if (typeof root.window === 'object' && root.window) {
        if (typeof root.window.__shiori !== 'object' || root.window.__shiori === null)
            root.window.__shiori = root.__shiori;
        else {
            root.window.__shiori.dsl = dsl;
            root.window.__shiori.reg = regApi;
        }
        root.window.__reg = regApi;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
