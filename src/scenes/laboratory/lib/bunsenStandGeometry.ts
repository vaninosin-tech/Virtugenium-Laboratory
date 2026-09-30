/** Measurements of the three-part stand — see `bunsenStandAssembly.ts`. Kept free of loaders so stores and node tests can import them. */

/**
 * Boss height on the rod. 0.196 is the notes' "tube vertical, bottom in the
 * spirit lamp's hot zone" height for a tube hanging `TUBE_RING_INSERT_DEPTH`
 * below the clamp.
 */
export const CLAMP_MOUNT_HEIGHT = 0.196;
/** `ClampHandleChannel` in `ClampMount`'s own space: the handle passes beside the rod. */
export const CLAMP_CHANNEL_OFFSET_Z = 0.018;
/** `TubeClamp_TubeAxis` along the clamp's handle. */
export const CLAMP_TUBE_AXIS_X = 0.104;
