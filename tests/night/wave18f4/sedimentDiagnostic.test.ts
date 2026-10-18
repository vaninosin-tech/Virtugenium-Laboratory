import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeSilverVolumeMaterial } from "../../../src/scenes/laboratory/lib/tubeSilverVolumeMaterial";

describe("wave 18 sediment and GPU budget guards", () => {
  it("contains no regular sediment detail or competing alpha height", () => {
    const source=readFileSync("src/scenes/laboratory/lib/tubeReactionVisuals.ts","utf8");
    const start=source.indexOf('} else if (kind === "silver-chloride") {');
    const end=source.indexOf('bedMaterial.customProgramCacheKey',start);
    const surface=source.slice(start,end);
    expect(surface).not.toMatch(/(?:sin|cos|fract|mod)\s*\(/);
    expect(surface).not.toMatch(/min\(vSedimentThickness,\s*deposited\)/);
    expect(surface).toContain("smoothstep(${silverAggregateOptics.sedimentAlphaStart}, ${silverAggregateOptics.sedimentAlphaEnd}, vSedimentThickness)");
    expect(source).toContain('side: kind === "silver-chloride" ? THREE.FrontSide');
  });

  it("removes the old lattice frequency from a visible controlled surface", () => {
    const metrics=JSON.parse(readFileSync("docs/night/wave18f4/sediment-diagnostic-metrics.json","utf8"));
    expect(metrics.displayScale).toBe(10);
    expect(metrics.beforeCommit).toBe("7690e47");
    expect(metrics.before.targetToBroadband).toBeGreaterThan(.5);
    expect(metrics.after.targetToBroadband).toBeLessThan(.01);
  });

  it("keeps the ray cost at one aggregate sample and two aggregate light taps", () => {
    const material=makeSilverVolumeMaterial(.007,0,.055).material,shader=material.fragmentShader;
    expect((shader.match(/texture\(uAggregate,grid\)/g)??[]).length).toBe(1);
    expect((shader.match(/texture\(uAggregate,uvw\(q\)\)/g)??[]).length).toBe(1);
    expect((shader.match(/texture\(uHaze,grid\)/g)??[]).length).toBe(1);
    expect(material.uniforms.uSteps.value).toBe(88);
    material.dispose();
  });
});
