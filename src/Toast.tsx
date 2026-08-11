// Toast notification system.
//
// Usage from anywhere:
//   import { toast } from "./Toast";
//   toast("Streak saved");
//   toast("New PB!", { kind: "success", icon: "🏆" });
//
// Mount the <ToastHost /> once at the root of the app - it portals to body
// so it's safe to drop next to <App />.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ToastKind = "info" | "success" | "warn" | "error" | "celebrate";

type Toast = {
  id: number;
  text: string;
  kind: ToastKind;
  icon?: string;
  duration: number;
  // unix ms when it should be removed; null = persistent (rare)
  expires: number | null;
};

type Listener = (toasts: Toast[]) => void;

// ── Mini reactive store (no external deps) ───────────────────────────────────
let _toasts: Toast[] = [];
const _listeners = new Set<Listener>();
let _nextId = 1;

function emit() {
  for (const l of _listeners) l(_toasts);
}

function add(text: string, opts: Partial<Pick<Toast, "kind" | "icon" | "duration">> = {}) {
  const id = _nextId++;
  const duration = opts.duration ?? 2400;
  const t: Toast = {
    id,
    text,
    kind: opts.kind ?? "info",
    icon: opts.icon,
    duration,
    expires: duration > 0 ? Date.now() + duration : null,
  };
  _toasts = [..._toasts, t];
  emit();
  if (t.expires !== null) {
    setTimeout(() => dismiss(id), duration);
  }
  return id;
}

function dismiss(id: number) {
  _toasts = _toasts.filter(t => t.id !== id);
  emit();
}

// Public API: a callable function with helper methods.
type ToastFn = ((text: string, opts?: Parameters<typeof add>[1]) => number) & {
  success: (text: string, icon?: string) => number;
  warn:    (text: string) => number;
  error:   (text: string) => number;
  celebrate: (text: string, icon?: string) => number;
  dismiss: (id: number) => void;
};

const _toast: any = (text: string, opts?: Parameters<typeof add>[1]) => add(text, opts);
_toast.success = (text: string, icon?: string) => add(text, { kind: "success", icon });
_toast.warn    = (text: string) => add(text, { kind: "warn" });
_toast.error   = (text: string) => add(text, { kind: "error" });
_toast.celebrate = (text: string, icon = "🏆") => add(text, { kind: "celebrate", icon, duration: 3600 });
_toast.dismiss = dismiss;
export const toast: ToastFn = _toast;

// ── ToastHost: renders the stack, subscribes to the store ────────────────────
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>(_toasts);
  useEffect(() => {
    _listeners.add(setToasts);
    return () => { _listeners.delete(setToasts); };
  }, []);

  return createPortal(
    <>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toastOut {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(-6px) scale(0.98); }
        }
      `}</style>
      <div style={{
        position: "fixed",
        right: 20, bottom: 20,
        display: "flex", flexDirection: "column", gap: "8px",
        zIndex: 10000,
        pointerEvents: "none",
        alignItems: "flex-end",
      }}>
        {toasts.map(t => <ToastItem key={t.id} t={t} />)}
      </div>
    </>,
    document.body
  );
}

function ToastItem({ t }: { t: Toast }) {
  const accent =
    t.kind === "success"   ? "#22C55E" :
    t.kind === "warn"      ? "#F59E0B" :
    t.kind === "error"     ? "#E8394D" :
    t.kind === "celebrate" ? "#FFD166" :
    "#5BA8E0";

  return (
    <div
      onClick={() => toast.dismiss(t.id)}
      style={{
        background: `linear-gradient(135deg, #14141C 0%, ${accent}1A 100%)`,
        border: `1px solid ${accent}55`,
        borderRadius: "10px",
        padding: "10px 14px",
        minWidth: "200px",
        maxWidth: "360px",
        color: "white",
        fontSize: "13px", fontWeight: 600,
        fontFamily: "Segoe UI, sans-serif",
        boxShadow: `0 8px 28px rgba(0,0,0,0.55), 0 0 0 1px ${accent}22, 0 0 24px ${accent}33`,
        animation: "toastIn 220ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        cursor: "pointer",
        pointerEvents: "auto",
        display: "flex", alignItems: "center", gap: "10px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top accent line - matches the build-card treatment */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "1px",
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        pointerEvents: "none",
      }} />
      {t.icon && <span style={{ fontSize: "18px", flexShrink: 0 }}>{t.icon}</span>}
      <span>{t.text}</span>
    </div>
  );
}
