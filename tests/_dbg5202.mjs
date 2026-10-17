import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.addInitScript(`window.__silverStage=${process.env.STAGE ?? 3};`);
await page.goto("http://127.0.0.1:5201");
await page.getByText("Играть", { exact: true }).click();
await page.getByText("Песочница (временно)").click();
await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 120000 });
await page.waitForTimeout(2000);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Debugger.enable");
page.getByRole("button", { name: "Опыт 2", exact: true }).click({ timeout: 90000 }).catch(() => {});
for (let k = 0; k < 2; k++) {
  await new Promise(r => setTimeout(r, 4000));
  const paused = new Promise(resolve => cdp.once("Debugger.paused", resolve));
  await cdp.send("Debugger.pause");
  const ev = await Promise.race([paused, new Promise(r => setTimeout(() => r(null), 8000))]);
  if (!ev) { console.log("sample", k, "no pause"); continue; }
  const frame = ev.callFrames.find(f => f.functionName === "setProgram");
  let info = "";
  if (frame) { try { const r = await cdp.send("Debugger.evaluateOnCallFrame", { callFrameId: frame.callFrameId, expression: "material.constructor.name + ' | ' + (material.fragmentShader ? material.fragmentShader.length : -1) + ' | ' + (material.uniforms ? Object.keys(material.uniforms).slice(0,8).join(',') : '-') + ' | ' + (material.name||'')" }); info = r.result.value; } catch (e) { info = "eval failed"; } }
  console.log("sample", k, ev.callFrames.slice(0, 4).map(f => f.functionName || "(anon)").join(" < "), info);
  await cdp.send("Debugger.resume");
}
await browser.close();
