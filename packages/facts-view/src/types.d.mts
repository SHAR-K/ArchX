// facts-view 的对外类型。实现是 .mjs（浏览器、webview、宿主都要能直接跑），
// 类型单独声明，让 TypeScript 的消费方也有约束。

export interface SourceLocation {
  path: string;
  line: number;
  column?: number;
}

/** 投影输出。字段很多且大部分是引擎事实的透传，这里只声明消费方用到的部分。 */
export interface FactsView {
  region: string;
  generatedAt: string;
  project?: string;
  partition?: { id?: string; name?: string } | null;
  files: Array<{ path: string; name: string; module: string; [key: string]: unknown }>;
  functions: Array<{ id: string; name: string; file: string; line: number; external?: boolean; [key: string]: unknown }>;
  modules: Array<{ id: string; name: string; external: boolean; [key: string]: unknown }>;
  callPairs: Array<{ s: string; t: string; line?: number | null }>;
  registerPairs: Array<{ s: string; t: string; line?: number | null }>;
  entries: Record<string, any>;
  ast: Record<string, any>;
  [key: string]: unknown;
}

export interface FactsIndex {
  view: FactsView;
  entries: Record<string, any>;
  ast: Record<string, any>;
  fileById: Map<string, any>;
  fnById: Map<string, any>;
  calleesOf: Map<string, Array<{ s: string; t: string; line?: number | null }>>;
  callersOf: Map<string, Array<{ s: string; t: string; line?: number | null }>>;
  reachOf: (id: string) => Set<string>;
  blocksByFn: Map<string, any[]>;
  isrIds: Set<string>;
  regById: Map<string, any>;
  domainOf: (id: string) => string | null;
  fileOf: (id: string) => string | null;
  nameOf: (id: string) => string;
  inRegion: (file: string) => boolean;
}

/** 条件拆出来的一行：一个判断。tone 决定颜色，tag 是行首标签。 */
export interface AtomRow {
  tone: "pos" | "neg" | "guard";
  tag: string;
  text: string;
  line: number | null;
}

export interface FsmEdge {
  from: string;
  to: string;
  kind: "next" | "jump" | "back" | "self" | "exit";
  transition: Record<string, any>;
}

export interface FsmAnalysis {
  names: string[];
  extra: string[];
  edges: FsmEdge[];
  stats: { next: number; jump: number; back: number; self: number; exit: number; helper: number; total: number; linearity: number };
  terminal: string[];
  viaHelper: string[];
  helperWrites: Record<string, Array<{ s: string; t: string; line?: number | null }>>;
  outDeg: Record<string, number>;
  inDeg: Record<string, number>;
  depth: Record<string, number>;
  maxDepth: number;
  start: string[];
  noIn: string[];
  isrWriters: string[];
  /** 线性度的判词，阈值见 fsm/model.mjs 的 linearityVerdict */
  verdict: string;
}

export interface EnumTableRow {
  name: string;
  value: string | null;
  inMachine: boolean;
  isCase: boolean;
  inDeg: number | null;
  outDeg: number | null;
  guards: number;
  role: string;
}

export interface EnumTable {
  enum: { name: string; location: SourceLocation | null; members: number } | null;
  rows: EnumTableRow[];
  unused: number;
}

export interface FsmState {
  id: string;
  name: string;
  location?: SourceLocation | null;
  endLine?: number | null;
  function?: string;
  isEnum?: boolean;
  guards?: any[];
}

export interface FsmMachine {
  id: string;
  members: string[];
  function: string;
  functions: string[];
  file: string | null;
  dispatch: string;
  dispatchVariable: string | null;
  dispatchType: string | null;
  enumType: string | null;
  location: SourceLocation;
  hasDefault: boolean;
  states: FsmState[];
  transitions: Array<Record<string, any>>;
  writersElsewhere: string[];
  confidence: "high" | "medium" | "low";
  owners: Array<{ id: string; kind: string; name: string }>;
  parent: string | null;
  parentState: string | null;
  parentVia: string | null;
  children: string[];
  depth: number;
  waitsOn: Array<{ id: string; dispatch: string; via: string[] }>;
  analysis: FsmAnalysis;
  /** 枚举一览：状态名对到引擎给的枚举定义上，没定义就退回 switch 标签 */
  enumTable: EnumTable;
  /** 每个状态的明细，宿主派生时预先算好 */
  panels?: Record<string, StatePanel>;
}

export interface StateTransitionsTheme {
  theme: "state-transitions";
  available: boolean;
  reason?: string;
  basis?: string;
  machines: FsmMachine[];
  dispatchTables: Array<{ id: string; dispatch: string; function: string; location: SourceLocation; cases: number; demoted?: boolean }>;
}

export interface StatePanelItem {
  number: number;
  to: string;
  toId: string;
  kind: FsmEdge["kind"];
  function: string;
  file: string | null;
  line: number | null;
  helper: string | null;
  siteRows: AtomRow[];
  innerRows: AtomRow[];
  directRows: AtomRow[];
}

export interface StatePanel {
  state: FsmState | null;
  id: string;
  name: string;
  guards: Array<{ letter: string; kind: string; line?: number | null; rows: AtomRow[]; [key: string]: unknown }>;
  items: StatePanelItem[];
}
