import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {makePng} from './image-fixture.mjs';
test('image API copies assets, updates a separate main preamble once and rejects stale or invalid requests',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schriftenministerium-image-api-'));let server;
  try{
    server=await createApp({dataRoot:root,seed:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const request=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,headers:{'X-SchriftenMinisterium-Request':'1','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
    const project=(await request('/api/projects','POST',{name:'Bildertest',template:'blank'})).data,url=`/api/projects/${project.id}`;
    const main='\\documentclass{article}\r\n\\begin{document}\r\n\\input{kapitel}\r\n\\end{document}\r\n',chapter='\\section{Kapitel}\nUnverändert davor und danach.\n';
    await request(url+'/file','PUT',{path:'main.tex',content:main});await request(url+'/file','POST',{path:'kapitel.tex',content:chapter});
    const body={document:'kapitel.tex',expectedContent:chapter,start:chapter.indexOf('Unverändert'),end:chapter.indexOf('Unverändert'),addGraphicx:true,options:{width:45,caption:'Bild & Text',label:'',floating:false},file:{name:'Mein Bild.png',base64:makePng().toString('base64')}};
    assert.equal((await fetch(base+url+'/insert-image',{method:'POST'})).status,403);
    assert.equal((await request(url+'/insert-image','POST',{...body,expectedContent:'veraltet'})).status,409);
    assert.equal((await request(url+'/insert-image','POST',{...body,options:{...body.options,width:120}})).status,400);
    assert.equal((await request(url+'/file?path=main.tex')).data.content,main);
    const first=await request(url+'/insert-image','POST',body);assert.equal(first.status,200,first.data.error);assert.equal(first.data.mainUpdated,true);assert.ok(first.data.content.endsWith(chapter.slice(body.start)));
    const mainAfter=(await request(url+'/file?path=main.tex')).data.content;assert.equal((mainAfter.match(/\\usepackage\{graphicx\}/g)||[]).length,1);assert.ok(!mainAfter.replace(/\r\n/g,'').includes('\n'));
    const image=await fetch(base+url+'/asset?path='+encodeURIComponent(first.data.assetPath));assert.deepEqual(Buffer.from(await image.arrayBuffer()),makePng());
    const second=await request(url+'/insert-image','POST',{...body,expectedContent:first.data.content,start:first.data.content.length,end:first.data.content.length,file:undefined,existingPath:first.data.assetPath});assert.equal(second.status,200,second.data.error);assert.equal(second.data.mainUpdated,false);assert.equal(second.data.assetPath,first.data.assetPath);
    const files=(await request(url)).data.files;assert.equal(files.filter(item=>item.path.startsWith('images/')).length,1);
    assert.equal((await request(url+'/insert-image','POST',{...body,expectedContent:second.data.content,file:{name:'fake.png',base64:Buffer.from('<svg/>').toString('base64')}})).status,400);
    assert.equal((await request(url+'/file?path=kapitel.tex')).data.content,second.data.content);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(path.join(os.tmpdir(),'schriftenministerium-image-api-')));await fs.rm(root,{recursive:true,force:true});}
});
