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
import { prewarmBariumLiquidShader } from "../lib/tubeReactionVisuals";
import { clearTubeAmount, resetTubeAmounts, seedTubeAmounts } from "../lib/tubeAmounts";
import { clearTubePourImpact, publishTubePourImpact } from "../lib/tubePourImpact";
import { CLAMP_TUBE_MOUTH } from "../lib/useStandMotionStore";
import * as THREE from "three";

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
  // Heating is never required (game-rules-amounts §7): the burner starts out and the player lights it.
  useBurnerStore.getState().setLit(false);
  useHeatingStore.getState().reset();
  useTubeReactionStore.getState().reset();
  resetTubeAmounts();
  useSceneInteractionStore.getState().requestFocus(FUME_HOOD_ID);
}

/** The sandbox burner is lit or put out here; nothing heats a tube until it is lit and the tube is held in the flame. */
export function setSandboxBurnerLit(lit: boolean): void {
  useBurnerStore.getState().setLit(lit);
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
  resetTubeAmounts();
  useLaboratoryStore.setState({ inventoryItemIds: [] });
}

/** Swaps the clamped tube for a clean one — the sandbox's only way to start another combination. */
export function replaceSandboxTube(): void {
  const old = useTestTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
  if (old) { clearTubeAmount(old); clearTubePourImpact(old); }
  useTestTubeStorageStore.setState({ fumeHoodTestTubes: [freshTube()] });
  useBunsenStandStorageStore.setState({ attachedTubeSlotIndex: 0 });
  useHeatingStore.getState().reset();
  useTubeReactionStore.getState().reset();
}

/** What goes in first, and the reagent poured last — the one that starts the reaction. */
const EXPERIMENT_SHOWCASE: Record<1 | 2 | 3 | 4, { first: ReagentId[]; last: ReagentId }> = {
  1: { first: ["cu"], last: "hno3" },
  2: { first: ["agno3"], last: "nacl" },
  3: { first: ["bacl2"], last: "k2so4" },
  4: { first: ["na2so3", "h2so4"], last: "kmno4" },
};

let showcaseTimers: number[] = [];
let showcaseGeneration = 0;

/**
 * Shows one experiment close up: a clean tube with the first reagents, the
 * camera at the tube, then the last reagent a moment later so the start of the
 * reaction is seen. Every experiment starts cold; `heated` (experiment 1 only)
 * feeds the tube the same heat the flame would, for a quick look at the hot reaction.
 */
export function showExperiment(experiment: 1 | 2 | 3 | 4,
  point: "left" | "center" | "right" = "right", speed: "slow" | "fast" = "slow", heated = false): void {
  const generation = ++showcaseGeneration;
  for (const timer of showcaseTimers) {
    window.clearTimeout(timer);
    window.clearInterval(timer);
  }
  showcaseTimers = [];
  replaceSandboxTube();
  const { first, last } = EXPERIMENT_SHOWCASE[experiment];
  const hot = heated && experiment === 1;
  const tubes = useTestTubeStorageStore.getState();
  for (const id of first) tubes.addTubeContents("fumeHood", 0, id);
  const tubeId = useTestTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
  if (tubeId) seedTubeAmounts(tubeId, first);
  // The showcase starts warming the contents while the last reagent is poured.
  // The tube field owns the heat-up and keeps its local gradient.
  if (hot) {
    const id = useTestTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
    if (id) useTubeReactionStore.getState().setExternalHeat(id, 1);
  }
  useSceneInteractionStore.getState().requestFocus(FUME_HOOD_ID);

  const pour = () => {
      if (generation !== showcaseGeneration) return;
      useTestTubeStorageStore.getState().addTubeContents("fumeHood", 0, last);
      if (tubeId) {
        const serial = Date.now();
        const duration = speed === "fast" ? 450 : 1300;
        const started = performance.now();
        let prior = 0;
        const timer = window.setInterval(() => {
          if (generation !== showcaseGeneration) { window.clearInterval(timer); return; }
          const fraction = Math.min(1, (performance.now() - started) / duration);
          const side = point === "left" ? -1 : point === "right" ? 1 : 0;
          const target = CLAMP_TUBE_MOUTH.point.clone().add(new THREE.Vector3(side * 0.006, -0.026, 0));
          publishTubePourImpact(tubeId, last, target, new THREE.Vector3(0, -1, 0),
            speed === "fast" ? 2.2 : 0.77, fraction - prior, serial);
          prior = fraction;
          if (fraction >= 1) window.clearInterval(timer);
        }, 40);
        showcaseTimers.push(timer);
      }
      // The close-up needs the reacting tube to have claimed the focus point first.
      showcaseTimers.push(window.setTimeout(() => useTubeCloseUpStore.getState().open(), 150));
  };
  {
    const three = (window as unknown as { __three?: { gl: THREE.WebGLRenderer;
      scene: THREE.Scene; camera: THREE.Camera } }).__three;
    if (three) {
      const started = Date.now();
      void prewarmBariumLiquidShader(three.gl, three.scene, three.camera,
        experiment === 1 ? "copper-nitric" : experiment === 2 ? "silver-chloride"
          : experiment === 3 ? "barium-sulfate" : "permanganate-redox")
        .catch(error => { if (import.meta.env.DEV) console.warn("Reaction shader warmup failed", error); })
        .then(() => showcaseTimers.push(window.setTimeout(pour,
          Math.max(0, 1500 - (Date.now() - started)))));
      return;
    }
  }
  showcaseTimers.push(window.setTimeout(pour, 1500));
}
