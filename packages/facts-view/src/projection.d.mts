import type { FactsView } from "./types.d.mts";

export declare function buildFactsView(
  facts: unknown,
  region: string,
  options?: { source?: string; generatedAt?: string },
): FactsView;
