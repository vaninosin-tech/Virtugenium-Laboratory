import {readFileSync,writeFileSync} from 'node:fs';
const out=[];
const percentile=(v,q)=>v.sort((a,b)=>a-b)[Math.floor((v.length-1)*q)]??0;
for(const t of [3,6,9,14,22]){
  const d=JSON.parse(readFileSync(`docs/night/wave16shared/wave18_state_${t}s.json`));
  const [nx,ny,nz]=d.dimensions,active=d.mask.filter(Boolean).length;
  const fineMass=d.fine.reduce((a,b)=>a+b,0),opticalMix=Math.max(0,Math.min(.78,(fineMass-.10)*7));
  const fine=[],sections=[];
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    let tf=0,ta=0,wet=false;
    for(let z=0;z<nz;z++){
      const i=x+nx*(y+ny*z);if(!d.mask[i])continue;wet=true;
      tf+=d.fine[i]*active*8*(2/nz);
      const density=d.aggregate[4*i],loose=d.aggregate[4*i+1],compact=d.aggregate[4*i+2];
      ta+=density*17*(1-.25*Math.max(0,Math.min(1,loose)))*(.85+.15*Math.max(0,Math.min(1,compact)))*(2/nz);
    }
    if(wet){fine.push(tf);sections.push(ta);}
  }
  out.push({time:t,method:'straight occupied x/y ray along z; homogeneous voxel density, without grain, trilinear interpolation, or alpha stop',
    fine:{p50:percentile(fine,.5),p95:percentile(fine,.95),max:Math.max(...fine)},
    sections:{p50:percentile(sections,.5),p95:percentile(sections,.95),max:Math.max(...sections)}});
}
writeFileSync('docs/night/wave19s2/optical-depth.json',JSON.stringify(out,null,2));
