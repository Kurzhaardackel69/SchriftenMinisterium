import { ProjectLibrary } from './library.js';
import { installFormulaDialog } from './formula-dialog.js';
import {installInsertionDialogs} from './insertion-dialogs.js';

const $ = id => document.getElementById(id);
const state = { view: 'projects', projects: [], project: null, file: null, tabs: [], collapsed: new Set(), pending: new Map(), saving: null, compiling: false, revision: 0, lastResult: null, auto: localStorage.getItem('satzwerk-auto') === 'true' };
const projectViews = new Map();
let openedProjects;
try { openedProjects = JSON.parse(localStorage.getItem('sm-open-projects') || '[]'); if (!Array.isArray(openedProjects)) openedProjects = []; } catch { openedProjects = []; }
let saveTimer, autoTimer, toastTimer, pdfViewer, pdfVersion = 0, currentSearch = -1, fileLoadVersion = 0, navigating = false;
const icon = name => { const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.classList.add('icon'); node.innerHTML = `<use href="#i-${name}"/>`; return node; };
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const endpoint = (suffix = '', id = state.project?.id) => `/api/projects/${id}${suffix}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: { 'X-SchriftenMinisterium-Request': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json();
  if (!res.ok) { const error = new Error(data.error || 'Anfrage fehlgeschlagen.'); error.status = res.status; throw error; }
  return data;
}
function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 10000 : 4000);
}
function safeAction(action) { return async (...args) => { try { await action(...args); } catch (e) { toast(e.message, true); } }; }
function on(id, action) { $(id).addEventListener('click', safeAction(action)); }
function statusSave(message, error = false) { $('save-state').textContent = message; $('save-state').classList.toggle('error', error); }

function renderCode() {
  const text = $('editor').value;
  let result = '', previous = 0;
  const pattern = /%[^\n]*|\\(?:[a-zA-Z@]+\*?|.)|\$[^$\n]*\$|[{}]|[&^_]/g;
  for (const match of text.matchAll(pattern)) {
    result += escape(text.slice(previous, match.index));
    const token = match[0], type = token[0] === '%' ? 'comment' : token[0] === '\\' ? 'command' : token[0] === '$' ? 'math' : /[{}]/.test(token) ? 'brace' : 'special';
    result += `<span class="${type}">${escape(token)}</span>`; previous = match.index + token.length;
  }
  $('highlight').firstElementChild.innerHTML = result + escape(text.slice(previous)) + '\n';
  $('line-numbers').textContent = Array.from({ length: text.split('\n').length }, (_, i) => i + 1).join('\n');
  const words = text.replace(/%[^\n]*/g, '').replace(/\\[a-zA-Z@]+\*?/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  $('word-count').textContent = `${words.length} Wörter`;
  renderOutline(); syncScroll(); updateCursor();
}
function syncScroll() {
  $('highlight').scrollTop = $('editor').scrollTop; $('highlight').scrollLeft = $('editor').scrollLeft;
  $('line-numbers').scrollTop = $('editor').scrollTop;
}
function updateCursor() {
  const before = $('editor').value.slice(0, $('editor').selectionStart), lines = before.split('\n');
  $('cursor-position').textContent = `Z ${lines.length}, S ${lines.at(-1).length + 1}`;
}
function renderOutline() {
  const container = $('outline'); container.replaceChildren();
  for (const match of $('editor').value.matchAll(/\\(part|chapter|section|subsection|subsubsection)\*?\{([^}]+)\}/g)) {
    const button = el('button', '', match[2]);
    if (match[1].startsWith('sub')) button.style.paddingLeft = '23px';
    button.title = match[2]; button.addEventListener('click', () => selectPosition(match.index)); container.append(button);
  }
  if (!container.children.length) container.append(el('p', '', 'Deine Kapitel erscheinen hier.'));
}
function selectPosition(index, length = 0) {
  const editor = $('editor'); editor.focus(); editor.setSelectionRange(index, index + length);
  editor.scrollTop = Math.max(0, (editor.value.slice(0, index).split('\n').length - 5) * parseInt(getComputedStyle(document.documentElement).getPropertyValue('--editor-line'))); syncScroll(); updateCursor();
}
function edited() {
  if (!state.project || !state.file) return;
  const key = `${state.project.id}/${state.file}`;
  state.pending.set(key, { project: state.project.id, path: state.file, content: $('editor').value, revision: ++state.revision });
  $('dirty-dot').hidden = false; statusSave('Ungespeicherte Änderungen');
  renderCode(); markStale();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => flush().catch(e => toast(e.message, true)), 650);
  clearTimeout(autoTimer); if (state.auto) autoTimer = setTimeout(() => compile().catch(e => toast(e.message, true)), 1800);
}
async function flush() {
  clearTimeout(saveTimer);
  if (state.saving) { await state.saving; if (state.pending.size) return flush(); return; }
  state.saving = (async () => {
    while (state.pending.size) {
      const [key, item] = state.pending.entries().next().value; statusSave('Speichert…');
      let success = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await api(endpoint('/file', item.project), 'PUT', { path: item.path, content: item.content }); success = true; break; }
        catch (e) { if (e.status !== 409 || attempt === 3) { statusSave('Speichern fehlgeschlagen', true); throw e; } await delay(400); }
      }
      if (success && state.pending.get(key) === item) state.pending.delete(key);
    }
    $('dirty-dot').hidden = true; statusSave('Alle Änderungen gespeichert');
  })();
  try { await state.saving; } finally { state.saving = null; }
}

function renderTree() {
  const tree = $('file-tree'); tree.replaceChildren();
  const folders = new Set();
  for (const file of state.project.files) {
    const parts = file.path.split('/');
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const folder = parts.slice(0, depth + 1).join('/');
      if (!folders.has(folder)) {
        if (parts.slice(0, depth).some((_, index) => state.collapsed.has(parts.slice(0, index + 1).join('/')))) continue;
        const row = el('button', `folder-row${state.collapsed.has(folder) ? ' collapsed' : ''}`); row.style.paddingLeft = `${8 + depth * 13}px`;
        const chevron = icon('chevron'); chevron.classList.add('folder-chevron'); row.append(chevron, icon('folder'), el('span', '', parts[depth])); row.setAttribute('aria-expanded', String(!state.collapsed.has(folder)));
        row.onclick = () => { state.collapsed.has(folder) ? state.collapsed.delete(folder) : state.collapsed.add(folder); renderTree(); }; tree.append(row); folders.add(folder);
      }
    }
    if (parts.slice(0, -1).some((_, index) => state.collapsed.has(parts.slice(0, index + 1).join('/')))) continue;
    const row = el('button', `file-row${file.path === state.file ? ' selected' : ''}`); row.setAttribute('role', 'treeitem'); row.setAttribute('aria-selected', String(file.path === state.file)); row.title = file.path;
    row.style.paddingLeft = `${10 + (parts.length - 1) * 13}px`;
    const type = file.path.endsWith('.bib') ? el('span', 'file-type', 'B') : icon(file.editable ? 'file' : 'image');
    row.append(type, el('span', 'filename', parts.at(-1)));
    if (file.path === state.project.main) row.append(el('span', 'file-tag', 'MAIN'));
    row.addEventListener('click', safeAction(() => openFile(file.path))); tree.append(row);
  }
}
function renderTabs() {
  const container = $('open-tabs'); container.replaceChildren();
  state.tabs = state.tabs.filter(name => state.project.files.some(file => file.path === name));
  for (const name of state.tabs) {
    const tab = el('div', `file-tab${state.file === name ? ' active' : ''}`), button = el('button'); button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(state.file === name)); button.title = name;
    button.append(icon('file'), el('span', '', name.split('/').at(-1))); button.onclick = safeAction(() => openFile(name)); tab.append(button);
    if (state.tabs.length > 1) { const close = el('button', 'file-tab-close'); close.append(icon('close')); close.setAttribute('aria-label', `${name} schließen`); close.onclick = safeAction(async () => {
      await flush(); const index = state.tabs.indexOf(name); state.tabs.splice(index, 1);
      if (state.file === name) await openFile(state.tabs[Math.max(0, index - 1)]); renderTabs();
    }); tab.append(close); }
    container.append(tab);
  }
  localStorage.setItem(`satzwerk-tabs-${state.project.id}`, JSON.stringify(state.tabs));
}
async function refreshProject() {
  const project = await api(endpoint()); state.project = project; state.projects = state.projects.map(p => p.id === project.id ? project : p);
  $('project-name').textContent = project.name; $('tree-project-name').textContent = project.name; document.title = `${project.name} · SchriftenMinisterium`; renderTree();
}
async function openProject(id) {
  await flush(); clearTimeout(autoTimer);
  ++fileLoadVersion;
  state.project = await api(endpoint('', id)); state.revision = 0;
  state.collapsed.clear();
  try { state.tabs = JSON.parse(localStorage.getItem(`satzwerk-tabs-${id}`) || '[]'); if (!Array.isArray(state.tabs)) state.tabs = []; } catch { state.tabs = []; }
  localStorage.setItem('satzwerk-project', id);
  $('project-name').textContent = state.project.name; $('tree-project-name').textContent = state.project.name; document.title = `${state.project.name} · SchriftenMinisterium`;
  const savedFile = localStorage.getItem(`satzwerk-file-${id}`);
  const first = state.project.files.find(f => f.path === savedFile)?.path || state.project.main || state.project.files[0]?.path;
  state.file = null; $('editor').value = ''; $('editor').disabled = true; $('binary-placeholder').hidden = true;
  if (first) await openFile(first); else { renderTree(); renderCode(); renderTabs(); $('tab-name').textContent = 'Keine Datei'; $('breadcrumb').textContent = 'Lege deine erste Datei an'; }
  state.lastResult = state.project.result; $('pdf-frame').hidden = !state.project.hasPdf; $('preview-empty').hidden = state.project.hasPdf; $('download-pdf').disabled = !state.project.hasPdf;
  pdfViewer?.clear(); pdfVersion = Date.now();
  $('log-content').textContent = state.lastResult?.log || 'Noch keine Kompilierung. Klicke auf „Kompilieren“, um dein PDF zu erstellen.';
  $('log-panel').hidden = true; setCompileStatus(state.lastResult);
  if (state.project.hasPdf && state.lastResult?.ok && state.project.sourceUpdated > (state.lastResult.sourceUpdated || state.lastResult.compiledAt)) markStale();
  statusSave('Alle Änderungen gespeichert');
  $('branch-label').textContent = 'Mit GitHub verbinden';
  api(endpoint('/git')).then(data => { if (state.project.id === id && data.initialized) $('branch-label').textContent = data.branch || 'Git-Repository'; }).catch(() => {});
}
async function openFile(name) {
  if (state.file === name) return;
  await flush(); const file = state.project.files.find(f => f.path === name); if (!file) return;
  const version = ++fileLoadVersion, projectId = state.project.id;
  $('editor').disabled = true;
  if (file.editable) {
    const data = await api(endpoint(`/file?path=${encodeURIComponent(name)}`));
    if (version !== fileLoadVersion || projectId !== state.project.id) return;
    $('editor').value = data.content; $('editor').disabled = false;
    $('binary-placeholder').hidden = true; $('highlight').hidden = false; $('line-numbers').hidden = false;
  } else {
    $('editor').value = ''; $('binary-placeholder').hidden = false; $('binary-name').textContent = name; $('highlight').hidden = true; $('line-numbers').hidden = true;
  }
  state.file = name; $('tab-name').textContent = name.split('/').at(-1); $('breadcrumb').textContent = name.replaceAll('/', '  /  ');
  if (!state.tabs.includes(name)) state.tabs.push(name);
  const language = name.endsWith('.tex') ? 'Quelltext' : name.endsWith('.bib') ? 'Literaturdaten' : file.editable ? 'Text' : 'Datei';
  $('language-badge').textContent = language; $('editor-language').textContent = language;
  $('editor').setSelectionRange(0, 0); $('editor').scrollTop = 0; $('editor').scrollLeft = 0; localStorage.setItem(`satzwerk-file-${state.project.id}`, name);
  renderTree(); renderTabs(); renderCode(); $('dirty-dot').hidden = true; document.querySelector('.workspace').classList.remove('show-files');
}
async function updatePdf() {
  const projectId = state.project.id;
  try {
    if (!pdfViewer) {
      const { PdfViewer } = await import('/pdf-viewer.js');
      pdfViewer = new PdfViewer($('pdf-frame'), count => { document.querySelector('.engine-label').textContent = `${count} ${count === 1 ? 'Seite' : 'Seiten'}`; });
    }
    if (projectId !== state.project.id) return;
    await pdfViewer.load(endpoint(`/pdf?v=${pdfVersion}`), $('zoom').value);
  } catch (error) { toast(`PDF-Anzeige: ${error.message}. Das PDF kann weiterhin heruntergeladen werden.`, true); }
}
function markStale() { if (state.project.hasPdf) { $('preview-status').className = 'preview-status'; $('preview-status').firstElementChild.textContent = 'Änderungen vorhanden · Erneut kompilieren'; } }
function setCompileStatus(result) {
  const status = $('preview-status'), summary = $('compile-summary');
  status.className = `preview-status${result ? result.ok ? ' success' : ' error' : ''}`; $('toggle-log').classList.toggle('error', result?.ok === false);
  if (!result) { status.firstElementChild.textContent = 'Dein Dokument, fertig gesetzt.'; summary.textContent = 'Bereit zum Kompilieren'; return; }
  const warning = /warning:/i.test(result.log);
  status.firstElementChild.textContent = result.ok ? warning ? 'Erfolgreich · Hinweise im Protokoll' : 'Erfolgreich kompiliert' : 'Kompilierung fehlgeschlagen · Protokoll öffnen';
  summary.textContent = result.ok ? `${warning ? 'Mit Hinweisen' : 'Erfolgreich'} · ${(result.duration / 1000).toFixed(1)} s` : 'Fehler beim Kompilieren';
}
async function compile() {
  if (state.compiling || !state.project || state.view !== 'editor') return;
  clearTimeout(autoTimer); await flush();
  const projectId = state.project.id, revision = state.revision;
  state.compiling = true; $('compile-button').disabled = true; $('compile-button').querySelector('span').textContent = 'Kompiliert…'; $('compile-overlay').hidden = false;
  $('compile-summary').textContent = 'Kompilierung läuft…';
  $('compile-phase').textContent='Projekt wird vorbereitet…';$('compile-hint').textContent='Beim ersten Lauf können benötigte Pakete heruntergeladen und vorbereitet werden. Der Cache bleibt für weitere Durchläufe erhalten.';
  let polling=false;
  const progressTimer=setInterval(async()=>{
    if(polling)return;polling=true;
    try{const progress=await api(endpoint('/compile-status',projectId));if(!progress.running||!state.compiling||state.project?.id!==projectId)return;
      const labels={prepare:'Projekt wird vorbereitet…',download:'Benötigte Pakete werden geladen…',format:'Das Grundsystem wird einmalig vorbereitet…',typeset:'Dein Dokument wird gesetzt…',bibliography:'Literaturverzeichnis wird erstellt…',pdf:'Die PDF-Datei wird erstellt…'};
      $('compile-phase').textContent=labels[progress.phase]||labels.typeset;
    }catch{/* Keep the running compile request and its final result authoritative. */}finally{polling=false;}
  },900);
  try {
    const result = await api(endpoint('/compile', projectId), 'POST', {});
    if (projectId !== state.project.id) return;
    state.lastResult = result; $('log-content').textContent = result.log || 'Kompilierung ohne Meldungen beendet.'; setCompileStatus(result);
    if (result.ok) {
      state.project.hasPdf = true; $('preview-empty').hidden = true; $('pdf-frame').hidden = false; $('download-pdf').disabled = false; pdfVersion = Date.now(); updatePdf();
      if (revision !== state.revision) markStale();
      if (window.innerWidth <= 680) { document.querySelector('.workspace').classList.add('show-preview'); toast('PDF fertig. Mit „Dateien“ zurück zum Editor.'); }
    } else $('log-panel').hidden = false;
  } catch (e) {
    $('compile-summary').textContent = 'Kompilierung fehlgeschlagen'; $('log-content').textContent = e.message; $('log-panel').hidden = false; throw e;
  } finally {
    clearInterval(progressTimer);
    state.compiling = false; $('compile-button').disabled = false; $('compile-button').querySelector('span').textContent = 'Kompilieren'; $('compile-overlay').hidden = true;
    if (state.auto && state.view === 'editor' && revision !== state.revision) { clearTimeout(autoTimer); autoTimer = setTimeout(() => compile().catch(e => toast(e.message, true)), 1200); }
  }
}

function showModal(title, eyebrow = 'DEIN ARBEITSPLATZ', wide = false) {
  $('modal-title').textContent = title; $('modal-eyebrow').textContent = eyebrow;
  $('modal-body').replaceChildren(); $('modal-footer').replaceChildren(); $('modal-error').hidden = true;
  $('modal').className = wide ? 'wide' : ''; if (!$('modal').open) $('modal').showModal();
  return $('modal-body');
}
function field(label, placeholder = '', value = '', type = 'text') {
  const wrapper = el('label', 'field'), input = el('input'); input.type = type; input.placeholder = placeholder; input.value = value;
  wrapper.append(el('span', 'field-label', label), input); return { wrapper, input };
}
function note(wrapper, text) { wrapper.append(el('small', 'field-note', text)); }
function modalButton(text, action, cls = 'primary-button') {
  const button = el('button', cls, text);
  button.addEventListener('click', async () => {
    $('modal-error').hidden = true; button.disabled = true;
    try { await action(); } catch (e) { if ($('modal').open) { $('modal-error').textContent = e.message; $('modal-error').hidden = false; } else toast(e.message, true); }
    finally { button.disabled = false; }
  }); $('modal-footer').append(button); return button;
}
function cancelButton() { modalButton('Abbrechen', () => $('modal').close(), 'secondary-button'); }

async function showSharing(project = state.project) {
  await flush();
  const url = `/api/projects/${project.id}/sharing`;
  const sharing = await api(url);
  const body = showModal('Teile deine Gedanken.', 'PROJEKT TEILEN', true);
  body.append(el('p', 'share-project-title', project.name));
  const banner = el('div', 'sharing-status'); banner.append(icon('share'));
  const explanation = el('div'); explanation.append(el('strong', '', 'Server noch nicht verbunden'), el('p', '', 'Merke Einladungen für später vor. Es werden noch keine E-Mails oder Links versendet und keine Zugriffsrechte erteilt. Gemeinsames Bearbeiten wird mit der Server-Verbindung eingerichtet.')); banner.append(explanation); body.append(banner);
  const heading = el('div', 'sharing-list-heading'); heading.append(el('h3', '', 'Vorgemerkte Einladungen'), el('span', '', String(sharing.invitations.length))); body.append(heading);
  const list = el('div', 'sharing-list');
  for (const invitation of sharing.invitations) {
    const row = el('div', 'sharing-person'), avatar = el('span', 'sharing-avatar', (invitation.name || invitation.email).slice(0, 1).toLocaleUpperCase('de'));
    const details = el('div', 'sharing-person-details'); details.append(el('strong', '', invitation.name || invitation.email));
    if (invitation.name) details.append(el('span', '', invitation.email));
    details.append(el('small', '', 'Vorgemerkt · noch nicht versendet'));
    const role = el('select'); role.setAttribute('aria-label', `Vorgesehene Rechte für ${invitation.email}`);
    for (const [value, text] of [['reader', 'Lesen'], ['editor', 'Bearbeiten']]) { const option = el('option', '', text); option.value = value; option.selected = value === invitation.role; role.append(option); }
    role.onchange = safeAction(async () => { role.disabled = true; try { await api(`${url}/invitations/${invitation.id}`, 'PATCH', { role: role.value }); } catch (error) { role.value = invitation.role; throw error; } finally { role.disabled = false; } });
    const remove = el('button', 'icon-button'); remove.append(icon('close')); remove.title = 'Vormerkung entfernen'; remove.setAttribute('aria-label', `Vormerkung für ${invitation.email} entfernen`);
    remove.onclick = safeAction(async () => { await api(`${url}/invitations/${invitation.id}`, 'DELETE'); await showSharing(project); });
    row.append(avatar, details, role, remove); list.append(row);
  }
  if (!sharing.invitations.length) list.append(el('p', 'empty-note', 'Noch keine Personen vorgemerkt. Deine Projekte bleiben privat auf deinem PC.'));
  body.append(list, el('h3', 'sharing-form-heading', 'Person für später vormerken'));
  const form = el('div', 'sharing-form'), name = field('Name (optional)', 'z. B. Alex'), email = field('E-Mail-Adresse', 'name@beispiel.de', '', 'email');
  name.input.maxLength = 100; email.input.maxLength = 254; form.append(name.wrapper, email.wrapper);
  const rights = el('label', 'field'), role = el('select'); rights.append(el('span', 'field-label', 'Vorgesehene Rechte'), role);
  for (const [value, label] of [['editor', 'Bearbeiten'], ['reader', 'Lesen']]) { const option = el('option', '', label); option.value = value; role.append(option); }
  form.append(rights); body.append(form);
  body.append(el('p', 'empty-note', 'Jetzt als ZIP teilen: Die empfangende Person importiert eine eigene Kopie. Änderungen werden dabei nicht synchronisiert. Die Vormerkliste und dein Git-Verlauf werden nicht mitgegeben.'));
  modalButton('Projekt-ZIP herunterladen', async () => { await flush(); window.location.href = `/api/projects/${project.id}/export`; }, 'secondary-button');
  modalButton('Schließen', () => $('modal').close(), 'secondary-button');
  modalButton('Einladung vormerken', async () => { await api(`${url}/invitations`, 'POST', { name: name.input.value, email: email.input.value, role: role.value }); await showSharing(project); });
}

async function showProjects() {
  closeProjectMenu();
  await flush(); clearTimeout(autoTimer);
  await library.refresh(); state.view = 'projects'; $('editor-app').hidden = true; $('library-view').hidden = false; $('file-menu').hidden = true;
  document.title = 'Deine Projekte · SchriftenMinisterium'; if (location.hash !== '#/projects') history.pushState(null, '', '#/projects');
}
async function enterProject(id) {
  if (state.compiling) { toast('Bitte warte, bis die Kompilierung abgeschlossen ist.'); return; }
  if (navigating) return; navigating = true;
  try {
    if (state.project) projectViews.set(state.project.id, { file: state.file, start: $('editor').selectionStart, end: $('editor').selectionEnd, top: $('editor').scrollTop, left: $('editor').scrollLeft, pdfTop: $('pdf-frame').scrollTop });
    await openProject(id); state.view = 'editor'; $('library-view').hidden = true; $('editor-app').hidden = false;
    if (!openedProjects.includes(id)) openedProjects.push(id); localStorage.setItem('sm-open-projects', JSON.stringify(openedProjects)); closeProjectMenu();
    const position = projectViews.get(id);
    if (position && position.file === state.file) { $('editor').setSelectionRange(position.start, position.end); $('editor').scrollTop = position.top; $('editor').scrollLeft = position.left; syncScroll(); updateCursor(); }
    if (location.hash !== `#/project/${id}`) history.pushState(null, '', `#/project/${id}`);
    applyPanelLayout();
    if (state.project.hasPdf) { await updatePdf(); if (position) $('pdf-frame').scrollTop = position.pdfTop; }
  } finally { navigating = false; }
}
function closeProjectMenu() { $('project-menu').hidden = true; $('project-switch').setAttribute('aria-expanded', 'false'); }
async function showProjectMenu() {
  if (!$('project-menu').hidden) { closeProjectMenu(); return; }
  const projects = await api('/api/projects'); openedProjects = openedProjects.filter(id => projects.some(project => project.id === id));
  if (state.project && !openedProjects.includes(state.project.id)) openedProjects.push(state.project.id);
  localStorage.setItem('sm-open-projects', JSON.stringify(openedProjects));
  const menu = $('project-menu'); menu.replaceChildren(el('div', 'project-menu-heading', 'GEÖFFNETE PROJEKTE'));
  for (const id of openedProjects) {
    const project = projects.find(item => item.id === id); if (!project) continue;
    const row = el('div', `project-menu-row${state.project?.id === id ? ' current' : ''}`), button = el('button', 'project-menu-open'); button.setAttribute('role', 'menuitem');
    button.append(icon(state.project?.id === id ? 'check' : 'folder'), el('span', '', project.name)); button.title = project.name;
    button.onclick = safeAction(async () => { closeProjectMenu(); if (state.project?.id !== id) await enterProject(id); });
    const close = el('button', 'project-menu-close'); close.append(icon('close')); close.setAttribute('aria-label', `${project.name} aus geöffneten Projekten schließen`);
    close.onclick = safeAction(async () => {
      if (state.compiling) { toast('Bitte warte, bis die Kompilierung abgeschlossen ist.'); return; }
      await flush(); openedProjects = openedProjects.filter(item => item !== id); localStorage.setItem('sm-open-projects', JSON.stringify(openedProjects)); closeProjectMenu();
      if (state.project?.id === id) { const next = openedProjects.at(-1); if (next) await enterProject(next); else await showProjects(); }
    }); row.append(button, close); menu.append(row);
  }
  const rect = $('project-switch').getBoundingClientRect(); menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 340))}px`; menu.style.top = `${rect.bottom + 8}px`;
  menu.hidden = false; $('project-switch').setAttribute('aria-expanded', 'true');
}
function newProject(importRepo, template = 'article') {
  const body = showModal(importRepo ? 'Ein Repository, dein Arbeitsplatz.' : 'Ein neues Kapitel.', importRepo ? 'GITHUB IMPORTIEREN' : 'NEUES PROJEKT');
  body.append(el('p', '', importRepo ? 'Klone ein bestehendes GitHub-Repository. Deine Dateien werden lokal gespeichert.' : 'Starte mit einer Vorlage oder einer leeren Seite. Alles bleibt auf deinem Rechner.'));
  const name = field('Projektname', 'z. B. Meine Abschlussarbeit'); body.append(name.wrapper);
  let remote, choices;
  if (importRepo) {
    remote = field('GitHub-Repository', 'https://github.com/name/projekt.git'); body.append(remote.wrapper);
    body.append(el('div', 'info-box', 'Für private Repositories nutzt Git deine vorhandene Anmeldung über Git Credential Manager oder deinen SSH-Schlüssel. Beim Import kann sich das GitHub-Anmeldefenster öffnen.'));
  } else {
    choices = el('div', 'template-options');
    for (const [value, title, description] of [['article', 'Artikel', 'Mit Formeln, Kapiteln und einem kleinen Beispiel.'], ['blank', 'Leeres Dokument', 'Das Wesentliche. Platz für deinen eigenen Anfang.']]) {
      const label = el('label', 'template-option'), radio = el('input'); radio.type = 'radio'; radio.name = 'template'; radio.value = value; radio.checked = value === template;
      label.append(radio, el('strong', '', title), el('small', '', description)); choices.append(label);
    }
    body.append(choices);
  }
  cancelButton(); modalButton(importRepo ? 'Repository klonen' : 'Projekt erstellen', async () => {
    if (state.compiling) throw new Error('Bitte warte, bis die laufende Kompilierung abgeschlossen ist.');
    await flush();
    const project = await api('/api/projects', 'POST', { name: name.input.value, ...(remote ? { remote: remote.input.value } : { template: choices.querySelector('input:checked').value }) });
    state.projects.push(project); await enterProject(project.id); $('modal').close(); toast(importRepo ? 'Repository erfolgreich importiert.' : 'Dein Projekt ist bereit.');
  }); name.input.focus();
}
function importProject() {
  const body = showModal('Aus einer Vorlage wird dein Projekt.', 'PROJEKT IMPORTIEREN');
  const methods = el('div', 'import-methods');
  for (const [id, label] of [['zip', 'Quelltext-ZIP'], ['git', 'GitHub']]) { const button = el('button', id === 'zip' ? 'active' : '', label); button.onclick = () => id === 'git' ? newProject(true) : importProject(); methods.append(button); } body.append(methods);
  body.append(el('p', '', 'Übernimm den vollständigen Quelltext deiner Vorlage. Bilder, Unterordner, Literatur und Stildateien bleiben zusammen.'));
  const name = field('Projektname', 'z. B. Meine Abschlussarbeit'); body.append(name.wrapper);
  const zone = el('label', 'zip-dropzone'), input = el('input'); input.type = 'file'; input.accept = '.zip,application/zip'; input.setAttribute('aria-label', 'Projekt-ZIP auswählen');
  const title = el('strong', '', 'ZIP-Datei auswählen oder hier ablegen'); zone.append(icon('upload'), title, el('small', '', 'Vollständiges Projekt · maximal 25 MB ZIP / 100 MB entpackt'), input); body.append(zone);
  let selectedFile;
  const select = file => { selectedFile = file; if (file) { title.textContent = file.name; if (!name.input.value.trim()) name.input.value = file.name.replace(/\.zip$/i, ''); } };
  input.onchange = () => select(input.files[0]);
  zone.ondragover = event => { event.preventDefault(); zone.classList.add('dragging'); }; zone.ondragleave = () => zone.classList.remove('dragging');
  zone.ondrop = event => { event.preventDefault(); zone.classList.remove('dragging'); select(event.dataTransfer.files[0]); };
  body.append(el('p', 'empty-note', 'Die Hauptdatei wird anhand von \\documentclass erkannt. Bei mehreren Dokumenten kannst du sie anschließend in den Projekteinstellungen ändern. Die Lizenzdateien der Vorlage werden mit übernommen.'));
  cancelButton(); modalButton('Projekt importieren', async () => {
    if (state.compiling) throw new Error('Bitte warte, bis die laufende Kompilierung abgeschlossen ist.');
    if (!selectedFile) throw new Error('Bitte das Quelltext-ZIP auswählen.');
    if (selectedFile.size > 25 * 1024 * 1024) throw new Error('Das ZIP darf maximal 25 MB groß sein.');
    const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Das ZIP konnte nicht gelesen werden.')); reader.readAsDataURL(selectedFile); });
    await flush(); const project = await api('/api/projects', 'POST', { name: name.input.value, archive: base64 });
    await enterProject(project.id); $('modal').close(); toast(`${project.importedFiles} Dateien importiert. Hauptdatei: ${project.main}`);
  });
}
function newFile() {
  const body = showModal('Platz für einen neuen Gedanken.', 'NEUE DATEI');
  const name = field('Dateiname', 'z. B. sections/methodik.tex'); body.append(name.wrapper); note(name.wrapper, 'Ordner werden automatisch erstellt. Unterstützt werden .tex, .bib, .sty und weitere Textformate.');
  cancelButton(); modalButton('Datei erstellen', async () => { await flush(); await api(endpoint('/file'), 'POST', { path: name.input.value.trim(), content: '' }); await refreshProject(); await openFile(name.input.value.trim()); $('modal').close(); $('editor').focus(); }); name.input.focus();
}
function renameFile() {
  if (!state.file) return;
  const from = state.file, body = showModal('Datei umbenennen', 'PROJEKTDATEIEN'), name = field('Neuer Dateipfad', '', from); body.append(name.wrapper);
  note(name.wrapper, 'Verweise wie \\input{…} oder \\includegraphics{…} im Quelltext bitte ebenfalls anpassen.');
  cancelButton(); modalButton('Umbenennen', async () => {
    await flush(); await api(endpoint('/rename'), 'POST', { from, to: name.input.value.trim() }); state.file = null; await refreshProject(); await openFile(name.input.value.trim()); $('modal').close(); markStale();
  }); name.input.focus();
}
function deleteFile() {
  if (!state.file) return;
  const file = state.file, body = showModal('Datei löschen?', 'PROJEKTDATEIEN'); body.append(el('p', '', `„${file}“ wird von deiner Festplatte gelöscht. Ein vorhandener Git-Commit behält frühere Versionen.`));
  cancelButton(); modalButton('Datei löschen', async () => { await flush(); await api(endpoint(`/file?path=${encodeURIComponent(file)}`), 'DELETE'); state.file = null; await refreshProject(); if (state.project.main) await openFile(state.project.main); else { $('editor').value = ''; $('editor').disabled = true; renderCode(); } $('modal').close(); markStale(); }, 'danger-button');
}
async function settings() {
  await flush(); const body = showModal('Dein Projekt. Deine Einstellungen.', 'EINSTELLUNGEN');
  const name = field('Projektname', '', state.project.name); body.append(name.wrapper);
  const label = el('label', 'field'), select = el('select'); label.append(el('span', 'field-label', 'Hauptdatei'), select);
  for (const file of state.project.files.filter(f => f.path.endsWith('.tex'))) { const option = el('option', '', file.path); option.value = file.path; option.selected = file.path === state.project.main; select.append(option); }
  body.append(label);
  const health = await api('/api/health');
  const engineLabel = el('label', 'field'), engine = el('select'); engine.setAttribute('aria-label', 'PDF-Compiler'); engineLabel.append(el('span', 'field-label', 'PDF-Compiler'), engine);
  for (const [value, title] of [['auto','Automatisch'],['tectonic','Standard (mitgeliefert)'],['pdflatex','pdfLaTeX'],['xelatex','XeLaTeX'],['lualatex','LuaLaTeX']]) {
    const option = el('option', '', title + (value !== 'auto' && !health[value] ? ' · nicht gefunden' : '')); option.value = value; option.selected = value === (state.project.compiler || 'auto'); option.disabled = value !== 'auto' && !health[value]; engine.append(option);
  }
  body.append(engineLabel); note(engineLabel, 'Eine vorhandene vollständige TeX-Installation ermöglicht zusätzliche Pakete und Werkzeuge für Literatur, Glossare und Register.');
  const toolPath = field('Programmordner der TeX-Installation (optional)', 'Automatisch erkannt oder z. B. C:\\texlive\\2026\\bin\\windows', health.toolsDirectory || ''); body.append(toolPath.wrapper);
  note(toolPath.wrapper, 'Gilt für die gesamte Anwendung. Nach einer Änderung speichern und die Einstellungen erneut öffnen, um gefundene Werkzeuge zu aktualisieren.');
  const shellOption = el('label', 'template-option'), allowShell = el('input'); allowShell.type = 'checkbox'; allowShell.checked = !!state.project.shellEscape;
  shellOption.append(allowShell, el('strong', '', 'Externe Programme zulassen (Shell-Escape)'), el('small', '', 'Nur für vertrauenswürdige eigene Projekte mit vollständigem Compiler: Erlaubt dem Dokument, lokale Programme auszuführen. Der Standard-Compiler unterstützt diese Option nicht.')); body.append(shellOption);
  const updateShell = () => { allowShell.disabled = engine.value === 'tectonic' || (engine.value === 'auto' && !health.pdflatex); }; updateShell(); engine.onchange = updateShell;
  const size = field('Schriftgröße im Editor', '', localStorage.getItem('satzwerk-font') || '14', 'number'); size.input.min = '12'; size.input.max = '24'; body.append(size.wrapper);
  const auto = el('label', 'template-option'), check = el('input'); check.type = 'checkbox'; check.checked = state.auto; auto.append(check, el('strong', '', 'Nach Änderungen automatisch kompilieren'), el('small', '', 'Startet nach einer kurzen Schreibpause. Manuell jederzeit mit Strg + Enter.')); body.append(auto);
  body.append(el('div', 'info-box', `${health.tectonic || health.pdflatex || health.xelatex || health.lualatex ? '✓ PDF-Erzeugung verfügbar' : '✕ PDF-Erzeugung nicht eingerichtet'} · ${health.git ? '✓ Versionsverwaltung verfügbar' : '✕ Versionsverwaltung nicht eingerichtet'}\nLiteratur: ${health.biber ? 'Biber' : health.bibtex ? 'BibTeX' : 'Zusatzwerkzeug nicht gefunden'} · Glossare: ${health.makeglossaries ? 'verfügbar' : 'Zusatzwerkzeug nicht gefunden'}\nDie PDF-Erzeugung läuft lokal auf deinem PC.`));
  cancelButton(); modalButton('Einstellungen speichern', async () => {
    const font = Number(size.input.value); if (font < 12 || font > 24) throw new Error('Bitte eine Schriftgröße zwischen 12 und 24 wählen.');
    if (toolPath.input.value.trim() !== (health.toolsDirectory || '')) await api('/api/runtime', 'PUT', { toolsDirectory: toolPath.input.value });
    await api(endpoint(), 'PATCH', { name: name.input.value, compiler: engine.value, shellEscape: allowShell.checked, ...(select.value ? { main: select.value } : {}) });
    const mainChanged = select.value !== state.project.main || engine.value !== state.project.compiler || allowShell.checked !== state.project.shellEscape;
    localStorage.setItem('satzwerk-font', String(font)); applyFont(font); state.auto = check.checked; localStorage.setItem('satzwerk-auto', String(state.auto)); clearTimeout(autoTimer);
    await refreshProject(); if (mainChanged) markStale(); $('modal').close(); toast('Einstellungen gespeichert.');
  });
}
function applyFont(size) { document.documentElement.style.setProperty('--editor-size', `${size}px`); document.documentElement.style.setProperty('--editor-line', `${Math.round(size * 1.8)}px`); }

async function showGit() {
  await flush(); const projectId = state.project.id;
  const body = showModal('Jede Version zählt.', 'GITHUB & VERSIONEN', true); body.append(el('p', '', 'Repository-Status wird geladen…'));
  let status; try { status = await api(endpoint('/git')); } catch (e) { body.replaceChildren(el('div', 'info-box', e.message)); return; }
  if (!$('modal').open || projectId !== state.project.id) return;
  if (!status.initialized || !status.remote) return connectGit(status);
  $('branch-label').textContent = status.branch; body.replaceChildren();
  const head = el('div', 'git-status-head'), desc = el('div'); desc.append(el('strong', '', status.branch || 'Kein Branch'), el('small', '', status.remote));
  const configure = el('button', 'small-button', 'Einrichten'); configure.onclick = () => connectGit(status); head.append(icon('git'), desc, configure); body.append(head);
  const actions = el('div', 'git-actions'), pull = el('button', 'secondary-button', `Pull${status.behind ? ` (${status.behind})` : ''}`), push = el('button', 'primary-button', `Push${status.ahead ? ` (${status.ahead})` : ''}`);
  pull.prepend(icon('download')); push.prepend(icon('upload')); actions.append(pull, push); body.append(actions);
  const doGit = async (action, message) => {
    $('modal-error').hidden = true; actions.classList.add('busy-ui'); body.classList.add('busy-ui');
    try {
      await flush(); await api(endpoint('/git'), 'POST', { action, ...(message ? { message } : {}) });
      if (action === 'pull') { const active = state.file; state.file = null; await refreshProject(); await openFile(state.project.files.some(f => f.path === active) ? active : state.project.main); markStale(); }
      await showGit(); toast(action === 'commit' ? 'Änderungen lokal committet.' : action === 'push' ? 'Änderungen zu GitHub übertragen.' : 'Stand von GitHub geladen.');
    } catch (e) {
      $('modal-error').textContent = `${e.message}${/auth|permission|credential|publickey|could not read/i.test(e.message) ? '\nPrüfe deine GitHub-Anmeldung im Git Credential Manager oder deinen SSH-Schlüssel. Hinweise stehen in der README.' : ''}`; $('modal-error').hidden = false;
    } finally { actions.classList.remove('busy-ui'); body.classList.remove('busy-ui'); }
  };
  pull.onclick = () => doGit('pull'); push.onclick = () => doGit('push');
  body.append(el('h3', 'section-label', `Lokale Änderungen · ${status.changes.length}`));
  if (status.changes.length) {
    const list = el('div', 'change-list'); for (const change of status.changes) { const row = el('div', 'change-row'); row.append(el('code', '', change.status.trim()), el('span', '', change.path)); list.append(row); } body.append(list);
    const message = field('Commit-Nachricht', 'Was hast du geändert?'); body.append(message.wrapper);
    const commit = el('button', 'secondary-button', 'Alle Änderungen committen'); commit.onclick = () => { if (!message.input.value.trim()) { message.input.focus(); return; } doGit('commit', message.input.value); }; body.append(commit);
    note(message.wrapper, 'Erstellt einen lokalen Commit mit allen oben aufgeführten Änderungen. Push überträgt ihn anschließend zu GitHub.');
  } else body.append(el('p', 'empty-note', 'Alles aufgeräumt. Keine lokalen Änderungen.'));
  body.append(el('h3', 'section-label', 'Die letzten Versionen'));
  for (const commit of status.history) {
    const row = el('div', 'commit-row'); row.append(el('strong', '', commit.subject), el('small', '', `${commit.author} · ${new Date(commit.date).toLocaleString('de-DE')}`), el('code', '', commit.hash)); body.append(row);
  }
  if (!status.history.length) body.append(el('p', 'empty-note', 'Dein erster Commit wartet auf dich.'));
  body.append(el('p', 'empty-note', 'Pull führt ausschließlich Fast-Forward-Updates aus. Bei Konflikten bleiben deine lokalen Änderungen erhalten; löse sie mit Git im Projektordner.'));
}
function connectGit(status = {}) {
  const body = showModal('Verbinde deine Ideen.', 'GITHUB EINRICHTEN');
  body.append(el('p', '', 'Verbinde dieses Projekt mit einem GitHub-Repository. Für ein bestehendes Repository nutze „Von GitHub importieren“ in der Projektübersicht.'));
  const remote = field('GitHub-Repository', 'https://github.com/name/projekt.git', status.remote || ''); body.append(remote.wrapper);
  const row = el('div', 'field-row'), author = field('Commit-Name (optional)', 'Dein Name'), email = field('Commit-E-Mail (optional)', 'name@example.com', '', 'email'); row.append(author.wrapper, email.wrapper); body.append(row);
  body.append(el('div', 'info-box', 'Name und E-Mail werden nur für dieses Repository gespeichert. Ohne diese Angaben verwendet Git deine bestehende Konfiguration. SchriftenMinisterium speichert keine GitHub-Tokens. Lege das Ziel-Repository zuerst auf GitHub an; für ein neues Projekt am besten leer.'));
  cancelButton(); modalButton('Repository verbinden', async () => {
    await flush(); await api(endpoint('/git'), 'POST', { action: 'connect', remote: remote.input.value, authorName: author.input.value, authorEmail: email.input.value });
    await showGit(); toast('Repository verbunden. Erstelle einen Commit und übertrage ihn mit Push.');
  });
}
function showHelp() {
  const body = showModal('Weniger klicken. Mehr schreiben.', 'WILLKOMMEN IM SCHRIFTENMINISTERIUM');
  body.append(el('p', '', 'Dein Arbeitsplatz für schriftliche Dokumentationi läuft auf deinem PC. Änderungen werden automatisch gespeichert. Kompiliere die Hauptdatei, um das PDF rechts zu aktualisieren.'));
  body.append(el('p', '', 'Formeln: Rechtsklick an die gewünschte Stelle im Quelltext → Formel einfügen. Alternativ ∑ in der Werkzeugleiste verwenden. Eingaben wie (a+b)/c oder WURZEL(x) werden vor dem Einfügen als Vorschau und TeX-Code angezeigt.'));
  body.append(el('p', '', 'Tabellen und Bilder: über Rechtsklick oder die Symbole neben ∑. Tabellen direkt im Raster bearbeiten oder aus Excel/Calc einfügen. Bilder als PNG/JPEG auswählen und Breite sowie Beschriftung festlegen.'));
  const table = el('table', 'help-table');
  for (const [label, shortcut] of [['Speichern', 'Strg + S'], ['PDF kompilieren', 'Strg + Enter'], ['Im Dokument suchen', 'Strg + F'], ['Einrücken', 'Tab'], ['Kommentar umschalten', 'Strg + /']]) { const row = el('tr'); row.append(el('td', '', label), el('td', '', shortcut)); table.append(row); } body.append(table);
  body.append(el('div', 'info-box', 'Desktop: Datei → Datenordner öffnen zeigt deine Projekte. Sichere diesen Ordner regelmäßig.\n\nUpdates: Hilfe → Nach Updates suchen lädt neue Desktop-Versionen. Projekte und Einstellungen bleiben erhalten.\n\nTeilen: Gib eine Projektkopie als ZIP weiter oder merke Personen und ihre vorgesehenen Rechte vor. Einladungen und gemeinsames Bearbeiten werden mit der späteren Server-Verbindung aktiviert.'));
  modalButton('Los geht’s', () => $('modal').close());
}

function showFind() { $('find-bar').hidden = false; $('find-input').focus(); $('find-input').select(); }
function find(next = false) {
  const query = $('find-input').value, text = $('editor').value, positions = [];
  if (!query) { $('find-count').textContent = ''; return; }
  const lower = text.toLocaleLowerCase(), needle = query.toLocaleLowerCase(); let start = 0;
  while ((start = lower.indexOf(needle, start)) !== -1) { positions.push(start); start += needle.length; }
  currentSearch = next ? (currentSearch + 1) % Math.max(1, positions.length) : 0;
  $('find-count').textContent = positions.length ? `${currentSearch + 1} / ${positions.length}` : 'Kein Treffer';
  if (positions.length) selectPosition(positions[currentSearch], query.length);
}
function insertText(text, start = $('editor').selectionStart, end = $('editor').selectionEnd) {
  $('editor').setSelectionRange(start,end);
  $('editor').focus(); document.execCommand('insertText', false, text);
  // execCommand preserves the browser's native undo stack for ordinary insertions.
  if ($('editor').selectionStart === start && $('editor').selectionEnd === end && text) { $('editor').setRangeText(text, start, end, 'end'); edited(); }
}
$('editor').addEventListener('input', edited); $('editor').addEventListener('scroll', syncScroll); $('editor').addEventListener('click', updateCursor); $('editor').addEventListener('keyup', updateCursor);
$('editor').addEventListener('keydown', event => {
  const editor = $('editor');
  if (event.key === 'Tab') {
    event.preventDefault();
    if (editor.selectionStart !== editor.selectionEnd) {
      const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1, end = editor.selectionEnd;
      const block = editor.value.slice(start, end).split('\n').map(line => event.shiftKey ? line.replace(/^ {1,2}/, '') : '  ' + line).join('\n');
      editor.setSelectionRange(start, end); insertText(block, start, end);
    } else if (!event.shiftKey) insertText('  ');
  } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault(); const line = editor.value.slice(0, editor.selectionStart).split('\n').at(-1); insertText('\n' + (line.match(/^\s*/)?.[0] || ''));
  } else if ((event.ctrlKey || event.metaKey) && (event.key === '/' || event.code === 'Slash')) {
    event.preventDefault(); const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1, lineEnd = editor.value.indexOf('\n', editor.selectionEnd), end = lineEnd === -1 ? editor.value.length : lineEnd;
    const lines = editor.value.slice(start, end).split('\n'), uncomment = lines.every(line => /^\s*%/.test(line));
    editor.setSelectionRange(start, end); insertText(lines.map(line => uncomment ? line.replace(/^(\s*)% ?/, '$1') : '% ' + line).join('\n'), start, end);
  }
});
document.addEventListener('keydown', event => {
  if ($('modal').open) { if (event.key === 'Enter' && event.target.tagName === 'INPUT' && !['radio', 'checkbox', 'file', 'color'].includes(event.target.type)) { event.preventDefault(); $('modal-footer').querySelector('.primary-button')?.click(); } return; }
  if (state.view === 'projects') {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('project-search').focus(); }
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 's') { event.preventDefault(); flush().catch(e => toast(e.message, true)); }
    if (event.key === 'Enter') { event.preventDefault(); compile().catch(e => toast(e.message, true)); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); showFind(); }
  }
  if (event.key === 'Escape') { $('file-menu').hidden = true; $('find-bar').hidden = true; closeProjectMenu(); }
});
window.addEventListener('beforeunload', event => { if (state.pending.size) { event.preventDefault(); event.returnValue = ''; } });
$('find-input').addEventListener('input', () => { currentSearch = -1; find(); $('find-input').focus(); });
$('find-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); find(true); } });
on('find-next', () => find(true)); on('find-close', () => { $('find-bar').hidden = true; $('editor').focus(); });
on('nav-search', showFind); on('project-switch', showProjectMenu); on('new-file', newFile); on('upload-file', () => $('file-input').click());
on('back-projects', showProjects);
on('github-button', showGit); on('nav-git', showGit); on('sidebar-git', showGit); on('nav-settings', settings); on('nav-help', showHelp);
on('share-project', () => showSharing());
on('nav-files', () => { document.querySelector('.workspace').classList.remove('show-preview'); if (window.innerWidth <= 680) document.querySelector('.workspace').classList.toggle('show-files'); });
on('compile-button', compile); on('first-compile', compile); on('modal-close', () => $('modal').close());
on('download-pdf', () => { window.location.href = endpoint('/pdf?download=1'); });
on('binary-download', () => { window.location.href = endpoint(`/asset?path=${encodeURIComponent(state.file)}`); });
on('toggle-log', () => { $('log-panel').hidden = !$('log-panel').hidden; }); on('close-log', () => { $('log-panel').hidden = true; });
on('copy-log', async () => { await navigator.clipboard.writeText($('log-content').textContent); toast('Protokoll kopiert.'); });
$('zoom').addEventListener('change', () => { if (state.project.hasPdf) updatePdf(); });
on('file-menu-button', () => { const rect = $('file-menu-button').getBoundingClientRect(); $('file-menu').style.top = `${rect.bottom + 6}px`; $('file-menu').style.left = `${Math.max(8, rect.right - 215)}px`; $('file-menu').hidden = !$('file-menu').hidden; });
document.addEventListener('click', event => { if (!event.target.closest('#file-menu') && !event.target.closest('#file-menu-button')) $('file-menu').hidden = true; if (!event.target.closest('#project-menu') && !event.target.closest('#project-switch')) closeProjectMenu(); });
on('rename-file', () => { $('file-menu').hidden = true; renameFile(); }); on('delete-file', () => { $('file-menu').hidden = true; deleteFile(); });
on('set-main', async () => { $('file-menu').hidden = true; await flush(); await api(endpoint(), 'PATCH', { main: state.file }); await refreshProject(); markStale(); toast('Hauptdatei festgelegt.'); });
$('file-input').addEventListener('change', safeAction(async event => {
  const files = [...event.target.files]; event.target.value = ''; await flush();
  let uploaded = 0;
  try {
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: maximal 10 MB pro Datei.`);
      const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.')); reader.readAsDataURL(file); });
      await api(endpoint('/file'), 'POST', { path: file.name, base64 }); uploaded++;
    }
  } finally { await refreshProject(); if (uploaded) { markStale(); toast(`${uploaded} ${uploaded === 1 ? 'Datei hochgeladen' : 'Dateien hochgeladen'}.`); } }
}));
let panelLayout;
try { panelLayout = JSON.parse(localStorage.getItem('sm-panel-layout') || '{}'); if (!panelLayout || typeof panelLayout !== 'object') panelLayout = {}; } catch { panelLayout = {}; }
function applyPanelLayout() {
  const root = document.documentElement;
  for (const [key, variable] of [['sidebar','--sidebar-width'],['editor','--editor-width'],['outline','--outline-height'],['log','--log-height']]) if (Number.isFinite(panelLayout[key])) root.style.setProperty(variable, `${panelLayout[key]}px`);
}
function savePanels() { localStorage.setItem('sm-panel-layout', JSON.stringify(panelLayout)); applyPanelLayout(); }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function resizePanel(type, x, y) {
  const workspace = document.querySelector('.workspace').getBoundingClientRect(), sidebar = $('sidebar').getBoundingClientRect(), editor = $('editor-pane').getBoundingClientRect();
  if (type === 'sidebar') { panelLayout.sidebar = clamp(x - sidebar.left, 150, Math.max(150, Math.min(workspace.width * .45, workspace.width - 570))); if (panelLayout.editor) panelLayout.editor = clamp(panelLayout.editor, 230, Math.max(230, workspace.right - sidebar.left - panelLayout.sidebar - 255)); }
  if (type === 'editor') panelLayout.editor = clamp(x - editor.left, 230, Math.max(230, workspace.right - editor.left - 245));
  if (type === 'outline') panelLayout.outline = clamp(sidebar.bottom - 43 - y, 70, Math.max(70, sidebar.height - 230));
  if (type === 'log') { const preview = document.querySelector('.preview-pane').getBoundingClientRect(); panelLayout.log = clamp(preview.bottom - 30 - y, 85, Math.max(85, preview.height - 220)); }
  savePanels();
}
for (const [id, type, vertical] of [['sidebar-splitter','sidebar',true],['splitter','editor',true],['outline-splitter','outline',false],['log-splitter','log',false]]) {
  const divider = $(id);
  divider.addEventListener('pointerdown', event => { divider.setPointerCapture(event.pointerId); document.body.classList.add('resizing', vertical ? 'resizing-columns' : 'resizing-rows'); });
  divider.addEventListener('pointermove', event => { if (divider.hasPointerCapture(event.pointerId)) resizePanel(type, event.clientX, event.clientY); });
  const finish = () => document.body.classList.remove('resizing','resizing-columns','resizing-rows');
  divider.addEventListener('pointerup', event => { if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId); finish(); }); divider.addEventListener('lostpointercapture', finish);
  divider.addEventListener('dblclick', () => { delete panelLayout[type]; const variables = {sidebar:'--sidebar-width',editor:'--editor-width',outline:'--outline-height',log:'--log-height'}; document.documentElement.style.removeProperty(variables[type]); savePanels(); });
  divider.addEventListener('keydown', event => { const keys = vertical ? ['ArrowLeft','ArrowRight'] : ['ArrowUp','ArrowDown']; if (!keys.includes(event.key)) return; event.preventDefault(); const rect = divider.getBoundingClientRect(), step = event.key === keys[0] ? -20 : 20; resizePanel(type, rect.left + (vertical ? step : 0), rect.top + (vertical ? 0 : step)); });
}
new MutationObserver(() => { $('log-splitter').hidden = $('log-panel').hidden; }).observe($('log-panel'), { attributes:true, attributeFilter:['hidden'] });

