// 代码事实面板的视图冒烟：把宿主派生好的 payload 喂给打包出来的 webview，看它画不画得出来。
//
// 不起 VS Code，只在一个最小的浏览器页面里加载 extension/dist/facts/main.js，
// 桩掉 acquireVsCodeApi，postMessage 一份 payload 进去，再对 DOM 断言。
// 数据来自自建样例 corpus/blinky，不依赖任何真实工程。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFactsView } from "../packages/facts-view/src/projection.mjs";
import { buildIndex } from "../packages/facts-view/src/graph.mjs";
import { buildStateTransitions, statePanel } from "../packages/facts-view/src/fsm/model.mjs";
import { buildMemory } from "../packages/facts-view/src/memory/model.mjs";
import { buildDependencies } from "../packages/facts-view/src/deps/model.mjs";
import { buildExecution } from "../packages/facts-view/src/execution/model.mjs";
import { buildConcurrency } from "../packages/facts-view/src/concurrency/model.mjs";
import { buildTiming } from "../packages/facts-view/src/timing/model.mjs";
import { buildRound } from "../packages/facts-view/src/timing/sequence.mjs";

const bundle = path.resolve("extension/dist/facts/main.js");
const styles = path.resolve("extension/dist/facts/main.css");
if (!fs.existsSync(bundle)) {
  console.log("facts-panel: 还没构建 extension/dist/facts，跳过（先跑 npm run build:extension）");
  process.exit(0);
}

const browser = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter((candidate) => fs.existsSync(candidate)).find((candidate) => {
  // 装着不等于能用：Edge 在某些状态下 --dump-dom 会静默返回空、退出码 0。先拿一个空页探一下
  const probe = spawnSync(candidate, ["--headless=new", "--disable-gpu", "--no-first-run", "--dump-dom", "data:text/html,<p>probe</p>"], { encoding: "utf8", timeout: 30_000 });
  return (probe.stdout ?? "").includes("probe");
});
if (!browser) {
  console.log("facts-panel: 本机没有能输出 DOM 的 Chromium，跳过 DOM 检查");
  process.exit(0);
}

const facts = JSON.parse(fs.readFileSync("corpus/blinky/facts/partition.json", "utf8"));
const view = buildFactsView(facts, "src/", { source: "corpus/blinky", generatedAt: "1970-01-01T00:00:00.000Z" });
const index = buildIndex(view);
const stateTransitions = buildStateTransitions(view, { index });
for (const machine of stateTransitions.machines) {
  machine.panels = Object.fromEntries(machine.states.map((st) => [st.name, statePanel(machine, machine.analysis, st.name, index)]));
}
const payload = {
  snapshot: "corpustest",
  project: "corpus/blinky",
  projectRoot: path.resolve("corpus/blinky"),
  partition: "application",
  region: "src/",
  generatedAt: "1970-01-01T00:00:00.000Z",
  counts: { files: view.files.length, functions: view.functions.length },
  themes: { stateTransitions, memory: buildMemory(view, { index }), dependencies: buildDependencies(view, { index }), execution: buildExecution(view, { index }), concurrency: buildConcurrency(view, { index }), timing: buildTiming(view, { index }) },
  declarations: { top: [], bottom: [], regroup: {}, invert: [], names: {} },
  functions: Object.fromEntries(view.functions.map((fn) => [fn.id, { name: fn.name, file: fn.file, line: fn.line }])),
};

// 一轮按需算：桩要像宿主一样答话，所以先把每个入口的一轮备好
const roundRoots = [view.entries.main, ...(view.entries.units ?? []).map((u) => u.entry ?? u.entrySymbolId)].filter(Boolean);
const rounds = Object.fromEntries(roundRoots.map((root) => [root, buildRound(view, root, { index })]));

