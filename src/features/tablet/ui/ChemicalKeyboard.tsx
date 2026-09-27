import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  buildPhysicalCodeMap,
  isNativeTypingTarget,
  readCapsLockFromEvent,
} from "../lib/physicalKeyboard";
import { colors, typography } from "./tabletStyles";
import { TABLET_COMPOSER_BOARD_HEIGHT, TABLET_SPEC_PAD_WIDTH } from "./tabletComposerLayout";

type IndexMode = "none" | "sub" | "super";

type ChemKeyDef = {
  readonly id: string;
  readonly label: string;
  readonly subLabel?: string;
  readonly insert?: string;
  readonly shiftInsert?: string;
  readonly action?: "backspace" | "clear" | "space" | "shift" | "caps" | "sub" | "super" | "left" | "right";
  readonly physical?: readonly string[];
  readonly units?: number;
};

const DIGIT_TO_SUB: Readonly<Record<string, string>> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

const DIGIT_TO_SUPER: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

const DIGIT_ROW: readonly ChemKeyDef[] = [
  { id: "1", label: "1", insert: "1", physical: ["Digit1"], units: 1 },
  { id: "2", label: "2", insert: "2", physical: ["Digit2"], units: 1 },
  { id: "3", label: "3", insert: "3", physical: ["Digit3"], units: 1 },
  { id: "4", label: "4", insert: "4", physical: ["Digit4"], units: 1 },
  { id: "5", label: "5", insert: "5", physical: ["Digit5"], units: 1 },
  { id: "6", label: "6", insert: "6", physical: ["Digit6"], units: 1 },
  { id: "7", label: "7", insert: "7", physical: ["Digit7"], units: 1 },
  { id: "8", label: "8", insert: "8", physical: ["Digit8"], units: 1 },
  { id: "9", label: "9", insert: "9", physical: ["Digit9"], units: 1 },
  { id: "0", label: "0", insert: "0", physical: ["Digit0"], units: 1 },
  { id: "minus", label: "-", insert: "-", physical: ["Minus", "NumpadSubtract"], units: 1 },
  { id: "plus", label: "+", insert: "+", physical: ["Equal", "NumpadAdd"], units: 1 },
  { id: "backspace", label: "⌫", action: "backspace", physical: ["Backspace"], units: 2 },
];

const ROW2_LETTERS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"] as const;
const ROW3_LETTERS = ["a", "s", "d", "f", "g", "h", "j", "k", "l"] as const;
const ROW4_LETTERS = ["z", "x", "c", "v", "b", "n", "m"] as const;

const letterKey = (letter: string, upper: boolean): ChemKeyDef => {
  const glyph = upper ? letter.toUpperCase() : letter;
  return {
    id: `L-${letter}`,
    label: glyph,
    insert: glyph,
    physical: [`Key${letter.toUpperCase()}`],
    units: 1,
  };
};

const CHEM_PAD_SYMBOLS: readonly ChemKeyDef[] = [
  { id: "lsb", label: "[", insert: "[" },
  { id: "rsb", label: "]", insert: "]" },
  { id: "arrow", label: "→", insert: "->" },
  { id: "rev", label: "⇌", insert: "<->" },
];

const CHEM_PAD_MARKS: readonly ChemKeyDef[] = [
  { id: "up", label: "↑", insert: "↑" },
  { id: "down", label: "↓", insert: "↓" },
  { id: "middot", label: "·", insert: "·" },
];

const CHEM_PAD_INDEX: readonly ChemKeyDef[] = [
  { id: "mode-sub", label: "X₂", action: "sub" },
  { id: "mode-super", label: "X²", action: "super" },
];

const SPACE_ROW: readonly ChemKeyDef[] = [
  { id: "nav-left", label: "←", action: "left", physical: ["ArrowLeft"], units: 8 },
  { id: "space", label: "Пробел", action: "space", physical: ["Space"], units: 8 },
  { id: "nav-right", label: "→", action: "right", physical: ["ArrowRight"], units: 8 },
];

const isDigitChar = (value: string): boolean => /^[0-9]$/.test(value);

