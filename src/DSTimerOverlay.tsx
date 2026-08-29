// Perk Timer overlay window (label "ds-overlay"), ported from CrowSight and
// cut down to Endurance + Elusive. Borderless, transparent, always-on-top;
// click-through unless the control panel unlocks it.
//
// All state arrives over events from the Perk Timer page; localStorage is only
// used for the first paint before the ready-handshake lands.

import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { centerOverlayWindow } from "./lib/overlayCenter";
import { trackOverlayPosition } from "./lib/overlayGeometry";

// ── Constants ──────────────────────────────────────────────────────────────────
// Durations match DSTimer.tsx. Keep these two files in lockstep.
type PerkId = "bt" | "elusive";
const PERK_INFO: Record<PerkId, { tag: string; duration: number }> = {
  bt:      { tag: "BT",  duration: 10 },
  elusive: { tag: "ELU", duration: 10 },
};
const ALL_PERKS: PerkId[] = ["bt", "elusive"];
const DEFAULT_ORDER: PerkId[] = ["bt", "elusive"];

// Glyph per row, masked so one white source takes whatever colour the user
// picked. Duplicated from DSTimer.tsx on purpose: importing it would pull the
// whole main-window bundle into the overlay's chunk.
function perkIconUrl(id: PerkId): string {
  return new URL(`./assets/perk-timer/${id}.png`, import.meta.url).href;
}

// Overlay visual presets. classic = compact opaque card, glass = frosted
// premium hud, neon = cyber glow with mono readout.
type PresetId = "classic" | "glass" | "neon";
function sanitizePreset(p: unknown): PresetId {
  return p === "glass" || p === "neon" ? p : "classic";
}

function sanitizeOrder(order: unknown): PerkId[] {
  if (!Array.isArray(order)) return DEFAULT_ORDER;
  const seen = new Set<string>();
  const out: PerkId[] = [];
  for (const id of order) {
    if (typeof id === "string" && (ALL_PERKS as string[]).includes(id) && !seen.has(id)) {
      out.push(id as PerkId);
      seen.add(id);
    }
  }
  for (const id of ALL_PERKS) if (!seen.has(id)) out.push(id);
  return out;
}

// Read initial colors + order from the persisted zustand store. Best-effort
// first paint; the main window's handshake pushes fresh values once the
// overlay emits ds-overlay-ready.
function getStoredState() {
  try {
    const raw = localStorage.getItem("1v1-theme");
    const state = raw ? (JSON.parse(raw)?.state ?? {}) : {};
    return {
      btColor:      (state.btColor      as string) ?? "#4FC3F7",
      elusiveColor: (state.elusiveColor as string) ?? "#90A4AE",
      accentColor:  (state.accentColor  as string) ?? "#E94560",
      showAccents:  (state.dsShowAccents as boolean) ?? true,
      preset:       sanitizePreset(state.dsPreset),
      order:        sanitizeOrder(state.perkOrder),
      scale:        typeof state.dsOverlayScale === "number" && state.dsOverlayScale > 0 ? state.dsOverlayScale : 1,
    };
  } catch {
    return {
      btColor: "#4FC3F7", elusiveColor: "#90A4AE", accentColor: "#E94560",
      showAccents: true, preset: "classic" as PresetId, order: DEFAULT_ORDER,
      scale: 1,
    };
  }
}

type Phase = "idle" | "active";
type PerkEnabled = Record<PerkId, boolean>;

