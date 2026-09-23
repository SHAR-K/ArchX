import { setLocale } from "../../packages/facts-view/src/i18n.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

// 和面板同一份派生。不是「照着实现一遍」，是同一批文件被打进这个服务器——
// 「人在图上看到的和 Agent 说的必然是同一件事」这句话只有这样才成立。
import { buildFactsView } from "../../packages/facts-view/src/projection.mjs";
import { buildIndex } from "../../packages/facts-view/src/graph.mjs";
import { buildStateTransitions } from "../../packages/facts-view/src/fsm/model.mjs";
import { buildMemory } from "../../packages/facts-view/src/memory/model.mjs";
import { buildDependencies } from "../../packages/facts-view/src/deps/model.mjs";
import { buildExecution } from "../../packages/facts-view/src/execution/model.mjs";
import { buildConcurrency } from "../../packages/facts-view/src/concurrency/model.mjs";
import { buildTiming } from "../../packages/facts-view/src/timing/model.mjs";
import { buildRound } from "../../packages/facts-view/src/timing/sequence.mjs";
import { indexById, overview, slice } from "../../packages/facts-view/src/slice.mjs";
import { archxStateDirectory, projectKey as stateProjectKey, publishFactsPointer } from "../../packages/core/src/facts-pointer.ts";
import { scanProject } from "./scan.mjs";
import { createPartition, projectFactsToPartition } from "../../packages/core/src/index.ts";

// Agent 面固定英文：派生层的 hint / basis 都经 t()，语言在这里定
setLocale("en");

const root = path.resolve(process.env.ARCHX_PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd());

function projectKey() {
  return crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 20);
}


// 反向通道：宿主写状态给 MCP 读，这条相反——MCP 写请求，宿主监听文件。
// 对称、不用本地端口、Windows 上不弹防火墙。请求带序号，宿主据此判断是不是新的一条。
function viewRequestFile() {
  const base = archxStateDirectory();
  return path.join(base, "view-requests", `${projectKey()}.json`);
}

function requestView(request) {
  const file = viewRequestFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let previous = 0;
  try { previous = JSON.parse(fs.readFileSync(file, "utf8")).seq ?? 0; } catch { previous = 0; }
  const payload = { seq: previous + 1, at: new Date().toISOString(), root, ...request };
  fs.writeFileSync(file, `${JSON.stringify(payload)}
`, "utf8");
  return payload;
}

// ---- 代码事实：指针 → 读 → 投影 → 派生 → 切片 -------------------------------------
//
// 指针由宿主每次派生完写下。事实落在扩展的 globalStorage 里，那个路径由 VS Code 决定，
// 这个进程自己推不出来，所以只能靠宿主告诉它。

function factsPointerFile() {
  const base = archxStateDirectory();
  return path.join(base, "facts", `${projectKey()}.json`);
}

let factsCache = null;

/** 还没有事实可读：和 needs-engine 那些一样回一个带 status 的结果，agent 按同一个口子处理 */
class NoFacts extends Error {
  constructor() { super("No code facts to read yet."); }
}
const NO_FACTS = { status: "no-facts", message: "No code facts to read yet.", next: "Call scan_project first (it works without VS Code). show_code_facts is the alternative when the ArchX extension is open." };

/** 当前这份事实的全部派生结果。同一个文件同一个 mtime 就复用，重扫之后自动失效。 */
function facts() {
  let pointer;
  try { pointer = JSON.parse(fs.readFileSync(factsPointerFile(), "utf8")); } catch {
    throw new NoFacts();
  }
  if (!fs.existsSync(pointer.factsFile)) {
    throw new Error(`The facts file the pointer refers to is gone: ${pointer.factsFile}. Call show_code_facts again.`);
  }
  const stamp = `${pointer.factsFile}:${fs.statSync(pointer.factsFile).mtimeMs}:${pointer.region}`;
  if (factsCache && factsCache.stamp === stamp) return factsCache;

  const raw = fs.readFileSync(pointer.factsFile);
  const text = raw.length >= 2 && raw.readUInt16BE(0) === 0x1f8b ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const snapshot = JSON.parse(text);
  const view = buildFactsView(snapshot, pointer.region, { source: pointer.factsFile, generatedAt: pointer.at });
  const index = buildIndex(view);
  const themes = {
    execution: buildExecution(view, { index }),
    dependencies: buildDependencies(view, { index }),
    timing: buildTiming(view, { index }),
    concurrency: buildConcurrency(view, { index }),
    stateTransitions: buildStateTransitions(view, { index }),
    memory: buildMemory(view, { index }),
  };
  factsCache = { stamp, pointer, view, index, themes, byId: indexById(themes) };
  return factsCache;
}

