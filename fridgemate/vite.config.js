import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { calendarApi } from "./server/calendar-bridge.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), calendarApi()],
});
