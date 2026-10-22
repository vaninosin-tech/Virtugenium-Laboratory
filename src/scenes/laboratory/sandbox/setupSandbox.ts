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
 * tube in the stand beside a capped burner, and flies the camera there. No
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

  // Capped: the lamp opens and lights only when the player heats the tube.
  useBurnerStore.setState({ place: "fumeHood", returnRequest: null });
  useBurnerStore.getState().setLit(false);
  useHeatingStore.getState().reset();
  useTubeReactionStore.getState().reset();
  useSceneInteractionStore.getState().requestFocus(FUME_HOOD_ID);
}

/**
 * Takes the sandbox's setup back out, so a real attempt started afterwards
 * does not find nine bottles and a burner already in the hood. The scene
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
