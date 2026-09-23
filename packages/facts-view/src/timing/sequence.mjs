// 一轮：一个执行单元跑一圈，都经过了什么。
//
// 表格讲不了这件事。表格能说「这里有三个循环、两个让出点」，说不了「先走到哪、在哪停下、
// 停下之后从哪儿继续」。所以这一层出的不是行，是**一列一列往右的框**：
//
//   第 1 列是这个单元的一整轮（一个框）。让出点是框里的一行，不把框切开。
//   框在长出子循环的那一行裂开，子循环从这道缝里向右展开成第 2 列的一个框。
//   框头是那个循环所在的函数，框里第一行是 while / for 本身，然后是循环体内的调用。
//   框右边是这个循环的出口：条件不成立 / break / return / 体内的让出。再深的循环进第 3 列。
//
// 「往右」表示的是嵌套深度，不是时间。同一列里两个框之间也不表示先后——只有一个框内部
// 自上而下才是源码顺序。这一点在视图上要写出来，否则很容易被读成甘特图。
//
// 派生只出结构：列、框、行、出口、角标。像素由渲染方量出来对齐，因为框有多高取决于字体。

import { t } from "../i18n.mjs";
import { buildIndex } from "../graph.mjs";
import { loopClassifier } from "./model.mjs";

const MAX_CALL_DEPTH = 7; // 调用链最多展开这么多跳，只沿通向循环的分支
const MAX_LEVELS = 4; // 最多往右展开几层循环

// ---- 一个函数体的一段：调用、共享访问、让出点，按行号排 ------------------------------

