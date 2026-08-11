import { useState } from "react";
import { useTheme } from "../theme";

interface PremiumSectionProps {
  title: string;
  accentColor: string;
  storageKey: string;
  icon?: string;
  children: React.ReactNode;
}

export default function PremiumSection({
  title,
  accentColor,
  storageKey,
  icon,
  children,
}: PremiumSectionProps) {
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
        border: `1.5px solid rgba(255, 255, 255, 0.08)`,
        boxShadow: `0 8px 32px -4px rgba(0, 0, 0, 0.5)`,
        borderRadius: "16px",
        padding: isMinimized ? "12px 18px" : "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: isMinimized ? "0" : "14px",
        transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
        position: "relative",
        overflow: "visible",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes slideDownSection {
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
          {icon && (
            <div
              style={{
                fontSize: "16px",
                background: "rgba(255,255,255,0.06)",
                color: "#ECECEC",
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {icon}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <span style={{ color: "#ECECEC", fontSize: "13.5px", fontWeight: 800, fontFamily: "var(--font-ui)", letterSpacing: "0.02em" }}>
              {title}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
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
            animation: "slideDownSection 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
