// 依赖主题的派生层：一张分层 DSM。行 = 依赖方，列 = 被依赖方。
//
// 叶子是「单元」：源文件 + 同目录同主名的头（引擎 dependencyOrder.units）。include 边永远指向头文件，
// 调用边永远指向定义被调函数的源文件，拆开看时 `A.c → B.h` 与 `A.c → B.c` 是两个格子，
// 而 `A.c include B.h` + `B.c include A.h` 在文件图上根本不成环——合成单元之后这些才对得上。
//
// 行是分组树上的可见节点：展开的组显示子项（连续成块），没展开的组折成一行，格子是聚合值。
// 分组树可选目录（人画的框）或聚簇（引擎从边算出来的组）。折叠而不是过滤：范围外的组也在表里，
// 所以任何一条边都不会因为看不见而消失。
//
// 排序是嵌套的：组之间按聚合边排，块内部按子项之间的边排，同一套源/汇剥离 + 撕开算法；
// 同时算一遍打平排序，两者反向边数的差就是这棵分组树的代价。
//
// 这一层不产坐标也不产 DOM。声明（人的假设）从外面传进来，不在这里读写存储。

import { t } from "../i18n.mjs";
import { buildIndex } from "../graph.mjs";

export const ROOT = "";

export const EMPTY_DECLARATIONS = { top: [], bottom: [], regroup: {}, invert: [], names: {} };

export const edgeWeight = (e) =>
  (e.includes ?? 0) + (e.calls ?? 0) + (e.types ?? 0) + (e.macros ?? 0) + (e.reads ?? 0) + (e.writes ?? 0);

const parentDir = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

// ---- 分区算法：与引擎 dependency_order.sequence 同一套 -------------------------------

// edgeList：[a, b, 权重?]。撕开时先比出度−入度，平了再比出权−入权，再平按名字。
// 光看条数分不出轻重：被几百次调用的和只被点了一下的一样重，字母序就会把错的那个撕到最上面。
export function depSequence(nodes, edgeList) {
  const out = new Map(nodes.map((n) => [n, new Set()]));
  const inn = new Map(nodes.map((n) => [n, new Set()]));
  const wt = new Map();
  for (const [a, b, w] of edgeList) {
    if (a === b || !out.has(a) || !out.has(b)) continue;
    out.get(a).add(b);
    inn.get(b).add(a);
    wt.set(`${a}→${b}`, (wt.get(`${a}→${b}`) ?? 0) + (w ?? 1));
  }
  const remaining = new Set(nodes);
  const head = [];
  const tail = [];
  const steps = [];
  const live = (set) => [...set].filter((x) => remaining.has(x)).length;
  const liveW = (n) =>
    [...out.get(n)].filter((x) => remaining.has(x)).reduce((acc, x) => acc + (wt.get(`${n}→${x}`) ?? 1), 0)
    - [...inn.get(n)].filter((x) => remaining.has(x)).reduce((acc, x) => acc + (wt.get(`${x}→${n}`) ?? 1), 0);
  while (remaining.size) {
    let progressed = true;
    while (progressed && remaining.size) {
      progressed = false;
      for (const n of [...remaining].filter((x) => !live(out.get(x))).sort()) { tail.push(n); remaining.delete(n); steps.push({ kind: "sink", node: n, out: 0, in: live(inn.get(n)) }); progressed = true; }
      for (const n of [...remaining].filter((x) => !live(inn.get(x))).sort()) { head.push(n); remaining.delete(n); steps.push({ kind: "source", node: n, out: live(out.get(n)), in: 0 }); progressed = true; }
    }
    if (remaining.size) {
      const score = (n) => [live(out.get(n)) - live(inn.get(n)), liveW(n)];
      const pick = [...remaining].sort().reduce((best, n) => {
        if (best == null) return n;
        const a = score(n); const b = score(best);
        return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? n : best;
      }, null);
      remaining.delete(pick);
      head.push(pick);
      steps.push({ kind: "tear", node: pick, out: live(out.get(pick)), in: live(inn.get(pick)), weight: liveW(pick), block: remaining.size + 1 });
    }
  }
  const order = [...head, ...tail.slice().reverse()];
  const pos = new Map(order.map((n, i) => [n, i]));
  const feedback = new Set();
  for (const [a, set] of out) for (const b of set) if (pos.get(b) < pos.get(a)) feedback.add(`${a}→${b}`);
  const level = new Map();
  for (const n of order.slice().reverse()) {
    let best = -1;
    for (const b of out.get(n)) if (!feedback.has(`${n}→${b}`) && level.has(b)) best = Math.max(best, level.get(b));
    level.set(n, best + 1);
  }
  return { order, steps, feedback, level };
}

