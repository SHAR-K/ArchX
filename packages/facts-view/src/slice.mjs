// 按需切片：Agent 的上下文有限，几 MB 的事实不能整吞。
//
// 这一层不产生任何新结论，只决定「这次给多少」。派生结果是什么样，切出来就是什么样，
// 键名、稳定 ID、置信度全部原样——一改写就等于给了 Agent 一份和面板不一致的东西。
//
// 三条规矩：
//   宁可拒绝，不要截断。超出上限就说清楚有多大、该怎么往下走，绝不悄悄少给几条——
//   Agent 没法分辨「就这些」和「给你看了一部分」，而这个区别会直接变成错误结论。
//   数组一律带 total，所以「还有多少没看」永远是明的。
//   路径冗余可以去，信息不能去：切片按文件划的时候，路径在切片头上说一次就够。

import { t } from "./i18n.mjs";

const DEFAULT_LIMIT = 50;
const MAX_BYTES = 60_000;

/** 主题里各回答什么问题。列清单时给 Agent 看，省得它逐个试 */
export const THEME_QUESTIONS = {
  execution: "Where execution starts and what it reaches",
  dependencies: "Who depends on whom, and on what exactly",
  timing: "Ordering, wait points and periods",
  concurrency: "Which execution units touch the same resource",
  stateTransitions: "How state changes and where the conditions are",
  memory: "Where the space goes, based on which artifact",
};

/** 沿路径取值。`loops`、`loops.3`、`resources.2.units` 都行；取不到返回哨兵 */
const NOT_FOUND = Symbol("not-found");

export function atPath(value, fieldPath) {
  if (!fieldPath) return value;
  let current = value;
  for (const segment of String(fieldPath).split(".")) {
    if (current == null) return NOT_FOUND;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return NOT_FOUND;
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== "object" || !(segment in current)) return NOT_FOUND;
    current = current[segment];
  }
  return current;
}

/** 一个值有多大。用序列化后的字节数，因为那才是真正要过 Agent 上下文的东西 */
export function sizeOf(value) {
  try { return JSON.stringify(value)?.length ?? 0; } catch { return Infinity; }
}

/** 对象顶层每个键各多大，用来告诉 Agent「往哪个键里钻」 */
function shapeOf(value) {
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  if (value && typeof value === "object") {
    return {
      kind: "object",
      fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        Array.isArray(item) ? t("array · {n} items · {bytes} bytes", { n: item.length, bytes: sizeOf(item) })
          : item && typeof item === "object" ? t("object · {n} keys · {bytes} bytes", { n: Object.keys(item).length, bytes: sizeOf(item) })
            : t("{type} · {bytes} bytes", { type: typeof item, bytes: sizeOf(item) }),
      ])),
    };
  }
  return { kind: typeof value };
}

/**
 * 从一份派生结果里切一块。
 * 数组按 offset/limit 分页并带 total；其他值整块给，太大就拒绝并说清楚怎么往下走。
 */
export function slice(themeName, theme, options = {}) {
  const fieldPath = options.path ?? "";
  const value = atPath(theme, fieldPath);
  if (value === NOT_FOUND) {
    const parent = atPath(theme, fieldPath.split(".").slice(0, -1).join("."));
    return {
      theme: themeName,
      path: fieldPath,
      error: t("This theme has no field {path}", { path: fieldPath }),
      available: parent === NOT_FOUND ? Object.keys(theme ?? {}) : shapeOf(parent),
    };
  }

  if (Array.isArray(value)) {
    const offset = Math.max(0, Number(options.offset ?? 0));
    const limit = Math.max(1, Math.min(Number(options.limit ?? DEFAULT_LIMIT), 500));
    const items = value.slice(offset, offset + limit);
    const bytes = sizeOf(items);
    if (bytes > MAX_BYTES && items.length > 1) {
      // 这一页本身就超了：不截断，退回去让它减小 limit，并说明单条多大
      const perItem = Math.ceil(bytes / items.length);
      return {
        theme: themeName, path: fieldPath, total: value.length, offset,
        error: t("These {n} items take {bytes} bytes, over the per-call limit of {max}", { n: items.length, bytes, max: MAX_BYTES }),
        hint: t("About {perItem} bytes each; keep limit within {limit}, or use path to drill into just the fields you need", { perItem, limit: Math.max(1, Math.floor(MAX_BYTES / perItem)) }),
      };
    }
    return {
      theme: themeName, path: fieldPath,
      total: value.length, offset, count: items.length,
      more: offset + items.length < value.length ? { offset: offset + items.length, remaining: value.length - offset - items.length } : null,
      items,
    };
  }

  const bytes = sizeOf(value);
  if (bytes > MAX_BYTES) {
    return {
      theme: themeName, path: fieldPath, bytes,
      error: t("This block is {bytes} bytes, over the per-call limit of {max}", { bytes, max: MAX_BYTES }),
      hint: t("Point path at a field below; array fields take offset / limit for paging"),
      shape: shapeOf(value),
    };
  }
  return { theme: themeName, path: fieldPath, bytes, value };
}

/** 派生结果里所有带稳定 ID 的对象：ID -> {主题, 路径, 对象} */
export function indexById(themes) {
  const found = new Map();
  const walk = (value, themeName, trail) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, themeName, `${trail}.${i}`));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.id === "string" && value.id.includes(":") && !found.has(value.id)) {
      found.set(value.id, { theme: themeName, path: trail.replace(/^\./, ""), object: value });
    }
    for (const [key, item] of Object.entries(value)) {
      if (item && typeof item === "object") walk(item, themeName, `${trail}.${key}`);
    }
  };
  for (const [themeName, theme] of Object.entries(themes)) walk(theme, themeName, "");
  return found;
}

/** 各主题一句话概览：有没有数据、答什么问题、里面有哪些字段能往下钻 */
export function overview(themes) {
  return Object.entries(themes).map(([name, theme]) => ({
    theme: name,
    question: THEME_QUESTIONS[name] ? t(THEME_QUESTIONS[name]) : null,
    available: Boolean(theme?.available),
    reason: theme?.available ? null : theme?.reason ?? null,
    hint: theme?.available ? null : theme?.hint ?? null,
    bytes: sizeOf(theme),
    fields: theme && typeof theme === "object"
      ? Object.fromEntries(Object.entries(theme)
        .filter(([, item]) => Array.isArray(item) || (item && typeof item === "object"))
        .map(([key, item]) => [key, Array.isArray(item) ? t("array · {n} items", { n: item.length }) : t("object · {n} keys", { n: Object.keys(item).length })]))
      : {},
  }));
}
