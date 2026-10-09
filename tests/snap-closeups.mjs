// Close-ups of all four experiments from a separate camera beside the clamped tube.
// The game has no tube close-up any more (VL-020); this renders one frame from a
// camera of our own right after the game's frame and reads the canvas at once.
//   node tests/snap-closeups.mjs   ->  tmp/visual/closeups/*.png
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const out = process.env.VISUAL_OUT ?? "tmp/visual/closeups";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1200,900"] });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  if (process.env.VISUAL_QUALITY === "LOW")
    await context.addInitScript(() => localStorage.setItem("virtugenium.runtime-quality.v1", "LOW"));
  const page = await context.newPage();
  page.on("pageerror", e => console.log("pageerror", e.message));
  await page.goto(process.env.VISUAL_URL ?? "http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.waitForTimeout(3000);

  const fresh = (ingredients) => page.evaluate(async (ingredients) => {
    const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
    const location = standLocation();
    const key = location === "workbench" ? "workbenchTestTubes" : "fumeHoodTestTubes";
    window.__closeLocation = location;
    window.__tubeVisualTuningStore.setState({ enabled: false });
    window.__testTubeStorageStore.setState({ [key]: [{ instanceId: `close-${Date.now()}`, contents: [] }] });
    for (const id of ingredients) window.__testTubeStorageStore.getState().addTubeContents(location, 0, id);
  }, ingredients);
  const add = (id) => page.evaluate(id => window.__testTubeStorageStore.getState().addTubeContents(window.__closeLocation, 0, id), id);
  const tune = (state) => page.evaluate(s => window.__tubeVisualTuningStore.setState(s), state);
  const onsetShots = async (prefix, reagent) => {
    const kind = prefix.startsWith("2-") ? 2 : prefix.startsWith("3-") ? 3 : 4;
    const seconds = [...Array.from({ length: 12 }, (_, i) => (i + 1) * 0.25), 5, 8, 12];
    // Arm the frame sampler in the same browser task that adds the reagent.
    // Round trips to Node otherwise miss the first second on a busy GPU.
    const frames = await page.evaluate(async ({ kind, reagent, seconds }) => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { gl, scene, camera: gameCamera } = window.__three;
      window.__testTubeStorageStore.getState().addTubeContents(window.__closeLocation, 0, reagent);
      const result = [];
      let frameCount = 0;
      const startTime = performance.now();
      for (const second of seconds) {
        let age = -1;
        while (age < second) {
          await new Promise(r => requestAnimationFrame(r));
          frameCount++;
          scene.traverse(o => {
            if (o.name === "ContentsVolume" && o.material?.name === "TubeLiquidContents"
              && o.material.uniforms.uReactionKind.value === kind)
              age = Math.max(age, o.material.uniforms.uTransportAge.value);
          });
        }
        let group = null;
        scene.traverse(o => {
          if (group || o.name !== "TubeReactionVisuals") return;
          for (let x = o; x; x = x.parent) if (!x.visible) return;
          group = o;
        });
        if (!group) continue;
        const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0));
        const dir = gameCamera.position.clone().sub(target).setY(0).normalize();
        const camera = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
        camera.position.copy(target).addScaledVector(dir, 0.3).add(new THREE.Vector3(0, 0.06, 0));
        camera.lookAt(target);
        camera.updateMatrixWorld();
        gl.render(scene, camera);
        result.push({ second, age, dataUrl: gl.domElement.toDataURL("image/png") });
        if (second === 3) window.__closeFps = frameCount / ((performance.now() - startTime) / 1000);
      }
      return result;
    }, { kind, reagent, seconds });
    for (const { second, age, dataUrl } of frames) {
      const name = `${prefix}-${String(second).replace(".", "p")}s`;
      await writeFile(`${out}/${name}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
      console.log("shot", name, "age", age.toFixed(2));
    }
    console.log(prefix, "capture FPS to 3s", (await page.evaluate(() => window.__closeFps)).toFixed(1));
  };

  const shot = async (name) => {
    const dataUrl = await page.evaluate(async () => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { gl, scene, camera: gameCamera } = window.__three;
      // Wait for the game's own frame, then draw ours over it in the same task.
      await new Promise(r => requestAnimationFrame(() => r()));
      // The visible tube with reaction visuals (the one we filled).
      let group = null;
      scene.traverse(o => {
        if (group || o.name !== "TubeReactionVisuals") return;
        for (let x = o; x; x = x.parent) if (!x.visible) return;
        group = o;
      });
      if (!group) return null;
      const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0));
      // From the player's side, close and slightly above.
      const dir = gameCamera.position.clone().sub(target).setY(0).normalize();
      const camera = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
      camera.position.copy(target).addScaledVector(dir, 0.3).add(new THREE.Vector3(0, 0.06, 0));
      camera.lookAt(target);
      camera.updateMatrixWorld();
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    });
    if (!dataUrl) { console.log("no tube for", name); return; }
    await writeFile(`${out}/${name}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
    const age = await page.evaluate(() => {
      let age = -1;
      window.__three.scene.traverse(o => {
        if (o.name === "ContentsVolume" && o.material?.name === "TubeLiquidContents")
          age = Math.max(age, o.material.uniforms.uTransportAge.value);
      });
      return age;
    });
    console.log("shot", name, "age", age.toFixed(2));
    if (process.env.VISUAL_DEBUG) {
      const uniforms = await page.evaluate(() => {
        let result = null;
        window.__three.scene.traverse(o => {
          if (o.name !== "ContentsVolume" || o.material?.name !== "TubeLiquidContents") return;
          const u = o.material.uniforms;
          if (u.uReactionKind.value === 3) result = {
            progress: u.uReactionProgress.value,
            cloud: u.uCloudiness.value,
            age: u.uTransportAge.value,
            active: u.uTransportActive.value,
          };
        });
        return result;
      });
      console.log("uniforms", name, uniforms);
    }
  };

  // 1. Cu + dilute HNO3, heated (tuning drives progress, rate and temperature; it eases in).
  if (!process.env.VISUAL_PRECIPITATES_ONLY) {
  await fresh(["cu", "hno3"]);
  await page.waitForTimeout(1500);
  await tune({ enabled: true, progress: 0, rate: 0.2, temperature: 0 });
  await page.waitForTimeout(4000); await shot("1-copper-a-start");
  await tune({ progress: 0.035, rate: 1, temperature: 0.9 });
  await page.waitForTimeout(3000); await shot("1-heated-3s");
  await tune({ progress: 0.08 });
  await page.waitForTimeout(3000); await shot("1-heated-6s");
  await tune({ progress: 0.16 });
  await page.waitForTimeout(4000); await shot("1-heated-10s");
  await tune({ progress: 0.27 });
  await page.waitForTimeout(5000); await shot("1-heated-15s");
  await tune({ progress: 0.65 });
  await page.waitForTimeout(9000); await shot("1-mid");
  await tune({ progress: 1, rate: 0, temperature: 0.3 });
  await page.waitForTimeout(9000); await shot("1-end");
  await tune({ enabled: false });
  }

  // 2. AgNO3 + NaCl.
  if (!process.env.VISUAL_BARIUM_ONLY && !process.env.VISUAL_REGRESSION_ONLY && !process.env.VISUAL_TARGET_ONLY) {
    await fresh(["agno3"]); await page.waitForTimeout(150);
    await onsetShots("2-agcl", "nacl");
  }

  // 3. BaCl2 + K2SO4.
  if (!process.env.VISUAL_AGCL_ONLY && !process.env.VISUAL_REGRESSION_ONLY && !process.env.VISUAL_TARGET_ONLY) {
    await fresh(["bacl2"]); await page.waitForTimeout(150);
    await onsetShots("3-baso4", "k2so4");
    if (process.env.VISUAL_QUALITY === "LOW") {
      await fresh(["bacl2"]); await page.waitForTimeout(150);
      await add("k2so4");
      const fps = await page.evaluate(() => new Promise(resolve => {
        const start = performance.now();
        let frames = 0;
        const tick = () => {
          frames++;
          const elapsed = performance.now() - start;
          if (elapsed >= 5000) resolve(frames * 1000 / elapsed);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }));
      console.log("3-baso4 LOW FPS (5 s without screenshots):", fps.toFixed(1));
    }
  }

  // 4. Na2SO3 + H2SO4, then KMnO4.
  if (!process.env.VISUAL_PRECIPITATES_ONLY && !process.env.VISUAL_COPPER_ONLY) {
  await fresh(["na2so3", "h2so4"]); await page.waitForTimeout(2500);
  await onsetShots("4-kmno4", "kmno4");
  }
} finally {
  await browser.close();
}
