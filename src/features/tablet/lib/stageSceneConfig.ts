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
  /** The clamped hood tube's reaction has gone far enough to be seen (`REACTION_SEEN`). */
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

const tubeAt = (
  snapshot: SceneSnapshot,
  index: number | null,
): StoredTestTube | undefined => (index === null ? undefined : snapshot.workbenchTubes[index]);

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
 * the stand, everything carried to where the experiment is done, the rest
 * poured in and the reaction watched. «Рабочая зона» is the fume hood — the
 * only place in the lab where pouring into the clamped tube and the reaction
 * itself exist — but unlike experiment 1 nothing toxic comes off, so the
 * extraction is not required. The order of pouring is judged at the pour
 * (`mixingRules`).
 */
function solutionExperimentSteps(
  experiment: number,
  { base, baseName, added, addedNames }: SolutionExperiment,
): Record<EntityId, StageSceneRequirement> {
  return {
    [`step-${experiment}-setup`]: {
      label: `Налейте в пробирку раствор ${baseName} и закрепите её в штативе.`,
      isMet: (snapshot) => tubeAt(snapshot, snapshot.attachedTubeSlotIndex)?.contents.includes(base) ?? false,
    },
    [`step-${experiment}-transfer`]: {
      label: `У вытяжного шкафа нажмите «Перенести» и перенесите туда штатив с пробиркой и ${addedNames}.`,
      isMet: (snapshot) =>
        snapshot.standInFumeHood &&
        (snapshot.clampedHoodTubeContents?.includes(base) ?? false) &&
        added.every(
          (id) =>
            snapshot.fumeHoodReagentIds.includes(id) ||
            snapshot.fumeHoodTubeContents.some((tube) => tube.includes(id)),
        ),
    },
    [`step-${experiment}-experiment`]: {
      label: `Прилейте ${addedNames} к раствору ${baseName} в пробирке на штативе и понаблюдайте за реакцией.`,
      isMet: (snapshot) =>
        hasAll(snapshot.clampedHoodTubeContents, [base, ...added]) && snapshot.clampedReactionSeen,
    },
  };
}

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
