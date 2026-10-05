import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false, channel: 'chrome',
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1600,900'] });
try {
  for (const quality of ['HIGH', 'LOW']) {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
    await page.goto(process.env.VISUAL_URL ?? 'http://127.0.0.1:5173');
    await page.getByText('Играть', { exact: true }).click();
    await page.getByText('Песочница (временно)').click();
    await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === 'inspecting', null, { timeout: 90000 });
    await page.getByText('Лаборатория готова').waitFor({ state: 'hidden', timeout: 90000 });
    await page.evaluate(async mode => {
      const { useRuntimeQualityStore } = await import('/src/scenes/laboratory/lib/useRuntimeQualityStore.ts');
      useRuntimeQualityStore.getState().setMode(mode);
      window.__sceneStore.getState().finishCabinetReturn();
    }, quality);
    await page.waitForTimeout(3000);
    const result = await page.evaluate(async () => {
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
      const before = await measure();
      restores.forEach(restore => restore());
      const after = await measure();
      return { phase: window.__sceneStore.getState().cabinetPhase, before, after };
    });
    console.log(quality, result);
    await page.context().close();
  }
} finally { await browser.close(); }
