import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/press-start-2p/latin-400.css";
import "@fontsource/vt323/latin-400.css";
import "./index.css";
import { App } from "./App";
import reportWebVitals from "./reportWebVitals";
import { BrowserRouter } from "react-router-dom";
import { StorageProvider } from "./providers/Storage";
import { SyncProvider } from "./providers/Sync";
import { createLocalStorage } from "./storage";
import { createLazySyncRuntime } from "./sync/lazy";
import { trackError, trackUncaughtErrors, trackWebVital } from "./analytics";

// Analytics: uncaught errors (their kind only) and Core Web Vitals.
trackUncaughtErrors();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
  // A render error with no error boundary blanks the page: report it as a "react"
  // error, then hand it on as React would by default (reportError logs it; the
  // window listener above knows it's already been reported).
  onUncaughtError: (error) => {
    trackError(error, "react");
    if (typeof window.reportError === "function") window.reportError(error);
    else console.error(error);
  },
});
// Supporter sync (docs/spec/sync.md). Storage tells it about every save; it does
// nothing over the network unless sync has been turned on in this browser.
const sync = createLazySyncRuntime();
const storage = createLocalStorage({ sync });

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <SyncProvider runtime={sync}>
        <StorageProvider storage={storage}>
          <App />
        </StorageProvider>
      </SyncProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Core Web Vitals: each metric's name and rounded value (see src/analytics.ts).
reportWebVitals(trackWebVital);
