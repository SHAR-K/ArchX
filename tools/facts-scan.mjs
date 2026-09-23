// 不经 VS Code 扩展、不打包，直接用 ArchCheck 源码扫一个工程并投影到分区事实。
// 用法：node --experimental-strip-types tools/facts-scan.mjs <projectRoot> [partitionId] [--out work/facts-scan] [--engine engine] [--keil path/to.uvprojx] [--target name]
// 输出：<out>/<partitionId>/architecture.json（全仓，引擎原样输出）与 partition.json（与扩展相同的投影规则）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectFactsToPartition } from "../packages/core/src/facts.ts";
import { writeFacts } from "../packages/core/src/facts-io.ts";

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const positional = args.filter((item, index) => !item.startsWith("--") && (index === 0 || !args[index - 1].startsWith("--")));
const root = path.resolve(positional[0] ?? ".");
const partitionId = positional[1] ?? "application";
const outRoot = path.resolve(option("--out", "work/facts-scan"));
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const engineRoot = path.resolve(option("--engine", path.join(repoRoot, "engine")));
const python = option("--python", "python");

if (!fs.existsSync(path.join(engineRoot, "src", "archcheck", "__init__.py"))) throw new Error(`找不到 ArchCheck 源码：${engineRoot}（用 --engine 指定）`);
const project = JSON.parse(fs.readFileSync(path.join(root, ".archx", "project.json"), "utf8"));
const partition = (project.partitions ?? []).find((item) => item.id === partitionId);
if (!partition) throw new Error(`分区 ${partitionId} 不存在，已有：${(project.partitions ?? []).map((item) => item.id).join(", ")}`);

// Keil 工程：与扩展相同的规则——显式指定 > 与 focus 路径公共前缀最长的 .uvprojx；Target 取第一个
const findKeil = (directory) => {
  const ignored = new Set([".git", "build", "Listings", "node_modules", "Objects", "output"]);
  const matches = [];
  const visit = (current) => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { if (entry.isDirectory()) { if (!ignored.has(entry.name)) visit(path.join(current, entry.name)); } else if (entry.name.toLowerCase().endsWith(".uvprojx")) matches.push(path.join(current, entry.name)); } };
  visit(directory);
  return matches.sort();
};
const relevance = (file) => { const parts = path.relative(root, path.dirname(file)).replaceAll("\\", "/").split("/"); return Math.max(0, ...partition.focusPaths.map((focus) => { const focusParts = focus.replaceAll("\\", "/").split("/").filter((part) => part && !part.includes("*")); let common = 0; while (common < parts.length && common < focusParts.length && parts[common].toLowerCase() === focusParts[common].toLowerCase()) common += 1; return common; })); };
const compileDatabase = [path.join(root, "compile_commands.json"), path.join(root, "build", "compile_commands.json")].find(fs.existsSync);
let keil = option("--keil") ? path.resolve(root, option("--keil")) : null;
if (!keil && !compileDatabase) { const candidates = findKeil(root).sort((a, b) => relevance(b) - relevance(a)); keil = candidates[0] ?? null; }
const target = option("--target") ?? (keil ? (/<TargetName>\s*([^<]+?)\s*<\/TargetName>/i.exec(fs.readFileSync(keil, "utf8"))?.[1]?.trim() ?? "") : "");

const outDir = path.join(outRoot, partitionId);
fs.mkdirSync(outDir, { recursive: true });
const engineArgs = ["-m", "archcheck", root, "--json", "--out", outDir];
if (keil) { engineArgs.push("--keil-project", keil); if (target) engineArgs.push("--keil-target", target); }
else if (!compileDatabase) engineArgs.push("--source-scan");
console.error(`engine: ${engineRoot}\nproject: ${root}\npartition: ${partitionId} focus=${partition.focusPaths.join(",")}\n${keil ? `keil: ${path.relative(root, keil)} / ${target}` : compileDatabase ? `compile db: ${compileDatabase}` : "source scan"}`);

const started = Date.now();
const result = spawnSync(python, engineArgs, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 512, env: { ...process.env, PYTHONPATH: [path.join(engineRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter), PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
if (result.status !== 0) { console.error(result.stderr); throw new Error(`ArchCheck 退出码 ${result.status}`); }
if (result.stderr.trim()) console.error(result.stderr.trim().split("\n").slice(-8).join("\n"));
const snapshot = JSON.parse(result.stdout);
writeFacts(outDir, snapshot, "architecture.json");
const scoped = projectFactsToPartition(snapshot, partition);
const factsOut = writeFacts(outDir, scoped);
const count = (value) => (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : value ?? "-");
console.log(`scan: ${((Date.now() - started) / 1000).toFixed(1)}s, engine schema ${snapshot.schemaVersion}`);
console.log(`architecture.json: functions=${count(snapshot.functions)} semantic_edges=${count(snapshot.semantic_edges)} executionUnits=${count(snapshot.executionUnits)}`);
console.log(`partition.json: functions=${count(scoped.functions)} semanticEdges=${count(scoped.semanticEdges)} executionUnits=${count(scoped.executionUnits)} loops=${count(scoped.loops)} stateMachines=${count(scoped.stateMachines)} resourceAccesses=${count(scoped.resourceAccesses)} conflictCandidates=${count(scoped.conflictCandidates)} unreached=${count(scoped.reachability?.unreached)}`);
console.log(`extra fields: ${Object.keys(scoped).filter((key) => !["schemaVersion", "project", "partition", "completeness", "files", "dependencyEdges", "dependencyCycles", "functions", "variables", "semanticEdges", "globalVariables", "warnings", "metrics", "engineSchemaVersion"].includes(key)).join(", ")}`);
console.log(`out: ${factsOut}`);
