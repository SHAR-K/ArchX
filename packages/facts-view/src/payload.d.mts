import type { FactsView, StateTransitionsTheme } from "./types.d.mts";
import type { Declarations, DependenciesTheme } from "./deps/model.d.mts";
import type { ExecutionTheme } from "./execution/model.d.mts";
import type { ConcurrencyTheme } from "./concurrency/model.d.mts";
import type { MemoryTheme } from "./memory/model.d.mts";
import type { TimingTheme } from "./timing/model.d.mts";
import type { buildIndex } from "./graph.mjs";

export interface FactsPayload {
  snapshot: string;
  project: string;
  projectRoot: string;
  partition: string;
  region: string;
  generatedAt: string;
  counts: { files: number; functions: number };
  themes: { stateTransitions: StateTransitionsTheme; memory: MemoryTheme; dependencies: DependenciesTheme; execution: ExecutionTheme; concurrency: ConcurrencyTheme; timing: TimingTheme };
  /** 人的假设，宿主负责落盘；面板只把改动报上来 */
  declarations: Declarations;
  /** 扫任意目录时：所选目录、实际扫描根、构建信息的依据。分区扫描时没有这一段 */
  scope?: { folder: string; buildRoot: string; basis: string };
  /** 视图要把函数 id 变成「文件:行」才能跳转，带一份精简映射，不传整个函数表 */
  functions: Record<string, { name: string; file: string; line: number }>;
}

export interface PayloadMeta {
  snapshot: string;
  project: string;
  projectRoot?: string;
  partition?: string;
  region?: string;
  generatedAt: string;
  declarations?: Declarations;
  scope?: FactsPayload["scope"];
}

export type IrqPairs = Map<string, Array<{ s: string; t: string; line?: number | null; kind?: string }>>;

export declare const NO_DECLARATIONS: Declarations;
export declare function derivePayload(view: FactsView, meta: PayloadMeta): FactsPayload;
export declare function irqPairsOf(view: FactsView): IrqPairs;
export declare function answer(view: FactsView, index: ReturnType<typeof buildIndex>, irqPairs: IrqPairs, message: { type: string; [key: string]: unknown }): Record<string, unknown> | null;
