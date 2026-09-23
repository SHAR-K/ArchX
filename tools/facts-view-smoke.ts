// 投影层回归：拿自建样例 corpus/blinky 的事实跑 buildFactsView，和记录下来的视图逐字节比。
//
// 样例是自己写的 C 工程（main + led 状态机 + gpio + 两个中断），事实由引擎扫出来后存成静态夹具，
// 所以这条测试不需要 clangd，也不依赖任何真实工程。样例源码或引擎改了就重记：
//   node --experimental-strip-types tools/corpus-record.mjs
// 那个脚本会重扫、把 project 归一成相对路径、写成明文缩进的夹具，再刷新金样。
// 只想刷金样时用 UPDATE_GOLDEN=1 跑本文件。两种情况都要在 git diff 里逐条看清改了什么。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildFactsView } from "../packages/facts-view/src/projection.mjs";
import { buildIndex } from "../packages/facts-view/src/graph.mjs";
import { buildStateTransitions, negateC, statePanel } from "../packages/facts-view/src/fsm/model.mjs";
import { layoutMachine } from "../packages/facts-view/src/fsm/layout.mjs";
import { buildMemory } from "../packages/facts-view/src/memory/model.mjs";
import * as Deps from "../packages/facts-view/src/deps/model.mjs";
import * as Exec from "../packages/facts-view/src/execution/model.mjs";
import * as Conc from "../packages/facts-view/src/concurrency/model.mjs";
import * as RunMap from "../packages/facts-view/src/concurrency/runmap.mjs";
import { layoutPreemptive } from "../packages/facts-view/src/timing/preemptive.mjs";
import { buildTiming } from "../packages/facts-view/src/timing/model.mjs";
import * as Timing from "../packages/facts-view/src/timing/model.mjs";
import * as Beat from "../packages/facts-view/src/timing/beat.mjs";
import * as Round from "../packages/facts-view/src/timing/sequence.mjs";

const root = path.resolve("corpus/blinky/facts");
const facts = JSON.parse(fs.readFileSync(path.join(root, "partition.json"), "utf8"));
const view = buildFactsView(facts, "src/", { source: "corpus/blinky", generatedAt: "1970-01-01T00:00:00.000Z" });
const index = buildIndex(view);

// 结构不变量：金样之外再钉几条，免得金样被整体刷新时悄悄丢东西
assert.equal(view.region, "src/");
assert.equal(view.generatedAt, "1970-01-01T00:00:00.000Z", "生成时间必须可注入，否则回归比对无从做起");
assert.deepEqual(view.modules.filter((m: { external: boolean }) => !m.external).map((m: { id: string }) => m.id).sort(), ["(root)", "app", "hal", "startup"]);
// scheduler_add / scheduler_run 只有声明，样例里没有实现也没有链接产物：投影把它们挂在
// lib: 伪文件下，库名 unknown.lib。这条边界符号路径也要钉住。
assert.deepEqual(view.files.map((f: { path: string }) => f.path).sort(), ["lib:unknown.lib", "src/app/events.c", "src/app/events.h", "src/app/heartbeat.c", "src/app/heartbeat.h", "src/app/led.c", "src/app/led.h", "src/hal/gpio.c", "src/hal/gpio.h", "src/main.c", "src/startup/startup.s"]);
assert.equal(view.functions.length, 16, "13 个定义 + 3 个只有声明的边界符号（scheduler_add / run / sleep）");
assert.deepEqual(view.functions.filter((f: { external: boolean }) => f.external).map((f: { name: string }) => f.name).sort(), ["scheduler_add", "scheduler_run", "scheduler_sleep"]);
assert.ok(view.entries.main, "样例有 main，投影必须认出来");
assert.equal(view.ast.present, true);
assert.equal(view.ast.stateMachines.length, 1, "led_task 的 switch 是唯一的状态机候选");
assert.deepEqual(view.ast.stateMachines[0].states.map((s: { name: string }) => s.name), ["LED_OFF", "LED_ON", "LED_FAULT"]);
assert.ok(view.callPairs.some((p: { s: string; t: string }) => p.s.endsWith(":main") && p.t.endsWith(":led_init")), "main -> led_init 是调用边");
assert.ok(view.includeEdges.some((e: { s: string; t: string }) => e.s === "src/app/led.c" && e.t === "src/hal/gpio.h"), "led.c include gpio.h");

