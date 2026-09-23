// 抢占式的时间图：纵轴按优先级一行一个任务（最高在上），横轴毫秒。
//
// 节拍图（beat.mjs）的横轴假设是协作式的——任务按轮询顺序首尾相接。抢占式里这条不成立，
// 但另外三件事是静态可读的事实：谁的优先级高（能打断谁）、谁多久到期一次（延时实参 × tick）、
// 谁在等什么（队列 / 信号量，以及谁在另一头写）。这张图只画这三件，不假装知道谁先跑完。
// 同一刻到期的任务按优先级先后执行，所以低优先级的方块向右错开「比它高且同刻到期的个数」格——
// 那是抢占的形状，不是时间。
//
// 优先级数字的方向由内核定：FreeRTOS / CMSIS-RTOS2 数字大的高，Zephyr 反过来。这里按命中的
// 规则前缀判，写进 order 字段，界面上说出来。
//
// 模型和布局分开：模型给 MCP 和界面共用，布局只出坐标。

import { t } from "../i18n.mjs";
import { buildIndex } from "../graph.mjs";
import { tickOf } from "./beat.mjs";

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const MODE_NOTE = {
  "event-driven": "waits for an event; runs when it is signalled and nothing higher is ready",
  "busy-poll": "never blocks; runs whenever nothing higher is ready",
  "one-shot": "runs once",
  unknown: "period unknown",
};

