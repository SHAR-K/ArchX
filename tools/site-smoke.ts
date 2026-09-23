// 静态演示页的 DOM 检查：起一个本地静态服务，用无头 Chromium 打开两个工程，确认面板真的画出来了。
//
// 面板的 fetch 走不了 file://，所以要有个 http 服务；没构建、没浏览器都跳过，和 facts-panel-smoke 同一态度。
// 检查的是「和插件一致」：主题导航、文件/函数数、每个工程的快照 ID 都要出现，不许出现加载失败。

import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const dist = path.resolve("site/dist");
if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.log("site: 还没构建 site/dist，跳过（先跑 npm run build:site）");
  process.exit(0);
}
const browser = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter((candidate) => fs.existsSync(candidate)).find((candidate) => {
  // 装着不等于能用：Edge 在某些状态下 --dump-dom 会静默返回空、退出码 0。先拿一个空页探一下
  const probe = spawnSync(candidate, ["--headless=new", "--disable-gpu", "--no-first-run", "--dump-dom", "data:text/html,<p>probe</p>"], { encoding: "utf8", timeout: 30_000 });
  return (probe.stdout ?? "").includes("probe");
});
if (!browser) {
  console.log("site: 本机没有能输出 DOM 的 Chromium，跳过 DOM 检查");
  process.exit(0);
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".gz": "application/gzip" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const file = path.join(dist, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const port = (server.address() as { port: number }).port;
const trace = (text: string) => { if (process.env.SITE_SMOKE_TRACE) fs.writeSync(2, `${text}
`); };
trace(`listening ${port}`);

const manifest = JSON.parse(fs.readFileSync(path.join(dist, "data", "manifest.json"), "utf8")) as { projects: Array<{ id: string; snapshot: string; counts: { files: number; functions: number } }> };
assert.ok(manifest.projects.length >= 2, "演示页至少两个工程：一裸机一 RTOS");

try {
  for (const project of manifest.projects) {
    trace(`open ${project.id}`);
    // 浏览器要向本进程的服务要文件，所以不能用 spawnSync：它会把事件循环一起卡住，两边互等
    const dump: { stdout: string } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=15000", "--dump-dom", `http://127.0.0.1:${port}/index.html?lang=en#${project.id}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).then((r) => ({ stdout: String(r.stdout) }), (error: { stdout?: string }) => ({ stdout: String(error.stdout ?? "") }));
    trace(`dumped ${project.id} bytes ${dump.stdout.length}`);
    const html = dump.stdout;
    assert.ok(!html.includes("Could not load the facts"), `${project.id}: 数据没加载出来`);
    assert.ok(!html.includes("Waiting for a scan"), `${project.id}: 面板还停在等扫描`);
    for (const label of ["Execution", "Dependencies", "Order &amp; time", "Sharing &amp; concurrency", "State transitions", "Memory footprint"]) {
      assert.ok(html.includes(label), `${project.id}: 主题「${label}」没渲染`);
    }
    assert.ok(html.includes(`${project.counts.files} files`), `${project.id}: 文件数没显示`);
    assert.ok(html.includes(`${project.counts.functions} functions`), `${project.id}: 函数数没显示`);
    assert.ok(html.includes(project.snapshot), `${project.id}: 快照 ID 没显示`);
    const rail = (html.match(/class="machine/g) ?? []).length;
    assert.ok(rail > 0, `${project.id}: 左栏没有对象`);
    console.log(`site: ${project.id} · ${project.counts.files} files · ${project.counts.functions} functions · rail ${rail} · snapshot ${project.snapshot}`);
  }
} finally {
  server.close();
}
console.log(`site: ${manifest.projects.length} 个工程的演示页 DOM 检查通过`);
