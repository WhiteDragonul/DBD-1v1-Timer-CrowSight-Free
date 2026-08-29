// Perk Timer - control panel, ported from CrowSight and cut down to the two
// perks the free build ships: Endurance (BT) and Elusive. Both run off the
// same 10s unhook window, which is why they share a cue.
//
// No account, no sync: every preference lives in the "1v1-theme" zustand
// store (localStorage). Hotkeys go through the low-level pass-through hook in
// src-tauri/src/lowlevel.rs, same as the 1v1 timer's - a bare "5" binding
// starts the timer AND still types a 5 in the game.

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { useTheme, HOTKEY_DEFAULTS } from "./theme";
import {
  formatKey, formatBareModifier, formatMouseButton, formatWheel,
  findConflict, validateHotkeyStrength, prettyChord, type HotkeyBinding,
} from "./lib/hotkeys";
import { toast } from "./Toast";
import { EditableValueChip } from "./components/EditableValueChip";
import HotkeyHeroSection from "./components/HotkeyHeroSection";
import PremiumSection from "./components/PremiumSection";
import { OverlayControlBar } from "./components/OverlayControlBar";
import { restoreOverlayPosition } from "./lib/overlayGeometry";

function InlineResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <div style={{ marginTop: "-4px", display: "flex", justifyContent: "flex-end" }}>
      <button
        onClick={onReset}
        style={{
          padding: "6px 12px", background: "transparent", color: "var(--ink-3)",
          border: "1px solid #1D1D25", borderRadius: "8px",
          fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-ui)",
          letterSpacing: "0.06em", textTransform: "uppercase",
          cursor: "pointer", transition: "all 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "#444450"; e.currentTarget.style.color = "#888890"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "#1D1D25"; e.currentTarget.style.color = "var(--ink-3)"; }}
      >
        {label}
      </button>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────
// Endurance on an unhook. Cut to 10s by the live patch, and the same unhook
// now also applies Elusive for the same 10s - two effects, one window.
const BT_DURATION      = 10;
const ELUSIVE_DURATION = 10;

export type PerkId = "bt" | "elusive";
export const PERK_META: Record<PerkId, { tag: string; label: string; durationLabel: string; duration: number; description: string }> = {
  bt:      { tag: "BT",  label: "Endurance", durationLabel: "10s", duration: BT_DURATION,
             description: "Audio cue fires at 10s when the Endurance window closes." },
  elusive: { tag: "ELU", label: "Elusive",   durationLabel: "10s", duration: ELUSIVE_DURATION,
             description: "Runs alongside Endurance off the same unhook. The cue is BT's - two beeps on the same second would only muddy it." },
};
const ALL_PERKS: PerkId[] = ["bt", "elusive"];

// Status-effect glyph per row. White line art on transparent, so the UI masks
// it with the row's colour rather than drawing it as an image - see PerkGlyph.
export function perkIconUrl(id: PerkId): string {
  return new URL(`./assets/perk-timer/${id}.png`, import.meta.url).href;
}

/** The glyph, tinted to the perk's colour. A mask rather than an <img> so a
 *  single white source works for every colour the user picks. */
export function PerkGlyph({ id, color, size = 18 }: { id: PerkId; color: string; size?: number }) {
  const url = perkIconUrl(id);
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, flexShrink: 0, display: "block",
        background: color,
        WebkitMaskImage: `url(${url})`, maskImage: `url(${url})`,
        WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
        WebkitMaskPosition: "center", maskPosition: "center",
        WebkitMaskSize: "contain", maskSize: "contain",
      }}
    />
  );
}

// Normalize a persisted perkOrder: keep known ids in order, drop dupes /
// unknowns, append any missing ids in default order. Defensive so a corrupt
// or stale localStorage value never wipes a perk from the picker.
function sanitizeOrder(order: string[] | undefined): PerkId[] {
  const seen = new Set<string>();
  const out: PerkId[] = [];
  for (const id of order ?? []) {
    if ((ALL_PERKS as string[]).includes(id) && !seen.has(id)) {
      out.push(id as PerkId);
      seen.add(id);
    }
  }
  for (const id of ALL_PERKS) if (!seen.has(id)) out.push(id);
  return out;
}

// ── Sound generation ──────────────────────────────────────────────────────────
function playSound(type: PerkId) {
  try {
    const ctx = new AudioContext();
    const tone = (freq: number, t: number, dur: number, vol: number) => {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      const g  = ctx.createGain(),       g2 = ctx.createGain();
      o1.type = "sine"; o2.type = "triangle";
      o1.frequency.value = freq; o2.frequency.value = freq * 2;
      g2.gain.value = 0.25;
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o1.start(t); o2.start(t);
      o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    };
    const now = ctx.currentTime;
    if (type === "elusive") {
      // Soft two-note fall, quieter than BT - only ever heard when Endurance
      // itself is switched off, since the two share a second.
      tone(494, now,        0.16, 0.24);
      tone(392, now + 0.17, 0.22, 0.22);
    } else {
      // BT - ascending two-note chime, C5 → E5
      tone(523, now,        0.22, 0.28);
      tone(659, now + 0.23, 0.28, 0.32);
    }
    setTimeout(() => ctx.close(), 1200);
  } catch (e) { console.warn("Audio error:", e); }
}

