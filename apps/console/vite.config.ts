import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/v1": { target: process.env.API_URL ?? "http://127.0.0.1:3000", changeOrigin: true } },
  },
  preview: { port: 4173, proxy: { "/v1": { target: process.env.API_URL ?? "http://127.0.0.1:3000", changeOrigin: true } } },
  test: { environment: "jsdom", include: ["test/**/*.test.tsx", "test/**/*.test.ts"], setupFiles: ["test/setup.ts"] },
});
