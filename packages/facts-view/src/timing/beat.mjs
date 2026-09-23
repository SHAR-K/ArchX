// 节拍：一张画布。横轴是毫秒（sleep 实参 × tick，事实），纵轴一行一个任务（轮询顺序）。
//
// 同一刻到期的任务不会并行——协作式里它们按轮询顺序依次执行，所以每个任务在自己的到期时刻
// 向右错开「顺序 − 1」格画。一格是一个时间片的理想化占位（假设每个任务一格），实际耗时静态
// 不可知；细线把方块连回它真正的到期时刻，避免把错开读成时间。
// 方块颜色是事实：会跑的段 / 这一轮走到无界忙等（步数上界不成立）。
//
// 一轮被让出点切成若干段，一段一格，段和一轮共用 sequence.mjs 的口径。它也是 dataDependencies
// 唯一的消费方：执行单元之间「谁写谁读、同轮还是跨轮」，只有把轮询顺序摆在眼前才说得清。
//
// 模型和布局分开：模型给 MCP 和界面共用，布局只出坐标，画法由消费方决定。

import { t } from "../i18n.mjs";
import { buildIndex } from "../graph.mjs";
import { roundSteps } from "./sequence.mjs";

const BUSY = new Set(["busy-var", "busy-hw", "busy-poll", "inner-infinite"]);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export const ORDER_LABEL = { "same-round": "same round", "next-round": "next round", async: "async", preemptive: "preemptive", main: "main context", "unknown-order": "order unknown" };
const ORDER_RANK = { "next-round": 0, "unknown-order": 1, async: 2, preemptive: 3, "same-round": 4, main: 5 };

/** tick 周期：代码里读到的优先，读不到才退回 profile 声明值 */
export function tickOf(view) {
  const facts = view.timeBase ?? [];
  const fromCode = facts.find((x) => x.kind === "systick" && x.value != null && x.basis !== "declared");
  if (fromCode) return { ms: fromCode.value, basis: "code", fact: fromCode };
  return { ms: view.tickMs ?? 1, basis: "declared", fact: facts.find((x) => x.kind === "systick") ?? null };
}

