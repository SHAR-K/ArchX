import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "extension/dist/facts",
    emptyOutDir: false,
    target: "es2022",
    sourcemap: true,
    minify: "oxc",
    cssCodeSplit: false,
    lib: {
      entry: path.resolve("extension/webview/facts/main.tsx"),
      formats: ["iife"],
      name: "ArchXFacts",
      fileName: () => "main.js",
      cssFileName: "main",
    },
  },
});
