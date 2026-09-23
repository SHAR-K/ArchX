// scan_project：终端里对 agent 说一句「扫描这个工程」就能跑完，不经过 VS Code。
//
// 形态是 Linker 定的：ArchCheck 主要给 AI 调用，插件只是一种视图。所以扫描必须能由 MCP 自己发起。
// 工具不替用户跑构建、不下载东西：前提缺了，就返回「缺什么 + 这个工程该跑哪条命令」，让 agent 在
// 用户终端里执行后再调一次。前提齐了就调引擎、写事实、写指针——之后 list/read 工具读的就是这一份。
//
// 找引擎的顺序：ARCHX_ENGINE → 插件激活时登记的位置（engine.json）→ 相对本脚本的 VSIX 自带引擎
//   → PATH 上的 archcheck → python -m archcheck。
// 找 clangd 的顺序：ARCHX_CLANGD / CLANGD_PATH → PATH。用户指定的路径永远优先。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
const platformDirectory = () => `${process.platform}-${process.arch}`;

function onPath(name) {
  const dirs = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of process.platform === "win32" ? [exe(name), `${name}.cmd`, `${name}.bat`] : [name]) {
      const full = path.join(dir, candidate);
      try { if (fs.statSync(full).isFile()) return full; } catch { /* 下一个 */ }
    }
  }
  return null;
}

function engineFromSource(dir, python) {
  if (!fs.existsSync(path.join(dir, "src", "archcheck", "__init__.py"))) return null;
  return { executable: python, prefixArgs: ["-m", "archcheck"], env: { PYTHONPATH: [path.join(dir, "src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) }, description: `ArchCheck Python engine at ${dir}` };
}

export function findEngine(stateDir) {
  const python = process.env.ARCHX_PYTHON || "python";
  const configured = process.env.ARCHX_ENGINE?.trim();
  if (configured) {
    const p = path.resolve(configured);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return { executable: p, prefixArgs: [], env: {}, description: `ArchCheck engine from ARCHX_ENGINE (${p})` };
    const src = engineFromSource(p, python);
    if (src) return src;
  }
  try {
    const registered = JSON.parse(fs.readFileSync(path.join(stateDir, "engine.json"), "utf8"));
    if (registered?.executable && fs.existsSync(registered.executable)) return { executable: registered.executable, prefixArgs: registered.prefixArgs ?? [], env: registered.env ?? {}, description: `ArchCheck engine registered by the VS Code extension (${registered.executable})` };
  } catch { /* 没装插件，或者还没激活过 */ }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // server/ → archx/ → plugins/ → claude-marketplace/ → 扩展根
    const bundled = path.resolve(here, "..", "..", "..", "..", "engines", platformDirectory(), exe("archcheck"));
    if (fs.existsSync(bundled)) return { executable: bundled, prefixArgs: [], env: {}, description: `ArchCheck engine bundled with the extension (${bundled})` };
  } catch { /* 打包环境里 import.meta.url 取不到时跳过 */ }
  const cli = onPath("archcheck");
  if (cli) return { executable: cli, prefixArgs: [], env: {}, description: `archcheck on PATH (${cli})` };
  const probe = spawnSync(python, ["-c", "import archcheck"], { encoding: "utf8" });
  if (probe.status === 0) return { executable: python, prefixArgs: ["-m", "archcheck"], env: {}, description: `python -m archcheck (${python})` };
  return null;
}

export function findClangd() {
  for (const key of ["ARCHX_CLANGD", "CLANGD_PATH"]) {
    const value = process.env[key]?.trim();
    if (value && fs.existsSync(value)) return { path: path.resolve(value), from: key };
  }
  const found = onPath("clangd");
  return found ? { path: found, from: "PATH" } : null;
}

const SKIP = new Set([".git", "node_modules", ".pio", "build", "out", "Objects", "Listings", "output", ".vscode"]);
function findFiles(root, test, depth = 4) {
  const hits = [];
  const walk = (dir, d) => {
    if (d > depth || hits.length > 20) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), d + 1); }
      else if (test(e.name)) hits.push(path.join(dir, e.name));
    }
  };
  walk(root, 0);
  return hits;
}

