const near=(a,b,tolerance)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
export function checkRegression(trace,{strict=false}={}) {
  const failures=[],unavailable=new Set(),check=(name,available,passed)=>{if(!available){const category=name.replace(/ \d+$/,""),fresh=!unavailable.has(category);unavailable.add(category);if(strict&&fresh)failures.push(`${category}: unavailable`);}else if(!passed)failures.push(name);};
  const samples=trace.samples??trace.trace??[],click=trace.clickSim,diag=trace.diag??samples.at(-1)?.A??trace.dumps?.at(-1)?.A;
  const valid=samples.filter(s=>(s.A?.valid??s.A?.events??s.A?.eventIds?.length??0)>0);
  const impactElapsed=diag?.firstValidImpactMs < click ? diag.firstValidImpactMs : diag?.firstValidImpactMs-click;
  const before=samples.filter(s=>s.sim<click+impactElapsed);
  check("impact timing",Number.isFinite(click)&&Number.isFinite(diag?.firstValidImpactMs),near(impactElapsed,600,150));
  check("impact on receiving surface",Number.isFinite(diag?.firstImpactPoint?.y)&&Number.isFinite(diag?.surfaceY),near(diag?.firstImpactPoint?.y,diag?.surfaceY,.003));
  check("stream above impact",samples.some(s=>s.stream?.lip||s.align?.streamTargetPx),samples.some(s=>s.stream?.lip?.[1]>diag?.firstImpactPoint?.y));
  check("unique event ids",Array.isArray(diag?.eventIds),new Set(diag?.eventIds??[]).size===(diag?.eventIds?.length??0));
  check("ledger equals field delivery",Number.isFinite(diag?.deliveredMl)&&Number.isFinite(samples.at(-1)?.B?.fieldDelivered),near(diag?.deliveredMl,samples.at(-1)?.B?.fieldDelivered,1e-9));
  check("receiver volume increase",Number.isFinite(trace.receiverBefore)&&Number.isFinite(samples.at(-1)?.receiverMl),near(samples.at(-1)?.receiverMl-trace.receiverBefore,diag?.deliveredMl,1e-9));
  check("source volume decrease",Number.isFinite(trace.sourceBefore)&&Number.isFinite(samples.at(-1)?.sourceMl),near(trace.sourceBefore-samples.at(-1)?.sourceMl,1,1e-9));
  check("no tracer before impact",before.length>0,before.every(s=>(s.B?.tracerTotal??s.B?.tracerSum??0)<=1e-12));
  check("no chloride before impact",before.length>0,before.every(s=>(s.B?.clTotal??0)<=1e-12));
  check("no product before impact",before.length>0,before.every(s=>(s.B?.extent??0)<=1e-12));
  const firstCl=trace.firstChloride;
  check("chloride onset timing",Number.isFinite(diag?.firstChlorideInsertionMs),near(diag?.firstChlorideInsertionMs,diag?.firstValidImpactMs,50));
  check("first chloride top rows",firstCl&&valid[0]?.B,firstCl?.cell?.[1]>=(valid[0]?.B?.wetTop??0)-2);
  const dumps=trace.dumps??[];
  const first=dumps.find(d=>d.fields?.cl?.some(v=>v>1e-12));
  if(first) {
    const f=first.fields,dx=2*f.radius/f.nx,dz=2*f.radius/f.nz,impact=f.impactLocal;
    const nearImpact=i=>Math.hypot((i%f.nx+.5-f.nx/2)*dx-impact.x,
      (Math.floor(i/(f.nx*f.ny))+.5-f.nz/2)*dz-impact.z)<=.003;
    const firstIndex=firstCl?.cell ? firstCl.cell[0]+f.nx*(firstCl.cell[1]+f.ny*firstCl.cell[2]) : null;
    check("chloride near impact",!!impact&&firstIndex!==null,firstIndex!==null&&nearImpact(firstIndex));
  }else check("chloride near impact",false,false);
  for(const [k,s] of samples.entries()) if(s.B) {
    const b=s.B,ag=b.agTotal??s.slice?.agT,cl=b.clTotal??s.slice?.clT,extent=b.extent;
    check(`silver conservation ${k}`,Number.isFinite(ag)&&Number.isFinite(extent),near(ag+extent,1.15,1e-9));
    check(`chloride conservation ${k}`,Number.isFinite(cl)&&Number.isFinite(extent)&&Number.isFinite(b.fieldDelivered),near(cl+extent,b.fieldDelivered,1e-9));
    check(`no source without reactants ${k}`,Number.isFinite(b.sourceTotal)&&Number.isFinite(ag)&&Number.isFinite(cl),
      b.sourceTotal<=1e-12||(ag+b.sourceTotal>0&&cl+b.sourceTotal>0));
  }
  for(const [k,d] of [...(trace.firstSource?[trace.firstSource]:[]),...dumps].entries()) if((d.fields??d).src) {
    const f=d.fields??d;let bad=0;
    for(let i=0;i<f.src.length;i++)if(f.src[i]>1e-12&&!(f.ag?.[i]+f.src[i]>0&&f.cl?.[i]+f.src[i]>0))bad++;
    check(`product source overlaps reactants ${k}`,!!f.ag&&!!f.cl,bad===0);
    if(d.fields&&f.mask&&f.ag&&Number.isFinite(d.B?.extent)) {
      let total=0;for(let i=0;i<f.ag.length;i++)if(f.mask[i])total+=f.ag[i];
      check(`silver conservation dump ${k}`,true,near(total+d.B.extent,1.15,1e-9));
    }
  }
  return {ok:failures.length===0,failures,unavailable:[...unavailable],checked:samples.length,dumps:dumps.length};
}
