// Shared overlay control bar — the Tournament Overlay button vocabulary
// (⬡ Launch / ✕ Close, 🔓 Lock toggle, ⊹ Center) applied to every overlay page
// so the controls look and behave identically across the app.
//
// Lock and Center are optional: overlays that are always click-through
// (e.g. the crosshair) simply omit those callbacks.

import type { ReactNode } from "react";

const LOSS_COLOR = "#EF4444";

const baseBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7, padding: "10px 20px", borderRadius: 10,
  fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
  fontFamily: "var(--font-ui)", cursor: "pointer", transition: "all 0.2s",
};

export function OverlayControlBar({
  overlayOpen, accentColor, onLaunch, onClose,
  locked, onToggleLock, onCenter, launchDisabled, children,
}: {
  overlayOpen: boolean;
  accentColor: string;
  onLaunch: () => void;
  onClose: () => void;
  /** Current lock state; only used when onToggleLock is provided. */
  locked?: boolean;
  /** Omit to hide the Lock button (e.g. always-click-through overlays). */
  onToggleLock?: () => void;
  /** Omit to hide the Center button. */
  onCenter?: () => void;
  launchDisabled?: boolean;
  /** Extra trailing controls (pushed to the right edge by a spacer). */
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {/* Launch / Close overlay */}
      {overlayOpen ? (
        <button onClick={onClose} style={{
          ...baseBtn,
          background: `${LOSS_COLOR}1A`, border: `1.5px solid ${LOSS_COLOR}66`, color: LOSS_COLOR,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = `${LOSS_COLOR}33`; e.currentTarget.style.boxShadow = `0 4px 16px ${LOSS_COLOR}4D`; }}
        onMouseLeave={e => { e.currentTarget.style.background = `${LOSS_COLOR}1A`; e.currentTarget.style.boxShadow = "none"; }}
        >
          <span style={{ fontSize: 14 }}>✕</span> Close Overlay
        </button>
      ) : (
        <button onClick={onLaunch} disabled={launchDisabled} style={{
          ...baseBtn,
          background: `${accentColor}18`, border: `1.5px solid ${accentColor}50`, color: accentColor,
          opacity: launchDisabled ? 0.4 : 1, cursor: launchDisabled ? "default" : "pointer",
        }}
        onMouseEnter={e => { if (!launchDisabled) { e.currentTarget.style.background = `${accentColor}30`; e.currentTarget.style.boxShadow = `0 4px 16px ${accentColor}30`; } }}
        onMouseLeave={e => { e.currentTarget.style.background = `${accentColor}18`; e.currentTarget.style.boxShadow = "none"; }}
        >
          <span style={{ fontSize: 14 }}>⬡</span> Launch Overlay
        </button>
      )}

      {/* Lock / Unlock (only when overlay is open) */}
      {overlayOpen && onToggleLock && (
        <button onClick={onToggleLock} style={{
          ...baseBtn, padding: "10px 18px",
          background: locked ? "rgba(255,255,255,0.06)" : `${accentColor}12`,
          border: `1.5px solid ${locked ? "rgba(255,255,255,0.15)" : `${accentColor}35`}`,
          color: locked ? "rgba(255,255,255,0.6)" : accentColor,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = locked ? "rgba(255,255,255,0.1)" : `${accentColor}22`; }}
        onMouseLeave={e => { e.currentTarget.style.background = locked ? "rgba(255,255,255,0.06)" : `${accentColor}12`; }}
        >
          <span style={{ fontSize: 13 }}>{locked ? "🔒" : "🔓"}</span>
          {locked ? "Locked" : "Lock Overlay"}
        </button>
      )}

      {/* Center on screen (only when overlay is open) */}
      {overlayOpen && onCenter && (
        <button onClick={onCenter} style={{
          ...baseBtn, padding: "10px 18px",
          background: `${accentColor}12`, border: `1.5px solid ${accentColor}35`, color: accentColor,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = `${accentColor}22`; }}
        onMouseLeave={e => { e.currentTarget.style.background = `${accentColor}12`; }}
        >
          <span style={{ fontSize: 13 }}>⊹</span> Center
        </button>
      )}

      {children != null && <div style={{ flex: 1 }} />}
      {children}
    </div>
  );
}
