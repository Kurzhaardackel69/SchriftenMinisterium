import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { run } from '../lib/process.mjs';

const root = path.resolve(import.meta.dirname, '..'), runtime = path.join(root, 'desktop/runtime'), cache = path.join(root, '.build-cache/tectonic');
await fs.mkdir(runtime, { recursive: true }); await fs.mkdir(cache, { recursive: true });
const zipPath = path.join(cache, 'tectonic-0.17.0.zip');
let bytes = await fs.readFile(zipPath).catch(() => null);
if (!bytes) {
  const response = await fetch('https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-x86_64-pc-windows-msvc.zip');
  if (!response.ok) throw new Error(`Compiler-Download: ${response.status}`); bytes = Buffer.from(await response.arrayBuffer()); await fs.writeFile(zipPath, bytes);
}
if (createHash('sha256').update(bytes).digest('hex') !== 'f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f') throw new Error('Compiler-Prüfsumme stimmt nicht.');
const extracted = await run('tar.exe', ['-xf', zipPath, '-C', runtime]); if (extracted.code) throw new Error(extracted.output);
const licenseResponse = await fetch('https://raw.githubusercontent.com/tectonic-typesetting/tectonic/tectonic%400.17.0/LICENSE');
if (!licenseResponse.ok) throw new Error('Compiler-Lizenz konnte nicht geladen werden.');
await fs.writeFile(path.join(runtime, 'TECTONIC-LICENSE.txt'), await licenseResponse.text());
await fs.writeFile(path.join(runtime, 'README.txt'), 'Tectonic 0.17.0, offizielles unverändertes Windows-x64-Programm.\nQuelle: https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0\nIntegrität: SHA-256 f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f\nDie Tectonic-Lizenz und alle im offiziellen Archiv enthaltenen Hinweise bleiben erhalten.\n');

// Code-native multi-resolution Windows icon, matching the existing document mark.
const distance = (x,y,a,b,c,d) => { const q = Math.max(0, Math.min(1, ((x-a)*(c-a)+(y-b)*(d-b))/((c-a)**2+(d-b)**2))); return Math.hypot(x-a-q*(c-a),y-b-q*(d-b)); };
const icons = [];
for (const size of [16,32,48,256]) {
  const stride = Math.ceil(size/32)*4, dib = Buffer.alloc(40+size*size*4+stride*size);
  dib.writeUInt32LE(40); dib.writeInt32LE(size,4); dib.writeInt32LE(size*2,8); dib.writeUInt16LE(1,12); dib.writeUInt16LE(32,14); dib.writeUInt32LE(size*size*4,20);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const sx=(x+.5)*64/size, sy=(y+.5)*64/size, rounded=Math.hypot(Math.max(0,Math.abs(sx-32)-16),Math.max(0,Math.abs(sy-32)-16))<=16;
    const lines=[[19,12,38,12],[38,12,47,21],[47,21,47,52],[47,52,19,52],[19,52,19,12],[38,12,38,22],[38,22,47,22],[25,42,25,29],[25,29,33,38],[33,38,41,29],[41,29,41,42]];
    const white=rounded && lines.some(line=>distance(sx,sy,...line)<=1.6), at=40+((size-1-y)*size+x)*4;
    dib[at]=white?255:100; dib[at+1]=white?255:125; dib[at+2]=white?255:20; dib[at+3]=rounded?255:0;
    if(!rounded)dib[40+size*size*4+(size-1-y)*stride+(x>>3)]|=0x80>>(x%8);
  }
  icons.push({size,dib});
}
const header = Buffer.alloc(6+icons.length*16); header.writeUInt16LE(1,2); header.writeUInt16LE(icons.length,4); let offset=header.length;
icons.forEach(({size,dib},i)=>{const at=6+i*16;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(dib.length,at+8);header.writeUInt32LE(offset,at+12);offset+=dib.length;});
await fs.mkdir(path.join(root,'desktop/assets'),{recursive:true}); await fs.writeFile(path.join(root,'desktop/assets/icon.ico'),Buffer.concat([header,...icons.map(icon=>icon.dib)]));
console.log('Desktop-Icon und offizieller PDF-Compiler vorbereitet.');