for (const [id, command] of [['tool-undo', 'undo'], ['tool-redo', 'redo']]) on(id, () => { if (!$('editor').disabled) { $('editor').focus(); document.execCommand(command); } });
const insertionContext=()=>({project:state.project?.id,file:state.file,main:state.project?.main,files:state.project?.files||[],editable:!$('editor').disabled&&!!state.file?.endsWith('.tex')});
const insertionDialogs=installInsertionDialogs({el,icon,showModal,modalButton,field,toast,api,flush,insert:insertText,getContext:insertionContext,applyImage:async(result,saved)=>{
  const scroll=$('editor').scrollTop;insertText(result.content,0,$('editor').value.length);
  const block=result.edits.find(edit=>edit.start===saved.start&&edit.end===saved.end),shift=result.edits.filter(edit=>edit!==block&&edit.start<=saved.start).reduce((sum,edit)=>sum+edit.text.length-(edit.end-edit.start),0);
  const caret=saved.start+shift+(block?.text.length||0);$('editor').setSelectionRange(caret,caret);$('editor').scrollTop=scroll;syncScroll();updateCursor();
  clearTimeout(saveTimer);state.pending.delete(`${saved.project}/${saved.file}`);$('dirty-dot').hidden=true;statusSave('Alle Änderungen gespeichert');await refreshProject();toast(result.mainUpdated?'Bild eingefügt; graphicx in der Hauptdatei ergänzt.':'Bild eingefügt.');
}});
const openFormula = installFormulaDialog({el,icon,showModal,modalButton,toast,insert:insertText,getContext:insertionContext,extraActions:[{label:'Tabelle einfügen …',icon:'grid',open:insertionDialogs.table},{label:'Bild einfügen …',icon:'image',open:insertionDialogs.image}]});
on('tool-math',openFormula);
on('tool-table',()=>insertionDialogs.table());on('tool-image',()=>insertionDialogs.image());
for (const [id, before, fallback, after] of [['tool-bold', '\\textbf{', 'Text', '}'], ['tool-italic', '\\textit{', 'Text', '}'], ['tool-section', '\\section{', 'Abschnitt', '}'], ['tool-cite', '\\cite{', 'quelle', '}']]) on(id, () => {
  const editor = $('editor'); if (editor.disabled) return; const start = editor.selectionStart, selected = editor.value.slice(start, editor.selectionEnd) || fallback;
  insertText(before + selected + after); editor.setSelectionRange(start + before.length, start + before.length + selected.length); updateCursor();
});
$('editor-layout').addEventListener('change', () => {
  const workspace = document.querySelector('.workspace'), value = $('editor-layout').value;
  workspace.classList.toggle('layout-code', value === 'code'); workspace.classList.toggle('layout-pdf', value === 'pdf');
  workspace.classList.toggle('show-preview', value === 'pdf');
});

