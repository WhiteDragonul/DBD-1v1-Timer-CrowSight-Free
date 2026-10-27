// 1v1 Timer - standalone app shell.
//
// One window, one page: the 1v1 Timer control panel (ported verbatim from
// CrowSight) plus an Appearance panel for the accent color and the
// classic/modern visual preset. No account, no sign-in - every preference
// lives in localStorage. The only network call is the startup update check
// against this repo's GitHub Releases (see components/UpdateBanner).
//
// The window is `decorations: false`, so the header below IS the title bar:
// it carries data-tauri-drag-region and hosts our own min/max/close buttons.

import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTheme } from "./theme";
import { THEME_COLORS } from "./OneVOne";
import { mountLowlevelBridge } from "./lib/lowlevelBridge";
import { openDiscordInvite, openWebsite } from "./lib/links";
import OneVOneTimer from "./OneVOneTimer";
import DSTimer from "./DSTimer";
import Crosshair from "./Crosshair";
import PremiumSection from "./components/PremiumSection";
import UpdateBanner from "./components/UpdateBanner";
import { ToastHost } from "./Toast";

// ─── Pages ───────────────────────────────────────────────────────────────────
// Everything here is free and account-less, so there is no gate: the tab strip
// is the whole navigation model.
type Page = "1v1" | "perk-timer" | "crosshair";

const PAGES: { id: Page; label: string; blurb: string }[] = [
  { id: "1v1",        label: "1v1 Timer",   blurb: "Match timer overlay with hotkeys and scoring" },
  { id: "perk-timer", label: "Perk Timer",  blurb: "Endurance + Elusive countdown overlay" },
  { id: "crosshair",  label: "Crosshair",   blurb: "Click-through crosshair at screen center" },
];

const PAGE_KEY = "1v1-page";

function readStoredPage(): Page {
  try {
    const v = localStorage.getItem(PAGE_KEY);
    if (PAGES.some(p => p.id === v)) return v as Page;
  } catch { /* non-fatal */ }
  return "1v1";
}

