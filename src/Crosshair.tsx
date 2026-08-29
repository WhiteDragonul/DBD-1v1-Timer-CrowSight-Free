// Crosshair - control page for the in-app vector crosshair overlay. Configures the mark (style, size, thickness, gap, dot,
// color, opacity, outline) and launches/closes the crosshair-overlay window.
//
// The overlay is dead-center, always click-through and always-on-top - there's
// no hotkey and no lock toggle, just in-app Launch / Close. Config rides the
// "crosshair-overlay-config" event; the overlay's ready-handshake re-pulls it.
//
// Page layout follows the app-wide format: primary card on top, then
// PremiumSection groups - sliders live in "Dimensions", toggles in "Options".

import { useEffect, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { primaryMonitor, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { useTheme } from "./theme";
import PremiumSection from "./components/PremiumSection";
import { OverlayControlBar } from "./components/OverlayControlBar";
import {
  CrosshairMark,
  DEFAULT_CROSSHAIR,
  type CrosshairConfig,
  type CrosshairStyle,
} from "./CrosshairOverlay";

const LS_KEY = "1v1-crosshair-config";

const STYLES: { id: CrosshairStyle; label: string }[] = [
  { id: "cross-dot",   label: "Cross + Dot" },
  { id: "cross",       label: "Cross" },
  { id: "t",           label: "T" },
  { id: "circle-dot",  label: "Circle + Dot" },
  { id: "circle",      label: "Circle" },
  { id: "dot",         label: "Dot" },
];

const SWATCHES = ["#19E08A", "#36D7FF", "#FF3B6B", "#FFFFFF", "#FFE14D", "#B36BFF"];

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function loadConfig(): CrosshairConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CROSSHAIR;
    const p = JSON.parse(raw) as Partial<CrosshairConfig>;
    const style = STYLES.some(s => s.id === p.style) ? (p.style as CrosshairStyle) : DEFAULT_CROSSHAIR.style;
    const color = typeof p.color === "string" && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : DEFAULT_CROSSHAIR.color;
    return {
      style,
      color,
      size:             clampNum(p.size, 1, 40, DEFAULT_CROSSHAIR.size),
      thickness:        clampNum(p.thickness, 1, 8, DEFAULT_CROSSHAIR.thickness),
      gap:              clampNum(p.gap, 0, 24, DEFAULT_CROSSHAIR.gap),
      dotSize:          clampNum(p.dotSize, 1, 10, DEFAULT_CROSSHAIR.dotSize),
      opacity:          clampNum(p.opacity, 0, 1, DEFAULT_CROSSHAIR.opacity),
      outline:          typeof p.outline === "boolean" ? p.outline : DEFAULT_CROSSHAIR.outline,
      outlineThickness: clampNum(p.outlineThickness, 1, 4, DEFAULT_CROSSHAIR.outlineThickness),
      rotation:         clampNum(p.rotation, 0, 360, DEFAULT_CROSSHAIR.rotation),
      holdRightMouse:   typeof p.holdRightMouse === "boolean" ? p.holdRightMouse : DEFAULT_CROSSHAIR.holdRightMouse,
    };
  } catch {
    return DEFAULT_CROSSHAIR;
  }
}

