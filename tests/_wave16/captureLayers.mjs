import { mkdir, writeFile } from "node:fs/promises";
import { openSilverPage, prepareSilver, waitSimulationElapsed, tubeCrop } from "../_wave11/browserCommon.mjs";

process.env.INIT = `${process.env.INIT ?? ""};window.__silverAgg=true;`;
const output = process.env.OUT ?? "docs/night/wave16f2/browser";
await mkdir(output, { recursive: true });
const targets = (process.env.TIMES_MS ?? "1500,3000,6000,9000").split(",").map(Number);
const manifest = { clickSimMs: null, captures: [] };
let browser;
try {
  const opened = await openSilverPage(); browser = opened.browser;
  const { page } = opened;
  const clickSim = await prepareSilver(page); manifest.clickSimMs = clickSim;
  for (const target of targets) {
    await waitSimulationElapsed(page, clickSim, target);
    const frozen = await page.evaluate(() => { window.__diag.pauseSimulation(); return window.__diag.frozen(); });
    if (!frozen.paused) throw new Error("Simulation did not pause");
    const crop = await tubeCrop(page);
    for (const background of ["lab", "black", "gray"])
      for (const layer of [0, 1, 2, 3])
        for (const optics of [0, 1, 2, 3]) {
          const state = await page.evaluate(({ background, layer, optics }) => {
            window.__diag.setBackground(background); window.__diag.setOpticsMode(optics);
            let mesh; window.__three.scene.traverse(object => { if (object.name === "TubeSilverDenseField") mesh = object; });
            if (!mesh) throw new Error("Silver mesh missing");
            mesh.material.uniforms.uSolidMode.value = layer;
            return { ...window.__diag.frozen(), layer, optics, background,
              kappa: mesh.material.uniforms.uCloudK.value, aggregateKappa: 17,
              light: mesh.material.uniforms.uLightStrength.value, ambient: mesh.material.uniforms.uAmbient.value,
              exposure: window.__three.gl.toneMappingExposure };
          }, { background, layer, optics });
          if (!state.paused || state.simMs !== frozen.simMs) throw new Error("Frozen state changed during matrix");
          await page.waitForTimeout(120);
          const file = `silver-t${target}-sim${Math.round(frozen.simMs)}-layer${layer}-optics${optics}-bg${background}.png`;
          await page.screenshot({ path: `${output}/${file}`, clip: crop });
          manifest.captures.push({ file, target, state, crop });
        }
    await page.evaluate(() => {
      window.__diag.setBackground("lab"); window.__diag.setOpticsMode(0);
      window.__three.scene.traverse(object => { if (object.name === "TubeSilverDenseField") object.material.uniforms.uSolidMode.value = 2; });
      window.__diag.resumeSimulation();
    });
  }
  await writeFile(`${output}/captureLayers.json`, JSON.stringify(manifest, null, 2));
  console.log(`Captured ${manifest.captures.length} frames in ${output}`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (browser) await browser.close(); }
