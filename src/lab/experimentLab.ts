import * as THREE from "three";
import { TubeSilverField } from "../scenes/laboratory/lib/tubeSilverField";
import { makeSilverVolumeMaterial } from "../scenes/laboratory/lib/tubeSilverVolumeMaterial";

/**
 * Stand for watching experiment 2 (AgNO3 + NaCl) on a dark background, camera aimed straight at the tube,
 * with the customer's reference video next to it on one shared time axis.
 * It drives the same TubeSilverField and silver volume material as the game; the glass, the stream and the
 * pouring script are simplified.
 */
// Proportions of the reference video: the liquid column is about two tube diameters tall.
// Stage 3: cohesive Lagrangian flocs (use ?stage=1 for the older concentration-field model).
(window as unknown as { __silverStage?: number }).__silverStage = Number(new URLSearchParams(location.search).get("stage") ?? 3);
const RADIUS = 0.007, BOTTOM = 0, FIELD_HEIGHT = 0.034;
const LEVEL_START = 0.0262, LEVEL_END = new URLSearchParams(location.search).get("rise") === "1" ? 0.0278 : 0.0262;
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
let pourSeconds = pourParam === "fast" ? 2.2 : pourParam && Number(pourParam) > 0 ? Number(pourParam) : 3.0;
let speed = 1, paused = params.get("t") !== null;
let videoOffset = Number(params.get("voff") ?? 0), videoRate = 1;
const RATES = [1, 0.5, 2, 5];

// Diagnostic views (?view=): material (default), tracer (fluid + passive tracer + velocity vectors), source (where AgCl forms),
// nodes (aggregate nodes, links and component counts). The debug layers are drawn on a 2D canvas over the left pane.
const VIEW = params.get("view") ?? "material";
// Aggregation is off by default in the game; this viewer keeps showing it except in the fine-cloud view.
(window as unknown as { __silverAgg?: number }).__silverAgg = VIEW === "cloud" ? 0 : 1;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view"), hud = $<HTMLDivElement>("hud");
const video = $<HTMLVideoElement>("ref"), scrub = $<HTMLInputElement>("scrub"), clock = $<HTMLSpanElement>("clock");
const playButton = $<HTMLButtonElement>("play"), rateButton = $<HTMLButtonElement>("rate"), pourButton = $<HTMLButtonElement>("pour");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(20, 1, 0.05, 2);
const centerY = 0.0215;
camera.position.set(0, centerY, 0.135);
camera.lookAt(0, centerY, 0);

