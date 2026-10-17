import { performance } from 'node:perf_hooks';
import type { TubeSilverField } from '../../../src/scenes/laboratory/lib/tubeSilverField';

/** Diagnostic only: conservative 2x scalar on a parent-cell mask, with trilinearly sampled coarse flow. */
export class FineExperiment {
  readonly nx:number; readonly ny:number; readonly nz:number;
  readonly values:Float64Array; private readonly next:Float64Array;
  private readonly wet:Uint8Array; private readonly flux:Float64Array;private readonly outgoing:Float64Array;
  readonly timings:number[]=[];
  constructor(readonly field:TubeSilverField){const m=field.mask;this.nx=m.nx*2;this.ny=m.ny*2;this.nz=m.nz*2;
    const n=this.nx*this.ny*this.nz;this.values=new Float64Array(n);this.next=new Float64Array(n);
    this.wet=new Uint8Array(n);this.flux=new Float64Array(n*3);this.outgoing=new Float64Array(n);
  }
  private parent(x:number,y:number,z:number){const m=this.field.mask;return (x>>1)+m.nx*((y>>1)+m.ny*(z>>1));}
  private sample(x:number,y:number,z:number,axis:number){
    const m=this.field.mask,v=this.field.solver.flow;let q=0,sum=0;
    const X=x*.5-.25,Y=y*.5-.25,Z=z*.5-.25;
    const lo=[Math.floor(X),Math.floor(Y),Math.floor(Z)],frac=[X-lo[0],Y-lo[1],Z-lo[2]];
    for(let dz=0;dz<=1;dz++)for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){
      const ix=lo[0]+dx,iy=lo[1]+dy,iz=lo[2]+dz;if(ix<0||iy<0||iz<0||ix>=m.nx||iy>=m.ny||iz>=m.nz)continue;
      const i=ix+m.nx*(iy+m.ny*iz);if(!m.data[i])continue;
      const w=(dx?frac[0]:1-frac[0])*(dy?frac[1]:1-frac[1])*(dz?frac[2]:1-frac[2]);q+=v[i*3+axis]*w;sum+=w;
    }
    return sum?q/sum:0;
  }
  step(source:Float64Array){
    const start=performance.now(),m=this.field.mask,nx=this.nx,ny=this.ny,nz=this.nz,strides=[1,nx,nx*ny];
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const i=x+nx*(y+ny*z),p=this.parent(x,y,z);this.wet[i]=m.data[p];
    }
    const spacing=[m.radius/m.nx,m.height/m.ny/2,m.radius/m.nz],dt=.05/4;
    for(let sub=0;sub<4;sub++){
      this.next.set(this.values);this.flux.fill(0);this.outgoing.fill(0);
      for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
        const i=x+nx*(y+ny*z);if(!this.wet[i])continue;
        for(let axis=0;axis<3;axis++){
          if((axis===0&&x+1===nx)||(axis===1&&y+1===ny)||(axis===2&&z+1===nz))continue;
          const j=i+strides[axis];if(!this.wet[j])continue;
          const u=this.sample(x+(axis===0?.5:0),y+(axis===1?.5:0),z+(axis===2?.5:0),axis);
          const flux=u*dt/spacing[axis]*(u>=0?this.values[i]:this.values[j]);
          this.flux[3*i+axis]=flux;this.outgoing[flux>=0?i:j]+=Math.abs(flux);
        }
      }
      for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
        const i=x+nx*(y+ny*z);if(!this.wet[i])continue;
        for(let axis=0;axis<3;axis++){
          if((axis===0&&x+1===nx)||(axis===1&&y+1===ny)||(axis===2&&z+1===nz))continue;
          const j=i+strides[axis];if(!this.wet[j])continue;
          const raw=this.flux[3*i+axis],donor=raw>=0?i:j;
          const amount=raw*Math.min(1,this.values[donor]/Math.max(1e-30,this.outgoing[donor]));
          this.next[i]-=amount;this.next[j]+=amount;
        }
      }
      this.values.set(this.next);
    }
    // Production transports old suspension, then adds fresh source, then transfers smoke to tint.
    const decay=Math.exp(-.05*.03);
    for(let i=0;i<this.values.length;i++)this.values[i]=(this.values[i]+source[this.parent(i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny)))]/8)*decay;
    this.timings.push(performance.now()-start);
  }
  coarse(){const m=this.field.mask,out=new Float64Array(m.data.length),nx=this.nx,ny=this.ny;
    for(let z=0;z<this.nz;z++)for(let y=0;y<this.ny;y++)for(let x=0;x<nx;x++)out[this.parent(x,y,z)]+=this.values[x+nx*(y+ny*z)];
    return out;
  }
  mass(){return this.values.reduce((a,b)=>a+b,0);}
}
