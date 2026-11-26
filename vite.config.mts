/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vercel serves this folder.
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
