import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSilverPage, pour, tubeCrop } from "../_wave11/browserCommon.mjs";

// URL is the corrected build; URL_BEFORE is the legacy build on a second port.
// No browser is launched by the unit-test suite.
const root = process.env.OUT ?? "tests/_wave15/r1/captures";
const builds = [{ name: "after", url: process.env.URL ?? "http://127.0.0.1:5201/" },
  ...(process.env.URL_BEFORE ? [{ name: "before", url: process.env.URL_BEFORE }] : [])];
const experiments = {
  copper: ["cu", "hno3"],
  barium: ["bacl2", "k2so4"],
  permanganate: ["na2so3", "h2so4", "kmno4"],
};

for (const { name, url } of builds) {
const out = join(root, name);
process.env.URL = url;
await mkdir(out, { recursive: true });
const manifest = { name, url, captures: [] };
for (const [experiment, reagents] of Object.entries(experiments)) {
  let browser;
  try {
    const opened = await openSilverPage();
    browser = opened.browser;
    const { page } = opened;
    await page.evaluate(async () => {
      const { useTubeCloseUpStore } = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
      useTubeCloseUpStore.getState().setViewing(true);
      window.__diag.setCamera({ dist: 0.3, lateral: 0, height: 0.02, targetY: -0.035, fov: 55 });
    });
    for (let stage = 0; stage < reagents.length; stage++) {
      const reagent = reagents[stage];
      const action = await pour(page, reagent);
      if (!action.accepted) throw new Error(`${experiment}: stand refused ${reagent}`);
      await page.waitForFunction(id => window.__testTubeStorageStore?.getState()
        .fumeHoodTestTubes[0]?.contents.includes(id), reagent, { timeout: 30000 });
      await page.waitForTimeout(2500); // Stand busyUntil is wall-clock based.
      const state = await page.evaluate(async () => {
        window.__diag.pauseSimulation();
        const { tubeLiquidHeight } = await import("/src/scenes/laboratory/lib/tubeLiquidLevel.ts");
        const frozen = window.__diag.frozen();
        if (!frozen.paused) throw new Error("diagnostic pause failed");
        const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0];
        const amount = window.__tubeAmount?.(tube.instanceId);
        if (!amount) throw new Error("app tube amount handle unavailable");
        const objects = [];
        window.__three.scene.traverse(object => {
          if (!["TubeCopperGranules", "TubeSediment", "TubeAbsorptionWall",
            "TubeAbsorptionSurface", "TubeRefractedSurface", "TubePourAirBubbles",
            "TubeReactionVisuals", "ContentsVolume", "TubeBariumAggregates"].includes(object.name)) return;
          const box = new window.__three.camera.position.constructor();
          const uniforms = object.material?.uniforms;
          objects.push({ name: object.name, visible: object.visible,
            worldY: object.getWorldPosition(box).y,
            localY: object.position.y,
            childY: object.name === "TubeCopperGranules" ? object.children.map(child => child.position.y) : undefined,
            uniforms: uniforms ? Object.fromEntries(["uLevel", "uBottom", "uHeight", "uRadius"]
              .filter(key => uniforms[key] && typeof uniforms[key].value === "number")
              .map(key => [key, uniforms[key].value])) : undefined });
        });
        const renderer = window.__three.gl;
        return { frozen, tubeId: tube.instanceId, contents: tube.contents,
          volumeMl: amount?.volumeMl ?? null,
          liquidLevelMm: amount ? tubeLiquidHeight(amount.volumeMl, 0.007) * 1000 : null,
          objects,
          rendererInfo: { memory: { ...renderer.info.memory }, render: { ...renderer.info.render },
            programs: renderer.info.programs?.length ?? null } };
      });
      const crop = await tubeCrop(page);
      const file = `${name}-${experiment}-${String(stage + 1).padStart(2, "0")}-${reagent}.png`;
      await page.screenshot({ path: join(out, file), clip: crop });
      manifest.captures.push({ experiment, stage: stage + 1, reagent, file, crop, ...state });
      await page.evaluate(() => window.__diag.resumeSimulation());
    }
  } catch (error) {
    console.error(`${experiment}:`, error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}
await writeFile(join(out, `${name}-experiments.json`), JSON.stringify(manifest, null, 2));
console.log(`Saved ${manifest.captures.length} stages to ${out}`);
}
