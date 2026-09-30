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
  /** The stand stands on the workbench. */
  readonly standOnWorkbench: boolean;
  /** Reagent ids of the bottles standing on the workbench. */
  readonly workbenchReagentIds: readonly string[];
  /** Contents of the tube clamped in the stand, wherever the stand is; null when there is none. */
  readonly clampedTubeContents: readonly string[] | null;
  /** The heating mini-game ran to the end: preheated, then the contents heated. */
  readonly heatingDone: boolean;
  /** The clamped tube's reaction has gone far enough to be seen (`REACTION_SEEN`), wherever the stand is. */
  readonly clampedReactionSeen: boolean;
}

/**
 * How far a reaction must have run for its signs to have been seen before
 * the step counts as done. The precipitates show at once and then take long
 * to settle (BaSO₄ ~45 s to the end), so a third of the way is plenty: the
 * player has seen the white suspension without waiting it out.
 */
export const REACTION_SEEN = 0.3;

export interface StageSceneRequirement {
  /** Shown to the player as the condition still standing between them and the step. */
  readonly label: string;
  readonly isMet: (snapshot: SceneSnapshot) => boolean;
}

interface SolutionExperiment {
  /** The working solution that goes into the clamped tube first. */
  readonly base: string;
  /** Genitive, for «пробирку с раствором …». */
  readonly baseName: string;
  /** Everything else the experiment pours into it. */
  readonly added: readonly string[];
  readonly addedNames: string;
}

const hasAll = (contents: readonly string[] | null, ids: readonly string[]) =>
  contents !== null && ids.every((id) => contents.includes(id));

/**
 * Experiments 2–4 share one shape: a working tube with the base solution in
 * the stand, everything brought together at the working place, the rest
 * poured in and the reaction watched. The working place is the workbench
 * («рабочая зона» in the ToR); the fume hood serves as well — nothing toxic
 * comes off, so neither is required, but the stand and what goes into its
 * tube must be at the same one. The order of pouring is judged at the pour
 * (`mixingRules`).
 */
function solutionExperimentSteps(
  experiment: number,
  { base, baseName, added, addedNames }: SolutionExperiment,
): Record<EntityId, StageSceneRequirement> {
  const available = (snapshot: SceneSnapshot, id: string) =>
    snapshot.standInFumeHood
      ? snapshot.fumeHoodReagentIds.includes(id) || snapshot.fumeHoodTubeContents.some((tube) => tube.includes(id))
      : snapshot.standOnWorkbench &&
        (snapshot.workbenchReagentIds.includes(id) || snapshot.workbenchTubes.some((tube) => tube.contents.includes(id)));
  return {
    [`step-${experiment}-setup`]: {
      label: `Подойдите к штативу, закрепите пробирку и прилейте в неё раствор ${baseName}.`,
      isMet: (snapshot) => snapshot.clampedTubeContents?.includes(base) ?? false,
    },
    [`step-${experiment}-transfer`]: {
      label: `Штатив с пробиркой и ${addedNames} должны стоять вместе на рабочем столе (или в вытяжном шкафу).`,
      isMet: (snapshot) =>
        (snapshot.clampedTubeContents?.includes(base) ?? false) && added.every((id) => available(snapshot, id)),
    },
    [`step-${experiment}-experiment`]: {
      label: `У штатива прилейте ${addedNames} к раствору ${baseName} и понаблюдайте за реакцией.`,
      isMet: (snapshot) =>
        hasAll(snapshot.clampedTubeContents, [base, ...added]) && snapshot.clampedReactionSeen,
    },
  };
}

export const STAGE_SCENE_REQUIREMENTS: Partial<Record<EntityId, StageSceneRequirement>> = {
  "step-1-setup": {
    label: "Подойдите к штативу, закрепите пробирку и насыпьте в неё гранулы меди.",
    isMet: (snapshot) => snapshot.clampedTubeContents?.includes("cu") ?? false,
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
  ...solutionExperimentSteps(2, {
    base: "agno3",
    baseName: "нитрата серебра",
    added: ["nacl"],
    addedNames: "раствор хлорида натрия",
  }),
  ...solutionExperimentSteps(3, {
    base: "bacl2",
    baseName: "хлорида бария",
    added: ["k2so4"],
    addedNames: "раствор сульфата калия",
  }),
  ...solutionExperimentSteps(4, {
    base: "na2so3",
    baseName: "сульфита натрия",
    added: ["h2so4", "kmno4"],
    addedNames: "серную кислоту и раствор перманганата калия",
  }),
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
