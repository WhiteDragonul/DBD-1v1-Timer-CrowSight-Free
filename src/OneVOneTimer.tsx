// 1v1 Timer - in-app control panel page.
//
// Matches the reference design: PLAYERS / SCORE / ACTIONS & KEYBINDS / THEME
// COLOR sections in a single column, plus a bottom "Unlock / Lock Overlay"
// toggle and a small preset selector.
//
// State lives in src/OneVOne.ts (zustand). This component reads/writes it,
// wires the F1/F2 global hotkeys via Rust on overlay launch, and forwards
// every relevant change to the overlay window via Tauri events.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { use1v1, type Preset, DEFAULT_HOTKEY_CYCLE, DEFAULT_HOTKEY_SWAP, formatTimeSecondsHundredths, formatTimeColons } from "./OneVOne";
import { useTheme } from "./theme";
import { toast } from "./Toast";
import { formatKey, formatBareModifier, formatMouseButton, formatWheel, findConflict, validateHotkeyStrength } from "./lib/hotkeys";
import { EditableValueChip } from "./components/EditableValueChip";
import HotkeyHeroSection from "./components/HotkeyHeroSection";
import PremiumSection from "./components/PremiumSection";
import { OverlayControlBar } from "./components/OverlayControlBar";

// ─── Reset Match button + instant toggle ──────────────────────────────────
// Sits inside the Score section so the destructive action is anchored near
// what it destroys. Two-stage confirm by default (matches the Clear All
// pattern on the Stats page); a per-user toggle lets power users skip the
// second click. The toggle persists across launches via resetSkipConfirm.
function ResetMatchControl({
  accent, skipConfirm, onSkipConfirmChange, onReset,
}: {
  accent: string;
  skipConfirm: boolean;
  onSkipConfirmChange: (v: boolean) => void;
  onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const LOSS = "#E94560";

  function handleClick() {
    if (skipConfirm || confirming) { onReset(); setConfirming(false); return; }
    setConfirming(true);
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
      marginTop: "12px", paddingTop: "12px",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      flexWrap: "wrap",
    }}>
      <button
        onClick={handleClick}
        onBlur={() => setTimeout(() => setConfirming(false), 150)}
        title="Reset names, score, and the current round (theme and hotkeys stay)"
        style={{
          padding: "8px 16px", borderRadius: "8px",
          background: confirming ? `${LOSS}1A` : "transparent",
          color: confirming ? LOSS : "rgba(255,255,255,0.55)",
          border: `1px solid ${confirming ? LOSS + "66" : "rgba(255,255,255,0.12)"}`,
          fontSize: "11px", fontWeight: 800, fontFamily: "var(--font-ui)",
          letterSpacing: "0.06em", textTransform: "uppercase",
          cursor: "pointer", transition: "all 0.15s",
        }}
        onMouseEnter={e => { if (!confirming) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; e.currentTarget.style.color = "white"; } }}
        onMouseLeave={e => { if (!confirming) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.55)"; } }}
      >
        {confirming ? "Confirm reset?" : "Reset Match"}
      </button>

      <label
        style={{
          display: "flex", alignItems: "center", gap: "8px",
          cursor: "pointer", userSelect: "none",
        }}
        title="When on, the Reset Match button fires immediately with no confirmation."
      >
        <div
          onClick={() => onSkipConfirmChange(!skipConfirm)}
          style={{
            width: "32px", height: "18px", borderRadius: "9px", flexShrink: 0,
            background: skipConfirm ? accent : "rgba(255,255,255,0.1)",
            position: "relative", cursor: "pointer",
            transition: "background 0.2s",
          }}
        >
          <div style={{
            position: "absolute", top: "2px",
            left: skipConfirm ? "16px" : "2px",
            width: "14px", height: "14px",
            borderRadius: "50%", background: "white",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }} />
        </div>
        <span style={{
          fontSize: "10.5px", fontWeight: 700,
          color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-ui)",
          letterSpacing: "0.04em",
        }}>
          Skip confirmation
        </span>
      </label>
    </div>
  );
}

// ─── "Reset to default" pill rendered below a KeybindRow ───────────────────
// Defined above the default export because Vite's React Fast Refresh
// doesn't reliably hoist PascalCase function declarations the way module
// scope normally would - referencing it from JSX before its declaration
// in source order throws "X is not defined" at runtime during HMR.
function KeybindResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "-2px" }}>
      <button
        onClick={onReset}
        style={{
          padding: "6px 12px",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "8px",
          color: "rgba(255,255,255,0.4)",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontFamily: "var(--font-ui)",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
      >
        {label}
      </button>
    </div>
  );
}

