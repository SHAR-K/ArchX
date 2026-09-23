import type { FactsIndex, FactsView } from "../types.d.mts";

export interface ConcurrencyUnitCell {
  unit: string; kind: string; glyph: "w" | "r" | "rw" | "addr";
  kinds: string[]; protected: boolean; accesses: number; derived: boolean;
}

export interface ConcurrencyResource {
  id: string; name: string; variable: string | null; file: string | null; line: number | null;
  volatile: boolean; atomicity: string; typeName: string | null;
  units: ConcurrencyUnitCell[];
  conflict: { confidence: string; pattern: string; reason: string | null; role: string | null; approximation: string | null } | null;
  wake: { kind: string; confidence: string; producers: number; consumers: number } | null;
}

import type { RunMapModel } from "./runmap.d.mts";

export interface ConcurrencyTheme {
  runMap: RunMapModel;
  theme: "concurrency";
  available: boolean;
  reason?: string;
  hint?: string;
  basis?: string;
  resources: ConcurrencyResource[];
  units: Array<{ unit: string; kind: string; label: string }>;
  isrs?: Array<{ id: string; kernel: boolean; name: string; file: string | null; vector: number | null; preempt: number | null; sub: number | null; enabled: boolean; registeredAt?: { id: string; name: string; line: number } | null; rule?: string | null }>;
  criticalSections?: Array<{ function: string; name: string; file: string | null; begin: { path: string; line: number } | null; end: { path: string; line: number } | null; api: string; endApi: string | null; kind: string; accesses: number }>;
  counts?: { high: number; medium: number; shared: number; wake: number; criticalSections: number; criticalSectionsTotal?: number; accesses: number };
}

export interface ResourceSides {
  id: string;
  name: string;
  sides: Array<{
    unit: string; kind: string; kinds: string[]; unprotectedKinds: string[];
    accesses: Array<{ function: string; name: string; file: string | null; line: number | null; kind: string; via: string | null; inCriticalSection: boolean; derived: { callee: string; param: string | number; basis: string } | null }>;
  }>;
}

export declare function buildConcurrency(view: FactsView, options?: { index?: FactsIndex }): ConcurrencyTheme;
export declare function resourceSides(view: FactsView, name: string, options?: { index?: FactsIndex }): ResourceSides | null;
