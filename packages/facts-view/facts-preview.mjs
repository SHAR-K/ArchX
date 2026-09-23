// 把 ArchCheck 分区事实（partition.json）解析成"当前架构"预览：目录分组、声明层序、聚合带权边、反向/越层/循环标记、函数级明细。
// 用法：node packages/facts-view/facts-preview.mjs [partition.json] [--region src/app/] [--out work/facts-preview/x.html]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFactsView } from "./src/projection.mjs";

// 资源相对脚本自身定位，从任何工作目录调用都成立
const here = import.meta.dirname;
const repoRoot = path.resolve(here, "..", "..");

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const positional = args.filter((item, index) => !item.startsWith("--") && (index === 0 || !args[index - 1].startsWith("--")));
const defaultFacts = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData/Roaming"), "Code/User/globalStorage/archx-local.archx/facts/d4a7cc902cf13e68/application/partition.json");
const factsFile = positional[0] ?? defaultFacts;
const region = option("--region", "src/").replaceAll("\\", "/").replace(/\/?$/, "/");
const outFile = option("--out", path.resolve("work/facts-preview", `${path.basename(path.dirname(factsFile))}.html`));


const facts = JSON.parse(fs.readFileSync(factsFile, "utf8"));

// 投影层在 src/projection.mjs：页面、扩展 webview 和 MCP 共用同一份，
// 这个脚本只剩「读参数 → 投影 → 拼 HTML → 打印摘要」。
const data = buildFactsView(facts, region, { source: factsFile });
const { entries, ast, includeEdges, callPairs, globals, cycles, contractBypass, coverage } = data;
const { duplicates, externDeclarations, main: mainFn } = entries;

// 页签源码懒拆：preview/ 下一个页签一个 .js（连同它自己的 .css），按文件名顺序拼进模板的槽位。
// 拼接而不是 import——预览是 file:// 直接打开的，ES module 会被 CORS 拒；拼接后所有片和模板同一个作用域，
// 共享的 F/A/E 与 helper 一行都不用改。
const partsDir = path.join(here, "preview");
const parts = (extension) => (fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter((name) => name.endsWith(extension)).sort() : []);
const readParts = (extension) => parts(extension).map((name) => `${extension === ".css" ? "/* " : "// "}${name}${extension === ".css" ? " */" : ""}\n${fs.readFileSync(path.join(partsDir, name), "utf8")}`).join("\n");
const template = fs.readFileSync(path.join(here, "facts-preview.template.html"), "utf8")
  .replace(/^ *\/\* parts:css.*\*\/$/m, () => readParts(".css"))
  .replace(/^ *\/\/ parts:js.*$/m, () => readParts(".js"));
// 内嵌的第三方布局库（dagre：dot 算法的 JS 移植），不走网络；插件侧同一套库
const vendor = ["dagre.min.js"].map((name) => fs.readFileSync(path.join(repoRoot, "tools/vendor", name), "utf8")).join(";");
const html = template.replace("/*__VENDOR__*/", () => vendor).replace("/*__DATA__*/", () => `window.__FACTS__ = ${JSON.stringify(data)};`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html, "utf8");

const internal = data.modules.filter((module) => !module.external);
console.log(`facts: ${factsFile}`);
console.log(`modules: ${internal.length} internal + ${data.modules.length - internal.length} boundary; files: ${data.files.length}; functions: ${data.functions.length}; include edges: ${includeEdges.length}; calls: ${callPairs.length}; cross-file globals: ${globals.length}; cycles: ${cycles.length}`);
for (const module of internal.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) console.log(`  L${module.rank ?? "-"} ${module.layerName.padEnd(10)} ${module.id.padEnd(28)} ${String(module.files.length).padStart(3)} files`);
console.log(`entries: main=${mainFn ? "yes" : "no"} isr=${entries.counts.isrs}(+${entries.counts.kernel} kernel) tasks=${entries.counts.tasks} handlers=${entries.counts.handlers} unreached=${entries.counts.unreached}/${entries.counts.functions} boot-only=${entries.counts.bootOnly} isr-only=${entries.counts.isrOnly} mixed=${entries.counts.mixed} duplicates=${duplicates.length} extern-direct=${externDeclarations.length} bypass=${contractBypass.length} coverage=${coverage ? `${coverage.regionAnalyzed} analyzed, ${coverage.regionExcluded.length} excluded in region` : "n/a"}`);
if (ast.present) console.log(`ast: loops=${ast.loops.length} stateMachines=${ast.stateMachines.length} resourceAccesses=${ast.resourceAccesses.length} criticalSections=${ast.criticalSections.length} runModes=${Object.keys(ast.runModes).length} sharedResources=${ast.sharedResources.length} conflictCandidates=${ast.conflictCandidates.length} (high ${ast.conflictCandidates.filter((c) => c.confidence === "high").length})`);
else console.log("ast: 事实里没有 AST 层字段（需要 ArchCheck ≥ 0.3.0）");
console.log(`preview: ${outFile} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
