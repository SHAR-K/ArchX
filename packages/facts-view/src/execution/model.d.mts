import type { FactsIndex, FactsView } from "../types.d.mts";

export interface TreeChild {
  kind: "call" | "register" | "irq" | "schedule";
  target: string;
  line: number | null;
  derived?: boolean;
}

export interface ExecutionRoot {
  id: string; symbol: string; kind: string; name: string; file: string | null;
  reaches: number;
  vector?: number | null;
  kernel?: boolean;
  rule?: string | null;
  enabledAt?: unknown[];
  registrars?: unknown[];
}

export interface ExecutionTheme {
  compare: RootCompareMatrix;
  theme: "execution";
  available: boolean;
  reason?: string;
  hint?: string;
  basis?: string;
  roots: ExecutionRoot[];
  counts?: Record<string, number> | null;
  unreached: Array<{ id: string; name: string; file: string | null }>;
  duplicates?: unknown[];
  externDeclarations?: unknown[];
  schedulerNames?: string[];
  hasScheduleHop?: boolean;
  regRules?: Record<string, string | null>;
}

export interface CallEdgeEvidence {
  from: { id: string; name: string; file: string; line: number; module: string | null };
  to: { id: string; name: string; file: string; line: number; module: string | null; external: boolean };
  sites: number[];
  cross: boolean;
  bypassesHeader: boolean;
}

export interface RootCompareMatrix {
  rows: Array<{ id: string; name: string }>;
  cols: Array<{ id: string; name: string; kind: string }>;
  cells: Record<string, Record<string, number>>;
  hiddenIsrs: number;
  hiddenOthers: number;
  allIsrs: Array<{ id: string; name: string }>;
  allOthers: Array<{ id: string; name: string; kind: string }>;
}

export declare function compareMatrix(view: FactsView, options?: { index?: FactsIndex }): RootCompareMatrix;

export interface FunctionEntry {
  id: string;
  name: string;
  file: string | null;
  line: number | null;
  kind: string | null;
  chains: Array<{ root: { id: string; name: string; kind: string | null }; path: Array<{ id: string; name: string; file: string | null; hop: string | null }> }>;
  reaches: number;
  direct: Array<{ id: string; name: string }>;
  unreached: boolean;
}

export declare function findFunctions(view: FactsView, query: string, options?: { index?: FactsIndex; limit?: number }): Array<{ id: string; name: string; file: string; line: number }>;
export declare function functionEntry(view: FactsView, id: string, options?: { index?: FactsIndex }): FunctionEntry | null;

export interface RootComparison {
  a: { id: string; name: string; reaches: number };
  b: { id: string; name: string; reaches: number };
  sharedFunctions: Array<{ id: string; name: string; file: string | null }>;
  sharedVariables: Array<{ id: string; name: string; file: string | null; line: number | null; aFunctions: number; bFunctions: number }>;
}

export declare function buildExecution(view: FactsView, options?: { index?: FactsIndex }): ExecutionTheme;
export declare function treeChildren(index: FactsIndex, id: string, options?: { showLibrary?: boolean; showScheduling?: boolean; irqPairs?: Map<string, Array<{ t: string; line?: number | null; kind?: string }>> }): TreeChild[];
export declare function callEdgeEvidence(view: FactsView, fromId: string, toId: string, options?: { index?: FactsIndex }): CallEdgeEvidence | null;
export declare function compareRoots(view: FactsView, aId: string, bId: string, options?: { index?: FactsIndex }): RootComparison;
