// 为 corpus 里的样例工程生成 compile_commands.json。
//
// 为什么要生成而不是签进版本库：clang 的编译数据库规范要求 directory / file 是绝对路径，
// 实测把它们换成相对路径，引擎读到 0 个函数（覆盖率 0/5）——不是报错，是静默变空。
// 而绝对路径是 clone 位置决定的，写死就只在作者那台机器上成立。所以在本地生成。

import fs from "node:fs";
import path from "node:path";

const projects = [
  { dir: "corpus/blinky", includes: ["src/app", "src/hal"], sources: ["src/main.c", "src/app/led.c", "src/app/events.c", "src/app/heartbeat.c", "src/hal/gpio.c", "src/startup/startup.s"] },
  { dir: "corpus/rtos-mini", includes: ["src"], sources: ["src/main.c", "src/rtos.c", "src/startup/startup.s"] },
];

for (const project of projects) {
  const root = path.resolve(project.dir).split(path.sep).join("/");
  const entries = project.sources.map((source) => ({
    directory: root,
    file: `${root}/${source}`,
    arguments: ["clang", ...project.includes.map((dir) => `-I${root}/${dir}`), "-c", `${root}/${source}`],
  }));
  const out = path.join(project.dir, "compile_commands.json");
  fs.writeFileSync(out, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`${out}：${entries.length} 个编译单元，根 ${root}`);
}