// 状态转换主题的派生：机器合并、状态顺序、边的种类、终态、稳定 ID
const theme = buildStateTransitions(view);
assert.equal(theme.available, true);
assert.equal(theme.machines.length, 1, "样例只有 led_task 一台机");
assert.equal(theme.dispatchTables.length, 0);
const machine = theme.machines[0];
// 枚举一览：状态名对到引擎给的枚举定义上；LED_UNKNOWN 没有任何引用，值靠 hover 兜底取到，角色是「未在 switch 出现」
assert.equal(machine.enumTable.enum?.name, "led_state_t", "状态机要对到它的枚举类型");
assert.equal(machine.enumTable.rows.length, 4, "led_state_t 有四个成员");
const unknown = machine.enumTable.rows.find((r: { name: string }) => r.name === "LED_UNKNOWN");
assert.ok(unknown && unknown.value === "3" && !unknown.inMachine && unknown.role === "not in the switch", "未被引用的成员要有值、要标成未在 switch 出现");
assert.ok(machine.enumTable.rows.filter((r: { isCase: boolean }) => r.isCase).length >= 3, "OFF / ON / FAULT 都有 case");
assert.equal(machine.enumTable.unused, 1);
assert.ok(typeof machine.analysis.verdict === "string" && machine.analysis.verdict.length > 0, "线性度要有判词");
assert.equal(machine.dispatch, "s_ctx.state");
assert.equal(machine.file, "src/app/led.c");
// ID 不含行号：case 上面插一行注释，ID 不该变
assert.equal(machine.id, "fsm:src/app/led.c:s_ctx");
assert.deepEqual(machine.states.map((s: { id: string }) => s.id), ["state:src/app/led.c:s_ctx/LED_OFF", "state:src/app/led.c:s_ctx/LED_ON", "state:src/app/led.c:s_ctx/LED_FAULT"]);
// 状态顺序是代码入口顺序，不是字母序
assert.deepEqual(machine.analysis.names, ["LED_OFF", "LED_ON", "LED_FAULT"]);
assert.deepEqual(machine.analysis.edges.map((e: { from: string; to: string; kind: string }) => `${e.from}->${e.to}:${e.kind}`),
  ["LED_OFF->LED_ON:next", "LED_ON->LED_OFF:back", "LED_ON->LED_FAULT:exit"]);
assert.deepEqual(machine.analysis.terminal, ["LED_FAULT"], "LED_FAULT 没有出边，是终态");
assert.equal(machine.analysis.stats.total, 3);
// 状态图布局：层由我们的 depth 钉死，dagre 只管同层顺序和走线；坐标不能有 NaN，回退边的点序要从 from 到 to
const fsmLayout = layoutMachine(machine, machine.analysis, { children: [] });
assert.equal(fsmLayout.nodes.length, 3);
assert.equal(fsmLayout.edges.length, 3, "三条转换都不是自环，都进 dagre");
assert.ok(!JSON.stringify(fsmLayout).includes("NaN"), "布局坐标里不能有 NaN");
assert.ok(fsmLayout.edges.every((e: { points: unknown[] }) => e.points.length >= 2), "每条边至少两个点");
assert.equal(fsmLayout.init?.to, "LED_OFF", "初态指向起点");
const yOf = Object.fromEntries(fsmLayout.nodes.map((n: { name: string; y: number }) => [n.name, n.y]));
assert.ok(yOf.LED_OFF < yOf.LED_ON, "起点在上，顺序前进往下");
const backEdge = fsmLayout.edges.find((e: { kind: string }) => e.kind === "back");
assert.ok(backEdge && backEdge.points[0].y > backEdge.points[backEdge.points.length - 1].y, "回退边的点序是从下面的 from 走到上面的 to");
assert.ok(fsmLayout.nodes.find((n: { name: string }) => n.name === "LED_FAULT")?.terminal, "LED_FAULT 没有出弧，是终态");

// 一个状态的明细：LED_ON 有两条出边，条件从 if / else 拆成原子行
const panel = statePanel(machine, machine.analysis, "LED_ON", index);
assert.equal(panel.items.length, 2);
assert.deepEqual(panel.items.map((i: { to: string }) => i.to), ["LED_OFF", "LED_FAULT"]);
assert.ok(panel.items[0].directRows.length, "第一条转换有条件");
assert.ok(panel.items[1].directRows.some((r: { tone: string }) => r.tone === "neg"), "else 分支的条件取反后是 neg");

// 编译库可以引用扫描根之外的文件：投影不许因此崩，那些文件保留绝对路径，明显落在区域外。
// 扫描根是某个子目录时这是常态，之前会让整次扫描中止。
const outsider = JSON.parse(JSON.stringify(facts));
outsider.files = [...outsider.files, { path: "D:/elsewhere/vendor/lib.c", code_lines: 10, total_lines: 12, fan_in: 0, fan_out: 0, risk_score: 0 }];
const widened = buildFactsView(outsider, "src/", { source: "outsider", generatedAt: "0" });
assert.equal(widened.files.length, view.files.length + 1);
assert.ok(widened.files.some((f: { path: string }) => f.path === "D:/elsewhere/vendor/lib.c"), "根外文件要留在事实里，不能吞掉");
assert.ok(widened.modules.some((m: { external: boolean }) => m.external), "根外文件归到边界模块");