export default function OneVOneTimer() {
  const s = use1v1();
  const {
    timerColor,
    oneVOneOverlayScale,
    setOneVOneOverlayScale,
    hotkey1v1Enabled,
    setHotkey1v1Enabled,
    appPreset,
  } = useTheme();

  // Sync the global theme color into the 1v1 store so pushOverlay() always
  // sends the correct color without needing a local color picker.
  useEffect(() => {
    s.setThemeColor(timerColor);
    // If the overlay is already open, push the updated color immediately.
    if (s.overlayOpen) s.pushOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerColor]);

  // ── Bridge global hotkeys to this component while the overlay is open ──
  // Rust calls window.__hotkey1v1Cycle() / window.__hotkey1v1Swap() when F1/F2
  // are pressed. We attach those to the current store callbacks via a ref so
  // we always invoke the latest closure.
  const cycleRef = useRef(s.cycleTimer);
  const swapRef  = useRef(s.swapActive);
  cycleRef.current = s.cycleTimer;
  swapRef.current  = s.swapActive;
  useEffect(() => {
    // 150 ms debounce guards against hall-effect keyboards with very short
    // actuation points that can register a single physical keypress as two
    // rapid OS-level keydown events in succession.
    let lastCycleMs = 0;
    let lastSwapMs  = 0;
    const DEBOUNCE = 150;

    (window as any).__hotkey1v1Cycle = () => {
      const now = Date.now();
      if (now - lastCycleMs < DEBOUNCE) return;
      lastCycleMs = now;
      cycleRef.current();
    };
    (window as any).__hotkey1v1Swap = () => {
      const now = Date.now();
      if (now - lastSwapMs < DEBOUNCE) return;
      lastSwapMs = now;
      swapRef.current();
    };
    return () => {
      (window as any).__hotkey1v1Cycle = undefined;
      (window as any).__hotkey1v1Swap  = undefined;
    };
  }, []);

  // Re-push state to the overlay whenever it (re-)announces ready. Mirrors
  // the streak overlay handshake; covers cold-launch and reload cases.
  useEffect(() => {
    let off: (() => void) | undefined;
    listen("overlay-1v1-ready", () => {
      s.pushOverlay();
    }).then(u => { off = u; });
    return () => off?.();
  }, [s]);

  // ── Launch / close overlay ───────────────────────────────────────────────
  async function launchOverlay() {
    const existing = await WebviewWindow.getByLabel("1v1-overlay");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      existing.once("tauri://destroyed", () => {
        s.setOverlayOpen(false);
        invoke("unregister_1v1_hotkeys", {
          cycleKey: s.hotkeyCycle,
          swapKey:  s.hotkeySwap,
        }).catch(() => {});
      });
      s.setOverlayOpen(true);
      // Re-arm the global shortcuts in case they were unregistered earlier
      if (hotkey1v1Enabled) {
        await invoke("register_1v1_hotkeys", {
          cycleKey: s.hotkeyCycle,
          swapKey:  s.hotkeySwap,
        }).catch(console.error);
      }
      // Push the latest state so the overlay catches up
      s.pushOverlay();
      return;
    }
    const w = new WebviewWindow("1v1-overlay", {
      url: "index.html#1v1-overlay",
      title: "1v1 Timer Overlay",
      // Sizes match the constants in OneVOneOverlay.tsx
      width:  s.preset === "horizontal" ? 380 : s.preset === "glass" ? 420 : 90,
      height: s.preset === "horizontal" ? 90  : s.preset === "glass" ? 110 : 134,
      decorations: false,
      shadow: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      visible: false,
      skipTaskbar: false,
    });
    w.once("tauri://created", async () => {
      await w.show();
      s.setOverlayOpen(true);
      if (hotkey1v1Enabled) {
        await invoke("register_1v1_hotkeys", {
          cycleKey: s.hotkeyCycle,
          swapKey:  s.hotkeySwap,
        }).catch(console.error);
      }
      // The overlay handshake will trigger pushOverlay; nothing else needed.
    });
    w.once("tauri://destroyed", () => {
      s.setOverlayOpen(false);
      invoke("unregister_1v1_hotkeys", {
        cycleKey: s.hotkeyCycle,
        swapKey:  s.hotkeySwap,
      }).catch(() => {});
    });
  }

  async function closeOverlay() {
    const existing = await WebviewWindow.getByLabel("1v1-overlay");
    if (existing) await existing.close();
    s.setOverlayOpen(false);
    invoke("unregister_1v1_hotkeys", {
      cycleKey: s.hotkeyCycle,
      swapKey:  s.hotkeySwap,
    }).catch(() => {});
  }

  async function toggleLock() {
    const next = !s.overlayLocked;
    s.setOverlayLocked(next);
    await invoke("set_1v1_overlay_lock", { locked: next }).catch(console.error);
  }

  function handleCenter() {
    emit("1v1-overlay-center").catch(() => {});
  }

  function handleToggleHotkey(enabled: boolean) {
    setHotkey1v1Enabled(enabled);
    if (enabled) {
      if (s.overlayOpen) {
        invoke("register_1v1_hotkeys", { cycleKey: s.hotkeyCycle, swapKey: s.hotkeySwap }).catch(console.error);
      }
    } else {
      invoke("unregister_1v1_hotkeys", { cycleKey: s.hotkeyCycle, swapKey: s.hotkeySwap }).catch(console.error);
    }
  }

  // Ticking state for modern dashboard clock
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!s.running) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 50);
    return () => clearInterval(interval);
  }, [s.running]);

  const modern = appPreset === "modern";

  if (modern) {
    const liveMs = s.running && s.runStartedAt !== null ? (now - s.runStartedAt + s.accumulatedMs) : s.accumulatedMs;
    const formatToUse = s.preset === "vertical" ? formatTimeSecondsHundredths : formatTimeColons;
    const formattedTime = formatToUse(liveMs);
    const roundNum = s.score.p1 + s.score.p2 + 1;
    const activeName = s.active === "p1" ? s.players.p1 : s.players.p2;

    const handleResetActive = () => {
      use1v1.setState({
        running: false,
        runStartedAt: null,
        accumulatedMs: 0,
        lastTimeMs: { ...s.lastTimeMs, [s.active]: 0 }
      });
      use1v1.getState().pushOverlay();
    };

    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "100%",
        fontFamily: "var(--font-ui)",
        color: "white",
        animation: "pageIn 0.3s ease-out",
      }}>
        {/* Top Giant Digital Timer Card */}
        <div style={{
          background: "linear-gradient(135deg, rgba(25, 25, 35, 0.45) 0%, rgba(10, 10, 15, 0.65) 100%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "18px",
          padding: "24px",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Subtle accent glow behind timer */}
          <div style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "200px",
            height: "200px",
            background: `radial-gradient(circle, ${s.themeColor}15 0%, transparent 70%)`,
            pointerEvents: "none",
          }} />

          <span style={{
            fontSize: "11px",
            fontWeight: 800,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: s.running ? s.themeColor : "rgba(255, 255, 255, 0.4)",
            transition: "color 0.3s",
          }}>
            ROUND {roundNum} · {activeName.toUpperCase()} {s.running ? "· RUNNING" : "· PAUSED"}
          </span>

          <span className="tnum" style={{
            fontSize: "64px",
            fontWeight: 900,
            color: s.running ? "white" : "rgba(255, 255, 255, 0.8)",
            fontFamily: "var(--font-mono)",
            lineHeight: 1,
            textShadow: s.running ? `0 0 20px ${s.themeColor}88` : "none",
            transition: "color 0.3s, text-shadow 0.3s",
            margin: "8px 0",
          }}>
            {formattedTime}
          </span>

          {/* Controls */}
          <div style={{ display: "flex", gap: "12px", width: "100%", zIndex: 1 }}>
            <button
              onClick={s.cycleTimer}
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: "10px",
                background: s.running ? "rgba(240, 80, 110, 0.15)" : `${s.themeColor}22`,
                color: s.running ? "#F0506E" : s.themeColor,
                border: `1.5px solid ${s.running ? "#F0506E" : s.themeColor}`,
                fontWeight: 800,
                fontSize: "12px",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = s.running ? "rgba(240, 80, 110, 0.25)" : `${s.themeColor}33`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = s.running ? "rgba(240, 80, 110, 0.15)" : `${s.themeColor}22`;
              }}
            >
              {s.running ? "PAUSE" : (s.accumulatedMs > 0 ? "RESUME" : "START")}
            </button>
            
            <button
              onClick={handleResetActive}
              disabled={s.accumulatedMs === 0 && !s.running}
              style={{
                padding: "12px 24px",
                borderRadius: "10px",
                background: "transparent",
                color: (s.accumulatedMs > 0 || s.running) ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)",
                border: `1.5px solid ${(s.accumulatedMs > 0 || s.running) ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)"}`,
                fontWeight: 800,
                fontSize: "12px",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                cursor: (s.accumulatedMs > 0 || s.running) ? "pointer" : "default",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                if (s.accumulatedMs > 0 || s.running) {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)";
                  e.currentTarget.style.color = "white";
                }
              }}
              onMouseLeave={e => {
                if (s.accumulatedMs > 0 || s.running) {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                  e.currentTarget.style.color = "rgba(255,255,255,0.6)";
                }
              }}
            >
              RESET
            </button>
          </div>
        </div>

        {/* 2-Column Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "16px", alignItems: "start" }}>
          
          {/* Left: Match State & Preset */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            
            {/* Players & Score Card */}
            <div style={{
              background: "linear-gradient(135deg, rgba(25, 25, 35, 0.45) 0%, rgba(10, 10, 15, 0.65) 100%)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "18px",
              padding: "20px",
              boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
            }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: "16px" }}>
                Players &amp; Score
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "space-between" }}>
                  <div style={{ flex: 1 }}>
                    <PlayerInput label="P1" value={s.players.p1} onChange={v => s.setPlayerName("p1", v)} accent={s.themeColor} onCommit={s.pushOverlay} />
                  </div>
                  <ScoreControl value={s.score.p1} onBump={d => s.bumpScore("p1", d)} accent={s.themeColor} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "space-between" }}>
                  <div style={{ flex: 1 }}>
                    <PlayerInput label="P2" value={s.players.p2} onChange={v => s.setPlayerName("p2", v)} accent={s.themeColor} onCommit={s.pushOverlay} />
                  </div>
                  <ScoreControl value={s.score.p2} onBump={d => s.bumpScore("p2", d)} accent={s.themeColor} />
                </div>
              </div>

              <ResetMatchControl
                accent={s.themeColor}
                skipConfirm={s.resetSkipConfirm}
                onSkipConfirmChange={s.setResetSkipConfirm}
                onReset={() => { s.resetMatch(); toast.success("Match reset"); }}
              />
            </div>

            {/* Presets Card */}
            <div style={{
              background: "linear-gradient(135deg, rgba(25, 25, 35, 0.45) 0%, rgba(10, 10, 15, 0.65) 100%)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "18px",
              padding: "20px",
              boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
            }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: "16px" }}>
                Preset Style
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <PresetButton
                  label="Vertical"
                  description="Compact, stacked layout"
                  active={s.preset === "vertical"}
                  onClick={() => s.setPreset("vertical")}
                  accent={s.themeColor}
                  preview={<OneVOnePresetThumbnail id="vertical" active={s.preset === "vertical"} accent={s.themeColor} />}
                />
                <PresetButton
                  label="Horizontal"
                  description="Wide, broadcast-style"
                  active={s.preset === "horizontal"}
                  onClick={() => s.setPreset("horizontal")}
                  accent={s.themeColor}
                  preview={<OneVOnePresetThumbnail id="horizontal" active={s.preset === "horizontal"} accent={s.themeColor} />}
                />
                <PresetButton
                  label="Glass"
                  description="Premium translucent hud"
                  active={s.preset === "glass"}
                  onClick={() => s.setPreset("glass")}
                  accent={s.themeColor}
                  preview={<OneVOnePresetThumbnail id="glass" active={s.preset === "glass"} accent={s.themeColor} />}
                />
              </div>
            </div>

          </div>

          {/* Right: Controls & Options */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            
            {/* Overlay Settings Card */}
            <div style={{
              background: "linear-gradient(135deg, rgba(25, 25, 35, 0.45) 0%, rgba(10, 10, 15, 0.65) 100%)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "18px",
              padding: "20px",
              boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
            }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "10px" }}>
                Overlay Settings
              </div>

              {/* Action Buttons */}
              <div style={{ marginBottom: "20px" }}>
                <OverlayControlBar
                  overlayOpen={s.overlayOpen}
                  accentColor={s.themeColor}
                  onLaunch={() => { void launchOverlay(); }}
                  onClose={() => { void closeOverlay(); }}
                  locked={s.overlayLocked}
                  onToggleLock={() => { void toggleLock(); }}
                  onCenter={handleCenter}
                />
              </div>

              {/* Sliders */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                
                {/* Opacity Slider */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>Background Opacity</span>
                    <span style={{ fontSize: "11px", fontWeight: 850, fontFamily: "var(--font-mono)", color: "white" }}>
                      {s.preset === "vertical" ? s.vertBgOpacity : s.horizBgOpacity}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0} max={100} step={1}
                    value={s.preset === "vertical" ? s.vertBgOpacity : s.horizBgOpacity}
                    onChange={e => {
                      const n = Number(e.target.value);
                      if (s.preset === "vertical") s.setVertBgOpacity(n);
                      else                          s.setHorizBgOpacity(n);
                    }}
                    style={{ accentColor: s.themeColor, cursor: "pointer", width: "100%" }}
                  />
                </div>

                {/* Scale Slider */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>Overlay Scale</span>
                    <span style={{ fontSize: "11px", fontWeight: 850, fontFamily: "var(--font-mono)", color: "white" }}>
                      {Math.round(oneVOneOverlayScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5} max={2} step={0.05}
                    value={oneVOneOverlayScale}
                    onChange={e => setOneVOneOverlayScale(Number(e.target.value))}
                    style={{ accentColor: s.themeColor, cursor: "pointer", width: "100%" }}
                  />
                </div>

                {/* Accent lines toggle - horizontal preset only */}
                {s.preset === "horizontal" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <div>
                      <div style={{ color: "white", fontSize: "12px", fontWeight: 700 }}>Accent lines</div>
                      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "10px" }}>Border lines on horizontal preset</div>
                    </div>
                    {/* Small Switch */}
                    <div
                      onClick={() => s.setHorizShowLines(!s.horizShowLines)}
                      style={{
                        width: "34px", height: "19px", borderRadius: "10px", flexShrink: 0,
                        background: s.horizShowLines ? s.themeColor : "rgba(255,255,255,0.1)",
                        position: "relative", cursor: "pointer",
                        transition: "background 0.2s",
                        boxShadow: s.horizShowLines ? `0 0 8px ${s.themeColor}50` : "none",
                      }}
                    >
                      <div style={{
                        position: "absolute", top: "2.5px",
                        left: s.horizShowLines ? "17px" : "2.5px",
                        width: "14px", height: "14px", borderRadius: "50%",
                        background: "white", transition: "left 0.18s",
                      }} />
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Hotkeys Card */}
            <div style={{
              background: "linear-gradient(135deg, rgba(25, 25, 35, 0.45) 0%, rgba(10, 10, 15, 0.65) 100%)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "18px",
              padding: "20px",
              boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "10px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>1v1 Timer Hotkeys</span>
                {/* Switch for hotkeys */}
                <div
                  onClick={() => handleToggleHotkey(!hotkey1v1Enabled)}
                  style={{
                    width: "34px", height: "19px", borderRadius: "10px", flexShrink: 0,
                    background: hotkey1v1Enabled ? s.themeColor : "rgba(255,255,255,0.1)",
                    position: "relative", cursor: "pointer",
                    transition: "background 0.2s",
                    boxShadow: hotkey1v1Enabled ? `0 0 8px ${s.themeColor}50` : "none",
                  }}
                >
                  <div style={{
                    position: "absolute", top: "2.5px",
                    left: hotkey1v1Enabled ? "17px" : "2.5px",
                    width: "14px", height: "14px", borderRadius: "50%",
                    background: "white", transition: "left 0.18s",
                  }} />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <KeybindRow
                  label="Start / Stop / Reset"
                  binding={s.hotkeyCycle}
                  accent={s.themeColor}
                  ownerId="cycle"
                  enabled={hotkey1v1Enabled}
                  onCommit={k => {
                    const prev = s.hotkeyCycle;
                    s.setHotkeyCycle(k);
                    if (s.overlayOpen && hotkey1v1Enabled) {
                      invoke("unregister_1v1_hotkeys", { cycleKey: prev, swapKey: s.hotkeySwap }).catch(() => {});
                      invoke("register_1v1_hotkeys",   { cycleKey: k,   swapKey: s.hotkeySwap }).catch(console.error);
                    }
                    toast.success(`Cycle hotkey set to ${k}`);
                  }}
                />
                <KeybindRow
                  label="Swap Active Player"
                  binding={s.hotkeySwap}
                  accent={s.themeColor}
                  ownerId="swap"
                  enabled={hotkey1v1Enabled}
                  onCommit={k => {
                    const prev = s.hotkeySwap;
                    s.setHotkeySwap(k);
                    if (s.overlayOpen && hotkey1v1Enabled) {
                      invoke("unregister_1v1_hotkeys", { cycleKey: s.hotkeyCycle, swapKey: prev }).catch(() => {});
                      invoke("register_1v1_hotkeys",   { cycleKey: s.hotkeyCycle, swapKey: k    }).catch(console.error);
                    }
                    toast.success(`Swap hotkey set to ${k}`);
                  }}
                />
              </div>
            </div>

          </div>

        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      gap: "20px",
      maxWidth: "440px",
      margin: "0 auto",
      fontFamily: "var(--font-ui)",
      color: "white",
    }}>
      {/* PLAYERS section */}
      <Section title="Players" storageKey="crowsight-section-1v1-players">
        <PlayerInput label="P1" value={s.players.p1} onChange={v => s.setPlayerName("p1", v)} accent={s.themeColor} onCommit={s.pushOverlay} />
        <PlayerInput label="P2" value={s.players.p2} onChange={v => s.setPlayerName("p2", v)} accent={s.themeColor} onCommit={s.pushOverlay} />
      </Section>

      {/* SCORE section */}
      <Section title="Score" storageKey="crowsight-section-1v1-score">
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: "16px",
        }}>
          <ScoreControl value={s.score.p1} onBump={d => s.bumpScore("p1", d)} accent={s.themeColor} />
          <div style={{ color: "rgba(255,255,255,0.18)", fontSize: "18px", fontWeight: 800 }}>-</div>
          <ScoreControl value={s.score.p2} onBump={d => s.bumpScore("p2", d)} accent={s.themeColor} />
        </div>
        <ResetMatchControl
          accent={s.themeColor}
          skipConfirm={s.resetSkipConfirm}
          onSkipConfirmChange={s.setResetSkipConfirm}
          onReset={() => { s.resetMatch(); toast.success("Match reset"); }}
        />
      </Section>



      {/* PRESET section */}
      <Section title="Preset" storageKey="crowsight-section-1v1-preset">
        <div style={{ display: "flex", gap: "8px" }}>
          <PresetButton
            label="Vertical"
            description="Compact, stacked layout"
            active={s.preset === "vertical"}
            onClick={() => s.setPreset("vertical")}
            accent={s.themeColor}
            preview={<OneVOnePresetThumbnail id="vertical" active={s.preset === "vertical"} accent={s.themeColor} />}
          />
          <PresetButton
            label="Horizontal"
            description="Wide, broadcast-style"
            active={s.preset === "horizontal"}
            onClick={() => s.setPreset("horizontal")}
            accent={s.themeColor}
            preview={<OneVOnePresetThumbnail id="horizontal" active={s.preset === "horizontal"} accent={s.themeColor} />}
          />
          <PresetButton
            label="Glass"
            description="Premium translucent hud"
            active={s.preset === "glass"}
            onClick={() => s.setPreset("glass")}
            accent={s.themeColor}
            preview={<OneVOnePresetThumbnail id="glass" active={s.preset === "glass"} accent={s.themeColor} />}
          />
        </div>
      </Section>

      {/* Premium Collapsible Hotkey Hero Section */}
      <HotkeyHeroSection
        title="1v1 Timer Hotkeys"
        enabled={hotkey1v1Enabled}
        onEnabledChange={handleToggleHotkey}
        accentColor={s.themeColor}
        storageKey="crowsight-hotkey-collapse-1v1"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <KeybindRow
            label="Start / Stop / Reset Timer"
            binding={s.hotkeyCycle}
            accent={s.themeColor}
            ownerId="cycle"
            enabled={hotkey1v1Enabled}
            onCommit={k => {
              const prev = s.hotkeyCycle;
              s.setHotkeyCycle(k);
              if (s.overlayOpen && hotkey1v1Enabled) {
                invoke("unregister_1v1_hotkeys", { cycleKey: prev, swapKey: s.hotkeySwap }).catch(() => {});
                invoke("register_1v1_hotkeys",   { cycleKey: k,   swapKey: s.hotkeySwap }).catch(console.error);
              }
              toast.success(`Cycle hotkey set to ${k}`);
            }}
          />
          {s.hotkeyCycle !== DEFAULT_HOTKEY_CYCLE && (
            <KeybindResetButton
              label={`Reset to ${DEFAULT_HOTKEY_CYCLE}`}
              onReset={() => {
                const prev = s.hotkeyCycle;
                s.setHotkeyCycle(DEFAULT_HOTKEY_CYCLE);
                if (s.overlayOpen && hotkey1v1Enabled) {
                  invoke("unregister_1v1_hotkeys", { cycleKey: prev, swapKey: s.hotkeySwap }).catch(() => {});
                  invoke("register_1v1_hotkeys",   { cycleKey: DEFAULT_HOTKEY_CYCLE, swapKey: s.hotkeySwap }).catch(console.error);
                }
                toast.success(`Reset to ${DEFAULT_HOTKEY_CYCLE}`);
              }}
            />
          )}
          <KeybindRow
            label="Swap Active Player"
            binding={s.hotkeySwap}
            accent={s.themeColor}
            ownerId="swap"
            enabled={hotkey1v1Enabled}
            onCommit={k => {
              const prev = s.hotkeySwap;
              s.setHotkeySwap(k);
              if (s.overlayOpen && hotkey1v1Enabled) {
                invoke("unregister_1v1_hotkeys", { cycleKey: s.hotkeyCycle, swapKey: prev }).catch(() => {});
                invoke("register_1v1_hotkeys",   { cycleKey: s.hotkeyCycle, swapKey: k    }).catch(console.error);
              }
              toast.success(`Swap hotkey set to ${k}`);
            }}
          />
          {s.hotkeySwap !== DEFAULT_HOTKEY_SWAP && (
            <KeybindResetButton
              label={`Reset to ${DEFAULT_HOTKEY_SWAP}`}
              onReset={() => {
                const prev = s.hotkeySwap;
                s.setHotkeySwap(DEFAULT_HOTKEY_SWAP);
                if (s.overlayOpen && hotkey1v1Enabled) {
                   invoke("unregister_1v1_hotkeys", { cycleKey: s.hotkeyCycle, swapKey: prev }).catch(() => {});
                   invoke("register_1v1_hotkeys",   { cycleKey: s.hotkeyCycle, swapKey: DEFAULT_HOTKEY_SWAP }).catch(console.error);
                }
                toast.success(`Reset to ${DEFAULT_HOTKEY_SWAP}`);
              }}
            />
          )}
        </div>
      </HotkeyHeroSection>

      {/* APPEARANCE */}
      <Section title="Appearance" storageKey="crowsight-section-1v1-appearance">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Background opacity slider - reads/writes the active preset's own value */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{
                color: "rgba(255,255,255,0.45)", fontSize: "11px", fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase",
              }}>Background Opacity</span>
              <EditableValueChip
                value={s.preset === "vertical" ? s.vertBgOpacity : s.horizBgOpacity}
                min={0} max={100} suffix="%"
                onCommit={n => {
                  if (s.preset === "vertical") s.setVertBgOpacity(n);
                  else                          s.setHorizBgOpacity(n);
                }}
                style={{
                  color: "white", fontSize: "12px", fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                  background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "5px", padding: "2px 8px",
                  fontFamily: "var(--font-mono)",
                }}
                inputWidth={52}
                ariaLabel={`${s.preset === "vertical" ? "Vertical" : "Horizontal/Glass"} background opacity`}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "10px", fontWeight: 700 }}>0</span>
              <input
                type="range"
                min={0} max={100} step={1}
                value={s.preset === "vertical" ? s.vertBgOpacity : s.horizBgOpacity}
                onChange={e => {
                  const n = Number(e.target.value);
                  if (s.preset === "vertical") s.setVertBgOpacity(n);
                  else                          s.setHorizBgOpacity(n);
                }}
                style={{ flex: 1, accentColor: s.themeColor, cursor: "pointer" }}
              />
              <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "10px", fontWeight: 700 }}>100</span>
            </div>
          </div>

          {/* Accent lines toggle - horizontal preset only */}
          {s.preset === "horizontal" && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
              }}>
              <div>
                <div style={{
                  color: "rgba(255,255,255,0.85)", fontSize: "12px", fontWeight: 700,
                  fontFamily: "var(--font-ui)",
                }}>Top &amp; bottom accent lines</div>
                <div style={{
                  color: "rgba(255,255,255,0.3)", fontSize: "10.5px",
                  fontFamily: "var(--font-ui)", marginTop: "2px",
                }}>Thin gradient bars along the top and bottom edges</div>
              </div>
              {/* Toggle pill */}
              <div
                onClick={() => s.setHorizShowLines(!s.horizShowLines)}
                style={{
                  width: "40px", height: "22px", borderRadius: "11px", flexShrink: 0,
                  background: s.horizShowLines ? s.themeColor : "rgba(255,255,255,0.1)",
                  position: "relative", cursor: "pointer",
                  transition: "background 0.2s",
                }}
              >
                <div style={{
                  position: "absolute", top: "3px",
                  left: s.horizShowLines ? "21px" : "3px",
                  width: "16px", height: "16px",
                  borderRadius: "50%", background: "white",
                  transition: "left 0.2s",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                }} />
              </div>
            </div>
            )}

        </div>
      </Section>

      {/* OVERLAY SCALE - applies to all presets */}
      <Section title="Overlay Scale" storageKey="crowsight-section-1v1-scale">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{
              color: "rgba(255,255,255,0.45)", fontSize: "11px", fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>Scale</span>
            <EditableValueChip
              value={Math.round(oneVOneOverlayScale * 100)} min={50} max={200} suffix="%"
              onCommit={pct => setOneVOneOverlayScale(Math.min(2, Math.max(0.5, pct / 100)))}
              style={{
                color: "white", fontSize: "12px", fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "5px", padding: "2px 8px",
                fontFamily: "var(--font-mono)",
              }}
              inputWidth={52}
              ariaLabel="1v1 overlay scale"
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "10px", fontWeight: 700 }}>50%</span>
            <input
              type="range"
              min={0.5} max={2} step={0.05}
              value={oneVOneOverlayScale}
              onChange={e => setOneVOneOverlayScale(Number(e.target.value))}
              style={{ flex: 1, accentColor: s.themeColor, cursor: "pointer" }}
            />
            <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "10px", fontWeight: 700 }}>200%</span>
          </div>
        </div>
      </Section>

      {/* Launch + lock buttons */}
      <OverlayControlBar
        overlayOpen={s.overlayOpen}
        accentColor={s.themeColor}
        onLaunch={() => { void launchOverlay(); }}
        onClose={() => { void closeOverlay(); }}
        locked={s.overlayLocked}
        onToggleLock={() => { void toggleLock(); }}
        onCenter={handleCenter}
      />
    </div>
  );
}

