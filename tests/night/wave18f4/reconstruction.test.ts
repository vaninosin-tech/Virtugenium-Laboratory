import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { SilverFlocReconstruction } from "../../../src/scenes/laboratory/lib/night/render/silverFlocReconstruction";
import { marchSilverLayers, silverAggregateDumpFromState, type SilverAggregateDump, SILVER_FINE_OPTICS } from "../../../src/scenes/laboratory/lib/night/render/silverOpticsReference";
import { SilverSedimentField, SilverSedimentGeometry } from "../../../src/scenes/laboratory/lib/tubeSilverSediment";

const nx = 6, ny = 8, nz = 6;
const index = (x: number, y: number, z: number) => x + nx * (y + ny * z);
const coarse = new Float32Array(nx * ny * nz * 4);
for (let z = 1; z < 5; z++) for (let y = 2; y < 7; y++) for (let x = 1; x < 5; x++) {
  const i = index(x,y,z) * 4; coarse[i] = .24 + .08 * Math.sin(x + z); coarse[i+1] = .8; coarse[i+2] = .2;
}
const nodes = [
  { x: -.0015, y: .023, z: 0, mass: .08 },
  { x: 0, y: .019, z: .0004, mass: .06 },
  { x: .0014, y: .015, z: .001, mass: .04 },
];
const links = [{a:0,b:1},{a:1,b:2}];
const make = () => { const r = new SilverFlocReconstruction(nx,ny,nz);
  r.update(coarse,nodes,links,.007,0,.055,() => .0022); return r; };

