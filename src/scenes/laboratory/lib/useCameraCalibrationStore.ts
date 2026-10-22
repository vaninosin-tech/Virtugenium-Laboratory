import { create } from "zustand";

import {
  CABINETS,
  CAMERA_TARGETS,
  computeFumeHoodStagingTarget,
  EQUIPMENT,
  INSPECTION_TARGETS,
  type CameraTarget,
  type InspectionTarget,
  type SceneTargetId,
} from "./layout";

/**
 * Dev-only camera calibration layer (F8 panel). Lets a developer nudge the
 * existing focus-camera poses (`INSPECTION_TARGETS`, `CAMERA_TARGETS.table`)
 * at runtime and persist the result locally, without a second camera
 * architecture: `CameraRig` reads `getEffectivePose`/`getEffectiveCameraTarget`
 * instead of the raw `layout.ts` constants, falling back to them when no
 * override has been saved.
 *
 * `"fume-hood-staging"` is the one preset with no matching hotspot — it's
 * the fume hood's own intermediate "camera holds here while the panel
 * powers on and the sash rises" pose (see `CameraRig`'s staged fume-hood
 * approach), calibratable exactly like every real hotspot's pose even
 * though nothing ever navigates to it directly.
 */
export type CalibrationPresetId = Exclude<SceneTargetId, "overview"> | "fume-hood-staging";

export type EditMode = "position" | "target";
export type MoveDirection = "up" | "down" | "left" | "right" | "forward" | "back";

export interface CalibrationPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

const STORAGE_KEY = "virtugenium.cameraCalibration.v1";
const BACKUP_STORAGE_KEY = "virtugenium.cameraCalibration.backup.v1";
const DEFAULT_ROOM_FOV = 55;
export const MIN_FOV = 25;
export const MAX_FOV = 90;

const CABINET_LABELS: Record<string, string> = Object.fromEntries(
  CABINETS.map((cabinet) => [cabinet.id, cabinet.label]),
);

/**
 * All six cabinets (acids/bases/oxides/salts/simple substances/glassware).
 * The player must approach every one of these identically, so `save`/`reset`
 * on any single one of them propagate to all six (see below) instead of
 * editing it alone.
 */
export const SHARED_CABINET_IDS: readonly CalibrationPresetId[] = CABINETS.map(
  (cabinet) => cabinet.id as CalibrationPresetId,
);

/** Horizontal forward/right unit vectors from a pose's own view direction — same convention as `move()`. */
function localFrame(pose: CalibrationPose): { forward: [number, number, number]; right: [number, number, number] } {
  const [px, , pz] = pose.position;
  const [tx, , tz] = pose.target;
  let fx = tx - px;
  let fz = tz - pz;
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) {
    fx = 0;
    fz = -1;
  } else {
    fx /= len;
    fz /= len;
  }
  return { forward: [fx, 0, fz], right: [-fz, 0, fx] };
}

interface LocalDelta {
  forward: number;
  right: number;
  up: number;
}

function projectDelta(
  edited: [number, number, number],
  base: [number, number, number],
  frame: { forward: [number, number, number]; right: [number, number, number] },
): LocalDelta {
  const dx = edited[0] - base[0];
  const dy = edited[1] - base[1];
  const dz = edited[2] - base[2];
  return {
    forward: dx * frame.forward[0] + dz * frame.forward[2],
    right: dx * frame.right[0] + dz * frame.right[2],
    up: dy,
  };
}

function applyDelta(
  base: [number, number, number],
  frame: { forward: [number, number, number]; right: [number, number, number] },
  delta: LocalDelta,
): [number, number, number] {
  return [
    base[0] + frame.forward[0] * delta.forward + frame.right[0] * delta.right,
    base[1] + delta.up,
    base[2] + frame.forward[2] * delta.forward + frame.right[2] * delta.right,
  ];
}

export const CALIBRATION_PRESETS: readonly { id: CalibrationPresetId; label: string }[] = [
  { id: "table", label: "Верстак / Workbench" },
  ...CABINETS.map((cabinet) => ({ id: cabinet.id as CalibrationPresetId, label: `Шкаф — ${CABINET_LABELS[cabinet.id]}` })),
  ...EQUIPMENT.map((equipment) => ({ id: equipment.id as CalibrationPresetId, label: equipment.label })),
  { id: "fume-hood-staging", label: "Вытяжной шкаф — пром. точка" },
];

