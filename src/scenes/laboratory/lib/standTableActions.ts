import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import type * as THREE from "three";

import type { Position3 } from "./layout";
import { judgeMix, reagentName } from "./mixingRules";
import { tryAddToTube, tryPourBetweenTubes } from "./pourIntoTube";
import { standLocation } from "./standStationActions";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { applyErrorRule } from "../../../features/tablet/lib/penalties";
import { FLAME_REACH, LAMP_FLAME } from "./lampFlame";
import { reactionTriggerFor } from "./tubeReactions";
import { useHeatingStore } from "./useHeatingStore";
import { useLabNoticeStore } from "./useLabNoticeStore";
import { useStandStationStore } from "./useStandStationStore";
import { CLAMP_TUBE_MOUTH, standBusy, useStandMotionStore } from "./useStandMotionStore";
import { equipmentHandAction } from "./equipmentPlacement";
import { HAND, takeIntoHand, useHandStore, type HeldItem } from "./useHandStore";
import { overTableTray } from "./tableTray";
import type { HintSubject } from "./hoverInfo";
import { obstacleCircle } from "./worktopBounds";
import { useReagentStorageStore } from "./useReagentStorageStore";
import { bottleToTray } from "./trayCarry";
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
  /** `instanceId` — the bottle itself, so it can be seen coming to the tube and pouring (`PourMotion`). */
  | { readonly kind: "bottle"; readonly location: TubeLocation; readonly reagentId: string; readonly instanceId?: string }
  | { readonly kind: "clamped-tube" }
  | { readonly kind: "burner" };

export interface StandAction {
  /** What the click will do, or why it won't — the hover caption. */
  readonly label: string;
  readonly blocked: boolean;
  /** @param origin where the clicked object is in the world, when known — a tube flies from there */
  readonly run: (origin?: Position3) => void;
  /** What a held item is brought to for this when it is not the stand — the tray, a jar: no snap pose and no outline of their own. */
  readonly part?: "tray" | "jar" | "place";
  /** What the action is done to or with, named next to the hand: the jar, the clamped tube, the lamp. */
  readonly subject?: HintSubject;
}

const NOTHING = () => {};
const withSubject = (result: StandAction, subject: HintSubject): StandAction => ({ ...result, subject });
const blocked = (label: string): StandAction => ({ label, blocked: true, run: NOTHING });
const action = (label: string, run: (origin?: Position3) => void): StandAction => ({ label, blocked: false, run });

/** The tube in the clamp hangs this far below its mouth: its base, where it is seen leaving from. */
const TUBE_LENGTH = 0.15;

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


/**
 * What clicking `target` does right now. `null` means the click is not the
 * stand's business: the object keeps its own behaviour (on the workbench an
 * empty tube is still picked up and carried to a jar to be filled).
 */
