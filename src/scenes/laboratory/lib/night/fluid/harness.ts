import * as THREE from "three";
import { LiquidMask } from "../../tubeVolumeField";
import { TubeFlowSolver } from "../../tubeFlowSolver";
import { tubeLiquidHeight } from "../../tubeLiquidLevel";
import { pouredMl } from "../../tubePourImpact";
import { TUBE_SIMULATION } from "../../tubeSimulationConfig";

export type Grid = "LOW" | "HIGH";
export type GridQuality = Grid;
export interface FluidRunOptions {
  grid?: Grid;
  quality?: Grid;
  initialMl?: number;
  up?: THREE.Vector3;
  tiltRadians?: number;
  inletX?: number;
  impactX?: number;
  pourSteps?: number;
  coastSteps?: number;
  pressureIterations?: number;
}
export interface FluidSample {
  step: number;
  volumeMl: number;
  deliveredMl: number;
  level: number;
  activeCount: number;
  mass: number;
  centroid: [number, number, number];
  energy: number;
  meanAbsDivergence: number;
  movingFraction: number;
}

const radius = 0.007;
const height = 0.055;
const dt = TUBE_SIMULATION.field.stepSeconds;
const diffusivity = TUBE_SIMULATION.jetFlow.molecularDiffusivity;

export function nearestWetCell(mask: LiquidMask, point: THREE.Vector3): number {
  let seed = -1, nearest = Infinity;
  for (let a = 0; a < mask.activeCount; a++) {
    const i = mask.active[a];
    const p = mask.point(i % mask.nx, Math.floor(i / mask.nx) % mask.ny,
      Math.floor(i / (mask.nx * mask.ny)));
    const distance = p.distanceToSquared(point);
    if (distance < nearest) { nearest = distance; seed = i; }
  }
  if (seed < 0) throw new RangeError("initial fill contains no wet cells");
  return seed;
}

export function tracerCentroid(mask: LiquidMask, tracer: Float64Array): [number, number, number] {
  let mass = 0, x = 0, y = 0, z = 0;
  for (let a = 0; a < mask.activeCount; a++) {
    const i = mask.active[a], v = tracer[i];
    const p = mask.point(i % mask.nx, Math.floor(i / mask.nx) % mask.ny,
      Math.floor(i / (mask.nx * mask.ny)));
    mass += v; x += v * p.x; y += v * p.y; z += v * p.z;
  }
  return [x / mass, y / mass, z / mass];
}

export function runFluidPour(options: FluidRunOptions = {}) {
  const grid = TUBE_SIMULATION.jetFlow[options.grid ?? options.quality ?? "HIGH"];
  const initialMl = options.initialMl ?? 2.5;
  const up = (options.up ?? new THREE.Vector3(Math.sin(options.tiltRadians ?? 0),
    Math.cos(options.tiltRadians ?? 0), 0)).clone().normalize();
  const pourSteps = options.pourSteps ?? 20;
  const coastSteps = options.coastSteps ?? 60;
  if (pourSteps <= 0 || !Number.isInteger(pourSteps) || coastSteps < 0 || !Number.isInteger(coastSteps))
    throw new RangeError("pourSteps must be positive and coastSteps nonnegative integers");
  const mask = new LiquidMask(grid.width, grid.height, grid.depth, radius, 0, height);
  mask.update(up, tubeLiquidHeight(initialMl, radius));
  const solver = new TubeFlowSolver(mask, { pressureIterations: options.pressureIterations });
  const inlet = new THREE.Vector3(options.inletX ?? options.impactX ?? 0,
    tubeLiquidHeight(initialMl, radius) - radius * 0.25, 0);
  const tracer = new Float64Array(mask.data.length);
  const seed = nearestWetCell(mask, inlet);
  tracer[seed] = 1;
  const direction = up.clone().negate();
  const samples: FluidSample[] = [];
  const sample = (step: number, volumeMl: number) => {
    let mass = 0;
    for (let a = 0; a < mask.activeCount; a++) {
      const i = mask.active[a], v = tracer[i];
      mass += v;
    }
    const diagnostics = solver.diagnostics();
    samples.push({ step, volumeMl, deliveredMl: volumeMl - initialMl,
      level: tubeLiquidHeight(volumeMl, radius),
      activeCount: mask.activeCount, mass,
      centroid: tracerCentroid(mask, tracer),
      energy: diagnostics.energy, meanAbsDivergence: diagnostics.meanAbsDivergence,
      movingFraction: diagnostics.movingFraction });
  };
  sample(0, initialMl);
  for (let step = 1; step <= pourSteps + coastSteps; step++) {
    const deliveredMl = pouredMl(Math.min(step, pourSteps) / pourSteps);
    const previousMl = pouredMl(Math.min(step - 1, pourSteps) / pourSteps);
    const volumeMl = initialMl + deliveredMl;
    mask.update(up, tubeLiquidHeight(volumeMl, radius));
    solver.refreshMask();
    inlet.y = tubeLiquidHeight(volumeMl, radius) - radius * 0.15;
    solver.step(dt, inlet, direction, step <= pourSteps ? 0.02 * (deliveredMl - previousMl) * pourSteps : 0);
    solver.transport(tracer, dt, diffusivity);
    sample(step, volumeMl);
  }
  return { mask, solver, tracer, samples, seed, pourSteps, coastSteps, dt };
}
