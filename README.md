# 1v1 Timer

Free standalone version of CrowSight's 1v1 Timer. One window, one job: time a
1v1, keep score, and put a clean overlay on top of the game for the player or
the caster.

**No account. No sign-in. No network calls.** Every preference lives in
`localStorage`.

## What's in it

- **Three overlay presets** — Vertical (compact stack), Horizontal
  (broadcast bar), Glass (translucent HUD).
- **Global hotkeys** (default `F1` / `F2`, fully rebindable to any key, mouse
  button, or scroll direction):
  - `F1` — three-state cycle: start → pause → reset. Resetting the *second*
    player closes the round and awards the point to the longer survivor.
  - `F2` — save the active player's time and swap.
- **Accent color** — one picker (plus five presets) drives the entire app and
  every element of the overlay.
- **Classic / Modern** visual presets for the app window.
- Per-preset background opacity, overlay scale, lock (click-through) and
  top-center snap.

## Hotkeys are pass-through

Every binding goes through a low-level `WH_KEYBOARD_LL` hook (`rdev`), never
`RegisterHotKey`. That means binding a bare key like `5` fires the timer **and**
still types a `5` in whatever window has focus — the hook observes, it doesn't
consume.

Kill-switch: `Ctrl+Alt+Shift+F12` disables all hotkey firing until the app
restarts.

## Layout

```
src/
  App.tsx              app shell: title bar, Discord/website links, appearance panel
  OneVOneTimer.tsx     the control panel (classic + modern layouts)
  OneVOneOverlay.tsx   the overlay window (#1v1-overlay hash route)
  OneVOne.ts           zustand store, timer state machine, time formatting
  theme.ts             accent color / preset / scale preferences
  lib/hotkeys.ts       chord-string format + conflict detection
  lib/lowlevelBridge.ts  Rust hook events → window.__hotkey1v1* handlers
src-tauri/
  src/main.rs          five commands: register/unregister hotkeys, overlay lock, bare modifiers
  src/lowlevel.rs      the pass-through keyboard/mouse hook
```

The overlay is the same bundle loaded into a second webview at
`index.html#1v1-overlay`. It has its own JS heap, so state reaches it through
the `overlay-1v1-update` Tauri event and it reconstructs its own ticking clock
from the timing fields.

## Development

```bash
npm install
npm run tauri dev
```

Build an installer:

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/nsis/`.
