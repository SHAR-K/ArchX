// 运行图：共享变量的数据流向。上排是中断，下排是线程（任务，其后跟它宿主的回调），
// 中间三层是变量——中断写的往下流给线程、线程写的往上流给中断、两边都写的没有 owner。
//
// 数据和矛阵是同一份 sharedResources，只是换了问法：矛阵答「谁碰了什么」，这张图答
// 「数据从哪个上下文产出、流到哪个上下文消费」。判定口径也一样：冲突是候选不是结论，
// 通知标志是设计意图，未识别的保护不等于没有保护。
//
// 模型和布局分开：模型给 MCP 和界面共用，布局只出坐标，画法由消费方决定。

import { t } from "../i18n.mjs";
import { buildIndex } from "../graph.mjs";

const WRITE_KINDS = new Set(["write", "read_write"]);
const READ_KINDS = new Set(["read", "read_write"]);
const writes = (u) => (u.kinds ?? []).some((k) => WRITE_KINDS.has(k));
const reads = (u) => (u.kinds ?? []).some((k) => READ_KINDS.has(k));
const bareWrite = (u) => (u.unprotectedKinds ?? []).some((k) => WRITE_KINDS.has(k));
const bareRead = (u) => (u.unprotectedKinds ?? []).some((k) => READ_KINDS.has(k));

export const FLOW_LABEL = {
  "isr→thread": "Interrupt produces → thread consumes",
  "thread→isr": "Thread produces → interrupt consumes",
  mixed: "Both interrupt and thread write",
  "isr↔isr": "Between interrupts",
  "thread↔thread": "Between threads",
};

