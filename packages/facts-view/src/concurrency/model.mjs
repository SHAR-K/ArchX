// 共享与并发主题的派生层：哪些执行单元访问同一资源。
//
// 引擎给的是三层事实：resourceAccesses（谁在哪一行读写了哪个文件级变量）、
// sharedResources（按执行单元归并之后，被多个单元触到的变量）、conflictCandidates
// （中断侧的写撞上另一侧未受保护的访问）。criticalSections 是同一语句块内成对出现的
// 保护 API，wakeRelations 是「中断置标志、任务在条件里轮询」这种握手。
//
// 这一层把它们拼成一张变量 × 单元的矩阵，并把冲突、唤醒、保护贴到对应的变量上。
// 三条不能含糊的话，界面上要照着说：
//   1. 冲突是候选，不是结论。引擎看不见跨函数的、条件性的保护。
//   2. 通知标志是设计意图，不是竞争，但它和竞争长得一样，所以单独标。
//   3. 未识别的保护不等于没有保护。

import { t } from "../i18n.mjs";
import { buildIndex, confidenceRank, idOf } from "../graph.mjs";
import { buildRunMap } from "./runmap.mjs";

const UNIT_ORDER = { isr: 0, task: 1, callback: 2, timer: 3, main: 4 };
const WRITE_KINDS = new Set(["write", "read_write"]);
const READ_KINDS = new Set(["read", "read_write"]);

/** 一个单元对一个变量做了什么，压成一个字形：写 / 读写 / 读 / 取地址。 */
function glyphOf(kinds) {
  const set = new Set(kinds);
  const w = [...set].some((k) => WRITE_KINDS.has(k));
  const r = [...set].some((k) => READ_KINDS.has(k));
  if (w && r) return "rw";
  if (w) return "w";
  if (r) return "r";
  return "addr";
}