// 回放到第 k 步时的行列顺序：已放顶部的 / 还没排的（保持字母序）/ 已放底部的
export function depOrderAtStep(nodes, steps, k) {
  const head = [];
  const tail = [];
  const placed = new Set();
  for (const s of steps.slice(0, k)) { placed.add(s.node); (s.kind === "sink" ? tail : head).push(s.node); }
  const rest = nodes.filter((n) => !placed.has(n)).sort();
  return { order: [...head, ...rest, ...tail.slice().reverse()], pending: new Set(rest) };
}

// 把 (s,t) 映射到 (ms,mt)，同一对相加，记住造成它的文件对
export function aggregateEdges(edges, mapS, mapT) {
  const out = new Map();
  for (const e of edges) {
    const s = mapS(e.s ?? e.source);
    const t = (mapT ?? mapS)(e.t ?? e.target);
    if (!s || !t || s === t) continue;
    const id = `${s}→${t}`;
    const rec = out.get(id) ?? { id, s, t, includes: 0, calls: 0, bypass: 0, typeOnly: 0, types: 0, macros: 0, reads: 0, writes: 0, pairs: [], files: {} };
    rec.includes += e.includes ?? 0;
    rec.calls += e.calls ?? 0;
    rec.bypass += e.bypass ?? e.bypassCalls ?? 0;
    rec.typeOnly += e.typeOnly ?? e.typeOnlyIncludes ?? 0;
    rec.types += e.types ?? 0;
    rec.macros += e.macros ?? 0;
    rec.reads += e.reads ?? 0;
    rec.writes += e.writes ?? 0;
    if (e.pairs) {
      rec.pairs.push(...e.pairs);
      for (const [k, v] of Object.entries(e.files ?? {})) rec.files[k] = (rec.files[k] ?? 0) + v;
    } else {
      rec.pairs.push({ s: e.source, t: e.target });
      const k = `${e.source}→${e.target}`;
      rec.files[k] = (rec.files[k] ?? 0) + ((e.includes ?? 0) + (e.calls ?? 0) || 1);
    }
    out.set(id, rec);
  }
  return [...out.values()];
}

// ---- 主题：叶子、边、聚簇 --------------------------------------------------------------

export function buildDependencies(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const order = view.dependencyOrder ?? null;
  if (!order?.files) {
    return { theme: "dependencies", available: false, reason: "no-dependency-order", hint: t("The facts have no dependencyOrder; rescan with a newer engine."), leaves: [], edges: [] };
  }
  const units = order.units ?? null;
  const unitOf = (f) => units?.unitOf?.[f] ?? f;
  const membersOf = (u) => units?.members?.[u] ?? [u];

  const regionFiles = view.files.filter((f) => f.path.startsWith(view.region) && !f.path.startsWith("lib:"));
  const fileEdges = (order.files.edges ?? []).filter((e) => !String(e.source).startsWith("lib:") && !String(e.target).startsWith("lib:"));

  const leafSet = new Set(regionFiles.map((f) => unitOf(f.path)));
  for (const e of fileEdges) { leafSet.add(unitOf(e.source)); leafSet.add(unitOf(e.target)); }
  const leafEdges = aggregateEdges(fileEdges, unitOf);

  const leaves = [...leafSet].map((u) => {
    const members = membersOf(u);
    const source = members.find((f) => /\.c(c|pp|xx)?$/i.test(f)) ?? members[0];
    const suffixes = members.map((f) => f.split(".").pop()).sort((a, b) => (a.startsWith("c") ? -1 : 1) - (b.startsWith("c") ? -1 : 1));
    return {
      id: `unit:${u}`,
      unit: u,
      members,
      // led.c/h：两个文件合成一个单元时，名字把后缀并起来，一眼看出它包含什么
      label: members.length === 1 ? members[0].split("/").pop() : `${u.split("/").pop()}.${suffixes.join("/")}`,
      file: source,
      dir: parentDir(u),
      module: index.fileById.get(source)?.module ?? null,
    };
  });

  const clusters = order.clusters ?? null;
  return {
    theme: "dependencies",
    available: true,
    basis: t("Leaves are units: a source file plus the same-named header in its directory. All eight quantities on an edge come from the engine; row and column order is computed by peeling sources and sinks then tearing, with no declared layers"),
    region: view.region,
    leaves,
    edges: leafEdges,
    // 引擎自己在全工程单元图上算过一遍，用来和当前视图的分块排序对照
    projectFeedback: (order.units?.feedback ?? order.files.feedback ?? []).length,
    fileFeedback: (order.files.feedback ?? []).length,
    fileEdgeCount: fileEdges.length,
    regionFileCount: regionFiles.length,
    pairedUnits: units ? Object.values(units.members).filter((m) => m.length > 1).length : 0,
    clusters: clusters ? { of: Object.fromEntries(clusters.clusters.flatMap((members, i) => members.map((f) => [f, i]))), stability: clusters.stability ?? {}, params: clusters.params ?? null, count: clusters.clusters.length, cost: clusters.cost ?? null, initialCost: clusters.initialCost ?? null, iterations: clusters.iterations ?? 0 } : null,
    counts: {
      contractBypass: (view.contractBypass ?? []).length,
      typeOnlyIncludes: (view.typeOnlyIncludes ?? []).length,
      crossFileTypeUses: (view.typeUses ?? []).filter((u) => u.def && index.fnById.get(u.fn)?.file && index.fnById.get(u.fn).file !== u.def.path).length,
      crossFileMacroUses: (view.macroUses ?? []).filter((u) => u.def && u.def.path !== u.file).length,
    },
  };
}

