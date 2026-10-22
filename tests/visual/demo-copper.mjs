// Живая демонстрация опытов в видимом окне браузера.
// Запуск: node tests/visual/demo-live.mjs  (dev-сервер должен работать на 5173)
import { chromium } from "playwright";

const url = process.env.VISUAL_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--start-maximized", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});
const page = await (await browser.newContext({ viewport: null })).newPage();
const wait = (s) => page.waitForTimeout(s * 1000);

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("__demo_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_caption";
      el.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;" +
        "background:rgba(10,16,28,.92);color:#e8f4ff;font:600 20px sans-serif;padding:12px 22px;" +
        "border-radius:12px;border:1px solid rgba(120,200,255,.5);max-width:80vw;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function freshTube(id) {
  await page.evaluate(async (id) => {
    window.__tubeVisualTuningStore?.setState({ enabled: false });
    const heat = window.__heatingStore.getState();
    heat.exit(); heat.reset();
    window.__testTubeStorageStore.setState({ fumeHoodTestTubes: [{ instanceId: id, contents: [] }] });
    const closeUp = await import("/src/scenes/laboratory/lib/useTubeCloseUpStore.ts");
    closeUp.useTubeCloseUpStore.getState().setViewing(true);
  }, id);
}
const pour = (reagent) =>
  page.evaluate((r) => window.__testTubeStorageStore.getState().addTubeContents("fumeHood", 0, r), reagent);

await page.goto(url);
await page.getByText("Играть", { exact: true }).click();
await page.getByText("Песочница (временно)").click();
await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting", null, { timeout: 90000 });
await wait(2);

// Медь + разбавленная HNO₃: пузырьки на грануле и газ, затем нагрев по V.
await freshTube("demo-cu");
await caption("Медь + разбавленная HNO₃. Кладём гранулу меди…");
await wait(2); await pour("cu"); await wait(3);
await caption("Приливаем кислоту: на холоду гранулу облепляют мелкие пузырьки, газ копится из лопнувших");
await pour("hno3"); await wait(20);
await caption("Нагрев: лапку сняли, пробирку водят по V через пламя");
await page.evaluate(() => {
  const hs = window.__heatingStore; hs.getState().enter(() => 0.1); hs.getState().grab();
  const t0 = performance.now();
  window.__demoFollow = setInterval(() => {
    const s = hs.getState();
    if (s.phase === "preheat") {
      const ph = ((performance.now() - t0) / 5000) % 2; const a = ph <= 1 ? ph : 2 - ph;
      s.setSweep(-1 + 2 * a);
    } else if (s.phase === "heating") s.setSweep(-1);
    else { clearInterval(window.__demoFollow); setTimeout(() => s.exit(), 8000); }
  }, 30);
});
await wait(60);
await caption("Лапка снова в штативе: реакция идёт дальше, газ уходит через горлышко");
await wait(30);
await caption("Готово. Окно можно закрыть.");
await new Promise(() => {});
