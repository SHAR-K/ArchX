import type { FactsIndex, FactsView } from "../types.d.mts";

export declare const ORDER_LABEL: Record<string, string>;

export interface BeatSegment {
  calls: number;
  rawCalls: number;
  bounded: number;
  unbounded: number;
  wait: number | null;
  callee: string | null;
  kind: string | null;
}

export interface BeatDelay {
  key: string;
  callee: string;
  value: number | null;
  unit: string;
  argument: string | number | null;
  resolvedFrom: string | null;
  path: string | null;
  line: number | null;
}

export interface BeatRow {
  id: string;
  entry: string;
  name: string;
  file: string | null;
  order: number | null;
  mode: string;
  period: number | null;
  always: boolean;
  delays: BeatDelay[];
  seq: BeatSegment[];
  alternatives: number;
  unbounded: number;
  work: number;
  suspend: { callee: string | null; path: string | null; line: number | null } | null;
}

export interface BeatChip {
  label: string;
  value: string;
  path: string | null;
  line: number | null;
  bad: boolean;
}

export interface BeatDataDep {
  from: string;
  to: string;
  fromKind: string;
  toKind: string;
  order: string;
  label: string;
  fromPosition: number | null;
  toPosition: number | null;
  resources: Array<{ name: string; variable: string | null; file: string | null; line: number | null }>;
}

export interface BeatModel {
  available: boolean;
  reason?: string;
  hint?: string;
  scheduling?: string;
  tick?: { ms: number; basis: "code" | "declared"; fact: Record<string, unknown> | null };
  rows: BeatRow[];
  lcm?: number;
  minPeriod?: number | null;
  unplaced?: number;
  isrs?: number;
  chips?: BeatChip[];
  dataDeps: { rows: BeatDataDep[]; counts: Record<string, number> };
  pollingOrder?: Array<{ position: number; unit: string; name: string }>;
}

export interface BeatLayoutRow {
  id: string;
  entry: string;
  name: string;
  order: number | null;
  y: number;
  always: boolean;
  period: number | null;
  mode: string;
  unbounded: boolean;
  label: { x: number; y: number; text: string };
  lane: { x1: number; x2: number; y: number };
  cells: Array<{ x: number; y: number; w: number; h: number; unbounded: boolean; t: number | null; index: number; count: number; calls: number; bounded: number; unboundedCount: number; wait: number | null; callee: string | null }>;
  yields: Array<{ x: number; y1: number; y2: number; sleep: boolean }>;
  leads: Array<{ x1: number; x2: number; y: number }>;
  band: { x: number; y: number; w: number; h: number; title: string } | null;
  note: { x: number; y: number; text: string; inPlot?: boolean } | null;
  chips: Array<{ x: number; y: number; w: number; h: number; label: string; title: string; path: string | null; line: number | null }>;
  suspend: { x: number; y: number; callee: string | null; path: string | null; line: number | null } | null;
}

export interface BeatLayout {
  width: number;
  height: number;
  t0: number;
  t1: number;
  span: number;
  total: number;
  pxPerMs: number;
  stepMs: number;
  header: { x: number; y: number; text: string };
  isrBand: { x: number; y: number; w: number; h: number; text: string; tx: number; ty: number };
  ticks: Array<{ x: number; y1: number; y2: number; label: string }>;
  rows: BeatLayoutRow[];
}

export declare function buildBeat(view: FactsView, options?: { index?: FactsIndex }): BeatModel;
export declare function layoutBeat(model: BeatModel, options?: { width?: number; t0?: number; span?: number }): BeatLayout;
