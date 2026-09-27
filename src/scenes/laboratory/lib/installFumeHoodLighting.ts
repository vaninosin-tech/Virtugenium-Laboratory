import * as THREE from "three";

/** Attach to the rendered LED so furniture translation/rotation stays authoritative. */
export function installFumeHoodLighting(root: THREE.Object3D) {
  const led = root.getObjectByName("Interior_LED");
  if (!(led instanceof THREE.Mesh)) return null;
  const original = led.material;
  const materials = (Array.isArray(original) ? original : [original]).map(m => m.clone());
  led.material = Array.isArray(original) ? materials : materials[0];
  const castShadow = led.castShadow;
  led.castShadow = false;
  const light = new THREE.SpotLight("#fff4df", 0, 2.4, Math.PI * 0.43, 0.65, 2);
  light.name = "FumeHood_WorkLight";
  light.position.set(0, -0.018, 0);
  light.target.position.set(0, -0.95, -0.12);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.02;
  light.shadow.camera.far = 2.4;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.006;
  led.add(light, light.target);
  // `light.visible` stays true for good — it is never toggled off. Three.js
  // only compiles a light's shadow-depth GPU program the first time it
  // actually renders that light's shadow map, which only happens for a
  // *visible* shadow-casting light. Toggling `.visible` on the switch click
  // (as this used to) deferred that one-time compile to the exact frame the
  // player flips the switch, reading as a freeze. Keeping it permanently
  // visible bakes that compile into the fume hood's own mount (while the
  // model is loading, same as any other one-time asset cost), so the actual
  // on/off switch below only ever touches `intensity`/`emissiveIntensity` —
  // already-compiled uniforms, same convention `LightingRuntime` uses for
  // the ceiling lights.
  //
  // `shadow.autoUpdate` stays off while the light is off — with `intensity`
  // 0 the shadow contributes nothing visible, so re-rendering its depth map
  // every frame for no reason is pure waste. `needsUpdate = true` forces
  // exactly one depth render right now (the mount-time prewarm above) and
  // again on every switch-on (so a sash mid-slide when the light comes on
  // still gets a fresh, correctly-shaped shadow instead of a stale one).
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
  const setEnabled = (enabled: boolean) => {
    light.intensity = enabled ? 7 : 0;
    light.shadow.autoUpdate = enabled;
    if (enabled) light.shadow.needsUpdate = true;
    materials.forEach(material => {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.set("#fff4df");
        material.emissiveIntensity = enabled ? 2.5 : 0;
      }
    });
  };
  setEnabled(false);
  return { light, setEnabled, dispose: () => {
    led.remove(light, light.target);
    light.dispose();
    led.material = original;
    led.castShadow = castShadow;
    materials.forEach(m => m.dispose());
  } };
}
