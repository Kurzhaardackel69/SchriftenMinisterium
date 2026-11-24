import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError,safePath,crc32} from './files.mjs';
import {imageTex,graphicxEdit,blockEdit,applyEdits} from '../public/insertions.js';
const normalized=text=>text.replace(/\r\n?/g,'\n');
const input=action=>{try{return action();}catch(error){throw new AppError(error.message);}};
export function imageInfo(data) {
  if(!data.length||data.length>10*1024*1024)throw new AppError('Ein Bild darf maximal 10 MB groß sein.');
  let width,height,extension;
  if(data.length>=33&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&data.toString('ascii',12,16)==='IHDR'){
    width=data.readUInt32BE(16);height=data.readUInt32BE(20);extension='png';
    let offset=8,ended=false,pixels=false;
    while(offset+12<=data.length){const length=data.readUInt32BE(offset),end=offset+12+length;if(end>data.length||crc32(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))throw new AppError('Die PNG-Datei ist beschädigt.');const type=data.toString('ascii',offset+4,offset+8);if(offset===8&&length!==13)throw new AppError('Ungültiger PNG-Kopf.');if(type==='IDAT')pixels=true;offset=end;if(type==='IEND'){ended=length===0;break;}}
    if(!ended||!pixels||offset!==data.length)throw new AppError('Die PNG-Datei ist unvollständig.');
  }else if(data.length>=4&&data[0]===255&&data[1]===216){
    let i=2;
    while(i<data.length){
      if(data[i++]!==255)break;while(data[i]===255)i++;const marker=data[i++];
      if(marker===217||marker===218)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      if(i+2>data.length)break;const length=data.readUInt16BE(i);if(length<2||i+length>data.length)break;
      if(marker>=192&&marker<=207&&![196,200,204].includes(marker)&&length>=8){height=data.readUInt16BE(i+3);width=data.readUInt16BE(i+5);extension='jpg';break;}i+=length;
    }
  }
  if(!extension||!width||!height)throw new AppError('Bitte ein gültiges PNG- oder JPEG-Bild wählen.');
  if(extension==='jpg'){const scan=data.indexOf(Buffer.from([255,218])),end=data.lastIndexOf(Buffer.from([255,217]));if(scan<0||end<=scan)throw new AppError('Die JPEG-Datei ist unvollständig.');}
  if(width>16000||height>16000||width*height>40000000)throw new AppError('Das Bild ist zu hoch aufgelöst (maximal 40 Megapixel und 16000 Pixel je Seite).');
  return {width,height,extension};
}
export async function insertImage({projectDirectory,root,project,body}) {
  if(typeof body.document!=='string'||!body.document.endsWith('.tex')||typeof body.expectedContent!=='string'||Buffer.byteLength(body.expectedContent)>2*1024*1024||typeof body.addGraphicx!=='boolean')throw new AppError('Ungültige Dokumentauswahl.');
  const documentPath=await safePath(root,body.document),original=await fs.readFile(documentPath),source=normalized(original.toString('utf8'));
  if(source!==body.expectedContent)throw new AppError('Die Datei wurde inzwischen geändert. Bitte neu öffnen und das Bild erneut einfügen.',409);
  if(!body.options||typeof body.options!=='object')throw new AppError('Die Bildeinstellungen fehlen.');
  let assetPath,assetData,newAsset=false;
  if(body.file&&!body.existingPath){
    if(typeof body.file.name!=='string'||body.file.name.length>240||typeof body.file.base64!=='string'||body.file.base64.length>14*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.file.base64))throw new AppError('Ungültige Bilddatei.');
    assetData=Buffer.from(body.file.base64,'base64');const info=imageInfo(assetData);
    const stem=path.basename(body.file.name).replace(/\.[^.]*$/,'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'bild';
    assetPath=`images/${stem}-${randomUUID().slice(0,8)}.${info.extension}`;newAsset=true;
  }else if(typeof body.existingPath==='string'&&!body.file){
    assetPath=body.existingPath;const file=await safePath(root,assetPath),stat=await fs.stat(file);
    if(stat.size>10*1024*1024)throw new AppError('Das Bild darf maximal 10 MB groß sein.');assetData=await fs.readFile(file);imageInfo(assetData);
  }else throw new AppError('Bitte ein neues oder ein vorhandenes Bild auswählen.');
  const snippet=input(()=>imageTex({...body.options,path:assetPath}));
  const edits=[input(()=>blockEdit(source,body.start,body.end,snippet))];
  const writes=[];let mainUpdated=false;
  if(body.addGraphicx){
    if(!project.main)throw new AppError('Bitte zuerst eine Hauptdatei auswählen.');
    if(project.main===body.document){const edit=input(()=>graphicxEdit(source));if(edit){edits.push(edit);mainUpdated=true;}}
    else{
      const file=await safePath(root,project.main),before=await fs.readFile(file),text=normalized(before.toString('utf8')),edit=input(()=>graphicxEdit(text));
      if(edit){const after=input(()=>applyEdits(text,[edit]));writes.push({file,before,after:Buffer.from(before.includes(Buffer.from('\r\n'))?after.replace(/\n/g,'\r\n'):after)});mainUpdated=true;}
    }
  }
  const content=input(()=>applyEdits(source,edits));if(Buffer.byteLength(content)>2*1024*1024)throw new AppError('Die bearbeitete Datei wäre zu groß.');
  writes.push({file:documentPath,before:original,after:Buffer.from(original.includes(Buffer.from('\r\n'))?content.replace(/\n/g,'\r\n'):content)});
  const destination=await safePath(root,assetPath);let created=false;const committed=[];
  const atomicWrite=async(file,bytes)=>{const temporary=path.join(projectDirectory,`insert-${randomUUID()}.tmp`);try{await fs.writeFile(temporary,bytes);await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}};
  try{
    if(newAsset){await fs.mkdir(path.dirname(destination),{recursive:true});const handle=await fs.open(destination,'wx');created=true;try{await handle.writeFile(assetData);}finally{await handle.close();}}
    for(const item of writes){await atomicWrite(item.file,item.after);committed.push(item);}
  }catch(error){
    for(const item of committed.reverse())await atomicWrite(item.file,item.before);
    if(created)await fs.unlink(destination);throw error;
  }
  return {content,edits,assetPath,mainUpdated};
}
