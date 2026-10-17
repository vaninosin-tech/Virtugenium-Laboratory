import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { TubeFlowSolver } from '../../../src/scenes/laboratory/lib/tubeFlowSolver';
import { TubeJetModel } from '../../../src/scenes/laboratory/lib/tubeJetModel';
import { LiquidMask } from '../../../src/scenes/laboratory/lib/tubeVolumeField';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { silverEffectiveRadius, silverFieldHeight, SILVER_TUBE_RADIUS } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';

const output='docs/night/wave12c5';
const up=new THREE.Vector3(0,1,0);
type Mask=LiquidMask;
function sum(v:ArrayLike<number>,m:Mask){let s=0;for(let a=0;a<m.activeCount;a++)s+=v[m.active[a]];return s;}
function percentile(v:number[],p:number){const s=v.slice().sort((a,b)=>a-b);return s[Math.floor((s.length-1)*p)]??0;}
function shape(v:Float64Array,m:Mask,cut:number){
  const selected=new Uint8Array(m.data.length),seen=new Uint8Array(m.data.length);
  for(let a=0;a<m.activeCount;a++){const i=m.active[a];if(v[i]>=cut)selected[i]=1;}
  const h=[2*m.radius/m.nx,m.height/m.ny,2*m.radius/m.nz];
  const areas=[h[1]*h[2],h[0]*h[2],h[0]*h[1]];
  let cells=0,components=0,area=0;
  for(let a=0;a<m.activeCount;a++){
    const seed=m.active[a];if(!selected[seed]||seen[seed])continue;
    components++;seen[seed]=1;const stack=[seed];
    while(stack.length){const i=stack.pop()!,x=i%m.nx,y=Math.floor(i/m.nx)%m.ny,z=Math.floor(i/(m.nx*m.ny));cells++;
      for(const [axis,stride,position,limit] of [[0,1,x,m.nx],[1,m.nx,y,m.ny],[2,m.nx*m.ny,z,m.nz]])
        for(const sign of [-1,1]){const j=i+sign*stride;if(position+sign<0||position+sign>=limit||!selected[j])area+=areas[axis];
          else if(!seen[j]){seen[j]=1;stack.push(j);}}
    }
  }
  return {components,cells,area,sv:area/Math.max(1e-30,cells*h[0]*h[1]*h[2])};
}
function ppm(name:string,values:ArrayLike<number>,m:Mask,scale:number,plane:'vertical'|'horizontal',vectors?:Float32Array){
  const width=m.nx,height=plane==='vertical'?m.ny:m.nz,rgb=Buffer.alloc(width*height*3);
  for(let row=0;row<height;row++)for(let x=0;x<width;x++){
    const y=plane==='vertical'?m.ny-1-row:Math.max(0,Math.floor(m.ny*.7));
    const z=plane==='vertical'?Math.floor(m.nz/2):m.nz-1-row;
    const i=m.index(x,y,z),o=3*(x+width*row),q=Math.round(255*Math.min(1,Math.max(0,values[i]/scale)));
    rgb[o]=q;rgb[o+1]=vectors?Math.round(127+127*Math.max(-1,Math.min(1,vectors[3*i]/.02))):q;
    rgb[o+2]=vectors?Math.round(127+127*Math.max(-1,Math.min(1,vectors[3*i+1]/.02))):q;
  }
  writeFileSync(`${output}/${name}.ppm`,Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),rgb]));
}
function metrics(f:TubeSilverField,t:number,impact:number){
  const m=f.mask,v=f.tracer,flow=f.solver.flow,h=[2*m.radius/m.nx,m.height/m.ny,2*m.radius/m.nz];
  const mass=sum(v,m),positive:number[]=[];let cx=0,cy=0,cz=0,far=0,below=0,peak=0,down=0,upward=0,near=0;
  let speedMax=0,speedMean=0,strainMean=0,vorticityMean=0;
  let entrainmentMeasured=0,outflowMeasured=0;
  for(let a=0;a<m.activeCount;a++){
    const i=m.active[a],x=i%m.nx,y=Math.floor(i/m.nx)%m.ny,z=Math.floor(i/(m.nx*m.ny)),p=m.point(x,y,z),q=v[i];
    if(q>1e-15)positive.push(q);peak=Math.max(peak,q);cx+=q*p.x;cy+=q*p.y;cz+=q*p.z;
    if(Math.hypot(p.x-impact,p.z)>.003)far+=q;
    const s=Math.hypot(flow[3*i],flow[3*i+1],flow[3*i+2]);speedMax=Math.max(speedMax,s);speedMean+=s;
    strainMean+=f.solver.lastStrain[i];vorticityMean+=f.solver.lastVorticity[i];
    if(flow[3*i+1]<-1e-5)down++;if(flow[3*i+1]>1e-5)upward++;
    if(Math.hypot(p.x-impact,p.z)<.003)near++;
    // Flux through the lateral faces of a 3 mm cylindrical control volume.
    // Count each crossing once, with inward velocity positive for entrainment.
    for(const [axis,stride,coordinate,limit] of [[0,1,x,m.nx],[2,m.nx*m.ny,z,m.nz]]){
      if(coordinate+1>=limit||p.y>tubeLiquidHeight(1+f.delivered,silverEffectiveRadius)
        ||p.y<tubeLiquidHeight(1+f.delivered,silverEffectiveRadius)-.015)continue;
      const j=i+stride;if(!m.data[j])continue;
      const p2=m.point(j%m.nx,Math.floor(j/m.nx)%m.ny,Math.floor(j/(m.nx*m.ny)));
      const inside=Math.hypot(p.x-impact,p.z)<.003,inside2=Math.hypot(p2.x-impact,p2.z)<.003;
      if(inside===inside2)continue;
      const outward=(inside?1:-1)*.5*(flow[3*i+axis]+flow[3*j+axis]);
      const flux=outward*h[1]*(axis===0?h[2]:h[0]);
      if(flux<0)entrainmentMeasured-=flux;else outflowMeasured+=flux;
    }
  }
  cx/=mass||1;cy/=mass||1;cz/=mass||1;
  let varH=0,varV=0,lowest=Infinity,mixedMass=0;
  for(let a=0;a<m.activeCount;a++){const i=m.active[a],p=m.point(i%m.nx,Math.floor(i/m.nx)%m.ny,Math.floor(i/(m.nx*m.ny))),q=v[i];
    varH+=q*((p.x-cx)**2+(p.z-cz)**2);varV+=q*(p.y-cy)**2;
    if(q<.5*peak)mixedMass+=q;
    if(q>peak*.1)lowest=Math.min(lowest,p.y);
  }
  const p95=percentile(positive,.95),s10=shape(v,m,.1*p95),s50=shape(v,m,.5*p95);
  return {t,mass,far:far/(mass||1),centroidX:cx,centroidY:cy,centroidZ:cz,
    horizontalMoment:varH/(mass||1),verticalMoment:varV/(mass||1),penetration:Math.max(0,tubeLiquidHeight(1+f.delivered,silverEffectiveRadius)-lowest),
    mixedFraction:mixedMass/(mass||1),s10Components:s10.components,s10Cells:s10.cells,s10Area:s10.area,s10SV:s10.sv,
    s50Components:s50.components,s50Cells:s50.cells,s50Area:s50.area,s50SV:s50.sv,
    speedMax,speedMean:speedMean/m.activeCount,strainMean:strainMean/m.activeCount,vorticityMean:vorticityMean/m.activeCount,
    down,upward,near,divergence:f.solver.diagnostics().meanAbsDivergence,
    jetMomentum:f.solver.lastJetMomentumSource[1],jetClipped:f.solver.lastJetClippedMomentum,
    jetProjection:f.solver.lastJetProjectionChange[1],entrainment:f.solver.lastEntrainmentFlux,
    entrainmentMeasured,outflowMeasured,jetDepth:f.solver.lastJetPenetration};
}
function replay(flag:boolean,impact:number,write:boolean){
  (globalThis as any).__silverJetModel=flag;
  const f=new TubeSilverField('LOW',SILVER_TUBE_RADIUS,0,silverFieldHeight),m=f.mask;
  const inlet=new THREE.Vector3(impact,0,0),rows:ReturnType<typeof metrics>[]=[];
  for(let k=0;k<180;k++){
    const delivery=Math.min(1,(k+1)*.04),level=tubeLiquidHeight(1+delivery,silverEffectiveRadius);
    m.update(up,level);let top=-Infinity;
    for(let a=0;a<m.activeCount;a++){const i=m.active[a],p=m.point(i%m.nx,Math.floor(i/m.nx)%m.ny,Math.floor(i/(m.nx*m.ny)));
      if(Math.hypot(p.x-impact,p.z)<=.003)top=Math.max(top,p.y);}
    inlet.y=top;
    f.advance(.05,up,level,inlet,delivery,0,delivery>f.delivered?.4:0);
    const row=metrics(f,(k+1)*.05,impact);rows.push(row);
    expect(Math.abs(row.mass-delivery)).toBeLessThan(1e-12);
    expect(row.divergence,`flag=${flag} impact=${impact} step=${k}`).toBeLessThan(.3);
    expect(f.tracer.every(x=>Number.isFinite(x)&&x>=0)).toBe(true);
    if(write&&[9,19,39,79,179].includes(k)){
      const prefix=`${flag?'on':'off'}_${row.t.toFixed(1)}s`;
      const speed=new Float64Array(m.data.length);
      for(let a=0;a<m.activeCount;a++){const i=m.active[a];speed[i]=Math.hypot(f.solver.flow[3*i],f.solver.flow[3*i+1],f.solver.flow[3*i+2]);}
      ppm(`${prefix}_velocity`,speed,m,.03,'vertical',f.solver.flow);
      ppm(`${prefix}_strain`,f.solver.lastStrain,m,10,'vertical');
      ppm(`${prefix}_tracer_vertical`,f.tracer,m,.003,'vertical');
      ppm(`${prefix}_tracer_horizontal`,f.tracer,m,.003,'horizontal');
    }
  }
  f.dispose();return rows;
}
describe('flagged silver jet',()=>{
  it('normalizes incoming momentum and bounds its source',()=>{
    const m=new LiquidMask(12,24,12,.007,0,.055);m.update(up,.035);
    const jet=new TubeJetModel(m),inlet=new THREE.Vector3(.0065,.034,0),direction=new THREE.Vector3(.4,-1,0).normalize();
    jet.prepare(.05,inlet,direction,{x:.0065,z:0,level:.035,flow:1e-6,alpha:.2,delta:.0015,r0:.001,relaxation:12});
    expect(jet.faceCount[1]).toBeGreaterThan(0);
    for(let k=0;k<3;k++)expect(jet.appliedMomentum[k]).toBeCloseTo(jet.momentum[k],5);
    expect(jet.source.every(Number.isFinite)).toBe(true);
    expect(jet.entrainmentFlux).toBeGreaterThan(1e-6);
  });
  it('replays passive tracer at game and comparison impacts',()=>{
    vi.stubGlobal('window',{__silverStage:3,location:{search:''}});(globalThis as any).__silverAgg=0;
    (globalThis as any).__silverDiag='tracer';
    mkdirSync(output,{recursive:true});
    try{
      const all=[] as {flag:boolean;impact:number;rows:ReturnType<typeof metrics>[]}[];
      for(const impact of [.0065,0,.0035])for(const flag of [false,true])
        all.push({flag,impact,rows:replay(flag,impact,impact===.0065)});
      const columns=Object.keys(all[0].rows[0]);
      writeFileSync(`${output}/history.csv`,['flag,impact,'+columns.join(','),...all.flatMap(run=>run.rows.map(row=>
        `${run.flag},${run.impact},${columns.map(k=>(row as any)[k]).join(',')}`))].join('\n')+'\n');
      writeFileSync(`${output}/summary.json`,JSON.stringify(all.map(({flag,impact,rows})=>({flag,impact,samples:[rows[9],rows[19],rows[39],rows[79],rows[179]]})),null,2));
      const off=all[0].rows,on=all[1].rows;
      expect(off[179].mass).toBeCloseTo(on[179].mass,12);
      expect(on[179].horizontalMoment).not.toBe(off[179].horizontalMoment);
    }finally{delete (globalThis as any).__silverJetModel;delete (globalThis as any).__silverAgg;
      delete (globalThis as any).__silverDiag;vi.unstubAllGlobals();}
  },120000);
  it('keeps the flag-off path bit identical and is deterministic on',()=>{
    const run=(flag:undefined|boolean)=>{(globalThis as any).__silverJetModel=flag;
      const m=new LiquidMask(12,24,12,.007,0,.055);m.update(up,.035);
      const s=new TubeFlowSolver(m),v=new Float64Array(m.data.length);v[m.index(6,9,6)]=1;
      for(let k=0;k<12;k++){s.step(.05,new THREE.Vector3(.0065,.034,0),new THREE.Vector3(.4,-1,0),.02,0,undefined,0,undefined,
        {x:.0065,z:0,level:.035,flow:1e-6,alpha:.2,delta:.0015,r0:.001,relaxation:12});s.transport(v,.05,2e-6,.3);}
      return {flow:s.flow.slice(),tracer:v.slice()};};
    try{const a=run(undefined),b=run(false),c=run(true),d=run(true);
      expect(b).toEqual(a);expect(d).toEqual(c);expect(c.flow).not.toEqual(a.flow);
    }finally{delete (globalThis as any).__silverJetModel;}
  });
  it('profiles 200 steps after 20 warm-up at both resolutions',()=>{
    mkdirSync(output,{recursive:true});const results=[];
    for(const [nx,ny,nz] of [[12,24,12],[16,32,16]])for(const flag of [false,true]){
      (globalThis as any).__silverJetModel=flag;
      const m=new LiquidMask(nx,ny,nz,.007,0,.055);m.update(up,.04);
      const s=new TubeFlowSolver(m),times:number[]=[];
      for(let k=0;k<220;k++){const start=performance.now();s.step(.05,new THREE.Vector3(.0065,.039,0),new THREE.Vector3(.4,-1,0),k<25?.02:0,0,undefined,0,undefined,
        k<25?{x:.0065,z:0,level:.04,flow:1e-6,alpha:.2,delta:.0015,r0:.001,relaxation:12}:undefined);
        if(k>=20)times.push(performance.now()-start);}
      results.push({nx,ny,nz,flag,p50:percentile(times,.5),p95:percentile(times,.95)});
    }
    delete (globalThis as any).__silverJetModel;
    writeFileSync(`${output}/cpu.json`,JSON.stringify(results,null,2));
    expect(results).toHaveLength(4);
  },120000);
});
