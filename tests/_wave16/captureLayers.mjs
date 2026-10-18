import { mkdir, writeFile } from "node:fs/promises";
import { openSilverPage, prepareSilver, waitSimulationElapsed, tubeCrop } from "../_wave11/browserCommon.mjs";
import { luminanceContrast, sedimentMoireMetric } from "./imageMetrics.mjs";

process.env.INIT = `${process.env.INIT ?? ""};window.__silverAgg=true;`;
const output = process.env.OUT ?? "docs/night/wave17f2/browser";
await mkdir(output, { recursive: true });
const targets = (process.env.TIMES_MS ?? "1500,3000,6000,9000").split(",").map(Number);
const manifest = { clickSimMs: null, captures: [] };
let browser;
try {
  const opened = await openSilverPage(); browser = opened.browser;
  const { page } = opened;
  const clickSim = await prepareSilver(page); manifest.clickSimMs = clickSim;
  for (const target of targets) {
    await waitSimulationElapsed(page, clickSim, target);
    const frozen = await page.evaluate(() => {
      window.__diag.pauseSimulation();
      window.__three.scene.traverse(object => {
        if (object.name === "TubeSediment") object.userData.depositedVisible = object.visible;
      });
      return window.__diag.frozen();
    });
    if (!frozen.paused) throw new Error("Simulation did not pause");
    const crop = await tubeCrop(page);
    for (const background of ["lab", "black", "gray"])
      for (const layer of [0, 1, 2, 3])
        for (const optics of [0, 1, 2, 3]) {
          const state = await page.evaluate(({ background, layer, optics }) => {
            window.__diag.setBackground(background); window.__diag.setOpticsMode(optics);
            let mesh; window.__three.scene.traverse(object => { if (object.name === "TubeSilverDenseField") mesh = object; });
            if (!mesh) throw new Error("Silver mesh missing");
            mesh.material.uniforms.uSolidMode.value = layer;
            window.__three.scene.traverse(object => {
              if (object.name === "TubeSediment") object.visible = (layer === 0 || layer === 3) && object.userData.depositedVisible === true;
            });
            return { ...window.__diag.frozen(), layer, optics, background,
              kappa: mesh.material.uniforms.uCloudK.value, aggregateKappa: 17,
              light: mesh.material.uniforms.uLightStrength.value, ambient: mesh.material.uniforms.uAmbient.value,
              exposure: window.__three.gl.toneMappingExposure };
          }, { background, layer, optics });
          if (!state.paused || state.simMs !== frozen.simMs) throw new Error("Frozen state changed during matrix");
          await page.waitForTimeout(120);
          const file = `silver-t${target}-sim${Math.round(frozen.simMs)}-layer${layer}-optics${optics}-bg${background}.png`;
          const png=await page.screenshot({ path: `${output}/${file}`, clip: crop });
          let metrics;
          if(optics===0){
            const decoded=await page.evaluate(async base64=>{const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();
              const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
              const context=canvas.getContext("2d");context.drawImage(image,0,0);
              return {width:image.width,height:image.height,rgba:Array.from(context.getImageData(0,0,image.width,image.height).data)};
            },png.toString("base64"));
            metrics={luminance:luminanceContrast(decoded.rgba,decoded.width,decoded.height)};
            if(layer===3)metrics.moire=sedimentMoireMetric(decoded.rgba,decoded.width,decoded.height);
          }
          manifest.captures.push({ file, target, state, crop, metrics });
        }
    // Deliberately enlarged display-only surface: a thin physical deposit cannot
    // establish whether a repeated shader or mesh pattern is actually absent.
    const diagnosticScale = Number(process.env.SEDIMENT_DIAGNOSTIC_SCALE ?? 10);
    const diagnosticSynthetic = process.env.SEDIMENT_DIAGNOSTIC_SYNTHETIC !== "0";
    if (diagnosticScale >= 5 && diagnosticScale <= 20) for (const background of ["lab", "black", "gray"]) {
      const state = await page.evaluate(({ background, diagnosticScale, diagnosticSynthetic }) => {
        const id = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
        const field = id && window.__silverRuntime.field(id);
        let bed; window.__three.scene.traverse(object => { if (object.name === "TubeSediment") bed = object; });
        if (!bed || !field) throw new Error("Sediment diagnostic lacks field or mesh");
        window.__diag.setBackground(background); window.__diag.setOpticsMode(0);
        const physical = field.sedimentHeightTexture;
        const texture = physical.clone();
        texture.image = { ...physical.image, data: new Float32Array(physical.image.data) };
        if (diagnosticSynthetic) {
          const {width:nx,height:nz,data} = texture.image;
          for (let z=0;z<nz;z++) for (let x=0;x<nx;x++) {
            const u=(x+.5)/nx*2-1,v=(z+.5)/nz*2-1,r2=u*u+v*v;
            data[x+nx*z]=r2<.8 ? .00007*(1-r2/.8)*(1+.18*Math.sin(7*u+3*v)+.12*Math.cos(5*v-2*u)) : 0;
          }
        }
        texture.needsUpdate = true; bed.userData.diagnosticTexture = texture;
        window.__silverSedimentDiagnosticTexture = texture;
        window.__silverSedimentDiagnosticScale = diagnosticScale;
        if (bed.material.userData.sedimentShader) bed.material.userData.sedimentShader.uniforms.uSedimentHeight.value = texture;
        bed.visible = diagnosticSynthetic || field.sedimentField.mass > 0;
        bed.geometry.update(field.sedimentField, texture, diagnosticScale);
        return { ...window.__diag.frozen(), background, diagnosticScale, diagnosticSynthetic, sedimentMass: field.sedimentField.mass };
      }, { background, diagnosticScale, diagnosticSynthetic });
      await page.waitForTimeout(120);
      const file = `silver-t${target}-sediment-diagnostic-x${diagnosticScale}-bg${background}.png`;
      const png = await page.screenshot({ path: `${output}/${file}`, clip: crop });
      const decoded = await page.evaluate(async base64 => { const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d"); context.drawImage(image,0,0);
        return { width:image.width, height:image.height, rgba:Array.from(context.getImageData(0,0,image.width,image.height).data) };
      }, png.toString("base64"));
      manifest.captures.push({ file, target, state, crop, metrics:{ moire:sedimentMoireMetric(decoded.rgba,decoded.width,decoded.height) } });
      await page.evaluate(() => { let bed; window.__three.scene.traverse(object => { if (object.name === "TubeSediment") bed = object; });
        if (!bed) return; const id=window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
        const field=id&&window.__silverRuntime.field(id);
        if (field) { bed.geometry.update(field.sedimentField,field.sedimentHeightTexture,1);
          if (bed.material.userData.sedimentShader) bed.material.userData.sedimentShader.uniforms.uSedimentHeight.value=field.sedimentHeightTexture; }
        delete window.__silverSedimentDiagnosticTexture; delete window.__silverSedimentDiagnosticScale;
        bed.userData.diagnosticTexture?.dispose(); bed.userData.diagnosticTexture=null;
      });
    }
    await page.evaluate(() => {
      window.__diag.setBackground("lab"); window.__diag.setOpticsMode(0);
      window.__three.scene.traverse(object => {
        if (object.name === "TubeSilverDenseField") object.material.uniforms.uSolidMode.value = 0;
        if (object.name === "TubeSediment") {
          object.visible = object.userData.depositedVisible === true;
          const id = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
          const field = id && window.__silverRuntime.field(id);
          if (field) object.geometry.update(field.sedimentField, field.sedimentHeightTexture, 1);
        }
      });
      window.__diag.resumeSimulation();
    });
  }
  await writeFile(`${output}/captureLayers.json`, JSON.stringify(manifest, null, 2));
  console.log(`Captured ${manifest.captures.length} frames in ${output}`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (browser) await browser.close(); }
