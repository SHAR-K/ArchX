// MCP 服务器打成一个自包含的 .mjs。
//
// 为什么要打包：它要和面板用同一份派生（packages/facts-view），否则「人看到的和 Agent
// 说的是同一件事」就只是句口号。但 vsce 从 extension/ 打包，packages/ 在它外面进不了 VSIX，
// 所以把依赖一起编进这一个文件。
//
// 源码在 extension/mcp/（.vscodeignore 排掉），产物落到插件目录里被 .mcp.json 指着。

import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "extension/claude-marketplace/plugins/archx/server",
    emptyOutDir: false,
    target: "node20",
    ssr: true,
    minify: false, // 出问题时要能直接读它，几百 KB 不值得为压缩牺牲这个
    sourcemap: false,
    rollupOptions: {
      input: path.resolve("extension/mcp/archx-mcp.mjs"),
      output: { entryFileNames: "archx-mcp.mjs", format: "es" },
      external: [/^node:/],
    },
  },
});
