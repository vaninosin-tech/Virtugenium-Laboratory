import type {
  AppMode,
  CameraView,
  EntityId,
  LaboratoryError,
  LaboratorySession,
  ScoreEvent,
  Screen,
} from "../../entities/laboratory";

export type TabletSection =
  | "tasks"
  | "description"
  | "stages"
  | "theory"
  | "errors"
  | "answer"
  | "settings";

export interface LaboratoryStoreState extends LaboratorySession {
  readonly tabletOpen: boolean;
  readonly tabletSection: TabletSection;
  readonly basketItemIds: readonly EntityId[];
  readonly liquidColor: string;
}

export interface LaboratoryStoreActions {
  setMode: (mode: AppMode) => void;
  setScreen: (screen: Screen) => void;
  setCameraView: (cameraView: CameraView) => void;

  openTablet: (section?: TabletSection) => void;
  closeTablet: () => void;
  setTabletSection: (section: TabletSection) => void;

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
  finishSession: (finishedAt: string) => void;

  toggleLiquidColor: () => void;
  resetAttempt: () => void;
  resetLaboratory: () => void;
}

export type LaboratoryStore =
  LaboratoryStoreState & LaboratoryStoreActions;
