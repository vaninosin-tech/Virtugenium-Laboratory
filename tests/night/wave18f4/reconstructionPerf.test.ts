import { expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { SilverFlocReconstruction } from "../../../src/scenes/laboratory/lib/night/render/silverFlocReconstruction";

it("benchmarks the bounded 260-node reconstruction without a browser", () => {
  const nx=12,ny=24,nz=12,radius=.007,height=.055;
  const coarse=new Float32Array(nx*ny*nz*4);
  for(let i=0;i<coarse.length;i+=4){coarse[i]=.08;coarse[i+1]=.8;coarse[i+2]=.2;}
  const nodes=Array.from({length:260},(_,i)=>{const cluster=Math.floor(i/10),angle=cluster*2.39996;
    const r=.004*Math.sqrt((cluster%25)/25),j=(i%10)-4.5;
    return {x:r*Math.cos(angle)+j*.00013,y:.009+(cluster%13)/13*.037+j*.00009,
      z:r*Math.sin(angle)-j*.00011,mass:.01+(i%7)*.004};});
  const links=Array.from({length:200},(_,i)=>({a:Math.floor(i/8)*10+i%8,b:Math.floor(i/8)*10+i%8+1}));
  const reconstruction=new SilverFlocReconstruction(nx,ny,nz),elapsed=[];
  for(let i=0;i<12;i++){
    const start=performance.now();reconstruction.update(coarse,nodes,links,radius,0,height,()=>.0021);
    if(i>=2)elapsed.push(performance.now()-start);
  }
  elapsed.sort((a,b)=>a-b);
  writeFileSync("docs/night/wave18f4/reconstruction-benchmark.json",JSON.stringify({nodes:nodes.length,links:links.length,
    medianMs:elapsed[Math.floor(elapsed.length/2)],p90Ms:elapsed[Math.floor(elapsed.length*.9)]},null,2));
  expect(reconstruction.pixels.length).toBe(nx*ny*nz*8*4);
  reconstruction.dispose();
});
