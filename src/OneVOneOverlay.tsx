// 1v1 Timer Overlay - child window rendered when url contains #1v1-overlay.
//
// Listens for the "overlay-1v1-update" event from the main window to receive
// state snapshots, and runs its own requestAnimationFrame loop to advance
// the displayed timer 60fps. Two visual layouts:
//   - vertical (Preset 1): compact stack, matches the original C# overlay 1:1
//   - horizontal (Preset 2): wider, broadcast-style for casting / streaming
//
// Drag behaviour: the overlay has zero interactive controls - clicking anywhere
// while unlocked should drag the window. Tauri's data-tauri-drag-region only
// triggers on the element it's applied to (it doesn't propagate), so we
// apply pointer-events:none to all interior children. Mouse events fall
// through to the wrapper, which IS the drag region. When locked, the OS-level
// setIgnoreCursorEvents takes over and pointer-events becomes irrelevant.

import { useEffect, useRef, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize, LogicalPosition, PhysicalPosition } from "@tauri-apps/api/window";
import {
  OverlayPayload, PlayerId,
  currentActiveMs, formatTimeSecondsHundredths, formatTimeColons,
} from "./OneVOne";

const VERTICAL_SIZE   = { w: 90, h: 134 };
const HORIZONTAL_SIZE = { w: 380, h: 90 };
// Glass card's outer div uses content-box (the overlay window doesn't pick up
// App.tsx's global * { box-sizing: border-box }), so its declared width:400 +
// padding:12 actually renders at 424×134. Window must match the rendered size
// or the right/bottom of the card sits outside the window and gets clipped.
const GLASS_SIZE      = { w: 424, h: 134 };

// Transparent gutter around each preset so the accent glow can fade smoothly
// instead of being clipped at the rectangular Tauri window edge (which is
// what was making the horizontal preset's halo look like a hard rectangle).
// Vertical has no outer glow, so 0; glass already builds its own padding via
// inset:12 inside the card.
const GLOW_PAD: Record<"vertical" | "horizontal" | "glass", number> = {
  vertical:   0,
  horizontal: 28,
  glass:      0,
};

const DEFAULT_PAYLOAD: OverlayPayload = {
  players: { p1: "Player 1", p2: "Player 2" },
  score:   { p1: 0, p2: 0 },
  themeColor: "#E94560",
  preset: "vertical",
  active: "p1",
  running: false,
  runStartedAt: null,
  accumulatedMs: 0,
  lastTimeMs: { p1: 0, p2: 0 },
  scoreEventSeq: 0,
  overlayLocked: false,
  horizBgOpacity: 62,
  vertBgOpacity:  62,
  horizShowLines: true,
};

function getOneVOneScale(): number {
  try {
    const raw = localStorage.getItem("1v1-theme");
    const s = raw ? (JSON.parse(raw)?.state ?? {}) : {};
    if (typeof s.oneVOneOverlayScale === "number" && s.oneVOneOverlayScale > 0) return s.oneVOneOverlayScale;
  } catch {}
  return 1;
}

