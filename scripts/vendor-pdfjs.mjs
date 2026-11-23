import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { run } from '../lib/process.mjs';

const version = '6.5.438';
const integrity = 'vg8Pw1x+AFKy4AMDvhuWl5cOYV8d698UoEANoFFhc79hqXDnZQqnOXoxw3HG907WHOg1JYOvLhP756boddFxpA==';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'schriftenministerium-pdfjs-'));
try {
  const response = await fetch(`https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${version}.tgz`);
  if (!response.ok) throw new Error(`Download fehlgeschlagen: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha512').update(data).digest('base64') !== integrity) throw new Error('PDF.js-Integritätsprüfung fehlgeschlagen.');
  const archive = path.join(temp, 'pdfjs.tgz'); await fs.writeFile(archive, data);
  const result = await run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xzf', archive, '-C', temp, 'package/build/pdf.mjs', 'package/build/pdf.worker.mjs', 'package/LICENSE', 'package/cmaps', 'package/standard_fonts', 'package/wasm']);
  if (result.code) throw new Error(result.output);
  const dest = path.resolve(import.meta.dirname, '../public/vendor/pdfjs'); await fs.mkdir(dest, { recursive: true });
  for (const name of ['pdf.mjs', 'pdf.worker.mjs']) await fs.copyFile(path.join(temp, 'package/build', name), path.join(dest, name));
  for (const name of ['LICENSE', 'cmaps', 'standard_fonts', 'wasm']) await fs.cp(path.join(temp, 'package', name), path.join(dest, name), { recursive: true });
  await fs.writeFile(path.join(dest, 'VERSION'), version + '\n');
  console.log(`Mozilla PDF.js ${version} lokal eingebunden. Integrität geprüft, Lizenz und Ressourcen übernommen.`);
} finally {
  if (!temp.startsWith(path.join(os.tmpdir(), 'schriftenministerium-pdfjs-'))) throw new Error('Ungültiger temporärer Pfad.');
  await fs.rm(temp, { recursive: true, force: true });
}
