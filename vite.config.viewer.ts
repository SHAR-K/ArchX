// 本地网页模板：演示页构建成一个单文件 HTML（脚本、样式都内联），scan_project 把事实嵌进去写到用户本机。
// 和演示页同一份代码（site/），只是打包方式不同：动态导入并进一个 chunk，才能整体内联。
import { defineConfig } from "vite";

export default defineConfig({
  root: "site",
  base: "./",
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../work/viewer-build",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    minify: "oxc",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
