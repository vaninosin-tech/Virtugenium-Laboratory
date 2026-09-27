import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Usage: node tests/measure-model.mjs public/assets/models/BunsenStand.glb
//
// Same idea as measure-cabinet.mjs / measure-tray.mjs, generalised: prints the
// whole bbox plus every named node's own world bbox, and the world position of
// empty anchors (which have no geometry and so no bbox of their own). Use it
// before hardcoding any in-model offset — the assets carry more anchors than
// the code currently uses.
const path = process.argv[2];
if (!path) {
  console.error('usage: node tests/measure-model.mjs <path-to.glb>');
  process.exit(1);
}

const b = fs.readFileSync(path);
const a = await new GLTFLoader().parseAsync(
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  '',
);
a.scene.updateMatrixWorld(true);

const round = (n) => +n.toFixed(4);
const whole = new THREE.Box3().setFromObject(a.scene);
console.log(`=== ${path} ===`);
console.log('min ', whole.min.toArray().map(round));
console.log('max ', whole.max.toArray().map(round));
console.log('size', whole.getSize(new THREE.Vector3()).toArray().map(round));

console.log('\n=== NODES ===');
a.scene.traverse((o) => {
  if (!o.name) return;
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) {
    const p = o.getWorldPosition(new THREE.Vector3()).toArray().map(round);
    console.log(`${o.type.padEnd(9)} ${o.name.padEnd(32)} ANCHOR pos:[${p.join(', ')}]`);
    return;
  }
  const min = box.min.toArray().map(round);
  const max = box.max.toArray().map(round);
  const size = box.getSize(new THREE.Vector3()).toArray().map(round);
  console.log(
    `${o.type.padEnd(9)} ${o.name.padEnd(32)} x:${min[0]}..${max[0]}  y:${min[1]}..${max[1]}  z:${min[2]}..${max[2]}  size:${size.join(' x ')}`,
  );
});
