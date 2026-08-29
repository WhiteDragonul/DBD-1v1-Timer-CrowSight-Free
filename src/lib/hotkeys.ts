/**
 * Shared hotkey utilities for the rebind UI.
 *
 * Chord-string format (must match `lowlevel.rs` on the Rust side):
 *   - F-keys              "F1" .. "F24"
 *   - With modifiers      "Ctrl+5", "Shift+A"
 *   - Bare letter/digit   "Q", "5"
 *   - Bare nav/edit       "Space", "Tab", "Up"
 *   - Mouse buttons       "M3", "M4", "M5"
 *   - Scroll wheel        "WheelUp", "WheelDown"
 *   - Mod + mouse/wheel   "Ctrl+M5", "Shift+WheelUp"
 *
 * Everything converges on the same `window.__hotkey1v1*` JS handlers - callers
 * don't need to care which mechanism is in use.
 */

import { use1v1 } from "../OneVOne";
import { useTheme } from "../theme";

/**
 * Build the chord-string from a raw KeyboardEvent. Returns null if the event
 * is a bare modifier (Ctrl/Alt/Shift/Meta on their own) - the caller should
 * keep listening for the rest of the chord.
 *
 * Numpad keys collapse to the plain digit ("Numpad5" -> "5") so that a
 * binding records identically regardless of whether the user pressed the
 * top-row 5 or the numpad 5. The Rust hook does the same on the way out.
 */
export function formatKey(e: KeyboardEvent): string | null {
  // Bare modifiers - wait for the real key
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey)  parts.push("Ctrl");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  let k = e.key;
  // Normalize a few names so they match the chord-strings the Rust side
  // recognizes - and so a numpad-5 binding maps to the same "5" as top-row.
  if (k === " ") k = "Space";
  else if (k === "ArrowUp")    k = "Up";
  else if (k === "ArrowDown")  k = "Down";
  else if (k === "ArrowLeft")  k = "Left";
  else if (k === "ArrowRight") k = "Right";
  // Backtick/tilde key (left of "1" on US layouts). e.key reports "`" or "~"
  // depending on Shift state - both fail validate_key() on the Rust side
  // (non-alphanumeric). Match on the physical key code instead so it works
  // regardless of layout, and emit "Backquote" to match lowlevel.rs.
  else if (e.code === "Backquote") k = "Backquote";
  else if (k.length === 1)     k = k.toUpperCase();

  parts.push(k);
  return parts.join("+");
}

/**
 * Returns "Ctrl" / "Alt" / "Shift" when the event is a release of a *bare*
 * modifier key (no other modifier was held along with it). Used by the
 * recorder to commit a single-modifier binding: tap Shift → "Shift" gets
 * bound.
 */
export function formatBareModifier(e: KeyboardEvent): string | null {
  // Other modifiers also pressed → user is mid-chord, not tapping a bare key.
  // e.shiftKey on a Shift-keyup reports the *post*-event state (false), so
  // checking the OTHER modifier flags is what distinguishes "Shift alone"
  // from "Shift+Ctrl".
  if (e.key === "Control" && !e.altKey && !e.shiftKey) return "Ctrl";
  if (e.key === "Alt"     && !e.ctrlKey && !e.shiftKey) return "Alt";
  if (e.key === "Shift"   && !e.ctrlKey && !e.altKey)   return "Shift";
  return null;
}

/** Prefix a bare chord fragment with the modifiers held during a mouse/wheel
 *  event, in the same Ctrl→Alt→Shift order formatKey uses so both the keyboard
 *  and mouse paths produce identical chord-strings (e.g. "Ctrl+Shift+M5"). */
function withMouseMods(e: MouseEvent, bare: string): string {
  const parts: string[] = [];
  if (e.ctrlKey)  parts.push("Ctrl");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(bare);
  return parts.join("+");
}

/**
 * Build a chord-string from a MouseEvent. Returns null for left/right click
 * (left = the recorder's own start trigger, right = context-menu - both too
 * dangerous to bind globally). Middle-click → "M3", back/forward → "M4"/"M5".
 * Modifiers held at click time are folded in, so "Ctrl+M5" is bindable.
 */