// ---- 分组树 ---------------------------------------------------------------------------

// 目录树。分区目录到根那一串永远展开，所以直接提升：它们的子项挂在根下，不占缩进。
export function dirTree(theme, declarations = EMPTY_DECLARATIONS, moduleDirOf = () => null) {
  const regionDir = String(theme.region ?? "").replace(/\/$/, "");
  const byUnit = new Map(theme.leaves.map((l) => [l.unit, l]));
  const leafDir = (unit) => {
    const leaf = byUnit.get(unit);
    for (const f of leaf?.members ?? [unit]) {
      const declared = declarations.regroup?.[f];
      const dir = declared ? moduleDirOf(declared) : null;
      if (dir) return dir;
    }
    return parentDir(unit);
  };
  const children = new Map([[ROOT, new Set()]]);
  const parent = new Map();
  const groups = new Set([ROOT]);
  const add = (g, c) => { if (!children.has(g)) children.set(g, new Set()); children.get(g).add(c); parent.set(c, g); };
  const hoisted = new Set();
  { let d = regionDir; while (d) { hoisted.add(d); d = parentDir(d); } }
  const up = (d) => (hoisted.has(d) ? ROOT : d);
  for (const leaf of theme.leaves) {
    let d = up(leafDir(leaf.unit));
    add(d, leaf.unit);
    while (d !== ROOT) { groups.add(d); const p = up(parentDir(d)); add(p, d); d = p; }
  }
  const label = (g) => (g === ROOT ? "" : `${g.startsWith(`${regionDir}/`) ? g.slice(regionDir.length + 1) : g}/`);
  return {
    kind: "dir",
    groups,
    children: (g) => [...(children.get(g) ?? [])].sort(),
    parent: (id) => parent.get(id) ?? null,
    isGroup: (id) => groups.has(id),
    label,
    shortLabel: (g) => `${label(g).replace(/\/$/, "").split("/").pop()}/`,
    defaultOpen: () => new Set([ROOT]),
    allOpen: () => new Set([ROOT, ...[...groups].filter((g) => g.startsWith(`${regionDir}/`))]),
  };
}

