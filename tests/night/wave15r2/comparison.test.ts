import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { alignStages, detectTube, fieldMetrics, labelText, stageMarkers, stageMetrics } from "../../_wave15/comparisonCore.mjs";
import { checkRegression } from "../../_wave13/regressionChecks.mjs";

describe("wave 15 comparison",()=>{
  it("finds a vertical bright tube and measures its cloud",()=>{
    const w=40,h=60,a=new Uint8Array(w*h*3);for(let y=8;y<55;y++)for(let x=17;x<24;x++)a.fill(y<30?240:170,3*(y*w+x),3*(y*w+x)+3);
    const box=detectTube(a,w,h);expect(box.x).toBeLessThanOrEqual(17);expect(box.x+box.width).toBeGreaterThanOrEqual(24);
    const m=stageMetrics(a,w,h,box);expect(m.whitenessFraction).toBeGreaterThan(.2);expect(m.massByThird.reduce((x,y)=>x+y,0)).toBeCloseTo(1);
  });
  it("computes fine suspension occupancy only in wet cells",()=>{
    const f={nx:2,ny:2,nz:1,mask:[1,1,1,0],fine:[1,0,2,0]};expect(fieldMetrics(f).occupiedFraction).toBeCloseTo(2/3);
    expect(fieldMetrics(f).fineMass).toBe(3);
  });
  it("aligns curves monotonically despite unequal playback rate",()=>{
    const game=[0,.1,.3,.7,1].map(whitenessFraction=>({whitenessFraction,whiteFront:.3}));
    const ref=[0,.05,.12,.3,.5,.7,1].map(whitenessFraction=>({whitenessFraction,whiteFront:.3}));
    const path=alignStages(ref,game);expect(path[0]).toEqual([0,0]);expect(path.at(-1)).toEqual([4,6]);
    for(let i=1;i<path.length;i++){expect(path[i][0]).toBeGreaterThanOrEqual(path[i-1][0]);expect(path[i][1]).toBeGreaterThanOrEqual(path[i-1][1]);}
  });
  it("uses in-page simulation times for markers and explicit labels",()=>{
    const t={clickSim:1000,trace:[{sim:1200,A:{valid:0}},{sim:1600,A:{valid:1}}],dumps:[{simElapsedMs:900,fields:{nx:1,ny:2,nz:1,mask:[1,1],fine:[.1,.1]}}]};
    expect(stageMarkers(t).impact).toBe(600);expect(stageMarkers(t).visibleCloud).toBe(900);
    expect(labelText({simMs:1500,referenceSeconds:4.2,referenceSpeed:"x5",stage:"milky",camera:"wide",background:"lab"})).toContain("game 1.50s | reference 4.20s x5");
  });
  it("treats absent pre-impact field as zero and checks dry cells",()=>{
    const t={clickSim:1000,diag:{firstValidImpactMs:1600},samples:[{sim:1200,A:{valid:0}},{sim:1700,A:{valid:1}}],dumps:[{B:{extent:0,fieldDelivered:0},fields:{nx:1,ny:1,nz:1,mask:[0],ag:[.1],cl:[0],fine:[0],src:[0]}}]};
    const result=checkRegression(t);expect(result.notes.length).toBe(1);expect(result.failures).toContain("no concentration in dry cells 0");
    expect(result.unavailable).not.toContain("no tracer before impact");
  });
  it("recognizes existing screencast epoch index format",()=>{
    const path="D:/Claude/virtugenium-night/frames/w12D/frames/index.json";
    try {const index=JSON.parse(readFileSync(path,"utf8"));expect(index.idx.length).toBeGreaterThan(0);expect(index.idx[0]).toEqual(expect.objectContaining({fn:expect.any(String),abs:expect.any(Number)}));}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT"&& (e as NodeJS.ErrnoException).code!=="EACCES")throw e;}
  });
});
