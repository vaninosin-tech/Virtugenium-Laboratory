import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  buildPhysicalCodeMap,
  isNativeTypingTarget,
  readCapsLockFromEvent,
} from "../lib/physicalKeyboard";
import { colors, typography } from "./tabletStyles";

type IndexMode = "none" | "sub" | "super";

type KeyDef = {
  readonly id: string;
  readonly label: string;
  readonly insert?: string;
  readonly action?: "backspace" | "space" | "sub" | "super" | "left" | "right" | "shift" | "caps";
  readonly physical?: readonly string[];
  readonly units?: number;
};

const DIGIT_TO_SUB: Readonly<Record<string, string>> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
};

const DIGIT_TO_SUPER: Readonly<Record<string, string>> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

const ROW1_DIGITS: readonly KeyDef[] = [
  { id: "d-1", label: "1", insert: "1", physical: ["Digit1"], units: 1 },
  { id: "d-2", label: "2", insert: "2", physical: ["Digit2"], units: 1 },
  { id: "d-3", label: "3", insert: "3", physical: ["Digit3"], units: 1 },
  { id: "d-4", label: "4", insert: "4", physical: ["Digit4"], units: 1 },
  { id: "d-5", label: "5", insert: "5", physical: ["Digit5"], units: 1 },
  { id: "d-6", label: "6", insert: "6", physical: ["Digit6"], units: 1 },
  { id: "d-7", label: "7", insert: "7", physical: ["Digit7"], units: 1 },
  { id: "d-8", label: "8", insert: "8", physical: ["Digit8"], units: 1 },
  { id: "d-9", label: "9", insert: "9", physical: ["Digit9"], units: 1 },
  { id: "d-0", label: "0", insert: "0", physical: ["Digit0"], units: 1 },
  { id: "d-+", label: "+", insert: "+", physical: ["Equal", "NumpadAdd"], units: 1 },
  { id: "d--", label: "-", insert: "-", physical: ["Minus", "NumpadSubtract"], units: 1 },
];

const ROW2_LETTERS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"] as const;
const ROW3_LETTERS = ["a", "s", "d", "f", "g", "h", "j", "k", "l"] as const;
const ROW4_LETTERS = ["z", "x", "c", "v", "b", "n", "m"] as const;

const letterKey = (letter: string, upper: boolean): KeyDef => {
  const glyph = upper ? letter.toUpperCase() : letter;
  return {
    id: `L-${letter}`,
    label: glyph,
    insert: glyph,
    physical: [`Key${letter.toUpperCase()}`],
    units: 1,
  };
};

type SubstanceNameKeyboardProps = {
  readonly onInsert: (text: string) => void;
  readonly onBackspace: () => void;
  readonly onMoveLeft: () => void;
  readonly onMoveRight: () => void;
  readonly enabled?: boolean;
};

