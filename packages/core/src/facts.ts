import type { ArchitecturePartition } from "./types.ts";

export interface FactLocation {
  path: string;
  line: number;
  column: number;
}

export interface FactFileMetric {
  path: string;
  architecture_node: string;
  total_lines: number;
  code_lines: number;
  fan_in: number;
  fan_out: number;
  global_variables?: number;
  cross_file_globals?: number;
  in_dependency_cycle?: boolean;
  risk_score: number;
}

export interface FactDocumentation {
  brief: string;
  params: Array<[string, string]>;
  returns: string;
  notes: string[];
  warnings: string[];
}

export interface FactSymbol {
  symbol_id: string;
  name: string;
  detail: string;
  location: FactLocation;
  end_line?: number;
  documentation?: FactDocumentation | null;
  /** schemaVersion 2: false for prototypes; the function table only lists definitions. */
  isDefinition?: boolean;
  /** schemaVersion 2: conjunction of `#if` conditions the definition sits under. */
  compileBranch?: string | null;
  /** schemaVersion 2: the body lives in a header (static inline helper, CMSIS intrinsic). */
  definedInHeader?: boolean;
}

/**
 * `relation` is `calls | references | declares` in schemaVersion 1 and additionally
 * `address_of | registers_task | registers_callback | enables_isr` in schemaVersion 2.
 */
export interface FactEdge {
  source: string;
  target: string;
  relation?: string;
  locations?: FactLocation[];
  /** address_of: which argument of `callee` carried the function name. */
  argumentIndex?: number;
  callee?: string;
  /** registers_* / enables_isr: the framework rule that interpreted the raw edge. */
  rule?: string;
}

export interface FactCoverage {
  target: string;
  sourceFilesOnDisk: number;
  translationUnits: number;
  filesAnalyzed: number;
  excluded: Array<{ path: string; reason: string }>;
}

export interface FactEntryPoint {
  kind: string;
  symbolId: string;
}

export interface FactCodeSite {
  functionId: string;
  path: string;
  line: number;
}

export interface FactExecutionUnit {
  id: string;
  kind: string;
  entrySymbolId: string;
  confidence: string;
  vector?: number | null;
  vectorTable?: FactLocation | null;
  enabledAt?: FactCodeSite[];
  registeredAt?: FactCodeSite | null;
  alsoRegisteredAt?: FactCodeSite[];
  rule?: string | null;
}

export interface FactExternDeclaration {
  name: string;
  declaredIn: FactLocation;
  resolvesTo: string | null;
  viaHeader: boolean;
}

export interface FactReachability {
  byUnit: Record<string, string[]>;
  domains: Record<string, string[]>;
  unreached: string[];
}

export interface FactContractBypass {
  caller: string;
  callee: string;
  location: FactLocation;
  reason: string;
}

export interface FactTypeOnlyInclude {
  source: string;
  target: string;
  callsBetweenFiles: number;
  variableReferences: number;
}

/** A schemaVersion 3 fact anchored to one function (`loops`, `stateMachines`, `resourceAccesses`, `criticalSections`). */
export interface FactFunctionScoped {
  function: string;
  location?: FactLocation;
  [key: string]: unknown;
}

/** A schemaVersion 3 derivation anchored to one execution unit (`runModes`). */
export interface FactUnitScoped {
  unitId: string;
  function?: string;
  [key: string]: unknown;
}

