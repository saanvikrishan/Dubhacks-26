import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { calendarApi } from "./server/calendar-bridge.js";
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), calendarApi()],
  server: {
    proxy: {
      "/api/pricing": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ""),
      },
      "/api/backend-status": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: () => "/",
      },
      // FastAPI backend (Gemini recipes + Backboard preferences)
      "/api/dining": {
        target: process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/recipes": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/preferences": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/vision": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/pantry": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/saved-meals": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/nutrition": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/google-calendar": {
        target: process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Openverse CC image search — match photos to dish names
      "/api/openverse": {
        target: "https://api.openverse.org/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openverse/, ""),
      },
    },
  },
});
