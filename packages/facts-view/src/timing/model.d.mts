import type { FactsIndex, FactsView } from "../types.d.mts";

export interface TimingLoop {
  id: string; function: string; name: string; file: string | null; line: number; endLine: number | null;
  loopKind: string; infinite: boolean; depth: number;
  class: keyof typeof LOOP_CLASSES | string;
  condition: string | null; mayTimeOut: boolean;
  blocking: Array<{ callee: string; kind: string; via: string; line: number | null; duration: Record<string, unknown> | null }>;
  /** 引擎从 for 头部读出的计数：basis 是 limit 的来源（literal / variable / sizeof / unresolved），max 只在能算出来时有 */
  iterations: { variable?: string; start?: number | string | null; comparison?: string; limit?: string; step?: number; basis?: string; shape?: string; max?: number | null } | null;
  exits: Array<{ kind: string; line: number }>;
}

export interface TimingUnit {
  id: string; unit: string; kind: string; entry: string | null; name: string; file: string | null;
  mode: string | null; modeLabel: string | null; confidence: string | null; periodMs: number | null;
  busyLoops: number; waitLoops: number; basis: Record<string, unknown> | null; outline: OutlineSummary | null; kernel?: boolean;
}

import type { BeatModel } from "./beat.d.mts";
import type { PreemptiveModel } from "./preemptive.d.mts";
import type { OutlineSummary } from "./sequence.d.mts";

export interface TimingTheme {
  beat: BeatModel;
  preemptive: PreemptiveModel;
  theme: "timing";
  available: boolean;
  reason?: string;
  hint?: string;
  basis?: string;
  scheduling?: string;
  tickMs?: number | null;
  timeBase?: Array<Record<string, unknown>>;
  pollingOrder?: Array<{ position: number; unit: string; name: string }>;
  units: TimingUnit[];
  loops: TimingLoop[];
  loopClasses?: Record<string, { label: string; tone: string; hint: string }>;
  counts?: { loops: number; byClass: Record<string, number>; yieldLocals: number; taskControls: number };
  yieldLocals?: Array<{ function: string; name: string; file: string | null; variable: string; writtenAt: { line: number } | null; yieldedAt: { line: number } | null; readAt: { line: number } | null; callee: string | null }>;
}

export declare const LOOP_CLASSES: Record<string, { label: string; tone: string; hint: string }>;
export declare function buildTiming(view: FactsView, options?: { index?: FactsIndex }): TimingTheme;
