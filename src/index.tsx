import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/press-start-2p/latin-400.css";
import "@fontsource/vt323/latin-400.css";
import "./index.css";
import { App } from "./App";
import reportWebVitals from "./reportWebVitals";
import { BrowserRouter } from "react-router-dom";
import { StorageProvider } from "./providers/Storage";
import { createIpfsStorage } from "./ipfs";

// Create storage promise at module scope to prevent multiple Helia nodes
const storagePromise = createIpfsStorage();

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <StorageProvider storage={storagePromise}>
        <App />
      </StorageProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