export function buildPreemptive(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const ast = index.ast ?? {};
  const entries = index.entries ?? {};
  const sched = view.scheduling ?? "unknown";
  const off = (reason, hint) => ({ available: false, reason, hint, rows: [], isrs: [], dataDeps: [] });
  if (sched !== "preemptive") return off("not-preemptive", t("The scheduling model is not preemptive; the beat shows the round instead."));
  if (!ast.present) return off("no-ast-facts", t("This scan has no AST-level facts, so the preemption picture cannot be drawn."));

  const tick = tickOf(view);
  const tasks = (entries.registrations ?? []).filter((r) => r.kind === "task");
  // 优先级数字的方向：Zephyr 小的高，其余大的高
  const order = tasks.some((r) => String(r.rule ?? "").startsWith("zephyr.")) ? "ascending" : "descending";
  const wakes = ast.wakeRelations ?? [];
  const toMs = (d) => (d == null || d.value == null ? null : d.unit === "tick" ? d.value * tick.ms : d.unit === "s" ? d.value * 1000 : d.unit === "us" ? d.value / 1000 : d.value);

  const rows = tasks.map((reg) => {
    const rm = ast.runModes?.[reg.unitId] ?? null;
    const evidence = rm?.evidence ?? {};
    const blocking = [...(evidence.blockingCalls ?? []), ...(evidence.blockingViaCallee?.call ? [evidence.blockingViaCallee.call] : [])];
    const site = (b) => ({ callee: b.callee, rule: b.rule ?? null, path: b.location?.path ?? null, line: b.location?.line ?? null });
    const waits = blocking.filter((b) => b.kind === "wait").map(site);
    const delays = blocking.filter((b) => b.kind === "delay").map((b) => ({ ...site(b), ms: toMs(b.duration), argument: b.duration?.argument ?? null }));
    // 谁叫醒它：它消费的通知标志，以及标志的写方单元
    const wakeBy = wakes
      .filter((w) => (w.consumers ?? []).some((c) => c.unit === reg.unitId))
      .map((w) => ({ name: w.name, kind: w.kind, producers: [...new Set((w.producers ?? []).map((p) => p.unit))] }));
    const suspend = (view.taskControls ?? []).find((c) => c.kind === "suspend" && (c.target === reg.id || c.targetUnit === reg.unitId)) ?? null;
    const p = reg.priority ?? null;
    return {
      id: reg.unitId,
      entry: reg.id,
      name: index.nameOf(reg.id),
      file: index.fileOf(reg.id),
      rule: reg.rule ?? null,
      priority: p ? { value: p.value ?? null, symbol: p.symbol ?? null, argument: p.argument ?? null, basis: p.basis ?? "unresolved", path: p.at?.path ?? null, line: p.at?.line ?? null } : null,
      mode: rm?.mode ?? "unknown",
      modeNote: MODE_NOTE[rm?.mode] ?? MODE_NOTE.unknown,
      confidence: rm?.confidence ?? null,
      period: rm?.periodMs ?? null,
      waits,
      delays,
      wakeBy,
      suspend: suspend ? { callee: suspend.callee ?? null, path: suspend.location?.path ?? null, line: suspend.location?.line ?? null } : null,
      rank: null,
    };
  });
  const value = (r) => r.priority?.value;
  rows.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (order === "descending" ? bv - av : av - bv) || a.name.localeCompare(b.name);
  });
  // rank：1 = 最高。同优先级同 rank（它们之间靠时间片轮转，静态说不清先后）
  let rank = 0, last = null;
  for (const r of rows) {
    if (value(r) == null) { r.rank = null; continue; }
    if (value(r) !== last) { rank += 1; last = value(r); }
    r.rank = rank;
  }

  const isrs = (entries.isrs ?? [])
    .filter((i) => !i.kernel && (index.calleesOf.get(i.id) ?? []).length > 0)
    .map((i) => ({ id: i.unitId, entry: i.id, name: index.nameOf(i.id), preempt: i.priority?.preempt ?? null, vector: i.vector ?? null }))
    .sort((a, b) => (a.preempt ?? 99) - (b.preempt ?? 99) || (a.vector ?? 0) - (b.vector ?? 0));

  const periods = rows.filter((r) => r.period != null).map((r) => r.period);
  const lcm = periods.length ? periods.reduce((p, q) => (p * q) / gcd(p, q), 1) : 0;
  const unitIds = new Set(rows.map((r) => r.id));
  const dataDeps = (view.dataDependencies ?? [])
    .filter((d) => d.order === "preemptive" && unitIds.has(d.from) && unitIds.has(d.to))
    .map((d) => ({ from: d.from, to: d.to, resources: (d.resources ?? []).map((r) => r.name) }));

  const known = rows.filter((r) => value(r) != null).length;
  const chips = [];
  const chip = (label, val, at, bad = false) => { if (val != null) chips.push({ label, value: val, path: at?.path ?? null, line: at?.line ?? null, bad }); };
  chip(t("scheduling"), t("preemptive"), null);
  chip(t("priority order"), order === "descending" ? t("higher number = higher priority") : t("lower number = higher priority"), null);
  chip(t("priorities known"), `${known} / ${rows.length}`, null, known < rows.length);
  chip(t("shortest period"), periods.length ? `${Math.min(...periods)} ms` : null, null);
  chip(t("hyperperiod"), lcm ? (lcm >= 1000 ? `${lcm / 1000} s` : `${lcm} ms`) : null, null);
  chip(t("event-driven tasks"), String(rows.filter((r) => r.mode === "event-driven").length), null);
  chip(t("interrupts with a body"), String(isrs.length), null);

  return {
    available: true,
    scheduling: sched,
    order,
    tick,
    rows,
    isrs,
    lcm,
    minPeriod: periods.length ? Math.min(...periods) : null,
    chips,
    dataDeps,
    counts: { tasks: rows.length, known, periodic: periods.length, eventDriven: rows.filter((r) => r.mode === "event-driven").length, unresolved: rows.length - known },
    basis: t("Priority comes from the create call or the attribute struct; period is the delay argument × tick; who wakes whom comes from notification flags. None of this is a measurement: it says who can interrupt whom, not who did."),
  };
}

/**
 * 布局：只出坐标。行按优先级（rank）从高到低；周期任务在到期点画一格，同刻到期的按优先级向右错开；
 * 事件驱动 / 忙轮询 / 未知周期的画一条带子加说明。
 */
