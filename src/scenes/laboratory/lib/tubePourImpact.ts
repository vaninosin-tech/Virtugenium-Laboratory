import * as THREE from "three";
import { deliver, STANDARD_POUR_ML, tubeAmount, TUBE_CAPACITY_ML } from "./tubeAmounts";
import { onSimulationTick, POUR_MS, useStandMotionStore } from "./useStandMotionStore";
import { recordDelivery, validateImpact, type DeliveryEvent, type ImpactContext } from "./tubeDelivery";
import { tubeVessel } from "./vesselGeometry";
import { silverStage } from "./silverStage";
import { silverRuntime } from "./tubeSilverRuntime";
import { useReagentStorageStore } from "./useReagentStorageStore";
import { useTestTubeStorageStore } from "./useTestTubeStorageStore";
import { tryAddToTube } from "./pourIntoTube";

export interface TubePourImpact {
  reagentId: string;
  point: THREE.Vector3;
  direction: THREE.Vector3;
  flowMlPerSecond: number;
  deliveredMl: number;
  serial: number;
}
const impacts = new Map<string, TubePourImpact>();
const legacySteps = new Map<string, number>();
const pourProgress = new Map<string, number>();
type OutletSample = { serial: number; atMs: number; point: THREE.Vector3; velocity?: THREE.Vector3 };
const outletSamples = new Map<string, OutletSample>();
/** The actual rendered lip pose, sampled in the same stand-clock frame as PourStream. */
export function samplePourOutlet(sourceId: string, serial: number, now: number, lip: THREE.Vector3) {
  const key = sourceId;
  const atMs = now - serial;
  const sampled = outletSamples.get(key);
  const previous = sampled?.serial === serial ? sampled : undefined;
  const velocity = previous && atMs > previous.atMs
    ? lip.clone().sub(previous.point).multiplyScalar(1000 / (atMs - previous.atMs))
    : previous?.velocity?.clone();
  outletSamples.set(key, { serial, atMs, point: lip.clone(), velocity });
}
export const tubePourImpact = (id: string) => impacts.get(id);
/** A validated event is the only route from a simulation step to receiving chemistry. */
export function publishDeliveryEvent(input: Omit<DeliveryEvent, "valid" | "reason">,
  context: ImpactContext, direction: THREE.Vector3, flowMlPerSecond: number) {
  const source = input.sourceId ?? useStandMotionStore.getState().pour?.instanceId;
  const requested = input.requestedMl ?? input.ml;
  const debited = source ? useReagentStorageStore.getState().debitSource(source, input.reagentId,
    `${input.serial}|${input.step}`, requested) : requested;
  const limited = { ...input, requestedMl: debited, ml: Math.min(input.ml, debited) };
  if (debited <= 0) return { ...limited, valid: false, reason: "invalid-volume" as const };
  const stage3 = input.reagentId === "nacl" && silverStage() === 3 && silverRuntime.acceptsChloride(input.tubeId);
  if (stage3 && validateImpact(limited.point, context).valid && limited.ml > 0
    && !silverRuntime.canApply({ ...limited, valid: true, reason: "ok" }))
    return { ...limited, valid: false, reason: "invalid-volume" as const };
  const event = recordDelivery(limited, context);
  if (!event.valid || event.ml <= 0) return event;
  let accepted = event.ml;
  if (stage3) {
    if (!silverRuntime.applyDelivery(event)) return { ...event, valid: false, reason: "invalid-volume" as const };
  } else {
    accepted = deliver(input.tubeId, input.reagentId, event.ml);
    const state = useTestTubeStorageStore.getState();
    for (const location of ["workbench", "fumeHood"] as const) {
      const list = location === "workbench" ? state.workbenchTestTubes : state.fumeHoodTestTubes;
      const index = list.findIndex(tube => tube.instanceId === input.tubeId);
      if (index >= 0) { tryAddToTube(location, index, input.reagentId); break; }
    }
  }
  const previous = impacts.get(input.tubeId);
  impacts.set(input.tubeId, { reagentId: input.reagentId,
    point: new THREE.Vector3(input.point.x, input.point.y, input.point.z), direction: direction.clone(),
    flowMlPerSecond, deliveredMl: (previous?.serial === input.serial ? previous.deliveredMl : 0) + accepted,
    serial: input.serial });
  return event;
}
export function publishTubePourImpact(tubeId: string, reagentId: string,
  point: THREE.Vector3, direction: THREE.Vector3, flowMlPerSecond: number,
  ml: number, serial: number) {
  // The permissive legacy channel cannot create stage-three chloride.
  if (reagentId === "nacl" && silverStage() === 3 && silverRuntime.acceptsChloride(tubeId)) return 0;
  const key = `${tubeId}|${reagentId}|${serial}`;
  const step = (legacySteps.get(key) ?? 0) + 1;
  legacySteps.set(key, step);
  const event = publishDeliveryEvent({ tubeId, reagentId, serial, step,
    ml: Math.max(0, Math.min(ml, TUBE_CAPACITY_ML - tubeAmount(tubeId).volumeMl)),
    requestedMl: ml, point, surfaceY: point.y, atMs: 0 },
  { axis: point, radius: Infinity, surfaceY: point.y, hasLiquid: true }, direction, flowMlPerSecond);
  return event.valid ? event.ml : 0;
}
export interface TubePourStep {
  tubeId: string; reagentId: string; serial: number; now: number;
  mouth: THREE.Vector3; root: THREE.Matrix4; side: THREE.Vector3;
  mouthValid: boolean; radius?: number;
  allowEmpty?: boolean;
}
/** The render-independent 30 ms clock for a stand pour. Clearing a pour stops it immediately. */
export function observePourClock(instanceId: string, onStep: (serial: number, now: number) => void) {
  return onSimulationTick(now => {
    const pour = useStandMotionStore.getState().pour;
    if (pour?.instanceId === instanceId) onStep(pour.at, Math.min(now, pour.at + POUR_MS));
  });
}
/** Advance from the stand's Date.now timebase. Repeated timestamps and subscribers are idempotent. */
export function stepTubePour(input: TubePourStep): DeliveryEvent | undefined {
  const key = `${input.tubeId}|${input.reagentId}|${input.serial}`;
  const atMs = Math.max(0, Math.min(POUR_MS, input.now - input.serial));
  const total = pouredMl(atMs / POUR_MS);
  const previous = pourProgress.get(key) ?? 0;
  if (total <= previous) return undefined;
  pourProgress.set(key, total);
  const requestedMl = total - previous;
  const volume = tubeAmount(input.tubeId).volumeMl;
  const surfaceY = new THREE.Vector3(0, tubeVessel.heightFromVolume(volume), 0)
    .applyMatrix4(input.root).y;
  const point = input.mouth.clone().addScaledVector(input.side, 0.0065);
  point.y = Math.min(input.mouth.y, surfaceY);
  const axis = new THREE.Vector3(0, tubeVessel.heightFromVolume(volume), 0)
    .applyMatrix4(input.root);
  const context: ImpactContext = { axis, radius: input.radius ?? tubeVessel.innerRadius,
    surfaceY, hasLiquid: input.mouthValid && (volume > 0 || input.allowEmpty === true) };
  const ml = Math.max(0, Math.min(requestedMl, TUBE_CAPACITY_ML - volume));
  const sourceId = useStandMotionStore.getState().pour?.instanceId;
  const sampled = sourceId ? outletSamples.get(sourceId) : undefined;
  const outlet = sampled?.serial === input.serial && Math.abs(sampled.atMs - atMs) <= 50
    ? sampled : undefined;
  return publishDeliveryEvent({ tubeId: input.tubeId, reagentId: input.reagentId,
    sourceId, serial: input.serial, step: Math.round(atMs), ml, requestedMl, point,
    sourceOutlet: outlet?.point, sourceOutletVelocity: outlet?.velocity,
    sourceMouth: { x: input.mouth.x, y: input.mouth.y, z: input.mouth.z },
    surfaceY, atMs }, context, new THREE.Vector3().subVectors(point, input.mouth).normalize(),
  pourFlowMlPerSecond(atMs / POUR_MS));
}
/** Fixed click portion, integrated from the existing stream's thickness envelope. */
export function pourFraction(k: number) {
  const rise = THREE.MathUtils.smoothstep(k, 0.35, 0.44);
  const fade = 1 - THREE.MathUtils.smoothstep(k, 0.69, 0.76);
  return Math.min(rise, fade);
}
const integral = (() => {
  const values = new Float64Array(1025);
  for (let i = 1; i < values.length; i++) values[i] = values[i - 1]
    + (pourFraction((i - 0.5) / 1024) ** 2) / 1024;
  return values;
})();
export function pouredMl(k: number) {
  if (k <= 0.35) return 0;
  if (k >= 0.76) return STANDARD_POUR_ML;
  const x = THREE.MathUtils.clamp(k, 0, 1) * 1024;
  const i = Math.min(1023, Math.floor(x));
  return STANDARD_POUR_ML * THREE.MathUtils.lerp(integral[i], integral[i + 1], x - i) / integral[1024];
}
/** Instantaneous rate corresponding to pouredMl, in actual millilitres per second. */
export function pourFlowMlPerSecond(k: number) {
  return STANDARD_POUR_ML * pourFraction(k) ** 2 / (integral[1024] * (POUR_MS / 1000));
}
/** Ring zero of the drawn mesh is the outlet; ring twelve is downstream. */
export function pourOutletRadius(k: number): number {
  return 0.00115 * (0.42 + 0.58 * pourFraction(k));
}
export interface PourJetState {
  q: number; lipArea: number; lipSpeed: number; impactSpeed: number;
  impactArea: number; impactRadius: number; force: number;
  /** World m/s. Horizontal outlet motion is added separately to the relative jet velocity. */
  impactVelocity: THREE.Vector3;
}
/** Instantaneous, unbinned flow; `q` may instead be supplied from an exact ledger interval. */
export function pourJetState(atMs: number, outlet: THREE.Vector3, impact: THREE.Vector3,
  outletVelocity = new THREE.Vector3(), q = pourFlowMlPerSecond(atMs / POUR_MS) * 1e-6): PourJetState {
  const lipArea = Math.PI * pourOutletRadius(atMs / POUR_MS) ** 2;
  const lipSpeed = q / lipArea;
  const fall = Math.max(0, outlet.y - impact.y);
  const relativeImpactSpeed = Math.sqrt(lipSpeed ** 2 + 2 * 9.81 * fall);
  const impactVelocity = new THREE.Vector3(outletVelocity.x, outletVelocity.y - relativeImpactSpeed,
    outletVelocity.z);
  const impactSpeed = relativeImpactSpeed;
  const impactArea = impactSpeed > 0 ? q / impactSpeed : 0;
  return { q, lipArea, lipSpeed, impactSpeed, impactArea,
    impactRadius: Math.sqrt(impactArea / Math.PI), force: 1000 * q * impactSpeed, impactVelocity };
}
/** Reconstruct jet physics from a valid ledger increment with a measured lip.
 * The supplied interval must be the interval that produced event.ml; it is
 * intentionally not inferred from the display or fluid-step clock.
 */
