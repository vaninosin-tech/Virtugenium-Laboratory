import type { EquationDraft, LaboratoryStoreState } from "./types";

export const DEFAULT_LIQUID_COLOR = "#0ea5e9";
export const ALTERNATIVE_LIQUID_COLOR = "#10b981";

export const EMPTY_EQUATION_TERM = { coefficient: 1, formula: "" } as const;

export const createEmptyEquationDraft = (): EquationDraft => ({
  molecularText: "",
  reactants: [{ ...EMPTY_EQUATION_TERM }],
  products: [{ ...EMPTY_EQUATION_TERM }],
  arrow: "->",
  observations: {},
});

export const createInitialLaboratoryState = (): LaboratoryStoreState => ({
  mode: "training",
  screen: "main-menu",
  cameraView: "overview",
  selectedExperimentId: null,
  currentStepId: null,
  inventoryItemIds: [],
  completedStepIds: [],
  completedExperimentIds: [],
  scoreEvents: [],
  errors: [],
  startedAt: "",
  finishedAt: null,
  tabletOpen: false,
  tabletSection: "tasks",
  tabletHistory: [],
  theoryFocusId: null,
  basketItemIds: [],
  liquidColor: DEFAULT_LIQUID_COLOR,
  equationDraft: createEmptyEquationDraft(),
  identifyAnswers: {},
});
