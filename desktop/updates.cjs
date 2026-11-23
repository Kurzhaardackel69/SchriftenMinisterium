const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const repository = 'Kurzhaardackel69/SchriftenMinisterium';
const latestURL = `https://api.github.com/repos/${repository}/releases/latest`;
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'SchriftenMinisterium-Desktop', 'X-GitHub-Api-Version': '2022-11-28' };
const maxSize = 600 * 1024 * 1024;
const versionParts = value => {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Ungültige Versionsnummer.');
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Ungültige Versionsnummer.');
  return parts;
};
function newer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function releaseAsset(release, current) {
  if (release.draft || release.prerelease) return null;
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!newer(version, current)) return null;
  const name = `SchriftenMinisterium-Setup-${version}-x64.exe`;
  const asset = release.assets?.find(item => item.name === name && item.state === 'uploaded');
  const url = `https://github.com/${repository}/releases/download/v${version}/${name}`;
  if (!asset || asset.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maxSize) {
    throw new Error('Die neue Version enthält noch kein vollständig geprüftes Windows-Update. Bitte später erneut versuchen.');
  }
  return { version, name, url, size: asset.size, sha256: asset.digest.slice(7).toLowerCase() };
}
async function checkForUpdate(current, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(latestURL, { headers, signal: AbortSignal.timeout(20000) });
  if (response.status === 404) return null;
  if (response.status === 403 || response.status === 429) throw new Error('GitHub begrenzt gerade die Update-Abfragen. Bitte später erneut versuchen.');
  if (!response.ok) throw new Error(`Die Update-Prüfung ist fehlgeschlagen (${response.status}).`);
  return releaseAsset(await response.json(), current);
}
async function verifyInstaller(file, asset) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size !== asset.size) throw new Error('Die Größe der Update-Datei stimmt nicht.');
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); }
  finally { await handle.close(); }
  if (hash.digest('hex') !== asset.sha256) throw new Error('Die Update-Prüfsumme stimmt nicht. Das Update wird nicht gestartet.');
}
const cacheFile = name => /^SchriftenMinisterium-Setup-\d+\.\d+\.\d+-x64\.exe(?:\.part)?$/.test(name);
async function cleanUpdateCache(directory, keep) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (entry.isFile() && cacheFile(entry.name) && entry.name !== keep) await fs.unlink(path.join(directory, entry.name));
  }
}
async function downloadUpdate(asset, directory, { fetchImpl = fetch, onProgress = () => {} } = {}) {
  // Validate again at the privileged boundary; no arbitrary URLs or paths are accepted.
  if (!releaseAsset({ tag_name: `v${asset.version}`, assets: [{ name: asset.name, state: 'uploaded', browser_download_url: asset.url, digest: `sha256:${asset.sha256}`, size: asset.size }] }, '0.0.0')) throw new Error('Ungültiges Update.');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, asset.name), partial = file + '.part';
  try { await verifyInstaller(file, asset); await cleanUpdateCache(directory, asset.name); return file; } catch { /* Download a fresh verified copy. */ }
  await cleanUpdateCache(directory);
  let handle;
  try {
    const response = await fetchImpl(asset.url, { headers: { 'User-Agent': headers['User-Agent'] }, signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`Das Update konnte nicht geladen werden (${response.status}).`);
    if (response.url && !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(new URL(response.url).hostname)) throw new Error('Unerwartetes Download-Ziel.');
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) !== asset.size) throw new Error('Die angekündigte Update-Größe stimmt nicht.');
    handle = await fs.open(partial, 'wx');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > asset.size) throw new Error('Das Update ist größer als angekündigt.');
      hash.update(chunk); await handle.writeFile(chunk); onProgress(size / asset.size);
    }
    await handle.close(); handle = null;
    if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Die Update-Prüfsumme oder Dateigröße stimmt nicht. Das Update wird nicht gestartet.');
    await fs.rename(partial, file);
    return file;
  } catch (error) {
    await handle?.close().catch(() => {}); await fs.unlink(partial).catch(() => {}); throw error;
  }
}
module.exports = { repository, newer, releaseAsset, checkForUpdate, verifyInstaller, downloadUpdate, cleanUpdateCache };
