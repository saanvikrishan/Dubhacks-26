import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { calendarApi } from "./server/calendar-bridge.js";
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), calendarApi()],
  server: {
    proxy: {
      // Openverse CC image search — match photos to dish names
      "/api/openverse": {
        target: "https://api.openverse.org/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openverse/, ""),
      },
      // FastAPI backend (Gemini, USDA nutrition, pantry, …)
      // /api/calendar/* is handled by calendarApi middleware instead.
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
