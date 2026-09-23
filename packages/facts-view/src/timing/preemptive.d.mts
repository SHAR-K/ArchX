import type { FactsIndex, FactsView } from "../types.d.mts";
import type { BeatChip } from "./beat.d.mts";

export interface PreemptivePriority {
  value: number | null;
  symbol: string | null;
  argument: string | null;
  basis: string;
  path: string | null;
  line: number | null;
}

export interface PreemptiveSite { callee: string; rule: string | null; path: string | null; line: number | null }

export interface PreemptiveRow {
  id: string;
  entry: string;
  name: string;
  file: string | null;
  rule: string | null;
  priority: PreemptivePriority | null;
  mode: string;
  modeNote: string;
  confidence: string | null;
  period: number | null;
  waits: PreemptiveSite[];
  delays: Array<PreemptiveSite & { ms: number | null; argument: string | number | null }>;
  wakeBy: Array<{ name: string; kind: string; producers: string[] }>;
  suspend: { callee: string | null; path: string | null; line: number | null } | null;
  rank: number | null;
}

export interface PreemptiveModel {
  available: boolean;
  reason?: string;
  hint?: string;
  scheduling?: string;
  order?: "ascending" | "descending";
  tick?: { ms: number; basis: string };
  rows: PreemptiveRow[];
  isrs: Array<{ id: string; entry: string; name: string; preempt: number | null; vector: number | null }>;
  lcm?: number;
  minPeriod?: number | null;
  chips?: BeatChip[];
  dataDeps: Array<{ from: string; to: string; resources: string[] }>;
  counts?: { tasks: number; known: number; periodic: number; eventDriven: number; unresolved: number };
  basis?: string;
}

export interface PreemptiveLayout {
  width: number; height: number; t0: number; t1: number; span: number; total: number; pxPerMs: number;
  ticks: Array<{ x: number; y1: number; y2: number; label: string }>;
  header: { x: number; y: number; text: string };
  isrBand: { x: number; y: number; w: number; h: number; tx: number; ty: number; text: string };
  rows: Array<{
    id: string; entry: string; name: string; rank: number | null; mode: string; period: number | null; y: number;
    label: { x: number; y: number; text: string };
    prio: { x: number; y: number; text: string; path: string | null; line: number | null; unresolved: boolean };
    lane: { x1: number; x2: number; y: number };
    cells: Array<{ x: number; y: number; w: number; h: number; t: number; deferred: number }>;
    leads: Array<{ x1: number; x2: number; y: number }>;
    band: { x: number; y: number; w: number; h: number; kind: string; title: string } | null;
    note: { x: number; y: number; text: string } | null;
    suspend: { x: number; y: number; callee: string | null; path: string | null; line: number | null } | null;
  }>;
}

export declare function buildPreemptive(view: FactsView, options?: { index?: FactsIndex }): PreemptiveModel;
export declare function layoutPreemptive(model: PreemptiveModel, options?: { width?: number; t0?: number; span?: number }): PreemptiveLayout;
