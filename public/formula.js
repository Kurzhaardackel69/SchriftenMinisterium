const symbols = {pi:'\\pi',alpha:'\\alpha',beta:'\\beta',gamma:'\\gamma',delta:'\\delta',epsilon:'\\epsilon',theta:'\\theta',lambda:'\\lambda',mu:'\\mu',rho:'\\rho',sigma:'\\sigma',tau:'\\tau',phi:'\\phi',omega:'\\omega',Gamma:'\\Gamma',Delta:'\\Delta',Theta:'\\Theta',Lambda:'\\Lambda',Sigma:'\\Sigma',Phi:'\\Phi',Omega:'\\Omega',inf:'\\infty'};
const glyphs = {pi:'π',alpha:'α',beta:'β',gamma:'γ',delta:'δ',epsilon:'ε',theta:'θ',lambda:'λ',mu:'μ',rho:'ρ',sigma:'σ',tau:'τ',phi:'φ',omega:'ω',Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Sigma:'Σ',Phi:'Φ',Omega:'Ω',inf:'∞'};
const aliases = {PI:'piConstant',WURZEL:'sqrt',SQRT:'sqrt',BRUCH:'frac',FRAC:'frac',POTENZ:'power',POWER:'power',ABS:'abs',BETRAG:'abs',SIN:'sin',COS:'cos',TAN:'tan',ARCSIN:'arcsin',ARCCOS:'arccos',ARCTAN:'arctan',LN:'ln',LOG:'log',EXP:'exp',SUMME:'sum',SUM:'sum',MITTELWERT:'mean',AVERAGE:'mean',SIGMA:'sigma',INTEGRAL:'integral',MIN:'min',MAX:'max'};
const arities = {piConstant:[0,0],sqrt:[1,2],frac:[2,2],power:[2,2],abs:[1,1],sin:[1,1],cos:[1,1],tan:[1,1],arcsin:[1,1],arccos:[1,1],arctan:[1,1],ln:[1,1],log:[1,2],exp:[1,1],sum:[1,32],mean:[1,32],sigma:[4,4],integral:[4,4],min:[1,32],max:[1,32]};
const binding = {'=':10,'<':10,'>':10,'<=':10,'>=':10,'!=':10,'+':20,'-':20,'*':30,'/':30,'^':50,'_':60};
const strip = node => node.type==='group' ? strip(node.value) : node;
export function parseFormula(input) {
  if (typeof input!=='string' || input.length>4096) throw new Error('Die Formel darf maximal 4096 Zeichen enthalten.');
  const source=input.trim().replace(/^=/,'').replace(/[−–]/g,'-');
  if (!source.trim()) throw new Error('Gib eine Formel ein.');
  const tokens=[];let i=0;
  while(i<source.length) {
    if (/\s/.test(source[i])) {i++;continue;}
    const tail=source.slice(i), number=tail.match(/^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?/), name=tail.match(/^[a-zA-Z][a-zA-Z0-9]*/)|| (Object.values(glyphs).includes(source[i])?[source[i]]:null);
    if(number){tokens.push({kind:'number',value:number[0]});i+=number[0].length;}
    else if(name){const value=Object.entries(glyphs).find(([,v])=>v===name[0])?.[0]||name[0];tokens.push({kind:'name',value});i+=name[0].length;}
    else {
      const operator=tail.match(/^(?:<=|>=|!=|[+\-*/^_=<>();!%×÷≤≥≠√∞])/);
      if(!operator) throw new Error(source[i]==='\\' ? 'Für vorhandene TeX-Befehle bitte „TeX-Eingabe“ wählen.' : `„${source[i]}“ wird hier nicht unterstützt. Funktionsargumente mit ; trennen.`);
      const value=({'×':'*','÷':'/','≤':'<=','≥':'>=','≠':'!=','√':'sqrt','∞':'inf'})[operator[0]]||operator[0];
      tokens.push({kind:['sqrt','inf'].includes(value)?'name':'op',value});i+=operator[0].length;
    }
    if(tokens.length>1024)throw new Error('Die Formel ist zu umfangreich. Bitte in kleinere Formeln aufteilen.');
  }
  tokens.push({kind:'end',value:''});let at=0,depth=0;
  const peek=()=>tokens[at];
  const expect=value=>{if(peek().value!==value)throw new Error(`„${value}“ fehlt. Argumente mit ; trennen, z. B. POTENZ(2;3).`);at++;};
  function expression(minimum=0) {
    if(++depth>64)throw new Error('Die Formel ist zu tief verschachtelt.');
    let node;const token=tokens[at++];
    if(token.kind==='number')node={type:'number',value:token.value};
    else if(token.value==='+'||token.value==='-')node={type:'unary',op:token.value,value:expression(40)};
    else if(token.value==='('){node={type:'group',value:expression()};expect(')');}
    else if(token.kind==='name') {
      if(peek().value==='(') {
        at++;const args=[];
        if(peek().value!==')'){args.push(expression());while(peek().value===';'){at++;args.push(expression());}}
        expect(')');const name=aliases[token.value.toUpperCase()]||token.value, range=arities[name];
        if(range&&(args.length<range[0]||args.length>range[1]))throw new Error(`${token.value} erwartet ${range[0]===range[1]?range[0]:`${range[0]}–${range[1]}`} Argumente. Bitte mit ; trennen.`);
        if(!range&&token.value.length>1&&token.value===token.value.toUpperCase())throw new Error(`Die Funktion ${token.value} ist nicht vorgesehen. Nutze z. B. WURZEL, BRUCH oder POTENZ.`);
        if(!range&&!args.length)throw new Error('Eine Funktion braucht mindestens ein Argument.');
        if(['sigma','integral'].includes(name)&&strip(args[1]).type!=='name')throw new Error('Das zweite Argument muss eine Variable sein, z. B. k oder x.');
        node={type:'call',name,args};
      } else node={type:'name',value:token.value};
    } else throw new Error('Hier fehlt eine Zahl, Variable oder öffnende Klammer.');
    while(true){
      const next=peek();
      if(['!','%'].includes(next.value)){if(70<minimum)break;at++;node={type:'postfix',op:next.value,value:node};continue;}
      const implicit=next.kind==='number'||next.kind==='name'||next.value==='(';
      const operator=implicit?'*':next.value, power=binding[operator];
      if(power===undefined||power<minimum)break;
      if(!implicit)at++;
      node={type:'binary',op:operator,left:node,right:expression(operator==='^'?power:power+1)};
    }
    depth--;return node;
  }
  const result=expression();if(peek().kind!=='end')throw new Error(`Unerwartetes Zeichen „${peek().value}“. Klammern und Semikolons prüfen.`);return result;
}
const wrap = value => `\\left(${value}\\right)`;
const variable = value => symbols[value] || (value.length===1?value:`\\mathit{${value}}`);
export function toTex(node) {
  const tex=toTex, argument=n=>tex(strip(n));
  if(node.type==='number'){
    const [base,exponent]=node.value.split(/[eE]/);const value=base.replace(',','{,}');return exponent===undefined?value:`${value}\\cdot 10^{${Number(exponent)}}`;
  }
  if(node.type==='name')return variable(node.value);
  if(node.type==='group')return wrap(tex(node.value));
  if(node.type==='unary')return node.op+tex(node.value);
  if(node.type==='postfix')return tex(node.value)+(node.op==='%'?'\\%':'!');
  if(node.type==='binary'){
    const a=tex(node.left),b=tex(node.right);
    if(node.op==='/')return `\\frac{${argument(node.left)}}{${argument(node.right)}}`;
    if(node.op==='^')return `${node.left.type==='number'&&/[eE]/.test(node.left.value)?wrap(a):a}^{${argument(node.right)}}`;
    if(node.op==='_')return `${a}_{${argument(node.right)}}`;
    return `${a} ${({'*':'\\cdot','<=':'\\leq','>=':'\\geq','!=':'\\neq'})[node.op]||node.op} ${b}`;
  }
  const args=node.args.map(argument),name=node.name;
  if(name==='piConstant')return '\\pi';
  if(name==='frac')return `\\frac{${args[0]}}{${args[1]}}`;
  if(name==='sqrt')return `\\sqrt${args[1]===undefined?'':`[${args[1]}]`}{${args[0]}}`;
  if(name==='power')return `${wrap(args[0])}^{${args[1]}}`;
  if(name==='abs')return `\\left|${args[0]}\\right|`;
  if(name==='sum')return wrap(args.join(' + '));
  if(name==='mean')return `\\frac{${args.join(' + ')}}{${args.length}}`;
  if(name==='sigma')return `\\sum_{${args[1]}=${args[2]}}^{${args[3]}} ${wrap(args[0])}`;
  if(name==='integral')return `\\int_{${args[2]}}^{${args[3]}} ${wrap(args[0])}\\,\\mathrm{d}${args[1]}`;
  if(name==='log'&&args.length===2)return `\\log_{${args[1]}}${wrap(args[0])}`;
  return `${['sin','cos','tan','arcsin','arccos','arctan','ln','log','exp','min','max'].includes(name)?'\\'+name:variable(name)}${wrap(args.join(';\\,'))}`;
}
export function renderMath(node, document) {
  const make=(tag,...children)=>{const element=document.createElementNS('http://www.w3.org/1998/Math/MathML',tag);for(const child of children)element.append(typeof child==='string'?document.createTextNode(child):child);return element;};
  const row=(...children)=>make('mrow',...children),op=text=>make('mo',text),group=child=>row(op('('),child,op(')'));
  function render(n){
    if(n.type==='number') {const [base,exponent]=n.value.split(/[eE]/);return exponent===undefined?make('mn',base):row(make('mn',base),op('·'),make('msup',make('mn','10'),make('mn',String(Number(exponent)))));}
    if(n.type==='name')return make('mi',glyphs[n.value]||n.value);
    if(n.type==='group')return group(render(n.value));
    if(n.type==='unary')return row(op(n.op==='-'?'−':n.op),render(n.value));
    if(n.type==='postfix')return row(render(n.value),op(n.op));
    if(n.type==='binary') {
      if(n.op==='/')return make('mfrac',render(strip(n.left)),render(strip(n.right)));
      if(n.op==='^')return make('msup',n.left.type==='number'&&/[eE]/.test(n.left.value)?group(render(n.left)):render(n.left),render(strip(n.right)));
      if(n.op==='_')return make('msub',render(n.left),render(strip(n.right)));
      return row(render(n.left),op(({'*':'·','-':'−','<=':'≤','>=':'≥','!=':'≠'})[n.op]||n.op),render(n.right));
    }
    const a=n.args.map(x=>render(strip(x))),name=n.name;
    if(name==='piConstant')return make('mi','π');
    const joined=(values,sign)=>row(...values.flatMap((value,index)=>index?[op(sign),value]:[value]));
    if(name==='frac')return make('mfrac',a[0],a[1]);
    if(name==='sqrt')return a[1]?make('mroot',a[0],a[1]):make('msqrt',a[0]);
    if(name==='power')return make('msup',group(a[0]),a[1]);
    if(name==='abs')return row(op('|'),a[0],op('|'));
    if(name==='sum')return group(joined(a,'+'));
    if(name==='mean')return make('mfrac',joined(a,'+'),make('mn',String(a.length)));
    if(name==='sigma')return row(make('munderover',op('∑'),row(a[1],op('='),a[2]),a[3]),group(a[0]));
    if(name==='integral')return row(make('msubsup',op('∫'),a[2],a[3]),group(a[0]),make('mi','d'),a[1]);
    if(name==='log'&&a.length===2)return row(make('msub',make('mi','log'),a[1]),group(a[0]));
    return row(make('mi',name),group(joined(a,';')));
  }
  const math=make('math',render(node));math.setAttribute('display','block');return math;
}
const mathEnvironments=new Set(['math','displaymath','equation','equation*','align','align*','gather','gather*','multline','multline*','eqnarray','eqnarray*','flalign','flalign*','alignat','alignat*']);
export function isMathPosition(source, position) {
  let mode='',environments=[];
  for(let i=0;i<position;i++){
    if(source[i]==='%'){const end=source.indexOf('\n',i);i=end<0?position:end;continue;}
    if(source[i]==='\\'){
      const tail=source.slice(i,position),literal=tail.match(/^\\begin\{(verbatim\*?|lstlisting|minted)\}/);
      if(literal){const end=source.indexOf(`\\end{${literal[1]}}`,i+literal[0].length);if(end<0||end>=position)return false;i=end+literal[1].length+5;continue;}
      const verb=tail.match(/^\\verb\*?([^a-zA-Z\s])/);if(verb){const end=source.indexOf(verb[1],i+verb[0].length);i=end<0?position:end;continue;}
      const env=tail.match(/^\\(begin|end)\{([^}]+)\}/);
      if(env){if(mathEnvironments.has(env[2])){if(env[1]==='begin')environments.push(env[2]);else {const index=environments.lastIndexOf(env[2]);if(index>=0)environments.splice(index,1);}}i+=env[0].length-1;continue;}
      const next=source[++i];if(next==='(')mode='inline';else if(next==='[')mode='display';else if(next===')'||next===']')mode='';continue;
    }
    if(source[i]==='$'){const delimiter=source[i+1]==='$'?'$$':'$';mode=mode===delimiter?'':delimiter;if(delimiter==='$$')i++;}
  }
  return !!mode||environments.length>0;
}
export function unwrapFormula(value) {
  const text=value.trim();
  for(const [left,right,layout] of [['\\[','\\]','display'],['\\(','\\)','inline'],['$$','$$','display'],['$','$','inline'],['\\begin{equation}','\\end{equation}','numbered']])if(text.startsWith(left)&&text.endsWith(right)&&text.length>=left.length+right.length)return {expression:text.slice(left.length,-right.length).trim(),layout,texMode:true};
  return {expression:value,layout:null,texMode:/\\[a-zA-Z[(]/.test(value)};
}
export function insertionTex(expression, layout='inline', texMode=false) {
  if(typeof expression!=='string'||expression.length>4096||!expression.trim())throw new Error('Bitte eine Formel mit maximal 4096 Zeichen eingeben.');
  const tex=texMode?expression:toTex(parseFormula(expression));
  if(layout==='content')return tex;
  if(layout==='inline')return `\\(${tex}\\)`;
  if(layout==='display')return `\\[\n${tex}\n\\]`;
  if(layout==='numbered')return `\\begin{equation}\n${tex}\n\\end{equation}`;
  throw new Error('Unbekannte Formel-Darstellung.');
}
