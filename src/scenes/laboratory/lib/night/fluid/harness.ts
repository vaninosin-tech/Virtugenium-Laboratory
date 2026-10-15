import * as THREE from "three";
import { LiquidMask } from "../../tubeVolumeField";
import { TubeFlowSolver } from "../../tubeFlowSolver";
import { tubeLiquidHeight } from "../../tubeLiquidLevel";
import { pouredMl } from "../../tubePourImpact";
import { TUBE_SIMULATION } from "../../tubeSimulationConfig";

export type GridQuality = "LOW" | "HIGH";
export interface FluidRunOptions {
  quality?: GridQuality;
  initialMl?: number;
  tiltRadians?: number;
  impactX?: number;
  pourSteps?: number;
  coastSteps?: number;
  diffusivity?: number;
}
export interface FluidSample {
  step: number;
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

export function nearestWetCell(mask: LiquidMask, point: THREE.Vector3): number {
  let seed = -1, distance = Infinity;
  for (let a = 0; a < mask.activeCount; a++) {
    const i = mask.active[a];
    const p = mask.point(i % mask.nx, Math.floor(i / mask.nx) % mask.ny,
      Math.floor(i / (mask.nx * mask.ny)));
    const d = p.distanceToSquared(point);
    if (d < distance) { distance = d; seed = i; }
  }
  if (seed < 0) throw new Error("Liquid mask has no wet cells");
  return seed;
}

export function tracerCentroid(mask: LiquidMask, tracer: Float64Array): [number, number, number] {
  const centre: [number, number, number] = [0, 0, 0];
  let mass = 0;
  for (let a = 0; a < mask.activeCount; a++) {
    const i = mask.active[a], v = tracer[i];
    const p = mask.point(i % mask.nx, Math.floor(i / mask.nx) % mask.ny,
      Math.floor(i / (mask.nx * mask.ny)));
    centre[0] += v * p.x; centre[1] += v * p.y; centre[2] += v * p.z;
    mass += v;
  }
  return centre.map(v => v / mass) as [number, number, number];
}

/** One continuous 1 ml pour followed by coasting, sampled at the fixed solver step. */
export function runFluidPour(options: FluidRunOptions = {}) {
  const quality = options.quality ?? "HIGH";
  const grid = TUBE_SIMULATION.jetFlow[quality];
  const mask = new LiquidMask(grid.width, grid.height, grid.depth, radius, 0, height);
  const solver = new TubeFlowSolver(mask);
  const tracer = new Float64Array(mask.data.length);
  const initialMl = options.initialMl ?? 2.5;
  const tilt = options.tiltRadians ?? 0;
  const up = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0);
  const impactX = options.impactX ?? 0;
  const pourSteps = options.pourSteps ?? 20;
  const coastSteps = options.coastSteps ?? 60;
  const diffusivity = options.diffusivity ?? 2e-7;
  if (pourSteps < 1 || coastSteps < 0) throw new Error("Invalid step counts");
  const initialLevel = tubeLiquidHeight(initialMl, radius);
  mask.update(up, initialLevel);
  solver.refreshMask();
  const seed = nearestWetCell(mask, new THREE.Vector3(impactX, initialLevel - radius * 0.25, 0));
  tracer[seed] = 1;
  const samples: FluidSample[] = [];
  const direction = up.clone().negate();
  for (let step = 1; step <= pourSteps + coastSteps; step++) {
    const fraction = Math.min(1, step / pourSteps);
    const previousFraction = Math.min(1, (step - 1) / pourSteps);
    const deliveredMl = pouredMl(fraction);
    const incrementMl = deliveredMl - pouredMl(previousFraction);
    const level = tubeLiquidHeight(initialMl + deliveredMl, radius);
    mask.update(up, level);
    solver.refreshMask();
    const inlet = new THREE.Vector3(impactX, level - radius * 0.15, 0);
    solver.step(dt, inlet, direction, 0.02 * incrementMl / (1 / pourSteps));
    solver.transport(tracer, dt, diffusivity);
    const scalar = solver.scalarDiagnostics(tracer);
    const flow = solver.diagnostics();
    samples.push({ step, deliveredMl, level, activeCount: mask.activeCount,
      mass: scalar.mass, centroid: tracerCentroid(mask, tracer), energy: flow.energy,
      meanAbsDivergence: flow.meanAbsDivergence, movingFraction: flow.movingFraction });
  }
  return { mask, solver, tracer, seed, samples, dt, pourSteps, coastSteps };
}
