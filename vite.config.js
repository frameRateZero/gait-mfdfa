import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_BASE || "/gait-mfdfa/";

export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: "es" },
  build: { outDir: "dist", assetsInlineLimit: 0 },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy":   "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