/** Compact keyboard for substance / formula names on the Stages tab. */
export function SubstanceNameKeyboard({
  onInsert,
  onBackspace,
  onMoveLeft,
  onMoveRight,
  enabled = true,
}: SubstanceNameKeyboardProps) {
  const [indexMode, setIndexMode] = useState<IndexMode>("none");
  const [litId, setLitId] = useState<string | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const lettersUpper = capsLock !== shiftHeld;

  const rows = useMemo((): readonly (readonly KeyDef[])[] => {
    return [
      ROW1_DIGITS,
      [...ROW2_LETTERS.map((letter) => letterKey(letter, lettersUpper)), { id: "bksp", label: "⌫", action: "backspace", physical: ["Backspace"], units: 2 }],
      [{ id: "caps", label: capsLock ? "CAPS" : "Caps", action: "caps", units: 1.6 }, ...ROW3_LETTERS.map((letter) => letterKey(letter, lettersUpper))],
      [
        { id: "shift", label: "Shift", action: "shift", units: 2.1 },
        ...ROW4_LETTERS.map((letter) => letterKey(letter, lettersUpper)),
        { id: "lp", label: "(", insert: "(", units: 1 },
        { id: "rp", label: ")", insert: ")", units: 1 },
      ],
      [
        { id: "sub", label: "X₂", action: "sub", units: 1.2 },
        { id: "super", label: "X²", action: "super", units: 1.2 },
        { id: "space", label: "Пробел", action: "space", physical: ["Space"], units: 4 },
        { id: "left", label: "←", action: "left", physical: ["ArrowLeft"], units: 1.2 },
        { id: "right", label: "→", action: "right", physical: ["ArrowRight"], units: 1.2 },
      ],
    ];
  }, [capsLock, lettersUpper]);

  const allKeys = useMemo(() => rows.flat(), [rows]);
  const codeToKey = useMemo(() => buildPhysicalCodeMap(allKeys), [allKeys]);

  const flash = useCallback((id: string) => {
    setLitId(id);
    window.setTimeout(() => setLitId((current) => (current === id ? null : current)), 120);
  }, []);

  const emit = useCallback(
    (raw: string) => {
      if (!raw) return;
      if (/^[0-9]$/.test(raw) && indexMode === "sub") {
        onInsert(DIGIT_TO_SUB[raw] ?? raw);
        return;
      }
      if (/^[0-9]$/.test(raw) && indexMode === "super") {
        onInsert(DIGIT_TO_SUPER[raw] ?? raw);
        return;
      }
      if (indexMode !== "none" && /[A-Za-z(+)]/.test(raw)) {
        setIndexMode("none");
      }
      onInsert(raw);
    },
    [indexMode, onInsert],
  );

  const pressKey = useCallback(
    (key: KeyDef) => {
      if (!enabled) return;
      flash(key.id);
      if (key.action === "caps") {
        setCapsLock((value) => !value);
        return;
      }
      if (key.action === "shift") return;
      if (key.action === "sub") {
        setIndexMode((mode) => (mode === "sub" ? "none" : "sub"));
        return;
      }
      if (key.action === "super") {
        setIndexMode((mode) => (mode === "super" ? "none" : "super"));
        return;
      }
      if (key.action === "left") {
        onMoveLeft();
        return;
      }
      if (key.action === "right") {
        onMoveRight();
        return;
      }
      if (key.action === "backspace") {
        onBackspace();
        return;
      }
      if (key.action === "space") {
        setIndexMode("none");
        onInsert(" ");
        return;
      }
      emit(key.insert ?? "");
    },
    [enabled, emit, flash, onBackspace, onInsert, onMoveLeft, onMoveRight],
  );

  useEffect(() => {
    if (!enabled) return;

    const syncCaps = (event: KeyboardEvent) => {
      setCapsLock(readCapsLockFromEvent(event));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      syncCaps(event);

      if (event.key === "Shift") {
        setShiftHeld(true);
        flash("shift");
        return;
      }
      if (event.key === "CapsLock") {
        window.setTimeout(() => syncCaps(event), 0);
        flash("caps");
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isNativeTypingTarget(event.target)) return;

      const direct: Record<string, { id: string; insert: string }> = {
        "(": { id: "lp", insert: "(" },
        ")": { id: "rp", insert: ")" },
        "+": { id: "d-+", insert: "+" },
        "-": { id: "d--", insert: "-" },
      };
      if (direct[event.key]) {
        event.preventDefault();
        const mapped = direct[event.key]!;
        flash(mapped.id);
        emit(mapped.insert);
        return;
      }

      const byCode = codeToKey.get(event.code);
      if (byCode) {
        if (byCode.id.startsWith("L-") && /^[a-zA-Z]$/.test(event.key)) {
          event.preventDefault();
          flash(byCode.id);
          emit(event.key);
          return;
        }
        event.preventDefault();
        pressKey(byCode);
        return;
      }

      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        flash(`L-${event.key.toLowerCase()}`);
        emit(event.key);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      syncCaps(event);
      if (event.key === "Shift") setShiftHeld(false);
    };

    const onBlur = () => setShiftHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [codeToKey, emit, enabled, flash, pressKey]);

  return (
    <div style={shellStyle} role="group" aria-label="Клавиатура для названий веществ">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} style={rowStyle}>
          {row.map((key) => {
            const sticky = key.action === "sub" || key.action === "super";
            const lit =
              litId === key.id ||
              (key.action === "sub" && indexMode === "sub") ||
              (key.action === "super" && indexMode === "super") ||
              (key.action === "shift" && shiftHeld) ||
              (key.action === "caps" && capsLock);
            const isNav = key.action === "left" || key.action === "right";
            const isLetter = key.id.startsWith("L-");
            const shiftLetterHighlight = isLetter && shiftHeld && !lit;
            return (
              <button
                key={key.id}
                type="button"
                disabled={!enabled}
                tabIndex={-1}
                aria-pressed={sticky || key.action === "caps" || key.action === "shift" ? lit : undefined}
                style={keyStyle(lit, key.units ?? 1, sticky || key.action === "caps")}
                onClick={() => {
                  if (key.action === "caps") {
                    pressKey(key);
                    return;
                  }
                  if (key.action !== "shift") pressKey(key);
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  if (key.action === "shift") {
                    setShiftHeld(true);
                    flash(key.id);
                  }
                }}
                onPointerUp={() => {
                  if (key.action === "shift") setShiftHeld(false);
                }}
                onPointerLeave={() => {
                  if (key.action === "shift") setShiftHeld(false);
                }}
                onPointerCancel={() => {
                  if (key.action === "shift") setShiftHeld(false);
                }}
              >
                <span
                  style={
                    isNav
                      ? navLabelStyle
                      : sticky
                        ? stickyLabelStyle(lit)
                        : singleLabelStyle(shiftLetterHighlight)
                  }
                >
                  {key.label}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const shellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  padding: 8,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgElevated,
  boxShadow: `inset 0 0 0 1px ${colors.accentSoft}`,
  flexShrink: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: 5,
  width: "100%",
};

const keyStyle = (lit: boolean, units: number, sticky: boolean): CSSProperties => ({
  flex: `${units} 1 0`,
  minWidth: 0,
  minHeight: sticky ? 40 : 36,
  padding: "4px 2px",
  borderRadius: 8,
  border: `1px solid ${lit ? colors.borderStrong : colors.border}`,
  backgroundColor: lit ? colors.accent : colors.bgInset,
  color: lit ? colors.accentInk : colors.textPrimary,
  boxShadow: lit
    ? `0 0 10px ${colors.accent}55`
    : "0 1px 0 rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
  cursor: "pointer",
  fontFamily: typography.fontFamilyBase,
  fontSize: sticky ? 13 : 12,
  fontWeight: typography.weightSemibold,
  lineHeight: 1.1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  outline: "none",
  WebkitTapHighlightColor: "transparent",
  transition: "background-color 0.08s ease, color 0.08s ease, box-shadow 0.08s ease",
  boxSizing: "border-box",
});

const navLabelStyle: CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
  fontFamily: typography.fontFamilyMono,
  fontWeight: 900,
  letterSpacing: "-0.04em",
  textShadow: "0 0 0 currentColor, 0.6px 0 0 currentColor, -0.6px 0 0 currentColor",
};

const stickyLabelStyle = (lit: boolean): CSSProperties => ({
  fontSize: 15,
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightBold,
  color: lit ? colors.accentInk : colors.textPrimary,
});

const singleLabelStyle = (shiftHighlight = false): CSSProperties => ({
  fontSize: "inherit",
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightSemibold,
  color: shiftHighlight ? colors.accentBright : undefined,
});
