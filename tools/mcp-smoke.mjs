// MCP 服务器的冒烟：把它当成一个真的 MCP 客户端来问。
//
// 覆盖两件事，也只有这两件：Agent 怎么读代码事实（按主题、按对象、分页、超限被拒），
// 以及 MCP 怎么请求插件显示（反向文件通道）。
//
// 事实用自建样例 corpus/blinky 的夹具，指针由这里替宿主写一行——不起 VS Code，
// 不依赖 clangd，也不依赖任何真实工程。

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "archx-mcp-smoke-"));
const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "archx-mcp-state-"));
const projectKey = crypto.createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 20);

// 事实指针：真实场景里宿主每次派生完写下，MCP 照着找。事实落在扩展的 globalStorage 里，
// 那个路径由 VS Code 决定，MCP 自己推不出来。
const pointerFile = path.join(localAppData, "facts", `${projectKey}.json`);
fs.mkdirSync(path.dirname(pointerFile), { recursive: true });
fs.writeFileSync(pointerFile, `${JSON.stringify({
  seq: 1,
  at: "1970-01-01T00:00:00.000Z",
  root,
  factsFile: path.resolve("corpus/blinky/facts/partition.json"),
  region: "src/",
  projectRoot: path.resolve("corpus/blinky"),
  snapshot: "corpustest",
  label: "blinky",
})}\n`, "utf8");

const server = path.resolve("extension/claude-marketplace/plugins/archx/server/archx-mcp.mjs");
if (!fs.existsSync(server)) {
  console.log("mcp: 还没构建 MCP 服务器，跳过（先跑 npm run build:extension）");
  process.exit(0);
}
const child = spawn(process.execPath, [server], {
  env: { ...process.env, ARCHX_PROJECT_ROOT: root, ARCHX_STATE_DIR: localAppData },
  stdio: ["pipe", "pipe", "inherit"],
});
const childClosed = new Promise((resolve) => child.once("close", resolve));
const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
lines.on("line", (line) => {
  const response = JSON.parse(line);
  pending.get(response.id)?.(response);
  pending.delete(response.id);
});

let nextId = 0;
const request = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
});
const call = async (name, args = {}) => JSON.parse((await request("tools/call", { name, arguments: args })).result.content[0].text);

