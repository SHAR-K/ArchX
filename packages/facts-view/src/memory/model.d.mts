import type { FactsIndex, FactsView } from "../types.d.mts";

export interface MemoryModuleRow {
  id: string; module: string; files: number;
  code: number; ro: number; rw: number; zi: number; rom: number; ram: number;
  objects: Array<{ path: string; sourcePath: string | null; match: string | null; code: number; ro: number; rw: number; zi: number }>;
}

export interface MemorySymbolRow {
  id: string; name: string; section: string | null; size: number; scope: string | null;
  file: string | null; line: number | null; module: string | null;
  sharedUnits: Array<{ unit: string; kind: string }>; touchedByIsr: boolean;
}

export interface MemoryTheme {
  theme: "memory";
  available: boolean;
  reason?: string;
  hint?: string;
  basis?: string;
  artifact: { path: string; kind: string | null; modified: number | null } | null;
  totals: Record<string, number> | null;
  scoped: Record<string, number> | null;
  staleness: Record<string, unknown> | null;
  approximations?: string[];
  matchedByFunctions?: number;
  objectCount?: number;
  modules: MemoryModuleRow[];
  symbols: MemorySymbolRow[];
  sharedBytes?: number;
  sharedCount?: number;
}

export declare function buildMemory(view: FactsView, options?: { index?: FactsIndex }): MemoryTheme;
