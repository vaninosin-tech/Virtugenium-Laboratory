import {mkdir,writeFile} from 'node:fs/promises';
import {openSilverPage,prepareSilver,waitSimulationElapsed,tubeCrop} from '../_wave11/browserCommon.mjs';
import {luminanceContrast} from '../_wave16/imageMetrics.mjs';

process.env.INIT=`${process.env.INIT??''};window.__silverAgg=true;`;
const out=process.env.OUT??'docs/night/wave19s2/browser';
const times=(process.env.TIMES_MS??'3000,6000,9000,14000,22000').split(',').map(Number);
const modes=['fine','sections','nodes','sediment','combined'];
const backgrounds=['lab','black','gray'];
await mkdir(out,{recursive:true});
const manifest={config:process.env.INIT,times,captures:[]};
let browser;
try{
  const opened=await openSilverPage();browser=opened.browser;
  const page=opened.page,clickSim=await prepareSilver(page);
  for(const target of times){
    await waitSimulationElapsed(page,clickSim,target);
    const frozen=await page.evaluate(()=>{window.__diag.pauseSimulation();return window.__diag.frozen();});
    if(!frozen.paused)throw new Error('Simulation did not pause');
    const crop=await tubeCrop(page);
    const setup=await page.evaluate(()=>{
      const id=window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
      const field=id&&window.__silverRuntime.field(id);
      let mesh,bed;window.__three.scene.traverse(o=>{if(o.name==='TubeSilverDenseField')mesh=o;if(o.name==='TubeSediment')bed=o;});
      if(!field||!mesh||!bed)throw new Error('Silver diagnostic objects missing');
      const original=mesh.material.uniforms.uAggregate.value;
      const nodes=field.flocSystem?.nodes?.length??0;
      const sections=field.aggregateSectionTexture;
      if(nodes>0&&!sections)throw new Error('Node split requires field.aggregateSectionTexture');
      const sectionTexture=field.aggregateTexture.clone();
      sectionTexture.image={...field.aggregateTexture.image,data:new Float32Array(field.aggregateTexture.image.data)};
      const sectionPixels=sections?.image.data;
      if(sections&&sectionPixels.length!==field.aggregateTexture.image.data.length&&sectionPixels.length*4!==field.aggregateTexture.image.data.length)throw new Error('Section texture dimensions mismatch');
      if(nodes>0&&sectionPixels.length!==field.aggregateTexture.image.data.length)throw new Error('Node split requires RGBA aggregateSectionTexture');
      const nodeTexture=field.aggregateTexture.clone();
      nodeTexture.image={...field.aggregateTexture.image,data:new Float32Array(field.aggregateTexture.image.data)};
      const data=nodeTexture.image.data;
      for(let i=0;i<data.length;i+=4){
        const section=sections?(sectionPixels.length===data.length?sectionPixels[i]:sectionPixels[i/4]):(nodes===0?data[i]:0);
        const node=Math.max(0,data[i]-section);
        if(sections&&sectionPixels.length===data.length){
          sectionTexture.image.data[i+1]=sectionPixels[i+1];
          sectionTexture.image.data[i+2]=sectionPixels[i+2];
          sectionTexture.image.data[i+3]=sectionPixels[i+3];
          if(node>0){data[i+1]=(data[i]*data[i+1]-section*sectionPixels[i+1])/node;data[i+2]=(data[i]*data[i+2]-section*sectionPixels[i+2])/node;}
        }
        sectionTexture.image.data[i]=section;data[i]=node;
        if(node===0){data[i+1]=0;data[i+2]=0;data[i+3]=0;}
      }
      nodeTexture.needsUpdate=true;sectionTexture.needsUpdate=true;
      window.__wave19Rep={mesh,bed,field,original,nodeTexture,sectionTexture,nodes,bedVisible:bed.visible};
      return {nodes,sectionMass:field.sections?.totalMass??0,sedimentMass:field.sedimentField.mass};
    });
    for(const background of backgrounds)for(const rep of modes)for(const optics of [0,1,2,3]){
      const state=await page.evaluate(({background,rep,optics})=>{
        const r=window.__wave19Rep,u=r.mesh.material.uniforms;
        window.__diag.setBackground(background);window.__diag.setOpticsMode(optics);
        u.uAggregate.value=rep==='nodes'?r.nodeTexture:rep==='sections'?r.sectionTexture:r.original;
        u.uSolidMode.value=rep==='fine'?1:rep==='sediment'?3:rep==='combined'?0:2;
        r.bed.visible=(rep==='sediment'||rep==='combined')&&r.bedVisible;
        return {...window.__diag.frozen(),background,rep,optics,nodes:r.nodes,
          fineMass:r.field.suspensionMass+r.field.coarseMass,sectionMass:r.field.sections?.totalMass??0,
          nodeMass:r.field.flocSystem.nodes.reduce((s,n)=>s+n.mass,0),sedimentMass:r.field.sedimentField.mass,
          cloudK:u.uCloudK.value,aggregateK:17};
      },{background,rep,optics});
      if(!state.paused||state.simMs!==frozen.simMs)throw new Error('Frozen state changed');
      await page.waitForTimeout(120);
      const file=`t${target}-${rep}-optics${optics}-${background}.png`;
      const png=await page.screenshot({path:`${out}/${file}`,clip:crop});
      let luminance;
      if(optics===0){
        const decoded=await page.evaluate(async base64=>{const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:image.width,height:image.height,rgba:Array.from(ctx.getImageData(0,0,image.width,image.height).data)};},png.toString('base64'));
        luminance=luminanceContrast(decoded.rgba,decoded.width,decoded.height);
      }
      manifest.captures.push({file,target,state,crop,luminance});
    }
    await page.evaluate(()=>{
      const r=window.__wave19Rep;
      r.mesh.material.uniforms.uAggregate.value=r.original;
      r.mesh.material.uniforms.uSolidMode.value=0;r.bed.visible=r.bedVisible;
      r.nodeTexture.dispose();r.sectionTexture.dispose();delete window.__wave19Rep;
      window.__diag.setBackground('lab');window.__diag.setOpticsMode(0);
      window.__diag.resumeSimulation();
    });
    manifest.captures.at(-1).source=setup;
  }
  await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2));
}finally{if(browser)await browser.close();}
