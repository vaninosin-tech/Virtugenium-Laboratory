import { writeFile } from "node:fs/promises";
import { openSilverPage, prepareSilver, waitSimulationElapsed, tubeCrop, outputDir } from "./browserCommon.mjs";

const failures = [], consoleErrors = [];
const report = { checks: {}, failures, consoleErrors };
let browser;
try {
  const opened = await openSilverPage(page => {
    page.on("console", message => { if (message.type() === "error" || /THREE\.WebGLProgram: Shader Error/.test(message.text())) consoleErrors.push(message.text()); });
    page.on("pageerror", error => consoleErrors.push(String(error)));
  }); browser = opened.browser;
  const { page } = opened;
  const clickSim = await prepareSilver(page);
  await waitSimulationElapsed(page, clickSim, 3000);
  await page.evaluate(() => window.__diag.pauseSimulation());
  await page.waitForTimeout(200);
  const crop = await tubeCrop(page);
  await page.evaluate(() => { window.__diag.setOpticsMode(0); window.__silverCloud = false; });
  await page.waitForTimeout(100);
  const off = await page.screenshot({ clip: crop });
  await page.evaluate(() => { window.__silverCloud = true; });
  await page.waitForTimeout(100);
  const on = await page.screenshot({ clip: crop });
  const pixels = await page.evaluate(async ({ before, after }) => {
    async function read(base64) {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
    }
    const a = await read(before), b = await read(after);
    if (a.width !== b.width || a.height !== b.height) throw new Error("Screenshot dimensions changed");
    let insideChanged = 0, outsideChanged = 0, insideSum = 0, outsideSum = 0;
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const i = 4 * (y * a.width + x);
      const difference = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      const liquid = x >= 0.27 * a.width && x <= 0.73 * a.width && y >= 0.25 * a.height && y <= 0.85 * a.height;
      if (liquid) { insideSum += difference; if (difference > 6) insideChanged++; }
      else { outsideSum += difference; if (difference > 6) outsideChanged++; }
    }
    return { insideChanged, outsideChanged, insideSum, outsideSum, width: a.width, height: a.height };
  }, { before: off.toString("base64"), after: on.toString("base64") });
  report.pixels = pixels;
  const shader = await page.evaluate(() => {
    const renderer = window.__three.gl, gl = renderer.getContext();
    const programs = renderer.info.programs ?? [];
    const programChecks = programs.map((item, index) => ({ index, linked: !!gl.getProgramParameter(item.program, gl.LINK_STATUS),
      runnable: item.diagnostics?.runnable ?? true, programLog: item.diagnostics?.programLog ?? "" }));
    let mesh;
    window.__three.scene.traverse(object => { if (object.name === "TubeSilverDenseField") mesh = object; });
    const id = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
    const field = id && window.__silverRuntime.field(id);
    const texture = field?.fineTexture ?? field?.texture;
    const materialProgram = mesh && renderer.properties.get(mesh.material).currentProgram;
    return { programChecks, meshExists: !!mesh, meshVisible: !!mesh?.visible,
      meshProgramCompiled: !!materialProgram && programs.includes(materialProgram),
      textureVersion: texture?.version ?? null, uploadedVersion: texture ? renderer.properties.get(texture).__version ?? null : null,
      textureBound: !!mesh && mesh.material.uniforms.uHaze.value === texture,
      cloudOn: mesh?.material.uniforms.uCloudOn.value, hazePresent: !!mesh?.material.uniforms.uHaze.value,
      opticsMode: mesh?.material.uniforms.uOpticsMode.value, paused: window.__diag.frozen().paused };
  });
  report.shader = shader;
  const checks = report.checks;
  checks.console = consoleErrors.length === 0;
  checks.programs = shader.programChecks.length > 0 && shader.programChecks.every(p => p.linked && p.runnable && !p.programLog);
  checks.mesh = shader.meshExists && shader.meshVisible && shader.meshProgramCompiled;
  checks.texture = shader.textureBound && shader.textureVersion !== null && shader.textureVersion === shader.uploadedVersion;
  checks.uniforms = shader.cloudOn === 1 && shader.hazePresent && shader.opticsMode === 0 && shader.paused;
  checks.image = pixels.insideChanged >= 20 && pixels.insideSum >= 300 && pixels.outsideChanged === 0;
  for (const [name, okay] of Object.entries(checks)) if (!okay) failures.push(name);
  const out = await outputDir();
  await writeFile(`${out}/validation-off.png`, off); await writeFile(`${out}/validation-on.png`, on);
} catch (error) { failures.push(`exception: ${error.stack ?? error}`); }
finally {
  if (browser) await browser.close();
  const out = await outputDir();
  await writeFile(`${out}/validateShaders.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (failures.length) process.exitCode = 1;
