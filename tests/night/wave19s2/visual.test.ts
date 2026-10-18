import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { silverAggregateDumpFromState, renderSilverLayers, type SilverAggregateDump } from '../../../src/scenes/laboratory/lib/night/render/silverOpticsReference';

const times=[3,6,9,14,22];
const reps=['fine','sections','nodes','sediment','combined'] as const;
const width=40,height=100;
function state(t:number){return JSON.parse(readFileSync(`docs/night/wave16shared/wave18_state_${t}s.json`,'utf8'));}
function layer(d:SilverAggregateDump,rep:typeof reps[number]):SilverAggregateDump{
  const zeroFine=new Array(d.fine.length).fill(0),zeroAgg=new Array(d.aggregate.length).fill(0),zeroBed=new Array(d.sedimentHeight.length).fill(0);
  return {...d,fine:rep==='fine'||rep==='combined'?d.fine:zeroFine,
    aggregate:rep==='sections'||rep==='combined'?d.aggregate:zeroAgg,
    sedimentHeight:rep==='sediment'||rep==='combined'?d.sedimentHeight:zeroBed};
}
function pixels(ppm:Uint8Array){const end=ppm.indexOf(10,ppm.indexOf(10,ppm.indexOf(10)+1)+1)+1;return ppm.slice(end);}
function stats(ppm:Uint8Array){
  const p=pixels(ppm),l:number[]=[];
  for(let i=0;i<p.length;i+=3)l.push((.2126*p[i]+.7152*p[i+1]+.0722*p[i+2])/255);
  const core=l.filter((_,i)=>{const x=i%width,y=Math.floor(i/width);return x>=width*.3&&x<width*.7&&y>=height*.38&&y<height*.7;});
  const denseCore=core.reduce((a,b)=>a+b,0)/core.length;
  const contrast=Math.max(...l)-Math.min(...l);
  return {denseCore,contrast,min:Math.min(...l),max:Math.max(...l)};
}
function tile(ppms:Uint8Array[]){
  const head=new TextEncoder().encode(`P6\n${width*5} ${height*4}\n255\n`);
  const out=new Uint8Array(head.length+width*5*height*4*3);out.set(head);
  for(let mode=0;mode<4;mode++)for(let rep=0;rep<5;rep++){
    const pix=pixels(ppms[mode*5+rep]);
    for(let y=0;y<height;y++)out.set(pix.slice(y*width*3,(y+1)*width*3),head.length+((mode*height+y)*width*5+rep*width)*3);
  }
  return out;
}
describe('wave19 optical layer separation',()=>{
  it('renders synchronized frozen representations without double-counting aggregate mass',()=>{
    const manifest=[];
    for(const t of times){
      const raw=state(t),d=silverAggregateDumpFromState(raw),sectionMass=raw.sectionMasses.reduce((a:number,b:number)=>a+b,0);
      expect(raw.visibleFlocs).toHaveLength(0);
      expect(Math.abs(sectionMass-raw.masses.aggregate)).toBeLessThan(1e-12);
      expect(Math.abs(raw.masses.fine+sectionMass+raw.masses.sediment-raw.masses.extent)).toBeLessThan(1e-12);
      const ppms=[];
      for(let mode=0;mode<4;mode++)for(const rep of reps){
        const ppm=renderSilverLayers(layer(d,rep),mode as 0|1|2|3,
          rep==='sediment'?3:rep==='fine'?1:rep==='sections'||rep==='nodes'?2:0,width,height,mode===1||mode===3?0:.5);
        ppms.push(ppm);
        manifest.push({time:t,representation:rep,optics:mode,...stats(ppm),
          mass:rep==='fine'?raw.masses.fine:rep==='sections'?sectionMass:rep==='nodes'?0:rep==='sediment'?raw.masses.sediment:raw.masses.extent});
      }
      writeFileSync(`docs/night/wave19s2/sheet_${t}s.ppm`,tile(ppms));
    }
    writeFileSync('docs/night/wave19s2/optical-metrics.json',JSON.stringify(manifest,null,2));
  },180000);
});
