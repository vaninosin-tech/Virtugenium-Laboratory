import type {
  AppMode,
  CameraView,
  EntityId,
  LaboratoryError,
  LaboratorySession,
  ScoreEvent,
  Screen,
} from "../../entities/laboratory";
import type { EquationArrow, EquationTerm } from "../../entities/equation";

export type TabletSection =
  | "tasks"
  | "stages"
  | "theory"
  | "errors"
  | "answer"
  | "observations"
  | "transfer"
  | "settings";

/** Sections that require an accepted assignment (`selectedExperimentId`). */
export const TASK_LOCKED_SECTIONS: readonly TabletSection[] = [
  "stages",
  "answer",
  "observations",
  "errors",
  "transfer",
];

export const isSectionLockedWithoutTask = (
  section: TabletSection,
  selectedExperimentId: EntityId | null,
): boolean => selectedExperimentId === null && TASK_LOCKED_SECTIONS.includes(section);

/** In-progress answer on the Equation tab — survives tab switches within an attempt. */
export interface EquationDraft {
  /** Free-form molecular equation typed via the chemical keyboard. */
  readonly molecularText: string;
  readonly reactants: readonly EquationTerm[];
  readonly products: readonly EquationTerm[];
  readonly arrow: EquationArrow;
  readonly observations: Readonly<Record<string, string>>;
}

export interface LaboratoryStoreState extends LaboratorySession {
  readonly tabletOpen: boolean;
  readonly tabletSection: TabletSection;
  /** Previous panels for the header back button (LIFO). */
  readonly tabletHistory: readonly TabletSection[];
  /** Optional reagent id to focus when opening «Теория». */
  readonly theoryFocusId: string | null;
  readonly basketItemIds: readonly EntityId[];
  readonly liquidColor: string;
  readonly equationDraft: EquationDraft;
  /** In-progress answers for «Определить вещества» (survives hologram / tab switches). */
  readonly identifyAnswers: Readonly<Record<string, string>>;
}

export interface LaboratoryStoreActions {
  setMode: (mode: AppMode) => void;
  setScreen: (screen: Screen) => void;
  setCameraView: (cameraView: CameraView) => void;

  openTablet: (section?: TabletSection) => void;
  closeTablet: () => void;
  /** Replace current section without touching history. */
  setTabletSection: (section: TabletSection) => void;
  /** Go to section and push the current one onto the back stack. */
  pushTabletSection: (section: TabletSection) => void;
  /** Pop history and restore the previous section. */
  goBackTablet: () => void;
  setTheoryFocusId: (theoryFocusId: string | null) => void;

  addInventoryItem: (itemId: EntityId) => void;
  removeInventoryItem: (itemId: EntityId) => void;
  addBasketItem: (itemId: EntityId) => void;
  removeBasketItem: (itemId: EntityId) => void;
  selectExperiment: (experimentId: EntityId) => void;
  setCurrentStep: (stepId: EntityId | null) => void;
  completeStep: (stepId: EntityId) => void;
  completeExperiment: (experimentId: EntityId) => void;

  addScoreEvent: (event: ScoreEvent) => void;
  addError: (error: LaboratoryError) => void;
  /** Drop attempt errors tied to a step (e.g. before re-checking the equation). */
  clearErrorsForStep: (stepId: EntityId) => void;
  finishSession: (finishedAt: string) => void;

  setEquationReactants: (reactants: readonly EquationTerm[]) => void;
  setEquationProducts: (products: readonly EquationTerm[]) => void;
  setEquationArrow: (arrow: EquationArrow) => void;
  setEquationMolecularText: (molecularText: string) => void;
  setEquationObservation: (blockId: string, optionId: string) => void;
  resetEquationDraft: () => void;
  setIdentifyAnswer: (fieldId: string, value: string) => void;
  clearIdentifyAnswers: () => void;

  toggleLiquidColor: () => void;
  /** Drop current assignment; keep tablet open and return to «Задания». */
  clearAssignment: () => void;
  resetAttempt: () => void;
  resetLaboratory: () => void;
}

export type LaboratoryStore = LaboratoryStoreState & LaboratoryStoreActions;
