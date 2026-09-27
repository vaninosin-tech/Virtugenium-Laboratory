import type { EntityId } from "../../../entities/laboratory";
import type { StoredTestTube } from "../../../scenes/laboratory/lib/useTestTubeStorageStore";

/**
 * What the 3D scene must actually look like before a step counts as done.
 *
 * Separate from `stageRequiredConfig`, which only asks "has the player
 * COLLECTED these items" — this asks "has the player ASSEMBLED the setup",
 * which is state no checklist can stand in for.
 *
 * Deliberately free of store imports so the predicates stay unit-testable
 * without a DOM — the live snapshot is assembled by `useStageSceneState`.
 */
export interface SceneSnapshot {
  readonly workbenchTubes: readonly StoredTestTube[];
  /** Workbench rack slot index currently clipped into the stand's ring, or null. */
  readonly attachedTubeSlotIndex: number | null;
  readonly fumeHoodFanOn: boolean;
  readonly atFumeHood: boolean;
  /** Reagent ids of the bottles carried into the hood. */
  readonly fumeHoodReagentIds: readonly string[];
  /** Contents of each tube carried into the hood, one array per tube. */
  readonly fumeHoodTubeContents: readonly (readonly string[])[];
  readonly standInFumeHood: boolean;
  /** Contents of the tube clamped in the stand inside the hood, in pouring order; null when there is none. */
  readonly clampedHoodTubeContents: readonly string[] | null;
  /** The heating mini-game ran to the end: preheated, then the contents heated. */
  readonly heatingDone: boolean;
}

export interface StageSceneRequirement {
  /** Shown to the player as the condition still standing between them and the step. */
  readonly label: string;
  readonly isMet: (snapshot: SceneSnapshot) => boolean;
}

const tubeAt = (
  snapshot: SceneSnapshot,
  index: number | null,
): StoredTestTube | undefined => (index === null ? undefined : snapshot.workbenchTubes[index]);

export const STAGE_SCENE_REQUIREMENTS: Partial<Record<EntityId, StageSceneRequirement>> = {
  "step-1-setup": {
    label: "Поместите гранулы меди в пробирку и закрепите её в штативе.",
    isMet: (snapshot) =>
      tubeAt(snapshot, snapshot.attachedTubeSlotIndex)?.contents.includes("cu") ?? false,
  },
  "step-1-transfer": {
    label:
      "В вытяжном шкафу нажмите «Перенести» и перенесите туда штатив с пробиркой меди и азотную кислоту, затем включите вытяжку.",
    isMet: (snapshot) =>
      snapshot.fumeHoodFanOn &&
      snapshot.standInFumeHood &&
      snapshot.fumeHoodTubeContents.some((tube) => tube.includes("cu")) &&
      snapshot.fumeHoodReagentIds.includes("hno3"),
  },
  "step-1-experiment": {
    label: "Прилейте азотную кислоту к меди в пробирке на штативе, прогрейте пробирку и нагрейте содержимое.",
    // The order (copper first) is enforced at the pour itself (`mixingRules`),
    // so a tube holding both got them in the right order or was charged for it.
    isMet: (snapshot) =>
      snapshot.heatingDone &&
      (snapshot.clampedHoodTubeContents?.includes("cu") ?? false) &&
      (snapshot.clampedHoodTubeContents?.includes("hno3") ?? false),
  },
};

/**
 * Steps the scene completes on its own the moment their condition holds:
 * everything with a scene condition. The tablet's «Выполнить шаг» stays only
 * where the action really is on the tablet — identifying the substances and
 * writing the equations.
 */
export const isSceneCompletedStep = (stepId: EntityId | null): boolean =>
  stepId !== null && STAGE_SCENE_REQUIREMENTS[stepId] !== undefined;

export function getStageSceneRequirement(
  stepId: EntityId | null,
): StageSceneRequirement | null {
  if (stepId === null) return null;
  return STAGE_SCENE_REQUIREMENTS[stepId] ?? null;
}

export interface StageSceneState {
  readonly requirement: StageSceneRequirement;
  readonly met: boolean;
}
