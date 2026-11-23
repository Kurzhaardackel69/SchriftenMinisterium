import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { run } from '../lib/process.mjs';

const root = path.resolve(import.meta.dirname, '..');
const toolsDir = path.join(root, '.build-tools');
await fs.mkdir(toolsDir, { recursive: true });
const npm = path.join(toolsDir, 'package/bin/npm-cli.js');
try { await fs.access(npm); } catch {
  const url = 'https://registry.npmjs.org/npm/-/npm-12.2.3.tgz';
  const response = await fetch(url); if (!response.ok) throw new Error(`npm-Download: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha512').update(bytes).digest('base64') !== 'ovmNRRe76Jvcp1E6iOePQ6H9Zr4XMOrqgfaeGNhtRvP3XSl2Lo/a9C1N5/jRlLLrsqCem/omgGdZHpZ5a6yn1Q==') throw new Error('npm-Prüfsumme stimmt nicht.');
  const archive = path.join(toolsDir, 'npm.tgz'); await fs.writeFile(archive, bytes);
  const result = await run('tar.exe', ['-xzf', archive, '-C', toolsDir], { timeout: 120000 }); if (result.code) throw new Error(result.output);
}
const env = {
  npm_config_cache: path.join(root, '.build-cache/npm'),
  ELECTRON_CACHE: path.join(root, '.build-cache/electron'),
  ELECTRON_BUILDER_CACHE: path.join(root, '.build-cache/electron-builder'),
  npm_config_fund: 'false', npm_config_audit: 'false'
};
const result = await run(process.execPath, [npm, 'install', '--no-fund', '--no-audit'], { cwd: root, timeout: 900000, env });
console.log(result.output);
if (result.code) process.exitCode = result.code;
else {
  // npm may withhold dependency lifecycle scripts. Run the pinned Electron installer explicitly.
  try { await fs.access(path.join(root, 'node_modules/electron/dist/electron.exe')); }
  catch {
    const electron = await run(process.execPath, [path.join(root, 'node_modules/electron/install.js')], { cwd: root, timeout: 900000, env });
    console.log(electron.output); if (electron.code) process.exitCode = electron.code;
  }
}