/** 这个工程的构建信息在哪；没有的话，按它的构建系统给出生成命令 */
export function buildInformation(folder) {
  const dbs = [path.join(folder, "compile_commands.json"), path.join(folder, "build", "compile_commands.json")].filter((p) => fs.existsSync(p));
  if (dbs.length) return { kind: "compile-commands", path: dbs[0] };
  const keil = findFiles(folder, (n) => n.toLowerCase().endsWith(".uvprojx"));
  if (keil.length) return { kind: "keil", path: keil[0], others: keil.slice(1) };
  const has = (name) => fs.existsSync(path.join(folder, name));
  const suggestions = [];
  if (has("platformio.ini")) suggestions.push({ system: "PlatformIO", command: "pio run -t compiledb", note: "writes compile_commands.json in the project root; add -e <env> to pick an environment" });
  if (has("CMakeLists.txt")) suggestions.push({ system: "CMake", command: "cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON", note: "writes build/compile_commands.json; add your usual toolchain / generator options" });
  if (has("Makefile") || has("makefile")) suggestions.push({ system: "Make", command: "bear -- make", note: "needs bear (https://github.com/rizsotto/Bear); writes compile_commands.json" });
  if (has("west.yml") || fs.existsSync(path.join(folder, "prj.conf"))) suggestions.push({ system: "Zephyr", command: "west build -- -DCMAKE_EXPORT_COMPILE_COMMANDS=ON", note: "writes build/compile_commands.json" });
  if (has("sdkconfig") || has("idf_component.yml")) suggestions.push({ system: "ESP-IDF", command: "idf.py build", note: "ESP-IDF writes build/compile_commands.json by default" });
  return { kind: "missing", suggestions };
}

const CLANGD_HINTS = {
  win32: "winget install LLVM.LLVM   (then reopen the terminal so clangd is on PATH)",
  darwin: "brew install llvm   (clangd is in $(brew --prefix llvm)/bin)",
  linux: "sudo apt install clangd   (or your distribution's clangd / clang-tools package)",
};

/**
 * 跑一次扫描。prereq 缺了返回 { status: "needs-…" }，齐了返回 { status: "scanned", factsFile, … }。
 * sourceScanOnly：用户明确接受「没有构建信息、只看文件和依赖」时才传。
 */
export function scanProject({ folder, stateDir, outDir, sourceScanOnly = false }) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return { status: "error", message: `Not a directory: ${folder}` };
  const engine = findEngine(stateDir);
  if (!engine) {
    return {
      status: "needs-engine",
      message: "No ArchCheck engine found.",
      fix: ['pip install "git+https://github.com/SHAR-K/ArchX#subdirectory=engine"   (puts archcheck on PATH; needs Python 3.10+ and git)', "or set ARCHX_ENGINE to an archcheck executable / engine source directory", "or install the ArchX VS Code extension (it bundles the engine and registers it on activation)"],
    };
  }
  const build = buildInformation(folder);
  const clangd = findClangd();
  if (!clangd && !sourceScanOnly) {
    return {
      status: "needs-clangd",
      message: "clangd is not installed or not on PATH. Without it only files and include dependencies can be read — no execution units, loops, state machines or concurrency.",
      install: CLANGD_HINTS[process.platform] ?? CLANGD_HINTS.linux,
      orPoint: "Set ARCHX_CLANGD to an existing clangd executable if it is installed somewhere else.",
      then: "Call scan_project again. Pass sourceScanOnly: true only if the user accepts a files-and-dependencies-only scan.",
    };
  }
  if (build.kind === "missing" && !sourceScanOnly) {
    return {
      status: "needs-build-info",
      message: "No compile_commands.json or Keil project found. The engine reads what actually compiles; without build information it can only list files.",
      runInProjectRoot: build.suggestions,
      then: build.suggestions.length
        ? "Run the matching command in the user's terminal (it uses the project's own build environment), then call scan_project again."
        : "No known build system detected. Ask the user how the firmware is built, or pass sourceScanOnly: true for a files-and-dependencies-only scan.",
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const args = [...engine.prefixArgs, folder, "--out", outDir];
  if (build.kind === "compile-commands") args.push("--compile-commands", build.path);
  else if (build.kind === "keil") args.push("--keil-project", build.path);
  else args.push("--source-scan");
  const env = { ...process.env, ...engine.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...(clangd ? { CLANGD_PATH: clangd.path, PATH: [path.dirname(clangd.path), process.env.PATH].filter(Boolean).join(path.delimiter) } : {}) };
  const started = Date.now();
  const run = spawnSync(engine.executable, args, { env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  const factsFile = path.join(outDir, "architecture.json");
  if (run.status !== 0 || !fs.existsSync(factsFile)) {
    return { status: "error", message: `The engine failed (exit ${run.status}).`, engine: engine.description, stderr: String(run.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-15) };
  }
  return {
    status: "scanned",
    factsFile,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    engine: engine.description,
    clangd: clangd ? `${clangd.path} (${clangd.from})` : null,
    buildInformation: build.kind === "missing" ? "none (source scan)" : `${build.kind}: ${path.relative(folder, build.path) || build.path}`,
    otherKeilProjects: build.others?.length ? build.others.map((p) => path.relative(folder, p)) : undefined,
  };
}