export interface FactResourceSide {
  unit?: string;
  accesses?: Array<{ function: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** A schemaVersion 3 derivation anchored to one shared variable (`sharedResources`, `conflictCandidates`). */
export interface FactResourceScoped {
  variable?: string | null;
  name?: string;
  units?: FactResourceSide[];
  isrSide?: FactResourceSide[];
  otherSide?: FactResourceSide[];
  [key: string]: unknown;
}

/** schemaVersion 2 additions to an ArchCheck report; every field is absent in schemaVersion 1. */
export interface ArchCheckRuntimeFacts {
  coverage?: FactCoverage | null;
  entries?: FactEntryPoint[];
  executionUnits?: FactExecutionUnit[];
  externDeclarations?: FactExternDeclaration[];
  reachability?: FactReachability | null;
  contractBypass?: FactContractBypass[];
  typeOnlyIncludes?: FactTypeOnlyInclude[];
  /** schemaVersion 3 (ArchCheck 0.3.x) AST-layer facts and derivations; kept loosely typed until the schema settles. */
  loops?: FactFunctionScoped[];
  stateMachines?: FactFunctionScoped[];
  resourceAccesses?: FactFunctionScoped[];
  criticalSections?: FactFunctionScoped[];
  runModes?: FactUnitScoped[];
  sharedResources?: FactResourceScoped[];
  conflictCandidates?: FactResourceScoped[];
  astFacts?: Record<string, unknown> | null;
  /** Sizes read from a link artifact (armlink map). A separate evidence source: not derived from source. */
  imageFacts?: FactImageFacts | null;
}

export interface FactImageSymbol {
  name: string;
  kind: "code" | "data" | "ro-data" | "zero-init";
  sizeBytes: number;
  address: string;
  object: string;
  section: string | null;
  scope: "local" | "global";
  sourcePath: string | null;
  symbolId: string | null;
}

export interface FactImageObject {
  object: string;
  sourcePath: string | null;
  codeBytes: number;
  roDataBytes: number;
  rwDataBytes: number;
  ziDataBytes: number;
  romBytes: number;
  ramBytes: number;
  library: boolean;
  match: string | null;
  matchEvidence?: string[];
}

export interface FactImageFacts {
  artifact: { path: string; kind: string; sha1: string; modified: number; sizeBytes: number };
  totals: Record<string, number>;
  objects: FactImageObject[];
  symbols: FactImageSymbol[];
  staleness: Record<string, unknown>;
  approximations?: string[];
  /** Filled by the projection: the part of the image that belongs to this partition. */
  scopedTotals?: Record<string, number>;
}

export interface FactGlobalVariable {
  name: string;
  type_name?: string;
  storage?: string;
  definition: FactLocation;
  references: FactLocation[];
  referenced_files?: number;
  cross_file: boolean;
}

export interface ArchCheckSnapshot extends ArchCheckRuntimeFacts {
  /** Absent in reports written before ArchCheck started versioning its output (treated as 1). */
  schemaVersion?: number;
  project: string;
  analysis_mode: string;
  dependency_edges: FactEdge[];
  dependency_cycles: string[][];
  global_variables: FactGlobalVariable[];
  functions: FactSymbol[];
  variables: FactSymbol[];
  semantic_edges: FactEdge[];
  file_metrics: FactFileMetric[];
  semantic_warnings: string[];
  metrics: Record<string, unknown>;
}

/**
 * The partition projection keeps its own `schemaVersion: 1` envelope; ArchCheck schemaVersion 2
 * facts ride along as optional fields (`engineSchemaVersion` records the source report version)
 * and are trimmed to the partition's focus + boundary file set. `coverage` is whole-project data
 * and passes through untouched.
 */
export interface ScopedFactSnapshot extends ArchCheckRuntimeFacts {
  schemaVersion: 1;
  engineSchemaVersion?: number;
  project: string;
  partition: ArchitecturePartition;
  completeness: "full-scan-projection";
  /** 整次扫描的计数（切分区之前）。CLI 摘要报的是这些数，面板要能对上，否则读者第一个 issue 就是「数字不一致」 */
  scanTotals?: Record<string, number>;
  files: FactFileMetric[];
  dependencyEdges: FactEdge[];
  dependencyCycles: string[][];
  functions: FactSymbol[];
  variables: FactSymbol[];
  semanticEdges: FactEdge[];
  globalVariables: ArchCheckSnapshot["global_variables"];
  warnings: string[];
  metrics: Record<string, unknown>;
}

export interface FactModuleSummary {
  id: string;
  name: string;
  pathPrefix: string;
  focus: boolean;
  files: FactFileMetric[];
  totalLines: number;
  codeLines: number;
  maxRisk: number;
  globalVariables: number;
  cycleFiles: number;
}

export interface FactModuleEdge {
  id: string;
  source: string;
  target: string;
  count: number;
}

export interface FactModuleGraph {
  modules: FactModuleSummary[];
  edges: FactModuleEdge[];
  fileToModule: Record<string, string>;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\0").replaceAll("*", "[^/]*").replaceAll("\0", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function pathMatchesAny(file: string, patterns: string[]): boolean {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function focusRoots(partition: ArchitecturePartition): string[] {
  return partition.focusPaths.map((pattern) => normalizedPath(pattern.replace(/\/\*\*.*$/, ""))).filter(Boolean);
}

function moduleForFile(file: string, roots: string[]): { id: string; name: string; pathPrefix: string; focus: boolean } {
  const normalized = normalizedPath(file);
  const root = roots.find((candidate) => normalized === candidate || normalized.startsWith(`${candidate}/`));
  if (root) {
    const relative = normalized.slice(root.length).replace(/^\//, "");
    const parts = relative.split("/").filter(Boolean);
    const hasSubdirectory = parts.length > 1;
    const pathPrefix = hasSubdirectory ? `${root}/${parts[0]}` : root;
    return { id: `module:${pathPrefix}`, name: hasSubdirectory ? parts[0] : root.split("/").at(-1) ?? root, pathPrefix, focus: true };
  }
  const pathPrefix = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : ".";
  return { id: `boundary:${pathPrefix}`, name: pathPrefix.split("/").at(-1) ?? pathPrefix, pathPrefix, focus: false };
}

export function deriveFactModuleGraph(facts: ScopedFactSnapshot): FactModuleGraph {
  const roots = focusRoots(facts.partition);
  const modules = new Map<string, FactModuleSummary>();
  const fileToModule: Record<string, string> = {};
  for (const file of facts.files) {
    const descriptor = moduleForFile(file.path, roots);
    fileToModule[file.path] = descriptor.id;
    const current = modules.get(descriptor.id) ?? {
      ...descriptor,
      files: [],
      totalLines: 0,
      codeLines: 0,
      maxRisk: 0,
      globalVariables: 0,
      cycleFiles: 0,
    };
    current.files.push(file);
    current.totalLines += file.total_lines;
    current.codeLines += file.code_lines;
    current.maxRisk = Math.max(current.maxRisk, file.risk_score);
    current.globalVariables += file.global_variables ?? 0;
    current.cycleFiles += file.in_dependency_cycle ? 1 : 0;
    modules.set(descriptor.id, current);
  }

  const edgeCounts = new Map<string, FactModuleEdge>();
  for (const edge of facts.dependencyEdges) {
    const source = fileToModule[edge.source];
    const target = fileToModule[edge.target];
    if (!source || !target || source === target) continue;
    const id = `module-edge:${source}->${target}`;
    const current = edgeCounts.get(id) ?? { id, source, target, count: 0 };
    current.count += 1;
    edgeCounts.set(id, current);
  }

  return {
    modules: [...modules.values()].sort((left, right) => Number(right.focus) - Number(left.focus) || left.name.localeCompare(right.name)),
    edges: [...edgeCounts.values()].sort((left, right) => right.count - left.count),
    fileToModule,
  };
}

export function projectFactsToPartition(snapshot: ArchCheckSnapshot, partition: ArchitecturePartition): ScopedFactSnapshot {
  const inFocus = (file: string) => pathMatchesAny(file, partition.focusPaths);
  const focusedFilePaths = new Set(snapshot.file_metrics.filter((file) => inFocus(file.path)).map((file) => file.path));
  const dependencyEdges = snapshot.dependency_edges.filter((edge) => inFocus(edge.source) || inFocus(edge.target));
  for (const edge of dependencyEdges) {
    focusedFilePaths.add(edge.source);
    focusedFilePaths.add(edge.target);
  }

  const focusedSymbols = new Set([
    ...snapshot.functions.filter((symbol) => inFocus(symbol.location.path)).map((symbol) => symbol.symbol_id),
    ...snapshot.variables.filter((symbol) => inFocus(symbol.location.path)).map((symbol) => symbol.symbol_id),
  ]);
  const semanticEdges = snapshot.semantic_edges.filter((edge) => focusedSymbols.has(edge.source) || focusedSymbols.has(edge.target));
  const boundarySymbols = new Set(semanticEdges.flatMap((edge) => [edge.source, edge.target]));
  const functions = snapshot.functions.filter((symbol) => boundarySymbols.has(symbol.symbol_id) || inFocus(symbol.location.path));

  const scoped: ScopedFactSnapshot = {
    schemaVersion: 1,
    project: snapshot.project,
    partition,
    completeness: "full-scan-projection",
    files: snapshot.file_metrics.filter((file) => focusedFilePaths.has(file.path)),
    dependencyEdges,
    dependencyCycles: snapshot.dependency_cycles.filter((cycle) => cycle.some(inFocus)),
    functions,
    variables: snapshot.variables.filter((symbol) => boundarySymbols.has(symbol.symbol_id) || inFocus(symbol.location.path)),
    semanticEdges,
    globalVariables: snapshot.global_variables.filter((variable) => inFocus(variable.definition.path) || variable.references.some((location) => inFocus(location.path))),
    warnings: snapshot.semantic_warnings,
    metrics: snapshot.metrics,
  };
  if (typeof snapshot.schemaVersion === "number") scoped.engineSchemaVersion = snapshot.schemaVersion;

  // schemaVersion 2 facts: keep an entry when one of its endpoints or locations falls inside the
  // partition's focus + boundary set (scoped files, or symbols retained above).
  const scopedFiles = new Set(scoped.files.map((file) => file.path));
  const inScopeFile = (file: string | undefined) => Boolean(file) && (scopedFiles.has(file!) || inFocus(file!));
  const scopedSymbols = new Set(functions.map((symbol) => symbol.symbol_id));
  const inScopeSymbol = (id: string | null | undefined) => Boolean(id) && (scopedSymbols.has(id!) || boundarySymbols.has(id!) || inScopeFile(symbolPath(id!)));
  const inScopeSite = (site: FactCodeSite | null | undefined) => Boolean(site) && (inScopeSymbol(site!.functionId) || inScopeFile(site!.path));

  if (snapshot.coverage !== undefined) scoped.coverage = snapshot.coverage;
  if (snapshot.entries) scoped.entries = snapshot.entries.filter((entry) => inScopeSymbol(entry.symbolId));
  if (snapshot.executionUnits) {
    scoped.executionUnits = snapshot.executionUnits.filter((unit) =>
      inScopeSymbol(unit.entrySymbolId) || inScopeSite(unit.registeredAt) || (unit.alsoRegisteredAt ?? []).some(inScopeSite) || (unit.enabledAt ?? []).some(inScopeSite));
  }
  if (snapshot.externDeclarations) {
    scoped.externDeclarations = snapshot.externDeclarations.filter((declaration) => inScopeFile(declaration.declaredIn.path) || inScopeSymbol(declaration.resolvesTo));
  }
  if (snapshot.reachability !== undefined) {
    const reachability = snapshot.reachability;
    if (reachability === null) scoped.reachability = null;
    else {
      const unitIds = new Set([
        ...(scoped.executionUnits ?? []).map((unit) => unit.id),
        ...(scoped.entries ?? []).map((entry) => `${entry.kind}:${symbolName(entry.symbolId)}`),
      ]);
      const byUnit: Record<string, string[]> = {};
      for (const [unit, members] of Object.entries(reachability.byUnit ?? {})) {
        const kept = members.filter(inScopeSymbol);
        if (unitIds.has(unit) || kept.length > 0) byUnit[unit] = kept;
      }
      const domains: Record<string, string[]> = {};
      for (const [symbol, kinds] of Object.entries(reachability.domains ?? {})) {
        if (inScopeSymbol(symbol)) domains[symbol] = kinds;
      }
      scoped.reachability = { byUnit, domains, unreached: (reachability.unreached ?? []).filter(inScopeSymbol) };
    }
  }
  if (snapshot.contractBypass) {
    scoped.contractBypass = snapshot.contractBypass.filter((item) => inScopeSymbol(item.caller) || inScopeSymbol(item.callee) || inScopeFile(item.location.path));
  }
  if (snapshot.typeOnlyIncludes) {
    scoped.typeOnlyIncludes = snapshot.typeOnlyIncludes.filter((item) => inScopeFile(item.source) || inScopeFile(item.target));
  }

  // schemaVersion 3 facts: anchored to a function, an execution unit, or a shared variable.
  const inScopeFunctionFact = (item: FactFunctionScoped) => inScopeSymbol(item.function) || inScopeFile(item.location?.path);
  const scopedUnitIds = new Set((scoped.executionUnits ?? []).map((unit) => unit.id));
  const sideInScope = (sides: FactResourceSide[] | undefined) => (sides ?? []).some((side) => (side.accesses ?? []).some((access) => inScopeSymbol(access.function)));
  const inScopeResourceFact = (item: FactResourceScoped) => inScopeSymbol(item.variable) || sideInScope(item.units) || sideInScope(item.isrSide) || sideInScope(item.otherSide);
  const totals: Record<string, number> = {};
  for (const key of ["loops", "stateMachines", "resourceAccesses", "criticalSections"] as const) {
    if (snapshot[key]) { totals[key] = snapshot[key]!.length; scoped[key] = snapshot[key]!.filter(inScopeFunctionFact); }
  }
  for (const key of ["sharedResources", "conflictCandidates"] as const) if (snapshot[key]) totals[key] = snapshot[key]!.length;
  scoped.scanTotals = totals;
  // 执行单元之间的数据依赖是单元对的全集（O(单元²)）：一个 310 回调的 RTOS 工程有四万对、169 MB，
  // 其中和分区有关的不到百分之一。只留一端在分区里的，main 永远算在里面
  const dataDependencies = (snapshot as unknown as { dataDependencies?: Array<{ from: string; to: string }> }).dataDependencies;
  if (Array.isArray(dataDependencies)) {
    const inScopeUnit = (id: string) => id === "main:main" || scopedUnitIds.has(id);
    (scoped as unknown as Record<string, unknown>).dataDependencies = dataDependencies.filter((d) => inScopeUnit(d.from) || inScopeUnit(d.to));
    totals.dataDependencies = dataDependencies.length;
  }
  if (snapshot.runModes) scoped.runModes = snapshot.runModes.filter((item) => scopedUnitIds.has(item.unitId) || inScopeSymbol(item.function));
  if (snapshot.sharedResources) scoped.sharedResources = snapshot.sharedResources.filter(inScopeResourceFact);
  if (snapshot.conflictCandidates) scoped.conflictCandidates = snapshot.conflictCandidates.filter(inScopeResourceFact);
  if (snapshot.astFacts !== undefined) scoped.astFacts = snapshot.astFacts;
  // 链接产物：整镜像的总量保持原样（RAM/ROM 是全局的，切了就没意义），
  // 符号与目标文件按归属的源文件收进分区，并补一份分区自己的合计。
  if (snapshot.imageFacts) {
    const image = snapshot.imageFacts;
    const objects = (image.objects ?? []).filter((item) => inScopeFile(item.sourcePath ?? undefined));
    const symbols = (image.symbols ?? []).filter((item) => inScopeFile(item.sourcePath ?? undefined));
    const sum = (pick: (item: FactImageObject) => number) => objects.reduce((total, item) => total + pick(item), 0);
    scoped.imageFacts = {
      ...image,
      objects,
      symbols,
      scopedTotals: {
        objects: objects.length,
        symbols: symbols.length,
        codeBytes: sum((item) => item.codeBytes),
        roDataBytes: sum((item) => item.roDataBytes),
        rwDataBytes: sum((item) => item.rwDataBytes),
        ziDataBytes: sum((item) => item.ziDataBytes),
        romBytes: sum((item) => item.romBytes),
        ramBytes: sum((item) => item.ramBytes),
      },
    };
  }

  // Fields this projection does not know yet (newer engine schemas) ride along; array items that carry a
  // recognisable anchor are trimmed to the partition, everything else passes through untouched.
  const anchorInScope = (item: unknown): boolean => {
    if (!item || typeof item !== "object") return true;
    const record = item as Record<string, unknown>;
    const anchors: Array<boolean | null> = [
      typeof record.function === "string" ? inScopeSymbol(record.function) : null,
      typeof record.caller === "string" ? inScopeSymbol(record.caller) : null,
      typeof record.symbolId === "string" ? inScopeSymbol(record.symbolId) : null,
      typeof record.path === "string" ? inScopeFile(record.path) : null,
      typeof (record.location as FactLocation | undefined)?.path === "string" ? inScopeFile((record.location as FactLocation).path) : null,
      Array.isArray(record.declaredIn) ? (record.declaredIn as FactLocation[]).some((site) => inScopeFile(site.path)) : null,
    ].filter((value) => value !== null);
    return anchors.length === 0 || anchors.some(Boolean);
  };
  for (const [key, value] of Object.entries(snapshot)) {
    if (KNOWN_SNAPSHOT_FIELDS.has(key)) continue;
    (scoped as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? value.filter(anchorInScope) : value;
  }
  return scoped;
}

const KNOWN_SNAPSHOT_FIELDS = new Set([
  "schemaVersion", "project", "analysis_mode", "dependency_edges", "dependency_cycles", "global_variables", "functions", "variables",
  "semantic_edges", "file_metrics", "semantic_warnings", "metrics", "coverage", "entries", "executionUnits", "externDeclarations",
  "reachability", "contractBypass", "typeOnlyIncludes", "loops", "stateMachines", "resourceAccesses", "criticalSections", "runModes",
  "sharedResources", "conflictCandidates", "astFacts", "imageFacts", "dataDependencies",
  // whole-project scaffolding the engine emits alongside the facts; never part of a partition projection
  "compile_commands", "architecture_config", "path_mapping", "include_directories", "coupling_hotspots", "architecture_modules",
]);

const SYMBOL_ID_PATTERN = /^(?:function|variable):(.+):([^:]+)$/;

/** File path encoded in an ArchCheck symbol id (`function:<path>:<name>`), if any. */
export function symbolPath(symbolId: string): string | undefined {
  return SYMBOL_ID_PATTERN.exec(symbolId)?.[1];
}

function symbolName(symbolId: string): string {
  return SYMBOL_ID_PATTERN.exec(symbolId)?.[2] ?? symbolId;
}