// ─── Tab strip ───────────────────────────────────────────────────────────────
function NavTabs({ page, onChange, accent }: {
  page: Page; onChange: (p: Page) => void; accent: string;
}) {
  return (
    <nav
      data-tauri-drag-region="false"
      onMouseDown={e => e.stopPropagation()}
      style={{
        display: "flex", gap: "6px", flexShrink: 0,
        padding: "10px 28px",
        background: "var(--surface-1)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {PAGES.map(p => {
        const active = p.id === page;
        return (
          <button
            key={p.id}
            title={p.blurb}
            onClick={() => onChange(p.id)}
            style={{
              padding: "8px 16px", borderRadius: "9px",
              background: active ? `${accent}1F` : "transparent",
              border: `1px solid ${active ? accent : "transparent"}`,
              color: active ? accent : "rgba(255,255,255,0.55)",
              fontSize: "11.5px", fontWeight: 800,
              letterSpacing: "0.05em", textTransform: "uppercase",
              fontFamily: "var(--font-ui)",
              cursor: "pointer", transition: "all 0.15s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
          >
            {p.label}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Logo mark ───────────────────────────────────────────────────────────────
function LogoMark({ accent }: { accent: string }) {
  return (
    // drop-shadow follows visible pixels (the circle) - no rectangle glow
    <div style={{
      flexShrink: 0,
      filter: `drop-shadow(0 0 8px ${accent}90) drop-shadow(0 0 3px ${accent}70)`,
    }}>
      <img
        src="/logo-transparent.png"
        alt=""
        style={{ width: "36px", height: "36px", display: "block", objectFit: "contain" }}
      />
    </div>
  );
}

// ─── Custom window controls (min / max / close) ──────────────────────────────
// Replaces the native Windows title-bar buttons since decorations:false is set
// on the main window. Subtle hover states; close button turns red on hover.
function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const w = getCurrentWindow();
    w.isMaximized().then(setIsMaximized).catch(() => {});
    const unlistenPromise = w.onResized(() => {
      w.isMaximized().then(setIsMaximized).catch(() => {});
    });
    return () => { unlistenPromise.then(fn => fn()).catch(() => {}); };
  }, []);

  const btnBase: React.CSSProperties = {
    width: "44px", height: "32px",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "transparent", border: "none", cursor: "pointer",
    color: "rgba(255,255,255,0.55)",
    transition: "background 0.12s, color 0.12s",
    padding: 0, borderRadius: 0, flexShrink: 0,
  };

  // Stop the mousedown from bubbling to the header's drag region - otherwise
  // Tauri starts dragging the window instead of letting the button click.
  const stopDrag = (e: React.MouseEvent) => { e.stopPropagation(); };

  return (
    <div
      data-tauri-drag-region="false"
      onMouseDown={stopDrag}
      style={{ display: "flex", flexShrink: 0, marginLeft: "8px", height: "52px" }}
    >
      <button
        title="Minimize"
        style={btnBase}
        data-tauri-drag-region="false"
        onMouseDown={stopDrag}
        onClick={() => getCurrentWindow().minimize().catch(console.error)}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "white"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ pointerEvents: "none" }}>
          <rect x="1.5" y="5.5" width="9" height="1" fill="currentColor" />
        </svg>
      </button>

      <button
        title={isMaximized ? "Restore" : "Maximize"}
        style={btnBase}
        data-tauri-drag-region="false"
        onMouseDown={stopDrag}
        onClick={() => getCurrentWindow().toggleMaximize().catch(console.error)}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "white"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
      >
        {isMaximized ? (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" style={{ pointerEvents: "none" }}>
            <rect x="2" y="3.5" width="6.5" height="6.5" />
            <path d="M3.5 3.5 V2 H10 V8.5 H8.5" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" style={{ pointerEvents: "none" }}>
            <rect x="1.5" y="1.5" width="9" height="9" />
          </svg>
        )}
      </button>

      <button
        title="Close"
        style={btnBase}
        data-tauri-drag-region="false"
        onMouseDown={stopDrag}
        onClick={() => getCurrentWindow().close().catch(console.error)}
        onMouseEnter={e => { e.currentTarget.style.background = "#E81123"; e.currentTarget.style.color = "white"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" style={{ pointerEvents: "none" }}>
          <line x1="2" y1="2" x2="10" y2="10" />
          <line x1="10" y1="2" x2="2" y2="10" />
        </svg>
      </button>
    </div>
  );
}

// ─── Header link pill (Discord / Website) ────────────────────────────────────
function LinkPill({ label, accent, icon, onClick }: {
  label: string; accent: string; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-tauri-drag-region="false"
      onMouseDown={e => e.stopPropagation()}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        padding: "7px 13px", borderRadius: "8px",
        background: `${accent}14`,
        border: `1px solid ${accent}3D`,
        color: accent,
        fontSize: "11.5px", fontWeight: 700,
        letterSpacing: "0.02em",
        fontFamily: "var(--font-ui)",
        cursor: "pointer",
        transition: "all 0.18s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = `${accent}28`; e.currentTarget.style.boxShadow = `0 4px 16px ${accent}33`; }}
      onMouseLeave={e => { e.currentTarget.style.background = `${accent}14`; e.currentTarget.style.boxShadow = "none"; }}
    >
      {icon}
      {label}
    </button>
  );
}

const DiscordIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ pointerEvents: "none", flexShrink: 0 }}>
    <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.644-1.873.891a.077.077 0 0 0-.041.107c.36.699.772 1.364 1.225 1.994a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-5.177-.838-9.673-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z" />
  </svg>
);

const GlobeIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none", flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
  </svg>
);

