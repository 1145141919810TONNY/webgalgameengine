; 测试宏.ks
; 给剧本页 scene_dsl_macros.html 用的一组测试宏。
; 组合已落地指令：wait / msgoff / msgon / lock / free / fadeout / fadein / 发抖 /
; BGM / SE / Voice / background / 立绘 / off。
; 不写 cond、nowait、jump、双花括号，也不在宏体里写 wait click。
;
; 形参：百分号加名字，竖线后面是默认值。展开、默认值和循环检测都在 C# MacroExpander。
; 宏名不要和 COMMAND 或已有 MACRO 重名。
; 本文件分号开头的行是注释，不要在注释里写方括号标签。

; 1) 定时等待。不传 time 时默认 300 毫秒。
[macro name=测试-等]
[wait time=%time|300]
[endmacro]

; 2) 藏框一拍：先藏消息框，等一下，再显示。
[macro name=测试-藏框]
[msgoff]
[wait time=%time|400]
[msgon]
[endmacro]

; 3) 锁点一拍：锁定点击 → 定时等待 → 解锁。宏体禁止 wait click，所以这里必须带 time。
[macro name=测试-锁点]
[lock]
[wait time=%time|400]
[free]
[endmacro]

; 4) 黑场闪一下：淡出、等、淡入，共用同一个 time。
[macro name=测试-黑场]
[fadeout time=%time|400]
[wait time=%time|400]
[fadein time=%time|400]
[endmacro]

; 5) 嵌套发抖：再展开成 quake + wait。who 要在立绘已经上场的下一拍再调。
[macro name=测试-抖一下]
[发抖 who=%who level=%level|中 time=%time|500]
[endmacro]

; 6) 上场：新版立绘词面，角色方位服装表情。
[macro name=测试-上场]
[角色A 正面 服装1 表情101]
[endmacro]

; 7) BGM 播放。storage / vol / time 可覆盖。time 大于 0 时渐入，不是先等再播。
[macro name=测试-BGM]
[BGM play storage=%storage|bgm1.ogg vol=%vol|100% time=%time|0]
[endmacro]

; 7a) BGM 音量渐变测试：100% -> 20%。vol 用箭头语法（引擎 parseVol 原生支持），
;     time 同时是渐变时长。调用示例：@测试-BGM渐变  或  @测试-BGM渐变 vol=80%->10% time=2000
[macro name=测试-BGM渐变]
[BGM play storage=%storage|bgm1.ogg vol=%vol|100%->20% time=%time|1000]
[endmacro]

; 7b) BGM 音量渐升测试：20% -> 100%。与 7a 对称，可来回听到音量变化。
[macro name=测试-BGM渐升]
[BGM play storage=%storage|bgm1.ogg vol=%vol|20%->100% time=%time|1000]
[endmacro]

; 8) BGM 停止。time 大于 0 时渐出后停。
[macro name=测试-BGM停]
[BGM stop time=%time|0]
[endmacro]

; 9) 音效。格式与 BGM 相同，名字换成 SE。
[macro name=测试-SE]
[SE play storage=%storage|se1.ogg vol=%vol|100% time=%time|0]
[endmacro]

; 10) 语音。格式与 BGM 相同，名字换成 Voice。
[macro name=测试-Voice]
[Voice play storage=%storage|voice1.ogg vol=%vol|100% time=%time|0]
[endmacro]

; 11) 普通背景替换。不写 layer 时替换当前背景。
[macro name=测试-背景]
[background storage=%storage|bg_01_02.png]
[endmacro]

; 12) 时间更替：早午晚用现有三张背景循环，嵌套 wait。
[macro name=测试-三天后]
[background storage=bg_01_01.png]
[wait time=%time|400]
[background storage=bg_01_02.png]
[wait time=%time|400]
[background storage=bg_01_03.png]
[wait time=%time|400]
[background storage=bg_01_01.png]
[wait time=%time|400]
[background storage=bg_01_02.png]
[wait time=%time|400]
[background storage=bg_01_03.png]
[wait time=%time|400]
[background storage=bg_01_01.png]
[wait time=%time|400]
[background storage=bg_01_02.png]
[wait time=%time|400]
[background storage=bg_01_03.png]
[wait time=%time|400]
[endmacro]

; 13) 大图平移 + 缩放：先按固有尺寸叠一层，再动画到新位置、新透明度、新缩放，最后移除。
;     zoom=100% 是默认值。50% 表示缩到一半，150% 表示放大到 1.5 倍。
[macro name=测试-大图]
[background storage=picture1.png size=3840*2160 Ssize=1920*1080 layer=1 50% y=10% x=10% zoom=100%]
[background storage=picture1.png time=3000 90% y=50% x=50% zoom=50%]
[background storage=picture1.png time=3000 40% y=20% x=20% zoom=150%]
[background storage=picture1.png time=3000 100% y=0% x=20% zoom=100%]
[wait time=%time|1000]
[picture1.png off]
[endmacro]

; 14) 转场 2 秒：硬编码默认值示范。宏内把测试-黑场 的 time 默认值定成 2000，
;     调用方不传参就用 2 秒，传 time= 可覆盖。改默认值只动这一个宏文件。
[macro name=测试-转场2秒]
[测试-黑场 time=%time|2000]
[endmacro]

; 15) 淡出 3 秒：同上，fadeout 的 time 默认值改为 3000。
[macro name=测试-淡出3秒]
[fadeout time=%time|3000]
[endmacro]