// 取反是纯文本变换，单独钉住
assert.equal(negateC("ready"), "!ready");
assert.equal(negateC("!ready"), "ready");
assert.equal(negateC("a && b"), "!(a && b)");

// 执行关系：入口、根、树上的边。样例自带一个最小调度器（corpus/blinky/framework_rules.yaml），
// 所以注册边和任务这条路也测得到。
const execution = Exec.buildExecution(view, { index });
// 函数搜索与倒推到入口：gpio_write 现在被 main、led_task、BUTTON_IRQHandler 三个入口都能到达，链上每一跳有种类
const found = Exec.findFunctions(view, "gpio_wr", { index });
assert.deepEqual(found.map((f: { name: string }) => f.name), ["gpio_write"], "子串匹配，区域内");
const entryInfo = Exec.functionEntry(view, found[0].id, { index });
assert.ok(entryInfo, "函数页要算得出");
assert.deepEqual(entryInfo.chains.map((c: { root: { name: string } }) => c.root.name).sort(), ["BUTTON_IRQHandler", "led_task", "main"], "三个入口都能到 gpio_write");
const viaIsr = entryInfo.chains.find((c: { root: { kind: string } }) => c.root.kind === "isr");
assert.equal(viaIsr.path[viaIsr.path.length - 1].hop, "interrupt fires", "中断直接调它，这一跳标成中断触发");
const viaMain = entryInfo.chains.find((c: { root: { name: string } }) => c.root.name === "main");
assert.equal(viaMain.path[0].name, "main");
assert.equal(viaMain.path[viaMain.path.length - 1].name, "gpio_write");
assert.equal(Exec.functionEntry(view, "function:src/hal/gpio.c:gpio_ticks", { index })?.unreached, true, "gpio_ticks 没有任何入口能到");
// 双根对比：矩阵里的数必须和按需算的明细一致，否则人看到的数和 Agent 拿到的清单对不上
const cmp = execution.compare;
assert.ok(cmp.allIsrs.length === 2 && cmp.allOthers.length >= 2, "blinky 有两个中断、main 加一个任务");
for (const row of cmp.rows) for (const col of cmp.cols) {
  const pair = Exec.compareRoots(view, row.id, col.id, { index });
  assert.equal(cmp.cells[row.id][col.id], pair.sharedFunctions.length, `${row.name} x ${col.name} 的格子要等于明细里的共用函数数`);
}
assert.ok(cmp.rows.every((r: { id: string }) => cmp.cols.some((c: { id: string }) => cmp.cells[r.id][c.id] > 0)), "全空的行不画");
assert.ok(cmp.cols.every((c: { id: string }) => cmp.rows.some((r: { id: string }) => cmp.cells[r.id][c.id] > 0)), "全空的列不画");
assert.equal(execution.available, true);
assert.deepEqual(execution.roots.map((r: { kind: string; name: string }) => `${r.kind}:${r.name}`).sort(), ["isr:BUTTON_IRQHandler", "isr:SysTick_Handler", "main:main", "task:heartbeat_task", "task:led_task"], "中断由向量表认出，任务由样例自己的调度器规则认出");
const mainRoot = execution.roots.find((r: { kind: string }) => r.kind === "main")!;
const kids = Exec.treeChildren(index, mainRoot.symbol);
assert.deepEqual(kids.map((k: { kind: string }) => k.kind), ["call", "call", "register", "register", "call"], "注册边和调用边都在树上，按行号排");
const registerKid = kids.find((k: { kind: string }) => k.kind === "register");
assert.equal(index.nameOf(registerKid.target), "led_task", "scheduler_add(led_task) 是注册，不是普通调用");
const evidence = Exec.callEdgeEvidence(view, mainRoot.symbol, kids[0].target, { index });
assert.deepEqual(evidence.sites, [9], "调用点要有行号，否则跳不过去");
assert.equal(evidence.cross, true, "main 在根目录，led 在 app，是跨模块");
assert.equal(evidence.bypassesHeader, false, "main.c include 了 led.h，没有绕过");