export function formatMouseButton(e: MouseEvent): string | null {
  let bare: string;
  switch (e.button) {
    case 1: bare = "M3"; break;
    case 3: bare = "M4"; break;
    case 4: bare = "M5"; break;
    default: return null;
  }
  return withMouseMods(e, bare);
}

/** Build a chord-string from a WheelEvent (deltaY sign decides direction).
 *  Modifiers held while scrolling are folded in (e.g. "Ctrl+WheelUp"). */
export function formatWheel(e: WheelEvent): string | null {
  if (e.deltaY > 0) return withMouseMods(e, "WheelDown");
  if (e.deltaY < 0) return withMouseMods(e, "WheelUp");
  return null;
}

/** One entry per currently-bound hotkey. */
export interface HotkeyBinding {
  /** Stable owner identifier used to skip self-collision checks.
   *  `perk:<id>` for a Perk Timer row that carries its own key. */
  ownerId: "cycle" | "swap" | "ds" | `perk:${string}`;
  /** Human-readable label shown in the conflict toast. */
  label:   string;
  /** Current key string ("F1", "Ctrl+F2", etc.). */
  key:     string;
}

/**
 * Snapshot of every hotkey the app currently binds. Snapshot - not a hook -
 * so it's safe to call from within keydown handlers.
 */
export function getAllHotkeys(): HotkeyBinding[] {
  const v = use1v1.getState();
  const t = useTheme.getState();
  const out: HotkeyBinding[] = [
    { ownerId: "cycle", label: "1v1 Start / Stop / Reset", key: v.hotkeyCycle },
    { ownerId: "swap",  label: "1v1 Swap Active Player",   key: v.hotkeySwap  },
    { ownerId: "ds",    label: "Perk Timer",               key: t.hotkeyDS    },
  ];
  // Perks only appear once they carry their own key. A perk still riding the
  // shared key must NOT be listed, or every row would report a conflict with
  // the Perk Timer hotkey it is deliberately sharing.
  if (t.perkHotkeysEnabled) {
    for (const [id, key] of Object.entries(t.perkHotkeys)) {
      if (key && key !== t.hotkeyDS) {
        out.push({ ownerId: `perk:${id}`, label: `Perk Timer - ${id}`, key });
      }
    }
  }
  return out;
}

/** Display form of a chord-string. Kept as a seam: the stored form is already
 *  what we want on screen today, but call sites shouldn't assume that. */
export function prettyChord(chord: string): string {
  return chord;
}

/**
 * Returns the conflicting binding's label if `newKey` is already bound to
 * something other than `ownerId`. Null means safe to commit.
 */
export function findConflict(
  newKey: string,
  ownerId: HotkeyBinding["ownerId"],
): HotkeyBinding | null {
  const normalized = newKey.trim().toLowerCase();
  for (const b of getAllHotkeys()) {
    if (b.ownerId === ownerId) continue;
    if (b.key.trim().toLowerCase() === normalized) return b;
  }
  return null;
}

/** A few chord strings we never want to bind, even via the pass-through path. */
const FORBIDDEN_CHORDS = new Set<string>([
  // Reserved kill-switch - pressing this disables all bare-key hotkeys.
  "Ctrl+Alt+Shift+F12",
  // Browser/app-killer chords - far too dangerous to ever bind.
  "Ctrl+Alt+Delete",
  "Alt+F4",
]);

/**
 * Validates that a chord can be bound. Returns null when OK, or a
 * human-readable reason string if the chord must be rejected.
 *
 * Bare letters and digits ARE allowed: every binding goes through the
 * low-level pass-through hook, so they fire the action *and* still reach the
 * focused window normally. Only the forbidden set above is rejected.
 */
export function validateHotkeyStrength(chord: string): string | null {
  if (FORBIDDEN_CHORDS.has(chord)) {
    return `${chord} is reserved and cannot be bound.`;
  }
  return null;
}
