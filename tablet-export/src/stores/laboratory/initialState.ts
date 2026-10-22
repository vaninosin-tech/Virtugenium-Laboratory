import type { LaboratoryStoreState } from "./types";

export const DEFAULT_LIQUID_COLOR = "#0ea5e9";
export const ALTERNATIVE_LIQUID_COLOR = "#10b981";

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
  basketItemIds: [],
  liquidColor: DEFAULT_LIQUID_COLOR,
});
