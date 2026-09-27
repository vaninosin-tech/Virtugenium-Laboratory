import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /NaN|WebGLProgram|shader error/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('http://localhost:5180/lab');
  await page.waitForFunction(() => window.__labScene && window.__trayCamera, { timeout: 60000 });
  const trayStart = await page.evaluate(async () => {
    const { useReagentPickablesStore } = await import('/src/scenes/laboratory/lib/useReagentPickablesStore.ts');
    return useReagentPickablesStore.getState().objectsById['held-tray'].position.toArray();
  });
  await page.evaluate(async () => {
    const { useSceneInteractionStore } = await import('/src/scenes/laboratory/lib/useSceneInteractionStore.ts');
    useSceneInteractionStore.getState().beginCabinetFocus('cabinet-simple');
  });
  await page.waitForTimeout(120);
  const trayDuringFocus = await page.evaluate(async () => {
    const { useReagentPickablesStore } = await import('/src/scenes/laboratory/lib/useReagentPickablesStore.ts');
    const { useSceneInteractionStore } = await import('/src/scenes/laboratory/lib/useSceneInteractionStore.ts');
    return {
      phase: useSceneInteractionStore.getState().cabinetPhase,
      position: useReagentPickablesStore.getState().objectsById['held-tray'].position.toArray(),
    };
  });
  assert.equal(trayDuringFocus.phase, 'focusing');
  assert.notDeepEqual(trayDuringFocus.position, trayStart);
  await page.waitForFunction(async () => {
    const { useSceneInteractionStore } = await import('/src/scenes/laboratory/lib/useSceneInteractionStore.ts');
    return useSceneInteractionStore.getState().cabinetPhase === 'inspecting';
  }, { timeout: 60000 });
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { useReagentInspectionStore } = await import('/src/scenes/laboratory/lib/useReagentInspectionStore.ts');
    const camera = window.__trayCamera;
    const position = camera.position.clone().add(new THREE.Vector3(0, 0, -.6).applyQuaternion(camera.quaternion));
    useReagentInspectionStore.getState().open('cabinet-simple-cu', position.toArray(), camera.quaternion.toArray(), 2);
  });
  await page.locator('[data-dev-pick-id="inspection:right"]').click();
  await page.waitForFunction(async () => {
    const { useReagentStorageStore } = await import('/src/scenes/laboratory/lib/useReagentStorageStore.ts');
    return useReagentStorageStore.getState().trayItems.some(item => item.instanceId === 'cabinet-simple-cu');
  }, { timeout: 30000 });
  await page.waitForFunction(() => window.__inspectionStore.getState().inspectedId === null);
  const invalid = await page.evaluate(() => {
    const invalid = [];
    window.__labScene.updateMatrixWorld(true);
    window.__labScene.traverse(object => {
      if (!object.matrixWorld.elements.every(Number.isFinite)) invalid.push(object.name || object.type);
    });
    return invalid;
  });
  await page.screenshot({ path: 'tests/reagent-take.png' });
  assert.deepEqual(errors, []);
  assert.deepEqual(invalid, []);
  assert.equal(await page.locator('canvas').count(), 1);
  console.log('PASS: take button transfers Cu to tray; inspection closes; no runtime errors or invalid transforms.');
} finally {
  await browser.close();
}
