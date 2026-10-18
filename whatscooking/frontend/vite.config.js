import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { calendarApi } from "./server/calendar-bridge.js";
import {backendTarget, diningTarget} from "./src/domain/branding.js";
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), calendarApi()],
  build: {
    // The complete reviewed USDA reference is one ~604 kB module (~54 kB gzip).
    // Keep it separately cached and allow that data size without dropping source facts.
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "food-reference", test: /[\\/]src[\\/]data[\\/]food[\\/]/ },
            { name: "campus-reference", test: /[\\/]src[\\/]data[\\/]uw[\\/]/ },
            { name: "vendor", test: /[\\/]node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api/food": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ""),
      },
      "/api/profile-patch": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ""),
      },
      "/api/pricing": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ""),
      },
      "/api/backend-status": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: () => "/",
      },
      // FastAPI backend (Gemini recipes + Backboard preferences)
      "/api/assistant": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/dining": {
        target: diningTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/recipes": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/preferences": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/vision": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/pantry": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/saved-meals": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/nutrition": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/google-calendar": {
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
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
        target: backendTarget(process.env),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
