import { defineConfig } from "vite";

/**
 * The hand-off page that the old address (relationship-menu.vercel.app) serves at
 * every path (spec HO-3…HO-8): handoff/index.html and handoff/main.ts, using
 * src/handoff/, with no React. `yarn build:handoff` → build-handoff/, which vercel.json deploys.
 * `yarn start:handoff` serves it on 127.0.0.1:3098, a different origin from the
 * app's dev server on localhost:3099, for trying the hand-off locally and for the
 * e2e tests (e2e/handoff.spec.ts).
 */
export default defineConfig({
  root: "handoff",
  // VITE_* settings come from the repository root, as for the app.
  envDir: "..",
  // Its own dependency cache: the e2e tests run this dev server beside the app's,
  // and two configs sharing node_modules/.vite rewrite each other's, which breaks
  // the app's lazy imports (web-vitals).
  cacheDir: "../node_modules/.vite-handoff",
  // Every path serves the page, as on Vercel (vercel.json's rewrite).
  appType: "spa",
  build: { outDir: "../build-handoff", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 3098, strictPort: true },
});
