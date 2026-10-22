export type ComposerGlyph = {
  readonly display: string;
  readonly start: number;
  readonly end: number;
};

/** Tokenize equation / formula text for caret + glyph rendering. */
export const tokenizeComposerText = (text: string): readonly ComposerGlyph[] => {
  const glyphs: ComposerGlyph[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("<->", index)) {
      glyphs.push({ display: "⇌", start: index, end: index + 3 });
      index += 3;
      continue;
    }
    if (text.startsWith("->", index)) {
      glyphs.push({ display: "→", start: index, end: index + 2 });
      index += 2;
      continue;
    }
    glyphs.push({ display: text[index]!, start: index, end: index + 1 });
    index += 1;
  }
  return glyphs;
};
