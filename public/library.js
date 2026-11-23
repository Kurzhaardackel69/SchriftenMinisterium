const $ = id => document.getElementById(id);
const tagColors = [
  ['Grün', '#59a57b'], ['Tannengrün', '#147d64'], ['Blau', '#4688b1'],
  ['Türkis', '#3d9b9f'], ['Violett', '#8b6bb1'], ['Rosa', '#c36f94'],
  ['Rot', '#c76b64'], ['Orange', '#ce9457'], ['Gold', '#b8a348'], ['Grau', '#7b8b96']
];

export class ProjectLibrary {
  constructor(ui) {
    Object.assign(this, ui); this.projects = []; this.tags = []; this.filter = 'all'; this.tagId = null; this.selected = new Set();
    this.bind('library-new', () => this.newProject(false)); this.bind('library-import', () => this.importProject()); this.bind('library-help', () => this.showHelp());
    this.bind('create-tag', () => this.editTag());
    this.bind('library-nav-toggle', () => { const expanded = document.querySelector('.library-shell').classList.toggle('sidebar-expanded'); $('library-nav-toggle').setAttribute('aria-expanded', String(expanded)); });
    for (const type of ['all', 'starred', 'archive', 'untagged', 'templates']) this.bind(`filter-${type}`, () => this.setFilter(type));
    $('project-search').addEventListener('input', () => { this.selected.clear(); this.renderRows(); });
    $('project-sort').addEventListener('change', () => this.renderRows());
    $('select-projects').addEventListener('change', event => { this.visibleProjects().forEach(project => event.target.checked ? this.selected.add(project.id) : this.selected.delete(project.id)); this.renderRows(); });
    this.bind('clear-selection', () => { this.selected.clear(); this.renderRows(); });
    this.bind('bulk-tags', () => this.assignTags([...this.selected]));
    this.bind('bulk-archive', async () => {
      const restore = this.filter === 'archive';
      for (const id of this.selected) await this.api(`/api/projects/${id}`, 'PATCH', { archived: !restore });
      this.selected.clear(); await this.refresh(); this.toast(restore ? 'Projekte wiederhergestellt.' : 'Projekte archiviert.');
    });
  }
  bind(id, action) { $(id).addEventListener('click', () => this.act(action)); }
  async act(action) { try { await action(); } catch (error) { this.toast(error.message, true); } }
  async refresh() {
    [this.projects, this.tags] = await Promise.all([this.api('/api/projects'), this.api('/api/tags')]);
    this.selected = new Set([...this.selected].filter(id => this.projects.some(p => p.id === id)));
    if (this.filter === 'tag' && !this.tags.some(tag => tag.id === this.tagId)) this.filter = 'all';
    this.render();
  }
  setFilter(type, id = null) { this.filter = type; this.tagId = id; this.selected.clear(); this.render(); document.querySelector('.library-shell').classList.remove('sidebar-expanded'); $('library-nav-toggle').setAttribute('aria-expanded', 'false'); }
  visibleProjects() {
    const search = $('project-search').value.trim().toLocaleLowerCase('de');
    const sort = $('project-sort').value;
    return this.projects.filter(project => {
      if (this.filter === 'archive' ? !project.archived : project.archived) return false;
      if (this.filter === 'starred' && !project.starred) return false;
      if (this.filter === 'untagged' && project.tags.some(id => this.tags.some(t => t.id === id))) return false;
      if (this.filter === 'tag' && !project.tags.includes(this.tagId)) return false;
      const tagNames = this.tags.filter(tag => project.tags.includes(tag.id)).map(tag => tag.name).join(' ');
      return !search || `${project.name} ${tagNames}`.toLocaleLowerCase('de').includes(search);
    }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'de') : b[sort === 'created' ? 'created' : 'updated'].localeCompare(a[sort === 'created' ? 'created' : 'updated']));
  }
  mark(color) { const span = this.el('span', 'tag-color-mark'); span.style.setProperty('--tag-color', color); return span; }
  render() {
    const active = this.projects.filter(p => !p.archived);
    $('count-all').textContent = active.length; $('count-starred').textContent = active.filter(p => p.starred).length; $('count-archive').textContent = this.projects.filter(p => p.archived).length;
    $('count-untagged').textContent = active.filter(p => !p.tags.some(id => this.tags.some(t => t.id === id))).length;
    for (const button of document.querySelectorAll('.library-nav')) { button.classList.remove('active'); button.removeAttribute('aria-current'); }
    if (this.filter !== 'tag') { $(`filter-${this.filter}`).classList.add('active'); $(`filter-${this.filter}`).setAttribute('aria-current', 'page'); }
    const list = $('library-tags'); list.replaceChildren();
    for (const tag of this.tags) {
      const row = this.el('div', 'library-tag-row'), button = this.el('button', `library-nav${this.filter === 'tag' && this.tagId === tag.id ? ' active' : ''}`);
      button.append(this.mark(tag.color), this.el('span', '', tag.name), this.el('span', 'nav-count', active.filter(p => p.tags.includes(tag.id)).length));
      button.title = `Nach „${tag.name}“ filtern`; button.onclick = () => this.setFilter('tag', tag.id);
      if (this.filter === 'tag' && this.tagId === tag.id) button.setAttribute('aria-current', 'page');
      const edit = this.el('button', 'tag-edit-button'); edit.append(this.icon('more')); edit.title = `${tag.name} bearbeiten`; edit.setAttribute('aria-label', `Tag ${tag.name} bearbeiten`); edit.onclick = () => this.editTag(tag);
      row.append(button, edit); list.append(row);
    }
    if (!this.tags.length) list.append(this.el('p', 'no-tags-note', 'Mit Tags behältst du den Überblick. Erstelle deinen ersten Tag mit +.'));
    const titles = { all: 'Alle Projekte', starred: 'Favoriten', archive: 'Archiv', untagged: 'Ohne Tag', templates: 'Vorlagen', tag: this.tags.find(t => t.id === this.tagId)?.name || 'Projekte' };
    $('library-title').firstChild.textContent = titles[this.filter] + ' ';
    $('library-subtitle').textContent = this.filter === 'templates' ? 'Ein guter Anfang für dein nächstes Projekt.' : this.filter === 'archive' ? 'Abgeschlossene Projekte bleiben erhalten und lassen sich jederzeit wiederherstellen.' : 'Von der ersten Idee bis zur letzten Seite.';
    $('project-list-view').hidden = this.filter === 'templates'; $('template-list-view').hidden = this.filter !== 'templates'; $('project-count').hidden = this.filter === 'templates';
    if (this.filter === 'templates') this.renderTemplates(); else this.renderRows();
  }
  renderRows() {
    const projects = this.visibleProjects(), body = $('project-rows'); body.replaceChildren();
    const visible = new Set(projects.map(p => p.id)); this.selected = new Set([...this.selected].filter(id => visible.has(id)));
    for (const project of projects) {
      const row = this.el('tr', this.selected.has(project.id) ? 'selected-project' : ''), checkCell = this.el('td', 'check-column'), check = this.el('input'); check.type = 'checkbox'; check.checked = this.selected.has(project.id); check.setAttribute('aria-label', `${project.name} auswählen`);
      check.onchange = () => { check.checked ? this.selected.add(project.id) : this.selected.delete(project.id); this.renderRows(); }; checkCell.append(check); row.append(checkCell);
      const starCell = this.el('td', 'star-column'), star = this.el('button', `project-star${project.starred ? ' starred' : ''}`); star.append(this.icon('star')); star.title = project.starred ? 'Aus Favoriten entfernen' : 'Als Favorit markieren'; star.setAttribute('aria-label', `${project.name}: ${star.title}`); star.setAttribute('aria-pressed', String(project.starred));
      star.onclick = () => this.act(async () => { star.disabled = true; await this.api(`/api/projects/${project.id}`, 'PATCH', { starred: !project.starred }); await this.refresh(); }); starCell.append(star); row.append(starCell);
      const titleCell = this.el('td'), open = this.el('button', 'project-open-button'), title = this.el('div'); title.append(this.el('strong', '', project.name), this.el('small', '', project.main || 'Hauptdatei noch auswählen'));
      open.append(this.icon('file'), title); open.title = `${project.name} im Editor öffnen`; open.onclick = () => this.act(() => this.openProject(project.id)); titleCell.append(open); row.append(titleCell);
      const tagsCell = this.el('td'), chips = this.el('div', 'project-tags-cell');
      for (const tag of this.tags.filter(t => project.tags.includes(t.id))) { const chip = this.el('button', 'project-tag'); chip.append(this.mark(tag.color), this.el('span', '', tag.name)); chip.title = `Tag „${tag.name}“ filtern`; chip.onclick = () => this.setFilter('tag', tag.id); chips.append(chip); }
      const add = this.el('button', 'add-project-tag', chips.children.length ? '+' : '+ Tag'); add.title = `Tags für ${project.name} bearbeiten`; add.setAttribute('aria-label', add.title); add.onclick = () => this.assignTags([project.id]); chips.append(add); tagsCell.append(chips); row.append(tagsCell);
      const owner = this.el('td', 'owner-cell'), ownerLabel = this.el('span', 'row-owner'); ownerLabel.append(this.el('span', '', 'DU'), document.createTextNode('Du')); owner.append(ownerLabel); row.append(owner);
      const dateCell = this.el('td', 'project-date'), date = new Date(project.updated); dateCell.textContent = date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }); dateCell.title = date.toLocaleString('de-DE'); dateCell.append(this.el('small', '', `um ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`)); row.append(dateCell);
      const actionCell = this.el('td'), manage = this.el('button', 'icon-button'); manage.append(this.icon('more')); manage.title = `${project.name} verwalten`; manage.setAttribute('aria-label', manage.title); manage.onclick = () => this.manage(project); actionCell.append(manage); row.append(actionCell); body.append(row);
    }
    $('project-count').textContent = projects.length; $('library-empty').hidden = projects.length !== 0;
    $('empty-title').textContent = $('project-search').value ? 'Kein passendes Projekt gefunden.' : this.filter === 'archive' ? 'Dein Archiv ist noch leer.' : this.filter === 'all' ? 'Hier ist Platz für deine Projekte.' : 'Hier sind noch keine Projekte.';
    $('empty-copy').textContent = $('project-search').value ? 'Versuche einen anderen Projektnamen oder Tag.' : this.filter === 'archive' ? 'Archivierte Projekte erscheinen hier. Deine Dateien bleiben dabei erhalten.' : 'Erstelle ein Projekt, importiere eine Vorlage oder passe deine Filter an.';
    $('library-result-count').textContent = `${projects.length} ${projects.length === 1 ? 'Projekt' : 'Projekte'}${$('project-search').value ? ' gefunden' : ''}`;
    $('bulk-toolbar').hidden = !this.selected.size; $('selection-count').textContent = `${this.selected.size} ausgewählt`;
    $('bulk-archive').lastChild.textContent = this.filter === 'archive' ? 'Wiederherstellen' : 'Archivieren';
    $('select-projects').checked = projects.length > 0 && projects.every(p => this.selected.has(p.id)); $('select-projects').indeterminate = this.selected.size > 0 && this.selected.size < projects.length; $('select-projects').disabled = !projects.length;
  }
  editTag(tag) {
    const body = this.showModal(tag ? 'Tag bearbeiten' : 'Ein Tag für deine Ideen.', 'PROJEKTE ORGANISIEREN'), name = this.field('Name', 'z. B. Studium, Abschlussarbeit oder Privat', tag?.name || ''); body.append(name.wrapper);
    const color = this.el('input'); color.type = 'color'; color.value = tag?.color || tagColors[0][1]; color.setAttribute('aria-label', 'Eigene Tag-Farbe');
    const palette = this.el('div', 'tag-color-presets'); palette.setAttribute('role', 'radiogroup'); palette.setAttribute('aria-label', 'Standardfarben');
    for (const [label, value] of tagColors) {
      const option = this.el('label', 'tag-color-preset'), radio = this.el('input'), swatch = this.el('span', 'tag-color-swatch');
      radio.type = 'radio'; radio.name = 'tag-color'; radio.value = value; radio.checked = color.value.toLowerCase() === value; radio.setAttribute('aria-label', label);
      option.title = label; swatch.style.setProperty('--tag-color', value); swatch.append(this.icon('check'));
      radio.addEventListener('change', () => { color.value = value; }); option.append(radio, swatch, this.el('span', 'sr-only', label)); palette.append(option);
    }
    body.append(this.el('span', 'field-label', 'Standardfarben'), palette);
    color.addEventListener('input', () => { for (const radio of palette.querySelectorAll('input')) radio.checked = radio.value === color.value.toLowerCase(); });
    const colorLabel = this.el('label', 'field'); colorLabel.append(this.el('span', 'field-label', 'Eigene Farbe')); const colorRow = this.el('div', 'tag-color-field'); colorRow.append(color, this.el('span', '', 'Du kannst auch eine eigene Farbe auswählen.')); colorLabel.append(colorRow); body.append(colorLabel);
    if (tag) this.modalButton('Tag entfernen', async () => { await this.api(`/api/tags/${tag.id}`, 'DELETE'); $('modal').close(); await this.refresh(); this.toast('Tag entfernt. Deine Projekte bleiben erhalten.'); }, 'secondary-button danger-text');
    this.cancelButton(); this.modalButton(tag ? 'Änderungen speichern' : 'Tag erstellen', async () => { await this.api(tag ? `/api/tags/${tag.id}` : '/api/tags', tag ? 'PATCH' : 'POST', { name: name.input.value, color: color.value }); $('modal').close(); await this.refresh(); }); name.input.focus();
  }
  tagChecklist(body, initial = []) {
    const list = this.el('div', 'tag-checklist');
    for (const tag of this.tags) { const label = this.el('label'), check = this.el('input'); check.type = 'checkbox'; check.value = tag.id; check.checked = initial.includes(tag.id); label.append(check, this.mark(tag.color), this.el('span', '', tag.name)); list.append(label); }
    if (!this.tags.length) list.append(this.el('p', 'empty-note', 'Erstelle zuerst links unter „Deine Tags“ einen Tag.'));
    body.append(list); return () => [...list.querySelectorAll('input:checked')].map(check => check.value);
  }
  assignTags(ids) {
    const single = ids.length === 1, project = this.projects.find(p => p.id === ids[0]); if (!project) return;
    const body = this.showModal(single ? 'Tags für dein Projekt' : 'Tags hinzufügen', 'PROJEKTE ORGANISIEREN'); body.append(this.el('p', '', single ? project.name : `Die ausgewählten Tags werden ${ids.length} Projekten hinzugefügt. Bestehende Tags bleiben erhalten.`));
    const selected = this.tagChecklist(body, single ? project.tags : []);
    this.cancelButton(); this.modalButton('Tags speichern', async () => {
      for (const id of ids) { const current = this.projects.find(p => p.id === id); await this.api(`/api/projects/${id}`, 'PATCH', { tags: single ? selected() : [...new Set([...current.tags, ...selected()])] }); }
      $('modal').close(); await this.refresh(); this.toast('Tags gespeichert.');
    });
  }
  manage(project) {
    const body = this.showModal('Projekt verwalten', 'DEIN ARBEITSBEREICH'), name = this.field('Projektname', '', project.name); body.append(name.wrapper);
    const options = this.el('div', 'project-options'), star = this.el('input'), archive = this.el('input');
    star.type = archive.type = 'checkbox'; star.checked = project.starred; archive.checked = project.archived;
    for (const [input, text] of [[star, 'Als Favorit markieren'], [archive, 'Im Archiv ablegen']]) { const label = this.el('label'); label.append(input, document.createTextNode(text)); options.append(label); } body.append(options);
    const selected = this.tagChecklist(body, project.tags);
    body.append(this.el('p', 'empty-note', 'Archivieren bewahrt alle Dateien auf. Du findest das Projekt weiterhin im Archiv und kannst es dort wiederherstellen.'));
    this.modalButton('ZIP herunterladen', () => { window.location.href = `/api/projects/${project.id}/export`; }, 'secondary-button');
    this.cancelButton(); this.modalButton('Speichern', async () => { await this.api(`/api/projects/${project.id}`, 'PATCH', { name: name.input.value, tags: selected(), starred: star.checked, archived: archive.checked }); $('modal').close(); await this.refresh(); this.toast('Projekt aktualisiert.'); });
  }
  renderTemplates() {
    const container = $('template-list-view'); container.replaceChildren();
    const cards = [
      ['file', 'Artikel', 'Ein aufgeräumter Einstieg mit Kapiteln, Formeln und einem kleinen Beispieldokument.', 'Vorlage von SchriftenMinisterium', 'Artikel erstellen', () => this.newProject(false, 'article')],
      ['book', 'Leeres Dokument', 'Beginne mit einer leeren Seite und gestalte Aufbau und Inhalt nach deinen Vorstellungen.', 'Platz für deine schriftliche Dokumentation', 'Dokument erstellen', () => this.newProject(false, 'blank')],
      ['upload', 'Eigene Vorlage importieren', 'Importiere ein komplettes Projekt als ZIP. Unterordner, Abbildungen, Stildateien und Literatur werden übernommen.', 'Lokaler Import · Originaldateien bleiben erhalten', 'ZIP importieren', () => this.importProject('zip')],
      ['github', 'Aus einem GitHub-Repository', 'Arbeite mit einer veröffentlichten Dokumentvorlage oder einem bestehenden Repository weiter.', 'Verbindet sich erst nach deiner Auswahl', 'Repository importieren', () => this.newProject(true)]
    ];
    for (const [symbol, title, description, caption, label, action] of cards) { const card = this.el('article', 'template-card'), graphic = this.el('div', 'template-card-icon'); graphic.append(this.icon(symbol)); const button = this.el('button', 'secondary-button', label); button.onclick = () => this.act(action); card.append(graphic, this.el('h2', '', title), this.el('p', '', description), this.el('small', '', caption), button); container.append(card); }
  }
}
