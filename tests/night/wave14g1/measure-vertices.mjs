import fs from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const bytes = fs.readFileSync('public/assets/models/LabTestTube.glb');
const scene = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
scene.traverse(object => {
  if (!object.isMesh) return;
  const rows = new Map();
  const position = object.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = Math.round(position.getY(i) * 1e5) / 1e5;
    const r = Math.round(Math.hypot(position.getX(i), position.getZ(i)) * 1e5) / 1e5;
    if (!rows.has(y)) rows.set(y, new Set());
    rows.get(y).add(r);
  }
  console.log(object.name, 'scale', object.scale.toArray(), 'parent', object.parent?.name, 'vertices', position.count);
  console.log([...rows].sort((a, b) => a[0] - b[0]).map(([y, radii]) => [y, [...radii].sort((a, b) => a - b)]));
});
