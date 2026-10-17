import { readFile,writeFile,mkdir } from "node:fs/promises";
import { checkRegression } from "./regressionChecks.mjs";
import { spawn } from "node:child_process";

const out=process.env.OUT??"docs/night/wave13c8/captures",name=process.env.NAME??"baseline";
await mkdir(out,{recursive:true});
let trace;
if(process.env.TRACE) trace=JSON.parse(await readFile(process.env.TRACE,"utf8"));
else {
  // Run the same real-game recorder, including the ledger, source and full field dumps.
  const child=spawn(process.execPath,["tests/_wave13/recordRun.mjs"],{stdio:"inherit",env:{...process.env,OUT:out,NAME:name}});
  const code=await new Promise(resolve=>child.on("exit",resolve));if(code!==0)process.exit(code??1);
  trace=JSON.parse(await readFile(`${out}/${name}-run.json`,"utf8"));
}
{ const last=[...trace.samples].reverse().find(s=>s.A); if(last) trace={...trace,diag:last.A}; } // the recorder stores the diag selector string under diag; the checks need the runtime diagnostics
const result=checkRegression(trace,{strict:!process.env.TRACE||process.env.STRICT==="1"});
await writeFile(`${out}/${name}-regression.json`,JSON.stringify(result,null,2));
console.log(result);
if(!result.ok)process.exitCode=1;
