import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import OneVOneOverlay from "./OneVOneOverlay";
import DSTimerOverlay from "./DSTimerOverlay";
import CrosshairOverlay from "./CrosshairOverlay";
import "./App.css";

// Every overlay is the same bundle loaded into its own webview, picked by the
// URL hash. No auth, no gate - they render instantly.
const hash = window.location.hash;
const component =
    hash === "#1v1-overlay"       ? <OneVOneOverlay />
  : hash === "#ds-overlay"        ? <DSTimerOverlay />
  : hash === "#crosshair-overlay" ? <CrosshairOverlay />
  : <App />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{component}</React.StrictMode>
);