const work = fs.mkdtempSync(path.join(os.tmpdir(), "archx-facts-"));
const page = path.join(work, "page.html");
fs.writeFileSync(page, `<!doctype html><meta charset="utf-8">
<style>${fs.readFileSync(styles, "utf8")}</style>
<div id="root"></div>
<script>
  window.__sent = [];
  window.__rounds = ${JSON.stringify(rounds)};
  // 桩按宿主的行为答话：收到 round 请求就把算好的那一份投回去
  window.acquireVsCodeApi = () => ({ postMessage: (m) => {
    window.__sent.push(m);
    if (m && m.type === "round") {
      setTimeout(() => window.postMessage({ type: "round", root: m.root, round: window.__rounds[m.root] }, "*"), 10);
    }
  } });
</script>
<script>${fs.readFileSync(bundle, "utf8")}</script>
<script>
  // React 的 message 监听在 effect 里挂，要等它挂上再投；面板自己会先发 ready
  const send = () => window.postMessage({ type: "facts", payload: ${JSON.stringify(payload)} }, "*");
  setTimeout(send, 60);
  const clickTheme = (name) => {
    const b = [...document.querySelectorAll(".themes button")].find((x) => x.textContent.trim() === name);
    if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };
  setTimeout(() => {
    // 执行关系是默认主题：记下入口和树根，再依次看依赖和状态转换
    window.__exec = { roots: document.querySelectorAll(".machine").length, treeRows: document.querySelectorAll(".trow").length, cmpCells: document.querySelectorAll(".cmp td.cnt").length, search: document.querySelectorAll(".fnsearch input").length };
    clickTheme("Dependencies");
  }, 250);
  setTimeout(() => {
    window.__deps = {
      depRows: document.querySelectorAll(".dm-row").length,
      cells: document.querySelectorAll(".dm-cell.cell").length,
      backCells: document.querySelectorAll(".dm-cell.cell.back").length,
      legend: document.querySelectorAll(".dm-legend i").length,
      cutRows: document.querySelectorAll(".dp-table tr.dp-edge-row").length,
    };
    // 回放：点左上角那颗 ▶，回放条应当出现并停在第 1 步
    document.querySelector(".dm-corner-play")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, 420);
  setTimeout(() => {
    const bar = document.querySelector(".dm-play");
    window.__play = {
      playBar: bar ? 1 : 0,
      playWhy: bar?.querySelector(".why")?.textContent ?? "",
      slider: bar?.querySelector("input[type=range]")?.max ?? "",
      // 回放中途未排定的行要标出来，否则看不出「还没轮到它」
      pendingRows: document.querySelectorAll(".dm-row.pending").length,
    };
    clickTheme("Order & time");
  }, 700);
  setTimeout(() => {
    window.__timing = { unitRows: document.querySelectorAll("table.grid tbody tr").length, beatRows: document.querySelectorAll(".beat-row").length, beatSlots: document.querySelectorAll(".beat-slot").length, beatChips: document.querySelectorAll(".beat-facts .bf").length, railUnits: document.querySelectorAll(".rail .machine").length };
    // 一轮：挑 main 那一行。它排在最后，启动路径上那个忙等就是要靠它才看得到
    // 单元列表现在在侧栏（Rail）里，点 main 那个
    const mainBtn = [...document.querySelectorAll(".rail .machine")].find((el) => el.textContent.includes("main"));
    if (mainBtn) mainBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, 800);
  setTimeout(() => {
    window.__round = {
      levels: document.querySelectorAll(".rd-level").length,
      boxes: document.querySelectorAll(".rd-box").length,
      rdRows: document.querySelectorAll(".rd-row").length,
      exits: document.querySelectorAll(".rd-exit").length,
      badges: document.querySelectorAll(".rd-badge").length,
      // 子框要被推下去对齐它长出来的那一行，位移写在 style 上
      shifted: [...document.querySelectorAll(".rd-slot")].filter((x) => parseFloat(x.style.marginTop) > 0).length,
    };
    clickTheme("Sharing & concurrency");
  }, 1000);
  setTimeout(() => {
    window.__conc = { rows: document.querySelectorAll("table.rw tbody tr").length, rungs: document.querySelectorAll(".rung").length, rmVars: document.querySelectorAll(".runmap .rm-var").length, rmNodes: document.querySelectorAll(".runmap .rm-node[data-unit]").length };
    clickTheme("State transitions");
  }, 1120);
  setTimeout(() => {
    const target = [...document.querySelectorAll(".state")].find((g) => g.textContent.trim() === "LED_ON");
    if (target) target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const probe = document.createElement("div");
    probe.id = "probe";
    probe.textContent = JSON.stringify({ ...(window.__deps ?? {}), ...(window.__exec ?? {}), ...(window.__conc ?? {}), ...(window.__timing ?? {}), ...(window.__play ?? {}), ...(window.__round ?? {}) });
    document.body.appendChild(probe);
  }, 1400);
</script>`, "utf8");