// 顺序与时间：循环分类只用事实——宏展开、无限、有没有阻塞点、条件里读的是什么
const timing = Timing.buildTiming(view, { index });
assert.equal(timing.available, true);
assert.equal(timing.scheduling, "cooperative", "调度模型来自样例自己的框架规则");
assert.equal(timing.counts!.byClass["busy-var"], 1, "条件读的是中断会写的标志：忙等变量，卡住整个调度");
assert.equal(timing.counts!.byClass.iter, 1, "普通计数循环只表示重复若干次");
// 带 u 后缀的循环边界也要认出来：`i < 4u` 是字面量上界，不是「表达式，上界未知」。
// int(s, 0) 认不了后缀，也认不了 C 的八进制前导零——那正是外部样例上崩溃的那个 bug
const iterLoop = timing.loops.find((l: { class: string }) => l.class === "iter");
assert.equal(iterLoop.iterations.basis, "literal", "4u 是字面量");
assert.equal(iterLoop.iterations.max, 4, "上界能算出来，循环最多转 4 次");
const busyLoop = timing.loops.find((l: { class: string }) => l.class === "busy-var");
assert.equal(busyLoop.blocking.length, 0, "忙等的定义就是不让出");
assert.ok(busyLoop.condition?.includes("g_button_pressed"), "分类依据是条件里那个变量，要能看到");
assert.equal(timing.units.length, 5, "两个中断、两个任务，外加 main——启动路径也有节奏");
// 节拍：led_task 没有定时器，每圈都跑，排第 1；heartbeat 的 for(;;) 里 scheduler_sleep(50)，周期 50 ms，排第 2
const beat = timing.beat;
assert.equal(beat.available, true, "协作式调度，节拍画得出");
assert.deepEqual(beat.rows.map((r: { name: string; order: number | null; period: number | null; always: boolean }) => [r.name, r.order, r.period, r.always]), [["led_task", 1, null, true], ["heartbeat_task", 2, 50, false]]);
assert.equal(beat.lcm, 50, "只有一个周期，超周期就是它");
assert.equal(beat.rows[1].seq.length, 1, "一轮被一个让出点切成一段");
assert.equal(beat.rows[1].seq[0].wait, 50, "段末的让出带标称时长，来自 delay 规则解析的实参");
assert.equal(beat.rows[1].delays[0].callee, "scheduler_sleep", "延时实参标签链回那一行");
assert.equal(beat.dataDeps.rows.length, 7, "节拍是 dataDependencies 的消费方");
const beatLayout = Beat.layoutBeat(beat, { width: 900 });
assert.ok(!JSON.stringify(beatLayout).includes("NaN"), "节拍坐标里不能有 NaN");
assert.ok(beatLayout.rows[0].band && beatLayout.rows[0].cells.length === 1, "每圈都跑的任务是一条带加一轮的格");
assert.ok(beatLayout.rows[1].cells.length >= 1 && beatLayout.rows[1].leads.length >= 1, "周期任务在超周期里至少到期一次，且有回连到期时刻的细线");
assert.ok(beatLayout.rows[1].yields[0]?.sleep, "格后那道竖线是 sleep，画实线");
assert.equal(timing.units[timing.units.length - 1].kind, "main", "main 排在最后");

// 一轮：一个执行单元跑一圈的列式展开。样例里 main 会经过 led_init，led_init 里那个
// events_wait_button 是忙等，所以它必须裂出第二列，而不是被压成一行
const round = Round.buildRound(view, view.entries.main, { index });
assert.equal(round.available, true);
assert.equal(round.range.kind, "body", "main 没有无限循环，一轮就是整个函数体");
assert.equal(round.levels.length, 2, "忙等在被调函数里，要往右裂出第二列");
// main 注册了 heartbeat_task（它体内有 for(;;)），但注册是取函数地址装进系统，不是在这儿调它——
// 那个循环在调度器手里转，不在 main 的一轮里，所以第二列只有 events_wait_button 那一个忙等框
assert.equal(round.levels.flat().length, 2, "main 的一轮只有根框和忙等框，注册的任务不开框");

const rootBox = round.levels[0][0];
assert.equal(rootBox.badge, null, "根框不带角标");
assert.deepEqual(rootBox.exits.map((e: { type: string }) => e.type), ["return"], "没有循环的一轮，出口是返回不是转下一轮");
const names = rootBox.rows.filter((r: { type: string }) => r.type === "step").map((r: { name: string }) => r.name);
assert.deepEqual(names, ["led_init","scheduler_add","led_task","heartbeat_task","scheduler_run"], "按源码行序，库函数是边界也要留着");
const reg = rootBox.rows.find((r: { name?: string }) => r.name === "led_task");
assert.equal(reg.kind, "register", "scheduler_add(led_task) 是注册，不是在这里调它");
// 调用链只沿通向循环的分支展开：led_init 下面挂着 events_wait_button，别的不挂
const chain = rootBox.rows.filter((r: { type: string }) => r.type === "chain");
assert.deepEqual(chain.map((r: { name: string }) => r.name), ["events_wait_button"], "只有通向循环的那一支才展开");
assert.equal(chain[0].badges.length, 1, "长出循环的那一行要挂角标");

