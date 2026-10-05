// BaCl2 + K2SO4 in the stand: frames and liquid uniforms over time.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const quality = process.env.VISUAL_QUALITY ?? "HIGH";
const out = process.env.VISUAL_OUT ?? `tmp/visual/31/baso4/${quality}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,900"] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  const frames = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /shader|webgl|program/i.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(mode => localStorage.setItem("virtugenium.runtime-quality.v1", mode), quality);
  await page.goto(process.env.VISUAL_URL ?? "http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const { useLabBootStore } = await import("/src/features/lab-boot/lib/useLabBootStore.ts");
    return useLabBootStore.getState().phase === "done";
  }, null, { timeout: 90000 });
  await page.evaluate(async quality => {
    const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts");
    useRuntimeQualityStore.getState().setMode(quality);
    const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
    const location = standLocation();
    const key = location === "workbench" ? "workbenchTestTubes" : "fumeHoodTestTubes";
    window.__baso4Location = location;
    window.__testTubeStorageStore.setState({ [key]: [{ instanceId: "snap-baso4", contents: [] }] });
    window.__testTubeStorageStore.getState().addTubeContents(location, 0, "bacl2");
    const { useTubeCloseUpStore } = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
    useTubeCloseUpStore.getState().setViewing(true);
  }, quality);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__testTubeStorageStore.getState().addTubeContents(window.__baso4Location, 0, "k2so4"));
  const start = Date.now();
  for (const t of [0.5, 1, 2, 4, 8, 13, 20, 30, 45]) {
    await page.waitForTimeout(Math.max(0, start + t * 1000 - Date.now()));
    const state = await page.evaluate(() => {
      const scene = window.__three?.scene;
      const result = { reaction: null, meshes: [] };
      const reactions = (window.__tubeReactionStore ?? null);
      scene?.traverse(o => {
        if (!o.isMesh || !o.material) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const u = m.uniforms;
        if (!u?.uReactionKind || u.uReactionKind.value < 2.5 || u.uReactionKind.value > 3.5) return;
        result.meshes.push({ name: o.name, visible: o.visible, kind: u.uReactionKind.value,
          p: +u.uReactionProgress.value.toFixed(3), cloud: +u.uCloudiness.value.toFixed(3),
          tActive: +u.uTransportActive?.value?.toFixed(3), opacity: +u.uOpacity.value.toFixed(3) });
      });
      return result;
    });
    const name = `baso4-${String(t).replace(".", "p")}s`;
    frames.push({ name, png: await page.screenshot({ path: `${out}/${name}.png` }) });
    console.log(quality, t, JSON.stringify(state));
  }
  const fps = await page.evaluate(() => new Promise(resolve => {
    const times = [];
    const start = performance.now();
    const tick = now => {
      times.push(now);
      if (now - start < 5000) requestAnimationFrame(tick);
      else resolve(Math.round((times.length - 1) * 1000 / (times.at(-1) - times[0])));
    };
    requestAnimationFrame(tick);
  }));
  console.log(`${quality} FPS (5 s without screenshots): ${fps}`);
  for (const { name, png } of frames) {
    const data = await page.evaluate(async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 150; canvas.height = 520;
      canvas.getContext("2d").drawImage(image, 730, 160, 150, 520, 0, 0, 150, 520);
      return canvas.toDataURL("image/png").split(",")[1];
    }, png.toString("base64"));
    await writeFile(`${out}/${name}-tube.png`, Buffer.from(data, "base64"));
  }
  if (errors.length) throw new Error(errors.join(" | "));
} finally {
  await browser.close();
}
