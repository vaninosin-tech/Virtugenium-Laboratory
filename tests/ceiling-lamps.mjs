import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5180/lab');
  await page.waitForTimeout(5000);
  const result = await page.evaluate(async () => {
    const fiber = await import('/node_modules/.vite/deps/@react-three_fiber.js');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { scene, camera } = fiber._roots.get(document.querySelector('canvas')).store.getState();
    const view = camera.clone();
    view.position.set(0, 1.6, 0);
    view.lookAt(0, 3.08, .9);
    view.aspect = 1.5;
    view.updateProjectionMatrix();
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true });
    renderer.setSize(900, 600);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const panels = [];
    scene.updateMatrixWorld(true);
    for (let i = 1; i <= 6; i++) {
      const panel = scene.getObjectByName(`LED_Panel_0${i}_Diffuser`);
      const center = new THREE.Box3().setFromObject(panel).getCenter(new THREE.Vector3());
      const ray = new THREE.Raycaster(new THREE.Vector3(center.x, 2.95, center.z), new THREE.Vector3(0, 1, 0), 0, .3);
      const hit = ray.intersectObject(scene, true).find(hit => hit.object.isMesh);
      panels.push({ name: panel.name, firstHit: hit?.object.name, emission: panel.material.emissiveIntensity });
    }
    renderer.render(scene, view);
    const on = renderer.domElement.toDataURL();
    scene.traverse(object => {
      if (/^LED_Panel_\d+_Diffuser$/.test(object.name)) object.material.emissiveIntensity = 0;
    });
    renderer.render(scene, view);
    const off = renderer.domElement.toDataURL();
    renderer.dispose();
    return { panels, on, off };
  });
  for (const state of ['on', 'off']) writeFileSync(`tests/ceiling-lamps-${state}.png`, Buffer.from(result[state].split(',')[1], 'base64'));
  console.log(JSON.stringify(result.panels));
  if (result.panels.some(panel => panel.name !== panel.firstHit || panel.emission <= 0)) process.exitCode = 1;
} finally { await browser.close(); }
