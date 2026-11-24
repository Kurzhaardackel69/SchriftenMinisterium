import {deflateSync} from 'node:zlib';
import {crc32} from '../lib/files.mjs';
export function makePng(width=64,height=32){
  const chunk=(name,content)=>{const type=Buffer.from(name),header=Buffer.alloc(4),crc=Buffer.alloc(4);header.writeUInt32BE(content.length);crc.writeUInt32BE(crc32(Buffer.concat([type,content])));return Buffer.concat([header,type,content,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*(width*3+1)+1+x*3;pixels[at]=35+Math.floor(x/width*80);pixels[at+1]=110+Math.floor(y/height*60);pixels[at+2]=90;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
