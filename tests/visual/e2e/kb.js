// helper injected into do.mjs bodies: type a formula on the tablet keyboard into a textbox
globalThis.typeInto = async (page, label, tokens) => {
  await page.locator(`[role=textbox][aria-label="${label}"]`).first().click();
  await page.waitForTimeout(200);
  for (const t of tokens) {
    const btn = page.locator("button:not([disabled])").filter({ hasText: new RegExp("^" + t.replace(/[()+-]/g, (c) => "\\" + c) + "$", "i") }).first();
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(60);
  }
};
// screen position (CSS px) of a named 3D object, or of the first object matching a predicate source
globalThis.screenOf = async (page, name) => page.evaluate((name) => {
  const st = window.__three.get ? window.__three.get() : window.__three;
  const { camera, scene, gl } = st;
  let obj = null;
  scene.traverse((o) => { if (!obj && o.name === name && o.visible) obj = o; });
  if (!obj) return null;
  const THREE = Object.getPrototypeOf(camera.position).constructor;
  const v = new THREE(); obj.getWorldPosition(v); v.project(camera);
  const r = gl.domElement.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, z: v.z };
}, name);
globalThis.names = async (page, re) => page.evaluate((re) => {
  const st = window.__three.get ? window.__three.get() : window.__three;
  const out = new Set(); st.scene.traverse((o) => { if (o.name && new RegExp(re).test(o.name)) out.add(o.name); }); return [...out];
}, re);
globalThis.startClassic = async (page) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.getByText("Играть", { exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByText("Классический").click();
  await page.waitForFunction(() => window.__three && window.__sceneStore, null, { timeout: 90000 });
  await page.waitForTimeout(8000);
};
globalThis.accept1 = async (page) => {
  await page.getByText("Выберите опыт").click(); await page.waitForTimeout(800);
  await page.getByText("Опыт 1.").first().click(); await page.waitForTimeout(600);
  await page.getByText("Принять опыт").click(); await page.waitForTimeout(800);
  await typeInto(page, "Металл X", ["Caps", "c", "Caps", "u"]);
  await typeInto(page, "Жидкость Y", ["Caps", "h", "n", "o", "Caps", "X₂", "3"]);
  await page.getByText("Выполнить шаг").click(); await page.waitForTimeout(800);
};
globalThis.focus = async (page, id) => {
  if (await page.evaluate(() => window.__sceneStore.getState().cabinetPhase !== "room")) {
    await page.locator('button[aria-label="Назад"]').click();
    await page.waitForFunction(() => window.__sceneStore.getState().cabinetPhase === "room", null, { timeout: 30000 });
    await page.waitForTimeout(600);
  }
  // Same as aiming at a hotspot and clicking it (CameraRig: setActiveTarget + focus).
  await page.evaluate((id) => { const s = window.__sceneStore.getState(); s.setActiveTarget(id); s.requestFocus(id); }, id);
  await page.waitForFunction(() => window.__sceneStore.getState().cabinetPhase === "inspecting", null, { timeout: 30000 });
  await page.waitForTimeout(800);
};
globalThis.clickObj = async (page, name) => {
  const p = await screenOf(page, name);
  if (!p) throw new Error("no object " + name);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(600); return p;
};
globalThis.collect1 = async (page) => {
  await page.evaluate(() => window.__laboratoryStore.getState().closeTablet());
  await focus(page, "ppe-cabinet"); await page.waitForTimeout(800);
  for (const [x, y] of [[720, 135], [878, 135], [800, 382]]) { await page.mouse.click(x, y); await page.waitForTimeout(1200); }
  await focus(page, "cabinet-simple"); await page.waitForTimeout(800);
  await page.mouse.click(520, 395); await page.waitForTimeout(1500); await page.getByText("ВЗЯТЬ", { exact: true }).click(); await page.waitForTimeout(2500);
  await focus(page, "cabinet-acids"); await page.waitForTimeout(800);
  await page.mouse.click(521, 380); await page.waitForTimeout(1500); await page.getByText("ВЗЯТЬ", { exact: true }).click(); await page.waitForTimeout(2500);
  await focus(page, "cabinet-glassware"); await page.waitForTimeout(800);
  await page.mouse.click(648, 340); await page.waitForTimeout(2500); await page.mouse.click(676, 340); await page.waitForTimeout(2500);
  await focus(page, "cabinet-lab-equipment"); await page.waitForTimeout(800);
  await page.mouse.click(743, 330); await page.waitForTimeout(3000);
  await takeLamp(page);
};
// The spirit lamp is its own item on the equipment shelf (VL-014); the only lamp in the scene while it is there.
globalThis.takeLamp = async (page) => { await clickObj(page, "LampBody"); await page.waitForTimeout(2000); };
globalThis.back = async (page) => {
  await page.locator('button[aria-label="Назад"]').click();
  await page.waitForFunction(() => window.__sceneStore.getState().cabinetPhase === "room", null, { timeout: 30000 });
  await page.waitForTimeout(1500);
};
globalThis.doStep = async (page) => {
  await page.evaluate(() => window.__laboratoryStore.getState().openTablet());
  await page.waitForTimeout(900);
  await page.getByText("Выполнить шаг").click(); await page.waitForTimeout(900);
  await page.evaluate(() => window.__laboratoryStore.getState().closeTablet());
  await page.waitForTimeout(500);
};
globalThis.toTable = async (page) => {
  await page.evaluate(() => window.__sceneStore.getState().setActiveTarget("table"));
  await page.waitForTimeout(2500);
};
// The stand has no menu any more (VL-014): every action is a click on an object, decided by
// `standTableActions`. `act` keeps the old menu wording and runs the same action a click would.
// «Отойти» leaves the close-up via its button.
globalThis.panel = async (page) => console.log("HINT:", await page.evaluate(() => document.querySelector('[data-testid="stand-hint"]')?.textContent ?? null));
globalThis.act = async (page, text) => {
  if (text.startsWith("Отойти")) {
    const leave = page.locator('[data-testid="stand-leave"]');
    if (await leave.count()) await leave.click();
    await page.waitForTimeout(900);
    return;
  }
  const done = await page.evaluate(async (text) => {
    const { runStandAction } = await import("/src/scenes/laboratory/lib/standTableActions.ts");
    const { standLocation } = await import("/src/scenes/laboratory/lib/standStationActions.ts");
    const { REAGENTS } = await import("/src/entities/laboratory/reagents/index.ts");
    const location = standLocation();
    const plain = (formula) => formula.replace(/[₀-₉]/g, (d) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(d)));
    let m;
    if ((m = text.match(/^(?:Закрепить|Перелить из) пробирк[уи] (\d+)/))) return runStandAction({ kind: "rack-tube", location, index: Number(m[1]) - 1 });
    if ((m = text.match(/^(?:Насыпать|Прилить) (\S+)/))) {
      const reagent = Object.values(REAGENTS).find((r) => plain(r.formula).startsWith(plain(m[1])));
      return reagent ? runStandAction({ kind: "bottle", location, reagentId: reagent.id }) : false;
    }
    if (/^(Снять колпачок|Зажечь|Погасить)/.test(text)) return runStandAction({ kind: "burner" });
    if (/^(Снять лапку и нагреть|Вынуть пробирку)/.test(text)) return runStandAction({ kind: "clamped-tube" });
    return false;
  }, text);
  if (!done) throw new Error("act: no stand action for «" + text + "»");
  await page.waitForTimeout(900);
};
globalThis.standAtTable = async (page) => {
  await page.mouse.move(560, 488); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(2000);
};
globalThis.setup1 = async (page) => {
  await toTable(page); await standAtTable(page);
  await page.mouse.move(300, 700);
  await act(page, "Закрепить пробирку 1"); await act(page, "Насыпать Cu");
  await act(page, "Отойти"); await page.waitForTimeout(1500);
};
globalThis.heatByDragging = async (page) => {
  const svg = page.locator('svg[aria-label="Положение пробирки в пламени"]');
  const r = await svg.boundingBox();
  const k = r.width / 340;
  const L = { x: r.x + 22 * k, y: r.y + 22 * k }, V = { x: r.x + 170 * k, y: r.y + 119 * k }, R = { x: r.x + 318 * k, y: r.y + 22 * k };
  const at = (s) => (s < 0 ? { x: V.x + (L.x - V.x) * -s, y: V.y + (L.y - V.y) * -s } : { x: V.x + (R.x - V.x) * s, y: V.y + (R.y - V.y) * s });
  let p = at(-1); await page.mouse.move(p.x, p.y); await page.mouse.down();
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const phase = await page.evaluate(() => window.__heatingStore.getState().phase);
    if (phase !== "preheat") break;
    const ph = ((Date.now() - t0) / 5000) % 2; const a = ph <= 1 ? ph : 2 - ph;
    p = at(-1 + 2 * a); await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(40);
  }
  p = at(-1); await page.mouse.move(p.x, p.y, { steps: 10 });
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    if (await page.evaluate(() => window.__heatingStore.getState().phase) !== "heating") break;
    await page.waitForTimeout(200);
  }
  await page.mouse.up();
  return page.evaluate(() => window.__heatingStore.getState().phase);
};
globalThis.typeField = async (page, label, text) => {
  await page.locator(`[role=textbox][aria-label="${label}"]`).first().click();
  await page.waitForTimeout(150); await page.keyboard.type(text); await page.waitForTimeout(150);
};
globalThis.take = async (page, x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(1500); await page.getByText("ВЗЯТЬ", { exact: true }).click(); await page.waitForTimeout(2500); };
globalThis.SALT = { agno3: [521, 380], nacl: [669, 380], bacl2: [817, 380], k2so4: [965, 380], na2so3: [521, 610], kmno4: [669, 610] };
globalThis.collectTubeStand = async (page, tubes = 1) => {
  await focus(page, "cabinet-glassware"); await page.waitForTimeout(800);
  for (let i = 0; i < tubes; i++) { await page.mouse.click(648 + 28 * i, 340); await page.waitForTimeout(2500); }
  await focus(page, "cabinet-lab-equipment"); await page.waitForTimeout(800);
  await page.mouse.click(743, 330); await page.waitForTimeout(3000);
};
globalThis.equation = async (page, text) => {
  await page.evaluate(() => window.__laboratoryStore.getState().openTablet()); await page.waitForTimeout(900);
  const go = page.getByText("Перейти к уравнению и признаку");
  if (await go.count()) { await go.click(); await page.waitForTimeout(1200); }
  await page.getByText("Наберите уравнение").click(); await page.waitForTimeout(200);
  await page.keyboard.type(text); await page.waitForTimeout(200);
  await page.getByText("Далее", { exact: true }).click(); await page.waitForTimeout(1200);
};
globalThis.signs = async (page, labels) => {
  for (let i = 0; i < labels.length; i++) {
    await page.getByText(labels[i]).first().click(); await page.waitForTimeout(300);
    const last = i === labels.length - 1;
    await page.getByText(last ? "Завершить" : "Далее", { exact: true }).click(); await page.waitForTimeout(900);
  }
};
globalThis.acceptExp = async (page, n, fields) => {
  await page.getByText("Выберите опыт").click(); await page.waitForTimeout(800);
  await page.getByText(`Опыт ${n}.`).first().click(); await page.waitForTimeout(600);
  await page.getByText("Принять опыт").click(); await page.waitForTimeout(900);
  for (const [label, text] of fields) await typeField(page, label, text);
  await page.getByText("Выполнить шаг").click(); await page.waitForTimeout(900);
  await page.evaluate(() => window.__laboratoryStore.getState().closeTablet());
};
globalThis.ppe = async (page) => { await focus(page, "ppe-cabinet"); for (const [x, y] of [[720, 135], [878, 135], [800, 382]]) { await page.mouse.click(x, y); await page.waitForTimeout(1200); } };
