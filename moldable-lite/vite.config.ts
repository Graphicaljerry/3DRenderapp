import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // ES-format workers so `import ... from "...?url"` works inside the CAD worker.
  worker: { format: "es" },
  optimizeDeps: {
    // The multi-MB OCCT emscripten glue must NOT be esbuild-prebundled; that
    // breaks the ?url .wasm resolution in `vite dev`. (build path is unaffected.)
    exclude: ["replicad", "replicad-opencascadejs"],
  },
  build: { target: "esnext" },
  server: { port: 5173, open: true },
});
