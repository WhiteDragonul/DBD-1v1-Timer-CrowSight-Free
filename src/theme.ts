// Theme / preferences store for the standalone 1v1 Timer.
//
// This is the slimmed-down descendant of CrowSight's theme store: only the
// keys the 1v1 Timer and its overlay actually read. No account, no sync -
// everything lives in localStorage under "1v1-theme".
//
// `accentColor` is the single user-facing color. `timerColor` mirrors it so
// the 1v1 code copied over from CrowSight (which reads `timerColor`) keeps
// working unchanged.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const STORAGE_KEY = "1v1-theme";

type ThemeState = {
  accentColor: string;
  /** Mirror of accentColor - what the 1v1 timer/overlay code reads. */
  timerColor: string;
  /** App-wide visual preset. Purely cosmetic; drives [data-app-preset]. */
  appPreset: "classic" | "modern";
  premiumGlowEffects: boolean;
  hotkey1v1Enabled: boolean;
  /** Overlay window scale factor (0.5 - 2.0). */
  oneVOneOverlayScale: number;
  // Per-modifier "bare-key" switches, mirrored to the Rust hook via
  // set_bare_modifiers. True = the modifier is treated as a bare key and
  // doesn't reserve itself as a chord prefix.
  bareModCtrl: boolean;
  bareModAlt: boolean;
  bareModShift: boolean;

  // ── Perk Timer (free tier: Endurance + Elusive only) ──────────────────────
  /** Shared Perk Timer hotkey. Every perk rides this unless it has its own. */
  hotkeyDS: string;
  hotkeyDSEnabled: boolean;
  btEnabled: boolean;
  elusiveEnabled: boolean;
  /** Off, one key starts every perk. On, a row may carry its own key. */
  perkHotkeysEnabled: boolean;
  /** Per-perk key overrides. A perk absent from this map rides hotkeyDS. */
  perkHotkeys: Record<string, string>;
  dsOverlayOpacity: number;
  dsOverlayScale: number;
  dsShowAccents: boolean;
  dsSoundEnabled: boolean;
  btColor: string;
  elusiveColor: string;
  dsPreset: "classic" | "glass" | "neon";
  /** Row order in the picker and the overlay. Sanitized on read. */
  perkOrder: string[];

  // ── Crosshair ─────────────────────────────────────────────────────────────
  // The crosshair keeps its own localStorage blob (see Crosshair.tsx) so the
  // overlay window can read it without pulling in this store.

  setAccentColor: (c: string) => void;
  setAppPreset: (p: "classic" | "modern") => void;
  setPremiumGlowEffects: (b: boolean) => void;
  setHotkey1v1Enabled: (b: boolean) => void;
  setOneVOneOverlayScale: (n: number) => void;
  setBareModCtrl: (b: boolean) => void;
  setBareModAlt: (b: boolean) => void;
  setBareModShift: (b: boolean) => void;

  setHotkeyDS: (k: string) => void;
  setHotkeyDSEnabled: (b: boolean) => void;
  setBtEnabled: (b: boolean) => void;
  setElusiveEnabled: (b: boolean) => void;
  setPerkHotkeysEnabled: (b: boolean) => void;
  setPerkHotkey: (id: string, key: string | null) => void;
  resetPerkHotkeys: () => void;
  setDsOverlayOpacity: (n: number) => void;
  setDsOverlayScale: (n: number) => void;
  setDsShowAccents: (b: boolean) => void;
  setDsSoundEnabled: (b: boolean) => void;
  setBtColor: (c: string) => void;
  setElusiveColor: (c: string) => void;
  setDsPreset: (p: "classic" | "glass" | "neon") => void;
  setPerkOrder: (o: string[]) => void;
  reset: () => void;
};

