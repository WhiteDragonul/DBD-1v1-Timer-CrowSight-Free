// ─── 1v1 Timer - shared types + state store ──────────────────────────────────
//
// The control panel page (OneVOneTimer.tsx) owns authoritative state in a
// zustand store. The overlay window (OneVOneOverlay.tsx) is a separate
// webview process so it cannot share JS memory; it receives state via the
// "overlay-1v1-update" Tauri event and reconstructs its own ticking timer
// from the timing fields below.
//
// Timer model:
//   - `running` is true while the active player's run is being timed.
//   - `runStartedAt` is the epoch ms at which the latest run segment started.
//     null when not currently running.
//   - `accumulatedMs` is the sum of all previously paused-out run segments
//     for the active player's CURRENT (in-progress) round. Persisted across
//     start/stop cycles within one round, zeroed on swap/reset.
//   - The DISPLAYED elapsed time for the active player at any moment is:
//       running ? (Date.now() - runStartedAt + accumulatedMs) : accumulatedMs
//   - The non-active player shows `lastTimeMs[p]` - their previous round's
//     final time (frozen). Zero if they haven't completed a round yet.
//
// F1 cycle (hotkey1v1Cycle):
//   stopped/idle (running=false, accumulatedMs=0)  --F1-->  running
//   running                                        --F1-->  paused (running=false, accumulatedMs grows)
//   paused (running=false, accumulatedMs>0)        --F1-->  reset to idle (accumulatedMs=0)
//   Auto-scoring is implicit (always on) and resolves on this reset: if the
//   OTHER player already has a recorded time, resetting this (second) player
//   closes the round - +1 score to the longer survivor, clear both times,
//   scoreEventSeq++ so the overlay can flash. Otherwise the reset just clears
//   the active player's own time (incl. their lastTimeMs so their frozen,
//   non-active display matches).
//
// F2 cycle (hotkey1v1Swap):
//   Always: if running -> stop and roll accumulatedMs first.
//   Then save accumulatedMs as the active player's lastTimeMs.
//   Then swap active player.
//   Then RESTORE accumulatedMs to the incoming player's own saved time
//     (lastTimeMs[newActive]) so switching back shows the time they had,
//     not 0. Only the F1 reset clears a player's time. No scoring happens on
//     swap.

import { create } from "zustand";
import { emit } from "@tauri-apps/api/event";

export type PlayerId = "p1" | "p2";
export type Preset = "vertical" | "horizontal" | "glass";

export const THEME_COLORS: { id: string; color: string; label: string }[] = [
  { id: "red",     color: "#E94560", label: "Red" },
  { id: "cyan",    color: "#06D6E0", label: "Cyan" },
  { id: "green",   color: "#1D9E75", label: "Green" },
  { id: "magenta", color: "#B547D6", label: "Magenta" },
  { id: "yellow",  color: "#FFCC4D", label: "Yellow" },
];

export const DEFAULT_HOTKEY_CYCLE = "F1";
export const DEFAULT_HOTKEY_SWAP  = "F2";