export function buildBeat(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const ast = index.ast ?? {};
  const entries = index.entries ?? {};
  if (!ast.present) return { available: false, reason: "no-ast-facts", hint: t("This scan has no AST-level facts, so the beat cannot be drawn."), rows: [], dataDeps: { rows: [], counts: {} } };
  const sched = view.scheduling ?? "unknown";
  if (sched === "preemptive") return { available: false, reason: "preemptive", hint: t("The profile's scheduling is preemptive: tasks can interrupt each other, so staggering by polling order does not hold."), rows: [], dataDeps: { rows: [], counts: {} } };

  const tick = tickOf(view);
  const position = new Map((view.pollingOrder ?? []).map((unit, i) => [unit, i + 1]));
  const loopsIn = (fnId) => index.loopsByFn.get(fnId) ?? [];
  // 一处让出的标称时长：引擎把 delay 类阻塞调用的实参解析进循环事实
  const waitMs = (fnId, line) => {
    for (const loop of loopsIn(fnId)) {
      for (const call of loop.blockingCalls ?? []) {
        if (call.line !== line && call.location?.line !== line) continue;
        const d = call.duration;
        if (!d || d.value == null) return null;
        return d.unit === "tick" ? d.value * tick.ms : d.value;
      }
    }
    return null;
  };

  const tasks = (entries.registrations ?? []).filter((r) => r.kind === "task");
  // main 也是一行：裸机的超级循环就是那一轮，RTOS 下它是启动后的前台循环。没有它，
  // 没注册任何任务的工程这页就只剩中断条——而裸机主循环正是这个工具的核心受众
  // 只在 main 自己的函数体里有无限循环时才成行：把循环交给 scheduler_run 之类的工程，行是那些任务
  const mainHasLoop = Boolean(entries.main) && (entries.mainSuperloop || loopsIn(entries.main).some((l) => l.infinite && !l.depth));
  const mainRow = mainHasLoop && !tasks.some((r) => r.id === entries.main) ? { unitId: entries.mainUnit ?? "main:main", id: entries.main, kind: "main" } : null;
  const rowFor = (reg) => {
    const fn = index.fnById.get(reg.id);
    const rm = ast.runModes?.[reg.unitId] ?? null;
    // 一轮的范围和 buildRound 同一个口径：有无限循环就是它的循环体，没有就是整个函数体
    const mainLoop = loopsIn(reg.id).filter((l) => l.infinite).sort((a, b) => a.depth - b.depth || a.location.line - b.location.line)[0] ?? null;
    const range = mainLoop ? { from: mainLoop.location.line, to: mainLoop.endLine } : { from: fn?.line ?? 0, to: fn?.endLine ?? Infinity };
    const steps = fn ? roundSteps(view, reg.id, range.from, range.to, { index }) : [];
    // 段 = 被顶层让出点切开的步骤序列；分支里的提前让出是同一段的另一条走法，只计数不成段
    const segments = [];
    let current = { steps: [] };
    let alternatives = 0;
    for (const st of steps) {
      if (st.type === "wait") {
        if (!st.depth) { current.exit = { callee: st.callee, kind: st.kind, line: st.line, fn: st.fn, wait: waitMs(st.fn, st.line) }; segments.push(current); current = { steps: [] }; }
        else alternatives += 1;
        continue;
      }
      if (st.type === "call" || st.type === "self") current.steps.push(st);
    }
    segments.push(current);
    const kept = segments.filter((p) => p.steps.length || p.exit);
    const seq = (kept.length ? kept : [{ steps: [] }]).map((p) => {
      let calls = 0, bounded = 0, unbounded = 0;
      for (const st of p.steps) {
        calls += 1;
        for (const l of st.loops ?? []) {
          if (l.fromMacro || l.class === "main") continue;
          if (BUSY.has(l.class) || l.infinite) { unbounded += 1; continue; }
          bounded += (l.iterations?.max ?? 1) * Math.max(1, (l.callsInBody ?? []).length);
        }
      }
      return { calls: Math.max(1, calls + bounded), rawCalls: calls, bounded, unbounded, wait: p.exit?.wait ?? null, callee: p.exit?.callee ?? null, kind: p.exit?.kind ?? null };
    });
    // 延时实参：画布上跟在任务名后面的标签，点它跳到那一行
    const delays = [];
    for (const b of rm?.evidence?.blockingCalls ?? []) {
      if (!b.duration) continue;
      const key = `${b.duration.value}@${b.location?.path}:${b.location?.line}`;
      if (delays.some((d) => d.key === key)) continue;
      delays.push({ key, callee: b.callee, value: b.duration.value ?? null, unit: b.duration.unit ?? "ms", argument: b.duration.argument ?? null, resolvedFrom: b.duration.resolvedFrom ?? null, path: b.location?.path ?? null, line: b.location?.line ?? null });
    }
    const mode = rm?.mode ?? "unknown";
    // 周期：引擎给了单一值就用它；一轮里有多个不同延时（裸机主循环常见）时，引擎不敢定，
    // 这里按顶层让出点的实参之和给一个下界——每段的让出都在同一轮里走完才算
    let period = rm?.periodMs ?? null;
    let periodBasis = period != null ? "engine" : null;
    const yields = seq.filter((s) => s.callee);
    if (period == null && yields.length && yields.every((s) => s.wait != null)) { period = yields.reduce((n, s) => n + s.wait, 0); periodBasis = "sum-of-yields"; }
    // 没有定时器的任务每圈都被调度器叫一次：单次 / 忙轮询都是；周期未知的是让出方式不明的
    const always = period == null && (mode === "one-shot" || mode === "busy-poll");
    const suspend = (view.taskControls ?? []).find((c) => c.kind === "suspend" && (c.target === reg.id || c.targetUnit === reg.unitId)) ?? null;
    return {
      id: reg.unitId, entry: reg.id, kind: reg.kind ?? "task", name: index.nameOf(reg.id), file: index.fileOf(reg.id),
      order: position.get(reg.unitId) ?? null,
      mode, period, periodBasis, always, delays,
      seq, alternatives,
      unbounded: seq.reduce((n, s) => n + s.unbounded, 0),
      work: seq.reduce((n, s) => n + s.calls, 0),
      suspend: suspend ? { callee: suspend.callee ?? null, path: suspend.location?.path ?? null, line: suspend.location?.line ?? null } : null,
    };
  };
  const rows = [...tasks.map(rowFor), ...(mainRow ? [rowFor(mainRow)] : [])]
    .sort((a, b) => (a.kind === "main") - (b.kind === "main") || (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));

  const periods = rows.filter((r) => r.period != null).map((r) => r.period);
  const lcm = periods.length ? periods.reduce((p, q) => (p * q) / gcd(p, q), 1) : 0;

  // 事实条：一个通用标签一个值，有出处的可点跳源码；取不到值的不出现
  const facts = view.timeBase ?? [];
  const of = (kind) => facts.filter((x) => x.kind === kind);
  const chips = [];
  const chip = (label, value, at, bad = false) => { if (value != null) chips.push({ label, value, path: at?.path ?? null, line: at?.line ?? null, bad }); };
  const reg = tasks.find((x) => (x.registrars ?? []).length);
  const regAt = reg ? { path: index.fileOf(reg.registrars[0].id), line: reg.registrars[0].line ?? null } : null;
  chip(`scheduling${reg?.rule ? ` · ${reg.rule}` : ""}`, sched === "unknown" ? null : sched, regAt);
  const clock = of("core-clock")[0];
  const clockDef = clock ? (view.globals ?? []).find((g) => g.name === clock.name)?.definition ?? null : null;
  chip(clock?.name ?? "SystemCoreClock", clock?.value ? (clock.value >= 1e6 ? `${+(clock.value / 1e6).toFixed(3)} MHz` : `${clock.value} Hz`) : null, clockDef ?? clock?.location ?? null);
  const systick = of("systick")[0];
  chip(systick?.name ?? "tick_ms", tick.ms != null ? `${tick.ms} ms${tick.basis === "declared" ? ` (${t("declared by profile")})` : ""}` : null, systick?.location ?? null);
  const counter = of("tick-counter")[0];
  chip(t("time base counter"), counter?.name ?? null, counter?.location ?? null);
  const waits = of("timeout-loop");
  if (waits.length === 1) chip(t("timeout bound"), waits[0].value != null ? `${waits[0].value} tick` : null, waits[0].location ?? null);
  else if (waits.length > 1) chip(t("timeout loops"), String(waits.length), waits[0].location ?? null);
  const suspends = (view.taskControls ?? []).filter((c) => c.kind === "suspend");
  if (suspends.length) chip(t("suspendable tasks"), String(new Set(suspends.map((c) => c.targetUnit ?? c.target ?? c.argument)).size), suspends[0].location ?? null);
  chip(t("shortest period"), periods.length ? `${Math.min(...periods)} ms` : null, null);
  const works = rows.map((r) => r.work);
  chip(t("steps per round"), works.length ? `${Math.min(...works)}–${Math.max(...works)}` : null, null);
  chip(t("hyperperiod"), lcm ? (lcm >= 1000 ? `${lcm / 1000} s` : `${lcm} ms`) : null, null);
  const busy = rows.filter((r) => r.always).reduce((n, r) => n + r.unbounded, 0);
  if (busy) chip(t("runs every round · unbounded busy-wait"), String(busy), null, true);

  // 执行单元之间的数据依赖：写方 → 读方 · 变量 · 顺序。顺序码的固定对应见 ORDER_LABEL
  const regionUnits = new Set([...(entries.units ?? []).map((u) => u.id), entries.mainUnit ?? "main:main"]);
  const dd = (view.dataDependencies ?? []).filter((d) => regionUnits.has(d.from) || regionUnits.has(d.to));
  const counts = {};
  for (const d of dd) counts[d.order] = (counts[d.order] ?? 0) + 1;
  const dataDeps = {
    counts,
    rows: dd.slice().sort((x, y) => (ORDER_RANK[x.order] ?? 9) - (ORDER_RANK[y.order] ?? 9) || String(x.name ?? "").localeCompare(String(y.name ?? ""))).map((d) => ({
      from: d.from, to: d.to, fromKind: d.fromKind ?? String(d.from).split(":")[0], toKind: d.toKind ?? String(d.to).split(":")[0],
      order: d.order, label: t(ORDER_LABEL[d.order] ?? d.order),
      fromPosition: d.fromPosition ?? null, toPosition: d.toPosition ?? null,
      resources: (d.resources ?? []).map((r) => ({ name: r.name, variable: r.variable ?? null, ...index.varAt(r.variable) })),
    })),
  };

  const isrs = (entries.isrs ?? []).filter((i) => !i.kernel && (index.calleesOf.get(i.id) ?? []).length > 0).length;
  return {
    available: true,
    scheduling: sched,
    tick,
    rows,
    lcm,
    minPeriod: periods.length ? Math.min(...periods) : null,
    unplaced: rows.filter((r) => r.order == null && r.kind !== "main").length,
    isrs,
    chips,
    dataDeps,
    pollingOrder: (view.pollingOrder ?? []).map((unit, i) => ({ position: i + 1, unit, name: String(unit).split(":").slice(1).join(":") })),
  };
}

