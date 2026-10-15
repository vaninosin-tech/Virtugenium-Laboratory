import * as THREE from "three";
import { TubeSilverField } from "../scenes/laboratory/lib/tubeSilverField";
import { makeSilverVolumeMaterial } from "../scenes/laboratory/lib/tubeSilverVolumeMaterial";

/**
 * Stand for watching experiment 2 (AgNO3 + NaCl) on a dark background, camera aimed straight at the tube,
 * with the customer's reference video next to it on one shared time axis.
 * It drives the same TubeSilverField and silver volume material as the game; the glass, the stream and the
 * pouring script are simplified.
 */
const RADIUS = 0.007, BOTTOM = 0, FIELD_HEIGHT = 0.1105;
const LEVEL_START = 0.062, LEVEL_END = 0.077;
// The reference video is time-lapsed: x1 up to 6.25 s of video, x5 until 9.4 s, x50 afterwards (on-screen labels).
const SPEED_STEPS = [{ video: 6.25, real: 6.25 }, { video: 9.4, real: 6.25 + 3.15 * 5 }];
const MAX_TIME = 180;
function videoFromReal(t: number) {
  if (t <= SPEED_STEPS[0].real) return t;
  if (t <= SPEED_STEPS[1].real) return SPEED_STEPS[0].video + (t - SPEED_STEPS[0].real) / 5;
  return Math.min(19.4, SPEED_STEPS[1].video + (t - SPEED_STEPS[1].real) / 50);
}
const params = new URLSearchParams(location.search);
const pourParam = params.get("pour");
let pourSeconds = pourParam === "fast" ? 2.2 : pourParam && Number(pourParam) > 0 ? Number(pourParam) : 1.5;
let speed = 1, paused = params.get("t") !== null;
let videoOffset = Number(params.get("voff") ?? 0), videoRate = 1;
const RATES = [1, 0.5, 2, 5];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view"), hud = $<HTMLDivElement>("hud");
const video = $<HTMLVideoElement>("ref"), scrub = $<HTMLInputElement>("scrub"), clock = $<HTMLSpanElement>("clock");
const playButton = $<HTMLButtonElement>("play"), rateButton = $<HTMLButtonElement>("rate"), pourButton = $<HTMLButtonElement>("pour");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(20, 1, 0.05, 2);
const centerY = 0.0475;
camera.position.set(0, centerY, 0.285);
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
let simTime = 0, poured = 0, dragging = false;

function restart() {
  field?.dispose();
  field = new TubeSilverField("HIGH", RADIUS, BOTTOM, FIELD_HEIGHT);
  silver.material.uniforms.uDense.value = field.denseTexture;
  silver.material.uniforms.uOverlap.value = field.overlapTexture;
  silver.material.uniforms.uHaze.value = field.texture;
  silver.material.uniforms.uTint.value = field.tintTexture;
  silver.material.uniforms.uChip.value = field.chipTexture;
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

/** The tube fills the pane's height in both halves; the video is cropped so the tube sits in the middle. */
function layoutVideo() {
  const box = video.parentElement as HTMLElement;
  const scale = box.clientHeight / 360;
  video.style.width = `${640 * scale}px`; video.style.height = `${360 * scale}px`;
  video.style.left = `${box.clientWidth / 2 - 323 * scale}px`;
}

function videoTarget() { return Math.max(0, Math.min(video.duration || 19.4, videoFromReal(simTime * videoRate) + videoOffset)); }

function syncVideo(force = false) {
  const target = videoTarget();
  if (paused || force) {
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - target) > 0.03) video.currentTime = target;
  } else {
    // The reference runs at x1, x5 and x50 in different parts: follow the mapped target by seeking.
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target;
  }
}

function draw() {
  const level = levelAt(simTime);
  silver.material.uniforms.uLevel.value = level;
  silver.material.uniforms.uTime.value = simTime;
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
  const w = canvas.clientWidth, h = canvas.clientHeight, ratio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); layoutVideo();
  }
  renderer.render(scene, camera);
  hud.textContent = `налив ${(poured * 100).toFixed(0)}%   осадок ${(field.extent * 100).toFixed(0)}%`;
  clock.textContent = `t = ${simTime.toFixed(1)} с   |   видео ${videoTarget().toFixed(1)} с (сдвиг ${videoOffset >= 0 ? "+" : ""}${videoOffset.toFixed(1)}, x${videoRate})`;
  if (!dragging) scrub.value = String(Math.min(MAX_TIME, simTime));
  playButton.textContent = paused ? "Играть" : "Пауза";
}

/** Run the simulation to time t (restarting if t is in the past); resolves when the video frame is ready. */
async function seek(t: number) {
  if (t < simTime - 1e-9) restart();
  while (simTime + 1e-9 < t) stepSim(0.05);
  draw(); syncVideo(true);
  if (video.readyState < 2 || video.seeking) await new Promise<void>(resolve => {
    const done = () => { video.removeEventListener("seeked", done); resolve(); };
    video.addEventListener("seeked", done); setTimeout(done, 1500);
  });
}

const win = window as unknown as Record<string, unknown>;
win.__labSeek = seek;
win.__labState = () => ({ simTime, poured, extent: field.extent, video: video.currentTime });

restart();
layoutVideo();
window.addEventListener("resize", layoutVideo);
video.addEventListener("loadedmetadata", () => { layoutVideo(); syncVideo(true); });

playButton.onclick = () => { paused = !paused; syncVideo(); };
$("restart").onclick = () => { restart(); paused = false; syncVideo(true); };
$("vminus").onclick = () => { videoOffset -= 0.5; syncVideo(true); };
$("vplus").onclick = () => { videoOffset += 0.5; syncVideo(true); };
rateButton.onclick = () => { videoRate = RATES[(RATES.indexOf(videoRate) + 1) % RATES.length]; rateButton.textContent = `скорость видео x${videoRate}`; syncVideo(true); };
pourButton.onclick = () => { pourSeconds = pourSeconds > 1.8 ? 1.5 : 4.5; pourButton.textContent = `налив: ${pourSeconds > 1.8 ? "медленно" : "быстро"}`; restart(); syncVideo(true); };
scrub.addEventListener("input", () => { dragging = true; clock.textContent = `перемотка: ${scrub.value} с`; });
scrub.addEventListener("change", async () => { paused = true; await seek(Number(scrub.value)); dragging = false; });
window.addEventListener("keydown", event => {
  if (event.code === "Space") { event.preventDefault(); paused = !paused; syncVideo(); }
  else if (event.key === "ArrowRight") void seek(simTime + 1);
  else if (event.key === "ArrowLeft") void seek(Math.max(0, simTime - 1));
});

const seekParam = params.get("t");
if (seekParam !== null) {
  void seek(Number(seekParam)).then(() => { document.title = "ready"; });
} else {
  document.title = "running";
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000) * speed; last = now;
    if (!paused) {
      stepSim(dt);
      if (simTime >= MAX_TIME) { paused = true; syncVideo(); }
      syncVideo();
    }
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
