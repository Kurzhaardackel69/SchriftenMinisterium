import { parseFormula, toTex, renderMath, isMathPosition, unwrapFormula, insertionTex } from './formula.js';

// The editor uses unwrapped source lines. Measure the clicked line with the same font and tab stops.
function positionAtPoint(editor, x, y) {
  const style=getComputedStyle(editor),rect=editor.getBoundingClientRect(),lines=editor.value.split('\n');
  const lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.8;
  const row=Math.max(0,Math.min(lines.length-1,Math.floor((y-rect.top-parseFloat(style.borderTopWidth||0)-parseFloat(style.paddingTop||0)+editor.scrollTop)/lineHeight)));
  const point=x-rect.left-parseFloat(style.borderLeftWidth||0)-parseFloat(style.paddingLeft||0)+editor.scrollLeft;
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const tabSize=parseInt(style.tabSize)||8,spacing=parseFloat(style.letterSpacing)||0;
  const segments=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(lines[row])];
  let previous=0,column=0,expanded='';
  for(const segment of segments){
    expanded+=segment.segment==='\t'?' '.repeat(tabSize-expanded.length%tabSize):segment.segment;
    const width=context.measureText(expanded).width+expanded.length*spacing;
    if(point<(previous+width)/2)break;
    previous=width;column=segment.index+segment.segment.length;
  }
  return lines.slice(0,row).reduce((sum,line)=>sum+line.length+1,0)+column;
}
export function installFormulaDialog(ui) {
  const {el,icon,showModal,modalButton,getContext,insert,toast}=ui,editor=document.getElementById('editor');
  const menu=el('div','formula-context-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','Einfügen');menu.hidden=true;
  const action=el('button');action.setAttribute('role','menuitem');action.append(icon('math'),el('span','','Formel einfügen …'));menu.append(action);document.body.append(menu);
  let anchor;
  const hide=()=>{menu.hidden=true;};
  for(const item of ui.extraActions||[]){const button=el('button');button.setAttribute('role','menuitem');button.append(icon(item.icon),el('span','',item.label));button.onclick=()=>{hide();item.open(anchor);};menu.append(button);}
  function capture(){const context=getContext();return {...context,start:editor.selectionStart,end:editor.selectionEnd,source:editor.value};}
  function open(saved=capture()){
    hide();if(!saved?.editable)return;
    anchor=saved;
    const selected=unwrapFormula(saved.source.slice(saved.start,saved.end)),inside=isMathPosition(saved.source,saved.start);
    const body=showModal('Eine Formel. Ganz einfach.', 'FORMEL EINFÜGEN',true);
    const introduction=el('p','formula-intro','Schreibe mit +, −, *, / und ^. Funktionen wie in Excel: WURZEL(a^2+b^2), BRUCH(a;b) oder SIN(x). Argumente mit ; trennen.');body.append(introduction);
    const tabs=el('div','formula-modes'),simple=el('button','','Einfache Eingabe'),raw=el('button','','TeX-Eingabe');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Formeleingabe');tabs.append(simple,raw);body.append(tabs);
    const grid=el('div','formula-grid'),entry=el('div'),output=el('div');grid.append(entry,output);body.append(grid);
    const label=el('label','field'),input=el('textarea','formula-input');input.rows=3;input.maxLength=4096;input.spellcheck=false;input.value=selected.expression;input.placeholder='z. B. (a+b)/c oder =WURZEL(a^2+b^2)';label.append(el('span','field-label','Deine Formel'),input);entry.append(label);
    const tools=el('div','formula-snippets');
    for(const [name,snippet] of [['Bruch','BRUCH(a;b)'],['Wurzel','WURZEL(x)'],['Potenz','x^2'],['Index','x_i'],['Sinus','SIN(x)'],['Summe','SIGMA(k^2;k;1;n)'],['Integral','INTEGRAL(f(x);x;0;1)']]){
      const button=el('button','small-button',name);button.onclick=()=>{input.setRangeText(snippet,input.selectionStart,input.selectionEnd,'select');input.focus();update();};tools.append(button);
    }entry.append(tools);
    const layoutLabel=el('label','field'),layout=el('select');layoutLabel.append(el('span','field-label','Darstellung im Dokument'),layout);
    for(const [value,name] of [['inline','Im Fließtext'],['display','Eigene Zeile'],['numbered','Mit Gleichungsnummer'],['content','Nur Formelcode (innerhalb einer bestehenden Formel)']]){const option=el('option','',name);option.value=value;layout.append(option);}
    layout.value=inside?'content':selected.layout||'inline';entry.append(layoutLabel);
    if(inside)entry.append(el('p','field-note','Die Einfügestelle liegt bereits in einer Formelumgebung. Deshalb wird standardmäßig nur der Formelinhalt eingefügt.'));
    const preview=el('div','formula-preview');preview.setAttribute('aria-label','Formelvorschau');output.append(el('span','field-label','Vorschau'),preview);
    const error=el('p','formula-error');error.setAttribute('role','status');output.append(error);
    const sourceHeading=el('span','field-label','Das wird eingefügt'),source=el('pre','formula-source');output.append(sourceHeading,source);
    body.append(el('p','field-note','Es wird nur die gewählte Stelle ersetzt. Bestehende TeX-Dokumente bleiben im Originalformat. Die Eingabe beschreibt eine Formel; sie berechnet keine Tabellenzellen.'));
    let texMode=selected.texMode;
    const drafts={simple:texMode?'':input.value,raw:texMode?input.value:''};
    const cancel=modalButton('Abbrechen',()=>{document.getElementById('modal').close();editor.focus();editor.setSelectionRange(saved.start,saved.end);},'secondary-button');
    const confirm=modalButton('Formel einfügen',()=>{
      const now=getContext();if(now.project!==saved.project||now.file!==saved.file||editor.value!==saved.source)throw new Error('Die Datei wurde inzwischen gewechselt oder geändert. Bitte den Formeldialog erneut öffnen.');
      let text=insertionTex(input.value,layout.value,texMode);
      if(['display','numbered'].includes(layout.value))text=(saved.start>0&&saved.source[saved.start-1]!=='\n'?'\n':'')+text+(saved.end<saved.source.length&&saved.source[saved.end]!=='\n'?'\n':'');
      document.getElementById('modal').close();insert(text,saved.start,saved.end);toast('Formel als TeX eingefügt.');
    });
    function update(){
      simple.classList.toggle('active',!texMode);raw.classList.toggle('active',texMode);simple.setAttribute('aria-pressed',String(!texMode));raw.setAttribute('aria-pressed',String(texMode));tools.hidden=texMode;
      preview.replaceChildren();error.textContent='';confirm.disabled=false;
      try{
        source.textContent=insertionTex(input.value,layout.value,texMode);
        if(texMode)preview.append(el('p','field-note','TeX-Eingabe wird unverändert übernommen. Die gesetzte Formel siehst du nach dem Kompilieren im PDF.'));
        else preview.append(renderMath(parseFormula(input.value),document));
      }catch(problem){error.textContent=problem.message;source.textContent='';confirm.disabled=true;preview.append(el('span','formula-preview-empty','Deine Formel erscheint hier.'));}
    }
    simple.onclick=()=>{if(texMode){drafts.raw=input.value;input.value=drafts.simple;}texMode=false;update();input.focus();};raw.onclick=()=>{if(!texMode){drafts.simple=input.value;if(!drafts.raw&&input.value.trim()){try{drafts.raw=toTex(parseFormula(input.value));}catch{drafts.raw=input.value;}}input.value=drafts.raw;}texMode=true;update();input.focus();};
    input.oninput=update;layout.onchange=update;input.onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();if(!confirm.disabled)confirm.click();}};
    update();input.focus();input.select();
  }
  editor.addEventListener('contextmenu',event=>{
    if(!getContext().editable)return;event.preventDefault();
    if(event.clientX||event.clientY){const position=positionAtPoint(editor,event.clientX,event.clientY);if(position<editor.selectionStart||position>editor.selectionEnd||editor.selectionStart===editor.selectionEnd)editor.setSelectionRange(position,position);}
    anchor=capture();menu.hidden=false;
    const rect=editor.getBoundingClientRect(),x=event.clientX||rect.left+40,y=event.clientY||rect.top+40;
    menu.style.left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';action.focus();
  });
  action.onclick=()=>open(anchor);
  menu.onkeydown=event=>{if(event.key==='Escape'){hide();editor.focus();}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}};
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))hide();});window.addEventListener('resize',hide);editor.addEventListener('scroll',hide);
  return ()=>open(capture());
}