export type OneVOneState = {
  // Persisted across launches (mirrors what's stored in localStorage)
  players: { p1: string; p2: string };
  score:   { p1: number; p2: number };
  themeColor: string;                              // hex string
  preset: Preset;
  hotkeyCycle: string;
  hotkeySwap:  string;
  horizBgOpacity: number;                          // 0-100, horizontal preset background alpha
  vertBgOpacity:  number;                          // 0-100, vertical preset background alpha
  horizShowLines: boolean;                         // show top/bottom accent lines in horizontal preset
  resetSkipConfirm: boolean;                       // if true, Reset Match button fires instantly without confirmation

  // Volatile (per-session) - overlay timing state
  active: PlayerId;
  running: boolean;
  runStartedAt: number | null;                     // epoch ms
  accumulatedMs: number;                           // active-player's in-progress run total
  lastTimeMs: { p1: number; p2: number };          // each player's most-recently-completed run

  // Bumped whenever a point is auto-awarded so the overlay can flash
  scoreEventSeq: number;

  // Overlay window state
  overlayOpen:   boolean;
  overlayLocked: boolean;                          // true = cursor passes through

  // ─── actions ───────────────────────────────────────────────────────────────
  setPlayerName: (id: PlayerId, name: string) => void;
  setScore:      (id: PlayerId, value: number) => void;
  bumpScore:     (id: PlayerId, delta: number) => void;
  setThemeColor:     (c: string) => void;
  setPreset:         (p: Preset) => void;
  setHotkeyCycle:    (k: string) => void;
  setHotkeySwap:     (k: string) => void;
  setHorizBgOpacity: (n: number) => void;
  setVertBgOpacity:  (n: number) => void;
  setHorizShowLines: (v: boolean) => void;
  setResetSkipConfirm: (v: boolean) => void;

  /** Wipe match-level state: players back to defaults, score to 0, current
   *  round and saved lastTimes cleared. Theme / preset / hotkeys / opacity
   *  preferences are intentionally NOT touched. */
  resetMatch: () => void;

  // F1 - three-state cycle
  cycleTimer: () => void;
  // F2 - stop, save active's time, swap, reset
  swapActive: () => void;

  setOverlayOpen:   (v: boolean) => void;
  setOverlayLocked: (v: boolean) => void;

  /** Force-push the current snapshot to the overlay window. */
  pushOverlay: () => void;
};

// ── localStorage I/O ────────────────────────────────────────────────────────
const KEY = "1v1-timer-v1";

type Persisted = Pick<OneVOneState,
  "players" | "score" | "themeColor" | "preset" |
  "hotkeyCycle" | "hotkeySwap" | "horizBgOpacity" | "vertBgOpacity" |
  "horizShowLines" | "resetSkipConfirm"
>;

function loadPersisted(): Persisted {
  const fallback: Persisted = {
    players:     { p1: "Player 1", p2: "Player 2" },
    score:       { p1: 0, p2: 0 },
    themeColor:  THEME_COLORS[0].color,
    preset:          "vertical",
    hotkeyCycle:     DEFAULT_HOTKEY_CYCLE,
    hotkeySwap:      DEFAULT_HOTKEY_SWAP,
    horizBgOpacity:  62,
    vertBgOpacity:   62,
    horizShowLines:  true,
    resetSkipConfirm: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Persisted>;
    return {
      players:        { p1: p.players?.p1 ?? fallback.players.p1, p2: p.players?.p2 ?? fallback.players.p2 },
      score:          { p1: p.score?.p1   ?? 0,                    p2: p.score?.p2   ?? 0 },
      themeColor:     typeof p.themeColor      === "string"  ? p.themeColor      : fallback.themeColor,
      preset:         p.preset === "horizontal" || p.preset === "vertical" || p.preset === "glass" ? p.preset : fallback.preset,
      hotkeyCycle:    typeof p.hotkeyCycle     === "string"  ? p.hotkeyCycle     : fallback.hotkeyCycle,
      hotkeySwap:     typeof p.hotkeySwap      === "string"  ? p.hotkeySwap      : fallback.hotkeySwap,
      horizBgOpacity: typeof p.horizBgOpacity  === "number"  ? p.horizBgOpacity  : fallback.horizBgOpacity,
      vertBgOpacity:  typeof p.vertBgOpacity   === "number"  ? p.vertBgOpacity   : fallback.vertBgOpacity,
      horizShowLines: typeof p.horizShowLines  === "boolean" ? p.horizShowLines  : fallback.horizShowLines,
      resetSkipConfirm: typeof p.resetSkipConfirm === "boolean" ? p.resetSkipConfirm : fallback.resetSkipConfirm,
    };
  } catch { return fallback; }
}

