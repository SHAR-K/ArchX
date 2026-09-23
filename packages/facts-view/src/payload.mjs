// 一份投影 → 面板 payload，以及面板按需要的那些明细。宿主（VS Code 扩展）和静态演示页
// 共用这一份：两边算出来的必须一模一样，否则演示页和插件会各说各话。
// 这里不碰 fs / crypto / vscode：快照 ID、落盘、跳转都是调用方的事。

import { buildIndex } from "./graph.mjs";
import { buildStateTransitions, statePanel } from "./fsm/model.mjs";
import { buildDependencies, edgeDetail } from "./deps/model.mjs";
import { buildExecution, callEdgeEvidence, compareRoots, functionEntry, rootProfile, treeChildren } from "./execution/model.mjs";
import { buildConcurrency, resourceSides } from "./concurrency/model.mjs";
import { buildMemory } from "./memory/model.mjs";
import { buildTiming } from "./timing/model.mjs";
import { buildRound } from "./timing/sequence.mjs";

export const NO_DECLARATIONS = { top: [], bottom: [], regroup: {}, invert: [], names: {} };

/** 六个主题一次算好。每个状态的明细也在这里算：视图只画，不重算结论 */
export function derivePayload(view, meta) {
  const index = buildIndex(view);
  const stateTransitions = buildStateTransitions(view, { index });
  for (const machine of stateTransitions.machines) {
    machine.panels = Object.fromEntries(machine.states.map((st) => [st.name, statePanel(machine, machine.analysis, st.name, index)]));
  }
  // 视图要把函数 id 变成「文件:行」才能跳转，带一份精简映射，不传整个函数表
  const functions = {};
  for (const fn of view.functions) functions[fn.id] = { name: fn.name, file: fn.file, line: fn.line };
  return {
    snapshot: meta.snapshot,
    project: meta.project,
    projectRoot: meta.projectRoot ?? "",
    partition: meta.partition ?? "",
    region: meta.region ?? "",
    generatedAt: meta.generatedAt,
    counts: { files: view.files.length, functions: view.functions.length },
    themes: { stateTransitions, memory: buildMemory(view, { index }), dependencies: buildDependencies(view, { index }), execution: buildExecution(view, { index }), concurrency: buildConcurrency(view, { index }), timing: buildTiming(view, { index }) },
    declarations: meta.declarations ?? NO_DECLARATIONS,
    functions,
    ...(meta.scope ? { scope: meta.scope } : {}),
  };
}

/** 使能边指向中断本身，不在调用图里，树要用就得单独建一份索引 */
export function irqPairsOf(view) {
  const irqPairs = new Map();
  for (const pair of view.irqPairs ?? []) irqPairs.set(pair.s, [...(irqPairs.get(pair.s) ?? []), { ...pair, kind: "irq" }]);
  return irqPairs;
}

/**
 * 按需算的明细：几百上千条边、几千个树节点、每个执行单元的一轮，全预先算会把 payload 撑到不能用，
 * 而且人一次只看一个。返回要回给面板的消息；不认识的类型返回 null。
 */
export function answer(view, index, irqPairs, message) {
  switch (message.type) {
    case "edgeDetail":
      return { type: "edgeDetail", edgeId: message.edgeId, data: edgeDetail(view, message.sourceFiles, message.targetFiles) };
    case "treeChildren":
      return { type: "treeChildren", symbol: message.symbol, children: treeChildren(index, message.symbol, { irqPairs }) };
    case "rootProfile":
      // 执行树画布：从一个函数出发，模块首次触及顺序和按模块统计的可达函数
      return { type: "rootProfile", id: message.id, profile: rootProfile(index, message.id) };
    case "callEvidence":
      return { type: "callEvidence", evidence: callEdgeEvidence(view, message.from, message.to, { index }) };
    case "functionEntry":
      // 倒推到入口：链要走可达性索引，webview 里没有
      return { type: "functionEntry", id: message.id, entry: functionEntry(view, message.id, { index }) };
    case "compareRoots":
      // 矩阵里只有数，点了格子才要函数与变量的明细
      return { type: "compareRoots", a: message.a, b: message.b, comparison: compareRoots(view, message.a, message.b, { index }) };
    case "resourceSides":
      return { type: "resourceSides", sides: resourceSides(view, message.name, { index }) };
    case "round":
      // 把调用链一直追到有循环的那个函数，深的工程一次全算会很慢
      return { type: "round", root: message.root, round: buildRound(view, message.root, { index, showIterations: Boolean(message.showIterations) }) };
    default:
      return null;
  }
}
