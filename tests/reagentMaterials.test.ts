import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createExteriorGlassGeometry, installReagentMaterials } from "../src/scenes/laboratory/lib/reagentMaterials";
import type { ContainerType } from "../src/entities/laboratory/reagents";

// Read the shipped asset, so its offsets and dimensions are covered too.
const glb = readFileSync("public/assets/models/ReagentContainers.glb");
const jsonLength = glb.readUInt32LE(12);
const asset = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
const binaryStart = 28 + jsonLength;

function readAccessor(index: number, itemSize: number) {
  const accessor = asset.accessors[index];
  const view = asset.bufferViews[accessor.bufferView];
  const bytes = accessor.componentType === 5123 ? 2 : 4;
  const values = new Float32Array(accessor.count * itemSize);
  for (let i = 0; i < accessor.count; i++) {
    for (let axis = 0; axis < itemSize; axis++) {
      const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) +
        i * (view.byteStride ?? bytes * itemSize) + axis * bytes;
      values[i * itemSize + axis] = accessor.componentType === 5126 ? glb.readFloatLE(offset) :
        bytes === 2 ? glb.readUInt16LE(offset) : glb.readUInt32LE(offset);
    }
  }
  return values;
}

describe("exterior glass shell", () => {
  it.each(asset.nodes.filter((node: { name: string }) => /^(Bottle_Glass|Jar_Glass)/.test(node.name)))
    ("keeps a continuous wall and closed bottom: $name", (node) => {
      const primitive = asset.meshes[node.mesh].primitives[0];
      const source = new THREE.BufferGeometry();
      source.setAttribute("position", new THREE.BufferAttribute(readAccessor(primitive.attributes.POSITION, 3), 3));
      source.setIndex(Array.from(readAccessor(primitive.indices, 1)));
      const originalIndex = source.index!.array.slice();
      const exterior = createExteriorGlassGeometry(source);
      exterior.computeBoundingBox();
      const box = exterior.boundingBox!;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(exterior, material);
      mesh.updateMatrixWorld();
      // Every azimuth must hit one near wall, including across the old
      // apparent half-shell seam. The internal wall must no longer blend.
      for (let i = 0; i < 32; i++) {
        const angle = (i + 0.37) * Math.PI * 2 / 32;
        const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const origin = center.clone().addScaledVector(direction, size.length());
        const ray = new THREE.Raycaster(origin, direction.negate());
        expect(ray.intersectObject(mesh)).toHaveLength(1);
      }
      const below = new THREE.Vector3(center.x + size.x * 0.07, box.min.y - size.y, center.z + size.z * 0.03);
      expect(new THREE.Raycaster(below, new THREE.Vector3(0, 1, 0)).intersectObject(mesh)).toHaveLength(1);
      expect(exterior.index!.count).toBeLessThan(source.index!.count);
      expect(source.index!.array).toEqual(originalIndex);
      exterior.dispose(); source.dispose(); material.dispose();
    });
});

describe("liquid cavity floor", () => {
  it.each<[ContainerType, string, number]>([
    ["clear250", "ContentsVolume", 0.005],
    ["amber250", "ContentsVolume.001", 0.005],
    ["wide120", "ContentsVolume.002", 0.0045],
  ])("keeps %s liquid above the glass base at every fill", (containerType, name, floor) => {
    const node = asset.nodes.find((entry: { name: string }) => entry.name === name);
    const accessor = asset.accessors[asset.meshes[node.mesh].primitives[0].attributes.POSITION];
    const view = asset.bufferViews[accessor.bufferView];
    const positions = new Float32Array(accessor.count * 3);
    for (let i = 0; i < accessor.count; i++) {
      for (let axis = 0; axis < 3; axis++) {
        positions[i * 3 + axis] = glb.readFloatLE(binaryStart + view.byteOffset +
          (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 12) + axis * 4);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    const originalBounds = geometry.boundingBox!.clone();
    const originalMaterial = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, originalMaterial);
    mesh.name = name;
    mesh.position.fromArray(node.translation);
    const originalTop = mesh.position.y + originalBounds.max.y;
    const root = new THREE.Group();
    root.add(mesh);
    const binding = installReagentMaterials(root, {
      id: "test", formula: "test", displayName: "test", labelText: "test",
      containerType, contentsColor: "#ffffff", contentsOpacity: 0.5, fillLevel: 0.7,
    });
    for (const fill of [1, 0.7, 0.1, 0.001, 0, 1]) {
      binding.setFillLevel(fill);
      const bottom = mesh.position.y + originalBounds.min.y * mesh.scale.y;
      expect(bottom).toBeGreaterThan(floor);
      expect(bottom).toBeCloseTo(floor + 0.0001, 7);
      expect(mesh.visible).toBe(fill > 0);
      if (fill === 1) expect(mesh.position.y + originalBounds.max.y * mesh.scale.y).toBeCloseTo(originalTop, 7);
    }
    expect(geometry.boundingBox).toEqual(originalBounds);
    binding.dispose();
    originalMaterial.dispose();
    geometry.dispose();
  });
});
