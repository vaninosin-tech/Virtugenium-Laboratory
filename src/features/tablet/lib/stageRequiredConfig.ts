import type { EntityId } from "../../../entities/laboratory";
import {
  checkIdentifyAnswers,
  isIdentifyStep,
  STAGE_IDENTIFY_FIELDS,
} from "./stageIdentifyConfig";

export type StageRequiredKind = "ppe" | "reagent" | "glassware" | "equipment";

export type StageRequiredItem = {
  readonly id: string;
  readonly label: string;
  readonly kind: StageRequiredKind;
  /** Catalog item id used for inventory matching. */
  readonly catalogItemId: EntityId;
};

const PPE_ITEMS: readonly StageRequiredItem[] = [
  { id: "coat", label: "Лабораторный халат", kind: "ppe", catalogItemId: "safety-coat" },
  { id: "goggles", label: "Очки", kind: "ppe", catalogItemId: "safety-goggles" },
  { id: "gloves", label: "Перчатки", kind: "ppe", catalogItemId: "safety-gloves" },
];

const STAND_ITEM: StageRequiredItem = {
  id: "stand",
  label: "Штатив с мет. лапкой",
  kind: "equipment",
  catalogItemId: "equipment-holder",
};

const reagentItem = (id: string, label: string, catalogItemId: EntityId): StageRequiredItem => ({
  id,
  label,
  kind: "reagent",
  catalogItemId,
});

const TUBE_ITEM: StageRequiredItem = { id: "tube", label: "Пробирка", kind: "glassware", catalogItemId: "glassware-test-tube" };

/** Catalog reagent → the id the 3D storage stores keep it under. */
const REAGENT_STORE_ID: Partial<Record<EntityId, string>> = {
  "reagent-copper": "cu",
  "reagent-nitric-acid": "hno3",
  "reagent-silver-nitrate": "agno3",
  "reagent-sodium-chloride": "nacl",
  "reagent-barium-chloride": "bacl2",
  "reagent-potassium-sulfate": "k2so4",
  "reagent-sulfuric-acid": "h2so4",
  "reagent-sodium-sulfite": "na2so3",
  "reagent-potassium-permanganate": "kmno4",
};

/** How many test tubes each checklist asks for. */
const TUBES_NEEDED: Partial<Record<EntityId, number>> = { "step-1-ppe": 2 };

/** Display list for the «Необходимо» block on selected stages. */
export const STAGE_REQUIRED_ITEMS: Partial<Record<EntityId, readonly StageRequiredItem[]>> = {
  "step-2-ppe": [
    ...PPE_ITEMS,
    reagentItem("agno3", "AgNO₃", "reagent-silver-nitrate"),
    reagentItem("nacl", "NaCl", "reagent-sodium-chloride"),
    TUBE_ITEM,
    STAND_ITEM,
  ],
  "step-3-ppe": [
    ...PPE_ITEMS,
    reagentItem("bacl2", "BaCl₂", "reagent-barium-chloride"),
    reagentItem("k2so4", "K₂SO₄", "reagent-potassium-sulfate"),
    TUBE_ITEM,
    STAND_ITEM,
  ],
  "step-4-ppe": [
    ...PPE_ITEMS,
    reagentItem("na2so3", "Na₂SO₃", "reagent-sodium-sulfite"),
    reagentItem("h2so4", "H₂SO₄", "reagent-sulfuric-acid"),
    reagentItem("kmno4", "KMnO₄", "reagent-potassium-permanganate"),
    TUBE_ITEM,
    STAND_ITEM,
  ],
  "step-1-ppe": [
    ...PPE_ITEMS,
    { id: "cu", label: "Cu", kind: "reagent", catalogItemId: "reagent-copper" },
    { id: "hno3", label: "HNO₃ (разб.)", kind: "reagent", catalogItemId: "reagent-nitric-acid" },
    { id: "tubes", label: "Пробирка x2", kind: "glassware", catalogItemId: "glassware-test-tube" },
    STAND_ITEM,
    { id: "burner", label: "Спиртовая горелка", kind: "equipment", catalogItemId: "equipment-burner" },
  ],
};

export function getStageRequiredItems(stepId: EntityId): readonly StageRequiredItem[] | null {
  return STAGE_REQUIRED_ITEMS[stepId] ?? null;
}

export type RequirementProgress = {
  readonly current: number;
  readonly total: number;
};