const DEFAULTS = {
  accentColor: "#E94560",
  timerColor: "#E94560",
  appPreset: "classic" as "classic" | "modern",
  premiumGlowEffects: true,
  hotkey1v1Enabled: true,
  oneVOneOverlayScale: 1,
  // Default true: Ctrl/Alt/Shift are bare keys out of the box, so a bare
  // binding like "F" fires even while one of them is held. Explicit combo
  // bindings (Ctrl+F, etc.) always win regardless - see candidate_chords
  // in lowlevel.rs.
  bareModCtrl: true,
  bareModAlt: true,
  bareModShift: true,

  hotkeyDS:           "F5",
  hotkeyDSEnabled:    true,
  btEnabled:          true,
  elusiveEnabled:     true,
  perkHotkeysEnabled: false,
  perkHotkeys:        {} as Record<string, string>,
  dsOverlayOpacity:   75,
  dsOverlayScale:     1,
  dsShowAccents:      true,
  dsSoundEnabled:     true,
  btColor:            "#4FC3F7",
  elusiveColor:       "#90A4AE",
  dsPreset:           "classic" as "classic" | "glass" | "neon",
  perkOrder:          ["bt", "elusive"] as string[],
};

/** Factory-default hotkeys, surfaced by the "reset to default" affordances. */
export const HOTKEY_DEFAULTS = { ds: "F5" };

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      // One color drives everything - keep the mirror in lockstep so the
      // overlay never reads a stale hue.
      setAccentColor: (accentColor) => set({ accentColor, timerColor: accentColor }),

      setAppPreset:           (appPreset)           => set({ appPreset }),
      setPremiumGlowEffects:  (premiumGlowEffects)  => set({ premiumGlowEffects }),
      setHotkey1v1Enabled:    (hotkey1v1Enabled)    => set({ hotkey1v1Enabled }),
      setOneVOneOverlayScale: (oneVOneOverlayScale) => set({ oneVOneOverlayScale }),
      setBareModCtrl:         (bareModCtrl)         => set({ bareModCtrl }),
      setBareModAlt:          (bareModAlt)          => set({ bareModAlt }),
      setBareModShift:        (bareModShift)        => set({ bareModShift }),

      setHotkeyDS:            (hotkeyDS)            => set({ hotkeyDS }),
      setHotkeyDSEnabled:     (hotkeyDSEnabled)     => set({ hotkeyDSEnabled }),
      setBtEnabled:           (btEnabled)           => set({ btEnabled }),
      setElusiveEnabled:      (elusiveEnabled)      => set({ elusiveEnabled }),
      setPerkHotkeysEnabled:  (perkHotkeysEnabled)  => set({ perkHotkeysEnabled }),
      // Passing null clears the override rather than storing a duplicate of
      // the shared key, so "same as the rest" stays a single source of truth.
      setPerkHotkey: (id, key) => set(state => {
        const next = { ...state.perkHotkeys };
        if (key) next[id] = key; else delete next[id];
        return { perkHotkeys: next };
      }),
      resetPerkHotkeys:       ()                    => set({ perkHotkeys: {} }),
      setDsOverlayOpacity:    (dsOverlayOpacity)    => set({ dsOverlayOpacity }),
      setDsOverlayScale:      (dsOverlayScale)      => set({ dsOverlayScale }),
      setDsShowAccents:       (dsShowAccents)       => set({ dsShowAccents }),
      setDsSoundEnabled:      (dsSoundEnabled)      => set({ dsSoundEnabled }),
      setBtColor:             (btColor)             => set({ btColor }),
      setElusiveColor:        (elusiveColor)        => set({ elusiveColor }),
      setDsPreset:            (dsPreset)            => set({ dsPreset }),
      setPerkOrder:           (perkOrder)           => set({ perkOrder }),
      reset: () => set(DEFAULTS),
    }),
    { name: STORAGE_KEY }
  )
);

// The overlay lives in a separate webview with its own JS heap, so the only
// channel for preference changes is localStorage + the storage event.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      useTheme.persist.rehydrate();
    }
  });
}