describe("wave 18 conserved floc display", () => {
  it("conserves every coarse voxel and the whole aggregate integral", () => {
    const r = make(), hi = r.pixels;
    let lowTotal = 0, highTotal = 0;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const low = coarse[index(x,y,z)*4]; lowTotal += low;
      let high = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        high += hi[4*((2*x+dx)+2*nx*((2*y+dy)+2*ny*(2*z+dz)))]/8;
      highTotal += high;
      expect(high).toBeCloseTo(low,6);
    }
    expect(highTotal).toBeCloseTo(lowTotal,5);
    expect(r.texture.image.width).toBe(nx*2);
    r.dispose();
  });

  it("integrates to the supplied physical node mass when the source field represents those nodes", () => {
    const activeCount = nx*ny*nz;
    const nodeMass = nodes.reduce((sum,node)=>sum+node.mass,0);
    const sourceTotal = coarse.reduce((sum,value,i)=>sum+(i%4===0?value:0),0);
    const normalized = new Float32Array(coarse);
    for(let i=0;i<normalized.length;i+=4) normalized[i] *= nodeMass*activeCount/sourceTotal;
    const r = new SilverFlocReconstruction(nx,ny,nz);
    r.update(normalized,nodes,links,.007,0,.055,() => .0022);
    let reconstructedMass=0;
    for(let i=0;i<r.pixels.length;i+=4) reconstructedMass += r.pixels[i]/(8*activeCount);
    expect(reconstructedMass).toBeCloseTo(nodeMass,6);
    r.dispose();
  });

  it("keeps density centroid and iso regions independent of the fibre noise seed", () => {
    const a=make(),seeded=new Float32Array(coarse);
    for(let i=3;i<seeded.length;i+=4)seeded[i]=.9;
    const b=new SilverFlocReconstruction(nx,ny,nz);
    b.update(seeded,nodes,links,.007,0,.055,()=>.0022);
    let massA=0,massB=0,weightedA=0,weightedB=0;
    for(let i=0;i<a.pixels.length;i+=4){const x=(i/4)%(nx*2);
      massA+=a.pixels[i];massB+=b.pixels[i];weightedA+=x*a.pixels[i];weightedB+=x*b.pixels[i];
      expect(a.pixels[i]>=.1).toBe(b.pixels[i]>=.1);
    }
    expect(weightedA/massA).toBeCloseTo(weightedB/massB,10);
    a.dispose();b.dispose();
  });

  it("forms connected, uneven subcells only where conserved density exists", () => {
    const r = make(), values = [];
    for (let z = 0; z < nz*2; z++) for (let y = 0; y < ny*2; y++) for (let x = 0; x < nx*2; x++)
      values.push(r.pixels[4*(x+nx*2*(y+ny*2*z))]);
    expect(Math.max(...values)).toBeGreaterThan(.5);
    expect(values.filter(v=>v===0).length).toBeGreaterThan(values.length/2);
    const d: SilverAggregateDump = {nx,ny,nz,radius:.007,bottom:0,height:.055,
      mask:new Array(nx*ny*nz).fill(1), fine:new Array(nx*ny*nz).fill(0),
      aggregate:Array.from(r.pixels),aggregateResolutionScale:2,sedimentHeight:new Array(nx*nz).fill(0)};
    const core=marchSilverLayers(d,[0,.02,.021],[0,0,-1],0,2);
    expect(core[0]).toBeGreaterThan(.85);
    expect(core[0]).toBeLessThanOrEqual(SILVER_FINE_OPTICS.lightStrength+SILVER_FINE_OPTICS.ambient+SILVER_FINE_OPTICS.ambientBoost);
    r.dispose();
  });

  it("uses only the aggregate state as mass and keeps fine and sediment separate", () => {
    const source=readFileSync("src/scenes/laboratory/lib/night/render/silverFlocReconstruction.ts","utf8");
    const shader=readFileSync("src/scenes/laboratory/lib/tubeSilverVolumeMaterial.ts","utf8");
    expect(source).toContain("density * 8 * weights[sub] / sum");
    expect(source).not.toContain("pixels[destination] +=");
    expect(shader).toMatch(/smokeValue\s*=.*texture\(uHaze,grid\)\.r/);
    expect(shader).toMatch(/field\s*=.*texture\(uAggregate,grid\)/);
    expect(shader).not.toMatch(/uSolidMode == 3[^\n]*texture\(uAggregate/);
  });

  it("scales only deposit display geometry for the moire diagnostic", () => {
    const field = new SilverSedimentField(6,6), geometry = new SilverSedimentGeometry(.007,0);
    const heights = new Float32Array(36).fill(.0002);
    const texture = new THREE.DataTexture(heights,6,6,THREE.RedFormat,THREE.FloatType);
    geometry.update(field,texture,1); const physical = geometry.getAttribute("sedimentThickness").getX(0);
    geometry.update(field,texture,10); const diagnostic = geometry.getAttribute("sedimentThickness").getX(0);
    expect(diagnostic).toBeCloseTo(physical*10,6);
    expect(heights[0]).toBeCloseTo(.0002,8);
    geometry.dispose(); texture.dispose();
  });

  it("measures aggregate core contrast against the bright CPU lab wall", () => {
    const raw=JSON.parse(readFileSync("docs/night/wave16shared/state_9s.json","utf8"));
    const d=silverAggregateDumpFromState(raw), wall=.85;
    let best={aggregate:0,fine:0,combined:0,alpha:0}, bestDistinct={aggregate:0,fine:0,combined:0,alpha:0,contrast:0};
    let bestCombined={aggregate:0,fine:0,combined:0,contrast:0};
    for(let y=0;y<32;y++)for(let x=0;x<20;x++){
      const px=((x+.5)/20*2.4-1.2)*d.radius;
      const py=d.bottom+(1-(y+.5)/32)*(d.height+.75*d.radius)-.15*d.radius;
      const ray=(layer:0|1|2)=>{const c=marchSilverLayers(d,[px,py,3*d.radius],[0,0,-1],0,layer);
        return {value:c[0]*c[3]+wall*(1-c[3]),alpha:c[3]};};
      const aggregate=ray(2);
      if(aggregate.value>best.aggregate){best={aggregate:aggregate.value,fine:ray(1).value,combined:ray(0).value,alpha:aggregate.alpha};}
      const fine=ray(1),combined=ray(0),contrast=Math.min(1,aggregate.value)-Math.min(1,fine.value);
      if(aggregate.alpha>.2&&contrast>bestDistinct.contrast)bestDistinct={aggregate:aggregate.value,fine:fine.value,combined:combined.value,alpha:aggregate.alpha,contrast};
      const combinedContrast=Math.min(1,combined.value)-Math.min(1,fine.value);
      if(combined.value>wall&&combinedContrast>bestCombined.contrast)
        bestCombined={aggregate:aggregate.value,fine:fine.value,combined:combined.value,contrast:combinedContrast};
    }
    expect(best.aggregate).toBeGreaterThan(wall);
    expect(best.alpha).toBeGreaterThan(0);
    writeFileSync("docs/night/wave18f4/contrast-9s.json",JSON.stringify({background:"CPU lab wall",wall,brightestAggregate:best,
      bestDisplayContrast:bestDistinct,bestCombinedContrast:bestCombined,aggregateMinusWall:Math.min(1,best.aggregate)-wall},null,2));
  });
});
