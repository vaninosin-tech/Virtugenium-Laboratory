import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { alignStages, detectTube, fieldMetrics, labelText, stageMetrics, stageMarkers } from "./comparisonCore.mjs";

const ffmpeg=process.env.FFMPEG??"C:/Users/Aiyrell/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe";
const ffprobe=ffmpeg.replace(/ffmpeg\.exe$/i,"ffprobe.exe");
const reference=process.env.REFERENCE??"C:/Users/Aiyrell/Downloads/AgNO3 + NaCl (silver nitrate + sodium chloride).mp4";
const game=resolve(process.env.GAME??"docs/night/wave15r2/captures/wide");
const out=resolve(process.env.COMPARE_OUT??"docs/night/wave15r2/comparison");
const fps=Number(process.env.FPS??5);if(!(fps>0&&fps<=30))throw new RangeError("FPS");
const run=(exe,args,options={})=>{const r=spawnSync(exe,args,{encoding:null,maxBuffer:256*1024*1024,...options});if(r.error||r.status!==0)throw new Error(`${exe}: ${r.error??r.stderr?.toString().slice(-1500)}`);return r.stdout;};
const dimensions=file=>{const r=JSON.parse(run(ffprobe,["-v","error","-select_streams","v:0","-show_entries","stream=width,height","-of","json",file]).toString());return r.streams[0];};
const rgb=(file,width,height)=>run(ffmpeg,["-v","error","-i",file,"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","-"]);
const nearRecord=(records,epoch)=>{let lo=0,hi=records.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(records[mid].wall<epoch)lo=mid+1;else hi=mid;}return lo&&Math.abs(records[lo-1].wall-epoch)<Math.abs(records[lo].wall-epoch)?records[lo-1]:records[lo];};
const safeTime=v=>Number.isFinite(v)?v:0;
await mkdir(out,{recursive:true});const referenceDir=join(out,"reference-frames");await mkdir(referenceDir,{recursive:true});
run(ffmpeg,["-y","-v","error","-i",reference,"-vf",`fps=${fps}`,join(referenceDir,"ref-%05d.png")]);
const refFiles=(await readdir(referenceDir)).filter(f=>/^ref-\d+\.png$/.test(f)).sort();if(!refFiles.length)throw new Error("Reference produced no frames");
const rd=dimensions(join(referenceDir,refFiles[0])),raw0=rgb(join(referenceDir,refFiles[0]),rd.width,rd.height);
const refBox=detectTube(raw0,rd.width,rd.height);
const refs=refFiles.map((fn,i)=>({fn,time:i/fps,...stageMetrics(rgb(join(referenceDir,fn),rd.width,rd.height),rd.width,rd.height,refBox)}));
const trace=JSON.parse(await readFile(join(game,"trace.json"),"utf8")),index=JSON.parse(await readFile(join(game,"frames","index.json"),"utf8")).idx.sort((a,b)=>a.abs-b.abs);
if(!index.length)throw new Error("Game has no screencast frames");
const records=(trace.trace??[]).filter(r=>Number.isFinite(r.wall)).sort((a,b)=>a.wall-b.wall),gd=dimensions(join(game,"frames",index[0].fn));
const gameBox=process.env.GAME_CROP?JSON.parse(process.env.GAME_CROP):trace.crop;
if(!gameBox)throw new Error("Game crop absent; provide GAME_CROP JSON");
const frames=index.map(entry=>{const rec=nearRecord(records,entry.abs),image=rgb(join(game,"frames",entry.fn),gd.width,gd.height);return {fn:entry.fn,abs:entry.abs,simMs:rec.sim-trace.clickSim,recordWall:rec.wall,...stageMetrics(image,gd.width,gd.height,gameBox)};});
const refCurve=refs,gameCurve=[];for(const f of frames)if(!gameCurve.length||f.simMs-gameCurve.at(-1).simMs>=150)gameCurve.push(f);if(gameCurve.at(-1)!==frames.at(-1))gameCurve.push(frames.at(-1));
const path=alignStages(refCurve,gameCurve),matched=new Map();for(const [gi,ri] of path)matched.set(gi,ri);
const fieldCrossCheck=(trace.dumps??[]).map(d=>({t:d.t??d.simElapsedMs,simElapsedMs:d.simElapsedMs,...fieldMetrics(d)}));
const markers=stageMarkers(trace);markers.milky=frames.find(f=>f.simMs>=0&&f.whitenessFraction>=.35)?.simMs??null;
markers.referenceMilkyPlaybackSeconds=refs.find(f=>f.whitenessFraction>=.35)?.time??null;
const result={reference:{file:reference,box:refBox,frames:refs},game:{directory:game,box:gameBox,frames},fieldCrossCheck,markers,
  method:"Monotone dynamic time warping on whiteness fraction and white-front position; each game frame is joined to the nearest in-page wall epoch (performance.timeOrigin + performance.now), then to the true simulation clock. Reference playback timestamps do not define chemical time.",
  alignment:path.map(([gi,ri])=>({gameIndex:gi,referenceIndex:ri,gameSimMs:gameCurve[gi].simMs,referencePlaybackSeconds:refs[ri].time}))};
