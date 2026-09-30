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

/** Display list for the «Необходимо» block on selected stages. */
export const STAGE_REQUIRED_ITEMS: Partial<Record<EntityId, readonly StageRequiredItem[]>> = {
  "step-1-ppe": [
    { id: "coat", label: "Лабораторный халат", kind: "ppe", catalogItemId: "safety-coat" },
    { id: "goggles", label: "Очки", kind: "ppe", catalogItemId: "safety-goggles" },
    { id: "gloves", label: "Перчатки", kind: "ppe", catalogItemId: "safety-gloves" },
    { id: "cu", label: "Cu", kind: "reagent", catalogItemId: "reagent-copper" },
    { id: "hno3", label: "HNO₃ (разб.)", kind: "reagent", catalogItemId: "reagent-nitric-acid" },
    { id: "tubes", label: "Пробирка x2", kind: "glassware", catalogItemId: "glassware-test-tube" },
    {
      id: "stand",
      label: "Штатив с мет. лапкой",
      kind: "equipment",
      catalogItemId: "equipment-holder",
    },
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
const PHYSICAL_ONLY_CATALOG_IDS: Partial<Record<EntityId, ReadonlySet<EntityId>>> = {
  "step-1-ppe": new Set<EntityId>([
    "reagent-copper",
    "reagent-nitric-acid",
    "glassware-test-tube",
    // Only `PPEBoard` (inside the opened СИЗ cabinet) puts these into the
    // inventory — the tablet checkbox must not stand in for walking over.
    "safety-coat",
    "safety-goggles",
    "safety-gloves",
    // The stand (with its clamp — the tube holder) and the spirit lamp come
    // out of the equipment cabinet as one; only taking it counts.
    "equipment-holder",
    "equipment-burner",
  ]),
};

export function isPhysicalOnlyRequiredItem(stepId: EntityId, catalogItemId: EntityId): boolean {
  return PHYSICAL_ONLY_CATALOG_IDS[stepId]?.has(catalogItemId) ?? false;
}

/** Returns whether one required item is actually available to the player. */
export function isStageRequiredItemCollected(
  stepId: EntityId,
  catalogItemId: EntityId,
  inventoryItemIds: readonly EntityId[],
  physical: PhysicalCollectionState = {},
): boolean {
  if (isPhysicalOnlyRequiredItem(stepId, catalogItemId)) {
    if (catalogItemId === "reagent-copper") return physical.takenReagentIds?.includes("cu") ?? false;
    if (catalogItemId === "reagent-nitric-acid") return physical.takenReagentIds?.includes("hno3") ?? false;
    if (catalogItemId === "glassware-test-tube") return (physical.takenTestTubeCount ?? 0) >= 2;
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