function listCodeFacts() {
  const { pointer, view, themes } = facts();
  return {
    snapshot: pointer.snapshot,
    label: pointer.label,
    projectRoot: pointer.projectRoot,
    region: pointer.region || "(whole scan root)",
    derivedAt: pointer.at,
    scale: { files: view.files.length, functions: view.functions.length },
    themes: overview(themes),
    howToRead: [
      "read_code_facts reads by theme; path drills in; arrays take offset / limit; total in the result says how many there are.",
      "Anything over the per-call limit is refused explicitly with instructions on how to split it; nothing is silently dropped — 'this is all' and 'here is part' must never be confused.",
      "read_fact_object fetches one object by stable ID — the same ID the panel lets you copy.",
      "focus_code_fact shows the person, in the panel, which object you are working on.",
    ],
  };
}

function readCodeFacts(args) {
  const { themes, pointer } = facts();
  const name = String(args?.theme ?? "");
  if (!(name in themes)) throw new Error(`No such theme: ${name}. Available: ${Object.keys(themes).join(", ")}`);
  const theme = themes[name];
  if (!theme.available) {
    return { snapshot: pointer.snapshot, theme: name, available: false, reason: theme.reason ?? null, hint: theme.hint ?? null };
  }
  return { snapshot: pointer.snapshot, ...slice(name, theme, { path: args?.path, offset: args?.offset, limit: args?.limit }) };
}

function readFactObject(args) {
  const { byId, pointer, view, index } = facts();
  const id = String(args?.id ?? "");
  if (!id) throw new Error("read_fact_object needs a stable ID");
  const found = byId.get(id);
  if (!found) {
    const kind = id.split(":")[0];
    const sameKind = [...byId.keys()].filter((key) => key.startsWith(`${kind}:`)).slice(0, 12);
    return { snapshot: pointer.snapshot, id, found: false, note: "This ID is not in these facts", sameKind };
  }
  // 一轮不进主题（88 个单元一次全算太慢），按需现算，和面板点「看这一轮」是同一条路径
  const extra = id.startsWith("unit:") || id.startsWith("exec:")
    ? (() => { try { return buildRound(view, found.object.entry ?? found.object.symbol ?? found.object.root, { index }); } catch { return null; } })()
    : null;
  return { snapshot: pointer.snapshot, id, theme: found.theme, path: found.path, object: found.object, round: extra };
}


const EXECUTION_DOMAINS = ["isr", "task", "host", "hw", "build"];


const tools = [
  {
    name: "scan_project",
    description: "Scan a C/C++ firmware project with the ArchCheck engine — works from a terminal, no VS Code needed. Call this when the user asks to scan / analyze a project. folder defaults to the current project. If a prerequisite is missing (engine, clangd, or build information such as compile_commands.json) nothing is run: the result says what is missing and the exact command to run in the user's terminal; run it, then call again. On success the facts are ready for list_code_facts / read_code_facts, and the result carries a first overview",
    inputSchema: { type: "object", properties: { folder: { type: "string", description: "absolute path; defaults to the current project root" }, sourceScanOnly: { type: "boolean", description: "only if the user accepts a scan without build information (files and include dependencies only)" } } },
  },
  {
    name: "list_code_facts",
    description: "Call this first: the snapshot ID of the current code facts, their scale, what question each of the six themes answers, whether it has data, and which fields in each theme can be drilled into. Returns no fact content itself; cheap",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_code_facts",
    description: "Read one slice of the derived results by theme. theme is one of execution / dependencies / timing / concurrency / stateTransitions / memory; path is a dotted field path (e.g. loops, resources.2.units), omitted means the whole theme; arrays page with offset / limit and total in the result is the full count. Anything over the per-call limit is refused with instructions on how to split; never silently truncated",
    inputSchema: { type: "object", required: ["theme"], properties: { theme: { type: "string" }, path: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 500 } } },
  },
  {
    name: "read_fact_object",
    description: "Fetch one object by stable ID — the same ID the panel lets you copy (unit: / exec: / res: / loop: / fsm: / state: / mem: / sym:). For unit: or exec: the unfolded round of that execution unit is attached",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "show_code_facts",
    description: "Make the ArchX extension show code facts. With folder (an absolute path) that directory is analyzed (the target project needs no ArchX metadata and is not written to); without it the currently selected partition is used. scan: true rescans first",
    inputSchema: { type: "object", properties: { folder: { type: "string" }, scan: { type: "boolean" } } },
  },
  {
    name: "focus_code_fact",
    description: "Point the code-facts panel in the extension at one object so the person sees which one you are working on. id is the stable reference the panel gives",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

/**
 * 本地网页：演示页的单文件模板 + 这次的事实。双击就能看，所有图和插件面板一样（同一份代码）。
 * 页面里带着这个工程的全部事实——它只写在本机的 ArchX 状态目录里，转发这个文件就等于把事实发出去。
 */
function writeLocalViewer({ folder, outDir, scoped, snapshot, raw }) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const template = path.resolve(here, "..", "viewer", "archx-viewer.html");
  if (!fs.existsSync(template)) return { available: false, note: "viewer template not found next to the MCP server; rebuild the plugin (npm run build:viewer)" };
  const view = buildFactsView(scoped, "", { source: folder, generatedAt: new Date().toISOString() });
  const units = {};
  for (const u of view.entries?.units ?? []) units[u.kind] = (units[u.kind] ?? 0) + 1;
  const project = {
    id: "local", title: path.basename(folder), repo: "", commit: "", license: "", kind: "local",
    blurb: `Local scan of ${folder}`, build: "", focus: ["**"], region: "", snapshot, localRoot: folder,
    counts: { files: view.files.length, functions: view.functions.length, units, sharedResources: view.ast?.sharedResources?.length ?? 0, conflictCandidates: view.ast?.conflictCandidates?.length ?? 0 },
  };
  const embed = { generatedAt: new Date().toISOString().slice(0, 10), engineCommit: "", project, data: zlib.gzipSync(JSON.stringify(view)).toString("base64") };
  const html = fs.readFileSync(template, "utf8").replace("window.__ARCHX_EMBED__ = null;", () => `window.__ARCHX_EMBED__ = ${JSON.stringify(embed).replace(/</g, "\\u003c")};`);
  const file = path.join(outDir, "archx-facts.html");
  fs.writeFileSync(file, html, "utf8");
  return { available: true, file, url: pathToFileURL(file).href, sizeKB: Math.round(html.length / 1024), note: "Contains this project's facts; it lives only on this machine. Forwarding the file shares the facts." };
}

