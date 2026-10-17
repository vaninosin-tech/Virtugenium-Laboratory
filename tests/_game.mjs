import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.env.OUT ?? "D:/Claude/virtugenium-night/frames/game";
const query = process.env.QUERY ?? "silverStage=3";
const seconds = Number(process.env.SECONDS ?? 25);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--window-size=1400,950", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(900000);
  page.on("pageerror", e => console.log("pageerror", e.message.slice(0, 300)));
  // The SPA router drops the query string, so the selectors are set as window properties before any script runs.
  await page.addInitScript(`window.__silverStage=${process.env.STAGE ?? 3}; window.__silverDiag=${JSON.stringify(process.env.DIAG ?? "")};`);
  await page.goto("http://127.0.0.1:5201/");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 300000 });
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 300000 });
  await page.waitForTimeout(2000);
  if (process.env.WIDE) await page.keyboard.press(process.env.WIDE);
  // Warm-up: the first experiment click compiles the shaders and stalls the page for tens of seconds. Do it once, reset the
  // tube, and only then record, so the recording shows the real pour instead of the stall.
  if (!process.env.NOWARM) {
    await page.getByRole("button", { name: "Опыт 2", exact: true }).click();
    await page.waitForTimeout(8000);
    await page.getByRole("button", { name: "Новая пробирка", exact: true }).click();
    await page.waitForTimeout(4000);
    console.log("warm-up done");
  }
  // The canvas capture of the WebGL context returned a stale frame, so the recording is made of real page screenshots.
  const stamps = [];
  const grab = async (label) => { const name = `${out}/f${String(stamps.length).padStart(4, "0")}.png`; await page.screenshot({ path: name }); stamps.push({ name, label, t: Date.now() }); };
  const clickAt = Date.now();
  const clickPromise = page.getByRole("button", { name: "Опыт 2", exact: true }).click();
  // Frames are grabbed from before the click until the end; the page may stall during shader compilation.
  let done = false; clickPromise.then(() => { console.log("click returned after", ((Date.now() - clickAt) / 1000).toFixed(1), "s"); });
  const endAt = () => Date.now() > clickAt + (seconds + 30) * 1000;
  while (!endAt()) { try { await Promise.race([grab("frame"), new Promise((_, r) => setTimeout(() => r(new Error("stall")), 20000))]); } catch { /* page busy */ } }
  await writeFile(`${out}/stamps.json`, JSON.stringify(stamps.map(x => ({ n: x.name.split("/").pop(), dt: (x.t - clickAt) / 1000 })), null, 1));
  console.log("saved");
} finally { await browser.close(); }
