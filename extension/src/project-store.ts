import { t } from "../../packages/facts-view/src/i18n.mjs";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { createDefaultProject, createPartition, normalizeProject, type ArchitecturePartition, type ProjectSpec } from "../../packages/core/src/index.ts";

/** 项目定义的读写。分区是「这次分析看哪一片代码」的范围，是新方向唯一还需要的项目状态。
 *  提案、审批、检查点、变更单随旧模型一起删了。 */
export class ProjectStore {
  private readonly changedEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changedEmitter.event;

  constructor(readonly root: string) {}

  get file(): string {
    return path.join(this.root, ".archx", "project.json");
  }

  initialized(): boolean {
    return fs.existsSync(this.file);
  }

  async initialize(): Promise<ProjectSpec | null> {
    const name = await vscode.window.showInputBox({ title: t("Initialize ArchX"), prompt: t("Project name"), value: path.basename(this.root), ignoreFocusOut: true });
    if (!name?.trim()) return null;
    const summary = await vscode.window.showInputBox({ title: t("Initialize ArchX"), prompt: t("What problem does the product solve?"), ignoreFocusOut: true });
    if (!summary?.trim()) return null;
    const spec = createDefaultProject(name.trim());
    spec.project.summary = summary.trim();
    await this.save(spec);
    return spec;
  }

  load(): ProjectSpec {
    if (!this.initialized()) throw new Error(t("ArchX is not initialized in this workspace"));
    return normalizeProject(JSON.parse(fs.readFileSync(this.file, "utf8")) as ProjectSpec);
  }

  async save(spec: ProjectSpec): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(normalizeProject(spec), null, 2)}\n`, "utf8");
    this.changedEmitter.fire();
  }

  async addPartition(folder?: vscode.Uri): Promise<ArchitecturePartition | null> {
    if (!this.initialized() && !(await this.initialize())) return null;
    let target = folder;
    if (!target) {
      const selected = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: vscode.Uri.file(this.root), openLabel: t("Choose the partition folder") });
      target = selected?.[0];
    }
    if (!target) return null;
    const relative = path.relative(this.root, target.fsPath).replaceAll("\\", "/");
    if (!relative || relative.startsWith("..")) throw new Error(t("The partition must be inside the current VS Code workspace"));
    const name = await vscode.window.showInputBox({ title: t("Create an architecture partition"), prompt: t("Partition name"), value: path.basename(target.fsPath), ignoreFocusOut: true });
    if (!name?.trim()) return null;
    const spec = this.load();
    const partition = createPartition({ name: name.trim(), focusPaths: [`${relative}/**`] });
    if (spec.partitions.some((item) => item.id === partition.id)) throw new Error(t("A partition with id {id} already exists", { id: partition.id }));
    spec.partitions.push(partition);
    await this.save(spec);
    return partition;
  }
}
