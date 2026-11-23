import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import updates from '../desktop/updates.cjs';

const bytes = Buffer.from('Verified update fixture.');
const asset = { version:'0.3.0', name:'SchriftenMinisterium-Setup-0.3.0-x64.exe', url:'https://github.com/Kurzhaardackel69/SchriftenMinisterium/releases/download/v0.3.0/SchriftenMinisterium-Setup-0.3.0-x64.exe', size:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') };
const release = () => ({ tag_name:'v0.3.0', draft:false, prerelease:false, assets:[{name:asset.name, browser_download_url:asset.url, size:asset.size, digest:`sha256:${asset.sha256}`, state:'uploaded'}] });
async function fixture(action) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'schriftenministerium-update-'));
  try { await action(directory); }
  finally { assert.ok(directory.startsWith(path.join(os.tmpdir(),'schriftenministerium-update-'))); await fs.rm(directory,{recursive:true,force:true}); }
}
test('update discovery accepts only newer stable releases with the exact repository asset and digest', async () => {
  assert.equal(updates.newer('0.10.0','0.9.9'),true);
  assert.equal(updates.releaseAsset(release(),'0.3.0'),null);
  assert.equal(updates.releaseAsset(release(),'1.0.0'),null);
  assert.equal(updates.releaseAsset({...release(),prerelease:true},'0.2.0'),null);
  assert.throws(()=>updates.newer('../1.0.0','0.2.0'));
  const found = await updates.checkForUpdate('0.2.0',{fetchImpl:async url=>{ assert.match(url,/api.github.com\/repos\/Kurzhaardackel69\/SchriftenMinisterium\/releases\/latest$/);return Response.json(release()); }});
  assert.deepEqual(found,asset);
  for (const patch of [{browser_download_url:'https://example.com/update.exe'}, {digest:undefined}, {size:700*1024*1024}, {state:'new'}]) {
    const broken=release();Object.assign(broken.assets[0],patch);assert.throws(()=>updates.releaseAsset(broken,'0.2.0'));
  }
  await assert.rejects(updates.checkForUpdate('0.2.0',{fetchImpl:async()=>new Response('',{status:429})}),/begrenzt/);
});
test('download verifies bytes, reuses an intact download and detects later tampering',()=>fixture(async directory=>{
  const progress=[];
  const file=await updates.downloadUpdate(asset,directory,{fetchImpl:async()=>new Response(bytes,{headers:{'content-length':String(bytes.length)}}),onProgress:value=>progress.push(value)});
  assert.deepEqual(await fs.readFile(file),bytes);assert.equal(progress.at(-1),1);
  await updates.downloadUpdate(asset,directory,{fetchImpl:async()=>{throw new Error('Unexpected second download');}});
  const changed=Buffer.from(bytes);changed[0]^=1;await fs.writeFile(file,changed);
  await assert.rejects(updates.verifyInstaller(file,asset),/Prüfsumme/);
}));
test('corrupt, truncated and oversized downloads leave no executable or partial update',()=>fixture(async directory=>{
  for(const content of [Buffer.from(bytes.toString().replace('Verified','Modified')), bytes.subarray(1), Buffer.concat([bytes,Buffer.from('!')])]) {
    await assert.rejects(updates.downloadUpdate(asset,directory,{fetchImpl:async()=>new Response(content)}));
    assert.deepEqual(await fs.readdir(directory),[]);
  }
  await assert.rejects(updates.downloadUpdate({...asset,name:'../escape.exe'},directory,{fetchImpl:async()=>new Response(bytes)}));
  await assert.rejects(updates.downloadUpdate({...asset,version:'0.0.0'},directory,{fetchImpl:async()=>new Response(bytes)}));
}));
test('update cache cleanup preserves unrelated files and directories',()=>fixture(async directory=>{
  await fs.writeFile(path.join(directory,asset.name),bytes);await fs.writeFile(path.join(directory,asset.name+'.part'),bytes);
  await fs.writeFile(path.join(directory,'notes.txt'),'keep');await fs.mkdir(path.join(directory,'projects'));
  await updates.cleanUpdateCache(directory,asset.name);
  assert.deepEqual((await fs.readdir(directory)).sort(),[asset.name,'notes.txt','projects'].sort());
  await updates.cleanUpdateCache(directory);
  assert.deepEqual((await fs.readdir(directory)).sort(),['notes.txt','projects']);
}));
