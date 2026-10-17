import { readFileSync, writeFileSync } from 'node:fs';
const root='docs/night/wave10c1';
function read(name){const b=readFileSync(`${root}/${name}.ppm`);const breaks=[];
  for(let i=0;i<b.length&&breaks.length<3;i++)if(b[i]===10)breaks.push(i);
  const [w,h]=b.subarray(breaks[0]+1,breaks[1]).toString().split(' ').map(Number);
  return {w,h,data:b.subarray(breaks[2]+1)};
}
for(const quality of ['LOW','HIGH'])for(const ms of [500,1000,2000,4000,6000,9000])
  for(const plane of ['vertical','horizontal']){
    const a=read(`old_${quality}_${ms}ms_pixels_${plane}`),b=read(`new_${quality}_${ms}ms_pixels_${plane}`);
    if(a.w!==b.w||a.h!==b.h)throw Error('grid mismatch');
    const pixels=Buffer.alloc(a.w*a.h*6);
    for(let y=0;y<a.h;y++){a.data.copy(pixels,y*a.w*6,y*a.w*3,(y+1)*a.w*3);
      b.data.copy(pixels,y*a.w*6+a.w*3,y*a.w*3,(y+1)*a.w*3);}
    writeFileSync(`${root}/comparison_${quality}_${ms}ms_${plane}.ppm`,
      Buffer.concat([Buffer.from(`P6\n${a.w*2} ${a.h}\n255\n`),pixels]));
  }