const dump = spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=8000", "--dump-dom", `file:///${page.replace(/\\/g, "/")}`], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const html = dump.stdout ?? "";
if (process.env.KEEP_DOM) { fs.writeFileSync(path.resolve("work/facts-panel-dom.html"), html, "utf8"); console.log("DOM 存到 work/facts-panel-dom.html"); }
fs.rmSync(work, { recursive: true, force: true });

assert.ok(html.includes("State transitions"), "顶栏没有渲染");
assert.ok(html.includes("corpustest"), "快照 ID 没有显示");
assert.ok(html.includes("s_ctx.state"), "机器名没有渲染");
for (const state of ["LED_OFF", "LED_ON", "LED_FAULT"]) assert.ok(html.includes(state), `状态 ${state} 没画出来`);
assert.ok(html.includes("g_button_pressed"), "并发矩阵里要有共享标志");
const stateNodes = html.match(/class="state[^"]*"/g) ?? [];
assert.equal(stateNodes.length, 3, `状态节点应有 3 个，实际 ${stateNodes.length}`);
assert.equal((html.match(/class="uml-init"/g) ?? []).length, 1, "UML 初态要画出来");
assert.ok((html.match(/class="uml-badge/g) ?? []).length >= 1, "选中 LED_ON 之后它的出边要挂上和侧栏对应的编号");
const edges = html.match(/class="edge (next|jump|back|self|exit)[^"]*"/g) ?? [];
assert.equal(edges.length, 3, `边应有 3 条，实际 ${edges.length}`);
assert.ok(html.includes("class=\"detail\""), "点状态之后没出明细区");
assert.ok(/class="row (pos|neg|guard)/.test(html), "明细区里没有条件行");
assert.ok(html.includes("Memory footprint"), "主题导航里没有内存");
assert.ok(html.includes("Dependencies"), "主题导航里没有依赖");
assert.ok(html.includes("Execution"), "主题导航里没有执行关系");
// 依赖主题：三个单元三行，两条边两个格子，图例齐全
const probe = JSON.parse(/<div id="probe">([^<]*)<\/div>/.exec(html)?.[1] ?? "{}");
assert.equal(probe.depRows, 4, `依赖矩阵折叠时应有 4 行（app / hal / startup / main.c），实际 ${probe.depRows}`);
assert.ok(probe.cells >= 2, `依赖矩阵至少 2 个格子，实际 ${probe.cells}`);
assert.equal(probe.legend, 5, "图例五种颜色都要在");
// 样例里有一条故意的反向边：红格、切割集、回放三处都要看得见
assert.equal(probe.backCells, 1, `反向边应画成 1 个红格，实际 ${probe.backCells}`);
assert.equal(probe.cutRows, 1, `切割集应有 1 行，实际 ${probe.cutRows}`);
assert.ok(html.includes("Cut set"), "切割集那一节没渲染");
assert.equal(probe.playBar, 1, "点了 ▶ 之后没出回放条");
assert.ok(/step \d+ of \d+/.test(probe.playWhy), `回放条要说清第几步，实际「${probe.playWhy}」`);
assert.ok(/moved to the top|moved to the bottom|alphabetical/.test(probe.playWhy), `回放条要说清这一步为什么这么排，实际「${probe.playWhy}」`);
assert.ok(Number(probe.slider) >= 3, `滑杆上限应是总步数，实际 ${probe.slider}`);
assert.ok(probe.pendingRows > 0, "回放中途还没排定的行要标成待定");
// 双根对比：BUTTON_IRQHandler 与 main、led_task 都经 gpio_write 碰头，两个格子；SysTick 没有共用函数，藏进注脚
assert.equal(probe.cmpCells, 2, "双根对比矩阵要有两个格子");
assert.equal(probe.search, 1, "入口栏顶上要有函数搜索框");
// 执行关系：main 和 led_task 两个入口，树根一行
assert.equal(probe.roots, 5, `入口应有 5 个（main、两个中断、两个任务），实际 ${probe.roots}`);
assert.ok(probe.treeRows >= 1, "调用树至少画出根节点");
// 共享与并发：两个标志各一行，两个中断各一级
assert.ok(html.includes("Sharing &amp; concurrency"), "主题导航里没有共享与并发");
assert.ok(probe.rows >= 2, `并发矩阵应至少 2 行，实际 ${probe.rows}`);
assert.equal(probe.rungs, 2, "两个中断都要出现在优先级梯子上");
assert.equal(probe.beatRows, 2, "节拍里两行任务");
assert.ok(probe.beatSlots >= 2, `节拍里要有格子，实际 ${probe.beatSlots}`);
assert.ok(probe.beatChips >= 4, "节拍上面的事实条");
assert.equal(probe.railUnits, 5, "侧栏里五个执行单元可选");
assert.equal(probe.rmVars, 4, "运行图里四个变量");
assert.equal(probe.rmNodes, 3, "运行图里三个单元");
// 顺序与时间：三个执行单元一行一个，忙等单独一张表
assert.ok(html.includes("Order &amp; time"), "主题导航里没有顺序与时间");
assert.ok(probe.unitRows >= 3, `节奏表应至少 3 行，实际 ${probe.unitRows}`);
// 一轮：main 那一轮要裂成两列，忙等单独成框，框右边写着怎么出去
assert.ok(html.includes("One round of"), "一轮那一段没渲染");
assert.equal(probe.levels, 2, `一轮应有 2 列（一轮 + 第 1 层循环），实际 ${probe.levels}`);
assert.equal(probe.boxes, 2, `应有 2 个框，实际 ${probe.boxes}`);
assert.ok(probe.rdRows >= 5, `框里的行太少，实际 ${probe.rdRows}`);
assert.ok(probe.exits >= 2, "每个框右边都要写出口");
assert.equal(probe.badges, 1, "长出循环的那一行要挂角标，且只有一个");
assert.ok(probe.shifted >= 1, "子框要被推下去对齐它长出来的那一行");
assert.ok(html.includes("Rightward is nesting depth, not time"), "读法必须写在页面上，否则会被读成甘特图");
// 样例没有链接产物：内存主题必须标成没有数据，而不是消失或画空表
assert.ok(/class="[^"]*dim[^"]*"[^>]*>Memory footprint/.test(html), "没有数据的主题要标灰，不能装作有");
assert.ok(!/<p class="empty">/.test(html), "渲染成了空状态");

console.log(`facts-panel: 执行 ${probe.roots} 入口 · 双根 ${probe.cmpCells} 格 · 依赖 ${probe.depRows} 行 ${probe.backCells} 红格 · 切割集 ${probe.cutRows} 行 · 回放 ${probe.slider} 步 · 一轮 ${probe.levels} 列 ${probe.boxes} 框 · 并发 ${probe.rows} 行 ${probe.rungs} 中断 · 运行图 ${probe.rmVars} 变量 ${probe.rmNodes} 单元 · 节拍 ${probe.beatRows} 行 ${probe.beatSlots} 格，DOM 检查通过`);
