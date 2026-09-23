// 共享索引：投影输出上建一次，各主题的派生共用。
//
// 和投影一样不碰 DOM、不用 node 内置模块。原型里这些索引散在模板顶部，各页签直接闭包引用；
// 搬进包之后改成显式建一次、显式传下去。

export function buildIndex(view) {
  const entries = view.entries;
  const fileById = new Map(view.files.map((f) => [f.path, f]));
  const fnById = new Map(view.functions.map((fn) => [fn.id, fn]));
  const varById = new Map((view.variables ?? []).map((item) => [item.id, item]));

  // 可达性沿调用边 + 注册边（取函数地址装进系统）走；使能边不算，中断体不在使能者「下面」
  const calleesOf = new Map();
  const callersOf = new Map();
  for (const c of [...view.callPairs, ...view.registerPairs]) {
    calleesOf.set(c.s, [...(calleesOf.get(c.s) ?? []), c]);
    callersOf.set(c.t, [...(callersOf.get(c.t) ?? []), c]);
  }

  const reachCache = new Map();
  const reachOf = (id) => {
    if (reachCache.has(id)) return reachCache.get(id);
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const current = queue.shift();
      for (const c of calleesOf.get(current) ?? []) if (!seen.has(c.t)) { seen.add(c.t); queue.push(c.t); }
    }
    reachCache.set(id, seen);
    return seen;
  };

  const ast = view.ast ?? {};
  const push = (map, key, value) => { if (key != null) map.set(key, [...(map.get(key) ?? []), value]); };
  const blocksByFn = new Map();
  for (const b of ast.controlFlow ?? []) push(blocksByFn, b.function, b);
  // 按函数分桶的 AST 事实。多个主题都要按函数取一段区间里的事实，索引建一次共用，
  // 免得每个主题各自扫一遍全表
  const loopsByFn = new Map();
  for (const l of ast.loops ?? []) push(loopsByFn, l.function, l);
  // 循环没有名字可用，只能靠位置区分同一个函数里的第几个。序号比行号稳：
  // 加注释、改循环体都不动它，只有在前面插入一个新循环时才会漂。
  // 键用「函数 + 行」而不是对象引用：各主题传进来的往往是加工过的副本，引用对不上。
  const loopOrdinal = new Map();
  for (const list of loopsByFn.values()) {
    [...list]
      .sort((a, b) => (a.location?.line ?? 0) - (b.location?.line ?? 0))
      .forEach((l, i) => loopOrdinal.set(`${l.function}@${l.location?.line ?? 0}`, i + 1));
  }
  const accessesByFn = new Map();
  for (const a of ast.resourceAccesses ?? []) push(accessesByFn, a.function, a);
  const critByFn = new Map();
  for (const c of ast.criticalSections ?? []) push(critByFn, c.function, c);

  return {
    view,
    entries,
    ast,
    fileById,
    fnById,
    calleesOf,
    callersOf,
    reachOf,
    blocksByFn,
    loopsByFn,
    loopId: (loop) => {
      const line = loop?.location?.line ?? loop?.line ?? 0;
      const ordinal = loopOrdinal.get(`${loop?.function}@${line}`) ?? 1;
      return `loop:${String(loop?.function ?? "?").replace(/^function:/, "")}#${ordinal}`;
    },
    accessesByFn,
    critByFn,
    sharedByName: new Map((ast.sharedResources ?? []).map((r) => [r.name, r])),
    conflictByName: new Map((ast.conflictCandidates ?? []).map((c) => [c.name, c])),
    wakeByName: new Map((ast.wakeRelations ?? []).map((w) => [w.name, w])),
    isrIds: new Set((entries.isrs ?? []).map((i) => i.id)),
    regById: new Map((entries.registrations ?? []).map((r) => [r.id, r])),
    domainOf: (id) => entries.domains?.[id] ?? null,
    varById,
    // 变量 ID 不带行号，位置一律查表；查不到就只从 ID 里取路径，行号交代不了就是 null
    varAt: (id) => {
      const found = varById.get(id);
      if (found) return { file: found.file, line: found.line, name: found.name };
      const parts = String(id ?? "").split(":");
      if (parts.length < 3) return { file: null, line: null, name: null };
      return { file: parts.slice(1, -1).join(":"), line: null, name: parts[parts.length - 1] };
    },
    fileOf: (fnId) => fnById.get(fnId)?.file ?? null,
    nameOf: (fnId) => fnById.get(fnId)?.name ?? String(fnId).split(":").pop(),
    inRegion: (file) => String(file ?? "").startsWith(view.region),
  };
}

export const confidenceRank = (c) => ({ high: 3, medium: 2, low: 1 }[c] ?? 0);

// 稳定 ID：`<种类>:<键>`，种类决定它属于哪个主题。键里不放数组下标，也不放会随编辑漂移的行号。
// 第一阶段只有状态转换主题的两种；完整规则见 docs/ARCHX_DIRECTION.md 的 B1。
export const idOf = {
  machine: (dispatchVariable, fallbackFile, dispatch) => {
    if (dispatchVariable) {
      // variable:<路径>:<名字> -> 去掉种类前缀，路径 + 名字足以定位
      const parts = String(dispatchVariable).split(":");
      if (parts.length >= 3) return `fsm:${parts.slice(1).join(":")}`;
      return `fsm:${dispatchVariable}`;
    }
    return `fsm:${fallbackFile ?? "?"}:${dispatch}`;
  },
  state: (machineId, stateName) => `state:${machineId.slice("fsm:".length)}/${stateName}`,
  // 变量 ID 已经是 variable:<路径>:<名字>，去掉种类前缀再拼，避免 res:variable:... 这种双前缀。
  // 取不到变量 ID 的（只在 map 文件里见过的符号）退回名字。
  resource: (variable, name) => `res:${String(variable ?? "").replace(/^variable:/, "") || name}`,
  memoryModule: (moduleId) => `mem:${moduleId}`,
  memorySymbol: (file, name) => `sym:${file || "?"}:${name}`,
};
