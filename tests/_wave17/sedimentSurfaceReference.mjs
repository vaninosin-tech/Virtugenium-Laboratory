import { readFile, mkdir, writeFile } from "node:fs/promises";
import { sedimentMoireMetric } from "../_wave16/imageMetrics.mjs";

const raw=JSON.parse(await readFile("docs/night/wave16shared/state_9s.json","utf8"));
const [nx,,nz]=raw.dimensions,heights=raw.sedimentHeights;
const out=process.env.OUT??"docs/night/wave17f2";await mkdir(out,{recursive:true});
const size=128,at=(x,z)=>Math.max(0,heights[Math.min(nz-1,z)*nx+Math.min(nx-1,x)]??0);
const sample=(u,v)=>{const gx=Math.max(0,Math.min(nx-1,u*nx-.5)),gz=Math.max(0,Math.min(nz-1,v*nz-.5));
  const x=Math.floor(gx),z=Math.floor(gz),fx=gx-x,fz=gz-z;
  return (at(x,z)*(1-fx)+at(x+1,z)*fx)*(1-fz)+(at(x,z+1)*(1-fx)+at(x+1,z+1)*fx)*fz;};
const metrics={source:"state_9s.json",model:"top-down CPU surface crop; legacy fixed sine versus height-only white curd"};
for(const [name,legacy] of [["before",true],["after",false]]){
  const rgb=new Uint8Array(size*size*3),rgba=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x+.5)/size,v=(y+.5)/size,r=Math.hypot(2*u-1,2*v-1),h=r<.96?sample(u,v):0;
    const alpha=Math.min(1,Math.max(0,(h-.000018)/(.00035-.000018)));
    const curd=legacy?.94+.06*Math.sin(u*183)*Math.sin(v*197):.94;
    const value=Math.round(255*(.15*(1-alpha)+curd*alpha));
    const i=3*(y*size+x),j=4*(y*size+x);
    rgb[i]=rgb[i+1]=rgb[i+2]=value;rgba[j]=rgba[j+1]=rgba[j+2]=value;rgba[j+3]=255;
  }
  await writeFile(`${out}/sediment-crop-${name}.ppm`,Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`),rgb]));
  metrics[name]=sedimentMoireMetric(rgba,size,size);
}
await writeFile(`${out}/sediment-crop-metrics.json`,JSON.stringify(metrics,null,2));
console.log(JSON.stringify({before:metrics.before.peakToBroadband,after:metrics.after.peakToBroadband}));
