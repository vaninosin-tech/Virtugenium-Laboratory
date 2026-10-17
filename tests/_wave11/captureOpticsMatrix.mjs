import { writeFile } from "node:fs/promises";
import { openSilverPage, prepareSilver, waitSimulationElapsed, tubeCrop, outputDir } from "./browserCommon.mjs";

const targets = [1500, 3000, 6000, 9000];
const backgrounds = ["lab", "black", "gray"];
const modes = [0, 1, 2, 3];
const manifest = { clickSimMs: null, captures: [] };
let browser;
try {
  const opened = await openSilverPage(); browser = opened.browser;
  const { page } = opened;
  const out = await outputDir();
  const clickSim = await prepareSilver(page); manifest.clickSimMs = clickSim;
  for (const target of targets) {
    await waitSimulationElapsed(page, clickSim, target);
    const frozen = await page.evaluate(() => { window.__diag.pauseSimulation(); return window.__diag.frozen(); });
    if (!frozen.paused) throw new Error("Simulation failed to pause");
    const crop = await tubeCrop(page);
    for (const background of backgrounds) for (const mode of modes) {
      await page.evaluate(({ background, mode }) => {
        window.__diag.setBackground(background); window.__diag.setOpticsMode(mode);
      }, { background, mode });
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => {
        let mesh; window.__three.scene.traverse(object => { if (object.name === "TubeSilverDenseField") mesh = object; });
        return { ...window.__diag.frozen(), opticsMode: mesh?.material.uniforms.uOpticsMode.value,
          cloudOn: mesh?.material.uniforms.uCloudOn.value,
          kappa: mesh?.material.uniforms.uCloudK.value, albedo: mesh?.material.uniforms.uAlbedo.value,
          lightStrength: mesh?.material.uniforms.uLightStrength.value, ambient: mesh?.material.uniforms.uAmbient.value,
          exposure: window.__three.gl.toneMappingExposure };
      });
      if (!state.paused || state.simMs !== frozen.simMs || state.opticsMode !== mode || state.cloudOn !== 1)
        throw new Error(`Frozen state or uniform changed at ${target}ms ${background} mode ${mode}: ${JSON.stringify(state)}`);
      const file = `silver_t${String(target).padStart(5, "0")}_sim${Math.round(frozen.simMs)}_bg-${background}_mode-${mode}.png`;
      await page.screenshot({ path: `${out}/${file}`, clip: crop });
      manifest.captures.push({ file, requestedElapsedMs: target, frozenSimMs: frozen.simMs,
        elapsedMs: frozen.simMs - clickSim, background, mode, crop, uniforms: state });
    }
    await page.evaluate(() => { window.__diag.setBackground("lab"); window.__diag.setOpticsMode(0); window.__diag.resumeSimulation(); });
  }
  await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
  await writeFile(`${out}/contact-sheet.sh`, `#!/usr/bin/env sh\nset -eu\ncd "$(dirname "$0")"\nffmpeg -y -pattern_type glob -i 'silver_*.png' -vf 'scale=320:-1,tile=4x12' -frames:v 1 contact-sheet.png\n`);
  console.log(`Captured ${manifest.captures.length} images in ${out}`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (browser) await browser.close(); }
