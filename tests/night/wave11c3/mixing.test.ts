import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { silverEffectiveRadius, silverFieldHeight, SILVER_TUBE_RADIUS } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';
import { precipitatePair } from '../../../src/scenes/laboratory/lib/tubePrecipitationPhysics';

type Run = { name: string; mix: number; eddy: number; impact: number };
type Mask = TubeSilverField['mask'];
const output = 'docs/night/wave11c3';
const up = new THREE.Vector3(0, 1, 0);
const configs: Run[] = [
  ...[0.5, 1, 2, 4].map(n => ({name:`mix${n}`, mix:2e-6*n, eddy:0.3, impact:0.0065})),
  ...[0.5, 2, 4].map(n => ({name:`eddy${n}`, mix:2e-6, eddy:0.3*n, impact:0.0065})),
  ...[0, 0.0035].map(n => ({name:`impact${n*1000}mm`, mix:2e-6, eddy:0.3, impact:n})),
];
function sum(v: ArrayLike<number>, m: Mask) { let s=0; for(let a=0;a<m.activeCount;a++)s+=v[m.active[a]]; return s; }
function coord(m: Mask, i: number) { return m.point(i%m.nx, Math.floor(i/m.nx)%m.ny, Math.floor(i/(m.nx*m.ny))); }
function percentile(v:number[], p:number) { const s=v.slice().sort((a,b)=>a-b); return s[Math.floor((s.length-1)*p)]??0; }
function shape(v: Float64Array, m:Mask) {
  const positive:number[]=[]; for(let a=0;a<m.activeCount;a++) if(v[m.active[a]]>1e-15)positive.push(v[m.active[a]]);
  const p95=percentile(positive,.95); const dx=2*m.radius/m.nx,dy=m.height/m.ny,dz=2*m.radius/m.nz;
  const result=[];
  for(const scale of [.1,.5]) {
    const cut=scale*p95, seen=new Uint8Array(m.data.length);let components=0,largest=0,voxels=0,surface=0;
    let xmin=m.nx,xmax=0,ymin=m.ny,ymax=0,zmin=m.nz,zmax=0;
    for(let a=0;a<m.activeCount;a++) {const seed=m.active[a];if(seen[seed]||v[seed]<=cut)continue;
      components++;let size=0;const stack=[seed];seen[seed]=1;
      while(stack.length) {const i=stack.pop()!,x=i%m.nx,y=Math.floor(i/m.nx)%m.ny,z=Math.floor(i/(m.nx*m.ny));
        size++;voxels++;xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);zmin=Math.min(zmin,z);zmax=Math.max(zmax,z);
        for(const [X,Y,Z,area] of [[x-1,y,z,dy*dz],[x+1,y,z,dy*dz],[x,y-1,z,dx*dz],[x,y+1,z,dx*dz],[x,y,z-1,dx*dy],[x,y,z+1,dx*dy]]) {
          if(X<0||Y<0||Z<0||X>=m.nx||Y>=m.ny||Z>=m.nz){surface+=area;continue;}
          const j=X+m.nx*(Y+m.ny*Z);if(!m.data[j]||v[j]<=cut){surface+=area;continue;}
          if(!seen[j]){seen[j]=1;stack.push(j);}
        }
      }largest=Math.max(largest,size);
    }
    const lengths=[(xmax-xmin+1)*dx,(ymax-ymin+1)*dy,(zmax-zmin+1)*dz];
    result.push({threshold:scale*p95,components,voxels,largest,volumeM3:voxels*dx*dy*dz,
      surfaceToVolumeMInverse:surface/Math.max(voxels*dx*dy*dz,1e-30),
      aspect:Math.max(...lengths)/Math.max(Math.min(...lengths),1e-30)});
  }return result;
}
function ppm(name:string,v:ArrayLike<number>,m:Mask,scale:number) {
  const rgb=Buffer.alloc(m.nx*m.ny*3),z=Math.floor(m.nz/2);
  for(let Y=0;Y<m.ny;Y++)for(let x=0;x<m.nx;x++){
    const i=x+m.nx*((m.ny-1-Y)+m.ny*z),q=Math.round(255*Math.min(1,Math.max(0,v[i]/scale))),o=3*(x+m.nx*Y);
    rgb[o]=rgb[o+1]=rgb[o+2]=q;
  }
  writeFileSync(`${output}/${name}.ppm`,Buffer.concat([Buffer.from(`P6\n${m.nx} ${m.ny}\n255\n`),rgb]));
}
function velocityPpm(name:string,f:TubeSilverField){
  const m=f.mask,v=f.solver.flow,rgb=Buffer.alloc(m.nx*m.ny*3),z=Math.floor(m.nz/2);
  for(let Y=0;Y<m.ny;Y++)for(let x=0;x<m.nx;x++){
    const i=x+m.nx*((m.ny-1-Y)+m.ny*z),o=3*(x+m.nx*Y),p=3*i;
    const q=m.data[i]?Math.min(255,Math.round(255*Math.hypot(v[p],v[p+1],v[p+2])/.02)):0;
    rgb[o]=rgb[o+1]=rgb[o+2]=q;
  }
  writeFileSync(`${output}/${name}.ppm`,Buffer.concat([Buffer.from(`P6\n${m.nx} ${m.ny}\n255\n`),rgb]));
}
function measure(f:TubeSilverField,impact:number,t:number,elapsed:number) {
  const m=f.mask,ag=f.species['Ag+'].values,cl=f.species['Cl-'].values,fine=f.suspension[0],source=f.productSource;
  let overlap=0,overlapCells=0,clWithAg=0,sourceSum=0,sx=0,sy=0,sz=0,spread=0,firstSourceRadius=0,farFine=0;
  let fineSum=0,fineSq=0,tv=0,vorticity=0,vortN=0,riNumerator=0,riDenominator=0,maxNeg=0,nan=0,sourceRows=new Array(m.ny).fill(0);
  const h=[2*m.radius/m.nx,m.height/m.ny,2*m.radius/m.nz],flow=f.solver.flow;
  for(let a=0;a<m.activeCount;a++){
    const i=m.active[a],p=coord(m,i),x=i%m.nx,y=Math.floor(i/m.nx)%m.ny,z=Math.floor(i/(m.nx*m.ny));
    const av=ag[i]*m.activeCount,cv=cl[i]*m.activeCount;
    overlap+=Math.min(av,cv)/m.activeCount;if(av>0.115)clWithAg+=cl[i];
    if(av>0.115&&cv>0.1)overlapCells++;
    const q=source[i];sourceSum+=q;sx+=q*p.x;sy+=q*p.y;sz+=q*p.z;sourceRows[y]+=q;
    if(q>1e-15)firstSourceRadius=Math.max(firstSourceRadius,Math.hypot(p.x-impact,p.z));
    fineSum+=fine[i];fineSq+=fine[i]*fine[i];if(Math.hypot(p.x-impact,p.z)>.003)farFine+=fine[i];
    for(const [j,ok] of [[i+1,x+1<m.nx],[i+m.nx,y+1<m.ny],[i+m.nx*m.ny,z+1<m.nz]] as const)
      if(ok&&m.data[j])tv+=Math.abs(fine[i]-fine[j]);
    if(x>0&&x+1<m.nx&&z>0&&z+1<m.nz&&m.data[i-1]&&m.data[i+1]&&m.data[i-m.nx*m.ny]&&m.data[i+m.nx*m.ny]){
      const wx=(flow[3*(i+1)+2]-flow[3*(i-1)+2])/(2*h[0]);
      const wz=(flow[3*(i+m.nx*m.ny)]-flow[3*(i-m.nx*m.ny)])/(2*h[2]);
      vorticity+=Math.abs(wx-wz);vortN++;
    }
    if(y>0&&y+1<m.ny&&m.data[i-m.nx]&&m.data[i+m.nx]){
      // Diagnostic Richardson-like ratio. The model's buoyancy is a closure, not a measured density difference.
      const dbdy=.005*.1*m.activeCount*(f.tracer[i+m.nx]-f.tracer[i-m.nx])/(2*h[1]);
      const du=(flow[3*(i+m.nx)]-flow[3*(i-m.nx)])/(2*h[1]);
      const dw=(flow[3*(i+m.nx)+2]-flow[3*(i-m.nx)+2])/(2*h[1]);
      riNumerator+=dbdy;riDenominator+=du*du+dw*dw;
    }
    for(const v of [ag[i],cl[i],fine[i],...f.suspension.map(s=>s[i])]){if(!Number.isFinite(v))nan++;maxNeg=Math.min(maxNeg,v);}
  }
  const cx=sx/(sourceSum||1),cy=sy/(sourceSum||1),cz=sz/(sourceSum||1);
  if(sourceSum)for(let a=0;a<m.activeCount;a++){const i=m.active[a],q=source[i],p=coord(m,i);spread+=q*((p.x-cx)**2+(p.y-cy)**2+(p.z-cz)**2);}
  const fineMean=fineSum/m.activeCount,clTotal=f.species['Cl-'].total;
  const d=f.diagnostics();
  return {t,delivered:f.delivered,ag:d.silverRemaining,cl:clTotal,extent:f.extent,
    fine:fineSum,tint:sum(f.suspension[1],m),class2:sum(f.suspension[2],m),coarse:f.coarseMass,flocs:f.flocSystem?.totalMass??0,sediment:f.sedimentMass,
    overlap,overlapVolumeM3:overlapCells*h[0]*h[1]*h[2],clWithAgFraction:clWithAg/(clTotal||1),source:sourceSum,sourceCentroid:[cx,cy,cz],sourceSpreadMm:1000*Math.sqrt(spread/(sourceSum||1)),
    sourceRows:sourceRows.map(v=>v/(sourceSum||1)),sourceMaxRadiusMm:firstSourceRadius*1000,
    fineCv:Math.sqrt(Math.max(0,fineSq/m.activeCount-fineMean*fineMean))/(fineMean||1),fineTv:tv/(fineSum||1),
    fineFarFraction:farFine/(fineSum||1),vorticityMean:vorticity/(vortN||1),richardsonLike:riNumerator/(riDenominator||1),
    massError:Math.max(Math.abs(f.extent+clTotal-f.delivered),Math.abs(f.extent+d.silverRemaining-1.15),Math.abs(f.massBalanceError)),
    maxNeg,nan,stepMs:elapsed};
}
function replay(c:Run){
  (globalThis as any).__silverMix=c.mix;(globalThis as any).__silverEddy=c.eddy;
  const f=new TubeSilverField('LOW',SILVER_TUBE_RADIUS,0,silverFieldHeight),m=f.mask,inlet=new THREE.Vector3(c.impact,0,0);
  const rows:ReturnType<typeof measure>[]=[], snapshots:any[]=[];
  for(let k=0;k<280;k++){
    const delivery=Math.min(1,(k+1)*.04); // two real 0.02 mL events per 50 ms step, 1 mL in 1.25 s
    const level=tubeLiquidHeight(1+delivery,silverEffectiveRadius);m.update(up,level);
    let top=-Infinity;for(let a=0;a<m.activeCount;a++){const p=coord(m,m.active[a]);if(Math.hypot(p.x-inlet.x,p.z-inlet.z)<=.003)top=Math.max(top,p.y);}
    inlet.y=top;
    const start=performance.now();f.advance(.05,up,level,inlet,delivery,0,delivery>f.delivered?.4:0);
    const row=measure(f,c.impact,(k+1)*50,performance.now()-start);rows.push(row);
    if([9,19,49,79,119,179,279].includes(k)){
      snapshots.push({t:row.t,shape:shape(f.suspension[0],m)});
      if(c.name==='mix1')for(const [label,v,scale] of [['fine',f.suspension[0],.002],['ag',f.species['Ag+'].values,.002],['cl',f.species['Cl-'].values,.002],['source',f.productSource,.00005]] as const)
        ppm(`${c.name}_${row.t}ms_${label}`,v,m,scale);
      if(c.name==='mix1')velocityPpm(`${c.name}_${row.t}ms_velocity`,f);
    }
  }
  const sample=rows.slice(20).map(r=>r.stepMs);
  const result={config:c,rows,snapshots,cpu:{p50:percentile(sample,.5),p95:percentile(sample,.95)},
    maxMassError:Math.max(...rows.map(r=>r.massError)),minValue:Math.min(...rows.map(r=>r.maxNeg)),nan:rows.reduce((s,r)=>s+r.nan,0)};
  f.dispose();return result;
}
describe('stage 3 mixing diagnostics',()=>{
  it('replays each stepped delivery with exact conservation and positive concentrations',()=>{
    vi.stubGlobal('window',{__silverStage:3,location:{search:''}});(globalThis as any).__silverAgg=0;
    mkdirSync(output,{recursive:true});
    try{
      const results=configs.map(replay);
      const columns=['t','delivered','ag','cl','extent','fine','tint','class2','coarse','flocs','sediment','overlap','overlapVolumeM3','clWithAgFraction','source','sourceSpreadMm','sourceMaxRadiusMm','fineCv','fineTv','fineFarFraction','vorticityMean','richardsonLike','massError','maxNeg','nan','stepMs'];
      for(const r of results){writeFileSync(`${output}/${r.config.name}.csv`,[columns.join(','),...r.rows.map(row=>columns.map(k=>(row as any)[k]).join(','))].join('\n')+'\n');
        expect(r.maxMassError).toBeLessThan(1e-12);expect(r.minValue).toBeGreaterThanOrEqual(-1e-15);expect(r.nan).toBe(0);
        expect(r.rows[0].sourceMaxRadiusMm).toBeLessThanOrEqual(3.01);
      }
      const baseline=results.find(r=>r.config.name==='mix1')!;
      expect(baseline.rows[0].extent).toBeCloseTo(0.018406326453354584, 12) /* wave 14: re-pinned for the corrected 7 mm geometry (more wet rows at the same volume change the first-step formation) */;
      expect(baseline.rows[179].extent).toBeCloseTo(0.7979501906316301, 12) /* wave 14: corrected geometry (liquid 7-14 mm deep instead of 20-38 mm): the same delivery now reacts far more */;
      expect(baseline.rows[279].extent).toBeCloseTo(0.919120639459964, 12);
      expect(baseline.rows[0].sourceCentroid[0]).toBeCloseTo(0.00582363370720687, 12);
      writeFileSync(`${output}/summary.json`,JSON.stringify(results.map(({rows,...rest})=>({...rest,
        samples:[rows[0],rows[9],rows[19],rows[49],rows[79],rows[119],rows[179],rows[279]]})),null,2));
      expect(precipitatePair(1/1000,1/1000,1000,.0005,.05,0)).toBeGreaterThan(.0008);
    }finally{delete (globalThis as any).__silverAgg;delete (globalThis as any).__silverMix;delete (globalThis as any).__silverEddy;vi.unstubAllGlobals();}
  },120000);
});
