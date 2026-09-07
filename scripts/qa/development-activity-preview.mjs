/** Real LAN UI and durable API replay; loopback SSE fixture supplies token deltas. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import pg from 'pg';
const base = 'http://192.168.0.77:5275';
const clients = new Set();
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': base, 'cache-control': 'no-cache' });
  res.write('retry: 60000\n: fixture\n\n'); clients.add(res);
  req.on('close', () => clients.delete(res));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/events`;
const client = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await client.connect();
const browser = await chromium.launch({ headless: true });
// The fixture SSE uses a separate loopback port; production remains same-origin.
const page = await browser.newPage({ bypassCSP: true });
page.on('pageerror', error => console.error('Browser error:', error.message));
let id;
const send = data => { for (const res of clients) res.write(`id: -1\ndata: ${JSON.stringify(data)}\n\n`); };
try {
 await page.route('**/api/jkai/builds/*/stream', route => route.fulfill({ status: 307, headers: { location: endpoint } }));
 await page.goto(`${base}/jkai/develop`, { waitUntil: 'networkidle' });
 const created = await page.request.post(`${base}/api/jkai/development`, { data: { area: 'Platform', outcome: 'Synthetic visible code stream' } });
 assert.equal(created.status(), 201); id = (await created.json()).buildId;
 await client.query("update jkai_build_deliveries set state=jsonb_set(state,'{brief,acceptedAt}',to_jsonb(now()::text)) where build_id=$1", [id]);
 await client.query("update jkai_builds set status='running',heartbeat_at=now() where id=$1", [id]);
 await client.query("update jkai_build_deliveries set state=jsonb_set(jsonb_set(state,'{candidate}',to_jsonb('fixture-v1'::text)),'{criteria}',$2::jsonb) where build_id=$1", [id, JSON.stringify([{id:'c1',text:'The page opens',verdict:'passed',evidence:'Synthetic fixture',revision:'fixture-v1'},{id:'c2',text:'Navigation passes',verdict:'unverified',evidence:'',revision:null}])]);
 await client.query("update jkai_builds set model_provider='codex',model_id='codex/gpt-5.6-luna',budget_config=jsonb_set(budget_config,'{maxTokensPerIteration}','20000') where id=$1", [id]);
 await client.query("insert into jkai_iterations(build_id,number,status,goals,evaluation,tokens_used,output_tokens) values($1,1,'completed','Create the page','Page scaffold created; checks still need to pass',120000,1000),($1,2,'running','Fix navigation and rerun checks',null,50000,500)", [id]);
 await client.query("insert into jkai_logs(build_id,type,content) values($1,'code','npm run check — synthetic saved command')", [id]);
 await page.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'domcontentloaded' });
 await page.getByText('Live stream connected', { exact: true }).waitFor();
 await page.getByRole('button', { name: 'Build', exact: true }).click();
 await page.getByText('Iteration 2 in progress', { exact: true }).waitFor();
 await page.getByText('170,000', { exact: true }).waitFor();
 await page.getByText('1,500', { exact: true }).waitFor();
 await page.getByText('1 / 2', { exact: true }).waitFor();
 await page.getByText('Codex usage is tracked in tokens.', { exact: false }).waitFor();
 assert.equal(await page.getByText(/\$0\.00 spent/).count(), 0);
 await client.query("update jkai_iterations set output_tokens=800,tokens_used=53000 where build_id=$1 and number=2", [id]);
 await page.getByText('1,800', { exact: true }).waitFor();
 const output = page.getByRole('log', { name: 'Code generation and command output' });
 await output.getByText('npm run check — synthetic saved command', { exact: true }).waitFor();
 send({ type: 'stream_tool_start', streamId: 'fixture:1', iterationId: null, toolName: 'write' });
 send({ type: 'stream_tool_delta', streamId: 'fixture:1', iterationId: null, delta: '<h1>Streaming ' });
 await output.getByText(/<h1>Streaming/).waitFor();
 send({ type: 'stream_tool_delta', streamId: 'fixture:1', iterationId: null, delta: 'code is visible</h1>' });
 await output.getByText(/Streaming code is visible/).waitFor();
 for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 });
   await page.getByRole('region', {name:'Build progress and token usage'}).scrollIntoViewIfNeeded();
   await page.screenshot({path: `/tmp/development-progress-${width}.png`, fullPage:true});
   await output.scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.screenshot({ path: `/tmp/development-activity-${width}.png`, fullPage: true });
 }
 send({ type: 'stream_tool_end', streamId: 'fixture:1', iterationId: null, full: 'write completed' });
 await client.query("insert into jkai_logs(build_id,type,content) values($1,'code','Saved generated code survives reload')", [id]);
 await output.getByText('Saved generated code survives reload', { exact: true }).waitFor();
 for (const res of clients) res.end();
 await page.getByText('Live stream reconnecting', { exact: true }).waitFor();
 await client.query("insert into jkai_logs(build_id,type,content) values($1,'error','Synthetic compiler failure visible during reconnect')", [id]);
 await output.getByText('Synthetic compiler failure visible during reconnect', { exact: true }).waitFor();
 await client.query("update jkai_builds set heartbeat_at=now()-interval '3 minutes' where id=$1", [id]);
 await page.getByText('Worker heartbeat not confirmed', { exact: true }).waitFor();
 await page.reload({ waitUntil: 'domcontentloaded' });
 await page.getByText('Live stream connected', { exact: true }).waitFor();
 await page.getByRole('button', { name: 'Build', exact: true }).click();
 await output.getByText('Saved generated code survives reload', { exact: true }).waitFor();
 assert.equal(await output.getByText('Saved generated code survives reload', { exact: true }).count(), 1);
 await client.query("update jkai_builds set status='paused' where id=$1", [id]);
 await page.getByText('Build paused', { exact: true }).waitFor();
 console.log('PASS: running goal, live Codex token counters, output budget, assessment, live token deltas, code/command output, durable replay, reconnect error visibility, heartbeat warning, paused status and desktop/phone layout. Synthetic SSE; no model called.');
} catch (error) {
 await page.screenshot({path: '/tmp/development-progress-failure.png', fullPage:true});
 console.error((await page.locator('body').innerText()).slice(-3000)); throw error;
} finally {
 if (id) await client.query('delete from jkai_builds where id=$1', [id]);
 await client.end(); await browser.close(); for (const res of clients) res.end(); server.close();
}