// ── Perk row with small toggle ────────────────────────────────────────────────
// The drag-handle is a tiny grip column on the left. Drag events live on the
// surrounding wrapper so the whole row is the drag target - clicking the badge
// or toggle still works without initiating a drag.
function PerkRow({
  perkId, tag, label, duration, description, color, enabled, onToggle, dragging,
}: {
  perkId: PerkId;
  tag: string; label: string; duration: string; description: string;
  color: string; enabled: boolean; onToggle: () => void;
  dragging?: boolean;
}) {
  return (
    <div style={{
      display: "flex", gap: "10px", alignItems: "flex-start",
      opacity: dragging ? 0.4 : 1,
      transition: "opacity 0.15s",
    }}>
      {/* Drag grip - signals "you can drag this row" */}
      <div style={{
        width: "12px", flexShrink: 0,
        display: "flex", flexDirection: "column", justifyContent: "center",
        alignItems: "center", gap: "2px",
        cursor: "grab", userSelect: "none",
        color: "#3A3A45", fontSize: "8px", lineHeight: 0.6,
        paddingTop: "10px",
      }} title="Drag to reorder">
        <span>⋮⋮</span>
      </div>

      {/* Icon badge */}
      <div style={{
        width: "36px", height: "36px", borderRadius: "8px", flexShrink: 0,
        background: enabled ? `${color}18` : "rgba(255,255,255,0.04)",
        border: `1px solid ${enabled ? color + "40" : "rgba(255,255,255,0.08)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.2s", userSelect: "none",
      }}>
        <PerkGlyph
          id={perkId}
          color={enabled ? color : "rgba(255,255,255,0.18)"}
          size={30}
        />
      </div>

      <div style={{ flex: 1 }}>
        {/* Label row + toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <div>
            <span style={{
              color: enabled ? color : "#555560",
              fontSize: "12px", fontWeight: 700,
              fontFamily: "var(--font-ui)",
              transition: "color 0.2s",
            }}>{label}</span>
            <span className="tnum" style={{
              color: enabled ? "var(--ink-3)" : "#3A3A45",
              fontSize: "11px", fontWeight: 600,
              fontFamily: "var(--font-ui)",
              marginLeft: "6px",
              transition: "color 0.2s",
            }}>{duration}</span>
            <span style={{
              color: enabled ? "rgba(255,255,255,0.30)" : "#33333D",
              fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.12em",
              fontFamily: "var(--font-ui)", marginLeft: "8px",
              transition: "color 0.2s",
            }}>{tag}</span>
          </div>
          {/* Small toggle pill */}
          <div
            onClick={onToggle}
            style={{
              width: "34px", height: "19px", borderRadius: "10px", flexShrink: 0,
              background: enabled ? color : "#1D1D25",
              position: "relative", cursor: "pointer",
              transition: "background 0.2s",
              boxShadow: enabled ? `0 0 8px ${color}50` : "none",
            }}
          >
            <div style={{
              position: "absolute", top: "2.5px",
              left: enabled ? "17px" : "2.5px",
              width: "14px", height: "14px", borderRadius: "50%",
              background: "white", transition: "left 0.18s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
            }} />
          </div>
        </div>
        {/* Description */}
        <div style={{
          color: "var(--ink-3)", fontSize: "11px",
          fontFamily: "var(--font-ui)", marginTop: "3px", lineHeight: 1.45,
        }}>{description}</div>
      </div>
    </div>
  );
}

// ── HotkeyRecorder ────────────────────────────────────────────────────────────
function HotkeyRecorder({
  currentKey, onRebind, accentColor, enabled,
  action = "ds", ownerId = "ds",
}: {
  currentKey: string; onRebind: (k: string) => void; accentColor: string; enabled: boolean;
  /** Rust action that currently owns `currentKey`. Recording unregisters that
   *  key so the webview can see the keydown, and cancelling has to hand it
   *  back to the SAME action - a perk row still on the shared key is paused
   *  and restored as "ds", not as its own action. */
  action?: string;
  /** Who to exempt in the conflict check. */
  ownerId?: HotkeyBinding["ownerId"];
}) {
  const [recording, setRecording] = useState(false);
  const pausedKey = useRef<string>("");
  const onRebindRef = useRef(onRebind);
  onRebindRef.current = onRebind;

  const ref = useRef<HTMLButtonElement>(null);

  async function startRecording() {
    pausedKey.current = currentKey;
    try {
      await invoke("unregister_hotkey", { key: currentKey });
      await new Promise(r => setTimeout(r, 50));
    } catch (e) {
      console.error("[hotkey] unregister_hotkey failed:", e);
    }
    setRecording(true);
    requestAnimationFrame(() => {
      const b = document.body;
      if (b.tabIndex < 0) b.tabIndex = -1;
      (document.activeElement as HTMLElement | null)?.blur?.();
      b.focus();
    });
  }

  function cancelRecording() {
    if (pausedKey.current) {
      invoke("rebind_hotkey", { action, oldKey: pausedKey.current, newKey: pausedKey.current }).catch(console.error);
    }
    setRecording(false);
  }

  useEffect(() => {
    if (!recording) return;
    let committed = false;

    function tryCommit(chord: string | null) {
      if (committed || !chord) return;
      const weak = validateHotkeyStrength(chord);
      if (weak) { toast(weak, { kind: "warn" }); committed = true; cancelRecording(); return; }
      const clash = findConflict(chord, ownerId);
      if (clash) {
        toast(`${prettyChord(chord)} is already used by ${clash.label}`, { kind: "warn" });
        committed = true;
        cancelRecording();
        return;
      }
      committed = true;
      onRebindRef.current(chord);
      setRecording(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") { cancelRecording(); return; }
      tryCommit(formatKey(e));
    }
    function onKeyUp(e: KeyboardEvent) {
      if (committed) return;
      const mod = formatBareModifier(e);
      if (!mod) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      tryCommit(mod);
    }
    function onMouseDown(e: MouseEvent) {
      if (e.button === 0 || e.button === 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      tryCommit(formatMouseButton(e));
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      tryCommit(formatWheel(e));
    }

    document.addEventListener("keydown",   onKeyDown,   true);
    document.addEventListener("keyup",     onKeyUp,     true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("wheel",     onWheel,     { passive: false, capture: true });
    return () => {
      document.removeEventListener("keydown",   onKeyDown,   true);
      document.removeEventListener("keyup",     onKeyUp,     true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("wheel",     onWheel,     true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const displayColor = enabled ? accentColor : "#555560";

  return (
    <div style={{
      background: "#0D0D12", border: "1px solid #1D1D25", borderRadius: "10px",
      padding: "10px 14px", display: "flex", alignItems: "center",
      justifyContent: "space-between", flex: 1,
    }}>
      <div>
        <div style={{ color: enabled ? "#ECECEC" : "#555560", fontSize: "12.5px", fontWeight: 700, fontFamily: "var(--font-ui)" }}>
          Timer hotkey
        </div>
        <div style={{ color: "var(--ink-3)", fontSize: "10.5px", fontFamily: "var(--font-ui)", marginTop: "2px" }}>
          {!enabled ? "Hotkey is disabled" : (recording ? "Press a key, mouse, or scroll - Esc to cancel" : "Click to rebind")}
        </div>
      </div>
      <button
        ref={ref}
        disabled={!enabled}
        onClick={() => (recording ? cancelRecording() : startRecording())}
        style={{
          minWidth: "68px",
          padding: "7px 12px",
          background: recording ? `${displayColor}22` : "#09090D",
          border: `1.5px solid ${recording ? displayColor : "#252530"}`,
          borderRadius: "8px",
          color: enabled ? (recording ? displayColor : "#ECECEC") : "#444450",
          fontSize: "12px",
          fontWeight: 800,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.05em",
          cursor: enabled ? "pointer" : "default",
          transition: "all 0.2s",
        }}
      >
        {recording ? "..." : currentKey}
      </button>
    </div>
  );
}

// ── Mini overlay preview ──────────────────────────────────────────────────────
// Iterates over perkOrder so the preview matches whatever sequence the user
// has dragged the rows into. Each perk gets a fixed example progress percent
// (rough mid-cycle visual) - actual countdown happens in the real overlay.
function OverlayPreview({
  opacity, enabled, colors, accentColor, showAccents, order,
}: {
  opacity: number;
  enabled: Record<PerkId, boolean>;
  colors:  Record<PerkId, string>;
  accentColor: string;
  showAccents: boolean;
  order: PerkId[];
}) {
  const anyEnabled = order.some(id => enabled[id]);
  const previewPct:  Record<PerkId, number> = { bt: 60,     elusive: 60 };
  const previewLeft: Record<PerkId, string> = { bt: "6.0s", elusive: "6.0s" };
  return (
    <div style={{
      background: "#0D0D12", border: "1px solid #1D1D25",
      borderRadius: "12px", padding: "20px",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: "240px",
        background: `rgba(10,10,16,${anyEnabled ? (0.90 * opacity / 100).toFixed(2) : (0.82 * opacity / 100).toFixed(2)})`,
        borderRadius: "8px", overflow: "hidden",
        border: "none",
        boxShadow: "none",
      }}>
        {showAccents && (
          <div style={{ height: "2px", background: `linear-gradient(to right, transparent, ${accentColor}, transparent)` }} />
        )}

        {anyEnabled ? (
          <div style={{ padding: "8px 12px 10px", display: "flex", flexDirection: "column", gap: "7px" }}>
            {order.filter(id => enabled[id]).map(id => (
              <PreviewBar
                key={id}
                color={colors[id]}
                label={PERK_META[id].tag}
                pct={previewPct[id]}
                text={previewLeft[id]}
              />
            ))}
          </div>
        ) : (
          <div style={{ padding: "7px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: accentColor, flexShrink: 0 }} />
            <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "var(--font-ui)" }}>No perks selected</span>
          </div>
        )}

        {showAccents && (
          <div style={{ height: "2px", background: `linear-gradient(to right, transparent, ${accentColor}80, transparent)` }} />
        )}
      </div>
    </div>
  );
}

function PreviewBar({ color, label, pct, text }: { color: string; label: string; pct: number; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ color, fontSize: "8px", fontWeight: 800, letterSpacing: "0.14em", width: "28px", flexShrink: 0, fontFamily: "var(--font-ui)" }}>{label}</span>
      <div style={{ flex: 1, height: "5px", background: "rgba(255,255,255,0.08)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(to right, ${color}99, ${color})`, borderRadius: "3px", boxShadow: `0 0 6px ${color}80` }} />
      </div>
      <span style={{ color, fontSize: "10px", fontWeight: 800, fontFamily: "var(--font-ui)", minWidth: "30px", textAlign: "right", flexShrink: 0 }}>{text}</span>
    </div>
  );
}