// Shared slider row - same visual as the Now Playing page's sliders.
function Slider({ label, value, min, max, step, accent, onChange, disabled, readout }: {
  label: string;
  value: number;
  min: number; max: number; step: number;
  accent: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  readout: string;
}) {
  return (
    <div className="flex items-center gap-4" style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <span className="text-[10px] font-bold text-[#8B8B93] uppercase tracking-widest whitespace-nowrap" style={{ width: "100px" }}>
        {label}
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ accentColor: accent }}
        className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer bg-[#252530]"
        aria-label={label}
      />
      <span style={{ color: "#9CA3AF", fontSize: "12px", width: 40, textAlign: "right", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" }}>
        {readout}
      </span>
    </div>
  );
}

function ToggleRow({ title, caption, checked, accent, onToggle }: {
  title: string; caption: string; checked: boolean; accent: string; onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="text-[11px] font-bold text-white uppercase tracking-widest">{title}</div>
        <div style={{ color: "#8B8B93", fontSize: "11px", marginTop: "2px", fontFamily: "var(--font-ui)" }}>{caption}</div>
      </div>
      <button
        role="switch" aria-checked={checked} aria-label={title} onClick={onToggle}
        style={{
          width: "40px", height: "22px", borderRadius: "11px",
          border: `1px solid ${checked ? accent : "#2A2A35"}`,
          background: checked ? `${accent}55` : "#0D0D12",
          position: "relative", cursor: "pointer", padding: 0, transition: "all 0.15s", flexShrink: 0,
        }}
      >
        <span style={{
          position: "absolute", top: "2px", left: checked ? "20px" : "2px",
          width: "16px", height: "16px", borderRadius: "50%",
          background: checked ? accent : "#555560", transition: "all 0.15s",
        }} />
      </button>
    </div>
  );
}

export default function Crosshair() {
  const { accentColor } = useTheme();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [cfg, setCfg] = useState<CrosshairConfig>(loadConfig);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  function update(partial: Partial<CrosshairConfig>) {
    setCfg(prev => {
      const next = { ...prev, ...partial };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
      emit("crosshair-overlay-config", next);
      return next;
    });
  }

  // Re-push config whenever the overlay (re)connects.
  useEffect(() => {
    const uReady = listen("crosshair-overlay-ready", () => emit("crosshair-overlay-config", cfgRef.current));
    return () => { uReady.then(f => f()); };
  }, []);

  // Reflect an external close (taskbar X) in the buttons.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const win = await WebviewWindow.getByLabel("crosshair-overlay");
      if (!cancelled && win) setOverlayOpen(true);
    })();
    return () => { cancelled = true; };
  }, []);

  async function openOverlay() {
    let win = await WebviewWindow.getByLabel("crosshair-overlay");
    if (!win) {
      win = await new Promise<WebviewWindow>((resolve, reject) => {
        const created = new WebviewWindow("crosshair-overlay", {
          url: "index.html#crosshair-overlay",
          title: "Crosshair",
          width: 400, height: 400,
          decorations: false, shadow: false, transparent: true,
          alwaysOnTop: true, resizable: false, visible: false,
          skipTaskbar: false, focus: false,
        });
        created.once("tauri://created", () => resolve(created));
        created.once("tauri://error", e => reject(e.payload));
      });
    }
    win.once("tauri://destroyed", () => setOverlayOpen(false));

    // Cover the full primary monitor so the CSS-centered crosshair sits at
    // true screen center (where DBD renders aim), not the work-area center a
    // maximized window would use.
    try {
      const mon = (await primaryMonitor()) ?? (await currentMonitor());
      if (mon) {
        await win.setPosition(new PhysicalPosition(mon.position.x, mon.position.y));
        await win.setSize(new PhysicalSize(mon.size.width, mon.size.height));
      }
    } catch { /* fall back to the 400x400 default */ }

    await win.setIgnoreCursorEvents(true).catch(() => {});
    // Small delay so the webview wires its listener before first paint.
    await new Promise(r => setTimeout(r, 250));
    await win.show();
    emit("crosshair-overlay-config", cfgRef.current);
    setOverlayOpen(true);
  }

  async function closeOverlay() {
    const win = await WebviewWindow.getByLabel("crosshair-overlay");
    if (win) await win.destroy();
    setOverlayOpen(false);
  }

  const showGap = cfg.style === "cross" || cfg.style === "cross-dot" || cfg.style === "t";
  const showArm = showGap || cfg.style === "circle" || cfg.style === "circle-dot";
  const showDot = cfg.style === "dot" || cfg.style === "cross-dot" || cfg.style === "circle-dot";

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* ── Primary card: live preview + overlay controls ── */}
      <div className="bg-[#111118] border border-[#1D1D25] rounded-2xl p-5 flex flex-col gap-4">
        <div>
          <label className="block text-[10px] font-bold text-[#8B8B93] uppercase tracking-widest mb-2">
            Preview
          </label>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "150px",
            background:
              "repeating-conic-gradient(#15151C 0% 25%, #101016 0% 50%) 50% / 22px 22px",
            border: "1px solid #252530",
            borderRadius: "12px",
            overflow: "hidden",
          }}>
            <CrosshairMark cfg={cfg} canvas={140} />
          </div>
        </div>

        {/* Fullscreen click-through window - no lock/center controls needed. */}
        <OverlayControlBar
          overlayOpen={overlayOpen}
          accentColor={accentColor}
          onLaunch={() => { void openOverlay(); }}
          onClose={() => { void closeOverlay(); }}
        />
      </div>

      {/* ── Shape & color ── */}
      <PremiumSection title="Shape & Color" accentColor={accentColor} storageKey="1v1-section-crosshair-shape">
        <div>
          <span className="block text-[10px] font-bold text-[#8B8B93] uppercase tracking-widest mb-2">Style</span>
          <div className="grid grid-cols-3 gap-2">
            {STYLES.map(s => {
              const active = cfg.style === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => update({ style: s.id })}
                  style={{
                    padding: "8px 6px", borderRadius: "10px",
                    border: `1px solid ${active ? accentColor : "#252530"}`,
                    background: active ? `${accentColor}1A` : "#0D0D12",
                    color: active ? "#ECECEC" : "#8B8B93",
                    fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.04em",
                    textTransform: "uppercase", cursor: "pointer", transition: "all 0.12s",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[10px] font-bold text-[#8B8B93] uppercase tracking-widest whitespace-nowrap" style={{ width: "100px" }}>
            Color
          </span>
          <div className="flex items-center gap-2 flex-1">
            {SWATCHES.map(sw => (
              <button
                key={sw}
                onClick={() => update({ color: sw })}
                aria-label={`Color ${sw}`}
                style={{
                  width: "22px", height: "22px", borderRadius: "6px", cursor: "pointer",
                  background: sw,
                  border: cfg.color.toLowerCase() === sw.toLowerCase() ? "2px solid #ECECEC" : "1px solid #2A2A35",
                }}
              />
            ))}
            <label
              style={{
                width: "22px", height: "22px", borderRadius: "6px", cursor: "pointer",
                border: "1px solid #2A2A35", overflow: "hidden", position: "relative",
                background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
              }}
              title="Custom color"
            >
              <input
                type="color"
                value={cfg.color}
                onChange={e => update({ color: e.target.value })}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: "none", padding: 0 }}
                aria-label="Custom crosshair color"
              />
            </label>
            <span style={{ color: "#9CA3AF", fontSize: "11px", marginLeft: "auto", fontFamily: "ui-monospace, monospace" }}>
              {cfg.color.toUpperCase()}
            </span>
          </div>
        </div>
      </PremiumSection>

      {/* ── Sliders ── */}
      <PremiumSection title="Dimensions" accentColor={accentColor} storageKey="1v1-section-crosshair-dims">
        <Slider label={cfg.style === "circle" || cfg.style === "circle-dot" ? "Radius" : "Length"}
          value={cfg.size} min={1} max={40} step={1} accent={accentColor}
          onChange={v => update({ size: v })} disabled={!showArm} readout={`${cfg.size}`} />
        <Slider label="Thickness" value={cfg.thickness} min={1} max={8} step={0.5} accent={accentColor}
          onChange={v => update({ thickness: v })} disabled={!showArm} readout={`${cfg.thickness}`} />
        <Slider label="Gap" value={cfg.gap} min={0} max={24} step={1} accent={accentColor}
          onChange={v => update({ gap: v })} disabled={!showGap} readout={`${cfg.gap}`} />
        <Slider label="Dot Size" value={cfg.dotSize} min={1} max={10} step={1} accent={accentColor}
          onChange={v => update({ dotSize: v })} disabled={!showDot} readout={`${cfg.dotSize}`} />
        <Slider label="Rotation" value={cfg.rotation} min={0} max={360} step={1} accent={accentColor}
          onChange={v => update({ rotation: v })} disabled={!showGap} readout={`${cfg.rotation}°`} />
        <Slider label="Opacity" value={cfg.opacity} min={0} max={1} step={0.01} accent={accentColor}
          onChange={v => update({ opacity: v })} readout={`${Math.round(cfg.opacity * 100)}%`} />
        <Slider label="Outline" value={cfg.outlineThickness} min={1} max={4} step={1} accent={accentColor}
          onChange={v => update({ outlineThickness: v })} disabled={!cfg.outline} readout={`${cfg.outlineThickness}`} />
      </PremiumSection>

      {/* ── Toggles ── */}
      <PremiumSection title="Options" accentColor={accentColor} storageKey="1v1-section-crosshair-options">
        <ToggleRow
          title="Outline"
          caption="A black contrast edge so the crosshair stays visible over bright maps and the fog."
          checked={cfg.outline}
          accent={accentColor}
          onToggle={() => update({ outline: !cfg.outline })}
        />
        <ToggleRow
          title="Hold M2 to Show"
          caption="The crosshair stays hidden and only appears while you hold right-click - e.g. while winding up a Huntress hatchet."
          checked={cfg.holdRightMouse}
          accent={accentColor}
          onToggle={() => update({ holdRightMouse: !cfg.holdRightMouse })}
        />
      </PremiumSection>

      {/* ── How it works note ── */}
      <div style={{
        padding: "14px 16px", background: "#111118", border: "1px solid #1D1D25",
        borderRadius: "16px", color: "#8B8B93", fontSize: "12px", lineHeight: 1.6,
        fontFamily: "var(--font-ui)",
      }}>
        Draws a crosshair at the exact center of your screen as a click-through
        overlay - it sits on top of the game and never intercepts your mouse.
        Handy for ranged killers (Huntress, Trickster, Deathslinger). It reads
        nothing from the game; it's just a marker drawn over your display.
      </div>
    </div>
  );
}
