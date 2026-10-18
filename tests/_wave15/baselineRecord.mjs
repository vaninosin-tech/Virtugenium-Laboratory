import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { stageMarkers } from "./comparisonCore.mjs";
import { tubeCrop } from "../_wave11/browserCommon.mjs";

const root=process.env.OUT??"docs/night/wave15r2/captures";
const modes=process.env.BOTH==="1"?["wide","close"]:[process.env.CAMERA??"wide"];
const cameras={wide:{dist:.42,fov:30,targetY:-.045,targetSide:.02},close:{dist:.2,fov:20,targetY:-.115,targetSide:0}};
const dumpAt=JSON.parse(process.env.DUMPAT??"[500,1000,2000,3000,4500,6000,9000,12000,14000,17000,20000,22000,24000]");
const durationMs=Number(process.env.DURATION_MS??24000);
const slow=Number(process.env.SLOW??.15);
if(!(slow>0&&slow<=1)||!(durationMs>0)||!dumpAt.every(t=>Number.isFinite(t)&&t>=0))throw new RangeError("SLOW, DURATION_MS or DUMPAT");

for(const mode of modes){
  if(!cameras[mode])throw new RangeError(`CAMERA ${mode}`);
  const out=join(root,mode);await mkdir(join(out,"frames"),{recursive:true});
  const browser=await chromium.launch({headless:false,channel:"chrome",args:["--window-size=1400,950","--disable-renderer-backgrounding","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-features=CalculateNativeWinOcclusion"]});
  try{
    const page=await browser.newPage({viewport:{width:Number(process.env.VW??1280),height:Number(process.env.VH??800)}});
    page.setDefaultTimeout(300000);
    await page.addInitScript(k=>{const original=Date.now.bind(Date),base=original();Date.now=()=>base+(original()-base)*k;},slow);
    await page.addInitScript(`window.__silverStage=3;window.__silverAgg=0;window.__silverDiag="";${process.env.INIT??""}`);
    const consoleLog=[];page.on("console",m=>consoleLog.push(`${m.type()}: ${m.text()}`));page.on("pageerror",e=>consoleLog.push(`pageerror: ${e}`));
    await page.goto(process.env.URL??"http://127.0.0.1:5201/");
    await page.getByText("Играть",{exact:true}).click();await page.getByText("Песочница (временно)").click();
    await page.waitForFunction(()=>window.__sceneStore?.getState().cabinetPhase==="inspecting"&&window.__diag&&window.__clampMouth?.valid&&window.__three?.gl);
    await page.locator(".lab-boot-screen").waitFor({state:"hidden"});
    await page.evaluate(async({camera,dumpAt,hideUi})=>{
      window.__diagCamera=camera;
      const sm=await import("/src/scenes/laboratory/lib/useStandMotionStore.ts");
      const box=document.createElement("div");box.style.cssText="position:fixed;left:6px;bottom:60px;z-index:99999;font:700 22px monospace;color:#ff0;background:#000a;padding:4px 8px;white-space:pre";document.body.appendChild(box);
      if(hideUi){let el=document.querySelector("canvas");while(el&&el!==document.body){for(const sib of el.parentElement.children)if(sib!==el&&sib!==box)sib.style.display="none";el=el.parentElement;}}
      const run=window.__baseline={trace:[],dumps:[],dumpAt,clickSim:null,stop:false,sourceBefore:null,receiverBefore:null};
      const sample=(kind)=>{
        const id=window.__testTubeStorageStore?.getState().fumeHoodTestTubes[0]?.instanceId,f=id?window.__silverRuntime?.field(id):null,dg=id?window.__silverRuntime?.diagnostics(id):null;
        const sim=sm.simNowMs(),r={kind,sim,perf:performance.now(),wall:(performance.timeOrigin+performance.now())/1000,rend:window.__three.gl.info.render.frame,
          A:{events:dg?.eventIds.length??0,valid:dg?.eventIds.length??0,delivered:dg?.deliveredMl??0,firstValid:dg?.firstValidImpactMs?{atMs:dg.firstValidImpactMs,y:dg.firstImpactPoint?.y,surfaceY:dg.surfaceY}:null}};
        if(f){const m=f.mask;let fine=0,occupied=0,ag=0,cl=0,tracer=0,wetTop=-1;const rows=new Set();for(let k=0;k<m.activeCount;k++){const i=m.active[k],v=f.suspension[0][i];fine+=v;ag+=f.species["Ag+"].values[i];cl+=f.species["Cl-"].values[i];tracer+=f.tracer[i];wetTop=Math.max(wetTop,Math.floor(i/m.nx)%m.ny);if(v>1e-8){occupied++;rows.add(Math.floor(i/m.nx)%m.ny);}}
          const nodes=f.flocSystem?.nodes??[],cfg=f.flocSystem?.config;
          const radiusMm=mass=>cfg?1000*cfg.quantumRadius*Math.pow(Math.max(mass,1e-15)/cfg.quantum,1/cfg.fractalDimension):0;
          r.B={fineTotal:fine,occupiedFraction:occupied/(m.activeCount||1),occupiedDepthFraction:rows.size/m.ny,agTotal:ag,clTotal:cl,tracerTotal:tracer,extent:f.extent,fieldDelivered:f.delivered,wetTop,nx:m.nx,ny:m.ny,nz:m.nz,
            aggregateMass:f.denseMass??0,sedimentMass:f.sedimentField?.mass??0,aggregateCount:nodes.length,largestNodeMass:nodes.reduce((v,n)=>Math.max(v,n.mass),0),
            largestNodeRadiusMm:nodes.reduce((v,n)=>Math.max(v,radiusMm(n.mass)),0),meanNodeRadiusMm:nodes.length?nodes.reduce((v,n)=>v+radiusMm(n.mass),0)/nodes.length:0};}
        run.trace.push(r);
        box.textContent=`sim ${sim.toFixed(0)} ms  elapsed ${run.clickSim===null?"pre-click":((sim-run.clickSim)/1000).toFixed(2)+" s"}\nA valid ${r.A.valid} delivered ${r.A.delivered.toFixed(3)}  B fine ${r.B?.fineTotal.toFixed(5)??"-"}\ncloud depth ${r.B?.occupiedDepthFraction.toFixed(2)??"-"}  stage ${r.A.valid?"impact":"before impact"}`;
        if(f&&run.clickSim!==null){const elapsed=sim-run.clickSim;for(const t of dumpAt)if(elapsed>=t&&!run.dumps.some(d=>d.t===t)){
          const m=f.mask;run.dumps.push({t,simElapsedMs:elapsed,sim,fields:{nx:m.nx,ny:m.ny,nz:m.nz,radius:m.radius,bottom:m.bottom,height:m.height,level:f.liquidLevel,mask:Array.from(m.data),fine:Array.from(f.suspension[0]),aggregate:Array.from(f.aggregatePixels??[]),sedimentHeight:Array.from(f.sedimentHeightPixels??[]),ag:Array.from(f.species["Ag+"].values),cl:Array.from(f.species["Cl-"].values),src:Array.from(f.productSource),tracer:Array.from(f.tracer),flow:Array.from(f.solver.flow)},B:r.B});
        }}
      };
      const frame=()=>{sample("raf");if(!run.stop)requestAnimationFrame(frame);};requestAnimationFrame(frame);
      sm.onSimulationTick(()=>{if(!run.stop)sample("tick");});
    },{camera:cameras[mode],dumpAt,hideUi:process.env.HIDEUI!=="0"});
    const pour=id=>page.evaluate(async reagentId=>{const {runStandAction}=await import("/src/scenes/laboratory/lib/standTableActions.ts");return runStandAction({kind:"bottle",location:"fumeHood",reagentId,instanceId:`sandbox-jar-${reagentId}`});},id);
    if(!(await pour("agno3")))throw new Error("AgNO3 refused");
    await page.waitForFunction(()=>window.__testTubeStorageStore?.getState().fumeHoodTestTubes[0]?.contents.includes("agno3"));
    await page.waitForTimeout(2500);
    const crop=await tubeCrop(page);
    const cdp=await page.context().newCDPSession(page),frames=[];let record=false;
    cdp.on("Page.screencastFrame",async f=>{if(record)frames.push({abs:f.metadata.timestamp,data:f.data});try{await cdp.send("Page.screencastFrameAck",{sessionId:f.sessionId});}catch{}});
    await cdp.send("Page.startScreencast",{format:"jpeg",quality:80,maxWidth:Number(process.env.VW??1280),maxHeight:Number(process.env.VH??800),everyNthFrame:1});
    record=true;
    // Simulation advances by the dilated Date clock. Verify the lead-in from actual sim time.
    const firstDeadline=Date.now()+15000;while(!frames.length&&Date.now()<firstDeadline)await new Promise(resolve=>setTimeout(resolve,100));
    if(!frames.length)throw new Error("No screencast frame before NaCl lead-in");
    const lead=await page.evaluate(()=>window.__diag.frozen().simMs);
    await page.waitForFunction(start=>window.__diag.frozen().simMs-start>=1500,lead);
    const click=await page.evaluate(async()=>{const sm=await import("/src/scenes/laboratory/lib/useStandMotionStore.ts"),{runStandAction}=await import("/src/scenes/laboratory/lib/standTableActions.ts"),{tubeAmount}=await import("/src/scenes/laboratory/lib/tubeAmounts.ts");const b=window.__baseline,id=window.__testTubeStorageStore.getState().fumeHoodTestTubes[0].instanceId;b.id=id;b.sourceBefore=window.__diag.sourceAccounting().sourceMl["sandbox-jar-nacl"]??1;b.receiverBefore=tubeAmount(id).volumeMl;b.clickSim=sm.simNowMs();return runStandAction({kind:"bottle",location:"fumeHood",reagentId:"nacl",instanceId:"sandbox-jar-nacl"});});
    if(!click)throw new Error("NaCl refused");
    await page.waitForFunction(duration=>window.__diag.frozen().simMs-window.__baseline.clickSim>=duration,durationMs,{timeout:Math.max(180000,durationMs/slow*2)});
    record=false;await cdp.send("Page.stopScreencast");
    const data=await page.evaluate(()=>{const b=window.__baseline;b.stop=true;return {clickSim:b.clickSim,trace:b.trace,dumps:b.dumps,diag:window.__silverRuntime.diagnostics(b.id),sourceBefore:b.sourceBefore,receiverBefore:b.receiverBefore,events:window.__diag.events(b.id),sourceAfter:window.__diag.sourceAccounting()};});
    data.dumps=data.dumps.map(({fields,...dump})=>({...dump,...fields}));
    data.crop=crop;data.camera=mode;data.background="lab";data.clockScale=slow;data.durationMs=durationMs;
    const idx=[];for(let i=0;i<frames.length;i++){const fn=`s${String(i).padStart(5,"0")}.jpg`;await writeFile(join(out,"frames",fn),Buffer.from(frames[i].data,"base64"));idx.push({fn,t:frames[i].abs-frames[0].abs,abs:frames[i].abs});}
    await writeFile(join(out,"frames","index.json"),JSON.stringify({idx}));await writeFile(join(out,"trace.json"),JSON.stringify(data));
    await writeFile(join(out,"stages.json"),JSON.stringify(stageMarkers(data),null,2));await writeFile(join(out,"console.txt"),consoleLog.join("\n"));
    if(idx.length<2)throw new Error("Screencast delivered fewer than two frames");
    const rec=data.trace.filter(r=>Number.isFinite(r.wall)).sort((a,b)=>a.wall-b.wall);
    const simAt=epoch=>rec.reduce((best,r)=>Math.abs(r.wall-epoch)<Math.abs(best.wall-epoch)?r:best).sim;
    const timeline=idx.map(f=>({fn:f.fn,sim:simAt(f.abs)})).sort((a,b)=>a.sim-b.sim);
    const lines=["ffconcat version 1.0"];
    for(let i=0;i<timeline.length;i++){lines.push(`file '${timeline[i].fn}'`);if(i+1<timeline.length)lines.push(`duration ${Math.max(.01,(timeline[i+1].sim-timeline[i].sim)/1000)}`);}
    lines.push(`file '${timeline.at(-1).fn}'`);
    await writeFile(join(out,"frames","simulation.ffconcat"),lines.join("\n"));
    const ffmpeg=process.env.FFMPEG??"C:/Users/Aiyrell/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe";
    const movie=spawnSync(ffmpeg,["-y","-v","error","-safe","0","-i","simulation.ffconcat","-fps_mode","vfr","-c:v","libx264","-pix_fmt","yuv420p",join(out,"baseline.mp4")],{cwd:join(out,"frames"),encoding:"utf8"});
    if(movie.error||movie.status!==0)throw new Error(`ffmpeg baseline: ${movie.error??movie.stderr}`);
    console.log(`${mode}: ${idx.length} continuous frames, ${data.trace.length} records, ${data.dumps.length} dumps`);
  }finally{await browser.close();}
}
