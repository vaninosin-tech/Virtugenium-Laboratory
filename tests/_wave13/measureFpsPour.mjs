import { mkdir, writeFile } from "node:fs/promises";
import { openSilverPage, pour } from "../_wave11/browserCommon.mjs";
import { percentile } from "./analysis.mjs";

const name=process.env.NAME??"baseline", runs=Math.max(3,Number(process.env.RUNS??3));
const out=process.env.OUT??"docs/night/wave13c8/captures";
const report={name,init:process.env.INIT??"",runs:[],notes:["requestAnimationFrame intervals include browser scheduling", "GPU query is cloud-mesh draw time when extension is exposed"]};
await mkdir(out,{recursive:true});
for(const cloud of [false,true]) for(let run=0;run<runs;run++) {
  let browser;
  try {
    const opened=await openSilverPage();browser=opened.browser;const {page}=opened;
    if(!(await pour(page,"agno3")).accepted)throw new Error("AgNO3 refused");
    await page.waitForFunction(()=>window.__testTubeStorageStore?.getState().fumeHoodTestTubes[0]?.contents.includes("agno3"));
    await page.waitForTimeout(2500);
    await page.evaluate(cloud=>{
      window.__silverCloud=cloud;
      const id=window.__testTubeStorageStore.getState().fumeHoodTestTubes[0].instanceId;
      const renderer=window.__three.gl,gl=renderer.getContext(),ext=gl.getExtension("EXT_disjoint_timer_query_webgl2");
      const measure={frames:[],steps:[],queries:[],gpuMs:[],gpuAvailable:!!ext,started:performance.now(),clickPerf:null,done:false};
      window.__wave13perf=measure;
      if(ext){const originalRender=renderer.render;renderer.render=function(...args){
        const q=gl.createQuery();if(!q)return originalRender.apply(this,args);
        gl.beginQuery(ext.TIME_ELAPSED_EXT,q);
        try{return originalRender.apply(this,args);}finally{gl.endQuery(ext.TIME_ELAPSED_EXT);measure.queries.push({q,perf:performance.now()});}
      };}
      let last=performance.now(),wrapped=null;
      const frame=()=>{
        const now=performance.now(),f=window.__silverRuntime?.field(id);
        if(f&&f!==wrapped){const original=f.advance;f.advance=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{measure.steps.push({perf:performance.now(),totalMs:performance.now()-t,solverMs:this.solver.lastStepMs});}};wrapped=f;}
        if((measure.clickPerf===null || now-measure.clickPerf<=8000) && now-measure.started>=0)
          measure.frames.push({perf:now,dt:now-last,solverMs:f?.solver.lastStepMs??null});
        last=now;if(!measure.done)requestAnimationFrame(frame);
      };requestAnimationFrame(frame);
    },cloud);
    await page.waitForTimeout(1000);
    const accepted=await page.evaluate(async()=>{
      const {runStandAction}=await import("/src/scenes/laboratory/lib/standTableActions.ts");
      window.__wave13perf.clickPerf=performance.now();
      return runStandAction({kind:"bottle",location:"fumeHood",reagentId:"nacl",instanceId:"sandbox-jar-nacl"});
    });if(!accepted)throw new Error("NaCl refused");
    await page.waitForTimeout(8100);
    const raw=await page.evaluate(()=>{
      const p=window.__wave13perf;p.done=true;const gl=window.__three.gl.getContext(),ext=gl.getExtension("EXT_disjoint_timer_query_webgl2");
      for(const {q,perf} of p.queries){if(perf>=p.clickPerf-1000&&perf<=p.clickPerf+8000&&gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(ext.GPU_DISJOINT_EXT))p.gpuMs.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);}p.queries=[];
      return {frames:p.frames,steps:p.steps,gpuMs:p.gpuMs,gpuAvailable:p.gpuAvailable,clickPerf:p.clickPerf};
    });
    raw.frames=raw.frames.filter(f=>f.perf>=raw.clickPerf-1000&&f.perf<=raw.clickPerf+8000);
    const times=raw.frames.map(f=>f.dt),solver=raw.steps.map(s=>s.solverMs),transport=raw.steps.map(s=>s.totalMs-s.solverMs);
    const summary={cloud,run,frameCount:times.length,medianFps:1000/percentile(times,.5),p10Fps:1000/percentile(times,.9),
      peakFrameMs:Math.max(...times),framesOver50:times.filter(t=>t>50).length,framesOver100:times.filter(t=>t>100).length,
      solverPeakMs:solver.length?Math.max(...solver):null,solverP90Ms:percentile(solver,.9),
      fieldAdvancePeakMs:raw.steps.length?Math.max(...raw.steps.map(s=>s.totalMs)):null,
      nonSolverAdvanceP90Ms:percentile(transport,.9),gpuMedianMs:percentile(raw.gpuMs,.5),gpuAvailable:raw.gpuAvailable,gpuSamples:raw.gpuMs.length};
    report.runs.push(summary);
    await writeFile(`${out}/${name}-fps-${cloud?"on":"off"}-${run}.json`,JSON.stringify({summary,...raw}));
    console.log(summary);
  }catch(e){console.error(e);process.exitCode=1;report.runs.push({cloud,run,error:String(e)});}finally{if(browser)await browser.close();}
}
await writeFile(`${out}/${name}-fps-summary.json`,JSON.stringify(report,null,2));
