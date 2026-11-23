import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const excluded = new Set(['.git', '.satzwerk', '.schriftenministerium', 'node_modules']);
export const textExtensions = new Set(['.tex', '.bib', '.sty', '.cls', '.txt', '.md', '.csv', '.tsv', '.json', '.yaml', '.yml', '.bst', '.def', '.cfg', '.tikz', '.svg', '.gitignore', '.ltx', '.ist', '.bbl', '.bbx', '.cbx', '.lbx', '.latexmkrc', '.dtx', '.ins']);
export const isText = name => textExtensions.has(path.extname(name).toLowerCase()) || ['.gitignore', '.latexmkrc', 'license', 'notice', 'readme', 'makefile'].includes(name.toLowerCase());

export async function safePath(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || name.includes(':') || name.length > 500) throw new AppError('Ungültiger Dateipfad.');
  const parts = name.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || excluded.has(p.toLowerCase()) || /[<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw new AppError('Dieser Dateipfad ist nicht erlaubt.');
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new AppError('Dateipfad außerhalb des Projekts.');
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new AppError('Symbolische Links werden nicht geöffnet.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return target;
}

export async function listFiles(root, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (excluded.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(root, name));
    else if (entry.isFile()) {
      const stat = await fs.stat(path.join(root, name));
      result.push({ path: name, size: stat.size, editable: isText(name) && stat.size <= 2 * 1024 * 1024 });
    }
    if (result.length > 3000) throw new AppError('Das Projekt enthält zu viele Dateien.');
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

// ZIP with stored entries: no runtime packages, standard ZIP-compatible export.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(data) {
  let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
export function readZip(archive) {
  try {
    if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > 25 * 1024 * 1024) throw new AppError('Bitte ein gültiges Projekt-ZIP mit maximal 25 MB auswählen.');
    let end = -1;
    for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65557); i--) if (archive.readUInt32LE(i) === 0x06054b50 && i + 22 + archive.readUInt16LE(i + 20) === archive.length) { end = i; break; }
    if (end === -1) throw new AppError('Das ZIP ist unvollständig oder beschädigt.');
    const count = archive.readUInt16LE(end + 10), directorySize = archive.readUInt32LE(end + 12), directoryStart = archive.readUInt32LE(end + 16);
    if (archive.readUInt32LE(end + 4) !== 0 || archive.readUInt16LE(end + 8) !== count || count > 3000 || count === 0xffff || directoryStart + directorySize !== end) throw new AppError('Dieses ZIP-Format wird nicht unterstützt (maximal 3.000 Einträge, kein ZIP64 oder mehrteiliges ZIP).');
    const entries = []; let offset = directoryStart, total = 0;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) throw new AppError('Das ZIP-Verzeichnis ist beschädigt.');
      const flags = archive.readUInt16LE(offset + 8), method = archive.readUInt16LE(offset + 10), crc = archive.readUInt32LE(offset + 16), compressed = archive.readUInt32LE(offset + 20), size = archive.readUInt32LE(offset + 24);
      const nameLength = archive.readUInt16LE(offset + 28), extraLength = archive.readUInt16LE(offset + 30), commentLength = archive.readUInt16LE(offset + 32), attributes = archive.readUInt32LE(offset + 38), local = archive.readUInt32LE(offset + 42);
      if (flags & 1 || ![0, 8].includes(method)) throw new AppError('Verschlüsselte ZIPs und diese Kompressionsmethode werden nicht unterstützt.');
      if (((attributes >>> 16) & 0xf000) === 0xa000) throw new AppError('ZIPs mit symbolischen Links werden nicht importiert.');
      if (size > 30 * 1024 * 1024 || (total += size) > 100 * 1024 * 1024) throw new AppError('Das entpackte Projekt ist zu groß (100 MB insgesamt, 30 MB pro Datei).');
      if (offset + 46 + nameLength + extraLength + commentLength > end) throw new AppError('Ungültiger ZIP-Dateiname.');
      let name;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(archive.subarray(offset + 46, offset + 46 + nameLength)); }
      catch { throw new AppError('Die ZIP-Dateinamen müssen UTF-8 verwenden. Bitte das Projekt erneut als UTF-8-ZIP exportieren.'); }
      name = name.replace(/^(\.\/)+/, '');
      if (local + 30 > directoryStart || archive.readUInt32LE(local) !== 0x04034b50) throw new AppError('Das ZIP enthält einen ungültigen Dateieintrag.');
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      if (start + compressed > directoryStart || start < local) throw new AppError('Das ZIP enthält unvollständige Daten.');
      const packed = archive.subarray(start, start + compressed);
      const data = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) });
      if (data.length !== size || crc32(data) !== crc) throw new AppError('Die Prüfsumme einer ZIP-Datei stimmt nicht. Bitte erneut herunterladen.');
      entries.push({ name, data, directory: name.endsWith('/') }); offset += 46 + nameLength + extraLength + commentLength;
    }
    if (offset !== end) throw new AppError('Ungültiges ZIP-Verzeichnis.');
    return entries;
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError('Das ZIP konnte nicht entpackt werden. Bitte eine unbeschädigte ZIP-Datei auswählen.'); }
}
export function zip(entries) {
  const chunks = [], central = []; let offset = 0;
  for (const { name, data } of entries) {
    const filename = Buffer.from(name); let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(33, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(filename.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(33, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(filename.length, 28); c.writeUInt32LE(offset, 42);
    chunks.push(h, filename, data); central.push(c, filename); offset += h.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
