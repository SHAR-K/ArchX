import type { FactsIndex, FactsView } from "../types.d.mts";

export declare const FLOW_LABEL: Record<"isr→thread" | "thread→isr" | "mixed" | "isr↔isr" | "thread↔thread", string>;

export interface RunMapUnit {
  id: string;
  fn: string | null;
  kind: string;
  name: string;
  preempt?: number | null;
  vector?: number | null;
  kernel?: boolean;
  hosts?: string[];
  host?: string | null;
  hostConfidence?: string | null;
  mode?: string | null;
  periodMs?: number | null;
}

export interface RunMapVar {
  id: string;
  name: string;
  typeName: string | null;
  units: Array<{ unit: string; kind: string; write: boolean; read: boolean; bareWrite: boolean; bareRead: boolean; accesses: number }>;
  writers: string[];
  readers: string[];
  writerGroups: string[];
  owner: string | null;
  multiWriter: boolean;
  domain: "isr" | "thread";
  layer: 0 | 1 | 2;
  flow: "isr→thread" | "thread→isr" | "mixed" | "isr↔isr" | "thread↔thread";
  cross: boolean;
  pollution: boolean;
  conflict: string | null;
  wake: string | null;
  protMismatch: boolean;
  protectedAll: boolean;
  nonAtomic: boolean;
}

export interface RunMapModel {
  isrs: RunMapUnit[];
  threads: RunMapUnit[];
  vars: RunMapVar[];
  used: string[];
  mainInit: string[];
  worst: Record<string, "conflict" | "pollution" | "mismatch" | "shared" | "idle">;
  flows: Record<RunMapVar["flow"], number>;
  problems: { conflict: number; pollution: number; mismatch: number; nonAtomic: number; wake: number };
}

export interface RunMapNode extends RunMapUnit {
  x: number;
  y: number;
  w: number;
  h: number;
  worst: string;
  writes: number;
  touches: number;
}

export interface RunMapLayout {
  width: number;
  height: number;
  pad: number;
  rowLabels: { isr: { x: number; y: number; text: string }; thread: { x: number; y: number; text: string } };
  layers: Array<{ index: number; top: number; height: number; count: number; label: string; x: number; width: number }>;
  isrs: RunMapNode[];
  threads: RunMapNode[];
  idle: { isr: { x: number; y: number; count: number; w: number; h: number } | null; thread: { x: number; y: number; count: number; w: number; h: number } | null };
  vars: Array<{ id: string; name: string; x: number; y: number; w: number; h: number; layer: number; cls: string; flags: { multiWriter: boolean; writerCount: number; protectedAll: boolean; nonAtomic: boolean; protMismatch: boolean }; owner: string | null; flow: string }>;
  edges: Array<{ var: string; unit: string; kind: "write" | "read" | "both"; d: string; cls: string; bad: boolean; bare: boolean }>;
  page: { id: string; name: string; kind: string } | null;
}

export declare function buildRunMap(view: FactsView, options?: { index?: FactsIndex }): RunMapModel;
export declare function layoutRunMap(model: RunMapModel, options?: { page?: string | null; focus?: string | null; filter?: string | null; expandIdle?: boolean }): RunMapLayout;
