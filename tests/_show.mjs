import { chromium } from "playwright";
// Opens the real game, goes to the sandbox and starts experiment 2 with the cohesive-floc model, then stays open.
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--window-size=1400,950"] });
const page = await browser.newPage({ viewport: { width: 1380, height: 880 } });
page.setDefaultTimeout(900000);
await page.goto("http://127.0.0.1:5201/?silverStage=3");
await page.getByText("Играть", { exact: true }).click();
await page.getByText("Песочница (временно)").click();
await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 120000 });
await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 180000 });
await page.waitForTimeout(2000);
await page.getByRole("button", { name: "Опыт 2", exact: true }).click();
console.log("experiment 2 started");
await page.waitForTimeout(Number(process.env.KEEPOPEN ?? 600000));
await browser.close();
