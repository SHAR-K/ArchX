// 状态转换主题的派生层。
//
// 引擎把 `switch(变量)` 当状态机候选：case 标签是状态，switch 内对分派变量的赋值是转换，
// 包围它的 if 条件作为近似转换条件。这一层把这些候选整理成人和 Agent 都能用的结构：
//
//   1. 只分发不改状态的 switch 单列成「分发表」，不当状态机
//   2. 同一个分派变量的多个 switch 合成一台机（状态分散在几个函数里是常见写法）
//   3. 归属：哪个执行单元可达它
//   4. 嵌套：A 的某个 case 体内的调用在若干跳内到达 B 的函数，则 B 是 A 那个状态的子状态机
//   5. 耦合：转换条件里出现的函数定义在另一台机所在的文件里，则 A 等待 B
//   6. 状态顺序、边的种类、终态、分层深度
//   7. 转换条件拆成原子行：一行一个判断，else 分支取反
//
// 全是确定性推导，没有渲染，没有坐标。布局在视图侧做。

import { t } from "../i18n.mjs";
import { buildIndex, confidenceRank, idOf } from "../graph.mjs";

const NEST_MAX_HOPS = 3;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ---- 机器 ---------------------------------------------------------------------------

function mergeMachines(raw) {
  const groups = new Map();
  for (const m of raw) {
    const key = m.dispatchVariable ?? m.id;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()].map((list) => {
    const head = list[0];
    // 同名 case 在几个 switch 里都出现时，留带 endLine 的那个（它知道 case 体到哪结束）
    const states = new Map();
    for (const m of list) {
      for (const st of m.states) {
        const current = states.get(st.name);
        if (!current || (!current.endLine && st.endLine)) states.set(st.name, { ...st, function: m.function });
      }
    }
    const functions = [...new Set(list.map((m) => m.function))];
    return {
      id: idOf.machine(head.dispatchVariable, head.location?.path, head.dispatch),
      members: list.map((m) => m.id),
      function: head.function,
      functions,
      dispatch: head.dispatch,
      dispatchVariable: head.dispatchVariable ?? null,
      dispatchType: head.dispatchType ?? null,
      enumType: list.map((m) => m.enumType).find(Boolean) ?? null,
      location: head.location,
      hasDefault: list.some((m) => m.hasDefault),
      states: [...states.values()],
      transitions: list.flatMap((m) => m.transitions.map((t) => ({ ...t, function: m.function }))),
      writersElsewhere: [...new Set(list.flatMap((m) => m.writersElsewhere ?? []))].filter((f) => !functions.includes(f)),
      confidence: ["high", "medium", "low"].find((c) => list.some((m) => m.confidence === c)) ?? "low",
    };
  });
}

function attachOwners(machines, index) {
  const registrations = index.entries.registrations ?? [];
  const units = [
    ...registrations.filter((r) => r.kind === "task"),
    ...registrations.filter((r) => r.kind === "callback" || r.kind === "handler"),
    ...(index.entries.isrs ?? []).filter((i) => !i.kernel).map((i) => ({ id: i.id, kind: "isr" })),
  ];
  for (const m of machines) {
    m.owners = units
      .filter((u) => m.functions.some((f) => f === u.id || index.reachOf(u.id).has(f)))
      .map((u) => ({ id: u.id, kind: u.kind, name: index.nameOf(u.id) }));
  }
}

function attachNesting(machines, index) {
  const hops = (from, to) => {
    if (from === to) return 0;
    const seen = new Set([from]);
    let frontier = [from];
    for (let d = 1; d <= NEST_MAX_HOPS; d += 1) {
      const next = [];
      for (const x of frontier) {
        for (const c of index.calleesOf.get(x) ?? []) {
          if (c.t === to) return d;
          if (!seen.has(c.t)) { seen.add(c.t); next.push(c.t); }
        }
      }
      frontier = next;
    }
    return null;
  };

  for (const b of machines) { b.parent = null; b.parentState = null; b.parentVia = null; b.depth = 0; }
  const parentDepth = new Map();
  for (const a of machines) {
    for (const b of machines) {
      if (a === b || a.functions.some((f) => b.functions.includes(f))) continue;
      let best = null;
      for (const st of a.states) {
        if (!st.location || !st.endLine) continue;
        const inCase = (index.calleesOf.get(st.function) ?? []).filter((c) => c.line >= st.location.line && c.line <= st.endLine);
        for (const c of inCase) {
          for (const bf of b.functions) {
            const h = c.t === bf ? 1 : (() => { const n = hops(c.t, bf); return n == null ? null : n + 1; })();
            if (h != null && (!best || h < best.depth)) best = { depth: h, state: st.name, via: c.t };
          }
        }
      }
      if (best && (b.parent == null || best.depth < parentDepth.get(b.id))) {
        b.parent = a.id;
        b.parentState = best.state;
        b.parentVia = best.via;
        parentDepth.set(b.id, best.depth);
      }
    }
  }
  const byId = new Map(machines.map((m) => [m.id, m]));
  for (const m of machines) {
    let d = 0;
    let cur = m;
    while (cur?.parent) { d += 1; cur = byId.get(cur.parent); if (!cur || d > 6) break; }
    m.depth = d;
  }
  for (const m of machines) m.children = machines.filter((x) => x.parent === m.id).map((x) => x.id);
}

