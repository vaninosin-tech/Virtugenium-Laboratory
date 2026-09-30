/** Measurements of the three-part stand — see `bunsenStandAssembly.ts`. Kept free of loaders so stores and node tests can import them. */

/**
 * Boss height on the rod. The tube hanging from it has its bottom 13.5 cm up,
 * a couple of centimetres clear of the spirit lamp's flame tip: on the stand
 * the tube is held, not heated; heating takes the clamp off (`HeldClampRig`).
 */
export const CLAMP_MOUNT_HEIGHT = 0.235;
/** `ClampHandleChannel` in `ClampMount`'s own space: the handle passes beside the rod. */
export const CLAMP_CHANNEL_OFFSET_Z = 0.018;
/** `TubeClamp_TubeAxis` along the clamp's handle. */
export const CLAMP_TUBE_AXIS_X = 0.104;
