import { useState } from "react";
import { useTheme } from "../theme";

interface HotkeyHeroSectionProps {
  title: string;
  description?: string;
  enabled: boolean;
  onEnabledChange: (b: boolean) => void;
  accentColor: string;
  storageKey: string;
  children: React.ReactNode;
}

export default function HotkeyHeroSection({
  title,
  enabled,
  onEnabledChange,
  accentColor,
  storageKey,
  children,
}: HotkeyHeroSectionProps) {
  const premiumGlowEffects = useTheme(s => s.premiumGlowEffects);
  const [isMinimized, setIsMinimized] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });

  const toggleMinimize = () => {
    const next = !isMinimized;
    setIsMinimized(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {}
  };

  return (
    <div
      className="premium-section-container"
      style={{
        background: `linear-gradient(135deg, rgba(20, 20, 28, 0.8) 0%, rgba(13, 13, 18, 0.9) 100%)`,
        backdropFilter: "blur(12px)",
        border: "1.5px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "0 8px 32px -4px rgba(0, 0, 0, 0.5)",
        borderRadius: "16px",
        padding: isMinimized ? "12px 18px" : "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: isMinimized ? "0" : "14px",
        transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
        position: "relative",
        overflow: "visible",
      }}
    >
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes softPulseGlow {
          0%, 100% {
            opacity: 0.65;
            box-shadow: 0 0 8px ${accentColor}30;
          }
          50% {
            opacity: 1;
            box-shadow: 0 0 16px ${accentColor}60;
          }
        }
        .premium-section-container {
          position: relative;
          z-index: 1;
        }
        .premium-section-container:hover {
          z-index: 5;
        }
        .premium-section-container:focus-within {
          z-index: 50 !important;
        }
        .premium-glow-line {
          animation: softPulseGlow 4s ease-in-out infinite;
        }
      `}</style>

      {/* Glow highlight line */}
      {premiumGlowEffects && (
        <div
          className="premium-glow-line"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "2.5px",
            background: `linear-gradient(90deg, transparent 15%, ${accentColor} 50%, transparent 85%)`,
          }}
        />
      )}

      {/* Header Row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <div
            style={{
              fontSize: "18px",
              background: enabled ? `${accentColor}1C` : "rgba(255,255,255,0.06)",
              color: enabled ? accentColor : "#555560",
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: enabled ? `inset 0 0 8px ${accentColor}25` : "none",
              transition: "all 0.3s",
              flexShrink: 0,
            }}
          >
            ⌨️
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#ECECEC", fontSize: "14px", fontWeight: 800, fontFamily: "var(--font-ui)" }}>
                {title}
              </span>
              {isMinimized && (
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 800,
                    background: enabled ? `${accentColor}1A` : "rgba(255,255,255,0.06)",
                    color: enabled ? accentColor : "#555560",
                    padding: "2px 6px",
                    borderRadius: "12px",
                    letterSpacing: "0.05em",
                  }}
                >
                  {enabled ? "ACTIVE" : "MUTED"}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          {/* Toggle button */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {enabled ? "ON" : "OFF"}
            </span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                onEnabledChange(!enabled);
              }}
              style={{
                width: "38px",
                height: "20px",
                borderRadius: "10px",
                background: enabled ? accentColor : "rgba(255, 255, 255, 0.1)",
                position: "relative",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  left: enabled ? "20px" : "2px",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  background: "white",
                  transition: "left 0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                }}
              />
            </div>
          </div>

          <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.08)" }} />

          {/* Minimize toggle button */}
          <button
            onClick={toggleMinimize}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              borderRadius: "6px",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "white";
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--ink-3)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: isMinimized ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Children content area */}
      {!isMinimized && (
        <div
          style={{
            marginTop: "4px",
            animation: "slideDown 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