export function buildConcurrency(view, options = {}) {
  const index = options.index ?? buildIndex(view);
  const ast = index.ast;
  if (!ast.present) {
    return { theme: "concurrency", available: false, reason: "no-ast-facts", hint: t("This scan has no AST-level facts, so reads, writes and execution domains are invisible. A full scan with build information is required."), resources: [], units: [] };
  }

  const conflictByName = new Map((ast.conflictCandidates ?? []).map((c) => [c.name, c]));
  const wakeByName = new Map((ast.wakeRelations ?? []).map((w) => [w.name, w]));

  // 矩阵只收被中断和别的单元同时碰到的变量：单侧的、纯任务内的不构成并发问题
  const rows = (ast.sharedResources ?? [])
    .filter((r) => r.units.length >= 2 && r.units.some((u) => u.unitKind === "isr"))
    .map((r) => {
      const conflict = conflictByName.get(r.name) ?? null;
      const wake = wakeByName.get(r.name) ?? null;
      return {
        id: idOf.resource(r.variable, r.name),
        name: r.name,
        variable: r.variable ?? null,
        file: r.variable ? index.varAt(r.variable).file : null,
        line: r.variable ? index.varAt(r.variable).line : null,
        volatile: Boolean(r.volatile),
        atomicity: r.atomicity ?? "unknown",
        typeName: r.type_name ?? r.typeName ?? null,
        units: (r.units ?? []).map((u) => ({
          unit: u.unit,
          kind: u.unitKind,
          glyph: glyphOf(u.kinds ?? []),
          kinds: u.kinds ?? [],
          // 有写但没有一处在临界区外，才算受保护；引擎看不见跨函数的保护，所以只说「已识别的保护」
          protected: Boolean((u.kinds ?? []).length) && !(u.unprotectedKinds ?? []).length,
          accesses: (u.accesses ?? []).length,
          derived: (u.accesses ?? []).some((a) => a.derived),
        })),
        conflict: conflict ? { confidence: conflict.confidence, pattern: conflict.pattern, reason: conflict.reason ?? null, role: conflict.role ?? null, approximation: conflict.approximation ?? null } : null,
        wake: wake ? { kind: wake.kind, confidence: wake.confidence ?? "medium", producers: (wake.producers ?? []).length, consumers: (wake.consumers ?? []).length } : null,
      };
    });

  // 高置信的排前面；通知标志是设计意图，同置信度里排到数据竞争之后
  rows.sort((x, y) =>
    (confidenceRank(y.conflict?.confidence) - confidenceRank(x.conflict?.confidence))
    || ((x.wake ? 1 : 0) - (y.wake ? 1 : 0))
    || (y.units.length - x.units.length)
    || x.name.localeCompare(y.name));

  const units = [...new Map(rows.flatMap((r) => r.units.map((u) => [u.unit, u.kind]))).entries()]
    .sort((a, b) => (UNIT_ORDER[a[1]] ?? 9) - (UNIT_ORDER[b[1]] ?? 9) || a[0].localeCompare(b[0]))
    .map(([unit, kind]) => ({ unit, kind, label: unit.split(":").slice(1).join(":") }));

  // 中断优先级梯子：抢占优先级小的能打断大的。优先级解析不出来就说未知，不猜
  const isrs = (index.entries.isrs ?? [])
    .map((i) => ({
      kernel: Boolean(i.kernel),
      id: i.id,
      name: index.nameOf(i.id),
      file: index.fileOf(i.id),
      vector: i.vector ?? null,
      preempt: i.priority?.preempt ?? null,
      sub: i.priority?.sub ?? null,
      // 经 API 注册的中断（ESP-IDF 那种，没有向量表）：注册点和规则
      registeredAt: i.registeredAt ? { id: i.registeredAt.id, name: index.nameOf(i.registeredAt.id), line: i.registeredAt.line } : null,
      rule: i.rule ?? null,
      // 内核异常不走 NVIC，没有使能点是正常的，不该显示成「未见使能」
      enabled: Boolean(i.kernel) || (i.enabledAt ?? []).length > 0 || Boolean(i.registeredAt),
    }))
    .sort((a, b) => (a.preempt ?? 99) - (b.preempt ?? 99) || (a.vector ?? 0) - (b.vector ?? 0));

  return {
    theme: "concurrency",
    available: true,
    basis: t("Reads, writes and execution domains come from the engine; a conflict is a candidate, not a verdict — the engine cannot see cross-function or conditional protection"),
    resources: rows,
    units,
    isrs,
    // 同一份 sharedResources 的另一种问法：数据从哪个上下文产出、流到哪个上下文消费
    runMap: buildRunMap(view, { index }),
    criticalSections: (ast.criticalSections ?? []).map((c) => ({
      function: c.function,
      name: index.nameOf(c.function),
      file: index.fileOf(c.function),
      begin: c.begin ?? null,
      end: c.end ?? null,
      api: c.api,
      endApi: c.endApi ?? c.end_api ?? null,
      kind: c.kind,
      accesses: (c.accessesInside ?? c.accesses_inside ?? []).length,
    })),
    counts: {
      high: (ast.conflictCandidates ?? []).filter((c) => c.confidence === "high").length,
      medium: (ast.conflictCandidates ?? []).filter((c) => c.confidence === "medium").length,
      shared: rows.length,
      wake: (ast.wakeRelations ?? []).length,
      criticalSections: (ast.criticalSections ?? []).length,
      criticalSectionsTotal: ast.criticalSectionsTotal ?? (ast.criticalSections ?? []).length,
      accesses: (ast.resourceAccesses ?? []).length,
    },
  };
}

/** 一个变量的两侧明细：每个单元在哪些函数的哪些行碰它。 */
export function resourceSides(view, name, options = {}) {
  const index = options.index ?? buildIndex(view);
  const resource = (index.ast.sharedResources ?? []).find((r) => r.name === name);
  if (!resource) return null;
  return {
    // 和矩阵行用同一个构造，否则界面上「复制引用」复制出来的 ID 定位不回那一行
    id: idOf.resource(resource.variable, name),
    name,
    sides: (resource.units ?? []).map((u) => ({
      unit: u.unit,
      kind: u.unitKind,
      kinds: u.kinds ?? [],
      unprotectedKinds: u.unprotectedKinds ?? [],
      accesses: (u.accesses ?? []).map((a) => ({
        function: a.function,
        name: index.nameOf(a.function),
        file: a.location?.path ?? index.fileOf(a.function),
        line: a.location?.line ?? null,
        kind: a.kind,
        via: a.via ?? null,
        inCriticalSection: Boolean(a.inCriticalSection),
        // 一步指针形参推出来的访问：不是这一行直接写的，标出来
        derived: a.derived ? { callee: a.derived.calleeName, param: a.derived.paramName ?? a.derived.param, basis: a.derived.basis } : null,
      })),
    })).sort((a, b) => (UNIT_ORDER[a.kind] ?? 9) - (UNIT_ORDER[b.kind] ?? 9)),
  };
}
