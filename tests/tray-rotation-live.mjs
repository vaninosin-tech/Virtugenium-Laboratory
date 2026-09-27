import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto("http://127.0.0.1:5180/lab");
  await page.waitForFunction(() => window.__labScene && window.__trayCamera, { timeout: 60_000 });

  await page.evaluate(async () => {
    const { useSceneInteractionStore } = await import(
      "/src/scenes/laboratory/lib/useSceneInteractionStore.ts"
    );
    useSceneInteractionStore.getState().beginCabinetFocus("cabinet-simple");
  });
  await page.waitForFunction(
    () => window.__sceneStore?.getState().cabinetPhase === "inspecting",
    { timeout: 60_000 },
  );

  const before = await page.evaluate(async () => {
    const { useReagentPickablesStore } = await import(
      "/src/scenes/laboratory/lib/useReagentPickablesStore.ts"
    );
    const { useSceneInteractionStore } = await import(
      "/src/scenes/laboratory/lib/useSceneInteractionStore.ts"
    );
    const tray = useReagentPickablesStore.getState().objectsById["held-tray"];
    const tableTray = window.__labScene.getObjectByName("lab-tray-table");
    return {
      quaternion: tray.quaternion.toArray(),
      position: tray.position.toArray(),
      scale: tray.scale.x,
      tableQuaternion: tableTray?.quaternion.toArray(),
      tablePosition: tableTray?.position.toArray(),
      scene: useSceneInteractionStore.getState(),
    };
  });

  await page.evaluate(async () => {
    const { useDevMenuStore } = await import(
      "/src/scenes/laboratory/lib/useDevMenuStore.ts"
    );
    useDevMenuStore.getState().setCategory("tray");
    useDevMenuStore.getState().setOpen(true);
  });
  await page.getByRole("slider", { name: "Rot X (°)" }).fill("35");
  await page.getByRole("slider", { name: "Rot Y (°)" }).fill("90");
  await page.getByRole("slider", { name: "Rot Z (°)" }).fill("-20");
  await page.waitForTimeout(600);

  const after = await page.evaluate(async () => {
    const { useReagentPickablesStore } = await import(
      "/src/scenes/laboratory/lib/useReagentPickablesStore.ts"
    );
    const { useNavButtonCalibrationStore } = await import(
      "/src/scenes/laboratory/lib/useNavButtonCalibrationStore.ts"
    );
    const { useSceneInteractionStore } = await import(
      "/src/scenes/laboratory/lib/useSceneInteractionStore.ts"
    );
    const tray = useReagentPickablesStore.getState().objectsById["held-tray"];
    const tableTray = window.__labScene.getObjectByName("lab-tray-table");
    return {
      quaternion: tray.quaternion.toArray(),
      position: tray.position.toArray(),
      scale: tray.scale.x,
      tableQuaternion: tableTray?.quaternion.toArray(),
      tablePosition: tableTray?.position.toArray(),
      config: useNavButtonCalibrationStore.getState().heldTray,
      scene: useSceneInteractionStore.getState(),
    };
  });

  console.log(JSON.stringify({ before, after }));
  assert.notDeepEqual(after.quaternion, before.quaternion);
  assert.notDeepEqual(after.position, [-0.925, 0.9, -0.733125]);
  assert.deepEqual(before.position, [-0.925, 0.9, -0.733125]);
  assert.deepEqual(after.tableQuaternion, before.tableQuaternion);
  assert.deepEqual(after.tablePosition, before.tablePosition);
  assert.ok(Math.abs(after.config.rotY - Math.PI / 2) < 1e-10);

  await page.evaluate(() => window.__sceneStore.getState().requestCabinetReturn());
  await page.waitForTimeout(40);
  const duringReturn = await page.evaluate(() => {
    const tray = window.__labScene.getObjectByName("lab-tray-held");
    return { visible: tray?.visible, scale: tray?.scale.x };
  });
  assert.equal(duringReturn.visible, false);
  console.log("PASS: held tray reacts to Rot X/Y/Z store updates.");
} finally {
  await browser.close();
}
