import { tubeEffectiveRadius, tubeLiquidHeight } from "./tubeLiquidLevel";

/**
 * Single authoritative description of the receiving test tube interior (wave 14 interface stub).
 *
 * THE CURRENT BODY IS THE LEGACY BEHAVIOUR (volume to height through the authored 2.5 ml calibration radius) so that the
 * code base keeps working while Agent G1 replaces the internals with the geometry measured from the real vessel. The
 * exported names, units and signatures below are the contract with every consumer and must not change:
 * heights and lengths in metres, volumes in millilitres.
 */
export interface VesselGeometry {
  /** Inner radius of the cylindrical bore (m). */
  readonly innerRadius: number;
  /** Interior height available for liquid, measured from the lowest interior point (m). */
  readonly cavityHeight: number;
  /** Largest game volume the vessel accepts (ml). */
  readonly capacityMl: number;
  /** Interior cross-sectional area at height z above the lowest interior point (m2). */
  areaAtHeight(z: number): number;
  /** V(h): liquid volume below height h (ml). */
  volumeFromHeight(h: number): number;
  /** Inverse of volumeFromHeight (m). */
  heightFromVolume(volumeMl: number): number;
  /** Fraction (0 to 1) of an axis-aligned cell [x0,x1] x [y0,y1] x [z0,z1] (vessel-local metres, y up) that lies inside the vessel interior and below the free surface height h. */
  cellLiquidFraction(box: readonly [number, number, number, number, number, number], surfaceHeight: number): number;
}

const LEGACY_RADIUS = 0.007;
const LEGACY_HEIGHT = 0.055;

export const tubeVessel: VesselGeometry = {
  innerRadius: LEGACY_RADIUS,
  cavityHeight: LEGACY_HEIGHT,
  capacityMl: 5,
  areaAtHeight(z) {
    const r = tubeEffectiveRadius(LEGACY_HEIGHT);
    if (z <= 0) return 0;
    return z >= r ? Math.PI * r * r : Math.PI * (2 * r * z - z * z);
  },
  heightFromVolume(volumeMl) { return tubeLiquidHeight(volumeMl, tubeEffectiveRadius(LEGACY_HEIGHT)); },
  volumeFromHeight(h) {
    let lo = 0, hi = 5.0001;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (tubeLiquidHeight(mid, tubeEffectiveRadius(LEGACY_HEIGHT)) < h) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  },
  cellLiquidFraction(box, surfaceHeight) {
    // Legacy stub: a cell counts as liquid when its centre is below the surface and inside the bore.
    const cx = (box[0] + box[1]) / 2, cy = (box[2] + box[3]) / 2, cz = (box[4] + box[5]) / 2;
    return cy <= surfaceHeight && Math.hypot(cx, cz) <= LEGACY_RADIUS ? 1 : 0;
  },
};
