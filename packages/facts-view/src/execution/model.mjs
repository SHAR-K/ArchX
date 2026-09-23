// 执行关系主题的派生层：从哪里开始，什么会被触达。
//
// 入口、执行单元、可达性、执行域都是引擎给的事实，投影层已经整理好；这一层做的是把它们
// 串成一棵能走的树，并给每条边配上证据。
//
// 树上的边有四种，全部来自事实，没有一条靠名字猜：
//   call      普通调用
//   register  注册（引擎给的 registeredAt，取函数地址装进系统的那一行）
//   irq       中断使能（引擎给的 enabledAt，指向中断本身）
//   schedule  调度器轮询任务。这一跳是推导：框架规则说 protothreads 的任务由 thread_run 轮询，
//             代码里没有从 thread_run 到任务体的调用边，但任务确实是在那里跑起来的。界面必须标出「推导」。
//
// 跨模块调用是否绕过头文件也在这里判：沿 include 边走三跳，看得见被调方所在模块就算没绕过。

import { t } from "../i18n.mjs";
import { buildIndex } from "../graph.mjs";

const SCHEDULER_BY_RULE = { "protothreads.thread_create": "thread_run" };

export function buildExecution(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const entries = index.entries ?? {};
  if (!entries.units) {
    return { theme: "execution", available: false, reason: "no-entries", hint: t("The facts have no execution units; a schema 2 or newer scan is required."), roots: [] };
  }

  const nameOf = (id) => index.nameOf(id);
  const regById = new Map((entries.registrations ?? []).map((r) => [r.id, r]));
  const schedulerNames = new Set((entries.registrations ?? []).map((r) => SCHEDULER_BY_RULE[r.rule]).filter(Boolean));

  const roots = [];
  if (entries.main) roots.push({ id: `exec:${entries.main}`, symbol: entries.main, kind: "main", name: nameOf(entries.main), file: index.fileOf(entries.main) });
  // 内核异常（SysTick、PendSV 这些，向量号为负）也是中断，而且时基常常就来自它，
  // 所以照样是根，只是标出来，不像外设中断那样需要 NVIC 使能
  for (const isr of entries.isrs ?? []) {
    roots.push({ id: `exec:${isr.id}`, symbol: isr.id, kind: "isr", name: nameOf(isr.id), file: index.fileOf(isr.id), vector: isr.vector ?? null, kernel: Boolean(isr.kernel), enabledAt: isr.enabledAt ?? [] });
  }
  for (const reg of entries.registrations ?? []) {
    roots.push({ id: `exec:${reg.id}`, symbol: reg.id, kind: reg.kind, name: nameOf(reg.id), file: index.fileOf(reg.id), rule: reg.rule ?? null, registrars: reg.registrars ?? [] });
  }

  const reachCount = (id) => Math.max(0, index.reachOf(id).size - 1);
  for (const root of roots) root.reaches = reachCount(root.symbol);

  return {
    theme: "execution",
    available: true,
    basis: t("Entries, execution units and reachability come from the engine; the scheduling hop is inferred from framework rules and marked as such"),
    roots,
    counts: entries.counts ?? null,
    unreached: (entries.unreached ?? []).map((id) => ({ id, name: nameOf(id), file: index.fileOf(id) })),
    duplicates: entries.duplicates ?? [],
    externDeclarations: entries.externDeclarations ?? [],
    schedulerNames: [...schedulerNames],
    hasScheduleHop: schedulerNames.size > 0,
    regRules: Object.fromEntries([...regById].map(([id, r]) => [id, r.rule ?? null])),
    compare: compareMatrix(view, { index }),
  };
}

/** 中断 × 任务的共用函数数。全空的行列不画（席克定律），只在注脚说藏了多少。 */
export function compareMatrix(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const entries = index.entries ?? {};
  const nameOf = (id) => index.nameOf(id);
  const isrs = (entries.isrs ?? []).map((i) => i.id);
  const others = [entries.main, ...(entries.registrations ?? []).map((r) => r.id)].filter(Boolean);
  const inRegion = (id) => index.inRegion(index.fileOf(id) ?? "");
  const count = (a, b) => {
    const ra = index.reachOf(a), rb = index.reachOf(b);
    let n = 0;
    for (const id of ra) if (rb.has(id) && inRegion(id)) n += 1;
    return n;
  };
  const cells = {};
  for (const a of isrs) { cells[a] = {}; for (const b of others) cells[a][b] = count(a, b); }
  const rows = isrs.filter((a) => others.some((b) => cells[a][b] > 0));
  const cols = others.filter((b) => isrs.some((a) => cells[a][b] > 0));
  const kindOf = (id) => id === entries.main ? "main" : ((entries.registrations ?? []).find((r) => r.id === id)?.kind ?? "task");
  return {
    rows: rows.map((id) => ({ id, name: nameOf(id) })),
    cols: cols.map((id) => ({ id, name: nameOf(id), kind: kindOf(id) })),
    cells: Object.fromEntries(rows.map((a) => [a, Object.fromEntries(cols.map((b) => [b, cells[a][b]]))])),
    hiddenIsrs: isrs.length - rows.length,
    hiddenOthers: others.length - cols.length,
    // 变量级交叠可能在函数级为零时仍然存在，所以任意一对都允许选
    allIsrs: isrs.map((id) => ({ id, name: nameOf(id) })),
    allOthers: others.map((id) => ({ id, name: nameOf(id), kind: kindOf(id) })),
  };
}