const library = new ProjectLibrary({ api, el, icon, toast, showModal, field, modalButton, cancelButton, showHelp, showSharing, newProject, importProject, openProject: enterProject });
window.openProjectOverview = async () => { if (state.compiling) throw new Error('Bitte warte, bis die Kompilierung abgeschlossen ist.'); await showProjects(); };
window.schriftenministeriumReady = true;
window.prepareDesktopUpdate = async () => {
  if (state.compiling || navigating) return false;
  clearTimeout(autoTimer); await flush();
  return state.pending.size === 0 && !state.compiling;
};
async function route() {
  const match = location.hash.match(/^#\/project\/([a-f0-9-]{36})$/);
  if (match) {
    try { await enterProject(match[1]); }
    catch (error) { await showProjects(); toast(error.message, true); }
  } else await showProjects();
}
window.addEventListener('hashchange', safeAction(route));

async function init() {
  applyFont(Number(localStorage.getItem('satzwerk-font') || 14));
  await route();
  api('/api/health').then(health => { if (!health.tectonic && !health.pdflatex && !health.xelatex && !health.lualatex) toast('Die lokale PDF-Erzeugung ist noch nicht eingerichtet. Hinweise stehen in der README.', true); }).catch(() => {});
}
init().catch(error => { statusSave('Verbindung fehlgeschlagen', true); $('preview-empty').querySelector('p').textContent = error.message; toast(error.message, true); });
