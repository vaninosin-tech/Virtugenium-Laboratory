// Живая демонстрация: опыт 1 в классическом режиме целиком, через интерфейс, с подписями.
// node tests/visual/e2e/demo-classic.mjs  (dev-сервер на 5173)
import { chromium } from "playwright";
import "./kb.js";

const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--window-size=1600,950"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const wait = (s) => page.waitForTimeout(s * 1000);
const caption = (t) => page.evaluate((t) => {
  let el = document.getElementById("__demo_caption");
  if (!el) {
    el = document.createElement("div"); el.id = "__demo_caption";
    el.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99999;background:rgba(10,16,28,.92);color:#e8f4ff;font:600 18px sans-serif;padding:10px 20px;border-radius:12px;border:1px solid rgba(120,200,255,.5);max-width:70vw;text-align:center;pointer-events:none";
    document.body.appendChild(el);
  }
  el.textContent = t;
}, t);

await startClassic(page);
await caption("Классический режим. Планшет: выбираем опыт 1 и определяем вещества");
await wait(2);
await accept1(page);
await caption("Шаг 2: СИЗ в шкафу, медь, кислота, две пробирки и штатив — всё берём руками");
await collect1(page);
await back(page);
await caption("Всё собранное на столе. Шаг 2 закрываем на планшете");
await wait(2);
await doStep(page);
await caption("Подходим к штативу на столе — камера подлетает, справа меню действий");
await toTable(page); await wait(1.5); await standAtTable(page); await page.mouse.move(300, 700); await wait(2.5);
await caption("Закрепляем пробирку в лапке и насыпаем медь — шаг «Подготовить установку» закрывается сам");
await act(page, "Закрепить пробирку 1"); await wait(1.5); await act(page, "Насыпать Cu"); await wait(3);
await act(page, "Отойти"); await wait(1.5);
await caption("Идём к вытяжке — панель «Перенести» открывается сама");
await page.evaluate(() => window.__sceneStore.getState().setActiveTarget("overview")); await wait(1.5);
await focus(page, "fume-hood"); await wait(3);
await caption("Переносим штатив, вторую пробирку и кислоту");
for (const t of ["Штатив со спиртовкой", "Пробирка 2", "HNO₃ разб."]) { await page.getByText(t).first().click(); await wait(0.6); }
await page.getByText("Перенести выбранное").click(); await wait(1.5);
await page.evaluate(() => window.__laboratoryStore.getState().closeTablet()); await wait(2.5);
await caption("Подходим к штативу в вытяжке");
await page.mouse.click(838, 470); await wait(3); await page.mouse.move(300, 700);
await caption("Приливаем кислоту к меди — реакция пошла");
await act(page, "Прилить HNO"); await wait(5);
await caption("Снимаем колпачок, зажигаем спиртовку — появляется «Нагреть»");
await act(page, "Снять колпачок"); await wait(1.5); await act(page, "Зажечь"); await wait(2.5);
await caption("Снимаем лапку и ведём пробирку по V через неподвижное пламя, потом держим дно в пламени");
await act(page, "Снять лапку и нагреть"); await wait(1.5);
await heatByDragging(page); await wait(3);
await caption("Содержимое нагрето — возвращаем лапку в штатив, гасим спиртовку");
await page.getByText("Вернуть лапку в штатив").click(); await wait(2.5);
await act(page, "Погасить"); await wait(4);
await act(page, "Отойти"); await wait(1.5);
await caption("Планшет: уравнение и признаки реакции");
await equation(page, "3Cu + 8HNO3 -> 3Cu(NO3)2 + 2NO + 4H2O"); await wait(1.5);
await signs(page, ["Голубой / синий", "NO — оксид азота(II)", "NO₂ — бурый (красно-бурый)"]);
await caption("Итог: оценка и ошибки попытки. Окно можно закрыть.");
await new Promise(() => {});
