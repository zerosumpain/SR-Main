import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT='/tmp/claude-1000/-home-john/fc7296a5-fab0-4feb-afa9-2423d7d96481/scratchpad/study';
mkdirSync(OUT,{recursive:true});
const PAGES=[
 ['spine','/projects/data-spine'],['spine-gov','/projects/data-spine/governance'],
 ['spine-fed','/projects/data-spine/federation'],
 ['policy','/projects/policy-engine'],['policy-method','/projects/policy-engine/method'],
 ['policy-monitor','/projects/policy-engine/monitor'],
 ['engine','/projects/engine-room'],['engine-ground','/projects/engine-room/ground'],
 ['strategy','/projects/dfe-data-strategy'],['convergence','/projects/data-convergence'],
 ['projects','/projects'],
];
const b=await chromium.launch(); const rep=[];
for (const [w,h,tag] of [[1440,900,'1440'],[390,844,'390']]) {
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  const p=await ctx.newPage();
  for (const [name,path] of PAGES) {
    const errs=[]; const on=e=>errs.push(String(e).slice(0,130)); p.on('pageerror',on);
    let st=0;
    try{ const r=await p.goto('http://localhost:5331'+path,{waitUntil:'networkidle',timeout:40000}); st=r?.status()??0; }
    catch{ try{ const r=await p.goto('http://localhost:5331'+path,{waitUntil:'domcontentloaded',timeout:25000}); st=r?.status()??0; }catch{} }
    await p.waitForTimeout(2000);
    const o=await p.evaluate(()=>({d:document.documentElement.scrollWidth,c:document.documentElement.clientWidth}));
    rep.push({name,tag,st,over:o.d>o.c+1?o.d-o.c:0,errors:errs.slice(0,2)});
    await p.screenshot({path:`${OUT}/${name}-${tag}.png`}); p.off('pageerror',on);
  }
  await ctx.close();
}
await b.close();
const bad=rep.filter(r=>r.over||r.errors.length||r.st>=400);
console.log('checked',rep.length,'problems',bad.length);
for(const r of bad) console.log(JSON.stringify(r));
