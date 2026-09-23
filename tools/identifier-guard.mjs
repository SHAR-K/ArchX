// 接口标识符必须是 ASCII。规则和理由见 CLAUDE.md 的「Hard rule: interface identifiers are
// never localized」：在中文 locale 下产出的事实必须和英文 locale 下的逐字段对得上，否则
// Agent 和下游工具无法对齐到同一个对象。这是正确性规则，所以守在 CI 里而不是靠记性。
//
// 守两样：
//   ① 所有对象的键名（有人把 architecture.json 的字段名翻译掉，事实就分叉了）
//   ② 标识符类的值——ID、种类、规则名、置信度这些是机器对齐用的枚举，不是给人读的文案
//
// 不守自由文本：warnings、documentation、condition、label 这些本来就该说人话，
// 引擎的中文警告是有意的。路径也不守——工程叫什么名字是用户的事，不是我们本地化的结果。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 值必须是 ASCII 的字段：ID 一律以 Id / id 结尾或就叫 id，其余是枚举值
const IDENTIFIER_FIELDS = new Set([
  "id", "kind", "unitKind", "relation", "scope", "storage", "rule", "confidence",
  "atomicity", "mode", "class", "section", "type", "reason", "basis", "match",
]);
const isIdentifierField = (key) =>
  IDENTIFIER_FIELDS.has(key) || /(^|[a-z])Id$/.test(key) || key.endsWith("Ids");
// 这些子树装的是给人读的解释（引擎的推导依据、备注、表达式原文），里面的 basis / kind 之类
// 是散文不是枚举——「scheduler_sleep(50) × 1 ms/ms」里那个 × 就是合法的
const PROSE_SUBTREES = new Set(["evidence", "note", "hint", "label", "text", "expression", "title", "summary", "documentation", "approximations"]);

const offenders = [];
const walk = (node, trail) => {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${trail}[${index}]`));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const here = trail ? `${trail}.${key}` : key;
    // 键名：无条件 ASCII
    if (!/^[\x20-\x7E]*$/.test(key)) offenders.push(`键名 ${here}`);
    if (typeof value === "string") {
      if (isIdentifierField(key) && !/^[\x20-\x7E]*$/.test(value)) offenders.push(`值 ${here}`);
    } else if (Array.isArray(value) && isIdentifierField(key)) {
      value.forEach((item, index) => {
        if (typeof item === "string" && !/^[\x20-\x7E]*$/.test(item)) offenders.push(`值 ${here}[${index}]`);
      });
    } else if (!PROSE_SUBTREES.has(key)) {
      walk(value, here);
    }
  }
};

const targets = [
  "corpus/blinky/facts/partition.json",
  "corpus/blinky/facts/view.json",
];
for (const target of targets) {
  const absolute = path.resolve(target);
  if (!fs.existsSync(absolute)) throw new Error(`守卫找不到 ${target}`);
  walk(JSON.parse(fs.readFileSync(absolute, "utf8")), "");
}

// 稳定 ID 的形状：种类前缀必须是已登记的那些，见 docs/STABLE_IDS.md
const KNOWN_KINDS = new Set([
  "function", "variable", "external", "main", "task", "isr", "callback", "timer",
  "unit", "ext", "lib", "exec", "fsm", "state", "loop", "res", "mem", "sym",
]);
const view = JSON.parse(fs.readFileSync(path.resolve("corpus/blinky/facts/view.json"), "utf8"));
const unknown = new Set();
for (const fn of view.functions ?? []) {
  const kind = String(fn.id).split(":")[0];
  if (!KNOWN_KINDS.has(kind)) unknown.add(kind);
}
for (const item of view.variables ?? []) {
  const kind = String(item.id).split(":")[0];
  if (!KNOWN_KINDS.has(kind)) unknown.add(kind);
}

assert.deepEqual(offenders, [], `非 ASCII 的接口标识符：\n  ${offenders.join("\n  ")}`);
assert.deepEqual([...unknown], [], `未登记的 ID 种类：${[...unknown].join(", ")}`);
console.log(`标识符守卫通过（${targets.length} 份事实，键名与标识符值全部 ASCII，ID 种类都已登记）`);
