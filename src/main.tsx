import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import OneVOneOverlay from "./OneVOneOverlay";
import "./App.css";

// The overlay is the same bundle loaded into a second webview with the
// "#1v1-overlay" hash. No auth, no gate - it renders instantly.
const component = window.location.hash === "#1v1-overlay"
  ? <OneVOneOverlay />
  : <App />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{component}</React.StrictMode>
);
