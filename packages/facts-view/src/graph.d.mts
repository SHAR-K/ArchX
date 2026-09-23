import type { FactsIndex, FactsView } from "./types.d.mts";

export declare function buildIndex(view: FactsView): FactsIndex;
export declare function confidenceRank(confidence: string | null | undefined): number;
export declare const idOf: {
  machine(dispatchVariable: string | null | undefined, fallbackFile: string | null | undefined, dispatch: string): string;
  state(machineId: string, stateName: string): string;
  memoryModule(moduleId: string): string;
  memorySymbol(file: string, name: string): string;
};
