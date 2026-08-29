// Overlay window position, remembered across close and app restart.
//
// Generalises what the map overlay already did on its own: save the position
// whenever the window moves, and put the window back BEFORE it is shown, so it
// is never visible at the default spot first. Streamers align these against a
// scene once; reopening at the top-left every time undoes that work.
//
// Positions are PHYSICAL px, matching outerPosition()/PhysicalPosition, which
// is what the map overlay proved out on mixed-DPI setups. Storing logical px
// would drift on a monitor whose scale factor differs from the main window's.
//
// Same-origin localStorage is shared between the main window and every overlay
// webview, so the overlay saves and the launcher reads the same key.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";

interface Geometry { x: number; y: number }

const key = (label: string) => `crowsight-overlay-geom:${label}`;

function read(label: string): Geometry | null {
  try {
    const raw = localStorage.getItem(key(label));
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<Geometry>;
    const ok = typeof g?.x === "number" && Number.isFinite(g.x)
            && typeof g?.y === "number" && Number.isFinite(g.y);
    // A monitor that has been unplugged can leave a position far outside any
    // desktop. Rather than hiding the overlay somewhere unreachable, treat an
    // absurd value as "no memory" and let it open at its default spot.
    if (!ok || Math.abs(g.x!) > 20000 || Math.abs(g.y!) > 20000) return null;
    return { x: g.x!, y: g.y! };
  } catch {
    return null;
  }
}

/**
 * Remember this overlay's position while it is open. Call from inside the
 * overlay window; returns a teardown for the effect.
 *
 * Debounced, because a drag emits a move event per frame and this writes to
 * localStorage.
 */
export function trackOverlayPosition(
  label: string,
  /** Optional gate, read at write time. Overlays that park themselves
   *  programmatically (e.g. a full-screen preset snapping to 0,0) return false
   *  so the move does not overwrite the spot the user dragged the window to. */
  shouldSave?: () => boolean,
): () => void {
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = async () => {
    if (shouldSave && !shouldSave()) return;
    try {
      const pos = await win.outerPosition();
      localStorage.setItem(key(label), JSON.stringify({ x: pos.x, y: pos.y }));
    } catch { /* non-fatal: a lost position is not worth an error path */ }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, 200);
  };

  const unlisten = win.listen("tauri://move", schedule);

  return () => {
    unlisten.then(f => f()).catch(() => {});
    if (timer) clearTimeout(timer);
    // One last write on the way out: the debounce may still be pending when
    // the window closes, and that final drag is the position the user meant.
    void save();
  };
}

/**
 * Put a freshly-created overlay back where it was closed. Call while the
 * window is still hidden, then show it.
 */
export async function restoreOverlayPosition(
  win: { setPosition: (p: PhysicalPosition) => Promise<void> },
  label: string,
): Promise<void> {
  const geom = read(label);
  if (!geom) return;
  try {
    await win.setPosition(new PhysicalPosition(geom.x, geom.y));
  } catch { /* non-fatal */ }
}
