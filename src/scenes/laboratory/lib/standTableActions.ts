import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { judgeMix, reagentName } from "./mixingRules";
import { tryAddToTube, tryPourBetweenTubes } from "./pourIntoTube";
import { standLocation } from "./standStationActions";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore, type BurnerPhase } from "./useBurnerStore";
import { useHeatingStore } from "./useHeatingStore";
import { useStandStationStore } from "./useStandStationStore";
import { useReagentInspectionStore } from "./useReagentInspectionStore";
import { toggleTubePick, useTestTubeDragStore } from "./useTestTubeDragStore";
import { useTestTubeStorageStore, type StoredTestTube, type TubeLocation } from "./useTestTubeStorageStore";

/**
 * «Действие на столе» (VL-014): the stand has no menu. Every object on the
 * table does its one sensible thing towards the stand when clicked, and says
 * what that is on hover. This module is the single place that decides it —
 * the 3D objects only report WHAT was clicked.
 *
 * Two kinds of «no», on purpose:
 * - what cannot physically happen (nothing in the clamp, a reagent this
 *   experiment does not use, the same reagent twice) is `blocked` — shown
 *   in red with the reason, and the click does nothing;
 * - an experimenter's MISTAKE (wrong mixing order, copper with acid outside
 *   the hood) looks like any other action and goes through to
 *   `pourIntoTube`, which charges it. Greying those out would give the
 *   answer away and make the ToR's errors impossible to commit.
 */
export type StandTarget =
  | { readonly kind: "rack-tube"; readonly location: TubeLocation; readonly index: number }
  | { readonly kind: "bottle"; readonly location: TubeLocation; readonly reagentId: string }
  | { readonly kind: "clamped-tube" }
  | { readonly kind: "burner" };

export interface StandAction {
  /** What the click will do, or why it won't — the hover caption. */
  readonly label: string;
  readonly blocked: boolean;
  readonly run: () => void;
}

const NOTHING = () => {};
const blocked = (label: string): StandAction => ({ label, blocked: true, run: NOTHING });
const action = (label: string, run: () => void): StandAction => ({ label, blocked: false, run });

const reagentConfig = (id: string): ReagentContainerConfig | undefined =>
  (REAGENTS as Record<string, ReagentContainerConfig | undefined>)[id];
const formula = (id: string) => reagentConfig(id)?.formula ?? id;

const tubesAt = (location: TubeLocation): readonly StoredTestTube[] => {
  const state = useTestTubeStorageStore.getState();
  return location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
};

/** A reagent the selected experiment does not use — refused before anything is poured. */
const foreignIn = (adding: readonly string[]): string | null => {
  const experimentId = useLaboratoryStore.getState().selectedExperimentId;
  const verdict = judgeMix(experimentId, [], adding);
  return verdict.kind === "foreign" ? verdict.reagentId : null;
};
const foreignLabel = (reagentId: string) => `${reagentName(reagentId)} в этом опыте не используется`;

const BURNER_LABEL: Record<BurnerPhase, string> = {
  capped: "Снять колпачок со спиртовки",
  open: "Зажечь спиртовку",
  lit: "Погасить спиртовку колпачком",
};

/**
 * What clicking `target` does right now. `null` means the click is not the
 * stand's business: the object keeps its own behaviour (on the workbench an
 * empty tube is still picked up and carried to a jar to be filled).
 */
export function standActionFor(target: StandTarget): StandAction | null {
  // While heating, the heating panel owns the stand.
  if (useHeatingStore.getState().active) return null;
  // A tube carried on the workbench fills from a jar by being brought to it;
  // clicks then belong to that gesture, not to the stand.
  if (target.kind !== "burner" && useTestTubeDragStore.getState().heldInstanceId !== null) return null;
  const location = standLocation();

  if (target.kind === "burner") {
    const phase = useBurnerStore.getState().phase;
    return action(BURNER_LABEL[phase], () => useBurnerStore.getState().advance());
  }

  const clampedIndex = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;

  if (target.kind === "clamped-tube") {
    if (location === null || clampedIndex === null) return null;
    const burner = useBurnerStore.getState();
    // The lamp is its own item: it heats only standing here, beside the stand.
    if (burner.lit && burner.place === location) {
      return action("Нагреть пробирку над спиртовкой", () => useHeatingStore.getState().enter());
    }
    return action("Вернуть пробирку в штатив для пробирок", () => {
      useBunsenStandStorageStore.getState().detachTestTube();
      // Nothing left to look at closely.
      useStandStationStore.getState().close();
    });
  }

  // No stand here: the object keeps its own behaviour, and says nothing.
  if (location !== target.location) return null;
  const tubes = tubesAt(location);
  const clamped = clampedIndex === null ? undefined : tubes[clampedIndex];

  if (target.kind === "bottle") {
    if (clampedIndex === null || !clamped) return blocked("Сначала закрепите пробирку в лапке штатива");
    const { reagentId } = target;
    if (clamped.contents.includes(reagentId)) return blocked(`${formula(reagentId)} уже в пробирке`);
    const foreign = foreignIn([reagentId]);
    if (foreign) return blocked(foreignLabel(foreign));
    const verb = reagentConfig(reagentId)?.contentsKind === "solid" ? "Насыпать" : "Прилить";
    return action(`${verb} ${formula(reagentId)} в пробирку в лапке`, () => {
      tryAddToTube(location, clampedIndex, reagentId);
    });
  }

  // A tube standing in the rack.
  const { index } = target;
  const tube = tubes[index];
  if (!tube || index === clampedIndex) return null;
  if (clampedIndex === null) {
    return action("Закрепить пробирку в лапке штатива", () => {
      useBunsenStandStorageStore.getState().attachTestTube(index, [0, 0, 0]);
    });
  }
  if (tube.contents.length === 0) {
    // On the workbench an empty tube is carried to a jar to be filled.
    return location === "workbench" ? null : blocked("Пробирка пустая — переливать нечего");
  }
  const foreign = foreignIn(tube.contents);
  if (foreign) return blocked(foreignLabel(foreign));
  return action("Перелить в пробирку в лапке", () => {
    tryPourBetweenTubes(location, index, clampedIndex);
  });
}

/** Runs what `standActionFor` offers; returns whether the click was the stand's. */
export function runStandAction(target: StandTarget): boolean {
  const next = standActionFor(target);
  if (!next) return false;
  next.run();
  return true;
}

/**
 * A tube in the workbench rack, clicked in 3D or on its button in the rack's
 * close-up. A stand action wins (clamp it, pour it into the clamp) and the
 * close-up closes so the player sees it happen at the stand; otherwise the
 * tube is picked up as before — an empty one is carried to a jar to fill.
 */
export function clickWorkbenchRackTube(index: number, instanceId: string): void {
  const carrying = useTestTubeDragStore.getState().heldInstanceId !== null;
  if (!carrying && runStandAction({ kind: "rack-tube", location: "workbench", index })) {
    useReagentInspectionStore.getState().requestClose();
    return;
  }
  toggleTubePick(instanceId);
}
