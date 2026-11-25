import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/press-start-2p/latin-400.css";
import "@fontsource/vt323/latin-400.css";
import "./index.css";
import { App } from "./App";
import { BrowserRouter } from "react-router-dom";
import { StorageProvider } from "./providers/Storage";
import { createLocalStorage } from "./storage";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <StorageProvider storage={createLocalStorage()}>
        <App />
      </StorageProvider>
    </BrowserRouter>
  </React.StrictMode>
);
