import { useEffect, useRef, useState } from "react";

// ─── EditableValueChip ───────────────────────────────────────────────────────
// The little "62%" / "100%" display that lives at the end of every overlay
// configuration slider. Click it once and it becomes a numeric input you can
// type into directly — Enter / blur commits, Escape cancels, anything outside
// [min, max] gets clamped.
//
// Each call site provides:
//   - `value` and `onCommit` in DISPLAY space (e.g. 50–200 for a scale
//     percentage), not whatever internal float the store uses. The caller is
//     responsible for the conversion. That keeps the chip dumb and uniform.
//   - `style` to preserve the per-page chip look (Streaks uses bare colored
//     text, DSTimer/Scrim use a dark box, 1v1 uses an rgba box). The same
//     style is applied to both the static span and the editing input so the
//     control stays visually anchored when you click into it.
//
// `inputWidth` overrides the input element's width while editing — useful for
// styles that hug their text (Streaks: 36px is fine; 1v1: ~52px).

export interface EditableValueChipProps {
  value:        number;
  min:          number;
  max:          number;
  suffix?:      string;
  onCommit:     (n: number) => void;
  style?:       React.CSSProperties;
  inputWidth?:  number | string;
  title?:       string;
  ariaLabel?:   string;
}

export function EditableValueChip({
  value, min, max, suffix = "%", onCommit, style, inputWidth, title, ariaLabel,
}: EditableValueChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select-all on enter to editing so typing replaces the value
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEdit() {
    setDraft(String(value));
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    const parsed  = parseInt(trimmed, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      if (clamped !== value) onCommit(clamped);
    }
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={e => setDraft(e.target.value.replace(/[^\d-]/g, "").slice(0, 4))}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        aria-label={ariaLabel ?? "Edit value"}
        style={{
          ...style,
          width: inputWidth ?? (style as { minWidth?: number | string } | undefined)?.minWidth ?? 48,
          textAlign: "center",
          outline: "none",
          cursor: "text",
          // Honor whatever the chip looked like, but make it clear it's a focused input
          boxShadow: "0 0 0 1px rgba(255,255,255,0.16) inset",
        }}
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      title={title ?? "Click to type a value"}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(); } }}
      style={{
        ...style,
        cursor: "text",
        userSelect: "none",
      }}
    >
      {value}{suffix}
    </span>
  );
}

export default EditableValueChip;
