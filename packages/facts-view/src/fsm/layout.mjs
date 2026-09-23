// 状态图的布局：层是我们算的（从起点沿前进边的最长路径，见 analyzeMachine 的 depth），
// dagre 只负责同层排序和边的走线。用初态到每个节点的不可见高权重边把节点钉在自己那一层上，
// 代码顺序里没有前向入弧的状态用不可见边挂在前一个后面，留在自己的支路里；回退边反着喂给
// dagre 再把点序倒回来，它才会走到侧面而不是穿过中间；自环不进 dagre，单独画。
//
// 只出坐标和点序，不出 SVG 字符串。UML 的语义（初态、终态、非 case、无入弧、经 helper 改写、
// 子状态机）在这里标好，怎么画由消费方决定。

import { t } from "../i18n.mjs";
import dagre from "@dagrejs/dagre";

export const NODE_W = 176;
export const NODE_H = 40;
export const TERMINAL_R = 14;

export function layoutMachine(machine, analysis, options = {}) {
  const a = analysis;
  const names = a.names ?? [];
  if (!names.length) return { nodes: [], edges: [], selfLoops: [], init: null, bbox: { x: 0, y: 0, width: 0, height: 0 } };
  const terminal = new Set(a.terminal ?? []);
  const extra = new Set(a.extra ?? []);
  const start = a.start ?? [];
  const idx = new Map(names.map((n, i) => [n, i]));
  const depth = (n) => (a.depth instanceof Map ? a.depth.get(n) : a.depth?.[n]) ?? 0;
  const children = options.children ?? [];
  // 初态：没有入弧的状态；一个都没有（起点被回退边指着）就退到深度 0、代码顺序最前的那个
  const initTo = start[0] ?? names.slice().sort((x, y) => depth(x) - depth(y) || (idx.get(x) ?? 0) - (idx.get(y) ?? 0))[0];

  // dagre 偶尔会在回退边很多的机器上崩（端点落到节点中心，"Not possible to find intersection"）。
  // 三种排序器依次试，都不行就退回按 depth 分行的简单布局——图永远画得出来，兜底级别记在结果里
  const build = (ranker, reverseBack) => {
    const graph = new dagre.graphlib.Graph({ multigraph: true })
      .setGraph({ rankdir: "TB", nodesep: 34, ranksep: 54, marginx: 24, marginy: 24, ranker })
      .setDefaultEdgeLabel(() => ({}));
    fill(graph, reverseBack);
    dagre.layout(graph);
    for (const n of names) { const nd = graph.node(n); if (!nd || !Number.isFinite(nd.x) || !Number.isFinite(nd.y)) throw new Error("dagre returned non-numeric coordinates"); }
    return graph;
  };
  let g = null;
  let ranker = null;
  // 先按原型的做法把回退边反着喂（走侧面），崩了就让 dagre 自己处理环，再换排序器
  const attempts = [["network-simplex", true], ["network-simplex", false], ["longest-path", true], ["longest-path", false], ["tight-tree", false]];
  for (const [candidate, reverseBack] of attempts) {
    try { g = build(candidate, reverseBack); ranker = reverseBack ? candidate : `${candidate}/natural`; break; } catch { /* 换下一种 */ }
  }
  if (!g) return fallbackLayout(names, a, { terminal, extra, initTo, depth, children });

  function fill(g, reverseBack) {
  g.setNode("__init", { width: 12, height: 12 });
  for (const n of names) g.setNode(n, { width: terminal.has(n) ? TERMINAL_R * 2 : NODE_W, height: terminal.has(n) ? TERMINAL_R * 2 : NODE_H });
  if (initTo) g.setEdge("__init", initTo, { init: true }, "init");
  for (const n of names) if (n !== initTo) g.setEdge("__init", n, { invisible: true, weight: 8, minlen: depth(n) + 1 }, `rank:${n}`);
  const hasForwardIn = new Set((a.edges ?? []).filter((e) => (idx.get(e.to) ?? 0) > (idx.get(e.from) ?? 0)).map((e) => e.to));
  names.forEach((n, i) => {
    if (i > 0 && !hasForwardIn.has(n) && !terminal.has(n) && !extra.has(n) && !start.includes(n)) g.setEdge(names[i - 1], n, { invisible: true, weight: 0.3 }, `order:${i}`);
  });
  const real = [];
  (a.edges ?? []).forEach((e, i) => {
    if (e.kind === "self") return;
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) return;
    const back = e.kind === "back" && reverseBack;
    const meta = { ref: e, index: i, reversed: back, weight: e.kind === "back" ? 0.5 : e.kind === "next" ? 2 : 1, minlen: 1 };
    if (back) g.setEdge(e.to, e.from, meta, `e${i}`);
    else g.setEdge(e.from, e.to, meta, `e${i}`);
    real.push(`e${i}`);
  });
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, pad = 0) => { minX = Math.min(minX, x - pad); minY = Math.min(minY, y - pad); maxX = Math.max(maxX, x + pad); maxY = Math.max(maxY, y + pad); };

  const helperWrites = a.helperWrites ?? {};
  const viaHelper = new Set(a.viaHelper ?? []);
  const noIn = new Set(a.noIn ?? []);
  const nodes = names.map((name) => {
    const nd = g.node(name);
    const isTerminal = terminal.has(name);
    const helpers = (helperWrites instanceof Map ? helperWrites.get(name) : helperWrites[name]) ?? [];
    const flags = [];
    if (viaHelper.has(name)) flags.push({ kind: "helper", text: t("rewritten via helper ×{n}", { n: helpers.length }) });
    if (noIn.has(name) && !start.includes(name)) flags.push({ kind: "no-in", text: t("no incoming edge") });
    if (extra.has(name)) flags.push({ kind: "extra", text: t("not a case: only a transition target") });
    const kids = children.filter((c) => c.parentState === name);
    grow(nd.x - nd.width / 2, nd.y - nd.height / 2 - 44);
    grow(nd.x + nd.width / 2, nd.y + nd.height / 2 + 30);
    return { name, x: nd.x, y: nd.y, w: nd.width, h: nd.height, terminal: isTerminal, extra: extra.has(name), start: name === initTo, flags, children: kids.map((c) => ({ id: c.id, dispatch: c.dispatch })) };
  });

  const edges = [];
  for (const eo of g.edges()) {
    const meta = g.edge(eo);
    if (!meta.ref || meta.invisible) continue;
    const pts = (meta.points ?? []).map((p) => ({ x: p.x, y: p.y }));
    const points = meta.reversed ? pts.slice().reverse() : pts;
    for (const p of points) grow(p.x, p.y, 8);
    const t = meta.ref.transition ?? {};
    edges.push({ from: meta.ref.from, to: meta.ref.to, kind: meta.ref.kind, index: meta.index, points, line: t.location?.line ?? null, via: t.via ?? null, condition: t.condition ?? null });
  }
  edges.sort((x, y) => x.index - y.index);

  const selfLoops = (a.edges ?? []).map((e, i) => ({ e, i })).filter(({ e }) => e.kind === "self" && g.hasNode(e.from)).map(({ e, i }) => {
    const nd = g.node(e.from);
    const t = e.transition ?? {};
    grow(nd.x + nd.width / 2 + 40, nd.y);
    return { from: e.from, to: e.to, kind: "self", index: i, x: nd.x + nd.width / 2, y: nd.y, line: t.location?.line ?? null, via: t.via ?? null, condition: t.condition ?? null };
  });

  let init = null;
  if (initTo && g.hasNode(initTo)) {
    const s = g.node(initTo);
    init = { to: initTo, x: s.x, y: s.y - s.height / 2 - 34, targetY: s.y - s.height / 2 };
  }
  grow(maxX + 70, maxY); // 右侧留给自环与出口标签
  return {
    nodes, edges, selfLoops, init, ranker,
    bbox: { x: Math.floor(minX - 24), y: Math.floor(minY - 24), width: Math.ceil(maxX - minX + 48), height: Math.ceil(maxY - minY + 48) },
  };
}

