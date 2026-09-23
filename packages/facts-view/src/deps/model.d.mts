import type { FactsIndex, FactsView } from "../types.d.mts";

export interface DepEdge {
  id: string; s: string; t: string;
  includes: number; calls: number; bypass: number; typeOnly: number;
  types: number; macros: number; reads: number; writes: number;
  pairs: Array<{ s: string; t: string }>;
  files: Record<string, number>;
}

export interface DepLeaf {
  id: string; unit: string; members: string[]; label: string; file: string; dir: string; module: string | null;
}

export interface Declarations {
  top: string[]; bottom: string[]; regroup: Record<string, string>; invert: string[]; names: Record<string, string>;
}

export interface DependenciesTheme {
  theme: "dependencies";
  available: boolean;
  reason?: string;
  hint?: string;
  basis?: string;
  region?: string;
  leaves: DepLeaf[];
  edges: DepEdge[];
  projectFeedback?: number;
  fileFeedback?: number;
  fileEdgeCount?: number;
  regionFileCount?: number;
  pairedUnits?: number;
  clusters?: { of: Record<string, number>; stability: Record<string, number>; params: Record<string, unknown> | null; count: number; cost: number | null; initialCost: number | null; iterations: number } | null;
  counts?: { contractBypass: number; typeOnlyIncludes: number; crossFileTypeUses: number; crossFileMacroUses: number };
}

export interface DepTree {
  kind: "dir" | "cluster";
  groups: Set<string>;
  children(group: string): string[];
  parent(id: string): string | null;
  isGroup(id: string): boolean;
  label(id: string): string;
  shortLabel(id: string): string;
  defaultOpen(): Set<string>;
  allOpen(): Set<string>;
}

export interface DepSequence {
  order: string[];
  steps: Array<{ kind: "sink" | "source" | "tear"; node: string; out: number; in: number; weight?: number; block?: number }>;
  feedback: Set<string>;
  level: Map<string, number>;
}

export interface DepBlock {
  group: string; depth: number; kids: string[]; seq: DepSequence;
  order: string[]; pending: Set<string>; edges: DepEdge[]; first: number; last: number;
}

export interface DepLayout {
  rows: string[]; order: string[]; pos: Map<string, number>;
  edges: DepEdge[]; inner: Map<string, number>; blocks: DepBlock[];
  feedback: Set<string>; flat: DepSequence;
  rowOf(leaf: string): string | null;
  depthOf(row: string): number;
  pending: Set<string>; inverted: Set<string>;
  rowsUnder(group: string): string[];
}

export interface EdgeDetail {
  includes: Array<{ s: string; t: string }>;
  calls: Array<{ from: string; to: string; fromName: string; toName: string; file: string; lines: number[] }>;
  types: Array<{ type: string; def: { path: string; line: number }; n: number; functions: number; roles: Record<string, number>; at: { path: string; line: number } }>;
  macros: Array<{ macro: string; def: { path: string; line: number }; n: number; files: number; at: { path: string; line: number } }>;
  reads: Array<{ name: string; path: string; line: number | null; n: number; functions: number; sites: Array<{ path: string; line: number }> }>;
  writes: EdgeDetail["reads"];
}

export declare const ROOT: string;
export declare const EMPTY_DECLARATIONS: Declarations;
export declare function edgeWeight(edge: Partial<DepEdge>): number;
export declare function depSequence(nodes: string[], edges: Array<[string, string, number?]>): DepSequence;
export declare function depOrderAtStep(nodes: string[], steps: DepSequence["steps"], k: number): { order: string[]; pending: Set<string> };
export declare function aggregateEdges(edges: unknown[], mapS: (id: string) => string | null, mapT?: (id: string) => string | null): DepEdge[];
export declare function buildDependencies(view: FactsView, options?: { index?: FactsIndex }): DependenciesTheme;
export declare function dirTree(theme: DependenciesTheme, declarations?: Declarations, moduleDirOf?: (id: string) => string | null): DepTree;
export declare function clusterTree(theme: DependenciesTheme, declarations?: Declarations): DepTree;
export declare function layoutRows(theme: DependenciesTheme, tree: DepTree, open: Set<string>, options?: { declarations?: Declarations; playing?: { group: string; step: number } | null }): DepLayout;
export declare function edgeDetail(view: FactsView, sourceFiles: string[], targetFiles: string[], options?: { index?: FactsIndex }): EdgeDetail;
