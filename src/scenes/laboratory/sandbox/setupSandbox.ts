/**
 * TEMPORARY sandbox mode — a place to mix, heat and watch the reactions of
 * all four experiments without playing them. Not in the ToR (which excludes
 * a creative mode); everything it needs lives in this folder plus a handful
 * of `mode === "sandbox"` checks, so removing it means deleting this folder
 * and grepping for "sandbox".
 */
import { REAGENTS, type ReagentId } from "../../../entities/laboratory/reagents";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import type { HotspotTargetId } from "../lib/layout";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { useTubeReactionStore } from "../lib/tubeReactions";
import { useTubeCloseUpStore } from "../lib/useTubeCloseUpStore";

const FUME_HOOD_ID = "fume-hood";

/** The shelf each bottle nominally came from — only read if it is ever returned to a cabinet. */
const CABINET_BY_REAGENT: Record<ReagentId, HotspotTargetId> = {
  cu: "cabinet-simple",
  hno3: "cabinet-acids",
  h2so4: "cabinet-acids",
  agno3: "cabinet-salts",
  nacl: "cabinet-salts",
  bacl2: "cabinet-salts",
  k2so4: "cabinet-salts",
  na2so3: "cabinet-salts",
  kmno4: "cabinet-salts",
};

let tubeSerial = 0;
const freshTube = () => ({ instanceId: `sandbox-tube-${tubeSerial++}`, contents: [] as string[] });

/**
 * Puts every reagent of all four experiments into the fume hood, an empty
 * tube in the stand over a lit burner, and flies the camera there. No
 * assignment is selected, so `judgeMix` allows any combination and no
 * penalty rule applies.
 */
export function setupSandbox(): void {
  const lab = useLaboratoryStore.getState();
  lab.clearAssignment();
  useLaboratoryStore.setState({
    inventoryItemIds: ["safety-coat", "safety-goggles", "safety-gloves", "equipment-holder", "equipment-burner"],
    tabletOpen: false,
  });

  useTestTubeStorageStore.setState({
    trayTestTubes: [],
    workbenchTestTubes: [],
    fumeHoodTestTubes: [freshTube()],
  });

  useReagentStorageStore.setState({
    trayItems: [],
    workbenchItems: [],
    fumeHoodItems: (Object.keys(REAGENTS) as ReagentId[]).map((reagentId, slotIndex) => ({
      instanceId: `sandbox-jar-${reagentId}`,
      reagentId,
      containerType: REAGENTS[reagentId].containerType,
      cabinetId: CABINET_BY_REAGENT[reagentId],
      slotIndex,
    })),
  });

  useBunsenStandStorageStore.setState({
    onTray: false,
    onWorkbench: false,
    onFumeHood: true,
    attachedTubeSlotIndex: 0,
  });

  useBurnerStore.setState({ place: "fumeHood", returnRequest: null });
  useBurnerStore.getState().setLit(true);
  useHeatingStore.getState().reset();
  useTubeReactionStore.getState().reset();
  useSceneInteractionStore.getState().requestFocus(FUME_HOOD_ID);
}

/**
 * Takes the sandbox's setup back out, so a real attempt started afterwards
 * does not find nine bottles and a lit burner already in the hood. The scene
 * stores outlive the lab screen, hence this rather than relying on unmount.
 */
export function teardownSandbox(): void {
  useTestTubeStorageStore.setState({ fumeHoodTestTubes: [] });
  useReagentStorageStore.setState({ fumeHoodItems: [] });
  useBunsenStandStorageStore.setState({ onFumeHood: false, attachedTubeSlotIndex: null });
  useBurnerStore.setState({ place: "shelf", returnRequest: null });
  useBurnerStore.getState().setLit(false);
  useHeatingStore.getState().reset();
  useTubeReactionStore.getState().reset();
  useLaboratoryStore.setState({ inventoryItemIds: [] });
}

/** Swaps the clamped tube for a clean one — the sandbox's only way to start another combination. */
export function replaceSandboxTube(): void {
  useTestTubeStorageStore.setState({ fumeHoodTestTubes: [freshTube()] });
  useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
  useHeatingStore.getState().reset();
  useTubeReactionStore.getState().reset();
}

/** What goes in first, and the reagent poured last — the one that starts the reaction. */
const EXPERIMENT_SHOWCASE: Record<1 | 2 | 3 | 4, { first: ReagentId[]; last: ReagentId; hot?: boolean }> = {
  1: { first: ["cu"], last: "hno3", hot: true },
  2: { first: ["agno3"], last: "nacl" },
  3: { first: ["bacl2"], last: "k2so4" },
  4: { first: ["na2so3", "h2so4"], last: "kmno4" },
};

let showcaseTimers: number[] = [];

/**
 * Shows one experiment close up: a clean tube with the first reagents, the
 * camera at the tube, then the last reagent a moment later so the start of the
 * reaction is seen. Experiment 1 is kept hot instead of being heated by hand.
 */
export function showExperiment(experiment: 1 | 2 | 3 | 4): void {
  for (const timer of showcaseTimers) {
    window.clearTimeout(timer);
    window.clearInterval(timer);
  }
  showcaseTimers = [];
  replaceSandboxTube();
  const { first, last, hot } = EXPERIMENT_SHOWCASE[experiment];
  const tubes = useTestTubeStorageStore.getState();
  for (const id of first) tubes.addTubeContents("fumeHood", 0, id);
  // The showcase starts warming the contents while the last reagent is poured.
  // The tube field owns the heat-up and keeps its local gradient.
  if (hot) {
    const id = useTestTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
    if (id) useTubeReactionStore.getState().setExternalHeat(id, 1);
  }
  useSceneInteractionStore.getState().requestFocus(FUME_HOOD_ID);

  showcaseTimers.push(
    window.setTimeout(() => {
      useTestTubeStorageStore.getState().addTubeContents("fumeHood", 0, last);
      // The close-up needs the reacting tube to have claimed the focus point first.
      showcaseTimers.push(window.setTimeout(() => useTubeCloseUpStore.getState().open(), 150));
    }, 1500),
  );
}