function directionVector(target: CameraTarget): [number, number, number] {
  return [
    Math.sin(target.yaw) * Math.cos(target.pitch),
    Math.sin(target.pitch),
    -Math.cos(target.yaw) * Math.cos(target.pitch),
  ];
}

/**
 * Approved F8 poses (`F8_camera_objects_positions.md`, saved 2026-10-02) baked
 * in as the defaults, so every fresh browser / the Tauri build opens with them
 * without a localStorage save. A preset missing here falls back to `layoutDefault`.
 */
const APPROVED_POSES: Partial<Record<CalibrationPresetId, CalibrationPose>> = {
  "table": { position: [0, 1.45, -2.000739], target: [0, 0.37618, 1.381552], fov: 55 },
  "cabinet-acids": { position: [1.374342, 1.43575, 0.7], target: [3.104, 1.43575, 0.7], fov: 38 },
  "cabinet-salts": { position: [1.374342, 1.43575, -0.7], target: [3.104, 1.43575, -0.7], fov: 38 },
  "cabinet-bases": { position: [1.374342, 1.43575, -2.1], target: [3.104, 1.43575, -2.1], fov: 38 },
  "ppe-cabinet": { position: [-2.191081, 1.3, -0.85], target: [-4.545, 1.3, -0.85], fov: 45 },
  "cabinet-simple": { position: [0.3, 1.43575, 0.074342], target: [0.3, 1.43575, 1.804], fov: 38 },
  "cabinet-oxides": { position: [1.374342, 1.43575, 2.1], target: [3.104, 1.43575, 2.1], fov: 38 },
  "cabinet-glassware": { position: [-1.1, 1.43575, 0.074342], target: [-1.1, 1.43575, 1.804], fov: 38 },
  "fume-hood": { position: [-3.320689, 1.65, 0.5], target: [-6.12, -0.7, 0.5], fov: 45 },
  "fume-hood-staging": { position: [-1.970689, 1.45, 0.5], target: [-5.22, 1.45, 0.5], fov: 45 },
  "cabinet-lab-equipment": { position: [-2.5, 1.43575, 0.074342], target: [-2.5, 1.43575, 1.804], fov: 38 },
};

/** Default pose for a preset: the approved F8 pose if there is one, otherwise derived from `layout.ts`. */
function sourceDefault(id: CalibrationPresetId): CalibrationPose {
  const approved = APPROVED_POSES[id];
  return approved ? clonePose(approved) : layoutDefault(id);
}

/** Pose derived from the real gameplay config in `layout.ts` — never fabricated. */
function layoutDefault(id: CalibrationPresetId): CalibrationPose {
  if (id === "table") {
    const t = CAMERA_TARGETS.table;
    const [dx, dy, dz] = directionVector(t);
    return {
      position: [...t.position],
      target: [t.position[0] + dx * 3, t.position[1] + dy * 3, t.position[2] + dz * 3],
      fov: DEFAULT_ROOM_FOV,
    };
  }
  if (id === "fume-hood-staging") {
    // Derived from the fume hood's own final inspection target — see
    // `computeFumeHoodStagingTarget`'s own doc for the "pulled back along
    // the same view axis" default this replicates.
    const insp = computeFumeHoodStagingTarget(INSPECTION_TARGETS["fume-hood"]);
    return { position: [...insp.position], target: [...insp.lookAt], fov: insp.fov };
  }
  // fume-hood/ppe-cabinet now have real EQUIPMENT anchors and real
  // INSPECTION_TARGETS entries (see layout.ts's computeEquipmentInspectionTarget),
  // so they fall through to the same real-config path every reagent cabinet uses —
  // no more seeded placeholder values.
  const insp: InspectionTarget = INSPECTION_TARGETS[id];
  return { position: [...insp.position], target: [...insp.lookAt], fov: insp.fov };
}

function readCommitted(key: string): Partial<Record<CalibrationPresetId, CalibrationPose>> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const validIds = new Set(CALIBRATION_PRESETS.map(({ id }) => id));
    const committed: Partial<Record<CalibrationPresetId, CalibrationPose>> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!validIds.has(id as CalibrationPresetId) || !isCalibrationPose(value)) continue;
      committed[id as CalibrationPresetId] = clonePose(value);
    }
    return committed;
  } catch {
    return null;
  }
}

