import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "extension/dist",
    emptyOutDir: true,
    ssr: path.resolve("extension/src/extension.ts"),
    target: "node20",
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ["vscode"],
      output: { format: "cjs", entryFileNames: "extension.cjs" },
    },
  },
});
