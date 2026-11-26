import { lazy, Suspense } from "react";

/**
 * Sync settings, downloaded only when someone opens `/sync`: most people never
 * do, so it stays out of the main bundle. (The pairing page is not split: it
 * has to take the key out of the address bar during the app's first render, SY-11.)
 */
const SyncSettingsPage = lazy(() => import("./SyncSettings").then((m) => ({ default: m.SyncSettingsPage })));

export const SyncSettingsRoute = () => (
  <Suspense fallback={null}>
    <SyncSettingsPage />
  </Suspense>
);
