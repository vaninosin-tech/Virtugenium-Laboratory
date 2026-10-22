/** Measurements of the three-part stand — see `bunsenStandAssembly.ts`. Kept free of loaders so stores and node tests can import them. */

/**
 * Boss height on the rod. The clamp holds the tube by its top, 2.5 cm below
 * the mouth (`TUBE_RING_INSERT_DEPTH`), so the tube hanging from it has its
 * bottom 13.5 cm up, a couple of centimetres clear of the spirit lamp's flame
 * tip: on the stand the tube is held, not heated; heating takes the clamp off
 * (`HeldClampRig`). The rod is 30 cm tall.
 */
export const CLAMP_MOUNT_HEIGHT = 0.26;
/** `ClampHandleChannel` in `ClampMount`'s own space: the handle passes beside the rod. */
export const CLAMP_CHANNEL_OFFSET_Z = 0.018;
/** `TubeClamp_TubeAxis` along the clamp's handle. */
export const CLAMP_TUBE_AXIS_X = 0.104;
