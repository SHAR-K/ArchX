// 把 ArchX 的 Claude Code 插件（archcheck skill + MCP 服务器）装到用户的 Claude 里。
//
// 从 native-agent-service 里摘出来的：那个类原本还管着旧模型的会话同步、把选中的节点
// 推给 Claude、拉起 design / deliver 那套流程。那些随旧模型一起删了，只有装插件这件事
// 和新方向有关——archcheck skill 和事实工具都在这个包里。

import { t } from "../../packages/facts-view/src/i18n.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { detectClaude } from "../../packages/claude/src/adapter.ts";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class ClaudePluginInstaller implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("ArchX");

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose(): void {
    this.output.dispose();
  }

  async install(): Promise<void> {
    const status = await detectClaude();
    if (!status.available || !status.runnable) throw new Error(status.message || t("No runnable Claude Code CLI detected"));
    const marketplace = path.join(this.context.extensionPath, "claude-marketplace");
    if (!fs.existsSync(path.join(marketplace, ".claude-plugin", "marketplace.json"))) {
      throw new Error(t("This ArchX package does not include the Claude Code plugin"));
    }

    this.output.clear();
    this.output.show(true);
    this.output.appendLine(`Claude Code: ${status.version}`);
    this.output.appendLine(`ArchX marketplace: ${marketplace}`);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t("Installing the ArchX Claude Code plugin"), cancellable: false },
      async (progress) => {
        progress.report({ message: t("Verifying the plugin") });
        await this.mustRun(status.executable, ["plugin", "validate", path.join(marketplace, "plugins", "archx")]);
        const listed = await this.run(status.executable, ["plugin", "marketplace", "list", "--json"]);
        if (`${listed.stdout}\n${listed.stderr}`.includes("archx-local")) {
          progress.report({ message: t("Updating the local marketplace") });
          await this.mustRun(status.executable, ["plugin", "marketplace", "remove", "archx-local"]);
        }
        progress.report({ message: t("Registering the marketplace") });
        await this.mustRun(status.executable, ["plugin", "marketplace", "add", marketplace, "--scope", "user"]);
        progress.report({ message: t("Installing the skill and MCP server") });
        await this.mustRun(status.executable, ["plugin", "install", "archx@archx-local", "--scope", "user"]);
      },
    );
    void vscode.window.showInformationMessage(t("Installed. In Claude Code, use /archx:archcheck to scan the repository and read code facts."));
  }

  private run(executable: string, args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn(executable, args, { cwd: this.context.extensionPath, shell: process.platform === "win32" });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  private async mustRun(executable: string, args: string[]): Promise<RunResult> {
    this.output.appendLine(`$ claude ${args.join(" ")}`);
    const result = await this.run(executable, args);
    if (result.stdout.trim()) this.output.appendLine(result.stdout.trim());
    if (result.stderr.trim()) this.output.appendLine(result.stderr.trim());
    if (result.code !== 0) throw new Error(t("claude {args} exited with code {code}", { args: args.join(" "), code: result.code }));
    return result;
  }
}
