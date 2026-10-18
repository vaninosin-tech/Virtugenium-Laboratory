import * as THREE from 'three';
import { describe, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { SILVER_TUBE_RADIUS, silverFieldHeight, silverEffectiveRadius } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { STAGE3_AGCL_SOLID_M3_PER_UNIT } from '../../../src/scenes/laboratory/lib/tubeSilverSediment';
import { SectionalPopulation as Baseline } from './sectionalPopulationBaseline';

function percentile(values: number[], q: number) { const v = values.toSorted((a,b)=>a-b); return v[Math.floor((v.length-1)*q)]; }
function profile(quality: 'LOW'|'HIGH', original: boolean) {
  vi.stubGlobal('window', { __silverStage: 3, __silverAgg: 1, location: { search: '' } });
  const f = new TubeSilverField(quality, SILVER_TUBE_RADIUS, 0, silverFieldHeight);
  const up = new THREE.Vector3(0,1,0), inlet = new THREE.Vector3(.0065,0,0);
  const samples: Record<string, number[]> = { step: [], collide: [], transport: [], other: [], heapDelta: [] };
  let peakHeap = 0, peakRss = 0, lastHeap = process.memoryUsage().heapUsed;
  try {
    for (let k=0;k<220;k++) {
      const delivery = Math.min(1,(k+1)*.04), level=tubeLiquidHeight(1+delivery,silverEffectiveRadius);
      f.mask.update(up,level);
      let top=-Infinity;
      for(let a=0;a<f.mask.activeCount;a++){
        const i=f.mask.active[a], p=f.mask.point(i%f.mask.nx,Math.floor(i/f.mask.nx)%f.mask.ny,Math.floor(i/(f.mask.nx*f.mask.ny)));
        if(Math.hypot(p.x-inlet.x,p.z)<=.003)top=Math.max(top,p.y);
      }
      inlet.y=top;
      if(k===1 && original){
        const old=new Baseline(f.mask,f.flocSystem.config,4*Math.PI/3*(.2e-6)**3,STAGE3_AGCL_SOLID_M3_PER_UNIT);
        for(let b=0;b<13;b++)old.masses[b].set(f.sections.masses[b]);
        (f as unknown as {sections: Baseline}).sections=old;
      }
      let collideMs=0,transportMs=0;
      let restore: (()=>void)|undefined;
      if(k>=20){
        const s=f.sections;
        const collide=s.collide.bind(s), transport=s.transport.bind(s);
        s.collide=((...args: Parameters<typeof collide>)=>{const t=performance.now();const result=collide(...args);collideMs+=performance.now()-t;return result;}) as typeof s.collide;
        s.transport=((...args: Parameters<typeof transport>)=>{const t=performance.now();const result=transport(...args);transportMs+=performance.now()-t;return result;}) as typeof s.transport;
        restore=()=>{s.collide=collide;s.transport=transport;};
      }
      const t=performance.now();
      f.advance(.05,up,level,inlet,delivery,0,delivery>f.delivered?.4:0);
      const ms=performance.now()-t;
      restore?.();
      if(k>=20){
        const mem=process.memoryUsage();peakHeap=Math.max(peakHeap,mem.heapUsed);peakRss=Math.max(peakRss,mem.rss);
        samples.step.push(ms);samples.collide.push(collideMs);samples.transport.push(transportMs);
        samples.other.push(ms-collideMs-transportMs);samples.heapDelta.push(mem.heapUsed-lastHeap);
      }
      lastHeap=process.memoryUsage().heapUsed;
    }
    const timings=Object.fromEntries(Object.entries(samples).map(([name,v])=>[name,{p50:percentile(v,.5),p95:percentile(v,.95),peak:Math.max(...v)}]));
    return {quality,original,samples:200,grid:[f.mask.nx,f.mask.ny,f.mask.nz],activeCells:f.mask.activeCount,
      timings,peakHeap,peakRss,meanHeapDelta:samples.heapDelta.reduce((a,b)=>a+b,0)/200,
      sectionBytes:f.sections.masses.reduce((s,a)=>s+a.byteLength,0)*2,
      maxPairsPerCell:91,textureBytes:f.aggregatePixels.byteLength+f.sedimentHeightPixels.byteLength};
  }finally{f.dispose();vi.unstubAllGlobals();}
}
describe('wave19 sectional cost',()=>{
  it('profiles the real pour for 200 measured steps after 20 warm-up steps',()=>{
    const results=[profile('LOW',true),profile('LOW',false),profile('HIGH',true),profile('HIGH',false)];
    writeFileSync('docs/night/wave19s2/benchmark.json',JSON.stringify(results,null,2));
  },180000);
});
