// 语言包的机器校验。CLAUDE.md 只允许有机器校验的消息目录：没人校验的第二份目录会漂成半翻译。
//
// 三条：
//   ① 对外源码（webview / 宿主 / 派生层 / MCP / core）里不许再有中文字面量——有就是漏翻；
//   ② 每个 t("…") 里的英文句子在中文表里都要有——有 key 没译文就是半翻译；
//   ③ 中文表里每一项都要在源码里出现过（作为字面量）——没人用的项是陈旧的。
// 注释里的中文不管：CLAUDE.md 说注释留中文。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["extension/webview/facts", "extension/src", "extension/mcp", "packages/facts-view/src", "packages/core/src"];
const EXT = new Set([".ts", ".tsx", ".mjs", ".js"]);
const CATALOG = "packages/facts-view/src/locales/zh-CN.json";
const zh = /[一-鿿]/;

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "locales") walk(full); continue; }
    if (EXT.has(path.extname(entry.name)) && !entry.name.endsWith(".d.mts") && !entry.name.endsWith(".d.ts")) files.push(full);
  }
};
for (const root of ROOTS) if (fs.existsSync(root)) walk(root);

// 去注释：// 到行尾（不在字符串里的粗略判断：行首或前面是空白/分号/大括号）和 /* */
const stripComments = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/(?<=[;{}\s])\/\/(?![^\n]*["'`]).*$/gm, "");

// 源码里的转义不一定是合法 JSON（比如 "\0"），解不开就按原样收
const unescape = (raw) => { try { return JSON.parse(`"${raw}"`); } catch { return raw; } };
const leftover = [];
const used = new Set();
const literalPool = new Set();
for (const file of files) {
  const code = stripComments(fs.readFileSync(file, "utf8"));
  code.split("\n").forEach((line, i) => { if (zh.test(line)) leftover.push(`${file.replace(/\\/g, "/")}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  for (const m of code.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) used.add(unescape(m[1]));
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) literalPool.add(unescape(m[1]));
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) literalPool.add(m[1]);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const missing = [...used].filter((key) => !Object.prototype.hasOwnProperty.call(catalog, key)).sort();
const stale = Object.keys(catalog).filter((key) => !literalPool.has(key)).sort();

assert.deepEqual(leftover, [], `对外源码里还有中文字面量（注释不算）：\n  ${leftover.join("\n  ")}`);
assert.deepEqual(missing, [], `t() 里的句子在 zh-CN.json 里没有译文：\n  ${missing.join("\n  ")}`);
assert.deepEqual(stale, [], `zh-CN.json 里有源码不再使用的项：\n  ${stale.join("\n  ")}`);
console.log(`i18n 守卫通过（${files.length} 个源文件 · ${used.size} 句经 t() · 中文表 ${Object.keys(catalog).length} 项）`);
