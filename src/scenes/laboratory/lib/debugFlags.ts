/**
 * Flip to `true` locally to see development-only 3D scene overlays
 * (floating cabinet name tags, reserved-slot markers). Must stay `false` in
 * normal gameplay — the crosshair overlay (`Laboratory.tsx`'s
 * `crosshairLabelStyle`) already tells the player what they're aiming at
 * via 2D UI, so these floating in-world labels are a dev aid, not a
 * gameplay requirement.
 */
export const SHOW_SCENE_DEBUG_LABELS = false;

/**
 * Flip to `true` locally to log every `THREE.Light` found in the live scene
 * (name/type/intensity/position, plus distance+decay for point lights or
 * quaternion for the directional sun) once on mount — see
 * `LightingRuntime.tsx`. Must stay `false` in normal gameplay; it's a
 * console-only dev aid for verifying runtime light state matches
 * `lightingConfig.ts`, not something a player needs.
 */
export const LOG_LIVE_LIGHTS = false;

/**
 * Flip to `true` locally to render one instance of all 9 reagents (see
 * `entities/laboratory/reagents`) lined up on the work table via
 * `ReagentContainerPreviewRow` — a dev-only visual check that the glb
 * loads, the clear/amber/wide-mouth mapping is correct, and each reagent's
 * label/contents render distinctly. Must stay `false` in normal gameplay;
 * no gameplay code depends on this row existing.
 */
export const SHOW_REAGENT_CONTAINER_PREVIEW = false;