function savePersisted(s: OneVOneState) {
  const out: Persisted = {
    players:        s.players,
    score:          s.score,
    themeColor:     s.themeColor,
    preset:         s.preset,
    hotkeyCycle:    s.hotkeyCycle,
    hotkeySwap:     s.hotkeySwap,
    horizBgOpacity: s.horizBgOpacity,
    vertBgOpacity:  s.vertBgOpacity,
    horizShowLines: s.horizShowLines,
    resetSkipConfirm: s.resetSkipConfirm,
  };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch {}
}

// ── overlay event payload ───────────────────────────────────────────────────
// What the overlay needs to render - same shape regardless of preset.
export type OverlayPayload = {
  players: { p1: string; p2: string };
  score:   { p1: number; p2: number };
  themeColor: string;
  preset: Preset;
  active: PlayerId;
  running: boolean;
  runStartedAt: number | null;
  accumulatedMs: number;
  lastTimeMs: { p1: number; p2: number };
  scoreEventSeq: number;
  overlayLocked: boolean;
  horizBgOpacity: number;
  vertBgOpacity:  number;
  horizShowLines: boolean;
};

function snapshot(s: OneVOneState): OverlayPayload {
  return {
    players: s.players,
    score:   s.score,
    themeColor: s.themeColor,
    preset:  s.preset,
    active:  s.active,
    running: s.running,
    runStartedAt:   s.runStartedAt,
    accumulatedMs:  s.accumulatedMs,
    lastTimeMs:     s.lastTimeMs,
    scoreEventSeq:  s.scoreEventSeq,
    overlayLocked:  s.overlayLocked,
    horizBgOpacity: s.horizBgOpacity,
    vertBgOpacity:  s.vertBgOpacity,
    horizShowLines: s.horizShowLines,
  };
}

