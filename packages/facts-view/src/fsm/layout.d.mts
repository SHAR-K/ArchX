import type { FsmAnalysis, FsmMachine } from "../types.d.mts";

export declare const NODE_W: number;
export declare const NODE_H: number;
export declare const TERMINAL_R: number;

export interface FsmLayoutNode {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  terminal: boolean;
  extra: boolean;
  start: boolean;
  flags: Array<{ kind: "helper" | "no-in" | "extra"; text: string }>;
  children: Array<{ id: string; dispatch: string }>;
}

export interface FsmLayoutEdge {
  from: string;
  to: string;
  kind: string;
  index: number;
  points: Array<{ x: number; y: number }>;
  line: number | null;
  via: string | null;
  condition: string | null;
}

export interface FsmSelfLoop {
  from: string;
  to: string;
  kind: "self";
  index: number;
  x: number;
  y: number;
  line: number | null;
  via: string | null;
  condition: string | null;
}

export interface FsmLayout {
  nodes: FsmLayoutNode[];
  edges: FsmLayoutEdge[];
  selfLoops: FsmSelfLoop[];
  init: { to: string; x: number; y: number; targetY: number } | null;
  /** 用了哪种排序器；"fallback" 是 dagre 三种都崩了之后的简单分行 */
  ranker: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export declare function layoutMachine(machine: FsmMachine, analysis: FsmAnalysis, options?: { children?: Array<{ id: string; parentState: string | null; dispatch: string }> }): FsmLayout;