function sliceOf(index, fnId, from, to) {
  const inRange = (line) => line != null && line >= from && line <= to;
  const events = [];
  // 区域外的库函数调用不画。让出点由 loops.blockingCalls 单独成行，不重复；
  // 闭源库符号是边界，要保留，否则一轮里会凭空少一段
  for (const c of index.calleesOf.get(fnId) ?? []) {
    if (inRange(c.line) && (index.inRegion(index.fileOf(c.t)) || index.fnById.get(c.t)?.external)) {
      events.push({ type: "call", fn: fnId, line: c.line, target: c.t, kind: c.kind ?? "call" });
    }
  }
  for (const a of index.accessesByFn.get(fnId) ?? []) {
    if (inRange(a.location?.line) && (index.sharedByName.has(a.name) || index.conflictByName.has(a.name))) {
      events.push({ type: "access", fn: fnId, line: a.location.line, name: a.name, kind: a.kind, inCritical: Boolean(a.inCriticalSection), via: a.via ?? null });
    }
  }
  for (const l of index.loopsByFn.get(fnId) ?? []) {
    for (const b of l.blockingCalls ?? []) {
      if (inRange(b.location?.line)) events.push({ type: "wait", fn: fnId, line: b.location.line, callee: b.callee, kind: b.kind });
    }
  }
  const seen = new Set();
  const deduped = events.filter((e) => {
    const key = `${e.type}:${e.line}:${e.target ?? e.name ?? e.callee}:${e.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // 同一行上让出点排在调用后面：先调它，才让出
  deduped.sort((x, y) => x.line - y.line || (x.type === "wait" ? 1 : 0) - (y.type === "wait" ? 1 : 0));

  // 分支 / case / 内层循环成为嵌套框。整个区间那一层不算，它就是这个框本身
  const frames = (index.blocksByFn.get(fnId) ?? [])
    .filter((b) => b.kind !== "do" && !(b.location.line <= from && b.endLine >= to) && b.location.line >= from && b.endLine <= to)
    .map((b) => ({
      fn: fnId,
      kind: b.kind,
      from: b.location.line,
      to: b.endLine,
      condition: b.condition ?? null,
      labels: b.labels ?? [],
      depth: b.depth,
      isLoop: ["while", "for"].includes(b.kind),
    }));

  const crits = (index.critByFn.get(fnId) ?? [])
    .filter((c) => inRange(c.begin?.line))
    .map((c) => ({ fn: fnId, from: c.begin.line, to: c.end?.line ?? to, api: c.api, unterminated: Boolean(c.unterminated) }));

  return { events: deduped, frames, crits };
}

// 事件挂进最内层的那个框，框按包含关系嵌套
function nest(index, fnId, from, to) {
  const { events, frames, crits } = sliceOf(index, fnId, from, to);
  const nodes = frames.sort((a, b) => a.from - b.from || b.to - a.to).map((f) => ({ ...f, type: "frame", children: [] }));
  const roots = [];
  const stack = [];
  for (const n of nodes) {
    while (stack.length && !(stack[stack.length - 1].from <= n.from && n.to <= stack[stack.length - 1].to)) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(n);
    stack.push(n);
  }
  const innermost = (line) => nodes.filter((n) => n.from <= line && line <= n.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0] ?? null;
  for (const e of events) { const f = innermost(e.line); (f ? f.children : roots).push({ ...e, children: null }); }
  const sortRec = (list) => { list.sort((a, b) => (a.line ?? a.from) - (b.line ?? b.from)); for (const n of list) if (n.type === "frame") sortRec(n.children); };
  sortRec(roots);
  return { roots, crits };
}

// ---- 被调函数体内有什么：只看一层，够判断「这一步碰了什么、会不会停」 -------------------

function calleeSummary(index, target, chain) {
  const t = index.fnById.get(target);
  if (!t || t.external || !index.inRegion(t.file) || !t.endLine) return { accesses: [], yields: [], deepYield: false, loops: 0 };
  const { events } = sliceOf(index, target, t.line, t.endLine);
  const acc = new Map();
  for (const e of events) {
    if (e.type !== "access") continue;
    const cur = acc.get(e.name) ?? { name: e.name, kinds: new Set(), inCritical: true, line: e.line };
    cur.kinds.add(e.kind);
    if (!e.inCritical) cur.inCritical = false;
    acc.set(e.name, cur);
  }
  // 更深一层的让出：被调的被调里有阻塞点。只标出来，不展开——展开就没边了
  let deepYield = false;
  for (const e of events) {
    if (e.type !== "call" || chain.includes(e.target)) continue;
    const tt = index.fnById.get(e.target);
    if (tt && index.inRegion(tt.file) && (index.loopsByFn.get(e.target) ?? []).some((l) => (l.blockingCalls ?? []).length)) { deepYield = true; break; }
  }
  return {
    accesses: [...acc.values()].map((a) => ({ ...a, kinds: [...a.kinds] })),
    yields: events.filter((e) => e.type === "wait").map((e) => ({ callee: e.callee, kind: e.kind, line: e.line })),
    deepYield,
    loops: (index.loopsByFn.get(target) ?? []).length,
  };
}

// ---- 一轮里的步骤：调用 / 让出 / 分支框的开合 ------------------------------------------

export function roundSteps(view, fnId, from, to, options = {}) {
  const index = options.index ?? buildIndex(view);
  const cls = options.classifier ?? loopClassifier(view, { index });
  const built = nest(index, fnId, from, to);
  const hasCall = (n) => n.type === "call" || (n.type === "frame" && n.children.some(hasCall));
  const hasWait = (n) => n.type === "wait" || (n.type === "frame" && n.children.some(hasWait));
  const inCrit = (fn, line) => built.crits.some((c) => c.fn === fn && line >= c.from && line <= c.to);

  const frameLabel = (n) => {
    if (n.kind === "case" || n.kind === "default") return n.labels.length ? n.labels.join(" / ") : "default";
    if (n.kind === "else") return "else";
    return n.condition ?? "";
  };
  const frameKind = (n) => (n.isLoop ? "loop" : n.kind === "case" || n.kind === "default" ? "case" : n.kind === "else" ? "else" : n.kind === "switch" ? "switch" : "opt");

  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (n.type === "access") continue; // 直接访问最后挂到最近的那一步上
      if (n.type === "wait") { out.push({ type: "wait", callee: n.callee, kind: n.kind, line: n.line, fn: n.fn, depth }); continue; }
      if (n.type === "frame") {
        const kind = frameKind(n);
        const ownLoop = kind === "loop" ? cls.loopsOfFn(n.fn, n.from, n.from)[0] ?? null : null;
        // 空框不画：里面既没有调用也没有让出，那这个分支对一轮没有可说的
        const worthShowing = ownLoop && ownLoop.class !== "iter" && ownLoop.class !== "macro";
        if (!hasCall(n) && !hasWait(n) && !worthShowing) continue;
        out.push({ type: "frame-open", kind, label: frameLabel(n), line: n.from, to: n.to, fn: n.fn, depth, loop: ownLoop });
        walk(n.children, depth + 1);
        out.push({ type: "frame-close", depth });
        continue;
      }
      const t = index.fnById.get(n.target);
      // 注册（取函数地址装进系统）不是在这里调它：那个函数的循环在调度器手里转，不在这一轮里
      const loops = n.kind !== "register" && t && index.inRegion(t.file) && !t.external ? cls.loopsOfFn(n.target, t.line, t.endLine) : [];
      out.push({
        type: "call", target: n.target, line: n.line, fn: n.fn, kind: n.kind, depth,
        summary: calleeSummary(index, n.target, [fnId]),
        loops, inCritical: inCrit(n.fn, n.line), directAccesses: [],
      });
    }
  };
  walk(built.roots, 0);

  // 根函数自己直接读写的共享变量，挂在它前面最近的那一步上；一步都没有就自成一行
  const direct = [];
  const gather = (nodes) => { for (const n of nodes) { if (n.type === "frame") gather(n.children); else if (n.type === "access") direct.push(n); } };
  gather(built.roots);
  for (const a of direct.sort((x, y) => x.line - y.line)) {
    const prev = [...out].reverse().find((st) => st.type === "call" && st.line <= a.line);
    const rec = { name: a.name, kinds: [a.kind], inCritical: a.inCritical || inCrit(a.fn, a.line), direct: true, line: a.line };
    if (prev) { prev.directAccesses.push(rec); continue; }
    let self = out.find((st) => st.type === "self");
    if (!self) { self = { type: "self", fn: fnId, line: from, depth: 0, directAccesses: [], loops: [], summary: null }; out.unshift(self); }
    self.directAccesses.push(rec);
  }
  return out;
}

// 一步碰到的共享变量，以及它有没有保护。判定按「已识别的」说，没识别到不等于没有
export function stepVariables(step, index) {
  const map = new Map();
  for (const a of step.summary?.accesses ?? []) {
    map.set(a.name, { name: a.name, kinds: new Set(a.kinds), inCritical: a.inCritical, where: t("inside the callee") });
  }
  for (const a of step.directAccesses ?? []) {
    const cur = map.get(a.name) ?? { name: a.name, kinds: new Set(), inCritical: true, where: t("direct access") };
    for (const k of a.kinds) cur.kinds.add(k);
    cur.inCritical = cur.inCritical && a.inCritical;
    if (step.inCritical) cur.inCritical = true;
    map.set(a.name, cur);
  }
  return [...map.values()].map((v) => {
    const shared = index.sharedByName.get(v.name);
    return {
      name: v.name,
      kinds: [...v.kinds],
      write: [...v.kinds].some((k) => k !== "read"),
      inCritical: v.inCritical,
      where: v.where,
      conflict: index.conflictByName.has(v.name),
      wake: index.wakeByName.has(v.name),
      isrWriters: (shared?.units ?? [])
        .filter((u) => u.unitKind === "isr" && (u.kinds ?? []).some((k) => k !== "read"))
        .map((u) => String(u.unit).split(":").pop()),
    };
  });
}

// ---- 一轮的列：框、框里的行、框右边的出口 ------------------------------------------

// 循环的出口：条件不成立、break、return、体内的让出。一个都没有就是出不去。
// 根框没有循环时出口取决于这一轮是什么：无限循环转下一圈，函数体则是返回
function exitsOf(loop, rootRangeKind) {
  if (!loop) return [{ type: rootRangeKind === "body" ? "return" : "loopback" }];
  const out = [];
  if (loop.infinite !== true) out.push({ type: "cond", text: loop.condition ?? null });
  for (const e of loop.exits ?? []) out.push({ type: e.kind, line: e.line });
  if (!out.length) out.push({ type: "none" });
  return out;
}

// 一个函数体里最外层的那些循环。嵌在别人里面的不算，它们由父循环那一列再往右长
function topLoops(index, cls, fnId) {
  const t = index.fnById.get(fnId);
  if (!t || t.external || !index.inRegion(t.file) || !t.endLine) return [];
  const all = (index.loopsByFn.get(fnId) ?? []).filter((l) => l.location.line >= t.line && l.location.line <= t.endLine && !l.fromMacro);
  return all
    .filter((l) => !all.some((o) => o !== l && o.location.line < l.location.line && l.endLine <= o.endLine))
    .map((l) => ({ ...l, class: cls.classify(l), condition: cls.conditionOf(l), mayTimeOut: cls.mayTimeOut(l) }));
}

// 从一次调用往下追：只保留自己有循环、或下面有循环的分支。其余不展开，它们对时序没话说
function chainOf(index, cls, target, chain, budget, showIter) {
  const t = index.fnById.get(target);
  if (!t || t.external || !index.inRegion(t.file) || !t.endLine || chain.includes(target) || budget <= 0) return null;
  const top = topLoops(index, cls, target);
  const mine = top.filter((l) => showIter || l.class !== "iter");
  const insideTop = (line) => top.some((l) => line >= l.location.line && line <= l.endLine);
  const children = [];
  const seen = new Set();
  for (const c of [...(index.calleesOf.get(target) ?? [])].sort((x, y) => (x.line ?? 0) - (y.line ?? 0))) {
    if (c.line == null || c.line < t.line || c.line > t.endLine || insideTop(c.line) || seen.has(c.t)) continue;
    seen.add(c.t);
    const sub = chainOf(index, cls, c.t, [...chain, target], budget - 1, showIter);
    if (sub) children.push({ ...sub, line: c.line });
  }
  if (!mine.length && !children.length) return null;
  return { target, loops: mine, children };
}

/**
 * 一个执行单元的一轮，摊成一列一列的框。
 * rootId 是单元的入口函数；range 不给就自己找：有无限循环就取那个循环体，没有就整个函数体。
 */
export function buildRound(view, rootId, options = {}) {
  const index = options.index ?? buildIndex(view);
  const cls = options.classifier ?? loopClassifier(view, { index });
  const showIter = Boolean(options.showIterations);
  const maxLevels = options.maxLevels ?? MAX_LEVELS;

  const fn = index.fnById.get(rootId);
  if (!fn) return { id: `round:${rootId}`, available: false, reason: "no-such-function", levels: [] };

  // 一轮的范围。有无限循环就是它的循环体，一轮 = 转一圈；没有就是整个函数体，跑一遍返回
  const mainLoop = (index.loopsByFn.get(rootId) ?? []).filter((l) => l.infinite).sort((a, b) => a.depth - b.depth || a.location.line - b.location.line)[0] ?? null;
  const explicit = options.range ?? null;
  const range = explicit
    ?? (mainLoop
      ? { from: mainLoop.location.line, to: mainLoop.endLine, kind: "loop", label: t("{kind} infinite loop {from}–{to}; one round = one turn", { kind: mainLoop.kind, from: mainLoop.location.line, to: mainLoop.endLine }) }
      : { from: fn.line, to: fn.endLine ?? Infinity, kind: "body", label: t("function body {from}–{to}; no loop, runs once and returns", { from: fn.line, to: fn.endLine ?? "?" }) });

  const levels = [];
  let badgeSeq = 0;
  const nextBadge = () => { const n = badgeSeq++; return String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26)) : ""); };
  const badgeOf = new Map(); // 同一个循环被多条路径走到时只开一个框，共用一个角标
  let queue = [{ fnId: options.stateFunction ?? rootId, from: range.from, to: range.to, loop: null, chain: [rootId], badge: null, spawnKey: null }];

  for (let depth = 0; depth < maxLevels && queue.length; depth++) {
    const boxes = [];
    const next = [];
    for (const item of queue) {
      const rows = [];
      const scope = `${rootId}|${depth}|${item.badge ?? "root"}`;
      // 挂角标：这一行长出的循环，会成为右边一列的一个框
      const attach = (loops, rowKey, chain) => loops.map((l) => {
        const key = `${l.function}:${l.location.line}`;
        const known = badgeOf.get(key);
        if (known) return { loop: l, badge: known, repeat: true };
        const badge = nextBadge();
        badgeOf.set(key, badge);
        next.push({ fnId: l.function, from: l.location.line, to: l.endLine, loop: l, chain: [...chain, l.function], badge, spawnKey: rowKey });
        return { loop: l, badge, repeat: false };
      });

      const walkChain = (node, indent, chain, ancestors) => {
        // key 要带上父 key：同一条调用链会从多个入口重复出现，只用 目标:行 会撞
        const key = `${ancestors[ancestors.length - 1] ?? "^"}>${node.target}:${node.line ?? 0}`;
        rows.push({
          type: "chain", target: node.target, name: index.nameOf(node.target), file: index.fileOf(node.target),
          line: node.line, indent, key, badges: attach(node.loops, key, chain),
        });
        for (const c of node.children) walkChain(c, indent + 1, [...chain, node.target], [...ancestors, key]);
      };

      for (const st of roundSteps(view, item.fnId, item.from, item.to, { index, classifier: cls })) {
        if (st.type === "frame-close") { rows.push({ type: "frame-close", indent: st.depth, key: `close:${rows.length}` }); continue; }
        if (st.type === "wait") {
          rows.push({ type: "yield", indent: st.depth, callee: st.callee, kind: st.kind, line: st.line, fn: st.fn, file: index.fileOf(st.fn), key: `yield:${st.fn}:${st.line}`, badges: [], conditional: st.depth > 0 });
          continue;
        }
        if (st.type === "frame-open") {
          const own = st.loop && !st.loop.fromMacro && (showIter || st.loop.class !== "iter") ? [st.loop] : [];
          const key = `frame:${st.fn}:${st.line}`;
          rows.push({ type: "frame", indent: st.depth, kind: st.kind, label: st.label, line: st.line, to: st.to, fn: st.fn, file: index.fileOf(st.fn), key, badges: attach(own, key, item.chain) });
          continue;
        }
        if (st.type !== "call" && st.type !== "self") continue;
        const target = st.type === "self" ? item.fnId : st.target;
        const chained = st.type === "call" && st.kind !== "register" ? chainOf(index, cls, target, item.chain, MAX_CALL_DEPTH, showIter) : null;
        const key = `${target}:${st.line}`;
        rows.push({
          type: "step", indent: st.depth, self: st.type === "self", target, name: index.nameOf(target), file: index.fileOf(target),
          line: st.line, kind: st.kind ?? null, key,
          variables: stepVariables(st, index),
          yields: st.summary?.yields ?? [], deepYield: Boolean(st.summary?.deepYield),
          badges: attach(chained?.loops ?? [], key, item.chain),
        });
        for (const c of chained?.children ?? []) walkChain(c, (st.depth ?? 0) + 1, [...item.chain, target], [key]);
      }

      boxes.push({
        id: `box:${scope}${item.badge ? `#${item.badge}` : ""}`,
        depth, scope, badge: item.badge, spawnKey: item.spawnKey,
        fn: item.fnId, name: index.nameOf(item.fnId), file: index.fileOf(item.fnId),
        loop: item.loop
          ? { id: index.loopId(item.loop), class: item.loop.class, kind: item.loop.kind, line: item.loop.location.line, endLine: item.loop.endLine, condition: item.loop.condition, mayTimeOut: item.loop.mayTimeOut, infinite: Boolean(item.loop.infinite) }
          : null,
        exits: exitsOf(item.loop, depth === 0 ? range.kind : null),
        rows,
      });
    }
    levels.push(boxes);
    queue = next;
  }

  const allRows = levels.flat().flatMap((b) => b.rows);
  const truncated = queue.length > 0; // 还有没画完的层：说出来，别让人以为就这么深
  return {
    id: `round:${rootId}`,
    available: levels.some((boxes) => boxes.length > 0),
    root: rootId,
    name: index.nameOf(rootId),
    file: index.fileOf(rootId),
    range,
    levels: levels.filter((boxes) => boxes.length > 0),
    truncated,
    maxLevels,
    counts: {
      boxes: levels.flat().length,
      steps: allRows.filter((r) => r.type === "step" || r.type === "chain").length,
      yields: allRows.filter((r) => r.type === "yield").length,
      // 没保护又和中断撞上的访问：这一轮里真正要人看的东西
      unguarded: allRows.reduce((n, r) => n + (r.variables ?? []).filter((v) => (v.conflict || v.isrWriters.length) && !v.inCritical).length, 0),
    },
  };
}
