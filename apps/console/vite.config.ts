import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { CSP } from "./csp";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/v1": { target: process.env.API_URL ?? "http://127.0.0.1:3000", changeOrigin: true } },
  },
  // preview serves the build under the production policy, so the e2e run fails on any violation
  preview: {
    port: 4173,
    headers: { "Content-Security-Policy": CSP },
    proxy: { "/v1": { target: process.env.API_URL ?? "http://127.0.0.1:3000", changeOrigin: true } },
  },
  test: { environment: "jsdom", include: ["test/**/*.test.tsx", "test/**/*.test.ts"], setupFiles: ["test/setup.ts"] },
});
