import { mkdir, writeFile } from "node:fs/promises";
import { openSilverPage, prepareSilver, waitSimulationElapsed, tubeCrop } from "../_wave11/browserCommon.mjs";
import { percentile } from "./analysis.mjs";

const name=process.env.NAME??"baseline", out=process.env.OUT??"docs/night/wave13c8/captures";
const targets=(process.env.TIMES??"500,1000,1500,2000,3000,4500,6000,9000,12000,14000").split(",").map(Number);
if(targets.some(v=>!Number.isFinite(v)||v<0)||targets.some((v,i)=>i&&v<=targets[i-1])) throw new Error("TIMES must increase");
const manifest={name,init:process.env.INIT??"",clickSimMs:null,region:"central 50% width, vertical 25%-95% of tube crop; geometric proxy",captures:[]};
let referenceCoefficients;
let browser;
try {
  await mkdir(out,{recursive:true});
  const opened=await openSilverPage();browser=opened.browser;const {page}=opened;
  const clickSim=await prepareSilver(page);manifest.clickSimMs=clickSim;
  for(const target of targets) {
    await waitSimulationElapsed(page,clickSim,target);
    const frozen=await page.evaluate(()=>{window.__diag.pauseSimulation();return window.__diag.frozen();});
    if(!frozen.paused) throw new Error("pause failed");
    const crop=await tubeCrop(page);
    for(const background of ["black","gray","lab"]) for(const mode of [0,1,2,3]) {
      await page.evaluate(({background,mode})=>{window.__diag.setBackground(background);window.__diag.setOpticsMode(mode);},{background,mode});
      await page.waitForTimeout(150);
      const uniforms=await page.evaluate(()=>{
        let mesh;window.__three.scene.traverse(o=>{if(o.name==="TubeSilverDenseField")mesh=o;});
        const u=mesh?.material.uniforms;return {mode:u?.uOpticsMode.value,cloudOn:u?.uCloudOn.value,
          kappa:u?.uCloudK.value,albedo:u?.uAlbedo.value,lightStrength:u?.uLightStrength.value,
          ambient:u?.uAmbient.value,exposure:window.__three.gl.toneMappingExposure,
          simMs:window.__diag.frozen().simMs};
      });
      if(uniforms.simMs!==frozen.simMs||uniforms.mode!==mode||uniforms.cloudOn!==1) throw new Error("state changed during matrix");
      const coefficients={kappa:uniforms.kappa,albedo:uniforms.albedo,lightStrength:uniforms.lightStrength,ambient:uniforms.ambient,exposure:uniforms.exposure};
      if(referenceCoefficients&&JSON.stringify(coefficients)!==JSON.stringify(referenceCoefficients))throw new Error("optical coefficients changed");
      referenceCoefficients=coefficients;
      const file=`${name}_t${String(target).padStart(5,"0")}_bg-${background}_mode-${mode}.png`;
      const png=await page.screenshot({path:`${out}/${file}`,clip:crop});
      const pixels=await page.evaluate(async bytes=>{
        const blob=new Blob([new Uint8Array(bytes)],{type:"image/png"}),bitmap=await createImageBitmap(blob);
        const c=document.createElement("canvas");c.width=bitmap.width;c.height=bitmap.height;
        const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
        const {data}=ctx.getImageData(0,0,c.width,c.height), w=c.width,h=c.height;
        const lum=(x,y)=>{const i=4*(y*w+x);return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];};
        const liquid=[],rows=[],cols=[];
        for(let y=Math.floor(h*.25);y<Math.floor(h*.95);y++) {let rs=0,rn=0;
          for(let x=Math.floor(w*.25);x<Math.floor(w*.75);x++) {const v=lum(x,y);liquid.push(v);rs+=v;rn++;}
          rows.push(rs/rn);
        }
        for(let x=Math.floor(w*.25);x<Math.floor(w*.75);x++) {let cs=0,cn=0;
          for(let y=Math.floor(h*.25);y<Math.floor(h*.95);y++) {cs+=lum(x,y);cn++;}cols.push(cs/cn);
        }
        const bg=[];for(let y=0;y<Math.max(1,Math.floor(h*.1));y++)for(let x=0;x<Math.max(1,Math.floor(w*.1));x++)bg.push(lum(x,y));
        return {liquid,rows,cols,bg};
      },Array.from(png));
      const variance=a=>{const m=a.reduce((s,v)=>s+v,0)/a.length;return a.reduce((s,v)=>s+(v-m)**2,0)/a.length;};
      const bg=percentile(pixels.bg,.5), threshold=Number(process.env.CONTRAST_THRESHOLD??10);
      const contrast={backgroundLuminance:bg,threshold,mean: pixels.liquid.reduce((s,v)=>s+v,0)/pixels.liquid.length,
        p10:percentile(pixels.liquid,.1),p90:percentile(pixels.liquid,.9),
        brighterFraction:pixels.liquid.filter(v=>v>bg+threshold).length/pixels.liquid.length,
        horizontalVariance:variance(pixels.cols),verticalVariance:variance(pixels.rows)};
      manifest.captures.push({file,target,frozenSimMs:frozen.simMs,background,mode,crop,uniforms,contrast});
    }
    await page.evaluate(()=>{window.__diag.setBackground("lab");window.__diag.setOpticsMode(0);window.__diag.resumeSimulation();});
  }
  await writeFile(`${out}/${name}-optics.json`,JSON.stringify(manifest,null,2));
  console.log(`${manifest.captures.length} captures`);
}catch(e){console.error(e);process.exitCode=1;}finally{if(browser)await browser.close();}
