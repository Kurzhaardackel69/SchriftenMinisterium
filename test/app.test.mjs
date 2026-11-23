import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { run } from '../lib/process.mjs';
import { zip, readZip } from '../lib/files.mjs';
import { deflateRawSync } from 'node:zlib';

let server, dataRoot, base, project;
const headers = { 'X-Satzwerk-Request': '1', 'Content-Type': 'application/json' };
async function request(route, method = 'GET', body) {
  const response = await fetch(base + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
const route = suffix => `/api/projects/${project.id}${suffix || ''}`;
before(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'satzwerk-test-'));
  server = await createApp({ dataRoot, seed: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  // Only remove the exact temporary directory created above.
  assert.ok(dataRoot.startsWith(path.join(os.tmpdir(), 'satzwerk-test-')));
  await fs.rm(dataRoot, { recursive: true, force: true });
});

test('local API refuses cross-site requests and requests without application header', async () => {
  assert.equal((await fetch(base + '/api/projects')).status, 403);
  assert.equal((await fetch(base + '/api/projects', { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/server.mjs')).status, 404);
});
test('project creation and source files survive re-reading', async () => {
  const created = await request('/api/projects', 'POST', { name: 'Testprojekt', template: 'blank' });
  assert.equal(created.status, 201); project = created.data;
  assert.equal(project.main, 'main.tex');
  assert.equal((await request('/api/projects')).data.length, 1);
  assert.match((await request(route('/file?path=main.tex'))).data.content, /\\begin\{document\}/);
  const write = await request(route('/file'), 'PUT', { path: 'main.tex', content: '\\documentclass{article}\n\\begin{document}Saved content.\\end{document}\n' });
  assert.equal(write.status, 200);
  assert.match((await request(route('/file?path=main.tex'))).data.content, /Saved content/);
});
test('tags, favorites and archive persist without changing document freshness', async () => {
  const before = (await request(route())).data.updated;
  const tag = await request('/api/tags', 'POST', { name: 'Studium', color: '#59a57b' }); assert.equal(tag.status, 201);
  assert.equal((await request('/api/tags', 'POST', { name: 'studium', color: '#59a57b' })).status, 409);
  const organized = await request(route(), 'PATCH', { tags: [tag.data.id], starred: true, archived: true });
  assert.equal(organized.status, 200); assert.equal(organized.data.updated, before);
  const saved = (await request(route())).data; assert.deepEqual(saved.tags, [tag.data.id]); assert.equal(saved.starred, true); assert.equal(saved.archived, true);
  assert.equal((await request(route(), 'PATCH', { tags: ['nonexistent'] })).status, 400);
  assert.equal((await request(route(), 'PATCH', { archived: 'yes' })).status, 400);
  const renamed = await request(`/api/tags/${tag.data.id}`, 'PATCH', { name: 'Abschlussarbeit', color: '#4688b1' }); assert.equal(renamed.data.name, 'Abschlussarbeit');
  assert.equal((await request(`/api/tags/${tag.data.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await request(route())).data.tags, []); assert.equal((await request('/api/tags')).data.length, 0);
  await request(route(), 'PATCH', { starred: false, archived: false });
});
test('Overleaf ZIP imports nested files and detects sample.tex rather than the first chapter', async () => {
  const archive = zip([
    { name: 'HAW/chapters/first.tex', data: Buffer.from('\\section{First chapter}') },
    { name: 'HAW/sample.tex', data: Buffer.from('\\documentclass{article}\n\\begin{document}\\input{chapters/first}\\end{document}') },
    { name: 'HAW/hawstyle.sty', data: Buffer.from('\\ProvidesPackage{hawstyle}') },
    { name: 'HAW/sample.bib', data: Buffer.from('@book{example,title={Example}}') },
    { name: 'HAW/LICENSE', data: Buffer.from('Original template license') },
    { name: 'HAW/images/example.png', data: Buffer.from([137, 80, 78, 71]) }
  ]);
  const imported = await request('/api/projects', 'POST', { name: 'Imported HAW', archive: archive.toString('base64') });
  assert.equal(imported.status, 201, imported.data.error); assert.equal(imported.data.main, 'sample.tex'); assert.equal(imported.data.importedFiles, 6);
  const detail = (await request(`/api/projects/${imported.data.id}`)).data;
  assert.equal(detail.files.length, 6); assert.ok(detail.files.find(file => file.path === 'LICENSE').editable);
  assert.equal((await request(`/api/projects/${imported.data.id}/file?path=LICENSE`)).data.content, 'Original template license');
});
test('compressed ZIP entries work and malformed or escaping archives leave no project behind', async () => {
  const source = Buffer.from('\\documentclass{article}\n\\begin{document}A compressed source.\\end{document}');
  const stored = zip([{ name: 'sample.tex', data: source }]), packed = deflateRawSync(source);
  const nameLength = stored.readUInt16LE(26), header = Buffer.from(stored.subarray(0, 30 + nameLength)), centralStart = stored.length - 22 - (46 + nameLength);
  const central = Buffer.from(stored.subarray(centralStart, stored.length - 22)), end = Buffer.from(stored.subarray(stored.length - 22));
  header.writeUInt16LE(8, 8); header.writeUInt32LE(packed.length, 18); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); end.writeUInt32LE(header.length + packed.length, 16);
  const compressed = Buffer.concat([header, packed, central, end]); assert.deepEqual(readZip(compressed)[0].data, source);
  const count = (await request('/api/projects')).data.length;
  for (const archive of [Buffer.from('invalid'), zip([{ name: '../outside.tex', data: source }]), zip([{ name: 'image.png', data: Buffer.from('no source') }]), Buffer.from(stored)]) {
    if (archive.equals(stored)) archive[header.length + 4] ^= 1;
    const imported = await request('/api/projects', 'POST', { name: 'Invalid archive', archive: archive.toString('base64') }); assert.equal(imported.status, 400, imported.data.error);
  }
  assert.equal((await request('/api/projects')).data.length, count);
});
test('nested files, duplicate protection, renaming main and deletion', async () => {
  assert.equal((await request(route('/file'), 'POST', { path: 'chapters/test.tex', content: 'Kapitel' })).status, 200);
  assert.equal((await request(route('/file'), 'POST', { path: 'chapters/test.tex', content: 'overwrite' })).status, 409);
  assert.equal((await request(route('/rename'), 'POST', { from: 'main.tex', to: 'document.tex' })).status, 200);
  assert.equal((await request(route())).data.main, 'document.tex');
  assert.equal((await request(route('/file?path=document.tex'), 'DELETE')).status, 400);
  assert.equal((await request(route('/file?path=chapters%2Ftest.tex'), 'DELETE')).status, 200);
  assert.equal((await request(route('/file?path=chapters%2Ftest.tex'))).status, 404);
});
test('file writes cannot escape the project or modify Git internals', async () => {
  for (const name of ['../outside.tex', '/absolute.tex', '.git/config', 'x/../../outside.tex', 'C:/outside.tex', 'x\\bad.tex', 'NUL.tex', '.GIT/config', 'x./test.tex']) {
    const result = await request(route('/file'), 'PUT', { path: name, content: 'no' });
    assert.equal(result.status, 400, name);
  }
  assert.equal((await request(route(), 'PATCH', { main: 'missing.tex' })).status, 400);
  assert.equal(await fs.stat(path.join(dataRoot, 'outside.tex')).catch(() => null), null);
});
test('binary uploads and ZIP export include uncommitted source files', async () => {
  const data = Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]);
  assert.equal((await request(route('/file'), 'POST', { path: 'figure.png', base64: data.toString('base64') })).status, 200);
  const download = await fetch(base + route('/asset?path=figure.png'));
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), data);
  const exported = await fetch(base + route('/export'));
  assert.equal(exported.headers.get('content-type'), 'application/zip');
  const archive = Buffer.from(await exported.arrayBuffer());
  assert.equal(archive.readUInt32LE(), 0x04034b50);
  assert.ok(archive.includes(Buffer.from('document.tex'))); assert.ok(archive.includes(Buffer.from('Saved content.'))); assert.ok(archive.includes(data));
  const zipPath = path.join(dataRoot, 'export.zip'); await fs.writeFile(zipPath, archive);
  if (process.platform === 'win32') {
    const result = await run('tar.exe', ['-tf', zipPath]); assert.equal(result.code, 0, result.output); assert.match(result.output, /figure\.png/);
  }
});
test('GitHub connection and local commit use real Git without touching any remote', async () => {
  assert.equal((await request(route('/git'))).data.initialized, false);
  for (const remote of ['file:///tmp/repo', 'https://token@github.com/name/repo', 'https://example.com/name/repo', '--upload-pack=bad']) {
    assert.equal((await request(route('/git'), 'POST', { action: 'connect', remote })).status, 400);
  }
  const connected = await request(route('/git'), 'POST', { action: 'connect', remote: 'https://github.com/example/satzwerk-test.git', authorName: 'Satzwerk Test', authorEmail: 'test@example.com' });
  assert.equal(connected.status, 200); assert.equal(connected.data.branch, 'main'); assert.ok(connected.data.changes.length >= 2);
  const committed = await request(route('/git'), 'POST', { action: 'commit', message: 'Test: local document' });
  assert.equal(committed.status, 200); assert.equal(committed.data.changes.length, 0); assert.equal(committed.data.history[0].subject, 'Test: local document');
  await request(route('/file'), 'PUT', { path: 'document.tex', content: '\\documentclass{article}\n\\begin{document}Changed.\\end{document}\n' });
  assert.equal((await request(route('/git'))).data.changes[0].path, 'document.tex');
  const pull = await request(route('/git'), 'POST', { action: 'pull' });
  assert.equal(pull.status, 400); assert.match(pull.data.error, /zuerst committen/);
});
test('real Tectonic PDF and failed compilation preserve last good output', { skip: process.env.SCHRIFTENMINISTERIUM_TEST_TEX !== '1' && process.env.SATZWERK_TEST_TEX !== '1' }, async () => {
  // Share a reusable package cache while keeping all test projects temporary.
  const first = await request(route('/compile'), 'POST', {});
  assert.equal(first.data.ok, true, first.data.log);
  const beforePdf = Buffer.from(await (await fetch(base + route('/pdf'))).arrayBuffer()); assert.equal(beforePdf.subarray(0, 5).toString(), '%PDF-');
  await request(route('/file'), 'PUT', { path: 'document.tex', content: '\\documentclass{article}\n\\begin{document}\\undefinedSatzwerkCommand\\end{document}' });
  const failed = await request(route('/compile'), 'POST', {}); assert.equal(failed.data.ok, false);
  const afterPdf = Buffer.from(await (await fetch(base + route('/pdf'))).arrayBuffer()); assert.deepEqual(afterPdf, beforePdf);
});