function attachCoupling(machines, index) {
  const fnByName = new Map();
  for (const f of index.view.functions) if (index.inRegion(f.file)) fnByName.set(f.name, f);
  for (const a of machines) {
    a.waitsOn = [];
    const called = new Set(a.transitions.flatMap((t) => [...String(t.condition ?? "").matchAll(/([A-Za-z_]\w*)\s*\(/g)].map((x) => x[1])));
    for (const b of machines) {
      if (a === b) continue;
      const files = new Set(b.functions.map((f) => index.fileOf(f)));
      const via = [...called].filter((name) => files.has(fnByName.get(name)?.file));
      if (via.length) a.waitsOn.push({ id: b.id, dispatch: b.dispatch, via });
    }
  }
}

// ---- 分析：顺序、边、终态、深度 -------------------------------------------------------

export function analyzeMachine(machine, index) {
  // 状态顺序 = 代码入口顺序：从没有入弧的起点沿 switch 内的转换拓扑排序，终态排到最后
  const byCase = machine.states.slice().sort((a, b) => (a.location?.line ?? 0) - (b.location?.line ?? 0)).map((s) => s.name);
  const succ = new Map(byCase.map((n) => [n, []]));
  const indeg = new Map(byCase.map((n) => [n, 0]));
  for (const t of machine.transitions) {
    for (const f of t.from) {
      if (succ.has(f) && succ.has(t.to) && f !== t.to && !succ.get(f).includes(t.to)) {
        succ.get(f).push(t.to);
        indeg.set(t.to, indeg.get(t.to) + 1);
      }
    }
  }
  const terminalNames = new Set(byCase.filter((n) => !(succ.get(n) ?? []).length));
  const order = [];
  const seen = new Set();
  const visit = (n) => {
    if (seen.has(n) || terminalNames.has(n)) return;
    seen.add(n);
    order.push(n);
    for (const x of succ.get(n) ?? []) visit(x);
  };
  for (const n of byCase) if (indeg.get(n) === 0) visit(n);
  for (const n of byCase) visit(n);
  for (const n of byCase) if (terminalNames.has(n)) order.push(n);
  // 转换指向的、不在任何 case 标签里的名字（写进去但没人接）
  const extra = [...new Set(machine.transitions.map((t) => t.to).filter((n) => n && n !== "<expr>" && !order.includes(n)))];
  const names = [...order, ...extra];
  const idx = new Map(names.map((n, i) => [n, i]));

  // 出口经 helper：case 体内调用了「switch 之外改写分派变量」的函数，且那一行不是已知转换
  const writers = new Set(machine.writersElsewhere ?? []);
  const helperWrites = new Map(machine.states.map((st) => [
    st.name,
    (index.calleesOf.get(machine.function) ?? []).filter((c) =>
      writers.has(c.t) && st.location && st.endLine && c.line >= st.location.line && c.line <= st.endLine
      && !machine.transitions.some((t) => t.location?.line === c.line)),
  ]));

  const outDeg = new Map(names.map((n) => [n, 0]));
  const inDeg = new Map(names.map((n) => [n, 0]));
  const edges = [];
  for (const t of machine.transitions) {
    for (const from of t.from) {
      if (!idx.has(from) || !idx.has(t.to)) continue;
      edges.push({ from, to: t.to, transition: t });
      outDeg.set(from, outDeg.get(from) + 1);
      inDeg.set(t.to, inDeg.get(t.to) + 1);
    }
  }
  const terminal = new Set(names.filter((n) => outDeg.get(n) === 0 && !(helperWrites.get(n) ?? []).length));
  const viaHelper = new Set(names.filter((n) => outDeg.get(n) === 0 && (helperWrites.get(n) ?? []).length));
  for (const e of edges) {
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    e.kind = a === b ? "self" : terminal.has(e.to) ? "exit" : b === a + 1 ? "next" : b > a ? "jump" : "back";
  }

  const count = (kind) => edges.filter((e) => e.kind === kind).length;
  const helperCount = [...helperWrites.values()].reduce((sum, list) => sum + list.length, 0);
  const stats = {
    next: count("next"), jump: count("jump"), back: count("back"), self: count("self"), exit: count("exit"),
    helper: helperCount, total: edges.length, linearity: edges.length ? count("next") / edges.length : 0,
  };

  // 分层：沿向后的边取最长路径深度；终态压到最底层；回边不参与
  const depth = new Map(names.map((n) => [n, 0]));
  const hasForwardIn = new Set(edges.filter((e) => idx.get(e.to) > idx.get(e.from)).map((e) => e.to));
  names.forEach((n, i) => {
    if (terminal.has(n)) return;
    if (i > 0 && !hasForwardIn.has(n) && !extra.includes(n)) depth.set(n, Math.max(depth.get(n), depth.get(names[i - 1]) + 1));
    for (const e of edges) if (e.from === n && idx.get(e.to) > idx.get(e.from) && !terminal.has(e.to)) depth.set(e.to, Math.max(depth.get(e.to), depth.get(n) + 1));
  });
  const deepest = Math.max(0, ...names.filter((n) => !terminal.has(n)).map((n) => depth.get(n)));
  for (const n of names) if (terminal.has(n)) depth.set(n, deepest + 1);

  const isrWriters = (machine.writersElsewhere ?? []).filter((f) => {
    const domain = index.domainOf(f);
    return index.isrIds.has(f) || domain === "isr" || domain === "mixed";
  });

  return {
    names,
    extra,
    edges,
    stats,
    terminal: [...terminal],
    viaHelper: [...viaHelper],
    helperWrites: Object.fromEntries([...helperWrites].filter(([, v]) => v.length).map(([k, v]) => [k, v])),
    outDeg: Object.fromEntries(outDeg),
    inDeg: Object.fromEntries(inDeg),
    depth: Object.fromEntries(depth),
    maxDepth: deepest + (names.some((n) => terminal.has(n)) ? 1 : 0),
    start: names.filter((n) => (inDeg.get(n) ?? 0) === 0 && !terminal.has(n)),
    noIn: names.filter((n) => (inDeg.get(n) ?? 0) === 0 && !extra.includes(n)),
    isrWriters,
  };
}

// ---- 条件：拆成原子行 -----------------------------------------------------------------

// C 写法的取反：`!x` 去掉 !；裸变量、成员、无嵌套的调用前缀 !；其余包一层 !( … )
export function negateC(text) {
  const t = String(text).trim();
  if (/^!\s*[A-Za-z_][\w.>\-[\]]*(\([^()]*\))?$/.test(t)) return t.replace(/^!\s*/, "");
  if (/^[A-Za-z_][\w.>\-[\]]*(\([^()]*\))?$/.test(t)) return `!${t}`;
  return `!(${t})`;
}

export function conditionSteps(transition) {
  const raw = transition.conditionSteps?.length ? transition.conditionSteps : (transition.condition ? [transition.condition] : []);
  return raw.map((c) => {
    if (typeof c !== "string") return c;
    const m = /^!\((.*)\)$/.exec(c);
    return m ? { text: m[1], kind: "else", line: null } : { text: c, kind: "if", line: null };
  });
}

// 一个步骤展开成若干原子行：要求为真 → if 行；要求为假 → 取反的 else 行；break/return/continue 检查 → guard 行
export function atomRows(step) {
  const parts = step.parts?.length ? step.parts : [{ text: step.text, line: step.line }];
  const mustHold = step.mustHold ?? (step.kind === "if");
  const isGuard = String(step.kind).startsWith("guard");
  return parts.map((p, i) => ({
    // anyOf：这些原子是「选一」，第二行起标签换成 or
    tone: isGuard ? "guard" : mustHold ? "pos" : "neg",
    tag: p.anyOf && i > 0 ? "or" : isGuard ? String(step.kind).replace("guard-", "") : mustHold ? "if" : "else",
    text: isGuard || mustHold ? p.text : negateC(p.text),
    line: p.line ?? step.line ?? null,
  }));
}

// 调用点在 case 里的 if / else 步骤：引擎给的 helper 转换步骤只含 helper 内部，
// 调用点自己被哪些分支包着要从 controlFlow 的块区间反推
export function callSiteSteps(index, fnId, line, caseFrom, caseTo) {
  const all = index.blocksByFn.get(fnId) ?? [];
  const blocks = all.filter((b) => b.location.line >= caseFrom && b.endLine <= caseTo && b.location.line <= line && line <= b.endLine);
  const steps = [];
  for (const b of blocks.filter((x) => x.kind === "if").sort((x, y) => x.location.line - y.location.line)) {
    const elseBlock = blocks.find((e) => e.kind === "else" && e.parent != null && all[e.parent] === b);
    const inElse = Boolean(elseBlock && line >= elseBlock.location.line);
    const fallback = [{ text: b.condition ?? "", line: b.location.line }];
    const parts = inElse ? (b.partsNegated?.length ? b.partsNegated : fallback) : (b.parts?.length ? b.parts : fallback);
    steps.push({ text: b.condition ?? "", kind: inElse ? "else" : "if", line: b.location.line, mustHold: !inElse, parts });
  }
  return steps;
}

// 一个状态的明细：守卫（case 一进来就可能跳出的检查）+ 它发出的每条转换
export function statePanel(machine, analysis, stateName, index) {
  const state = machine.states.find((x) => x.name === stateName) ?? null;
  const outgoing = analysis.edges
    .filter((e) => e.from === stateName)
    .slice()
    .sort((x, y) => (x.transition.location?.line ?? 0) - (y.transition.location?.line ?? 0));
  const guards = (state?.guards ?? []).slice()
    .sort((x, y) => (x.line ?? 0) - (y.line ?? 0))
    .map((g, i) => ({ ...g, letter: LETTERS[i] ?? `G${i}`, rows: atomRows(g) }));
  const items = outgoing.map((e, i) => {
    const via = e.transition.via ?? "assignment";
    const fn = e.transition.function ?? machine.function;
    const helper = via.startsWith("call:") ? via.slice(5) : null;
    const siteSteps = helper && state?.location && state.endLine
      ? callSiteSteps(index, fn, e.transition.location?.line ?? 0, state.location.line, state.endLine)
      : [];
    const inner = conditionSteps(e.transition);
    return {
      number: i + 1,
      to: e.to,
      toId: idOf.state(machine.id, e.to),
      kind: e.kind,
      function: fn,
      file: index.fileOf(fn),
      line: e.transition.location?.line ?? null,
      helper,
      // helper 转换：调用点外面包着的分支 + helper 内部的判断，两段分开，别混成一串
      siteRows: siteSteps.map(atomRows).flat(),
      innerRows: inner.filter((s) => !String(s.kind).startsWith("guard") && !siteSteps.some((ss) => ss.text === s.text && ss.kind === s.kind)).map(atomRows).flat(),
      directRows: helper ? [] : inner.filter((s) => !String(s.kind).startsWith("guard")).map(atomRows).flat(),
    };
  });
  return { state, id: idOf.state(machine.id, stateName), name: stateName, guards, items };
}

// ---- 主题入口 -------------------------------------------------------------------------

export function buildStateTransitions(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const ast = index.ast;
  if (!ast.present) return { theme: "state-transitions", available: false, reason: "no-ast-facts", machines: [], dispatchTables: [] };

  const raw = ast.stateMachines ?? [];
  const dispatchTables = raw.filter((m) => !m.transitions.length).map((m) => ({
    id: idOf.machine(m.dispatchVariable, m.location?.path, m.dispatch),
    dispatch: m.dispatch,
    function: m.function,
    location: m.location,
    cases: m.states.length,
  }));

  const machines = mergeMachines(raw.filter((m) => m.transitions.length));
  attachOwners(machines, index);
  attachNesting(machines, index);
  attachCoupling(machines, index);
  for (const m of machines) {
    m.analysis = analyzeMachine(m, index);
    m.states = m.states.map((st) => ({ ...st, id: idOf.state(m.id, st.name) }));
    m.file = index.fileOf(m.function);
    m.analysis.verdict = linearityVerdict(m.analysis.stats);
    m.enumTable = enumTableFor(m, m.analysis, ast.enums ?? []);
  }
  // 有赋值但一条都落不到具名状态上的（比如 switch(align) 里给别的变量赋值被误抓）：
  // 分析后 total 为 0，按派发表列，不占候选位。LVGL 的 align 枚举 21 态 0 边就是这种
  for (const m of machines.filter((m) => m.analysis.stats.total === 0)) {
    dispatchTables.push({ id: m.id, dispatch: m.dispatch, function: m.function, location: m.location, cases: m.states.length, demoted: true });
  }
  const kept = machines.filter((m) => m.analysis.stats.total > 0);
  machines.length = 0; machines.push(...kept);
  machines.sort((a, b) => (confidenceRank(b.confidence) - confidenceRank(a.confidence)) || (b.transitions.length - a.transitions.length));

  return {
    theme: "state-transitions",
    available: true,
    basis: t("The engine treats switch(variable) as a state-machine candidate: case labels are states, assignments to the dispatch variable inside the switch are transitions, and the enclosing if conditions approximate the transition conditions"),
    machines,
    dispatchTables,
  };
}

/** 线性度的判词。阈值照原型：顺序前进占六成以上是「像用 switch 写的过程」，跳跃加回退多于顺序前进才是「真正的状态机」。 */
export function linearityVerdict(stats) {
  if (!stats || stats.total === 0) return t("Dispatch only, no transitions");
  const lin = Math.round((stats.linearity ?? 0) * 100);
  if (lin >= 60) return t("Mostly sequential: reads like a procedure written with switch; back and jump edges are exception paths");
  if (stats.back + stats.jump > stats.next) return t("Mesh: jumps and backs outnumber forward steps — a real state machine");
  return t("Mixed: neither forward steps nor jumps and backs dominate");
}

/**
 * 枚举一览：把这台机器的状态名对到引擎给的枚举定义上，列出每个成员有没有 case、
 * 入出度、break 数和角色。「未在 switch 出现」的成员是设计和实现对不上的地方；
 * 引擎没给出枚举定义时退回 switch 里出现过的标签。
 */
export function enumTableFor(machine, analysis, enums) {
  const names = new Set(analysis.names ?? []);
  const get = (m, k) => (m instanceof Map ? m.get(k) : m?.[k]) ?? 0;
  const candidates = (enums ?? []).filter((e) => (e.members ?? []).some((x) => names.has(x.name)));
  candidates.sort((x, y) => y.members.filter((mm) => names.has(mm.name)).length - x.members.filter((mm) => names.has(mm.name)).length);
  const best = machine.enumType ? candidates.find((e) => e.name === machine.enumType) ?? candidates[0] ?? null : candidates[0] ?? null;
  const members = best
    ? best.members.map((mm) => ({ name: mm.name, value: mm.value ?? null }))
    : [...names].map((n) => ({ name: n, value: null }));
  const terminal = new Set(analysis.terminal ?? []);
  // 起点和状态图的初态同一个口径：没有无入弧的状态时，退到深度 0、代码顺序最前的那个
  const depthOf = (n) => (analysis.depth instanceof Map ? analysis.depth.get(n) : analysis.depth?.[n]) ?? 0;
  const order = analysis.names ?? [];
  const fallback = order.slice().sort((x, y) => depthOf(x) - depthOf(y) || order.indexOf(x) - order.indexOf(y))[0];
  const start = new Set((analysis.start ?? []).length ? analysis.start : fallback ? [fallback] : []);
  const extra = new Set(analysis.extra ?? []);
  const rows = members
    .slice()
    .sort((x, y) => ((Number(x.value) || 0) - (Number(y.value) || 0)) || x.name.localeCompare(y.name))
    .map((mm) => {
      const inMachine = names.has(mm.name);
      const state = machine.states.find((st) => st.name === mm.name) ?? null;
      const role = !inMachine ? t("not in the switch") : start.has(mm.name) ? t("start") : terminal.has(mm.name) ? t("terminal") : extra.has(mm.name) ? t("transition target only") : "";
      return {
        name: mm.name,
        value: mm.value,
        inMachine,
        isCase: Boolean(state),
        inDeg: inMachine ? get(analysis.inDeg, mm.name) : null,
        outDeg: inMachine ? get(analysis.outDeg, mm.name) : null,
        guards: (state?.guards ?? []).length,
        role,
      };
    });
  return {
    enum: best ? { name: best.name, location: best.location ?? null, members: best.members.length } : null,
    rows,
    unused: rows.filter((r) => !r.inMachine).length,
  };
}
