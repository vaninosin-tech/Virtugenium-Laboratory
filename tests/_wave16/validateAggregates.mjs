import { mkdir, writeFile } from "node:fs/promises";
import { openSilverPage, prepareSilver, waitSimulationElapsed, tubeCrop } from "../_wave11/browserCommon.mjs";

process.env.INIT = `${process.env.INIT ?? ""};window.__silverAgg=true;`;
const output = process.env.OUT ?? "docs/night/wave16f2/browser";
await mkdir(output, { recursive: true });
const errors = [], failures = [];
const report = { checks: {}, errors, failures };
let browser;
try {
  const opened = await openSilverPage(page => {
    page.on("console", message => { if (message.type() === "error" || /THREE\.WebGLProgram: Shader Error/.test(message.text())) errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
  });
  browser = opened.browser;
  const { page } = opened;
  const clickSim = await prepareSilver(page);
  await waitSimulationElapsed(page, clickSim, Number(process.env.ELAPSED_MS ?? 9000));
  await page.evaluate(() => window.__diag.pauseSimulation());
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => {
    const renderer = window.__three.gl, gl = renderer.getContext(), programs = renderer.info.programs ?? [];
    let mesh, bed;
    window.__three.scene.traverse(object => {
      if (object.name === "TubeSilverDenseField") mesh = object;
      if (object.name === "TubeSediment" && object.visible) bed = object;
    });
    const id = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
    const field = id && window.__silverRuntime.field(id);
    const aggregate = field?.aggregateTexture ?? field?.denseTexture;
    const sediment = field?.sedimentHeightTexture;
    const uploaded = texture => texture ? renderer.properties.get(texture).__version === texture.version : false;
    const program = mesh && renderer.properties.get(mesh.material).currentProgram;
    const depositedMass = field?.sedimentField?.mass ?? 0;
    return {
      programs: programs.map(p => ({ linked: !!gl.getProgramParameter(p.program, gl.LINK_STATUS),
        runnable: p.diagnostics?.runnable ?? true, log: p.diagnostics?.programLog ?? "" })),
      meshVisible: !!mesh?.visible, silverProgramLinked: !!program && programs.includes(program),
      aggregateExists: !!aggregate, aggregateBound: mesh?.material.uniforms.uAggregate.value === aggregate,
      aggregateUploaded: uploaded(aggregate),
      sedimentExists: !!sediment, sedimentBound: bed?.material.userData.sedimentShader?.uniforms.uSedimentHeight.value === sediment,
      sedimentUploaded: uploaded(sediment), depositedMass, sedimentVisible: !!bed,
      paused: window.__diag.frozen().paused,
    };
  });
  report.state = state;
  const crop = await tubeCrop(page);
  const image = await page.screenshot({ path: `${output}/aggregate-validation.png`, clip: crop });
  const pixel = await page.evaluate(async base64 => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext("2d"); context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, img.width, img.height).data;
    let variance = 0, count = 0;
    for (let y = Math.floor(img.height * 0.25); y < img.height * 0.85; y++)
      for (let x = Math.floor(img.width * 0.3); x < img.width * 0.7; x++) {
        const i = 4 * (y * img.width + x);
        variance += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]); count++;
      }
    return { variance, count };
  }, image.toString("base64"));
  report.pixel = pixel;
  report.checks = {
    console: errors.filter(v => !/Failed to load resource: the server responded with a status of 404/.test(v)).length === 0,
    programs: state.programs.length > 0 && state.programs.every(v => v.linked && v.runnable && !/ERROR/i.test(v.log)),
    silverProgram: state.meshVisible && state.silverProgramLinked,
    aggregate: state.aggregateExists && state.aggregateBound && state.aggregateUploaded,
    sedimentTexture: state.sedimentExists && (!state.sedimentVisible || state.sedimentBound && state.sedimentUploaded),
    sedimentArrival: state.sedimentVisible === (state.depositedMass > 0),
    image: pixel.count > 100 && pixel.variance > 0,
    paused: state.paused,
  };
  for (const [name, passed] of Object.entries(report.checks)) if (!passed) failures.push(name);
} catch (error) { failures.push(String(error?.stack ?? error)); }
finally {
  if (browser) await browser.close();
  await writeFile(`${output}/validateAggregates.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (failures.length) process.exitCode = 1;
