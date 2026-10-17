import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LiquidMask } from '../../../src/scenes/laboratory/lib/tubeVolumeField';
import { TubeFlowSolver } from '../../../src/scenes/laboratory/lib/tubeFlowSolver';
import { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';

const make = () => {
  const m=new LiquidMask(16,32,16,.007,0,.11);m.update(new THREE.Vector3(0,1,0),.06);
  const solver=new TubeFlowSolver(m,{lowDiffusion:true});
  const values=new Float64Array(m.data.length),i=m.index(8,6,8);
  expect(m.data[i]).toBe(1);values[i]=1;
  return {m,solver,values,i};
};
const mass=(v:Float64Array)=>v.reduce((a,b)=>a+b,0);
const moments=(v:Float64Array,m:LiquidMask)=>{
  let s=0,x=0,x2=0;for(let a=0;a<m.activeCount;a++){const i=m.active[a],q=v[i],p=i%m.nx;s+=q;x+=q*p;x2+=q*p*p;}
  return {mean:x/s,variance:x2/s-(x/s)**2};
};
describe('fine scalar flux audit',()=>{
  it('has no motion without velocity or diffusivity',()=>{
    const {solver,values,i}=make();solver.transport(values,.05,0,0);
    expect(values[i]).toBe(1);expect(mass(values)).toBe(1);
  });
  it('conserves a compact tracer under fixed face translation and exposes numerical spreading',()=>{
    const {m,solver,values}=make();
    const faces=(solver as unknown as {faces:Float32Array[]}).faces;
    for(let a=0;a<m.activeCount;a++){const i=m.active[a];if(i%m.nx+1<m.nx&&m.data[i+1])faces[0][i]=.005;}
    const dx=2*m.radius/m.nx,dt=.05,initial=moments(values,m);
    solver.transport(values,dt,0,0);
    const end=moments(values,m),deff=(end.variance-initial.variance)*dx*dx/(2*dt);
    expect(mass(values)).toBeCloseTo(1,12);
    expect(end.mean).toBeGreaterThan(initial.mean);
    expect(deff).toBeGreaterThan(0);
    expect(deff).toBeLessThan(3e-6);
  });
  it('bounds explicit diffusion and keeps a spike positive',()=>{
    const {m,solver,values}=make();solver.transport(values,.05,.000012,0);
    expect(mass(values)).toBeCloseTo(1,12);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(moments(values,m).variance).toBeGreaterThan(0);
  });
  it('reconciles fine mass when the moving meniscus vacates wet cells',()=>{
    vi.stubGlobal('window',{__silverStage:3,location:{search:''}});
    (globalThis as any).__silverAgg=0;
    const f=new TubeSilverField('LOW',.007,0,.11),up=new THREE.Vector3(0,1,0),inlet=new THREE.Vector3(0,.04,0);
    try {
      f.advance(.05,up,.06,inlet,0);
      let top=-1;for(let a=0;a<f.mask.activeCount;a++){
        const i=f.mask.active[a],y=Math.floor(i/f.mask.nx)%f.mask.ny;
        if(y>top)top=y;
      }
      let index=-1;for(let a=0;a<f.mask.activeCount;a++){
        const i=f.mask.active[a];if(Math.floor(i/f.mask.nx)%f.mask.ny===top){index=i;break;}
      }
      expect(index).toBeGreaterThanOrEqual(0);f.suspension[0][index]=1;f.extent=1;
      f.advance(.05,up,.04,inlet,0);
      expect(f.mask.data[index]).toBe(0);
      expect(Math.abs(f.massBalanceError)).toBeLessThan(1e-12);
    } finally { f.dispose();vi.unstubAllGlobals();delete (globalThis as any).__silverAgg; }
  });
});
