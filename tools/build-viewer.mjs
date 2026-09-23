// 把 vite.config.viewer.ts 的产物内联成一个 HTML 模板，放到 MCP 插件目录里随插件发。
// 模板里留一个槽 window.__ARCHX_EMBED__ = null;，scan_project 扫完把事实填进去写到用户本机。
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("work/viewer-build");
const out = path.resolve("extension/claude-marketplace/plugins/archx/viewer/archx-viewer.html");
let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const readAsset = (ref) => fs.readFileSync(path.join(dist, ref.replace(/^\.\//, "")), "utf8");
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${readAsset(href)}</style>`);
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => {
  const code = readAsset(src).replace(/<\/script/gi, "<\\/script");
  return `<script>window.__ARCHX_EMBED__ = null;</script>\n<script type="module">${code}</script>`;
});
if (!html.includes("window.__ARCHX_EMBED__ = null;")) throw new Error("viewer: 没找到模块脚本，模板槽没插进去");
if (/src="\.\/assets\//.test(html) || /href="\.\/assets\//.test(html)) throw new Error("viewer: 还有没内联的资源");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, "utf8");
console.log(`viewer: ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
