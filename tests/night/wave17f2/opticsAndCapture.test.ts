import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeSilverVolumeMaterial } from "../../../src/scenes/laboratory/lib/tubeSilverVolumeMaterial";
import { marchSilverLayers, renderSilverLayers, silverAggregateDumpFromState,
  SILVER_FINE_OPTICS, type SilverAggregateDump } from "../../../src/scenes/laboratory/lib/night/render/silverOpticsReference";
import { luminanceContrast, sedimentMoireMetric } from "../../_wave16/imageMetrics.mjs";
import { progressionStage, PROGRESSION_STAGES, stageMarkers } from "../../_wave15/comparisonCore.mjs";

const state = JSON.parse(readFileSync("docs/night/wave16shared/state_9s.json", "utf8"));
const dump = silverAggregateDumpFromState(state);
const origin: [number, number, number] = [0, .025, .021];
const direction: [number, number, number] = [0, 0, -1];

describe("Wave 17 aggregate optics and capture tools", () => {
  it("reads the physical dump in texture units and conserves the aggregate density sum", () => {
    expect(dump.nx * dump.ny * dump.nz).toBe(state.fine.length);
    expect(dump.fine.reduce((a,b)=>a+b,0)).toBeGreaterThan(state.fine.reduce((a:number,b:number)=>a+b,0));
    expect(dump.aggregate.filter((_:number,i:number)=>i%4===0).reduce((a:number,b:number)=>a+b,0))
      .toBeCloseTo(state.aggregate.filter((_:number,i:number)=>i%4===0).reduce((a:number,b:number)=>a+b,0),8);
  });

  it("keeps distinct solid modes and dense white with translucent thin material", () => {
    const empty: SilverAggregateDump={...dump,fine:dump.fine.map(()=>0),aggregate:dump.aggregate.map(()=>0)};
    const dense={...empty,aggregate:[...empty.aggregate]};
    const n=dense.nx*dense.ny*dense.nz;
    for(let i=0;i<n;i++) if(dense.mask[i]){dense.aggregate[4*i]=.8;dense.aggregate[4*i+1]=.3;dense.aggregate[4*i+2]=.7;}
    const thick=marchSilverLayers(dense,origin,direction,0,2);
    expect(thick[3]).toBeGreaterThan(.95);
    expect(thick[0]).toBeGreaterThan(.88);
    expect(thick[0]).toBeLessThanOrEqual(SILVER_FINE_OPTICS.lightStrength+SILVER_FINE_OPTICS.ambient+SILVER_FINE_OPTICS.ambientBoost);
    const thin={...dense,aggregate:dense.aggregate.map((v,i)=>i%4===0?v*.005:v)};
    expect(marchSilverLayers(thin,origin,direction,0,2)[3]).toBeLessThan(thick[3]);
    expect(marchSilverLayers(empty,origin,direction,0,0)[3]).toBe(0);
    expect(marchSilverLayers(dump,origin,direction,0,3)[3]).toBeGreaterThanOrEqual(0);
  });

  it("keeps one primary sample of each physical state and the tap budget", () => {
    const material=makeSilverVolumeMaterial(.007,0,.055).material,shader=material.fragmentShader;
    const main=shader.slice(shader.indexOf("void main()"));
    expect((main.match(/texture\(uHaze,grid\)/g)??[]).length).toBe(1);
    expect((main.match(/texture\(uAggregate,grid\)/g)??[]).length).toBe(1);
    expect((shader.match(/texture\(uAggregate,uvw\(q\)\)/g)??[]).length).toBe(1);
    expect(Number(material.uniforms.uSteps.value)).toBe(88);
    expect(shader).not.toMatch(/\*\s*17(?![.\d])/);
    material.dispose();
  });

  it("keeps the silver sediment surface free of repeated detail frequencies", () => {
    const source=readFileSync("src/scenes/laboratory/lib/tubeReactionVisuals.ts","utf8");
    const silver=source.slice(source.indexOf('} else if (kind === "silver-chloride") {'),
      source.indexOf('bedMaterial.customProgramCacheKey = () => "silver-curd-bed-v3"'));
    expect(source).toContain('side: kind === "silver-chloride" ? THREE.FrontSide');
    expect(silver).toContain('smoothstep(0.000018, 0.00035, vSedimentThickness)');
    expect(silver).not.toMatch(/(?:sin|cos|fract|mod)\s*\(/);
    expect(silver).not.toMatch(/min\(vSedimentThickness, deposited\)/);
  });

  it("writes CPU reference panels for real state, including three backgrounds", () => {
    const out="docs/night/wave17f2";mkdirSync(out,{recursive:true});
    for(const solid of [0,1,2,3] as const)for(const optics of [0,1,2,3] as const)
      writeFileSync(join(out,`state-9s-solid${solid}-optics${optics}.ppm`),renderSilverLayers(dump,optics,solid,48,110));
    for(const [name,bg] of [["black",0],["gray",.5],["lab",.85]] as const)
      writeFileSync(join(out,`state-9s-aggregate-${name}.ppm`),renderSilverLayers(dump,0,2,48,110,bg));
    const ray=marchSilverLayers(dump,origin,direction,0,2);
    expect(ray[0]).toBeGreaterThan(0);
    expect(ray[3]).toBeGreaterThan(0);
  },30000);

  it("detects an imposed periodic sediment pattern in the high-pass FFT", () => {
    const make=(pattern:boolean)=>{const out=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const i=4*(y*64+x),value=pattern?Math.round(160+40*Math.sin(2*Math.PI*x/8)*Math.sin(2*Math.PI*y/8)):160;
      out[i]=out[i+1]=out[i+2]=value;out[i+3]=255;
    }return out;};
    expect(sedimentMoireMetric(make(true),64,64).peakToBroadband)
      .toBeGreaterThan(sedimentMoireMetric(make(false),64,64).peakToBroadband);
    const contrast=luminanceContrast(make(false),64,64);
    expect(Math.abs(contrast.contrast)).toBeLessThan(1e-6);
  });

  it("exposes nine stage labels and physical stage markers", () => {
    const trace={clickSim:100, durationMs:22000,trace:[
      {sim:100,A:{valid:0},B:{aggregateCount:0,largestNodeMass:0,sedimentMass:0}},
      {sim:200,A:{valid:1},B:{aggregateCount:1,largestNodeMass:.002,sedimentMass:0}},
      {sim:300,A:{valid:1},B:{aggregateCount:2,largestNodeMass:.003,sedimentMass:.01}}],
      dumps:[{sim:200,simElapsedMs:100,nx:1,ny:1,nz:1,mask:[1],fine:[.01]}]};
    const markers=stageMarkers(trace);
    expect(markers.impact).toBe(100);expect(markers.firstAggregateAboveMass).toBe(100);
    expect(markers.firstSedimentDeposit).toBe(200);
    expect(markers.aggregateMaximumCount).toEqual({simElapsedMs:200,count:2});
    expect(PROGRESSION_STAGES).toHaveLength(9);
    expect(progressionStage(18000,markers)).toBe(PROGRESSION_STAGES[8]);
  });
});