function scanProjectTool(args) {
  const folder = path.resolve(String(args?.folder || root));
  const stateDir = archxStateDirectory();
  const outDir = path.join(stateDir, "scans", stateProjectKey(folder));
  const result = scanProject({ folder, stateDir, outDir, sourceScanOnly: Boolean(args?.sourceScanOnly) });
  if (result.status !== "scanned") return result;
  // 快照 ID 和插件同一口径：事实内容的 sha256 前 12 位。写指针之后 list / read 读的就是这一份
  // 引擎给的是整次扫描；读取工具吃的是分区投影（和插件同一条规则）。整个目录就是一个分区
  const raw = JSON.parse(fs.readFileSync(result.factsFile, "utf8"));
  const scoped = projectFactsToPartition(raw, createPartition({ name: path.basename(folder), focusPaths: ["**"] }));
  const partitionFile = path.join(outDir, "partition.json.gz");
  fs.writeFileSync(partitionFile, zlib.gzipSync(JSON.stringify(scoped)));
  const snapshot = crypto.createHash("sha256").update(JSON.stringify(scoped)).digest("hex").slice(0, 12);
  publishFactsPointer(root, { factsFile: partitionFile, region: "", projectRoot: folder, snapshot, label: path.basename(folder) });
  factsCache = null;
  const viewer = writeLocalViewer({ folder, outDir, scoped, snapshot, raw });
  let firstLook = null;
  try { firstLook = listCodeFacts(); } catch (error) { firstLook = { note: error instanceof Error ? error.message : String(error) }; }
  return {
    ...result,
    snapshot,
    viewer,
    next: "Read with list_code_facts / read_code_facts / read_fact_object. Give the user the viewer link (viewer.url): it opens the same facts as pictures in a browser, no server needed. If the VS Code extension is installed, show_code_facts opens them in its panel as well.",
    overview: firstLook,
  };
}

async function toolCall(name, args) {
  try {
    return await dispatchTool(name, args);
  } catch (error) {
    if (error instanceof NoFacts) return NO_FACTS;
    throw error;
  }
}

async function dispatchTool(name, args) {
  if (name === "scan_project") return scanProjectTool(args);
  if (name === "list_code_facts") return listCodeFacts();
  if (name === "read_code_facts") return readCodeFacts(args);
  if (name === "read_fact_object") return readFactObject(args);
  if (name === "show_code_facts") {
    const request = requestView({ kind: "show", folder: args?.folder ?? null, scan: Boolean(args?.scan) });
    return {
      requested: request,
      note: "The extension opens the code-facts panel and shows it. The person sees the same derived results you read; the snapshot ID is in the panel header.",
    };
  }
  if (name === "focus_code_fact") {
    const id = String(args?.id ?? "");
    if (!id) throw new Error("focus_code_fact needs a stable reference id");
    return { requested: requestView({ kind: "focus", id }) };
  }
  throw new Error(`Unknown ArchX tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, error) {
  send({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  try {
    if (request.method === "initialize") {
      respond(request.id, {
        protocolVersion: request.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "archx", version: "0.26.1" },
      });
    } else if (request.method === "ping") respond(request.id, {});
    else if (request.method === "tools/list") respond(request.id, { tools });
    else if (request.method === "tools/call") {
      // 返回一律原样给出，不做压缩。空数组在派生结果里表示「查过，没有」，null 表示
      // 「这一项不适用」；删掉它们之后 Agent 只看到字段缺席，而「没有」和「没查」
      // 这个区别一混，后面的结论就全是错的。
      const result = await toolCall(request.params?.name, request.params?.arguments || {});
      respond(request.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    } else fail(request.id, new Error(`Unsupported MCP method: ${request.method}`));
  } catch (error) {
    if (request.method === "tools/call") {
      respond(request.id, { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] });
    } else fail(request.id, error);
  }
});