export function eventJetState(event: DeliveryEvent, intervalMs: number): PourJetState | undefined {
  if (!event.valid || !event.sourceOutlet || !(intervalMs > 0)) return undefined;
  const lip = new THREE.Vector3(event.sourceOutlet.x, event.sourceOutlet.y, event.sourceOutlet.z);
  const hit = new THREE.Vector3(event.point.x, event.point.y, event.point.z);
  const v = event.sourceOutletVelocity;
  return pourJetState(event.atMs, lip, hit,
    v ? new THREE.Vector3(v.x, v.y, v.z) : undefined, event.ml * 1e-6 / (intervalMs / 1000));
}
/** Exact cumulative differences in fixed bins: sum(q * binSeconds) equals the portion. */
export function pourFlowBins(binMs: number): { atMs: number; ml: number; q: number }[] {
  if (!(Number.isFinite(binMs) && binMs > 0)) throw new RangeError("binMs must be positive");
  const bins: { atMs: number; ml: number; q: number }[] = [];
  for (let end = binMs; end < POUR_MS + binMs; end += binMs) {
    const start = end - binMs;
    const ml = pouredMl(Math.min(end, POUR_MS) / POUR_MS) - pouredMl(start / POUR_MS);
    bins.push({ atMs: Math.min(end, POUR_MS), ml, q: ml * 1e-6 / (binMs / 1000) });
  }
  return bins;
}
export function clearTubePourImpact(tubeId: string) {
  impacts.delete(tubeId);
  for (const key of [...legacySteps.keys()]) if (key.startsWith(`${tubeId}|`)) legacySteps.delete(key);
  for (const key of [...pourProgress.keys()]) if (key.startsWith(`${tubeId}|`)) pourProgress.delete(key);
}
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __tubePourImpact?: typeof tubePourImpact }).__tubePourImpact = tubePourImpact;