/** Physical collection state that is not represented by the tablet's
 * checkbox inventory. Reagents can be on the held tray or already on the
 * workbench; test tubes are counted by unique taken instances. */
export type PhysicalCollectionState = {
  readonly takenReagentIds?: readonly string[];
  readonly takenTestTubeCount?: number;
  /** The stand has left the equipment cabinet — it brings its clamp and spirit lamp with it. */
  readonly standTaken?: boolean;
};

/**
 * catalogItemIds whose "collected" state comes ONLY from actually taking the
 * item in the 3D scene (see `PhysicalCollectionState`) — the tablet's
 * click-to-toggle checkbox no longer fakes these (`StageDetailPanel`'s
 * `toggleRequiredItem` skips them), so the progress counter only advances
 * when the player physically grabs Cu/HNO₃/a test tube from the cabinet.
 */
const PHYSICAL_ONLY_STEPS: ReadonlySet<EntityId> = new Set(["step-1-ppe", "step-2-ppe", "step-3-ppe", "step-4-ppe"]);

/**
 * Every item on these checklists counts only once the player has actually
 * done it in the 3D scene — worn the PPE, taken the reagent, the tubes, the
 * stand (which brings its clamp and spirit lamp). The tablet cannot tick them.
 */
export function isPhysicalOnlyRequiredItem(stepId: EntityId, catalogItemId: EntityId): boolean {
  return PHYSICAL_ONLY_STEPS.has(stepId) && (STAGE_REQUIRED_ITEMS[stepId]?.some((item) => item.catalogItemId === catalogItemId) ?? false);
}

/** Returns whether one required item is actually available to the player. */
export function isStageRequiredItemCollected(
  stepId: EntityId,
  catalogItemId: EntityId,
  inventoryItemIds: readonly EntityId[],
  physical: PhysicalCollectionState = {},
): boolean {
  if (isPhysicalOnlyRequiredItem(stepId, catalogItemId)) {
    const reagentId = REAGENT_STORE_ID[catalogItemId];
    if (reagentId) return physical.takenReagentIds?.includes(reagentId) ?? false;
    if (catalogItemId === "glassware-test-tube") return (physical.takenTestTubeCount ?? 0) >= (TUBES_NEEDED[stepId] ?? 1);
    if (catalogItemId === "equipment-holder" || catalogItemId === "equipment-burner") return physical.standTaken ?? false;
    // PPE still lives in the inventory; "physical-only" here means the
    // tablet may not tick it, not that it is tracked somewhere else.
    return inventoryItemIds.includes(catalogItemId);
  }
  return inventoryItemIds.includes(catalogItemId);
}

/** Progress for identify fields that already match an accepted formula. */
export function getIdentifyProgress(
  stepId: EntityId,
  answers: Readonly<Record<string, string>>,
): RequirementProgress | null {
  const fields = STAGE_IDENTIFY_FIELDS[stepId];
  if (!fields) return null;
  const result = checkIdentifyAnswers(stepId, answers);
  const wrong = new Set(result.wrongFieldIds);
  let current = 0;
  for (const field of fields) {
    const value = (answers[field.id] ?? "").trim();
    if (value.length > 0 && !wrong.has(field.id)) current += 1;
  }
  return { current, total: fields.length };
}

/** Progress for PPE / prep checklist based on inventory. */
export function getRequiredItemsProgress(
  stepId: EntityId,
  inventoryItemIds: readonly EntityId[],
  physical: PhysicalCollectionState = {},
): RequirementProgress | null {
  const items = STAGE_REQUIRED_ITEMS[stepId];
  if (!items || items.length === 0) return null;
  const current = items.filter((item) =>
    isStageRequiredItemCollected(stepId, item.catalogItemId, inventoryItemIds, physical),
  ).length;
  return { current, total: items.length };
}

/** Unified requirement counter for the active step (hologram / stage UI). */
export function getStepRequirementProgress(
  stepId: EntityId | null,
  inventoryItemIds: readonly EntityId[],
  identifyAnswers: Readonly<Record<string, string>>,
  physical: PhysicalCollectionState = {},
): RequirementProgress | null {
  if (!stepId) return null;
  if (isIdentifyStep(stepId)) return getIdentifyProgress(stepId, identifyAnswers);
  return getRequiredItemsProgress(stepId, inventoryItemIds, physical);
}
