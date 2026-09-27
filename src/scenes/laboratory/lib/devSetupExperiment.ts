import { LABORATORY_CONTENT } from "../../../data/content/experiments";
import { REAGENTS } from "../../../entities/laboratory/reagents";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { useBunsenStandStorageStore } from "./useBunsenStandStorageStore";
import { useBurnerStore } from "./useBurnerStore";
import { useFumeHoodControlsStore } from "./useFumeHoodControlsStore";
import { useHeatingStore } from "./useHeatingStore";
import { useReagentStorageStore } from "./useReagentStorageStore";
import { useSceneInteractionStore } from "./useSceneInteractionStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";

const EXPERIMENT_ID = "experiment-copper-nitric-acid";
const FUME_HOOD_ID = "fume-hood";

/** Everything before «Провести эксперимент» — identify, PPE, setup, transfer. */
const PRESOLVED_STEP_IDS = ["step-1-identify", "step-1-ppe", "step-1-setup", "step-1-transfer"];

/**
 * DEV-only jump straight to the heating bench: experiment 1 accepted, its
 * first four steps closed with the points they actually award, PPE on, the
 * copper tube clamped in the stand, the acid and the stand already inside
 * the fume hood with the extraction and the burner running, camera flying to
 * the hood.
 *
 * Deliberately writes the stores directly rather than replaying the UI: this
 * exists to skip that UI. It leaves exactly two things undone — pouring the
 * acid onto the copper and heating the tube.
 */
export function devSetupExperimentOne(): void {
  const experiment = LABORATORY_CONTENT.experiments.find((entry) => entry.id === EXPERIMENT_ID);
  if (!experiment) return;

  const now = new Date().toISOString();
  const store = useLaboratoryStore.getState();
  store.selectExperiment(EXPERIMENT_ID);

  const scoreEvents = PRESOLVED_STEP_IDS.flatMap((stepId) => {
    const step = experiment.steps.find((entry) => entry.id === stepId);
    return (step?.successScoreRules ?? []).map((rule) => ({
      ruleId: rule.id,
      points: rule.points,
      stepId,
      createdAt: now,
    }));
  });

  useLaboratoryStore.setState({
    completedStepIds: PRESOLVED_STEP_IDS,
    currentStepId: "step-1-experiment",
    scoreEvents,
    inventoryItemIds: [
      "safety-coat",
      "safety-goggles",
      "safety-gloves",
      "equipment-holder",
      "equipment-burner",
    ],
    tabletOpen: false,
  });

  useTestTubeStorageStore.setState({
    trayTestTubes: [],
    workbenchTestTubes: [],
    // Index 0 is the clamped one, so the acid tube goes after it and
    // `attachedTubeSlotIndex: 0` below stays correct.
    fumeHoodTestTubes: [
      { instanceId: "dev-tube-cu", contents: ["cu"] },
      { instanceId: "dev-tube-hno3", contents: ["hno3"] },
    ],
  });

  useReagentStorageStore.setState({
    trayItems: [],
    workbenchItems: [],
    fumeHoodItems: [
      {
        instanceId: "dev-jar-hno3",
        reagentId: "hno3",
        containerType: REAGENTS.hno3.containerType,
        cabinetId: "cabinet-acids",
        slotIndex: 0,
      },
    ],
  });

  useBunsenStandStorageStore.setState({
    onTray: false,
    onWorkbench: false,
    onFumeHood: true,
    // The only tube in the hood, so slot 0 — see `transferToFumeHood.ts` for
    // why this index is relative to the tube's current location.
    attachedTubeSlotIndex: 0,
  });

  useBurnerStore.getState().setLit(true);
  useHeatingStore.getState().reset();

  const scene = useSceneInteractionStore.getState();
  if (scene.activeTargetId === FUME_HOOD_ID) {
    // Already standing at the hood, so no approach will run to switch the
    // extraction on for us.
    useFumeHoodControlsStore.getState().setFan(FUME_HOOD_ID, true);
    useFumeHoodControlsStore.getState().setLight(FUME_HOOD_ID, true);
    return;
  }

  // The staged approach owns the light and the fan (it deliberately starts
  // them off and switches them on partway in), so they are NOT set here —
  // `CameraRig` consumes this request and runs that sequence properly.
  scene.requestFocus(FUME_HOOD_ID);
}