await writeFile(join(out,"metrics.json"),JSON.stringify(result,null,2));
const W=900,H=480,alignSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="white"/><text x="60" y="30" font-size="20">Stage alignment: game simulation vs reference playback</text><path d="M60 40 V420 H860" fill="none" stroke="black"/><polyline fill="none" stroke="#1565c0" stroke-width="3" points="${result.alignment.map(p=>`${60+800*p.gameSimMs/14000},${420-360*p.referencePlaybackSeconds/Math.max(1,refs.at(-1).time)}`).join(" ")}"/><text x="350" y="460">Game simulation seconds (0 to 14)</text><text x="65" y="55">Reference playback: 0 to ${refs.at(-1).time.toFixed(1)} s</text></svg>`;
await writeFile(join(out,"alignment.svg"),alignSvg);
if(process.env.METRICS_ONLY==="1"){console.log(`${refs.length} reference, ${frames.length} game frames; metrics only`);process.exit(0);}
const panels=join(out,"panels");await mkdir(panels,{recursive:true});
const font="C\\:/Windows/Fonts/arial.ttf";
const esc=s=>s.replaceAll("\\","\\\\").replaceAll(":","\\:").replaceAll("'","\\'");
const rect=b=>`${b.width}:${b.height}:${b.x}:${b.y}`;
const nearestDump=t=>(trace.dumps??[]).reduce((best,d)=>Math.abs((d.simElapsedMs??d.t)-t)<Math.abs((best?.simElapsedMs??best?.t??Infinity)-t)?d:best,null);
const stage=t=>t<(markers.impact??600)?"before impact":t<(markers.visibleCloud??Infinity)?"first valid impact":t<(markers.halfDepth??Infinity)?"first visible cloud":t<(markers.milky??Infinity)?"half-depth spread":t<9000?"milky":"late state";
const lookup=path.reduce((a,[gi,ri])=>(a.set(gi,ri),a),new Map());
for(let gi=0;gi<gameCurve.length;gi++){
  const g=gameCurve[gi],r=refs[lookup.get(gi)??0],dump=nearestDump(g.simMs),field=dump?.fields??dump;
  const n=field?.nx??12,ny=field?.ny??24,nz=field?.nz??12,bytes=Buffer.alloc(n*ny*3);let max=0;
  if(field?.fine)for(const v of field.fine)max=Math.max(max,v);
  for(let y=0;y<ny;y++)for(let x=0;x<n;x++){const i=x+n*((ny-1-y)+ny*Math.floor(nz/2)),v=field?.mask?.[i]?Math.round(255*Math.min(1,(field.fine[i]/(Number(process.env.FIELD_SCALE??.005))))):0;bytes.fill(v,3*(y*n+x),3*(y*n+x)+3);}
  const raw=join(panels,`field-${String(gi).padStart(5,"0")}.ppm`);await writeFile(raw,Buffer.concat([Buffer.from(`P6\n${n} ${ny}\n255\n`),bytes]));
  const speed=process.env.X50_AT?(r.time>=Number(process.env.X50_AT)?"x50":"x5"):"x5/x50";
  const label=labelText({simMs:g.simMs,referenceSeconds:r.time,referenceSpeed:speed,stage:stage(g.simMs),camera:trace.camera??"wide",background:trace.background??"lab"});
  const file=join(panels,`panel-${String(gi).padStart(5,"0")}.png`);
  const filter=`[0:v]crop=${rect(refBox)},scale=400:420,setsar=1[a];[1:v]scale=640:420,setsar=1[b];[2:v]scale=240:420:flags=neighbor,setsar=1[c];[a][b][c]hstack=inputs=3,pad=1280:480:0:0:black,drawtext=fontfile='${font}':text='${esc(label)}':x=10:y=440:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.8[v]`;
  run(ffmpeg,["-y","-v","error","-i",join(referenceDir,r.fn),"-i",join(game,"frames",g.fn),"-i",raw,"-filter_complex",filter,"-map","[v]","-frames:v","1",file]);
}
run(ffmpeg,["-y","-v","error","-framerate",String(fps),"-i",join(panels,"panel-%05d.png"),"-c:v","libx264","-pix_fmt","yuv420p",join(out,"comparison.mp4")]);
console.log(`${refs.length} reference frames, ${frames.length} game frames, ${gameCurve.length} comparison panels`);
