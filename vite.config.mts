/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The Worker serves this folder as static files (server/wrangler.toml, HO-1).
  build: { outDir: "build" },
  server: {
    // HO-2: the app calls the sync API on its own address. Locally that's this dev
    // server, passing /v1 on to the Worker (`cd server && yarn dev`, port 8787).
    proxy: { "/v1": "http://localhost:8787" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/setupTests.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
