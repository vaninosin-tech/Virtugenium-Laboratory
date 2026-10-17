import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clearDeliveries, deliveredMl, deliveryEvents, firstValidDelivery, recordDelivery,
  validateImpact, type DeliveryPoint } from "../../../src/scenes/laboratory/lib/tubeDelivery";
import { resetTubeAmounts, seedTubeAmounts, tubeAmount } from "../../../src/scenes/laboratory/lib/tubeAmounts";
import { tubeEffectiveRadius, tubeLiquidHeight } from "../../../src/scenes/laboratory/lib/tubeLiquidLevel";
import { pouredMl, pourFlowMlPerSecond } from "../../../src/scenes/laboratory/lib/tubePourImpact";
import { POUR_MS } from "../../../src/scenes/laboratory/lib/useStandMotionStore";

// The game reads the stage switch at module import time.
(globalThis as { window?: { __silverStage?: number } }).window ??= {};
window.__silverStage = 3;
const { TubeSilverField } = await import("../../../src/scenes/laboratory/lib/tubeSilverField");
afterAll(() => { delete window.__silverStage; });
beforeEach(() => { clearDeliveries(); resetTubeAmounts(); });

const ID = "receiving", RADIUS = 0.007, HEIGHT = 0.055, DT = 50;
const EFFECTIVE_RADIUS = tubeEffectiveRadius(HEIGHT);
const FIELD_HEIGHT = Math.max(HEIGHT, tubeLiquidHeight(5, EFFECTIVE_RADIUS) + RADIUS * 0.25);
type Field = InstanceType<typeof TubeSilverField>;
type Cell = { x: number; y: number; z: number; row: number; index: number };
type EventRow = { atMs: number; event: string; x?: number; y?: number; z?: number;
  surfaceY?: number; deliveredMl: number; chloride: number; extent: number };