function loadCommitted(): Partial<Record<CalibrationPresetId, CalibrationPose>> {
  const primary = readCommitted(STORAGE_KEY);
  const backup = readCommitted(BACKUP_STORAGE_KEY);

  if (!primary && !backup) return {};

  // Merge from the backup first: a valid but accidentally emptied/partially
  // deleted primary record must not erase the last known-good camera poses.
  const recovered = { ...(backup ?? {}), ...(primary ?? {}) };
  persistCommitted(recovered);
  return recovered;
}

function persistCommitted(committed: Partial<Record<CalibrationPresetId, CalibrationPose>>) {
  const serialized = JSON.stringify(committed);
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, serialized);
  } catch {
    // Best-effort — calibration still works in-memory for this session.
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // The backup write may still have succeeded even if the primary one did not.
  }
}

function clonePose(pose: CalibrationPose): CalibrationPose {
  return { position: [...pose.position], target: [...pose.target], fov: pose.fov };
}

function isCalibrationPose(value: unknown): value is CalibrationPose {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CalibrationPose>;
  return isFiniteVector3(candidate.position) && isFiniteVector3(candidate.target) && Number.isFinite(candidate.fov);
}

function isFiniteVector3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((component) => Number.isFinite(component));
}

interface CalibrationState {
  readonly isOpen: boolean;
  readonly presetId: CalibrationPresetId;
  readonly mode: EditMode;
  readonly step: number;
  /** Live-edited pose per preset, shown in the panel and previewed in-scene while `isOpen`. */
  readonly drafts: Record<CalibrationPresetId, CalibrationPose>;
  /** Saved overrides — only presets the dev has pressed SAVE PRESET on; persisted to localStorage. */
  readonly committed: Partial<Record<CalibrationPresetId, CalibrationPose>>;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setPreset: (id: CalibrationPresetId) => void;
  setMode: (mode: EditMode) => void;
  setStep: (step: number) => void;
  move: (direction: MoveDirection) => void;
  tiltHead: (direction: "up" | "down") => void;
  setFov: (fov: number) => void;
  save: () => void;
  reset: () => void;
}

const initialDrafts = Object.fromEntries(
  CALIBRATION_PRESETS.map(({ id }) => [id, sourceDefault(id)]),
) as Record<CalibrationPresetId, CalibrationPose>;

const initialCommitted = loadCommitted();
for (const [id, pose] of Object.entries(initialCommitted)) {
  if (pose) initialDrafts[id as CalibrationPresetId] = clonePose(pose);
}

