// 对外文字的语言包。英文原句就是 key（`t("Reading…")`），中文包是一张英→中的映射表——
// 不发明几百个 key 名，英文包零成本，加一种语言就是加一张表。插值用 {name} 占位。
//
// 规矩见 CLAUDE.md：接口标识符（ID、kind、规则名、字段名）永不本地化，它们不走这里；
// 这里只管给人读的句子。tools/i18n-guard.mjs 做机器校验：源码里不许残留中文字面量，
// 每个 t() 的句子在中文表里都要有，中文表里不许有没人用的项。
//
// 语言在哪定：宿主用 vscode.env.language，webview 从 body[data-lang] 读，MCP 固定英文。
// 派生层的句子在宿主里算，所以宿主要在派生之前 setLocale。

import zhCN from "./locales/zh-CN.json" with { type: "json" };

const catalogs = { "zh-CN": zhCN };
let current = "en";

/** "zh-cn" / "zh-CN" / "zh-hans" 都算简体中文；其余一律英文 */
export function normalizeLocale(language) {
  const lower = String(language ?? "").toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  return "en";
}

export function setLocale(language) {
  current = normalizeLocale(language);
  return current;
}

export function getLocale() {
  return current;
}

/** 浏览器里按 body[data-lang] 自动定；没有就是英文 */
if (typeof document !== "undefined" && document.body?.dataset?.lang) setLocale(document.body.dataset.lang);

export function t(text, vars) {
  const table = catalogs[current];
  let out = table && Object.prototype.hasOwnProperty.call(table, text) ? table[text] : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
  return out;
}
