import { useState, type CSSProperties } from "react";

/**
 * Free-typing number input for every dev-menu panel. A plain controlled
 * `<input type="number" value={n} onChange={...}>` re-renders the DOM value
 * back to the last-committed number on every keystroke that doesn't parse
 * yet ("-", ".", "", a leading zero) — visibly reverting whatever the user
 * just typed. This keeps its own local text draft instead: every keystroke
 * stays on screen, a value commits to the store the moment it parses (no
 * min/max clamp — the user must be able to type a number below the field's
 * nominal minimum without it being blocked), and only an actually-invalid
 * draft snaps back to the last committed number, on blur.
 */
export function NumberField({
  value,
  onCommit,
  step,
  style,
}: {
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly step?: number;
  readonly style?: CSSProperties;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const [lastValue, setLastValue] = useState(value);

  // Resync when `value` changes from outside this field (D-pad buttons,
  // RESET, selecting a different object) — a render-phase adjustment (React's
  // documented pattern for "state derived from a changing prop") rather than
  // an effect, so it never fights the user's own in-progress keystrokes and
  // never fires a redundant extra commit.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      step={step}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (text.trim() === "") return;
        const parsed = Number(text);
        if (Number.isFinite(parsed)) onCommit(parsed);
      }}
      onBlur={() => setDraft(String(value))}
      style={{ ...defaultStyle, ...style }}
    />
  );
}

const defaultStyle: CSSProperties = {
  width: 48,
  backgroundColor: "rgba(15, 23, 42, 0.9)",
  color: "#e2e8f0",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 6,
  fontSize: 11,
  padding: "3px 4px",
};
