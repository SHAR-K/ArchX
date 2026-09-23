import { t } from "../../packages/facts-view/src/i18n.mjs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { projectFactsToPartition, type ArchCheckSnapshot, type ArchitecturePartition, type ScopedFactSnapshot } from "../../packages/core/src/index.ts";
import { factsFile as resolveFactsFile, readFacts, writeFacts } from "../../packages/core/src/facts-io.ts";

interface ArchCheckRuntime {
  executable: string;
  prefixArgs: string[];
  env: NodeJS.ProcessEnv;
  description: string;
}

export class ArchCheckService {
  private active: ChildProcessWithoutNullStreams | null = null;
  private selectedKeil: { project: string; target: string } | null = null;

  constructor(private readonly context: vscode.ExtensionContext, private readonly root: string) {}

  async scan(partition: ArchitecturePartition): Promise<ScopedFactSnapshot> {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("ArchCheck is scanning {name}", { name: partition.name }), cancellable: true }, async (progress, token) => {
      progress.report({ message: t("Building whole-repository facts and projecting the current partition") });
      const configuration = vscode.workspace.getConfiguration("archx.archcheck");
      const runtime = this.runtime(configuration);
      progress.report({ message: runtime.description });
      const output = this.outputDirectory(partition.id);
      fs.mkdirSync(output, { recursive: true });
      const args = [...runtime.prefixArgs, this.root, "--json", "--out", output];
      const compileDatabase = [path.join(this.root, "compile_commands.json"), path.join(this.root, "build", "compile_commands.json")].find(fs.existsSync);
      const keil = compileDatabase ? null : await this.resolveKeilInput(partition, configuration);
      if (keil) {
        progress.report({ message: t("Using {project} / {target}", { project: path.relative(this.root, keil.project), target: keil.target }) });
        args.push("--keil-project", keil.project);
        if (keil.target) args.push("--keil-target", keil.target);
      } else if (!compileDatabase) {
        args.push("--source-scan");
      }
      const env = {
        ...process.env,
        ...runtime.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      };
      const snapshot = await this.run(runtime.executable, args, env, token);
      const scoped = projectFactsToPartition(snapshot, partition);
      writeFacts(output, scoped);
      return scoped;
    });
  }

  /** 从任意目录起扫，不需要目标工程里有 ArchX 元数据，也不往目标工程写任何东西。
   *
   * 构建信息决定引擎能看到哪些编译单元，所以扫描根是「往上找到的构建根」而不是所选目录本身：
   * 从所选目录逐级上溯，找 compile_commands.json 或 Keil 工程，最多五级。找不到就退回纯源码扫描。
   * 所选目录变成显示区域，返回值里把两者都说清楚，界面上要标出来，不能悄悄扩大范围。
   */
  async scanFolder(folder: string, token?: vscode.CancellationToken): Promise<{ factsFile: string; buildRoot: string; region: string; basis: string }> {
    const found = this.findBuildRoot(folder);
    const buildRoot = found?.root ?? folder;
    const relative = path.relative(buildRoot, folder).split(path.sep).filter(Boolean).join("/");
    const region = relative ? `${relative}/` : "";
    const key = crypto.createHash("sha256").update(folder.toLowerCase()).digest("hex").slice(0, 16);
    const output = path.join(this.context.globalStorageUri.fsPath, "folder-facts", key);
    fs.mkdirSync(output, { recursive: true });
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("ArchCheck is scanning {name}", { name: path.basename(folder) }), cancellable: true }, async (progress, progressToken) => {
      const configuration = vscode.workspace.getConfiguration("archx.archcheck");
      const runtime = this.runtime(configuration);
      progress.report({ message: found ? `${t("Build information")}: ${found.basis}` : t("No build information; source scan only") });
      const args = [...runtime.prefixArgs, buildRoot, "--json", "--out", output];
      if (found?.kind === "keil") {
        args.push("--keil-project", found.file);
        if (found.target) args.push("--keil-target", found.target);
      } else if (!found) {
        args.push("--source-scan");
      }
      const env = { ...process.env, ...runtime.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
      const snapshot = await this.run(runtime.executable, args, env, token ?? progressToken);
      // 引擎原始快照是下划线命名的全仓事实；投影一次才是各视图和 MCP 共用的分区事实。
      // 这里的「分区」是所选目录本身，不落进任何工程配置，只为这次投影存在。
      const partition: ArchitecturePartition = {
        id: "folder", name: path.basename(folder), focusPaths: [region ? `${region}**` : "**"],
        readContextPaths: [], ownedPaths: [], boundaryDepth: 1, nodeIds: [],
      };
      const scoped = projectFactsToPartition(snapshot, partition);
      const factsFile = writeFacts(output, scoped);
      return { factsFile, buildRoot, region, basis: found ? found.basis : t("source scan, no build information") };
    });
  }

  /** 从 start 逐级上溯找构建信息：本级有 compile_commands.json 就用它，否则在本级子树里找 Keil 工程。
   *  上溯是必要的——引擎要靠构建信息才知道有哪些编译单元，而它常放在被分析目录的上层。
   *  所选目录随后只作为显示区域，界面上会同时标出扫描根和依据，不悄悄扩大范围。 */
  findBuildRoot(start: string, levels = 4): { root: string; kind: "compdb" | "keil"; file: string; target: string; basis: string } | null {
    let current = start;
    for (let i = 0; i <= levels; i += 1) {
      for (const candidate of [path.join(current, "compile_commands.json"), path.join(current, "build", "compile_commands.json")]) {
        if (fs.existsSync(candidate)) return { root: current, kind: "compdb", file: candidate, target: "", basis: `compile_commands.json（${path.relative(current, candidate)}）` };
      }
      const projects = this.findKeilProjects(current);
      if (projects.length > 0) {
        const ranked = projects.map((candidate) => ({ candidate, score: this.keilRelevance(candidate, [path.relative(current, start).split(path.sep).join("/")]) })).sort((a, b) => b.score - a.score);
        const file = ranked[0].candidate;
        const target = this.readKeilTargets(file)[0] ?? "";
        return { root: current, kind: "keil", file, target, basis: `${t("Keil project")} ${path.relative(current, file)}${target ? ` / ${target}` : ""}` };
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  /** 这次分区扫描落盘的事实文件；代码事实面板直接读它做派生。 */
  factsFile(partitionId: string): string {
    return resolveFactsFile(this.outputDirectory(partitionId));
  }

  load(partition: ArchitecturePartition): ScopedFactSnapshot | null {
    const file = resolveFactsFile(this.outputDirectory(partition.id));
    if (!fs.existsSync(file)) return null;
    try {
      const snapshot = readFacts<ScopedFactSnapshot>(file);
      return snapshot.schemaVersion === 1 ? { ...snapshot, partition } : null;
    } catch {
      return null;
    }
  }

  save(partition: ArchitecturePartition, snapshot: ScopedFactSnapshot): void {
    writeFacts(this.outputDirectory(partition.id), { ...snapshot, partition });
  }

  async scanWorktree(partition: ArchitecturePartition, projectRoot: string): Promise<ScopedFactSnapshot> {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("ArchCheck is re-checking {name}", { name: partition.name }), cancellable: true }, async (progress, token) => {
      progress.report({ message: t("Checking architecture rules in an isolated worktree") });
      const configuration = vscode.workspace.getConfiguration("archx.archcheck");
      const runtime = this.runtime(configuration);
      const output = fs.mkdtempSync(path.join(os.tmpdir(), "archx-rescan-"));
      const args = [...runtime.prefixArgs, projectRoot, "--json", "--out", output];
      const compileDatabase = [path.join(projectRoot, "compile_commands.json"), path.join(projectRoot, "build", "compile_commands.json")].find(fs.existsSync);
      if (!compileDatabase) args.push("--source-scan");
      const env = {
        ...process.env,
        ...runtime.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      };
      try {
        return projectFactsToPartition(await this.run(runtime.executable, args, env, token), partition);
      } finally {
        fs.rmSync(output, { recursive: true, force: true });
      }
    });
  }

  cancel(): void {
    this.active?.kill();
  }

  private runtime(configuration: vscode.WorkspaceConfiguration): ArchCheckRuntime {
    const configured = configuration.get<string>("enginePath")?.trim();
    const python = configuration.get<string>("pythonPath") || "python";
    if (configured) {
      const resolved = path.resolve(configured);
      const configuredExecutable = fs.existsSync(resolved) && fs.statSync(resolved).isFile()
        ? resolved
        : [path.join(resolved, this.platformDirectory(), this.executableName()), path.join(resolved, this.executableName())].find(fs.existsSync);
      if (configuredExecutable) return { executable: configuredExecutable, prefixArgs: [], env: {}, description: t("Using the user-configured standalone ArchCheck engine") };
      if (fs.existsSync(path.join(resolved, "src", "archcheck", "__init__.py"))) return this.pythonRuntime(resolved, python, t("Using the user-configured ArchCheck Python engine"));
    }

    const bundled = path.join(this.context.extensionPath, "engines", this.platformDirectory(), this.executableName());
    if (fs.existsSync(bundled)) return { executable: bundled, prefixArgs: [], env: {}, description: t("Using the ArchCheck engine bundled in the VSIX") };

    const sourceCandidates = [
      path.resolve(this.context.extensionPath, "..", "..", "..", "archcheck"),
      path.join(os.homedir(), "Desktop", "archcheck"),
    ];
    const source = sourceCandidates.find((candidate) => fs.existsSync(path.join(candidate, "src", "archcheck", "__init__.py")));
    if (source) return this.pythonRuntime(source, python, t("Using the development-environment ArchCheck Python engine"));
    throw new Error(t("No bundled ArchCheck engine is available for this platform ({platform}). Install the ArchX build for your platform, or set archx.archcheck.enginePath.", { platform: this.platformDirectory() }));
  }

  private pythonRuntime(engineRoot: string, python: string, description: string): ArchCheckRuntime {
    return {
      executable: python,
      prefixArgs: ["-m", "archcheck"],
      env: { PYTHONPATH: [path.join(engineRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
      description,
    };
  }

  private platformDirectory(): string {
    return `${process.platform}-${process.arch}`;
  }

  private executableName(): string {
    return process.platform === "win32" ? "archcheck.exe" : "archcheck";
  }

  private outputDirectory(partitionId: string): string {
    const projectKey = crypto.createHash("sha256").update(this.root.toLowerCase()).digest("hex").slice(0, 16);
    return path.join(this.context.globalStorageUri.fsPath, "facts", projectKey, partitionId);
  }

  private async resolveKeilInput(partition: ArchitecturePartition, configuration: vscode.WorkspaceConfiguration): Promise<{ project: string; target: string } | null> {
    const configuredProject = configuration.get<string>("keilProject") || "";
    const configuredTarget = configuration.get<string>("keilTarget") || "";
    if (configuredProject) return { project: path.resolve(this.root, configuredProject), target: configuredTarget };
    if (this.selectedKeil) return this.selectedKeil;

    const projects = this.findKeilProjects(this.root);
    if (projects.length === 0) return null;
    let project = projects[0];
    if (projects.length > 1) {
      const ranked = projects
        .map((candidate) => ({ candidate, score: this.keilRelevance(candidate, partition.focusPaths) }))
        .sort((left, right) => right.score - left.score);
      if (ranked[0].score > ranked[1].score) project = ranked[0].candidate;
      else {
        const selected = await vscode.window.showQuickPick(
          projects.map((candidate) => ({ label: path.relative(this.root, candidate), candidate })),
          { title: t("Choose the Keil project for scanning {name}", { name: partition.name }), ignoreFocusOut: true },
        );
        if (!selected) throw new Error(t("Keil project selection cancelled"));
        project = selected.candidate;
      }
    }

    const targets = this.readKeilTargets(project);
    let target = targets[0] ?? "";
    if (targets.length > 1) {
      const selected = await vscode.window.showQuickPick(targets, { title: t("Choose the Keil target"), ignoreFocusOut: true });
      if (!selected) throw new Error(t("Keil target selection cancelled"));
      target = selected;
    }
    this.selectedKeil = { project, target };
    return this.selectedKeil;
  }

  private findKeilProjects(directory: string): string[] {
    const ignored = new Set([".git", "build", "Listings", "node_modules", "Objects", "output"]);
    const matches: string[] = [];
    const visit = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name)) visit(path.join(current, entry.name));
        } else if (entry.name.toLowerCase().endsWith(".uvprojx")) matches.push(path.join(current, entry.name));
      }
    };
    visit(directory);
    return matches.sort((left, right) => left.localeCompare(right));
  }

  private readKeilTargets(project: string): string[] {
    const xml = fs.readFileSync(project, "utf8");
    return [...xml.matchAll(/<TargetName>\s*([^<]+?)\s*<\/TargetName>/gi)].map((match) => match[1].trim());
  }

  private keilRelevance(project: string, focusPaths: string[]): number {
    const projectParts = path.relative(this.root, path.dirname(project)).replaceAll("\\", "/").split("/");
    return Math.max(0, ...focusPaths.map((focus) => {
      const focusParts = focus.replaceAll("\\", "/").split("/").filter((part) => part && !part.includes("*"));
      let common = 0;
      while (common < projectParts.length && common < focusParts.length && projectParts[common].toLowerCase() === focusParts[common].toLowerCase()) common += 1;
      return common;
    }));
  }

  private run(executable: string, args: string[], env: NodeJS.ProcessEnv, token: vscode.CancellationToken): Promise<ArchCheckSnapshot> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: this.root, env, shell: false, windowsHide: true });
      this.active = child;
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      const cancellation = token.onCancellationRequested(() => child.kill());
      child.on("error", reject);
      child.on("close", (code) => {
        cancellation.dispose();
        this.active = null;
        if (code !== 0) reject(new Error(stderr.trim() || t("ArchCheck exited with status {code}", { code })));
        else {
          try { resolve(JSON.parse(stdout) as ArchCheckSnapshot); }
          catch (error) { reject(new Error(`${t("ArchCheck output is not valid JSON")}: ${error instanceof Error ? error.message : String(error)}`)); }
        }
      });
    });
  }
}
