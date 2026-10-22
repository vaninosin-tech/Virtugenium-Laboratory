// Freeze simulation while preserving the normal postprocessing render.
export async function freezeTubeFrame(page) {
  await page.evaluate(() => {
    const state = window.__three.get();
    window.__frozenTube = { subscribers: state.internal.subscribers,
      position: state.camera.position.clone(), quaternion: state.camera.quaternion.clone() };
    state.setFrameloop("never");
    state.internal.subscribers = state.internal.subscribers.filter(s => s.priority > 0);
  });
}
export async function renderTubeFrame(page, path) {
  await page.evaluate(() => window.__three.get().advance(0, false));
  await page.screenshot({ path });
}
export async function tubeTopView(page) {
  await page.evaluate(() => {
    const state = window.__three.get();
    let volume;
    state.scene.traverse(o => {
      if (o.isMesh && o.name.startsWith("ContentsVolume") && o.material?.uniforms?.uReactionKind?.value > 0) volume = o;
    });
    if (!volume) throw new Error("No reacting tube for top view");
    const u = volume.material.uniforms;
    const center = u.uBoundsMin.value.clone().addScaledVector(u.uBoundsSize.value, 0.5);
    center.y = u.uLevel.value;
    const target = volume.localToWorld(center);
    const radius = u.uBoundsSize.value.x * 0.5 * volume.getWorldScale(state.camera.position.clone()).x;
    const across = state.camera.position.clone().sub(target); across.y = 0; across.normalize();
    state.camera.position.copy(target).addScaledVector(across, radius * 15);
    state.camera.position.y += radius * 18;
    state.camera.lookAt(target);
    state.camera.updateMatrixWorld(true);
    u.uCameraLocal.value.copy(volume.worldToLocal(state.camera.position.clone()));
  });
}
export async function thawTubeFrame(page) {
  await page.evaluate(() => {
    const state = window.__three.get(), saved = window.__frozenTube;
    state.camera.position.copy(saved.position);
    state.camera.quaternion.copy(saved.quaternion);
    state.internal.subscribers = saved.subscribers;
    state.setFrameloop("always");
    delete window.__frozenTube;
  });
}
