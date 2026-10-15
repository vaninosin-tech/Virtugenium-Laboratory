import { REAGENTS, type ReagentContainerConfig } from "../../../entities/laboratory/reagents";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import * as THREE from "three";

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
import { HAND, takeIntoHand, useHandStore, type HeldItem } from "./useHandStore";
import { equipmentHandAction } from "./equipmentCarry";
import { JAR_AIM, type PourSource } from "./pourSources";
import { overTableTray } from "./tableTray";
import { bottleToTray, tubeToTray } from "./trayCarry";
import { worktopZoneAt } from "./worktopBounds";
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
  /** The held item stays in the hand after it (a tube a bottle is pouring into). */
  readonly keepHeld?: boolean;
  /**
   * Where a held item is set down by this, rather than used at the stand:
   * onto a tray, or in a spot of the worktop (the stand moved on the table).
   */
  readonly part?: "tray" | "place";
}

const NOTHING = () => {};
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
function heldAsTarget(held: Exclude<HeldItem, { kind: "tray" | "equipment" | "clamp" }>): StandTarget {
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
  // A tube held up to a bottle: the bottle pours into it (`JAR_AIM`).
  if (JAR_AIM.source) return jarPourAction(held, JAR_AIM.source);
  // The stand or the lamp off the table: onto the tray, or the stand moved (`equipmentCarry`).
  if (held.kind === "equipment") return equipmentHandAction(held, point);
  // The clamp off the stand (`clampCarry`): at the lamp's flame it heats its tube
  // there — the lamp's own heating, its rules and caption; elsewhere it goes back.
  if (held.kind === "clamp") {
    if (!nearFlame(held.location, point)) return null;
    return standActionFor({ kind: "burner" }) ?? blocked("Подождите — нагреть сейчас нельзя");
  }
  // A bare tube brought to the lamp's flame (VL-020). The workbench rack's
  // carried tube asks the same from its own carry (`InspectableTestTubeSlot`).
  if (held.kind === "tube" && nearFlame(held.location, point)) return heatInHandAction(held.location, held.index);
  // A bottle from the bench brought over the tray on the table goes onto it (VL-017).
  if (held.kind === "bottle" && held.location === "workbench" && overTableTray(point)) {
    return { label: "Поставить на поднос", blocked: false, part: "tray", run: () => void bottleToTray("workbench", held.instanceId) };
  }
  // At the stand, its use there comes first; only then where it is set down.
  if (nearClamp(point)) return standActionFor(heldAsTarget(held), { fromHand: true });
  // A tube from the hood's rack brought over the tray there goes onto it.
  if (held.kind === "tube" && worktopZoneAt(point) === "hood-tray") {
    return { label: "Поставить на поднос", blocked: false, part: "tray", run: () => void tubeToTray(held.location, held.index) };
  }
  return null;
}

/** The tube held in the hand, as its place's list knows it; null — what is held is not a tube. */
function heldTube(held: HeldItem): { readonly location: TubeLocation; readonly index: number } | null {
  if (held.kind === "workbench-tube") return { location: "workbench", index: held.index };
  if (held.kind === "tube") return { location: held.location, index: held.index };
  return null;
}

/**
 * A tube held up to a bottle (`JAR_AIM`): the bottle pours into it where it
 * is held — the same pour, the same rules as a bottle brought to the clamped
 * tube (`standActionFor`): the same reagent twice or one this experiment does
 * not use is refused; a wrong order is the player's mistake to make. The
 * tube stays in the hand.
 */
export function jarPourAction(held: HeldItem, source: PourSource): StandAction | null {
  const tube = heldTube(held);
  if (!tube || tube.location !== source.location) return null;
  const contents = tubesAt(tube.location)[tube.index]?.contents;
  if (!contents) return null;
  const { reagentId, instanceId } = source;
  if (useHeatingStore.getState().active || standBusy()) return blocked(`Подождите — ${formula(reagentId)} сейчас не налить`);
  if (contents.includes(reagentId)) return blocked(`${formula(reagentId)} уже в пробирке`);
  const foreign = foreignIn([reagentId]);
  if (foreign) return blocked(foreignLabel(foreign));
  const verb = reagentConfig(reagentId)?.contentsKind === "solid" ? "Насыпать" : "Налить";
  return {
    label: `${verb} ${formula(reagentId)} в пробирку`,
    blocked: false,
    keepHeld: true,
    run: () => {
      const pour = () => tryAddToTube(tube.location, tube.index, reagentId);
      // In when the bottle is tipped over the tube's mouth, where it is held (`PourMotion`).
      useStandMotionStore.getState().startPour(instanceId, pour, undefined, "hand");
    },
  };
}

/** Whether the hand at `point` has brought what it holds to the stand's clamp (`MAGNET_REACH`). */
export function nearClamp(point: THREE.Vector3): boolean {
  if (!CLAMP_TUBE_MOUTH.valid) return false;
  return Math.hypot(point.x - CLAMP_TUBE_MOUTH.point.x, point.z - CLAMP_TUBE_MOUTH.point.z) <= MAGNET_REACH;
}

/** The hover caption over the tube in the clamp: it is taken out into the hand. */
export const TAKE_CLAMPED_TUBE = "Взять пробирку из лапки";

/**
 * The tube in the clamp, pressed: taken out into the hand. The clamp is left
 * empty; the tube is the same tube of its place's rack list (the clamp only
 * ever pointed at it), now carried — from the clamp, where it was
 * (`HAND.takenFrom`) — and put back in its rack hole if let go anywhere.
 */
export function takeClampedTube(): boolean {
  if (useHandStore.getState().held || standBusy() || useHeatingStore.getState().active) return false;
  const location = standLocation();
  const index = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;
  if (location === null || index === null) return false;
  const tube = tubesAt(location)[index];
  if (!tube) return false;
  const from = CLAMP_TUBE_MOUTH.valid ? new THREE.Vector3().setFromMatrixPosition(CLAMP_TUBE_MOUTH.root) : null;
  useBunsenStandStorageStore.getState().detachTestTube();
  useStandStationStore.getState().close();
  if (location === "workbench") {
    const instanceId = `workbench-tube-slot-${index}`;
    takeIntoHand({ kind: "workbench-tube", index, instanceId }, [0, 0, 0]);
    useTestTubeDragStore.setState({ heldInstanceId: instanceId, pendingPickInstanceId: null });
  } else {
    takeIntoHand({ kind: "tube", location, index, instanceId: tube.instanceId }, [0, 0, 0]);
  }
  if (from) {
    HAND.takenFrom.copy(from);
    HAND.takenFromValid = true;
  }
  return true;
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
 * proper way is the clamp off the stand. An empty tube may be heated too:
 * the glass heats, nothing reacts, and the heating ends as it always does
 * (`useHeatingStore`). Contents with no reaction that needs heat are not heated.
 */
export function heatInHandAction(location: TubeLocation, index: number): StandAction | null {
  if (useBurnerStore.getState().place !== location) return null;
  const tube = tubesAt(location)[index];
  if (!tube) return null;
  if (tube.contents.length > 0 && !needsHeat(tube.contents)) return blocked(NOTHING_TO_HEAT);
  const { instanceId } = tube;
  return action("Нагреть пробирку над спиртовкой", () => {
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
  });
}