// ─── Reusable section wrapper ───────────────────────────────────────────────
function Section({ title, storageKey, children }: {
  title: string; storageKey: string; children: React.ReactNode;
}) {
  const themeColor = use1v1(s => s.themeColor);
  return (
    <PremiumSection title={title} accentColor={themeColor} storageKey={storageKey}>
      {children}
    </PremiumSection>
  );
}

// ─── Player input row (P1/P2 badge + editable name) ─────────────────────────
function PlayerInput({ label, value, onChange, accent, onCommit }: {
  label: string; value: string; onChange: (v: string) => void; accent: string; onCommit: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{
        minWidth: "28px", height: "22px",
        padding: "0 8px",
        borderRadius: "5px",
        background: `${accent}1F`,
        border: `1px solid ${accent}55`,
        color: accent,
        fontSize: "10px", fontWeight: 800,
        letterSpacing: "0.04em",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>{label}</div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onCommit}
        maxLength={40}
        style={{
          flex: 1,
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "6px",
          padding: "8px 12px",
          color: "white",
          fontSize: "13px", fontWeight: 600,
          fontFamily: "var(--font-ui)",
          outline: "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onFocus={e => { e.currentTarget.style.borderColor = `${accent}66`; e.currentTarget.style.boxShadow = `0 0 0 2px ${accent}1A`; }}
        onBlurCapture={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}
      />
    </div>
  );
}

// ─── Score -/+ control ──────────────────────────────────────────────────────
function ScoreControl({ value, onBump, accent }: {
  value: number; onBump: (d: number) => void; accent: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <ScoreButton onClick={() => onBump(-1)} accent={accent}>−</ScoreButton>
      <div style={{
        minWidth: "30px",
        textAlign: "center",
        fontSize: "26px", fontWeight: 900,
        color: "white",
        fontVariantNumeric: "tabular-nums",
        textShadow: "0 1px 4px rgba(0,0,0,0.4)",
      }}>{value}</div>
      <ScoreButton onClick={() => onBump(1)} accent={accent}>+</ScoreButton>
    </div>
  );
}

function ScoreButton({ onClick, accent, children }: {
  onClick: () => void; accent: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "26px", height: "26px",
        borderRadius: "6px",
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.65)",
        fontSize: "16px", fontWeight: 800,
        lineHeight: 1,
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s",
        fontFamily: "var(--font-ui)",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = `${accent}66`; e.currentTarget.style.color = accent; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
    >{children}</button>
  );
}

// ─── Keybind rebinder ──────────────────────────────────────────────────────
// Click → "Press a key..." state → next physical key sets the binding.
// Pauses the OS-level binding while capturing so the currently-bound key
// reaches the webview locally. Supports modifier chords (Ctrl+F1, etc.).
function KeybindRow({ label, binding, accent, onCommit, ownerId, enabled = true }: {
  label: string; binding: string; accent: string;
  onCommit: (key: string) => void;
  /** Identifies which 1v1 hotkey this row owns - used for conflict detection. */
  ownerId: "cycle" | "swap";
  enabled?: boolean;
}) {
  const [capturing, setCapturing] = useState(false);
  const pausedKey = useRef<string>("");
  const overlayWasOpen = useRef(false);
  // Stable ref for onCommit - the parent (OneVOneTimer) creates a fresh
  // arrow function every render, so depending on it in useEffect would
  // detach + reattach the keydown listener on every render and lose the
  // very keystroke we're trying to capture.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  async function startCapture() {
    pausedKey.current = binding;
    overlayWasOpen.current = use1v1.getState().overlayOpen;
    console.log("[hotkey] start: pausing", binding, "overlayOpen:", overlayWasOpen.current);
    if (overlayWasOpen.current) {
      try {
        await invoke("unregister_hotkey", { key: binding });
        await new Promise(r => setTimeout(r, 50));
      } catch (e) {
        console.error("[hotkey] unregister_hotkey failed:", e);
      }
    }
    setCapturing(true);
    requestAnimationFrame(() => {
      const b = document.body;
      if (b.tabIndex < 0) b.tabIndex = -1;
      (document.activeElement as HTMLElement | null)?.blur?.();
      b.focus();
    });
  }

  function cancelCapture() {
    if (overlayWasOpen.current && pausedKey.current) {
      console.log("[hotkey] cancel: restoring 1v1 bindings");
      const v = use1v1.getState();
      invoke("register_1v1_hotkeys", {
        cycleKey: v.hotkeyCycle,
        swapKey:  v.hotkeySwap,
      }).catch(console.error);
    }
    setCapturing(false);
  }

  useEffect(() => {
    if (!capturing) return;
    let committed = false;

    function tryCommit(chord: string | null) {
      if (committed || !chord) return;
      const weak = validateHotkeyStrength(chord);
      if (weak) { toast(weak, { kind: "warn" }); committed = true; cancelCapture(); return; }
      const clash = findConflict(chord, ownerId);
      if (clash) {
        toast(`${chord} is already used by ${clash.label}`, { kind: "warn" });
        committed = true;
        cancelCapture();
        return;
      }
      committed = true;
      console.log("[hotkey] commit:", chord);
      onCommitRef.current(chord);
      setCapturing(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") { cancelCapture(); return; }
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
  }, [capturing, ownerId]);

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
      padding: "6px 0",
    }}>
      <div style={{
        flex: 1,
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "6px",
        padding: "9px 12px",
        color: enabled ? "rgba(255,255,255,0.85)" : "#555560",
        fontSize: "12.5px", fontWeight: 600,
      }}>{label}</div>
      <button
        disabled={!enabled}
        onClick={() => (capturing ? cancelCapture() : startCapture())}
        style={{
          minWidth: "62px", padding: "9px 14px",
          background: capturing ? `${accent}22` : "transparent",
          border: `1.5px solid ${capturing ? accent : (enabled ? `${accent}66` : "rgba(255,255,255,0.06)")}`,
          borderRadius: "6px",
          color: enabled ? (capturing ? "white" : accent) : "#444450",
          fontSize: "12px", fontWeight: 800,
          letterSpacing: "0.05em",
          cursor: enabled ? "pointer" : "default",
          fontFamily: "var(--font-ui)",
          transition: "all 0.15s",
        }}
      >
        {capturing ? "PRESS…" : binding}
      </button>
    </div>
  );
}

