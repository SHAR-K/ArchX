// 投影层：把 ArchCheck 的分区事实（partition.json）整理成页面和 AI 都用的视图模型。
//
// 这一层只做确定性的整理——目录分组、模块与层序、调用/注册/使能边、入口与执行域、
// AST 事实按区域过滤——不含任何渲染，也不用任何 node 内置模块，所以浏览器、webview
// 和扩展宿主都能直接跑。分层约定见 packages/facts-view/README.md。
//
// buildFactsView(facts, region, options)
//   facts    ArchCheck 分区事实对象（已 JSON.parse）
//   region   区域前缀，形如 "src/"，空串表示整个工程
//   options  { source }      出错信息里显示的来源名，默认 "facts"
//            { generatedAt } 生成时间，注入后输出完全确定，便于回归比对

import { t } from "./i18n.mjs";

export function buildFactsView(facts, region, options = {}) {
  const source = options.source ?? "facts";
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const norm = (value) => value.replaceAll("\\", "/");
  // 层不是声明出来的：引擎 dependencyOrder 给每个目录一个深度（缩点后的最长路径，0 = 不依赖工程内任何目录），
  // 模块的深度取它覆盖的目录里最深的那个；rank = maxDepth - depth，越小越靠上。页面上只出现 D0…Dn，没有层的名字。
  const depOrder = facts.dependencyOrder ?? null;
  const dirDepth = new Map((depOrder?.nodes ?? []).map((node) => [norm(node.id), node.depth]));
  const maxDepth = depOrder?.maxDepth ?? 0;
  const inRegion = (file) => norm(file).startsWith(region);
  const relative = (file) => norm(file).slice(region.length);

  // 模块 = 目录单元：区域内取相对路径的前两段目录（更深的目录并入第二段），根目录文件归 "(root)"；区域外按前两段聚成边界模块。
  function moduleOf(file) {
    const normalized = norm(file);
    // 闭源库（只有声明、定义在 .lib 里的符号）单独成一个边界模块，不并入声明头文件所在目录
    if (normalized.startsWith("lib:")) { const name = normalized.slice(4).split("/").pop(); return { id: `lib:${name}`, name: t("closed-source library {name}", { name }), dir: normalized, external: true, library: true }; }
    if (inRegion(normalized)) {
      const parts = relative(normalized).split("/");
      if (parts.length === 1) return { id: "(root)", name: t("(root-level files)"), dir: "(root)", external: false };
      const dirs = parts.slice(0, -1);
      const id = dirs.slice(0, 2).join("/");
      return { id, name: id, dir: `${id}/`, external: false };
    }
    const parts = normalized.split("/");
    const id = `ext:${parts.slice(0, 2).join("/")}`;
    return { id, name: parts.slice(0, 2).join("/"), dir: `${parts.slice(0, 2).join("/")}/`, external: true };
  }

  function layerOf(moduleDir, external) {
    // 内部模块的 dir 相对 region（"drivers/hal/"），外部模块用它的 id 去掉 ext: 前缀；引擎的目录是工程相对路径
    const prefix = external ? String(moduleDir).replace(/^(ext:|lib:)/, "").replace(/\/?$/, "/") : `${region}${moduleDir === "(root)" ? "" : moduleDir}`;
    let depth = null;
    for (const [dir, d] of dirDepth) {
      const hit = moduleDir === "(root)" ? dir === region.replace(/\/$/, "") : (`${dir}/`).startsWith(prefix);
      if (hit) depth = depth == null ? d : Math.max(depth, d);
    }
    if (depth == null) return { rank: null, name: external ? t("outside the region") : t("no dependency data"), crosscutting: false, depth: null };
    return { rank: maxDepth - depth, name: `D${depth}`, crosscutting: false, depth };
  }

  const files = new Map();
  const modules = new Map();
  for (const metric of facts.files) {
    const filePath = norm(metric.path);
    const module = moduleOf(filePath);
    if (!modules.has(module.id)) modules.set(module.id, { ...module, layer: layerOf(module.external ? module.id : module.dir, module.external), files: [] });
    modules.get(module.id).files.push(filePath);
    files.set(filePath, { path: filePath, name: filePath.split("/").pop(), module: module.id, lines: metric.code_lines ?? 0, totalLines: metric.total_lines ?? 0, fanIn: metric.fan_in ?? 0, fanOut: metric.fan_out ?? 0, risk: metric.risk_score ?? 0, inCycle: Boolean(metric.in_dependency_cycle), functions: [], exports: new Set() });
  }
  const ensureFile = (filePath) => {
    const normalized = norm(filePath);
    if (files.has(normalized)) return files.get(normalized);
    const module = moduleOf(normalized);
    if (!modules.has(module.id)) modules.set(module.id, { ...module, layer: layerOf(module.external ? module.id : module.dir, module.external), files: [] });
    modules.get(module.id).files.push(normalized);
    const record = { path: normalized, name: normalized.split("/").pop(), module: module.id, lines: 0, totalLines: 0, fanIn: 0, fanOut: 0, risk: 0, inCycle: false, functions: [], exports: new Set(), unmeasured: true };
    files.set(normalized, record);
    return record;
  };

  // 需要 ArchCheck v2 事实（engineSchemaVersion ≥ 2）：函数只含定义，调用边已指向定义，入口 / 执行单元 / 可达性由引擎给出。
  if (!facts.executionUnits || !facts.reachability || !facts.entries) throw new Error(t("{source} is not v2 facts (missing executionUnits / reachability / entries); rescan with ArchX 0.25.2 or newer", { source }));
  const functions = new Map();
  for (const symbol of facts.functions) {
    if (symbol.isDefinition === false) continue;
    const fn = { id: symbol.symbol_id, name: symbol.name, file: norm(symbol.location.path), line: symbol.location.line, endLine: symbol.end_line ?? null, detail: symbol.detail ?? "", brief: symbol.documentation?.brief ?? "", compileBranch: symbol.compileBranch ?? null, definedInHeader: Boolean(symbol.definedInHeader) };
    ensureFile(fn.file).functions.push(fn.id);
    functions.set(fn.id, fn);
  }

  // 闭源库符号（schema 4 `externalSymbols`）：只有声明、定义在 .lib 里。挂成 `lib:<库文件>` 伪文件下的函数记录，调用边得以保留。
  for (const symbol of facts.externalSymbols ?? []) {
    const library = symbol.library ? norm(symbol.library).split("/").pop() : "unknown.lib";
    const fn = { id: symbol.symbolId, name: symbol.name, file: `lib:${library}`, line: 0, endLine: null, detail: symbol.signature ?? "", brief: "", compileBranch: null, definedInHeader: false, external: true, declaredIn: (symbol.declaredIn ?? []).map((site) => ({ path: norm(site.path), line: site.line })), library: symbol.library ? norm(symbol.library) : null };
    ensureFile(fn.file).functions.push(fn.id);
    functions.set(fn.id, fn);
  }

  const callPairs = [];
  const referencePairs = [];
  const seenCalls = new Set();
  for (const edge of facts.semanticEdges) {
    const sourceId = edge.source, targetId = edge.target;
    const source = functions.get(sourceId);
    const targetFunction = functions.get(targetId);
    const location = edge.locations?.[0];
    if ((edge.relation === "calls" || edge.relation === "dispatches") && source && targetFunction && sourceId !== targetId) {
      const key = `${sourceId}→${targetId}@${location?.line ?? ""}`;
      if (seenCalls.has(key)) continue;
      seenCalls.add(key);
      // dispatches：分发器经函数指针槽位可能调到的回调（may-call），当调用边走，但标出来
      callPairs.push({ s: sourceId, t: targetId, line: location?.line ?? null, ...(edge.relation === "dispatches" ? { kind: "dispatch", confidence: edge.confidence ?? null } : {}) });
      if (source.file !== targetFunction.file) ensureFile(targetFunction.file).exports.add(targetId);
    } else if (edge.relation === "references" && source) {
      referencePairs.push({ s: sourceId, t: edge.target, line: location?.line ?? null });
    }
  }

  const includeEdges = facts.dependencyEdges.map((edge) => ({ s: norm(edge.source), t: norm(edge.target) })).filter((edge) => edge.s !== edge.t);
  for (const edge of includeEdges) { ensureFile(edge.s); ensureFile(edge.t); }

  const globals = facts.globalVariables.filter((item) => item.cross_file || new Set((item.references ?? []).map((reference) => norm(reference.path))).size > 1).map((item) => ({
    name: item.name,
    type: item.type_name,
    definition: item.definition ? { path: norm(item.definition.path), line: item.definition.line } : null,
    references: [...new Set((item.references ?? []).map((reference) => norm(reference.path)))].filter((filePath) => filePath !== norm(item.definition?.path ?? "")),
  }));

  // 变量的定义位置：稳定 ID 是 variable:<路径>:<名字>，不带行号，所以要看位置只能查这张表。
  // globals 只留了跨文件的那些，这里要的是全部——派生层按 ID 问位置时不分跨不跨文件。
  const variables = (facts.variables ?? []).filter((item) => item.location).map((item) => ({
    id: item.symbol_id,
    name: item.name,
    file: norm(item.location.path),
    line: item.location.line,
    scope: item.scope ?? null,
  }));

  const cycles = facts.dependencyCycles.map((cycle) => cycle.map(norm));

  // ---- 入口模型：入口、执行单元、可达性、执行域全部来自 ArchCheck v2 事实；这里只做索引与整理，不按函数名猜身份。
  const callersOf = new Map(), calleesOf = new Map();
  for (const pair of callPairs) {
    calleesOf.set(pair.s, [...(calleesOf.get(pair.s) ?? []), pair]);
    callersOf.set(pair.t, [...(callersOf.get(pair.t) ?? []), pair]);
  }
  const isRegionFn = (id) => inRegion(functions.get(id)?.file ?? "");
  const nameOf = (id) => functions.get(id)?.name ?? id.split(":").pop();
  const regionFunctionIds = [...functions.values()].filter((fn) => inRegion(fn.file)).map((fn) => fn.id);

  const mainEntry = facts.entries.find((entry) => entry.kind === "main");
  const mainFn = mainEntry ? functions.get(mainEntry.symbolId) : null;
  const resetEntry = facts.entries.find((entry) => entry.kind === "reset");
  const units = facts.executionUnits.filter((unit) => functions.has(unit.entrySymbolId));
  const unitByEntry = new Map(units.map((unit) => [unit.entrySymbolId, unit]));

  // 中断：向量号 < 0 是 Cortex-M 内核异常；使能点由引擎从 nvic_irq_enable(<IRQn 常量>) 解析，IRQn 走变量时会缺失
  const isrs = units.filter((unit) => unit.kind === "isr" && isRegionFn(unit.entrySymbolId)).map((unit) => ({
    id: unit.entrySymbolId,
    unitId: unit.id,
    kernel: unit.vector < 0,
    vector: unit.vector,
    vectorTable: unit.vectorTable ? { path: norm(unit.vectorTable.path), line: unit.vectorTable.line } : null,
    enablers: [...new Set(unit.enabledAt.map((site) => site.functionId))],
    enabledAt: unit.enabledAt.map((site) => ({ id: site.functionId, line: site.line, priority: site.evidence?.priority ?? null })),
    priority: unit.enabledAt.map((site) => site.evidence?.priority).find(Boolean) ?? null,
    confidence: unit.confidence,
    // 经 API 注册的中断（context: isr 规则，ESP-IDF 那种）：没有向量号，有注册点和规则
    registeredAt: unit.registeredAt ? { id: unit.registeredAt.functionId, line: unit.registeredAt.line } : null,
    rule: unit.rule ?? null,
  }));

  // 任务与回调（处理器）的注册点：registeredAt 是取函数地址的那一行；注册者自身若不在 main 启动路径上，就是运行期注册
  const domainSetOf = (id) => facts.reachability.domains[id] ?? [];
  const registrations = units.filter((unit) => (unit.kind === "task" || unit.kind === "callback") && isRegionFn(unit.entrySymbolId)).map((unit) => ({
    id: unit.entrySymbolId,
    unitId: unit.id,
    kind: unit.kind === "task" ? "task" : "handler",
    rule: unit.rule,
    confidence: unit.confidence,
    registrars: unit.registeredAt ? [{ id: unit.registeredAt.functionId, line: unit.registeredAt.line, runtime: !domainSetOf(unit.registeredAt.functionId).includes("main") }] : [],
    dispatchers: unit.dispatchers ?? [], // 经函数指针槽位真正调用它的函数（回调的宿主由此倒推）
    // 宿主任务：引擎可达性里能到达它的分发器（或它本身）的任务单元
    hosts: unit.hosts ?? [], // 引擎给的宿主上下文（经 dispatches 边可达它的 isr / task / main 单元）
    hostConfidence: unit.hostConfidence ?? null,
    // 任务优先级（引擎从创建调用或属性结构体初始化器解出）：{ value, symbol, argument, basis, at }；没有就是 null
    priority: unit.priority ?? null,
  }));
  // 注册边与使能边：不是调用，但它们是"入口如何被装进系统"的事实；预览树把它们和调用边一起展开，可达性只沿调用边 + 注册边走
  const registerPairs = registrations.flatMap((item) => item.registrars.map((registrar) => ({ s: registrar.id, t: item.id, line: registrar.line, kind: "register" })));
  const irqPairs = isrs.flatMap((isr) => isr.enabledAt.map((site) => ({ s: site.id, t: isr.id, line: site.line, kind: "irq" })));

  // 启动树：从 main 沿调用边在区域内下钻，只保留子树里装了入口（注册 / 使能）的分支；其余纯初始化调用计数折叠
  const registrationsBy = new Map(); for (const pair of registerPairs) registrationsBy.set(pair.s, [...(registrationsBy.get(pair.s) ?? []), pair]);
  const irqEnablesBy = new Map(); for (const pair of irqPairs) irqEnablesBy.set(pair.s, [...(irqEnablesBy.get(pair.s) ?? []), pair]);
  const entryIds = new Set(units.map((unit) => unit.entrySymbolId));
  const bootTree = (() => {
    const seen = new Set();
    const installsSomething = new Map();
    const build = (id, depth) => {
      seen.add(id);
      const kids = (calleesOf.get(id) ?? []).filter((pair) => functions.has(pair.t) && !entryIds.has(pair.t));
      const registrationsHere = (registrationsBy.get(id) ?? []).map((pair) => ({ id: pair.t, kind: unitByEntry.get(pair.t).kind === "task" ? "task" : "handler", line: pair.line }));
      const irqEnables = (irqEnablesBy.get(id) ?? []).map((pair) => ({ id: pair.t, line: pair.line }));
      const libraryInits = kids.filter((pair) => !isRegionFn(pair.t)).length;
      const candidates = kids.filter((pair) => isRegionFn(pair.t) && !seen.has(pair.t));
      const children = depth < 8 ? candidates.map((pair) => build(pair.t, depth + 1)) : [];
      const kept = children.filter((child) => installsSomething.get(child.id));
      installsSomething.set(id, Boolean(registrationsHere.length || irqEnables.length || kept.length));
      return { id, registrations: registrationsHere, irqEnables: irqEnables.length, irqTargets: irqEnables, libraryInits, plainCalls: children.length - kept.length, children: kept };
    };
    return mainFn ? build(mainFn.id, 0) : null;
  })();

  // 重复定义：同名且都带函数体（条件编译两个分支都被收进事实）；compileBranch 记录所在分支
  const byName = new Map();
  for (const fn of functions.values()) if (inRegion(fn.file)) byName.set(fn.name, [...(byName.get(fn.name) ?? []), fn.id]);
  const duplicates = [...byName.entries()].filter(([, ids]) => ids.length > 1).map(([name, ids]) => ({ name, ids, branches: ids.map((id) => functions.get(id).compileBranch) }));

  // 执行域：引擎给的是根集合（main / task / callback / isr）；呈现时折成五档，原始集合保留供侧栏解释
  const domainOf = (id) => { const set = domainSetOf(id); if (!set.length) return "unreached"; const isr = set.includes("isr"); const other = set.some((root) => root !== "isr"); return isr && other ? "mixed" : isr ? "isr" : set.every((root) => root === "main") ? "main" : "task"; };
  const unreached = facts.reachability.unreached.filter((id) => functions.has(id) && isRegionFn(id));
  const unitsReaching = new Map();
  for (const [unitId, reached] of Object.entries(facts.reachability.byUnit)) for (const id of reached) unitsReaching.set(id, [...(unitsReaching.get(id) ?? []), unitId]);
  const unitEntry = new Map(units.map((unit) => [unit.id, unit.entrySymbolId]));
  const mixed = regionFunctionIds.filter((id) => domainOf(id) === "mixed").map((id) => {
    const reaching = (unitsReaching.get(id) ?? []).map((unitId) => ({ unitId, entry: unitEntry.get(unitId), kind: unitId.split(":")[0] }));
    return { id, isrs: reaching.filter((item) => item.kind === "isr").map((item) => item.entry), tasks: reaching.filter((item) => item.kind === "task").map((item) => item.entry), callbacks: reaching.filter((item) => item.kind === "callback").map((item) => item.entry), roots: domainSetOf(id) };
  });
  const uniqueNames = (ids) => new Set(ids.map(nameOf)).size;

  // 事实质量与契约信号：跨文件 extern 直调、引擎判定的契约绕过（无 include 路径到被调模块）、类型专用 include、覆盖率
  const externDeclarations = (facts.externDeclarations ?? []).map((item) => ({ name: item.name, declaredIn: { path: norm(item.declaredIn.path), line: item.declaredIn.line }, resolvesTo: item.resolvesTo, viaHeader: Boolean(item.viaHeader) }));
  const contractBypass = (facts.contractBypass ?? []).filter((item) => functions.has(item.caller) && functions.has(item.callee) && isRegionFn(item.caller)).map((item) => ({ s: item.caller, t: item.callee, line: item.location?.line ?? null, reason: item.reason }));
  const regionSources = (facts.coverage?.excluded ?? []).filter((item) => inRegion(item.path));
  const coverage = facts.coverage ? { translationUnits: facts.coverage.translationUnits, filesAnalyzed: facts.coverage.filesAnalyzed, sourceFilesOnDisk: facts.coverage.sourceFilesOnDisk, regionAnalyzed: [...files.values()].filter((file) => inRegion(file.path) && !file.unmeasured && /\.(c|cc|cpp|s)$/i.test(file.path)).length, regionExcluded: regionSources.map((item) => ({ path: norm(item.path), reason: item.reason })) } : null;

  // schema 4：解析不出中断号的使能点（IRQn 走变量）、未激活 #if 区域里的函数定义（文本扫描近似）、未激活比例最高的文件
  const enableSites = (facts.enableSites ?? []).filter((site) => isRegionFn(site.function)).map((site) => ({ function: site.function, line: site.location?.line ?? null, argumentExpr: site.argumentExpr ?? "", callee: site.callee ?? "", resolvedTo: (site.resolvedTo ?? []).filter((id) => functions.has(id)), reason: site.reason ?? null }));
  const inactive = {
    functions: (facts.inactiveFunctions ?? []).filter((item) => inRegion(item.path)).map((item) => ({ name: item.name, path: norm(item.path), line: item.line, region: item.region ?? null })),
    files: (facts.inactiveRegions ?? []).filter((item) => inRegion(item.path) && item.inactiveLines > 0).map((item) => ({ path: norm(item.path), inactiveLines: item.inactiveLines, totalLines: item.totalLines, ratio: item.ratio, regions: (item.regions ?? []).length })).sort((a, b) => b.ratio - a.ratio),
  };

  const entries = {
    main: mainFn?.id ?? null,
    // main 单元的 ID 跟引擎一致：<kind>:<函数名>。main() 是 main:main，ESP-IDF 是 main:app_main，Arduino 是 main:loop
    mainUnit: mainFn ? `main:${mainFn.name}` : null,
    // 框架代为无限调用的入口（Arduino loop）：整个函数体就是大循环的一轮
    mainSuperloop: Boolean(mainEntry?.superloop),
    enableSites,
    inactive,
    externalSymbols: [...functions.values()].filter((fn) => fn.external).map((fn) => ({ id: fn.id, name: fn.name, library: fn.library, declaredIn: fn.declaredIn, callers: (callersOf.get(fn.id) ?? []).map((pair) => pair.s) })),
    reset: resetEntry?.symbolId ?? null,
    bootTree,
    registrations,
    isrs,
    duplicates,
    domains: Object.fromEntries(regionFunctionIds.map((id) => [id, domainOf(id)])),
    domainSets: Object.fromEntries(regionFunctionIds.map((id) => [id, domainSetOf(id)]).filter(([, set]) => set.length)),
    unreached,
    mixed,
    externDeclarations,
    units: units.map((unit) => ({ id: unit.id, kind: unit.kind, entry: unit.entrySymbolId, rule: unit.rule ?? null, confidence: unit.confidence })),
    counts: { functions: regionFunctionIds.length, uniqueFunctions: uniqueNames(regionFunctionIds), isrs: isrs.filter((isr) => !isr.kernel).length, kernel: isrs.filter((isr) => isr.kernel).length, tasks: registrations.filter((item) => item.kind === "task").length, handlers: registrations.filter((item) => item.kind === "handler").length, unreached: unreached.length, isrOnly: regionFunctionIds.filter((id) => domainOf(id) === "isr").length, mixed: mixed.length, bootOnly: regionFunctionIds.filter((id) => domainOf(id) === "main").length },
  };

  // ---- AST 层（schema 3）：运行模式、状态机、资源读写、临界区、共享资源与冲突候选。全部是引擎产出，这里只按区域过滤并建索引。
  const touchesRegion = (sides) => (sides ?? []).some((side) => (side.accesses ?? []).some((access) => isRegionFn(access.function)));
  const ast = {
    present: Boolean(facts.astFacts),
    summary: facts.astFacts ?? null,
    runModes: Object.fromEntries((facts.runModes ?? []).map((item) => [item.unitId, { mode: item.mode, confidence: item.confidence, periodMs: item.periodMs ?? null, evidence: item.evidence ?? null }])),
    wakeRelations: (facts.wakeRelations ?? []).filter((item) => [...(item.producers ?? []), ...(item.consumers ?? [])].some((site) => isRegionFn(site.function))),
    loops: (facts.loops ?? []).filter((item) => isRegionFn(item.function)),
    stateMachines: (facts.stateMachines ?? []).filter((item) => isRegionFn(item.function)),
    resourceAccesses: (facts.resourceAccesses ?? []).filter((item) => isRegionFn(item.function)),
    criticalSections: (facts.criticalSections ?? []).filter((item) => isRegionFn(item.function)),
    criticalSectionsTotal: facts.scanTotals?.criticalSections ?? (facts.criticalSections ?? []).length, // 整次扫描的数，CLI 摘要报的是它；面板只列区域内的
    controlFlow: (facts.controlFlow ?? []).filter((item) => isRegionFn(item.function)),
    enums: (facts.enums ?? []).map((item) => ({ name: item.name, location: { path: norm(item.location.path), line: item.location.line }, members: item.members })),
    sharedResources: (facts.sharedResources ?? []).filter((item) => touchesRegion(item.units)),
    conflictCandidates: (facts.conflictCandidates ?? []).filter((item) => touchesRegion(item.isrSide) || touchesRegion(item.otherSide)),
  };
  for (const unit of entries.units) unit.runMode = ast.runModes[unit.id]?.mode ?? null;

  const data = {
    entries,
    ast,
    project: facts.project,
    partition: facts.partition,
    scheduling: facts.scheduling ?? "unknown", // profile 声明的调度模型，节拍页按它分支画
    tickMs: facts.tickMs ?? null,             // 调度 tick 的毫秒数（profile 声明值）
    timeBase: facts.timeBase ?? [],           // 固件里定义时间的那些数字，每条带出处与置信度
    imageFacts: facts.imageFacts ?? null,     // 链接产物里的尺寸（独立证据源，带产物哈希与陈旧计数）
    taskControls: facts.taskControls ?? [],   // 谁在哪一行挂起 / 恢复 / 结束了哪个任务
    dependencyOrder: depOrder,                // 目录级依赖顺序（深度 / 循环组 / 每条边的四个量），只看图
    typeOnlyIncludes: (facts.typeOnlyIncludes ?? []).map((item) => ({ s: norm(item.source), t: norm(item.target), calls: item.calls_between_files ?? 0, refs: item.variable_references ?? 0 })),
    yieldLocals: facts.yieldLocals ?? [],     // 让出前写、让出后读的非 static 局部（无栈协程不保留）
    // 类型依赖：函数 -> 具名类型 -> 定义文件（工程内给路径；external = SDK/libc；unresolved = clangd 没给定义）
    typeUses: (facts.typeUses ?? []).map((item) => ({
      fn: item.function, type: item.type, role: item.role, ptr: item.pointer, n: item.count, res: item.resolution,
      at: { path: norm(item.location.path), line: item.location.line },
      def: item.definedIn ? { path: norm(item.definedIn.path), line: item.definedIn.line } : null,
    })),
    // 数据依赖：写共享变量的单元 -> 读它的单元，带同轮 / 跨轮 / 异步分类；pollingOrder 是分类依据（从 main 深搜、按调用行序的注册）
    // 执行单元之间的数据依赖是单元对的全集：几百个回调两两成对就是几万条、几十 MB，而消费方（节拍 / 抢占图）
    // 只看有任务、中断或 main 参与的对，也只用变量名。回调 × 回调的对丢掉，每对只留名字
    dataDependencies: (facts.dataDependencies ?? [])
      .filter((d) => d.fromKind !== "callback" || d.toKind !== "callback")
      .map((d) => ({ from: d.from, to: d.to, fromKind: d.fromKind, toKind: d.toKind, order: d.order, fromPosition: d.fromPosition ?? null, toPosition: d.toPosition ?? null, resourceCount: d.resourceCount ?? (d.resources ?? []).length, resources: (d.resources ?? []).map((r) => ({ name: r.name, variable: r.variable ?? null })) })),
    // 依据字符串从每一行提到了顶层：140 个字符乘以二十万行，光它自己就是 30 MB。
    // 每行都一样的东西不该每行都写一遍
    dataDependenciesBasis: facts.dataDependenciesBasis ?? null,
    pollingOrder: facts.pollingOrder ?? [],
    // 宏依赖：编译单元 -> 宏 -> 定义文件（clangd 语义 token 里的 macro + 全工程 #define 行；external = 工程里没有 #define）
    macroUses: (facts.macroUses ?? []).map((item) => ({
      file: norm(item.file), macro: item.macro, n: item.count, res: item.resolution, defs: item.definitions,
      at: { path: norm(item.location.path), line: item.location.line },
      def: item.definedIn ? { path: norm(item.definedIn.path), line: item.definedIn.line } : null,
    })),

    region,
    generatedAt,
    layers: [...new Set([...modules.values()].map((module) => module.layer.depth).filter((d) => d != null))].sort((a, b) => b - a).map((depth) => ({ name: `D${depth}`, rank: maxDepth - depth, crosscutting: false, patterns: [] })),
    modules: [...modules.values()].map((module) => ({ id: module.id, name: module.name, external: module.external, rank: module.layer.rank, layerName: module.layer.name, crosscutting: Boolean(module.layer.crosscutting), boundary: Boolean(module.layer.boundary), files: module.files })),
    files: [...files.values()].map((file) => ({ ...file, exports: [...file.exports] })),
    functions: [...functions.values()],
    includeEdges,
    callPairs,
    registerPairs,
    irqPairs,
    referencePairs,
    contractBypass,
    coverage,
    globals,
    variables,
    cycles,
    metrics: facts.metrics,
    engineSchemaVersion: facts.engineSchemaVersion ?? null,
  };

  return data;
}
