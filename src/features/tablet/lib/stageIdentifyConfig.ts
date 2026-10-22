import type { EntityId } from "../../../entities/laboratory";

export type IdentifyFieldDef = {
  readonly id: string;
  readonly label: string;
  /** Accepted chemical formulas (ASCII or unicode subscripts). */
  readonly answers: readonly string[];
};

const SUBSCRIPT_TO_DIGIT: Readonly<Record<string, string>> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
};

/** Normalize formula text for comparison (spaces / unicode indices / case). */
export const normalizeIdentifyFormula = (raw: string): string =>
  raw
    .trim()
    .replace(/\s+/g, "")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (char) => SUBSCRIPT_TO_DIGIT[char] ?? char)
    .toLowerCase();

/** Input rows for «Определить вещества» steps — keyed by step id. */
export const STAGE_IDENTIFY_FIELDS: Readonly<Record<EntityId, readonly IdentifyFieldDef[]>> = {
  "step-1-identify": [
    { id: "metal-x", label: "Металл X", answers: ["Cu"] },
    { id: "liquid-y", label: "Жидкость Y", answers: ["HNO3"] },
  ],
  "step-2-identify": [
    { id: "salt-x", label: "Соль X", answers: ["AgNO3"] },
    { id: "salt-y", label: "Соль Y", answers: ["NaCl"] },
  ],
  "step-3-identify": [
    { id: "salt-a", label: "Соль A", answers: ["BaCl2"] },
    { id: "salt-b", label: "Соль B", answers: ["K2SO4"] },
  ],
  "step-4-identify": [
    { id: "acid", label: "Серная кислота", answers: ["H2SO4"] },
    { id: "sulfite", label: "Сульфит натрия", answers: ["Na2SO3"] },
    { id: "permanganate", label: "Перманганат калия", answers: ["KMnO4"] },
  ],
};

export const isIdentifyStep = (stepId: EntityId | null): boolean =>
  stepId !== null && stepId in STAGE_IDENTIFY_FIELDS;

export type IdentifyCheckResult = {
  readonly ok: boolean;
  readonly wrongFieldIds: readonly string[];
};

/** Returns whether all identify fields match an accepted formula. */
export const checkIdentifyAnswers = (
  stepId: EntityId,
  values: Readonly<Record<string, string>>,
): IdentifyCheckResult => {
  const fields = STAGE_IDENTIFY_FIELDS[stepId];
  if (!fields) return { ok: true, wrongFieldIds: [] };

  const wrongFieldIds: string[] = [];
  for (const field of fields) {
    const normalized = normalizeIdentifyFormula(values[field.id] ?? "");
    const accepted = field.answers.some(
      (answer) => normalizeIdentifyFormula(answer) === normalized,
    );
    if (!accepted) wrongFieldIds.push(field.id);
  }

  return { ok: wrongFieldIds.length === 0, wrongFieldIds };
};