// ── store ───────────────────────────────────────────────────────────────────
export const use1v1 = create<OneVOneState>((set, get) => {
  const persisted = loadPersisted();
  return {
    ...persisted,

    // volatile defaults
    active:        "p1",
    running:       false,
    runStartedAt:  null,
    accumulatedMs: 0,
    lastTimeMs:    { p1: 0, p2: 0 },
    scoreEventSeq: 0,
    overlayOpen:   false,
    overlayLocked: false,

    setPlayerName: (id, name) => set(s => {
      const next = { ...s, players: { ...s.players, [id]: name } };
      savePersisted(next as OneVOneState);
      // Don't push overlay on every keystroke -- panel emits on blur via pushOverlay()
      return { players: next.players };
    }),

    setScore: (id, value) => set(s => {
      const v = Math.max(0, Math.floor(value));
      const next = { ...s, score: { ...s.score, [id]: v } };
      savePersisted(next as OneVOneState);
      queueMicrotask(() => get().pushOverlay());
      return { score: next.score };
    }),

    bumpScore: (id, delta) => set(s => {
      const v = Math.max(0, s.score[id] + delta);
      const next = { ...s, score: { ...s.score, [id]: v } };
      savePersisted(next as OneVOneState);
      queueMicrotask(() => get().pushOverlay());
      return { score: next.score };
    }),

    setThemeColor: (c) => set(s => {
      const next = { ...s, themeColor: c };
      savePersisted(next as OneVOneState);
      queueMicrotask(() => get().pushOverlay());
      return { themeColor: c };
    }),

    setPreset: (p) => set(s => {
      const next = { ...s, preset: p };
      savePersisted(next as OneVOneState);
      queueMicrotask(() => get().pushOverlay());
      return { preset: p };
    }),

    setHotkeyCycle: (k) => set(s => {
      const next = { ...s, hotkeyCycle: k };
      savePersisted(next as OneVOneState);
      return { hotkeyCycle: k };
    }),

    setHotkeySwap: (k) => set(s => {
      const next = { ...s, hotkeySwap: k };
      savePersisted(next as OneVOneState);
      return { hotkeySwap: k };
    }),

    setHorizBgOpacity: (n) => set(s => {
      const next = { ...s, horizBgOpacity: n };
      savePersisted(next as OneVOneState);
      queueMicrotask(() => get().pushOverlay());
      return { horizBgOpacity: n };
    }),

    setVertBgOpacity: (n) => set(s => {
      const next = { ...s, vertBgOpacity: n };
      savePersisted(next as OneVOneState);
      queueMicrotask(() => get().pushOverlay());
      return { vertBgOpacity: n };
    }),

    setResetSkipConfirm: (v) => set(s => {
      const next = { ...s, resetSkipConfirm: v };
      savePersisted(next as OneVOneState);
      return { resetSkipConfirm: v };
    }),

    // Match-level reset: wipe names, score, current round, and saved player
    // times. Theme / preset / hotkeys / opacity preferences are deliberately
    // left untouched - the user's overlay configuration is per-device, not
    // per-match.
    resetMatch: () => set(s => {
      const patch: Partial<OneVOneState> = {
        players:       { p1: "Player 1", p2: "Player 2" },
        score:         { p1: 0, p2: 0 },
        active:        "p1",
        running:       false,
        runStartedAt:  null,
        accumulatedMs: 0,
        lastTimeMs:    { p1: 0, p2: 0 },
      };
      savePersisted({ ...s, ...patch } as OneVOneState);
      queueMicrotask(() => get().pushOverlay());
      return patch;
    }),

    setHorizShowLines: (v) => set(s => {
      const next = { ...s, horizShowLines: v };
      savePersisted(next as OneVOneState);
      queueMicrotask(() => get().pushOverlay());
      return { horizShowLines: v };
    }),

    // F1 cycle: stopped -> running -> paused -> reset back to stopped
    cycleTimer: () => set(s => {
      let patch: Partial<OneVOneState>;
      if (s.running) {
        // running -> paused (accumulate elapsed segment). Snapshot the just-
        // finished time into lastTimeMs so the overlay (and the reset-time
        // auto-score below) can read it. No scoring happens on stop anymore -
        // it is deferred to the reset of the second player.
        const now = Date.now();
        const segment = s.runStartedAt !== null ? (now - s.runStartedAt) : 0;
        const newAccumulatedMs = s.accumulatedMs + segment;

        const updatedLastTimes = newAccumulatedMs > 0
          ? { ...s.lastTimeMs, [s.active]: newAccumulatedMs }
          : s.lastTimeMs;

        patch = {
          running: false,
          runStartedAt: null,
          accumulatedMs: newAccumulatedMs,
          lastTimeMs: updatedLastTimes,
        };
      } else if (s.accumulatedMs > 0) {
        // paused -> reset (third press in the cycle).
        //
        // Auto-score is implicit and resolved HERE: if the other player also
        // already has a recorded time, then resetting this (second) player
        // closes the round - award a point to the longer survivor and clear
        // both times. Otherwise it's just a plain reset of this player, which
        // also clears their lastTimeMs so the frozen (non-active) display
        // reads 0 too (otherwise swapping away would resurrect the time).
        const otherPlayer: PlayerId = s.active === "p1" ? "p2" : "p1";
        const myTime    = s.accumulatedMs;
        const otherTime = s.lastTimeMs[otherPlayer];

        if (otherTime > 0) {
          const winner: PlayerId | null =
            myTime > otherTime   ? s.active    :
            otherTime > myTime   ? otherPlayer :
            null; // tie - no point, but the round still closes
          patch = {
            running: false,
            runStartedAt: null,
            accumulatedMs: 0,
            lastTimeMs: { p1: 0, p2: 0 },
            ...(winner
              ? {
                  score: { ...s.score, [winner]: s.score[winner] + 1 },
                  scoreEventSeq: s.scoreEventSeq + 1,
                }
              : {}),
          };
          if (winner) savePersisted({ ...s, ...patch } as OneVOneState);
        } else {
          patch = {
            running: false,
            runStartedAt: null,
            accumulatedMs: 0,
            lastTimeMs: { ...s.lastTimeMs, [s.active]: 0 },
          };
        }
      } else {
        // stopped/idle -> start running
        patch = {
          running: true,
          runStartedAt: Date.now(),
        };
      }
      queueMicrotask(() => get().pushOverlay());
      return patch;
    }),

    // F2: save active player's run, swap, optionally auto-score.
    // Works correctly whether timer is running, paused, or idle.
    swapActive: () => set(s => {
      // Compute the active player's run total at this moment.
      const segment = s.running && s.runStartedAt !== null ? (Date.now() - s.runStartedAt) : 0;
      const totalForActive = s.accumulatedMs + segment;

      // Save it (only if > 0 - pressing F2 on a fresh idle round shouldn't
      // overwrite a previously-saved time with 0).
      const savedLastTimes = totalForActive > 0
        ? { ...s.lastTimeMs, [s.active]: totalForActive }
        : s.lastTimeMs;

      const nextActive: PlayerId = s.active === "p1" ? "p2" : "p1";

      // Auto-score is now handled inside cycleTimer (F1 stop), so swapActive
      // just saves the active player's time and switches - no scoring here.
      // Restore accumulatedMs to the incoming player's own saved time so that
      // switching back to a player shows the time they already had instead of
      // resetting to 0. Resetting is reserved for the F1 cycle.
      const patch: Partial<OneVOneState> = {
        active: nextActive,
        running: false,
        runStartedAt: null,
        accumulatedMs: savedLastTimes[nextActive],
        lastTimeMs: savedLastTimes,
      };

      queueMicrotask(() => get().pushOverlay());
      return patch;
    }),

    setOverlayOpen:   (v) => set(() => ({ overlayOpen: v })),
    setOverlayLocked: (v) => set(() => {
      queueMicrotask(() => get().pushOverlay());
      return { overlayLocked: v };
    }),

    pushOverlay: () => {
      emit("overlay-1v1-update", snapshot(get())).catch(() => {});
    },
  };
});

