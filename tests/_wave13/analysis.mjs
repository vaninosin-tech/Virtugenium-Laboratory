export function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), t = (a.length - 1) * p, i = Math.floor(t);
  return a[i] + (a[Math.ceil(t)] - a[i]) * (t - i);
}
const sum = a => a.reduce((s, x) => s + x, 0);
const index = (x, y, z, nx, ny) => x + nx * (y + ny * z);

/** All arrays use the solver's x + nx*(y + ny*z) layout. Values are cell amounts. */
export function spatialMetrics(values, mask, { nx, ny, nz, radius = 1, height = 1, occupiedEpsilon = 1e-12 }) {
  if (values.length !== nx * ny * nz || mask.length !== values.length) throw new RangeError("field dimensions");
  const dx = 2 * radius / nx, dy = height / ny, dz = 2 * radius / nz;
  const wet = [], positive = [], vertical = Array(ny).fill(0), radial = Array(8).fill(0), radialCells = Array(8).fill(0);
  let total = 0, gradientTotal = 0, gradientMax = 0, gradientFaces = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = index(x, y, z, nx, ny); if (!mask[i]) continue;
    const v = Math.max(0, values[i]); wet.push(v); total += v; vertical[y] += v;
    if (v > occupiedEpsilon) positive.push(v);
    const r = Math.hypot((x + .5 - nx / 2) * dx, (z + .5 - nz / 2) * dz);
    const bin = Math.min(7, Math.floor(8 * r / radius)); radial[bin] += v; radialCells[bin]++;
    for (const [j, h] of [[x + 1 < nx ? i + 1 : -1, dx], [y + 1 < ny ? i + nx : -1, dy], [z + 1 < nz ? i + nx * ny : -1, dz]])
      if (j >= 0 && mask[j]) { const g = Math.abs(v - Math.max(0, values[j])) / h; gradientTotal += g; gradientMax = Math.max(gradientMax, g); gradientFaces++; }
  }
  const mean = total / (wet.length || 1), variance = sum(wet.map(v => (v - mean) ** 2)) / (wet.length || 1);
  const sorted = [...wet].sort((a, b) => a - b);
  let weighted = 0; for (let i = 0; i < sorted.length; i++) weighted += (i + 1) * sorted[i];
  const p95 = percentile(positive, .95) ?? 0;
  const regions = {};
  for (const fraction of [.1, .5]) {
    const threshold = p95 * fraction, included = new Uint8Array(values.length);
    if (p95 > 0) for (let i = 0; i < values.length; i++) included[i] = Number(!!mask[i] && values[i] >= threshold);
    const seen = new Uint8Array(values.length), sizes = []; let faces = 0, count = 0;
    for (let i = 0; i < values.length; i++) if (included[i]) {
      count++; const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      for (const [xx, yy, zz, area] of [[x-1,y,z,dy*dz],[x+1,y,z,dy*dz],[x,y-1,z,dx*dz],[x,y+1,z,dx*dz],[x,y,z-1,dx*dy],[x,y,z+1,dx*dy]])
        if (xx < 0 || xx >= nx || yy < 0 || yy >= ny || zz < 0 || zz >= nz || !included[index(xx,yy,zz,nx,ny)]) faces += area;
      if (seen[i]) continue;
      const q = [i]; seen[i] = 1; let size = 0;
      for (let head = 0; head < q.length; head++) {
        const c = q[head], cx = c % nx, cy = Math.floor(c / nx) % ny, cz = Math.floor(c / (nx * ny)); size++;
        for (let oz = -1; oz <= 1; oz++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const xx = cx+ox, yy = cy+oy, zz = cz+oz;
          if ((ox || oy || oz) && xx >= 0 && xx < nx && yy >= 0 && yy < ny && zz >= 0 && zz < nz) {
            const j = index(xx,yy,zz,nx,ny); if (included[j] && !seen[j]) { seen[j] = 1; q.push(j); }
          }
        }
      }
      sizes.push(size);
    }
    regions[String(fraction)] = { threshold, occupiedFraction: count / (wet.length || 1), components: sizes.length,
      sizes: sizes.sort((a,b) => b-a), surfaceVolumeRatio: count ? faces / (count * dx * dy * dz) : 0 };
  }
  return { wetCells: wet.length, mass: total, mean, variance, cv: mean ? Math.sqrt(variance) / mean : 0,
    occupiedFraction: positive.length / (wet.length || 1), p95, p90p10: positive.length && percentile(positive,.1) > 0 ? percentile(positive,.9)/percentile(positive,.1) : null,
    gini: total ? 2*weighted/(wet.length*total) - (wet.length+1)/wet.length : 0,
    meanGradient: gradientTotal / (gradientFaces || 1), maxGradient: gradientMax,
    verticalProfile: vertical, radialProfile: radial.map((v,i) => v / (radialCells[i] || 1)), regions };
}

