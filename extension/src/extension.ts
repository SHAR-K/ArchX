// 插件宿主。
//
// 只做一件事：跟 Agent 说扫描仓库，然后在面板里看到代码事实。
//
// 三条入口，都通向同一个面板：命令面板里选分区扫、在资源管理器里对着目录扫、
// 或者 Agent 通过 MCP 写一个视图请求让这里显示。三条走的是同一份派生，
// 所以人看到的和 Agent 读到的必然是同一个快照。
//
// 旧的那套（画布、目标架构树、提案审批、受约束执行）已经删了。分区这个概念留着，
// 它是「这次分析看哪一片代码」的范围，新旧都要。

import { setLocale, t } from "../../packages/facts-view/src/i18n.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import type { ArchitecturePartition } from "../../packages/core/src/index.ts";
import { publishFactsPointer } from "../../packages/core/src/facts-pointer.ts";
import type { Declarations } from "../../packages/facts-view/src/deps/model.d.mts";
import { ArchCheckService } from "./archcheck-service.ts";
import { ClaudePluginInstaller } from "./claude-plugin.ts";
import { FactsPanel, FactsSideProvider, NO_DECLARATIONS, deriveFacts } from "./facts-panel.ts";
import { ProjectStore } from "./project-store.ts";
import { PartitionProvider } from "./providers.ts";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 对外文字的语言跟 VS Code 走；派生层的句子在宿主里算，所以要在任何派生之前定好
  setLocale(vscode.env.language);
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const root = folder.uri.fsPath;

  const store = new ProjectStore(root);
  const partitions = new PartitionProvider(() => (store.initialized() ? store.load() : null));
  const scanner = new ArchCheckService(context, root);
  const claudePlugin = new ClaudePluginInstaller(context);


  const refresh = async (): Promise<void> => {
    partitions.refresh();
  };

  const initialize = async () => {
    if (store.initialized()) return store.load();
    const spec = await store.initialize();
    if (spec) {
      await refresh();
      void vscode.window.showInformationMessage(t("ArchX initialized; only project.json under the project was written"));
    }
    return spec;
  };

  const choosePartition = async (value?: ArchitecturePartition): Promise<ArchitecturePartition | null> => {
    const spec = await initialize();
    if (!spec) return null;
    if (value?.focusPaths) return value;
    if (spec.partitions.length === 1) return spec.partitions[0];
    const picked = await vscode.window.showQuickPick(
      spec.partitions.map((item) => ({ label: item.name, description: item.focusPaths.join(", "), item })),
      { title: t("Choose the architecture partition to analyze") },
    );
    return picked?.item ?? null;
  };

  const scan = async (value?: ArchitecturePartition): Promise<void> => {
    const partition = await choosePartition(value);
    if (!partition) {
      void vscode.window.showWarningMessage(t("Create an architecture partition first"));
      return;
    }
    try {
      const scanned = await scanner.scan(partition);
      await refresh();
      if (FactsPanel.current) await showFacts(partition);
      void vscode.window.showInformationMessage(t("ArchCheck projected {name}: {n} related files", { name: partition.name, n: scanned.files.length }));
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  // 声明是人的假设（钉住的行、打算反转的边、簇的名字），不是事实。宿主负责存，
  // 派生层只接收，从不自己读存储——否则同一份事实在两处会派生出不同的东西。
  const declarationsFile = (partitionId: string): string => path.join(root, ".arc" + "hx", "declarations", `${partitionId}.json`);

  const loadDeclarations = (partitionId: string): Declarations => {
    try { return { ...NO_DECLARATIONS, ...JSON.parse(fs.readFileSync(declarationsFile(partitionId), "utf8")) }; }
    catch { return NO_DECLARATIONS; }
  };

  const saveDeclarations = (partitionId: string, declarations: Declarations): void => {
    const file = declarationsFile(partitionId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(declarations, null, 2)}\n`, "utf8");
  };

  // 分区的 focusPaths 是通配符，投影要的是一个前缀
  const regionOf = (partition: ArchitecturePartition): string => {
    const first = (partition.focusPaths ?? [])[0] ?? "";
    const prefix = first.replaceAll("\\", "/").split(/[?*[\]]/, 1)[0].replace(/\/+$/, "");
    return prefix ? `${prefix}/` : "";
  };

  const showFacts = async (value?: ArchitecturePartition): Promise<void> => {
    const partition = await choosePartition(value);
    if (!partition) {
      void vscode.window.showWarningMessage(t("Create an architecture partition first"));
      return;
    }
    const panel = FactsPanel.show(context, root);
    void vscode.commands.executeCommand("archx.factsSide.focus");
    const file = scanner.factsFile(partition.id);
    if (!fs.existsSync(file)) {
      panel.setStatus(t("This partition has not been scanned yet; scanning…"));
      await scan(partition);
    }
    if (!fs.existsSync(file)) {
      panel.setStatus(t("The scan produced no facts file"));
      return;
    }
    try {
      const derived = deriveFacts(file, root, regionOf(partition), { declarations: loadDeclarations(partition.id) });
      panel.onDeclare = (declarations) => saveDeclarations(partition.id, declarations);
      panel.setFacts(derived.payload, derived.view);
      // 告诉 MCP 这份事实在哪：Agent 读到的和人在面板上看到的必须是同一个快照
      publishFactsPointer(root, { factsFile: file, region: regionOf(partition), projectRoot: root, snapshot: derived.payload.snapshot, label: partition.name });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      panel.setStatus(`${t("Derivation failed")}: ${text}`);
      void vscode.window.showErrorMessage(`${t("Code-facts derivation failed")}: ${text}`);
    }
  };

  // 扫任意目录：不需要目标工程里有 ArchX 元数据，也不往它写任何东西。
  // 打开一个陌生仓库、扫一次、就能看，这是新方向要求的入口。
  const showFolderFacts = async (uri?: vscode.Uri): Promise<void> => {
    const picked = uri ?? (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: t("Analyze this folder") }))?.[0];
    if (!picked) return;
    const target = picked.fsPath;
    const panel = FactsPanel.show(context, target);
    void vscode.commands.executeCommand("archx.factsSide.focus");
    panel.setStatus(t("Scanning {target}…", { target }));
    try {
      const result = await scanner.scanFolder(target);
      // 扫任意目录时不往目标写声明：那会改动一个只被分析的工程
      const derived = deriveFacts(result.factsFile, result.buildRoot, result.region);
      panel.onDeclare = null;
      panel.setFacts({
        ...derived.payload,
        // 扫描根可能在所选目录之上（构建信息在那儿），两者都要显示，不能悄悄扩大范围
        scope: { folder: target, buildRoot: result.buildRoot, basis: result.basis },
      }, derived.view);
      publishFactsPointer(root, { factsFile: result.factsFile, region: result.region, projectRoot: result.buildRoot, snapshot: derived.payload.snapshot, label: path.basename(target) });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      panel.setStatus(`${t("Scan failed")}: ${text}`);
      void vscode.window.showErrorMessage(`${t("Scanning {target} failed", { target })}: ${text}`);
    }
  };

  // Agent 的视图请求：MCP 写文件，这里监听。宿主写事实指针给 MCP 读是另一条，两条对称。
  const viewRequestFile = (): string => {
    const base = process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "ArchX")
      : path.join(os.homedir(), ".local", "state", "archx");
    const key = crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 20);
    return path.join(base, "view-requests", `${key}.json`);
  };

  let lastViewSeq = 0;
  const applyViewRequest = async (): Promise<void> => {
    const file = viewRequestFile();
    if (!fs.existsSync(file)) return;
    let request: { seq?: number; kind?: string; folder?: string | null; scan?: boolean; id?: string };
    try { request = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return; }
    const seq = Number(request.seq ?? 0);
    if (!seq || seq <= lastViewSeq) return;
    lastViewSeq = seq;
    if (request.kind === "focus" && request.id) { FactsPanel.current?.select(request.id); return; }
    if (request.kind !== "show") return;
    if (request.folder) { await showFolderFacts(vscode.Uri.file(request.folder)); return; }
    const partition = await choosePartition();
    if (!partition) return;
    if (request.scan) await scan(partition);
    await showFacts(partition);
  };

  // 监听共享目录里由别的进程写的文件，事件会丢，所以再加一个轮询兜底
  fs.mkdirSync(path.dirname(viewRequestFile()), { recursive: true });
  const requestWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(viewRequestFile())), "*.json"));
  requestWatcher.onDidChange(() => void applyViewRequest());
  requestWatcher.onDidCreate(() => void applyViewRequest());
  const requestPoll = setInterval(() => void applyViewRequest(), 2000);
  try { lastViewSeq = JSON.parse(fs.readFileSync(viewRequestFile(), "utf8")).seq ?? 0; } catch { lastViewSeq = 0; }

  context.subscriptions.push(
    requestWatcher,
    new vscode.Disposable(() => clearInterval(requestPoll)),
    claudePlugin,
    vscode.window.registerTreeDataProvider("archx.partitions", partitions),
    // 侧栏视图：主题导航、本主题可选的对象、检查面板。舞台面板只剩对象本身
    vscode.window.registerWebviewViewProvider(FactsSideProvider.viewType, new FactsSideProvider(context), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("archx.initialize", initialize),
    vscode.commands.registerCommand("archx.addPartition", async () => {
      const item = await store.addPartition();
      if (item) await refresh();
    }),
    vscode.commands.registerCommand("archx.addPartitionFromFolder", async (uri: vscode.Uri) => {
      const item = await store.addPartition(uri);
      if (item) await refresh();
    }),
    vscode.commands.registerCommand("archx.scanPartition", scan),
    vscode.commands.registerCommand("archx.openFacts", showFacts),
    vscode.commands.registerCommand("archx.openFolderFacts", showFolderFacts),
    vscode.commands.registerCommand("archx.applyViewRequest", applyViewRequest),
    vscode.commands.registerCommand("archx.refresh", refresh),
    vscode.commands.registerCommand("archx.installClaudeWorkflow", async () => {
      try { await claudePlugin.install(); }
      catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
    }),
    store.onDidChange(() => void refresh()),
    { dispose: () => scanner.cancel() },
  );
}

export function deactivate(): void {}
