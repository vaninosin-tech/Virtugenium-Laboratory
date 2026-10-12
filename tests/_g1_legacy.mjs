import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const out = "tmp/g1-legacy";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(120000);
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting");
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden" });
  const records = [];
  for (const [name, legacy] of [["before", true], ["after", false]]) {
    await page.evaluate(legacy => {
      window.__tubeLegacyTransport = legacy;
      window.__g1PourAt = 0;
      window.__g1Unsub?.();
      window.__g1Unsub = window.__testTubeStorageStore.subscribe(state => {
        if (!window.__g1PourAt && state.fumeHoodTestTubes[0]?.contents.includes("k2so4"))
          window.__g1PourAt = performance.now();
      });
    }, legacy);
    await page.getByRole("button", { name: "Опыт 3", exact: true }).click();
    await page.waitForFunction(() => window.__g1PourAt > 0);
    await page.waitForFunction(() => performance.now() - window.__g1PourAt >= 2000);
    const state = await page.evaluate(() => {
      const materials = [];
      window.__three.scene.traverse(object => {
        if (object.material?.uniforms?.uReactionKind?.value === 3)
          materials.push({ active: object.material.uniforms.uTransportActive?.value ?? 0,
            age: object.material.uniforms.uTransportAge?.value ?? 0 });
      });
      return { actual: (performance.now() - window.__g1PourAt) / 1000, materials };
    });
    await page.screenshot({ path: `${out}/${name}.png` });
    records.push({ name, ...state });
  }
  await writeFile(`${out}/comparison.json`, JSON.stringify(records, null, 2));
} finally { await browser.close(); }
