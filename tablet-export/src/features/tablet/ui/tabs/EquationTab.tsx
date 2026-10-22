import { useState, type CSSProperties } from "react";

import type { EquationArrow, EquationTerm } from "../../../../entities/equation";
import { validateEquation } from "../../../../entities/equation";
import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import {
  equationMatchesTarget,
  getEquationIdForStep,
  getExperimentById,
  getStepById,
  isEquationStep,
} from "../../lib/experimentRuntime";
import { advanceStep } from "../../lib/stepActions";
import { colors, ghostButtonStyle, inputStyle, mutedTextStyle, panelStyle, primaryButtonStyle, sectionTitleStyle } from "../tabletStyles";

const EMPTY_TERM: EquationTerm = { coefficient: 1, formula: "" };

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "invalid"; readonly messages: readonly string[] }
  | { readonly kind: "wrong-reaction" }
  | { readonly kind: "correct" };

/**
 * "Уравнение и признак реакции" — the structured editor from
 * `docs/decisions/VL-008-equation-input.md` (coefficient/formula/charge per
 * term, not freehand drawing), wired to the real `validateEquation`
 * balance/structure checker plus a target-equation match so a correctly
 * balanced but unrelated equation doesn't pass.
 */
export function EquationTab() {
  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);
  const currentStepId = useLaboratoryStore((state) => state.currentStepId);

  const experiment = getExperimentById(selectedExperimentId);
  const currentStep = getStepById(experiment, currentStepId);
  const equationId = currentStep ? getEquationIdForStep(currentStep) : null;
  const targetEquation = experiment?.equations.find((equation) => equation.id === equationId) ?? null;

  const [reactants, setReactants] = useState<EquationTerm[]>([{ ...EMPTY_TERM }]);
  const [products, setProducts] = useState<EquationTerm[]>([{ ...EMPTY_TERM }]);
  const [arrow, setArrow] = useState<EquationArrow>("->");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  if (!experiment || !currentStep || !isEquationStep(currentStep)) {
    return (
      <div style={panelStyle}>
        <p style={mutedTextStyle}>
          На текущем шаге уравнение не требуется. Откройте вкладку «Этапы», чтобы увидеть, что нужно делать сейчас.
        </p>
      </div>
    );
  }

  const handleCheck = () => {
    const answer = { reactants, products, arrow };
    const result = validateEquation(answer);

    if (!result.valid) {
      setOutcome({ kind: "invalid", messages: result.issues.map((issue) => issue.message) });
      return;
    }

    if (targetEquation && !equationMatchesTarget(answer, targetEquation.molecular)) {
      setOutcome({ kind: "wrong-reaction" });
      return;
    }

    setOutcome({ kind: "correct" });
    advanceStep(experiment, currentStep);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={panelStyle}>
        <h3 style={sectionTitleStyle}>{currentStep.title}</h3>
        <p style={{ ...mutedTextStyle, margin: "6px 0 0" }}>{currentStep.instruction}</p>
      </div>

      <TermList title="Реагенты" testId="reactants" terms={reactants} onChange={setReactants} />

      <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
        {(["->", "<->"] as const).map((option) => (
          <button
            key={option}
            style={arrow === option ? primaryButtonStyle : ghostButtonStyle}
            onClick={() => setArrow(option)}
          >
            {option === "->" ? "→" : "⇌"}
          </button>
        ))}
      </div>

      <TermList title="Продукты" testId="products" terms={products} onChange={setProducts} />

      <button style={primaryButtonStyle} onClick={handleCheck}>
        Проверить
      </button>

      {outcome.kind === "invalid" && (
        <div style={{ ...panelStyle, borderColor: "rgba(248, 113, 113, 0.4)" }}>
          {outcome.messages.map((message) => (
            <p key={message} style={{ ...mutedTextStyle, color: colors.danger, margin: "2px 0" }}>
              {message}
            </p>
          ))}
        </div>
      )}

      {outcome.kind === "wrong-reaction" && (
        <div style={{ ...panelStyle, borderColor: "rgba(251, 191, 36, 0.4)" }}>
          <p style={{ ...mutedTextStyle, color: colors.warning, margin: 0 }}>
            Уравнение сбалансировано верно, но это не та реакция, которая изучается в этом опыте.
          </p>
        </div>
      )}

      {outcome.kind === "correct" && (
        <div style={{ ...panelStyle, borderColor: "rgba(52, 211, 153, 0.4)" }}>
          <p style={{ ...mutedTextStyle, color: colors.success, margin: 0 }}>Верно — шаг засчитан.</p>
        </div>
      )}
    </div>
  );
}

function TermList({
  title,
  testId,
  terms,
  onChange,
}: {
  readonly title: string;
  readonly testId: string;
  readonly terms: readonly EquationTerm[];
  readonly onChange: (terms: EquationTerm[]) => void;
}) {
  const updateTerm = (index: number, patch: Partial<EquationTerm>) => {
    onChange(terms.map((term, termIndex) => (termIndex === index ? { ...term, ...patch } : term)));
  };

  const removeTerm = (index: number) => {
    onChange(terms.filter((_, termIndex) => termIndex !== index));
  };

  return (
    <div style={panelStyle} data-testid={`term-list-${testId}`}>
      <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#e2e8f0" }}>{title}</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {terms.map((term, index) => (
          <div key={index} style={rowStyle}>
            <input
              type="number"
              min={1}
              value={term.coefficient}
              onChange={(event) => updateTerm(index, { coefficient: Number(event.target.value) })}
              style={{ ...inputStyle, width: 48 }}
            />
            <input
              type="text"
              placeholder="Формула, напр. Cu(NO3)2"
              value={term.formula}
              onChange={(event) => updateTerm(index, { formula: event.target.value })}
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              type="number"
              placeholder="заряд"
              value={term.charge ?? ""}
              onChange={(event) =>
                updateTerm(index, {
                  charge: event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
              style={{ ...inputStyle, width: 64 }}
            />
            <button style={ghostButtonStyle} onClick={() => removeTerm(index)} aria-label="Удалить">
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        style={{ ...ghostButtonStyle, marginTop: 8 }}
        onClick={() => onChange([...terms, { ...EMPTY_TERM }])}
      >
        + Добавить вещество
      </button>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "center",
};
