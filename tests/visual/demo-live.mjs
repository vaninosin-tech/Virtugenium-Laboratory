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

// 1. Медь + разбавленная азотная кислота, с нагревом
await freshTube("demo-cu");
await caption("Опыт 1. Медь + разбавленная HNO₃. Кладём гранулу меди…");
await wait(2); await pour("cu"); await wait(3);
await caption("Приливаем азотную кислоту — на холоду реакция идёт медленно, редкие пузырьки");
await pour("hno3"); await wait(8);
await caption("Нагреваем: пробирка ходит через пламя, реакция ускоряется, раствор голубеет, над ним бурый NO₂");
await page.evaluate(() => {
  const hs = window.__heatingStore; hs.getState().enter(); hs.getState().grab();
  window.__demoFollow = setInterval(() => { const s = hs.getState(); s.setSweep(s.target); if (s.phase === "done") clearInterval(window.__demoFollow); }, 30);
});
await wait(45);
await caption("Реакция закончилась: голубой раствор Cu(NO₃)₂, остатки бурого газа у воды");
await wait(12);

// 2. AgNO₃ + NaCl
await freshTube("demo-agcl");
await caption("Опыт 2. Нитрат серебра + хлорид натрия");
await pour("agno3"); await wait(3);
await caption("Приливаем NaCl — сразу белая творожистая муть AgCl, хлопья оседают");
await pour("nacl"); await wait(16);

// 3. BaCl₂ + K₂SO₄
await freshTube("demo-baso4");
await caption("Опыт 3. Хлорид бария + сульфат калия");
await pour("bacl2"); await wait(3);
await caption("Приливаем K₂SO₄ — молочная взвесь BaSO₄, медленно оседает белым порошком");
await pour("k2so4"); await wait(50);
await caption("Осадок на дне, над ним ещё лёгкая муть и налёт на стенках");
await wait(8);

// 4. KMnO₄ + H₂SO₄ + Na₂SO₃
await freshTube("demo-kmno4");
await caption("Опыт 4. Сульфит натрия + серная кислота (бесцветные)");
await pour("na2so3"); await pour("h2so4"); await wait(4);
await caption("Приливаем перманганат калия — малиновый, затем обесцвечивается");
await pour("kmno4"); await wait(10);

await caption("Демонстрация окончена. Окно можно закрыть.");
await new Promise(() => {});
