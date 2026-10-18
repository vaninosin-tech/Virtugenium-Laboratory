import { tubeVessel } from "./vesselGeometry";

/** @deprecated Compatibility aliases for code migrating to tubeVessel. */
export const SILVER_TUBE_RADIUS = tubeVessel.innerRadius;
export const SILVER_TUBE_BOTTOM = 0;
export const SILVER_TUBE_HEIGHT = tubeVessel.cavityHeight;
export const silverEffectiveRadius = tubeVessel.innerRadius;
export const silverFieldHeight = tubeVessel.heightFromVolume(tubeVessel.capacityMl);
