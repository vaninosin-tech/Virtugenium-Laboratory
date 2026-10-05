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
    await page.evaluate(id => window.__sceneStore.getState().beginCabinetFocus(id), cabinet);
    await page.waitForFunction(id => window.__sceneStore.getState().focusedCabinetId === id &&
      window.__sceneStore.getState().cabinetPhase === 'inspecting', cabinet, { timeout: 30000 });
    await page.waitForTimeout(1500);
    for (const reagent of ids) {
      const id = `${cabinet}-${reagent}`;
      for (const degrees of [...[0, 30, 60], ...(reagent === 'k2so4' ? ['side'] : [])]) {
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
            degrees === 'side' ? Math.PI * 1.5 : Math.PI));
          const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,
            THREE.MathUtils.degToRad(degrees === 'side' ? 0 : degrees)));
          useReagentInspectionStore.getState().open(id, position.toArray(), orientation.toArray(), 2.0);
        }, { id, degrees });
        await page.waitForTimeout(2600);
        await page.screenshot({ path: `${out}/${reagent}-hand-${degrees}.png` });
        if (quality === 'HIGH' && degrees === 'side') {
          await page.evaluate(() => {
            window.__bottleRenderRestore = [];
            window.__labScene.traverse(object => {
              if (object.material?.name !== 'BottleLiquidContents') return;
              const old = object.onBeforeRender;
              object.onBeforeRender = () => { object.material.uniforms.uBottleRefraction.value = 0; };
              window.__bottleRenderRestore.push(() => { object.onBeforeRender = old; });
            });
          });
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${out}/${reagent}-hand-side-nocapture.png` });
          await page.evaluate(() => window.__bottleRenderRestore.forEach(restore => restore()));
        }
        console.log('Captured', reagent, degrees);
        await page.evaluate(() => window.__inspectionStore.getState().requestClose());
        await page.waitForFunction(() => window.__inspectionStore.getState().inspectedId === null, null, { timeout: 10000 });
      }
    }
  }
  const fps = await page.evaluate(async () => {
    const measure = () => new Promise(resolve => {
      const times = [], start = performance.now();
      function tick(t) { times.push(t); if (t - start < 5000) requestAnimationFrame(tick);
        else resolve(Math.round((times.length - 1) * 1000 / (times.at(-1) - times[0]))); }
      requestAnimationFrame(tick);
    });
    const restores = [];
    window.__labScene.traverse(object => {
      if (object.material?.name !== 'BottleLiquidContents') return;
      const old = object.onBeforeRender;
      object.onBeforeRender = () => { object.material.uniforms.uBottleRefraction.value = 0; };
      restores.push(() => { object.onBeforeRender = old; });
    });
    const withoutCapture = await measure();
    restores.forEach(restore => restore());
    const withCapture = await measure();
    return { withoutCapture, withCapture };
  });
  console.log(`${quality} overview FPS (5 s each, no screenshots):`, fps);
  if (errors.length) throw new Error(errors.join(' | '));
} finally { await browser.close(); }
