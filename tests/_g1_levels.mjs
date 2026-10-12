import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const out = "tmp/g1-levels";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome" });
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 675 } });
  await context.addInitScript(() => localStorage.setItem("virtugenium.runtime-quality.v1", "LOW"));
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", error => console.log("pageerror", error.message));
  await page.goto("http://127.0.0.1:5173/");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting");
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden" });
  const capture = async name => {
    const result = await page.evaluate(async () => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { gl, scene, camera: game } = window.__three;
      let group = null;
      scene.traverse(o => { if (!group && o.name === "TubeReactionVisuals" && o.parent?.visible) group = o; });
      if (!group) return null;
      const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.045, 0));
      const dir = game.position.clone().sub(target).setY(0).normalize();
      const camera = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
      camera.position.copy(target).addScaledVector(dir, 0.35);
      camera.lookAt(target); camera.updateMatrixWorld();
      gl.render(scene, camera);
      const image = document.createElement("canvas"); image.width = 800; image.height = 600;
      image.getContext("2d").drawImage(gl.domElement, 0, 0, 800, 600);
      const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0];
      return { image: image.toDataURL("image/png"),
        volumeMl: tube ? window.__tubeAmount(tube.instanceId).volumeMl : null,
        contents: tube?.contents, actual: performance.now() - window.__g1LevelStart };
    });
    if (!result) throw Error(`No tube for ${name}`);
    await writeFile(`${out}/${name}.png`, Buffer.from(result.image.split(",")[1], "base64"));
    delete result.image;
    console.log(name, JSON.stringify(result));
    return result;
  };
  const records = [];
  await page.evaluate(() => { window.__g1LevelStart = performance.now(); });
  await page.getByRole("button", { name: "Опыт 1", exact: true }).click();
  await page.waitForFunction(() => window.__testTubeStorageStore.getState()
    .fumeHoodTestTubes[0]?.contents.includes("hno3"));
  records.push({ name: "exp1-start", ...await capture("exp1-start") });
  await page.evaluate(() => { window.__g1LevelStart = performance.now(); });
  await page.getByRole("button", { name: "Опыт 4", exact: true }).click();
  await page.waitForFunction(() => {
    const contents = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.contents ?? [];
    return contents.includes("h2so4") && !contents.includes("kmno4");
  });
  records.push({ name: "exp4-before", ...await capture("exp4-before") });
  await page.waitForFunction(() => window.__testTubeStorageStore.getState()
    .fumeHoodTestTubes[0]?.contents.includes("kmno4"));
  const t0 = await page.evaluate(() => performance.now());
  records.push({ name: "exp4-pour", ...await capture("exp4-pour") });
  await page.waitForFunction(t0 => performance.now() >= t0 + 3000, t0);
  records.push({ name: "exp4-after", ...await capture("exp4-after") });
  await writeFile(`${out}/frames.json`, JSON.stringify(records, null, 2));
} finally { await browser.close(); }
