# 页签源码（懒拆）

一个页签一个 `NN-<tab>.js`，样式放同名 `NN-<tab>.css`。`facts-preview.mjs` 按**文件名顺序**把
`.css` 拼进模板的 `/* parts:css */`、`.js` 拼进 `// parts:js`，仍然只产出一个 HTML。

为什么是拼接而不是 ES module：预览是 `file://` 直接打开的，模块 import 会被 CORS 拒。拼接后
所有片和模板同一个 IIFE 作用域，共享的 `F` / `A` / `E` 与 `esc` / `fname` / `codeHref` 等 helper
一行都不用改；片里的 `const` 在槽位处求值（在引导语句之前），函数声明照常提升。

拆的动机是防事故：样式和它的代码放在一起，就不会再出现"改一个页签的 CSS 块，把另一个页签的
规则一起删掉"（`.beat-fire` 与 `.beat-h3` 各被误删过一次）。**下次改哪个页签，就把那个页签搬出来**。
