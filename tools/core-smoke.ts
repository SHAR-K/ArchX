// 分区投影的回归：引擎的全仓事实投影成一个分区的事实，边界怎么划、哪些字段跟着走。
//
// 这是新方向唯一还需要的 core 能力——面板和 MCP 都从这一步的输出往下派生。
// 旧模型（提案、门禁、映射、执行包）的测试随那套代码一起删了。

import assert from "node:assert/strict";
import { createPartition, pathMatchesAny, projectFactsToPartition } from "../packages/core/src/index.ts";

assert.equal(pathMatchesAny("src/sensor/controller.c", ["src/sensor/**"]), true);
const partition = createPartition({ name: "sensor", focusPaths: ["src/sensor/**"] });
const scopedFacts = projectFactsToPartition({
  project: "sample",
  analysis_mode: "compilation-database",
  dependency_edges: [{ source: "src/app.c", target: "src/sensor/controller.c" }],
  dependency_cycles: [],
  global_variables: [],
  functions: [{ symbol_id: "src/sensor/controller.c::update", name: "update", detail: "void update(void)", location: { path: "src/sensor/controller.c", line: 4, column: 1 } }],
  variables: [],
  semantic_edges: [],
  file_metrics: [
    { path: "src/app.c", architecture_node: "app", total_lines: 10, code_lines: 8, fan_in: 0, fan_out: 1, risk_score: 10 },
    { path: "src/sensor/controller.c", architecture_node: "sensor", total_lines: 20, code_lines: 16, fan_in: 1, fan_out: 0, risk_score: 20 },
  ],
  semantic_warnings: [],
  metrics: {},
}, partition);
assert.equal(scopedFacts.files.length, 2, "partition projection must retain direct boundary files");
assert.equal(scopedFacts.engineSchemaVersion, undefined, "schemaVersion 1 reports must not invent runtime facts");
assert.equal("coverage" in scopedFacts || "executionUnits" in scopedFacts || "reachability" in scopedFacts, false, "schemaVersion 1 projections must not carry schemaVersion 2 keys");

