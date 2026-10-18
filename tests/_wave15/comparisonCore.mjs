export const STAGES = ["before impact", "first valid impact", "first visible cloud", "half-depth spread", "milky", "late state"];

export function detectTube(rgb, width, height, { threshold = 42 } = {}) {
  if (rgb.length !== width * height * 3) throw new RangeError("RGB dimensions");
  // Choose a persistent vertical bright component, excluding titles and short-lived drops.
  const counts = new Uint32Array(width);
  for (let y = Math.floor(height * .12); y < Math.floor(height * .92); y++) for (let x = 0; x < width; x++) {
    const i = 3 * (y * width + x), l = (rgb[i] * 54 + rgb[i+1] * 183 + rgb[i+2] * 19) / 256;
    if (l >= threshold) counts[x]++;
  }
  const minimum = Math.max(5, Math.floor(height * .15));
  let best = null, start = -1;
  for (let x = 0; x <= width; x++) {
    if (x < width && counts[x] >= minimum) { if (start < 0) start = x; }
    else if (start >= 0) { const end = x, score = (end-start) * Math.min(...counts.slice(start,end)); if (!best || score > best.score) best = {x:start,width:end-start,score}; start=-1; }
  }
  if (!best) throw new Error("No vertical bright tube component detected");
  const x0=Math.max(0,best.x-4),x1=Math.min(width,best.x+best.width+4);
  let y0=height,y1=0;
  for(let y=0;y<height;y++)for(let x=x0;x<x1;x++){const i=3*(y*width+x),l=(rgb[i]*54+rgb[i+1]*183+rgb[i+2]*19)/256;if(l>=threshold){y0=Math.min(y0,y);y1=Math.max(y1,y+1);}}
  return {x:x0,y:Math.max(0,y0),width:x1-x0,height:Math.max(1,y1-y0)};
}

export function stageMetrics(rgb, width, height, box, { bright = 150, white = 210 } = {}) {
  const rows=Array(box.height).fill(0), mass=[0,0,0];let count=0,whiteCount=0,sum=0,sum2=0;
  for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
    const i=3*(y*width+x),l=(rgb[i]*54+rgb[i+1]*183+rgb[i+2]*19)/256;
    if(l>=bright) {count++;rows[y-box.y]++;mass[Math.min(2,Math.floor(3*(y-box.y)/box.height))]++;}
    if(l>=white)whiteCount++;sum+=l;sum2+=l*l;
  }
  const n=box.width*box.height,front=rows.findIndex(v=>v>=Math.max(1,box.width*.1));
  return {brightFraction:count/n,whitenessFraction:whiteCount/n,whitenessVariance:sum2/n-(sum/n)**2,
    whiteFront:front<0?null:front/box.height,massByThird:mass.map(v=>count?v/count:0)};
}

export function fieldMetrics(dump, threshold=1e-8) {
  const f=dump.fields??dump,n=f.nx*f.ny*f.nz;if(!f.mask||!f.fine||f.fine.length!==n)throw new RangeError("field dump");
  let cells=0,occupied=0,total=0,squares=0;const rows=new Set(),wetRows=new Set();
  for(let i=0;i<n;i++)if(f.mask[i]) {const v=f.fine[i],y=Math.floor(i/f.nx)%f.ny;wetRows.add(y);cells++;total+=v;squares+=v*v;if(v>threshold){occupied++;rows.add(y);}}
  const mean=total/(cells||1);return {occupiedFraction:occupied/(cells||1),cv:mean?Math.sqrt(Math.max(0,squares/(cells||1)-mean*mean))/mean:0,
    occupiedDepthFraction:rows.size/(wetRows.size||1),fineMass:total};
}

export function stageMarkers(trace, threshold=1e-6) {
  const rec=trace.trace??trace.samples??[],click=trace.clickSim;
  const firstImpact=rec.find(r=>(r.A?.valid??r.A?.events??0)>0);
  const dumps=trace.dumps??[];const visible=dumps.find(d=>fieldMetrics(d).fineMass>threshold);
  const half=dumps.find(d=>fieldMetrics(d).occupiedDepthFraction>=.5);
  return {impact:firstImpact?.sim-click??null,visibleCloud:visible?.simElapsedMs??visible?.sim-click??null,
    halfDepth:half?.simElapsedMs??half?.sim-click??null,late:14000};
}

export function alignStages(reference, game) {
  if(!reference.length||!game.length)throw new RangeError("empty curve");
  // Monotone DTW, with a small temporal penalty to avoid matching distant flat tails.
  const n=game.length,m=reference.length,d=Array.from({length:n},()=>new Float64Array(m).fill(Infinity)),prev=Array.from({length:n},()=>new Uint8Array(m));
  for(let i=0;i<n;i++)for(let j=0;j<m;j++){
    const a=game[i],b=reference[j],cost=Math.abs(a.whitenessFraction-b.whitenessFraction)+.15*Math.abs((a.whiteFront??.5)-(b.whiteFront??.5));
    if(i===0&&j===0){d[i][j]=cost;continue;}
    const choices=[i&&j?d[i-1][j-1]:Infinity,i?d[i-1][j]:Infinity,j?d[i][j-1]:Infinity];
    const k=choices.indexOf(Math.min(...choices));d[i][j]=cost+choices[k];prev[i][j]=k;
  }
  const path=[];let i=n-1,j=m-1;while(true){path.push([i,j]);if(i===0&&j===0)break;const k=prev[i][j];if(k===0){i--;j--;}else if(k===1)i--;else j--;}
  return path.reverse();
}

export function labelText({simMs,referenceSeconds,referenceSpeed,stage,camera,background}) {
  return `game ${((simMs??0)/1000).toFixed(2)}s | reference ${referenceSeconds.toFixed(2)}s ${referenceSpeed} | ${stage} | diagnostic camera ${camera} | ${background} background`;
}
