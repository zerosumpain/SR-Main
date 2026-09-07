/** Persistent synthetic example: exercise the real isolated preview without a model call. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base='http://192.168.0.77:5275';
const id=process.env.INSPECTION_BUILD_ID;
if(!id || !/^[a-f0-9-]{36}$/.test(id))throw new Error('Provide the ID of a prepared synthetic local inspection build');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();page.on('pageerror',e=>console.error('Browser error:',e.message));
 await page.goto(`${base}/jkai/develop/${id}`,{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Stopped · no verified delivery',exact:true}).waitFor();
 await page.getByText(/Last repository failure/).click();
 await page.getByRole('region',{name:'Build progress and token usage'}).getByText(/FAIL Tests: synthetic repository check/).waitFor();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  await page.getByRole('region',{name:'Build progress and token usage'}).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`/tmp/development-blocked-${width}.png`,fullPage:true});
 }
 await page.getByRole('button',{name:'Prepare inspection preview',exact:true}).click();
 await page.getByText(/Preparing an isolated site|Snapshotting saved work/).waitFor({timeout:60000});
 console.log('PASS: stopped state, visible failed check, compact wide/narrow layout and preparation progress. Building real isolated preview…');
 await page.getByRole('link',{name:'Open site preview ↗'}).waitFor({timeout:900000});
 const data=await (await page.request.get(`${base}/api/jkai/development/${id}`)).json();
 assert.equal(data.delivery.state.preview.status,'ready');assert.equal(data.delivery.state.gate.passed,false);
 assert.equal(data.delivery.state.acceptedAt,null);assert.match(data.blocker,/passing repository gate/);
 const previewHref=await page.getByRole('link',{name:'Open site preview ↗'}).getAttribute('href');
 assert.equal(new URL(previewHref).pathname,'/inspection-example');
 const preview=await browser.newPage();await preview.goto(previewHref,{waitUntil:'domcontentloaded'});
 await preview.getByRole('heading',{name:'Saved work can be inspected'}).waitFor({timeout:30000});
 await page.getByRole('button',{name:'Delivery',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Accept into batch',exact:true}).isDisabled(),true);
 console.log('PASS: real isolated inspection page loads; failed checks remain visible and batch acceptance remains disabled. No model called.');
} finally { await browser.close(); }
