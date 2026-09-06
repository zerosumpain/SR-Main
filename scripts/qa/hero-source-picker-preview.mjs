import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base='http://192.168.0.77:5275';
const db=new pg.Client({connectionString:'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local'});
await db.connect();
const keys=['landing.hero.selected','landing.hero.preparation'];
const previous=(await db.query('select key,value from app_settings where key=any($1)',[keys])).rows;
const priorAssets=new Set((await db.query("select key from app_settings where key like 'landing.hero.prepared.%'")).rows.map(r=>r.key));
const work=await mkdtemp(join(tmpdir(),'sr-hero-picker-'));
const browser=await chromium.launch({headless:true});
const files=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=24:duration=3','-c:v','libx264','-preset','ultrafast',join(work,'source.mp4')]);
 const clip=await readFile(join(work,'source.mp4'));
 async function upload(name,buffer=clip,permissions={read:true}) {
  const r=await context.request.post(base+'/api/files/upload',{multipart:{name,file:{name:'clip.mp4',mimeType:'video/mp4',buffer},permissions:JSON.stringify(permissions)}});
  assert.equal(r.status(),200,await r.text()); const f=(await r.json()).file;files.push(f.id);return f;
 }
 const source=await upload('siteherobackground/Synthetic picker check.mp4');
 const privateFile=await upload('private/Synthetic hidden clip.mp4');
 const nested=await upload('siteherobackground/nested/Synthetic nested clip.mp4');
 const unreadable=await upload('siteherobackground/Synthetic unreadable clip.mp4',clip,{read:false});
 const invalid=await upload('siteherobackground/Synthetic invalid clip.mp4',Buffer.from('not an mp4'));
 const original=await (await context.request.get(`${base}/api/files/${source.id}/download`)).body();
 await page.goto(base+'/admin/content/hero',{waitUntil:'networkidle',timeout:120000});
 const section=page.getByRole('region',{name:'Background video',exact:true});
 const select=section.getByLabel('MP4 from siteherobackground',{exact:true});
 await select.waitFor();
 const values=await select.locator('option').evaluateAll(options=>options.map(o=>o.value));
 assert(values.includes(source.id)&&values.includes(invalid.id));
 for(const file of [privateFile,nested,unreadable]) {
  assert(!values.includes(file.id));
  const r=await context.request.post(base+'/admin/content/hero/background',{data:{sourceId:file.id}});
  assert.equal(r.status(),400);
 }
 await select.selectOption(source.id);
 await section.getByRole('button',{name:'Prepare & apply',exact:true}).click();
 await section.getByRole('status').filter({hasText:'Preparing'}).waitFor();
 const duplicate=await context.request.post(base+'/admin/content/hero/background',{data:{sourceId:source.id}});
 assert.equal(duplicate.status(),400);
 await section.getByText('Default updated.',{exact:false}).waitFor({timeout:120000});
 const selected=(await db.query('select value from app_settings where key=$1',[keys[0]])).rows[0].value;
 assert.equal(selected.sourceId,source.id);
 assert(selected.asset.desktopBytes<=2_000_000&&selected.asset.mobileBytes<=1_000_000);
 assert.equal(selected.asset.duration,3);
 assert.equal((await db.query('select id from workflow_files where disk_path=any($1)',[Object.values(selected.paths)])).rowCount,3);
 assert.deepEqual(await (await context.request.get(`${base}/api/files/${source.id}/download`)).body(),original);
 const range=await context.request.get(base+selected.asset.desktop,{headers:{range:'bytes=0-127'}});
 assert.equal(range.status(),206);assert.equal((await range.body()).length,128);
 assert.equal((await context.request.get(base+selected.asset.desktop,{headers:{range:'bytes=999999999-'}})).status(),416);
 assert.equal((await context.request.get(`${base}/api/landing/hero-media?id=${privateFile.id}&variant=desktop`)).status(),404);
 for(const kind of ['desktop','mobile']) {
  const response=await context.request.get(base+selected.asset[kind]);
  const path=join(work,kind+'.mp4');await writeFile(path,await response.body());
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',path]));
  assert.equal(probe.streams.length,1);assert.equal(probe.streams[0].codec_name,'h264');
  assert(probe.streams[0].width<=(kind==='desktop'?960:480));
 }
 await page.reload({waitUntil:'networkidle'});
 assert.equal(await select.inputValue(),source.id);
 await section.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/sr-hero-source-wide.png'});
 await page.setViewportSize({width:390,height:844});
 await select.focus();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await section.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/sr-hero-source-narrow.png'});
 const home=await context.newPage();
 await home.goto(base,{waitUntil:'domcontentloaded',timeout:90000});
 await home.locator('.hero-copy [data-phase="settled"]').waitFor({timeout:30000});
 assert.equal(await home.locator('.hero-copy video').getAttribute('src'),selected.asset.desktop);
 assert.equal(await home.locator('.hero-copy .hero-animation').evaluate(e=>getComputedStyle(e).opacity),'0.2');
 await home.close();
 await select.selectOption(invalid.id);await section.getByRole('button',{name:'Prepare & apply',exact:true}).click();
 await section.getByRole('alert').filter({hasText:'could not be read'}).waitFor({timeout:30000});
 assert.equal((await db.query('select value from app_settings where key=$1',[keys[0]])).rows[0].value.sourceId,source.id);
 await select.selectOption('');await section.getByRole('button',{name:'Use included animation',exact:true}).click();
 await section.getByText('Included animation restored.',{exact:true}).waitFor();
 assert.equal((await db.query('select key from app_settings where key=$1',[keys[0]])).rowCount,0);
 // An already published derivative remains available for a visitor who loaded before a switch.
 assert.equal((await context.request.get(base+selected.asset.desktop)).status(),200);
 assert.deepEqual(errors,[]);
 console.log('PASS: folder and read-permission filtering; server-side conversion; concurrent-job rejection; original unchanged; persistent selection; desktop/phone byte budgets and no audio; range serving; no private-ID access; failed conversion retains prior hero; restore included animation; desktop/mobile UI and homepage playback.');
} finally {
 const prepared=(await db.query("select key,value from app_settings where key like 'landing.hero.prepared.%'")).rows.filter(r=>!priorAssets.has(r.key));
 const sources=(await db.query('select disk_path from workflow_files where id=any($1)',[files])).rows;
 const paths=[...sources.map(r=>r.disk_path),...prepared.flatMap(r=>Object.values(r.value.paths))];
 await db.query('delete from workflow_files where id=any($1)',[files]);
 await db.query('delete from workflow_files where disk_path=any($1)',[prepared.flatMap(r=>Object.values(r.value.paths))]);
 await db.query('delete from app_settings where key=any($1)',[[...keys,...prepared.map(r=>r.key)].flat()]);
 for(const row of previous) await db.query('insert into app_settings(key,value) values($1,$2)',[row.key,row.value]);
 if(paths.length) execFileSync('docker',['exec','porkserv-local-jkai-1','node','-e',"const fs=require('fs');for(const path of process.argv.slice(1)){try{fs.unlinkSync(path)}catch{}}",...paths]);
 await browser.close();await db.end();await rm(work,{recursive:true,force:true});
}