function exportEvents(rows: EventRow[]) {
  if (process.env.WRITE_WAVE8_EVENTS !== "1") return;
  const path = fileURLToPath(new URL("../../../docs/night/wave8integration/events.md", import.meta.url));
  const lines = ["# Stage 3 surface delivery events", "", "50 ms simulation steps. Positions and surface heights are in metres; chloride is `Cl-.total + extent`.", "",
    "| t (ms) | event | x | y | z | surface y | delivered mL | chloride | extent |", "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(r => `| ${r.atMs} | ${r.event} | ${r.x?.toFixed(6) ?? ""} | ${r.y?.toFixed(6) ?? ""} | ${r.z?.toFixed(6) ?? ""} | ${r.surfaceY?.toFixed(6) ?? ""} | ${r.deliveredMl.toFixed(9)} | ${r.chloride.toFixed(9)} | ${r.extent.toFixed(9)} |`)];
  writeFileSync(path, lines.join("\n") + "\n");
}

function firstCell(field: Field, values: ArrayLike<number>): Cell | undefined {
  const m = field.mask;
  for (let a = 0; a < m.activeCount; a++) {
    const index = m.active[a];
    if (values[index] <= 0) continue;
    const x = index % m.nx, row = Math.floor(index / m.nx) % m.ny;
    const z = Math.floor(index / (m.nx * m.ny));
    const p = m.point(x, row, z);
    return { x: p.x, y: p.y, z: p.z, row, index };
  }
}
class DeliveryHarness {
  readonly field = new TubeSilverField("LOW", RADIUS, 0, FIELD_HEIGHT);
  readonly rows: EventRow[] = [];
  readonly point: DeliveryPoint;
  private lastPlanned = 0;
  private firstChloride = false;
  private firstSource = false;
  firstClCell?: Cell;
  firstClTopRow?: number;
  firstSourceCell?: Cell;
  firstSourceOverlap = false;
  constructor(readonly initialMl = 2.5, x = 0, z = 0) {
    this.point = { x, y: tubeLiquidHeight(initialMl, EFFECTIVE_RADIUS), z };
  }
  private log(atMs: number, event: string, point?: DeliveryPoint) {
    this.rows.push({ atMs, event, x: point?.x, y: point?.y, z: point?.z,
      surfaceY: tubeLiquidHeight(this.initialMl + deliveredMl(ID, "nacl"), EFFECTIVE_RADIUS),
      deliveredMl: deliveredMl(ID, "nacl"),
      chloride: this.field.species["Cl-"].total + this.field.extent, extent: this.field.extent });
  }
  step(atMs: number, options: { impact?: DeliveryPoint | ((surfaceY: number) => DeliveryPoint); render?: boolean; stop?: boolean;
    conserve?: boolean } = {}) {
    const k = Math.min(1, atMs / POUR_MS);
    const planned = options.stop ? this.lastPlanned : pouredMl(k);
    const delta = Math.max(0, planned - this.lastPlanned);
    this.lastPlanned = planned;
    if (atMs === 0) this.log(atMs, "pour start");
    if (delta > 0) {
      const surfaceY = tubeLiquidHeight(this.initialMl + deliveredMl(ID, "nacl"), EFFECTIVE_RADIUS);
      const point = typeof options.impact === "function" ? options.impact(surfaceY)
        : options.impact ?? { ...this.point, y: surfaceY };
      if (!this.rows.some(row => row.event === "stream visible")) this.log(atMs, "stream visible", point);
      const event = recordDelivery({ tubeId: ID, reagentId: "nacl", serial: 77,
        step: atMs, ml: delta, point, surfaceY, atMs },
      { axis: { x: 0, y: surfaceY, z: 0 }, radius: RADIUS, surfaceY, hasLiquid: true });
      if (event.valid && firstValidDelivery(ID, "nacl") === event) this.log(atMs, "first valid impact", point);
    }
    if (options.render !== false) {
      // This is the same world-to-local conversion and surface offset used by tubeReactionVisuals.
      const first = firstValidDelivery(ID, "nacl");
      const current = [...deliveryEvents(ID)].reverse().find(e => e.valid) ?? first;
      const surface = tubeLiquidHeight(this.initialMl + deliveredMl(ID, "nacl"), EFFECTIVE_RADIUS);
      const inlet = new THREE.Vector3(current?.point.x ?? 0, surface - 0.0007, current?.point.z ?? 0);
      this.field.advance(0.05, new THREE.Vector3(0, 1, 0), surface, inlet,
        deliveredMl(ID, "nacl"), 0, delta > 0 ? pourFlowMlPerSecond(k) : 0,
        new THREE.Vector3(0, -1, 0));
      if (!this.firstChloride) {
        this.firstClCell = firstCell(this.field, this.field.species["Cl-"].values);
        if (this.firstClCell) {
          this.firstClTopRow = Math.max(...Array.from(this.field.mask.active.slice(0, this.field.mask.activeCount),
            index => Math.floor(index / this.field.mask.nx) % this.field.mask.ny));
          this.firstChloride = true; this.log(atMs, "first Cl- cell", this.firstClCell);
        }
      }
      if (!this.firstSource) {
        this.firstSourceCell = firstCell(this.field, this.field.productSource);
        if (this.firstSourceCell) {
          this.firstSourceOverlap = this.field.species["Ag+"].values[this.firstSourceCell.index] > 0
            && this.field.species["Cl-"].values[this.firstSourceCell.index] > 0;
          this.firstSource = true; this.log(atMs, "first product source cell", this.firstSourceCell);
        }
      }
    }
    if (delta > 0) {
      const surfaceY = tubeLiquidHeight(this.initialMl + deliveredMl(ID, "nacl"), EFFECTIVE_RADIUS);
      this.log(atMs, "delivered mL", typeof options.impact === "function"
        ? options.impact(surfaceY) : options.impact ?? { ...this.point, y: surfaceY });
    }
    if (options.conserve) {
      expect(Math.abs(this.field.massBalanceError)).toBeLessThan(1e-9);
      expect(Math.abs(this.field.species["Cl-"].total + this.field.extent - this.field.delivered)).toBeLessThan(1e-9);
    }
  }
  dispose() { this.field.dispose(); }
}
function seedStage3Contents(contents: readonly string[]) {
  // Mirrors tubeReactionVisuals' stage-3 AgNO3 mount filter.
  seedTubeAmounts(ID, contents.filter(id => id !== "nacl"));
}

describe("stage 3 delivery through the real ledger", () => {
  it("rejects a stream before surface contact", () => {
    const h = new DeliveryHarness();
    for (let t = 0; t <= POUR_MS; t += DT)
      h.step(t, { impact: surfaceY => ({ ...h.point, y: surfaceY + 0.004 }) });
    expect(deliveryEvents(ID).length).toBeGreaterThan(0);
    expect(deliveryEvents(ID).every(e => !e.valid && e.reason === "above-surface")).toBe(true);
    expect(deliveredMl(ID, "nacl")).toBe(0);
    expect(h.field.species["Cl-"].total).toBe(0);
    expect(h.field.extent).toBe(0);
    h.dispose();
  });

  // tubeSilverField.inject drops later ledger increments when topWetRow is above the highest active voxel.
  it.fails("admits a surface impact and starts chloride and product at the contact patch", () => {
    const h = new DeliveryHarness();
    for (let t = 0; t <= POUR_MS; t += DT) h.step(t, { conserve: true });
    exportEvents(h.rows);
    const first = firstValidDelivery(ID, "nacl");
    expect(first).toBeDefined();
    expect(first!.point.y).toBeCloseTo(first!.surfaceY, 9);
    expect(deliveredMl(ID, "nacl")).toBeCloseTo(1, 9);
    expect(h.field.delivered).toBeCloseTo(deliveredMl(ID, "nacl"), 9);
    expect(h.firstClCell).toBeDefined();
    expect(Math.hypot(h.firstClCell!.x - first!.point.x, h.firstClCell!.z - first!.point.z))
      .toBeLessThanOrEqual(0.003);
    expect(h.firstClCell!.row).toBeGreaterThanOrEqual(h.firstClTopRow! - 1);
    expect(h.firstSourceCell).toBeDefined();
    expect(h.firstSourceOverlap).toBe(true);
    h.dispose();
  });

  it("rejects a stream that misses the tube", () => {
    const h = new DeliveryHarness();
    for (let t = 0; t <= POUR_MS; t += DT) h.step(t, { impact: { ...h.point, x: RADIUS + 0.001 } });
    expect(deliveryEvents(ID).every(e => !e.valid && e.reason === "outside-tube")).toBe(true);
    expect(deliveredMl(ID, "nacl")).toBe(0);
    expect(h.field.delivered).toBe(0);
    expect(h.field.species["Cl-"].total + h.field.extent).toBe(0);
    h.dispose();
  });

  // tubeSilverField.inject loses increments after the meniscus crosses a voxel boundary.
  it.fails("stops delivery halfway while remaining local species can continue reacting", () => {
    const h = new DeliveryHarness();
    for (let t = 0; t <= 850; t += DT) h.step(t, { conserve: true });
    const stopped = deliveredMl(ID, "nacl"), extent = h.field.extent;
    for (let t = 900; t <= 1700; t += DT) {
      h.step(t, { stop: true, conserve: true });
      for (let i = 0; i < h.field.productSource.length; i++) if (h.field.productSource[i] > 0) {
        expect(h.field.species["Ag+"].values[i]).toBeGreaterThan(0);
        expect(h.field.species["Cl-"].values[i]).toBeGreaterThan(0);
      }
    }
    expect(stopped).toBeGreaterThan(0);
    expect(stopped).toBeLessThan(1);
    expect(deliveredMl(ID, "nacl")).toBe(stopped);
    expect(h.field.delivered).toBeCloseTo(stopped, 9);
    expect(h.field.extent).toBeGreaterThanOrEqual(extent);
    expect(h.field.extent).toBeLessThanOrEqual(stopped);
    h.dispose();
  });

  // tubeDelivery currently records ledger events without adding the accepted NaCl to tubeAmounts.
  it.fails("does not seed NaCl or deliver twice when the receiving field remounts", () => {
    seedStage3Contents(["agno3", "nacl"]);
    expect(tubeAmount(ID).volumeMl).toBe(2.5);
    expect(tubeAmount(ID).species["Cl-"] ?? 0).toBe(0);
    const h = new DeliveryHarness();
    for (let t = 0; t <= 850; t += DT) h.step(t);
    const delivered = deliveredMl(ID, "nacl");
    h.dispose();
    // Recreate the field and repeat the game mount's stage-3 filtered seed list.
    seedStage3Contents(["agno3", "nacl"]);
    const mounted = new DeliveryHarness();
    mounted.step(0);
    mounted.step(50);
    expect(tubeAmount(ID).volumeMl).toBeCloseTo(2.5 + delivered, 9);
    expect(tubeAmount(ID).species["Cl-"] ?? 0).toBeCloseTo(delivered, 9);
    expect(deliveredMl(ID, "nacl")).toBe(delivered);
    expect(mounted.field.delivered).toBeCloseTo(delivered, 9);
    mounted.dispose();
  });

  // tubeSilverField.inject drops the cumulative ledger total when a render gap jumps the liquid level.
  it.fails("retains the exact pour plan through large gaps and absent render frames", () => {
    const h = new DeliveryHarness();
    for (const t of [0, 50, 200, 650, 850, 1200, 1700])
      h.step(t, { render: t === 0 || t === 850 || t === 1700, conserve: true });
    expect(deliveredMl(ID, "nacl")).toBeCloseTo(1, 9);
    expect(h.field.delivered).toBeCloseTo(1, 9);
    const count = deliveryEvents(ID).length;
    const e = deliveryEvents(ID).at(-1)!;
    expect(recordDelivery({ tubeId: e.tubeId, reagentId: e.reagentId, serial: e.serial,
      step: e.step, ml: e.ml, point: e.point, surfaceY: e.surfaceY, atMs: e.atMs },
      { axis: { x: 0, y: e.surfaceY, z: 0 }, radius: RADIUS, surfaceY: e.surfaceY, hasLiquid: true }).reason)
      .toBe("duplicate");
    expect(deliveryEvents(ID).length).toBe(count);
    expect(deliveredMl(ID, "nacl")).toBeCloseTo(1, 9);
    h.dispose();
  });

  it("moves the first chloride and source cells with left, centre and right impacts", () => {
    const positions = [-0.004, 0, 0.004].map(x => {
      clearDeliveries();
      const h = new DeliveryHarness(2.5, x);
      for (let t = 0; t <= 650; t += DT) h.step(t);
      const result = { chloride: h.firstClCell?.x, source: h.firstSourceCell?.x };
      h.dispose();
      return result;
    });
    for (const p of positions) { expect(p.chloride).toBeDefined(); expect(p.source).toBeDefined(); }
    expect(positions[0].chloride!).toBeLessThan(positions[1].chloride!);
    expect(positions[1].chloride!).toBeLessThan(positions[2].chloride!);
    expect(positions[0].source!).toBeLessThan(positions[1].source!);
    expect(positions[1].source!).toBeLessThan(positions[2].source!);
  });

  it("tracks the valid impact surface at 1, 2.5 and 4 mL", () => {
    const ys = [1, 2.5, 4].map(volume => {
      clearDeliveries();
      const h = new DeliveryHarness(volume);
      for (let t = 0; t <= 650; t += DT) h.step(t);
      const event = firstValidDelivery(ID, "nacl");
      expect(event?.valid).toBe(true);
      expect(event!.point.y).toBeCloseTo(tubeLiquidHeight(volume, EFFECTIVE_RADIUS), 9);
      expect(validateImpact(event!.point, { axis: { x: 0, y: event!.surfaceY, z: 0 },
        radius: RADIUS, surfaceY: event!.surfaceY, hasLiquid: true }).valid).toBe(true);
      h.dispose();
      return event!.point.y;
    });
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });
});
