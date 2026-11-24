const textEscapes={'\\':'\\textbackslash{}','&':'\\&','%':'\\%','$':'\\$','#':'\\#','_':'\\_','{':'\\{','}':'\\}','~':'\\textasciitilde{}','^':'\\textasciicircum{}'};
export function escapeTex(value) { return String(value).replace(/[\\&%$#_{}~^]/g,char=>textEscapes[char]); }
function captionLines(caption,label,floating) {
  if(typeof caption!=='string'||caption.length>500)throw new Error('Die Beschriftung darf maximal 500 Zeichen enthalten.');
  if(typeof label!=='string'||(label&&!/^[a-zA-Z][a-zA-Z0-9:._-]{0,79}$/.test(label)))throw new Error('Verweise dürfen Buchstaben, Zahlen, Doppelpunkt, Punkt, _ und - enthalten.');
  if(floating&&!caption.trim())throw new Error('Für die nummerierte Darstellung bitte eine Beschriftung eingeben.');
  if(label&&(!floating||!caption.trim()))throw new Error('Für einen Verweis bitte eine nummerierte Darstellung und eine Beschriftung wählen.');
  const lines=[];
  if(caption.trim())lines.push(floating?`\\caption{${escapeTex(caption.trim().replace(/\s*\n\s*/g,' '))}}`:`\\par\\small ${escapeTex(caption.trim().replace(/\s*\n\s*/g,' '))}`);
  if(label)lines.push(`\\label{${label}}`);
  return lines;
}
export function tableTex({cells,alignments,header=true,borders='simple',caption='',label='',floating=false}) {
  if(!Array.isArray(cells)||cells.length<1||cells.length>50||!Array.isArray(cells[0])||cells[0].length<1||cells[0].length>12)throw new Error('Bitte 1–50 Zeilen und 1–12 Spalten wählen.');
  const columns=cells[0].length;
  if(cells.some(row=>!Array.isArray(row)||row.length!==columns||row.some(cell=>typeof cell!=='string'||cell.length>500)))throw new Error('Jede Zelle darf maximal 500 Zeichen enthalten; alle Zeilen brauchen gleich viele Spalten.');
  if(!Array.isArray(alignments)||alignments.length!==columns||alignments.some(value=>!['l','c','r'].includes(value)))throw new Error('Ungültige Spaltenausrichtung.');
  if(!['simple','grid','none'].includes(borders)||typeof header!=='boolean'||typeof floating!=='boolean')throw new Error('Ungültige Tabelleneinstellung.');
  const specification=borders==='grid'?'|'+alignments.join('|')+'|':alignments.join('');
  const lines=[floating?'\\begin{table}[htbp]':'\\begin{center}'];if(floating)lines.push('\\centering');
  lines.push(`\\begin{tabular}{${specification}}`);if(borders!=='none')lines.push('\\hline');
  cells.forEach((row,index)=>{
    const content=row.map((value,column)=>{
      const parts=value.replace(/\r\n?/g,'\n').split('\n').map(escapeTex);
      let text=parts.length>1?`\\shortstack[${alignments[column]}]{${parts.join(' \\\\ ')}}`:parts[0];
      if(header&&index===0)text=`\\textbf{${text}}`;return text;
    });
    lines.push(content.join(' & ')+' \\\\');if(borders==='grid'||(borders==='simple'&&header&&index===0))lines.push('\\hline');
  });
  if(borders==='simple'&&!(header&&cells.length===1))lines.push('\\hline');
  lines.push('\\end{tabular}',...captionLines(caption,label,floating),floating?'\\end{table}':'\\end{center}');return lines.join('\n');
}
export function parseTsv(text) {
  if(typeof text!=='string'||text.length>100000)throw new Error('Die eingefügten Tabellendaten sind zu groß.');
  const rows=[];let row=[],cell='',quoted=false;
  const pushCell=()=>{if(cell.length>500)throw new Error('Eine eingefügte Zelle ist länger als 500 Zeichen.');row.push(cell);cell='';if(row.length>12)throw new Error('Maximal 12 Spalten sind möglich.');};
  const pushRow=()=>{rows.push(row);row=[];if(rows.length>50)throw new Error('Maximal 50 Zeilen sind möglich.');};
  const source=text.replace(/\r\n?/g,'\n');
  for(let i=0;i<source.length;i++){
    const char=source[i];
    if(char==='"'&&(!cell||quoted)){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&char==='\t')pushCell();
    else if(!quoted&&char==='\n'){pushCell();pushRow();}
    else cell+=char;
  }
  if(quoted)throw new Error('Eine Anführungszeichen-Zelle wurde nicht geschlossen.');
  if(cell||row.length||!rows.length){pushCell();pushRow();}
  const width=Math.max(...rows.map(value=>value.length));return rows.map(value=>[...value,...Array(width-value.length).fill('')]);
}
export function imageTex({path,width=70,caption='',label='',floating=false}) {
  if(typeof path!=='string'||!path||path.length>240||!/^[/\p{L}\p{N} ._()-]+$/u.test(path)||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..')||! /\.(png|jpe?g)$/i.test(path))throw new Error('Bitte ein PNG/JPEG mit einfachem relativem Dateinamen wählen.');
  if(typeof width!=='number'||!Number.isFinite(width)||width<5||width>100||typeof floating!=='boolean')throw new Error('Die Bildbreite muss zwischen 5 und 100 Prozent liegen.');
  const lines=[floating?'\\begin{figure}[htbp]':'\\begin{center}'];if(floating)lines.push('\\centering');
  lines.push(`\\includegraphics[width=${Number((width/100).toFixed(3))}\\linewidth,keepaspectratio]{\\detokenize{${path}}}`,...captionLines(caption,label,floating),floating?'\\end{figure}':'\\end{center}');return lines.join('\n');
}
export function maskComments(source) {
  return source.replace(/(\\\\|\\%|%[^\n]*)/g,token=>token.startsWith('%')?' '.repeat(token.length):token);
}
export function graphicxEdit(source) {
  const visible=maskComments(source),begin=/\\begin\s*\{document\}/.exec(visible);
  const preamble=visible.slice(0,begin?.index??visible.length);
  for(const match of preamble.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g))if(match[1].split(',').some(name=>name.trim()==='graphicx'))return null;
  if(!begin)throw new Error('Der Dokumentbeginn wurde in der Hauptdatei nicht gefunden. Bitte graphicx selbst einbinden und die automatische Ergänzung ausschalten.');
  return {start:begin.index,end:begin.index,text:'\\usepackage{graphicx}\n'};
}
export function blockEdit(source,start,end,text) {
  if(typeof source!=='string'||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>source.length)throw new Error('Die Einfügestelle ist ungültig.');
  return {start,end,text:(start>0&&source[start-1]!=='\n'?'\n':'')+text+(end<source.length&&source[end]!=='\n'?'\n':'')};
}
export function applyEdits(source,edits) {
  const ordered=[...edits].sort((a,b)=>b.start-a.start);let boundary=source.length;
  for(const edit of ordered){if(!Number.isInteger(edit.start)||!Number.isInteger(edit.end)||edit.start<0||edit.end<edit.start||edit.end>boundary||typeof edit.text!=='string')throw new Error('Überlappende oder ungültige Änderungen.');source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);boundary=edit.start;}
  return source;
}