/** dagre 全军覆没时的简单布局：按 depth 分行、行内按代码顺序，边两点直连，回退边往右绕。 */
function fallbackLayout(names, a, { terminal, extra, initTo, depth, children }) {
  const rows = new Map();
  for (const n of names) rows.set(depth(n), [...(rows.get(depth(n)) ?? []), n]);
  const GAP_X = 34, GAP_Y = 54;
  const widest = Math.max(1, ...[...rows.values()].map((r) => r.length));
  const pos = new Map();
  for (const [d, row] of rows) {
    const total = row.length * NODE_W + (row.length - 1) * GAP_X;
    const left = (widest * NODE_W + (widest - 1) * GAP_X - total) / 2;
    row.forEach((n, i) => pos.set(n, { x: left + i * (NODE_W + GAP_X) + NODE_W / 2, y: 60 + d * (NODE_H + GAP_Y) + NODE_H / 2 }));
  }
  const nodes = names.map((name) => {
    const p = pos.get(name);
    const isTerminal = terminal.has(name);
    const kids = children.filter((c) => c.parentState === name);
    return { name, x: p.x, y: p.y, w: isTerminal ? TERMINAL_R * 2 : NODE_W, h: isTerminal ? TERMINAL_R * 2 : NODE_H, terminal: isTerminal, extra: extra.has(name), start: name === initTo, flags: extra.has(name) ? [{ kind: "extra", text: t("not a case: only a transition target") }] : [], children: kids.map((c) => ({ id: c.id, dispatch: c.dispatch })) };
  });
  let backCount = 0;
  const edges = [];
  const selfLoops = [];
  (a.edges ?? []).forEach((e, i) => {
    const from = pos.get(e.from), to = pos.get(e.to);
    if (!from || !to) return;
    const t = e.transition ?? {};
    const meta = { line: t.location?.line ?? null, via: t.via ?? null, condition: t.condition ?? null };
    if (e.kind === "self") { selfLoops.push({ from: e.from, to: e.to, kind: "self", index: i, x: from.x + NODE_W / 2, y: from.y, ...meta }); return; }
    const down = to.y > from.y;
    const points = [{ x: from.x, y: from.y + (down ? NODE_H / 2 : -NODE_H / 2) }];
    if (e.kind === "back") { backCount += 1; const detour = Math.max(from.x, to.x) + NODE_W / 2 + 20 + backCount * 14; points.push({ x: detour, y: from.y }, { x: detour, y: to.y }); }
    points.push({ x: to.x, y: to.y + (down ? -NODE_H / 2 : NODE_H / 2) });
    edges.push({ from: e.from, to: e.to, kind: e.kind, index: i, points, ...meta });
  });
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const maxX = Math.max(...xs) + NODE_W / 2 + 80 + backCount * 14, maxY = Math.max(...ys) + NODE_H;
  const s = pos.get(initTo);
  return {
    nodes, edges, selfLoops, ranker: "fallback",
    init: s ? { to: initTo, x: s.x, y: s.y - NODE_H / 2 - 34, targetY: s.y - NODE_H / 2 } : null,
    bbox: { x: -24, y: 0, width: Math.ceil(maxX + 48), height: Math.ceil(maxY + 48) },
  };
}
