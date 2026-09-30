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

/** The ellipse dragged top to top at the reference pace, one pass per `PASS_SECONDS`. */
const pacedSweep = (t: number, from: -1 | 1) => {
  const phase = (t / PASS_SECONDS) % 2;
  const along = phase <= 1 ? phase : 2 - phase;
  return from * (1 - 2 * along);
};

/** Runs the game for `seconds`, optionally dragging the ellipse at the reference pace. */
const run = (seconds: number, paced: boolean, lit = true) => {
  const from = state().sweep < 0 ? -1 : 1;
  for (let t = 0; t < seconds; t += STEP) {
    if (paced) state().setSweep(pacedSweep(t, from));
    state().tick(STEP, lit);
  }
};

const startFrom = (side: "left" | "right") => {
  state().reset();
  state().enter(() => (side === "left" ? 0.1 : 0.9));
};

beforeEach(() => startFrom("left"));

describe("the ellipse", () => {
  it("starts at the top of the V the random pick chose", () => {
    expect(state().sweep).toBe(-1);
    startFrom("right");
    expect(state().sweep).toBe(1);
  });

  it("heats nothing until the player grabs it", () => {
    run(2, false);
    expect(Math.max(...state().zones)).toBe(0);
  });
});

describe("preheating", () => {
  it("dragging at the reference pace preheats evenly in about four passes, without cracking", () => {
    state().grab();
    let maxSpread = 0;
    for (let t = 0; t < PASS_SECONDS * 4.5 && state().phase === "preheat"; t += STEP) {
      state().setSweep(pacedSweep(t, -1));
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
    // Nearer the top of the V than the vertex: lower on the tube.
    expect(spot.height).toBeLessThan(crackSpotForZone(HEAT_ZONE_COUNT / 2).height);
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
    expect(state().sweep).toBe(1);
    expect(state().started).toBe(false);
  });
});

describe("heating the contents", () => {
  const preheat = () => {
    state().grab();
    for (let t = 0; t < PASS_SECONDS * 6 && state().phase === "preheat"; t += STEP) {
      state().setSweep(pacedSweep(t, -1));
      state().tick(STEP, true);
    }
    expect(state().phase).toBe("heating");
  };

  it("fills while the tube's bottom is held in the flame, at either top of the V", () => {
    preheat();
    state().setSweep(-1);
    run(HEAT_SECONDS / 2, false);
    expect(state().heatProgress).toBeCloseTo(0.5, 1);
    state().setSweep(0.95);
    run(HEAT_SECONDS, false);
    expect(state().phase).toBe("done");
  });

  it("does not advance with the tube out of the flame", () => {
    preheat();
    state().setSweep(0);
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
});
