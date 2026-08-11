/**
 * Listens for low-level-hotkey events emitted by the Rust `lowlevel` module
 * and dispatches them to the same `window.__hotkey1v1*` functions the
 * global-shortcut path uses. Mounted once from App.tsx.
 *
 * Events:
 *   - "lowlevel-hotkey-fired" (payload: action string)
 *       Bare-key or mouse-button hotkey was pressed.
 *   - "lowlevel-killed" (no payload)
 *       The user pressed Ctrl+Alt+Shift+F12 - all bare-key hotkeys are now
 *       disabled until the app restarts. We show a toast so it's not silent.
 *
 * Debounce: the same 150 ms guard OneVOneTimer uses for hall-effect keyboard
 * double-fires applies here too. Hardware can register a single physical
 * press as two rapid OS-level events.
 */

import { listen } from "@tauri-apps/api/event";
import { toast } from "../Toast";

const DEBOUNCE_MS = 150;
const lastFiredAt: Record<string, number> = {};

function dispatch(action: string) {
  const now = Date.now();
  if (now - (lastFiredAt[action] ?? 0) < DEBOUNCE_MS) return;
  lastFiredAt[action] = now;

  const w = window as unknown as Record<string, undefined | (() => void)>;
  const map: Record<string, string> = {
    cycle: "__hotkey1v1Cycle",
    swap:  "__hotkey1v1Swap",
  };
  const fn = w[map[action] ?? ""];
  if (typeof fn === "function") fn();
}

/** Subscribe; returns an unsubscribe function. */
export function mountLowlevelBridge(): () => void {
  const unsubs: Array<Promise<() => void>> = [];

  unsubs.push(
    listen<string>("lowlevel-hotkey-fired", (e) => {
      dispatch(e.payload);
    }),
  );

  unsubs.push(
    listen("lowlevel-killed", () => {
      toast(
        "Bare-key hotkeys disabled - kill-switch (Ctrl+Alt+Shift+F12) was triggered. Restart the app to re-enable.",
        { kind: "warn" },
      );
    }),
  );

  return () => {
    unsubs.forEach((p) => p.then((u) => u()).catch(() => {}));
  };
}
