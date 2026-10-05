import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const out = 'tmp/visual/30f/bottles/pour';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: 'chrome',
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1600,900'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByText('Играть', { exact: true }).click();
  await page.getByText('Песочница (временно)').click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === 'inspecting', null, { timeout: 90000 });
  await page.getByText('Лаборатория готова').waitFor({ state: 'hidden', timeout: 90000 });
  const location = await page.evaluate(async () => {
    const { standLocation } = await import('/src/scenes/laboratory/lib/standStationActions.ts');
    const { useTubeCloseUpStore } = await import('/src/scenes/laboratory/lib/useTubeCloseUpStore.ts');
    const here = standLocation();
    const key = here === 'workbench' ? 'workbenchTestTubes' : 'fumeHoodTestTubes';
    window.__testTubeStorageStore.setState({ [key]: [{ instanceId: '30f-bottle-pour-tube', contents: [] }] });
    useTubeCloseUpStore.getState().setViewing(true);
    const item = { instanceId: '30f-pour-hno3', reagentId: 'hno3',
      containerType: 'amber250', cabinetId: 'cabinet-acids', slotIndex: 0 };
    window.__storageStore.setState({ [here === 'workbench' ? 'workbenchItems' : 'fumeHoodItems']: [item] });
    return here;
  });
  await page.waitForTimeout(3000);
  const sample = () => page.evaluate(() => {
    const mouth = window.__standMotion.mouth;
    const bottles = [];
    window.__labScene.traverse(object => {
      const binding = object.userData?.reagentMaterials;
      if (binding?.reagentId !== 'hno3') return;
      bottles.push({ distance: object.getWorldPosition(mouth.point.clone()).distanceTo(mouth.point),
        fill: binding.getFillLevel() });
    });
    return { mouthValid: mouth.valid, bottles: bottles.sort((a, b) => a.distance - b.distance) };
  });
  console.log('location', location, 'before', await sample());
  await page.screenshot({ path: `${out}/before.png` });
  await page.evaluate(() => window.__standMotion.store.getState().startPour('30f-pour-hno3', () => {}));
  await page.waitForTimeout(740);
  console.log('tilted', await sample());
  await page.screenshot({ path: `${out}/tilted.png` });
  await page.waitForTimeout(420);
  console.log('after', await sample());
  await page.screenshot({ path: `${out}/after.png` });
  if (errors.length) throw new Error(errors.join(' | '));
} finally { await browser.close(); }