const isLetterOrSpecial = (value: string): boolean => {
  if (!value) return false;
  if (isDigitChar(value)) return false;
  // Multi-char inserts like "->" count as special
  if (value.length > 1) return true;
  return /[A-Za-z]/.test(value) || !isDigitChar(value);
};

type ChemicalKeyboardProps = {
  readonly onInsert: (text: string) => void;
  readonly onBackspace: () => void;
  readonly onClear: () => void;
  readonly onMoveLeft: () => void;
  readonly onMoveRight: () => void;
  readonly enabled?: boolean;
};

/**
 * QWERTY + chemistry pad. Sticky subscript/superscript modes apply to digits;
 * the mode releases when a letter or special symbol is typed.
 */
export function ChemicalKeyboard({
  onInsert,
  onBackspace,
  onMoveLeft,
  onMoveRight,
  enabled = true,
}: ChemicalKeyboardProps) {
  const [shiftHeld, setShiftHeld] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [indexMode, setIndexMode] = useState<IndexMode>("none");
  const [litIds, setLitIds] = useState<ReadonlySet<string>>(() => new Set());

  const lettersUpper = capsLock !== shiftHeld;

  const mainRows = useMemo((): ChemKeyDef[][] => {
    return [
      [...DIGIT_ROW],
      ROW2_LETTERS.map((letter) => letterKey(letter, lettersUpper)),
      [
        { id: "caps", label: capsLock ? "CAPS" : "Caps", action: "caps", units: 1.75 },
        ...ROW3_LETTERS.map((letter) => letterKey(letter, lettersUpper)),
      ],
      [
        { id: "shift-l", label: "Shift", action: "shift", units: 2.25 },
        ...ROW4_LETTERS.map((letter) => letterKey(letter, lettersUpper)),
        { id: "paren-l", label: "(", insert: "(", units: 1.35 },
        { id: "paren-r", label: ")", insert: ")", units: 1.4 },
      ],
      [...SPACE_ROW],
    ];
  }, [capsLock, lettersUpper]);

  const flash = useCallback((id: string) => {
    setLitIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setLitIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 120);
  }, []);

  const syncCaps = (event: KeyboardEvent) => {
    setCapsLock(readCapsLockFromEvent(event));
  };

  const emitInsert = useCallback(
    (raw: string) => {
      if (!raw) return;

      // Digits and +/- keep the sticky index mode; letters/specials release it.
      if (isDigitChar(raw) && indexMode === "sub") {
        onInsert(DIGIT_TO_SUB[raw] ?? raw);
        return;
      }
      if (isDigitChar(raw) && indexMode === "super") {
        onInsert(DIGIT_TO_SUPER[raw] ?? raw);
        return;
      }

      if (raw === "+" && indexMode === "sub") {
        onInsert("₊");
        return;
      }
      if (raw === "-" && indexMode === "sub") {
        onInsert("₋");
        return;
      }
      if (raw === "+" && indexMode === "super") {
        onInsert("⁺");
        return;
      }
      if (raw === "-" && indexMode === "super") {
        onInsert("⁻");
        return;
      }

      if (indexMode !== "none" && isLetterOrSpecial(raw)) {
        setIndexMode("none");
      }
      onInsert(raw);
    },
    [indexMode, onInsert],
  );

  const pressKey = useCallback(
    (key: ChemKeyDef) => {
      if (!enabled) return;
      flash(key.id);

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
      if (key.action === "shift" || key.action === "caps") return;
      if (key.action === "backspace") {
        onBackspace();
        return;
      }
      if (key.action === "space") {
        if (indexMode !== "none") setIndexMode("none");
        onInsert(" ");
        return;
      }
      if (key.shiftInsert !== undefined && shiftHeld) {
        emitInsert(key.shiftInsert);
        return;
      }
      emitInsert(key.insert ?? "");
    },
    [emitInsert, enabled, flash, indexMode, onBackspace, onInsert, onMoveLeft, onMoveRight, shiftHeld],
  );

  const allKeys = useMemo(
    () => [...mainRows.flat(), ...CHEM_PAD_SYMBOLS, ...CHEM_PAD_MARKS, ...CHEM_PAD_INDEX],
    [mainRows],
  );

  const codeToKey = useMemo(() => buildPhysicalCodeMap(allKeys), [allKeys]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      syncCaps(event);

      if (event.key === "Shift") {
        setShiftHeld(true);
        flash("shift-l");
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
        "(": { id: "paren-l", insert: "(" },
        ")": { id: "paren-r", insert: ")" },
        "[": { id: "lsb", insert: "[" },
        "]": { id: "rsb", insert: "]" },
        "+": { id: "plus", insert: "+" },
        "-": { id: "minus", insert: "-" },
      };
      if (direct[event.key]) {
        event.preventDefault();
        const mapped = direct[event.key]!;
        flash(mapped.id);
        emitInsert(mapped.insert);
        return;
      }

      const byCode = codeToKey.get(event.code);
      if (byCode) {
        if (byCode.id.startsWith("L-") && /^[a-zA-Z]$/.test(event.key)) {
          event.preventDefault();
          flash(byCode.id);
          emitInsert(event.key);
          return;
        }
        event.preventDefault();
        if (byCode.shiftInsert !== undefined && event.shiftKey) {
          flash(byCode.id);
          emitInsert(byCode.shiftInsert);
          return;
        }
        pressKey(byCode);
        return;
      }

      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        flash(`L-${event.key.toLowerCase()}`);
        emitInsert(event.key);
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
  }, [codeToKey, emitInsert, enabled, flash, pressKey]);

  const holdShift = (down: boolean) => setShiftHeld(down);

  const toggleCaps = () => {
    setCapsLock((value) => !value);
    flash("caps");
  };

  const renderKey = (key: ChemKeyDef, pad = false) => {
    const modeLit =
      (key.action === "sub" && indexMode === "sub") || (key.action === "super" && indexMode === "super");
    const lit =
      litIds.has(key.id) ||
      modeLit ||
      (key.action === "shift" && shiftHeld) ||
      (key.action === "caps" && capsLock);
    const dual = Boolean(key.subLabel);
    const emphasizeShift = dual && shiftHeld;
    const isNav = key.action === "left" || key.action === "right";
    const isBoldSymbol = key.id === "arrow" || key.id === "rev";
    const isLetter = key.id.startsWith("L-");
    const shiftLetterHighlight = isLetter && shiftHeld && !lit;

    return (
      <button
        key={key.id}
        type="button"
        disabled={!enabled}
        aria-pressed={key.action === "sub" || key.action === "super" ? modeLit : undefined}
        tabIndex={-1}
        style={pad ? padKeyStyle(lit, modeLit) : keyStyle(lit, key.units ?? 1)}
        onClick={() => {
          if (key.action === "caps") {
            toggleCaps();
            return;
          }
          if (key.action !== "shift") pressKey(key);
        }}
        onPointerDown={(event) => {
          // Keep focus off keys so the browser focus ring does not stick after click.
          event.preventDefault();
          if (key.action === "shift") {
            holdShift(true);
            flash(key.id);
          }
        }}
        onPointerUp={() => {
          if (key.action === "shift") holdShift(false);
        }}
        onPointerLeave={() => {
          if (key.action === "shift") holdShift(false);
        }}
        onPointerCancel={() => {
          if (key.action === "shift") holdShift(false);
        }}
      >
        {dual ? (
          <span style={dualLabelStyle}>
            <span style={subGlyphStyle(emphasizeShift, lit)}>{key.subLabel}</span>
            <span style={mainGlyphStyle(emphasizeShift, lit)}>{key.label}</span>
          </span>
        ) : (
          <span
            style={
              isNav
                ? navLabelStyle
                : isBoldSymbol
                  ? boldSymbolLabelStyle
                  : singleLabelStyle(shiftLetterHighlight)
            }
          >
            {key.label}
          </span>
        )}
      </button>
    );
  };

  return (
    <div style={shellStyle}>
      <div style={boardStyle} role="group" aria-label="Основная клавиатура">
        {mainRows.map((row, rowIndex) => (
          <div key={rowIndex} style={rowStyle}>
            {row.map((key) => renderKey(key))}
          </div>
        ))}
      </div>

      <div style={padStyle} role="group" aria-label="Специальные символы">
        <span style={padTitleStyle}>СПЕЦ. СИМВОЛЫ</span>
        <div style={{ ...padRowStyle, gridTemplateColumns: "repeat(4, 1fr)" }}>
          {CHEM_PAD_SYMBOLS.map((key) => renderKey(key, true))}
        </div>
        <div style={{ ...padRowStyle, gridTemplateColumns: "repeat(3, 1fr)" }}>
          {CHEM_PAD_MARKS.map((key) => renderKey(key, true))}
        </div>
        <span style={padTitleStyle}>Индексы</span>
        <div style={{ ...padRowStyle, gridTemplateColumns: "1fr 1fr" }}>
          {CHEM_PAD_INDEX.map((key) => renderKey(key, true))}
        </div>
      </div>
    </div>
  );
}

const shellStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "stretch",
  flexShrink: 0,
  minWidth: 0,
  height: TABLET_COMPOSER_BOARD_HEIGHT,
  boxSizing: "border-box",
};

const boardStyle: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgElevated,
  boxShadow: `inset 0 0 0 1px ${colors.accentSoft}`,
  boxSizing: "border-box",
};

const padStyle: CSSProperties = {
  flex: `0 0 ${TABLET_SPEC_PAD_WIDTH}px`,
  width: TABLET_SPEC_PAD_WIDTH,
  minHeight: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgElevated,
  boxShadow: `inset 0 0 0 1px ${colors.accentSoft}`,
  boxSizing: "border-box",
};

const padTitleStyle: CSSProperties = {
  flex: "0 0 auto",
  fontSize: 11,
  fontWeight: typography.weightSemibold,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: colors.accentBright,
  padding: "2px 2px 0",
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: 5,
  width: "100%",
  alignItems: "stretch",
  flex: "1 1 0",
  minHeight: 0,
};

const padRowStyle: CSSProperties = {
  display: "grid",
  gap: 5,
  flex: "1 1 0",
  minHeight: 0,
  alignContent: "stretch",
};

const keyStyle = (lit: boolean, units: number): CSSProperties => ({
  flex: `${units} 1 0`,
  minWidth: 0,
  minHeight: 0,
  height: "100%",
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
  fontSize: 12,
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

const padKeyStyle = (lit: boolean, sticky = false): CSSProperties => ({
  ...keyStyle(lit, 1),
  flex: "1 1 0",
  width: "100%",
  height: "100%",
  minHeight: sticky ? 48 : 0,
  fontSize: sticky ? 18 : 16,
  fontFamily: typography.fontFamilyMono,
});

const navLabelStyle: CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
  fontFamily: typography.fontFamilyMono,
  fontWeight: 900,
  letterSpacing: "-0.04em",
  textShadow: "0 0 0 currentColor, 0.6px 0 0 currentColor, -0.6px 0 0 currentColor",
};

const boldSymbolLabelStyle: CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
  fontFamily: typography.fontFamilyMono,
  fontWeight: 900,
  letterSpacing: "-0.02em",
  textShadow:
    "0 0 0 currentColor, 0.7px 0 0 currentColor, -0.7px 0 0 currentColor, 0 0.55px 0 currentColor, 0 -0.55px 0 currentColor",
};

const dualLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  height: "100%",
};

const subGlyphStyle = (emphasized: boolean, lit: boolean): CSSProperties => ({
  fontSize: 10,
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightBold,
  color: emphasized
    ? lit
      ? colors.accentInk
      : colors.accentBright
    : lit
      ? "rgba(15, 23, 42, 0.7)"
      : colors.textMuted,
});

const mainGlyphStyle = (deemphasized: boolean, lit: boolean): CSSProperties => ({
  fontSize: 13,
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightSemibold,
  opacity: deemphasized ? 0.55 : 1,
  color: lit ? colors.accentInk : colors.textPrimary,
});

const singleLabelStyle = (shiftHighlight = false): CSSProperties => ({
  fontSize: "inherit",
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightSemibold,
  color: shiftHighlight ? colors.accentBright : undefined,
});
