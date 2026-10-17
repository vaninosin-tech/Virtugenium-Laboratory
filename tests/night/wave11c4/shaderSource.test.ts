import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeLegacySilverVolumeMaterial, makeSilverVolumeMaterial } from "../../../src/scenes/laboratory/lib/tubeSilverVolumeMaterial";

describe("silver GLSL generated sources", () => {
  const cases = [
    ["stage 3 with textures", () => makeSilverVolumeMaterial(0.007, 0, 0.11,
      new THREE.Data3DTexture(new Float32Array(1), 1, 1, 1), new THREE.Data3DTexture(new Float32Array(1), 1, 1, 1)).material],
    ["stage 3 fallback", () => makeSilverVolumeMaterial(0.007, 0, 0.11).material],
    ["legacy", () => makeLegacySilverVolumeMaterial(0.007, 0).material],
  ] as const;
  it.each(cases)("keeps numeric and version declarations valid in %s", (_name, factory) => {
    const material = factory();
    const source = `${material.vertexShader}\n${material.fragmentShader}`;
    expect(source).not.toMatch(/^\s*#version\b/m); // Three injects the version for glslVersion.
    expect(material.glslVersion).toBe(source.includes("uniform sampler3D") ? THREE.GLSL3 : null);
    // A decimal-free integer operand in float arithmetic caused the real GLSL compile failure.
    expect(source).not.toMatch(/(?:\*|\/)\s*[1-9]\d*(?![.\dA-Za-z_])/);
    expect(source).not.toMatch(/(?<![.\dA-Za-z_])[1-9]\d*\s*(?:\*|\/)\s*(?:u[A-Z]|[a-z]+\()/);
    const declarations = [...material.fragmentShader.matchAll(/uniform\s+(float|int|sampler3D)\s+([^;]+);/g)];
    const types = new Map<string, string>();
    for (const [, type, names] of declarations) for (const name of names.split(",").map(s => s.trim())) {
      expect(types.has(name)).toBe(false);
      types.set(name, type);
    }
    for (const [name, type] of types) {
      expect(material.uniforms).toHaveProperty(name);
      const value = material.uniforms[name].value;
      if (type === "int") expect(Number.isInteger(value)).toBe(true);
      if (type === "float") expect(typeof value).toBe("number");
      if (type === "sampler3D" && value !== undefined) expect(value).toBeInstanceOf(THREE.Data3DTexture);
    }
    material.dispose();
  });
});