// ─── Accent color card ───────────────────────────────────────────────────────
// The store write is debounced so dragging the native picker doesn't flood
// every subscriber (and, through pushOverlay, the overlay window) with an
// event per frame. The <input type="color"> is deliberately uncontrolled:
// re-applying `value` on every drag tick made Chromium's picker re-sync each
// frame and stutter.
function AccentColorCard({ value, onChange }: {
  value: string; onChange: (c: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value);

  // Sync only on an EXTERNAL change (preset swatch, Reset) - never mid-drag.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    setLocal(value);
    if (inputRef.current) inputRef.current.value = value;
  }, [value]);

  const handleChange = useCallback((color: string) => {
    setLocal(color);                       // instant swatch update
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {     // debounced store write
      lastEmitted.current = color;
      onChange(color);
    }, 60);
  }, [onChange]);

  const commitPreset = (color: string) => {
    lastEmitted.current = color;
    setLocal(color);
    if (inputRef.current) inputRef.current.value = color;
    onChange(color);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
      }}>
        <div>
          <div style={{ color: "#ECECEC", fontSize: "12.5px", fontWeight: 700 }}>
            Accent color
          </div>
          <div style={{ color: "var(--ink-3)", fontSize: "10.5px", marginTop: "2px", lineHeight: 1.4 }}>
            Drives the app UI and every element of the overlay
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <span style={{ color: "var(--ink-3)", fontSize: "10.5px", fontFamily: "var(--font-mono)" }}>
            {local.toUpperCase()}
          </span>
          <label style={{ position: "relative", cursor: "pointer", display: "block" }}>
            <div style={{
              width: "32px", height: "32px", borderRadius: "7px",
              background: local, border: "2px solid rgba(255,255,255,0.12)",
              boxShadow: `0 0 12px ${local}66`,
            }} />
            <input
              ref={inputRef}
              type="color"
              defaultValue={value}
              onChange={e => handleChange(e.target.value)}
              aria-label="Accent color"
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
            />
          </label>
        </div>
      </div>

      {/* Quick presets */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        {THEME_COLORS.map(c => {
          const active = c.color.toLowerCase() === local.toLowerCase();
          return (
            <button
              key={c.id}
              title={c.label}
              onClick={() => commitPreset(c.color)}
              style={{
                width: "26px", height: "26px", borderRadius: "50%",
                background: c.color,
                border: active ? "2px solid white" : "2px solid rgba(255,255,255,0.14)",
                boxShadow: active ? `0 0 12px ${c.color}AA` : "none",
                cursor: "pointer", padding: 0,
                transition: "all 0.15s",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Appearance panel ────────────────────────────────────────────────────────
function AppearancePanel() {
  const {
    accentColor, setAccentColor,
    appPreset, setAppPreset,
    premiumGlowEffects, setPremiumGlowEffects,
  } = useTheme();

  return (
    <PremiumSection title="Appearance" accentColor={accentColor} storageKey="1v1-section-appearance">
      <AccentColorCard value={accentColor} onChange={setAccentColor} />

      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)" }} />

      {/* Visual preset */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
      }}>
        <div>
          <div style={{ color: "#ECECEC", fontSize: "12.5px", fontWeight: 700 }}>Visual preset</div>
          <div style={{ color: "var(--ink-3)", fontSize: "10.5px", marginTop: "2px", lineHeight: 1.4 }}>
            Classic is the flat dark look; Modern is the liquid-glass reskin
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          {(["classic", "modern"] as const).map(p => {
            const active = appPreset === p;
            return (
              <button
                key={p}
                onClick={() => setAppPreset(p)}
                style={{
                  padding: "7px 14px", borderRadius: "8px",
                  background: active ? `${accentColor}1F` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${active ? accentColor : "rgba(255,255,255,0.08)"}`,
                  color: active ? accentColor : "rgba(255,255,255,0.55)",
                  fontSize: "11px", fontWeight: 800,
                  letterSpacing: "0.05em", textTransform: "uppercase",
                  cursor: "pointer", transition: "all 0.15s",
                  fontFamily: "var(--font-ui)",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)" }} />

      {/* Glow effects */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
      }}>
        <div>
          <div style={{ color: "#ECECEC", fontSize: "12.5px", fontWeight: 700 }}>Panel glow</div>
          <div style={{ color: "var(--ink-3)", fontSize: "10.5px", marginTop: "2px", lineHeight: 1.4 }}>
            The pulsing accent line across the top of each panel
          </div>
        </div>
        <div
          onClick={() => setPremiumGlowEffects(!premiumGlowEffects)}
          style={{
            width: "40px", height: "22px", borderRadius: "11px", flexShrink: 0,
            background: premiumGlowEffects ? accentColor : "rgba(255,255,255,0.1)",
            position: "relative", cursor: "pointer",
            transition: "background 0.2s",
          }}
        >
          <div style={{
            position: "absolute", top: "3px",
            left: premiumGlowEffects ? "21px" : "3px",
            width: "16px", height: "16px",
            borderRadius: "50%", background: "white",
            transition: "left 0.2s",
            boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }} />
        </div>
      </div>
    </PremiumSection>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const accentColor = useTheme(s => s.accentColor);
  const appPreset   = useTheme(s => s.appPreset);
  const modern      = appPreset === "modern";

  const [page, setPage] = useState<Page>(readStoredPage);
  useEffect(() => {
    try { localStorage.setItem(PAGE_KEY, page); } catch { /* non-fatal */ }
  }, [page]);

  useEffect(() => {
    // Push the persisted bare-key modifier switches to the Rust hook so the
    // preference survives restarts.
    const { bareModCtrl, bareModAlt, bareModShift } = useTheme.getState();
    invoke("set_bare_modifiers", { ctrl: bareModCtrl, alt: bareModAlt, shift: bareModShift })
      .catch(console.error);

    // Wire the low-level hook → JS handler bridge. Every binding (F-keys,
    // bare keys, mouse buttons, wheel) fans in here.
    const teardown = mountLowlevelBridge();
    return () => { teardown(); };
  }, []);

  const glassBlur = modern ? "blur(22px) saturate(150%)" : "none";

  return (
    <div data-app-preset={appPreset} style={{
      display: "flex", flexDirection: "column",
      width: "100vw", height: "100vh",
      background: modern
        ? `radial-gradient(900px 540px at 82% -8%, ${accentColor}22, transparent 60%),`
          + ` radial-gradient(700px 600px at -6% 108%, rgba(70,90,160,0.16), transparent 60%),`
          + ` radial-gradient(1200px 800px at 50% 50%, #0c0c12 0%, #07070b 70%, #050507 100%)`
        : "linear-gradient(135deg, #09090E 0%, #161622 100%)",
      color: "white",
      fontFamily: "var(--font-ui)",
      overflow: "hidden",
    }}>
      <style>{`
        :root { --accent-color: ${accentColor}; }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 0; }
        ::-webkit-scrollbar:horizontal { display: none; height: 0; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
        ::-webkit-scrollbar-corner { background: transparent; }
        ::-webkit-resizer { background: transparent; display: none; }
      `}</style>

      {/* ── Title bar ── */}
      <header
        data-tauri-drag-region
        style={{
          height: "52px", flexShrink: 0,
          display: "flex", alignItems: "center",
          padding: "0 0 0 18px",
          background: "var(--surface-1)",
          backdropFilter: glassBlur,
          WebkitBackdropFilter: glassBlur,
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 4px 30px rgba(0, 0, 0, 0.2)",
          position: "relative",
          zIndex: "var(--z-sticky)",
          gap: "12px",
        }}>
        {/* Top accent line: 1px gradient running across the very top edge */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "1px",
          background: `linear-gradient(90deg, transparent, ${accentColor}80, transparent)`,
          pointerEvents: "none",
        }} />

        <LogoMark accent={accentColor} />
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
          <span style={{
            fontSize: "13px", fontWeight: 800, color: "white",
            letterSpacing: "-0.01em", whiteSpace: "nowrap", lineHeight: 1.1,
          }}>CrowSight</span>
          <span style={{
            fontSize: "9px", fontWeight: 700, color: "rgba(255,255,255,0.4)",
            letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap",
          }}>Free - Edition</span>
        </div>

        <div style={{ flex: 1 }} />

        <div
          data-tauri-drag-region="false"
          onMouseDown={e => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <LinkPill label="Discord" accent="#5865F2" icon={DiscordIcon}
            onClick={() => { openDiscordInvite().catch(() => {}); }} />
          <LinkPill label="Website" accent={accentColor} icon={GlobeIcon}
            onClick={() => { openWebsite().catch(() => {}); }} />
        </div>

        <WindowControls />
      </header>

      <UpdateBanner />

      <NavTabs page={page} onChange={setPage} accent={accentColor} />

      {/* ── Content ──
          Every page stays MOUNTED and is hidden with display:none rather than
          unmounted. The Perk Timer owns the window.__hotkeyDS handler and the
          overlay's event listeners; unmounting it on a tab switch would make
          the hotkey silently do nothing while the OS binding was still live. */}
      <main style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        padding: "24px 28px 32px",
      }}>
        {/* Classic keeps the timer's original 440px column, so the Appearance
            panel is constrained to match. Modern uses the full-width grid. */}
        <div style={{
          display: page === "1v1" ? "flex" : "none",
          flexDirection: "column", gap: "20px",
          maxWidth: modern ? "1100px" : "440px",
          margin: "0 auto",
        }}>
          <OneVOneTimer />
          <AppearancePanel />
        </div>

        <div style={{
          display: page === "perk-timer" ? "flex" : "none",
          flexDirection: "column",
          maxWidth: modern ? "1100px" : "620px",
          margin: "0 auto",
        }}>
          <DSTimer />
        </div>

        <div style={{
          display: page === "crosshair" ? "flex" : "none",
          flexDirection: "column",
          maxWidth: modern ? "1100px" : "620px",
          margin: "0 auto",
        }}>
          <Crosshair />
        </div>
      </main>

      <ToastHost />
    </div>
  );
}
