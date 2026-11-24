import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {tableTex,imageTex,parseTsv,graphicxEdit,applyEdits,blockEdit,escapeTex} from '../public/insertions.js';
import {imageInfo,insertImage} from '../lib/image-insert.mjs';
import {compileDocument} from '../lib/compiler.mjs';
import {makePng} from './image-fixture.mjs';
const table={cells:[['Name','Wert'],['A&B','50%'],['Mehr\nZeilen','x_1']],alignments:['l','r'],header:true,borders:'grid',caption:'Messung #1',label:'tab:messung',floating:true};
test('table generation escapes plain text, supports multiline cells, alignment, headers and captions',()=>{
  const tex=tableTex(table);assert.match(tex,/\\begin\{tabular\}\{\|l\|r\|\}/);assert.ok(tex.includes('A\\&B & 50\\%'));assert.ok(tex.includes('\\shortstack[l]{Mehr \\\\ Zeilen}'));assert.ok(tex.includes('x\\_1'));assert.ok(tex.includes('\\textbf{Name}'));assert.ok(tex.includes('\\caption{Messung \\#1}'));assert.ok(tex.includes('\\label{tab:messung}'));
  assert.ok(escapeTex('\\{x} $~^').includes('\\textbackslash{}'));
  assert.throws(()=>tableTex({...table,alignments:['l']}));assert.throws(()=>tableTex({...table,label:'x}\\input{evil}'}));assert.throws(()=>tableTex({...table,cells:[['x'.repeat(501),'ok']]}));
});
test('spreadsheet paste preserves quoted tabs, line breaks, quotes and empty cells',()=>{
  assert.deepEqual(parseTsv('Name\tWert\r\n"A\tB"\t"Zeile 1\nZeile 2"\r\n"ein ""Zitat"""\t\r\n'),[['Name','Wert'],['A\tB','Zeile 1\nZeile 2'],['ein "Zitat"','']]);
  assert.deepEqual(parseTsv('a\tb\nc'),[['a','b'],['c','']]);assert.throws(()=>parseTsv('x\t'.repeat(13)));assert.throws(()=>parseTsv('a\n'.repeat(51)));assert.throws(()=>parseTsv('"unvollständig'));
});
test('image TeX validates width and filenames and graphicx is added without rewriting the document',()=>{
  const tex=imageTex({path:'Bilder/Meine Aufnahme_1.png',width:55,caption:'A&B'});assert.ok(tex.includes('width=0.55\\linewidth'));assert.ok(tex.includes('\\detokenize{Bilder/Meine Aufnahme_1.png}'));assert.ok(tex.includes('A\\&B'));
  for(const patch of [{path:'../bild.png'},{path:'bild.png}\\input{x}'},{width:101},{width:'70'}])assert.throws(()=>imageTex({path:'image.png',...patch}));
  const source='\\documentclass{article}\n% \\usepackage{graphicx}\n\\begin{document}\nText bleibt.\n\\end{document}\n';
  const edit=graphicxEdit(source);assert.ok(edit);const inserted=applyEdits(source,[edit]);assert.equal(inserted.replace(edit.text,''),source);assert.equal(graphicxEdit(inserted),null);
  assert.equal(graphicxEdit('\\RequirePackage[demo]{amsmath, graphicx}\n\\begin{document}'),null);assert.throws(()=>graphicxEdit('Kein Dokumentbeginn'));
  const block=blockEdit(source,source.indexOf('Text'),source.indexOf('Text'),'BLOCK');assert.equal(block.text,'BLOCK\n');assert.throws(()=>applyEdits('abc',[{start:0,end:2,text:''},{start:1,end:3,text:''}]));
});
test('image import rejects changed documents and damaged files before copying anything',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schriftenministerium-image-'));
  try{
    const files=path.join(root,'files');await fs.mkdir(files);const source='\\documentclass{article}\n\\begin{document}\nText\n\\end{document}\n';await fs.writeFile(path.join(files,'main.tex'),source);
    const body={document:'main.tex',expectedContent:source,start:source.indexOf('Text'),end:source.indexOf('Text'),addGraphicx:true,options:{width:50,caption:'',label:'',floating:false},file:{name:'Bild.png',base64:makePng().toString('base64')}};
    await assert.rejects(insertImage({projectDirectory:root,root:files,project:{main:'main.tex'},body:{...body,expectedContent:'stale'}}),{status:409});assert.deepEqual(await fs.readdir(files),['main.tex']);
    const damaged=makePng();damaged[damaged.length-1]^=1;assert.throws(()=>imageInfo(damaged));
    await assert.rejects(insertImage({projectDirectory:root,root:files,project:{main:'main.tex'},body:{...body,file:{name:'bad.png',base64:damaged.toString('base64')}}}));assert.deepEqual(await fs.readdir(files),['main.tex']);
    const result=await insertImage({projectDirectory:root,root:files,project:{main:'main.tex'},body});assert.ok(result.mainUpdated);assert.ok(result.content.includes('\\usepackage{graphicx}'));assert.equal(await fs.readFile(path.join(files,'main.tex'),'utf8'),result.content);assert.deepEqual(await fs.readFile(path.join(files,result.assetPath)),makePng());
    assert.equal(imageInfo(makePng()).width,64);assert.ok(result.assetPath.startsWith('images/'));
  }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'schriftenministerium-image-')));await fs.rm(root,{recursive:true,force:true});}
});
test('table and image output compile together with the real standard engine',{skip:process.env.SCHRIFTENMINISTERIUM_TEST_TEX!=='1'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schriftenministerium-objects-'));
  try{
    const snapshot=path.join(root,'source'),outputDir=path.join(root,'output');await fs.mkdir(snapshot);await fs.mkdir(outputDir);await fs.writeFile(path.join(snapshot,'test.png'),makePng());
    const source='\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n'+tableTex(table)+'\n'+imageTex({path:'test.png',width:30,caption:'Grün & Blau',label:'fig:test',floating:true})+'\n\\end{document}\n';await fs.writeFile(path.join(snapshot,'main.tex'),source);
    const result=await compileDocument({project:{compiler:'tectonic',main:'main.tex'},snapshot,outputDir,dataRoot:root});assert.equal(result.code,0,result.output);assert.equal((await fs.readFile(path.join(outputDir,'main.pdf'))).subarray(0,5).toString(),'%PDF-');
  }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'schriftenministerium-objects-')));await fs.rm(root,{recursive:true,force:true});}
});