export function standActionFor(target: StandTarget, { fromHand = false }: { readonly fromHand?: boolean } = {}): StandAction | null {
  // While heating, the heating panel owns the stand.
  if (useHeatingStore.getState().active) return null;
  // Something is still moving at the stand (a pour, a tube in flight, the cap).
  if (standBusy()) return null;
  // A tube carried on the workbench fills from a jar by being brought to it;
  // clicks then belong to that gesture, not to the stand — unless the hand
  // carrying it is the one asking (`handActionFor`).
  if (!fromHand && target.kind !== "burner" && useTestTubeDragStore.getState().heldInstanceId !== null) return null;
  const location = standLocation();

  if (target.kind === "burner") {
    // One click heats (VL-020): the cap comes off, the lamp lights, the clamp
    // with its tube comes off the stand to the flame and the mini-game
    // starts. There is no cap-only click; the lamp goes out by itself when
    // the heating is over (`HeatingRuntime`).
    const place = useBurnerStore.getState().place;
    const clampedHere = location === place ? useBunsenStandStorageStore.getState().attachedTubeSlotIndex : null;
    if (clampedHere === null) return blocked("Сначала закрепите пробирку в лапке штатива");
    if (!needsHeat(tubesAt(place as TubeLocation)[clampedHere]?.contents ?? [])) return blocked(NOTHING_TO_HEAT);
    return action("Нагреть пробирку в лапке", startClampHeating);
  }

  const clampedIndex = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;

  if (target.kind === "clamped-tube") {
    if (location === null || clampedIndex === null) return null;
    const burner = useBurnerStore.getState();
    // The clamp comes off the stand to the lamp's flame, wherever the lamp
    // stands here (VL-020) — and only for contents that react when heated.
    const lampHere = burner.place === location;
    const clampedContents = tubesAt(location)[clampedIndex]?.contents ?? [];
    if (lampHere && needsHeat(clampedContents)) return action("Нагреть пробирку в лапке", startClampHeating);
    const back = "Вернуть пробирку в штатив для пробирок";
    return action(back, () => {
      // Seen flying back from where it hangs now.
      const mouth = CLAMP_TUBE_MOUTH.valid ? CLAMP_TUBE_MOUTH.point : null;
      if (mouth) useStandMotionStore.getState().arriveInRack(location, clampedIndex, [mouth.x, mouth.y - TUBE_LENGTH, mouth.z]);
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
    return action(`${verb} ${formula(reagentId)} в пробирку в лапке`, (origin) => {
      const pour = () => tryAddToTube(location, clampedIndex, reagentId);
      // The reagent goes in when the bottle is tipped over the mouth, not on
      // the click; the bottle comes from wherever it is (in the hand: `origin`).
      if (target.instanceId) useStandMotionStore.getState().startPour(target.instanceId, pour, origin);
      else pour();
    });
  }

  // A tube standing in the rack.
  const { index } = target;
  const tube = tubes[index];
  if (!tube || index === clampedIndex) return null;
  if (clampedIndex === null) {
    return action("Закрепить пробирку в лапке штатива", (origin) => {
      useBunsenStandStorageStore.getState().attachTestTube(index, origin ?? [0, 0, 0]);
      if (origin) useStandMotionStore.getState().arriveInClamp(origin);
    });
  }
  if (tube.contents.length === 0) {
    // On the workbench an empty tube is carried to a jar to be filled.
    return location === "workbench" ? null : blocked("Пробирка пустая — переливать нечего");
  }
  const foreign = foreignIn(tube.contents);
  if (foreign) return blocked(foreignLabel(foreign));
  return action("Перелить в пробирку в лапке", (origin) => {
    const pour = () => tryPourBetweenTubes(location, index, clampedIndex);
    // From the hand the tube is seen pouring, like a bottle: it goes in at the tipping point.
    if (origin) useStandMotionStore.getState().startPour(tube.instanceId, pour, origin);
    else pour();
  });
}

/** Runs what `standActionFor` offers; returns whether the click was the stand's. */
export function runStandAction(target: StandTarget, origin?: Position3): boolean {
  const next = standActionFor(target);
  if (!next) return false;
  next.run(origin);
  return true;
}

/**
 * A tube in the workbench rack, clicked in 3D or on its button in the rack's
 * close-up: it goes into the hand (VL-015). The rack's own carry
 * (`InspectableTestTubeSlot`) moves it; the hand steers that carry from the
 * middle of the screen. Clicking the tube already carried puts it back.
 */
export function clickWorkbenchRackTube(index: number, instanceId: string, origin?: Position3): void {
  if (useTestTubeDragStore.getState().heldInstanceId === instanceId) {
    useTestTubeDragStore.getState().releaseIfHeld(instanceId);
    useHandStore.getState().release();
    return;
  }
  if (useHandStore.getState().held || standBusy()) return;
  takeIntoHand({ kind: "workbench-tube", index, instanceId }, origin ?? [0, 0, 0]);
  toggleTubePick(instanceId);
}

/**
 * How close (horizontally, over the worktop) the hand must come to the
 * clamp's axis for the held item to snap to it — the tube over the clamp,
 * a bottle beside the clamped tube (`PourMotion`). Generous on purpose: the
 * player brings the item to the stand, the magnet does the aiming.
 */
const MAGNET_REACH = 0.13;

/** The stand target a held item becomes when brought to the stand. */
function heldAsTarget(held: Exclude<HeldItem, { kind: "tray" | "equipment" }>): StandTarget {
  if (held.kind === "bottle") {
    return { kind: "bottle", location: held.location, reagentId: held.reagentId, instanceId: held.instanceId };
  }
  return { kind: "rack-tube", location: held.kind === "tube" ? held.location : "workbench", index: held.index };
}

/**
 * What a click does with `held` at `point` (the hand, over the worktop):
 * a tube near the clamp goes into it (or is poured into the tube already
 * there), a bottle near the clamped tube's mouth pours. Null: nothing here.
 */
export function handActionFor(held: HeldItem, point: THREE.Vector3): StandAction | null {
  // Off the tray: set down where the player stands (`trayHandAction`, VL-017).
  if (held.kind === "tray") return null;
  // The stand or the lamp: set down on the worktop, or on the tray (the live hand point is where it lands).
  if (held.kind === "equipment") return equipmentHandAction(held, point, HAND.point);
  // A bare tube brought to the lamp's flame (VL-020). The workbench rack's
  // carried tube asks the same from its own carry (`InspectableTestTubeSlot`).
  if (held.kind === "tube" && nearFlame(held.location, point)) return heatInHandAction(held.location, held.index);
  // A tube brought to a jar: a click fills it.
  if (held.kind === "tube") {
    const fill = fillTubeAction(held.location, held.index, point);
    if (fill) return fill;
  }
  // A bottle from the bench brought over the tray on the table goes onto it (VL-017).
  if (held.kind === "bottle" && held.location === "workbench" && overTableTray(point)) {
    return { label: "Поставить на поднос", blocked: false, part: "tray", run: () => void bottleToTray("workbench", held.instanceId) };
  }
  if (!CLAMP_TUBE_MOUTH.valid) return null;
  const dx = point.x - CLAMP_TUBE_MOUTH.point.x;
  const dz = point.z - CLAMP_TUBE_MOUTH.point.z;
  if (Math.hypot(dx, dz) > MAGNET_REACH) return null;
  const result = standActionFor(heldAsTarget(held), { fromHand: true });
  if (!result) return null;
  // Named by what the item is brought to: the tube in the clamp, or the stand while its clamp is empty.
  const place = standLocation();
  const clampedIndex = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;
  if (!place) return result;
  return withSubject(result, clampedIndex === null ? { kind: "stand", place } : { kind: "tube", place, index: clampedIndex });
}

/** How far past a jar's footprint (m) a tube in the hand still counts as brought to it. */
const JAR_REACH_MARGIN = 0.04;

/** The reagent jar a tube at `point` has been brought to, at `location` — the nearest one, if any is near enough. */
export function jarNearTube(location: TubeLocation, point: THREE.Vector3): { readonly instanceId: string; readonly reagentId: string } | null {
  const storage = useReagentStorageStore.getState();
  const jars = location === "workbench" ? storage.workbenchItems : storage.fumeHoodItems;
  let best: { instanceId: string; reagentId: string } | null = null;
  let bestGap = Infinity;
  for (const jar of jars) {
    const circle = obstacleCircle(jar.instanceId);
    if (!circle) continue;
    const gap = Math.hypot(point.x - circle.x, point.z - circle.z) - circle.r;
    if (gap < JAR_REACH_MARGIN && gap < bestGap) {
      bestGap = gap;
      best = { instanceId: jar.instanceId, reagentId: jar.reagentId };
    }
  }
  return best;
}

/**
 * A tube in the hand brought to a reagent jar: a click puts the reagent in
 * it (the player confirms with the left button, nothing pours by itself).
 * Refused like the stand's pour is — a reagent this experiment does not use,
 * or one the tube already has; a wrong order is the player's to make.
 */
export function fillTubeAction(location: TubeLocation, index: number, point: THREE.Vector3): StandAction | null {
  if (useHeatingStore.getState().active || standBusy()) return null;
  const tube = tubesAt(location)[index];
  const jar = tube ? jarNearTube(location, point) : null;
  if (!tube || !jar) return null;
  const { reagentId } = jar;
  const withPart = (result: StandAction): StandAction => ({
    ...result,
    part: "jar",
    subject: { kind: "bottle", reagentId, place: location },
  });
  if (tube.contents.includes(reagentId)) return withPart(blocked(`${formula(reagentId)} уже в пробирке`));
  const foreign = foreignIn([reagentId]);
  if (foreign) return withPart(blocked(foreignLabel(foreign)));
  const verb = reagentConfig(reagentId)?.contentsKind === "solid" ? "Насыпать" : "Налить";
  return withPart(action(`${verb} ${formula(reagentId)} в пробирку`, () => void tryAddToTube(location, index, reagentId)));
}

/** The hover caption for something that can be taken into the hand. */
export function takeLabel(target: StandTarget): string | null {
  if (useHandStore.getState().held || standBusy() || useHeatingStore.getState().active) return null;
  if (target.kind === "bottle") return `Взять ${formula(target.reagentId)}`;
  if (target.kind === "rack-tube") {
    const tube = tubesAt(target.location)[target.index];
    if (!tube) return null;
    return tube.contents.length === 0 ? "Взять пустую пробирку" : `Взять пробирку (${tube.contents.map(formula).join(" + ")})`;
  }
  return null;
}

/* ---------- heating (VL-020) ---------- */

/** Whether these contents are one of the implemented reactions that need heating — nothing else is heated. */
const needsHeat = (contents: readonly string[]): boolean => reactionTriggerFor(contents) === "heat";

const NOTHING_TO_HEAT = "Нагревать нечего — в пробирке нет реакции, которой нужен нагрев";

/** The lamp lights by itself for the heating — cap off, wick lit — and goes out by itself after it. */
const lightLamp = () => useBurnerStore.getState().setLit(true);

function startClampHeating(): void {
  lightLamp();
  useHeatingStore.getState().enter();
}

/** Experiment 1: a tube heated in the bare hand rather than in the clamp. */
const HAND_HEAT_ERROR_RULE_ID = "error-1-heat-hand";

/** Whether `point` (over the worktop at `location`) is under the lamp's flame there. */
export function nearFlame(location: TubeLocation, point: THREE.Vector3): boolean {
  if (!LAMP_FLAME.valid || LAMP_FLAME.place !== location) return false;
  return Math.hypot(point.x - LAMP_FLAME.point.x, point.z - LAMP_FLAME.point.z) < FLAME_REACH;
}

/**
 * A bare tube in the hand, brought to the lamp: heat it right there (VL-020).
 * Allowed — it is the player's mistake to make, and like every mistake it
 * looks like any other action (see this module's doc) — but charged: the
 * proper way is the clamp off the stand.
 */
export function heatInHandAction(location: TubeLocation, index: number): StandAction | null {
  if (useBurnerStore.getState().place !== location) return null;
  const tube = tubesAt(location)[index];
  if (!tube) return null;
  if (!needsHeat(tube.contents)) return blocked(NOTHING_TO_HEAT);
  const { instanceId } = tube;
  return withSubject(action("Нагреть пробирку над спиртовкой", () => {
    // Out of the hand: the hand lets go and the tube is held in the flame instead (`HandHeatRig`).
    if (useTestTubeDragStore.getState().heldInstanceId === instanceId) useTestTubeDragStore.getState().releaseIfHeld(instanceId);
    useHandStore.getState().release();
    if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
    lightLamp();
    useHeatingStore.getState().enter(undefined, { mode: "hand", location, index, instanceId });
    const penalty = applyErrorRule(HAND_HEAT_ERROR_RULE_ID, "safety-violation");
    if (penalty) {
      const points = penalty.charged ? ` (${penalty.rule.points})` : "";
      useLabNoticeStore.getState().show(`Ошибка: пробирку греют в руке, а не в лапке штатива${points}`, "error");
    }
  }), { kind: "lamp", place: location });
}