export default function OneVOneOverlay() {
  const [state, setState] = useState<OverlayPayload>(DEFAULT_PAYLOAD);
  const [nowMs, setNowMs] = useState(Date.now());
  const rafRef = useRef<number>(0);
  const prevScoreEventRef = useRef<number>(0);
  const [scoreFlash, setScoreFlash] = useState(false);
  const [scale, setScale] = useState(getOneVOneScale);

  // The horizontal preset keeps a transparent GLOW_PAD gutter around the
  // card, so "top of the window" is 28px above the visible card. Anywhere we
  // position the window programmatically we offset by -pad so the VISIBLE
  // card (not the invisible gutter) is what lines up with the screen edge.
  const geomRef = useRef({ preset: state.preset, scale });
  geomRef.current = { preset: state.preset, scale };

  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenLock:  (() => void) | undefined;
    let unlistenCenter: (() => void) | undefined;

    listen<OverlayPayload>("overlay-1v1-update", e => setState(e.payload))
      .then(u => { unlistenState = u; });

    listen<boolean>("overlay-1v1-lock-changed", e => {
      getCurrentWindow().setIgnoreCursorEvents(e.payload).catch(() => {});
    }).then(u => { unlistenLock = u; });

    // Top-center snap, compensating for the glow gutter so the card sits
    // flush with the top of the screen.
    listen("1v1-overlay-center", async () => {
      try {
        const { preset, scale: sc } = geomRef.current;
        const pad = GLOW_PAD[preset];
        const win = getCurrentWindow();
        const size = await win.outerSize();
        const sf = await win.scaleFactor();
        const w = size.width / sf;
        const x = Math.max(0, Math.round((window.screen.width - w) / 2));
        await win.setPosition(new LogicalPosition(x, -pad * sc));
      } catch { /* non-fatal */ }
    }).then(u => { unlistenCenter = u; });

    Promise.resolve().then(() => emit("overlay-1v1-ready"));

    return () => { unlistenState?.(); unlistenLock?.(); unlistenCenter?.(); };
  }, []);

  // Restore the saved position on mount + persist it on every move, so the
  // overlay reopens exactly where it was closed (same pattern as the DS /
  // streak / scrim / tournament overlays).
  useEffect(() => {
    const win = getCurrentWindow();
    try {
      const s = localStorage.getItem("1v1-overlay-pos");
      if (s) {
        const p = JSON.parse(s) as { x: number; y: number };
        win.setPosition(new PhysicalPosition(p.x, p.y)).catch(() => {});
      }
    } catch { /* default position */ }
    const unlisten = win.listen("tauri://move", async () => {
      try {
        const pos = await win.outerPosition();
        localStorage.setItem("1v1-overlay-pos", JSON.stringify({ x: pos.x, y: pos.y }));
      } catch { /* non-fatal */ }
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // Dragging can't put the window's (invisible) top edge above the screen,
  // which leaves a gutter-sized gap over the visible card. Magnetic fix:
  // when a drag ends inside that gutter band, snap the window up by -pad so
  // the card touches the top edge.
  useEffect(() => {
    const win = getCurrentWindow();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const un = win.listen("tauri://move", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const { preset, scale: sc } = geomRef.current;
          const pad = GLOW_PAD[preset] * sc;
          if (pad === 0) return;
          const sf = await win.scaleFactor();
          const pos = await win.outerPosition();
          const y = pos.y / sf;
          // Only act inside the band (snapped position excluded, so the
          // snap's own move event doesn't re-trigger).
          if (y > -pad + 0.5 && y < pad) {
            await win.setPosition(new LogicalPosition(pos.x / sf, -pad));
          }
        } catch { /* non-fatal */ }
      }, 250);
    });
    return () => { un.then(f => f()); if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!state.running) {
      setNowMs(Date.now());
      return;
    }
    function tick() {
      setNowMs(Date.now());
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state.running, state.runStartedAt, state.accumulatedMs]);

  useEffect(() => {
    getCurrentWindow().setIgnoreCursorEvents(state.overlayLocked).catch(() => {});
  }, [state.overlayLocked]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== "1v1-theme") return;
      try {
        const s = JSON.parse(e.newValue ?? "")?.state ?? {};
        if (typeof s.oneVOneOverlayScale === "number" && s.oneVOneOverlayScale > 0) setScale(s.oneVOneOverlayScale);
      } catch {}
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const base = state.preset === "horizontal" ? HORIZONTAL_SIZE : state.preset === "glass" ? GLASS_SIZE : VERTICAL_SIZE;
    const pad  = GLOW_PAD[state.preset];
    getCurrentWindow().setSize(new LogicalSize((base.w + 2 * pad) * scale, (base.h + 2 * pad) * scale)).catch(() => {});
  }, [state.preset, scale]);

  useEffect(() => {
    if (state.scoreEventSeq === 0) {
      prevScoreEventRef.current = state.scoreEventSeq;
      return;
    }
    if (state.scoreEventSeq !== prevScoreEventRef.current) {
      prevScoreEventRef.current = state.scoreEventSeq;
      setScoreFlash(true);
      const id = setTimeout(() => setScoreFlash(false), 900);
      return () => clearTimeout(id);
    }
  }, [state.scoreEventSeq]);

  const activeMs = currentActiveMs({ ...state });
  const p1Display = state.active === "p1" ? activeMs : state.lastTimeMs.p1;
  const p2Display = state.active === "p2" ? activeMs : state.lastTimeMs.p2;
  void nowMs;

  const baseSize = state.preset === "horizontal" ? HORIZONTAL_SIZE : state.preset === "glass" ? GLASS_SIZE : VERTICAL_SIZE;
  const pad      = GLOW_PAD[state.preset];
  return (
    <div
      className="w-screen h-screen"
      style={{ background: "transparent" }}
      data-tauri-drag-region={!state.overlayLocked ? "" : undefined}
    >
      {/* Outer wrapper is sized to (card + 2*pad) so the box-shadow on the
          preset card has transparent room to fade rather than slamming into
          the window edge and reading as a sharp rectangle. */}
      <div style={{
        position: "absolute", top: 0, left: 0,
        transform: `scale(${scale})`, transformOrigin: "0 0",
        width: baseSize.w + 2 * pad, height: baseSize.h + 2 * pad,
        padding: pad,
        boxSizing: "border-box",
      }}>
        {state.preset === "glass"
          ? <GlassPreset      s={state} p1Ms={p1Display} p2Ms={p2Display} scoreFlash={scoreFlash} />
          : state.preset === "horizontal"
          ? <HorizontalPreset s={state} p1Ms={p1Display} p2Ms={p2Display} scoreFlash={scoreFlash} />
          : <VerticalPreset   s={state} p1Ms={p1Display} p2Ms={p2Display} scoreFlash={scoreFlash} />}
      </div>
    </div>
  );
}

