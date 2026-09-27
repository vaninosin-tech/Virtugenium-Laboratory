import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto('http://localhost:5180/lab');
  await page.waitForFunction(() => window.__labScene && window.__trayCamera, { timeout: 60000 });
  await page.evaluate(async () => {
    const { useSceneInteractionStore } = await import('/src/scenes/laboratory/lib/useSceneInteractionStore.ts');
    useSceneInteractionStore.getState().beginCabinetFocus('cabinet-salts');
  });
  await page.waitForFunction(async () => {
    const { useSceneInteractionStore } = await import('/src/scenes/laboratory/lib/useSceneInteractionStore.ts');
    return useSceneInteractionStore.getState().cabinetPhase === 'inspecting';
  }, { timeout: 60000 });
  await page.evaluate(async () => {
    const ids = ['hno3', 'h2so4', 'agno3', 'nacl', 'bacl2', 'k2so4', 'na2so3', 'kmno4'];
    window.__storageStore.setState({
      trayItems: ids.map((reagentId, slotIndex) => ({
        instanceId: `grid-${slotIndex}`,
        reagentId,
        containerType: reagentId === 'hno3' ? 'amber250' : 'clear250',
        cabinetId: 'cabinet-salts',
        slotIndex,
      })),
    });
  });
  await page.waitForTimeout(800);
  const debug = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { useReagentPickablesStore } = await import('/src/scenes/laboratory/lib/useReagentPickablesStore.ts');
    const tray = useReagentPickablesStore.getState().objectsById['held-tray'];
    tray.updateMatrixWorld(true);
    const world = tray.getWorldPosition(new THREE.Vector3());
    const jars = tray.children.slice(1).map(child => {
      const p = child.getWorldPosition(new THREE.Vector3());
      const box = new THREE.Box3().setFromObject(child);
      const center = box.getCenter(new THREE.Vector3());
      return { world: p.toArray(), center: center.toArray(), centerProjected: center.clone().project(window.__trayCamera).toArray(), size: box.getSize(new THREE.Vector3()).toArray(), projected: p.clone().project(window.__trayCamera).toArray(), visible: child.visible };
    });
    return { world: world.toArray(), camera: window.__trayCamera.position.toArray(), projected: world.clone().project(window.__trayCamera).toArray(), scale: tray.scale.toArray(), children: tray.children.length, jars };
  });
  console.log(JSON.stringify(debug));
  await page.screenshot({ path: 'tests/tray-grid-render.png' });
} finally {
  await browser.close();
}
