import { useEffect, useImperativeHandle, useState, forwardRef, type CSSProperties } from "react";

import { tokenizeComposerText } from "../lib/composerText";
import { colors, typography } from "./tabletStyles";
import "./scoreProgress.css";

export type ComposerFieldHandle = {
  readonly insert: (chunk: string) => void;
  readonly backspace: () => void;
  readonly moveLeft: () => void;
  readonly moveRight: () => void;
  readonly clear: () => void;
};

type ComposerTextFieldProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly enabled: boolean;
  readonly ariaLabel: string;
  readonly compact?: boolean;
  readonly invalid?: boolean;
};

export const ComposerTextField = forwardRef<ComposerFieldHandle, ComposerTextFieldProps>(
  function ComposerTextField(
    { value, onChange, active, onActivate, enabled, ariaLabel, compact = true, invalid = false },
    ref,
  ) {
    const [cursor, setCursor] = useState(value.length);
    const [fieldActive, setFieldActive] = useState(false);

    useEffect(() => {
      setCursor((position) => Math.min(Math.max(0, position), value.length));
    }, [value]);

    useEffect(() => {
      if (active) setFieldActive(true);
      else setFieldActive(false);
    }, [active]);

    const insert = (chunk: string) => {
      if (!enabled) return;
      setFieldActive(true);
      const next = `${value.slice(0, cursor)}${chunk}${value.slice(cursor)}`;
      onChange(next);
      setCursor(cursor + chunk.length);
    };

    const backspace = () => {
      if (!enabled) return;
      setFieldActive(true);
      if (cursor <= 0) return;
      onChange(`${value.slice(0, cursor - 1)}${value.slice(cursor)}`);
      setCursor(cursor - 1);
    };

    const clear = () => {
      if (!enabled) return;
      setFieldActive(true);
      onChange("");
      setCursor(0);
    };

    const moveLeft = () => {
      if (!enabled) return;
      setFieldActive(true);
      setCursor((position) => Math.max(0, position - 1));
    };

    const moveRight = () => {
      if (!enabled) return;
      setFieldActive(true);
      setCursor((position) => Math.min(value.length, position + 1));
    };

    useImperativeHandle(ref, () => ({ insert, backspace, moveLeft, moveRight, clear }), [
      enabled,
      value,
      cursor,
      onChange,
    ]);

    const glyphs = tokenizeComposerText(value);
    const atEnd = cursor >= value.length;
    const showPlaceholder = !value && !fieldActive;
    const showCaret = active && fieldActive && enabled;

    return (
      <div
        role="textbox"
        tabIndex={enabled ? 0 : -1}
        aria-label={ariaLabel}
        aria-disabled={!enabled}
        style={{
          ...displayStyle,
          ...(compact ? compactDisplayStyle : null),
          borderColor: invalid
            ? colors.danger
            : active
              ? colors.borderStrong
              : colors.border,
          boxShadow: invalid
            ? `0 0 0 1px ${colors.dangerSoft}, 0 0 12px ${colors.danger}33`
            : active
              ? `0 0 0 1px ${colors.accentSoft}, 0 0 12px ${colors.accent}33`
              : undefined,
          opacity: enabled ? 1 : 0.55,
        }}
        aria-invalid={invalid || undefined}
        onClick={() => {
          if (!enabled) return;
          onActivate();
          setFieldActive(true);
        }}
        onFocus={() => {
          if (!enabled) return;
          onActivate();
          setFieldActive(true);
        }}
        onBlur={() => {
          if (!value) setFieldActive(false);
        }}
      >
        <span style={displayTextStyle(compact)}>
          {showPlaceholder ? (
            <span style={placeholderStyle}>…</span>
          ) : (
            <>
              {glyphs.map((glyph) => {
                const selected = showCaret && !atEnd && cursor >= glyph.start && cursor < glyph.end;
                return (
                  <span
                    key={`${glyph.start}-${glyph.end}`}
                    className={selected ? "equation-char-selected" : undefined}
                  >
                    {glyph.display === " " ? "\u00a0" : glyph.display}
                  </span>
                );
              })}
              {showCaret && atEnd ? (
                <span className="equation-caret" aria-hidden>
                  _
                </span>
              ) : null}
            </>
          )}
        </span>
      </div>
    );
  },
);

const displayStyle: CSSProperties = {
  flex: "0 0 auto",
  minWidth: 72,
  maxWidth: 140,
  minHeight: 32,
  padding: "4px 8px",
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgInset,
  display: "flex",
  alignItems: "center",
  boxSizing: "border-box",
  overflow: "hidden",
  cursor: "text",
};

const compactDisplayStyle: CSSProperties = {
  width: 88,
};

const displayTextStyle = (compact: boolean): CSSProperties => ({
  fontFamily: typography.fontFamilyMono,
  fontSize: compact ? typography.sizeCaption : 18,
  fontWeight: typography.weightSemibold,
  color: colors.textPrimary,
  lineHeight: 1.35,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

const placeholderStyle: CSSProperties = {
  fontWeight: typography.weightMedium,
  color: colors.textMuted,
};
