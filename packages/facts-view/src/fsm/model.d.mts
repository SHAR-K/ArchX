import type { AtomRow, FactsIndex, FactsView, FsmAnalysis, FsmMachine, StatePanel, StateTransitionsTheme } from "../types.d.mts";

export declare function buildStateTransitions(view: FactsView, options?: { index?: FactsIndex }): StateTransitionsTheme;
export declare function analyzeMachine(machine: FsmMachine, index: FactsIndex): FsmAnalysis;
export declare function statePanel(machine: FsmMachine, analysis: FsmAnalysis, stateName: string, index: FactsIndex): StatePanel;
export declare function conditionSteps(transition: Record<string, unknown>): Array<Record<string, unknown>>;
export declare function callSiteSteps(index: FactsIndex, fnId: string, line: number, caseFrom: number, caseTo: number): Array<Record<string, unknown>>;
export declare function atomRows(step: Record<string, unknown>): AtomRow[];
export declare function negateC(text: string): string;
