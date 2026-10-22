import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5180');
  const png = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const { installReagentMaterials } = await import('/src/scenes/laboratory/lib/reagentMaterials.ts');
    const { REAGENTS } = await import('/src/entities/laboratory/reagents/index.ts');
    const asset = await new GLTFLoader().loadAsync('/assets/models/ReagentContainers.glb');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#bcc1c4');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(900, 500);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene.add(new THREE.HemisphereLight('#ffffff', '#727b85', 1.5));
    const light = new THREE.DirectionalLight('#ffffff', 3);
    light.position.set(-1, 2, 3);
    scene.add(light);
    ['cu', 'cu', 'cu'].forEach((id, index) => {
      const bottle = asset.scene.getObjectByName('ReagentJar_WideMouth_120ml').clone(true);
      installReagentMaterials(bottle, REAGENTS[id]);
      bottle.position.set(0, 0, 0); const box = new THREE.Box3().setFromObject(bottle); const center = box.getCenter(new THREE.Vector3()); bottle.position.sub(center); const pivot = new THREE.Group(); pivot.add(bottle); pivot.position.set((index - 1) * .085, .065, -index * .045); pivot.rotation.x = 0; scene.add(pivot);
      
    });
    const camera = new THREE.PerspectiveCamera(35, 1.8, .001, 10);
    camera.position.set(.0, .11, .65);
    camera.lookAt(0, .064, 0);
    renderer.render(scene, camera);
    const data = renderer.domElement.toDataURL();
    renderer.dispose();
    return data;
  });
  writeFileSync('tests/jar-glass-separation.png', Buffer.from(png.split(',')[1], 'base64'));
  console.log(JSON.stringify({ errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }



