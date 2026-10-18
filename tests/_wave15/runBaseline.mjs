import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const out=resolve(process.env.OUT??"docs/night/wave15r2/captures");await mkdir(out,{recursive:true});
const steps=[
  ["continuous real-game recording",["tests/_wave15/baselineRecord.mjs"],{OUT:out,BOTH:process.env.BOTH??"1",SLOW:process.env.SLOW??"0.15"}],
  ["reference metrics and side-by-side video",["tests/_wave15/buildComparison.mjs"],{GAME:join(out,"wide"),COMPARE_OUT:resolve(process.env.COMPARE_OUT??"docs/night/wave15r2/comparison")}],
  ["independent full-field regression recording",["tests/_wave13/recordRun.mjs"],{OUT:out,NAME:"baseline"}],
  ["strict regression checks",["tests/_wave13/regressionAB.mjs"],{OUT:out,NAME:"baseline",TRACE:join(out,"baseline-run.json"),STRICT:"1"}],
  ["cloud-on/off in-liquid pixel check",["tests/_wave11/validateShaders.mjs"],{OUT:out}],
  ["pour FPS measurements",["tests/_wave13/measureFpsPour.mjs"],{OUT:out,NAME:"baseline"}],
];
console.log("Sequential baseline plan. Each browser process exits before the next starts:");
for(const [label,args,env] of steps)console.log(`${label}: node ${args.join(" ")} (${Object.entries(env).map(([k,v])=>`${k}=${v}`).join(" ")})`);
if(process.env.PLAN_ONLY==="1")process.exit(0);
for(const [label,args,env] of steps){
  console.log(`\nRunning ${label}`);
  const child=spawn(process.execPath,args,{stdio:"inherit",env:{...process.env,...env}});
  const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
  if(code!==0)throw new Error(`${label} failed with exit code ${code}`);
}
const fps=JSON.parse(await readFile(join(out,"baseline-fps-summary.json"),"utf8"));
for(const r of fps.runs){if(r.error)console.warn(`FPS warning: run ${r.run} ${r.error}`);
  else if(r.cloud&&(r.medianFps<44||r.p10Fps<33||r.peakFrameMs>220))console.warn(`FPS warning: cloud-on run ${r.run}: median ${r.medianFps.toFixed(1)}, p10 ${r.p10Fps.toFixed(1)}, peak ${r.peakFrameMs.toFixed(1)} ms`);}