/** 一个节点在树上的孩子。区域外的函数默认不展开，但调度器和闭源库符号是边界，始终保留。 */
export function treeChildren(index, id, options = {}) {
  const showLibrary = options.showLibrary ?? false;
  const showScheduling = options.showScheduling ?? true;
  const entries = index.entries ?? {};
  const regById = new Map((entries.registrations ?? []).map((r) => [r.id, r]));
  const schedulerNames = new Set((entries.registrations ?? []).map((r) => SCHEDULER_BY_RULE[r.rule]).filter(Boolean));
  const irqPairs = options.irqPairs ?? new Map();

  const kids = [...(index.calleesOf.get(id) ?? []), ...(irqPairs.get(id) ?? [])]
    .slice()
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
    .flatMap((c) => {
      if (c.kind === "irq") return [{ kind: "irq", target: c.t, line: c.line ?? null }];
      const target = index.fnById.get(c.t);
      const keep = index.inRegion(target?.file ?? "") || showLibrary || target?.external || (showScheduling && schedulerNames.has(index.nameOf(c.t)));
      if (!keep) return [];
      return [{ kind: c.kind === "register" ? "register" : "call", target: c.t, line: c.line ?? null }];
    });

  const deduped = new Map();
  for (const k of kids) { const key = `${k.kind}:${k.target}`; if (!deduped.has(key)) deduped.set(key, k); }
  const list = [...deduped.values()];

  // 调度那一跳：代码里没有这条边，是框架规则推出来的，标 derived
  if (showScheduling && schedulerNames.has(index.nameOf(id))) {
    for (const reg of entries.registrations ?? []) {
      if (reg.kind === "task" && SCHEDULER_BY_RULE[reg.rule] === index.nameOf(id)) {
        list.push({ kind: "schedule", target: reg.id, line: null, derived: true });
      }
    }
  }
  return list;
}

/** include 可达：沿 include 边走几跳能不能看见目标文件所在的模块。 */
function includeReaches(index, fromFile, toFile, depth = 3) {
  const includesOf = index.includesOf ?? new Map();
  const toModule = index.fileById.get(toFile)?.module;
  const toStem = String(toFile).split("/").pop().replace(/\.(c|h)$/, "");
  const seen = new Set([fromFile]);
  let frontier = [fromFile];
  for (let i = 0; i < depth && frontier.length; i += 1) {
    const next = [];
    for (const f of frontier) {
      for (const h of includesOf.get(f) ?? []) {
        if (seen.has(h)) continue;
        seen.add(h);
        const stem = String(h).split("/").pop().replace(/\.(c|h)$/, "");
        if (stem === toStem || (toModule && index.fileById.get(h)?.module === toModule)) return true;
        next.push(h);
      }
    }
    frontier = next;
  }
  return false;
}

/** 一条边的证据：调用点在哪几行、跨不跨模块、有没有绕过头文件。 */
export function callEdgeEvidence(view, fromId, toId, options = {}) {
  const index = options.index ?? buildIndex(view);
  if (!index.includesOf) {
    index.includesOf = new Map();
    for (const e of view.includeEdges ?? []) index.includesOf.set(e.s, (index.includesOf.get(e.s) ?? new Set()).add(e.t));
  }
  const from = index.fnById.get(fromId);
  const to = index.fnById.get(toId);
  if (!from || !to) return null;
  const sites = (view.callPairs ?? []).filter((c) => c.s === fromId && c.t === toId).map((c) => c.line).filter(Boolean).sort((a, b) => a - b);
  const fromModule = index.fileById.get(from.file)?.module ?? null;
  const toModule = index.fileById.get(to.file)?.module ?? null;
  const cross = Boolean(fromModule && toModule && fromModule !== toModule);
  return {
    from: { id: fromId, name: from.name, file: from.file, line: from.line, module: fromModule },
    to: { id: toId, name: to.name, file: to.file, line: to.line, module: toModule, external: Boolean(to.external) },
    sites,
    cross,
    // 有调用却看不见被调方的头文件：契约绕过。只有跨模块时才有意义
    bypassesHeader: cross && !to.external && !includeReaches(index, from.file, to.file),
  };
}

