import * as THREE from 'three';
import { it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';
import { tubeLiquidHeight } from '../../../src/scenes/laboratory/lib/tubeLiquidLevel';
import { silverEffectiveRadius, silverFieldHeight, SILVER_TUBE_RADIUS } from '../../../src/scenes/laboratory/lib/tubeSilverGeometry';
import { FineExperiment } from './fineExperiment';

// Numerical diagnostic: run this test with Vitest's runner config to write metrics and PPM frames.
(globalThis as any).window = { __silverStage: 3, location: { search: '' } };
(globalThis as any).__silverAgg = 0;
const out = 'docs/night/wave10c1'; mkdirSync(out, { recursive: true });
type Grid = { nx: number; ny: number; nz: number; data: Uint8Array; active: Int32Array; activeCount: number };
function stats(v: ArrayLike<number>, m: Grid) {
  const nonzero: number[] = []; let sum = 0, sq = 0, tv = 0, high = 0, pairs = 0;
  for (let a=0;a<m.activeCount;a++) {
    const i=m.active[a], x=i%m.nx, y=Math.floor(i/m.nx)%m.ny, z=Math.floor(i/(m.nx*m.ny));
    const q=v[i]; if(q>1e-15) nonzero.push(q); sum+=q; sq+=q*q;
    for(const [j,ok] of [[i+1,x+1<m.nx],[i+m.nx,y+1<m.ny],[i+m.nx*m.ny,z+1<m.nz]] as const)
      if(ok && m.data[j]) { tv+=Math.abs(q-v[j]); high+=(q-v[j])**2; pairs++; }
  }
  nonzero.sort((a,b)=>a-b); const mean=sum/m.activeCount;
  const supportedMean=nonzero.reduce((a,b)=>a+b,0)/Math.max(1,nonzero.length);
  const supportedSq=nonzero.reduce((a,b)=>a+b*b,0)/Math.max(1,nonzero.length);
  const threshold=[0.1,0.5].map(f=>{
    const seen=new Uint8Array(m.data.length); let cc=0; const cut=(nonzero[Math.floor(nonzero.length*0.95)]??0)*f;
    for(let a=0;a<m.activeCount;a++) { const i=m.active[a]; if(seen[i] || v[i]<=cut) continue; cc++; const stack=[i];seen[i]=1;
      while(stack.length){const t=stack.pop()!, x=t%m.nx,y=Math.floor(t/m.nx)%m.ny,z=Math.floor(t/(m.nx*m.ny));
        for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(!dx&&!dy&&!dz)continue;const X=x+dx,Y=y+dy,Z=z+dz;if(X<0||Y<0||Z<0||X>=m.nx||Y>=m.ny||Z>=m.nz)continue;
          const j=X+m.nx*(Y+m.ny*Z);if(!seen[j]&&m.data[j]&&v[j]>cut){seen[j]=1;stack.push(j);}
        }
      }
    } return cc;
  });
  // High-frequency share from a 3-cell box high-pass, normalized by total spatial variance.
  let residual=0, variance=0;
  for(let a=0;a<m.activeCount;a++){const i=m.active[a],x=i%m.nx,y=Math.floor(i/m.nx)%m.ny,z=Math.floor(i/(m.nx*m.ny));let n=0,s=0;
    for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const X=x+dx,Y=y+dy,Z=z+dz;if(X<0||Y<0||Z<0||X>=m.nx||Y>=m.ny||Z>=m.nz)continue;
      const j=X+m.nx*(Y+m.ny*Z);if(m.data[j]){s+=v[j];n++;}
    } residual+=(v[i]-s/n)**2;variance+=(v[i]-mean)**2;
  }
  return { mass:sum, tv:tv/Math.max(sum,1e-30), cv:Math.sqrt(Math.max(0,supportedSq-supportedMean**2))/Math.max(supportedMean,1e-30),
    components:threshold, p95p50:(nonzero[Math.floor(nonzero.length*.95)]??0)/Math.max(nonzero[Math.floor(nonzero.length*.5)]??0,1e-30),
    highFreq:residual/Math.max(variance,1e-30), nonzero:nonzero.length, mean, faceGradient:Math.sqrt(high/Math.max(1,pairs)) };
}
function ppm(name:string,v:ArrayLike<number>,m:Grid,kind:'vertical'|'horizontal',scale:number){
  const w=kind==='vertical'?m.nx:m.nx,h=kind==='vertical'?m.ny:m.nz, rgb=Buffer.alloc(w*h*3);
  for(let Y=0;Y<h;Y++)for(let x=0;x<w;x++){
    const y=kind==='vertical'?h-1-Y:Math.floor(m.ny*.22),z=kind==='vertical'?Math.floor(m.nz/2):h-1-Y;
    const i=x+m.nx*(y+m.ny*z), q=Math.max(0,Math.min(255,Math.round(255*v[i]/scale))),o=3*(x+w*Y);rgb[o]=rgb[o+1]=rgb[o+2]=q;
  }
  writeFileSync(`${out}/${name}_${kind}.ppm`,Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`),rgb]));
}
function moment(v:ArrayLike<number>,m:Grid){
  let mass=0,cx=0,cy=0,cz=0,xx=0,yy=0,zz=0;
  for(let a=0;a<m.activeCount;a++){const i=m.active[a],q=v[i],x=i%m.nx,y=Math.floor(i/m.nx)%m.ny,z=Math.floor(i/(m.nx*m.ny));
    mass+=q;cx+=q*x;cy+=q*y;cz+=q*z;xx+=q*x*x;yy+=q*y*y;zz+=q*z*z;}
  cx/=mass||1;cy/=mass||1;cz/=mass||1;
  return {centroid:[cx,cy,cz],second:[xx/(mass||1)-cx*cx,yy/(mass||1)-cy*cy,zz/(mass||1)-cz*cz]};
}
function velocityPpm(name:string,f:TubeSilverField){
  const m=f.mask,w=m.nx,h=m.ny,z=Math.floor(m.nz/2),rgb=Buffer.alloc(w*h*3);
  for(let Y=0;Y<h;Y++)for(let x=0;x<w;x++){
    const y=h-Y-1,i=x+m.nx*(y+m.ny*z),p=3*i,o=3*(x+w*Y),v=f.solver.flow;
    const speed=m.data[i]?Math.hypot(v[p],v[p+1],v[p+2]):0;
    rgb[o]=Math.min(255,Math.round(speed*12000));
    rgb[o+1]=Math.min(255,Math.round(128+v[p]*9000));
    rgb[o+2]=Math.min(255,Math.round(128+v[p+1]*9000));
  }
  writeFileSync(`${out}/${name}_velocity.ppm`,Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`),rgb]));
}
function diffusionAudit(f:TubeSilverField,d:number,e:number){
  const m=f.mask,s=f.solver as unknown as {faces:Float32Array[];eddy:Float32Array};
  const spacing=[2*m.radius/m.nx,m.height/m.ny,2*m.radius/m.nz];let count=0,scheme=0,explicit=0,eddy=0,capped=0;
  for(let a=0;a<m.activeCount;a++){const i=m.active[a],x=i%m.nx,y=Math.floor(i/m.nx)%m.ny,z=Math.floor(i/(m.nx*m.ny));
    for(let axis=0;axis<3;axis++){if((axis===0&&x+1>=m.nx)||(axis===1&&y+1>=m.ny)||(axis===2&&z+1>=m.nz))continue;
      const j=i+[1,m.nx,m.nx*m.ny][axis];if(!m.data[j])continue;
      const h=spacing[axis],u=Math.abs(s.faces[axis][i]),Deddy=s.eddy[i]*e;
      scheme+=u*h*Math.max(0,1-u*.05/h)/2;explicit+=d;eddy+=Deddy;capped+=Math.min(.12,(d+Deddy)*.05/(h*h))*h*h/.05;count++;
    }
  }
  return {schemeProxy:scheme/count,explicit:explicit/count,eddy:eddy/count,cappedPhysical:capped/count};
}
function run(label:string,quality:'LOW'|'HIGH', diffusivity:number,eddyScale:number){
  const f=new TubeSilverField(quality,SILVER_TUBE_RADIUS,0,silverFieldHeight,1.15,{diffusivity,eddyScale});
  const m=f.mask,up=new THREE.Vector3(0,1,0), inlet=new THREE.Vector3(0,0,0);
  const rows:any[]=[];const times:number[]=[];
  const fine=label==='new'&&quality==='LOW'?new FineExperiment(f):undefined;
  const original=f.solver.transport.bind(f.solver);let before:Float64Array|undefined,after:Float64Array|undefined;
  f.solver.transport=(values,dt,d,e)=>{if(values===f.suspension[0])before=values.slice();original(values,dt,d,e);if(values===f.suspension[0])after=values.slice();};
  for(let k=0;k<220;k++){
    const volume=2.5+Math.min(1,(k+1)*.02),level=tubeLiquidHeight(volume,silverEffectiveRadius);
    f.mask.update(up,level);let top=-Infinity;
    for(let a=0;a<m.activeCount;a++){const i=m.active[a],x=i%m.nx,z=Math.floor(i/(m.nx*m.ny));const p=m.point(x,Math.floor(i/m.nx)%m.ny,z);
      if(Math.hypot(p.x,p.z)<=.003)top=Math.max(top,p.y);}
    inlet.y=top;const t=performance.now();f.advance(.05,up,level,inlet,Math.min(1,(k+1)*.02),0,.4);times.push(performance.now()-t);
    fine?.step(f.productSource);
    const row={t:(k+1)*50,source:stats(f.productSource,m),before:stats(before!,m),after:stats(after!,m),pixels:stats(f.pixels,m),balance:f.massBalanceError,
      tint:f.suspension[1].reduce((a,b)=>a+b,0),fineMoment:moment(f.suspension[0],m),diffusion:diffusionAudit(f,diffusivity,eddyScale),
      twiceFine:fine?stats(fine.coarse(),m):undefined,twiceFineMass:fine?.mass()}; rows.push(row);
    if([9,19,39,79,119,179].includes(k))for(const [stage,v] of [['source',f.productSource],['before',before!],['after',after!],['pixels',f.pixels]] as const)
      for(const plane of ['vertical','horizontal'] as const)ppm(`${label}_${quality}_${row.t}ms_${stage}`,v,m,plane,stage==='source'?.00005:.002);
    if([9,19,39,79,119,179].includes(k))velocityPpm(`${label}_${quality}_${row.t}ms`,f);
  }
  f.dispose(); const sorted=times.slice(20).sort((a,b)=>a-b);const ix=(p:number)=>sorted[Math.floor(p*(sorted.length-1))];
  const fineSorted=fine?.timings.slice(20).sort((a,b)=>a-b);
  return {label,quality,stepMs:{p50:ix(.5),p95:ix(.95)},fineStepMs:fineSorted?{p50:fineSorted[Math.floor(.5*fineSorted.length)],p95:fineSorted[Math.floor(.95*fineSorted.length)]}:undefined,
    maxBalance:Math.max(...rows.map(r=>Math.abs(r.balance))),rows};
}
const runs=[run('old','LOW',.000012,.6),run('new','LOW',1e-9,.02),run('noeddy','LOW',1e-9,0),run('new','HIGH',1e-9,.02),run('old','HIGH',.000012,.6)];
function momentumCase(name:string,spread:number,buoy:number){
  (globalThis as any).__silverSpread=spread;(globalThis as any).__silverBuoy=buoy;
  const f=new TubeSilverField('LOW',SILVER_TUBE_RADIUS,0,silverFieldHeight,1.15);
  const m=f.mask,up=new THREE.Vector3(0,1,0),inlet=new THREE.Vector3(.002,0,0),pairs:number[][]=[];
  let previous=moment(f.suspension[0],m).centroid;
  for(let k=0;k<120;k++){
    const volume=2.5+Math.min(1,(k+1)*.02),level=tubeLiquidHeight(volume,silverEffectiveRadius);m.update(up,level);
    let top=-Infinity;for(let a=0;a<m.activeCount;a++){const i=m.active[a],p=m.point(i%m.nx,Math.floor(i/m.nx)%m.ny,Math.floor(i/(m.nx*m.ny)));
      if(Math.hypot(p.x-inlet.x,p.z)<=.003)top=Math.max(top,p.y);}
    inlet.y=top;f.advance(.05,up,level,inlet,Math.min(1,(k+1)*.02),0,.4);
    const current=moment(f.suspension[0],m).centroid;let vy=0,mass=0;
    for(let a=0;a<m.activeCount;a++){const i=m.active[a],q=f.suspension[0][i];vy+=q*f.solver.flow[i*3+1];mass+=q;}
    if(k>50)pairs.push([(current[1]-previous[1])*m.height/m.ny/.05,vy/(mass||1)]);
    previous=current;
  }
  const meanVelocity=pairs.reduce((a,p)=>a+p[1],0)/pairs.length;
  const meanCentroidVelocity=pairs.reduce((a,p)=>a+p[0],0)/pairs.length;
  let covariance=0,v0=0,v1=0;
  for(const p of pairs){const a=p[0]-meanCentroidVelocity,b=p[1]-meanVelocity;covariance+=a*b;v0+=a*a;v1+=b*b;}
  const result={name,moment:moment(f.suspension[0],m),meanVelocity,meanCentroidVelocity,
    displacementFlowCorrelation:covariance/Math.sqrt(v0*v1)};f.dispose();return result;
}
const momentum=[momentumCase('normal',1,.1),momentumCase('noJetClosure',0,.1),momentumCase('noBuoyancy',1,0)];
delete (globalThis as any).__silverSpread;delete (globalThis as any).__silverBuoy;
writeFileSync(`${out}/metrics.json`,JSON.stringify(runs));
writeFileSync(`${out}/momentum.json`,JSON.stringify(momentum));
for(const r of runs)console.log(r.label,r.quality,r.stepMs,r.maxBalance,[r.rows[19],r.rows[79],r.rows[179]].map((x:any)=>({t:x.t,source:x.source.tv,before:x.before.tv,after:x.after.tv,pixels:x.pixels.tv,cv:x.pixels.cv,hf:x.pixels.highFreq})));
it('conserves the fine mass through changing masks and improves structure',()=>{
  expect(runs).toHaveLength(5);
  for(const r of runs)expect(r.maxBalance).toBeLessThan(1e-12);
  expect(runs[1].rows[179].pixels.tv/runs[0].rows[179].pixels.tv).toBeGreaterThan(4);
});
