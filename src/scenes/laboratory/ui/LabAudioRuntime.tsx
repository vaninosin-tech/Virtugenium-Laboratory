import { useFrame } from "@react-three/fiber";
import { useEffect } from "react";

import { installLabAudioUnlock, playLabSound, updateLabAmbience } from "../lib/labAudio";
import { reactionKindFor, useTubeReactionStore } from "../lib/tubeReactions";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useHandStore } from "../lib/useHandStore";
import { POUR_MS, TUBE_FLIGHT_MS, useStandMotionStore } from "../lib/useStandMotionStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useTestTubeStorageStore, type StoredTestTube } from "../lib/useTestTubeStorageStore";

/** About how long a let-go item takes to settle back on its place (`PourMotion`'s follow rate). */
const HOME_MS = 420;

/** Contents temperature above which the tube audibly boils. */
const BOIL_FROM = 0.85;

const totalContents = (tubes: readonly StoredTestTube[]) =>
  tubes.reduce((sum, tube) => sum + tube.contents.length, 0);

/**
 * Feeds the procedural lab sound (`labAudio.ts`) from the scene: the burner
 * while it is lit, the clamped tube's fizz and boiling from its chemistry,
 * and one-shots on the edges — a pour whenever a tube gains contents, a
 * crack when the glass gives. Mounted inside the Canvas for `useFrame`;
 * renders nothing.
 */
export function LabAudioRuntime() {
  useEffect(() => {
    installLabAudioUnlock();

    const unsubscribeTubes = useTestTubeStorageStore.subscribe((state, previous) => {
      const now = totalContents(state.workbenchTestTubes) + totalContents(state.fumeHoodTestTubes);
      const before = totalContents(previous.workbenchTestTubes) + totalContents(previous.fumeHoodTestTubes);
      // Tubes carried from the bench into the hood keep their contents, so the
      // sum only grows on a real pour.
      if (now > before) playLabSound("pour");
    });
    const unsubscribeHeating = useHeatingStore.subscribe((state, previous) => {
      if (state.phase === "cracked" && previous.phase !== "cracked") playLabSound("crack");
    });
    // Handling things (VL-015). A tube clamped or put back is heard when it
    // lands, at the end of its flight.
    const timers: number[] = [];
    const later = (ms: number, sound: Parameters<typeof playLabSound>[0]) => {
      timers.push(window.setTimeout(() => playLabSound(sound), ms));
    };
    const unsubscribeClamp = useBunsenStandStorageStore.subscribe((state, previous) => {
      if (state.attachedTubeSlotIndex === previous.attachedTubeSlotIndex) return;
      if (state.attachedTubeSlotIndex !== null && previous.attachedTubeSlotIndex === null) later(TUBE_FLIGHT_MS, "clamp");
      else if (state.attachedTubeSlotIndex === null && state.onWorkbench === previous.onWorkbench && state.onFumeHood === previous.onFumeHood) {
        later(TUBE_FLIGHT_MS, "clink");
      }
    });
    const unsubscribeCap = useBurnerStore.subscribe((state, previous) => {
      // The cap coming off or going on — not the striking of the flame.
      if ((state.phase === "capped") !== (previous.phase === "capped")) playLabSound("cap");
    });
    const unsubscribeHand = useHandStore.subscribe((state, previous) => {
      if (state.held && !previous.held) playLabSound("lift");
      const was = previous.held;
      if (state.held || !was) return;
      // Let go after an action, or put back: heard as it reaches its place.
      // A pour comes home only after pouring; a tube put in the clamp is the clamp's sound.
      if (useStandMotionStore.getState().pour?.instanceId === was.instanceId) later(POUR_MS + HOME_MS, "clink");
      else if ((was.kind === "tube" || was.kind === "workbench-tube") && useBunsenStandStorageStore.getState().attachedTubeSlotIndex === was.index) return;
      else later(HOME_MS, "clink");
    });
    return () => {
      unsubscribeTubes();
      unsubscribeHeating();
      unsubscribeClamp();
      unsubscribeCap();
      unsubscribeHand();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useFrame(() => {
    const atHood = useSceneInteractionStore.getState().activeTargetId === "fume-hood";
    const lit = useBurnerStore.getState().lit;

    let fizz = 0;
    let boil = 0;
    const standIndex = useBunsenStandStorageStore.getState().attachedTubeSlotIndex;
    const tube = standIndex === null ? undefined : useTestTubeStorageStore.getState().fumeHoodTestTubes[standIndex];
    if (tube) {
      const chemistry = useTubeReactionStore.getState().chemistryById[tube.instanceId];
      // Only copper gives off gas; the precipitations and the redox are silent.
      if (chemistry && reactionKindFor(tube.contents) === "copper-nitric") fizz = chemistry.rate;
      if (chemistry && tube.contents.length > 0) boil = Math.max(0, (chemistry.temperature - BOIL_FROM) / (1 - BOIL_FROM));
    }

    // Heard from across the room, the hood is quieter than standing at it.
    const distance = atHood ? 1 : 0.25;
    updateLabAmbience({ burner: lit ? distance : 0, fizz: fizz * distance, boil: boil * distance });
  });

  return null;
}
