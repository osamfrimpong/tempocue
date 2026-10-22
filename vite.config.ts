import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4310",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:4310",
        ws: true,
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