// ── Color swatch picker ───────────────────────────────────────────────────────
function ColorSwatch({ color, label, onChange }: { color: string; label: string; onChange: (c: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  // `local` drives the swatch for instant feedback; the store write (onChange)
  // is debounced so a drag doesn't flood re-renders across all subscribers.
  const [local, setLocal] = useState(color);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitted = useRef(color);

  // Sync the swatch + the UNCONTROLLED <input> only on EXTERNAL changes. The
  // input is left uncontrolled on purpose: re-applying `value` on every drag
  // tick made Chromium's native picker re-sync each frame, which made dragging
  // the handle stutter.
  useEffect(() => {
    if (color === lastEmitted.current) return;
    setLocal(color);
    if (inputRef.current) inputRef.current.value = color;
  }, [color]);

  const handleChange = useCallback((next: string) => {
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastEmitted.current = next;
      onChange(next);
    }, 60);
  }, [onChange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "7px" }}>
      <div
        onClick={() => inputRef.current?.click()}
        style={{
          width: "38px", height: "38px", borderRadius: "10px",
          background: local,
          border: "2px solid rgba(255,255,255,0.12)",
          cursor: "pointer",
          boxShadow: `0 0 14px ${local}55`,
          transition: "box-shadow 0.2s, transform 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.1)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
      />
      <span style={{
        color: "#555560", fontSize: "9px", fontWeight: 700,
        letterSpacing: "0.1em", textTransform: "uppercase",
        fontFamily: "var(--font-ui)", userSelect: "none",
      }}>{label}</span>
      <input
        ref={inputRef} type="color" defaultValue={color}
        onChange={e => handleChange(e.target.value)}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

// ── Preset thumbnail ────────────────────────────────────────────────────────
// CSS-only mock of each overlay preset so the picker isn't a blind choice.
function DsPresetThumbnail({ id, active, accent }: {
  id: "classic" | "glass" | "neon"; active: boolean; accent: string;
}) {
  const border = active ? `1px solid ${accent}` : "1px solid #252530";
  const C1 = "#4FC3F7", C2 = "#90A4AE"; // BT cyan, Elusive gray - the defaults

  if (id === "classic") {
    const rows = [{ c: C1, top: "33%", w: "54%" }, { c: C2, top: "60%", w: "82%" }];
    return (
      <div style={{ width: "100%", aspectRatio: "240 / 104", background: "rgba(13,13,19,0.96)", borderRadius: "7px", border, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4%", background: `linear-gradient(to right, transparent, ${accent}, transparent)` }} />
        {rows.map((r, i) => (
          <div key={i}>
            <div style={{ position: "absolute", top: r.top, left: "7%", width: "11%", height: "8%", borderRadius: "2px", background: r.c }} />
            <div style={{ position: "absolute", top: r.top, left: "23%", right: "22%", height: "8%", borderRadius: "2px", overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
              <div style={{ height: "100%", width: r.w, background: r.c }} />
            </div>
            <div style={{ position: "absolute", top: r.top, right: "5%", width: "12%", height: "8%", borderRadius: "2px", background: r.c }} />
          </div>
        ))}
      </div>
    );
  }

  if (id === "glass") {
    const rows = [{ c: C1, top: "27%", w: "54%" }, { c: C2, top: "56%", w: "82%" }];
    return (
      <div style={{
        width: "100%", aspectRatio: "240 / 104", borderRadius: "16px",
        background: "linear-gradient(135deg, rgba(56,50,72,0.62), rgba(15,13,21,0.85))",
        border: active ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.18)",
        position: "relative", overflow: "hidden", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)",
      }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at top, ${accent}3A 0%, transparent 70%)` }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "45%", background: "linear-gradient(180deg, rgba(255,255,255,0.16), transparent)" }} />
        {rows.map((r, i) => (
          <div key={i}>
            {/* translucent row-pill behind the bar */}
            <div style={{ position: "absolute", top: `calc(${r.top} - 5%)`, left: "5%", right: "5%", height: "22%", borderRadius: "6px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.06)" }} />
            <div style={{ position: "absolute", top: r.top, left: "9%", width: "10%", height: "12%", borderRadius: "3px", background: r.c, boxShadow: `0 0 5px ${r.c}` }} />
            <div style={{ position: "absolute", top: r.top, left: "24%", right: "23%", height: "12%", borderRadius: "5px", overflow: "hidden", background: "rgba(0,0,0,0.5)" }}>
              <div style={{ height: "100%", width: r.w, borderRadius: "5px", background: `linear-gradient(to right, ${r.c}55, ${r.c})`, boxShadow: `0 0 6px ${r.c}`, position: "relative" }}>
                <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "8%", background: "white", boxShadow: `0 0 5px white, 0 0 8px ${r.c}` }} />
              </div>
            </div>
            <div style={{ position: "absolute", top: r.top, right: "5%", width: "12%", height: "12%", borderRadius: "3px", background: r.c, boxShadow: `0 0 5px ${r.c}` }} />
          </div>
        ))}
      </div>
    );
  }

  // neon
  const rows = [{ c: C1, top: "35%", w: "54%" }, { c: C2, top: "60%", w: "82%" }];
  return (
    <div style={{
      width: "100%", aspectRatio: "240 / 104", background: "rgba(3,4,8,0.97)", borderRadius: "3px",
      border: active ? `1px solid ${accent}` : "1px solid #16161e",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.7, background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 3px)" }} />
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{ position: "absolute", top: r.top, left: "7%", width: "11%", height: "5%", borderRadius: "1px", background: r.c, boxShadow: `0 0 6px ${r.c}, 0 0 10px ${r.c}` }} />
          <div style={{ position: "absolute", top: r.top, left: "23%", right: "22%", height: "5%", borderRadius: "1px", overflow: "hidden", background: "rgba(0,0,0,0.6)", border: `1px solid ${r.c}55` }}>
            <div style={{ height: "100%", width: r.w, background: r.c, boxShadow: `0 0 6px ${r.c}, 0 0 12px ${r.c}` }} />
          </div>
          <div style={{ position: "absolute", top: r.top, right: "5%", width: "12%", height: "5%", borderRadius: "1px", background: r.c, boxShadow: `0 0 6px ${r.c}, 0 0 10px ${r.c}` }} />
        </div>
      ))}
    </div>
  );
}

// ── PresetButton ──────────────────────────────────────────────────────────────
function PresetButton({
  label, description, active, onClick, accent, preview,
}: {
  label: string; description: string; active: boolean; onClick: () => void; accent: string;
  preview?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "14px",
        background: active ? `${accent}1A` : "#14141C",
        border: `1.5px solid ${active ? accent : "#252530"}`,
        borderRadius: "10px",
        display: "flex", flexDirection: "column", gap: "12px",
        cursor: "pointer", textAlign: "center", transition: "all 0.15s",
      }}
    >
      {preview}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ color: active ? accent : "#ECECEC", fontSize: "14px", fontWeight: 800, fontFamily: "var(--font-ui)", letterSpacing: "0.02em" }}>
          {label}
        </div>
        <div style={{ color: active ? "rgba(255,255,255,0.7)" : "#6A6A75", fontSize: "11px", fontFamily: "var(--font-ui)", transition: "color 0.15s", lineHeight: 1.35 }}>
          {description}
        </div>
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DSTimer() {
  const {
    accentColor, hotkeyDS, setHotkeyDS,
    hotkeyDSEnabled, setHotkeyDSEnabled,
    btEnabled, setBtEnabled,
    elusiveEnabled, setElusiveEnabled,
    dsOverlayOpacity, setDsOverlayOpacity,
    dsOverlayScale, setDsOverlayScale,
    dsShowAccents, setDsShowAccents,
    dsSoundEnabled, setDsSoundEnabled,
    btColor, setBtColor,
    elusiveColor, setElusiveColor,
    perkHotkeysEnabled, setPerkHotkeysEnabled,
    perkHotkeys, setPerkHotkey, resetPerkHotkeys,
    perkOrder, setPerkOrder,
    dsPreset, setDsPreset,
  } = useTheme();

  // The key a given perk answers to. With per-perk keys off, or with no
  // override recorded, that is the shared Perk Timer key - which is what makes
  // "switch it on and everything keeps the same key" the natural default
  // rather than a migration.
  const keyFor = useCallback((id: PerkId): string => (
    perkHotkeysEnabled ? (perkHotkeys[id] ?? hotkeyDS) : hotkeyDS
  ), [perkHotkeysEnabled, perkHotkeys, hotkeyDS]);

  // Always read perkOrder through the sanitizer so a stale or missing-key
  // localStorage value can't drop perks from the picker.
  const order = sanitizeOrder(perkOrder);

  const [overlayOpen, setOverlayOpen] = useState(false);

  // Drag-reorder local state. draggingId = the row currently being dragged;
  // dragOverId = the row the cursor is hovering above (used to highlight the
  // separator just above that row as a drop indicator).
  const [draggingId, setDraggingId] = useState<PerkId | null>(null);
  const [dragOverId, setDragOverId] = useState<PerkId | null>(null);

  // Refs so closures always read fresh values.
  const enabledRef = {
    bt:      useRef(btEnabled),
    elusive: useRef(elusiveEnabled),
  };
  const colorRef = {
    bt:      useRef(btColor),
    elusive: useRef(elusiveColor),
  };
  const orderRef     = useRef<PerkId[]>(order);
  const opacityRef   = useRef(dsOverlayOpacity);
  const soundRef     = useRef(dsSoundEnabled);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = {
    bt:      useRef(false),
    elusive: useRef(false),
  };
  // One start stamp per perk, not one for the whole card: perks bound to
  // different keys run on their own clocks. 0 = not running.
  const startedRef = {
    bt:      useRef(0),
    elusive: useRef(0),
  };
  const keyForRef = useRef(keyFor);
  keyForRef.current = keyFor;

  useEffect(() => { enabledRef.bt.current      = btEnabled; },        [btEnabled]);
  useEffect(() => { enabledRef.elusive.current = elusiveEnabled; },   [elusiveEnabled]);
  useEffect(() => { opacityRef.current         = dsOverlayOpacity; }, [dsOverlayOpacity]);
  useEffect(() => { colorRef.bt.current        = btColor; },          [btColor]);
  useEffect(() => { colorRef.elusive.current   = elusiveColor; },     [elusiveColor]);
  useEffect(() => { soundRef.current           = dsSoundEnabled; },   [dsSoundEnabled]);
  useEffect(() => { orderRef.current           = order; },            [perkOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // One payload for both a fresh start and the resync the overlay asks for
  // when it reconnects. Carries a start stamp PER PERK, because perks bound to
  // different keys are not on the same clock any more.
  const emitTimerState = useCallback(() => {
    const startedAt = {} as Record<PerkId, number>;
    const colors = {} as Record<string, string | undefined>;
    const enabled = {} as Record<string, boolean>;
    for (const id of ALL_PERKS) {
      startedAt[id] = startedRef[id].current;
      enabled[id] = enabledRef[id].current;
      colors[`${id}Color`] = enabledRef[id].current ? colorRef[id].current : undefined;
    }
    emit("ds-timer-start", {
      ...enabled,
      ...colors,
      perkOrder: orderRef.current,
      startedAt,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Timer + sounds ────────────────────────────────────────────────────────
  // Starts the perks it is handed, each on its own clock. Pressing the shared
  // key hands it every perk still on that key; a perk with its own key is
  // handed over alone, and whatever else is mid-countdown keeps running.
  const startPerks = useCallback((ids: PerkId[]) => {
    const active = ids.filter(id => enabledRef[id].current);
    if (active.length === 0) return;

    const now = Date.now();
    for (const id of active) {
      startedRef[id].current = now;
      firedRef[id].current = false;
    }

    // Tell overlay to start its visual countdown. Payload carries the live
    // booleans + colors for every perk so the overlay never reads stale state.
    emitTimerState();

    if (intervalRef.current) return;   // already ticking for something else
    intervalRef.current = setInterval(() => {
      const t = Date.now();

      // Endurance and Elusive share the same 10s window, so both can expire in
      // a single tick. Collect them, then play ONE cue - two beeps on the same
      // second read as a glitch, not as two effects.
      const firing: PerkId[] = [];
      let running = false;
      for (const id of ALL_PERKS) {
        const startedAt = startedRef[id].current;
        if (startedAt === 0) continue;
        const elapsed = (t - startedAt) / 1000;
        if (elapsed >= PERK_META[id].duration) {
          if (!firedRef[id].current) {
            firedRef[id].current = true;
            firing.push(id);
          }
          startedRef[id].current = 0;
        } else {
          running = true;
        }
      }
      if (firing.length > 0 && soundRef.current) playSound(firing[0]);

      // Nothing left on any clock - stop ticking until the next key press.
      if (!running) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
      }
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Expose hotkey trigger ─────────────────────────────────────────────────
  useEffect(() => {
    // The shared key starts every perk still on it. With per-perk keys off
    // that is both of them, which is exactly the old behaviour.
    const w = window as Window & {
      __hotkeyDS?: () => void;
      __hotkeyPerk?: (id: string) => void;
    };
    w.__hotkeyDS = () => {
      const shared = useTheme.getState().hotkeyDS;
      startPerks(ALL_PERKS.filter(id => keyForRef.current(id) === shared));
    };
    w.__hotkeyPerk = (id: string) => {
      if ((ALL_PERKS as string[]).includes(id)) startPerks([id as PerkId]);
    };
    return () => {
      // The handlers deliberately stay bound after this page unmounts. They
      // only touch refs and emit to the overlay, so they keep working from any
      // page - deleting them meant the key silently did nothing unless the
      // Perk Timer page happened to be the one open, while the OS binding was
      // still live.
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        // Null it too: a surviving handler checks this before starting a new
        // interval, and a stale handle would make every later press a no-op.
        intervalRef.current = null;
      }
    };
  }, [startPerks]);

  // Keep the OS registrations in step with the per-perk keys. A perk that
  // overrides the shared key gets its own action; every other perk rides the
  // "ds" registration, so a chord is never registered twice.
  const registeredRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const want: Record<string, string> = {};
    if (hotkeyDSEnabled && perkHotkeysEnabled) {
      for (const id of ALL_PERKS) {
        const k = keyFor(id);
        if (k !== hotkeyDS) want[`perk_${id}`] = k;
      }
    }
    const have = registeredRef.current;
    for (const [action, key] of Object.entries(have)) {
      if (want[action] !== key) invoke("unregister_hotkey", { key }).catch(console.error);
    }
    for (const [action, key] of Object.entries(want)) {
      if (have[action] !== key) {
        invoke("rebind_hotkey", { action, oldKey: key, newKey: key }).catch(console.error);
      }
    }
    registeredRef.current = want;
  }, [hotkeyDSEnabled, perkHotkeysEnabled, perkHotkeys, hotkeyDS, keyFor]);

  // Rebind one perk. Passing the shared key clears the override instead of
  // storing a duplicate, so "same as the rest" stays a single source of truth.
  function handlePerkRebind(id: PerkId, newKey: string) {
    // Handing a perk back to the shared key is not a clash with the Perk
    // Timer hotkey - it IS the Perk Timer hotkey. Only a genuinely new key
    // gets checked.
    const backToShared = newKey === hotkeyDS;
    if (!backToShared) {
      const conflict = findConflict(newKey, `perk:${id}`);
      if (conflict) {
        toast.error(`${prettyChord(newKey)} is already bound to ${conflict.label}`);
        return;
      }
    }
    const previous = keyFor(id);
    if (previous !== hotkeyDS) {
      invoke("unregister_hotkey", { key: previous }).catch(console.error);
      delete registeredRef.current[`perk_${id}`];
    }
    setPerkHotkey(id, backToShared ? null : newKey);
    // Recording pauses whatever key the row was showing, and for a row on the
    // shared key that is the shared key itself. Put it back, or binding one
    // perk silently kills the hotkey the other perk is still using.
    if (hotkeyDSEnabled) {
      invoke("rebind_hotkey", { action: "ds", oldKey: hotkeyDS, newKey: hotkeyDS }).catch(console.error);
    }
  }

  // ── Re-register stored hotkey on mount ────────────────────────────────────
  useEffect(() => {
    if (hotkeyDSEnabled) {
      invoke("rebind_hotkey", { action: "ds", oldKey: hotkeyDS, newKey: hotkeyDS }).catch(console.error);
    } else {
      invoke("unregister_hotkey", { key: hotkeyDS }).catch(console.error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Check if overlay already open ────────────────────────────────────────
  useEffect(() => {
    WebviewWindow.getByLabel("ds-overlay").then(w => {
      if (w) {
        setOverlayOpen(true);
        // Re-assert the restored lock so window and button agree after a
        // page switch.
        try { emit("ds-overlay-lock", localStorage.getItem("ds-overlay-locked") === "1"); } catch { /* non-fatal */ }
        w.once("tauri://destroyed", () => setOverlayOpen(false));
      }
    });
  }, []);

  // ── Push visual state to the overlay whenever it changes ─────────────────
  useEffect(() => { emit("ds-overlay-opacity", dsOverlayOpacity); }, [dsOverlayOpacity]);
  useEffect(() => {
    emit("ds-overlay-colors", { btColor, elusiveColor, accentColor });
  }, [btColor, elusiveColor, accentColor]);
  useEffect(() => { emit("ds-overlay-show-accents", dsShowAccents); }, [dsShowAccents]);
  useEffect(() => { emit("ds-overlay-preset", dsPreset); }, [dsPreset]);
  // Emits the sanitized order so the overlay never sees a malformed array.
  useEffect(() => { emit("ds-overlay-perk-order", order); }, [perkOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ready handshake: when the overlay loads (or reloads), re-push the
  //    full visual state. Critically, if the timer is already running we
  //    re-emit ds-timer-start with the original start stamps so the overlay
  //    can resume mid-cycle instead of starting fresh at zero.
  useEffect(() => {
    const u = listen("ds-overlay-ready", () => {
      emit("ds-overlay-opacity", opacityRef.current);
      emit("ds-overlay-colors", {
        btColor:      colorRef.bt.current,
        elusiveColor: colorRef.elusive.current,
        accentColor,
      });
      emit("ds-overlay-show-accents", dsShowAccents);
      emit("ds-overlay-perk-order", orderRef.current);
      emit("ds-overlay-preset", dsPreset);
      // Active timer? Re-broadcast it.
      if (intervalRef.current) {
        emitTimerState();
      }
    });
    return () => { u.then(f => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accentColor, dsShowAccents, dsPreset]);

  // ── Hotkey rebind ─────────────────────────────────────────────────────────
  function handleRebind(newKey: string) {
    if (hotkeyDSEnabled) {
      invoke("rebind_hotkey", { action: "ds", oldKey: hotkeyDS, newKey }).catch(console.error);
    }
    setHotkeyDS(newKey);
  }

  function handleToggleHotkey(enabled: boolean) {
    setHotkeyDSEnabled(enabled);
    if (enabled) {
      invoke("rebind_hotkey", { action: "ds", oldKey: hotkeyDS, newKey: hotkeyDS }).catch(console.error);
    } else {
      invoke("unregister_hotkey", { key: hotkeyDS }).catch(console.error);
    }
  }

  // ── Overlay launch / close ────────────────────────────────────────────────
  async function handleLaunch() {
    const existing = await WebviewWindow.getByLabel("ds-overlay");
    if (existing) {
      await existing.show(); await existing.setFocus();
      emit("ds-overlay-opacity", dsOverlayOpacity);
      emit("ds-overlay-lock", true);
      setOverlayLocked(true);
      setOverlayOpen(true); return;
    }
    const w = new WebviewWindow("ds-overlay", {
      url: "index.html#ds-overlay", title: "Perk Timer",
      // The inner card auto-shrinks when fewer perks are active; the overlay
      // resizes itself from the preset + scale once it mounts.
      width: 260, height: 160,
      decorations: false, shadow: false, transparent: true,
      alwaysOnTop: true, resizable: false, visible: false,
      skipTaskbar: false,
    });
    w.once("tauri://created", async () => {
      await new Promise(r => setTimeout(r, 500));
      // Put it back where it was closed, while it is still hidden.
      await restoreOverlayPosition(w, "ds-overlay");
      await w.show();
      emit("ds-overlay-opacity", opacityRef.current);
      // Start locked - the overlay window is click-through from its first
      // frame (canMove starts false in DSTimerOverlay), so reflecting that
      // here keeps button and window in agreement even if this emit races
      // the webview's listener setup.
      emit("ds-overlay-lock", true);
      setOverlayLocked(true);
      setOverlayOpen(true);
    });
    w.once("tauri://destroyed", () => setOverlayOpen(false));
  }

  async function handleClose() {
    const w = await WebviewWindow.getByLabel("ds-overlay");
    if (w) await w.close();
    setOverlayOpen(false);
  }

  // Lock survives page switches: the overlay window keeps its click-through
  // state while this page unmounts, so the UI must restore the same value or
  // the button and the window disagree.
  const [overlayLocked, setOverlayLocked] = useState(() => {
    try { return localStorage.getItem("ds-overlay-locked") === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("ds-overlay-locked", overlayLocked ? "1" : "0"); } catch { /* non-fatal */ } }, [overlayLocked]);
  function handleToggleLock() {
    const next = !overlayLocked;
    setOverlayLocked(next);
    emit("ds-overlay-lock", next);
  }
  function handleCenter() { emit("ds-overlay-center"); }

  const enabledMap: Record<PerkId, boolean> = { bt: btEnabled, elusive: elusiveEnabled };
  const setEnabledMap: Record<PerkId, (b: boolean) => void> = { bt: setBtEnabled, elusive: setElusiveEnabled };
  const colorMap: Record<PerkId, string> = { bt: btColor, elusive: elusiveColor };
  const setColorMap: Record<PerkId, (c: string) => void> = { bt: setBtColor, elusive: setElusiveColor };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>

      {/* The sound toggle sits flush-right at the top - a way to keep the
          overlay visible while silencing the audio cues. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => setDsSoundEnabled(!dsSoundEnabled)}
          title={dsSoundEnabled ? "Mute audio cues" : "Unmute audio cues"}
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "8px 14px",
            background: dsSoundEnabled ? "transparent" : `${accentColor}1A`,
            border: `1px solid ${dsSoundEnabled ? "#252530" : `${accentColor}55`}`,
            borderRadius: "9px",
            color: dsSoundEnabled ? "rgba(255,255,255,0.6)" : accentColor,
            fontSize: "11px", fontWeight: 700, fontFamily: "var(--font-ui)",
            letterSpacing: "0.04em", cursor: "pointer", transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = dsSoundEnabled ? "#444450" : `${accentColor}88`; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = dsSoundEnabled ? "#252530" : `${accentColor}55`; }}
        >
          {dsSoundEnabled ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9"  x2="17" y2="15"/>
              <line x1="17" y1="9"  x2="23" y2="15"/>
            </svg>
          )}
          {dsSoundEnabled ? "SOUND ON" : "MUTED"}
        </button>
      </div>

      <PremiumSection title="Active Perks" accentColor={accentColor} storageKey="1v1-section-ds-active-perks">
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {order.map((id, idx) => {
            const meta = PERK_META[id];
            return (
              <div key={id}>
                {idx > 0 && (
                  <div style={{ height: "1px", background: dragOverId === id ? `${accentColor}99` : "rgba(255,255,255,0.05)", margin: "12px 0", transition: "background 0.1s" }} />
                )}
                <div
                  draggable
                  onDragStart={e => {
                    setDraggingId(id);
                    e.dataTransfer.effectAllowed = "move";
                    // Some browsers need a payload to start the drag.
                    e.dataTransfer.setData("text/plain", id);
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (draggingId && draggingId !== id) setDragOverId(id);
                  }}
                  onDragLeave={() => { if (dragOverId === id) setDragOverId(null); }}
                  onDrop={e => {
                    e.preventDefault();
                    if (!draggingId || draggingId === id) { setDraggingId(null); setDragOverId(null); return; }
                    // Insert position depends on drag direction so the dropped
                    // row lands on the side of the target the cursor
                    // approached from.
                    const sourceIdx = order.indexOf(draggingId);
                    const targetIdx = order.indexOf(id);
                    const next = order.filter(x => x !== draggingId);
                    const targetInNext = next.indexOf(id);
                    const insertAt = sourceIdx < targetIdx ? targetInNext + 1 : targetInNext;
                    next.splice(insertAt, 0, draggingId);
                    setPerkOrder(next);
                    setDraggingId(null);
                    setDragOverId(null);
                  }}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                >
                  <PerkRow
                    perkId={id} tag={meta.tag} label={meta.label} duration={meta.durationLabel}
                    description={meta.description}
                    color={colorMap[id]} enabled={enabledMap[id]}
                    onToggle={() => setEnabledMap[id](!enabledMap[id])}
                    dragging={draggingId === id}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </PremiumSection>

      <PremiumSection title="Presets" accentColor={accentColor} storageKey="1v1-section-ds-presets">
        <div style={{ display: "flex", gap: "8px" }}>
          <PresetButton
            label="Classic"
            description="Original compact layout"
            active={dsPreset === "classic"}
            onClick={() => setDsPreset("classic")}
            accent={accentColor}
            preview={<DsPresetThumbnail id="classic" active={dsPreset === "classic"} accent={accentColor} />}
          />
          <PresetButton
            label="Glass"
            description="Frosted premium hud"
            active={dsPreset === "glass"}
            onClick={() => setDsPreset("glass")}
            accent={accentColor}
            preview={<DsPresetThumbnail id="glass" active={dsPreset === "glass"} accent={accentColor} />}
          />
          <PresetButton
            label="Neon"
            description="Cyber glow, mono readout"
            active={dsPreset === "neon"}
            onClick={() => setDsPreset("neon")}
            accent={accentColor}
            preview={<DsPresetThumbnail id="neon" active={dsPreset === "neon"} accent={accentColor} />}
          />
        </div>
      </PremiumSection>

      <PremiumSection title="Perk Colors" accentColor={accentColor} storageKey="1v1-section-ds-colors">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", gap: "8px" }}>
          {order.map(id => (
            <ColorSwatch key={id} color={colorMap[id]} label={PERK_META[id].tag} onChange={c => setColorMap[id](c)} />
          ))}
        </div>
      </PremiumSection>

      <PremiumSection title="Overlay Opacity" accentColor={accentColor} storageKey="1v1-section-ds-opacity">
        <style>{`
          input[type=range].ds-opacity {
            -webkit-appearance: none; appearance: none; width: 100%; height: 4px;
            background: linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${dsOverlayOpacity}%, #252530 ${dsOverlayOpacity}%, #252530 100%);
            border-radius: 2px; outline: none; cursor: pointer;
          }
          input[type=range].ds-opacity::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 16px; height: 16px; border-radius: 50%;
            background: white; border: 2px solid var(--accent-color);
            box-shadow: 0 0 6px var(--accent-color); cursor: pointer; transition: transform 0.1s;
          }
          input[type=range].ds-opacity::-webkit-slider-thumb:active { transform: scale(1.25); }
        `}</style>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span style={{ color: "var(--ink-3)", fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-ui)", flexShrink: 0 }}>0%</span>
          <input type="range" className="ds-opacity" min={0} max={100} step={1}
            value={dsOverlayOpacity} onChange={e => setDsOverlayOpacity(Number(e.target.value))} />
          <span style={{ color: "var(--ink-3)", fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-ui)", flexShrink: 0 }}>100%</span>
          <EditableValueChip
            value={dsOverlayOpacity} min={0} max={100} suffix="%"
            onCommit={setDsOverlayOpacity}
            style={{
              minWidth: "44px", textAlign: "center", color: "white", fontSize: "13px", fontWeight: 800,
              fontFamily: "var(--font-ui)", background: "#0D0D12", border: "1px solid #252530",
              borderRadius: "6px", padding: "4px 8px", flexShrink: 0,
            }}
            ariaLabel="Perk timer overlay opacity"
          />
        </div>
      </PremiumSection>

      <PremiumSection title="Overlay Scale" accentColor={accentColor} storageKey="1v1-section-ds-scale">
        <style>{`
          input[type=range].ds-scale {
            -webkit-appearance: none; appearance: none; width: 100%; height: 4px;
            background: linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${Math.round(((dsOverlayScale - 0.5) / 1.5) * 100)}%, #252530 ${Math.round(((dsOverlayScale - 0.5) / 1.5) * 100)}%, #252530 100%);
            border-radius: 2px; outline: none; cursor: pointer;
          }
          input[type=range].ds-scale::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 16px; height: 16px; border-radius: 50%;
            background: white; border: 2px solid var(--accent-color);
            box-shadow: 0 0 6px var(--accent-color); cursor: pointer; transition: transform 0.1s;
          }
          input[type=range].ds-scale::-webkit-slider-thumb:active { transform: scale(1.25); }
        `}</style>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span style={{ color: "var(--ink-3)", fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-ui)", flexShrink: 0 }}>50%</span>
          <input type="range" className="ds-scale" min={0.5} max={2} step={0.05}
            value={dsOverlayScale} onChange={e => setDsOverlayScale(Number(e.target.value))} />
          <span style={{ color: "var(--ink-3)", fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-ui)", flexShrink: 0 }}>200%</span>
          <EditableValueChip
            value={Math.round(dsOverlayScale * 100)} min={50} max={200} suffix="%"
            onCommit={pct => setDsOverlayScale(Math.min(2, Math.max(0.5, pct / 100)))}
            style={{
              minWidth: "44px", textAlign: "center", color: "white", fontSize: "13px", fontWeight: 800,
              fontFamily: "var(--font-ui)", background: "#0D0D12", border: "1px solid #252530",
              borderRadius: "6px", padding: "4px 8px", flexShrink: 0,
            }}
            ariaLabel="Perk timer overlay scale"
          />
        </div>
      </PremiumSection>

      <PremiumSection title="Accent Lines" accentColor={accentColor} storageKey="1v1-section-ds-accents">
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
          width: "100%",
        }}>
          <div>
            <div style={{ color: "#ECECEC", fontSize: "13px", fontWeight: 700, fontFamily: "var(--font-ui)" }}>
              Top &amp; bottom accent lines
            </div>
            <div style={{ color: "#555560", fontSize: "11px", fontFamily: "var(--font-ui)", marginTop: "2px" }}>
              Adds the thin colored gradient bars at the top and bottom edges of the overlay.
            </div>
          </div>
          <div
            onClick={() => setDsShowAccents(!dsShowAccents)}
            style={{
              width: "40px", height: "22px", borderRadius: "11px",
              background: dsShowAccents ? accentColor : "#252530",
              position: "relative", cursor: "pointer",
              transition: "background 0.2s", flexShrink: 0,
            }}
          >
            <div style={{
              position: "absolute", top: "3px",
              left: dsShowAccents ? "21px" : "3px",
              width: "16px", height: "16px",
              borderRadius: "50%", background: "white",
              transition: "left 0.2s",
              boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
            }} />
          </div>
        </div>
      </PremiumSection>

      {/* Collapsible hotkey section */}
      <HotkeyHeroSection
        title="Perk Timer Hotkey"
        enabled={hotkeyDSEnabled}
        onEnabledChange={handleToggleHotkey}
        accentColor={accentColor}
        storageKey="1v1-hotkey-collapse-ds"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <HotkeyRecorder
            currentKey={hotkeyDS}
            onRebind={handleRebind}
            accentColor={accentColor}
            enabled={hotkeyDSEnabled}
          />
          <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "2px 0" }} />

          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <div style={{
                color: "#ECECEC", fontSize: "12px", fontWeight: 700, fontFamily: "var(--font-ui)",
              }}>Separate key per perk</div>
              <div style={{
                color: "#555560", fontSize: "11px", fontFamily: "var(--font-ui)",
                marginTop: "2px", lineHeight: 1.5,
              }}>
                Off, one key starts every perk at once. On, each row keeps the shared
                key until you give it one of its own - perks left on the shared key
                still start together.
              </div>
            </div>
            <div
              onClick={() => setPerkHotkeysEnabled(!perkHotkeysEnabled)}
              style={{
                width: "34px", height: "19px", borderRadius: "10px", flexShrink: 0,
                background: perkHotkeysEnabled ? accentColor : "#1D1D25",
                position: "relative", cursor: "pointer", marginTop: "2px",
                transition: "background 0.2s",
                boxShadow: perkHotkeysEnabled ? `0 0 8px ${accentColor}50` : "none",
              }}
            >
              <div style={{
                position: "absolute", top: "2.5px",
                left: perkHotkeysEnabled ? "17.5px" : "2.5px",
                width: "14px", height: "14px", borderRadius: "50%",
                background: "white", transition: "left 0.2s",
              }} />
            </div>
          </div>

          {perkHotkeysEnabled && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "2px" }}>
              {order.map(id => {
                const meta = PERK_META[id];
                const own = perkHotkeys[id];
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <PerkGlyph id={id} color={colorMap[id]} size={22} />
                    <div style={{ width: "120px", flexShrink: 0 }}>
                      <div style={{
                        color: "#ECECEC", fontSize: "11.5px", fontWeight: 600,
                        fontFamily: "var(--font-ui)", whiteSpace: "nowrap",
                        overflow: "hidden", textOverflow: "ellipsis",
                      }}>{meta.label}</div>
                      <div style={{
                        color: own ? "var(--ink-3)" : "#3A3A45", fontSize: "9.5px",
                        fontWeight: 700, letterSpacing: "0.1em", fontFamily: "var(--font-ui)",
                      }}>{own ? "OWN KEY" : "SHARED"}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <HotkeyRecorder
                        currentKey={keyFor(id)}
                        onRebind={k => handlePerkRebind(id, k)}
                        accentColor={accentColor}
                        enabled={hotkeyDSEnabled}
                        // A row still on the shared key is owned by "ds", so
                        // that is who gets it back if recording is cancelled.
                        action={own ? `perk_${id}` : "ds"}
                        ownerId={`perk:${id}`}
                      />
                    </div>
                    {own && (
                      <button
                        onClick={() => handlePerkRebind(id, hotkeyDS)}
                        title="Put this perk back on the shared key"
                        style={{
                          padding: "6px 10px", background: "transparent", color: "var(--ink-3)",
                          border: "1px solid #1D1D25", borderRadius: "8px", flexShrink: 0,
                          fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-ui)",
                          letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
                        }}
                      >Shared</button>
                    )}
                  </div>
                );
              })}
              {Object.keys(perkHotkeys).length > 0 && (
                <InlineResetButton
                  label="All back to the shared key"
                  onReset={() => {
                    for (const key of Object.values(registeredRef.current)) {
                      invoke("unregister_hotkey", { key }).catch(console.error);
                    }
                    registeredRef.current = {};
                    resetPerkHotkeys();
                    if (hotkeyDSEnabled) {
                      invoke("rebind_hotkey", { action: "ds", oldKey: hotkeyDS, newKey: hotkeyDS }).catch(console.error);
                    }
                    toast.success("Every perk is back on the shared key");
                  }}
                />
              )}
            </div>
          )}

          {hotkeyDS !== HOTKEY_DEFAULTS.ds && (
            <InlineResetButton
              label={`Reset to ${HOTKEY_DEFAULTS.ds}`}
              onReset={() => {
                if (hotkeyDSEnabled) {
                  invoke("rebind_hotkey", { action: "ds", oldKey: hotkeyDS, newKey: HOTKEY_DEFAULTS.ds }).catch(console.error);
                }
                setHotkeyDS(HOTKEY_DEFAULTS.ds);
                toast.success(`Reset to ${HOTKEY_DEFAULTS.ds}`);
              }}
            />
          )}
        </div>
      </HotkeyHeroSection>

      {/* ── Preview ── */}
      <div style={{ color: "var(--ink-3)", fontSize: "9px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase" }}>
        Preview
      </div>
      <OverlayPreview
        opacity={dsOverlayOpacity}
        enabled={enabledMap}
        colors={colorMap}
        accentColor={accentColor}
        showAccents={dsShowAccents}
        order={order}
      />

      {/* ── Overlay Controls ── */}
      <OverlayControlBar
        overlayOpen={overlayOpen}
        accentColor={accentColor}
        onLaunch={() => { void handleLaunch(); }}
        onClose={() => { void handleClose(); }}
        locked={overlayLocked}
        onToggleLock={handleToggleLock}
        onCenter={handleCenter}
      />

    </div>
  );
}
