// 静态演示页（GitHub Pages）。入口是 site/index.html，面板代码和插件共用，数据在 site/public/data/。
import { defineConfig } from "vite";

export default defineConfig({
  root: "site",
  base: "./",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    minify: "oxc",
  },
});
