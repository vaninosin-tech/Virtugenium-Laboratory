import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

export async function openSilverPage(onPage = () => {}) {
  const browser = await chromium.launch({ headless: false, channel: "chrome", args: [
    "--window-size=1400,950", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows", "--disable-features=CalculateNativeWinOcclusion",
  ] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  onPage(page);
  page.setDefaultTimeout(300000);
  await page.addInitScript(() => { window.__silverStage = 3; window.__silverAgg = 0; window.__silverDiag = ""; });
  await page.goto(process.env.URL ?? "http://127.0.0.1:5201/");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting" && !!window.__diag);
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.__clampMouth?.valid && !!window.__three?.gl);
  return { browser, page };
}

export async function pour(page, reagentId) {
  return page.evaluate(async id => {
    const { runStandAction } = await import("/src/scenes/laboratory/lib/standTableActions.ts");
    const clickSim = window.__diag.frozen().simMs;
    const accepted = runStandAction({ kind: "bottle", location: "fumeHood", reagentId: id, instanceId: `sandbox-jar-${id}` });
    return { clickSim, accepted };
  }, reagentId);
}

export async function prepareSilver(page) {
  const first = await pour(page, "agno3");
  if (!first.accepted) throw new Error("AgNO3 stand action refused");
  await page.evaluate(async () => {
    const { useTubeCloseUpStore } = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
    useTubeCloseUpStore.getState().setViewing(true);
    window.__diag.setCamera({ dist: 0.3, lateral: 0, height: 0.02, targetY: -0.035, fov: 55 });
  });
  await page.waitForFunction(() => {
    const tube = window.__testTubeStorageStore?.getState().fumeHoodTestTubes[0];
    return !!tube && tube.contents.includes("agno3");
  }, null, { timeout: 30000 });
  // Stand's busyUntil is wall-clock based; leave the standard inter-action gap.
  await page.waitForTimeout(2500);
  const second = await pour(page, "nacl");
  if (!second.accepted) throw new Error("NaCl stand action refused");
  return second.clickSim;
}

export async function waitSimulationElapsed(page, clickSim, elapsedMs) {
  await page.waitForFunction(({ start, elapsed }) => window.__diag.frozen().simMs - start >= elapsed,
    { start: clickSim, elapsed: elapsedMs });
}

export async function tubeCrop(page) {
  return page.evaluate(() => {
    const m = window.__clampMouth, camera = window.__three.camera;
    camera.updateMatrixWorld();
    const V = camera.position.constructor;
    const side = new V().subVectors(m.point, m.rod).setY(0).normalize();
    const center = m.point.clone(); center.y -= 0.115; // the liquid sits in the lower part of the tube, well below the clamp
    const corners = [];
    for (const y of [-0.04, 0.03]) for (const x of [-0.012, 0.012]) {
      const p = center.clone().addScaledVector(side, x); p.y += y; p.project(camera);
      corners.push({ x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 });
    }
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))));
    const x1 = Math.min(innerWidth, Math.ceil(Math.max(...corners.map(p => p.x))));
    const y1 = Math.min(innerHeight, Math.ceil(Math.max(...corners.map(p => p.y))));
    if (x1 <= x0 || y1 <= y0) throw new Error("Tube is outside viewport");
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
}

export async function outputDir() {
  const out = process.env.OUT ?? "docs/night/wave11c4/captures";
  await mkdir(out, { recursive: true });
  return out;
}