// 聚簇树。簇是启发式搜索的结果，不是事实；簇号是按大小排的下标，重扫会变，界面上要说清楚。
export function clusterTree(theme, declarations = EMPTY_DECLARATIONS) {
  const of = theme.clusters?.of ?? {};
  const clusterOf = (unit) => {
    const leaf = theme.leaves.find((l) => l.unit === unit);
    const votes = new Map();
    for (const f of leaf?.members ?? [unit]) if (of[f] != null) votes.set(of[f], (votes.get(of[f]) ?? 0) + 1);
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? `cl:${top[0]}` : "cl:none";
  };
  const children = new Map([[ROOT, new Set()]]);
  const parent = new Map();
  const groups = new Set([ROOT]);
  for (const leaf of theme.leaves) {
    const g = clusterOf(leaf.unit);
    groups.add(g);
    if (!children.has(g)) children.set(g, new Set());
    children.get(g).add(leaf.unit);
    parent.set(leaf.unit, g);
    children.get(ROOT).add(g);
    parent.set(g, ROOT);
  }
  const label = (g) => {
    if (g === ROOT) return "";
    if (g === "cl:none") return t("unclustered (no edges)");
    const i = g.slice(3);
    return declarations.names?.[i] ? `${declarations.names[i]}（C${i}）` : `C${i}`;
  };
  return {
    kind: "cluster",
    groups,
    children: (g) => [...(children.get(g) ?? [])].sort((a, b) => (children.get(b)?.size ?? 0) - (children.get(a)?.size ?? 0) || String(a).localeCompare(String(b))),
    parent: (id) => parent.get(id) ?? null,
    isGroup: (id) => groups.has(id),
    label,
    shortLabel: label,
    defaultOpen: () => new Set([ROOT]),
    allOpen: () => new Set(groups),
  };
}

// ---- 布局：可见行、聚合边、嵌套排序 -----------------------------------------------------

export function layoutRows(theme, tree, open, options = {}) {
  const declarations = options.declarations ?? EMPTY_DECLARATIONS;
  const playing = options.playing ?? null;
  const rows = [];
  const visit = (g) => { for (const c of tree.children(g)) { if (tree.isGroup(c) && open.has(c)) visit(c); else rows.push(c); } };
  visit(ROOT);
  const rowSet = new Set(rows);
  const rowOfCache = new Map();
  const rowOf = (leaf) => {
    if (rowOfCache.has(leaf)) return rowOfCache.get(leaf);
    let id = leaf;
    while (id != null && !rowSet.has(id)) id = tree.parent(id);
    rowOfCache.set(leaf, id);
    return id;
  };
  const edges = aggregateEdges(theme.edges, rowOf);
  const inner = new Map();
  for (const e of theme.edges) { const s = rowOf(e.s); const t = rowOf(e.t); if (s && s === t) inner.set(s, (inner.get(s) ?? 0) + 1); }
  const inverted = new Set(declarations.invert ?? []);
  const live = edges.filter((e) => !inverted.has(e.id));

  const kidOf = (row, g) => { let id = row; let prev = row; while (id != null && id !== g) { prev = id; id = tree.parent(id); } return id === g ? prev : null; };
  const blocks = [];
  const orderGroup = (g, depth) => {
    const kids = tree.children(g).filter((c) => rowSet.has(c) || (tree.isGroup(c) && open.has(c)));
    const kidSet = new Set(kids);
    const kidEdges = aggregateEdges(live, (r) => { const k = kidOf(r, g); return kidSet.has(k) ? k : null; });
    const seq = depSequence(kids, kidEdges.map((e) => [e.s, e.t, edgeWeight(e)]));
    const top = (declarations.top ?? []).filter((k) => kidSet.has(k));
    const bottom = (declarations.bottom ?? []).filter((k) => kidSet.has(k));
    const pinned = new Set([...top, ...bottom]);
    let ordered = [...top, ...seq.order.filter((k) => !pinned.has(k)), ...bottom];
    let pending = new Set();
    if (playing && playing.group === g) { const at = depOrderAtStep(kids, seq.steps, playing.step); ordered = at.order; pending = at.pending; }
    blocks.push({ group: g, depth, kids, seq, order: ordered, pending, edges: kidEdges, first: -1, last: -1 });
    const out = [];
    for (const k of ordered) { if (tree.isGroup(k) && open.has(k)) out.push(...orderGroup(k, depth + 1)); else out.push(k); }
    return out;
  };
  const order = orderGroup(ROOT, 0);
  const pos = new Map(order.map((r, i) => [r, i]));
  const rowsUnder = (g) => { const out = []; const walk = (x) => { if (rowSet.has(x)) out.push(x); else for (const c of tree.children(x)) walk(c); }; walk(g); return out; };
  for (const b of blocks) { const ps = rowsUnder(b.group).map((r) => pos.get(r)); b.first = Math.min(...ps); b.last = Math.max(...ps); }
  const depthOf = (row) => { let d = 0; let id = tree.parent(row); while (id != null && id !== ROOT) { d += 1; id = tree.parent(id); } return d; };
  const feedback = new Set(live.filter((e) => pos.get(e.t) < pos.get(e.s)).map((e) => e.id));
  // 打平排序：不受分组约束时能消掉多少环。和分块的差就是这棵分组树的代价
  const flat = depSequence(rows, live.map((e) => [e.s, e.t, edgeWeight(e)]));
  const pending = new Set(blocks.flatMap((b) => [...b.pending].flatMap((k) => rowsUnder(k))));
  return { rows, order, pos, edges, inner, blocks, feedback, flat, rowOf, depthOf, pending, inverted, rowsUnder };
}

