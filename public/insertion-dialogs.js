import {tableTex,parseTsv,imageTex,blockEdit} from './insertions.js';
import {isMathPosition} from './formula.js';

export function installInsertionDialogs(ui) {
  const {el,showModal,modalButton,field,toast,getContext,insert}=ui,editor=document.getElementById('editor');
  const capture=()=>({...getContext(),start:editor.selectionStart,end:editor.selectionEnd,source:editor.value});
  const current=saved=>{const now=getContext();return now.project===saved.project&&now.file===saved.file&&editor.value===saved.source;};
  function valid(saved){
    if(!saved.editable)return false;
    if(isMathPosition(saved.source,saved.start)){toast('Tabellen und Bilder bitte außerhalb einer Formel einfügen.',true);return false;}
    if(saved.file===saved.main){const begin=/\\begin\s*\{document\}/.exec(saved.source);if(begin&&saved.start<begin.index+begin[0].length){toast('Bitte eine Stelle nach dem Dokumentbeginn wählen.',true);return false;}}
    return true;
  }
  function common(body,kind,update){
    const options=el('div','insert-options'),caption=field('Beschriftung (optional)','z. B. Ergebnisse'),label=field('Verweis (optional)',kind==='table'?'tab:ergebnisse':'fig:aufnahme');caption.input.maxLength=500;label.input.maxLength=80;
    const placement=el('label','field'),floating=el('select');placement.append(el('span','field-label','Platzierung'),floating);
    for(const [value,title] of [['false','Direkt im Text (ohne Nummer)'],['true',kind==='table'?'Nummerierte Tabelle':'Nummerierte Abbildung']]){const option=el('option','',title);option.value=value;floating.append(option);}
    options.append(placement,caption.wrapper,label.wrapper);body.append(options);
    const change=()=>{label.wrapper.hidden=floating.value!=='true';caption.wrapper.firstElementChild.textContent=floating.value==='true'?'Beschriftung':'Beschriftung (optional)';if(floating.value!=='true')label.input.value='';update();};floating.onchange=change;caption.input.oninput=label.input.oninput=update;label.wrapper.hidden=true;
    return ()=>({caption:caption.input.value,label:label.input.value,floating:floating.value==='true'});
  }
  function codePreview(body){const error=el('p','insert-error');error.setAttribute('role','status');const details=el('details','insert-code'),summary=el('summary','','TeX-Code anzeigen'),pre=el('pre','formula-source');details.append(summary,pre);body.append(error,details);return {error,pre};}
  function openTable(saved=capture()){
    if(!valid(saved))return;
    const body=showModal('Deine Daten. Klar gegliedert.','TABELLE EINFÜGEN',true);
    body.append(el('p','formula-intro','Zellen direkt bearbeiten oder einen Bereich aus Excel/Calc kopieren und in eine Zelle einfügen. Tabulatoren und Zeilenumbrüche werden übernommen.'));
    const controls=el('div','table-size-controls'),rows=field('Zeilen','', '4','number'),columns=field('Spalten','','3','number');rows.input.min=columns.input.min='1';rows.input.max='50';columns.input.max='12';rows.wrapper.firstElementChild.title='Einschließlich der Kopfzeile';
    const header=el('input');header.type='checkbox';header.checked=true;const headLabel=el('label','insert-check');headLabel.append(header,document.createTextNode('Erste Zeile als Überschrift'));
    const borderLabel=el('label','field'),borders=el('select');borderLabel.append(el('span','field-label','Linien'),borders);
    for(const [value,title] of [['simple','Schlicht'],['grid','Vollständiges Raster'],['none','Ohne Linien']]){const option=el('option','',title);option.value=value;borders.append(option);}
    controls.append(rows.wrapper,columns.wrapper,borderLabel,headLabel);body.append(controls);
    const cells=Array.from({length:50},(_,row)=>Array.from({length:12},(_,column)=>row===0&&column<3?`Spalte ${column+1}`:'')),alignments=Array(12).fill('l');
    let height=4,width=3;
    const grid=el('div','table-grid');body.append(grid);
    const options=common(body,'table',()=>update()),preview=codePreview(body);
    body.append(el('p','field-note','Nummerierte Tabellen sind Gleitobjekte und können auf eine andere Seite rutschen. Kurze Zellen verwenden; sehr breite Tabellen können über den Seitenrand reichen.'));
    modalButton('Abbrechen',()=>document.getElementById('modal').close(),'secondary-button');
    const confirm=modalButton('Tabelle einfügen',()=>{if(!current(saved))throw new Error('Die Datei wurde geändert. Bitte den Dialog erneut öffnen.');const edit=blockEdit(saved.source,saved.start,saved.end,generate());document.getElementById('modal').close();insert(edit.text,edit.start,edit.end);toast('Tabelle als TeX eingefügt.');});
    const generate=()=>{if(Number(rows.input.value)!==height||Number(columns.input.value)!==width)throw new Error('Bitte gültige Zeilen- und Spaltenzahlen wählen.');return tableTex({cells:cells.slice(0,height).map(row=>row.slice(0,width)),alignments:alignments.slice(0,width),header:header.checked,borders:borders.value,...options()});};
    function update(){grid.classList.toggle('has-header',header.checked);try{preview.pre.textContent=generate();preview.error.textContent='';confirm.disabled=false;}catch(error){preview.error.textContent=error.message;confirm.disabled=true;}}
    function render(){
      grid.replaceChildren();const table=el('table'),thead=el('thead'),heading=el('tr');heading.append(el('th','','#'));
      for(let column=0;column<width;column++){const th=el('th'),select=el('select');select.setAttribute('aria-label',`Ausrichtung Spalte ${column+1}`);for(const [value,title] of [['l','Links'],['c','Mitte'],['r','Rechts']]){const option=el('option','',title);option.value=value;option.selected=value===alignments[column];select.append(option);}select.onchange=()=>{alignments[column]=select.value;render();update();};th.append(select);heading.append(th);}thead.append(heading);table.append(thead);
      const tbody=el('tbody');
      for(let row=0;row<height;row++){const tr=el('tr');tr.append(el('th','',String(row+1)));for(let column=0;column<width;column++){const td=el('td'),input=el('textarea');input.rows=1;input.maxLength=500;input.value=cells[row][column];input.setAttribute('aria-label',`Zeile ${row+1}, Spalte ${column+1}`);input.style.textAlign=({l:'left',c:'center',r:'right'})[alignments[column]];
          input.oninput=()=>{cells[row][column]=input.value;update();};
          input.onpaste=event=>{const text=event.clipboardData?.getData('text/plain');if(!text||!/[\t\r\n]/.test(text))return;event.preventDefault();try{const pasted=parseTsv(text);if(row+pasted.length>50||column+pasted[0].length>12)throw new Error('Der eingefügte Bereich überschreitet 50 Zeilen oder 12 Spalten.');for(let r=0;r<pasted.length;r++)for(let c=0;c<pasted[r].length;c++)cells[row+r][column+c]=pasted[r][c];height=Math.max(height,row+pasted.length);width=Math.max(width,column+pasted[0].length);rows.input.value=height;columns.input.value=width;render();update();}catch(error){preview.error.textContent=error.message;}};
          td.append(input);tr.append(td);}tbody.append(tr);}table.append(tbody);grid.append(table);
    }
    const resize=()=>{const h=Number(rows.input.value),w=Number(columns.input.value);if(!Number.isInteger(h)||h<1||h>50||!Number.isInteger(w)||w<1||w>12){preview.error.textContent='Bitte 1–50 Zeilen und 1–12 Spalten wählen.';confirm.disabled=true;return;}height=h;width=w;render();update();};
    rows.input.oninput=columns.input.oninput=resize;header.onchange=borders.onchange=update;render();update();
  }
  function openImage(saved=capture()){
    if(!valid(saved))return;
    const body=showModal('Ein Bild sagt mehr.','BILD EINFÜGEN',true);
    body.append(el('p','formula-intro','PNG/JPEG wählen oder ein vorhandenes Projektbild verwenden. Die Datei wird beim Bestätigen ins Projekt kopiert.'));
    const top=el('div','image-dialog-grid'),selection=el('div'),visual=el('div','image-preview'),image=el('img');image.alt='Bildvorschau';image.hidden=true;visual.append(image,el('span','','Dein Bild erscheint hier.'));top.append(selection,visual);body.append(top);
    const fileLabel=el('label','image-file-choice'),fileInput=el('input');fileInput.type='file';fileInput.accept='.png,.jpg,.jpeg,image/png,image/jpeg';fileInput.setAttribute('aria-label','Bilddatei auswählen');fileLabel.append(el('span','field-label','Neues Bild auswählen'),fileInput);selection.append(fileLabel);
    const existingLabel=el('label','field'),existing=el('select');existingLabel.append(el('span','field-label','Oder aus diesem Projekt'),existing);const empty=el('option','','Bild auswählen …');empty.value='';existing.append(empty);
    for(const file of saved.files.filter(item=>/\.(png|jpe?g)$/i.test(item.path))){const option=el('option','',file.path);option.value=file.path;existing.append(option);}selection.append(existingLabel);
    const width=field('Breite in % der Textbreite','','70','number');width.input.min='5';width.input.max='100';selection.append(width.wrapper);
    const options=common(body,'image',()=>update()),auto=el('input');auto.type='checkbox';auto.checked=true;const autoLabel=el('label','insert-check');autoLabel.append(auto,document.createTextNode('Paket graphicx bei Bedarf in der Hauptdatei ergänzen'));body.append(autoLabel,el('p','field-note','Diese Ergänzung erfolgt erst bei „Bild einfügen“. Bilder werden proportional skaliert. Maximal 10 MB, 40 Megapixel und 16000 Pixel je Seite. Nummerierte Abbildungen werden automatisch platziert.'));
    body.append(el('p','field-note','Neue Bilder erhalten einen eindeutigen Dateinamen im Ordner images. Die TeX-Vorschau zeigt dafür einen Platzhalter.'));
    const preview=codePreview(body);let chosen=null,objectURL=null,revision=0,previewValid=false,previewError='';
    const cleanup=()=>{if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}};document.getElementById('modal').addEventListener('close',cleanup,{once:true});
    modalButton('Abbrechen',()=>document.getElementById('modal').close(),'secondary-button');
    const confirm=modalButton('Bild einfügen',async()=>{
      if(!current(saved))throw new Error('Die Datei wurde geändert. Bitte den Dialog erneut öffnen.');
      const selected=chosen,existingPath=existing.value,epoch=revision,settings={...options(),width:Number(width.input.value)};let file;
      if(selected){const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('Das Bild konnte nicht gelesen werden.'));reader.readAsDataURL(selected);});file={name:selected.name,base64};}
      if(epoch!==revision)throw new Error('Die Bildauswahl wurde geändert. Bitte erneut bestätigen.');
      await ui.flush();if(!current(saved))throw new Error('Die Datei wurde geändert. Bitte erneut öffnen.');
      const result=await ui.api(`/api/projects/${saved.project}/insert-image`,'POST',{document:saved.file,expectedContent:saved.source,start:saved.start,end:saved.end,options:settings,addGraphicx:auto.checked,...(file?{file}:{existingPath})});
      document.getElementById('modal').close();cleanup();
      if(current(saved))await ui.applyImage(result,saved);else toast('Das Bild wurde im ursprünglichen Projekt eingefügt. Bitte die Datei dort erneut öffnen.');
    });
    function update(){try{if(!chosen&&!existing.value)throw new Error('Bitte ein Bild auswählen.');if(chosen&&chosen.size>10*1024*1024)throw new Error('Das Bild darf maximal 10 MB groß sein.');if(!previewValid)throw new Error(previewError||'Bildvorschau wird geladen …');preview.pre.textContent=imageTex({...options(),width:Number(width.input.value),path:existing.value||'images/bild-neue-id.png'});preview.error.textContent='';confirm.disabled=false;}catch(error){preview.pre.textContent='';preview.error.textContent=(chosen||existing.value)?error.message:'';confirm.disabled=true;}}
    function show(src){previewValid=false;previewError='';image.hidden=false;visual.lastElementChild.hidden=true;image.src=src;}
    fileInput.onchange=()=>{revision++;cleanup();existing.value='';chosen=fileInput.files[0]||null;if(chosen){objectURL=URL.createObjectURL(chosen);show(objectURL);}else{image.hidden=true;visual.lastElementChild.hidden=false;}update();};
    existing.onchange=()=>{revision++;cleanup();chosen=null;fileInput.value='';if(existing.value)show(`/api/projects/${saved.project}/asset?path=${encodeURIComponent(existing.value)}`);else{image.hidden=true;visual.lastElementChild.hidden=false;}update();};
    image.onload=()=>{previewValid=true;previewError='';update();};image.onerror=()=>{previewValid=false;previewError='Dieses Bild konnte nicht angezeigt werden. Bitte PNG/JPEG wählen.';update();};width.input.oninput=update;auto.onchange=update;update();
  }
  return {table:openTable,image:openImage};
}
