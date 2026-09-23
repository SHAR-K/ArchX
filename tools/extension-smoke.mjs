// 插件打包产物的冒烟：构建出来的东西对不对、注册面有没有多余的东西。
//
// 不起 VS Code。断言的是产物文件存在、宿主 bundle 里没有 webview 才有的东西、
// 插件清单只声明新方向的命令和视图，以及 Claude 插件里只剩 archcheck 这一个 skill。
//
// 面板画得对不对是另一条（tools/facts-panel-smoke.ts，真跑 DOM）。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const extensionBundle = path.resolve("extension/dist/extension.cjs");
const factsBundle = path.resolve("extension/dist/facts/main.js");
const factsStyles = path.resolve("extension/dist/facts/main.css");
const claudePlugin = path.resolve("extension/claude-marketplace/plugins/archx");
const mcpServer = path.join(claudePlugin, "server", "archx-mcp.mjs");
const manifestFile = path.resolve("extension/package.json");
const hostSourceFile = path.resolve("extension/src/extension.ts");

for (const [file, what] of [
  [extensionBundle, "宿主 bundle"],
  [factsBundle, "代码事实面板 bundle"],
  [factsStyles, "代码事实面板样式"],
  [mcpServer, "MCP 服务器"],
  [path.join(claudePlugin, ".mcp.json"), "MCP 配置"],
  [path.join(claudePlugin, "skills", "archcheck", "SKILL.md"), "archcheck skill"],
]) {
  assert.ok(fs.existsSync(file), `${what} 不在：先跑 npm run build:extension`);
}

// 旧那套整批删了，产物和源码都不该再出现
for (const gone of [
  "extension/dist/webview",
  "extension/dist/agent",
  "extension/src/workbench-panel.ts",
  "extension/src/agent-view-provider.ts",
  "extension/src/execution-store.ts",
  "extension/src/native-agent-service.ts",
  "extension/src/protocol.ts",
]) {
  assert.ok(!fs.existsSync(path.resolve(gone)), `旧模型的残留还在：${gone}`);
}
for (const skill of ["design", "deliver", "discuss", "propose", "implement", "verify"]) {
  assert.ok(!fs.existsSync(path.join(claudePlugin, "skills", skill)), `旧 skill 还在：${skill}`);
}
assert.ok(!fs.existsSync(path.join(claudePlugin, "hooks")), "写权限守卫只服务旧的 ownership 租约，应该已经删了");

const skills = fs.readdirSync(path.join(claudePlugin, "skills"));
assert.deepEqual(skills, ["archcheck"], "插件里只该有 archcheck 一个 skill");

// ---- 宿主 bundle ----------------------------------------------------------------
const host = fs.readFileSync(extensionBundle, "utf8");
assert.ok(host.includes("archx.openFacts"), "宿主没有注册打开代码事实");
assert.ok(host.includes("archx.openFolderFacts"), "宿主没有注册目录扫描");
assert.ok(host.includes("archx.applyViewRequest"), "宿主没有接 MCP 的视图请求通道");
for (const gone of ["archx.openWorkbench", "archx.openAgent", "archx.focusNode", "archx.openNativeAgent"]) {
  assert.ok(!host.includes(gone), `宿主里还留着旧命令：${gone}`);
}
assert.ok(!host.includes("acquireVsCodeApi"), "宿主 bundle 里混进了 webview 侧的桥");

// ---- 面板 bundle ----------------------------------------------------------------
const facts = fs.readFileSync(factsBundle, "utf8");
assert.ok(facts.includes("acquireVsCodeApi"), "面板 bundle 里没有 VS Code 桥");
assert.ok(!facts.includes("process.env."), "面板 bundle 里混进了 Node 的 process.env");
for (const theme of ["执行关系", "依赖", "顺序与时间", "共享与并发", "状态转换", "内存占用"]) {
  assert.ok(facts.includes(theme), `面板缺主题：${theme}`);
}

// ---- 插件清单 -------------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const commands = manifest.contributes.commands.map((item) => item.command);
assert.deepEqual(
  [...commands].sort(),
  ["archx.addPartition", "archx.addPartitionFromFolder", "archx.initialize", "archx.installClaudeWorkflow", "archx.openFacts", "archx.openFolderFacts", "archx.refresh", "archx.scanPartition"],
  "声明的命令只该有新方向这一套",
);
assert.deepEqual(manifest.contributes.views.archx.map((item) => item.id), ["archx.partitions", "archx.factsSide"], "侧边栏是分区树加代码事实视图");
assert.equal(manifest.contributes.viewsContainers.secondarySidebar, undefined, "右侧 Agent 工作台容器应该已经删了");
// package.json 声明的命令必须都真的注册了，否则点了报「命令不存在」
for (const command of commands) {
  assert.ok(host.includes(command), `清单声明了 ${command}，宿主却没注册`);
}

// ---- 宿主源码：不该再依赖旧包 ------------------------------------------------------
const hostSource = fs.readFileSync(hostSourceFile, "utf8");
const imported = [...hostSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
for (const gone of ["gates", "proposal", "ownership", "rules", "mappings", "workflows", "workspace"]) {
  assert.ok(!imported.some((item) => item.includes(`/${gone}`)), `宿主源码还在引旧包：${gone}`);
}

console.log(`ArchX extension bundle smoke passed（命令 ${commands.length} · skill ${skills.length} · 宿主 ${(host.length / 1024).toFixed(0)} KB · 面板 ${(facts.length / 1024).toFixed(0)} KB）`);
