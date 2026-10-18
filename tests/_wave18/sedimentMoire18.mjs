import { mkdir, writeFile } from "node:fs/promises";
import { sedimentMoireMetric } from "../_wave16/imageMetrics.mjs";

// Controlled height field, independent of chemical state. The old branch uses
// the exact 7690e47 sine frequencies and min(vertex, texture) alpha rule; the
// new branch uses the current height-only tone and vertex alpha rule.
const out=process.env.OUT??"docs/night/wave18f4"; await mkdir(out,{recursive:true});
const size=256,n=12,scale=10;let rings=14,sectors=40;
const heights=new Float64Array(n*n);
for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const u=(x+.5)/n*2-1,v=(z+.5)/n*2-1,r2=u*u+v*v;
  heights[x+n*z]=r2<.8?.00007*(1-r2/.8)*(1+.18*Math.sin(7*u+3*v)+.12*Math.cos(5*v-2*u)):0;
}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const at=(x,z)=>heights[Math.max(0,Math.min(n-1,x))+n*Math.max(0,Math.min(n-1,z))];
const sample=(u,v)=>{const gx=Math.max(0,Math.min(n-1,u*n-.5)),gz=Math.max(0,Math.min(n-1,v*n-.5));
  const x=Math.floor(gx),z=Math.floor(gz),fx=gx-x,fz=gz-z;
  return (at(x,z)*(1-fx)+at(x+1,z)*fx)*(1-fz)+(at(x,z+1)*(1-fx)+at(x+1,z+1)*fx)*fz;};
const vertex=(ring,sector)=>{const radius=.96*ring/rings,a=2*Math.PI*sector/sectors;
  const u=.5+.5*radius*Math.cos(a),v=.5+.5*radius*Math.sin(a);
  return {u,v,h:sample(u,v)*scale*(1-smooth(.82,1,ring/rings))};};
const bary=(p,a,b,c)=>{const den=(b.v-c.v)*(a.u-c.u)+(c.u-b.u)*(a.v-c.v);
  const wa=((b.v-c.v)*(p.u-c.u)+(c.u-b.u)*(p.v-c.v))/den;
  const wb=((c.v-a.v)*(p.u-c.u)+(a.u-c.u)*(p.v-c.v))/den;
  return {wa,wb,wc:1-wa-wb};};
const meshHeight=(u,v)=>{const dx=(u-.5)*2,dz=(v-.5)*2,rad=Math.hypot(dx,dz);
  if(rad>.96)return 0;
  const angle=(Math.atan2(dz,dx)+2*Math.PI)%(2*Math.PI),sector=Math.floor(angle/(2*Math.PI)*sectors);
  const ring=Math.max(0,Math.min(rings-1,Math.floor(rad/.96*rings)));
  const innerA=vertex(ring,sector),innerB=ring===0?innerA:vertex(ring,sector+1);
  const outerA=vertex(ring+1,sector),outerB=vertex(ring+1,sector+1),p={u,v};
  for(const [a,b,c] of ring===0?[[innerA,outerA,outerB]]:[[innerA,innerB,outerA],[innerB,outerB,outerA]]){
    const t=bary(p,a,b,c);if(t.wa>=-1e-6&&t.wb>=-1e-6&&t.wc>=-1e-6)return Math.max(0,t.wa*a.h+t.wb*b.h+t.wc*c.h);
  }
  return sample(u,v)*scale;
};
const result={source:"controlled synthetic deposit",displayScale:scale,grid:[n,n],meshBefore:[14,40],meshAfter:[24,64],beforeCommit:"7690e47"};
for(const before of [true,false]){
  rings=before?14:24;sectors=before?40:64;
  const rgb=new Uint8Array(size*size*3),rgba=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x+.5)/size,v=(y+.5)/size,mesh=meshHeight(u,v),deposited=sample(u,v)*scale;
    const alpha=smooth(.000018,.00035,before?Math.min(mesh,deposited):mesh);
    const tone=before?.94+.06*Math.sin(u*183)*Math.sin(v*197):.96*(.96+.04*smooth(.000018,.0007,deposited));
    const value=Math.round(255*(.15*(1-alpha)+tone*alpha));
    const i=3*(y*size+x),j=4*(y*size+x);rgb[i]=rgb[i+1]=rgb[i+2]=value;rgba[j]=rgba[j+1]=rgba[j+2]=value;rgba[j+3]=255;
  }
  const name=before?"before":"after";
  await writeFile(`${out}/sediment-diagnostic-${name}.ppm`,Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`),rgb]));
  result[name]=sedimentMoireMetric(rgba,size,size,{size:128,region:[.25,.75,.25,.75],targetCycles:[183*.5/(2*Math.PI),197*.5/(2*Math.PI)]});
}
await writeFile(`${out}/sediment-diagnostic-metrics.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({before:result.before.peakToBroadband,after:result.after.peakToBroadband,
  oldLatticeBefore:result.before.targetToBroadband,oldLatticeAfter:result.after.targetToBroadband}));
