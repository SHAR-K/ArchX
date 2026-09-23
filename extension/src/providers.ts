import { t } from "../../packages/facts-view/src/i18n.mjs";
import * as vscode from "vscode";
import type { ArchitecturePartition, ProjectSpec } from "../../packages/core/src/index.ts";

export class PartitionProvider implements vscode.TreeDataProvider<ArchitecturePartition> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private readonly read: () => ProjectSpec | null) {}
  refresh(): void { this.emitter.fire(); }
  getTreeItem(item: ArchitecturePartition): vscode.TreeItem {
    const tree = new vscode.TreeItem(item.name, vscode.TreeItemCollapsibleState.None);
    tree.id = item.id;
    tree.description = item.focusPaths.join(", ");
    tree.tooltip = `${t("Analysis scope")}: ${item.focusPaths.join(", ")}`;
    tree.contextValue = "archx.partition";
    tree.iconPath = new vscode.ThemeIcon("symbol-namespace");
    // 点分区就直接看它的代码事实——这是新方向唯一的入口
    tree.command = { command: "archx.openFacts", title: t("Open code facts"), arguments: [item] };
    return tree;
  }
  getChildren(): ArchitecturePartition[] { return this.read()?.partitions ?? []; }
}
