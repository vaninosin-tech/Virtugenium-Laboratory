import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const quality = process.env.VISUAL_QUALITY ?? 'HIGH';
const out = process.env.VISUAL_OUT ?? `tmp/visual/30e/${quality}-bottles`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: 'chrome',
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1600,900'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|webgl|program/i.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(mode => localStorage.setItem('virtugenium.runtime-quality.v1', mode), quality);
  await page.goto(process.env.VISUAL_URL ?? 'http://127.0.0.1:5173');
  await page.getByText('Играть', { exact: true }).click();
  await page.getByText('Песочница (временно)').click();
  try {
    await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === 'inspecting', null, { timeout: 90000 });
  } catch (error) {
    await page.screenshot({ path: `${out}/setup-failed.png` });
    console.log('setup errors:', errors);
    throw error;
  }
  await page.getByText('Лаборатория готова').waitFor({ state: 'hidden', timeout: 90000 });
  await page.evaluate(async () => {
    const { standLocation } = await import('/src/scenes/laboratory/lib/standStationActions.ts');
    const location = standLocation();
    const key = location === 'workbench' ? 'workbenchTestTubes' : 'fumeHoodTestTubes';
    window.__testTubeStorageStore.setState({ [key]: [{ instanceId: 'bottle-view', contents: [] }] });
    const { useTubeCloseUpStore } = await import('/src/scenes/laboratory/lib/useTubeCloseUpStore.ts');
    useTubeCloseUpStore.getState().setViewing(true);
  });
  await page.waitForTimeout(5000);
  console.log('loading visible:', await page.getByText('Лаборатория готова').isVisible());
  await page.screenshot({ path: `${out}/overview.png` });
  // The workbench reagent row is visible behind the tube in this camera pose.
  await page.screenshot({ path: `${out}/clear-k2so4.png`, clip: { x: 905, y: 65, width: 230, height: 310 } });
  await page.screenshot({ path: `${out}/clear-na2so3.png`, clip: { x: 1100, y: 50, width: 230, height: 310 } });
  await page.screenshot({ path: `${out}/amber-kmno4.png`, clip: { x: 1260, y: 40, width: 240, height: 310 } });
  const fps = await page.evaluate(() => new Promise(resolve => {
    const times = [], start = performance.now();
    function tick(t) { times.push(t); if (t-start < 5000) requestAnimationFrame(tick);
      else resolve(Math.round((times.length-1)*1000/(times.at(-1)-times[0]))); }
    requestAnimationFrame(tick);
  }));
  console.log(`${quality} overview FPS (5 s, no screenshots): ${fps}`);
  if (errors.length) throw new Error(errors.join(' | '));
} finally { await browser.close(); }
