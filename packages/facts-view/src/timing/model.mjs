// 顺序与时间主题的派生层：先后关系、等待点、周期。
//
// 时间是这套事实里最容易被高估的一层，所以口径要先说清楚：
//   引擎知道的是「代码里写了什么数字」和「哪里会让出」，不知道任何一段代码真实跑多久。
//   周期来自延时实参乘以 tick 周期，是这个任务最快能有多快，不是它实际多久跑一次；
//   忙等循环卡住的是整个调度，但卡多久取决于外部条件，静态看不出来。
//
// 循环按它对时序的意义分类，分类只用事实：宏展开、无限、有没有阻塞点、条件里读的是什么。
// 「忙等变量」那一档要和并发事实对照——条件读的变量是不是中断会写的，这决定它会不会醒。

import { t } from "../i18n.mjs";
import { buildBeat } from "./beat.mjs";
import { buildPreemptive } from "./preemptive.mjs";
import { buildIndex } from "../graph.mjs";

export const LOOP_CLASSES = {
  main: { label: "main loop", tone: "main", hint: "The infinite loop in an execution unit's root function: one round = one pass of its body" },
  "inner-infinite": { label: "inner infinite", tone: "busy", hint: "A while(1) inside a callee: once entered it never returns, so the calling step never ends" },
  wait: { label: "yield-wait", tone: "wait", hint: "The loop body has a blocking point: it waits for a condition and yields once per turn, so this step may span several scheduling periods" },
  "busy-var": { label: "busy-wait on variable", tone: "busy", hint: "No yield; the condition reads a shared variable written by an interrupt: the whole schedule stalls here until the interrupt changes it" },
  "busy-hw": { label: "busy-wait on hardware", tone: "busy", hint: "No yield; the condition polls a register or peripheral status: the whole schedule stalls here until the hardware is ready" },
  "busy-poll": { label: "busy-poll", tone: "busy", hint: "No yield; the condition calls a function for status: the whole schedule stalls here until the return value changes" },
  iter: { label: "iteration", tone: "iter", hint: "An ordinary counted or iterating loop; for timing it only means repeat a few times" },
  macro: { label: "macro expansion", tone: "macro", hint: "A do-while expanded from a macro such as protothreads — not a hand-written loop; handled by the macro semantics" },
};

const MODE_LABEL = { periodic: "periodic", "busy-poll": "busy-poll", "event-driven": "event-driven", "one-shot": "one-shot", unknown: "unknown" };

