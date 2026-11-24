import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  base: "./",
  server: { host: "127.0.0.1", port: 1502, strictPort: true },
  preview: { host: "127.0.0.1", port: 1502, strictPort: true },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
  worker: { format: "es" },
  optimizeDeps: {
    exclude: ["@intersect/visualization"],
    include: ["@intersect/visualization > elkjs/lib/elk.bundled.js"],
  },
});
