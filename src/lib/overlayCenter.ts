// Snap the current overlay window to the top-center of its screen (same
// behavior as the tournament overlay). Used by the per-overlay "Center"
// button: the settings page emits an event and the overlay window (which
// knows its own monitor) calls this.
//
// outerSize() returns physical px while window.screen is logical CSS px, so
// divide by the scale factor before computing the centered position.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";

// `visibleWidth` (logical px): pass the rendered content's width when it's
// narrower than the window and anchored at its left edge (e.g. the scrim
// Minimal preset in a fixed 600px window), so the VISIBLE bar is what gets
// centered rather than the invisible window box.
export async function centerOverlayWindow(visibleWidth?: number) {
  try {
    const win = getCurrentWindow();
    const size = await win.outerSize();
    const sf = await win.scaleFactor();
    const w = visibleWidth && visibleWidth > 0 ? visibleWidth : size.width / sf;
    const x = Math.max(0, Math.round((window.screen.width - w) / 2));
    await win.setPosition(new LogicalPosition(x, 0));
  } catch { /* non-fatal */ }
}