const busyBox = round.levels[1][0];
assert.equal(busyBox.badge, chain[0].badges[0].badge, "角标把行和右边那个框对起来");
assert.equal(busyBox.loop.class, "busy-var", "条件读的是中断会写的标志");
assert.equal(busyBox.spawnKey, chain[0].key, "框要知道自己是从哪一行长出来的，渲染方靠它对齐");
assert.ok(busyBox.loop.condition.includes("g_button_pressed"), "分类依据要能看到");
assert.deepEqual(busyBox.exits.map((e: { type: string }) => e.type), ["cond"], "这个 while 有条件，出口就是条件不成立");

// 一步碰了哪些共享变量，以及有没有保护。判定按「已识别的」说
const taskRound = Round.buildRound(view, "function:src/app/led.c:led_task", { index });
const taskSelf = taskRound.levels[0][0].rows.find((r: { self?: boolean }) => r.self);
assert.ok(taskSelf, "根函数自己直接读写的变量要自成一行，不能丢");
const stepFlag = taskSelf.variables.find((v: { name: string }) => v.name === "g_button_pressed");
assert.equal(stepFlag.write, true, "led_task 会清这个标志");
assert.deepEqual(stepFlag.isrWriters, ["BUTTON_IRQHandler"], "要说得出中断侧是谁在写");
assert.equal(stepFlag.inCritical, false, "样例没有临界区，不能假装有");
assert.ok(taskRound.counts.unguarded > 0, "和中断撞上又没保护的访问要计数");

// 遍历循环默认不展开：它对时序只表示重复若干次，摊开只会挤掉真正要看的
const plain = Round.buildRound(view, view.entries.main, { index });
const withIter = Round.buildRound(view, view.entries.main, { index, showIterations: true });
assert.ok(withIter.counts.boxes > plain.counts.boxes, "打开开关之后遍历循环也要成框");

// 共享与并发：样例有一个 SysTick 和一个按键中断，各写一个 volatile 标志，任务读它们
const conc = Conc.buildConcurrency(view, { index });
// 运行图：同一份 sharedResources 换成流向问法。BUTTON 写 g_button_pressed / s_level / s_ticks 而 led_task 也写 → 三个 mixed；
// SysTick 只写 g_tick_ms 给 led_task 读 → 一个 isr→thread。布局不能有 NaN，单元页要按「它写的 / 都写 / 它只读」分层
const rm = conc.runMap;
assert.equal(rm.vars.length, 4, "四个被多个单元碰到的变量");
assert.deepEqual({ ...rm.flows }, { "isr→thread": 1, "thread→isr": 0, mixed: 3, "isr↔isr": 0, "thread↔thread": 0 });
assert.equal(rm.problems.pollution, 3);
assert.equal(rm.problems.wake, 1, "g_button_pressed 是通知标志");
assert.equal(rm.vars.find((v: { name: string }) => v.name === "g_tick_ms")?.owner, "isr:SysTick_Handler", "唯一写方是 owner");
assert.deepEqual(rm.mainInit.slice().sort(), ["s_ctx", "s_level", "s_ticks"], "main 初始化时写的不算运行期数据流，单独列");
const rmLayout = RunMap.layoutRunMap(rm);
assert.ok(!JSON.stringify(rmLayout).includes("NaN"), "布局坐标里不能有 NaN");
assert.equal(rmLayout.isrs.length + rmLayout.threads.length, 3, "三个单元都碰了共享变量，全景里都在");
// 写方 → 变量 7 条箭头（BUTTON 3 + led_task 3 + SysTick 1）；既读又写的单元另有一条虚线读边：led_task 的 g_button_pressed、SysTick 的 g_tick_ms（++ 是读写）、两边的 s_ticks
assert.equal(rmLayout.edges.filter((e: { kind: string }) => e.kind === "write").length, 7, "写边的数量");
assert.equal(rmLayout.edges.filter((e: { kind: string }) => e.kind === "both").length, 4, "读写单元的读边数量");
const rmPage = RunMap.layoutRunMap(rm, { page: "task:led_task" });
assert.deepEqual(rmPage.layers.map((l: { count: number }) => l.count), [0, 3, 1], "led_task 的一页：它没有独占写出去的，三个和别人都写，一个只读");
assert.equal(conc.available, true);
assert.ok(conc.resources.length >= 2, "两个标志都被中断和任务同时触到");
// 裸机 main 也是线程侧。少了它，「中断置标志 + 主循环轮询」这个嵌入式最常见的竞态
// 一条都报不出来——样例里 main 经 led_init 走到 events_wait_button 读这个标志
const mainSide = conc.units.find((u: { kind: string }) => u.kind === "main");
assert.ok(mainSide, "节奏之外，并发矩阵也要把 main 当成一个执行单元");
const flag = conc.resources.find((r: { name: string }) => r.name === "g_button_pressed");
assert.ok(flag, "按键标志要进矩阵");
assert.equal(flag.volatile, true);
const isrCell = flag.units.find((u: { kind: string }) => u.kind === "isr");
const taskCell = flag.units.find((u: { kind: string }) => u.kind === "task");
assert.equal(isrCell.glyph, "w", "中断里只写");
assert.equal(taskCell.glyph, "rw", "任务里读了又清零");
assert.ok(flag.conflict, "中断写、任务读写且都没有保护：是冲突候选");
// 通知标志是设计意图，不是竞争，但两者长得一样，所以要分别标出来
assert.ok(conc.resources.some((r: { wake: unknown }) => r.wake), "中断置位、任务在条件里轮询，是通知关系");

