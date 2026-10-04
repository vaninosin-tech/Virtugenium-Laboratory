import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { REAGENTS } from "../src/entities/laboratory/reagents";
import { createTubeReactionVisuals } from "../src/scenes/laboratory/lib/tubeReactionVisuals";
import { createTubeCopperGranules } from "../src/scenes/laboratory/lib/testTubeContents";
import { TubeLiquidMaterial } from "../src/scenes/laboratory/lib/tubeLiquidMaterial";
import type { ReactionKind, TubeChemistry } from "../src/scenes/laboratory/lib/tubeReactions";
import type { RuntimeQuality } from "../src/scenes/laboratory/lib/useRuntimeQualityStore";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup());
  vi.restoreAllMocks();
});
const chemistry = (progress = 0.5, rate = 0, temperature = 0): TubeChemistry => ({ progress, rate, temperature });

function fixture(kind: ReactionKind | null, withCopper = false, pour = false, withSurface = false) {
  const parent = new THREE.Group();
  const root = new THREE.Group();
  parent.add(root);
  const surface = withSurface ? new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial()) : null;
  if (surface) {
    surface.geometry.rotateX(-Math.PI / 2);
    surface.position.y = -0.02;
    parent.add(surface);
  }
  const geometry = new THREE.CylinderGeometry(0.007, 0.007, 0.055, 16);
  geometry.translate(0, 0.028, 0);
  const baseline = new TubeLiquidMaterial(geometry, {
    color: kind === "permanganate-redox" ? REAGENTS.kmno4.contentsColor : "#eef6fb",
    opacity: kind === "permanganate-redox" ? REAGENTS.kmno4.contentsOpacity : 0.3,
  });
  const volume = new THREE.Mesh(geometry, baseline);
  volume.name = "ContentsVolume";
  const shellGeometry = new THREE.CylinderGeometry(0.0098, 0.0098, 0.15, 16);
  shellGeometry.translate(0, 0.075, 0);
  const shell = new THREE.Mesh(shellGeometry, new THREE.MeshBasicMaterial());
  shell.name = "Tube_Glass";
  root.add(volume, shell);
  const copper = withCopper ? createTubeCopperGranules(geometry) : null;
  if (copper) root.add(copper);
  const visuals = createTubeReactionVisuals(root, kind, { activeSurface: true, pour })!;
  const get = <T extends THREE.Mesh = THREE.Mesh>(name: string) => root.getObjectByName(name) as T;
  let time = 0;
  const update = (state: TubeChemistry, quality: RuntimeQuality = "HIGH", splashAge = Infinity,
    refraction = false) => {
    visuals.update(state, time, quality, splashAge, refraction);
  };
  const advance = (seconds: number, state: TubeChemistry, quality: RuntimeQuality = "HIGH") => {
    // Exercise the integrators with real frame deltas, not one clamped time jump.
    const frames = Math.ceil(seconds * 60);
    for (let i = 0; i < frames; i++) { time += seconds / frames; update(state, quality); }
  };
  cleanups.push(() => {
    visuals.dispose(); geometry.dispose(); shellGeometry.dispose(); baseline.dispose(); shell.material.dispose();
    copper?.children.forEach(child => (child as THREE.Mesh).geometry.dispose());
    surface?.geometry.dispose();
    surface?.material.dispose();
    // Copper's material is shared with other tubes and belongs to the source module.
  });
  return { parent, root, volume, geometry, baseline, visuals, copper, get, update, advance };
}
type Fixture = ReturnType<typeof fixture>;

function liquid(f: Fixture) { return f.volume.material as TubeLiquidMaterial; }
function waveRange(f: Fixture) {
  const heights = f.get("TubeLiquidSurface").geometry.getAttribute("tubeWave").array;
  return Math.max(...heights) - Math.min(...heights);
}
function maxWaveSlope(f: Fixture) {
  const normal = f.get("TubeLiquidSurface").geometry.getAttribute("normal");
  let greatest = 0;
  for (let i = 0; i < normal.count; i++) greatest = Math.max(greatest,
    Math.hypot(normal.getX(i), normal.getZ(i)));
  return greatest;
}
function density(f: Fixture): number {
  return (f.get("TubeNO2Headspace").material as THREE.ShaderMaterial).uniforms.uDensity.value;
}
function front(f: Fixture): number {
  return (f.get("TubeNO2Headspace").material as THREE.ShaderMaterial).uniforms.uFront.value;
}
function residue(f: Fixture): number {
  return (f.get("TubeNO2Headspace").material as THREE.ShaderMaterial).uniforms.uResidue.value;
}
function surfacePlane(f: Fixture) {
  const material = liquid(f);
  f.volume.updateWorldMatrix(true, false);
  return new THREE.Plane(material.uniforms.uUp.value.clone(), -material.uniforms.uLevel.value)
    .applyMatrix4(f.volume.matrixWorld);
}
function surfaceError(f: Fixture) { return surfacePlane(f).normal.angleTo(new THREE.Vector3(0, 1, 0)); }
function particleBounds(pool: THREE.InstancedMesh) {
  pool.geometry.computeBoundingBox();
  const box = new THREE.Box3();
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < pool.count; i++) {
    pool.getMatrixAt(i, matrix);
    box.union(pool.geometry.boundingBox!.clone().applyMatrix4(matrix));
  }
  return box;
}

