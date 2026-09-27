import * as THREE from "three";

/**
 * `CategoryLabelPlate` and `Page_Display` are box-primitive meshes with a
 * standard 6-face cube UV unwrap — verified directly from the glb's own
 * accessor data: U confined to [0.125, 0.875], V to [0, 1], the classic
 * "unfolded cube net" layout, not a clean 0-1 front face. That's the actual
 * cause of the "black horizontal stripes": a custom canvas texture applied
 * through that packed layout gets sampled through a thin sliver of UV
 * space, aliasing into banding — not a shutter/clipping artifact.
 *
 * This replaces the mesh's UV attribute with a simple planar projection
 * onto its own two largest-extent axes (the face the player actually sees).
 * `Page_Display` shares one raw unit-cube geometry with identical extent on
 * all three axes (verified from the glb's own accessor data: `posMin`/
 * `posMax` are exactly ±0.5) — its real, visually-thin axis comes entirely
 * from the node's own `scale` (a thin flush slab as of the right-side
 * control panel redesign — Blender's own Y/Z axes swap on glTF export, so
 * the runtime THREE.js scale isn't a 1:1 read of what was set in Blender;
 * only the *weighted* size this function computes matters, not which raw
 * axis letter is thinnest), not from the raw geometry, so multiplying by
 * `mesh.scale` first is what makes the axis choice correct for it.
 * `CategoryLabelPlate`'s geometry was rebuilt with
 * real-world dimensions baked directly into its vertices (object scale
 * reset to 1,1,1) in the interior-design pass, so its own bounding box
 * alone already reflects its true thin axis (Y, the plate's 8mm depth) —
 * the `mesh.scale` multiplication is simply a no-op for it now, not a
 * special case.
 * Geometry vertex *positions* are untouched — only how the material's
 * texture is sampled across the existing shape changes.
 */
export function remapPlanarUV(mesh: THREE.Mesh, flipU = false, flipV = false, swapUV = false): void {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position) return;

  const bbox = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  size.multiply(mesh.scale);

  const axisSizes: Array<{ axis: "x" | "y" | "z"; size: number }> = [
    { axis: "x", size: size.x },
    { axis: "y", size: size.y },
    { axis: "z", size: size.z },
  ];
  axisSizes.sort((a, b) => b.size - a.size);
  // Picking U as whichever remaining axis is larger matches the reading
  // direction by coincidence when that axis also ends up horizontal on
  // screen (true for CategoryLabelPlate). For Page_Display, ControlPanel's own
  // rotation makes its *smaller* remaining axis (Z) the one that ends up
  // horizontal after mounting — verified in-browser: without the swap,
  // "1 / 1" rendered legibly but turned 90°, reading top-to-bottom instead
  // of left-to-right. `swapUV` lets the caller correct that per-mesh
  // without guessing inside this generic function.
  const [uAxis, vAxis] = swapUV ? [axisSizes[1].axis, axisSizes[0].axis] : [axisSizes[0].axis, axisSizes[1].axis];

  const uMin = bbox.min[uAxis];
  const uRange = bbox.max[uAxis] - uMin || 1;
  const vMin = bbox.min[vAxis];
  const vRange = bbox.max[vAxis] - vMin || 1;

  const count = position.count;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    let u = (position.getComponent(i, "xyz".indexOf(uAxis)) - uMin) / uRange;
    let v = (position.getComponent(i, "xyz".indexOf(vAxis)) - vMin) / vRange;
    if (flipU) u = 1 - u;
    if (flipV) v = 1 - v;
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}