// Glass tube: open cylinder, hemispherical bottom, with a rim-lit transparent shader.
const glassMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.6); gl_FragColor = vec4(vec3(0.72,0.82,0.9), 0.03+0.55*f); }`,
});
const wall = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 1.06, RADIUS * 1.06, 0.045, 64, 1, true), glassMaterial);
wall.position.y = BOTTOM + RADIUS + 0.0225;
const bowl = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.06, 64, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glassMaterial);
bowl.position.y = BOTTOM + RADIUS;
scene.add(wall, bowl);

const surface = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 48),
  new THREE.MeshBasicMaterial({ color: 0x9fb7c8, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
surface.rotation.x = -Math.PI / 2;
surface.renderOrder = -2;
scene.add(surface);
const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0007, 1, 12),
  new THREE.MeshBasicMaterial({ color: 0xe8f3ff, transparent: true, opacity: 0.85, depthWrite: false }));
stream.renderOrder = 5;
scene.add(stream);

const silver = makeSilverVolumeMaterial(RADIUS, BOTTOM, FIELD_HEIGHT);
let field: TubeSilverField;
const volume = new THREE.Mesh(new THREE.BoxGeometry(2.4 * RADIUS, FIELD_HEIGHT + 0.75 * RADIUS, 2.4 * RADIUS), silver.material);
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
  silver.material.uniforms.uCloudOn.value = VIEW === "cloud" ? 1 : 0;
  silver.material.uniforms.uFlocOn.value = VIEW === "cloud" ? 0 : 1;
  silver.material.uniforms.uDiag.value = new URLSearchParams(location.search).get("silverDiag") === "tracer" ? 1 : 0;
  simTime = 0; poured = 0;
}

const levelAt = (t: number) => LEVEL_START + (LEVEL_END - LEVEL_START) * THREE.MathUtils.smoothstep(t, 0, pourSeconds);

function stepSim(dt: number) {
  const delivery = Math.min(1, simTime / pourSeconds);
  const level = levelAt(simTime);
  inlet.set(RADIUS * 0.7, level, 0);
  field.advance(dt, up, level, inlet, delivery, 0, 0.33, down);
  simTime += dt; poured = delivery;
}

const dbg = document.getElementById("dbg") as HTMLCanvasElement;
const project = (x: number, y: number, v = new THREE.Vector3()) => { v.set(x, y, 0).project(camera); return [(v.x * 0.5 + 0.5) * dbg.width, (1 - (v.y * 0.5 + 0.5)) * dbg.height] as const; };
function drawDiagnostics() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (dbg.width !== w || dbg.height !== h) { dbg.width = w; dbg.height = h; }
  const g = dbg.getContext("2d")!; g.clearRect(0, 0, w, h);
  if (VIEW === "material") return;
  const m = field.mask, R = RADIUS;
  const cell = (x: number, y: number, z: number) => m.index(x, y, z);
  const colour = (t: number) => { const c = Math.max(0, Math.min(1, t)); return `rgb(${Math.round(255 * Math.min(1, c * 2))},${Math.round(255 * Math.max(0, Math.min(1, c * 2 - 0.5)))},${Math.round(255 * (1 - c) * 0.8)})`; };
  if (VIEW === "fields") {
    // Diagnostic B: dissolved Ag+, dissolved Cl- and their local overlap, summed along the line of sight.
    const ag = field.species["Ag+"].values, cl = field.species["Cl-"].values;
    const panels: [string, (i: number) => number][] = [["Ag+", i => ag[i]], ["Cl-", i => cl[i]], ["перекрытие Ag+ x Cl-", i => Math.min(ag[i], cl[i])]];
    const pw = w / 3, cw = pw * 0.7 / m.nx, ch = Math.min(h * 0.8 / m.ny, cw * 2.2);
    panels.forEach(([name, value], k) => {
      const col = new Float64Array(m.nx * m.ny); let max = 1e-12;
      for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) { let sum = 0; for (let z = 0; z < m.nz; z++) { const i = cell(x, y, z); if (m.data[i]) sum += value(i); } col[y * m.nx + x] = sum; max = Math.max(max, sum); }
      const x0 = k * pw + pw * 0.15, y0 = h * 0.9;
      for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
        const wet = m.data[cell(x, y, Math.floor(m.nz / 2))]; if (!wet) continue;
        const v = col[y * m.nx + x] / (k === 0 ? Math.max(max, 1e-12) : max);
        g.fillStyle = k === 0 ? `rgb(${Math.round(40 + 160 * v)},${Math.round(60 + 120 * v)},${Math.round(90 + 60 * v)})` : colour(v);
        g.fillRect(x0 + x * cw, y0 - (y + 1) * ch, cw + 0.5, ch + 0.5);
      }
      g.fillStyle = "#fff"; g.font = "13px system-ui"; g.fillText(name, x0, y0 - m.ny * ch - 8);
      const levelY = y0 - (m.ny - 5) * ch; void levelY;
    });
    g.fillText("Диагностика B: растворённые поля (сумма по глубине), первое Cl- у точки удара", 10, h - 8);
  }
  if (VIEW === "tracer" || VIEW === "source" || VIEW === "dense") {
    const values = VIEW === "tracer" ? field.tracer : VIEW === "dense" ? Float32Array.from({ length: m.data.length }, (_, i) => field.densePixels[i * 4]) : field.productSource;
    let max = 1e-12; const col = new Float64Array(m.nx * m.ny);
    for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) { let sum = 0; for (let z = 0; z < m.nz; z++) { const i = cell(x, y, z); if (m.data[i]) sum += values[i]; } col[y * m.nx + x] = sum; max = Math.max(max, sum); }
    for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
      const v = col[y * m.nx + x] / max; if (v <= 0.01) continue;
      const [x0, y0] = project((x / m.nx * 2 - 1) * R, y / m.ny * m.height), [x1, y1] = project(((x + 1) / m.nx * 2 - 1) * R, (y + 1) / m.ny * m.height);
      g.fillStyle = colour(v); g.globalAlpha = 0.85; g.fillRect(x0, y1, x1 - x0 + 0.5, y0 - y1 + 0.5);
    }
    g.globalAlpha = 1;
    if (VIEW === "tracer") {
      g.strokeStyle = "#00ffd0"; g.fillStyle = "#00ffd0"; g.lineWidth = 1.2;
      for (let y = 1; y < m.ny; y += 2) for (let x = 1; x < m.nx; x += 2) {
        let ux = 0, uy = 0, n = 0;
        for (let z = 0; z < m.nz; z++) { const i = cell(x, y, z); if (!m.data[i]) continue; ux += field.solver.flow[i * 3]; uy += field.solver.flow[i * 3 + 1]; n++; }
        if (!n) continue; ux /= n; uy /= n;
        const [px, py] = project(((x + 0.5) / m.nx * 2 - 1) * R, (y + 0.5) / m.ny * m.height);
        const scale = 9000; g.beginPath(); g.moveTo(px, py); g.lineTo(px + ux * scale, py - uy * scale); g.stroke();
        g.fillRect(px - 1, py - 1, 2.4, 2.4);
      }
    }
    g.fillStyle = "#fff"; g.font = "13px system-ui";
    g.fillText(VIEW === "dense" ? "Диагностика 5: плотность осадка в сетке (z-сумма), сетка видна" : VIEW === "tracer" ? "Диагностика 1: пассивный трассер (z-сумма) и векторы скорости (z-среднее)" : "Диагностика 2: где образуется AgCl (z-сумма источника)", 10, h - 12);
  }
  if (VIEW === "nodes" || VIEW === "nodes-over") {
    const sys = field.flocSystem; if (!sys) return;
    const comps = new Map<number, number>(); const parent = sys.nodes.map((_, i) => i);
    const find = (a: number): number => parent[a] === a ? a : (parent[a] = find(parent[a]));
    for (const l of sys.links) parent[find(l.a)] = find(l.b);
    for (let i = 0; i < parent.length; i++) comps.set(find(i), (comps.get(find(i)) ?? 0) + 1);
    const ids = [...comps.keys()]; const hue = (r: number) => `hsl(${(ids.indexOf(r) * 67) % 360},85%,60%)`;
    g.lineWidth = 1.4;
    for (const l of sys.links) { const a = sys.nodes[l.a], b = sys.nodes[l.b]; const [ax, ay] = project(a.x, a.y), [bx, by] = project(b.x, b.y); const stretch = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / l.rest; g.strokeStyle = stretch > 1.3 ? "#ff5050" : "#ffffff88"; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
    for (let i = 0; i < sys.nodes.length; i++) { const n = sys.nodes[i]; const [px, py] = project(n.x, n.y); const r = Math.max(2, 1500 * Math.cbrt(n.mass) * 0.12); g.fillStyle = hue(find(i)); g.globalAlpha = 0.7; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.fillStyle = "#fff"; g.font = "13px system-ui";
    const sizes = [...comps.values()].sort((a, b) => b - a);
    let stretched = 0; for (const l of sys.links) { const a = sys.nodes[l.a], b = sys.nodes[l.b]; if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / l.rest > 1.3) stretched++; }
    g.fillText(`Диагностика 3: узлы ${sys.nodes.length}, связи ${sys.links.length} (растянуты >1.3: ${stretched}), компонентов ${comps.size}, крупнейшие ${sizes.slice(0, 5).join(",")}`, 10, h - 12);
  }
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
    const top = level + 0.03;
    // The stream ends exactly at the liquid surface: whatever happens below is the mixing, not a drawn column.
    stream.scale.set(1, top - level, 1);
    stream.position.set(inlet.x, (top + level) / 2, 0);
  }
  const w = canvas.clientWidth, h = canvas.clientHeight, ratio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); layoutVideo();
  }
  volume.visible = VIEW === "material" || VIEW === "fields" && false || VIEW === "cloud" || VIEW === "nodes-over";
  renderer.render(scene, camera);
  drawDiagnostics();
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
pourButton.onclick = () => { pourSeconds = pourSeconds > 3.5 ? 3.0 : 5.0; pourButton.textContent = `налив: ${pourSeconds > 3.5 ? "медленно" : "как в ролике"}`; restart(); syncVideo(true); };
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