const kinds: ReactionKind[] = ["copper-nitric", "silver-chloride", "barium-sulfate", "permanganate-redox"];
describe("tube reaction rendering contract", () => {
  it("curves the calm rim while keeping the wave highlight dormant", () => {
    const f = fixture(null);
    f.advance(0.1, chemistry(0));
    const cap = f.get("TubeLiquidSurface").geometry;
    const normal = cap.getAttribute("normal");
    const waveSlope = cap.getAttribute("tubeWaveSlope");
    expect(Math.hypot(normal.getX(1), normal.getZ(1))).toBeLessThan(0.02);
    expect(Math.hypot(normal.getX(normal.count - 1), normal.getZ(normal.count - 1))).toBeGreaterThan(0.1);
    for (let i = 0; i < waveSlope.count; i++) expect(Math.abs(waveSlope.getX(i))).toBeLessThan(1e-6);
  });

  it("projects tinted caustics only on detailed clear water", () => {
    const unsupported = fixture(null);
    unsupported.update(chemistry(0), "HIGH");
    expect(unsupported.get("TubeStandCaustic").visible).toBe(false);
    const clear = fixture(null, false, false, true);
    clear.update(chemistry(0), "HIGH");
    expect(clear.get("TubeStandCaustic").visible).toBe(true);
    const clearCaustic = clear.get("TubeStandCaustic").material as THREE.ShaderMaterial;
    expect(clearCaustic.uniforms.uWave.value).toBe(0);
    clear.update(chemistry(0), "LOW");
    expect(clear.get("TubeStandCaustic").visible).toBe(false);
    const blue = fixture("copper-nitric", false, false, true);
    blue.update(chemistry(0.8), "HIGH");
    const blueTint = (blue.get("TubeStandCaustic").material as THREE.ShaderMaterial).uniforms.uTint.value as THREE.Color;
    expect(blueTint.b).toBeGreaterThan(blueTint.r);
    const cloudy = fixture("barium-sulfate", false, false, true);
    cloudy.update(chemistry(0.2), "HIGH");
    const cloudStrength = (cloudy.get("TubeStandCaustic").material as THREE.ShaderMaterial).uniforms.uStrength.value;
    expect(cloudStrength).toBeLessThan(0.05);
    const poured = fixture(null, false, true, true);
    poured.update(chemistry(0), "HIGH");
    expect((poured.get("TubeStandCaustic").material as THREE.ShaderMaterial).uniforms.uWave.value).toBeGreaterThan(0);
  });

  it("keeps the original water material above the optional refracted backdrop", () => {
    const f = fixture(null);
    f.update(chemistry(0), "HIGH", Infinity, true);
    expect(f.get("TubeRefractedBackdrop").visible).toBe(true);
    expect(f.get("TubeRefractedSurface").visible).toBe(false);
    expect(f.volume.material).toBe(f.baseline);
    expect(f.get("TubeLiquidSurface").material).toBe(f.baseline);
    f.update(chemistry(0), "LOW", Infinity, true);
    expect(f.get("TubeRefractedBackdrop").visible).toBe(false);
  });

  it.each(kinds)("%s supports completion and reverse seeking while retaining GPU resources", kind => {
    const f = fixture(kind, false, false, true);
    f.update(chemistry(0));
    const held = f.volume.material;
    expect(held === f.baseline).toBe(kind !== "permanganate-redox");
    const group = f.root.getObjectByName("TubeReactionVisuals")!;
    const meshes = group.children as THREE.Mesh[];
    const resources = meshes.map(mesh => ({ mesh, geometry: mesh.geometry, material: mesh.material,
      array: mesh instanceof THREE.InstancedMesh ? mesh.instanceMatrix.array : null }));
    const wall = f.volume.geometry;
    f.update(chemistry(1), "LOW");
    const active = liquid(f);
    expect(active).toBeInstanceOf(TubeLiquidMaterial);
    f.advance(0.5, chemistry(0.5, kind === "copper-nitric" ? 0.8 : 0), "ULTRA");
    expect(f.volume.material).toBe(active);
    f.update(chemistry(0));
    expect(f.volume.material).toBe(held);
    expect(f.volume.geometry).toBe(wall);
    expect(group.children).toHaveLength(resources.length);
    for (const resource of resources) {
      expect(group.children).toContain(resource.mesh);
      expect(resource.mesh.geometry).toBe(resource.geometry);
      if (resource.mesh.name !== "TubeLiquidSurface") expect(resource.mesh.material).toBe(resource.material);
      if (resource.mesh instanceof THREE.InstancedMesh) expect(resource.mesh.instanceMatrix.array).toBe(resource.array);
      expect(resource.mesh.visible).toBe((["TubeLiquidSurface", "TubeBottomCaustic", "TubeStandCaustic"].includes(resource.mesh.name)
        && (kind !== "silver-chloride" || resource.mesh.name === "TubeLiquidSurface"))
        || kind === "copper-nitric" && ["TubeNO2Headspace", "TubeNOBubbles"].includes(resource.mesh.name));
    }
    expect(f.get("TubeLiquidSurface").material).toBe(held);
    f.update(chemistry(0.5));
    expect(f.volume.material).toBe(active);
  });

  it.each([-45, -20, 20, 45])("settles the water plane horizontally at %s degrees under transformed, scaled parents", degrees => {
    const f = fixture(null);
    f.parent.position.set(1.2, -0.4, 2.1);
    f.parent.rotation.set(0.12, 0.7, -0.09);
    f.parent.scale.set(1.4, 0.85, 1.1);
    f.root.position.set(0.1, 0.3, -0.2);
    f.root.scale.setScalar(0.8);
    f.update(chemistry(0));
    f.root.rotation.x = THREE.MathUtils.degToRad(degrees);
    f.advance(4, chemistry(0));
    expect(surfaceError(f)).toBeLessThan(1e-5);
    const cap = f.get("TubeLiquidSurface");
    expect(cap.visible).toBe(true);
    expect(cap.material).toBe(f.volume.material);
    expect(cap.geometry.getAttribute("tubeSurface").getX(0)).toBe(1);
    cap.updateWorldMatrix(true, false);
    const { uUp, uLevel } = liquid(f).uniforms;
    // Sample the shader's plane in world space. Keep away from the intentional
    // wetting rise at the rim; transformed local Y alone is not a surface test.
    const heights = [[0, 0], [0.003, 0], [-0.003, 0], [0, 0.003], [0, -0.003]].map(([x, z]) => {
      const y = (uLevel.value - uUp.value.x * x - uUp.value.z * z) / uUp.value.y;
      return new THREE.Vector3(x, y, z).applyMatrix4(cap.matrixWorld).y;
    });
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1e-6);
    const wallY = (x: number) => (uLevel.value - uUp.value.x * x) / uUp.value.y;
    expect((wallY(0.007) + wallY(-0.007)) / 2).toBeCloseTo(f.geometry.boundingBox!.max.y, 6);
  });

  it("keeps the gas height and outlet's up direction consistent with a tilted tube", () => {
    const f = fixture("copper-nitric", true);
    f.update(chemistry(0.4, 1));
    f.root.rotation.z = THREE.MathUtils.degToRad(45);
    f.advance(4, chemistry(0.4, 1));
    const head = f.get("TubeNO2Headspace").material as THREE.ShaderMaterial;
    const plume = f.get("TubeNO2").material as THREE.ShaderMaterial;
    expect(surfaceError(f)).toBeLessThan(1e-4);
    expect(head.uniforms.uMouthHeight.value).toBeCloseTo(0.095 / Math.sqrt(2), 3);
    f.volume.updateWorldMatrix(true, false);
    const plumeUp = (plume.uniforms.uWorldUp.value as THREE.Vector3).clone()
      .transformDirection(f.volume.matrixWorld);
    expect(plumeUp.angleTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-5);
  });

  it("moves settled AgCl flocs toward the lower wall when the tube tilts", () => {
    const f = fixture("silver-chloride");
    const flocs = f.get<THREE.InstancedMesh>("TubePrecipitate");
    const centerX = () => {
      const matrix = new THREE.Matrix4();
      let sum = 0;
      for (let i = 0; i < flocs.count; i++) {
        flocs.getMatrixAt(i, matrix);
        sum += matrix.elements[12];
      }
      return sum / flocs.count;
    };
    f.update(chemistry(1));
    const upright = centerX();
    f.root.rotation.z = THREE.MathUtils.degToRad(45);
    f.advance(4, chemistry(1));
    expect(Math.abs(centerX() - upright)).toBeGreaterThan(0.001);
  });

  it("excites a spring on rapid tilt, then damps toward the horizontal surface", () => {
    const f = fixture(null);
    f.update(chemistry(0));
    f.root.rotation.x = THREE.MathUtils.degToRad(20);
    f.advance(1 / 60, chemistry(0));
    const initial = surfaceError(f);
    expect(initial).toBeGreaterThan(THREE.MathUtils.degToRad(5));
    f.advance(0.2, chemistry(0));
    const moving = surfaceError(f);
    expect(moving).toBeLessThan(initial);
    f.advance(3, chemistry(0));
    expect(surfaceError(f)).toBeLessThan(1e-4);
    expect(surfaceError(f)).toBeLessThan(moving * 0.01);
  });

  it("runs and damps a surface wave after tilt while still water stays smooth", () => {
    const f = fixture(null);
    f.advance(1, chemistry(0));
    expect(waveRange(f)).toBe(0);
    f.root.rotation.x = THREE.MathUtils.degToRad(20);
    f.advance(0.2, chemistry(0));
    expect(waveRange(f)).toBeGreaterThan(0.00001);
    f.advance(4, chemistry(0));
    expect(waveRange(f)).toBeLessThan(0.00001);
  });

  it("disturbs the surface on pouring, bubbling and boiling at both quality levels", () => {
    const poured = fixture(null, false, true);
    poured.update(chemistry(0), "LOW");
    expect(poured.get("TubeLiquidSurface").geometry.userData.waveCells).toBe(13);
    expect(waveRange(poured)).toBeGreaterThan(0);
    expect(maxWaveSlope(poured)).toBeGreaterThan(0.05);
    poured.advance(0.08, chemistry(0), "LOW");
    expect(maxWaveSlope(poured)).toBeGreaterThan(0.02);
    poured.advance(4, chemistry(0), "LOW");
    expect(waveRange(poured)).toBeLessThan(0.00001);

    const copper = fixture("copper-nitric");
    copper.advance(3, chemistry(0.4, 1), "HIGH");
    expect(copper.get("TubeLiquidSurface").geometry.userData.waveCells).toBe(25);
    expect(waveRange(copper)).toBeGreaterThan(0);

    const heated = fixture(null);
    heated.advance(1, chemistry(0, 0, 1), "LOW");
    expect(waveRange(heated)).toBeGreaterThan(0);
  });

  it.each<RuntimeQuality>(["LOW", "HIGH"])("accumulates headspace gas and an outlet plume, then retains and decays them at %s", quality => {
    const f = fixture("copper-nitric");
    f.update(chemistry(0.4, 1), quality);
    expect(density(f)).toBe(0);
    f.advance(0.02, chemistry(0.4, 1), quality);
    f.advance(0.98, chemistry(0.4, 1), quality);
    const first = density(f);
    expect(first).toBeGreaterThan(0);
    f.advance(1, chemistry(0.5, 1), quality);
    const accumulated = density(f);
    expect(accumulated).toBeGreaterThan(first);
    const head = f.get("TubeNO2Headspace");
    const plume = f.get<THREE.InstancedMesh>("TubeNO2");
    expect(head.visible).toBe(true);
    expect(plume.visible).toBe(true);
    expect(front(f)).toBeGreaterThan(0.85);
    f.advance(4, chemistry(0.5, 1), quality);
    expect(front(f)).toBeCloseTo(1, 5);
    expect(plume.visible).toBe(true);
    const atLip = density(f);
    head.geometry.computeBoundingBox();
    // The interior gas volume spans the air column; its material clips at water.
    expect(head.geometry.boundingBox!.max.y).toBeCloseTo(0.15, 6);
    expect(head.geometry.boundingBox!.min.y).toBeLessThan(f.geometry.boundingBox!.max.y);
    expect(head.geometry.boundingBox!.max.x).toBeGreaterThan(0.0085);
    const headUniforms = (head.material as THREE.ShaderMaterial).uniforms;
    const plumeUniforms = (plume.material as THREE.ShaderMaterial).uniforms;
    expect(headUniforms.uDetail.value).toBe(quality === "LOW" ? 0 : 1);
    expect(headUniforms.uMouth.value).toBeGreaterThan(0.9);
    expect(plumeUniforms.uOpacity.value).toBeCloseTo(
      Math.min(0.9, (1 - Math.exp(-density(f) * 1.55 * 0.92)) * headUniforms.uMouth.value * 1.25), 6);
    expect(headUniforms.uLevel.value).toBeCloseTo(liquid(f).uniforms.uLevel.value);
    expect(headUniforms.uUp.value.equals(liquid(f).uniforms.uUp.value)).toBe(true);
    const matrix = new THREE.Matrix4();
    plume.getMatrixAt(0, matrix);
    expect(plume.count).toBe(1);
    const plumeBottom = matrix.elements[13] - Math.hypot(matrix.elements[4], matrix.elements[5], matrix.elements[6]);
    expect(plumeBottom).toBeCloseTo(0.144, 4);
    expect(plumeBottom).toBeLessThan(head.geometry.boundingBox!.max.y);
    f.advance(1, chemistry(1, 0), quality);
    expect(density(f)).toBeLessThan(atLip);
    expect(density(f)).toBeGreaterThan(atLip * 0.8);
    expect(head.visible).toBe(true);
    expect(plume.visible).toBe(true);
    expect(headUniforms.uMouth.value).toBeGreaterThan(0);
    expect(headUniforms.uMouth.value).toBeLessThan(0.3);
    expect(f.get("TubeNOBubbles").visible).toBe(true);
    f.advance(29, chemistry(1, 0), quality);
    expect(plume.visible).toBe(false);
    expect(f.get("TubeNOBubbles").visible).toBe(false);
    expect(density(f)).toBeGreaterThan(0);
    expect(density(f)).toBeLessThan(atLip * 0.3);
    const atThirty = residue(f);
    expect(atThirty).toBeGreaterThan(0.1);
    f.advance(30, chemistry(1, 0), quality);
    expect(head.visible).toBe(true);
    expect(residue(f)).toBeGreaterThan(0.5);
    expect(residue(f)).toBeGreaterThan(atThirty * 0.8);
    f.advance(60, chemistry(1, 0), quality);
    expect(head.visible).toBe(true);
    expect(residue(f)).toBeGreaterThan(0.45);
    f.advance(60, chemistry(1, 0), quality);
    expect(head.visible).toBe(true);
    expect(residue(f)).toBeGreaterThan(0.5);
    f.advance(120, chemistry(1, 0), quality);
    expect(residue(f)).toBeLessThan(0.3);
    f.advance(60, chemistry(1, 0), quality);
    expect(head.visible).toBe(false);
    expect(plume.visible).toBe(false);
  }, 30_000); // simulates several seconds of gas build-up per quality level

  it("keeps the final copper solution pale and transparent", () => {
    const f = fixture("copper-nitric");
    f.update(chemistry(1));
    expect(liquid(f).uniforms.uReactionColor.value.getHexString()).toBe("78cbd7");
    expect(liquid(f).uniforms.uOpacity.value).toBeLessThan(0.5);
  });

  it("keeps accumulated gas continuous across progress and rate override jumps", () => {
    const f = fixture("copper-nitric");
    f.update(chemistry(0.8, 1));
    f.advance(3, chemistry(0.8, 1));
    const before = density(f), risen = front(f);
    expect(before).toBeGreaterThan(0.1);
    f.update(chemistry(0.2));
    expect(density(f)).toBe(before);
    expect(front(f)).toBe(risen);
    f.advance(1, chemistry(0.2));
    expect(density(f)).toBeLessThan(before);
    expect(f.get("TubeNO2Headspace").visible).toBe(true);
    expect(f.get("TubeNO2").visible).toBe(true);
  });

  it("rises from the water over seconds and delays the outlet at low rate", () => {
    const fast = fixture("copper-nitric");
    const slow = fixture("copper-nitric");
    fast.update(chemistry(0.1, 1));
    slow.update(chemistry(0.1, 0.25));
    expect(front(fast)).toBe(0);
    expect(density(fast)).toBe(0);
    fast.advance(2, chemistry(0.1, 1));
    slow.advance(2, chemistry(0.1, 0.25));
    expect(front(fast)).toBeGreaterThan(front(slow) * 1.5);
    expect(front(fast)).toBeGreaterThan(0.9);
    expect(fast.get("TubeNO2").visible).toBe(true);
    fast.advance(8, chemistry(0.1, 1));
    expect(front(fast)).toBeCloseTo(1, 5);
    expect(fast.get("TubeNO2").visible).toBe(true);
    expect(slow.get("TubeNO2").visible).toBe(false);
  });

  it.each<RuntimeQuality>(["LOW", "HIGH"])("brings the mouth and plume in smoothly, then fades both at %s", quality => {
    const f = fixture("copper-nitric");
    const head = (f.get("TubeNO2Headspace").material as THREE.ShaderMaterial).uniforms;
    const plume = f.get<THREE.InstancedMesh>("TubeNO2");
    const opacity = () => (plume.material as THREE.ShaderMaterial).uniforms.uOpacity.value as number;
    f.update(chemistry(0.5, 1), quality);
    const onset: number[] = [];
    for (let i = 0; i < 20; i++) {
      f.advance(0.25, chemistry(0.5, 1), quality);
      onset.push(opacity());
      expect(head.uMouth.value).toBeGreaterThanOrEqual(0);
      expect(head.uMouth.value).toBeLessThanOrEqual(1);
    }
    expect(onset[11]).toBeGreaterThan(0);
    expect(onset.at(-1)!).toBeGreaterThan(onset[11]);
    for (let i = 1; i < onset.length; i++) {
      expect(onset[i]).toBeGreaterThanOrEqual(onset[i - 1] - 1e-6);
      expect(onset[i] - onset[i - 1]).toBeLessThan(onset.at(-1)! * 0.25);
    }
    const peak = opacity();
    f.advance(0.25, chemistry(1, 0), quality);
    expect(plume.visible).toBe(true);
    expect(opacity()).toBeLessThan(peak);
    f.advance(2, chemistry(1, 0), quality);
    expect(opacity()).toBeLessThan(peak * 0.05);
  });

  it("clears accumulated gas on reverse time seek even at the same progress", () => {
    const f = fixture("copper-nitric");
    f.update(chemistry(0.5, 1));
    f.advance(3, chemistry(0.5, 1));
    expect(density(f)).toBeGreaterThan(0.1);
    f.visuals.update(chemistry(0.5), 0, "HIGH", Infinity);
    expect(density(f)).toBe(0);
    expect(f.get("TubeNO2Headspace").visible).toBe(false);
  });

  it.each<RuntimeQuality>(["LOW", "HIGH"])("fades bubble sizes with rate without changing the pool at %s", quality => {
    const f = fixture("copper-nitric", true);
    const bubbles = f.get<THREE.InstancedMesh>("TubeNOBubbles");
    const matrix = new THREE.Matrix4();
    const visibleSize = () => {
      let sum = 0;
      for (let i = 0; i < bubbles.count; i++) {
        bubbles.getMatrixAt(i, matrix);
        sum += new THREE.Vector3().setFromMatrixScale(matrix).x;
      }
      return sum;
    };
    f.update(chemistry(0.4, 0.05), quality);
    const slow = visibleSize();
    expect(bubbles.visible).toBe(true);
    f.update(chemistry(0.4, 0.25), quality);
    const cold = visibleSize();
    f.update(chemistry(0.4, 0.9), quality);
    expect(visibleSize()).toBeGreaterThan(cold);
    expect(cold).toBeGreaterThan(slow);
    expect(bubbles.count).toBe(quality === "LOW" ? 24 : 54);
    f.advance(0.3, chemistry(0.4, 0.9), quality);
    f.update(chemistry(0.4), quality);
    expect(bubbles.visible).toBe(true);
    f.advance(10, chemistry(0.4));
    expect(bubbles.visible).toBe(false);
    f.update(chemistry(0.4, 0, 0.95), quality);
    expect(bubbles.visible).toBe(false);
    expect(f.get("TubeCondensate").visible).toBe(true);
  });

  it.each<RuntimeQuality>(["LOW", "HIGH"])("grows attached bubbles on the single copper grain and releases them after stopping at %s", quality => {
    const f = fixture("copper-nitric", true);
    const attached = f.get<THREE.InstancedMesh>("TubeNOAttachedBubbles");
    const free = f.get<THREE.InstancedMesh>("TubeNOBubbles");
    expect(attached.material).toBe(free.material);
    const grain = f.copper!.children[0];
    f.update(chemistry(0.1, 1), quality);
    expect(attached.visible).toBe(false);
    f.advance(0.4, chemistry(0.1, 1), quality);
    expect(attached.visible).toBe(true);
    expect(attached.count).toBe(quality === "LOW" ? 128 : 192);
    const first = new THREE.Matrix4();
    attached.getMatrixAt(0, first);
    const firstPosition = new THREE.Vector3().setFromMatrixPosition(first);
    expect(firstPosition.distanceTo(grain.position)).toBeLessThan(0.007);
    const firstScale = new THREE.Vector3().setFromMatrixScale(first).x;
    f.advance(0.3, chemistry(0.1, 1), quality);
    attached.getMatrixAt(0, first);
    const grownScale = new THREE.Vector3().setFromMatrixScale(first).x;
    expect(grownScale).not.toBeCloseTo(firstScale, 6);
    f.update(chemistry(0.6, 1), quality);
    attached.getMatrixAt(0, first);
    expect(new THREE.Vector3().setFromMatrixScale(first).x).toBeLessThan(grownScale);
    const activeCount = attached.count;
    f.advance(1, chemistry(0.6), quality);
    expect(attached.visible).toBe(true);
    expect(attached.count).toBeGreaterThan(0);
    expect(attached.count).toBeLessThanOrEqual(activeCount);
    f.advance(1, chemistry(0.6), quality);
    expect(attached.visible).toBe(false);
    f.advance(10, chemistry(0.6), quality);
    expect(attached.visible).toBe(false);
  });

  it("carries a one-millimetre copper bubble nearly through the water in a quarter second", () => {
    const f = fixture("copper-nitric", true);
    const free = f.get<THREE.InstancedMesh>("TubeNOBubbles");
    const matrix = new THREE.Matrix4();
    const state = chemistry(0.4, 0.25);
    f.update(state);
    free.getMatrixAt(0, matrix);
    const start = new THREE.Vector3().setFromMatrixPosition(matrix);
    f.advance(0.25, state);
    free.getMatrixAt(0, matrix);
    const after = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(after.y - start.y).toBeGreaterThan(0.025);
  });

  it("lets larger bubbles complete more surface-to-grain trips than smaller ones", () => {
    const f = fixture("copper-nitric", true);
    const free = f.get<THREE.InstancedMesh>("TubeNOBubbles");
    const indices = [33, 3, 0, 11]; // dust, 0.5 mm, 1 mm, 2–3 mm
    const matrix = new THREE.Matrix4();
    const wraps = indices.map(() => 0);
    const previous = indices.map(() => 0);
    const state = chemistry(0.4, 1);
    f.update(state);
    indices.forEach((index, k) => { free.getMatrixAt(index, matrix); previous[k] = matrix.elements[13]; });
    for (let frame = 0; frame < 180; frame++) {
      f.advance(1 / 60, state);
      indices.forEach((index, k) => {
        free.getMatrixAt(index, matrix);
        const y = matrix.elements[13];
        if (y < previous[k] - 0.01) wraps[k]++;
        previous[k] = y;
      });
    }
    expect(wraps[0]).toBeGreaterThanOrEqual(1);
    expect(wraps[0]).toBeLessThan(wraps[1]);
    expect(wraps[1]).toBeLessThan(wraps[2]);
    expect(wraps[2]).toBeLessThan(wraps[3]);
  });

  it.each<RuntimeQuality>(["LOW", "HIGH"])("clears released bubbles after copper dissolves without creating new ones at %s", quality => {
    const f = fixture("copper-nitric", true);
    const free = f.get<THREE.InstancedMesh>("TubeNOBubbles");
    const attached = f.get<THREE.InstancedMesh>("TubeNOAttachedBubbles");
    f.update(chemistry(1, 0, 0.95), quality);
    expect(free.visible).toBe(false);
    expect(attached.visible).toBe(false);
    f.advance(0.5, chemistry(0.8, 1, 0.95), quality);
    expect(free.visible).toBe(true);
    expect(attached.visible).toBe(true);
    f.update(chemistry(1, 0, 0.95), quality);
    expect(free.visible).toBe(true);
    expect(attached.visible).toBe(true);
    const first = new THREE.Matrix4();
    free.getMatrixAt(0, first);
    const startY = first.elements[13];
    f.advance(1, chemistry(1, 0, 0.95), quality);
    free.getMatrixAt(0, first);
    expect(first.elements[13]).toBeGreaterThan(startY);
    f.advance(1, chemistry(1, 0, 0.95), quality);
    expect(free.visible).toBe(false);
    expect(attached.visible).toBe(false);
    f.advance(10, chemistry(1, 0, 0.95), quality);
    expect(free.visible).toBe(false);
    expect(attached.visible).toBe(false);
  });

  it.each([-20, 20])("moves free bubbles upward with a small wobble at a static %s degree tilt", degrees => {
    const f = fixture("copper-nitric", true);
    f.parent.position.set(0.8, 0.4, -0.6);
    f.parent.rotation.y = 0.7;
    f.parent.scale.setScalar(1.3);
    f.root.rotation.x = THREE.MathUtils.degToRad(degrees);
    const state = chemistry(0.4, 0.8, 0.5);
    f.update(state);
    const group = f.root.getObjectByName("TubeReactionVisuals")!;
    const bubbles = f.get<THREE.InstancedMesh>("TubeNOBubbles");
    expect(bubbles.visible).toBe(true);
    const snapshot = () => {
      f.parent.updateMatrixWorld(true);
      const matrix = new THREE.Matrix4();
      return Array.from({ length: bubbles.count }, (_, i) => {
        bubbles.getMatrixAt(i, matrix);
        const local = new THREE.Vector3().setFromMatrixPosition(matrix);
        return { local, world: local.clone().applyMatrix4(group.matrixWorld) };
      });
    };
    let before = snapshot();
    const copperMatrices = f.copper!.children.map(grain => grain.matrix.clone());
    for (let frame = 0; frame < 4; frame++) {
      f.advance(1 / 120, state);
      const after = snapshot();
      expect(after).toHaveLength(before.length);
      f.copper!.children.forEach((grain, i) => expect(grain.matrix.equals(copperMatrices[i])).toBe(true));
      let checked = 0;
      for (let i = 0; i < before.length; i++) {
        const a = before[i], b = after[i];
        // Exclude wall sliding and the large return-to-source jump at a phase
        // wrap. Do not filter on motion direction: downward drift must fail.
        if (Math.hypot(a.local.x, a.local.z) >= 0.005 ||
            Math.hypot(b.local.x, b.local.z) >= 0.005 ||
            a.local.distanceTo(b.local) > 0.003) continue;
        const delta = b.world.clone().sub(a.world);
        expect(delta.y, `frame ${frame}, bubble ${i}: must rise`).toBeGreaterThan(0);
        expect(Math.hypot(delta.x, delta.z), `frame ${frame}, bubble ${i}: wobble bound`).toBeLessThan(1.5e-4);
        checked++;
      }
      expect(checked, `frame ${frame}: enough free, non-wrapping bubbles`).toBeGreaterThanOrEqual(2);
      before = after;
    }
  });

  it("shrinks copper monotonically, hides consumed grains and restores them on seek", () => {
    const f = fixture("copper-nitric", true);
    f.update(chemistry(0));
    const grains = f.copper!.children;
    expect(grains).toHaveLength(1);
    const initial = grains.map(grain => ({ scale: grain.scale.x, y: grain.position.y }));
    f.update(chemistry(0.5));
    grains.forEach((grain, i) => {
      expect(grain.scale.x).toBeGreaterThan(0);
      expect(grain.scale.x).toBeLessThan(initial[i].scale);
      expect(grain.position.y).toBeLessThan(initial[i].y);
      expect(grain.visible).toBe(true);
    });
    f.update(chemistry(1));
    grains.forEach(grain => expect(grain.visible).toBe(false));
    f.update(chemistry(0));
    grains.forEach((grain, i) => {
      expect(grain.scale.x).toBe(initial[i].scale);
      expect(grain.position.y).toBeCloseTo(initial[i].y);
      expect(grain.visible).toBe(true);
    });
  });

  it.each([-20, 0, 20])("keeps real copper vertices inside the rounded bottom at %s degrees", degrees => {
    const f = fixture("copper-nitric", true);
    f.root.rotation.x = THREE.MathUtils.degToRad(degrees);
    const bottom = f.geometry.boundingBox!.min.y;
    const radius = 0.007;
    for (const progress of [0, 0.5, 0.9]) {
      f.update(chemistry(progress));
      f.root.updateMatrixWorld(true);
      let lowest = Infinity, greatestBowlDistance = 0;
      for (const child of f.copper!.children) {
        const grain = child as THREE.Mesh;
        const positions = grain.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(grain.matrix);
          lowest = Math.min(lowest, point.y);
          greatestBowlDistance = Math.max(greatestBowlDistance,
            Math.hypot(point.x, point.z, Math.min(0, point.y - bottom - radius)));
        }
      }
      expect(lowest, `progress=${progress}: copper below bottom`).toBeGreaterThanOrEqual(bottom - 0.00001);
      expect(greatestBowlDistance, `progress=${progress}: copper outside bowl`).toBeLessThanOrEqual(radius + 0.00001);
    }
  });

  it("builds AgCl sediment from flocs at LOW and never adds gas to ionic reactions", () => {
    const silver = fixture("silver-chloride");
    const barium = fixture("barium-sulfate");
    for (const f of [silver, barium]) {
      f.update(chemistry(1), "LOW");
      expect(f.get("TubeSediment").visible).toBe(f === barium);
      expect(f.get("TubePrecipitate").visible).toBe(f === silver);
      expect(f.get("TubeBaCrystals")).toBeUndefined();
      expect(f.get("TubeNO2").visible).toBe(false);
      expect(f.get("TubeNO2Headspace").visible).toBe(false);
      expect(f.get("TubeNOBubbles").visible).toBe(false);
      expect(f.get("TubeLiquidSurface").visible).toBe(true);
    }
    const silverTop = particleBounds(silver.get<THREE.InstancedMesh>("TubePrecipitate")).max.y;
    const bariumBed = barium.get("TubeSediment");
    expect(silverTop).toBeGreaterThan(0.055 * 0.10);
    expect(silverTop).toBeLessThan(0.055 * 0.28);
    expect(barium.get("TubePrecipitate").visible).toBe(false);
    expect(bariumBed.visible).toBe(true);
    expect((bariumBed.material as THREE.MeshStandardMaterial).roughness).toBe(1);
    expect((bariumBed.material as THREE.MeshStandardMaterial).metalness).toBe(0);
    expect((silver.get("TubePrecipitate").material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0);
  });

  it("brings AgCl flocs and BaSO4 milk in gradually over their first second", () => {
    const silver = fixture("silver-chloride");
    silver.update(chemistry(0.1 / 12));
    expect(liquid(silver).uniforms.uCloudiness.value).toBeGreaterThan(0);
    expect(liquid(silver).uniforms.uCloudiness.value).toBeLessThan(0.5);
    const flocs = silver.get<THREE.InstancedMesh>("TubePrecipitate");
    expect(flocs.visible).toBe(true);
    expect(particleBounds(flocs).max.y).toBeGreaterThan(0);
    silver.update(chemistry(1.2 / 12));
    expect(liquid(silver).uniforms.uCloudiness.value).toBeCloseTo(1);

    const barium = fixture("barium-sulfate");
    barium.update(chemistry(0.2 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeGreaterThan(0);
    expect(liquid(barium).uniforms.uCloudiness.value).toBeLessThan(0.5);
    barium.update(chemistry(0.9 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeCloseTo(1);
    barium.update(chemistry(15 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeCloseTo(1);
    expect(barium.get("TubeSediment").visible).toBe(false);
    barium.update(chemistry(25 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeCloseTo(1);
    expect(barium.get("TubeSediment").visible).toBe(true);
    barium.update(chemistry(35 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeCloseTo(1);
    barium.update(chemistry(1));
    expect(barium.get("TubeSediment").visible).toBe(true);
  });

  it("keeps BaSO4 residue on the wall while the milky haze clears over minutes", () => {
    const barium = fixture("barium-sulfate");
    barium.update(chemistry(1));
    const material = liquid(barium);
    expect(material.uniforms.uWallFilm.value).toBeCloseTo(1);
    expect(material.uniforms.uResidualHaze.value).toBeCloseTo(0.65);
    barium.advance(45, chemistry(1));
    expect(material.uniforms.uResidualHaze.value).toBeGreaterThan(0.6);
    barium.advance(90, chemistry(1));
    expect(material.uniforms.uResidualHaze.value).toBeGreaterThan(0.1);
    expect(material.uniforms.uResidualHaze.value).toBeLessThan(0.3);
    barium.advance(65, chemistry(1));
    expect(material.uniforms.uResidualHaze.value).toBeCloseTo(0);
    expect(material.uniforms.uWallFilm.value).toBeCloseTo(1);
  });

  it("decolorizes permanganate while keeping its water surface visible", () => {
    const f = fixture("permanganate-redox", false, false, true);
    f.update(chemistry(1));
    expect(liquid(f).uniforms.uReactionColor.value.getHexString()).toBe("ffffff");
    expect(liquid(f).uniforms.uOpacity.value).toBeCloseTo(0.14);
    for (const o of f.root.getObjectByName("TubeReactionVisuals")!.children) {
      expect(o.visible).toBe(["TubeLiquidSurface", "TubeBottomCaustic", "TubeStandCaustic"].includes(o.name));
    }
  });

  it("preserves the physical response at the start of permanganate reduction", () => {
    const f = fixture("permanganate-redox");
    f.update(chemistry(0));
    const active = liquid(f);
    expect(active).not.toBe(f.baseline);
    expect(f.baseline.uniforms.uBaseColor.value.getHexString()).toBe("9c1c6b");
    expect(active.uniforms.uBaseColor.value.getHexString()).toBe("9c1c6b");
    expect(active.uniforms.uReactionKind.value).toBe(4);
    expect(active.side).toBe(f.baseline.side);
    expect(active.depthWrite).toBe(f.baseline.depthWrite);
    expect(active.roughness).toBe(f.baseline.roughness);
    expect(active.ior).toBe(f.baseline.ior);
    expect(active.uniforms.uOpacity.value).toBeCloseTo(f.baseline.uniforms.uOpacity.value, 3);
  });

  it("leaves unrecognized contents unchanged and expires a splash after one second", () => {
    const f = fixture(null);
    f.update(chemistry(1), "HIGH", 0.5);
    expect(f.volume.material).toBe(f.baseline);
    expect(f.get("TubeSplash").visible).toBe(true);
    f.update(chemistry(1), "HIGH", 1);
    expect(f.get("TubeSplash").visible).toBe(false);
    expect(f.get("TubeLiquidSurface").visible).toBe(true);
  });

  it("disposes owned resources once and restores shared geometry and materials", () => {
    const f = fixture("copper-nitric", true);
    f.update(chemistry(0.5, 1));
    const owned = new Set<THREE.BufferGeometry | THREE.Material>([f.volume.geometry, liquid(f)]);
    f.root.getObjectByName("TubeReactionVisuals")!.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.geometry !== f.geometry) owned.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material !== f.baseline) owned.add(material);
      }
    });
    const ownedSpies = [...owned].map(resource => vi.spyOn(resource, "dispose"));
    const shared = [f.geometry, f.baseline, (f.copper!.children[0] as THREE.Mesh).material as THREE.Material];
    const sharedSpies = shared.map(resource => vi.spyOn(resource, "dispose"));
    f.advance(1, chemistry(0.7, 0.8));
    ownedSpies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    f.visuals.dispose();
    f.visuals.dispose();
    expect(f.volume.geometry).toBe(f.geometry);
    expect(f.volume.material).toBe(f.baseline);
    expect(f.root.getObjectByName("TubeReactionVisuals")).toBeUndefined();
    ownedSpies.forEach(spy => expect(spy).toHaveBeenCalledTimes(1));
    sharedSpies.forEach(spy => expect(spy).not.toHaveBeenCalled());
  });
});