// 循环分类器。「一轮展开」那边要按同一套规则认循环，所以规则单独一份、两边共用——
// 复制一份出去，两个视图迟早会对同一个 while 给出不同的说法。
export function loopClassifier(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const ast = index.ast;
  const entries = index.entries ?? {};
  const cfLoopByKey = new Map();
  for (const b of ast.controlFlow ?? []) if (["while", "for", "do"].includes(b.kind)) cfLoopByKey.set(`${b.function}:${b.location.line}`, b);
  const rootFns = new Set([
    ...(entries.registrations ?? []).filter((r) => r.kind === "task").map((r) => r.id),
    ...(entries.isrs ?? []).map((i) => i.id),
    entries.main,
  ].filter(Boolean));

  const conditionOf = (loop) => cfLoopByKey.get(`${loop.function}:${loop.location.line}`)?.condition ?? null;
  // 条件里提到 timeout / tick / retry / count 这类名字：可能有上限，但引擎不保证
  const mayTimeOut = (loop) => /timeout|tick|systick|retry|count/i.test(conditionOf(loop) ?? "");

  const classify = (loop) => {
    if (loop.fromMacro) return "macro";
    if (loop.infinite) return loop.depth === 0 && rootFns.has(loop.function) ? "main" : "inner-infinite";
    if ((loop.blockingCalls ?? []).length) return "wait";
    const condition = conditionOf(loop) ?? "";
    const body = condition.replace(/^for\s*\(([^;]*);([^;]*);.*$/s, "$2");
    const identifiers = body.match(/[A-Za-z_]\w*/g) ?? [];
    // 条件读的变量是不是中断会写的：这决定忙等会不会醒，是并发事实说了算，不是猜的
    if (identifiers.some((n) => {
      const resource = index.sharedByName.get(n);
      return resource && (resource.units ?? []).some((u) => u.unitKind === "isr" && (u.kinds ?? []).some((k) => k !== "read"));
    })) return "busy-var";
    if (/\b[A-Z][A-Z0-9_]{2,}\s*\(/.test(body) || (/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(body) && /[&|]/.test(body))) return "busy-hw";
    const stripped = body.replace(/(sizeof|offsetof|_countof|ARRAY_SIZE)\s*\([^)]*\)/g, "");
    if (/[A-Za-z_]\w*\s*\(/.test(stripped) && !/^\s*(\d+|true|1)\s*$/.test(body)) return "busy-poll";
    return "iter";
  };

  // 一个函数在某段行区间里的循环，带上分类、条件和有没有上限
  const loopsOfFn = (fnId, from, to) => (index.loopsByFn.get(fnId) ?? [])
    .filter((l) => l.location.line >= (from ?? 0) && l.location.line <= (to ?? Infinity))
    .map((l) => ({ ...l, class: classify(l), condition: conditionOf(l), mayTimeOut: mayTimeOut(l) }));

  return { classify, conditionOf, mayTimeOut, loopsOfFn, rootFns };
}

export function buildTiming(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const ast = index.ast;
  if (!ast.present) {
    return { theme: "timing", available: false, reason: "no-ast-facts", hint: t("This scan has no AST-level facts, so loops and yield points are invisible."), units: [], loops: [] };
  }

  const entries = index.entries ?? {};
  const { classify, conditionOf, mayTimeOut } = loopClassifier(view, { index });

  const loops = (ast.loops ?? []).filter((l) => index.inRegion(index.fileOf(l.function) ?? "")).map((l) => {
    const kind = classify(l);
    const condition = conditionOf(l);
    return {
      id: index.loopId(l),
      function: l.function,
      name: index.nameOf(l.function),
      file: index.fileOf(l.function),
      line: l.location.line,
      endLine: l.endLine ?? null,
      loopKind: l.kind,
      infinite: Boolean(l.infinite),
      depth: l.depth ?? 0,
      class: kind,
      condition,
      mayTimeOut: mayTimeOut(l),
      blocking: (l.blockingCalls ?? []).map((c) => ({ callee: c.callee, kind: c.kind, via: c.via, line: c.line ?? null, duration: c.duration ?? null })),
      iterations: l.iterations ?? null,
      exits: (l.exits ?? []).map((e) => ({ kind: e.kind, line: e.line })),
    };
  });

  // 执行单元的节奏：运行模式与周期都来自引擎，周期是「最快能有多快」的下界
  const unitOf = (fnId) => {
    const reg = (entries.registrations ?? []).find((r) => r.id === fnId);
    if (reg?.unitId) return reg.unitId;
    const isr = (entries.isrs ?? []).find((i) => i.id === fnId);
    if (isr?.unitId) return isr.unitId;
    return fnId === entries.main ? entries.mainUnit : null;
  };
  // main 也是一个执行单元：引擎的 units 里没有它，但程序从那儿开始，启动路径也有节奏，
  // 而且启动阶段的忙等最容易被忽略。补进来，排在最后
  const unitList = [...(entries.units ?? [])];
  if (entries.main && !unitList.some((u) => (u.entry ?? u.entrySymbolId) === entries.main)) {
    unitList.push({ id: entries.mainUnit ?? "main:main", kind: "main", entry: entries.main });
  }
  const units = unitList.map((u) => {
    const mode = ast.runModes?.[u.id] ?? null;
    const rootLoops = loops.filter((l) => index.reachOf(u.entry ?? u.entrySymbolId ?? "").has(l.function));
    return {
      id: `unit:${u.id}`,
      unit: u.id,
      kind: u.kind,
      entry: u.entry ?? u.entrySymbolId ?? null,
      name: index.nameOf(u.entry ?? u.entrySymbolId ?? ""),
      file: index.fileOf(u.entry ?? u.entrySymbolId ?? ""),
      mode: mode?.mode ?? null,
      modeLabel: MODE_LABEL[mode?.mode] ?? null,
      confidence: mode?.confidence ?? null,
      periodMs: mode?.periodMs ?? null,
      // 一轮里能碰到的忙等：真正会卡住调度的那些
      busyLoops: rootLoops.filter((l) => LOOP_CLASSES[l.class]?.tone === "busy").length,
      waitLoops: rootLoops.filter((l) => l.class === "wait").length,
      basis: mode?.evidence ?? null,
    };
  }).sort((a, b) => {
    const rank = (k) => (k === "isr" ? 0 : k === "main" ? 2 : 1);
    return rank(a.kind) - rank(b.kind);
  });

  const byClass = {};
  for (const l of loops) byClass[l.class] = (byClass[l.class] ?? 0) + 1;

  return {
    theme: "timing",
    available: true,
    basis: t("The engine knows what numbers the code wrote and where it yields; it does not know how long any code actually runs. A period is the delay argument times the tick — a lower bound, not a measurement"),
    scheduling: view.scheduling ?? "unknown",
    tickMs: view.tickMs ?? null,
    timeBase: view.timeBase ?? [],
    pollingOrder: (view.pollingOrder ?? []).map((id, i) => ({ position: i + 1, unit: id, name: id.split(":").slice(1).join(":") })),
    // 节拍：横轴毫秒、纵轴一行一个任务的模型，也是 dataDependencies 的消费方
    beat: buildBeat(view, { index }),
    // 抢占式：按优先级分行的时间图；协作式 / 未知时 available 为 false，节拍图顶上
    preemptive: buildPreemptive(view, { index }),
    units,
    loops,
    loopClasses: LOOP_CLASSES,
    counts: { loops: loops.length, byClass, yieldLocals: (view.yieldLocals ?? []).length, taskControls: (view.taskControls ?? []).length },
    // 无栈协程的固有缺陷：让出前写、让出后读的非 static 局部，值不保留
    yieldLocals: (view.yieldLocals ?? []).map((y) => ({
      function: y.function,
      name: index.nameOf(y.function),
      file: index.fileOf(y.function),
      variable: y.variable,
      writtenAt: y.writtenAt ?? null,
      yieldedAt: y.yieldedAt ?? null,
      readAt: y.readAt ?? null,
      callee: y.callee ?? null,
    })),
  };
}
