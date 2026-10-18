import { tubeVessel } from "./vesselGeometry";

/** @deprecated Use tubeVessel.heightFromVolume. Radius is retained for old callers. */
export function tubeLiquidHeight(volumeMl: number, _radius: number): number {
  return tubeVessel.heightFromVolume(volumeMl);
}

/** @deprecated The authored 2.5 mL calibration is replaced by the measured liquid cavity. */
export function tubeEffectiveRadius(_authoredHeight: number): number {
  return tubeVessel.innerRadius;
}

/** @deprecated Use tubeVessel.heightFromVolume / tubeVessel.cavityHeight. */
export function tubeLiquidFill(volumeMl: number, _radius: number, cavityHeight: number): number {
  return cavityHeight > 0 ? tubeVessel.heightFromVolume(volumeMl) / cavityHeight : 0;
}
