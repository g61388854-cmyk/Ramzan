import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Демонстрационная сборка размещается в подкаталоге (GitHub Pages) — относительные пути
  base: process.env.VITE_DEMO === "1" ? "./" : "/",
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.PAI_API ?? "http://127.0.0.1:8000", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
});
