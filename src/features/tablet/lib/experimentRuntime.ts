import type {
  EntityId,
  Experiment,
  ExperimentStep,
  GradeThresholds,
} from "../../../entities/laboratory";
import type { EquationAnswer } from "../../../entities/equation";
import { LABORATORY_CONTENT } from "../../../data/content/experiments";

export const getExperimentById = (id: EntityId | null): Experiment | null =>
  id === null
    ? null
    : (LABORATORY_CONTENT.experiments.find((experiment) => experiment.id === id) ?? null);

export const getStepById = (
  experiment: Experiment | null,
  stepId: EntityId | null,
): ExperimentStep | null => {
  if (experiment === null || stepId === null) return null;
  return experiment.steps.find((step) => step.id === stepId) ?? null;
};

export const getNextStepId = (
  experiment: Experiment,
  currentStepId: EntityId | null,
): EntityId | null => {
  const currentIndex = experiment.steps.findIndex((step) => step.id === currentStepId);
  const nextStep = experiment.steps[currentIndex + 1];
  return nextStep?.id ?? null;
};

export const isEquationStep = (step: ExperimentStep): boolean =>
  step.requirements.some((requirement) => requirement.type === "equation-correct");

export const getEquationIdForStep = (step: ExperimentStep): EntityId | null => {
  const requirement = step.requirements.find(
    (candidate) => candidate.type === "equation-correct",
  );
  return requirement && requirement.type === "equation-correct" ? requirement.equationId : null;
};

export const getItemById = (id: EntityId) =>
  LABORATORY_CONTENT.items.find((item) => item.id === id) ?? null;

export const totalScore = (scoreEvents: readonly { readonly points: number }[]): number =>
  scoreEvents.reduce((sum, event) => sum + event.points, 0);

/** Points already awarded for a specific checklist step. */
export const scoreForStep = (
  scoreEvents: readonly { readonly points: number; readonly stepId: EntityId }[],
  stepId: EntityId,
): number =>
  scoreEvents
    .filter((event) => event.stepId === stepId)
    .reduce((sum, event) => sum + event.points, 0);

/**
 * How many points completing this step can award (success rules + observation
 * blocks when the step is the equation answer).
 */
export const potentialPointsForStep = (
  experiment: Experiment,
  step: ExperimentStep,
): number => {
  const fromRules = step.successScoreRules.reduce((sum, rule) => sum + rule.points, 0);
  if (!isEquationStep(step) || !experiment.observationBlocks) return fromRules;
  const fromObservations = experiment.observationBlocks.reduce(
    (sum, block) => sum + block.points,
    0,
  );
  return fromRules + fromObservations;
};

export type GradeLabel = "Отлично" | "Хорошо" | "Удовлетворительно" | "Неудовлетворительно";

/** Maps a raw score onto the ToR absolute thresholds for the active experiment. */
export const gradeForScore = (
  score: number,
  thresholds: GradeThresholds | undefined,
): GradeLabel => {
  if (!thresholds) return "Неудовлетворительно";
  if (score >= thresholds.excellentMin) return "Отлично";
  if (score >= thresholds.goodMin) return "Хорошо";
  if (score >= thresholds.satisfactoryMin) return "Удовлетворительно";
  return "Неудовлетворительно";
};

export interface StepProgress {
  readonly completed: number;
  readonly total: number;
  readonly ratio: number;
}

export const getStepProgress = (
  experiment: Experiment | null,
  completedStepIds: readonly EntityId[],
): StepProgress => {
  const total = experiment?.steps.length ?? 0;
  if (total === 0) return { completed: 0, total: 0, ratio: 0 };
  const completed = experiment!.steps.filter((step) => completedStepIds.includes(step.id)).length;
  return { completed, total, ratio: completed / total };
};

interface MolecularTerm {
  readonly coefficient: number;
  readonly formula: string;
}

const TERM_PATTERN = /^(\d+)?([A-Za-z0-9()]+)$/;

const parseMolecularSide = (side: string): readonly MolecularTerm[] =>
  side
    .split("+")
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((trimmed) => {
      const match = TERM_PATTERN.exec(trimmed);
      if (!match) return { coefficient: 1, formula: trimmed };
      const [, coefficientText, formula] = match;
      return { coefficient: coefficientText ? Number(coefficientText) : 1, formula };
    });

/** Loosely parses a plain "3Cu + 8HNO3 -> 3Cu(NO3)2 + ..." string, as stored in `ChemicalEquation.molecular`. */
export const parseMolecularEquation = (
  molecular: string,
): { readonly reactants: readonly MolecularTerm[]; readonly products: readonly MolecularTerm[] } => {
  const arrow = molecular.includes("<->") ? "<->" : "->";
  const [reactantsRaw, productsRaw] = molecular.split(arrow);
  return {
    reactants: parseMolecularSide(reactantsRaw ?? ""),
    products: parseMolecularSide(productsRaw ?? ""),
  };
};

const termKey = (term: MolecularTerm): string => `${term.coefficient}:${term.formula}`;

const sideMatches = (
  answerSide: readonly MolecularTerm[],
  targetSide: readonly MolecularTerm[],
): boolean => {
  if (answerSide.length !== targetSide.length) return false;
  const targetKeys = new Set(targetSide.map(termKey));
  return answerSide.every((term) => targetKeys.has(termKey(term)));
};

/**
 * Order-independent comparison between a validated `EquationAnswer` and the
 * experiment's target molecular equation. Only meaningful once
 * `validateEquation` has already confirmed the answer is internally
 * consistent (balanced, minimal coefficients) — this just checks it's
 * *this* reaction and not some other balanced-but-irrelevant equation.
 */
export const equationMatchesTarget = (
  answer: EquationAnswer,
  targetMolecular: string,
): boolean => {
  const target = parseMolecularEquation(targetMolecular);
  return (
    sideMatches(answer.reactants, target.reactants) &&
    sideMatches(answer.products, target.products)
  );
};