/**
 * 布局：只出坐标。画布永远一页宽，缩放只改时间轴的跨度（span），左边永远是任务名。
 * options.width 是容器像素宽；t0 / span 是时间视窗（ms）。
 */
export function layoutBeat(model, options = {}) {
  const LBL = 236, ROW = 18, PAD = 12, HEAD = 34, ISR = 22, RPAD = 24, CELL = 7;
  const width = Math.max(720, options.width ?? 900);
  const plotW = width - LBL - RPAD;
  const total = model.lcm || 200;
  const span = Math.max(4, Math.min(total, options.span ?? total));
  const t0 = Math.max(0, Math.min(options.t0 ?? 0, total - span));
  const t1 = t0 + span;
  const pxPerMs = plotW / span;
  const mx = (ms) => LBL + (ms - t0) * pxPerMs;
  const right = LBL + plotW;
  const gridTop = PAD + HEAD + ISR;
  const rowsH = model.rows.length * ROW;
  const height = gridTop + rowsH + PAD;

  const stepMs = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((v) => v * pxPerMs >= 60) ?? 10000;
  const ticks = [];
  for (let t = Math.ceil(t0 / stepMs) * stepMs; t <= t1 + 0.001; t += stepMs) ticks.push({ x: mx(t), y1: gridTop - 12, y2: gridTop + rowsH, label: t >= 1000 ? `${+(t / 1000).toFixed(3)} s` : `${+t.toFixed(t < 10 ? 1 : 0)} ms` });

  const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const rows = model.rows.map((row, i) => {
    const y = gridTop + i * ROW;
    const dx = ((row.order ?? model.rows.length) - 1) * CELL;
    const out = { id: row.id, entry: row.entry, name: row.name, order: row.order, y, always: row.always, period: row.period, mode: row.mode, unbounded: row.unbounded > 0, label: { x: PAD, y: y + 12, text: `${row.order ?? "–"}  ${short(row.name, 22)}` }, lane: { x1: LBL, x2: mx(t1), y: y + ROW - 1 }, cells: [], yields: [], leads: [], band: null, note: null, chips: [], suspend: null };
    // 延时实参标签：右对齐贴在名字后面
    const list = row.delays.slice(0, 4);
    if (!list.length) out.note = { x: LBL - 6, y: y + 12, text: row.always ? t("every round") : "?" };
    let cx = LBL - 6;
    for (let k = list.length - 1; k >= 0; k--) {
      const d = list[k];
      const label = d.value == null ? t("runtime") : d.value >= 1000 ? `${d.value / 1000}s` : `${d.value}${d.unit === "ms" ? "ms" : ""}`;
      const w = 9 + label.length * 6.4;
      cx -= w;
      out.chips.push({ x: cx, y: y + 3, w, h: ROW - 7, label, title: `${d.callee}(${d.argument ?? ""})${d.resolvedFrom ? ` → ${d.resolvedFrom}` : ""} · ${String(d.path ?? "").split("/").pop()}:${d.line ?? ""}`, path: d.path, line: d.line });
      cx -= 3;
    }
    if (row.suspend) out.suspend = { x: PAD + (String(row.order ?? "–").length + 2 + short(row.name, 16).length) * 6.02 + 5, y: y + 12, ...row.suspend };
    // 一轮 = 被让出点切开的若干段，一段一格；格后那道竖线就是让出（实线 = sleep，虚线 = 纯 yield）
    const round = (x0, cellW, at, t) => {
      row.seq.forEach((seg, k) => {
        const x = x0 + k * cellW;
        if (x >= right) return;
        const w = Math.max(1.5, Math.min(cellW - 1.6, right - x));
        out.cells.push({ x, y: y + 3, w, h: ROW - 7, unbounded: seg.unbounded > 0, t, index: k, count: row.seq.length, calls: seg.rawCalls, bounded: seg.bounded, unboundedCount: seg.unbounded, wait: seg.wait, callee: seg.callee });
        if (x + w + 1.2 < right) out.yields.push({ x: x + w + 0.8, y1: y + 2, y2: y + ROW - 4, sleep: seg.wait != null });
      });
      if (at != null && x0 > at) out.leads.push({ x1: at, x2: x0, y: y + ROW / 2 });
    };
    const band = (from, title) => { out.band = { x: from, y: y + 3, w: Math.max(2, right - from), h: ROW - 7, title }; };
    if (row.always) { band(LBL + dx, t("Runs every round; no timer")); round(LBL + dx, CELL, null, null); return out; }
    if (row.period == null) { out.note = { x: LBL + 4, y: y + 12, text: t("period unknown · click the row for the order of one round"), inPlot: true }; return out; }
    const first = Math.ceil(t0 / row.period) * row.period;
    if (row.period * pxPerMs < 3) { band(Math.max(LBL, mx(first) + dx), t("{period} ms · at this scale due times are denser than one cell", { period: row.period })); return out; }
    // 段挤不进一个周期时把格压窄，宁可窄也不让相邻两轮叠在一起
    const cellW = Math.min(CELL, Math.max(2, (row.period * pxPerMs) / row.seq.length));
    for (let t = first; t <= t1; t += row.period) {
      const at = mx(t), x = at + dx;
      if (x > right) continue;
      round(x, cellW, at, t);
    }
    return out;
  });

  return {
    width, height, t0, t1, span, total, pxPerMs, stepMs,
    header: { x: PAD, y: PAD + 10, text: t("due time = sleep argument × tick {tick} ms · horizontal offset = polling order · scroll sideways to zoom", { tick: model.tick.ms }) },
    isrBand: { x: LBL, y: PAD + 16, w: plotW, h: ISR - 12, text: t("Interrupts {n} · position not knowable statically", { n: model.isrs }), tx: LBL + 4, ty: PAD + 27 },
    ticks,
    rows,
  };
}
