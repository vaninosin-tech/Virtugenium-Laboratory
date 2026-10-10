import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.env.OUT; const exp = Number(process.env.EXP); const times = process.env.TIMES.split(",").map(Number);
const selectedAngles = (process.env.ANGLES ?? "front,side,top,45").split(",");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1200,900"] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  page.on("pageerror", e => console.log("pageerror", e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: `Опыт ${exp}` }).click();
  let previousTime = 0;
  for (const t of times) {
    await page.waitForTimeout(Math.max(0, t - previousTime) * 1000);
    previousTime = t;
    const shots = await page.evaluate(async selectedAngles => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { gl, scene, camera: game } = window.__three;
      await new Promise(r => requestAnimationFrame(() => r()));
      let group = null;
      scene.traverse(o => { if (group || o.name !== "TubeReactionVisuals") return; for (let x = o; x; x = x.parent) if (!x.visible) return; group = o; });
      if (!group) return null;
      const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0));
      const dir = game.position.clone().sub(target).setY(0).normalize();
      const res = [];
      for (const [label, rot, horizontal, elevation] of [
        ["front", 0, 0.3, 0.05], ["side", Math.PI / 2, 0.3, 0.05],
        ["top", 0, 0.055, 0.3], ["45", -Math.PI / 4, 0.28, 0.15],
      ]) {
        if (!selectedAngles.includes(label)) continue;
        const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        const cam = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
        cam.position.copy(target).addScaledVector(d, horizontal).add(new THREE.Vector3(0, elevation, 0));
        cam.lookAt(target); cam.updateMatrixWorld();
        gl.render(scene, cam);
        res.push([label, gl.domElement.toDataURL("image/png")]);
      }
      return res;
    }, selectedAngles);
    if (!shots) { console.log("no tube", t); continue; }
    for (const [label, url] of shots) await writeFile(`${out}/e${exp}-${t}s-${label}.png`, Buffer.from(url.split(",")[1], "base64"));
    const p = await page.evaluate(() => {
      const index = window.__bunsenStandStore.getState().attachedTubeSlotIndex;
      const tube = index === null ? null : window.__testTubeStorageStore.getState().fumeHoodTestTubes[index];
      return tube ? window.__tubeReactionStore.getState().chemistryById[tube.instanceId]?.progress : undefined;
    });
    console.log("shot", t, "progress", p?.toFixed(2));
  }
} finally { await browser.close(); }