// ── time formatting ─────────────────────────────────────────────────────────
// Two formats - the vertical preset matches the original C# "S.dd" layout
// (seconds + hundredths, e.g. "0.00", "12.34", "90.50"), while the
// horizontal preset uses "M:SS.t" for casting-style readability.

/** Seconds with two-decimal hundredths. Vertical preset.
 *  Under 60 s  → "S.dd"     e.g. "45.30"
 *  60 s and up → "M:SS.dd"  e.g. "1:00.00", "1:30.45"
 */
export function formatTimeSecondsHundredths(ms: number): string {
  if (ms < 0) ms = 0;
  const hundredths = Math.floor((ms % 1000) / 10); // 0..99
  const hh = hundredths.toString().padStart(2, "0");
  if (ms < 60_000) {
    const whole = Math.floor(ms / 1000);
    return `${whole}.${hh}`;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}.${hh}`;
}

/** Minutes, zero-padded seconds, one-decimal tenths. Horizontal preset. */
export function formatTimeMinutes(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  const t = Math.floor((totalSeconds * 10) % 10);
  return `${m}:${s.toString().padStart(2, "0")}.${t}`;
}

/** All-colon clock with hundredths: "M:SS:HH" (e.g. "0:23:45"). Horizontal & glass presets. */
export function formatTimeColons(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const m  = Math.floor(totalSeconds / 60);
  const s  = totalSeconds % 60;
  const hh = Math.floor((ms % 1000) / 10);
  return `${m}:${s.toString().padStart(2, "0")}:${hh.toString().padStart(2, "0")}`;
}

/** Back-compat alias - old code referred to formatTime without specifying. */
export const formatTime = formatTimeMinutes;

// Compute the current display time for the active player (live).
// The overlay's animation loop reads this each frame.
export function currentActiveMs(s: OverlayPayload | OneVOneState): number {
  if (s.running && s.runStartedAt !== null) {
    return Date.now() - s.runStartedAt + s.accumulatedMs;
  }
  return s.accumulatedMs;
}