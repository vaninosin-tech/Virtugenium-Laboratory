// Image-only diagnostic; does not affect the renderer or simulation.
export function luminanceContrast(rgba, width, height) {
  const lum=(x,y)=>{const i=4*(y*width+x);return (.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2])/255;};
  const mean=(x0,x1,y0,y1)=>{let sum=0,n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){sum+=lum(x,y);n++;}return n?sum/n:0;};
  const core=mean(Math.floor(width*.4),Math.ceil(width*.6),Math.floor(height*.35),Math.ceil(height*.65));
  const background=(mean(0,Math.ceil(width*.1),0,height)+mean(Math.floor(width*.9),width,0,height))/2;
  return {core,background,contrast:core-background};
}

function fft(re,im) {
  const n=re.length;
  for(let i=1,j=0;i<n;i++) {let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
  for(let len=2;len<=n;len*=2){const angle=-2*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle);
    for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){
      const a=i+j,b=a+len/2,tr=cr*re[b]-ci*im[b],ti=cr*im[b]+ci*re[b];
      re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;[cr,ci]=[cr*wr-ci*wi,cr*wi+ci*wr];
    }}
  }
}

/** Strongest high-pass 2D Fourier bin divided by broadband high-pass energy. */
export function sedimentMoireMetric(rgba,width,height,{size=64,region=[0,1,.72,.95],targetCycles=null}={}) {
  if(width<2||height<2||size<2||(size&(size-1)))throw new RangeError("image or FFT size");
  const grid=Array.from({length:size},()=>new Float64Array(size)),imag=Array.from({length:size},()=>new Float64Array(size));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=Math.min(width-1,Math.floor((region[0]+(region[1]-region[0])*(x+.5)/size)*width));
    const py=Math.min(height-1,Math.floor((region[2]+(region[3]-region[2])*(y+.5)/size)*height));
    const i=4*(py*width+px),l=(.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2])/255;
    grid[y][x]=l*(.5-.5*Math.cos(2*Math.PI*x/(size-1)))*(.5-.5*Math.cos(2*Math.PI*y/(size-1)));
  }
  for(let y=0;y<size;y++)fft(grid[y],imag[y]);
  for(let x=0;x<size;x++){const r=new Float64Array(size),im=new Float64Array(size);for(let y=0;y<size;y++){r[y]=grid[y][x];im[y]=imag[y][x];}fft(r,im);for(let y=0;y<size;y++){grid[y][x]=r[y];imag[y][x]=im[y];}}
  let peak=0,energy=0,bins=0,targetEnergy=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const fx=Math.min(x,size-x),fy=Math.min(y,size-y),f=Math.hypot(fx,fy);
    if(f<5||f>size*.42)continue;
    const power=grid[y][x]**2+imag[y][x]**2;peak=Math.max(peak,power);energy+=power;bins++;
    if(targetCycles&&Math.abs(fx-targetCycles[0])<=1.5&&Math.abs(fy-targetCycles[1])<=1.5)targetEnergy+=power;
  }
  return {peakToBroadband:energy?peak/energy:0,targetToBroadband:energy?targetEnergy/energy:0,peak,energy,bins,size};
}
