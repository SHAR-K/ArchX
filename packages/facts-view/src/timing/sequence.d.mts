import type { FactsIndex, FactsView } from "../types.d.mts";
import type { TimingLoop } from "./model.d.mts";

export interface RoundVariable {
  name: string;
  kinds: string[];
  write: boolean;
  inCritical: boolean;
  where: string;
  conflict: boolean;
  wake: boolean;
  isrWriters: string[];
}

export interface RoundBadge {
  loop: TimingLoop;
  badge: string;
  /** 这个循环上一次已经开过框了，这里只是又走到它 */
  repeat: boolean;
}

export type RoundRow =
  | { type: "step"; key: string; indent: number; self: boolean; target: string; name: string; file: string | null; line: number; kind: string | null; variables: RoundVariable[]; yields: Array<{ callee: string; kind: string; line: number }>; deepYield: boolean; badges: RoundBadge[] }
  | { type: "chain"; key: string; indent: number; target: string; name: string; file: string | null; line: number | null; badges: RoundBadge[] }
  | { type: "yield"; key: string; indent: number; callee: string; kind: string; line: number; fn: string; file: string | null; badges: RoundBadge[]; conditional: boolean }
  | { type: "frame"; key: string; indent: number; kind: string; label: string; line: number; to: number; fn: string; file: string | null; badges: RoundBadge[] }
  | { type: "frame-close"; key: string; indent: number };

export interface RoundExit {
  type: "cond" | "break" | "return" | "goto" | "none" | "loopback";
  text?: string | null;
  line?: number;
}

export interface RoundBox {
  id: string;
  depth: number;
  scope: string;
  badge: string | null;
  /** 长出这个框的那一行的 key，渲染方靠它把框对到父框那一行的高度上 */
  spawnKey: string | null;
  fn: string;
  name: string;
  file: string | null;
  loop: { id: string; class: string; kind: string; line: number; endLine: number | null; condition: string | null; mayTimeOut: boolean; infinite: boolean } | null;
  exits: RoundExit[];
  rows: RoundRow[];
}

export interface Round {
  id: string;
  available: boolean;
  reason?: string;
  root: string;
  name: string;
  file: string | null;
  range: { from: number; to: number; kind: "loop" | "body"; label: string };
  levels: RoundBox[][];
  /** 还有没展开完的层：说出来，别让人以为就这么深 */
  truncated: boolean;
  maxLevels: number;
  counts: { boxes: number; steps: number; yields: number; unguarded: number };
}

export declare function buildRound(
  view: FactsView,
  rootId: string,
  options?: {
    index?: FactsIndex;
    classifier?: unknown;
    showIterations?: boolean;
    maxLevels?: number;
    range?: { from: number; to: number; kind: "loop" | "body"; label: string };
    stateFunction?: string;
  },
): Round;

export declare function roundSteps(view: FactsView, fnId: string, from: number, to: number, options?: { index?: FactsIndex; classifier?: unknown }): Array<Record<string, unknown>>;
export declare function stepVariables(step: Record<string, unknown>, index: FactsIndex): RoundVariable[];
