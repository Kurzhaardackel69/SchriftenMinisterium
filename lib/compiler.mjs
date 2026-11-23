import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './process.mjs';
import { AppError } from './files.mjs';

export const compilerNames = ['auto', 'tectonic', 'pdflatex', 'xelatex', 'lualatex'];
export async function toolDirectories(config = {}) {
  const directories = [config.toolsDirectory, process.env.SCHRIFTENMINISTERIUM_TEX_BIN, ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean).map(p => p.replace(/^"|"$/g, ''));
  if (process.platform === 'win32') {
    for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles]) if (base) directories.push(path.join(base, base === process.env.LOCALAPPDATA ? 'Programs/MiKTeX/miktex/bin/x64' : 'MiKTeX/miktex/bin/x64'));
    try { for (const entry of (await fs.readdir('C:/texlive', { withFileTypes: true })).filter(e => e.isDirectory()).sort((a,b) => b.name.localeCompare(a.name))) directories.push(path.join('C:/texlive', entry.name, 'bin/windows')); } catch { /* Not installed. */ }
    if (process.env.ProgramFiles) directories.push(path.join(process.env.ProgramFiles, 'Git/cmd'));
  }
  return [...new Set(directories)];
}
export async function findTool(name, config = {}) {
  if (!['tectonic', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'makeglossaries', 'makeindex', 'git'].includes(name)) throw new AppError('Unbekanntes Werkzeug.');
  const candidates = name === 'tectonic' && process.env.TECTONIC_PATH ? [process.env.TECTONIC_PATH] : [];
  for (const dir of await toolDirectories(config)) candidates.push(path.join(dir, name + (process.platform === 'win32' ? '.exe' : '')));
  for (const candidate of candidates) try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* Try next location. */ }
  return null;
}
export async function compilerStatus(config = {}) {
  const names = ['tectonic', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'makeglossaries', 'makeindex', 'git'];
  const values = await Promise.all(names.map(name => findTool(name, config)));
  return Object.fromEntries(names.map((name, i) => [name, !!values[i]]));
}
export async function compileDocument({ project, snapshot, outputDir, dataRoot, config = {}, runProcess = run }) {
  const engine = project.compiler === 'auto' || !project.compiler ? (await findTool('pdflatex', config) ? 'pdflatex' : 'tectonic') : project.compiler;
  if (!compilerNames.includes(engine)) throw new AppError('Unbekannter Compiler.');
  const command = await findTool(engine, config);
  if (!command) return { code: 1, engine, output: `Das Werkzeug ${engine} ist nicht installiert oder wurde nicht gefunden.\nInstalliere eine vollständige lokale TeX-Distribution und wähle bei Bedarf deren Programmordner in den Einstellungen. Der mitgelieferte Standard-Compiler bleibt für einfache Projekte verfügbar.` };
  const env = { PATH: (await toolDirectories(config)).join(path.delimiter) };
  if (engine === 'tectonic') return { ...(await runProcess(command, ['--untrusted', '--keep-logs', '--synctex', '--outdir', outputDir, project.main], { cwd: snapshot, timeout: 180000, env: { ...env, TECTONIC_UNTRUSTED_MODE: '1', TECTONIC_CACHE_DIR: process.env.TECTONIC_CACHE_DIR || path.join(dataRoot, 'tex-cache') } })), engine };
  const base = path.basename(project.main, '.tex'), deadline = Date.now() + 600000;
  let output = `Compiler: ${engine}\n`, code = 0;
  const execute = async (tool, args, cwd = snapshot) => {
    const binary = tool === engine ? command : await findTool(tool, config);
    if (!binary) { code = 1; output += `\nDas zusätzlich benötigte Werkzeug ${tool} fehlt. Bitte in deiner TeX-Installation ergänzen.\n`; return false; }
    const remaining = deadline - Date.now(); if (remaining <= 0) { code = 1; output += '\nZeitlimit für die Kompilierung erreicht.\n'; return false; }
    output += `\n--- ${tool} ---\n`;
    const result = await runProcess(binary, args, { cwd, timeout: Math.min(remaining, 300000), env: { ...env, BIBINPUTS: `${snapshot}//${path.delimiter}`, BSTINPUTS: `${snapshot}//${path.delimiter}` } });
    output = (output + result.output).slice(-180000); code = result.code; return code === 0;
  };
  const args = ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-synctex=1', project.shellEscape ? '-shell-escape' : '-no-shell-escape', `-output-directory=${outputDir}`, project.main];
  if (!await execute(engine, args)) return { code, output, engine };
  const read = extension => fs.readFile(path.join(outputDir, `${base}.${extension}`), 'utf8').catch(() => '');
  const [bcf, aux, idx, nlo, glo, acn] = await Promise.all(['bcf','aux','idx','nlo','glo','acn'].map(read));
  if (/<bcf:datasource\b/.test(bcf)) { if (!await execute('biber', ['--input-directory', outputDir, '--output-directory', outputDir, base])) return { code, output, engine }; }
  else if (/\\bibdata\{/.test(aux)) { if (!await execute('bibtex', [base], outputDir)) return { code, output, engine }; }
  if (glo.trim() || acn.trim()) { if (!await execute('makeglossaries', ['-d', outputDir, base])) return { code, output, engine }; }
  if (idx.trim()) { if (!await execute('makeindex', ['-o', `${base}.ind`, `${base}.idx`], outputDir)) return { code, output, engine }; }
  if (nlo.trim()) { if (!await execute('makeindex', ['-s', 'nomencl.ist', '-o', `${base}.nls`, `${base}.nlo`], outputDir)) return { code, output, engine }; }
  for (let pass = 0; pass < 2; pass++) if (!await execute(engine, args)) break;
  return { code, output, engine };
}