export function buildRunMap(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const entries = index.entries ?? {};
  const ast = index.ast ?? {};
  const shortName = (unitId) => String(unitId).split(":").slice(1).join(":");

  // 单元表：中断按抢占优先级，任务按注册序，回调挂在唯一宿主后面
  const byUnit = new Map();
  for (const i of entries.isrs ?? []) {
    byUnit.set(i.unitId, { id: i.unitId, fn: i.id, kind: "isr", name: index.nameOf(i.id), preempt: i.priority?.preempt ?? null, vector: i.vector ?? null, kernel: Boolean(i.kernel) });
  }
  for (const r of entries.registrations ?? []) {
    const hosts = (r.hosts ?? []).filter((h) => !String(h).startsWith("main:"));
    byUnit.set(r.unitId, {
      id: r.unitId, fn: r.id, kind: r.kind === "task" ? "task" : "callback", name: index.nameOf(r.id),
      hosts, host: hosts.length === 1 ? hosts[0] : null, hostConfidence: r.hostConfidence ?? null,
      mode: ast.runModes?.[r.unitId]?.mode ?? null, periodMs: ast.runModes?.[r.unitId]?.periodMs ?? null,
    });
  }
  // 事实里有、入口表里没有的单元（区域外注册的回调）也要有个格子，不然它的边没地方落
  for (const r of ast.sharedResources ?? []) for (const u of r.units ?? []) {
    if (u.unitKind === "main" || byUnit.has(u.unit)) continue;
    byUnit.set(u.unit, { id: u.unit, fn: u.accesses?.[0]?.function ?? null, kind: u.unitKind, name: shortName(u.unit), hosts: [], host: null });
  }
  // main 也是一个运行期单元——前提是它自己的函数体里有无限循环（裸机超级循环）。循环体里的访问
  // （含循环体调到的函数）是运行期数据流，和中断真的会交错；循环前的访问是初始化，单独列。
  // main 没有循环（RTOS 启动调度器后返回、或把循环交给 scheduler_run 之类）时维持原样：全算初始化。
  // 冲突表早就把 main 当一列，这张图不画它，同一页就自相矛盾
  const mainFn = entries.main ?? null;
  const mainLoop = mainFn ? (index.loopsByFn.get(mainFn) ?? []).filter((l) => l.infinite && !l.depth).sort((a, b) => a.location.line - b.location.line)[0] ?? null : null;
  const loopReach = mainLoop ? new Set((mainLoop.callsInBody ?? []).flatMap((c) => [...index.reachOf(c)])) : new Set();
  const inMainLoop = (acc) => Boolean(mainLoop) && (acc.function === mainFn
    ? (acc.location?.line ?? 0) >= mainLoop.location.line && (acc.location?.line ?? 0) <= mainLoop.endLine
    : loopReach.has(acc.function));
  if (mainLoop) {
    const rm = ast.runModes?.["main:main"] ?? null;
    byUnit.set("main:main", { id: "main:main", fn: mainFn, kind: "main", name: index.nameOf(mainFn), hosts: [], host: null, mode: rm?.mode ?? null, periodMs: rm?.periodMs ?? null, loop: { line: mainLoop.location.line, endLine: mainLoop.endLine } });
  }
  // 把 main 的一次访问记录切成「循环里的」那一份；循环里没碰过就返回 null
  const loopPart = (u) => {
    if (u.unitKind !== "main" || !mainLoop) return null;
    const inside = (u.accesses ?? []).filter(inMainLoop);
    if (!inside.length) return null;
    const kinds = [...new Set(inside.map((a) => a.kind))];
    const has = (k) => kinds.some((x) => x === k || x === "read_write");
    const unprotected = (u.unprotectedKinds ?? []).filter((k) => k === "read_write" || has(k));
    return { ...u, kinds, unprotectedKinds: unprotected, accesses: inside, accessCount: inside.length };
  };
  const effective = (unitId) => byUnit.get(unitId)?.host ?? unitId; // 回调的写算到宿主头上

  const conflictByName = new Map((ast.conflictCandidates ?? []).map((c) => [c.name, c]));
  const wakeByName = new Map((ast.wakeRelations ?? []).map((w) => [w.name, w]));

  const vars = [];
  const mainInit = [];
  for (const r of ast.sharedResources ?? []) {
    const units = (r.units ?? []).map((u) => (u.unitKind === "main" ? loopPart(u) : u)).filter((u) => u && byUnit.has(u.unit));
    // 初始化阶段的写：main 在循环外写过的（没有循环时就是 main 写过的全部）
    const mainW = (r.units ?? []).some((u) => u.unitKind === "main" && (u.accesses ?? []).some((a) => WRITE_KINDS.has(a.kind) && !inMainLoop(a)) || (u.unitKind === "main" && !(u.accesses ?? []).length && writes(u)));
    if (mainW) mainInit.push(r.name);
    // 无写方的也留着：只读共享（配置表 / 写方在区域外）仍是耦合
    if (units.length < 2) continue;
    const writers = units.filter(writes);
    const readers = units.filter(reads);
    const writerGroups = [...new Set(writers.map((u) => effective(u.unit)))];
    const isrW = writers.some((u) => u.unitKind === "isr"), thW = writers.some((u) => u.unitKind !== "isr");
    const isrR = readers.some((u) => u.unitKind === "isr"), thR = readers.some((u) => u.unitKind !== "isr");
    const isrTouched = units.some((u) => u.unitKind === "isr"), thTouched = units.some((u) => u.unitKind !== "isr");
    const conflict = conflictByName.get(r.name) ?? null;
    const wake = wakeByName.get(r.name) ?? null;
    const multiWriter = writerGroups.length > 1;
    const owner = writerGroups.length === 1 ? writerGroups[0] : writerGroups.length === 0 ? (mainW ? "main:main" : "none") : null;
    const flow = isrW && thW ? "mixed" : isrW ? (thR ? "isr→thread" : "isr↔isr") : (isrR ? "thread→isr" : "thread↔thread");
    // 保护是否对齐：只在跨上下文时有意义。一侧全在临界区、另一侧裸访问 = 单边保护
    const wProt = writers.length > 0 && writers.every((u) => !bareWrite(u));
    const wBare = writers.some(bareWrite);
    const rProt = readers.length > 0 && readers.every((u) => !bareRead(u));
    const rBare = readers.some(bareRead);
    const protectedAll = units.every((u) => !(u.unprotectedKinds ?? []).length);
    const atomicity = r.atomicity ?? "unknown";
    vars.push({
      id: r.variable ?? `name:${r.name}`,
      name: r.name,
      typeName: r.type_name ?? r.typeName ?? null,
      units: units.map((u) => ({ unit: u.unit, kind: u.unitKind, write: writes(u), read: reads(u), bareWrite: bareWrite(u), bareRead: bareRead(u), accesses: (u.accesses ?? []).length })),
      writers: writers.map((u) => u.unit),
      readers: readers.map((u) => u.unit),
      writerGroups,
      owner,
      multiWriter,
      domain: isrW ? "isr" : "thread",
      layer: multiWriter ? 1 : isrW ? 0 : 2,
      flow,
      cross: isrTouched && thTouched,
      pollution: isrW && thW,
      conflict: conflict ? conflict.confidence : null,
      wake: wake ? wake.kind : null,
      protMismatch: isrTouched && thTouched && ((wProt && rBare) || (rProt && wBare)),
      protectedAll,
      nonAtomic: isrTouched && thTouched && (atomicity === "composite" || atomicity === "wide") && !protectedAll,
    });
  }

  const isrs = [...byUnit.values()].filter((n) => n.kind === "isr").sort((a, b) => (a.preempt ?? 99) - (b.preempt ?? 99) || (a.vector ?? 0) - (b.vector ?? 0));
  const tasks = (entries.registrations ?? []).filter((r) => r.kind === "task").map((r) => byUnit.get(r.unitId)).filter(Boolean);
  const cbs = [...byUnit.values()].filter((n) => n.kind === "callback" || (n.kind !== "isr" && n.kind !== "task" && n.kind !== "main"));
  const threads = [];
  for (const t of tasks) { threads.push(t); for (const c of cbs.filter((c) => c.host === t.id)) threads.push(c); }
  for (const c of cbs.filter((c) => !c.host || !tasks.some((t) => t.id === c.host))) threads.push(c);
  if (byUnit.has("main:main")) threads.push(byUnit.get("main:main"));

  const used = new Set(vars.flatMap((v) => v.units.map((u) => u.unit)));
  // 每个单元最严重的问题，给页索引和节点配色
  const worst = {};
  for (const n of byUnit.values()) {
    const mine = vars.filter((v) => v.units.some((u) => u.unit === n.id));
    worst[n.id] = mine.some((v) => v.conflict) ? "conflict"
      : mine.some((v) => v.pollution && v.writers.includes(n.id) && n.kind !== "isr") ? "pollution"
      : mine.some((v) => v.protMismatch) ? "mismatch"
      : mine.length ? "shared" : "idle";
  }
  const count = (f) => vars.filter(f).length;
  return {
    isrs, threads, vars, used: [...used], mainInit, worst,
    flows: Object.fromEntries(Object.keys(FLOW_LABEL).map((k) => [k, count((v) => v.flow === k)])),
    problems: {
      conflict: count((v) => v.conflict),
      pollution: count((v) => v.pollution),
      mismatch: count((v) => v.protMismatch),
      nonAtomic: count((v) => v.nonAtomic),
      wake: count((v) => v.wake),
    },
  };
}

