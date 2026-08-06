export type EntityId = string;

export type AppMode = "training" | "classic" | "clean";

export type Screen =
  | "main-menu"
  | "mode-selection"
  | "experiment-selection"
  | "laboratory"
  | "result";

export type CameraView =
  | "overview"
  | "workbench"
  | "reagent-cabinet"
  | "equipment-cabinet"
  | "safety-zone";

export type MatterState = "solid" | "liquid" | "gas" | "aqueous";

export type ItemCategory =
  | "reagent"
  | "glassware"
  | "equipment"
  | "safety";

export interface ItemBase {
  id: EntityId;
  category: ItemCategory;
  name: string;
  description: string;
  assetId: EntityId;
}

export interface Reagent extends ItemBase {
  category: "reagent";
  formula: string;
  state: MatterState;
  color: string;
  transparent: boolean;
  hazardIds: readonly EntityId[];
}

export type GlasswareKind =
  | "test-tube"
  | "beaker"
  | "flask"
  | "reagent-bottle";

export interface Glassware extends ItemBase {
  category: "glassware";
  kind: GlasswareKind;
  capacityMl: number;
}

export type EquipmentKind =
  | "burner"
  | "stand"
  | "holder"
  | "tongs"
  | "basket";

export interface Equipment extends ItemBase {
  category: "equipment";
  kind: EquipmentKind;
  attachmentPointIds: readonly EntityId[];
}

export type SafetyItemKind =
  | "goggles"
  | "gloves"
  | "lab-coat"
  | "fire-extinguisher"
  | "sand";

export interface SafetyItem extends ItemBase {
  category: "safety";
  kind: SafetyItemKind;
}

export type LaboratoryItem =
  | Reagent
  | Glassware
  | Equipment
  | SafetyItem;

export type ExperimentAction =
  | {
      type: "take-item";
      itemId: EntityId;
    }
  | {
      type: "place-item";
      itemId: EntityId;
      targetId: EntityId;
    }
  | {
      type: "pour";
      sourceId: EntityId;
      targetId: EntityId;
      volumeMl?: number;
    }
  | {
      type: "mix";
      containerId: EntityId;
    }
  | {
      type: "heat";
      containerId: EntityId;
      equipmentId: EntityId;
    }
  | {
      type: "wait";
      durationSeconds: number;
    }
  | {
      type: "submit-equation";
      equationId: EntityId;
    };

export type StepRequirement =
  | {
      type: "item-selected";
      itemId: EntityId;
    }
  | {
      type: "item-placed";
      itemId: EntityId;
      targetId: EntityId;
    }
  | {
      type: "action-completed";
      actionType: ExperimentAction["type"];
    }
  | {
      type: "equation-correct";
      equationId: EntityId;
    };

export interface ScoreRule {
  id: EntityId;
  points: number;
  reason: string;
}

export interface ExperimentStep {
  id: EntityId;
  title: string;
  instruction: string;
  allowedActions: readonly ExperimentAction["type"][];
  requirements: readonly StepRequirement[];
  successScoreRules: readonly ScoreRule[];
  errorScoreRules: readonly ScoreRule[];
}

export interface ChemicalEquation {
  id: EntityId;
  molecular: string;
  completeIonic?: string;
  netIonic?: string;
}

export interface Experiment {
  id: EntityId;
  title: string;
  description: string;
  requiredItemIds: readonly EntityId[];
  steps: readonly ExperimentStep[];
  equations: readonly ChemicalEquation[];
  maximumScore: number;
}

export type LaboratoryErrorCode =
  | "invalid-data"
  | "item-not-found"
  | "action-not-allowed"
  | "wrong-order"
  | "safety-violation"
  | "incorrect-equation";

export interface LaboratoryError {
  code: LaboratoryErrorCode;
  message: string;
  path?: string;
  stepId?: EntityId;
}

export interface ScoreEvent {
  ruleId: EntityId;
  points: number;
  stepId: EntityId;
  createdAt: string;
}

export interface LaboratorySession {
  mode: AppMode;
  screen: Screen;
  cameraView: CameraView;
  selectedExperimentId: EntityId | null;
  currentStepId: EntityId | null;
  inventoryItemIds: readonly EntityId[];
  completedStepIds: readonly EntityId[];
  completedExperimentIds: readonly EntityId[];
  scoreEvents: readonly ScoreEvent[];
  errors: readonly LaboratoryError[];
  startedAt: string;
  finishedAt: string | null;
}

export interface LaboratoryData {
  version: string;
  items: readonly LaboratoryItem[];
  experiments: readonly Experiment[];
}
