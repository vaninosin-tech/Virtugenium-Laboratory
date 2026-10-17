import { describe,it,expect } from "vitest";
import { spatialMetrics,processMetrics } from "../../_wave13/analysis.mjs";
import { checkRegression } from "../../_wave13/regressionChecks.mjs";

const nx=9,ny=9,nz=9,n=nx*ny*nz,mask=Array(n).fill(1),at=(x:number,y:number,z:number)=>x+nx*(y+ny*z);
const shape=(fn:(x:number,y:number,z:number)=>number)=>Array.from({length:n},(_,i)=>fn(i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))));
const metrics=(a:number[])=>spatialMetrics(a,mask,{nx,ny,nz,radius:.007,height:.055});
describe("spatial structure",()=>{
  it("scores a uniform wet volume as uniform",()=>{
    const m=metrics(Array(n).fill(2));expect(m.cv).toBe(0);expect(m.gini).toBeCloseTo(0,10);
    expect(m.p90p10).toBe(1);expect(m.regions["0.1"].occupiedFraction).toBe(1);
    expect(m.regions["0.1"].components).toBe(1);
  });
  it("distinguishes separated blobs with 26-connectivity",()=>{
    const two=metrics(shape((x,y,z)=>Math.hypot(x-2,y-2,z-2)<=1||Math.hypot(x-6,y-6,z-6)<=1?1:0));
    const one=metrics(shape((x,y,z)=>Math.exp(-((x-4)**2+(y-4)**2+(z-4)**2)/3)));
    expect(two.regions["0.5"].components).toBe(2);expect(one.regions["0.5"].components).toBe(1);
  });
  it("finds filament and sheet surface-to-volume distinction",()=>{
    const filament=metrics(shape((x,y,z)=>x===4&&z===4?1:0));
    const sheet=metrics(shape((x,y,z)=>y===4?1:0));
    expect(filament.regions["0.5"].surfaceVolumeRatio).toBeGreaterThan(sheet.regions["0.5"].surfaceVolumeRatio);
    expect(sheet.verticalProfile[4]).toBeGreaterThan(sheet.verticalProfile[3]);
  });
  it("uses 26-neighbor diagonals",()=>{
    const a=Array(n).fill(0);a[at(2,2,2)]=1;a[at(3,3,3)]=1;
    expect(metrics(a).regions["0.5"].components).toBe(1);
  });
});
it("separates formation from product transport",()=>{
  const base={nx:3,ny:3,nz:3,radius:.007,height:.055,bottom:0,level:.04,mask:Array(27).fill(1),
    tracer:Array(27).fill(0),ag:Array(27).fill(0),cl:Array(27).fill(0),src:Array(27).fill(0),fine:Array(27).fill(0),flow:Array(81).fill(0)};
  base.tracer[13]=1;base.ag[13]=.5;base.cl[13]=.5;base.src[13]=.1;base.fine[13]=.1;
  const first=processMetrics(base);expect(first.precipitation.source).toBeCloseTo(.1);expect(first.productTransport.mass).toBeCloseTo(.1);
  const moved={...base,src:Array(27).fill(0),fine:Array(27).fill(0)};moved.fine[14]=.1;
  const second=processMetrics(moved,first);expect(second.precipitation.source).toBe(0);
  expect(second.productTransport.centroidDisplacement).toBeGreaterThan(0);
});
it("checks a synthetic A/B trace",()=>{
  const first={sim:600,A:{eventIds:["1|0"],firstValidImpactMs:600,firstChlorideInsertionMs:600,
    firstImpactPoint:{x:0,y:1,z:0},surfaceY:1,deliveredMl:1},B:{agTotal:1.1,clTotal:.95,extent:.05,fieldDelivered:1,wetTop:8},
    receiverMl:2,sourceMl:0,stream:{lip:[0,1.1,0]}};
  const trace={clickSim:0,receiverBefore:1,sourceBefore:1,firstChloride:{cell:[4,8,4],sim:600},
    samples:[{sim:0,B:{tracerTotal:0,clTotal:0,extent:0}},first]};
  const result=checkRegression(trace);expect(result.failures).toEqual([]);
  expect(checkRegression({...trace,clickSim:5000,samples:[{sim:5000,B:trace.samples[0].B},{...first,sim:5600}]}).ok).toBe(true);
  expect(checkRegression({...trace,samples:[trace.samples[0],{...first,B:{...first.B,clTotal:.9}}]}).ok).toBe(false);
});
