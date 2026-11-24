import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula, toTex, isMathPosition, unwrapFormula, insertionTex, renderMath } from '../public/formula.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compileDocument } from '../lib/compiler.mjs';
const tex=input=>toTex(parseFormula(input));
test('Excel-like expressions preserve precedence, grouping, decimal commas and German/English functions',()=>{
  assert.equal(tex('=(a+b)/c'),'\\frac{a + b}{c}');
  assert.equal(tex('WURZEL(a^2+b^2)'),'\\sqrt{a^{2} + b^{2}}');
  assert.equal(tex('SQRT(a^2+b^2)'),tex('WURZEL(a^2+b^2)'));
  assert.equal(tex('-x^2'),'-x^{2}');assert.equal(tex('x^(a+b)'),'x^{a + b}');
  assert.equal(tex('a-(b+c)'),'a - \\left(b + c\\right)');
  assert.equal(tex('2x_1^2'),'2 \\cdot x_{1}^{2}');
  assert.equal(tex('1,5*PI()'),'1{,}5 \\cdot \\pi');
  assert.equal(tex('1e-3'),'1\\cdot 10^{-3}');
  assert.equal(tex('BRUCH(1;WURZEL(x))'),'\\frac{1}{\\sqrt{x}}');
  assert.equal(tex('f(x) = alpha*x'),'f\\left(x\\right) = \\alpha \\cdot x');
  assert.equal(tex('a<=b'),'a \\leq b');assert.equal(tex('SUMME(a;b;c)'),'\\left(a + b + c\\right)');
  assert.equal(tex('MITTELWERT(a;b)'),'\\frac{a + b}{2}');
  assert.match(tex('SIGMA(k^2;k;1;n)'),/^\\sum_\{k=1\}\^\{n\}/);
  assert.match(tex('INTEGRAL(f(x);x;0;1)'),/^\\int_\{0\}\^\{1\}/);
});
test('incomplete, unsupported or excessive input is rejected without executing code',()=>{
  for(const input of ['','a+','(a+b','BRUCH(;a;b)','BRUCH(a;)','BRUCH(a)','WURZEL()','POTENZ(2,3)','foo()','SIGMA(k;k+1;1;n)','alert("x")','a<script>','\\frac{a}{b}','('.repeat(100)+'a'+')'.repeat(100),'x'.repeat(4097)])assert.throws(()=>tex(input),undefined,input);
});
test('formula insertion emits standard TeX only and raw TeX is preserved exactly',()=>{
  assert.equal(insertionTex('a/b'),'\\(\\frac{a}{b}\\)');
  assert.equal(insertionTex('a/b','display'),'\\[\n\\frac{a}{b}\n\\]');
  assert.equal(insertionTex('a^2','numbered'),'\\begin{equation}\na^{2}\n\\end{equation}');
  const raw='\\frac{a}{b} + \\customMacro{x}';assert.equal(insertionTex(raw,'content',true),raw);
  assert.deepEqual(unwrapFormula('\\[ x^2 \\]'),{expression:'x^2',layout:'display',texMode:true});
  const original='Unverändert \\textbf{vorher} und nachher.';const index=original.indexOf(' und');
  const changed=original.slice(0,index)+insertionTex('a/b')+original.slice(index);
  assert.ok(changed.startsWith(original.slice(0,index)));assert.ok(changed.endsWith(original.slice(index)));
});
test('existing TeX math environments are detected without treating escaped dollars, comments and verbatim as formulas',()=>{
  for(const prefix of ['Text $x + ','Text \\(x + ','Text \\[x + ','\\begin{equation}x+','\\begin{align*}x&=','$$x+'])assert.equal(isMathPosition(prefix,prefix.length),true,prefix);
  for(const prefix of ['Text \\$ 5','Text % $ comment\nnormal','\\verb|$| text','\\begin{verbatim}$ fake \\end{verbatim} text','$x$ text','\\begin{equation}x\\end{equation} text'])assert.equal(isMathPosition(prefix,prefix.length),false,prefix);
});
test('MathML preview contains text nodes and math elements, never executable markup',()=>{
  const tags=[];const document={createTextNode:text=>({text}),createElementNS:(ns,tag)=>{tags.push(tag);assert.equal(ns,'http://www.w3.org/1998/Math/MathML');return {tag,children:[],append(child){this.children.push(child);},setAttribute(){}};}};
  const preview=renderMath(parseFormula('WURZEL(a^2+b^2)/c'),document);assert.equal(preview.tag,'math');assert.ok(tags.includes('mfrac'));assert.ok(tags.includes('msqrt'));assert.ok(tags.includes('msup'));assert.ok(!tags.includes('script'));
});
test('generated formulas compile with the real standard engine and no extra formula package',{skip:process.env.SCHRIFTENMINISTERIUM_TEST_TEX!=='1'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schriftenministerium-formula-'));
  try{
    const snapshot=path.join(root,'source'),outputDir=path.join(root,'output');await fs.mkdir(snapshot);await fs.mkdir(outputDir);
    const examples=['(a+b)/c','WURZEL(a^2+b^2)','x_1^2','1,5*PI()','POTENZ(a+b;2)','ABS(x)','LOG(x;2)','MITTELWERT(a;b;c)','SIGMA(k^2;k;1;n)','INTEGRAL(f(x);x;0;1)','alpha*x<=beta','MIN(a;b;c)'];
    await fs.writeFile(path.join(snapshot,'main.tex'),'\\documentclass{article}\n\\begin{document}\n'+examples.map(x=>insertionTex(x,'display')).join('\n')+'\n\\end{document}\n');
    const result=await compileDocument({project:{compiler:'tectonic',main:'main.tex'},snapshot,outputDir,dataRoot:root});
    assert.equal(result.code,0,result.output);assert.match((await fs.readFile(path.join(outputDir,'main.pdf'))).subarray(0,5).toString(),/^%PDF-/);
  }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'schriftenministerium-formula-')));await fs.rm(root,{recursive:true,force:true});}
});
