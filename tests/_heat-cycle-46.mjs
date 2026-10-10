import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const out = "tmp/visual/46";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: [
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1200,900",
] });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("virtugenium.runtime-quality.v1", "LOW"));
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.evaluate(async () => {
    const sandbox = await import("/src/scenes/laboratory/sandbox/setupSandbox.ts");
    sandbox.replaceSandboxTube();
    const tubes = window.__testTubeStorageStore.getState();
    tubes.addTubeContents("fumeHood", 0, "cu");
    tubes.addTubeContents("fumeHood", 0, "hno3");
  });
  async function capture(label) {
    const result = await page.evaluate(async () => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { gl, scene, camera: game } = window.__three;
      let group = null;
      scene.traverse(o => {
        if (group || o.name !== "TubeReactionVisuals") return;
        for (let node = o; node; node = node.parent) if (!node.visible) return;
        group = o;
      });
      const index = window.__bunsenStandStore.getState().attachedTubeSlotIndex;
      const tube = index === null ? null : window.__testTubeStorageStore.getState().fumeHoodTestTubes[index];
      const chemistry = tube && window.__tubeReactionStore.getState().chemistryById[tube.instanceId];
      if (!group) return { stats: chemistry && { temperature: chemistry.temperature, progress: chemistry.progress }, shots: [] };
      const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0));
      const direction = game.position.clone().sub(target).setY(0).normalize();
      const shots = [];
      // Keep the in-sandbox tube, its glass, copper and liquid, but hide
      // neighbouring bottles and clamp during the offscreen close-up render.
      const tubeRoot = group.parent;
      const hidden = [];
      scene.traverse(object => {
        if (!object.isMesh || !object.visible) return;
        let parent = object;
        while (parent && parent !== tubeRoot) parent = parent.parent;
        if (parent !== tubeRoot) { object.visible = false; hidden.push(object); }
      });
      for (const [angle, rotation] of [["front", 0], ["side", Math.PI / 2]]) {
        const look = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
        const camera = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
        camera.position.copy(target).addScaledVector(look, 0.14).add(new THREE.Vector3(0, 0.02, 0));
        camera.lookAt(target);
        camera.updateMatrixWorld();
        gl.render(scene, camera);
        shots.push([angle, gl.domElement.toDataURL("image/png")]);
      }
      for (const object of hidden) object.visible = true;
      return { stats: chemistry && { temperature: chemistry.temperature, progress: chemistry.progress,
        contrast: chemistry.temperatureField?.contrast, hotX: chemistry.temperatureField?.hotX }, shots };
    });
    console.log(label, result.stats);
    for (const [angle, shot] of result.shots)
      await writeFile(`${out}/cycle-${label}-${angle}.png`, Buffer.from(shot.split(",")[1], "base64"));
  }
  const setHeat = (power, side = 0) => page.evaluate(({ power, side }) => {
    const index = window.__bunsenStandStore.getState().attachedTubeSlotIndex;
    const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[index];
    window.__tubeReactionStore.getState().setExternalHeat(tube.instanceId, power, side);
  }, { power, side });
  await capture("cold-0");
  await page.waitForTimeout(2000);
  await capture("cold-2");
  await setHeat(1, -1);
  await page.waitForTimeout(2500);
  await capture("heating-2");
  await page.waitForTimeout(3000);
  await capture("heating-5");
  await setHeat(0);
  await page.waitForTimeout(2500);
  await capture("cooling-2");
  await page.waitForTimeout(3000);
  await capture("cooling-5");
  await setHeat(1, 1);
  await page.waitForTimeout(2500);
  await capture("reheating-2");
  await page.waitForTimeout(3000);
  await capture("reheating-5");
} finally {
  await browser.close();
}
