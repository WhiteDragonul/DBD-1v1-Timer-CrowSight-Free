// CrosshairOverlay - the crosshair overlay window (label "crosshair-overlay").
//
// A borderless, transparent, ALWAYS click-through, always-on-top window the
// Crosshair page sizes to cover the full primary monitor. The crosshair is
// CSS-centered, so it lands at true screen center (where DBD renders aim) and
// never intercepts input - it's a pure visual aid layered over the game.
//
// Config arrives over the "crosshair-overlay-config" event. On mount the
// window announces "crosshair-overlay-ready" so the page re-pushes the current
// config (the same ready-handshake the other overlays use, so a cold webview
// that wired its listener late still gets painted).
//
// CrosshairMark / CrosshairConfig / DEFAULT_CROSSHAIR are exported so the
// Crosshair page's live preview renders from the exact same code as the
// overlay - no drift between what you configure and what you see in-game.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";

export type CrosshairStyle =
  | "dot" | "cross" | "cross-dot" | "circle" | "circle-dot" | "t";

export interface CrosshairConfig {
  style: CrosshairStyle;
  size: number;             // arm length (cross/t) or radius (circle), px
  thickness: number;        // stroke width, px
  gap: number;              // center gap between arms (cross/t), px
  dotSize: number;          // center dot radius, px
  color: string;            // hex
  opacity: number;          // 0..1
  outline: boolean;         // black contrast outline behind the mark
  outlineThickness: number; // px
  rotation: number;         // degrees, clockwise about center
  holdRightMouse: boolean;  // show only while M2 (right mouse) is held
}

export const DEFAULT_CROSSHAIR: CrosshairConfig = {
  style: "cross-dot",
  size: 10,
  thickness: 2,
  gap: 4,
  dotSize: 2,
  color: "#19E08A",
  opacity: 1,
  outline: true,
  outlineThickness: 1,
  rotation: 0,
  holdRightMouse: false,
};

const OUTLINE_COLOR = "#000000";

// Shared SVG renderer. `canvas` is the square viewport in px; the mark is
// drawn around its center. overflow:visible lets a large crosshair spill past
// the box (the overlay window is full-screen, so there's always room).
export function CrosshairMark({ cfg, canvas = 200 }: { cfg: CrosshairConfig; canvas?: number }) {
  const c = canvas / 2;
  const { style, size, thickness, gap, dotSize, color, opacity, outline, outlineThickness, rotation } = cfg;
  const t = thickness;
  const ot = outlineThickness;

  const hasDot   = style === "dot" || style === "cross-dot" || style === "circle-dot";
  const isCircle = style === "circle" || style === "circle-dot";
  const isCross  = style === "cross" || style === "cross-dot";
  const isT      = style === "t";

  // Arms as filled rects [x, y, w, h] (not stroked lines). A 1px stroke
  // centered on an integer coordinate straddles two pixels and renders at
  // ~50% coverage each - it reads as a faint line, so bumping thickness 1->2
  // looks like an opacity change. Filled rects + crispEdges map thickness to
  // exact pixels. T-style drops the top arm so it never blocks the view up.
  const arms: Array<[number, number, number, number]> = [];
  if (isCross || isT) {
    arms.push([c - gap - size, c - t / 2, size, t]); // left
    arms.push([c + gap,        c - t / 2, size, t]); // right
    arms.push([c - t / 2,      c + gap,   t,    size]); // down
    if (!isT) arms.push([c - t / 2, c - gap - size, t, size]); // up
  }

  // Axis-aligned, whole-pixel arms render crisp. Rotated arms (diagonal) and
  // fractional thicknesses (e.g. 1.5px) must antialias - crispEdges would snap
  // a 1.5 back to a whole pixel, erasing the half-step.
  const armRendering = rotation % 360 === 0 && Number.isInteger(t) ? "crispEdges" : "geometricPrecision";

  return (
    <svg
      width={canvas}
      height={canvas}
      viewBox={`0 0 ${canvas} ${canvas}`}
      style={{ display: "block", overflow: "visible" }}
    >
      <g opacity={opacity} transform={rotation ? `rotate(${rotation} ${c} ${c})` : undefined}>
        {/* Outline pass (drawn first, underneath) */}
        {outline && (
          <>
            <g shapeRendering={armRendering} fill={OUTLINE_COLOR}>
              {arms.map((a, i) => (
                <rect key={i} x={a[0] - ot} y={a[1] - ot} width={a[2] + ot * 2} height={a[3] + ot * 2} />
              ))}
            </g>
            {isCircle && <circle cx={c} cy={c} r={size} fill="none" stroke={OUTLINE_COLOR} strokeWidth={t + ot * 2} />}
            {hasDot && <circle cx={c} cy={c} r={dotSize + ot} fill={OUTLINE_COLOR} />}
          </>
        )}
        {/* Main pass */}
        <g shapeRendering={armRendering} fill={color}>
          {arms.map((a, i) => (
            <rect key={i} x={a[0]} y={a[1]} width={a[2]} height={a[3]} />
          ))}
        </g>
        {isCircle && <circle cx={c} cy={c} r={size} fill="none" stroke={color} strokeWidth={t} />}
        {hasDot && <circle cx={c} cy={c} r={dotSize} fill={color} />}
      </g>
    </svg>
  );
}

export default function CrosshairOverlay() {

  const [cfg, setCfg] = useState<CrosshairConfig>(DEFAULT_CROSSHAIR);
  // Physical right-mouse-button state, mirrored from the Rust low-level hook
  // ("crosshair-rmb-state"). This window is click-through and never focused,
  // so it can't observe mouse input itself.
  const [rmbDown, setRmbDown] = useState(false);

  useEffect(() => {
    // This window is a pure visual aid - never take cursor input.
    getCurrentWindow().setIgnoreCursorEvents(true).catch(() => {});

    let active = true;
    let unsub: (() => void) | undefined;
    let unsubRmb: (() => void) | undefined;
    listen<Partial<CrosshairConfig>>("crosshair-overlay-config", e => {
      if (!active || !e.payload) return;
      setCfg(prev => ({ ...prev, ...e.payload }));
    }).then(fn => {
      if (!active) fn();
      else unsub = fn;
      // Ready-handshake: ask the page to (re)push config now that we're wired.
      emit("crosshair-overlay-ready");
    });
    listen<boolean>("crosshair-rmb-state", e => {
      if (!active) return;
      setRmbDown(e.payload === true);
    }).then(fn => {
      if (!active) fn();
      else unsubRmb = fn;
    });
    return () => {
      active = false;
      if (unsub) unsub();
      if (unsubRmb) unsubRmb();
    };
  }, []);

  const visible = !cfg.holdRightMouse || rmbDown;

  return (
    <div
      style={{
        width: "100vw", height: "100vh",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent",
        pointerEvents: "none",
        overflow: "hidden",
        // Hold-to-show: keep the mark mounted and toggle opacity so showing
        // on M2 press is instant (no re-render/layout, just a paint).
        opacity: visible ? 1 : 0,
      }}
    >
      <CrosshairMark cfg={cfg} />
    </div>
  );
}
