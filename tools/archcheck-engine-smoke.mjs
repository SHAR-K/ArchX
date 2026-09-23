import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const manifest = JSON.parse(fs.readFileSync("extension/engines/win32-x64/engine-manifest.json", "utf8"));
const executable = path.resolve("extension/engines/win32-x64", manifest.executable);
const project = fs.mkdtempSync(path.join(os.tmpdir(), "archcheck-standalone-smoke-"));
const output = path.join(project, "report");
const env = { ...process.env, PATH: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"), PYTHONHOME: "", PYTHONPATH: "" };

try {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "status.h"), "#pragma once\nint status(void);\n", "utf8");
  fs.writeFileSync(path.join(project, "src", "main.c"), "#include \"status.h\"\nint main(void) { return status(); }\n", "utf8");
  const result = spawnSync(executable, [project, "--source-scan", "--json", "--out", output], { encoding: "utf8", env, timeout: 60_000, windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.analysis_mode, "source-tree");
  assert.equal(snapshot.file_metrics.length, 1);
  assert.match(snapshot.file_metrics[0].path.replaceAll("\\", "/"), /src\/main\.c$/);
  assert.ok(fs.existsSync(path.join(output, "architecture.json")));
} finally {
  fs.rmSync(project, { recursive: true, force: true });
}

// 规则文件必须在 exe 里：09-09 那版没把 profiles/ 打进去，引擎一个 RTOS 都认不出，插件里看到的
// 「调度模型未知」全是它。规则要在函数体上命中，源码扫描模式没有函数，所以这一段要 clangd；
// 本机没有就跳过（CI 的引擎作业装了 clangd）
const clangdDir = (process.env.PATH ?? "").split(path.delimiter).find((dir) => dir && ["clangd.exe", "clangd"].some((name) => fs.existsSync(path.join(dir, name))));
if (!clangdDir) {
  console.log("ArchCheck standalone smoke test passed without a system Python path（本机没有 clangd，跳过规则打包检查）");
} else {
  const rtos = fs.mkdtempSync(path.join(os.tmpdir(), "archcheck-standalone-rules-"));
  try {
    const src = path.join(rtos, "src");
    fs.mkdirSync(src, { recursive: true });
    const main = path.join(src, "main.c");
    fs.writeFileSync(main, [
      'void vTaskDelay(unsigned ticks) { (void)ticks; }',
      'int xTaskCreate(void (*fn)(void *), const char *name, unsigned stack, void *arg, unsigned prio, void **handle) { (void)fn; (void)name; (void)stack; (void)arg; (void)prio; (void)handle; return 1; }',
      'void worker(void *arg) { (void)arg; for (;;) { vTaskDelay(50); } }',
      'int main(void) { xTaskCreate(worker, "w", 128, 0, 3, 0); for (;;) { } }',
      '',
    ].join(String.fromCharCode(10)), "utf8");
    const posix = (value) => value.split(path.sep).join("/");
    fs.writeFileSync(path.join(rtos, "compile_commands.json"), JSON.stringify([{ directory: posix(rtos), file: posix(main), arguments: ["clang", "-c", posix(main)] }]), "utf8");
    const rulesEnv = { ...env, PATH: [env.PATH, clangdDir].join(path.delimiter) };
    const result = spawnSync(executable, [rtos, "--compile-commands", path.join(rtos, "compile_commands.json"), "--json", "--no-image", "--out", path.join(rtos, "report")], { encoding: "utf8", env: rulesEnv, timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const snapshot = JSON.parse(result.stdout);
    assert.equal(snapshot.scheduling, "preemptive", "FreeRTOS profile 没打进 exe：xTaskCreate 没被认出，调度模型 unknown");
    const task = snapshot.executionUnits.find((unit) => unit.id === "task:worker");
    assert.ok(task, "xTaskCreate 注册的任务要成为执行单元");
    assert.equal(task.priority?.value, 3, "第 5 个实参是优先级");
    assert.equal(task.runMode?.periodMs, 50, "vTaskDelay(50) 的周期要折出来");
  } finally {
    fs.rmSync(rtos, { recursive: true, force: true });
  }
  console.log("ArchCheck standalone smoke test passed without a system Python path (profiles bundled)");
}
