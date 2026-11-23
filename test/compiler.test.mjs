import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileDocument } from '../lib/compiler.mjs';

async function fixture(action) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'schriftenministerium-compiler-'));
  try {
    const snapshot=path.join(root,'source'), outputDir=path.join(root,'output'), bin=path.join(root,'bin');
    for(const dir of [snapshot,outputDir,bin]) await fs.mkdir(dir);
    await action({root,snapshot,outputDir,bin,tool:async name=>fs.writeFile(path.join(bin,name+(process.platform==='win32'?'.exe':'')),'')});
  } finally { assert.ok(root.startsWith(path.join(os.tmpdir(),'schriftenministerium-compiler-'))); await fs.rm(root,{recursive:true,force:true}); }
}
test('full compiler runs bibliography, glossary, index and settling passes without shell escape',()=>fixture(async f=>{
  for(const name of ['pdflatex','biber','makeglossaries','makeindex']) await f.tool(name);
  const calls=[];
  const result=await compileDocument({project:{compiler:'pdflatex',main:'main.tex',shellEscape:false},...f,dataRoot:f.root,config:{toolsDirectory:f.bin},runProcess:async(command,args,options)=>{
    calls.push({tool:path.basename(command).replace(/\.exe$/,''),args,cwd:options.cwd});
    if(calls.length===1) for(const [ext,content] of [['bcf','<bcf:datasource type="file">sources.bib</bcf:datasource>'],['glo','glossary'],['idx','index'],['nlo','nomenclature']]) await fs.writeFile(path.join(f.outputDir,'main.'+ext),content);
    return {code:0,output:'Success\n'};
  }});
  assert.equal(result.code,0);
  assert.deepEqual(calls.map(c=>c.tool),['pdflatex','biber','makeglossaries','makeindex','makeindex','pdflatex','pdflatex']);
  for(const call of calls.filter(c=>c.tool==='pdflatex')){assert.ok(call.args.includes('-no-shell-escape'));assert.ok(!call.args.includes('-shell-escape'));}
  assert.ok(calls.find(c=>c.tool==='biber').args.includes(f.outputDir));
  assert.ok(calls.some(c=>c.tool==='makeindex'&&c.args.includes('nomencl.ist')));
}));
test('BibTeX projects use the auxiliary-file directory and explicit shell opt-in',()=>fixture(async f=>{
  for(const name of ['xelatex','bibtex']) await f.tool(name);
  const calls=[];
  const result=await compileDocument({project:{compiler:'xelatex',main:'paper.tex',shellEscape:true},...f,dataRoot:f.root,config:{toolsDirectory:f.bin},runProcess:async(command,args,options)=>{
    calls.push({command,args,options});
    if(calls.length===1)await fs.writeFile(path.join(f.outputDir,'paper.aux'),'\\bibdata{references}');
    return {code:0,output:''};
  }});
  assert.equal(result.code,0);const bib=calls.find(c=>path.basename(c.command).startsWith('bibtex'));assert.ok(bib);assert.equal(bib.options.cwd,f.outputDir);
  assert.ok(calls[0].args.includes('-shell-escape'));
}));
test('failed engine stops before auxiliary tools and preserves the original diagnostic',()=>fixture(async f=>{
  await f.tool('lualatex');let calls=0;
  const result=await compileDocument({project:{compiler:'lualatex',main:'paper.tex'},...f,dataRoot:f.root,config:{toolsDirectory:f.bin},runProcess:async()=>{calls++;return {code:1,output:'Missing custom-class.cls'};}});
  assert.equal(result.code,1);assert.equal(calls,1);assert.match(result.output,/Missing custom-class/);
}));
