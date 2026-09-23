// 重扫样例工程并重记夹具与金样。
//
// 手工做这件事踩过两次坑，所以写成脚本：
//   ① 扫描器落盘的是 partition.json.gz（不缩进），夹具要的是明文缩进版——它只有一百来 KB，
//      diff 能看，值这个体积。
//   ② 事实里的 project 是绝对路径，那是 clone 位置决定的，签进版本库就只在一台机器上成立。
//      归一成仓库内的相对路径。
//
// 用法：node --experimental-strip-types tools/corpus-record.mjs [样例目录]
// 之后金样由 facts-view-smoke 的 UPDATE_GOLDEN 重记，这里顺手一起做掉。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const project = process.argv[2] ?? "corpus/blinky";
const partitionId = process.argv[3] ?? "application";
const projectDir = path.resolve(project);
const relative = path.relative(process.cwd(), projectDir).split(path.sep).join("/");

// 先确保编译数据库指向本地 clone
run("node", ["--experimental-strip-types", "tools/corpus-prepare.mjs"]);

const out = fs.mkdtempSync(path.join(os.tmpdir(), "archx-corpus-"));
run("node", ["--experimental-strip-types", "tools/facts-scan.mjs", project, partitionId, "--out", out]);

const produced = path.join(out, partitionId, "partition.json.gz");
if (!fs.existsSync(produced)) throw new Error(`扫描没有产出 ${produced}`);
const facts = JSON.parse(zlib.gunzipSync(fs.readFileSync(produced)).toString("utf8"));

// project 归一：绝对路径是 clone 位置决定的，不能进版本库
if (typeof facts.project === "string") facts.project = relative;

const fixture = path.join(projectDir, "facts", "partition.json");
fs.mkdirSync(path.dirname(fixture), { recursive: true });
fs.writeFileSync(fixture, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
fs.rmSync(out, { recursive: true, force: true });
console.log(`夹具已重记 ${path.relative(process.cwd(), fixture).split(path.sep).join("/")}（${(fs.statSync(fixture).size / 1024).toFixed(0)} KB，明文缩进，project=${relative}）`);

run("node", ["--experimental-strip-types", "tools/facts-view-smoke.ts"], { UPDATE_GOLDEN: "1" });
console.log("金样已重记。用 git diff 逐条确认改了什么，再提交。");

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...extraEnv } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 退出码 ${result.status}`);
}
