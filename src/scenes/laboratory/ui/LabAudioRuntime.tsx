import { useFrame } from "@react-three/fiber";
import { useEffect } from "react";

import { installLabAudioUnlock, playLabSound, updateLabAmbience } from "../lib/labAudio";
import { reactionKindFor, useTubeReactionStore } from "../lib/tubeReactions";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useBurnerStore } from "../lib/useBurnerStore";
import { useHeatingStore } from "../lib/useHeatingStore";
import { useSceneInteractionStore } from "../lib/useSceneInteractionStore";
import { useTestTubeStorageStore, type StoredTestTube } from "../lib/useTestTubeStorageStore";

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
    return () => {
      unsubscribeTubes();
      unsubscribeHeating();
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
