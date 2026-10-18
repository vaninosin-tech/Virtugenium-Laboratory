import * as THREE from "three";

export interface FlocPoint { x: number; y: number; z: number; mass: number; radius?: number }
export interface FlocEdge { a: number; b: number }

/** Redistributes each conserved aggregate voxel into eight subvoxels. Nodes and links
 * shape that voxel's mass; they never contribute a second mass term. */
export class SilverFlocReconstruction {
  readonly texture: THREE.Data3DTexture;
  readonly pixels: Float32Array;
  private readonly bins: number[][];
  private readonly scores: Float64Array;
  private readonly weights = new Float64Array(8);
  private nodeRadii = new Float64Array(0);
  private nodeStrengths = new Float64Array(0);
  private readonly width: number;
  private readonly depth: number;
  constructor(readonly nx: number, readonly ny: number, readonly nz: number) {
    this.width = nx * 2; this.depth = nz * 2;
    this.pixels = new Float32Array(this.width * ny * 2 * this.depth * 4);
    this.bins = Array.from({ length: nx * ny * nz }, () => []);
    this.scores = new Float64Array(nx * ny * nz * 4);
    this.texture = new THREE.Data3DTexture(this.pixels, this.width, ny * 2, this.depth);
    this.texture.format = THREE.RGBAFormat; this.texture.type = THREE.FloatType;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = this.texture.wrapR = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1; this.texture.needsUpdate = true;
  }

  update(coarse: ArrayLike<number>, nodes: readonly FlocPoint[], links: readonly FlocEdge[],
    radius: number, bottom: number, height: number, nodeRadius: (mass: number) => number) {
    const { nx, ny, nz, bins, pixels } = this;
    for (const bin of bins) bin.length = 0;
    if (this.nodeRadii.length < nodes.length) {
      this.nodeRadii = new Float64Array(nodes.length);
      this.nodeStrengths = new Float64Array(nodes.length);
    }
    for (let i=0;i<nodes.length;i++) {
      this.nodeRadii[i] = Math.max(nodes[i].radius ?? nodeRadius(nodes[i].mass),1e-6);
      this.nodeStrengths[i] = Math.sqrt(Math.max(0,nodes[i].mass));
    }
    // A cell list bounds the candidate set at each subvoxel. Link midpoints are
    // indexed separately; a negative index distinguishes them from physical nodes.
    const add = (id: number, x: number, y: number, z: number, reach: number, strength: number) => {
      const gx = (x / radius + 1) * nx / 2, gy = (y - bottom) * ny / height, gz = (z / radius + 1) * nz / 2;
      const rx = reach * nx / (2 * radius) + 1, ry = reach * ny / height + 1, rz = reach * nz / (2 * radius) + 1;
      for (let iz = Math.max(0, Math.floor(gz - rz)); iz <= Math.min(nz - 1, Math.ceil(gz + rz)); iz++)
        for (let iy = Math.max(0, Math.floor(gy - ry)); iy <= Math.min(ny - 1, Math.ceil(gy + ry)); iy++)
          for (let ix = Math.max(0, Math.floor(gx - rx)); ix <= Math.min(nx - 1, Math.ceil(gx + rx)); ix++) {
            const cell=ix + nx * (iy + ny * iz),bin=bins[cell];
            const dx=(ix+.5-gx)*2*radius/nx,dy=(iy+.5-gy)*height/ny,dz=(iz+.5-gz)*2*radius/nz;
            const score=strength/(1+(dx*dx+dy*dy+dz*dz)/(reach*reach*.25));
            if(bin.length<4){this.scores[cell*4+bin.length]=score;bin.push(id);}
            else {let weakest=0;for(let k=1;k<4;k++)if(this.scores[cell*4+k]<this.scores[cell*4+weakest])weakest=k;
              if(score>this.scores[cell*4+weakest]){bin[weakest]=id;this.scores[cell*4+weakest]=score;}}
          }
    };
    nodes.forEach((node, i) => add(i, node.x, node.y, node.z, this.nodeRadii[i] * 1.8,this.nodeStrengths[i]));
    links.forEach((link, i) => {
      const a = nodes[link.a], b = nodes[link.b]; if (!a || !b) return;
      const length = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      add(-i - 1, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2,
        length / 2 + Math.min(this.nodeRadii[link.a], this.nodeRadii[link.b]),
        .3*Math.min(this.nodeStrengths[link.a],this.nodeStrengths[link.b]));
    });
    const weights = this.weights;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const cell = x + nx * (y + ny * z), source = cell * 4, density = Math.max(0, coarse[source] ?? 0);
      if (density === 0) {
        for(let sz=0;sz<2;sz++)for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++){
          const destination=4*((2*x+sx)+this.width*((2*y+sy)+ny*2*(2*z+sz)));
          pixels.fill(0,destination,destination+4);
        }
        continue;
      }
      const candidates = bins[cell]; let sum = 0;
      for (let sz = 0; sz < 2; sz++) for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const sub = sx + 2 * (sy + 2 * sz);
        const px = ((x + (sx + .5) / 2) / nx * 2 - 1) * radius;
        const py = bottom + (y + (sy + .5) / 2) / ny * height;
        const pz = ((z + (sz + .5) / 2) / nz * 2 - 1) * radius;
        let weight = .04;
        for (const id of candidates) {
          if (id >= 0) {
            const n = nodes[id], r = this.nodeRadii[id];
            const d2 = ((px - n.x) ** 2 + (py - n.y) ** 2 + (pz - n.z) ** 2) / (r * r);
            if (d2 < 9) weight += this.nodeStrengths[id] * Math.exp(-1.6 * d2);
          } else {
            const edge = links[-id - 1], a = nodes[edge.a], b = nodes[edge.b];
            const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
            const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy + (pz - a.z) * vz) / Math.max(1e-12, vx * vx + vy * vy + vz * vz)));
            const r = Math.max(1e-6, .55 * Math.min(this.nodeRadii[edge.a], this.nodeRadii[edge.b]));
            const d2 = ((px - a.x - t * vx) ** 2 + (py - a.y - t * vy) ** 2 + (pz - a.z - t * vz) ** 2) / (r * r);
            if (d2 < 9) weight += .3 * Math.min(this.nodeStrengths[edge.a],this.nodeStrengths[edge.b]) * Math.exp(-1.6 * d2);
          }
        }
        weights[sub] = weight; sum += weight;
      }
      for (let sz = 0; sz < 2; sz++) for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const sub = sx + 2 * (sy + 2 * sz);
        const destination = 4 * ((2 * x + sx) + this.width * ((2 * y + sy) + ny * 2 * (2 * z + sz)));
        pixels[destination] = density * 8 * weights[sub] / sum;
        pixels[destination + 1] = coarse[source + 1] ?? 0;
        pixels[destination + 2] = coarse[source + 2] ?? 0;
        pixels[destination + 3] = coarse[source + 3] ?? 0;
      }
    }
    this.texture.needsUpdate = true;
  }
  dispose() { this.texture.dispose(); }
}
