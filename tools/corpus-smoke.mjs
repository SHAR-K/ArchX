// 语料冒烟：拿 corpus 里的样例真跑一遍引擎，断言它读出了东西。
//
// 守的是这一类失败：引擎不报错，只是什么都没读到。曾经有一次 clang 的 target 被写死成
// riscv32，于是每个 CMake/GCC 工程都报「函数 0」，而退出码是 0。断言覆盖率和函数数，
// 就能让这种沉默的失效变成红色。

import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const python = process.env.PYTHON ?? "python";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "archcheck-corpus-"));

execFileSync(process.execPath, ["tools/corpus-prepare.mjs"], { stdio: "inherit" });
execFileSync(python, ["-m", "archcheck", "corpus/blinky", "--json", "--out", out], {
  env: { ...process.env, PYTHONPATH: path.resolve("engine/src") },
  stdio: ["ignore", "pipe", "inherit"],
  maxBuffer: 64 * 1024 * 1024,
});

const facts = JSON.parse(fs.readFileSync(path.join(out, "architecture.json"), "utf8"));
const { coverage } = facts;

assert.equal(coverage.filesAnalyzed, coverage.translationUnits, "每个编译单元都要进分析，少一个就是解析退化");
assert.ok(facts.functions.length >= 11, `函数应至少 11 个，实得 ${facts.functions.length}`);
assert.ok(facts.dependency_edges.length >= 7, `include 依赖应至少 7 条，实得 ${facts.dependency_edges.length}`);

const kinds = new Set(facts.executionUnits.map((unit) => unit.kind));
assert.ok(kinds.has("isr") && kinds.has("task"), `运行单元要同时认出 isr 和 task，实得 ${[...kinds].join("/")}`);

// 第二个样例：抢占式。守的是任务优先级两条路径（属性结构体初始化器 / 宏 + 字面量）和
// RTOS 延时的周期推导——这两样只在真跑 clangd 时才会静默失效，单测替不了。
const out2 = fs.mkdtempSync(path.join(os.tmpdir(), "archcheck-corpus-"));
execFileSync(python, ["-m", "archcheck", "corpus/rtos-mini", "--json", "--out", out2, "--no-image"], {
  env: { ...process.env, PYTHONPATH: path.resolve("engine/src") },
  stdio: ["ignore", "pipe", "inherit"],
  maxBuffer: 64 * 1024 * 1024,
});
const rtos = JSON.parse(fs.readFileSync(path.join(out2, "architecture.json"), "utf8"));
assert.equal(rtos.scheduling, "preemptive", "rtos-mini 命中 FreeRTOS / CMSIS 规则，调度模型应为 preemptive");
const task = (name) => rtos.executionUnits.find((unit) => unit.id === `task:${name}`) ?? assert.fail(`没认出任务 ${name}`);
assert.deepEqual([task("control_task").priority.value, task("control_task").priority.basis], [40, "attr-initializer"], "osThreadNew 的优先级要从 .priority 初始化器解出");
assert.deepEqual([task("logger_task").priority.value, task("logger_task").priority.basis], [1, "expression"], "xTaskCreate 的 tskIDLE_PRIORITY + 1 要折成 1");
assert.equal(task("worker_task").priority.value, 2);
assert.equal(task("control_task").runMode.periodMs, 10, "osDelay(10) 是 10 个 tick，tick 1 ms");
assert.equal(task("logger_task").runMode.periodMs, 50, "vTaskDelay(50) 同理");
assert.equal(task("worker_task").runMode.mode, "event-driven", "阻塞在 xQueueReceive 上的是事件驱动");
assert.ok(rtos.executionUnits.some((unit) => unit.id === "isr:TIM_IRQHandler"), "向量表里的 TIM_IRQHandler 要认成中断");
const registered = rtos.executionUnits.find((unit) => unit.id === "isr:button_isr");
assert.ok(registered, "gpio_isr_handler_add 装进去的处理函数要认成中断（context: isr），不是回调");
assert.equal(registered.rule, "esp_idf.gpio_isr_handler_add");
assert.ok(registered.registeredAt && registered.vector == null, "注册型中断带注册点、没有向量号");
assert.ok(rtos.conflictCandidates.some((c) => c.name === "g_setpoint"), "button_isr 与 control_task 都写 g_setpoint，要出冲突候选——ESP-IDF 工程恒零冲突就是这条缺的");
fs.rmSync(out2, { recursive: true, force: true });

fs.rmSync(out, { recursive: true, force: true });
console.log(`语料冒烟通过：${coverage.filesAnalyzed}/${coverage.translationUnits} 编译单元，函数 ${facts.functions.length}，运行单元 ${facts.executionUnits.length}；rtos-mini 任务 ${rtos.executionUnits.filter((unit) => unit.kind === "task").length}，优先级与周期解出`);
