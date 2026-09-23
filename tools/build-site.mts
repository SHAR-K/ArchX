// 静态演示页的数据：把已扫出的事实切成分区、投影成视图，gzip 后放进 site/public/data/。
//
// 只做这一步，不重扫。事实来自 work/corpus-scan/<id>/architecture.json（或 ARCHX_SCAN_DIR），
// 源码一律不入库——corpus/external.yaml 说了为什么。产物是派生元数据，每处出处都链回原仓库的那个 commit。
//
// 页面里再由 derivePayload 算主题（和插件宿主同一份代码），所以这里只存投影，不存主题：
// 主题一改，重新 build 页面就行，数据文件不用动。
//
// 用法：node --experimental-strip-types tools/build-site.mts

import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { buildFactsView } from "../packages/facts-view/src/projection.mjs";
import { createPartition, projectFactsToPartition } from "../packages/core/src/index.ts";

interface SiteProject {
  id: string;
  title: string;
  repo: string;
  commit: string;
  license: string;
  kind: "bare-metal" | "freertos";
  blurb: string;
  facts: string;
  focus: string[];
  region: string;
  build: string;
}

const PROJECTS: SiteProject[] = [
  {
    id: "hoverboard-foc",
    title: "hoverboard-firmware-hack-FOC",
    repo: "https://github.com/EFeru/hoverboard-firmware-hack-FOC",
    commit: "4f141cbc97b297e194fd58e56444bd0322f902ac",
    license: "GPL-3.0",
    kind: "bare-metal",
    blurb: "Bare-metal STM32F103 motor FOC. The control loop runs in the ADC-DMA interrupt, the super-loop in main changes targets; every conflict candidate is interrupt ↔ main.",
    facts: "hoverboard-foc-pio/architecture.json",
    focus: ["**"],
    region: "",
    build: "pio run -e VARIANT_ADC -t compiledb",
  },
  {
    id: "stm32h743",
    title: "STM32H743-CMake-Template",
    repo: "https://github.com/Mythologyli/STM32H743-CMake-Template",
    commit: "4542a412783c8f21fb49dc80030c5a1c52af0209",
    license: "GPL-3.0",
    kind: "freertos",
    blurb: "FreeRTOS on a Cortex-M7: 3 tasks, 14 interrupts, a software timer and a CLI. Shown as one partition — Core, Applications, the CLI and the kernel — the way you would scan a folder of it; LVGL and the HAL stay outside.",
    facts: "stm32h743/architecture.json",
    focus: ["Core/**", "Applications/**", "Libraries/FreeRTOS-Plus-CLI/**", "Middlewares/Third_Party/**"],
    region: "",
    build: "cmake -S . -B build -G Ninja -DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
  },
];

const root = process.cwd();
const scanDir = process.env.ARCHX_SCAN_DIR ?? path.join(root, "work", "corpus-scan");
const outDir = path.join(root, "site", "public", "data");
fs.mkdirSync(outDir, { recursive: true });

const engineCommit = (() => {
  try { return execSync("git log -1 --format=%h -- engine/src", { cwd: root, encoding: "utf8" }).trim(); } catch { return ""; }
})();

const manifest = { generatedAt: new Date().toISOString().slice(0, 10), engineCommit, projects: [] as Array<Record<string, unknown>> };
for (const p of PROJECTS) {
  const file = path.join(scanDir, p.facts);
  if (!fs.existsSync(file)) { console.error(`缺事实文件：${file}（先按 corpus/external.yaml 的 compile_db 扫一遍，或设 ARCHX_SCAN_DIR）`); process.exit(1); }
  const snapshotFacts = JSON.parse(fs.readFileSync(file, "utf8"));
  // 扫描时的绝对路径会带出本机用户名；页面是公开的，只留仓库地址
  snapshotFacts.project = `${p.repo}@${p.commit.slice(0, 7)}`;
  const scoped = projectFactsToPartition(snapshotFacts, createPartition({ name: p.id, focusPaths: p.focus }));
  const canonical = JSON.stringify(scoped);
  // 快照 ID 和宿主同一口径：事实内容的 sha256 前 12 位
  const snapshot = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  const view = buildFactsView(scoped, p.region, { source: `${p.repo}@${p.commit.slice(0, 7)}`, generatedAt: "1970-01-01T00:00:00.000Z" }) as Record<string, any>;
  const json = JSON.stringify(view);
  const gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(path.join(outDir, `${p.id}.json.gz`), gz);
  const units = (view.entries?.units ?? []) as Array<{ kind: string }>;
  const byKind: Record<string, number> = {};
  for (const u of units) byKind[u.kind] = (byKind[u.kind] ?? 0) + 1;
  manifest.projects.push({
    id: p.id, title: p.title, repo: p.repo, commit: p.commit, license: p.license, kind: p.kind, blurb: p.blurb, build: p.build,
    focus: p.focus, region: p.region, snapshot,
    counts: { files: view.files.length, functions: view.functions.length, units: byKind, sharedResources: view.ast?.sharedResources?.length ?? 0, conflictCandidates: view.ast?.conflictCandidates?.length ?? 0 },
  });
  console.log(`${p.id}: view ${(json.length / 1e6).toFixed(2)} MB → ${(gz.length / 1e6).toFixed(2)} MB gz · ${view.files.length} files · ${view.functions.length} functions · snapshot ${snapshot}`);
}
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${manifest.projects.length} projects · engine ${engineCommit}`);
