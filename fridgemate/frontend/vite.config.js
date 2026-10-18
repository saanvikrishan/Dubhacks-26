import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { calendarApi } from "./server/calendar-bridge.js";
const BACKEND_URL = process.env.DAYWELL_BACKEND_URL || process.env.DAYWELL_DINING_BACKEND_URL || "http://127.0.0.1:8000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), calendarApi()],
  server: {
    proxy: {
      // Backend health probe: the FastAPI root reports which integrations are configured.
      "/api/backend-status": {
        target: BACKEND_URL,
        changeOrigin: true,
        rewrite: () => "/",
      },
      // Openverse CC image search — match photos to dish names
      "/api/openverse": {
        target: "https://api.openverse.org/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openverse/, ""),
      },
      // FastAPI backend (Gemini, USDA nutrition, pantry, …)
      // /api/calendar/* is handled by calendarApi middleware instead.
      "/api": {
        target: BACKEND_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
