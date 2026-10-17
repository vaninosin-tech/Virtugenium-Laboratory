/**
 * Authoritative liquid-delivery ledger.
 *
 * Contract (experiment 2 stage 3, and the model for the other pours):
 *  - Every chemical change in a receiving tube follows a validated DeliveryEvent recorded here.
 *  - A DeliveryEvent is created by the pour simulation (never by a React mount, a render callback alone, a timer on the
 *    receiving side, or a contents list). Re-recording the same (serial, step) is idempotent: no duplicate delivery.
 *  - An impact is valid only if the stream really meets the free surface of the receiving liquid inside the tube mouth.
 *    A miss is recorded (valid = false) but adds nothing to the receiving tube.
 *  - The receiving volume, the reagent amount and the fluid solver inlet all read this ledger.
 */
export interface DeliveryPoint { x: number; y: number; z: number }

export interface DeliveryEvent {
  tubeId: string;
  reagentId: string;
  /** The pour action this event belongs to (`startPour` timestamp). */
  serial: number;
  /** Monotonic step inside the pour; (serial, step) identifies an event. */
  step: number;
  /** Millilitres delivered by this event (already limited by the source container). */
  ml: number;
  /** Volume consumed from the source, including a miss or capacity overflow. */
  requestedMl?: number;
  point: DeliveryPoint;
  /** Height of the receiving free surface at the moment of impact (world metres). */
  surfaceY: number;
  /** Milliseconds since the pour started, for the event log. */
  atMs: number;
  valid: boolean;
  reason: "ok" | "above-surface" | "outside-tube" | "no-liquid" | "duplicate" | "invalid-volume";
}

export interface ImpactContext {
  /** Receiving tube axis at the surface (world) and its inner radius. */
  axis: DeliveryPoint;
  radius: number;
  surfaceY: number;
  /** Whether the receiving tube holds liquid at all. */
  hasLiquid: boolean;
}

const SURFACE_TOLERANCE = 0.0035;

/** Pure test of an impact against the receiving liquid. */
export function validateImpact(point: DeliveryPoint, context: ImpactContext): { valid: boolean; reason: DeliveryEvent["reason"] } {
  if (!context.hasLiquid) return { valid: false, reason: "no-liquid" };
  const lateral = Math.hypot(point.x - context.axis.x, point.z - context.axis.z);
  if (lateral > context.radius * 0.98) return { valid: false, reason: "outside-tube" };
  if (point.y > context.surfaceY + SURFACE_TOLERANCE) return { valid: false, reason: "above-surface" };
  return { valid: true, reason: "ok" };
}

const ledger = new Map<string, DeliveryEvent[]>();
const seen = new Map<string, string>();
const key = (e: Pick<DeliveryEvent, "serial" | "step">) => `${e.serial}|${e.step}`;

/**
 * Records one delivery step. Returns the stored event (valid or not). A repeated (serial, step) is rejected as a
 * duplicate and returns `valid: false, reason: "duplicate"` without touching the ledger.
 */
export function recordDelivery(input: Omit<DeliveryEvent, "valid" | "reason">, context: ImpactContext): DeliveryEvent {
  if (!Number.isFinite(input.ml) || input.ml < 0) {
    return { ...input, ml: 0, valid: false, reason: "invalid-volume" };
  }
  if (seen.has(key(input))) return { ...input, ml: 0, valid: false, reason: "duplicate" };
  seen.set(key(input), input.tubeId);
  const verdict = validateImpact(input.point, context);
  const event: DeliveryEvent = { ...input, requestedMl: input.requestedMl ?? input.ml,
    ml: verdict.valid ? input.ml : 0, valid: verdict.valid, reason: verdict.reason };
  // A miss keeps its volume out of the receiving tube; the requested volume stays in the log for the source accounting.
  const list = ledger.get(input.tubeId) ?? [];
  list.push(verdict.valid ? event : { ...event });
  ledger.set(input.tubeId, list);
  return event;
}

export function deliveryEvents(tubeId: string): readonly DeliveryEvent[] { return ledger.get(tubeId) ?? []; }

/** Millilitres that really entered the receiving tube (valid events only), optionally for one reagent/serial. */
export function deliveredMl(tubeId: string, reagentId?: string, serial?: number): number {
  let sum = 0;
  for (const e of ledger.get(tubeId) ?? []) {
    if (!e.valid) continue;
    if (reagentId !== undefined && e.reagentId !== reagentId) continue;
    if (serial !== undefined && e.serial !== serial) continue;
    sum += e.ml;
  }
  return sum;
}

/** First valid event of a tube, for the diagnostics (where the reagent first entered). */
export function firstValidDelivery(tubeId: string, reagentId?: string): DeliveryEvent | undefined {
  return (ledger.get(tubeId) ?? []).find(e => e.valid && (reagentId === undefined || e.reagentId === reagentId));
}

export function clearDeliveries(tubeId?: string) {
  if (tubeId === undefined) { ledger.clear(); seen.clear(); return; }
  ledger.delete(tubeId);
  for (const [k, id] of seen) if (id === tubeId) seen.delete(k);
}
