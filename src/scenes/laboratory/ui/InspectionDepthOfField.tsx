import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DepthOfFieldEffect, MaskFunction } from "postprocessing";
import * as THREE from "three";
import { cancelDeferredDispose, deferDispose } from "../lib/deferredDispose";
import { useReagentInspectionStore } from "../lib/useReagentInspectionStore";
import { useRuntimeQualityStore } from "../lib/useRuntimeQualityStore";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import "./tabletFocus.css";

/** Sharp band around the focus point: tight — everything is meant to blur. */
const FOCUS_RANGE = 0.3;
/** Blur strength: soft enough that the cabinet and the tray are still recognisable behind the bottle. */
const BOKEH_SCALE = 5;
/** The focus is put this far beyond the bottle — off everything near it, so the whole view blurs. */
const FOCUS_BEYOND = 8;
/**
 * The layer the inspected bottle is moved to: out of the main (blurred) pass,
 * drawn alone, sharp, on top of it. Lights are enabled on it too.
 */
const INSPECT_LAYER = 7;
/** How fast the blur fades in and out (1/s, exponential) — about a quarter of a second. */
const FOCUS_SHIFT_RATE = 12;

class InspectionBlurEffect extends DepthOfFieldEffect {
  active = false;
  private warmed = false;

  override update(...args: Parameters<DepthOfFieldEffect["update"]>) {
    // Compile/upload once during scene startup. Outside inspection the
    // blend opacity is zero and none of the internal blur passes run.
    if (!this.active && this.warmed) return;
    super.update(...args);
    this.warmed = true;
  }
}

/**
 * Inspecting a bottle (ВЗЯТЬ / ОСТАВИТЬ): everything but the bottle and the
 * buttons blurs. So does the whole lab while the tablet is open — the focus
 * moves to the tablet. A depth of field focused on the bottle could not do it —
 * the held tray, the stand on it and the test-tube rack sit at the bottle's
 * own distance from the camera and stayed sharp. So the bottle is taken out
 * of the main pass (its own layer), the whole view is blurred (the focus is
 * pushed far behind the lab), and the bottle is drawn sharp on top after the
 * composer. The buttons are HTML over the canvas and never blur.
 *
 * Keeps the composer and its shader programs stable across open/close.
 */
export function InspectionDepthOfField() {
  const { camera, scene, gl, raycaster } = useThree();
  // The lifted bottle must still be dragged round (to look at it from every
  // side): pointer picking has to see its layer too, not only the camera's.
  useEffect(() => {
    raycaster.layers.enable(INSPECT_LAYER);
  }, [raycaster]);

  // The HTML over the lab blurs too while the tablet is open (`tabletFocus.css`).
  // The lab's root element: the canvas sits two wrappers deep in it.
  const tabletOpen = useLaboratoryStore((state) => state.tabletOpen);
  useEffect(() => {
    const root = gl.domElement.parentElement?.parentElement?.parentElement;
    if (!root) return;
    root.classList.add("lab-focus-root");
    root.classList.toggle("lab-tablet-focus", tabletOpen);
  }, [gl, tabletOpen]);
  const effect = useMemo(() => {
    const blur = new InspectionBlurEffect(camera, { focusRange: FOCUS_RANGE, bokehScale: BOKEH_SCALE });
    blur.target = new THREE.Vector3();
    blur.maskFunction = MaskFunction.MULTIPLY_RGB_SET_ALPHA;
    blur.blendMode.opacity.value = 0;
    return blur;
  }, [camera]);
  /** The bottle on its own layer: its objects and their original layer masks, to put back. */
  const lifted = useRef<{ readonly id: string; readonly masks: Map<THREE.Object3D, number> } | null>(null);
  const forward = useMemo(() => new THREE.Vector3(), []);
  /** How far the blur is faded in, 0..1. */
  const blend = useRef(0);

  const putBack = () => {
    lifted.current?.masks.forEach((mask, object) => {
      object.layers.mask = mask;
    });
    lifted.current = null;
  };

  useFrame((_, delta) => {
    const inspection = useReagentInspectionStore.getState();
    // A "holder" (the workbench test tube rack) is wide, angled and meant to
    // be read whole — it is not lifted out and nothing blurs around it.
    const inspectingJar = inspection.inspectedId !== null && inspection.kind !== "holder";
    // The tablet too: opening it is a change of focus — the lab behind it blurs.
    const tabletOpen = useLaboratoryStore.getState().tabletOpen;
    const wanted = (inspectingJar || tabletOpen) && useRuntimeQualityStore.getState().quality !== "LOW";
    // Eased in and out rather than switched, so it reads as the focus shifting.
    blend.current = THREE.MathUtils.damp(blend.current, wanted ? 1 : 0, FOCUS_SHIFT_RATE, Math.min(delta, 0.1));
    if (!wanted && blend.current < 0.002) blend.current = 0;
    effect.active = blend.current > 0;
    effect.blendMode.opacity.value = blend.current;

    const id = inspectingJar && effect.active ? inspection.inspectedId : null;
    if (lifted.current?.id !== id) {
      putBack();
      if (id) {
        let bottle: THREE.Object3D | null = null;
        scene.traverse((object) => {
          if (!bottle && object.userData.inspectionId === id) bottle = object;
        });
        if (bottle) {
          const masks = new Map<THREE.Object3D, number>();
          (bottle as THREE.Object3D).traverse((object) => {
            masks.set(object, object.layers.mask);
            object.layers.set(INSPECT_LAYER);
          });
          lifted.current = { id, masks };
          // Lights must reach the bottle on its own layer too.
          scene.traverse((object) => {
            if (object instanceof THREE.Light) object.layers.enable(INSPECT_LAYER);
          });
        }
      }
    }
    if (effect.active) {
      camera.getWorldDirection(forward);
      effect.target!.copy(camera.position).addScaledVector(forward, FOCUS_BEYOND);
    }
  });

  // After the composer (priority 1): the bottle alone, sharp, over the blurred frame.
  useFrame(() => {
    if (!lifted.current) return;
    const mask = camera.layers.mask;
    const autoClear = gl.autoClear;
    const shadows = gl.shadowMap.autoUpdate;
    // A colour background makes three.js clear the frame before drawing —
    // even with autoClear off — which wiped the blurred lab. None for this pass.
    const background = scene.background;
    scene.background = null;
    gl.autoClear = false;
    gl.shadowMap.autoUpdate = false;
    gl.clearDepth();
    camera.layers.set(INSPECT_LAYER);
    gl.render(scene, camera);
    camera.layers.mask = mask;
    scene.background = background;
    gl.autoClear = autoClear;
    gl.shadowMap.autoUpdate = shadows;
  }, 2);

  useEffect(() => {
    cancelDeferredDispose(effect);
    return () => deferDispose(effect, () => effect.dispose());
  }, [effect]);
  useEffect(() => putBack, []);

  return <primitive object={effect} />;
}
