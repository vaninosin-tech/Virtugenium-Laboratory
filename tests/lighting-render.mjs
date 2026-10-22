import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage();
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5180');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { LiquidMaterial } = await import('/src/scenes/laboratory/lib/reagentMaterials.ts');
    const { createWallLightingMaterial } = await import('/src/scenes/laboratory/lib/wallLightingMaterial.ts');
    const { RectAreaLightUniformsLib } = await import('/node_modules/three/examples/jsm/lights/RectAreaLightUniformsLib.js');
    RectAreaLightUniformsLib.init();
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(128, 128);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 10);
    camera.position.set(0, .05, .23);
    camera.lookAt(0, 0, 0);
    const geometry = new THREE.CylinderGeometry(.03, .03, .06, 32);
    const material = new LiquidMaterial(geometry, { color: '#7bc4eb', opacity: .5 });
    scene.add(new THREE.Mesh(geometry, material));
    const light = new THREE.RectAreaLight('#ffffff', 4, 1, 1);
    light.position.set(0, .3, .2);
    light.lookAt(0, 0, 0);
    scene.add(light);
    const target = new THREE.WebGLRenderTarget(128, 128);
    renderer.setRenderTarget(target);
    const sample = () => {
      renderer.render(scene, camera);
      const pixels = new Uint8Array(128 * 128 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      return sum;
    };
    const on = sample();
    light.intensity = 0;
    const off = sample();
    const spot = new THREE.SpotLight('#fff4df', 1, 2.4, Math.PI * .43, .65, 2);
    spot.position.set(0, .3, .2);
    scene.add(spot, spot.target);
    const hoodOn = sample();
    spot.intensity = 0;
    const hoodOff = sample();
    const source = new THREE.MeshStandardMaterial({ color: '#c7cac4' });
    const wall = createWallLightingMaterial(source);
    scene.children.find(object => object.isMesh).material = wall;
    light.intensity = 4;
    const wallOn = sample();
    light.intensity = 0;
    const wallOff = sample();
    source.dispose(); wall.dispose();
    target.dispose(); geometry.dispose(); material.dispose(); renderer.dispose();
    return { on, off, hoodOn, hoodOff, wallOn, wallOff };
  });
  console.log(JSON.stringify({ result, errors }));
  if (errors.length || result.on <= result.off || result.hoodOn <= result.hoodOff || result.wallOn <= result.wallOff) process.exitCode = 1;
} finally {
  await browser.close();
}