// 一个变量的两侧明细：每处访问都能落到文件和行
const detailSides = Conc.resourceSides(view, "g_button_pressed", { index });
assert.ok(detailSides);
assert.ok(detailSides.sides.every((s2: { accesses: Array<{ line: number | null }> }) => s2.accesses.every((a) => a.line != null)), "每处访问都要有行号");

// 依赖主题：叶子是单元，.c 和同名 .h 合成一个，边上八个量都在
const deps = Deps.buildDependencies(view, { index });
assert.equal(deps.available, true);
assert.equal(deps.pairedUnits, 4, "led、gpio、events、heartbeat 各自 .c/.h 合成一个单元");
assert.deepEqual(deps.leaves.map((l: { label: string }) => l.label).sort(), ["events.c/h", "gpio.c/h", "heartbeat.c/h", "led.c/h", "main.c", "startup.s"]);
assert.ok(deps.leaves.every((l: { id: string }) => l.id.startsWith("unit:")), "叶子的 ID 前缀决定它属于依赖主题");
const ledToGpio = deps.edges.find((e: { s: string; t: string }) => e.s === "src/app/led" && e.t === "src/hal/gpio");
assert.ok(ledToGpio, "led 依赖 gpio");
assert.equal(ledToGpio.includes, 1, "include 与调用落在同一个格子里，这是合成单元的意义");
assert.equal(ledToGpio.calls, 3, "gpio_init、gpio_write、gpio_reset_all");

// 分组树 + 嵌套排序：依赖别人的在上，被依赖的在下
const tree = Deps.dirTree(deps);
const collapsed = Deps.layoutRows(deps, tree, tree.defaultOpen());
assert.deepEqual(collapsed.order.filter((r: string) => r.startsWith("src/app") || r.startsWith("src/hal")), ["src/app", "src/hal"], "折叠时目录成行，app 依赖 hal 所以排在上面");
const expanded = Deps.layoutRows(deps, tree, tree.allOpen());
assert.ok(expanded.order.indexOf("src/app/led") < expanded.order.indexOf("src/hal/gpio"), "led 依赖 gpio，所以排在它上面");
// 样例里 hal/gpio.c 故意 include 了 app/led.h：跨目录的一个环，红格、切割集、撕开都靠它
assert.equal(expanded.feedback.size, 1, "样例有且只有一条反向边");
const back = [...expanded.feedback][0];
assert.equal(back, "src/hal/gpio→src/app/led", "反向的是 HAL 反过来依赖 APP 那条");
assert.equal(collapsed.feedback.size, 1, "折到目录一层，环还在");

// 回放：排序算法的每一步都要能取到，而且要说得出为什么。撕开是剥不动之后才做的动作
const rootBlock = collapsed.blocks.find((b: { group: string }) => b.group === Deps.ROOT)!;
assert.ok(rootBlock.seq.steps.length > 0, "顶层排序要有可回放的步骤");
const tears = rootBlock.seq.steps.filter((x: { kind: string }) => x.kind === "tear");
assert.equal(tears.length, 1, "环只有一个，撕开一次就够");
assert.ok(tears[0].block >= 2, "撕开时块里至少还剩两个互相依赖的元素");
assert.ok(tears[0].out >= 1 && tears[0].in >= 1, "被撕开的那个必须既依赖别人又被别人依赖");
// 停在第 k 步：已排定的在两头，没排的还在中间且标成待定
const half = Deps.depOrderAtStep(rootBlock.kids, rootBlock.seq.steps, 1);
assert.equal(half.order.length, rootBlock.kids.length, "回放中途行数不变，只是顺序不同");
assert.equal(half.pending.size, rootBlock.kids.length - 1, "第 1 步只排定一个，其余都还待定");
const done = Deps.depOrderAtStep(rootBlock.kids, rootBlock.seq.steps, rootBlock.seq.steps.length);
assert.equal(done.pending.size, 0, "放完最后一步就没有待定的了");
assert.deepEqual(done.order, rootBlock.order, "回放到底要和不回放时的顺序一致");

// 切割集：剪掉反向边剩下的就是 DAG，所以它得指得出具体是哪几对文件造成的
const cutEdge = expanded.edges.find((e: { id: string }) => e.id === back)!;
assert.ok(Object.keys(cutEdge.files).length > 0, "反向边要说得出由哪些文件对造成");
assert.ok(Object.keys(cutEdge.files).some((k: string) => k.includes("gpio.c") && k.includes("led.h")), "造成环的是 gpio.c → led.h");

// 声明是人的假设，从外面传进来，不由派生层读写存储
const inverted = Deps.layoutRows(deps, tree, tree.allOpen(), { declarations: { ...Deps.EMPTY_DECLARATIONS, invert: ["src/app/led→src/hal/gpio"] } });
assert.ok(!inverted.edges.some((e: { id: string }) => e.id === "src/app/led→src/hal/gpio" && !inverted.inverted.has(e.id)), "打算反转的边要被标出来");
const pinned = Deps.layoutRows(deps, tree, tree.allOpen(), { declarations: { ...Deps.EMPTY_DECLARATIONS, bottom: ["src/main.c"] } });
assert.equal(pinned.order[pinned.order.length - 1], "src/main.c", "钉到块底的行排到最后");
assert.deepEqual(conc.isrs!.map((i: { name: string }) => i.name).sort(), ["BUTTON_IRQHandler", "SysTick_Handler"]);

// 一条边的明细：include 对、调用对、类型、宏、读写，各自能落到文件和行
const detail = Deps.edgeDetail(view, ["src/app/led.c", "src/app/led.h"], ["src/hal/gpio.c", "src/hal/gpio.h"], { index });
assert.ok(detail.includes.some((i: { s: string; t: string }) => i.s === "src/app/led.c" && i.t === "src/hal/gpio.h"));
assert.deepEqual(detail.calls.map((c: { toName: string }) => c.toName).sort(), ["gpio_init", "gpio_reset_all", "gpio_write"]);
assert.ok(detail.calls.every((c: { lines: number[] }) => c.lines.length > 0), "每条调用都要有行号，否则跳不过去");
assert.ok(detail.macros.some((m: { macro: string }) => m.macro === "GPIO_PORT_A"), "宏依赖也算一条边上的量");

// 内存主题：样例没有链接产物，必须明确报「不可分析」而不是画一张空表
const noImage = buildMemory(view, { index });
assert.equal(noImage.available, false);
assert.equal(noImage.reason, "no-image-facts");
assert.ok(noImage.hint, "没有产物时要说清楚为什么，以及缺什么");

// 有产物的路径：用一份手写的合成 imageFacts，不取自任何真实工程
const withImage = buildFactsView({
  ...facts,
  imageFacts: {
    artifact: { path: "build/sample.map", kind: "armlink", modified: 0 },
    totals: { romBytes: 4096, ramBytes: 1024 },
    scopedTotals: { romBytes: 3072, ramBytes: 768, ziDataBytes: 512, objects: 2 },
    staleness: { sourcesNewerThanImage: 1, filesNotInImage: 0, functionsInlinedOrDiscarded: 2, sourcesNewerSample: ["src/app/led.c"] },
    approximations: ["目标文件按它定义的函数名反查源文件"],
    objects: [
      { path: "led.o", sourcePath: "src/app/led.c", match: "functions", codeBytes: 800, roDataBytes: 64, rwDataBytes: 16, ziDataBytes: 32 },
      { path: "gpio.o", sourcePath: "src/hal/gpio.c", match: "functions", codeBytes: 400, roDataBytes: 0, rwDataBytes: 0, ziDataBytes: 24 },
    ],
    symbols: [
      { name: "s_ctx", kind: "data", section: ".bss", sizeBytes: 32, scope: "static", sourcePath: "src/app/led.c", symbolId: "variable:src/app/led.c:s_ctx" },
      { name: "s_level", kind: "data", section: ".bss", sizeBytes: 16, scope: "static", sourcePath: "src/hal/gpio.c", symbolId: "variable:src/hal/gpio.c:s_level" },
      { name: "led_task", kind: "code", section: ".text", sizeBytes: 300, scope: "global", sourcePath: "src/app/led.c", symbolId: "function:src/app/led.c:led_task" },
    ],
  },
}, "src/", { generatedAt: "0" });
const memory = buildMemory(withImage);
assert.equal(memory.available, true);
assert.deepEqual(memory.modules.map((m: { module: string }) => m.module), ["app", "hal"], "目标文件按模块归并，RAM 大的在前");
assert.deepEqual(memory.modules.map((m: { ram: number }) => m.ram), [48, 24]);
assert.deepEqual(memory.modules.map((m: { rom: number }) => m.rom), [880, 400]);
assert.deepEqual(memory.symbols.map((s: { name: string }) => s.name), ["s_ctx", "s_level"], "只列数据符号，代码符号不进这张表");
assert.equal(memory.symbols[0].id, "sym:src/app/led.c:s_ctx");
assert.equal(memory.symbols[0].line, 5, "定义行查变量表拿，不再从 id 里抠——id 不带行号了");
assert.equal(memory.matchedByFunctions, 2);