export default function DSTimerOverlay() {
  // Reopen where the user left it: streamers align these against a scene
  // once, and a default position undoes that every launch.
  useEffect(() => trackOverlayPosition("ds-overlay"), []);

  const [phase,   setPhase]   = useState<Phase>("idle");
  const [canMove, setCanMove] = useState(false);
  const [opacity, setOpacity] = useState(75);
  const [perks,   setPerks]   = useState<PerkEnabled>({ bt: true, elusive: true });

  // Colors - initialized from localStorage, updated via events
  const init = getStoredState();
  const [btColor,      setBtColor]      = useState(init.btColor);
  const [elusiveColor, setElusiveColor] = useState(init.elusiveColor);
  const [accentColor,  setAccentColor]  = useState(init.accentColor);
  const [showAccents,  setShowAccents]  = useState(init.showAccents);
  const [preset,       setPreset]       = useState<PresetId>(init.preset);
  const [order,        setOrder]        = useState<PerkId[]>(init.order);
  const [scale,        setScale]        = useState(init.scale);

  // Remaining times - one entry per perk
  const [leftMap, setLeftMap] = useState<Record<PerkId, number>>({
    bt: PERK_INFO.bt.duration,
    elusive: PERK_INFO.elusive.duration,
  });

  // Collapsed state (a row slides away once its own window closes).
  const [doneMap, setDoneMap] = useState<Record<PerkId, boolean>>({
    bt: false, elusive: false,
  });

  const canMoveRef  = useRef(false);
  // Absolute start stamp per perk; 0 means that row is not running.
  const startedRef  = useRef<Record<PerkId, number>>(
    Object.fromEntries(ALL_PERKS.map(id => [id, 0])) as Record<PerkId, number>,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const perksRef    = useRef<PerkEnabled>({ bt: true, elusive: true });

  // ── Live scale updates from settings ──────────────────────────────────────
  // The overlay lives in its own webview, so the storage event is the only
  // channel for a preference the main window changed.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== "1v1-theme") return;
      try {
        const s = JSON.parse(e.newValue ?? "")?.state ?? {};
        if (typeof s.dsOverlayScale === "number" && s.dsOverlayScale > 0) setScale(s.dsOverlayScale);
      } catch { /* non-fatal */ }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Resize window depending on preset + scale ──────────────────────────────
  useEffect(() => {
    const base = preset === "glass" ? { w: 340, h: 160 }
               : preset === "neon"  ? { w: 320, h: 140 }
               : { w: 260, h: 110 };
    getCurrentWindow().setSize(new LogicalSize(base.w * scale, base.h * scale)).catch(() => {});
  }, [preset, scale]);

  // ── Visual-only timer ──────────────────────────────────────────────────────
  // One clock PER PERK. Perks bound to the same key are handed the same stamp
  // and so still fall in step; a perk on its own key runs on its own, and the
  // rest of the card carries on untouched.
  //
  // `startedAt` also carries the resync the main window sends when this webview
  // reconnects mid-cycle, which is why it is a map of absolute stamps rather
  // than "start these now".
  const GRACE_MS = 600;   // how long a finished row sits at zero before it goes

  function startVisualTimer(p: PerkEnabled, startedAt: Partial<Record<PerkId, number>>) {
    perksRef.current = p;
    setPerks(p);

    for (const id of ALL_PERKS) {
      const stamp = startedAt[id] ?? 0;
      // Only a stamp we have not seen means "this row just started". The
      // payload carries the whole card, so pressing one perk's key re-sends
      // the stamps of everything already mid-countdown - resetting those to a
      // full bar made them jump to 100% and snap back on the next tick.
      if (stamp > 0 && stamp !== startedRef.current[id]) {
        startedRef.current[id] = stamp;
        setLeftMap(prev => ({ ...prev, [id]: PERK_INFO[id].duration }));
        setDoneMap(prev => (prev[id] ? { ...prev, [id]: false } : prev));
      }
    }
    if (!ALL_PERKS.some(id => startedRef.current[id] > 0)) return;
    setPhase("active");

    if (intervalRef.current) return;   // already ticking for another perk
    intervalRef.current = setInterval(() => {
      const t = Date.now();
      const stamps = startedRef.current;
      const nextLeft = {} as Record<PerkId, number>;
      const nextDone = {} as Record<PerkId, boolean>;
      let anyRunning = false;

      for (const id of ALL_PERKS) {
        const stamp = stamps[id];
        const dur = PERK_INFO[id]?.duration;
        if (dur === undefined) continue;
        // done doubles as "collapse this row". A perk with no clock has not
        // been started, so it must not sit there at a full bar while another
        // perk counts down next to it.
        if (stamp === 0) { nextLeft[id] = dur; nextDone[id] = true; continue; }
        const elapsed = (t - stamp) / 1000;
        // Sit at zero for GRACE_MS so the end of the bar is actually seen,
        // then drop the row.
        if (elapsed >= dur + GRACE_MS / 1000) {
          stamps[id] = 0;
          nextLeft[id] = dur;
          nextDone[id] = true;
          continue;
        }
        nextLeft[id] = Math.max(0, dur - elapsed);
        nextDone[id] = false;
        anyRunning = true;
      }

      setLeftMap(nextLeft);
      setDoneMap(nextDone);

      if (!anyRunning) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        setPhase("idle");
      }
    }, 50);
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    type StartPayload = Partial<PerkEnabled> & {
      startedAt?: Partial<Record<PerkId, number>>;
      perkOrder?: string[];
    };
    const uStart = listen<StartPayload>("ds-timer-start", e => {
      const p = e.payload ?? {};
      const enabled: PerkEnabled = { bt: !!p.bt, elusive: !!p.elusive };
      if (p.perkOrder) setOrder(sanitizeOrder(p.perkOrder));
      startVisualTimer(enabled, p.startedAt ?? {});
    });
    const uLock = listen<boolean>("ds-overlay-lock", e => {
      const mv = !e.payload;
      setCanMove(mv); canMoveRef.current = mv;
    });
    const uCenter = listen("ds-overlay-center", () => { void centerOverlayWindow(); });
    const uOpacity = listen<number>("ds-overlay-opacity", e => setOpacity(e.payload));
    const uColors  = listen<{
      btColor?: string; elusiveColor?: string; accentColor: string;
    }>("ds-overlay-colors", e => {
      if (e.payload.btColor)      setBtColor(e.payload.btColor);
      if (e.payload.elusiveColor) setElusiveColor(e.payload.elusiveColor);
      setAccentColor(e.payload.accentColor);
    });
    const uAccents = listen<boolean>("ds-overlay-show-accents", e => setShowAccents(e.payload));
    const uOrder   = listen<string[]>("ds-overlay-perk-order", e => setOrder(sanitizeOrder(e.payload)));
    const uPreset  = listen<unknown>("ds-overlay-preset", e => setPreset(sanitizePreset(e.payload)));
    // Tell the main window we're ready - it will re-push current state so we
    // don't sit on "READY" while the timer is already counting down.
    emit("ds-overlay-ready");
    return () => {
      uStart.then(f => f());
      uLock.then(f => f());
      uCenter.then(f => f());
      uOpacity.then(f => f());
      uColors.then(f => f());
      uAccents.then(f => f());
      uOrder.then(f => f());
      uPreset.then(f => f());
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ── Click-through ──────────────────────────────────────────────────────────
  useEffect(() => {
    getCurrentWindow().setIgnoreCursorEvents(!canMove).catch(() => {});
  }, [canMove]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const colorMap: Record<PerkId, string> = { bt: btColor, elusive: elusiveColor };

  const isGlass = preset === "glass";
  const isNeon  = preset === "neon";
  const alpha = opacity / 100;

  // 0..1 → 2-digit hex alpha, for appending to a #RRGGBB accent/perk color.
  const hex2 = (a: number) =>
    Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");

  // Card width (logical px, before scale) per preset.
  const cardWidth = isGlass ? 340 : isNeon ? 300 : 240;
  // Mono readout is the signature of the neon skin.
  const fontFam = isNeon ? "var(--font-mono)" : "var(--font-ui)";

  // Container surface per preset. Classic stays opaque; glass is a deep,
  // accent-tinted frosted pane; neon is a plain dark slab - all the neon lives
  // inside on the bars/text, with no glow ring around the card.
  const cardSurface =
    isGlass
      ? {
          background: `rgba(8, 7, 13, ${(0.68 * alpha).toFixed(2)})`,
          backdropFilter: alpha > 0 ? "blur(40px) saturate(2)" : "none",
          WebkitBackdropFilter: alpha > 0 ? "blur(40px) saturate(2)" : "none",
          borderRadius: "18px",
          border: `1px solid rgba(255,255,255,${(0.16 * alpha).toFixed(2)})`,
          boxShadow: `0 18px 55px rgba(0,0,0,${(0.6 * alpha).toFixed(2)}), inset 0 1px 0 rgba(255,255,255,${(0.26 * alpha).toFixed(2)})`,
        }
      : isNeon
        ? {
            background: `rgba(5, 6, 11, ${(0.9 * alpha).toFixed(2)})`,
            backdropFilter: alpha > 0 ? "blur(6px)" : "none",
            WebkitBackdropFilter: alpha > 0 ? "blur(6px)" : "none",
            borderRadius: "6px",
            border: `1px solid rgba(255,255,255,${(0.07 * alpha).toFixed(2)})`,
            boxShadow: `inset 0 0 28px rgba(0,0,0,${(0.65 * alpha).toFixed(2)})`,
          }
        : {
            background: phase === "idle"
              ? `rgba(10,10,16,${(0.82 * alpha).toFixed(2)})`
              : `rgba(10,10,16,${(0.90 * alpha).toFixed(2)})`,
            borderRadius: "8px",
            border: "none",
            boxShadow: "none",
          };

  return (
    <div
      className="w-screen h-screen bg-transparent"
      onMouseDown={async () => { if (canMoveRef.current) await getCurrentWindow().startDragging(); }}
      style={{ cursor: canMove ? "move" : "default" }}
    >
      <style>{`
        @keyframes dsPulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes neonScan { 0%{transform:translateY(-100%)} 100%{transform:translateY(220%)} }
      `}</style>

      <div style={{
        position: "absolute", top: 0, left: 0,
        width: `${cardWidth}px`,
        transform: `scale(${scale})`,
        transformOrigin: "0 0",
        overflow: "hidden",
        transition: "background 0.4s",
        ...cardSurface,
      }}>

        {/* Glass: accent-tinted color wash (top + bottom) + specular highlight. */}
        {isGlass && (
          <>
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: `radial-gradient(ellipse 120% 80% at 50% -10%, ${accentColor}40 0%, transparent 60%), radial-gradient(ellipse 120% 70% at 50% 115%, ${accentColor}26 0%, transparent 65%)`,
              opacity: alpha,
            }} />
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: "45%", pointerEvents: "none",
              background: "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)",
              opacity: alpha,
            }} />
          </>
        )}

        {/* Neon: scanlines + scan sweep only. */}
        {isNeon && (
          <>
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden",
              opacity: 0.5 * alpha,
              background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 3px)",
            }} />
            <div style={{
              position: "absolute", left: 0, right: 0, height: "40%", pointerEvents: "none",
              background: `linear-gradient(180deg, transparent, ${accentColor}22, transparent)`,
              animation: "neonScan 4.5s linear infinite",
              opacity: 0.7 * alpha,
            }} />
          </>
        )}

        {/* Top accent - always uses the app accent color */}
        {showAccents && (
          <div style={{
            height: "2px",
            background: `linear-gradient(to right, transparent, ${accentColor}, transparent)`,
            opacity: phase === "active" ? 1 : 0.4,
            transition: "opacity 0.4s",
          }} />
        )}

        {phase === "idle" ? (
          <div style={{ position: "relative", padding: "7px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{
              width: "6px", height: "6px", borderRadius: isNeon ? "1px" : "50%",
              background: accentColor, boxShadow: `0 0 ${isNeon ? "8px" : "6px"} ${accentColor}`,
              animation: "dsPulse 2s ease-in-out infinite", flexShrink: 0,
            }} />
            <span style={{
              color: isNeon ? accentColor : "rgba(255,255,255,0.35)",
              fontSize: "10px", fontWeight: isNeon ? 800 : 700,
              letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: fontFam,
              textShadow: isNeon ? `0 0 8px ${accentColor}cc` : "none",
            }}>{isNeon ? "Standby" : "Ready"}</span>
          </div>
        ) : (
          // Rows render in the user's chosen perkOrder. Each row collapses
          // smoothly once it's been marked done, using max-height + opacity.
          <div style={{
            position: "relative",
            padding: isNeon ? "9px 12px 11px" : "8px 12px 10px",
            display: "flex", flexDirection: "column", gap: isGlass ? "3px" : isNeon ? "6px" : "7px",
          }}>
            {order.filter(id => perks[id]).map(id => {
              // A perkOrder saved by a NEWER build can name a row this overlay
              // has never heard of. Skip it rather than dereferencing
              // undefined - a throw in here takes the whole overlay off stream.
              const info = PERK_INFO[id];
              if (!info) return null;
              const left = leftMap[id] ?? info.duration;
              const pct = left / info.duration;
              const done = doneMap[id];
              const color = colorMap[id];
              const barH      = isGlass ? "8px" : isNeon ? "6px" : "5px";
              const barRadius = isNeon ? "2px" : "4px";
              return (
                <div key={id} style={{
                  display: "flex", alignItems: "center", gap: isGlass ? "12px" : isNeon ? "10px" : "8px",
                  opacity: done ? 0 : 1,
                  maxHeight: done ? "0px" : (isGlass ? "32px" : isNeon ? "28px" : "24px"),
                  overflow: "hidden",
                  transition: "opacity 0.3s ease, max-height 0.4s ease",
                  padding: isGlass ? "3px 8px" : "0",
                  background: isGlass ? `rgba(255,255,255,${(0.03 * alpha).toFixed(2)})` : "transparent",
                  borderRadius: isGlass ? "8px" : "0",
                  marginBottom: "0",
                  border: isGlass ? `1px solid rgba(255,255,255,${(0.02 * alpha).toFixed(2)})` : "none",
                }}>
                  {/* Status glyph, masked to the row colour. */}
                  <span
                    aria-hidden
                    style={{
                      width: isGlass ? 24 : isNeon ? 22 : 20,
                      height: isGlass ? 24 : isNeon ? 22 : 20,
                      flexShrink: 0, display: "block",
                      background: color,
                      opacity: isNeon ? 1 : 0.95,
                      filter: isNeon ? `drop-shadow(0 0 4px ${color})` : "none",
                      WebkitMaskImage: `url(${perkIconUrl(id)})`,
                      maskImage: `url(${perkIconUrl(id)})`,
                      WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
                      WebkitMaskPosition: "center", maskPosition: "center",
                      WebkitMaskSize: "contain", maskSize: "contain",
                    }}
                  />
                  <div style={{
                    flex: 1, height: barH,
                    background: isGlass ? `rgba(0,0,0,${(0.6 * alpha).toFixed(2)})`
                              : isNeon  ? `rgba(0,0,0,${(0.5 * alpha).toFixed(2)})`
                              : "rgba(255,255,255,0.08)",
                    border: isGlass ? `1px solid rgba(255,255,255,${(0.05 * alpha).toFixed(2)})`
                          : isNeon  ? `1px solid ${color}${hex2(0.35 * alpha)}`
                          : "none",
                    borderRadius: barRadius, overflow: "hidden",
                    position: "relative",
                    boxShadow: isGlass ? `inset 0 1px 3px rgba(0,0,0,${(0.8 * alpha).toFixed(2)})`
                             : isNeon  ? `inset 0 0 6px ${color}${hex2(0.25 * alpha)}`
                             : "none",
                  }}>
                    <div style={{
                      height: "100%", width: `${pct * 100}%`,
                      background: isGlass ? `linear-gradient(90deg, ${color}40, ${color})`
                                : isNeon  ? color
                                : `linear-gradient(to right, ${color}99, ${color})`,
                      borderRadius: barRadius,
                      boxShadow: isGlass ? `0 0 12px ${color}aa`
                               : isNeon  ? `0 0 8px ${color}, 0 0 16px ${color}cc`
                               : `0 0 6px ${color}80`,
                      transition: "width 0.16s linear",
                      position: "relative",
                    }}>
                      {isGlass && (
                        <div style={{
                          position: "absolute", right: 0, top: 0, bottom: 0, width: "6px",
                          background: "white", borderRadius: "2px",
                          boxShadow: `0 0 8px 2px white, 0 0 12px 4px ${color}`,
                        }} />
                      )}
                      {isNeon && (
                        <div style={{
                          position: "absolute", right: 0, top: 0, bottom: 0, width: "3px",
                          background: "white",
                          boxShadow: `0 0 6px 1px ${color}, 0 0 12px 2px ${color}`,
                        }} />
                      )}
                    </div>
                  </div>
                  <span style={{
                    color,
                    fontSize: isGlass ? "12px" : isNeon ? "13px" : "10px",
                    fontWeight: 900, fontFamily: fontFam,
                    minWidth: isGlass ? "36px" : isNeon ? "44px" : "30px",
                    textAlign: "right", flexShrink: 0,
                    textShadow: isGlass ? `0 0 8px ${color}80`
                              : isNeon  ? `0 0 8px ${color}, 0 0 16px ${color}aa`
                              : "none",
                  }}>{left.toFixed(1)}s</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom accent */}
        {showAccents && (
          <div style={{
            height: "2px",
            background: `linear-gradient(to right, transparent, ${accentColor}60, transparent)`,
            opacity: phase === "active" ? 1 : 0.35,
            transition: "opacity 0.4s",
          }} />
        )}
      </div>
    </div>
  );
}
