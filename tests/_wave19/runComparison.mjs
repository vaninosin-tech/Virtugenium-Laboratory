import {spawnSync} from 'node:child_process';
const root=process.env.OUT??'docs/night/wave19s2/browser';
const run=(script,env={})=>{const r=spawnSync(process.execPath,[script],{stdio:'inherit',env:{...process.env,...env}});if(r.error||r.status!==0)throw new Error(`${script}: ${r.error??`exit ${r.status}`}`);};
run('tests/_wave19/captureRepresentations.mjs',{OUT:`${root}/representations`});
run('tests/_wave15/baselineRecord.mjs',{OUT:`${root}/recording`,BOTH:'1',SLOW:process.env.SLOW??'0.15',DURATION_MS:'24000'});
run('tests/_wave15/buildComparison.mjs',{GAME:`${root}/recording/wide`,COMPARE_OUT:`${root}/comparison`});