/**
 * 布局：只出坐标。三层变量，每层内部多车道防重叠；变量的 x 以写方为主、读方为辅。
 * options.page 给一个单元 ID 就切成单元页：只留它碰到的变量，分层改成
 * 「它写出去的 / 它和别人都写 / 它只读的」。options.filter 是流向或问题的键。
 */
export function layoutRunMap(model, options = {}) {
  const page = options.page && [...model.isrs, ...model.threads].find((n) => n.id === options.page) || null;
  // focus：选中一个单元时只画它碰到的变量和碰同一批变量的单元，分层含义不变（和 page 的区别：page 换成以它为中心的三层）。
  // 几十个单元、几千条边的全景光靠淡化看不出来，也拖
  const focus = !page && options.focus && [...model.isrs, ...model.threads].find((n) => n.id === options.focus) || null;
  const filter = options.filter ?? null;
  const expandIdle = Boolean(options.expandIdle);
  const passFilter = (v) => !filter || v.flow === filter || (filter === "conflict" && v.conflict) || (filter === "pollution" && v.pollution) || (filter === "mismatch" && v.protMismatch) || (filter === "wake" && v.wake) || (filter === "nonAtomic" && v.nonAtomic);

  let vars, isrs, threads, layerOf, layerLabels, idle = { isr: [], thread: [] };
  const usedSet = new Set(model.used);
  if (page) {
    vars = model.vars.filter((v) => v.units.some((u) => u.unit === page.id) && passFilter(v));
    const involved = new Set(vars.flatMap((v) => v.units.map((u) => u.unit)));
    involved.add(page.id);
    isrs = model.isrs.filter((n) => involved.has(n.id));
    threads = model.threads.filter((n) => involved.has(n.id));
    layerOf = (v) => {
      const me = v.units.find((u) => u.unit === page.id);
      const othersW = v.writers.some((u) => u !== page.id);
      return me.write && !othersW ? 0 : me.write ? 1 : 2;
    };
    layerLabels = [t("Written out by {name} (it is the owner)", { name: page.name }), t("Written by it and by others"), t("Read-only for it")];
  } else if (focus) {
    vars = model.vars.filter((v) => v.units.some((u) => u.unit === focus.id) && passFilter(v));
    const involved = new Set(vars.flatMap((v) => v.units.map((u) => u.unit)));
    involved.add(focus.id);
    isrs = model.isrs.filter((n) => involved.has(n.id));
    threads = model.threads.filter((n) => involved.has(n.id));
    layerOf = (v) => v.layer;
    layerLabels = [t("Written by interrupts (flows down to threads)"), t("Multiple writers · no owner"), t("Written by threads (flows up to interrupts, or between threads)")];
  } else {
    vars = model.vars.filter(passFilter);
    idle = { isr: model.isrs.filter((n) => !usedSet.has(n.id)), thread: model.threads.filter((n) => !usedSet.has(n.id)) };
    isrs = expandIdle ? model.isrs : model.isrs.filter((n) => usedSet.has(n.id));
    threads = expandIdle ? model.threads : model.threads.filter((n) => usedSet.has(n.id));
    layerOf = (v) => v.layer;
    layerLabels = [t("Written by interrupts (flows down to threads)"), t("Multiple writers · no owner"), t("Written by threads (flows up to interrupts, or between threads)")];
  }

  const NW = 118, NH = 40, NGAP = 22, VGAP = 8, PAD = 40, ROW_LABEL = 26, VH = 22, LANE = VH + 6, LAYER_GAP = 26;
  const pos = new Map();
  const idleIsr = !page && idle.isr.length > 0 && !expandIdle;
  const idleTh = !page && idle.thread.length > 0 && !expandIdle;
  const rowWidth = (list, extra) => list.length * (NW + NGAP) + (extra ? 140 : 0);
  const W0 = Math.max(rowWidth(isrs, idleIsr), rowWidth(threads, idleTh), 700);
  // 窄图两排居中好看；宽图（几十个单元）视口只能看到左边一段，两排都靠左对齐，
  // 不然中断那排被居中到几千像素外，打开就是一片空
  const centered = W0 <= 1400;
  const layoutRow = (list, y, extra, key) => {
    let x = centered ? (W0 - rowWidth(list, extra)) / 2 : PAD / 2;
    for (const n of list) { pos.set(n.id, { x: x + NW / 2, y }); x += NW + NGAP; }
    if (extra) pos.set(key, { x: x + 60, y });
  };
  const yIsr = PAD + ROW_LABEL + NH / 2;
  layoutRow(isrs, yIsr, idleIsr, "idle:isr");
  layoutRow(threads, 0, idleTh, "idle:thread");

  const mean = (arr) => arr.reduce((t, x) => t + x, 0) / (arr.length || 1);
  const placed = vars.map((v) => {
    const xs = (list) => list.map((u) => pos.get(u)?.x).filter((x) => x != null);
    const others = page ? v.units.filter((u) => u.unit !== page.id) : null;
    const wx = xs(page ? others.filter((u) => u.write).map((u) => u.unit) : v.writers);
    const rx = xs(page ? others.map((u) => u.unit) : v.readers);
    const x0 = wx.length ? mean(wx) * 0.7 + (rx.length ? mean(rx) : mean(wx)) * 0.3 : rx.length ? mean(rx) : W0 / 2;
    return { v, x0, layer: layerOf(v), w: Math.min(150, v.name.length * 6.2 + 14), x: 0, y: 0 };
  });

  const SLACK = 70;
  let y = yIsr + NH / 2 + 90;
  const layers = [];
  for (let L = 0; L < 3; L++) {
    const list = placed.filter((p) => p.layer === L).sort((a, b) => a.x0 - b.x0);
    const lanes = [];
    for (const p of list) {
      const x0 = Math.min(W0 - p.w / 2, Math.max(p.w / 2, p.x0));
      let lane = lanes.findIndex((c) => c + VGAP <= x0 - p.w / 2 + SLACK);
      if (lane < 0) { lane = lanes.length; lanes.push(-Infinity); }
      p.x = Math.max(x0, lanes[lane] + VGAP + p.w / 2);
      lanes[lane] = p.x + p.w / 2;
      p.y = y + 16 + lane * LANE;
    }
    // 变量都挤在一个写方下面时车道会堆成塔：超过所需行数两倍就改成按 x0 顺序均匀铺满整层宽度
    const need = Math.max(1, Math.ceil(list.reduce((t, p) => t + p.w + VGAP, 0) / (W0 - PAD)));
    if (lanes.length > need * 2) {
      lanes.length = 0;
      const perRow = Math.ceil(list.length / need);
      for (let r = 0; r < need; r++) {
        const row = list.slice(r * perRow, (r + 1) * perRow);
        const total = row.reduce((t, p) => t + p.w, 0);
        const gap = Math.max(VGAP, (W0 - PAD - total) / Math.max(1, row.length - 1));
        let x = PAD / 2;
        for (const p of row) { p.x = x + p.w / 2; p.y = y + 16 + r * LANE; x += p.w + gap; }
        lanes.push(0);
      }
    }
    const h = 16 + Math.max(1, lanes.length) * LANE + 4;
    layers.push({ index: L, top: y, height: h, count: list.length, label: layerLabels[L] });
    y += h + LAYER_GAP;
  }
  const yThread = y - LAYER_GAP + 70 + NH / 2;
  for (const n of threads) pos.get(n.id).y = yThread;
  if (pos.has("idle:thread")) pos.get("idle:thread").y = yThread;

  const cls = (v) => (v.conflict ? "conflict" : v.pollution ? "pollution" : v.wake ? "wake" : v.cross ? "cross" : "shared");
  const edges = [];
  for (const p of placed) {
    const v = p.v;
    for (const u of v.units) {
      const at = pos.get(u.unit);
      if (!at) continue;
      const above = at.y < p.y;
      const from = { x: at.x, y: at.y + (above ? NH / 2 : -NH / 2) };
      const to = { x: p.x, y: above ? p.y : p.y + VH };
      const my = (from.y + to.y) / 2;
      const d = `M ${from.x} ${from.y} C ${from.x} ${my} ${to.x} ${my} ${to.x} ${to.y}`;
      const bad = u.write && v.pollution && u.kind !== "isr";
      if (u.write) edges.push({ var: v.id, unit: u.unit, kind: "write", d, cls: cls(v), bad, bare: u.bareWrite });
      if (u.read) edges.push({ var: v.id, unit: u.unit, kind: u.write ? "both" : "read", d, cls: cls(v), bad: false, bare: u.bareRead });
    }
  }
  const node = (n) => ({ ...n, x: pos.get(n.id).x, y: pos.get(n.id).y, w: NW, h: NH, worst: model.worst[n.id] ?? "idle", writes: vars.filter((v) => v.writers.includes(n.id)).length, touches: vars.filter((v) => v.units.some((u) => u.unit === n.id)).length });
  return {
    width: W0 + PAD,
    height: yThread + NH / 2 + PAD,
    pad: PAD,
    rowLabels: { isr: { x: PAD / 2, y: PAD, text: `${t("Interrupt context (by preemption priority)")}${page && !isrs.length ? ` · ${t("none")}` : ""}` }, thread: { x: PAD / 2, y: yThread - NH / 2 - 8, text: t("Thread context (tasks · each followed by the callbacks it hosts)") } },
    layers: layers.map((l) => ({ ...l, x: PAD / 2 - 6, width: W0 - PAD / 2 + 12 })),
    isrs: isrs.map(node),
    threads: threads.map(node),
    idle: {
      isr: idleIsr ? { ...pos.get("idle:isr"), count: idle.isr.length, w: NW, h: NH } : null,
      thread: idleTh ? { ...pos.get("idle:thread"), count: idle.thread.length, w: NW, h: NH } : null,
    },
    vars: placed.map((p) => ({ id: p.v.id, name: p.v.name, x: p.x, y: p.y, w: p.w, h: VH, layer: p.layer, cls: cls(p.v), flags: { multiWriter: p.v.multiWriter, writerCount: p.v.writerGroups.length, protectedAll: p.v.protectedAll, nonAtomic: p.v.nonAtomic, protMismatch: p.v.protMismatch }, owner: p.v.owner, flow: p.v.flow })),
    edges,
    page: page ? { id: page.id, name: page.name, kind: page.kind } : null,
  };
}
