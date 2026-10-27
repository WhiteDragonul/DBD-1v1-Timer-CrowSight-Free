// Auto-update banner.
//
// On startup we ask the Tauri updater plugin whether the newest GitHub Release
// of this repo carries a higher version than the one running. The plugin reads
// releases/latest/download/latest.json (uploaded by .github/workflows/release.yml)
// and verifies the installer's signature against the pubkey in tauri.conf.json,
// so there's no backend of our own - publishing a release IS the update push.
//
// If one is found we show a slim bar under the title bar; clicking "Update"
// downloads, runs the NSIS installer in passive mode and relaunches the app.

import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type State =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; percent: number | null }
  | { kind: "error"; message: string };

export default function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    // An offline user shouldn't see an error for a check they never asked
    // for - fail silently.
    check()
      .then(update => { if (update) setState({ kind: "available", update }); })
      .catch(err => console.warn("[updater] check failed:", err));
  }, []);

  const install = async (update: Update) => {
    let total = 0;
    let done = 0;
    setState({ kind: "downloading", update, percent: null });
    try {
      await update.downloadAndInstall(ev => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          if (total > 0) setState({ kind: "downloading", update, percent: Math.round((done / total) * 100) });
        }
      });
      // On Windows the installer usually closes us before this runs.
      await relaunch();
    } catch (err) {
      setState({ kind: "error", message: String(err) });
    }
  };

  if (state.kind === "idle") return null;

  let text: string;
  let action: { label: string; onClick: () => void } | null = null;
  if (state.kind === "available") {
    text = `Update available: v${state.update.version}`;
    action = { label: "Update now", onClick: () => install(state.update) };
  } else if (state.kind === "downloading") {
    text = state.percent == null ? "Downloading update…" : `Downloading update… ${state.percent}%`;
  } else {
    text = "Update failed. Try again later or download it from the website.";
    action = { label: "Dismiss", onClick: () => setState({ kind: "idle" }) };
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "8px 16px",
      fontSize: "13px",
      background: "var(--accent-color, #b91c1c)",
      color: "#fff",
    }}>
      <span>{text}</span>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            padding: "4px 12px",
            borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.6)",
            background: "rgba(0,0,0,0.25)",
            color: "#fff",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
