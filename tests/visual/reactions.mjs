import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const url = "http://localhost:5173";
const out = resolve(process.env.VISUAL_OUT ?? "tmp/visual");
await mkdir(out, { recursive: true });
const reachable = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server;
if (!await reachable()) {
  server = spawn(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32"
    ? ["/c", "npm.cmd run dev -- --port 5173 --strictPort"] : ["run", "dev", "--", "--port", "5173", "--strictPort"],
  { stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 60 && !await reachable(); i++) await new Promise(r => setTimeout(r, 500));
  if (!await reachable()) throw new Error("Vite did not start on port 5173");
}
// Installed Chrome also supports Playwright's Chromium protocol when the CDN
// is unavailable. SwiftShader remains selectable on machines without a GPU.
const angle = process.env.VISUAL_ANGLE ?? (process.platform === "win32" ? "d3d11" : "swiftshader");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
  channel: !process.env.CHROMIUM_EXECUTABLE && !existsSync(chromium.executablePath()) ? "chrome" : undefined,
  headless: true, args: [`--use-angle=${angle}`, "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120_000);
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(`${m.text()} ${m.location().url}`); });
// The app has no favicon; its unrelated 404 should not mask shader failures.
await page.route("**/favicon.ico", route => route.fulfill({ status: 204, body: "" }));
const frames = [];
console.log("Browser launched");
async function settle(ms = 500) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function shot(name) {
  await settle();
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  const state = await page.evaluate(async () => {
    const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts");
    const { enabled, progress } = window.__tubeVisualTuningStore.getState();
    return { enabled, progress, quality: useRuntimeQualityStore.getState().quality };
  });
  frames.push({ name, ...state });
  console.log(name);
}
try {
  await page.goto(url);
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)", { exact: true }).click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting");
  await page.waitForFunction(() => !!window.__tubeVisualTuningStore);
  console.log("Sandbox ready");
  await page.evaluate(async () => {
    const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts");
    useRuntimeQualityStore.getState().setMode("HIGH");
    window.__tubeVisualTuningStore.setState({ enabled: true, progress: 0 });
  });
  const cases = {
    "copper-nitric": ["cu", "hno3"],
    "silver-chloride": ["agno3", "nacl"],
    "barium-sulfate": ["bacl2", "k2so4"],
    "permanganate-redox": ["kmno4", "h2so4", "na2so3"],
  };
  for (const [kind, reagents] of Object.entries(cases)) {
    await page.getByRole("button", { name: "Новая пробирка", exact: true }).click();
    await page.evaluate(async ({ reagents }) => {
      const { useTubeCloseUpStore } = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
      const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts");
      useRuntimeQualityStore.getState().setMode("HIGH");
      window.__tubeVisualTuningStore.setState({ enabled: true, progress: 0 });
      for (const id of reagents) window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, id);
      useTubeCloseUpStore.getState().setViewing(true);
    }, { reagents: kind === "permanganate-redox" ? reagents.slice(0, 2) : reagents });
    await settle(2500);
    if (kind === "permanganate-redox") {
      await shot(`${kind}-before`);
      await page.evaluate(() => window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, "na2so3"));
    }
    for (const p of [0, 0.001, 0.1, 0.5, 1]) {
      if (p === 0.001 && kind !== "permanganate-redox") continue;
      await page.evaluate(p => window.__tubeVisualTuningStore.setState({ progress: p }), p);
      await shot(`${kind}-${p}`);
    }
    await page.evaluate(async () => {
      const { useRuntimeQualityStore } = await import("/src/scenes/laboratory/lib/useRuntimeQualityStore.ts");
      useRuntimeQualityStore.getState().setMode("LOW");
    });
    for (const p of [0.5, 1]) {
      await page.evaluate(p => window.__tubeVisualTuningStore.setState({ progress: p }), p);
      await shot(`${kind}-LOW-${p}`);
    }
  }
  await page.evaluate(() => window.__heatingStore.setState({ active: true, phase: "cracked" }));
  await shot("cracked");
  await page.evaluate(() => window.__heatingStore.getState().restartPreheat());
  await shot("replaced");
  await writeFile(resolve(out, "capture.json"), JSON.stringify({ frames, errors, browser: browser.version(), angle, viewport: { width: 1600, height: 900 } }, null, 2));
  if (errors.length) throw new Error(`Browser errors: ${errors.join("\n")}`);
} finally {
  await browser.close();
  if (server) {
    if (process.platform === "win32") spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true });
    else server.kill();
  }
}
