import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { calendarApi } from "./server/calendar-bridge.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), calendarApi()],
  server: {
    proxy: {
      // FastAPI backend (Gemini recipes + Backboard preferences)
      "/api/recipes": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/preferences": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/vision": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/pantry": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/saved-meals": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
