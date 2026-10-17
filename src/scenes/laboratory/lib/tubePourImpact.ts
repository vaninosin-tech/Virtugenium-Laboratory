import * as THREE from "three";
import { deliver, STANDARD_POUR_ML, tubeAmount, TUBE_CAPACITY_ML } from "./tubeAmounts";
import { POUR_MS, useStandMotionStore } from "./useStandMotionStore";
import { recordDelivery, type DeliveryEvent, type ImpactContext } from "./tubeDelivery";
import { tubeEffectiveRadius, tubeLiquidHeight } from "./tubeLiquidLevel";
import { silverStage } from "./silverStage";

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
export const tubePourImpact = (id: string) => impacts.get(id);
/** A validated event is the only route from a simulation step to receiving chemistry. */
export function publishDeliveryEvent(input: Omit<DeliveryEvent, "valid" | "reason">,
  context: ImpactContext, direction: THREE.Vector3, flowMlPerSecond: number) {
  const event = recordDelivery(input, context);
  if (!event.valid || event.ml <= 0) return event;
  const accepted = deliver(input.tubeId, input.reagentId, event.ml);
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
  if (reagentId === "nacl" && silverStage() === 3) return 0;
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
}
/** The render-independent 30 ms clock for a stand pour. Clearing a pour stops it immediately. */
export function observePourClock(instanceId: string, onStep: (serial: number, now: number) => void) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let activeAt: number | undefined;
  const sync = () => {
    const pour = useStandMotionStore.getState().pour;
    if (pour?.instanceId === instanceId && activeAt !== pour.at) {
      if (timer) clearInterval(timer);
      activeAt = pour.at;
      timer = setInterval(() => {
        const current = useStandMotionStore.getState().pour;
        if (current?.instanceId === instanceId && current.at === activeAt) onStep(current.at, Date.now());
      }, 30);
    } else if ((!pour || pour.instanceId !== instanceId) && timer) {
      clearInterval(timer); timer = undefined; activeAt = undefined;
    }
  };
  sync();
  const unsubscribe = useStandMotionStore.subscribe((state, previous) => {
    const finished = previous.pour;
    if (finished?.instanceId === instanceId && state.pour?.at !== finished.at
      && Date.now() >= finished.at + POUR_MS)
      onStep(finished.at, finished.at + POUR_MS);
    sync();
  });
  return () => { unsubscribe(); if (timer) clearInterval(timer); };
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
  const effectiveRadius = tubeEffectiveRadius(0.055);
  const surfaceY = new THREE.Vector3(0, tubeLiquidHeight(volume, effectiveRadius), 0)
    .applyMatrix4(input.root).y;
  const point = input.mouth.clone().addScaledVector(input.side, 0.0065);
  point.y = Math.min(input.mouth.y, surfaceY);
  const axis = new THREE.Vector3(0, tubeLiquidHeight(volume, effectiveRadius), 0)
    .applyMatrix4(input.root);
  const context: ImpactContext = { axis, radius: input.radius ?? 0.007,
    surfaceY, hasLiquid: input.mouthValid && volume > 0 };
  const ml = Math.max(0, Math.min(requestedMl, TUBE_CAPACITY_ML - volume));
  return publishDeliveryEvent({ tubeId: input.tubeId, reagentId: input.reagentId,
    serial: input.serial, step: Math.round(atMs), ml, requestedMl, point,
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
export function clearTubePourImpact(tubeId: string) {
  impacts.delete(tubeId);
  for (const key of [...legacySteps.keys()]) if (key.startsWith(`${tubeId}|`)) legacySteps.delete(key);
  for (const key of [...pourProgress.keys()]) if (key.startsWith(`${tubeId}|`)) pourProgress.delete(key);
}
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __tubePourImpact?: typeof tubePourImpact }).__tubePourImpact = tubePourImpact;
