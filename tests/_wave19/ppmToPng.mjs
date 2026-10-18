import {readFileSync,writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
function chunk(name,data){const type=Buffer.from(name),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);let c=0xffffffff;for(const b of Buffer.concat([type,data]))c=crcTable[(c^b)&255]^(c>>>8);crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([len,type,data,crc]);}
for(const t of [3,6,9,14,22]){
 const input=readFileSync(`docs/night/wave19s2/sheet_${t}s.ppm`),header=/^P6\n(\d+) (\d+)\n255\n/.exec(input.toString('ascii',0,40));if(!header)throw new Error('PPM header');
 const width=Number(header[1]),height=Number(header[2]),pixels=input.subarray(header[0].length);if(pixels.length!==width*height*3)throw new Error('PPM dimensions');
 const scan=Buffer.alloc(height*(width*3+1));for(let y=0;y<height;y++)pixels.copy(scan,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 writeFileSync(`docs/night/wave19s2/sheet_${t}s.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]));
}
