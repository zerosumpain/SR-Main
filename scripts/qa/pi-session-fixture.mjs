/** Exercise the pinned real Pi binary with a deterministic local provider; no paid model calls. */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'sr-pi-session-'));
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.ok(body.messages.length);
  await new Promise((r) => setTimeout(r, 350));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const needsDecision = body.messages.at(-1)?.role === 'user' && JSON.stringify(body.messages.at(-1)).includes('ask-owner-fixture');
  const choices = needsDecision ? [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'decision-1', type: 'function', function: { name: 'ask_owner', arguments: JSON.stringify({ question: 'Who can see this feature?' }) } }] }, finish_reason: null }, { delta: {}, finish_reason: 'tool_calls' }] : [{ delta: { role: 'assistant', content: 'Fixture response: session retained.' }, finish_reason: null }, { delta: {}, finish_reason: 'stop' }];
  for (const choice of choices) {
    res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, ...choice }] })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
await writeFile(join(dir, 'provider.mjs'), `export default function(pi) { pi.registerTool({ name: 'ask_owner', label: 'Ask owner', description: 'Request a product decision', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }, async execute(id, params, signal, update, ctx) { const answer = await ctx.ui.input(params.question, 'Answer'); return { content: [{ type: 'text', text: answer ?? 'No answer' }], details: {} }; } }); pi.registerProvider('sr-fixture', { baseUrl: 'http://127.0.0.1:${server.address().port}/v1', apiKey: 'fixture-only', api: 'openai-completions', models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }] }); }`);
function start() {
  const child = spawn('pi', ['--mode', 'rpc', '--session-dir', join(dir, 'sessions'), '--continue', '--no-context-files', '--no-skills', '--no-prompt-templates', '--extension', join(dir, 'provider.mjs'), '--provider', 'sr-fixture', '--model', 'fixture'], { cwd: dir, env: { ...process.env, PI_CODING_AGENT_DIR: join(dir, 'agent') } });
  let buffer = '', seq = 0, stderr = ''; const replies = new Map(); const events = [];
  child.stderr.on('data', (s) => stderr += s);
  child.stdout.on('data', (data) => { buffer += data; let i; while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (!line.trim()) continue;
    const event = JSON.parse(line); events.push(event);
    if (event.type === 'response' && replies.has(event.id)) { const handler = replies.get(event.id); replies.delete(event.id); event.success ? handler.resolve(event) : handler.reject(Error(event.error)); }
  } });
  const closed = new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })));
  return { events, async crash() { child.kill('SIGKILL'); await closed; }, send(event) { child.stdin.write(JSON.stringify(event) + '\n'); }, request(type, fields = {}) { const id = String(++seq); return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`RPC timeout ${type}: ${stderr}`)), 20000);
    replies.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    child.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
  }); }, async end() { child.stdin.end(); const result = await closed; assert.equal(result.code, 0, result.stderr); } };
}
async function ended(worker) { for (let i = 0; i < 200; i++) { if (worker.events.some((e) => e.type === 'agent_end')) return; await new Promise((r) => setTimeout(r, 50)); } throw Error('No agent_end'); }
try {
  const first = start();
  const state = (await first.request('get_state')).data;
  await first.request('prompt', { message: 'Remember feature alpha.' });
  await first.request('steer', { message: '[sr-instruction:17]\nPreserve the phone controls.' });
  await ended(first);
  const before = (await first.request('get_messages')).data.messages;
  assert.match(JSON.stringify(before), /sr-instruction:17/);
  await first.end();
  const second = start();
  const resumed = (await second.request('get_state')).data;
  assert.equal(resumed.sessionId, state.sessionId);
  assert.deepEqual((await second.request('get_messages')).data.messages, before);
  await second.request('prompt', { message: 'Continue feature alpha.' });
  await ended(second);
  assert.ok((await second.request('get_messages')).data.messages.length > before.length);
  await second.end();
  const third = start();
  await third.request('prompt', { message: 'ask-owner-fixture' });
  let question;
  for (let i = 0; i < 200; i++) { question = third.events.find((e) => e.type === 'extension_ui_request'); if (question) break; await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(question?.title, 'Who can see this feature?');
  assert.ok(!third.events.some((e) => e.type === 'agent_end'));
  third.send({ type: 'extension_ui_response', id: question.id, value: 'Only the owner.' });
  await ended(third);
  assert.match(JSON.stringify((await third.request('get_messages')).data.messages), /Only the owner/);
  await third.end();
  const interrupted = start();
  await interrupted.request('prompt', { message: 'crash-fixture: retain this unfinished request' });
  for (let i = 0; i < 100; i++) { if (interrupted.events.some((e) => e.type === 'message_end' && e.message?.role === 'user')) break; await new Promise((r) => setTimeout(r, 10)); }
  await new Promise((r) => setTimeout(r, 50));
  await interrupted.crash();
  const recovered = start();
  assert.equal((await recovered.request('get_state')).data.sessionId, state.sessionId);
  assert.match(JSON.stringify((await recovered.request('get_messages')).data.messages), /crash-fixture/);
  await recovered.request('prompt', { message: 'Recover the unfinished request without replaying completed work.' });
  await ended(recovered); await recovered.end();
  console.log('PASS: real Pi RPC, steering, durable transcript, same session after process restart continuation and a blocking owner decision/answer and forced-shutdown recovery. Synthetic provider; zero model spend.');
} finally { server.close(); await rm(dir, { recursive: true, force: true }); }
