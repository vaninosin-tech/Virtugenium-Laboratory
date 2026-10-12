import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const out = "tmp/g1-tracer";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 675 } });
  await context.addInitScript(() => localStorage.setItem("virtugenium.runtime-quality.v1", "LOW"));
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", error => console.log("pageerror", error.message));
  page.on("console", message => { if (message.type() === "error" || message.text().includes("shader"))
    console.log("browser", message.type(), message.text().slice(0, 350)); });
  await page.goto("http://127.0.0.1:5173/?tubeTracer");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting");
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden" });
  await page.evaluate(async () => {
    const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts");
    useRuntimeQualityStore.getState().setMode("LOW");
    window.__tubeDebugEnabled = true;
    window.__tubeTracerOnly = true;
    window.__g1Frames = [];
    const tick = () => {
      window.__g1Frames.push(performance.now());
      window.__g1FrameLoop = requestAnimationFrame(tick);
    };
    window.__g1FrameLoop = requestAnimationFrame(tick);
  });
  const modes = [["center", false], ["right", true], ["center", true]];
  for (const [point, save] of modes) {
    await page.locator("select").nth(0).selectOption(point);
    await page.locator("select").nth(1).selectOption("fast");
    await page.evaluate(() => {
      window.__g1PourAt = 0;
      window.__g1PreLayer = null;
      window.__g1Unsub?.();
      window.__g1Unsub = window.__testTubeStorageStore.subscribe(state => {
        const contents = state.fumeHoodTestTubes[0]?.contents ?? [];
        if (contents.includes("bacl2") && !contents.includes("k2so4") && !window.__g1PreLayer)
          setTimeout(async () => {
            if (window.__g1PreLayer || !window.__three ||
              window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.contents.includes("k2so4")) return;
            const THREE = await import("/node_modules/three/build/three.module.js");
            const { gl, scene, camera: game } = window.__three;
            let group = null;
            scene.traverse(o => { if (!group && o.name === "TubeReactionVisuals" && o.parent?.visible) group = o; });
            if (!group) return;
            const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.04, 0));
            const dir = game.position.clone().sub(target).setY(0).normalize();
            const camera = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
            camera.position.copy(target).addScaledVector(dir, 0.24);
            camera.lookAt(target); camera.updateMatrixWorld();
            gl.render(scene, camera);
            const image = document.createElement("canvas"); image.width = 800; image.height = 600;
            image.getContext("2d").drawImage(gl.domElement, 0, 0, image.width, image.height);
            window.__g1PreLayer = image.toDataURL("image/png");
          }, 500);
        if (!window.__g1PourAt && contents.includes("k2so4"))
          window.__g1PourAt = performance.now();
      });
    });
    await page.getByRole("button", { name: "Опыт 3", exact: true }).click();
    {
      await page.waitForFunction(() => (window.__testTubeStorageStore.getState()
        .fumeHoodTestTubes[0]?.contents ?? []).includes("bacl2"));
      await page.evaluate(() => {
        const tube = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0];
        window.__tubeAmount(tube.instanceId).volumeMl = 3.5;
      });
    }
    await page.waitForFunction(() => window.__g1PourAt > 0);
    const preLayer = await page.evaluate(() => window.__g1PreLayer);
    if (save && preLayer) await writeFile(`${out}/${point}-prelayers.png`,
      Buffer.from(preLayer.split(",")[1], "base64"));
    const records = [];
    for (let n = 0; n <= (save ? 25 : 2); n++) {
      await page.waitForFunction(target => performance.now() >= window.__g1PourAt + target * 1000,
        n * 0.2, { polling: 10 });
      const shot = await page.evaluate(async n => {
        const THREE = await import("/node_modules/three/build/three.module.js");
        const { gl, scene, camera: game } = window.__three;
        let group = null;
        scene.traverse(o => { if (!group && o.name === "TubeReactionVisuals" && o.parent?.visible) group = o; });
        if (!group) return null;
        const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.04, 0));
        const dir = game.position.clone().sub(target).setY(0).normalize();
        const angle = (n / 25 - 0.5) * 1.5;
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        const camera = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
        camera.position.copy(target).addScaledVector(dir, 0.24);
        camera.lookAt(target); camera.updateMatrixWorld();
        gl.render(scene, camera);
        const image = document.createElement("canvas"); image.width = 800; image.height = 600;
        image.getContext("2d").drawImage(gl.domElement, 0, 0, image.width, image.height);
        const d = window.__tubeDebug;
        let slices = null;
        if (d && [5, 15, 25].includes(n)) {
          const m = d.mask, fields = [d.tracerField, d.fields?.layers];
          const panelWidth = m.nx * 8, panelHeight = m.ny * 8;
          const canvas = document.createElement("canvas");
          canvas.width = panelWidth * 4 + 60; canvas.height = panelHeight + 58;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#0b1620"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.font = "17px sans-serif";
          const labels = ["tracer XY", "layers XY", "tracer ZY", "layers ZY"];
          for (let p = 0; p < 4; p++) {
            const values = fields[p % 2]; if (!values) continue;
            const x0 = 12 + p * (panelWidth + 12);
            ctx.fillStyle = "#e5f1f5"; ctx.fillText(labels[p], x0, 25);
            for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
              const i = p < 2 ? m.index(x, y, Math.floor(m.nz / 2))
                : m.index(Math.floor(m.nx / 2), y, x);
              const density = Math.min(1, (values[i] ?? 0) * m.activeCount * 0.7);
              ctx.fillStyle = p % 2 ? `rgba(246,81,155,${density})` : `rgba(35,211,243,${density})`;
              ctx.fillRect(x0 + x * 8, 35 + (m.ny - 1 - y) * 8, 8, 8);
              if (p === 0 && x % 3 === 0 && y % 4 === 0 && m.data[i]) {
                const vx = d.flow[i * 3], vy = d.flow[i * 3 + 1];
                ctx.strokeStyle = "#d8e66e"; ctx.beginPath();
                ctx.moveTo(x0 + x * 8 + 4, 35 + (m.ny - 1 - y) * 8 + 4);
                ctx.lineTo(x0 + x * 8 + 4 + Math.max(-15, Math.min(15, vx * 250)),
                  35 + (m.ny - 1 - y) * 8 + 4 - Math.max(-15, Math.min(15, vy * 250)));
                ctx.stroke();
              }
            }
          }
          slices = canvas.toDataURL("image/png");
        }
        return { actual: (performance.now() - window.__g1PourAt) / 1000,
          image: image.toDataURL("image/png"), slices,
          stats: d && { tracer: d.tracer, layerMass: d.layerMass, velocity: d.velocity, formed: d.formed,
            suspensionMass: d.suspensionMass, sedimentMass: d.sedimentMass,
            activeCells: d.mask.activeCount } };
      }, n);
      if (!shot) continue;
      const file = `${point}-${String(n).padStart(3, "0")}.png`;
      if (save) {
        await writeFile(`${out}/${file}`, Buffer.from(shot.image.split(",")[1], "base64"));
        records.push({ file, actual: shot.actual, ...shot.stats });
        if ([5, 15, 25].includes(n)) await page.screenshot({ path: `${out}/${point}-debug-${n}.png` });
        if (shot.slices) await writeFile(`${out}/${point}-slices-${n}.png`,
          Buffer.from(shot.slices.split(",")[1], "base64"));
      }
      console.log(point, n, shot.actual.toFixed(2), shot.stats?.tracer?.mass);
    }
    if (save)
      await writeFile(`${out}/${point}.json`, JSON.stringify(records, null, 2));
    if (save) {
      const timestamps = await page.evaluate(() => window.__g1Frames.filter(t =>
        t >= window.__g1PourAt && t <= performance.now()));
      const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
      const sorted = intervals.filter(v => v > 0).sort((a, b) => a - b);
      const fps = { frames: timestamps.length,
        elapsed: timestamps.length > 1 ? (timestamps.at(-1) - timestamps[0]) / 1000 : 0,
        mean: timestamps.length > 1 ? (timestamps.length - 1) * 1000 /
          (timestamps.at(-1) - timestamps[0]) : 0,
        median: sorted.length ? 1000 / sorted[Math.floor(sorted.length / 2)] : 0 };
      await writeFile(`${out}/${point}-fps.json`, JSON.stringify(fps, null, 2));
    }
    if (point === "center" && save) {
      const before = await page.evaluate(() => ({ energy: window.__tubeDebug?.velocity.energy,
        variance: window.__tubeDebug?.tracer.variance,
        motion: window.__tubeDebug?.motionIntensity, impulse: window.__tubeDebug?.motionImpulse }));
      await page.evaluate(() => {
        let root = null;
        window.__three.scene.traverse(o => {
          if (!root && o.name === "TubeReactionVisuals" && o.parent?.visible) root = o.parent;
        });
        window.__g1ShakeRoot = root;
        window.__g1ShakeOrigin = root.position.clone();
        window.__g1ShakeSamples = [];
        const started = performance.now();
        window.__g1ShakeTimer = setInterval(() => {
          root.position.x = window.__g1ShakeOrigin.x
            + 0.03 * Math.sin((performance.now() - started) * 2 * Math.PI * 2.5 / 1000);
          const d = window.__tubeDebug;
          if (d) window.__g1ShakeSamples.push({ t: (performance.now() - started) / 1000,
            energy: d.velocity.energy, motion: d.motionIntensity, impulse: d.motionImpulse });
        }, 16);
      });
      const shakeFrames = [];
      for (let n = 0; n < 24; n++) {
        await page.waitForTimeout(100);
        const shot = await page.evaluate(async n => {
          const THREE = await import("/node_modules/three/build/three.module.js");
          const { gl, scene, camera: game } = window.__three;
          let group = null;
          scene.traverse(o => { if (!group && o.name === "TubeReactionVisuals" && o.parent?.visible) group = o; });
          const target = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.04, 0));
          const dir = game.position.clone().sub(target).setY(0).normalize();
          dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (n / 23 - 0.5) * 1.5);
          const camera = new THREE.PerspectiveCamera(24, gl.domElement.width / gl.domElement.height, 0.01, 20);
          camera.position.copy(target).addScaledVector(dir, 0.24);
          camera.lookAt(target); camera.updateMatrixWorld();
          gl.render(scene, camera);
          const image = document.createElement("canvas"); image.width = 800; image.height = 600;
          image.getContext("2d").drawImage(gl.domElement, 0, 0, image.width, image.height);
          return { actual: window.__g1ShakeSamples.at(-1)?.t ?? 0,
            image: image.toDataURL("image/png"), energy: window.__tubeDebug?.velocity.energy };
        }, n);
        const file = `shake-${String(n).padStart(3, "0")}.png`;
        await writeFile(`${out}/${file}`, Buffer.from(shot.image.split(",")[1], "base64"));
        shakeFrames.push({ file, actual: shot.actual, energy: shot.energy });
      }
      await writeFile(`${out}/shake-frames.json`, JSON.stringify(shakeFrames, null, 2));
      const during = await page.evaluate(() => ({ energy: window.__tubeDebug?.velocity.energy,
        variance: window.__tubeDebug?.tracer.variance,
        motion: window.__tubeDebug?.motionIntensity, impulse: window.__tubeDebug?.motionImpulse }));
      await page.screenshot({ path: `${out}/center-shake.png` });
      await page.evaluate(() => {
        clearInterval(window.__g1ShakeTimer);
        window.__g1ShakeRoot.position.copy(window.__g1ShakeOrigin);
      });
      await page.waitForTimeout(800);
      const after = await page.evaluate(() => ({ energy: window.__tubeDebug?.velocity.energy,
        variance: window.__tubeDebug?.tracer.variance,
        motion: window.__tubeDebug?.motionIntensity, impulse: window.__tubeDebug?.motionImpulse }));
      const samples = await page.evaluate(() => window.__g1ShakeSamples);
      await writeFile(`${out}/center-shake.json`, JSON.stringify({ before, during, after, samples }, null, 2));
    }
  }
} finally { await browser.close(); }
