import { spawn } from 'node:child_process';
import { AppError } from './files.mjs';
import path from 'node:path';

export function run(command, args, { cwd, timeout = 120000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, env: { ...process.env, ...env } });
    let output = '', timedOut = false;
    const capture = data => { output = (output + data.toString()).slice(-180000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.on('error', e => { clearTimeout(timer); reject(new AppError(e.code === 'ENOENT' ? `${command} wurde nicht gefunden. Bitte installieren und zum PATH hinzufügen.` : e.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, output: timedOut ? output + '\nZeitlimit erreicht. Bitte erneut versuchen.' : output });
    });
  });
}

export async function git(root, args, { allowFailure = false, ...options } = {}) {
  const result = await run('git', ['-c', `core.hooksPath=${path.resolve(import.meta.dirname, '../.disabled-git-hooks')}`, '-c', 'protocol.file.allow=never', ...args], { cwd: root, env: { GIT_TERMINAL_PROMPT: '0' }, ...options });
  if (result.code !== 0 && !allowFailure) throw new AppError(result.output.trim() || 'Git-Befehl fehlgeschlagen.', 409);
  return result;
}

export function githubUrl(value) {
  if (typeof value !== 'string') throw new AppError('Bitte eine GitHub-Repository-URL eingeben.');
  const remote = value.trim().replace(/\/$/, '');
  if (!/^(https:\/\/github\.com\/|git@github\.com:)[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(remote)) throw new AppError('Erlaubt sind GitHub-URLs wie https://github.com/name/projekt.git oder git@github.com:name/projekt.git.');
  return remote;
}
