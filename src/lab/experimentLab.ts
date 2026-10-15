import * as THREE from "three";
import { TubeSilverField } from "../scenes/laboratory/lib/tubeSilverField";
import { makeSilverVolumeMaterial } from "../scenes/laboratory/lib/tubeSilverVolumeMaterial";

/**
 * Stand for watching experiment 2 (AgNO3 + NaCl) on a dark background, camera aimed straight at the tube.
 * It drives the same TubeSilverField and the same silver volume material as the game; only the glass,
 * the stream and the pouring script are simplified.
 */
const RADIUS = 0.007, BOTTOM = 0, FIELD_HEIGHT = 0.1105;
const LEVEL_START = 0.062, LEVEL_END = 0.077;
const params = new URLSearchParams(location.search);
let pourSeconds = params.get("pour") === "fast" ? 2.2 : 4.5;
let speed = 1, paused = false;

const canvas = document.getElementById("view") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(22, 1, 0.05, 2);
const centerY = 0.047;
camera.position.set(0, centerY, 0.33);
camera.lookAt(0, centerY, 0);

// Glass tube: open cylinder, hemispherical bottom, with a rim-lit transparent shader.
const glassMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.6); gl_FragColor = vec4(vec3(0.72,0.82,0.9), 0.03+0.55*f); }`,
});
const wall = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 1.06, RADIUS * 1.06, 0.1, 64, 1, true), glassMaterial);
wall.position.y = BOTTOM + RADIUS + 0.05;
const bowl = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.06, 64, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glassMaterial);
bowl.position.y = BOTTOM + RADIUS;
scene.add(wall, bowl);

// Liquid surface and the pouring stream.
const surface = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 48),
  new THREE.MeshBasicMaterial({ color: 0x9fb7c8, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
surface.rotation.x = -Math.PI / 2;
scene.add(surface);
const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0007, 1, 12),
  new THREE.MeshBasicMaterial({ color: 0xe8f3ff, transparent: true, opacity: 0.85, depthWrite: false }));
stream.renderOrder = 5;
scene.add(stream);

const silver = makeSilverVolumeMaterial(RADIUS, BOTTOM, FIELD_HEIGHT);
let field: TubeSilverField;
const volume = new THREE.Mesh(new THREE.BoxGeometry(2.4 * RADIUS, FIELD_HEIGHT + 0.3 * RADIUS, 2.4 * RADIUS), silver.material);
volume.position.y = BOTTOM + FIELD_HEIGHT * 0.5;
volume.renderOrder = -0.25;
scene.add(volume);

const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
const inlet = new THREE.Vector3();
let simTime = 0, poured = 0;

function restart() {
  field?.dispose();
  field = new TubeSilverField("HIGH", RADIUS, BOTTOM, FIELD_HEIGHT);
  silver.material.uniforms.uDense.value = field.denseTexture;
  silver.material.uniforms.uOverlap.value = field.overlapTexture;
  simTime = 0; poured = 0;
}

const levelAt = (t: number) => LEVEL_START + (LEVEL_END - LEVEL_START) * THREE.MathUtils.smoothstep(t, 0, pourSeconds);

function stepSim(dt: number) {
  const delivery = Math.min(1, simTime / pourSeconds);
  const level = levelAt(simTime);
  inlet.set(RADIUS * 0.7, level - 0.0007, 0);
  field.advance(dt, up, level, inlet, delivery, 0, 1, down);
  simTime += dt; poured = delivery;
}

function draw() {
  const level = levelAt(simTime);
  silver.material.uniforms.uLevel.value = level;
  silver.material.uniforms.uUp.value.copy(up);
  silver.camera.value.copy(camera.position);
  surface.position.y = level;
  const pouring = simTime < pourSeconds;
  stream.visible = pouring;
  if (pouring) {
    const top = level + 0.06;
    stream.scale.set(1, top - level + 0.003, 1);
    stream.position.set(inlet.x, (top + level - 0.003) / 2, 0);
  }
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
  const d = field.diagnostics();
  hud.textContent = `t = ${simTime.toFixed(1)} с   налив ${(poured * 100).toFixed(0)}%   осадок ${(field.extent * 100).toFixed(0)}%   скорость x${speed}${paused ? "   ПАУЗА" : ""}\n`
    + `налив ${pourSeconds > 3 ? "медленно" : "быстро"}`;
  void d;
}

(window as unknown as { __labSeek: (t: number) => void }).__labSeek = (t: number) => {
  while (simTime + 1e-9 < t) stepSim(0.05);
  draw();
};
(window as unknown as { __labState: () => unknown }).__labState = () => ({ simTime, poured, extent: field.extent });

restart();
const seek = params.get("t");
if (seek !== null) {
  (window as unknown as { __labSeek: (t: number) => void }).__labSeek(Number(seek));
  paused = true;
  document.title = "ready";
} else {
  document.title = "running";
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000) * speed; last = now;
    if (!paused) stepSim(dt);
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
window.addEventListener("keydown", event => {
  if (event.code === "Space") paused = !paused;
  else if (event.key === "r" || event.key === "R") restart();
  else if (event.key === "1") speed = 0.5;
  else if (event.key === "2") speed = 1;
  else if (event.key === "3") speed = 2;
  else if (event.key === "p" || event.key === "P") { pourSeconds = pourSeconds > 3 ? 2.2 : 4.5; restart(); }
});