export function layoutPreemptive(model, options = {}) {
  const LBL = 250, ROW = 20, PAD = 12, HEAD = 34, ISR = 22, RPAD = 24, CELL = 7;
  const width = Math.max(720, options.width ?? 900);
  const plotW = width - LBL - RPAD;
  const total = model.lcm || 200;
  const span = Math.max(4, Math.min(total, options.span ?? total));
  const t0 = Math.max(0, Math.min(options.t0 ?? 0, total - span));
  const t1 = t0 + span;
  const pxPerMs = plotW / span;
  const mx = (ms) => LBL + (ms - t0) * pxPerMs;
  const gridTop = PAD + HEAD + ISR;
  const rowsH = model.rows.length * ROW;
  const height = gridTop + rowsH + PAD;

  const stepMs = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((v) => v * pxPerMs >= 60) ?? 10000;
  const ticks = [];
  for (let tm = Math.ceil(t0 / stepMs) * stepMs; tm <= t1 + 0.001; tm += stepMs) {
    ticks.push({ x: mx(tm), y1: gridTop - 12, y2: gridTop + rowsH, label: tm >= 1000 ? `${+(tm / 1000).toFixed(3)} s` : `${+tm.toFixed(tm < 10 ? 1 : 0)} ms` });
  }
  const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  // 同刻到期的更高优先级任务数：低的向右错开那么多格
  const dueAt = (row, tm) => row.period != null && Math.abs(tm / row.period - Math.round(tm / row.period)) < 1e-9;
  const higherDue = (i, tm) => model.rows.slice(0, i).filter((r) => r.rank != null && r.rank < (model.rows[i].rank ?? Infinity) && dueAt(r, tm)).length;

  const rows = model.rows.map((row, i) => {
    const y = gridTop + i * ROW;
    const prio = row.priority ? (row.priority.value != null ? String(row.priority.value) : row.priority.symbol ?? "?") : "?";
    const out = {
      id: row.id, entry: row.entry, name: row.name, rank: row.rank, mode: row.mode, period: row.period, y,
      label: { x: PAD, y: y + 13, text: `${row.rank ?? "–"}  ${short(row.name, 20)}` },
      prio: { x: LBL - 8, y: y + 13, text: `p ${prio}`, path: row.priority?.path ?? null, line: row.priority?.line ?? null, unresolved: row.priority?.value == null },
      lane: { x1: LBL, x2: mx(t1), y: y + ROW - 1 },
      cells: [], leads: [], band: null, note: null,
      suspend: row.suspend ? { x: PAD + (String(row.rank ?? "–").length + 2 + short(row.name, 20).length) * 6.02 + 5, y: y + 13, ...row.suspend } : null,
    };
    if (row.period == null) {
      const text = row.mode === "event-driven"
        ? `${t("waits on")} ${[...new Set(row.waits.map((w) => w.callee))].slice(0, 3).join(", ") || "?"}${row.wakeBy.length ? ` · ${t("woken by")} ${[...new Set(row.wakeBy.flatMap((w) => w.producers))].map((u) => String(u).split(":").pop()).slice(0, 3).join(", ")}` : ""}`
        : t(row.modeNote);
      out.band = { x: LBL, y: y + 4, w: Math.max(0, mx(t1) - LBL), h: ROW - 9, kind: row.mode === "busy-poll" ? "poll" : row.mode === "event-driven" ? "event" : "unknown", title: text };
      out.note = { x: LBL + 6, y: y + 13, text };
      return out;
    }
    const first = Math.ceil(t0 / row.period) * row.period;
    if (row.period * pxPerMs < 3) {
      out.band = { x: Math.max(LBL, mx(first)), y: y + 4, w: Math.max(0, mx(t1) - Math.max(LBL, mx(first))), h: ROW - 9, kind: "dense", title: t("{period} ms · at this scale due times are denser than one cell", { period: row.period }) };
      return out;
    }
    for (let tm = first; tm <= t1; tm += row.period) {
      const dx = higherDue(i, tm) * CELL;
      const x = mx(tm);
      if (dx) out.leads.push({ x1: x, x2: x + dx, y: y + ROW / 2 });
      out.cells.push({ x: x + dx, y: y + 4, w: CELL, h: ROW - 9, t: tm, deferred: dx / CELL });
    }
    return out;
  });

  const isrBand = { x: LBL, y: PAD + HEAD, w: plotW, h: ISR - 6, tx: LBL + 6, ty: PAD + HEAD + 12,
    text: model.isrs.length ? t("{n} interrupts above every task · {m} with a known preempt priority · positions statically unknown", { n: model.isrs.length, m: model.isrs.filter((i) => i.preempt != null).length }) : t("no interrupt with a body") };
  return { width, height, t0, t1, span, total, pxPerMs, ticks, rows, isrBand,
    header: { x: PAD, y: PAD + 14, text: t("Preemption: rows by priority (highest first); a lower task due at the same instant is pushed right by one cell per higher task") } };
}
