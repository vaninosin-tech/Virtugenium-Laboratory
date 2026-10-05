import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const quality = process.env.VISUAL_QUALITY ?? 'HIGH';
const out = process.env.VISUAL_OUT ?? `tmp/visual/30f/bottles/${quality}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: 'chrome',
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1600,900'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && /shader|webgl|program/i.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(mode => localStorage.setItem('virtugenium.runtime-quality.v1', mode), quality);
  await page.goto(process.env.VISUAL_URL ?? 'http://127.0.0.1:5173');
  await page.getByText('Играть', { exact: true }).click();
  await page.getByText('Песочница (временно)').click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === 'inspecting', null, { timeout: 90000 });
  await page.getByText('Лаборатория готова').waitFor({ state: 'hidden', timeout: 90000 });
  await page.evaluate(async mode => {
    const { useRuntimeQualityStore } = await import('/src/scenes/laboratory/lib/useRuntimeQualityStore.ts');
    useRuntimeQualityStore.getState().setMode(mode);
  }, quality);
  for (const [cabinet, ids] of [
    ['cabinet-salts', ['k2so4', 'kmno4']],
    ['cabinet-acids', ['hno3']],
  ]) {
    if (process.env.VISUAL_ONLY && !ids.some(id => process.env.VISUAL_ONLY.split(',').includes(id))) continue;
    await page.evaluate(id => window.__sceneStore.getState().beginCabinetFocus(id), cabinet);
    await page.waitForFunction(id => window.__sceneStore.getState().focusedCabinetId === id &&
      window.__sceneStore.getState().cabinetPhase === 'inspecting', cabinet, { timeout: 30000 });
    await page.waitForTimeout(1500);
    for (const reagent of ids) {
      if (process.env.VISUAL_ONLY && !process.env.VISUAL_ONLY.split(',').includes(reagent)) continue;
      const id = `${cabinet}-${reagent}`;
      for (const degrees of [0, 30, 60]) {
        await page.evaluate(async ({ id, degrees }) => {
          const THREE = await import('/node_modules/three/build/three.module.js');
          const { useReagentInspectionStore } = await import('/src/scenes/laboratory/lib/useReagentInspectionStore.ts');
          const camera = window.__trayCamera;
          let group;
          window.__labScene.traverse(o => { if (o.userData?.inspectionId === id) group = o; });
          if (!group) throw new Error(`Bottle group missing: ${id}`);
          group.updateWorldMatrix(true, false);
          const position = camera.position.clone()
            .add(new THREE.Vector3(0, -0.035, -0.85).applyQuaternion(camera.quaternion));
          const orientation = group.getWorldQuaternion(new THREE.Quaternion());
          orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0),
            Math.PI));
          const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,
            THREE.MathUtils.degToRad(degrees)));
          useReagentInspectionStore.getState().open(id, position.toArray(), orientation.toArray(), 2.0);
        }, { id, degrees });
        await page.waitForTimeout(2600);
        await page.screenshot({ path: `${out}/${reagent}-hand-${degrees}.png` });
        console.log('Captured', reagent, degrees);
        await page.evaluate(() => window.__inspectionStore.getState().requestClose());
        await page.waitForFunction(() => window.__inspectionStore.getState().inspectedId === null, null, { timeout: 10000 });
      }
    }
  }
  await page.screenshot({ path: `${out}/overview.png` });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/tablet.png` });
  if (errors.length) throw new Error(errors.join(' | '));
} finally { await browser.close(); }
