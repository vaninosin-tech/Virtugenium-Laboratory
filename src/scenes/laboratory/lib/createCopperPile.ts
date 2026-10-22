import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";

function validateClosedFragment(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 12 || position.count % 3 !== 0) throw new Error("Invalid copper fragment topology");
  for (let i = 0; i < position.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, i);
    const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
    const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    if (!finite(a) || !finite(b) || !finite(c) || b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-12) {
      throw new Error("Degenerate copper fragment triangle");
    }
  }
}

/** Seven shared fragment shapes; deterministic random deposition, no physics. */
function buildCopperTemplate(cavity: THREE.BufferGeometry) {
  const bounds = new THREE.Box3().setFromBufferAttribute(cavity.getAttribute("position") as THREE.BufferAttribute);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.min(size.x, size.z) / 2;
  let seed = 93641;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const geometries: THREE.BufferGeometry[] = [];
  for (let kind = 0; kind < 7; kind++) {
    // ConvexGeometry always emits a closed hull with outward-facing triangles.
    // Keeping every variant on this path avoids the old open bent-strip meshes.
    const points: THREE.Vector3[] = [];
    const thickness = [0.22, 0.34, 0.7, 0.95, 0.6, 0.28, 0.42][kind];
    const elongation = [1, 1.15, 0.82, 1.28, 1.55, 1.9, 0.72][kind];
    const count = 6 + kind % 3;
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2;
      const r = 0.62 + random() * 0.38;
      const x = Math.cos(a) * r * elongation, z = Math.sin(a) * r;
      points.push(new THREE.Vector3(x, (random() - 0.5) * thickness * 0.35, z));
      points.push(new THREE.Vector3(x * (0.64 + random() * 0.12), thickness * (0.48 + random() * 0.26), z * (0.68 + random() * 0.14)));
      points.push(new THREE.Vector3(x * (0.7 + random() * 0.12), -thickness * (0.46 + random() * 0.2), z * (0.7 + random() * 0.12)));
    }
    const fragment = new ConvexGeometry(points);
    fragment.computeVertexNormals();
    validateClosedFragment(fragment);
    geometries.push(fragment);
  }
  const material = new THREE.MeshStandardMaterial({ color: "#d58b68", metalness: 0.96, roughness: 0.3 });
  const pile = new THREE.Group();
  pile.name = "CopperFragments";
  const batches = geometries.map(g => {
    const mesh = new THREE.InstancedMesh(g, material, 56);
    mesh.count = 0;
    mesh.castShadow = mesh.receiveShadow = true;
    pile.add(mesh);
    return mesh;
  });
  const settled: THREE.Mesh[] = [];
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const transform = new THREE.Object3D();
  const point = new THREE.Vector3();
  const tint = new THREE.Color();
  const baseMatrices: THREE.Matrix4[][] = batches.map(() => []);
  for (let i = 0; i < 56; i++) {
    const kind = i % 14 < 10 ? i % 5 : 5 + i % 2;
    const geometry = geometries[kind];
    const category = random();
    const variation = category < 0.22 ? 0.6 : category > 0.83 ? 1.3 + random() * 0.2 : 0.9 + random() * 0.2;
    const unit = radius * 0.17 * variation;
    transform.scale.set(unit * (0.85 + random() * 0.3), unit * (0.7 + random() * 0.6), unit * (0.8 + random() * 0.4));
    transform.rotation.set((random() - 0.5) * 1.1, random() * Math.PI * 2, (random() - 0.5) * 1.1);
    transform.position.set(0, 0, 0); transform.updateMatrix();
    const positions = geometry.getAttribute("position");
    const samples: THREE.Vector3[] = [];
    for (let v = 0; v < positions.count; v++) {
      point.fromBufferAttribute(positions, v).applyMatrix4(transform.matrix);
      if (!samples.some(p => p.distanceToSquared(point) < 1e-12)) samples.push(point.clone());
    }
    // The hull's raw vertices (6-8 per fragment) leave large flat faces
    // unchecked between them — a neighboring fragment could dip through
    // mid-face instead of resting on top, since only these sparse points get
    // raycast against `settled` below. Sampling each triangle's centroid too
    // gives the rest-height/containment checks coverage across the whole
    // surface, not just its corners.
    for (let f = 0; f < positions.count; f += 3) {
      const centroid = new THREE.Vector3()
        .fromBufferAttribute(positions, f)
        .add(new THREE.Vector3().fromBufferAttribute(positions, f + 1))
        .add(new THREE.Vector3().fromBufferAttribute(positions, f + 2))
        .divideScalar(3)
        .applyMatrix4(transform.matrix);
      if (!samples.some(p => p.distanceToSquared(centroid) < 1e-12)) samples.push(centroid);
    }
    const minY = Math.min(...samples.map(p => p.y));
    const maxY = Math.max(...samples.map(p => p.y));
    let best: THREE.Vector3 | undefined, bestScore = Infinity;
    for (let attempt = 0; attempt < 90; attempt++) {
      const a = random() * Math.PI * 2, r = Math.sqrt(random()) * radius * 0.83;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (samples.some(p => Math.hypot(x + p.x, z + p.z) > radius * 0.94)) continue;
      let y = bounds.min.y - minY;
      for (const p of samples) {
        ray.set(new THREE.Vector3(center.x + x + p.x, bounds.max.y + size.y, center.z + z + p.z), down);
        const hit = ray.intersectObjects(settled, false)[0];
        if (hit) y = Math.max(y, hit.point.y - p.y);
      }
      const top = y + maxY - bounds.min.y;
      if (top > size.y * (0.4 - 0.1 * r / radius)) continue;
      const score = y + r * 0.3 + random() * size.y * 0.016;
      if (score < bestScore) { bestScore = score; best = new THREE.Vector3(center.x + x, y, center.z + z); }
    }
    if (!best) continue; // Never force a fragment through the wall/fill ceiling.
    transform.position.copy(best); transform.updateMatrix();
    const batch = batches[kind], index = batch.count++;
    batch.setMatrixAt(index, transform.matrix);
    baseMatrices[kind][index] = transform.matrix.clone();
    batch.setColorAt(index, tint.setRGB(0.91 + random() * 0.09, 0.83 + random() * 0.14, 0.8 + random() * 0.16));
    const support = new THREE.Mesh(geometry, material);
    support.matrixAutoUpdate = false;
    support.matrix.copy(transform.matrix); support.updateMatrixWorld(true);
    settled.push(support);
  }
  batches.forEach(mesh => {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  });
  return { pile, baseMatrices, geometries, material };
}

