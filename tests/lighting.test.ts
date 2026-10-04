import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { installFumeHoodLighting } from "../src/scenes/laboratory/lib/installFumeHoodLighting";
import { useFumeHoodControlsStore } from "../src/scenes/laboratory/lib/useFumeHoodControlsStore";
import { LiquidMaterial } from "../src/scenes/laboratory/lib/reagentMaterials";

describe("game lighting", () => {
  it("switches the hood source and diffuser together and follows furniture transforms", () => {
    const root = new THREE.Group();
    const led = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const original = led.material;
    led.name = "Interior_LED";
    root.add(led);
    const binding = installFumeHoodLighting(root)!;
    const sync = () => binding.setEnabled(useFumeHoodControlsStore.getState().lightOnById["fume-hood"] ?? false);
    const unsubscribe = useFumeHoodControlsStore.subscribe(sync);
    for (const on of [true, false, true, false]) {
      useFumeHoodControlsStore.getState().setLight("fume-hood", on);
      expect(binding.light.intensity > 0).toBe(on);
      // Never toggled: hiding the light would defer its shadow-program compile to the switch click.
      expect(binding.light.visible).toBe(true);
      expect(binding.light.shadow.autoUpdate).toBe(on);
      expect((led.material as THREE.MeshStandardMaterial).emissiveIntensity > 0).toBe(on);
      expect(original.emissiveIntensity).toBe(1);
    }
    for (const on of [true, false, true, false]) {
      useFumeHoodControlsStore.getState().toggleLight("fume-hood");
      expect(binding.light.visible).toBe(true);
      expect(binding.light.intensity).toBe(on ? 7 : 0);
      expect((led.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(on ? 2.5 : 0);
    }
    root.position.set(2, 1, 3);
    root.rotation.y = Math.PI / 2;
    const position = binding.light.getWorldPosition(new THREE.Vector3());
    expect(position.x).toBeCloseTo(2);
    expect(position.y).toBeCloseTo(0.982);
    expect(position.z).toBeCloseTo(3);
    expect(binding.light.castShadow).toBe(true);
    unsubscribe();
    binding.dispose();
    expect(led.children).toHaveLength(0);
    expect(led.material).toBe(original);
    led.geometry.dispose(); original.dispose();
  });

  it("retains physical lights, shadows and output transforms in the liquid shader", () => {
    const geometry = new THREE.CylinderGeometry(0.03, 0.03, 0.06);
    const material = new LiquidMaterial(geometry, { color: "#ffffff", opacity: 0.5 });
    const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} };
    material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    expect(material.isMeshPhysicalMaterial).toBe(true);
    for (const chunk of ["lights_fragment_begin", "lights_fragment_end", "shadowmap_pars_fragment", "tonemapping_fragment", "colorspace_fragment"]) {
      expect(shader.fragmentShader).toContain(`#include <${chunk}>`);
    }
    expect(shader.vertexShader).toContain("transformed = p;");
    expect(shader.fragmentShader).toContain("diffuseColor = vec4(c, alpha);");
    // The physical normal chunks already declare vNormal; redeclaring it
    // in the custom header prevents the GPU program from compiling.
    expect(shader.vertexShader).not.toContain("varying vec3 vNormal;");
    expect(shader.fragmentShader).not.toContain("varying vec3 vNormal;");
    material.dispose(); geometry.dispose();
  });
});