/** 两个入口各自可达的函数与变量的交集：两条执行路径在哪里碰头。 */
export function compareRoots(view, aId, bId, options = {}) {
  const index = options.index ?? buildIndex(view);
  const reachA = index.reachOf(aId);
  const reachB = index.reachOf(bId);
  const shared = [...reachA].filter((id) => reachB.has(id) && index.inRegion(index.fileOf(id) ?? ""));
  const varsOf = (ids) => {
    const m = new Map();
    for (const r of view.referencePairs ?? []) if (ids.has(r.s)) m.set(r.t, new Set([...(m.get(r.t) ?? []), r.s]));
    return m;
  };
  const va = varsOf(reachA);
  const vb = varsOf(reachB);
  const sharedVars = [...va.keys()].filter((id) => vb.has(id)).map((id) => ({
    id,
    ...index.varAt(id),
    aFunctions: [...(va.get(id) ?? [])].length,
    bFunctions: [...(vb.get(id) ?? [])].length,
  }));
  return {
    a: { id: aId, name: index.nameOf(aId), reaches: reachA.size - 1 },
    b: { id: bId, name: index.nameOf(bId), reaches: reachB.size - 1 },
    sharedFunctions: shared.map((id) => ({ id, name: index.nameOf(id), file: index.fileOf(id) })),
    sharedVariables: sharedVars.sort((x, y) => y.aFunctions + y.bFunctions - (x.aFunctions + x.bFunctions)),
  };
}

/** 按名字找区域内的函数，子串匹配，最多 limit 个。搜索本身很轻，webview 也能做；放在这里是给 MCP 用同一份。 */
export function findFunctions(view, query, options = {}) {
  const index = options.index ?? buildIndex(view);
  const q = String(query ?? "").trim();
  if (!q) return [];
  const limit = options.limit ?? 12;
  return view.functions
    .filter((fn) => fn.name.includes(q) && !fn.external && index.inRegion(fn.file ?? ""))
    .slice(0, limit)
    .map((fn) => ({ id: fn.id, name: fn.name, file: fn.file, line: fn.line }));
}

/**
 * 一个函数「从哪里能跑到」：对每个能到达它的入口，给出入口到它的最短调用链。
 * 原型只找第一个碰到的入口；这里把全部入口都列出来，因为「一个函数被中断和任务同时能到」
 * 正是并发审查要看的东西。链上每一跳标出是调用、注册（函数指针）还是中断触发。
 */
export function functionEntry(view, id, options = {}) {
  const index = options.index ?? buildIndex(view);
  const fn = index.fnById.get(id);
  if (!fn) return null;
  const entries = index.entries ?? {};
  const isrIds = new Set((entries.isrs ?? []).map((i) => i.id));
  const regKind = new Map((entries.registrations ?? []).map((r) => [r.id, r.kind]));
  const roots = [entries.main, ...(entries.isrs ?? []).map((i) => i.id), ...(entries.registrations ?? []).map((r) => r.id)].filter(Boolean);
  const kindOf = (x) => (x === entries.main ? "main" : isrIds.has(x) ? "isr" : regKind.get(x) ?? null);
  const registerTargets = new Set((view.registerPairs ?? []).map((p) => `${p.s}>${p.t}`));
  const hopKind = (from, to) => (isrIds.has(from) ? t("interrupt fires") : registerTargets.has(`${from}>${to}`) ? t("registration (function pointer)") : t("call"));

  const chains = [];
  for (const root of roots) {
    if (root === id) continue;
    if (!index.reachOf(root).has(id)) continue;
    // 从入口沿 calleesOf 做最短路，比从目标往上找更直观：链就是「入口 → … → 它」
    const prev = new Map([[root, null]]);
    const queue = [root];
    while (queue.length && !prev.has(id)) {
      const current = queue.shift();
      for (const c of index.calleesOf.get(current) ?? []) if (!prev.has(c.t)) { prev.set(c.t, current); queue.push(c.t); }
    }
    if (!prev.has(id)) continue;
    const path = [];
    for (let cur = id; cur != null; cur = prev.get(cur)) path.unshift(cur);
    chains.push({
      root: { id: root, name: index.nameOf(root), kind: kindOf(root) },
      path: path.map((x, i) => ({ id: x, name: index.nameOf(x), file: index.fileOf(x), hop: i === 0 ? null : hopKind(path[i - 1], x) })),
    });
  }
  const below = index.reachOf(id);
  const direct = (index.calleesOf.get(id) ?? []).filter((c) => index.inRegion(index.fileOf(c.t) ?? "")).map((c) => ({ id: c.t, name: index.nameOf(c.t) }));
  return {
    id,
    name: fn.name,
    file: fn.file,
    line: fn.line,
    kind: kindOf(id),
    chains,
    reaches: Math.max(0, below.size - 1),
    direct: [...new Map(direct.map((d) => [d.id, d])).values()],
    unreached: chains.length === 0 && kindOf(id) == null,
  };
}