try {
  const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
  assert.equal(initialized.result.serverInfo.name, "archx");

  const listed = await request("tools/list");
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ["scan_project", "list_code_facts", "read_code_facts", "read_fact_object", "show_code_facts", "focus_code_fact"],
    "表面只有代码事实这一套（扫描 + 读取）；旧的契约 / 提案 / 执行工具已经删了",
  );

  // ---- 入口：便宜，只说有什么，不返回事实内容 ----------------------------------------
  const listing = await call("list_code_facts");
  assert.equal(listing.snapshot, "corpustest", "快照 ID 要从指针里带出来，人和 Agent 靠它对上同一份");
  assert.equal(listing.scale.files, 11, "样例 11 个文件（含 heartbeat.c/h）");
  const byTheme = Object.fromEntries(listing.themes.map((item) => [item.theme, item]));
  assert.equal(Object.keys(byTheme).length, 6, "六个主题都要列出来");
  assert.equal(byTheme.timing.available, true);
  assert.ok(byTheme.timing.question, "每个主题要说清它答什么问题，省得 Agent 逐个试");
  assert.equal(byTheme.memory.available, false, "样例没有链接产物");
  assert.ok(byTheme.memory.reason, "没数据要说原因，不能只是缺席");
  assert.ok(byTheme.dependencies.fields.leaves, "要告诉 Agent 哪些字段能往下钻");

  // ---- 按主题按路径取，数组带 total ----------------------------------------------------
  const loops = await call("read_code_facts", { theme: "timing", path: "loops" });
  assert.equal(loops.total, 3, "样例有三个循环（events 忙等、gpio 遍历、heartbeat 主循环）");
  assert.equal(loops.count, 3);
  assert.equal(loops.more, null, "取完了就明说取完了");
  assert.ok(loops.items[0].id.startsWith("loop:"), "切片不改写派生结果，稳定 ID 原样带着");

  const firstLoop = await call("read_code_facts", { theme: "timing", path: "loops", limit: 1 });
  assert.equal(firstLoop.count, 1);
  assert.equal(firstLoop.total, 3, "分页只切了一条，total 仍是全部");
  assert.deepEqual(firstLoop.more, { offset: 1, remaining: 2 }, "还剩多少必须是明的");

  const wrong = await call("read_code_facts", { theme: "timing", path: "loop" });
  assert.ok(wrong.error, "字段不存在要报错");
  assert.ok(JSON.stringify(wrong.available).includes("loops"), "报错时要告诉 Agent 有哪些字段");

  const memory = await call("read_code_facts", { theme: "memory" });
  assert.equal(memory.available, false);
  assert.equal(memory.reason, "no-image-facts");

  // 空数组必须原样返回：它表示「查过，没有」，和字段缺席的「没查」不是一回事
  const emptyish = await call("read_code_facts", { theme: "stateTransitions", path: "dispatchTables" });
  assert.equal(emptyish.total, 0, "样例没有分派表，但这是查过的结论，不能让字段消失");
  assert.deepEqual(emptyish.items, []);

  // ---- 按稳定 ID 取一个对象 -------------------------------------------------------------
  const units = await call("read_code_facts", { theme: "timing", path: "units" });
  const unitId = units.items.find((item) => item.kind === "main").id;
  const unit = await call("read_fact_object", { id: unitId });
  assert.equal(unit.theme, "timing");
  assert.equal(unit.object.id, unitId);
  assert.ok(unit.round && unit.round.levels.length >= 2, "main 那一轮要能摊开，忙等在第二列");

  const missing = await call("read_fact_object", { id: "loop:nowhere.c:1" });
  assert.equal(missing.found, false, "找不到就说找不到");
  assert.ok(Array.isArray(missing.sameKind), "顺带给出同类的 ID，让 Agent 能自己纠正");

  // ---- 反向通道：MCP 写视图请求，宿主监听这个文件 ----------------------------------------
  const shown = await call("show_code_facts", { scan: false });
  assert.equal(shown.requested.kind, "show");
  const focused = await call("focus_code_fact", { id: "state:src/app/led.c:s_ctx/LED_ON" });
  assert.equal(focused.requested.kind, "focus");
  assert.equal(focused.requested.id, "state:src/app/led.c:s_ctx/LED_ON");
  assert.equal(focused.requested.seq, shown.requested.seq + 1, "请求序号必须递增，宿主靠它判断是不是新的一条");
  const written = JSON.parse(fs.readFileSync(path.join(localAppData, "view-requests", `${projectKey}.json`), "utf8"));
  assert.equal(written.seq, focused.requested.seq, "请求要真的落盘，宿主是从文件读的");

  // scan_project：前提缺了就什么都不跑，只说缺什么、该跑哪条命令。一个只有 platformio.ini 的目录必然缺构建信息；
  // CI 的工具作业没装 clangd，那就先报缺 clangd——两种都对，都不能跑引擎
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "archx-mcp-bare-"));
  fs.writeFileSync(path.join(bare, "platformio.ini"), "[env:x]\n", "utf8");
  fs.writeFileSync(path.join(bare, "main.c"), "int main(void) { return 0; }\n", "utf8");
  const needs = await call("scan_project", { folder: bare });
  assert.ok(["needs-build-info", "needs-clangd", "needs-engine"].includes(needs.status), `缺前提时不能扫描，实得 ${needs.status}`);
  if (needs.status === "needs-build-info") assert.equal(needs.runInProjectRoot[0].command, "pio run -t compiledb", "PlatformIO 工程要给出生成编译数据库的那条命令");
  fs.rmSync(bare, { recursive: true, force: true });

  console.log(`ArchX MCP smoke passed（6 个工具 · 6 个主题 · 快照 ${listing.snapshot} · scan_project 缺前提时报 ${needs.status}）`);
} finally {
  child.stdin.end();
  child.kill();
  await childClosed;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(localAppData, { recursive: true, force: true });
}
