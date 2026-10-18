import { mkdir, writeFile } from "node:fs/promises";
import { openSilverPage, pour } from "../_wave11/browserCommon.mjs";
import { processMetrics, spatialMetrics } from "./analysis.mjs";

const name = process.env.NAME ?? "baseline", out = process.env.OUT ?? "docs/night/wave13c8/captures";
const configuredInit=process.env.INIT??"";
if(process.env.DIAG)process.env.INIT=`${configuredInit}window.__silverDiag=${JSON.stringify(process.env.DIAG)};`;
const dumpAt = [500,1000,1500,2000,3000,4500,6000,9000,12000,14000];
let browser;
try {
  await mkdir(out, { recursive: true });
  const opened = await openSilverPage(); browser = opened.browser; const { page } = opened;
  if (!(await pour(page,"agno3")).accepted) throw new Error("AgNO3 refused");
  await page.waitForFunction(() => window.__testTubeStorageStore?.getState().fumeHoodTestTubes[0]?.contents.includes("agno3"));
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { tubeAmount } = await import("/src/scenes/laboratory/lib/tubeAmounts.ts");
    const { useReagentStorageStore } = await import("/src/scenes/laboratory/lib/useReagentStorageStore.ts");
    const sm = await import("/src/scenes/laboratory/lib/useStandMotionStore.ts");
    const id = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0].instanceId;
    const amount = useReagentStorageStore.getState();
    window.__wave13 = { id, samples: [], dumps: [], next: 0, dumpAt: [500,1000,1500,2000,3000,4500,6000,9000,12000,14000],
      sourceBefore: window.__diag.sourceAccounting().sourceMl["sandbox-jar-nacl"] ?? 1 }; // app instance of the store
    const snapshot = (full, t) => {
      const field = window.__silverRuntime?.field(id), diag = window.__silverRuntime?.diagnostics(id);
      const receiver = tubeAmount(id).volumeMl;
      const source = window.__diag.sourceAccounting().sourceMl["sandbox-jar-nacl"] ?? 1;
      const basic = { t, sim: window.__diag.frozen().simMs, A: diag ? structuredClone(diag) : null,
        stream: window.__pourStreamDebug ? structuredClone(window.__pourStreamDebug) : null,
        receiverMl: receiver, sourceMl: source, solverMs: field?.solver.lastStepMs ?? null };
      if (!field) return basic;
      const m=field.mask, n=m.data.length, active=m.active;
      if(!window.__wave13.firstChloride) {
        const cl=field.species["Cl-"].values;let i=-1;for(let k=0;k<m.activeCount;k++)if(cl[active[k]]>1e-12){i=active[k];break;}
        if(i>=0)window.__wave13.firstChloride={sim:basic.sim,cell:[i%m.nx,Math.floor(i/m.nx)%m.ny,Math.floor(i/(m.nx*m.ny))]};
      }
      const total = a => { let s=0; for(let k=0;k<m.activeCount;k++) s+=a[active[k]]; return s; };
      Object.assign(basic, { B: { fieldDelivered: field.delivered, extent: field.extent,
        agTotal: total(field.species["Ag+"].values), clTotal: total(field.species["Cl-"].values),
        tracerTotal: total(field.tracer), sourceTotal: total(field.productSource),
        fineTotal: total(field.suspension[0]), solidTotal: field.totalSolidMass,
        level: field.liquidLevel, depth: field.liquidLevel-m.bottom,
        nx:m.nx,ny:m.ny,nz:m.nz,wetTop:Math.max(...Array.from(active.subarray(0,m.activeCount),i=>Math.floor(i/m.nx)%m.ny)) },
        solver: { lastStepMs: field.solver.lastStepMs, lastEntrainmentFlux: field.solver.lastEntrainmentFlux,
          lastJetPenetration: field.solver.lastJetPenetration } });
      const point=diag?.firstImpactPoint, root=window.__clampMouth?.root;
      const impactLocal=point&&root ? new window.__three.camera.position.constructor(point.x,point.y,point.z).applyMatrix4(root.clone().invert()) : null;
      if (full) basic.fields = { nx:m.nx,ny:m.ny,nz:m.nz,radius:m.radius,bottom:m.bottom,height:m.height,
        level:basic.B.level, impactLocal:impactLocal?{x:impactLocal.x,y:impactLocal.y,z:impactLocal.z}:null, mask:Array.from(m.data), tracer:Array.from(field.tracer),
        ag:Array.from(field.species["Ag+"].values), cl:Array.from(field.species["Cl-"].values),
        src:Array.from(field.productSource),
        fine:Array.from(field.suspension[0]), flow:Array.from(field.solver.flow) };
      return basic;
    };
    window.__wave13.receiverBefore = tubeAmount(id).volumeMl;
    window.__wave13.capture = snapshot;
    sm.onSimulationTick(() => {
      const w=window.__wave13; if(w.clickSim==null || w.next>14000) return;
      const elapsed=sm.simNowMs()-w.clickSim;
      while(w.next<=14000 && elapsed>=w.next) {
        const full=w.dumpAt.includes(w.next), s=snapshot(full,w.next); w.samples.push(s);
        if(!w.firstSource&&s.B?.sourceTotal>1e-12)w.firstSource=snapshot(true,w.next);
        if(full && s.fields) w.dumps.push(s); w.next+=50;
      }
    });
  });
  const click = await page.evaluate(async () => {
    const w=window.__wave13, sm=await import("/src/scenes/laboratory/lib/useStandMotionStore.ts");
    const { runStandAction }=await import("/src/scenes/laboratory/lib/standTableActions.ts");
    w.clickSim=sm.simNowMs(); w.samples.push(w.capture(false,-1));
    return { clickSim:w.clickSim, accepted:runStandAction({kind:"bottle",location:"fumeHood",reagentId:"nacl",instanceId:"sandbox-jar-nacl"}) };
  });
  if (!click.accepted) throw new Error("NaCl refused");
  await page.waitForFunction(() => window.__wave13.next>14000, null, { timeout: 60000 });
  await page.evaluate(() => window.__diag.pauseSimulation());
  const data=await page.evaluate(() => ({ ...window.__wave13, capture:undefined,
    events: window.__diag.events(window.__wave13.id) }));
  let prior=null;
  for(const dump of data.dumps) {
    dump.structure=spatialMetrics(dump.fields.fine,dump.fields.mask,dump.fields);
    dump.processes=processMetrics(dump.fields,prior); prior=dump.processes;
  }
  await writeFile(`${out}/${name}-run.json`,JSON.stringify({ config:name, init:configuredInit, diagSelector:process.env.DIAG??"", clickSim:click.clickSim,
    receiverBefore:data.receiverBefore, sourceBefore:data.sourceBefore,firstChloride:data.firstChloride,firstSource:data.firstSource,
    events:data.events,
    samples:data.samples.map(s=>{const {fields,...rest}=s;return rest;}), dumps:data.dumps },null,2));
  console.log(`${data.samples.length} samples, ${data.dumps.length} field dumps`);
} catch(e) { console.error(e); process.exitCode=1; } finally { if(browser) await browser.close(); }