// ---- 一条边的明细：具体的文件对 / 函数对 / 类型 / 宏 / 变量 ------------------------------

export function edgeDetail(view, sourceFiles, targetFiles, options = {}) {
  const index = options.index ?? buildIndex(view);
  const from = new Set(sourceFiles);
  const to = new Set(targetFiles);
  const ROLE = { param: "parameter", return: "return", local: "local", global: "global variable", member: "field", cast: "cast" };

  const includes = (view.includeEdges ?? []).filter((e) => from.has(e.s) && to.has(e.t)).map((e) => ({ s: e.s, t: e.t }));

  const callsBy = new Map();
  for (const c of view.callPairs ?? []) {
    const sf = index.fnById.get(c.s)?.file;
    const tf = index.fnById.get(c.t)?.file;
    if (!sf || !tf || !from.has(sf) || !to.has(tf)) continue;
    const key = `${c.s}→${c.t}`;
    const rec = callsBy.get(key) ?? { from: c.s, to: c.t, fromName: index.nameOf(c.s), toName: index.nameOf(c.t), file: sf, lines: [] };
    if (c.line) rec.lines.push(c.line);
    callsBy.set(key, rec);
  }

  const types = new Map();
  for (const u of view.typeUses ?? []) {
    const f = index.fnById.get(u.fn)?.file;
    if (!f || !u.def || !from.has(f) || !to.has(u.def.path)) continue;
    const rec = types.get(u.type) ?? { type: u.type, def: u.def, n: 0, functions: new Set(), roles: {}, at: u.at };
    rec.n += u.n;
    rec.functions.add(u.fn);
    rec.roles[ROLE[u.role] ?? u.role] = (rec.roles[ROLE[u.role] ?? u.role] ?? 0) + u.n;
    types.set(u.type, rec);
  }

  const macros = new Map();
  for (const u of view.macroUses ?? []) {
    if (!u.def || !from.has(u.file) || !to.has(u.def.path)) continue;
    const rec = macros.get(u.macro) ?? { macro: u.macro, def: u.def, n: 0, files: new Set(), at: u.at };
    rec.n += u.n;
    rec.files.add(u.file);
    macros.set(u.macro, rec);
  }

  const variables = (kinds) => {
    const out = new Map();
    for (const a of index.ast.resourceAccesses ?? []) {
      if (!kinds.has(a.kind)) continue;
      const f = index.fnById.get(a.function)?.file;
      const at = a.variable ? index.varAt(a.variable) : null;
      const vp = at?.file ?? null;
      if (!f || !vp || !from.has(f) || !to.has(vp)) continue;
      const rec = out.get(a.name) ?? { name: a.name, path: vp, line: at?.line ?? null, n: 0, functions: new Set(), sites: [] };
      rec.n += 1;
      rec.functions.add(a.function);
      if (rec.sites.length < 6) rec.sites.push(a.location);
      out.set(a.name, rec);
    }
    return [...out.values()].sort((a, b) => b.n - a.n).map((r) => ({ ...r, functions: r.functions.size }));
  };

  return {
    includes,
    calls: [...callsBy.values()].sort((a, b) => b.lines.length - a.lines.length).slice(0, 80),
    types: [...types.values()].sort((a, b) => b.n - a.n).map((r) => ({ ...r, functions: r.functions.size })),
    macros: [...macros.values()].sort((a, b) => b.n - a.n).map((r) => ({ ...r, files: r.files.size })),
    reads: variables(new Set(["read", "read_write"])),
    writes: variables(new Set(["write", "read_write"])),
  };
}
