import { beforeEach, describe, expect, it } from "vitest";

import {
  CRACK_SPREAD,
  HEAT_SECONDS,
  HEAT_ZONE_COUNT,
  crackSpotForZone,
  PASS_SECONDS,
  heatSpread,
  useHeatingStore,
} from "./useHeatingStore";

const state = () => useHeatingStore.getState();
const STEP = 1 / 60;

/** Runs the game for `seconds`, optionally letting the knob follow the oval each frame. */
const run = (seconds: number, follow: boolean, lit = true) => {
  for (let t = 0; t < seconds; t += STEP) {
    if (follow) state().setSweep(state().target);
    state().tick(STEP, lit);
  }
};

const startFrom = (side: "left" | "right") => {
  state().reset();
  state().enter(() => (side === "left" ? 0.1 : 0.9));
};

beforeEach(() => startFrom("left"));

describe("the oval", () => {
  it("starts at the side the random pick chose, knob underneath it", () => {
    expect(state().target).toBe(-1);
    expect(state().sweep).toBe(-1);
    startFrom("right");
    expect(state().target).toBe(1);
    expect(state().sweep).toBe(1);
  });

  it("waits for the player to grab the knob", () => {
    run(2, false);
    expect(state().target).toBe(-1);
    expect(Math.max(...state().zones)).toBe(0);
  });

  it("crosses the track in one pass time and turns back", () => {
    state().grab();
    run(PASS_SECONDS / 2, false, false);
    expect(state().target).toBeCloseTo(0, 1);
    run(PASS_SECONDS / 2 + 0.5, false, false);
    expect(state().targetDirection).toBe(-1);
    expect(state().target).toBeLessThan(1);
  });
});

describe("preheating", () => {
  it("following the oval preheats evenly in about four passes, without cracking", () => {
    state().grab();
    let maxSpread = 0;
    for (let t = 0; t < PASS_SECONDS * 4.5 && state().phase === "preheat"; t += STEP) {
      state().setSweep(state().target);
      state().tick(STEP, true);
      maxSpread = Math.max(maxSpread, heatSpread(state().zones));
    }
    expect(state().phase).toBe("heating");
    expect(maxSpread).toBeLessThan(CRACK_SPREAD);
  });

  it("holding still in the flame cracks the tube", () => {
    state().grab();
    state().setSweep(0);
    run(3, false);
    expect(state().phase).toBe("cracked");
  });

  it("remembers where the glass was hottest when it cracked", () => {
    state().grab();
    state().setSweep(0.6);
    run(3, false);
    expect(state().phase).toBe("cracked");
    const zone = state().crackZone!;
    expect(state().zones[zone]).toBe(Math.max(...state().zones));
    const spot = crackSpotForZone(zone);
    expect(spot.side).toBeGreaterThan(0.5);
    expect(spot.height).toBeGreaterThan(crackSpotForZone(HEAT_ZONE_COUNT / 2).height);
  });

  it("an unlit burner heats nothing", () => {
    state().grab();
    state().setSweep(0);
    run(5, false, false);
    expect(Math.max(...state().zones)).toBe(0);
    expect(state().phase).toBe("preheat");
  });

  it("restarting after a crack gives fresh glass", () => {
    state().grab();
    state().setSweep(0);
    run(3, false);
    state().restartPreheat(() => 0.9);
    expect(state().phase).toBe("preheat");
    expect(Math.max(...state().zones)).toBe(0);
    expect(state().target).toBe(1);
    expect(state().started).toBe(false);
  });
});

describe("heating the contents", () => {
  const preheat = () => {
    state().grab();
    for (let t = 0; t < PASS_SECONDS * 6 && state().phase === "preheat"; t += STEP) {
      state().setSweep(state().target);
      state().tick(STEP, true);
    }
  };

  it("parks the oval in the flame and fills while the knob is held there", () => {
    preheat();
    expect(state().target).toBe(0);
    state().setSweep(0);
    run(HEAT_SECONDS / 2, false);
    expect(state().heatProgress).toBeCloseTo(0.5, 1);
    run(HEAT_SECONDS, false);
    expect(state().phase).toBe("done");
  });

  it("does not advance with the tube out of the flame", () => {
    preheat();
    state().setSweep(0.8);
    run(HEAT_SECONDS, false);
    expect(state().heatProgress).toBe(0);
  });
});

it("leaving the mini-game keeps the glass as it was", () => {
  state().grab();
  run(1, true);
  const zones = state().zones;
  state().exit();
  state().enter(() => 0.9);
  expect(state().active).toBe(true);
  expect(state().zones).toEqual(zones);
  expect(state().target).not.toBe(1);
});