export function processMetrics(snapshot, previous = null) {
  const { nx, ny, nz, mask, tracer, ag, cl, src, fine, flow, radius, height, bottom = 0, level } = snapshot;
  const n = nx*ny*nz, cell = i => [i%nx, Math.floor(i/nx)%ny, Math.floor(i/(nx*ny))];
  if ([mask,tracer,ag,cl,src,fine].some(a => !a || a.length !== n)) throw new RangeError("snapshot fields");
  let tracerFront = null, velocityFront = null, source = 0, overlap = 0;
  let cx = 0, cy = 0, cz = 0, mass = 0, mx = 0, my = 0, mz = 0, bottomRadial = 0, bottomN = 0;
  let downFlux = 0, inwardFlux = 0, interfaceArea = 0, agInterfaceFlux = 0, clInterfaceFlux = 0, interfaceFaces = 0, verticalSignChanges = 0, circulation = 0;
  const jetDownward=Array(ny).fill(0),jetRadial=Array(ny).fill(0),jetCells=Array(ny).fill(0);
  let tracerMass=0,tracerRadialMoment=0;
  const dx=2*radius/nx, dy=height/ny, dz=2*radius/nz;
  const ix = snapshot.impactLocal?.x ?? 0, iz = snapshot.impactLocal?.z ?? 0;
  for (let i=0;i<n;i++) if (mask[i]) {
    const [x,y,z]=cell(i), px=(x+.5-nx/2)*dx, pz=(z+.5-nz/2)*dz, py=bottom+(y+.5)*dy;
    const r=Math.hypot(px-ix,pz-iz), v=Math.max(0,fine[i]); mass+=v; cx+=v*px; cy+=v*py; cz+=v*pz;
    if (tracer[i]>1e-9) tracerFront=Math.min(tracerFront??Infinity,py);
    tracerMass+=Math.max(0,tracer[i]);tracerRadialMoment+=Math.max(0,tracer[i])*r*r;
    source+=Math.max(0,src[i]); overlap+=Math.min(Math.max(0,ag[i]),Math.max(0,cl[i]));
    if (flow?.length === n*3) {
      const ux=flow[3*i], uy=flow[3*i+1], uz=flow[3*i+2];
      if(r<.003){jetDownward[y]+=Math.max(0,-uy);jetRadial[y]+=Math.hypot(ux,uz);jetCells[y]++;}
      if (r<.003 && uy<-.001) { velocityFront=Math.min(velocityFront??Infinity,py); downFlux+=-uy*dx*dz; }
      if (y<2) { bottomRadial+=Math.hypot(ux,uz); bottomN++; }
      if (r>=.002 && r<.0035 && py>level-.015 && py<level) inwardFlux+=Math.max(0,-(ux*(px-ix)+uz*(pz-iz))/Math.max(r,1e-9))*dy*(dx+dz)/2;
      if (x+1<nx && mask[i+1] && flow[3*(i+1)+1]*uy<0) verticalSignChanges++;
      if (x+1<nx && mask[i+1]) circulation+=(flow[3*(i+1)+1]-uy)*dx*dz;
    }
    for (const [j,area,axis] of [[x+1<nx?i+1:-1,dy*dz,0],[y+1<ny?i+nx:-1,dx*dz,1],[z+1<nz?i+nx*ny:-1,dx*dy,2]]) if (j>=0 && mask[j] && (ag[i]-cl[i])*(ag[j]-cl[j])<0) {
      interfaceFaces++;interfaceArea+=area;
      if(flow?.length===n*3){const u=(flow[3*i+axis]+flow[3*j+axis])/2,from=u>=0?i:j;
        agInterfaceFlux+=Math.abs(u)*ag[from]*area/(dx*dy*dz);
        clInterfaceFlux+=Math.abs(u)*cl[from]*area/(dx*dy*dz);}
    }
  }
  if (mass) { cx/=mass;cy/=mass;cz/=mass; for(let i=0;i<n;i++) if(mask[i]) { const [x,y,z]=cell(i), v=Math.max(0,fine[i]); mx+=v*((x+.5-nx/2)*dx-cx)**2; my+=v*(bottom+(y+.5)*dy-cy)**2; mz+=v*((z+.5-nz/2)*dz-cz)**2; } mx/=mass;my/=mass;mz/=mass; }
  return { penetration: { tracerDepth: tracerFront===null?null:level-tracerFront, downwardVelocityDepth: velocityFront===null?null:level-velocityFront, downFlux,
    downwardVelocityProfile:jetDownward.map((v,y)=>v/(jetCells[y]||1)),radialVelocityProfile:jetRadial.map((v,y)=>v/(jetCells[y]||1)),
    tracerRadialRms:tracerMass?Math.sqrt(tracerRadialMoment/tracerMass):null },
    entrainment: { inwardFluxEstimate: inwardFlux, tracerDilution: (()=>{const p=percentile(Array.from(tracer).filter(v=>v>0),.95);return p?Array.from(tracer).filter(v=>v>0&&v<p/2).reduce((s,v)=>s+v,0)/sum(Array.from(tracer)):null})() },
    reactantTransport: { interfaceArea, interfaceFaces, agAdvectiveFluxEstimate:agInterfaceFlux,
      clAdvectiveFluxEstimate:clInterfaceFlux,dissolvedOverlap: overlap },
    precipitation: { source, sourceRatePerSecond: source/.05,
      contactConsumptionFraction: source+overlap>0 ? source/(source+overlap) : null },
    productTransport: { mass, centroid: [cx,cy,cz], moments: [mx,my,mz], centroidDisplacement: previous?.productTransport?.mass ? Math.hypot(cx-previous.productTransport.centroid[0],cy-previous.productTransport.centroid[1],cz-previous.productTransport.centroid[2]) : null },
    flow: { bottomRadialSpeed: bottomRadial/(bottomN||1), verticalSignChanges, circulationProxy: circulation } };
}