// ─── MarqueeText: name slider used by all three presets ────────────────────
//
// When the name fits inside its slot, renders static. When it overflows the
// slot horizontally, animates a leftward slide at ~30 px/s with a pause at
// each end and an invisible snap-back so long handles (e.g. broadcaster IGNs
// like "FFFFFFFFFFFFFFFFFFF") read fully instead of being clipped to
// ellipsis or, worse, pushing past their column. Replaces the prior
// overflow:hidden/text-overflow:ellipsis treatment on the name divs.

function MarqueeText({ text, align = "left", textStyle, pxPerSec = 30, style }: {
  text: string;
  align?: "left" | "right";
  textStyle?: React.CSSProperties;
  pxPerSec?: number;
  style?: React.CSSProperties;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    function measure() {
      const w = wrapRef.current;
      const t = textRef.current;
      if (!w || !t) return;
      setOverflow(Math.max(0, t.scrollWidth - w.clientWidth));
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [text]);

  // Cycle: pause at start → slide left at pxPerSec → pause at end → fade out
  // → snap to origin while invisible → fade in. Snap during the fade window
  // means the reset is never visible.
  const PAUSE_START = 0.8;
  const PAUSE_END   = 1.0;
  const FADE        = 0.4;
  const slideSec    = overflow > 0 ? overflow / pxPerSec : 0;
  const cycleSec    = slideSec + PAUSE_START + PAUSE_END + FADE;
  const pct = (t: number) => ((t / cycleSec) * 100).toFixed(3);
  const t1 = PAUSE_START;
  const t2 = PAUSE_START + slideSec;
  const t3 = PAUSE_START + slideSec + PAUSE_END;
  const t4 = t3 + FADE * 0.5;
  // Animation name is keyed off overflow distance so multiple marquees on
  // screen with different widths each get their own keyframes.
  const animName = `mq_${Math.round(overflow)}_${Math.round(pxPerSec)}`;

  return (
    <div
      ref={wrapRef}
      style={{
        width: "100%",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textAlign: align,
        ...style,
      }}
    >
      {overflow > 0 && (
        <style>{`
          @keyframes ${animName} {
            0%               { transform: translateX(0);              opacity: 1; }
            ${pct(t1)}%      { transform: translateX(0);              opacity: 1; }
            ${pct(t2)}%      { transform: translateX(-${overflow}px); opacity: 1; }
            ${pct(t3)}%      { transform: translateX(-${overflow}px); opacity: 1; }
            ${pct(t4)}%      { transform: translateX(-${overflow}px); opacity: 0; }
            ${pct(t4 + 0.001)}% { transform: translateX(0);           opacity: 0; }
            100%             { transform: translateX(0);              opacity: 1; }
          }
        `}</style>
      )}
      <span
        ref={textRef}
        style={{
          display: "inline-block",
          ...textStyle,
          willChange: overflow > 0 ? "transform, opacity" : undefined,
          animation: overflow > 0
            ? `${animName} ${cycleSec.toFixed(2)}s linear infinite`
            : undefined,
        }}
      >
        {text}
      </span>
    </div>
  );
}

// ─── Preset 1: Vertical - matches the original C# overlay layout ────────────
//
// Tight column: left accent bar (positions itself by active player),
// PLAYER 1 label + time, score pill, PLAYER 2 label + time. Active player's
// time is rendered in the theme colour; the other is desaturated to grey.

function VerticalPreset({ s, p1Ms, p2Ms, scoreFlash }: {
  s: OverlayPayload; p1Ms: number; p2Ms: number; scoreFlash: boolean;
}) {
  const accent = s.themeColor;
  return (
    <div
      data-tauri-drag-region={!s.overlayLocked ? "" : undefined}
      style={{ position: "relative" }}
    >
    <div
      data-tauri-drag-region={!s.overlayLocked ? "" : undefined}
      style={{
        width: `${VERTICAL_SIZE.w}px`, height: `${VERTICAL_SIZE.h}px`,
        background: `rgba(10, 10, 14, ${(Math.max(0, Math.min(100, s.vertBgOpacity)) / 100).toFixed(2)})`,
        borderRadius: "5px",
        position: "relative",
        overflow: "hidden",
        color: "white",
        fontFamily: "var(--font-ui)",
        userSelect: "none",
        display: "flex", flexDirection: "column",
        padding: "4px 5px 4px 10px",
        cursor: s.overlayLocked ? "default" : "move",
      }}
    >
      {/* Left accent bar - re-positions to the active player's half. */}
      <div style={{
        position: "absolute",
        left: 0,
        top: s.active === "p1" ? "4px" : "50%",
        height: s.active === "p1" ? "50%" : "calc(50% - 4px)",
        width: "3px",
        background: accent,
        borderRadius: "0 2px 2px 0",
        boxShadow: `0 0 6px ${accent}AA`,
        transition: "top 0.25s cubic-bezier(0.22, 0.61, 0.36, 1), height 0.25s cubic-bezier(0.22, 0.61, 0.36, 1)",
        pointerEvents: "none",
      }} />

      <PlayerRowCompact name={s.players.p1} ms={p1Ms} active={s.active === "p1"} accent={accent} />

      <div style={{
        margin: "1px 0",
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
      }}>
        <div style={{
          background: accent,
          color: "white",
          padding: "1px 9px",
          borderRadius: "3px",
          fontSize: "10px", fontWeight: 800,
          letterSpacing: "0.04em",
          fontVariantNumeric: "tabular-nums",
          boxShadow: scoreFlash
            ? `0 0 0 1px ${accent}, 0 0 14px ${accent}DD`
            : `0 1px 4px rgba(0,0,0,0.4)`,
          transition: "box-shadow 0.3s ease",
        }}>
          {s.score.p1} <span style={{ opacity: 0.65 }}>-</span> {s.score.p2}
        </div>
      </div>

      <PlayerRowCompact name={s.players.p2} ms={p2Ms} active={s.active === "p2"} accent={accent} />
    </div>
    </div>
  );
}

function PlayerRowCompact({ name, ms, active, accent }: {
  name: string; ms: number; active: boolean; accent: string;
}) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      display: "flex", flexDirection: "column", justifyContent: "center",
      pointerEvents: "none",  // mouse falls through to the wrapper for drag
      lineHeight: 1,
    }}>
      <MarqueeText
        text={name}
        align="left"
        style={{ marginBottom: "1px" }}
        textStyle={{
          fontSize: "8px", fontWeight: 700,
          letterSpacing: "0.13em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.55)",
          textShadow: "0 1px 2px rgba(0,0,0,0.85)",
        }}
      />
      <div style={{
        fontSize: "17px", fontWeight: 900,
        letterSpacing: "-0.01em",
        lineHeight: 1,
        color: active ? accent : "rgba(255,255,255,0.4)",
        textShadow: active
          ? `0 0 10px ${accent}55, 0 1px 3px rgba(0,0,0,0.9)`
          : "0 1px 3px rgba(0,0,0,0.9)",
        fontVariantNumeric: "tabular-nums",
        transition: "color 0.2s, text-shadow 0.2s",
      }}>
        {formatTimeSecondsHundredths(ms)}
      </div>
    </div>
  );
}