// ArchCheck schemaVersion 2: runtime facts ride along as optional fields, trimmed to focus + boundary.
const v2Facts = projectFactsToPartition({
  schemaVersion: 2,
  coverage: { target: "keil:application", sourceFilesOnDisk: 10, translationUnits: 8, filesAnalyzed: 8, excluded: [{ path: "src/orphan.c", reason: "not-in-compile-database" }] },
  project: "sample",
  analysis_mode: "compilation-database",
  dependency_edges: [{ source: "src/app.c", target: "src/sensor/sensor.h" }, { source: "src/sensor/controller.c", target: "src/sensor/sensor.h" }, { source: "src/net/net.c", target: "src/net/net.h" }],
  dependency_cycles: [],
  global_variables: [],
  functions: [
    { symbol_id: "function:src/app.c:app_init", name: "app_init", detail: "void (void)", location: { path: "src/app.c", line: 5, column: 6 }, isDefinition: true, compileBranch: null },
    { symbol_id: "function:src/sensor/controller.c:sensor_task", name: "sensor_task", detail: "char (thread_t *)", location: { path: "src/sensor/controller.c", line: 4, column: 13 }, isDefinition: true, compileBranch: "defined(SENSOR)" },
    { symbol_id: "function:src/sensor/controller.c:ADC_IRQHandler", name: "ADC_IRQHandler", detail: "void (void)", location: { path: "src/sensor/controller.c", line: 20, column: 6 }, isDefinition: true, compileBranch: null },
    { symbol_id: "function:src/sensor/filter.h:filter_id", name: "filter_id", detail: "int (void)", location: { path: "src/sensor/filter.h", line: 3, column: 19 }, isDefinition: true, compileBranch: null, definedInHeader: true },
    { symbol_id: "function:src/net/net.c:net_poll", name: "net_poll", detail: "void (void)", location: { path: "src/net/net.c", line: 1, column: 6 }, isDefinition: true, compileBranch: null },
    { symbol_id: "function:src/net/net.c:net_unused", name: "net_unused", detail: "void (void)", location: { path: "src/net/net.c", line: 9, column: 6 }, isDefinition: true, compileBranch: null },
  ],
  variables: [],
  semantic_edges: [
    { source: "function:src/app.c:app_init", target: "function:src/sensor/controller.c:sensor_task", relation: "address_of", argumentIndex: 0, callee: "thread_create", locations: [{ path: "src/app.c", line: 7, column: 19 }] },
    { source: "function:src/app.c:app_init", target: "function:src/sensor/controller.c:sensor_task", relation: "registers_task", rule: "protothreads.thread_create", locations: [{ path: "src/app.c", line: 7, column: 19 }] },
    { source: "function:src/app.c:app_init", target: "function:src/sensor/controller.c:ADC_IRQHandler", relation: "enables_isr", rule: "gd32.nvic_irq_enable", locations: [{ path: "src/app.c", line: 8, column: 5 }] },
    { source: "function:src/sensor/controller.c:sensor_task", target: "function:src/sensor/filter.h:filter_id", relation: "calls", locations: [{ path: "src/sensor/controller.c", line: 6, column: 9 }] },
    { source: "function:src/net/net.c:net_poll", target: "function:src/net/net.c:net_unused", relation: "calls", locations: [{ path: "src/net/net.c", line: 3, column: 5 }] },
  ],
  file_metrics: [
    { path: "src/app.c", architecture_node: "app", total_lines: 10, code_lines: 8, fan_in: 0, fan_out: 1, risk_score: 10 },
    { path: "src/sensor/controller.c", architecture_node: "sensor", total_lines: 30, code_lines: 26, fan_in: 1, fan_out: 1, risk_score: 20 },
    { path: "src/sensor/sensor.h", architecture_node: "sensor", total_lines: 5, code_lines: 3, fan_in: 2, fan_out: 0, risk_score: 0 },
    { path: "src/sensor/filter.h", architecture_node: "sensor", total_lines: 6, code_lines: 4, fan_in: 1, fan_out: 0, risk_score: 0 },
    { path: "src/net/net.c", architecture_node: "net", total_lines: 12, code_lines: 10, fan_in: 0, fan_out: 1, risk_score: 5 },
    { path: "src/net/net.h", architecture_node: "net", total_lines: 3, code_lines: 2, fan_in: 1, fan_out: 0, risk_score: 0 },
  ],
  semantic_warnings: [],
  metrics: {},
  entries: [{ kind: "main", symbolId: "function:src/app.c:app_init" }, { kind: "main", symbolId: "function:src/net/net.c:net_poll" }],
  executionUnits: [
    { id: "task:sensor_task", kind: "task", entrySymbolId: "function:src/sensor/controller.c:sensor_task", registeredAt: { functionId: "function:src/app.c:app_init", path: "src/app.c", line: 7 }, rule: "protothreads.thread_create", confidence: "high" },
    { id: "isr:ADC_IRQHandler", kind: "isr", entrySymbolId: "function:src/sensor/controller.c:ADC_IRQHandler", vector: 18, vectorTable: { path: "src/startup.s", line: 40, column: 1 }, enabledAt: [{ functionId: "function:src/app.c:app_init", path: "src/app.c", line: 8 }], confidence: "high" },
    { id: "callback:net_poll", kind: "callback", entrySymbolId: "function:src/net/net.c:net_poll", registeredAt: { functionId: "function:src/net/net.c:net_poll", path: "src/net/net.c", line: 2 }, rule: "generic.set_callback", confidence: "medium" },
  ],
  externDeclarations: [
    { name: "sensor_task", declaredIn: { path: "src/app.c", line: 3, column: 1 }, resolvesTo: "function:src/sensor/controller.c:sensor_task", viaHeader: false },
    { name: "net_poll", declaredIn: { path: "src/other.c", line: 3, column: 1 }, resolvesTo: "function:src/net/net.c:net_poll", viaHeader: false },
  ],
  reachability: {
    byUnit: { "main:app_init": ["function:src/app.c:app_init"], "task:sensor_task": ["function:src/sensor/controller.c:sensor_task", "function:src/sensor/filter.h:filter_id"], "callback:net_poll": ["function:src/net/net.c:net_poll", "function:src/net/net.c:net_unused"] },
    domains: { "function:src/sensor/filter.h:filter_id": ["task"], "function:src/net/net.c:net_unused": ["callback"] },
    unreached: ["function:src/sensor/controller.c:ADC_IRQHandler", "function:src/net/net.c:net_unused"],
  },
  contractBypass: [
    { caller: "function:src/app.c:app_init", callee: "function:src/sensor/controller.c:sensor_task", location: { path: "src/app.c", line: 7, column: 19 }, reason: "no-include-path-to-callee-module" },
    { caller: "function:src/net/net.c:net_poll", callee: "function:src/net/net.c:net_unused", location: { path: "src/net/net.c", line: 3, column: 5 }, reason: "callee-directory-has-no-header" },
  ],
  typeOnlyIncludes: [
    { source: "src/app.c", target: "src/sensor/sensor.h", callsBetweenFiles: 0, variableReferences: 0 },
    { source: "src/net/net.c", target: "src/net/net.h", callsBetweenFiles: 0, variableReferences: 0 },
  ],
}, partition);
assert.equal(v2Facts.schemaVersion, 1, "the partition envelope keeps its own schema version");
assert.equal(v2Facts.engineSchemaVersion, 2, "the source report version must be recorded");
assert.deepEqual(v2Facts.coverage?.excluded, [{ path: "src/orphan.c", reason: "not-in-compile-database" }], "coverage passes through untouched");
assert.deepEqual(v2Facts.semanticEdges.map((edge) => edge.relation), ["address_of", "registers_task", "enables_isr", "calls"], "new relations must survive projection and net-only edges must be trimmed");
assert.equal(v2Facts.semanticEdges[0]?.callee, "thread_create", "address_of metadata must be preserved");
assert.equal(v2Facts.functions.find((item) => item.name === "sensor_task")?.compileBranch, "defined(SENSOR)");
assert.equal(v2Facts.functions.find((item) => item.name === "filter_id")?.definedInHeader, true, "header-defined functions must be kept with their marker");
assert.equal(v2Facts.functions.some((item) => item.name === "net_unused"), false);
assert.deepEqual(v2Facts.entries, [{ kind: "main", symbolId: "function:src/app.c:app_init" }], "entries outside the boundary must be dropped, boundary callers kept");
assert.deepEqual(v2Facts.executionUnits?.map((unit) => unit.id), ["task:sensor_task", "isr:ADC_IRQHandler"], "execution units are kept by entry symbol or registration site");
assert.deepEqual(v2Facts.externDeclarations?.map((item) => item.name), ["sensor_task"]);
assert.deepEqual(Object.keys(v2Facts.reachability?.byUnit ?? {}), ["main:app_init", "task:sensor_task"], "reachability keeps units that survive projection");
assert.deepEqual(v2Facts.reachability?.domains, { "function:src/sensor/filter.h:filter_id": ["task"] });
assert.deepEqual(v2Facts.reachability?.unreached, ["function:src/sensor/controller.c:ADC_IRQHandler"]);
assert.deepEqual(v2Facts.contractBypass?.map((item) => item.callee), ["function:src/sensor/controller.c:sensor_task"]);
assert.deepEqual(v2Facts.typeOnlyIncludes?.map((item) => item.target), ["src/sensor/sensor.h"]);

console.log(`ArchX core smoke test passed（分区投影：${scopedFacts.files.length} + ${v2Facts.files.length} 文件）`);