export const useCameraCalibrationStore = create<CalibrationState>((set) => ({
  isOpen: false,
  presetId: "table",
  mode: "position",
  step: 0.05,
  drafts: initialDrafts,
  committed: initialCommitted,

  setOpen: (isOpen) => set({ isOpen }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setPreset: (presetId) => set({ presetId }),
  setMode: (mode) => set({ mode }),
  // No clamp here — the field must show exactly what the user typed, even
  // transiently below the nominal minimum; `move()` is the only consumer,
  // and a non-positive step there is harmless (it just stops nudging).
  setStep: (step) => set({ step }),

  move: (direction) =>
    set((state) => {
      const pose = clonePose(state.drafts[state.presetId]);
      const [px, py, pz] = pose.position;
      const [tx, ty, tz] = pose.target;
      let fx = tx - px;
      let fz = tz - pz;
      const flen = Math.hypot(fx, fz);
      if (flen < 1e-6) {
        fx = 0;
        fz = -1;
      } else {
        fx /= flen;
        fz /= flen;
      }
      const rx = -fz;
      const rz = fx;
      const step = state.step;

      let dx = 0;
      let dy = 0;
      let dz = 0;
      switch (direction) {
        case "up":
          dy = step;
          break;
        case "down":
          dy = -step;
          break;
        case "left":
          dx = -rx * step;
          dz = -rz * step;
          break;
        case "right":
          dx = rx * step;
          dz = rz * step;
          break;
        case "forward":
          dx = fx * step;
          dz = fz * step;
          break;
        case "back":
          dx = -fx * step;
          dz = -fz * step;
          break;
      }

      if (state.mode === "position") {
        // Rigid translation: move the look-at point by the same delta so the
        // viewing angle stays fixed — otherwise UP/DOWN/LEFT/RIGHT would pivot
        // around the (unmoved) target instead of just relocating the camera,
        // which reads as an unwanted rotation.
        pose.position = [px + dx, py + dy, pz + dz];
        pose.target = [tx + dx, ty + dy, tz + dz];
      } else {
        pose.target = [tx + dx, ty + dy, tz + dz];
      }

      return { drafts: { ...state.drafts, [state.presetId]: pose } };
    }),

  // Pitch-only tilt: always edits the target's vertical (Y, the project's
  // real up axis) component regardless of the panel's position/target edit
  // mode — position and the target's X/Z (so left/right facing) are
  // untouched, so this can never be confused with `move()`'s own "up"/"down"
  // in "position" mode, which translates the whole camera instead.
  tiltHead: (direction) =>
    set((state) => {
      const pose = clonePose(state.drafts[state.presetId]);
      const dy = (direction === "up" ? 1 : -1) * state.step;
      pose.target = [pose.target[0], pose.target[1] + dy, pose.target[2]];
      return { drafts: { ...state.drafts, [state.presetId]: pose } };
    }),

  // No clamp here either — `CameraRig` clamps to [MIN_FOV, MAX_FOV] only at
  // the point it actually applies `fov` to the three.js camera, so the field
  // itself always reflects exactly what the user typed instead of snapping
  // back mid-edit.
  setFov: (fov) =>
    set((state) => {
      const pose = clonePose(state.drafts[state.presetId]);
      pose.fov = fov;
      return { drafts: { ...state.drafts, [state.presetId]: pose } };
    }),

  save: () =>
    set((state) => {
      const presetId = state.presetId;
      const pose = clonePose(state.drafts[presetId]);
      const committed = { ...state.committed, [presetId]: pose };
      const drafts = { ...state.drafts, [presetId]: pose };

      if (SHARED_CABINET_IDS.includes(presetId)) {
        // Same relative approach for every reagent cabinet: express the edit as a
        // delta in *this* cabinet's own local frame, then re-apply that delta in
        // each other cabinet's own local frame (their world positions/facings differ).
        const base = sourceDefault(presetId);
        const frame = localFrame(base);
        const posDelta = projectDelta(pose.position, base.position, frame);
        const targetDelta = projectDelta(pose.target, base.target, frame);
        const fovDelta = pose.fov - base.fov;

        for (const id of SHARED_CABINET_IDS) {
          if (id === presetId) continue;
          const base_i = sourceDefault(id);
          const frame_i = localFrame(base_i);
          const pose_i: CalibrationPose = {
            position: applyDelta(base_i.position, frame_i, posDelta),
            target: applyDelta(base_i.target, frame_i, targetDelta),
            fov: base_i.fov + fovDelta,
          };
          committed[id] = pose_i;
          drafts[id] = pose_i;
        }
      }

      persistCommitted(committed);
      return { committed, drafts };
    }),

  reset: () =>
    set((state) => {
      const ids = SHARED_CABINET_IDS.includes(state.presetId) ? SHARED_CABINET_IDS : [state.presetId];
      const committed = { ...state.committed };
      const drafts = { ...state.drafts };
      for (const id of ids) {
        delete committed[id];
        drafts[id] = sourceDefault(id);
      }
      persistCommitted(committed);
      return { committed, drafts };
    }),
}));

/** Effective (saved-override-or-default) pose for a preset — for imperative reads outside React (CameraRig). */
export function getEffectivePose(id: CalibrationPresetId): CalibrationPose {
  const committed = useCameraCalibrationStore.getState().committed[id];
  return committed ? clonePose(committed) : sourceDefault(id);
}

/** Effective inspection target (position/lookAt/fov) for a cabinet or equipment piece — drop-in replacement for `INSPECTION_TARGETS[id]`. */
export function getEffectiveInspectionTarget(id: Exclude<CalibrationPresetId, "table">): InspectionTarget {
  const pose = getEffectivePose(id);
  return { position: pose.position, lookAt: pose.target, fov: pose.fov };
}

/** Effective table camera target (position + derived yaw/pitch) — drop-in replacement for `CAMERA_TARGETS.table`. */
export function getEffectiveTableTarget(): CameraTarget {
  const committed = useCameraCalibrationStore.getState().committed.table;
  if (!committed) return CAMERA_TARGETS.table;
  const [px, py, pz] = committed.position;
  const [tx, ty, tz] = committed.target;
  const dx = tx - px;
  const dy = ty - py;
  const dz = tz - pz;
  const yaw = Math.atan2(dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { position: committed.position, yaw, pitch };
}