// ─── Preset thumbnail ───────────────────────────────────────────────────────
// Tiny CSS-only mock of each 1v1 overlay layout so the picker shows the real
// footprint, not just a label. Mirrors OneVOneOverlay: vertical = tall stacked
// column with a left accent bar + center score pill; horizontal = wide
// broadcast bar (P1 | SCORE pill | P2) with accent edge lines; glass = frosted
// card with an animated-look gradient ring + center VS pill.
function OneVOnePresetThumbnail({ id, active, accent }: {
  id: Preset; active: boolean; accent: string;
}) {
  const border = active ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.08)";
  const dim = "rgba(255,255,255,0.4)";
  if (id === "vertical") {
    return (
      <div style={{
        height: "100%", aspectRatio: "90 / 134", flexShrink: 0,
        background: "rgba(10,10,14,0.92)", borderRadius: "5px", border,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", left: 0, top: "7%", width: "5%", height: "38%", background: accent, borderRadius: "0 2px 2px 0", boxShadow: `0 0 5px ${accent}AA` }} />
        {/* P1 name + active time */}
        <div style={{ position: "absolute", top: "11%", left: "16%", width: "52%", height: "5%", background: "rgba(255,255,255,0.5)", borderRadius: "2px" }} />
        <div style={{ position: "absolute", top: "19%", left: "16%", width: "70%", height: "14%", background: accent, borderRadius: "3px", boxShadow: `0 0 6px ${accent}88` }} />
        {/* score pill */}
        <div style={{ position: "absolute", top: "44%", left: "50%", transform: "translateX(-50%)", width: "60%", height: "12%", background: accent, borderRadius: "3px" }} />
        {/* P2 name + idle time */}
        <div style={{ position: "absolute", top: "65%", left: "16%", width: "52%", height: "5%", background: "rgba(255,255,255,0.45)", borderRadius: "2px" }} />
        <div style={{ position: "absolute", top: "73%", left: "16%", width: "70%", height: "14%", background: dim, borderRadius: "3px" }} />
      </div>
    );
  }
  if (id === "horizontal") {
    return (
      <div style={{
        width: "100%", aspectRatio: "380 / 90",
        background: "linear-gradient(135deg, rgba(8,8,12,0.92), rgba(20,20,28,0.92))",
        borderRadius: "10px", border: active ? `1px solid ${accent}` : `1px solid ${accent}33`,
        boxShadow: `0 0 10px ${accent}1A`, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3%", background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "3%", background: `linear-gradient(90deg, transparent, ${accent}80, transparent)` }} />
        {/* P1 */}
        <div style={{ position: "absolute", top: "26%", left: "5%", width: "22%", height: "8%", background: "rgba(255,255,255,0.6)", borderRadius: "2px" }} />
        <div style={{ position: "absolute", top: "42%", left: "5%", width: "28%", height: "26%", background: accent, borderRadius: "3px", boxShadow: `0 0 8px ${accent}88` }} />
        {/* center SCORE label + pill */}
        <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: "13%", height: "7%", background: "rgba(255,255,255,0.3)", borderRadius: "2px" }} />
        <div style={{ position: "absolute", top: "40%", left: "50%", transform: "translateX(-50%)", width: "21%", height: "30%", background: accent, borderRadius: "4px" }} />
        {/* P2 */}
        <div style={{ position: "absolute", top: "26%", right: "5%", width: "22%", height: "8%", background: "rgba(255,255,255,0.45)", borderRadius: "2px" }} />
        <div style={{ position: "absolute", top: "42%", right: "5%", width: "28%", height: "26%", background: dim, borderRadius: "3px" }} />
      </div>
    );
  }
  // glass
  return (
    <div style={{
      width: "100%", aspectRatio: "400 / 110", borderRadius: "12px", border,
      position: "relative", overflow: "hidden", background: "rgba(6,6,10,0.4)",
    }}>
      {/* gradient ring + frosted inner */}
      <div style={{ position: "absolute", inset: "8%", borderRadius: "14px", padding: "1.5px", background: `linear-gradient(270deg, ${accent}AA, rgba(255,255,255,0.25), ${accent}AA)`, boxShadow: `0 0 6px ${accent}55` }}>
        <div style={{ width: "100%", height: "100%", borderRadius: "12px", background: "rgba(10,10,15,0.85)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at center, ${accent}2A 0%, transparent 60%)` }} />
        </div>
      </div>
      {/* P1 */}
      <div style={{ position: "absolute", top: "33%", left: "12%", width: "18%", height: "8%", background: "rgba(255,255,255,0.6)", borderRadius: "2px" }} />
      <div style={{ position: "absolute", top: "48%", left: "12%", width: "24%", height: "22%", background: accent, borderRadius: "3px", boxShadow: `0 0 8px ${accent}88` }} />
      {/* center VS pill */}
      <div style={{ position: "absolute", top: "38%", left: "50%", transform: "translateX(-50%)", width: "22%", height: "32%", background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "30px" }} />
      {/* P2 */}
      <div style={{ position: "absolute", top: "33%", right: "12%", width: "18%", height: "8%", background: "rgba(255,255,255,0.45)", borderRadius: "2px" }} />
      <div style={{ position: "absolute", top: "48%", right: "12%", width: "24%", height: "22%", background: dim, borderRadius: "3px" }} />
    </div>
  );
}

// ─── Preset selector button ─────────────────────────────────────────────────
function PresetButton({ label, description, active, onClick, accent, preview }: {
  label: string; description: string; active: boolean; onClick: () => void; accent: string;
  preview?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "14px",
        background: active ? `${accent}1F` : "rgba(0,0,0,0.25)",
        border: `1px solid ${active ? accent : "rgba(255,255,255,0.06)"}`,
        borderRadius: "8px",
        cursor: "pointer",
        textAlign: "center",
        transition: "all 0.15s",
        fontFamily: "var(--font-ui)",
        display: "flex", flexDirection: "column", gap: "12px",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
    >
      {/* Fixed-height stage centers each thumbnail so the row reads evenly even
          though vertical is tall and horizontal/glass are wide-and-short. */}
      <div style={{ height: "84px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {preview}
      </div>
      <div>
        <div style={{
          fontSize: "13px", fontWeight: 800,
          color: active ? accent : "white",
          letterSpacing: "0.06em", textTransform: "uppercase",
          marginBottom: "4px",
        }}>{label}</div>
        <div style={{
          fontSize: "10.5px", color: "rgba(255,255,255,0.45)", lineHeight: 1.35,
        }}>{description}</div>
      </div>
    </button>
  );
}

// ─── Helper exports (kept so we don't tree-shake the Preset type away) ─────
export type { Preset };