// ─── Preset 2: Horizontal - broadcast / casting layout ──────────────────────

function HorizontalPreset({ s, p1Ms, p2Ms, scoreFlash }: {
  s: OverlayPayload; p1Ms: number; p2Ms: number; scoreFlash: boolean;
}) {
  const accent = s.themeColor;
  const bgAlpha = (Math.max(0, Math.min(100, s.horizBgOpacity)) / 100).toFixed(2);
  return (
    <div
      data-tauri-drag-region={!s.overlayLocked ? "" : undefined}
      style={{
        width: `${HORIZONTAL_SIZE.w}px`, height: `${HORIZONTAL_SIZE.h}px`,
        background: `linear-gradient(135deg, rgba(8,8,12,${bgAlpha}) 0%, rgba(20,20,28,${bgAlpha}) 100%)`,
        borderRadius: "12px",
        border: s.horizShowLines ? `1px solid ${accent}33` : "none",
        // Two-stop halo: a tighter inner ring for definition and a wider, much
        // fainter outer wash for smooth falloff. The outer 56px blur lives
        // inside the GLOW_PAD gutter so it actually fades to transparent
        // instead of getting clipped at the window edge.
        boxShadow: s.horizShowLines
          ? `0 0 26px ${accent}1A, 0 0 56px ${accent}0D, inset 0 1px 0 rgba(255,255,255,0.06)`
          : "none",
        position: "relative",
        overflow: "hidden",
        color: "white",
        fontFamily: "var(--font-ui)",
        userSelect: "none",
        display: "flex", alignItems: "center",
        padding: "0 14px",
        gap: "10px",
        cursor: s.overlayLocked ? "default" : "move",
      }}
    >
      {s.horizShowLines && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "1px",
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          pointerEvents: "none",
        }} />
      )}
      {s.horizShowLines && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: "1px",
          background: `linear-gradient(90deg, transparent, ${accent}80, transparent)`,
          pointerEvents: "none",
        }} />
      )}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse at center, ${accent}10 0%, transparent 65%)`,
      }} />

      <PlayerCardHorizontal
        name={s.players.p1} ms={p1Ms} active={s.active === "p1"} accent={accent}
        align="left"
      />

      <div style={{
        flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
        pointerEvents: "none",
      }}>
        <div style={{
          fontSize: "8px", fontWeight: 700,
          color: "rgba(255,255,255,0.32)",
          letterSpacing: "0.18em", textTransform: "uppercase",
        }}>Score</div>
        <div style={{
          background: accent,
          color: "white",
          padding: "3px 12px",
          borderRadius: "5px",
          fontSize: "15px", fontWeight: 900,
          letterSpacing: "0.04em",
          fontVariantNumeric: "tabular-nums",
          boxShadow: scoreFlash
            ? `0 0 0 2px ${accent}, 0 0 22px ${accent}DD, inset 0 1px 0 rgba(255,255,255,0.2)`
            : `0 3px 10px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)`,
          transition: "box-shadow 0.3s ease",
        }}>
          {s.score.p1} <span style={{ opacity: 0.55 }}>-</span> {s.score.p2}
        </div>
      </div>

      <PlayerCardHorizontal
        name={s.players.p2} ms={p2Ms} active={s.active === "p2"} accent={accent}
        align="right"
      />
    </div>
  );
}

function PlayerCardHorizontal({ name, ms, active, accent, align }: {
  name: string; ms: number; active: boolean; accent: string; align: "left" | "right";
}) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      display: "flex", flexDirection: "column",
      alignItems: align === "left" ? "flex-start" : "flex-end",
      justifyContent: "center",
      gap: "3px",
      position: "relative",
      pointerEvents: "none",  // mouse falls through to the wrapper for drag
    }}>
      <div style={{
        position: "absolute",
        bottom: "-3px",
        left: align === "left" ? 0 : "auto",
        right: align === "right" ? 0 : "auto",
        width: active ? "60%" : "0%",
        height: "2px",
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        opacity: active ? 1 : 0,
        transition: "width 0.3s ease, opacity 0.3s ease",
        boxShadow: active ? `0 0 8px ${accent}AA` : "none",
      }} />

      <MarqueeText
        text={name}
        align={align}
        textStyle={{
          fontSize: "10px", fontWeight: 800,
          letterSpacing: "0.13em", textTransform: "uppercase",
          color: active ? "white" : "rgba(255,255,255,0.45)",
          textShadow: "0 1px 3px rgba(0,0,0,0.85)",
          transition: "color 0.2s",
        }}
      />
      <div style={{
        fontSize: "24px", fontWeight: 900,
        letterSpacing: "-0.015em",
        lineHeight: 1,
        color: active ? accent : "rgba(255,255,255,0.5)",
        textShadow: active
          ? `0 0 12px ${accent}55, 0 1px 4px rgba(0,0,0,0.9)`
          : "0 1px 4px rgba(0,0,0,0.9)",
        fontVariantNumeric: "tabular-nums",
        transition: "color 0.2s, text-shadow 0.2s",
      }}>
        {formatTimeColons(ms)}
      </div>
    </div>
  );
}

// ─── Preset 3: Glass - premium glassmorphic layout ──────────────────────────

function GlassPreset({ s, p1Ms, p2Ms, scoreFlash }: {
  s: OverlayPayload; p1Ms: number; p2Ms: number; scoreFlash: boolean;
}) {
  const accent = s.themeColor;
  const bgAlpha = Number((Math.max(0, Math.min(100, s.horizBgOpacity)) / 100).toFixed(2));

  return (
    <div
      data-tauri-drag-region={!s.overlayLocked ? "" : undefined}
      style={{
        // The card is content-box; width:400 + padding:12 renders at 424×134.
        // GLASS_SIZE is set to that rendered size so the Tauri window encloses
        // the full card without clipping its right/bottom edges.
        width: "400px", height: "110px",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "12px",
        position: "relative",
        cursor: s.overlayLocked ? "default" : "move",
      }}
    >
      <style>{`
        @keyframes borderGlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes vsPulse {
          0%, 100% { text-shadow: 0 0 10px ${accent}66; transform: scale(1); }
          50% { text-shadow: 0 0 20px ${accent}, 0 0 40px ${accent}; transform: scale(1.1); }
        }
      `}</style>

      {/* Background & Border Layer (fades with slider) */}
      <div style={{
        position: "absolute",
        inset: "12px",
        borderRadius: "24px",
        padding: "2px",
        background: `linear-gradient(270deg, ${accent}AA, rgba(255,255,255,0.2), ${accent}AA, rgba(255,255,255,0.2))`,
        backgroundSize: "400% 400%",
        animation: "borderGlow 8s ease infinite",
        // Tight halo that hugs the gradient border. Old value (0 0 30px) bled
        // past the 12px window gutter and was being clipped at the window
        // edge, reading as a hard rectangle. 6px stays fully inside the
        // gutter so the glow fades smoothly all the way around.
        boxShadow: `0 0 6px ${accent}55, 0 0 12px ${accent}22`,
        opacity: bgAlpha,
        pointerEvents: "none",
        transition: "opacity 0.3s ease",
      }}>
        <div style={{
          width: "100%", height: "100%",
          background: "rgba(10, 10, 15, 0.8)",
          backdropFilter: "blur(24px)",
          borderRadius: "22px",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Radial subtle glow inside */}
          <div style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "150%", height: "150%",
            background: `radial-gradient(circle, ${accent}2A 0%, transparent 60%)`,
          }} />
        </div>
      </div>

      {/* Content Layer (always fully opaque text). Score pill is now part of
          the row's flex flow (previously absolute) so the two player columns
          honestly share `(rowWidth - pillWidth - gap)` instead of relying on
          a magic gap value to clear the pill. That makes flex:1 + minWidth:0
          + overflow:hidden on each column actually clip long names. */}
      <div style={{
        flex: 1, height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "0 14px",
        gap: "10px",
        minWidth: 0,
        position: "relative",
        pointerEvents: "none", // lets clicks fall through to the drag wrapper
        zIndex: 2,
      }}>
        <PlayerStatsGlass name={s.players.p1} ms={p1Ms} active={s.active === "p1"} accent={accent} align="left" />

        {/* Score Pill - intrinsic width, never shrinks */}
        <div style={{
          flex: "0 0 auto",
          background: `rgba(0,0,0,${0.6 * bgAlpha})`,
          border: `1px solid rgba(255,255,255,${0.15 * bgAlpha})`,
          borderRadius: "30px",
          padding: "6px 18px",
          display: "flex", alignItems: "center", gap: "10px",
          boxShadow: scoreFlash ? `0 0 0 2px ${accent}, 0 0 40px ${accent}` : `0 4px 20px rgba(0,0,0,${0.6 * bgAlpha})`,
          transition: "box-shadow 0.3s ease, background 0.3s ease, border-color 0.3s ease",
        }}>
          <div style={{ fontSize: "20px", fontWeight: 900, color: "white", textShadow: `0 0 12px ${accent}` }}>
            {s.score.p1}
          </div>
          <div style={{ fontSize: "11px", fontWeight: 800, color: accent, animation: "vsPulse 2s infinite" }}>
            VS
          </div>
          <div style={{ fontSize: "20px", fontWeight: 900, color: "white", textShadow: `0 0 12px ${accent}` }}>
            {s.score.p2}
          </div>
        </div>

        <PlayerStatsGlass name={s.players.p2} ms={p2Ms} active={s.active === "p2"} accent={accent} align="right" />
      </div>
    </div>
  );
}

function PlayerStatsGlass({ name, ms, active, accent, align }: {
  name: string; ms: number; active: boolean; accent: string; align: "left" | "right";
}) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      // No overflow:hidden here - the marquee already clips long names, and
      // the time fits the column. Leaving overflow visible lets the active-
      // player underline (bottom:-6px) render outside the column box.
      // Gap between name and time + center-aligned column = name shifts up
      // and time shifts down relative to the row center.
      gap: "2px",
      display: "flex", flexDirection: "column",
      alignItems: align === "left" ? "flex-start" : "flex-end",
      position: "relative",
    }}>
      <MarqueeText
        text={name}
        align={align}
        textStyle={{
          fontSize: "12px", fontWeight: 800, color: active ? "white" : "rgba(255,255,255,0.45)",
          letterSpacing: "0.15em", textTransform: "uppercase",
          textShadow: "0 2px 4px rgba(0,0,0,0.9)",
          lineHeight: 1,
          transition: "color 0.3s",
        }}
      />
      <div style={{
        fontSize: "27px", fontWeight: 900,
        letterSpacing: "-0.02em",
        whiteSpace: "nowrap",
        color: active ? accent : "rgba(255,255,255,0.25)",
        fontVariantNumeric: "tabular-nums", lineHeight: 1,
        textShadow: active ? `0 0 24px ${accent}99, 0 2px 6px rgba(0,0,0,0.9)` : "0 2px 6px rgba(0,0,0,0.9)",
        transition: "color 0.3s, text-shadow 0.3s",
      }}>
        {formatTimeColons(ms)}
      </div>

      {/* Active-player underline - mirrors the horizontal preset so the
          "whose clock is running" cue is consistent across overlays. Width
          collapses to 0 when inactive so the layout doesn't shift. */}
      <div style={{
        position: "absolute",
        bottom: "-6px",
        left:  align === "left"  ? 0 : "auto",
        right: align === "right" ? 0 : "auto",
        width: active ? "70%" : "0%",
        height: "2px",
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        opacity: active ? 1 : 0,
        transition: "width 0.3s ease, opacity 0.3s ease",
        boxShadow: active ? `0 0 8px ${accent}AA` : "none",
        pointerEvents: "none",
      }} />
    </div>
  );
}

// keep the PlayerId type referenced so the import isn't tree-shaken away
void (null as unknown as PlayerId);