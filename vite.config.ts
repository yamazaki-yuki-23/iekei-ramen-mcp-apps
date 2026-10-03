import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig(({ mode }) => ({
  // MCP Apps は埋め込み用の単一HTML、Webは静的配信用の独立した出力にする。
  plugins: mode === "web" ? [react()] : [react(), viteSingleFile()],
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,
    rollupOptions: { input: mode === "web" ? "index.html" : "mcp-app.html" },
    outDir: mode === "web" ? "dist/web" : "dist",
    emptyOutDir: mode === "web",
  },
}));
