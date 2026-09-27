import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5180/lab");
  await page.waitForFunction(() => window.__labScene && window.__trayCamera, { timeout: 60_000 });

  await page.evaluate(async () => {
    const { useLaboratoryStore } = await import("/src/stores/laboratory/useLaboratoryStore.ts");
    const { useDevMenuStore } = await import("/src/scenes/laboratory/lib/useDevMenuStore.ts");
    const { useSceneInteractionStore } = await import("/src/scenes/laboratory/lib/useSceneInteractionStore.ts");
    const { useReagentStorageStore } = await import("/src/scenes/laboratory/lib/useReagentStorageStore.ts");
    useLaboratoryStore.getState().setCameraView("table");
    // Gameplay pickup must stay available even if the F8 calibration menu
    // happens to be open; this was the user-visible regression.
    useDevMenuStore.getState().setOpen(true);
    useSceneInteractionStore.getState().setActiveTarget("table");
    useReagentStorageStore.setState({
      workbenchItems: [{
        instanceId: "return-test",
        reagentId: "nacl",
        containerType: "clear250",
        cabinetId: "cabinet-salts",
        slotIndex: 0,
      }],
    });
  });

  await page.waitForTimeout(500);
  const initialDebug = await page.evaluate(() => ({
    workbenchItems: window.__storageStore?.getState().workbenchItems,
    dragIds: Object.keys(window.__workbenchReagentDragStore?.getState().objectsById ?? {}),
  }));
  if (!initialDebug.dragIds.includes("return-test")) {
    throw new Error(`Workbench jar did not mount: ${JSON.stringify({ initialDebug, errors })}`);
  }

  await page.waitForFunction(() => Boolean(window.__workbenchReagentDragStore?.getState().objectsById["return-test"]));
  await page.waitForTimeout(1_000);

  // Bring the tray into the center of the table view with the existing
  // right-button orbit control before validating the return interaction.
  await page.mouse.move(600, 400);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(820, 400, { steps: 10 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(250);

  await page.waitForFunction(() => Boolean(window.__workbenchReagentDragStore?.getState().objectsById["return-test"]));

  const points = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { useWorkbenchReagentDragStore } = await import("/src/scenes/laboratory/lib/useWorkbenchReagentDragStore.ts");
    const { TRAY_RETURN_ZONE_POSITION } = await import("/src/scenes/laboratory/lib/trayReturnZone.ts");
    const object = useWorkbenchReagentDragStore.getState().objectsById["return-test"];
    object.updateWorldMatrix(true, true);
    const camera = window.__trayCamera;
    const canvas = document.querySelector("canvas");
    const rect = canvas.getBoundingClientRect();
    const world = object.getWorldPosition(new THREE.Vector3());
    const visibleCenter = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    const toScreen = (point) => {
      const projected = point.clone().project(camera);
      return {
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    return {
      jar: toScreen(world),
      jarHit: toScreen(visibleCenter),
      zone: toScreen(new THREE.Vector3(TRAY_RETURN_ZONE_POSITION[0], world.y, TRAY_RETURN_ZONE_POSITION[2])),
    };
  });

  await page.mouse.move(points.jarHit.x, points.jarHit.y);
  await page.waitForTimeout(150);
  assert.equal(await page.getByText("ВЕРНУТЬ", { exact: true }).count(), 0);
  await page.screenshot({ path: "tests/workbench-reagent-return-before.png" });

  // Releasing away from the tray must return the jar to its own slot and
  // hide the return affordance again.
  await page.mouse.down();
  await page.waitForFunction(() => document.body.innerText.includes("ВЕРНУТЬ"));
  const dragStart = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { useWorkbenchReagentDragStore } = await import("/src/scenes/laboratory/lib/useWorkbenchReagentDragStore.ts");
    const object = useWorkbenchReagentDragStore.getState().objectsById["return-test"];
    const world = object.getWorldPosition(new THREE.Vector3());
    const projected = world.clone().project(window.__trayCamera);
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
    };
  });
  await page.mouse.move(points.jarHit.x + 130, points.jarHit.y - 25, { steps: 10 });
  const dragMoved = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { useWorkbenchReagentDragStore } = await import("/src/scenes/laboratory/lib/useWorkbenchReagentDragStore.ts");
    const object = useWorkbenchReagentDragStore.getState().objectsById["return-test"];
    const world = object.getWorldPosition(new THREE.Vector3());
    const projected = world.clone().project(window.__trayCamera);
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
    };
  });
  assert.ok(Math.abs((dragMoved.x - dragStart.x) - 130) < 2, "jar and cursor must have equal horizontal speed");
  assert.ok(Math.abs((dragMoved.y - dragStart.y) + 25) < 2, "jar and cursor must have equal vertical speed");

  // Even an extreme cursor move cannot take the jar center beyond the
  // countertop's safe inset.
  await page.mouse.move(1, 400, { steps: 4 });
  const countertopCheck = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { TABLE } = await import("/src/scenes/laboratory/lib/layout.ts");
    const { useFurniturePositionStore } = await import("/src/scenes/laboratory/lib/useFurniturePositionStore.ts");
    const { useWorkbenchReagentDragStore } = await import("/src/scenes/laboratory/lib/useWorkbenchReagentDragStore.ts");
    const position = useFurniturePositionStore.getState().getOverride("table").position;
    const world = useWorkbenchReagentDragStore
      .getState()
      .objectsById["return-test"]
      .getWorldPosition(new THREE.Vector3());
    const margin = 0.08;
    const epsilon = 1e-6;
    return {
      inside: (
      world.x >= position[0] - TABLE.width / 2 + margin - epsilon &&
      world.x <= position[0] + TABLE.width / 2 - margin + epsilon &&
      world.z >= position[2] - TABLE.depth / 2 + margin - epsilon &&
      world.z <= position[2] + TABLE.depth / 2 - margin + epsilon
      ),
      world: world.toArray(),
      position,
      width: TABLE.width,
      depth: TABLE.depth,
    };
  });
  assert.equal(countertopCheck.inside, true, JSON.stringify(countertopCheck));
  await page.mouse.up();
  await page.waitForFunction(async () => {
    const { useWorkbenchReagentDragStore } = await import("/src/scenes/laboratory/lib/useWorkbenchReagentDragStore.ts");
    const { useReagentStorageStore } = await import("/src/scenes/laboratory/lib/useReagentStorageStore.ts");
    return (
      !useWorkbenchReagentDragStore.getState().overrides["return-test"] &&
      useReagentStorageStore.getState().workbenchItems.some((item) => item.instanceId === "return-test")
    );
  });
  const snappedPoint = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { useWorkbenchReagentDragStore } = await import("/src/scenes/laboratory/lib/useWorkbenchReagentDragStore.ts");
    const world = useWorkbenchReagentDragStore
      .getState()
      .objectsById["return-test"]
      .getWorldPosition(new THREE.Vector3());
    const projected = world.project(window.__trayCamera);
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
    };
  });
  assert.ok(Math.abs(snappedPoint.x - points.jar.x) < 2, "released jar must snap back horizontally");
  assert.ok(Math.abs(snappedPoint.y - points.jar.y) < 2, "released jar must snap back vertically");
  assert.equal(await page.getByText("ВЕРНУТЬ", { exact: true }).count(), 0);

  // A second pickup keeps the hover highlight active while the pointer
  // leaves the jar and carries it into the tray return zone.
  await page.mouse.move(points.jarHit.x, points.jarHit.y);
  await page.mouse.down();
  await page.waitForFunction(() => document.body.innerText.includes("ВЕРНУТЬ"));
  await page.mouse.move(points.zone.x, points.zone.y, { steps: 18 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "tests/workbench-reagent-return-hover.png" });
  await page.mouse.up();

  await page.waitForFunction(async () => {
    const { useReagentStorageStore } = await import("/src/scenes/laboratory/lib/useReagentStorageStore.ts");
    return !useReagentStorageStore.getState().workbenchItems.some((item) => item.instanceId === "return-test");
  });

  // Two table jars exchange their grid slots when one is released over the
  // other highlighted jar. Tray inventory is outside this interaction.
  await page.evaluate(async () => {
    const { useReagentStorageStore } = await import("/src/scenes/laboratory/lib/useReagentStorageStore.ts");
    useReagentStorageStore.setState({
      workbenchItems: [
        { instanceId: "swap-a", reagentId: "nacl", containerType: "clear250", cabinetId: "cabinet-salts", slotIndex: 0 },
        { instanceId: "swap-b", reagentId: "agno3", containerType: "clear250", cabinetId: "cabinet-salts", slotIndex: 1 },
      ],
      trayItems: [],
    });
  });
  await page.waitForFunction(() => {
    const objects = window.__workbenchReagentDragStore?.getState().objectsById ?? {};
    return Boolean(objects["swap-a"] && objects["swap-b"]);
  });
  await page.waitForTimeout(100);
  const swapPoints = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { useWorkbenchReagentDragStore } = await import("/src/scenes/laboratory/lib/useWorkbenchReagentDragStore.ts");
    const rect = document.querySelector("canvas").getBoundingClientRect();
    const toScreen = (instanceId) => {
      const world = useWorkbenchReagentDragStore
        .getState()
        .objectsById[instanceId]
        .getWorldPosition(new THREE.Vector3());
      const projected = world.project(window.__trayCamera);
      return {
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    return { first: toScreen("swap-a"), second: toScreen("swap-b") };
  });
  await page.mouse.move(swapPoints.first.x, swapPoints.first.y);
  await page.mouse.down();
  await page.mouse.move(swapPoints.second.x, swapPoints.second.y, { steps: 12 });
  await page.waitForFunction(
    () => window.__workbenchReagentDragStore?.getState().swapTargetInstanceId === "swap-b",
  );
  await page.mouse.up();
  await page.waitForFunction(async () => {
    const { useReagentStorageStore } = await import("/src/scenes/laboratory/lib/useReagentStorageStore.ts");
    return useReagentStorageStore.getState().workbenchItems.map((item) => item.instanceId).join(",") === "swap-b,swap-a";
  });
  const swappedSeparation = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { useWorkbenchReagentDragStore } = await import("/src/scenes/laboratory/lib/useWorkbenchReagentDragStore.ts");
    const objects = useWorkbenchReagentDragStore.getState().objectsById;
    const first = objects["swap-a"].getWorldPosition(new THREE.Vector3());
    const second = objects["swap-b"].getWorldPosition(new THREE.Vector3());
    return first.distanceTo(second);
  });
  assert.ok(swappedSeparation > 0.1, "swapped jars must remain in two distinct slots");

  assert.deepEqual(errors, []);
  console.log("PASS: 1:1 bounded drag, snap-back, tray return, and workbench-only jar swapping.");
} finally {
  await browser.close();
}