// 金样：投影的完整输出。搬运和重构不许改变它
const goldenFile = path.join(root, "view.json");
const actual = `${JSON.stringify(view, null, 2)}\n`;
if (process.env.UPDATE_GOLDEN) {
  fs.writeFileSync(goldenFile, actual, "utf8");
  console.log(`facts-view: 已更新金样 ${goldenFile}`);
} else {
  // 行尾归一之后再比。金样的内容是 JSON，不是字节流；而 Windows 上任何一次 git 操作
  // 都可能把工作区那份写成 CRLF（.gitattributes 的 eol=lf 也没拦住），逐字节比会假失败，
  // 排查两次才发现根本不是代码的事。
  const normalise = (text: string) => text.split("\r\n").join("\n");
  const expected = fs.readFileSync(goldenFile, "utf8");
  assert.equal(normalise(actual), normalise(expected), "投影输出和金样不一致；确认是有意改动后用 UPDATE_GOLDEN=1 重新记录");
}
console.log(`facts-view: 投影 ${view.files.length} 文件 / ${view.functions.length} 函数 / ${view.ast.stateMachines.length} 状态机，与金样一致`);

// 第二个样例 rtos-mini：抢占式。守任务优先级两条来路、周期、事件驱动的等待点和唤醒方，
// 以及按优先级排的行序。blinky 是协作式，碰不到这一层
{
  const rtos = JSON.parse(fs.readFileSync(path.resolve("corpus/rtos-mini/facts/partition.json"), "utf8"));
  const rtosView = buildFactsView(rtos, "src/", { source: "corpus/rtos-mini", generatedAt: "1970-01-01T00:00:00.000Z" });
  const timing = buildTiming(rtosView);
  assert.equal(timing.scheduling, "preemptive");
  assert.equal(timing.beat.available, false, "抢占式不画节拍");
  const pre = timing.preemptive;
  assert.equal(pre.available, true, "抢占式要有自己的时间图");
  assert.equal(pre.order, "descending", "FreeRTOS / CMSIS：数字大的优先级高");
  assert.deepEqual(pre.rows.map((r) => [r.name, r.rank, r.priority?.value, r.priority?.basis]), [
    ["control_task", 1, 40, "attr-initializer"],
    ["worker_task", 2, 2, "expression"],
    ["logger_task", 3, 1, "expression"],
  ], "行按优先级从高到低，两种写法都解出数字");
  assert.deepEqual(pre.rows.map((r) => r.period), [10, null, 50], "osDelay(10) / vTaskDelay(50) 折成毫秒，等队列的没有周期");
  const worker = pre.rows.find((r) => r.name === "worker_task")!;
  assert.equal(worker.mode, "event-driven");
  assert.deepEqual(worker.waits.map((w) => w.callee), ["xQueueReceive"], "事件驱动任务记下它等的调用");
  assert.equal(pre.isrs.length, 2, "TIM_IRQHandler 与 API 注册的 button_isr 都有函数体，都进中断带");
  assert.equal(pre.lcm, 50, "超周期是 10 与 50 的最小公倍数");
  const layout = layoutPreemptive(pre, { width: 1000 });
  assert.deepEqual(layout.rows.map((r) => r.cells.length), [6, 0, 2], "10 ms 的在 0–50 里到期 6 次，50 ms 的 2 次，事件驱动没有到期点");
  assert.equal(layout.rows[1].band?.kind, "event");
  // 同刻到期：t=0 与 t=50 两处 logger 都和 control 同刻，被挤右一格
  assert.deepEqual(layout.rows[2].cells.map((c) => c.deferred), [1, 1]);
  console.log(`facts-view: rtos-mini 抢占式 ${pre.rows.length} 行 · 优先级已知 ${pre.counts?.known} · 超周期 ${pre.lcm} ms`);
}
