import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const fixtures=JSON.parse(await readFile(new URL('../tests/fixtures/intelligence/identity.json',import.meta.url),'utf8'));
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {assessIdentity}=await server.ssrLoadModule('/src/lib/jkai/intel/resolve/policy.ts');
  const {scorePair}=await server.ssrLoadModule('/src/lib/jkai/intel/resolve/match.ts');
  const entity=(value,id)=>({id,name:value.name,typeId:value.type,typeName:value.type,properties:value.email?{email:value.email}:{},embedding:null,degree:0,noteCount:0});
  const results=fixtures.pairs.map(p=>{const a=entity(p.a,'a'),b=entity(p.b,'b');const assessment=assessIdentity(a,b,{},p.decision);return {name:p.name,label:p.same,legacyAuto:(scorePair(a,b)?.confidence??0)>=.85,auto:assessment.canLink,reason:assessment.reason};});
  const metrics=key=>{const tp=results.filter(r=>r[key]&&r.label).length,fp=results.filter(r=>r[key]&&!r.label).length,fn=results.filter(r=>!r[key]&&r.label).length;return {truePositive:tp,falsePositive:fp,falseNegative:fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null};};
  const report={corpus:fixtures.description,count:results.length,legacy:metrics('legacyAuto'),sharedPolicy:metrics('auto'),cases:results};
  const predictionPath=process.argv[process.argv.indexOf('--extraction')+1];
  if(process.argv.includes('--extraction')){
    const predictions=JSON.parse(await readFile(predictionPath,'utf8'));let tp=0,fp=0,fn=0;
    for(const expected of fixtures.extraction){const actual=predictions.find(p=>p.text===expected.text)?.mentions??[];const key=m=>`${m.text}|${m.type}`;const truth=new Set(expected.mentions.map(key));const found=new Set(actual.map(key));tp+=[...found].filter(k=>truth.has(k)).length;fp+=[...found].filter(k=>!truth.has(k)).length;fn+=[...truth].filter(k=>!found.has(k)).length;}
    report.extraction={precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,truePositive:tp,falsePositive:fp,falseNegative:fn};
  }
  await writeFile('/tmp/jkai-intelligence-evaluation.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.sharedPolicy.falsePositive>0)process.exitCode=1;
} finally {await server.close();}
