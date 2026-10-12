import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { REAGENTS } from "../src/entities/laboratory/reagents";
import { createTubeReactionVisuals } from "../src/scenes/laboratory/lib/tubeReactionVisuals";
import { createTubeCopperGranules } from "../src/scenes/laboratory/lib/testTubeContents";
import { TubeLiquidMaterial } from "../src/scenes/laboratory/lib/tubeLiquidMaterial";
import { tubeEffectiveRadius, tubeLiquidHeight } from "../src/scenes/laboratory/lib/tubeLiquidLevel";
import type { ReactionKind, TubeChemistry } from "../src/scenes/laboratory/lib/tubeReactions";
import type { RuntimeQuality } from "../src/scenes/laboratory/lib/useRuntimeQualityStore";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup());
  vi.restoreAllMocks();
});
const chemistry = (progress = 0.5, rate = 0, temperature = 0): TubeChemistry => ({ progress, rate, temperature });

function fixture(kind: ReactionKind | null, withCopper = false, pour = false, withSurface = false,
  colorOverride?: string) {
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
    color: colorOverride ?? (kind === "permanganate-redox" ? REAGENTS.kmno4.contentsColor : "#eef6fb"),
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

  it("multiplies coloured transmission before drawing copper and glass", () => {
    const f = fixture("copper-nitric", true);
    f.update(chemistry(0.6));
    const wall = f.get("TubeAbsorptionWall");
    const cap = f.get("TubeAbsorptionSurface");
    const material = wall.material as THREE.ShaderMaterial;
    expect(wall.visible).toBe(true);
    expect(cap.visible).toBe(true);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendEquation).toBe(THREE.AddEquation);
    expect(material.blendSrc).toBe(THREE.ZeroFactor);
    expect(material.blendDst).toBe(THREE.SrcColorFactor);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
    expect(wall.renderOrder).toBeLessThan(f.copper!.children[0].renderOrder);
    expect(f.copper!.children[0].renderOrder).toBeLessThan(f.get("Tube_Glass").renderOrder);
    expect(((f.copper!.children[0] as THREE.Mesh).material as THREE.Material).transparent).toBe(true);
    f.update(chemistry(0));
    expect(wall.visible).toBe(false);
  });

  it("keeps a standalone permanganate tube absorbing without a reaction kind", () => {
    const f = fixture(null, false, false, false, REAGENTS.kmno4.contentsColor);
    f.update(chemistry(0));
    expect(f.get("TubeAbsorptionWall").visible).toBe(true);
    expect(f.get("TubeAbsorptionSurface").visible).toBe(true);
    expect(f.baseline.uniforms.uReactionKind.value).toBe(4);
    f.update(chemistry(1));
    expect(f.get("TubeAbsorptionWall").visible).toBe(true);
    f.visuals.dispose();
    expect(f.baseline.uniforms.uReactionKind.value).toBe(0);
  });

  it.each(kinds)("%s supports completion and reverse seeking while retaining GPU resources", kind => {
    const f = fixture(kind, false, false, true);
    f.update(chemistry(0));
    const held = f.volume.material;
    expect(held === f.baseline).toBe(kind === "copper-nitric");
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
      if (kind === "silver-chloride" && ["TubePrecipitate", "TubeSediment"].includes(resource.mesh.name)) continue;
      expect(resource.mesh.visible).toBe((["TubeLiquidSurface", "TubeBottomCaustic", "TubeStandCaustic"].includes(resource.mesh.name)
        && (kind !== "silver-chloride" || resource.mesh.name === "TubeLiquidSurface"))

        || kind === "permanganate-redox" && ["TubeAbsorptionWall", "TubeAbsorptionSurface"].includes(resource.mesh.name));
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
    f.update(chemistry(0));
    f.advance(3, chemistry(0));
    expect(flocs.count).toBeGreaterThan(0);
    const upright = centerX();
    f.root.rotation.z = THREE.MathUtils.degToRad(45);
    f.advance(2, chemistry(0));
    expect(Number.isFinite(centerX())).toBe(true);
    expect(Math.abs(centerX() - upright)).toBeGreaterThan(0.0001);
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

    const copper = fixture("copper-nitric", true);
    copper.update(chemistry(0));
    copper.advance(3, chemistry(0.4, 1), "HIGH");
    expect(copper.get("TubeLiquidSurface").geometry.userData.waveCells).toBe(25);

    const heated = fixture(null);
    heated.advance(1, chemistry(0, 0, 1), "LOW");
    expect(waveRange(heated)).toBeGreaterThan(0);
  });

  it("keeps the final copper solution saturated yet transparent", () => {
    const f = fixture("copper-nitric");
    f.update(chemistry(1));
    expect(liquid(f).uniforms.uReactionColor.value.getHexString()).toBe("1f7cc2");
    expect(liquid(f).uniforms.uOpacity.value).toBeLessThan(0.5);
  });

  it("shrinks copper monotonically, retains the unreacted grain and restores it on seek", () => {
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
    grains.forEach((grain, i) => {
      expect(grain.visible).toBe(true);
      expect(grain.scale.x / initial[i].scale).toBeGreaterThan(0.7);
      expect(grain.scale.x / initial[i].scale).toBeLessThan(0.8);
    });
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
      expect(f.get("TubeSediment").visible).toBe(false);
      expect(f.get("TubePrecipitate").visible).toBe(false);
      expect(f.get("TubeBaCrystals")).toBeUndefined();
      expect(f.get("TubeNO2").visible).toBe(false);
      expect(f.get("TubeNO2Headspace").visible).toBe(false);
      expect(f.get("TubeNOBubbles").visible).toBe(false);
      expect(f.get("TubeLiquidSurface").visible).toBe(true);
    }
    silver.advance(2, chemistry(0), "LOW");
    const silverTop = particleBounds(silver.get<THREE.InstancedMesh>("TubePrecipitate")).max.y;
    const bariumBed = barium.get("TubeSediment");
    expect(silverTop).toBeGreaterThan(0.055 * 0.10);
    expect(silverTop).toBeLessThan(tubeLiquidHeight(3.5, tubeEffectiveRadius(0.055)));
    expect(barium.get("TubePrecipitate").visible).toBe(false);
    expect(bariumBed.visible).toBe(false);
    expect(bariumBed.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((bariumBed.material as THREE.MeshBasicMaterial).color.getHexString()).toBe("f8f9f7");
    expect((silver.get("TubePrecipitate").material as THREE.MeshLambertMaterial).emissive.getHex()).toBe(0);
  });

  it("starts some AgCl flocs at the meniscus and carries them to the bottom", () => {
    const f = fixture("silver-chloride");
    const flocs = f.get<THREE.InstancedMesh>("TubePrecipitate");
    f.update(chemistry(0));
    f.advance(1, chemistry(0));
    expect(flocs.count).toBeGreaterThan(1);
    expect(particleBounds(flocs).max.y).toBeGreaterThan(0.03);
    f.advance(5, chemistry(0));
    expect(f.get("TubeSediment").visible).toBe(true);
  });

  it("keeps precipitate opacity available for the transported onset and later stages", () => {
    const silver = fixture("silver-chloride");
    silver.update(chemistry(0.1 / 12));
    expect(liquid(silver).uniforms.uCloudiness.value).toBeGreaterThan(0);
    expect(liquid(silver).uniforms.uCloudiness.value).toBeCloseTo(1);
    const flocs = silver.get<THREE.InstancedMesh>("TubePrecipitate");
    expect(flocs.visible).toBe(false);
    silver.advance(1, chemistry(0));
    expect(flocs.visible).toBe(true);
    expect(particleBounds(flocs).max.y).toBeGreaterThan(0);
    silver.update(chemistry(1.2 / 12));
    expect(liquid(silver).uniforms.uCloudiness.value).toBeCloseTo(1);

    const barium = fixture("barium-sulfate");
    barium.update(chemistry(0.2 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeGreaterThan(0);
    expect(liquid(barium).uniforms.uCloudiness.value).toBeGreaterThan(0.5);
    barium.update(chemistry(0.9 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeCloseTo(1);
    barium.update(chemistry(15 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeCloseTo(1);
    expect(barium.get("TubeSediment").visible).toBe(false);
    barium.update(chemistry(25 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeCloseTo(1);
    expect(barium.get("TubeSediment").visible).toBe(false);
    barium.update(chemistry(35 / 45));
    expect(liquid(barium).uniforms.uCloudiness.value).toBeCloseTo(1);
    barium.update(chemistry(1));
    expect(barium.get("TubeSediment").visible).toBe(false);
  });

  it("uses the suspension field instead of a timed wall haze", () => {
    const barium = fixture("barium-sulfate");
    barium.update(chemistry(1));
    const material = liquid(barium);
    expect(material.uniforms.uBaActive.value).toBe(1);
    expect(material.uniforms.uBaField.value).toBeTruthy();
    expect(material.uniforms.uResidualHaze.value).toBeCloseTo(0);
    expect(material.uniforms.uWallFilm.value).toBeCloseTo(0);
  });

  it("decolorizes permanganate while keeping its water surface visible", () => {
    const f = fixture("permanganate-redox", false, false, true);
    f.update(chemistry(1));
    expect(liquid(f).uniforms.uReactionColor.value.getHexString()).toBe("ffffff");
    expect(liquid(f).uniforms.uOpacity.value).toBeCloseTo(0.14);
    for (const o of f.root.getObjectByName("TubeReactionVisuals")!.children) {
      expect(o.visible).toBe(["TubeLiquidSurface", "TubeBottomCaustic", "TubeStandCaustic",
        "TubeAbsorptionWall", "TubeAbsorptionSurface"].includes(o.name));
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
    expect(active.uniforms.uOpacity.value).toBeCloseTo(0.14, 3);
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