// Deposition is deterministic and depends only on the GLTF cavity. Shelf,
// tray and workbench copies share its result, not its expensive raycasts.
const templates = new WeakMap<THREE.BufferGeometry, {
  template: ReturnType<typeof buildCopperTemplate>;
  users: number;
}>();

export function createCopperPile(cavity: THREE.BufferGeometry) {
  let entry = templates.get(cavity);
  if (!entry) {
    entry = { template: buildCopperTemplate(cavity), users: 0 };
    templates.set(cavity, entry);
  }
  entry.users += 1;
  const { template } = entry;
  // InstancedMesh.clone copies instance matrices/colors. Shaking one jar
  // must never move the fragments in another jar or in the cached template.
  const pile = template.pile.clone(true);
  const batches = pile.children as THREE.InstancedMesh[];
  const { baseMatrices } = template;
  const transform = new THREE.Object3D();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), extra = new THREE.Quaternion();
  const shakeEuler = new THREE.Euler();
  const shake = (tilt: number, strength: number, time: number) => {
    batches.forEach((batch, kind) => {
      for (let index = 0; index < batch.count; index++) {
        if ((index + kind * 3) % 3 !== 0) continue;
        const base = baseMatrices[kind][index];
        base.decompose(position, quaternion, scale);
        const phase = index * 1.71 + kind * 0.83;
        const wobble = Math.sin(time * 8 + phase) * 0.0012 * strength;
        position.x += wobble;
        position.z += Math.cos(time * 7 + phase) * 0.0005 * strength;
        extra.setFromEuler(shakeEuler.set(
          Math.sin(time * 6 + phase) * 0.045 * strength,
          0,
          tilt * (0.12 + (index % 4) * 0.06) * strength,
        ));
        quaternion.multiply(extra);
        transform.position.copy(position); transform.quaternion.copy(quaternion); transform.scale.copy(scale);
        transform.updateMatrix(); batch.setMatrixAt(index, transform.matrix);
      }
      batch.instanceMatrix.needsUpdate = true;
    });
  };
  let disposed = false;
  return { pile, shake, dispose: () => {
    if (disposed) return;
    disposed = true;
    batches.forEach(mesh => mesh.dispose());
    entry.users -= 1;
    if (entry.users === 0) {
      template.pile.children.forEach(mesh => (mesh as THREE.InstancedMesh).dispose());
      template.geometries.forEach(g => g.dispose());
      template.material.dispose();
      templates.delete(cavity);
    }
  } };
}
