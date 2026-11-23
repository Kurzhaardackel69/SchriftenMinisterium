import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppError, safePath, listFiles, isText, zip, readZip, excluded } from './lib/files.mjs';
import { run, git, githubUrl } from './lib/process.mjs';
import { templates, gitignore } from './lib/templates.mjs';
import { compileDocument, compilerNames, compilerStatus } from './lib/compiler.mjs';

const publicDir = path.join(import.meta.dirname, 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const exists = async p => !!await fs.stat(p).catch(() => false);
const cleanName = name => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new AppError('Bitte einen Projektnamen mit 1–100 Zeichen eingeben.');
  return name.trim();
};

export async function createApp({ dataRoot = process.env.SCHRIFTENMINISTERIUM_DATA || process.env.SATZWERK_DATA || path.join(import.meta.dirname, 'data'), seed = true } = {}) {
  dataRoot = path.resolve(dataRoot);
  await fs.mkdir(dataRoot, { recursive: true });
  const runtimePath = path.join(dataRoot, 'settings.json');
  const runtimeConfig = () => fs.readFile(runtimePath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  const busy = new Set(), compiling = new Set();
  const location = id => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new AppError('Projekt nicht gefunden.', 404);
    return path.join(dataRoot, id);
  };
  const meta = async id => {
    try { const value = JSON.parse(await fs.readFile(path.join(location(id), 'project.json'), 'utf8')); return { tags: [], archived: false, starred: false, compiler: 'auto', shellEscape: false, ...value, sourceUpdated: value.sourceUpdated || value.updated }; }
    catch (e) { if (e.code === 'ENOENT') throw new AppError('Projekt nicht gefunden.', 404); throw e; }
  };
  const writeMeta = async value => {
    const dest = path.join(location(value.id), 'project.json');
    await fs.writeFile(dest + '.tmp', JSON.stringify(value, null, 2)); await fs.rename(dest + '.tmp', dest);
  };
  const locked = async (id, action) => {
    if (busy.has(id)) throw new AppError('Das Projekt wird gerade bearbeitet. Bitte gleich erneut versuchen.', 409);
    busy.add(id); try { return await action(); } finally { busy.delete(id); }
  };
  async function projects() {
    const items = [];
    for (const entry of await fs.readdir(dataRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
        try { items.push(await meta(entry.name)); } catch { /* Interrupted creation is not a project. */ }
      }
    }
    return items.sort((a, b) => b.updated.localeCompare(a.updated));
  }
  let libraryBusy = false;
  const libraryPath = path.join(dataRoot, 'library.json');
  const readTags = async () => {
    try { return JSON.parse(await fs.readFile(libraryPath, 'utf8')).tags; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const writeTags = async tags => {
    await fs.writeFile(libraryPath + '.tmp', JSON.stringify({ tags }, null, 2)); await fs.rename(libraryPath + '.tmp', libraryPath);
  };
  async function editTag(method, id, body) {
    if (libraryBusy) throw new AppError('Die Tags werden gerade aktualisiert. Bitte erneut versuchen.', 409);
    libraryBusy = true;
    try {
      let tags = await readTags();
      if (method !== 'POST' && !tags.some(tag => tag.id === id)) throw new AppError('Tag nicht gefunden.', 404);
      if (method === 'DELETE') {
        const items = await projects();
        if (items.some(item => busy.has(item.id))) throw new AppError('Ein Projekt wird gerade bearbeitet. Bitte erneut versuchen.', 409);
        items.forEach(item => busy.add(item.id));
        try {
          for (const item of items) if (item.tags.includes(id)) { item.tags = item.tags.filter(tag => tag !== id); await writeMeta(item); }
          tags = tags.filter(tag => tag.id !== id); await writeTags(tags);
        } finally { items.forEach(item => busy.delete(item.id)); }
        return { ok: true };
      }
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 40) throw new AppError('Ein Tag braucht einen Namen mit 1–40 Zeichen.');
      if (!/^#[a-fA-F0-9]{6}$/.test(body.color || '')) throw new AppError('Bitte eine gültige Tag-Farbe auswählen.');
      if (tags.some(tag => tag.id !== id && tag.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) throw new AppError('Dieser Tag existiert bereits.', 409);
      if (method === 'POST' && tags.length >= 100) throw new AppError('Maximal 100 Tags sind möglich.');
      const tag = { id: method === 'POST' ? randomUUID() : id, name, color: body.color.toLowerCase() };
      tags = method === 'POST' ? [...tags, tag] : tags.map(item => item.id === id ? tag : item); await writeTags(tags); return tag;
    } finally { libraryBusy = false; }
  }
  async function createProject(body) {
    const name = cleanName(body.name), id = randomUUID(), dir = location(id), root = path.join(dir, 'files');
    const remote = body.remote ? githubUrl(body.remote) : null;
    await fs.mkdir(dir, { recursive: true });
    try {
      if (body.archive !== undefined) {
        if (remote || typeof body.archive !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.archive)) throw new AppError('Ungültiges Projekt-ZIP.');
        await fs.mkdir(root);
        const entries = readZip(Buffer.from(body.archive, 'base64'));
        // Validate even directory entries before considering ignored metadata.
        for (const entry of entries) await safePath(root, entry.name.replace(/\/$/, ''));
        const files = entries.filter(entry => !entry.directory && !entry.name.split('/').some(part => excluded.has(part.toLowerCase()) || ['__macosx', '.ds_store'].includes(part.toLowerCase())));
        if (!files.length) throw new AppError('Das ZIP enthält keine Projektdateien.');
        while (files.every(file => file.name.includes('/') && file.name.split('/')[0] === files[0].name.split('/')[0])) files.forEach(file => { file.name = file.name.slice(file.name.indexOf('/') + 1); });
        const names = files.map(file => file.name.toLowerCase()), seen = new Set();
        if (names.some(name => name.split('/').slice(0, -1).some((_, index) => names.includes(name.split('/').slice(0, index + 1).join('/'))))) throw new AppError('Im ZIP überschneiden sich Datei- und Ordnernamen.');
        for (const file of files) {
          if (seen.has(file.name.toLowerCase())) throw new AppError('Das ZIP enthält doppelte Dateinamen.'); seen.add(file.name.toLowerCase());
          const dest = await safePath(root, file.name); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, file.data);
        }
      } else if (remote) await git(dir, ['clone', '--', remote, root], { timeout: 180000 });
      else {
        if (!Object.hasOwn(templates, body.template || 'article')) throw new AppError('Unbekannte Vorlage.');
        await fs.mkdir(root);
        for (const [file, text] of Object.entries(templates[body.template || 'article'])) {
          const dest = await safePath(root, file); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, text);
        }
        await fs.writeFile(path.join(root, '.gitignore'), gitignore);
      }
      const files = await listFiles(root);
      const candidates = [];
      for (const file of files.filter(f => f.path.endsWith('.tex') && f.size <= 2 * 1024 * 1024)) {
        const content = (await fs.readFile(await safePath(root, file.path), 'utf8')).replace(/%[^\n]*/g, '');
        if (/\\documentclass(?:\s*\[[^\]]*\])?\s*\{/.test(content)) candidates.push(file.path);
      }
      const main = candidates.find(file => file === 'main.tex') || candidates.find(file => !file.includes('/')) || candidates[0] || files.find(f => f.path === 'main.tex')?.path || files.find(f => f.path.endsWith('.tex'))?.path || '';
      if (body.archive !== undefined && !main) throw new AppError('Im ZIP wurde keine .tex-Datei gefunden. Bitte den Quelltext des Projekts herunterladen, nicht nur das PDF.');
      const value = { id, name, main, tags: [], archived: false, starred: false, created: new Date().toISOString(), updated: new Date().toISOString() };
      if (body.archive !== undefined) value.importedFiles = files.length;
      await writeMeta(value); return value;
    } catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw e; }
  }
  if (seed && !(await projects()).length) await createProject({ name: 'Mein erstes Dokument', template: 'article' });

  async function gitStatus(root) {
    if (!await exists(path.join(root, '.git'))) return { initialized: false, branch: '', remote: '', changes: [], history: [] };
    const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const parts = status.output.split('\0'), changes = [];
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]; if (!entry) continue;
      const code = entry.slice(0, 2); changes.push({ status: code, path: entry.slice(3) });
      if (code.includes('R') || code.includes('C')) i++;
    }
    const branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true })).output.trim();
    const remote = (await git(root, ['remote', 'get-url', 'origin'], { allowFailure: true })).output.trim();
    const log = await git(root, ['log', '-12', '--format=%h%x00%s%x00%an%x00%aI'], { allowFailure: true });
    const history = log.code === 0 ? log.output.trim().split('\n').filter(Boolean).map(line => {
      const [hash, subject, author, date] = line.replace(/\r$/, '').split('\0'); return { hash, subject, author, date };
    }) : [];
    const ahead = await git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { allowFailure: true });
    const [aheadCount, behindCount] = ahead.code === 0 ? ahead.output.trim().split(/\s+/).map(Number) : [0, 0];
    return { initialized: true, branch, remote, changes, history, ahead: aheadCount, behind: behindCount };
  }

  async function compile(id) {
    if (compiling.has(id)) throw new AppError('Die Kompilierung läuft bereits.', 409);
    compiling.add(id);
    const build = path.join(location(id), 'build'), snapshot = path.join(location(id), 'snapshot');
    try {
      let project;
      await locked(id, async () => {
        project = await meta(id); if (!project.main) throw new AppError('Bitte zuerst eine .tex-Hauptdatei auswählen.');
        const root = path.join(location(id), 'files');
        await safePath(root, project.main);
        await fs.rm(snapshot, { recursive: true, force: true });
        await fs.mkdir(snapshot, { recursive: true });
        const files = await listFiles(root);
        if (files.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024) throw new AppError('Projekt zu groß für die Kompilierung (maximal 100 MB).');
        for (const file of files) {
          const source = await safePath(root, file.path), dest = path.join(snapshot, file.path);
          await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.copyFile(source, dest);
        }
      });
      await fs.mkdir(build, { recursive: true });
      const outputDir = path.join(snapshot, '.schriftenministerium'); await fs.mkdir(outputDir);
      const started = Date.now();
      const result = await compileDocument({ project, snapshot, outputDir, dataRoot, config: await runtimeConfig() });
      const base = path.basename(project.main, '.tex'), produced = path.join(outputDir, base + '.pdf');
      const ok = result.code === 0 && await exists(produced);
      const details = { ok, log: result.output, duration: Date.now() - started, compiledAt: new Date().toISOString(), sourceUpdated: project.sourceUpdated, main: project.main, compiler: result.engine };
      if (ok) await fs.copyFile(produced, path.join(build, 'document.pdf'));
      await fs.writeFile(path.join(build, 'result.json'), JSON.stringify(details));
      return details;
    } finally { compiling.delete(id); await fs.rm(snapshot, { recursive: true, force: true }).catch(() => {}); }
  }

  const sendJSON = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const readBody = async req => {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('JSON erwartet.', 415);
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 36 * 1024 * 1024) throw new AppError('Anfrage zu groß (maximal 25 MB Projekt-ZIP).', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new AppError('Ungültiges JSON.'); }
  };
  async function sendFile(res, file, download) {
    let content; try { content = await fs.readFile(file); } catch (e) { if (e.code === 'ENOENT') throw new AppError('Datei nicht gefunden.', 404); throw e; }
    const headers = { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_')}"`;
    res.writeHead(200, headers); res.end(content);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const port = server.address().port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) throw new AppError('Host nicht erlaubt.', 403);
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) throw new AppError('Zugriff von einer anderen Website ist nicht erlaubt.', 403);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self' blob: data:; worker-src 'self' blob:; img-src 'self' blob: data:; frame-src 'self' blob:; object-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'");
      const url = new URL(req.url, `http://127.0.0.1:${port}`), parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'api') {
        if (req.method !== 'GET') throw new AppError('Methode nicht erlaubt.', 405);
        if (url.pathname.startsWith('/vendor/pdfjs/')) return await sendFile(res, await safePath(publicDir, decodeURIComponent(url.pathname.slice(1))));
        if (!['/', '/index.html', '/app.js', '/library.js', '/pdf-viewer.js', '/style.css', '/library.css', '/workspace.css', '/icon.svg'].includes(url.pathname)) throw new AppError('Nicht gefunden.', 404);
        return await sendFile(res, path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname.slice(1)));
      }
      if (req.headers['x-schriftenministerium-request'] !== '1' && req.headers['x-satzwerk-request'] !== '1' && !['pdf', 'export', 'asset'].includes(parts[3])) throw new AppError('Ungültige Anfrage.', 403);
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) throw new AppError('Methode nicht erlaubt.', 405);
      if (parts[1] === 'health' && req.method === 'GET') {
        const config = await runtimeConfig();
        return sendJSON(res, 200, { app: 'schriftenministerium', ...(await compilerStatus(config)), toolsDirectory: config.toolsDirectory || '' });
      }
      if (parts[1] === 'runtime' && parts.length === 2) {
        if (req.method === 'GET') return sendJSON(res, 200, await runtimeConfig());
        if (req.method !== 'PUT') throw new AppError('Methode nicht erlaubt.', 405);
        const body = await readBody(req);
        if (typeof body.toolsDirectory !== 'string' || body.toolsDirectory.length > 500) throw new AppError('Bitte einen gültigen Programmordner angeben.');
        const toolsDirectory = body.toolsDirectory.trim();
        if (toolsDirectory && (!path.isAbsolute(toolsDirectory) || !(await fs.stat(toolsDirectory).catch(() => null))?.isDirectory())) throw new AppError('Der Programmordner existiert nicht.');
        await fs.writeFile(runtimePath + '.tmp', JSON.stringify({ toolsDirectory }, null, 2)); await fs.rename(runtimePath + '.tmp', runtimePath);
        return sendJSON(res, 200, { toolsDirectory });
      }
      if (parts[1] === 'tags') {
        if (req.method === 'GET' && !parts[2]) return sendJSON(res, 200, await readTags());
        if ((req.method === 'POST' && !parts[2]) || (['PATCH', 'DELETE'].includes(req.method) && parts[2] && !parts[3])) {
          const body = req.method === 'DELETE' ? {} : await readBody(req);
          return sendJSON(res, req.method === 'POST' ? 201 : 200, await editTag(req.method, parts[2], body));
        }
        throw new AppError('Methode nicht erlaubt.', 405);
      }
      if (parts[1] !== 'projects') throw new AppError('Nicht gefunden.', 404);
      if (!parts[2]) {
        if (req.method === 'GET') return sendJSON(res, 200, await projects());
        if (req.method === 'POST') return sendJSON(res, 201, await createProject(await readBody(req)));
        throw new AppError('Methode nicht erlaubt.', 405);
      }
      const id = parts[2], root = path.join(location(id), 'files'), action = parts[3];
      let project = await meta(id);
      if (!action && req.method === 'GET') {
        const result = await fs.readFile(path.join(location(id), 'build/result.json'), 'utf8').then(JSON.parse).catch(() => null);
        return sendJSON(res, 200, { ...project, files: await listFiles(root), result, hasPdf: await exists(path.join(location(id), 'build/document.pdf')) });
      }
      if (action === 'file' && req.method === 'GET') {
        const file = await safePath(root, url.searchParams.get('path'));
        if (!isText(path.basename(file))) throw new AppError('Diese Datei kann nicht als Text geöffnet werden.');
        const stat = await fs.stat(file); if (stat.size > 2 * 1024 * 1024) throw new AppError('Textdatei zu groß (maximal 2 MB).');
        return sendJSON(res, 200, { content: await fs.readFile(file, 'utf8') });
      }
      if (action === 'asset' && req.method === 'GET') return await sendFile(res, await safePath(root, url.searchParams.get('path')), true);
      if (action === 'pdf' && req.method === 'GET') return await sendFile(res, path.join(location(id), 'build/document.pdf'), url.searchParams.has('download'));
      if (action === 'export' && req.method === 'GET') {
        const entries = []; let size = 0;
        for (const file of await listFiles(root)) {
          size += file.size; if (size > 100 * 1024 * 1024) throw new AppError('Export zu groß (maximal 100 MB).');
          entries.push({ name: file.path, data: await fs.readFile(await safePath(root, file.path)) });
        }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="schriftenministerium-projekt.zip"' }); return res.end(zip(entries));
      }
      if (action === 'git' && req.method === 'GET') return sendJSON(res, 200, await gitStatus(root));
      if (action === 'compile' && req.method === 'POST') return sendJSON(res, 200, await compile(id));
      const body = req.method === 'DELETE' ? {} : await readBody(req);
      const result = await locked(id, async () => {
        project = await meta(id);
        if (!action && req.method === 'PATCH') {
          const current = await meta(id);
          const changedMain = body.main !== undefined && body.main !== current.main;
          const changedName = body.name !== undefined && body.name !== current.name;
          const changedCompiler = body.compiler !== undefined && body.compiler !== current.compiler;
          const changedShell = body.shellEscape !== undefined && body.shellEscape !== current.shellEscape;
          if (body.compiler !== undefined) {
            if (!compilerNames.includes(body.compiler)) throw new AppError('Unbekannter Compiler.'); current.compiler = body.compiler;
          }
          if (body.shellEscape !== undefined) {
            if (typeof body.shellEscape !== 'boolean') throw new AppError('Ungültige Einstellung für externe Programme.'); current.shellEscape = body.shellEscape;
          }
          if (libraryBusy) throw new AppError('Die Tags werden gerade aktualisiert. Bitte erneut versuchen.', 409);
          if (body.tags !== undefined) {
            const tags = await readTags();
            if (!Array.isArray(body.tags) || body.tags.length > 100 || body.tags.some(tag => !tags.some(item => item.id === tag))) throw new AppError('Bitte vorhandene Tags auswählen.');
            current.tags = [...new Set(body.tags)];
          }
          for (const key of ['archived', 'starred']) if (body[key] !== undefined) {
            if (typeof body[key] !== 'boolean') throw new AppError('Ungültiger Projektstatus.');
            current[key] = body[key];
          }
          if (body.name !== undefined) current.name = cleanName(body.name);
          if (body.main !== undefined) {
            const main = await safePath(root, body.main); if (!body.main.endsWith('.tex') || !await exists(main)) throw new AppError('Bitte eine vorhandene .tex-Datei auswählen.');
            current.main = body.main;
          }
          if (changedName || changedMain || changedCompiler || changedShell) current.updated = new Date().toISOString();
          if (changedMain || changedCompiler || changedShell) current.sourceUpdated = current.updated;
          await writeMeta(current); return current;
        }
        if (action === 'file' && ['PUT', 'POST'].includes(req.method)) {
          const file = await safePath(root, body.path);
          if (req.method === 'POST' && await exists(file)) throw new AppError('Diese Datei existiert bereits.', 409);
          let content;
          if (body.base64 !== undefined && req.method === 'POST') {
            if (typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) throw new AppError('Ungültige Datei.');
            content = Buffer.from(body.base64, 'base64');
          } else {
            if (typeof body.content !== 'string' || !isText(path.basename(file))) throw new AppError('Ungültige Textdatei.');
            content = Buffer.from(body.content);
            if (content.length > 2 * 1024 * 1024) throw new AppError('Textdatei zu groß (maximal 2 MB).');
          }
          if (content.length > 10 * 1024 * 1024) throw new AppError('Datei zu groß (maximal 10 MB).');
          await fs.mkdir(path.dirname(file), { recursive: true });
          const temporary = path.join(location(id), `write-${randomUUID()}.tmp`);
          try { await fs.writeFile(temporary, content); await fs.rename(temporary, file); }
          finally { await fs.unlink(temporary).catch(() => {}); }
        } else if (action === 'file' && req.method === 'DELETE') {
          const name = url.searchParams.get('path'), file = await safePath(root, name);
          if (project.main === name) throw new AppError('Die Hauptdatei kann nicht gelöscht werden. Wähle zuerst eine andere Hauptdatei.');
          await fs.unlink(file);
        } else if (action === 'rename' && req.method === 'POST') {
          const from = await safePath(root, body.from), to = await safePath(root, body.to);
          if (project.main === body.from && !body.to.endsWith('.tex')) throw new AppError('Die Hauptdatei muss die Endung .tex behalten.');
          if (await exists(to)) throw new AppError('Das Ziel existiert bereits.', 409);
          await fs.mkdir(path.dirname(to), { recursive: true }); await fs.rename(from, to);
          if (project.main === body.from) project.main = body.to;
        } else if (action === 'git' && req.method === 'POST') {
          if (body.action === 'connect') {
            const remote = githubUrl(body.remote);
            if ((body.authorName || body.authorEmail) && (typeof body.authorName !== 'string' || typeof body.authorEmail !== 'string' || !body.authorName.trim() || body.authorName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.authorEmail))) throw new AppError('Bitte einen Namen und eine gültige E-Mail für Commits eingeben.');
            if (!await exists(path.join(root, '.git'))) await git(root, ['init', '-b', 'main']);
            const old = await git(root, ['remote', 'get-url', 'origin'], { allowFailure: true });
            await git(root, ['remote', old.code === 0 ? 'set-url' : 'add', 'origin', remote]);
            if (body.authorName || body.authorEmail) {
              await git(root, ['config', '--local', 'user.name', body.authorName]); await git(root, ['config', '--local', 'user.email', body.authorEmail]);
            }
          } else {
            if (!await exists(path.join(root, '.git'))) throw new AppError('Bitte zuerst ein GitHub-Repository verbinden.');
            if (body.action === 'commit') {
              if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 500) throw new AppError('Bitte eine Commit-Nachricht eingeben (maximal 500 Zeichen).');
              await git(root, ['add', '--all']); await git(root, ['commit', '-m', body.message.trim()]);
            } else if (body.action === 'pull') {
              if ((await gitStatus(root)).changes.length) throw new AppError('Bitte lokale Änderungen zuerst committen.');
              githubUrl((await git(root, ['remote', 'get-url', 'origin'])).output.trim());
              const branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).output.trim();
              if (!branch || branch.startsWith('-')) throw new AppError('Ungültiger Branch.');
              await git(root, ['pull', '--ff-only', 'origin', branch]);
              project.updated = project.sourceUpdated = new Date().toISOString(); await writeMeta(project);
            } else if (body.action === 'push') {
              githubUrl((await git(root, ['remote', 'get-url', 'origin'])).output.trim());
              const branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).output.trim();
              if (!branch || branch.startsWith('-')) throw new AppError('Ungültiger Branch.');
              await git(root, ['push', '--set-upstream', 'origin', branch]);
            } else throw new AppError('Unbekannte Git-Aktion.');
          }
          return await gitStatus(root);
        } else throw new AppError('Nicht gefunden.', 404);
        project.updated = project.sourceUpdated = new Date().toISOString(); await writeMeta(project); return { ok: true };
      });
      return sendJSON(res, 200, result);
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      if (status === 500) console.error(error);
      sendJSON(res, status, { error: error.status ? error.message : status === 404 ? 'Datei nicht gefunden.' : 'Ein interner Fehler ist aufgetreten. Details stehen im Serverfenster.' });
    }
  });
  server.requestTimeout = 900000;
  server.hasActiveJobs = () => busy.size > 0 || compiling.size > 0;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3210), server = await createApp();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} ist bereits belegt. Öffne http://127.0.0.1:${port} oder wähle einen anderen PORT.` : error); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`\n  SchriftenMinisterium läuft auf http://127.0.0.1:${port}\n  Beenden mit Strg+C. Projekte bleiben im Ordner data erhalten.\n`));
}
