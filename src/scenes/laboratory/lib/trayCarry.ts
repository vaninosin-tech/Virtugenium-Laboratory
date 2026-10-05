import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useLabNoticeStore } from "./useLabNoticeStore";
import { nextFreeTraySlot, useReagentStorageStore } from "./useReagentStorageStore";
import { useTestTubeStorageStore, TEST_TUBE_TRAY_CAPACITY, type TubeLocation } from "./useTestTubeStorageStore";

/**
 * The tray is carried (VL-017): what is on it stays on it from the table to
 * the cabinets and the fume hood, until the player puts it down. This module
 * moves things between the tray and a place (the workbench or the hood) —
 * the one place that keeps the stores' lists and the stand's clamp in step.
 *
 * The clamp index is relative to the list of the place the stand is at
 * (HANDOFF 2.1): removing a tube that stands BEFORE the clamped one in that
 * list shifts it, so the clamp is re-pointed in the same operation.
 */

export type CarryPlace = TubeLocation;

const refuse = (text: string): false => {
  useLabNoticeStore.getState().show(text, "refusal");
  return false;
};

/* ---------- bottles ---------- */

/** A bottle from a place onto the tray, into a free slot of the bottles' half. */
export function bottleToTray(place: CarryPlace, instanceId: string): boolean {
  if (place === "workbench") {
    // The same move a jar dragged onto the tray makes (`returnWorkbenchReagent`).
    const before = useReagentStorageStore.getState().trayItems.length;
    useReagentStorageStore.getState().returnWorkbenchReagent(instanceId);
    return useReagentStorageStore.getState().trayItems.length > before;
  }
  // From the hood.
  const state = useReagentStorageStore.getState();
  const item = state.fumeHoodItems.find((candidate) => candidate.instanceId === instanceId);
  if (!item) return false;
  const slotIndex = nextFreeTraySlot(state.trayItems);
  if (slotIndex < 0) return refuse("На подносе нет места для склянок");
  useReagentStorageStore.setState({
    trayItems: [...state.trayItems, { ...item, slotIndex }],
    fumeHoodItems: state.fumeHoodItems.filter((candidate) => candidate.instanceId !== instanceId),
  });
  return true;
}

/** A bottle from the tray down to a place. */
export function bottleFromTray(instanceId: string, place: CarryPlace): boolean {
  const state = useReagentStorageStore.getState();
  const item = state.trayItems.find((candidate) => candidate.instanceId === instanceId);
  if (!item) return false;
  useReagentStorageStore.setState({
    trayItems: state.trayItems.filter((candidate) => candidate.instanceId !== instanceId),
    ...(place === "workbench"
      ? { workbenchItems: [...state.workbenchItems, item] }
      : { fumeHoodItems: [...state.fumeHoodItems, item] }),
  });
  return true;
}

/* ---------- tubes ---------- */

const tubesAt = (place: CarryPlace) => {
  const state = useTestTubeStorageStore.getState();
  return place === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
};
const setTubesAt = (place: CarryPlace, tubes: ReturnType<typeof tubesAt>) =>
  useTestTubeStorageStore.setState(place === "workbench" ? { workbenchTestTubes: tubes } : { fumeHoodTestTubes: tubes });

/** Where the stand is, if it is at a place the tubes are listed for. */
const standPlace = (): CarryPlace | null => {
  const stand = useBunsenStandStorageStore.getState();
  return stand.onFumeHood ? "fumeHood" : stand.onWorkbench ? "workbench" : null;
};

/** A tube from a place's rack onto the tray's rack. The clamped tube stays in the clamp. */
export function tubeToTray(place: CarryPlace, index: number): boolean {
  const tubes = tubesAt(place);
  const tube = tubes[index];
  if (!tube) return false;
  const clamp = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;
  const clampHere = standPlace() === place ? clamp : null;
  if (clampHere === index) return refuse("Сначала выньте пробирку из лапки");
  const tray = useTestTubeStorageStore.getState().trayTestTubes;
  if (tray.length >= TEST_TUBE_TRAY_CAPACITY) return refuse("На подносе нет места для пробирок");
  setTubesAt(place, tubes.filter((_, i) => i !== index));
  useTestTubeStorageStore.setState({ trayTestTubes: [...tray, tube] });
  if (clampHere !== null && clampHere > index) useBunsenStandStorageStore.getState().remapAttachedTube(clampHere - 1);
  return true;
}

/** A tube from the tray's rack down to a place's rack (appended: the clamp index is unaffected). */
export function tubeFromTray(instanceId: string, place: CarryPlace): boolean {
  const tray = useTestTubeStorageStore.getState().trayTestTubes;
  const tube = tray.find((candidate) => candidate.instanceId === instanceId);
  if (!tube) return false;
  useTestTubeStorageStore.setState({ trayTestTubes: tray.filter((candidate) => candidate.instanceId !== instanceId) });
  setTubesAt(place, [...tubesAt(place), tube]);
  return true;
}

/* ---------- stand and lamp ---------- */

/**
 * The stand from a place onto the tray — with the lamp if it stands beside
 * it. Not with a tube in the clamp: it would ride the tray unseen.
 */
export function standToTray(place: CarryPlace): boolean {
  if (standPlace() !== place) return false;
  if (useBunsenStandStorageStore.getState().attachedTubeSlotIndex !== null) {
    return refuse("Сначала выньте пробирку из лапки штатива");
  }
  useBunsenStandStorageStore.setState({ onWorkbench: false, onFumeHood: false, onTray: true });
  if (useBurnerStore.getState().place === place) lampToTray(place);
  return true;
}

/** The stand from the tray down to a place — and the lamp with it if it rides the tray too. */
export function standFromTray(place: CarryPlace): boolean {
  if (!useBunsenStandStorageStore.getState().onTray) return false;
  useBunsenStandStorageStore.setState({
    onTray: false,
    onWorkbench: place === "workbench",
    onFumeHood: place === "fumeHood",
    attachedTubeSlotIndex: null,
  });
  if (useBurnerStore.getState().place === "tray") lampFromTray(place);
  return true;
}

/** The lamp onto the tray — capped: a burning lamp is not carried. */
export function lampToTray(place: CarryPlace): boolean {
  if (useBurnerStore.getState().place !== place) return false;
  useBurnerStore.setState({ place: "tray", phase: "capped", lit: false });
  return true;
}

export function lampFromTray(place: CarryPlace): boolean {
  if (useBurnerStore.getState().place !== "tray") return false;
  useBurnerStore.setState({ place });
  return true;
}

/** Everything on the tray down to a place. */
export function unloadTray(place: CarryPlace): void {
  for (const item of useReagentStorageStore.getState().trayItems) bottleFromTray(item.instanceId, place);
  for (const tube of useTestTubeStorageStore.getState().trayTestTubes) tubeFromTray(tube.instanceId, place);
  if (useBunsenStandStorageStore.getState().onTray) standFromTray(place);
  else if (useBurnerStore.getState().place === "tray") lampFromTray(place);
}

/** Whether anything rides the tray. */
export function trayHasItems(): boolean {
  return (
    useReagentStorageStore.getState().trayItems.length > 0 ||
    useTestTubeStorageStore.getState().trayTestTubes.length > 0 ||
    useBunsenStandStorageStore.getState().onTray ||
    useBurnerStore.getState().place === "tray"
  );
}


/** «На стол» / «В вытяжной шкаф» — the caption for taking something off the tray here. */
export const unloadLabel = (place: CarryPlace) => (place === "workbench" ? "Поставить на стол" : "Поставить в вытяжной шкаф");
