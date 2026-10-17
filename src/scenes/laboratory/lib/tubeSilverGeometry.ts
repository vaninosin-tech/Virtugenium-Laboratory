import { tubeEffectiveRadius, tubeLiquidHeight } from "./tubeLiquidLevel";

/** The cavity dimensions used by tubeReactionVisuals for the authored tube. */
export const SILVER_TUBE_RADIUS = 0.007;
export const SILVER_TUBE_BOTTOM = 0;
export const SILVER_TUBE_HEIGHT = 0.055;
export const silverEffectiveRadius = tubeEffectiveRadius(SILVER_TUBE_HEIGHT);
export const silverFieldHeight = Math.max(SILVER_TUBE_HEIGHT,
  tubeLiquidHeight(5, silverEffectiveRadius) + SILVER_TUBE_RADIUS * 0.25);
