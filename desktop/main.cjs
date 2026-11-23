const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { checkForUpdate, downloadUpdate, verifyInstaller, cleanUpdateCache } = require('./updates.cjs');

app.setName('SchriftenMinisterium');
if (process.env.SCHRIFTENMINISTERIUM_DESKTOP_PROFILE) app.setPath('userData', path.resolve(process.env.SCHRIFTENMINISTERIUM_DESKTOP_PROFILE));
let window, server, baseUrl, dataRoot, shuttingDown = false;
let updating = false;
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('SchriftenMinisterium konnte nicht starten', error.message); app.quit(); });
}

async function importData() {
  if (server.hasActiveJobs() || !window.webContents.getURL().endsWith('#/projects')) {
    await dialog.showMessageBox(window, { type:'info', message:'Wechsle zuerst zur Projektübersicht und warte, bis die Kompilierung abgeschlossen ist.' }); return;
  }
  const selection = await dialog.showOpenDialog(window, { title:'Bisherigen data-Ordner auswählen', properties:['openDirectory'], defaultPath:app.getPath('documents') });
  if (selection.canceled) return;
  const source = await fs.realpath(selection.filePaths[0]);
  if (source.toLowerCase() === (await fs.realpath(dataRoot)).toLowerCase()) return;
  let imported = 0, skipped = 0;
  for (const entry of await fs.readdir(source, {withFileTypes:true})) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const from = path.join(source,entry.name), to = path.join(dataRoot,entry.name);
    const meta = await fs.readFile(path.join(from,'project.json'),'utf8').then(JSON.parse).catch(()=>null);
    if (!meta || meta.id !== entry.name || !(await fs.stat(path.join(from,'files')).catch(()=>null))?.isDirectory()) continue;
    if (await fs.stat(to).catch(()=>null)) { skipped++; continue; }
    await fs.cp(from,to,{recursive:true,errorOnExist:true,force:false,filter:p=>!p.split(path.sep).some(segment=>['snapshot','tex-cache'].includes(segment))}); imported++;
  }
  const sourceTags = await fs.readFile(path.join(source,'library.json'),'utf8').then(JSON.parse).catch(()=>({tags:[]}));
  const targetTags = await fs.readFile(path.join(dataRoot,'library.json'),'utf8').then(JSON.parse).catch(()=>({tags:[]}));
  for (const tag of sourceTags.tags || []) if (/^[a-f0-9-]{36}$/.test(tag.id) && typeof tag.name==='string' && /^#[0-9a-f]{6}$/i.test(tag.color) && !targetTags.tags.some(t=>t.id===tag.id)) targetTags.tags.push(tag);
  await fs.writeFile(path.join(dataRoot,'library.json'),JSON.stringify(targetTags,null,2));
  window.webContents.reload();
  await dialog.showMessageBox(window,{type:'info',message:`${imported} Projekte übernommen.`,detail:`${skipped} bereits vorhandene Projekte übersprungen. Die Originaldateien wurden nicht verändert.`});
}
async function chooseTools() {
  const result = await dialog.showOpenDialog(window,{title:'Programmordner deiner lokalen TeX-Installation auswählen',properties:['openDirectory']});
  if (result.canceled) return;
  await fs.writeFile(path.join(dataRoot,'settings.json'),JSON.stringify({toolsDirectory:result.filePaths[0]},null,2));
  await dialog.showMessageBox(window,{type:'info',message:'Programmordner gespeichert.',detail:'Du kannst den passenden Compiler in den Projekteinstellungen auswählen.'});
}
function guarded(action) { return () => action().catch(error=>dialog.showErrorBox('Aktion fehlgeschlagen',error.message)); }
async function updateApplication() {
  if (updating) return;
  if (!app.isPackaged) {
    await dialog.showMessageBox(window, { type:'info', message:'Updates sind in der installierten Desktop-Ausgabe verfügbar.', detail:'Die Entwicklungsversion wird über den Quellcode aktualisiert.' }); return;
  }
  updating = true;
  const title = window.getTitle();
  try {
    window.setProgressBar(2);
    const asset = await checkForUpdate(app.getVersion());
    window.setProgressBar(-1);
    if (!asset) {
      await dialog.showMessageBox(window, { type:'info', message:'Du verwendest die aktuelle Version.', detail:`SchriftenMinisterium ${app.getVersion()}` }); return;
    }
    const answer = await dialog.showMessageBox(window, { type:'info', buttons:['Update herunterladen', 'Später'], defaultId:0, cancelId:1, message:`Version ${asset.version} ist verfügbar.`, detail:`Installiert: ${app.getVersion()}\nDownload: ${Math.ceil(asset.size / 1024 / 1024)} MB\n\nDas Update ersetzt die Programmdateien. Projekte und Einstellungen bleiben im Benutzerprofil erhalten.` });
    if (answer.response !== 0) return;
    const installer = await downloadUpdate(asset, path.join(app.getPath('userData'), 'updates'), { onProgress: progress => { window.setProgressBar(progress); window.setTitle(`Update wird geladen · ${Math.round(progress * 100)} % · SchriftenMinisterium`); } });
    window.setProgressBar(-1); window.setTitle(title);
    const install = await dialog.showMessageBox(window, { type:'info', buttons:['Jetzt aktualisieren und neu starten', 'Später'], defaultId:0, cancelId:1, message:`Version ${asset.version} ist bereit.`, detail:'Die Anwendung speichert offene Dokumente, schließt sich und startet nach dem Update erneut. Eine laufende Kompilierung muss zuerst abgeschlossen sein.' });
    if (install.response !== 0) return;
    if (server.hasActiveJobs()) throw new Error('Bitte warte, bis die laufenden Projektaktionen abgeschlossen sind, und starte die Update-Prüfung erneut.');
    window.setEnabled(false);
    const saved = await window.webContents.executeJavaScript('window.prepareDesktopUpdate ? window.prepareDesktopUpdate() : false');
    if (!saved || server.hasActiveJobs()) throw new Error('Offene Änderungen konnten noch nicht vollständig gespeichert werden. Das Update wurde nicht gestartet.');
    await verifyInstaller(installer, asset);
    const child = spawn(installer, ['/S', '--updated', '--force-run'], { detached:true, stdio:'ignore', windowsHide:true });
    await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); }); child.unref();
    app.quit();
  } catch (error) { dialog.showErrorBox('Update nicht durchgeführt', error.message); }
  finally {
    updating = false;
    if (window && !window.isDestroyed()) { window.setEnabled(true); window.setProgressBar(-1); window.setTitle(title); }
  }
}
async function start() {
  dataRoot = path.resolve(process.env.SCHRIFTENMINISTERIUM_DATA || path.join(app.getPath('userData'),'projects'));
  // Own update cache only; project data and application settings are never cleanup targets.
  await cleanUpdateCache(path.join(app.getPath('userData'), 'updates')).catch(() => {});
  const runtime = app.isPackaged ? path.join(process.resourcesPath,'runtime') : path.join(__dirname,'runtime');
  process.env.TECTONIC_PATH = process.env.TECTONIC_PATH || path.join(runtime,'tectonic.exe');
  process.env.PATH = [runtime, path.join(process.env.ProgramFiles || 'C:/Program Files','Git/cmd'), process.env.PATH || ''].join(path.delimiter);
  const {createApp} = await import(pathToFileURL(path.join(__dirname,'../server.mjs')).href);
  server = await createApp({dataRoot});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(process.env.SCHRIFTENMINISTERIUM_DESKTOP_PORT || 3211),'127.0.0.1',resolve);});
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({width:1440,height:930,minWidth:820,minHeight:580,title:'SchriftenMinisterium',backgroundColor:'#142722',icon:path.join(__dirname,'assets/icon.ico'),show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.setWindowOpenHandler(({url})=>{ if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); return {action:'deny'}; });
  window.webContents.on('will-navigate',(event,url)=>{if (!url.startsWith(baseUrl+'/')) event.preventDefault();});
  window.webContents.on('will-prevent-unload',async event=>{
    const answer=dialog.showMessageBoxSync(window,{type:'question',buttons:['Weiter bearbeiten','Fenster schließen'],defaultId:0,cancelId:0,message:'Es gibt noch nicht gespeicherte Änderungen.'}); if(answer===1)event.preventDefault();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'Datei',submenu:[{label:'Projektübersicht',accelerator:'CmdOrCtrl+Shift+P',click:()=>window.loadURL(baseUrl+'/#/projects')},{label:'Vorhandene Projekte übernehmen …',click:guarded(importData)},{label:'Datenordner öffnen',click:()=>shell.openPath(dataRoot)},{type:'separator'},{role:'quit',label:'Beenden'}]},
    {label:'Bearbeiten',submenu:[{role:'undo',label:'Rückgängig'},{role:'redo',label:'Wiederholen'},{type:'separator'},{role:'cut',label:'Ausschneiden'},{role:'copy',label:'Kopieren'},{role:'paste',label:'Einfügen'},{role:'selectAll',label:'Alles auswählen'}]},
    {label:'Ansicht',submenu:[{role:'resetZoom',label:'Originalgröße'},{role:'zoomIn',label:'Vergrößern'},{role:'zoomOut',label:'Verkleinern'},{type:'separator'},{role:'togglefullscreen',label:'Vollbild'}]},
    {label:'Werkzeuge',submenu:[{label:'TeX-Programmordner auswählen …',click:guarded(chooseTools)}]},
    {label:'Hilfe',submenu:[{label:'Nach Updates suchen …',click:guarded(updateApplication)},{type:'separator'},{label:'Über SchriftenMinisterium',click:()=>dialog.showMessageBox(window,{type:'info',message:`SchriftenMinisterium ${app.getVersion()}`,detail:'Dein Arbeitsplatz für schriftliche Dokumentationi\n\nLokale Desktop-Anwendung.\nProjekte: '+dataRoot})}]}
  ]));
  window.once('ready-to-show',()=>window.show());
  await window.loadURL(baseUrl+'/#/projects');
  if (process.env.SCHRIFTENMINISTERIUM_SMOKE_OUTPUT) {
    await new Promise(resolve=>setTimeout(resolve,1800));
    const health=await(await fetch(baseUrl+'/api/health',{headers:{'X-Schriftenministerium-Request':'1'}})).json();
    const screenshot=await window.webContents.capturePage();
    await fs.writeFile(process.env.SCHRIFTENMINISTERIUM_SMOKE_OUTPUT+'.png',screenshot.toPNG());
    await fs.writeFile(process.env.SCHRIFTENMINISTERIUM_SMOKE_OUTPUT+'.json',JSON.stringify({desktop:true,title:window.getTitle(),health,userData:app.getPath('userData')},null,2));
    app.quit();
  }
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(server && !shuttingDown){event.preventDefault();shuttingDown=true;server.close(()=>app.quit());setTimeout(()=>app.exit(0),1500).unref();}
});
