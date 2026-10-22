import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/i.test(m.text())) errors.push(m.text()); });
  await page.goto('http://localhost:5180');
  const png = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const { RoomEnvironment } = await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js');
    const { prepareTrayMaterials } = await import('/src/scenes/laboratory/lib/trayMaterials.ts');
    const asset = await new GLTFLoader().loadAsync('/assets/models/LabTray_Metal.glb');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1000, 600);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#aeb5bb');
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room);
    scene.environment = environment.texture;
    scene.environmentIntensity = 2;
    const light = new THREE.DirectionalLight('#ffffff', 4);
    light.position.set(0, 3, 1);
    scene.add(light);
    const box = new THREE.Box3().setFromObject(asset.scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const cleanups = [];
    for (let i = 0; i < 2; i++) {
      const tray = asset.scene.clone(true);
      tray.position.sub(center);
      tray.position.x += (i - .5) * size.x * 1.15;
      if (i === 1) cleanups.push(prepareTrayMaterials(tray));
      scene.add(tray);
    }
    const camera = new THREE.PerspectiveCamera(38, 1000 / 600, .001, 100);
    camera.position.set(0, size.x * 2.1, size.x * 2.5);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    const data = renderer.domElement.toDataURL();
    cleanups.forEach(cleanup => cleanup());
    environment.dispose(); room.dispose(); pmrem.dispose(); renderer.dispose();
    return data;
  });
  writeFileSync('tests/tray-material-render.png', Buffer.from(png.split(',')[1], 'base64'));
  console.log(JSON.stringify({ errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
